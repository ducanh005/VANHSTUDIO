import { nextAvailablePath } from '../lib/paths';
import fs from 'fs';
import { TaskStore, type Task } from '../store/taskStore';
import { SettingsStore } from '../store/settingsStore';
import { extract16kHzWav } from './audioExtractor';
import { transcribeUnified } from './asrRouter';
import { TranslateRunner } from '../translate/translateRunner';
import { CancelledError, isCancelledError } from '../lib/cancel';
import { getProjectArtifactPaths } from '../utils/projectFolder';
import { parseSrt } from '../lib/srt';
import { validateSubtitleTimeline } from '../lib/timelineDiagnostics';

export class TaskRunner {
  private static readonly MAX_PARALLEL_ASR = 2;
  private static runningTasks = new Set<string>();
  private static cancelledTasks = new Set<string>();
  private static queue: Array<{
    taskId: string;
    onUpdate?: () => void;
    resolve: (t?: Task) => void;
    reject: (err: any) => void;
  }> = [];

  static isRunning(taskId: string): boolean {
    return this.runningTasks.has(taskId);
  }

  static isQueued(taskId: string): boolean {
    return this.queue.some((item) => item.taskId === taskId);
  }

  /** Yêu cầu huỷ phiên âm — huỷ ngay nếu đang trong hàng đợi hoặc dừng chunk đang chạy */
  static cancel(taskId: string): boolean {
    // 1. Kiểm tra hàng đợi
    const qIndex = this.queue.findIndex((item) => item.taskId === taskId);
    if (qIndex !== -1) {
      const [queuedItem] = this.queue.splice(qIndex, 1);
      TaskStore.update(taskId, {
        status: 'cancelled',
        stageDescription: 'Đã huỷ khỏi hàng đợi phiên âm',
      });
      queuedItem.onUpdate?.();
      queuedItem.resolve(TaskStore.getById(taskId));
      this.drainQueue();
      return true;
    }

    // 2. Đang chạy
    if (!this.runningTasks.has(taskId)) return false;
    this.cancelledTasks.add(taskId);
    return true;
  }

  static async runTask(taskId: string, onUpdate?: () => void): Promise<Task | undefined> {
    const task = TaskStore.getById(taskId);
    if (!task) throw new Error(`Không tìm thấy tác vụ ID: ${taskId}`);

    if (this.runningTasks.has(taskId)) {
      return task;
    }

    if (this.isQueued(taskId)) {
      return task;
    }

    if (this.runningTasks.size >= this.MAX_PARALLEL_ASR) {
      return new Promise<Task | undefined>((resolve, reject) => {
        this.queue.push({ taskId, onUpdate, resolve, reject });
        TaskStore.update(taskId, {
          status: 'queued',
          stageDescription: `Đang chờ trong hàng đợi phiên âm (#${this.queue.length})...`,
        });
        onUpdate?.();
      });
    }

    return this.executeTask(taskId, onUpdate);
  }

  private static drainQueue(): void {
    while (this.runningTasks.size < this.MAX_PARALLEL_ASR && this.queue.length > 0) {
      const next = this.queue.shift();
      if (!next) break;
      this.queue.forEach((item, idx) => {
        TaskStore.update(item.taskId, {
          stageDescription: `Đang chờ trong hàng đợi phiên âm (#${idx + 1})...`,
        });
        item.onUpdate?.();
      });
      this.executeTask(next.taskId, next.onUpdate)
        .then(next.resolve)
        .catch(next.reject);
    }
  }

  private static async executeTask(taskId: string, onUpdate?: () => void): Promise<Task | undefined> {
    const task = TaskStore.getById(taskId);
    if (!task) return undefined;

    this.runningTasks.add(taskId);
    this.cancelledTasks.delete(taskId);

    try {
      const { projectDir, audioWavPath, rawSrtPath } = getProjectArtifactPaths(task);

      // Giai đoạn 1: Chuẩn bị & trích xuất audio 16kHz vào thư mục dự án
      TaskStore.update(taskId, {
        status: 'transcribing',
        progress: 10,
        projectDir,
        stageDescription: 'Đang trích xuất audio vào thư mục dự án...',
      });
      onUpdate?.();

      const { wavPath } = await extract16kHzWav(task.filePath, nextAvailablePath(audioWavPath), (percent) => {
        TaskStore.update(taskId, {
          progress: 10 + Math.round(percent * 0.2), // 10% -> 30%
        });
        onUpdate?.();
      });

      // Giai đoạn 2: Nhận diện giọng nói bằng Whisper ASR
      // Audio dài sẽ được chia chunk trong whisperEngine — progress theo từng chunk
      TaskStore.update(taskId, {
        progress: 35,
        audioPath: wavPath,
        stageDescription: `Đang nhận diện giọng nói (${task.asrModel || SettingsStore.get('asrModel') || 'large-v3-turbo'})...`,
      });
      onUpdate?.();

      let lastAsrLog = -1;
      let lastProgress = 0;
      const asrEngine = task.asrEngine || (SettingsStore.get('asrEngine') as 'faster-whisper' | 'whisper-cpp') || 'faster-whisper';
      const enableDiarization = task.enableDiarization ?? (SettingsStore.get('enableDiarization') as boolean);
      const hfToken = SettingsStore.get('hfToken') as string;

      const result = await transcribeUnified(wavPath, {
        model: task.asrModel || SettingsStore.get('asrModel') || 'large-v3-turbo',
        asrEngine,
        enableDiarization,
        speakerCount: task.speakerCount,
        hfToken,
        onProgress: (percent, stage) => {
          const newProgress = 35 + Math.round(percent * 0.55); // 35% -> 90%
          const monotonicProgress = Math.max(lastProgress, newProgress);
          lastProgress = monotonicProgress;

          TaskStore.update(taskId, {
            progress: monotonicProgress,
            stageDescription:
              stage ||
              (percent < 100
                ? `Đang phiên âm (${percent}%)...`
                : 'Đang hoàn tất file phụ đề...'),
          });
          onUpdate?.();

          if (percent >= lastAsrLog + 15 || percent === 100) {
            console.log(`[ASR] [Tiến trình] Phiên âm: ${percent}%...`);
            lastAsrLog = percent;
          }
        },
        shouldStop: () => this.cancelledTasks.has(taskId),
      });

      // Chuẩn hoá file phụ đề về [cleanBase].srt trong projectDir
      if (this.cancelledTasks.has(taskId)) throw new CancelledError();
      const committedSrtPath = nextAvailablePath(rawSrtPath);
      let finalSrt = result.srtPath;
      if (fs.existsSync(result.srtPath) && result.srtPath !== committedSrtPath) {
        try {
          fs.copyFileSync(result.srtPath, committedSrtPath);
          fs.unlinkSync(result.srtPath);
          finalSrt = committedSrtPath;
        } catch {
          // nếu lỗi thì dùng result.srtPath
        }
      }

      console.log(`[ASR] Phiên âm hoàn tất! Đã lưu file phụ đề: ${finalSrt}`);
      const asrSegments = parseSrt(fs.readFileSync(finalSrt, 'utf-8')).map((line) => ({
        ...line,
        source: 'asr' as const,
        speechStartMs: line.startMs,
        speechEndMs: line.endMs,
        words: result.words?.filter((word) => word.startMs >= line.startMs - 2 && word.endMs <= line.endMs + 2),
      }));
      const timelineIssues = validateSubtitleTimeline(asrSegments);
      if (timelineIssues.some((issue) => issue.severity === 'error')) {
        throw new Error(`ASR timeline contains invalid timestamps: ${JSON.stringify(timelineIssues.filter((issue) => issue.severity === 'error'))}`);
      }
      fs.writeFileSync(finalSrt.replace(/\.srt$/i, '.timeline.json'),
        JSON.stringify({ engine: result.engineUsed, fallbackTriggered: result.fallbackTriggered,
          segments: asrSegments, issues: timelineIssues }, null, 2), 'utf-8');

      // Giai đoạn 3: Hoàn thành tạo phụ đề .srt
      TaskStore.update(taskId, {
        status: 'done',
        progress: 100,
        translatedSrtPath: undefined, ttsAudioDir: undefined, ttsMergedAudioPath: undefined, ttsOverruns: undefined, outputPath: undefined,
        errorMessage: undefined,
        srtPath: finalSrt,
        asrEngine: result.engineUsed,
        speakers: result.speakers,
        stageDescription: `Đã tạo xong phụ đề .srt (${result.engineUsed}${result.fallbackTriggered ? ' - fallback' : ''}${result.speakers?.length ? `, ${result.speakers.length} người nói` : ''})`,
      });
      onUpdate?.();

      // Tự động dịch nếu bật option autoTranslateAfterAsr và đã có Gemini Key
      if (SettingsStore.get('autoTranslateAfterAsr') && SettingsStore.hasGeminiKey()) {
        await TranslateRunner.runTranslate(taskId, undefined, onUpdate);
      }

      return TaskStore.getById(taskId);
    } catch (err: any) {
      if (isCancelledError(err)) {
        console.log(`Người dùng đã huỷ phiên âm task ${taskId}`);
        const updated = TaskStore.update(taskId, {
          status: 'cancelled',
          stageDescription: 'Đã huỷ phiên âm',
        });
        onUpdate?.();
        return updated;
      }
      console.error(`Lỗi khi xử lý task ${taskId}:`, err);
      const updated = TaskStore.update(taskId, {
        status: 'error',
        errorMessage: err.message || 'Lỗi không xác định khi phiên âm',
        stageDescription: 'Thất bại khi xử lý',
      });
      onUpdate?.();
      return updated;
    } finally {
      this.runningTasks.delete(taskId);
      this.cancelledTasks.delete(taskId);
      this.drainQueue();
    }
  }
}
