import fs from 'fs';
import path from 'path';
import { TaskStore, type Task } from '../store/taskStore';

export function canonicalArtifactPath(file: string): string {
  try { return fs.realpathSync(file).toLowerCase(); }
  catch { return path.resolve(file).toLowerCase(); }
}
function resources(task: Task): string[] {
  return [task.projectDir, task.ttsAudioDir, task.srtPath, task.translatedSrtPath, task.overlaySrtPath, task.translatedOverlaySrtPath]
    .filter((file): file is string => !!file).map(canonicalArtifactPath);
}

/** Legacy tasks may already share artifacts; do not overwrite ambiguous data. */
export function assertProjectIsolation(task: Task): void {
  const current = TaskStore.getById(task.id) || task;
  const owned = new Set(resources(current));
  if (!owned.size) return;
  const conflict = TaskStore.getAll().find((other) => other.id !== task.id && resources(other).some((file) => owned.has(file)));
  if (conflict) throw new Error(`Dự án đang dùng chung thư mục hoặc phụ đề với tác vụ "${conflict.fileName}". Hãy tạo tác vụ mới hoặc gỡ tác vụ trùng trước khi xử lý để giữ an toàn dữ liệu cũ.`);
}
