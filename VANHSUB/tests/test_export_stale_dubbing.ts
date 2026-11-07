import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import ffmpeg from '@ffmpeg-installer/ffmpeg';

async function main() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'vanhsub-export-stale-dub-'));
  process.env.VANHSUB_TASKS_DIR = path.join(root, 'tasks');
  process.env.VANHSUB_SETTINGS_DIR = path.join(root, 'settings');
  const { TaskStore } = await import('../main/store/taskStore');
  const { ExportRunner } = await import('../main/render/exportRunner');
  const video = path.join(root, 'source.mp4'), srt = path.join(root, 'source.srt');
  execFileSync(ffmpeg.path, ['-v', 'error', '-f', 'lavfi', '-i', 'color=blue:s=160x90:d=1', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', video], { windowsHide: true });
  fs.writeFileSync(srt, '1\n00:00:00,000 --> 00:00:00,900\nEdited subtitle.\n');
  const bytes = fs.readFileSync(video);
  const task = TaskStore.create({ fileName: 'source.mp4', filePath: video, srtPath: srt, projectDir: root });
  TaskStore.update(task.id, { ttsNeedsRegeneration: true, dubbedVideoPath: video, outputPath: video });
  for (const videoSource of ['auto', 'dubbed'] as const) {
    const result = await ExportRunner.runExport(task.id, 'hardsub', undefined, undefined, undefined, { videoSource });
    assert.equal(result?.status, 'error');
    assert.match(result?.errorMessage || '', /Audio lồng tiếng chưa khớp/);
    assert.equal(result?.outputPath, video);
    assert.equal(result?.dubbedVideoPath, video);
    assert.equal(ExportRunner.isRunning(task.id), false);
  }
  const original = await ExportRunner.runExport(task.id, 'softsub', undefined, undefined, undefined, { videoSource: 'original' });
  assert.equal(original?.status, 'done', original?.errorMessage);
  assert.notEqual(original?.outputPath, video);
  assert.deepEqual(fs.readFileSync(video), bytes);
  console.log('PASS: stale dubbed audio rejected for Auto/explicit dubbed; original-video export remains usable; previous file retained. Local synthetic media only.');
}
main().catch(error => { console.error(error); process.exitCode = 1; });
