import path from 'path';
import fs from 'fs';
import { app } from 'electron';

import { TaskStore, type Task } from '../store/taskStore';
import { SettingsStore } from '../store/settingsStore';
import { CancelledError, isCancelledError } from '../lib/cancel';
import { nextAvailablePath } from '../lib/paths';
import { TranslateRunner } from '../translate/translateRunner';
import { OcrPool, MIN_LINE_CONFIDENCE } from './ocrEngine';
import {
  extractFrames,
  cleanupFrames,
  type OcrMode,
  type OcrCustomRegion,
} from './frameExtractor';
import {
  buildSubtitleSegments,
  buildSubtitleSegmentsWithStats,
  filterPersistentTopLines,
  segmentsToSrt,
} from './subtitleBuilder';
import { normalizeSrtLines } from '../lib/srtNormalizer';
import { validateSubtitleTimeline } from '../lib/timelineDiagnostics';
import {
  checkRapidOcr,
  mapRecLangNames,
  runPaddleOcr,
  type PaddleOcrFrame,
} from './paddleEngine';
import {
  mergeOcrResults,
  mergedToFrameResults,
  type CropOcrResult,
  type MergedOcrFrame,
} from './resultMerge';

/** File audio thuần không có khung hình — OCR chỉ áp dụng cho video */
const AUDIO_EXTENSIONS = new Set(['.mp3', '.wav', '.m4a', '.flac', '.aac', '.ogg', '.opus', '.wma']);

const VIDEO_EXTENSIONS = new Set(['.mp4', '.mkv', '.avi', '.mov', '.flv', '.wmv', '.webm', '.m4v', '.ts']);

export interface OcrRunOptions {
  mode?: OcrMode;
  customRegion?: OcrCustomRegion | null;
  language?: string;
  fps?: number;
  dualEngine?: boolean;
  isSubTask?: boolean;
}

/**
 * Pipeline quét phụ đề cứng (hardsub):
 *
 *   Video → ffmpeg trích khung (fps + chế độ auto / bottom / full / custom)
 *        → Full-screen text detection (PP-OCRv5 DBNet)
 *        → Tracking (IoU & spatial distance across frames)
 *        → Classification (lọc watermark / logo tĩnh, chọn subtitle theo mode)
 *        → OCR Recognition (khung nét nhất + RapidOCR PP-OCRv5)
 *        → Lượt OCR 2 bằng Tesseract (nếu dualEngine)
 *        → So sánh kết quả 2 engine + confidence (resultMerge.ts)
 *        → Ghép khung trùng nội dung thành dòng phụ đề (Temporal Merging) → .srt
 */
export class OcrRunner {
  private static MAX_PARALLEL_OCR = 1;
  private static runningTasks = new Set<string>();
  private static cancelRequested = new Set<string>();
  private static queue: Array<{
    taskId: string;
    options?: OcrRunOptions;
    onUpdate?: () => void;
    resolve: (t: Task | undefined) => void;
    reject: (err: any) => void;
  }> = [];

  static isRunning(taskId: string): boolean {
    return this.runningTasks.has(taskId);
  }

  static isQueued(taskId: string): boolean {
    return this.queue.some((item) => item.taskId === taskId);
  }

  /** Yêu cầu huỷ — huỷ ngay khỏi hàng đợi hoặc huỷ trước khung OCR kế tiếp (hợp tác). */
  static cancel(taskId: string): boolean {
    // 1. Kiểm tra trong hàng đợi
    const qIndex = this.queue.findIndex((item) => item.taskId === taskId);
    if (qIndex !== -1) {
      const [queuedItem] = this.queue.splice(qIndex, 1);
      TaskStore.update(taskId, {
        status: 'cancelled',
        stageDescription: 'Đã huỷ khỏi hàng đợi OCR',
      });
      queuedItem.onUpdate?.();
      queuedItem.resolve(TaskStore.getById(taskId));
      this.drainQueue();
      return true;
    }

    // 2. Đang thực thi
    if (!this.runningTasks.has(taskId)) return false;
    this.cancelRequested.add(taskId);
    return true;
  }

  private static drainQueue() {
    if (this.runningTasks.size >= this.MAX_PARALLEL_OCR) return;
    const nextItem = this.queue.shift();
    if (!nextItem) return;

    this.executeOcr(nextItem.taskId, nextItem.options, nextItem.onUpdate)
      .then(nextItem.resolve)
      .catch(nextItem.reject);
  }

  static async runOcr(
    taskId: string,
    options?: OcrRunOptions,
    onUpdate?: () => void,
  ): Promise<Task | undefined> {
    const task = TaskStore.getById(taskId);
    if (!task) throw new Error(`Không tìm thấy tác vụ ID: ${taskId}`);

    if (this.runningTasks.has(taskId)) {
      return task;
    }

    if (this.isQueued(taskId)) {
      return task;
    }

    if (this.runningTasks.size >= this.MAX_PARALLEL_OCR) {
      return new Promise<Task | undefined>((resolve, reject) => {
        this.queue.push({ taskId, options, onUpdate, resolve, reject });
        TaskStore.update(taskId, {
          status: 'ocr',
          stageDescription: 'Đang xếp hàng chờ tài nguyên OCR...',
        });
        onUpdate?.();
      });
    }

    return this.executeOcr(taskId, options, onUpdate);
  }

  private static async executeOcr(
    taskId: string,
    options?: OcrRunOptions,
    onUpdate?: () => void,
  ): Promise<Task | undefined> {
    const task = TaskStore.getById(taskId);
    if (!task) throw new Error(`Không tìm thấy tác vụ ID: ${taskId}`);

    const ext = path.extname(task.filePath).toLowerCase();
    if (AUDIO_EXTENSIONS.has(ext)) {
      throw new Error('Tác vụ này là file audio — OCR phụ đề chỉ hỗ trợ file video.');
    }
    if (!VIDEO_EXTENSIONS.has(ext)) {
      throw new Error(`Định dạng không hỗ trợ OCR: ${ext || '(không rõ)'}`);
    }

    this.runningTasks.add(taskId);
    let framesDir: string | undefined;

    try {
      const language = options?.language || SettingsStore.get('ocrLanguage') || 'vie';
      const fps = clampNumber(Number(options?.fps ?? SettingsStore.get('ocrFps')) || 2, 0.5, 5);
      const mode = (options?.mode || SettingsStore.get('ocrMode') || 'auto') as OcrMode;
      const customRegion = options?.customRegion ?? SettingsStore.get('ocrCustomRegion') ?? null;
      const dualEngine = options?.dualEngine ?? (SettingsStore.get('ocrDualEngine') !== false);
      const shouldStop = () => this.cancelRequested.has(taskId);

      // Giai đoạn 1: trích khung hình
      TaskStore.update(taskId, {
        status: 'ocr',
        progress: 2,
        errorMessage: undefined,
        stageDescription: `Đang trích khung hình (chế độ ${mode.toUpperCase()})...`,
      });
      onUpdate?.();

      let lastExtractLogPercent = -1;
      const {
        framesDir: dir,
        framePaths,
        frameIntervalMs,
        width: videoWidth,
        height: videoHeight,
        offsetRatio,
      } = await extractFrames(task.filePath, fps, mode, customRegion, (percent) => {
        TaskStore.update(taskId, {
          progress: Math.min(24, 2 + Math.round(percent * 0.22)),
          stageDescription: `Đang trích khung hình: ${percent}%...`,
        });
        onUpdate?.();
        if (percent >= lastExtractLogPercent + 15 || percent === 100) {
          console.log(`[OCR] Trích xuất khung hình video: ${percent}%...`);
          lastExtractLogPercent = percent;
        }
      }, shouldStop);
      framesDir = dir;
      if (shouldStop()) throw new CancelledError();
      console.log(`[OCR] Đã trích xuất hoàn tất ${framePaths.length} khung hình (${fps} fps, chế độ ${mode.toUpperCase()})`);

      // Giai đoạn 2: Full-screen Text Detection & Tracking qua PaddleOCR PP-OCRv5
      const env = await checkRapidOcr();
      if (shouldStop()) throw new CancelledError();
      if (!env.ok) throw new Error(env.detail);

      TaskStore.update(taskId, {
        progress: 25,
        stageDescription: `Đang nạp model PaddleOCR PP-OCRv5 (${language})...`,
      });
      onUpdate?.();
      console.log(`[OCR] Đang khởi chạy sidecar PaddleOCR PP-OCRv5 (ngôn ngữ: ${language})...`);

      let lastPaddleLog = 0;
      let lastPaddleStage: string | undefined = '';

      const paddleFrames: PaddleOcrFrame[] = await runPaddleOcr(
        {
          frames: framePaths,
          cropsDir: path.join(dir, 'crops'),
          outPath: path.join(dir, 'paddle_out.jsonl'),
          recLangNames: mapRecLangNames(language),
          detVersion: 'PPOCRV5',
          recVersion: 'PPOCRV5',
          modelType: 'MOBILE',
          textScore: 0.25,
          videoWidth,
          videoHeight,
          regionOffsetRatio: offsetRatio,
          ocrMode: mode,
          customRegion: customRegion ?? null,
        },
        {
          onReady: () => {
            TaskStore.update(taskId, {
              stageDescription: `Đang phát hiện & theo dõi chữ trên ${framePaths.length} khung (${mode})...`,
            });
            onUpdate?.();
            console.log(`[OCR] Sidecar sẵn sàng — bắt đầu quét & tracking trên ${framePaths.length} khung hình...`);
          },
          onStage: (_stage, message) => {
            TaskStore.update(taskId, { stageDescription: message });
            onUpdate?.();
            console.log(`[OCR] [Giai đoạn] ${message}`);
          },
          onProgress: (done, total, stage) => {
            const pct = Math.round((done / total) * 100);
            let progress = 25;
            let stageDescription = '';

            if (stage === 'detect') {
              // 25% -> 48%
              progress = 25 + Math.round((done / total) * 23);
              stageDescription = `Đang quét & theo dõi chữ: khung ${done}/${total} (${pct}%)...`;
            } else if (stage === 'recognize') {
              // 49% -> 65%
              progress = 49 + Math.round((done / total) * 16);
              stageDescription = `Đang nhận diện chữ (PaddleOCR): ${done}/${total} đoạn (${pct}%)...`;
            } else {
              progress = 25 + Math.round((done / total) * 40);
              stageDescription = `Đang xử lý OCR: ${done}/${total} (${pct}%)...`;
            }

            TaskStore.update(taskId, { progress, stageDescription });
            onUpdate?.();

            // Log ra console định kỳ mỗi ~10% để người dùng theo dõi trong terminal
            const step = Math.max(10, Math.floor(total / 10));
            if (stage !== lastPaddleStage || done - lastPaddleLog >= step || done === total) {
              if (stage === 'detect') {
                console.log(`[OCR] [Khung ${done}/${total}] Quét vị trí & theo dõi chữ (${pct}%)...`);
              } else if (stage === 'recognize') {
                console.log(`[OCR] [Đoạn ${done}/${total}] Nhận diện ký tự PP-OCRv5 (${pct}%)...`);
              }
              lastPaddleLog = done;
              lastPaddleStage = stage;
            }
          },
          shouldStop,
        },
      );

      if (shouldStop()) throw new CancelledError();

      // Giai đoạn 3: lượt OCR thứ hai bằng Tesseract trên cùng crop đã enhance
      const cropFiles: string[] = [];
      for (const f of paddleFrames) for (const l of f.lines) cropFiles.push(l.crop);

      let cropMap = new Map<string, CropOcrResult>();
      if (dualEngine && cropFiles.length > 0) {
        TaskStore.update(taskId, {
          progress: 66,
          stageDescription: `Đang đối chiếu bằng Tesseract trên ${cropFiles.length} vùng chữ...`,
        });
        onUpdate?.();
        console.log(`[OCR] Khởi động đối chiếu song song Tesseract trên ${cropFiles.length} crop...`);

        const pool = await OcrPool.create(
          language,
          path.join(typeof app?.getPath === 'function' ? app.getPath('userData') : process.cwd(), 'tessdata'),
          undefined,
          'line',
        );
        let cropResults: CropOcrResult[];
        let lastTessLog = 0;
        try {
          cropResults = await pool.recognizeCrops(
            cropFiles,
            (done, total) => {
              const pct = Math.round((done / total) * 100);
              TaskStore.update(taskId, {
                progress: 66 + Math.round((done / total) * 19), // 66% -> 85%
                stageDescription: `Đối chiếu Tesseract: ${done}/${total} vùng chữ (${pct}%)...`,
              });
              onUpdate?.();

              const step = Math.max(10, Math.floor(total / 10));
              if (done - lastTessLog >= step || done === total) {
                console.log(`[OCR] [Crop ${done}/${total}] Đối chiếu mô hình Tesseract (${pct}%)...`);
                lastTessLog = done;
              }
            },
            shouldStop,
          );
        } finally {
          await pool.terminate();
        }
        cropMap = new Map(cropFiles.map((file, i) => [file, cropResults[i]]));
      }

      if (shouldStop()) throw new CancelledError();

      // Giai đoạn 4: so sánh 2 engine + confidence → chốt từng dòng
      TaskStore.update(taskId, {
        progress: 87,
        stageDescription: 'Đang so sánh kết quả 2 engine OCR...',
      });
      onUpdate?.();
      console.log('[OCR] Đang so sánh và dung hợp kết quả giữa 2 engine...');

      const merged: MergedOcrFrame[] = mergeOcrResults(paddleFrames, cropMap, MIN_LINE_CONFIDENCE);
      const frameResults = mergedToFrameResults(merged);

      // Giai đoạn 5: ghép khung trùng nội dung thành dòng phụ đề
      console.log('[OCR] Đang tổng hợp tracking, bình chọn văn bản ổn định và khử trùng lặp 5 tầng...');
      TaskStore.update(taskId, {
        progress: 93,
        stageDescription: 'Đang tổng hợp phụ đề & khử trùng lặp 5 tầng...',
      });
      onUpdate?.();

      // Bỏ lớp phủ tĩnh ở 1/4 trên khung (watermark/logo in cố định suốt video)
      // nếu không phải chế độ full (chế độ full giữ toàn bộ text trên màn hình)
      const cleanedResults =
        mode === 'full'
          ? frameResults
          : filterPersistentTopLines(frameResults, frameIntervalMs, videoHeight);
      const { segments: rawSegments, stats } = buildSubtitleSegmentsWithStats(cleanedResults, frameIntervalMs);
      const { lines: segments } = normalizeSrtLines(rawSegments, {
        maxGapMs: Math.max(1200, frameIntervalMs * 2),
        preserveEvidenceTiming: true,
      });

      // In báo cáo debug chi tiết theo Rule 18
      console.log(
        `[OCR Pipeline Report] OCR frames scanned: ${stats.framesScanned} | Text detections: ${stats.textDetections} | Tracked subtitle groups: ${stats.trackedGroups} | Duplicates merged: ${stats.duplicatesMerged} | Final subtitle events: ${stats.finalEvents} | High confidence: ${stats.highConfidence} | Needs review: ${stats.needsReview} | AI corrected: 0`,
      );

      const srtContent = segmentsToSrt(segments);
      const timelineIssues = validateSubtitleTimeline(segments);
      if (timelineIssues.some((issue) => issue.severity === 'error')) {
        throw new Error(`OCR timeline contains invalid timestamps: ${JSON.stringify(timelineIssues.filter((issue) => issue.severity === 'error'))}`);
      }
      if (!srtContent) {
        throw new Error(
          'Không nhận diện được phụ đề nào — kiểm tra ngôn ngữ quét trong Cài đặt hoặc thử vùng quét "Toàn khung".',
        );
      }

      if (shouldStop()) throw new CancelledError();

      // Giai đoạn 6: ghi file .srt cạnh video (không ghi đè file có sẵn)
      const videoDir = path.dirname(task.filePath);
      const base = path.basename(task.filePath, path.extname(task.filePath));
      const targetPath = nextAvailablePath(path.join(videoDir, `${base}_ocr.srt`));
      fs.writeFileSync(targetPath, srtContent, 'utf-8');
      fs.writeFileSync(targetPath.replace(/\.srt$/i, '.timeline.json'),
        JSON.stringify({ segments, issues: timelineIssues, frameIntervalMs }, null, 2), 'utf-8');
      console.log(`[OCR] Đã ghi ${segments.length} dòng phụ đề vào ${targetPath}`);

      writeDiagnosticDump(
        targetPath.replace(/\.srt$/i, '.frames.txt'),
        task.fileName,
        merged,
        frameIntervalMs,
      );

      // Commit a new subtitle only after all outputs were written. Failed/cancelled
      // reruns retain the last completed artifacts and never delete old TTS files.
      const artifactUpdates = {
        translatedSrtPath: undefined, ttsAudioDir: undefined,
        ttsMergedAudioPath: undefined, ttsOverruns: undefined, outputPath: undefined,
        ttsVoiceOverrides: {}, subtitleRevision: (task.subtitleRevision || 0) + 1,
        ttsNeedsRegeneration: !!task.ttsAudioDir,
      };
      if (!options?.isSubTask) {
        const updated = TaskStore.update(taskId, {
          ...artifactUpdates,
          status: 'done',
          progress: 100,
          srtPath: targetPath,
          stageDescription: `Đã quét OCR được ${segments.length} dòng phụ đề`,
          ocrStats: {
            framesScanned: stats.framesScanned,
            detections: stats.textDetections,
            trackedGroups: stats.trackedGroups,
            duplicatesRemoved: stats.duplicatesMerged,
            finalEvents: stats.finalEvents,
            highConfidence: stats.highConfidence,
            needsReview: stats.needsReview,
          },
        });
        onUpdate?.();

        // Nhất quán với phiên âm: tự động dịch nếu người dùng bật tùy chọn này
        if (SettingsStore.get('autoTranslateAfterAsr') && SettingsStore.hasGeminiKey()) {
          await TranslateRunner.runTranslate(taskId, undefined, onUpdate);
        }

        return updated ?? TaskStore.getById(taskId);
      } else {
        const updated = TaskStore.update(taskId, {
          ...artifactUpdates,
          srtPath: targetPath,
          ocrStats: {
            framesScanned: stats.framesScanned,
            detections: stats.textDetections,
            trackedGroups: stats.trackedGroups,
            duplicatesRemoved: stats.duplicatesMerged,
            finalEvents: stats.finalEvents,
            highConfidence: stats.highConfidence,
            needsReview: stats.needsReview,
          },
        });
        onUpdate?.();
        return updated ?? TaskStore.getById(taskId);
      }
    } catch (err: any) {
      const cancelled = isCancelledError(err);
      console.error(`[OCR] Lỗi khi quét task ${taskId}:`, err);
      const updated = TaskStore.update(taskId, {
        status: cancelled ? 'cancelled' : 'error',
        errorMessage: cancelled ? undefined : err.message || 'Lỗi không xác định khi quét OCR',
        stageDescription: cancelled ? 'Đã huỷ quét OCR' : 'Quét OCR thất bại',
      });
      onUpdate?.();
      return updated;
    } finally {
      if (framesDir) cleanupFrames(framesDir);
      this.runningTasks.delete(taskId);
      this.cancelRequested.delete(taskId);
      this.drainQueue();
    }
  }
}

/**
 * Dump từng dòng/khung cạnh file srt — đối chiếu được MỖI ENGINE đọc gì ở giây
 * nào, độ tin cậy bao nhiêu, engine nào thắng sau khi so sánh.
 */
function writeDiagnosticDump(
  dumpPath: string,
  fileName: string,
  merged: MergedOcrFrame[],
  frameIntervalMs: number,
): void {
  const rows: string[] = [];
  merged.forEach((f, i) => {
    const t = ((i * frameIntervalMs) / 1000).toFixed(1);
    if (f.lines.length === 0) {
      rows.push(`${String(i).padStart(5)}  ${t.padStart(7)}s  (không phát hiện chữ)`);
      return;
    }
    for (const l of f.lines) {
      const alt = l.altText
        ? ` | tess ${String(Math.round(l.altConfidence ?? 0)).padStart(3)} sim=${(l.similarity ?? 0).toFixed(2)} "${l.altText}"`
        : '';
      rows.push(
        `${String(i).padStart(5)}  ${t.padStart(7)}s  ${l.chosen === 'paddle' ? 'pad' : 'tes'} ${String(l.confidence).padStart(3)}  y=${String(Math.round(l.y0)).padStart(4)}  "${l.text}"${alt}`,
      );
    }
  });
  fs.writeFileSync(
    dumpPath,
    `# VANHSUB OCR frame dump — ${fileName}\n` +
      `# idx   time      eng conf    y  text (pad = PaddleOCR PP-OCRv5, tes = Tesseract thắng so sánh)\n` +
      `${rows.join('\n')}\n`,
    'utf-8',
  );
  console.log(`[OCR] Dump chi tiết từng khung: ${dumpPath}`);
}

function clampNumber(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}
