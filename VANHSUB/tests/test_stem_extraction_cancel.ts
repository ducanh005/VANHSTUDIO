import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import fluent from 'fluent-ffmpeg';
import ffmpeg from '@ffmpeg-installer/ffmpeg';

async function main() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'vanhsub-stem-extraction-'));
  process.env.VANHSUB_SETTINGS_DIR = path.join(root, 'settings');
  process.env.VANHSUB_TASKS_DIR = path.join(root, 'tasks');
  const { StemExportRunner } = await import('../main/audio/stemExportRunner');
  const { TaskStore } = await import('../main/store/taskStore');
  const { DubbingRunner } = await import('../main/render/dubbingRunner');
  const source = path.join(root, 'âm thanh có khoảng trắng.mp3');
  execFileSync(ffmpeg.path, ['-v', 'error', '-f', 'lavfi', '-i',
    'sine=frequency=700:duration=6', '-codec:a', 'libmp3lame', source], { windowsHide: true });
  const previous = path.join(root, 'previous.mp4');
  fs.writeFileSync(previous, 'previous completed export');
  const video = path.join(root, 'video mẫu.mp4');
  execFileSync(ffmpeg.path, ['-v', 'error', '-f', 'lavfi', '-i', 'color=size=32x32:rate=5:duration=6',
    '-i', source, '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-shortest', video], { windowsHide: true });
  for (const kind of ['stems', 'dubbing'] as const) {
    const projectDir = path.join(root, kind); fs.mkdirSync(projectDir);
    const srt = path.join(projectDir, 'input.srt');
    fs.writeFileSync(srt, '1\n00:00:00,000 --> 00:00:02,000\nXin chào.\n');
    const audioDir = path.join(projectDir, 'audio'); fs.mkdirSync(audioDir);
    const input = kind === 'stems' ? source : video;
    const task = TaskStore.create({ fileName: path.basename(input), filePath: input, projectDir, srtPath: srt });
    TaskStore.update(task.id, { outputPath: previous, ttsAudioDir: audioDir });
    const runner = kind === 'stems' ? StemExportRunner : DubbingRunner;

    // Throttle the real extraction worker so cancellation cannot race past a tiny fixture.
    // No fake FFmpeg process, provider or completion response is used.
    const prototype = (fluent as any).prototype;
    const originalRun = prototype.run;
    let workerPid = 0, tempOutput = '', cancelAt = 0, watchdog: NodeJS.Timeout | undefined;
    let reachedSeparation = false;
    prototype.run = function () {
      this.inputOptions('-re');
      this.once('start', () => {
        workerPid = this.ffmpegProc.pid;
        tempOutput = this._outputs[0].target;
        setTimeout(() => {
          cancelAt = Date.now();
          assert.equal(runner.cancel(task.id), true);
        }, 250);
        watchdog = setTimeout(() => this.kill('SIGKILL'), 10000);
      });
      return originalRun.call(this);
    };
    try {
      const update = () => {
        if ((TaskStore.getById(task.id)?.progress || 0) >= 12) reachedSeparation = true;
      };
      const result = kind === 'stems' ? await StemExportRunner.runStemExport(task.id, update)
        : await DubbingRunner.runDubbing(task.id, true, update, { vocalSeparation: true });
      const settleMs = Date.now() - cancelAt;
      assert.ok(workerPid > 0, 'Cancellation must reach a real FFmpeg extraction worker');
      assert.equal(result?.status, 'cancelled');
      assert.equal(runner.isRunning(task.id), false);
      assert.equal(reachedSeparation, false);
      assert.equal(fs.existsSync(tempOutput), false, 'Runner removes its partial extraction');
      assert.equal(result?.outputPath, previous);
      assert.equal(fs.readFileSync(previous, 'utf8'), 'previous completed export');
      assert.throws(() => process.kill(workerPid, 0), 'Worker must have exited before the runner settles');
      console.log(JSON.stringify({ kind, realExtractionWorker: true, cancelToSettleMs: settleMs, partialRemoved: true }));
      assert.ok(settleMs < 2500, `Cancel took ${settleMs}ms: extraction continued instead of stopping`);
    } finally {
      prototype.run = originalRun;
      if (watchdog) clearTimeout(watchdog);
    }
  }
  const { extractFullQualityAudio } = await import('../main/asr/audioExtractor');
  const neverStarted = path.join(root, 'never-started.wav');
  await assert.rejects(() => extractFullQualityAudio(source, neverStarted, undefined, { shouldStop: () => true }), /huỷ/);
  assert.equal(fs.existsSync(neverStarted), false);
  console.log('PASS: native fixture extraction cancellation, worker exit, temp cleanup and old output preservation; no live speech/provider/UI claim');
}
main().catch(error => { console.error(error); process.exitCode = 1; });
