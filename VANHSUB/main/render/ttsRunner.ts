import { nextAvailablePath } from '../lib/paths';
import fs from 'fs';
import path from 'path';
import { TaskStore, type Task } from '../store/taskStore';
import { SettingsStore } from '../store/settingsStore';
import { generateTtsFromSrt, regenerateTtsLine, type TTSEngine } from '../render/ttsEngine';
import { resolveTtsEngine } from '../lib/ttsConfig';
import { CancelledError, isCancelledError } from '../lib/cancel';
import { getOrCreateProjectDir, getProjectArtifactPaths } from '../utils/projectFolder';
import { mergeAudioFiles } from './dubbingEngine';
import { configuredMaxTempo } from './ttsTiming';
import { createTtsRunDirectory } from './ttsCache';

export class TTSRunner {
  private static runningTasks = new Set<string>();
  private static cancelledTasks = new Set<string>();

  static isRunning(taskId: string): boolean {
    return this.runningTasks.has(taskId);
  }

  /** Explicit selection wins; otherwise pair the chosen voice with its provider. */
  private static resolveEngine(task: Task, engine?: TTSEngine, voice?: string): TTSEngine {
    return resolveTtsEngine(voice || task.ttsVoice || SettingsStore.get('ttsVoice'), task.ttsEngine, engine);
  }

  /** Yêu cầu huỷ: hiệu lực sau khi câu hiện tại tạo audio xong */
  static cancel(taskId: string): boolean {
    if (!this.runningTasks.has(taskId)) return false;
    this.cancelledTasks.add(taskId);
    return true;
  }

  /**
   * Tạo lại nhóm câu trong một run mới; chỉ publish sau khi ghép MP3 thành công.
   * Trả về { ok, error? } thay vì throw để UI hiển thị trực tiếp.
   */
  static async regenerateLine(
    taskId: string,
    lineIndex: number,
    voice?: string,
    speed?: number,
    engine?: TTSEngine,
    voiceOverrides?: Record<string, string>,
    onUpdate?: () => void
  ): Promise<{ ok: boolean; error?: string }> {
    const task = TaskStore.getById(taskId);
    if (!task) return { ok: false, error: 'Không tìm thấy tác vụ.' };
    if (!task.ttsAudioDir) {
      return { ok: false, error: 'Tác vụ chưa tạo audio lồng tiếng — hãy chạy TTS trước.' };
    }

    if (this.runningTasks.has(taskId)) {
      return { ok: false, error: 'Tác vụ đang tạo audio. Hãy chờ hoàn tất.' };
    }
    this.runningTasks.add(taskId);
    this.cancelledTasks.delete(taskId);

    try {
      const srtPath = task.translatedSrtPath || task.srtPath;
      if (!srtPath) return { ok: false, error: 'Tác vụ không có file phụ đề.' };
      const sourceBytes = fs.readFileSync(srtPath);
      const projectDir = getOrCreateProjectDir(task);
      const candidateDir = createTtsRunDirectory(projectDir, task.ttsAudioDir);
      const snapshotPath = path.join(candidateDir, 'source.srt');
      fs.writeFileSync(snapshotPath, sourceBytes);

      // Rebuild with current per-line assignments and the project's default voice.
      const voiceToUse = voice || task.ttsVoice || SettingsStore.get('ttsVoice');
      const overrides = voiceOverrides ?? task.ttsVoiceOverrides;
      const engineForLine: TTSEngine = this.resolveEngine(task, engine, voiceToUse);

      TaskStore.update(taskId, { status: 'dubbing', progress: 0, ttsNeedsRegeneration: true,
        stageDescription: `Đang tạo lại nhóm câu chứa dòng ${lineIndex}...`, errorMessage: undefined });
      onUpdate?.();
      await regenerateTtsLine(
        snapshotPath,
        candidateDir,
        lineIndex,
        voiceToUse,
        speed || task.ttsSpeed,
        engineForLine,
        overrides,
        () => this.cancelledTasks.has(taskId)
      );
      if (this.cancelledTasks.has(taskId)) throw new CancelledError();
      const mergedPath = path.join(candidateDir, path.basename(getProjectArtifactPaths(task).ttsMergedAudioPath));
      const merged = await mergeAudioFiles(snapshotPath, candidateDir, mergedPath, undefined,
        { mode: 'strict', maxTempo: configuredMaxTempo() });
      if (this.cancelledTasks.has(taskId)) throw new CancelledError();
      if (!fs.readFileSync(srtPath).equals(sourceBytes)) {
        throw new Error('Phụ đề đã thay đổi trong khi tạo audio. Kết quả cũ được giữ; hãy chạy lại.');
      }
      TaskStore.update(taskId, { status: 'done', progress: 100, ttsNeedsRegeneration: false, errorMessage: undefined,
        projectDir, ttsAudioDir: candidateDir, ttsMergedAudioPath: merged.audioPath, ttsOverruns: merged.overruns,
        dubbedVideoPath: undefined, dubbedVideoStretchFactor: undefined, outputPath: undefined, outputInspection: undefined,
        ttsVoice: voiceToUse, ttsSpeed: speed ?? task.ttsSpeed, ttsEngine: engineForLine, ttsVoiceOverrides: overrides,
        stageDescription: `Đã tạo lại nhóm câu chứa dòng ${lineIndex} và cập nhật MP3 tổng hợp` });
      return { ok: true };
    } catch (err: any) {
      TaskStore.update(taskId, { status: this.cancelledTasks.has(taskId) || isCancelledError(err) ? 'cancelled' : 'error',
        errorMessage: err?.message, stageDescription: 'Tạo lại audio chưa hoàn tất' });
      console.error(`Lỗi khi tạo lại audio dòng ${lineIndex} task ${taskId}:`, err);
      return { ok: false, error: err?.message || 'Không thể tạo lại audio cho dòng này.' };
    } finally {
      this.runningTasks.delete(taskId);
      this.cancelledTasks.delete(taskId);
      onUpdate?.();
    }
  }

  /**
   * Ghép lại hoặc xuất file MP3 tổng hợp chính xác theo timeline cho dự án
   */
  static async exportMergedAudio(
    taskId: string,
    targetPath?: string,
    mode: 'strict' | 'flexible' = 'flexible',
    regenerated: boolean = false
  ): Promise<{ ok: boolean; audioPath?: string; error?: string }> {
    const task = TaskStore.getById(taskId);
    if (!task) return { ok: false, error: 'Không tìm thấy tác vụ.' };
    if (task.ttsNeedsRegeneration && !regenerated) {
      return { ok: false, error: 'Phụ đề đã thay đổi. Hãy tạo lại audio trước khi xuất MP3.' };
    }
    const srtPath = task.translatedSrtPath || task.srtPath;
    if (!srtPath || !fs.existsSync(srtPath)) {
      return { ok: false, error: 'Không tìm thấy file phụ đề SRT của tác vụ.' };
    }
    const ttsAudioDir = task.ttsAudioDir || path.join(getOrCreateProjectDir(task), 'tts_audio');
    if (!fs.existsSync(ttsAudioDir)) {
      return { ok: false, error: 'Chưa có các file audio lồng tiếng — hãy chạy tạo TTS trước.' };
    }

    const artifactPaths = getProjectArtifactPaths(task);
    const outputPath = nextAvailablePath(targetPath || artifactPaths.ttsMergedAudioPath);

    try {
      const { audioPath, overruns } = await mergeAudioFiles(
        srtPath,
        ttsAudioDir,
        outputPath,
        undefined,
        { mode, maxTempo: configuredMaxTempo() }
      );
      TaskStore.update(taskId, { ttsOverruns: overruns });
      TaskStore.update(taskId, { ttsMergedAudioPath: outputPath });
      return { ok: true, audioPath };
    } catch (err: any) {
      console.error(`[TTSRunner] Lỗi khi xuất file MP3 tổng hợp task ${taskId}:`, err);
      return { ok: false, error: err?.message || 'Không thể ghép file MP3 tổng hợp.' };
    }
  }

  static async runTTS(
    taskId: string,
    voice?: string,
    speed?: number,
    onUpdate?: () => void,
    voiceOverrides?: Record<string, string>,
    engine?: TTSEngine
  ): Promise<Task | undefined> {
    const task = TaskStore.getById(taskId);
    if (!task) throw new Error(`Không tìm thấy tác vụ ID: ${taskId}`);

    // Kiểm tra file phụ đề (ưu tiên dùng bản dịch, nếu không có thì dùng bản gốc)
    const srtPath = task.translatedSrtPath || task.srtPath;
    if (!srtPath) {
      throw new Error('Tác vụ chưa có file phụ đề SRT để tạo lồng tiếng.');
    }

    if (this.runningTasks.has(taskId)) {
      return task;
    }

    this.runningTasks.add(taskId);
    this.cancelledTasks.delete(taskId);

    const voiceToUse = voice || task.ttsVoice || SettingsStore.get('ttsVoice') || 'BV074_streaming';
    const speedToUse = speed || task.ttsSpeed || SettingsStore.get('ttsSpeed') || 1.0;
    // Keep the selected voice/provider pair consistent for this run.
    const engineToUse = this.resolveEngine(task, engine, voiceToUse);
    console.log(`[TTS] Engine: ${engineToUse} · giọng: ${voiceToUse}`);

    try {
      // Ghi đè gán giọng khi caller truyền vào (kể cả object rỗng = xoá hết gán
      // cũ — trước đây object rỗng bị bỏ qua nên gán cũ còn dính); undefined
      // (pipeline) thì giữ nguyên gán đã lưu
      TaskStore.update(taskId, {
        status: 'dubbing',
        ttsNeedsRegeneration: true,
        progress: 0,
        ttsVoice: voiceToUse,
        ttsSpeed: speedToUse,
        ttsEngine: engineToUse,
        ...(voiceOverrides !== undefined ? { ttsVoiceOverrides: voiceOverrides } : {}),
        stageDescription: `Đang khởi tạo lồng tiếng (${engineToUse})...`,
      });
      onUpdate?.();

      // Lưu audio files từng dòng vào thư mục dự án của video
      const projectDir = getOrCreateProjectDir(task);
      const ttsAudioDir = createTtsRunDirectory(projectDir, task.ttsAudioDir);

      const { audioFiles, totalDuration } = await generateTtsFromSrt(
        srtPath,
        ttsAudioDir,
        {
          voice: voiceToUse,
          speed: speedToUse,
          engine: engineToUse,
          voiceOverrides: voiceOverrides || task.ttsVoiceOverrides,
          shouldStop: () => this.cancelledTasks.has(taskId),
        },
        (current, total) => {
          const progress = Math.round((current / total) * 100);
          TaskStore.update(taskId, {
            progress,
            stageDescription: `Đang tạo lồng tiếng (${current}/${total})...`,
          });
          onUpdate?.();
        }
      );

      // Tự động ghép các câu thành 1 file MP3 tổng hợp chuẩn xác theo timeline dự án
      if (this.cancelledTasks.has(taskId)) throw new CancelledError();
      const artifactPaths = getProjectArtifactPaths(task);
      const mergedMp3Path = nextAvailablePath(artifactPaths.ttsMergedAudioPath);
      let finalMergedPath: string | undefined = undefined;

      try {
        TaskStore.update(taskId, {
          stageDescription: 'Đang ghép file MP3 lồng tiếng tổng hợp theo timeline dự án...',
        });
        onUpdate?.();

        const { audioPath, overruns } = await mergeAudioFiles(
          srtPath,
          ttsAudioDir,
          mergedMp3Path,
          undefined,
          { mode: 'flexible', maxTempo: configuredMaxTempo() }
        );
        if (fs.existsSync(audioPath)) {
          finalMergedPath = audioPath;
        }
        if (overruns && overruns.length > 0) {
          TaskStore.update(taskId, { ttsOverruns: overruns });
        }
      } catch (mergeErr) {
        throw new Error(`TTS timing conflict during audio merge: ${mergeErr}`);
      }

      if (this.cancelledTasks.has(taskId)) throw new CancelledError();
      const updated = TaskStore.update(taskId, {
        status: 'done',
        progress: 100,
        outputPath: undefined, errorMessage: undefined,
        ttsMergedAudioPath: undefined,
        projectDir,
        ttsAudioDir, // Lưu thư mục audio để dùng cho bước dubbing tiếp theo
        ttsNeedsRegeneration: false,
        ...(finalMergedPath ? { ttsMergedAudioPath: finalMergedPath } : {}),
        stageDescription: finalMergedPath
          ? 'Đã hoàn tất tạo lồng tiếng và xuất file MP3 tổng hợp dự án'
          : 'Đã hoàn tất tạo lồng tiếng vào thư mục dự án',
      });
      onUpdate?.();

      return updated;
    } catch (err: any) {
      if (isCancelledError(err)) {
        console.log(`Người dùng đã huỷ tạo lồng tiếng task ${taskId}`);
        const updated = TaskStore.update(taskId, {
          status: 'cancelled',
          stageDescription: 'Đã huỷ tạo lồng tiếng',
        });
        onUpdate?.();
        return updated;
      }
      console.error(`Lỗi khi tạo lồng tiếng task ${taskId}:`, err);
      const updated = TaskStore.update(taskId, {
        status: 'error',
        errorMessage: err.message || 'Lỗi không xác định khi tạo lồng tiếng',
        stageDescription: 'Thất bại khi tạo lồng tiếng',
      });
      onUpdate?.();
      return updated;
    } finally {
      this.cancelledTasks.delete(taskId);
      this.runningTasks.delete(taskId);
    }
  }
}
