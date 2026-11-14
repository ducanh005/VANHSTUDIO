import fs from 'fs';
import path from 'path';
import { TaskStore, type Task } from '../store/taskStore';
import { parseSrtStrict } from './srt';
import { nextAvailablePath } from './paths';
import { getProjectArtifactPaths } from '../utils/projectFolder';
import { assertTaskAvailable } from './taskOperations';
import { assertProjectIsolation, canonicalArtifactPath } from './projectIsolation';

function assertIdle(task: Task) {
  assertProjectIsolation(task);
  assertTaskAvailable(task.id);
  if (['transcribing', 'ocr', 'translating', 'dubbing', 'exporting'].includes(task.status)) {
    throw new Error('Tác vụ đang xử lý. Hãy chờ hoặc huỷ trước khi thay phụ đề.');
  }
}

function validate(content: string) {
  if (parseSrtStrict(content).length === 0) throw new Error('File SRT không có dòng phụ đề hợp lệ.');
}

function invalidate(task: Task, kind: 'primary_orig' | 'primary_trans' | 'overlay_orig' | 'overlay_trans') {
  if (kind === 'overlay_orig' || kind === 'overlay_trans') {
    return TaskStore.update(task.id, {
      ...(kind === 'overlay_orig' ? { translatedOverlaySrtPath: undefined } : {}),
      subtitleRevision: (task.subtitleRevision || 0) + 1,
      outputPath: undefined,
    });
  }
  return TaskStore.update(task.id, {
    ...(kind === 'primary_orig' ? { translatedSrtPath: undefined } : {}),
    subtitleRevision: (task.subtitleRevision || 0) + 1,
    ttsNeedsRegeneration: !!task.ttsAudioDir,
    ttsMergedAudioPath: undefined, ttsOverruns: undefined, outputPath: undefined,
    stageDescription: 'Phụ đề đã thay đổi — cần tạo lại audio trước khi lồng tiếng',
  });
}

export function saveTaskSubtitle(srtPath: string, content: string): void {
  validate(content);
  const normalize = canonicalArtifactPath;
  const target = normalize(srtPath);
  const tasks = TaskStore.getAll().filter((task) =>
    [task.srtPath, task.translatedSrtPath, task.overlaySrtPath, task.translatedOverlaySrtPath]
      .some((file) => file && normalize(file) === target));
  tasks.forEach(assertIdle);
  if (fs.existsSync(srtPath) && fs.readFileSync(srtPath, 'utf-8') === content) return;
  fs.writeFileSync(srtPath, content, 'utf-8');
  for (const task of tasks) {
    if (task.srtPath && normalize(task.srtPath) === target) invalidate(task, 'primary_orig');
    else if (task.translatedSrtPath && normalize(task.translatedSrtPath) === target) invalidate(task, 'primary_trans');
    else if (task.overlaySrtPath && normalize(task.overlaySrtPath) === target) invalidate(task, 'overlay_orig');
    else if (task.translatedOverlaySrtPath && normalize(task.translatedOverlaySrtPath) === target) invalidate(task, 'overlay_trans');
  }
}

export function importTaskSubtitle(id: string, source: string): Task | undefined {
  const task = TaskStore.getById(id);
  if (!task) throw new Error('Không tìm thấy tác vụ.');
  assertIdle(task);
  if (path.extname(source).toLowerCase() !== '.srt') throw new Error('Chỉ hỗ trợ file .srt');
  validate(fs.readFileSync(source, 'utf-8'));
  const target = nextAvailablePath(getProjectArtifactPaths(task).rawSrtPath);
  fs.copyFileSync(source, target);
  invalidate(task, 'primary_orig');
  return TaskStore.update(id, { srtPath: target, ttsVoiceOverrides: {},
    stageDescription: 'Đã nhập phụ đề — cần tạo lại bản dịch và audio nếu có' });
}
