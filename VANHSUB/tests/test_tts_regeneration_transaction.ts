import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';
import ffmpeg from '@ffmpeg-installer/ffmpeg';

async function main() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vanhsub-regeneration-transaction-'));
  process.env.VANHSUB_SETTINGS_DIR = path.join(dir, 'settings');
  process.env.VANHSUB_TASKS_DIR = path.join(dir, 'tasks');
  const { EdgeTTSClient } = await import('../main/tts-providers/edge/EdgeTTSClient');
  const { TTSRunner } = await import('../main/render/ttsRunner');
  const { DubbingRunner } = await import('../main/render/dubbingRunner');
  const { TaskStore } = await import('../main/store/taskStore');
  const client = EdgeTTSClient.getInstance(), original = client.synthesize;
  const tone = (name: string, frequency: number, duration: number) => {
    const file = path.join(dir, name);
    execFileSync(ffmpeg.path, ['-v', 'error', '-f', 'lavfi', '-i', `sine=frequency=${frequency}:duration=${duration}`, '-c:a', 'libmp3lame', file], { windowsHide: true });
    return fs.readFileSync(file);
  };
  const first = tone('first.mp3', 440, 0.4), changed = tone('changed.mp3', 880, 0.4), tooLong = tone('long.mp3', 220, 12);
  const srt = path.join(dir, 'source.srt');
  const video = path.join(dir, 'source.mp4');
  execFileSync(ffmpeg.path, ['-v', 'error', '-f', 'lavfi', '-i', 'color=blue:s=160x90:d=3.5', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', video], { windowsHide: true });
  const write = (a: string, b: string) => fs.writeFileSync(srt, `1\n00:00:00,000 --> 00:00:01,000\n${a}\n\n2\n00:00:02,000 --> 00:00:03,000\n${b}\n`);
  const hash = (file: string) => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
  try {
    client.synthesize = async () => ({ audio: first });
    write('First.', 'Second.');
    const task = TaskStore.create({ fileName: 'source.mp4', filePath: video, srtPath: srt, projectDir: dir });
    await TTSRunner.runTTS(task.id, 'vi-VN-HoaiMyNeural', 1, undefined, {}, 'edge');
    const before = TaskStore.getById(task.id)!;
    assert.equal(before.status, 'done');
    const savedFiles = ['manifest.json', 'subtitle_0001.mp3', 'subtitle_0002.mp3'].map(name => path.join(before.ttsAudioDir!, name));
    savedFiles.push(before.ttsMergedAudioPath!);
    const hashes = savedFiles.map(hash);
    write('First edited.', 'Failure.');
    let successfulCandidate = false;
    client.synthesize = async text => {
      if (text === 'First edited.') { successfulCandidate = true; return { audio: changed }; }
      return { audio: tooLong };
    };
    const failed = await TTSRunner.regenerateLine(task.id, 1);
    assert.equal(failed.ok, false);
    assert.equal(successfulCandidate, true, 'Reach a successful first group before a later failure');
    assert.deepEqual(savedFiles.map(hash), hashes, 'A later group failure must preserve ALL completed prior audio and manifest bytes');
    const after = TaskStore.getById(task.id)!;
    assert.equal(after.ttsAudioDir, before.ttsAudioDir);
    assert.equal(after.ttsMergedAudioPath, before.ttsMergedAudioPath);
    assert.equal(after.ttsNeedsRegeneration, true);
    client.synthesize = async () => ({ audio: changed });
    const success = await TTSRunner.regenerateLine(task.id, 1);
    assert.equal(success.ok, true, success.error);
    const committed = TaskStore.getById(task.id)!;
    assert.notEqual(committed.ttsAudioDir, before.ttsAudioDir);
    assert.notEqual(committed.ttsMergedAudioPath, before.ttsMergedAudioPath);
    assert.deepEqual(savedFiles.map(hash), hashes);
    assert.equal(committed.ttsNeedsRegeneration, false);
    const dubbed = await DubbingRunner.runDubbing(task.id);
    assert.equal(dubbed?.status, 'done', dubbed?.errorMessage);
    assert.equal(dubbed?.outputInspection?.decode, 'passed', 'Published regenerated audio must work with the real dubbing/inspection pipeline');

    const committedFiles = ['manifest.json', 'subtitle_0001.mp3', 'subtitle_0002.mp3'].map(name => path.join(committed.ttsAudioDir!, name));
    committedFiles.push(committed.ttsMergedAudioPath!);
    committedFiles.push(dubbed!.dubbedVideoPath!);
    const committedHashes = committedFiles.map(hash);
    write('First edited again.', 'Second changed.');
    client.synthesize = async text => {
      if (text === 'Second changed.') TTSRunner.cancel(task.id);
      return { audio: first };
    };
    assert.equal((await TTSRunner.regenerateLine(task.id, 1)).ok, false);
    assert.equal(TaskStore.getById(task.id)!.status, 'cancelled');
    assert.equal(TaskStore.getById(task.id)!.ttsMergedAudioPath, committed.ttsMergedAudioPath);
    assert.equal(TaskStore.getById(task.id)!.dubbedVideoPath, dubbed!.dubbedVideoPath);
    assert.deepEqual(committedFiles.map(hash), committedHashes, 'Cancellation after an earlier candidate must preserve the committed run');

    // An external editor can change the source despite the application's task lease.
    write('Source snapshot.', 'Second.');
    let changedSource = false;
    client.synthesize = async () => {
      if (!changedSource) { changedSource = true; write('External edit.', 'Second.'); }
      return { audio: first };
    };
    const sourceRace = await TTSRunner.regenerateLine(task.id, 1);
    assert.equal(sourceRace.ok, false);
    assert.match(sourceRace.error!, /Phụ đề đã thay đổi/);
    assert.equal(TaskStore.getById(task.id)!.ttsAudioDir, committed.ttsAudioDir);
    assert.deepEqual(committedFiles.map(hash), committedHashes);
    console.log('PASS: multi-group regeneration fails after a real candidate without mutating completed audio; successful rerun publishes a new run. Synthetic provider fixture, not live speech.');
  } finally { client.synthesize = original; }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
