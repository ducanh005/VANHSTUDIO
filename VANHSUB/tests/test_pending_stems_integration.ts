import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import ffmpeg from '@ffmpeg-installer/ffmpeg';
import ffprobe from '@ffprobe-installer/ffprobe';

async function main() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'vanhsub-pending-stems-'));
  process.env.VANHSUB_SETTINGS_DIR = path.join(root, 'settings');
  process.env.VANHSUB_TASKS_DIR = path.join(root, 'tasks');
  const { separateVocalsFastFfmpeg } = await import('../main/audio/vocalSeparation');
  const { runFfmpeg } = await import('../main/lib/ffmpegProcess');
  const { StemExportRunner } = await import('../main/audio/stemExportRunner');
  const { TaskStore } = await import('../main/store/taskStore');
  const { SettingsStore } = await import('../main/store/settingsStore');
  // Stub only the Demucs availability executable. Never install/download a model in a regression test.
  SettingsStore.set('pythonPath', process.execPath);
  const source = path.join(root, 'âm thanh mẫu.wav');
  execFileSync(ffmpeg.path, ['-v', 'error', '-f', 'lavfi', '-i', 'sine=frequency=700:duration=2', source], { windowsHide: true });
  for (const channels of [1, 2]) {
    const input = path.join(root, `channels-${channels}.wav`);
    execFileSync(ffmpeg.path, ['-v', 'error', '-i', source, '-ac', String(channels), input], { windowsHide: true });
    const stems = await separateVocalsFastFfmpeg(input, path.join(root, `dsp-${channels}`));
    for (const file of [stems.noVocals, stems.vocals]) {
      const probe = JSON.parse(execFileSync(ffprobe.path, ['-v', 'error', '-show_format', '-of', 'json', file], { encoding: 'utf8', windowsHide: true }));
      assert.ok(Number(probe.format.duration) > 1.9);
      execFileSync(ffmpeg.path, ['-v', 'error', '-xerror', '-i', file, '-f', 'null', '-'], { windowsHide: true });
    }
  }
  await assert.rejects(() => separateVocalsFastFfmpeg(source, path.join(root, 'stopped'), () => true), /huỷ/);
  let stop = false;
  const timer = setTimeout(() => { stop = true; }, 250);
  try { await assert.rejects(() => runFfmpeg(['-re', '-i', source, '-f', 'null', '-'], { shouldStop: () => stop }), /huỷ/); }
  finally { clearTimeout(timer); }
  const project = path.join(root, 'project'), previous = path.join(root, 'previous.mp4');
  fs.mkdirSync(project);
  fs.writeFileSync(previous, 'previous completed export');
  const task = TaskStore.create({ fileName: path.basename(source), filePath: source, projectDir: project });
  TaskStore.update(task.id, { outputPath: previous });
  // Cancel after actual extraction completes and before provider probing.
  const cancelled = await StemExportRunner.runStemExport(task.id, () => {
    if (TaskStore.getById(task.id)?.progress === 12) assert.equal(StemExportRunner.cancel(task.id), true);
  });
  assert.equal(cancelled?.status, 'cancelled');
  assert.equal(StemExportRunner.isRunning(task.id), false);
  assert.equal(fs.readFileSync(previous, 'utf8'), 'previous completed export');
  const completed = await StemExportRunner.runStemExport(task.id);
  assert.equal(completed?.status, 'done', completed?.errorMessage);
  assert.equal(fs.existsSync(path.join(project, 'âm thanh mẫu.nhacnen.mp3')), true);
  assert.equal(fs.existsSync(path.join(project, 'âm thanh mẫu.giong.mp3')), true);
  assert.equal(fs.existsSync(path.join(root, 'âm thanh mẫu.nhacnen.mp3')), false, 'Stems belong to the task project, not input parent');
  assert.equal(completed?.outputPath, previous);
  console.log('PASS: real mono/stereo DSP decode, FFmpeg cancellation, stem stop/rerun and project output isolation; synthetic audio, no Demucs model/provider live');
}
main().catch(error => { console.error(error); process.exitCode = 1; });
