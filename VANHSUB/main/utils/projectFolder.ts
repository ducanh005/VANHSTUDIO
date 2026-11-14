import fs from 'fs';
import path from 'path';
import { SettingsStore } from '../store/settingsStore';
import { TaskStore, type Task } from '../store/taskStore';
import { createUniqueDirectory } from '../lib/paths';
import { assertProjectIsolation } from '../lib/projectIsolation';

/**
 * Loại bỏ các ký tự không hợp lệ trên Windows để làm tên thư mục an toàn: \ / : * ? " < > |
 */
export function sanitizeFolderName(rawName: string): string {
  return rawName
    .replace(/[\\/:*?"<>|]/g, '_')
    .replace(/\s+/g, ' ')
    .trim().replace(/[. ]+$/g, '').slice(0, 140);
}

/**
 * Lấy hoặc tạo mới thư mục dự án riêng cho một video.
 * Cấu trúc: [Tên video]_vanhsub[_N]/; chỉ tái sử dụng thư mục đã lưu trên task.
 */
export function getOrCreateProjectDir(task: Task | { id: string; filePath: string; fileName: string; projectDir?: string }): string {
  const savedTask = TaskStore.getById(task.id);
  if (savedTask) assertProjectIsolation(savedTask);
  // Runners may keep a snapshot taken before another stage saved projectDir.
  const savedDir = TaskStore.getById(task.id)?.projectDir || task.projectDir;
  if (savedDir && fs.existsSync(savedDir)) {
    if (!fs.statSync(savedDir).isDirectory()) throw new Error('Project path is not a directory.');
    return savedDir;
  }

  const videoPath = task.filePath;
  const videoExt = path.extname(videoPath);
  const rawBase = path.basename(videoPath, videoExt) || path.basename(task.fileName, videoExt) || 'video';
  const cleanBase = sanitizeFolderName(rawBase);

  // Xác định thư mục cha: ưu tiên exportDir nếu có, nếu không thì cạnh file video
  const exportDirSetting = SettingsStore.get('exportDir');
  let parentDir = path.dirname(videoPath);
  if (exportDirSetting && fs.existsSync(exportDirSetting)) {
    parentDir = exportDirSetting;
  }

  const projectDir = createUniqueDirectory(path.join(parentDir, `${cleanBase}_vanhsub`));

  // Cập nhật lại vào TaskStore nếu task đã tồn tại
  if (task.id) {
    TaskStore.update(task.id, { projectDir });
  }

  return projectDir;
}

export interface ProjectArtifactPaths {
  projectDir: string;
  cleanBase: string;
  audioWavPath: string;
  rawSrtPath: string;
  translatedSrtPath: string;
  translatedOverlaySrtPath: string;
  compiledAssPath: string;
  hardsubPath: string;
  softsubPath: string;
  dubbedPath: string;
  ttsAudioDir: string;
  /** File audio MP3 lồng tiếng tổng hợp chuẩn xác theo timeline dự án */
  ttsMergedAudioPath: string;
}

/**
 * Tạo danh sách đường dẫn chuẩn hoá cho toàn bộ sản phẩm xuất ra của video trong projectDir.
 */
export function getProjectArtifactPaths(task: Task): ProjectArtifactPaths {
  const projectDir = getOrCreateProjectDir(task);
  const videoPath = task.filePath;
  const videoExt = path.extname(videoPath);
  const rawBase = path.basename(videoPath, videoExt) || path.basename(task.fileName, videoExt) || 'video';
  const cleanBase = sanitizeFolderName(rawBase);

  return {
    projectDir,
    cleanBase,
    audioWavPath: path.join(projectDir, `${cleanBase}_audio_16k.wav`),
    rawSrtPath: path.join(projectDir, `${cleanBase}.srt`),
    translatedSrtPath: path.join(projectDir, `${cleanBase}.vi.srt`),
    translatedOverlaySrtPath: path.join(projectDir, `${cleanBase}.overlay.vi.srt`),
    compiledAssPath: path.join(projectDir, `${cleanBase}.ass`),
    hardsubPath: path.join(projectDir, `${cleanBase}.hardsub.mp4`),
    softsubPath: path.join(projectDir, `${cleanBase}.softsub.mp4`),
    dubbedPath: path.join(projectDir, `${cleanBase}.dubbed.mp4`),
    ttsAudioDir: path.join(projectDir, 'tts_audio'),
    ttsMergedAudioPath: path.join(projectDir, `${cleanBase}_voice.mp3`),
  };
}
