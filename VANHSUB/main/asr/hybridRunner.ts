import fs from 'fs';
import path from 'path';
import { TaskStore, type Task } from '../store/taskStore';
import {
  DEFAULT_OCR_DUAL_REGIONS,
  SettingsStore,
  type OcrDualRegions,
} from '../store/settingsStore';
import { extract16kHzWav } from './audioExtractor';
import { transcribeUnified } from './asrRouter';
import { OcrRunner } from '../ocr/ocrRunner';
import type { OcrCustomRegion, OcrMode } from '../ocr/frameExtractor';
import { buildOverlaySegmentsFromTopFrames } from '../ocr/subtitleBuilder';
import { TaskRunner } from './taskRunner';
import { nextAvailablePath } from '../lib/paths';
import { parseSrt, serializeSrt, type SrtLine } from '../lib/srt';
import { sanitizeSubtitles } from '../lib/subtitleSanitizer';
import { deduplicateSubtitlesPipeline } from '../lib/subtitleDeduplication';
import { fuseOcrAndWhisper } from './hybridFusionEngine';
import { normalizeSrtLines } from '../lib/srtNormalizer';
import { validateSubtitleTimeline } from '../lib/timelineDiagnostics';
import { TranslateRunner } from '../translate/translateRunner';
import { CancelledError, isCancelledError } from '../lib/cancel';
import { getProjectArtifactPaths } from '../utils/projectFolder';
import {
  reconcileAsrAndOcrWithGemini,
  type AsrOcrReconcileItem,
} from '../ai/geminiClient';

const AUDIO_EXTENSIONS = new Set(['.mp3', '.wav', '.m4a', '.flac', '.aac', '.ogg', '.opus', '.wma']);

export interface HybridRunOptions {
  asrModel?: string;
  ocrMode?: OcrMode;
  ocrFps?: number;
  ocrLanguage?: string;
  ocrCustomRegion?: OcrCustomRegion | null;
  ocrDualRegions?: OcrDualRegions | null;
  dualEngine?: boolean;
  useGeminiAi?: boolean;
}

export class HybridRunner {
  private static runningTasks = new Set<string>();
  private static cancelledTasks = new Set<string>();

  static isRunning(taskId: string): boolean {
    return this.runningTasks.has(taskId);
  }

  static cancel(taskId: string): boolean {
    if (!this.runningTasks.has(taskId)) return false;
    this.cancelledTasks.add(taskId);
    // Lan truyền lệnh huỷ sang cả Whisper và OCR nếu đang trong tiến trình con
    TaskRunner.cancel(taskId);
    OcrRunner.cancel(taskId);
    return true;
  }

  static async runHybrid(
    taskId: string,
    options?: HybridRunOptions,
    onUpdate?: () => void
  ): Promise<Task | undefined> {
    const task = TaskStore.getById(taskId);
    if (!task) throw new Error(`Không tìm thấy tác vụ ID: ${taskId}`);

    if (this.runningTasks.has(taskId)) {
      return task;
    }

    const ext = path.extname(task.filePath).toLowerCase();
    if (AUDIO_EXTENSIONS.has(ext)) {
      throw new Error('Chế độ Kết hợp Whisper + OCR yêu cầu file video (cần hình ảnh để quét chữ).');
    }

    this.runningTasks.add(taskId);
    this.cancelledTasks.delete(taskId);

    try {
      const { projectDir, audioWavPath } = getProjectArtifactPaths(task);
      const asrModel = options?.asrModel || task.asrModel || SettingsStore.get('asrModel') || 'large-v3-turbo';
      const ocrMode = (options?.ocrMode || SettingsStore.get('ocrMode') || 'auto') as OcrMode;
      const ocrDualRegions =
        ocrMode === 'dual'
          ? (options?.ocrDualRegions ?? SettingsStore.get('ocrDualRegions') ?? DEFAULT_OCR_DUAL_REGIONS)
          : null;
      const useGeminiAi = options?.useGeminiAi ?? (SettingsStore.get('hybridUseGeminiAi') !== false);

      // -----------------------------------------------------------------------
      // GIAI ĐOẠN 1: PHIÊN ÂM WHISPER ASR (0% -> 35%)
      // -----------------------------------------------------------------------
      let whisperSegments: SrtLine[] = [];

      if (task.ttsAudioDir && fs.existsSync(task.ttsAudioDir)) {
        try {
          fs.rmSync(task.ttsAudioDir, { recursive: true, force: true });
        } catch {}
      }

      TaskStore.update(taskId, {
        status: 'transcribing',
        progress: 5,
        projectDir,
        stageDescription: '[Hybrid 1/3] Đang trích xuất audio 16kHz cho Whisper...',
        srtPath: undefined,
        translatedSrtPath: undefined,
        overlaySrtPath: undefined,
        translatedOverlaySrtPath: undefined,
        ttsAudioDir: undefined,
        ttsMergedAudioPath: undefined,
        outputPath: undefined,
        ttsOverruns: undefined,
      });
      onUpdate?.();

      if (this.cancelledTasks.has(taskId)) throw new CancelledError();

      const { wavPath } = await extract16kHzWav(task.filePath, audioWavPath, (percent) => {
        TaskStore.update(taskId, {
          progress: 5 + Math.round(percent * 0.1), // 5% -> 15%
        });
        onUpdate?.();
      });

      if (this.cancelledTasks.has(taskId)) throw new CancelledError();

      TaskStore.update(taskId, {
        progress: 15,
        audioPath: wavPath,
        stageDescription: `[Hybrid 1/3] Đang nhận diện giọng nói Whisper (${asrModel})...`,
      });
      onUpdate?.();

      console.log(`[HybridRunner] Bắt đầu phiên âm Whisper (${asrModel})...`);
      const whisperResult = await transcribeUnified(wavPath, {
        model: asrModel,
        asrEngine: task.asrEngine || (SettingsStore.get('asrEngine') as 'faster-whisper' | 'whisper-cpp') || 'faster-whisper',
        enableDiarization: task.enableDiarization ?? (SettingsStore.get('enableDiarization') as boolean),
        speakerCount: task.speakerCount,
        hfToken: SettingsStore.get('hfToken') as string,
        onProgress: (percent) => {
          TaskStore.update(taskId, {
            progress: 15 + Math.round(percent * 0.2), // 15% -> 35%
            stageDescription:
              percent < 100
                ? `[Hybrid 1/3] Đang phiên âm Whisper (${percent}%)...`
                : '[Hybrid 1/3] Hoàn tất phiên âm Whisper, chuyển sang quét OCR...',
          });
          onUpdate?.();
        },
        shouldStop: () => this.cancelledTasks.has(taskId),
      });

      if (this.cancelledTasks.has(taskId)) throw new CancelledError();

      if (fs.existsSync(whisperResult.srtPath)) {
        const whisperSrtContent = fs.readFileSync(whisperResult.srtPath, 'utf-8');
        whisperSegments = parseSrt(whisperSrtContent);
        for (const line of whisperSegments) {
          line.source = 'asr';
          line.speechStartMs = line.startMs;
          line.speechEndMs = line.endMs;
          line.words = whisperResult.words?.filter((word) =>
            word.startMs >= line.startMs - 2 && word.endMs <= line.endMs + 2);
        }
      }
      console.log(`[HybridRunner] Whisper ASR hoàn tất: ${whisperSegments.length} dòng lời thoại.`);

      // -----------------------------------------------------------------------
      // GIAI ĐOẠN 2: QUÉT CHỮ KHUNG HÌNH BẰNG OCR (35% -> 85%)
      // -----------------------------------------------------------------------
      TaskStore.update(taskId, {
        status: 'ocr',
        progress: 35,
        stageDescription: '[Hybrid 2/3] Bắt đầu quét phụ đề khung hình video (OCR)...',
      });
      onUpdate?.();

      console.log(`[HybridRunner] Bắt đầu quét chữ video qua OcrRunner (chế độ ${ocrMode})...`);
      await OcrRunner.runOcr(
        taskId,
        {
          mode: ocrMode,
          fps: options?.ocrFps,
          language: options?.ocrLanguage,
          customRegion: options?.ocrCustomRegion,
          dualRegions: ocrDualRegions,
          dualEngine: options?.dualEngine,
          isSubTask: true,
        },
        onUpdate
      );

      if (this.cancelledTasks.has(taskId)) throw new CancelledError();

      // Đọc cả file SRT phụ đề dưới (nếu có) và file SRT bảng/thông tin trên (nếu quét dual)
      const updatedTask = TaskStore.getById(taskId);
      const ocrSrtPath = updatedTask?.srtPath;
      const ocrOverlaySrtPath = updatedTask?.overlaySrtPath;
      const ocrSegments =
        ocrSrtPath && fs.existsSync(ocrSrtPath) ? parseSrt(fs.readFileSync(ocrSrtPath, 'utf-8')) : [];
      const topOverlaySegments =
        ocrOverlaySrtPath && fs.existsSync(ocrOverlaySrtPath)
          ? parseSrt(fs.readFileSync(ocrOverlaySrtPath, 'utf-8'))
          : [];

      if (ocrSegments.length === 0 && topOverlaySegments.length === 0) {
        throw new Error('Quá trình OCR không tạo ra file phụ đề hoặc bảng thông tin nào.');
      }

      const ocrById = new Map<string, SrtLine>();
      for (const seg of ocrSegments) {
        ocrById.set(seg.id, seg);
      }
      console.log(
        `[HybridRunner] OCR hoàn tất: ${ocrSegments.length} dòng vùng dưới, ${topOverlaySegments.length} dòng vùng trên.`,
      );

      // -----------------------------------------------------------------------
      // GIAI ĐOẠN 3: HỢP NHẤT ĐA PHƯƠNG THỨC (CROSS-MODAL FUSION + GEMINI AI) (85% -> 99%)
      // -----------------------------------------------------------------------
      TaskStore.update(taskId, {
        status: 'ocr',
        progress: 88,
        stageDescription: '[Hybrid 3/3] Đang hợp nhất thời gian theo OCR & sửa lỗi chữ bằng Whisper...',
      });
      onUpdate?.();

      const shouldRouteOverlay = ocrMode === 'dual' || useGeminiAi;
      console.log(`[HybridRunner] Đang thực thi Cross-Modal Fusion Engine (routeOverlay=${shouldRouteOverlay})...`);
      const fusionResult = fuseOcrAndWhisper(ocrSegments, whisperSegments, {
        toleranceMs: 800,
        minSimilarityThreshold: 0.35,
        useGeminiAi,
        preserveSpeechOnlyWhisper: true,
        deduplicateKaraoke: true,
        timingSource: 'speech',
        routeUnmatchedOverlappingToOverlay: shouldRouteOverlay,
      });

      let finalSegments: SrtLine[] = [...fusionResult.segments];
      let reclaimedOverlay: SrtLine[] = [...(fusionResult.overlaySegments || [])];
      let aiCorrectedCount = 0;

      if (useGeminiAi && SettingsStore.hasGeminiKey() && whisperSegments.length > 0) {
        TaskStore.update(taskId, {
          progress: 93,
          stageDescription: '[Hybrid 3/3] Gemini AI đang đối chiếu Whisper ASR & OCR...',
        });
        onUpdate?.();

        const reconciled = await reconcileHybridWithGemini(
          finalSegments,
          reclaimedOverlay,
          ocrById,
          whisperSegments,
        );
        finalSegments = reconciled.subtitles;
        reclaimedOverlay = reconciled.overlays;
        aiCorrectedCount = reconciled.aiUpdatedCount;
      }

      console.log(
        `[HybridRunner] Fusion hoàn tất: ${finalSegments.length} dòng thoại, ${topOverlaySegments.length + reclaimedOverlay.length} dòng bảng/thông tin. Sửa ${fusionResult.stats.typosRepaired} chính tả, phục hồi ${fusionResult.stats.diacriticsRestored} dấu, AI đối chiếu ${aiCorrectedCount} câu.`,
      );

      // Ghi file .srt kết quả [base]_hybrid.srt & (nếu có) [base]_hybrid_overlay.srt
      const videoDir = path.dirname(task.filePath);
      const base = path.basename(task.filePath, path.extname(task.filePath));
      const hybridTargetPath = finalSegments.length > 0
        ? nextAvailablePath(path.join(videoDir, `${base}_hybrid.srt`))
        : undefined;

      if (finalSegments.length > 0) {
        try {
          finalSegments = deduplicateSubtitlesPipeline(finalSegments);
          console.log(`[HybridRunner] [Dedup] Đã khử trùng lặp phụ đề kết hợp (${finalSegments.length} dòng).`);
        } catch (dedupErr) {
          console.warn(`[HybridRunner] [Dedup] Bỏ qua khử trùng lặp do lỗi:`, dedupErr);
        }

        try {
          const sanitizeResult = sanitizeSubtitles(finalSegments, { whisperSegments });
          if (sanitizeResult.removedCount > 0) {
            console.log(`[HybridRunner] [Sanitizer] Đã lọc bỏ ${sanitizeResult.removedCount} dòng rác OCR sau hợp nhất.`);
            finalSegments = sanitizeResult.cleaned;
          }
        } catch (sanErr) {
          console.warn(`[HybridRunner] [Sanitizer] Bỏ qua lọc rác do lỗi:`, sanErr);
        }
        try {
          const normResult = normalizeSrtLines(finalSegments, { preserveEvidenceTiming: true });
          finalSegments = normResult.lines;
          console.log(`[HybridRunner] [Normalizer] Đã chuẩn hoá timeline và câu (${finalSegments.length} dòng).`);
        } catch (normErr) {
          console.warn(`[HybridRunner] [Normalizer] Bỏ qua chuẩn hoá timeline do lỗi:`, normErr);
        }
      }

      if (hybridTargetPath && finalSegments.length > 0) {
        const hybridSrtContent = serializeSrt(finalSegments);
        const timelineIssues = validateSubtitleTimeline(finalSegments);
        if (timelineIssues.some((issue) => issue.severity === 'error')) {
          throw new Error(`Hybrid timeline contains invalid timestamps: ${JSON.stringify(timelineIssues.filter((issue) => issue.severity === 'error'))}`);
        }
        fs.writeFileSync(
          hybridTargetPath.replace(/\.srt$/i, '.timeline.json'),
          JSON.stringify({ segments: finalSegments, issues: timelineIssues }, null, 2),
          'utf-8',
        );
        fs.writeFileSync(hybridTargetPath, hybridSrtContent, 'utf-8');
      }

      const mergedOverlaySegments =
        topOverlaySegments.length > 0 || reclaimedOverlay.length > 0
          ? buildOverlaySegmentsFromTopFrames([], 500, [...topOverlaySegments, ...reclaimedOverlay])
          : [];
      let hybridOverlayTargetPath: string | undefined;
      if (mergedOverlaySegments.length > 0) {
        hybridOverlayTargetPath = nextAvailablePath(path.join(videoDir, `${base}_hybrid_overlay.srt`));
        fs.writeFileSync(hybridOverlayTargetPath, serializeSrt(mergedOverlaySegments), 'utf-8');
        console.log(`[HybridRunner] Đã ghi ${mergedOverlaySegments.length} dòng bảng/thông tin vào ${hybridOverlayTargetPath}`);
      }

      const stageSummary = mergedOverlaySegments.length > 0
        ? `Hoàn tất Hybrid: ${finalSegments.length} dòng thoại + ${mergedOverlaySegments.length} dòng bảng/thông tin${aiCorrectedCount > 0 ? ` (AI sửa ${aiCorrectedCount})` : ''}`
        : `Hoàn tất kết hợp Whisper + OCR: ${finalSegments.length} dòng (${fusionResult.stats.typosRepaired + fusionResult.stats.diacriticsRestored} sửa lỗi, ${fusionResult.stats.bannersPreserved} banner${aiCorrectedCount > 0 ? `, AI ${aiCorrectedCount}` : ''})`;

      // Cập nhật TaskStore hoàn thành
      const finalTask = TaskStore.update(taskId, {
        status: 'done',
        progress: 100,
        srtPath: finalSegments.length > 0 ? hybridTargetPath : undefined,
        overlaySrtPath: hybridOverlayTargetPath,
        translatedOverlaySrtPath: undefined,
        stageDescription: stageSummary,
      });
      onUpdate?.();

      // Tự động dịch nếu đã cấu hình (dịch cả thoại chính và file bảng nếu có)
      if (SettingsStore.get('autoTranslateAfterAsr') && SettingsStore.hasGeminiKey()) {
        await TranslateRunner.runTranslate(taskId, undefined, onUpdate, { targetTrack: 'both' });
      }

      return finalTask;
    } catch (err: any) {
      if (isCancelledError(err)) {
        console.log(`[HybridRunner] Tác vụ ${taskId} đã được huỷ.`);
        TaskStore.update(taskId, {
          status: 'cancelled',
          stageDescription: 'Đã huỷ tác vụ Kết hợp Whisper + OCR',
        });
      } else {
        console.error(`[HybridRunner] Lỗi kết hợp Whisper + OCR trên tác vụ ${taskId}:`, err);
        TaskStore.update(taskId, {
          status: 'error',
          errorMessage: err?.message || String(err),
          stageDescription: `Lỗi kết hợp: ${err?.message || String(err)}`,
        });
      }
      onUpdate?.();
      return TaskStore.getById(taskId);
    } finally {
      this.runningTasks.delete(taskId);
      this.cancelledTasks.delete(taskId);
      onUpdate?.();
    }
  }
}

async function reconcileHybridWithGemini(
  subSegments: SrtLine[],
  reclaimedOverlay: SrtLine[],
  ocrById: Map<string, SrtLine>,
  whisperSegments: SrtLine[],
): Promise<{ subtitles: SrtLine[]; overlays: SrtLine[]; aiUpdatedCount: number }> {
  const items: AsrOcrReconcileItem[] = [];
  const subIndexToItemIdx = new Map<number, number>();
  const ovIndexToItemIdx = new Map<number, number>();

  for (let i = 0; i < subSegments.length; i++) {
    const seg = subSegments[i];
    if (seg.source !== 'hybrid') continue;
    const rawOcr = seg.sourceIds?.[1] ? ocrById.get(seg.sourceIds[1])?.text : undefined;
    const idx = items.length;
    subIndexToItemIdx.set(i, idx);
    items.push({
      index: idx,
      startMs: seg.startMs,
      endMs: seg.endMs,
      asrText: seg.originalText || '',
      ocrText: rawOcr || seg.text,
      status: 'matched',
      fallbackAction: 'keep_sub',
      fallbackText: seg.text,
    });
  }

  for (let i = 0; i < reclaimedOverlay.length; i++) {
    const ov = reclaimedOverlay[i];
    const overlappingAsr = whisperSegments
      .filter((w) => Math.min(ov.endMs, w.endMs) > Math.max(ov.startMs, w.startMs))
      .map((w) => w.text.trim())
      .filter(Boolean)
      .join(' ');
    const idx = items.length;
    ovIndexToItemIdx.set(i, idx);
    items.push({
      index: idx,
      startMs: ov.startMs,
      endMs: ov.endMs,
      asrText: overlappingAsr,
      ocrText: ov.text,
      status: 'unmatched_ocr_with_speech',
      fallbackAction: 'move_to_overlay',
      fallbackText: ov.text,
    });
  }

  if (items.length === 0) {
    return { subtitles: subSegments, overlays: reclaimedOverlay, aiUpdatedCount: 0 };
  }

  try {
    const decisions = await reconcileAsrAndOcrWithGemini(items);
    const byIdx = new Map(decisions.map((d) => [d.index, d]));
    const nextSubs: SrtLine[] = [];
    const nextOverlays: SrtLine[] = [];
    let aiUpdatedCount = 0;

    for (let i = 0; i < subSegments.length; i++) {
      const seg = subSegments[i];
      const itemIdx = subIndexToItemIdx.get(i);
      const dec = itemIdx !== undefined ? byIdx.get(itemIdx) : undefined;
      if (!dec) {
        nextSubs.push(seg);
        continue;
      }
      if (dec.action === 'move_to_overlay') {
        aiUpdatedCount += 1;
        nextOverlays.push({
          ...seg,
          startMs: seg.displayStartMs ?? seg.startMs,
          endMs: seg.displayEndMs ?? seg.endMs,
          text: dec.text,
          source: 'ocr',
        });
      } else {
        if (dec.text !== seg.text) aiUpdatedCount += 1;
        nextSubs.push({ ...seg, text: dec.text });
      }
    }

    for (let i = 0; i < reclaimedOverlay.length; i++) {
      const ov = reclaimedOverlay[i];
      const itemIdx = ovIndexToItemIdx.get(i);
      const dec = itemIdx !== undefined ? byIdx.get(itemIdx) : undefined;
      if (!dec || dec.action === 'move_to_overlay') {
        nextOverlays.push(dec ? { ...ov, text: dec.text } : ov);
      } else {
        aiUpdatedCount += 1;
        nextSubs.push({ ...ov, text: dec.text, source: 'ocr' });
      }
    }

    nextSubs.sort((a, b) => a.startMs - b.startMs || a.endMs - b.endMs);
    return { subtitles: nextSubs, overlays: nextOverlays, aiUpdatedCount };
  } catch (err) {
    console.warn('[HybridRunner] Bỏ qua đối chiếu Gemini AI do lỗi:', err);
    return { subtitles: subSegments, overlays: reclaimedOverlay, aiUpdatedCount: 0 };
  }
}
