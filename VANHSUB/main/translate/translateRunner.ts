import { nextAvailablePath } from '../lib/paths';
import fs from 'fs';
import path from 'path';
import { TaskStore, type Task } from '../store/taskStore';
import { SettingsStore } from '../store/settingsStore';
import { translateSrtFile } from './translator';
import { CancelledError, isCancelledError } from '../lib/cancel';
import { getProjectArtifactPaths } from '../utils/projectFolder';
import { assertProjectIsolation } from '../lib/projectIsolation';

export type TranslateTargetTrack = 'primary' | 'overlay' | 'both';

async function translateSingleTrackAndMove(
  sourceSrtPath: string,
  preferredDestPath: string,
  targetLang: string,
  onProgress: (percent: number) => void,
  isCancelled: () => boolean,
): Promise<string> {
  const { translatedSrtPath: rawTranslatedPath } = await translateSrtFile(
    sourceSrtPath,
    targetLang,
    onProgress,
    isCancelled,
  );

  const expectedPath = nextAvailablePath(preferredDestPath);
  if (fs.existsSync(rawTranslatedPath) && rawTranslatedPath !== expectedPath) {
    try {
      fs.copyFileSync(rawTranslatedPath, expectedPath);
      fs.unlinkSync(rawTranslatedPath);
      const rawTimeline = rawTranslatedPath.replace(/\.srt$/i, '.timeline.json');
      if (fs.existsSync(rawTimeline)) {
        try {
          fs.copyFileSync(rawTimeline, expectedPath.replace(/\.srt$/i, '.timeline.json'));
          fs.unlinkSync(rawTimeline);
        } catch (e) {
          console.warn('[TranslateRunner] Could not copy timeline evidence:', e);
        }
      }
      return expectedPath;
    } catch {}
  }
  return rawTranslatedPath;
}

export class TranslateRunner {
  private static runningTasks = new Set<string>();
  private static cancelledTasks = new Set<string>();

  static isRunning(taskId: string): boolean {
    return this.runningTasks.has(taskId);
  }

  /** Yêu cầu huỷ: hiệu lực sau khi batch dịch hiện tại chạy xong */
  static cancel(taskId: string): boolean {
    if (!this.runningTasks.has(taskId)) return false;
    this.cancelledTasks.add(taskId);
    return true;
  }

  static async runTranslate(
    taskId: string,
    targetLanguage?: string,
    onUpdate?: () => void,
    options?: { targetTrack?: TranslateTargetTrack }
  ): Promise<Task | undefined> {
    const task = TaskStore.getById(taskId);
    if (!task) throw new Error(`Không tìm thấy tác vụ ID: ${taskId}`);
    assertProjectIsolation(task);

    const requestedTrack: TranslateTargetTrack = options?.targetTrack ?? 'primary';
    const hasPrimary = Boolean(task.srtPath && fs.existsSync(task.srtPath));
    const hasOverlay = Boolean(task.overlaySrtPath && fs.existsSync(task.overlaySrtPath));

    if (requestedTrack === 'overlay' && !hasOverlay) {
      throw new Error('Tác vụ chưa có file phụ đề bảng/thông tin (overlay SRT) để dịch.');
    }
    if (requestedTrack === 'primary' && !task.srtPath) {
      throw new Error('Tác vụ chưa có file phụ đề SRT để dịch.');
    }
    if (requestedTrack === 'both' && !hasPrimary && !hasOverlay) {
      throw new Error('Tác vụ chưa có file phụ đề SRT để dịch.');
    }

    if (this.runningTasks.has(taskId)) {
      return task;
    }

    this.runningTasks.add(taskId);
    this.cancelledTasks.delete(taskId);

    const targetLang = targetLanguage || task.targetLanguage || SettingsStore.get('targetLanguage') || 'vi';
    const isCancelled = () => this.cancelledTasks.has(taskId);

    try {
      TaskStore.update(taskId, {
        status: 'translating',
        progress: 0,
        targetLanguage: targetLang,
        stageDescription: 'Đang khởi tạo dịch thuật AI...',
      });
      onUpdate?.();

      const {
        translatedSrtPath: preferredPrimaryPath,
        translatedOverlaySrtPath: defaultOverlayPath,
        cleanBase,
        projectDir,
      } = getProjectArtifactPaths(task);
      const preferredOverlayPath =
        targetLang === 'vi'
          ? defaultOverlayPath
          : path.join(projectDir, `${cleanBase}.overlay.${targetLang}.srt`);

      const translatePrimary = requestedTrack === 'primary' || (requestedTrack === 'both' && hasPrimary);
      const translateOverlay = requestedTrack === 'overlay' || (requestedTrack === 'both' && hasOverlay);
      const totalSteps = (translatePrimary ? 1 : 0) + (translateOverlay ? 1 : 0);

      let finalPrimaryPath: string | undefined;
      let finalOverlayPath: string | undefined;
      let completedSteps = 0;

      if (translatePrimary && task.srtPath) {
        finalPrimaryPath = await translateSingleTrackAndMove(
          task.srtPath,
          preferredPrimaryPath,
          targetLang,
          (percent) => {
            const overall = totalSteps === 2 ? Math.round(percent * 0.5) : percent;
            TaskStore.update(taskId, {
              progress: overall,
              stageDescription: `Đang dịch phụ đề thoại bằng Gemini (${percent}%)...`,
            });
            onUpdate?.();
          },
          isCancelled,
        );
        if (isCancelled()) throw new CancelledError();
        completedSteps += 1;
      }

      if (translateOverlay && task.overlaySrtPath) {
        finalOverlayPath = await translateSingleTrackAndMove(
          task.overlaySrtPath,
          preferredOverlayPath,
          targetLang,
          (percent) => {
            const basePct = completedSteps * 50;
            const overall = totalSteps === 2 ? basePct + Math.round(percent * 0.5) : percent;
            TaskStore.update(taskId, {
              progress: overall,
              stageDescription: `Đang dịch bảng/thông tin (overlay) bằng Gemini (${percent}%)...`,
            });
            onUpdate?.();
          },
          isCancelled,
        );
        if (isCancelled()) throw new CancelledError();
      }

      const taskUpdates: Partial<Task> = {
        status: 'done',
        progress: 100,
        errorMessage: undefined,
        projectDir,
        stageDescription:
          finalPrimaryPath && finalOverlayPath
            ? 'Đã dịch xong cả phụ đề thoại và file bảng/thông tin'
            : finalOverlayPath
              ? 'Đã dịch xong file bảng/thông tin (overlay)'
              : 'Đã hoàn tất dịch phụ đề vào thư mục dự án',
      };

      if (finalPrimaryPath) {
        taskUpdates.translatedSrtPath = finalPrimaryPath;
        taskUpdates.ttsAudioDir = undefined;
        taskUpdates.ttsMergedAudioPath = undefined;
        taskUpdates.ttsOverruns = undefined;
        taskUpdates.outputPath = undefined;
      }
      if (finalOverlayPath) {
        taskUpdates.translatedOverlaySrtPath = finalOverlayPath;
      }

      const updated = TaskStore.update(taskId, taskUpdates);
      onUpdate?.();

      return updated;
    } catch (err: any) {
      if (isCancelledError(err)) {
        console.log(`Người dùng đã huỷ dịch task ${taskId}`);
        const updated = TaskStore.update(taskId, {
          status: 'cancelled',
          targetLanguage: task.targetLanguage,
          stageDescription: 'Đã huỷ dịch thuật',
        });
        onUpdate?.();
        return updated;
      }
      console.error(`Lỗi khi dịch thuật task ${taskId}:`, err);
      const updated = TaskStore.update(taskId, {
        status: 'error',
        targetLanguage: task.targetLanguage,
        errorMessage: err.message || 'Lỗi không xác định khi dịch thuật',
        stageDescription: 'Thất bại khi dịch thuật',
      });
      onUpdate?.();
      return updated;
    } finally {
      this.cancelledTasks.delete(taskId);
      this.runningTasks.delete(taskId);
    }
  }
}
