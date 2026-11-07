import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

async function main() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vanhsub-regenerate-'));
  process.env.VANHSUB_SETTINGS_DIR = path.join(dir, 'settings');
  process.env.VANHSUB_TASKS_DIR = path.join(dir, 'tasks');
  const { EdgeTTSClient } = await import('../main/tts-providers/edge/EdgeTTSClient');
  const client = EdgeTTSClient.getInstance();
  const original = client.synthesize;
  try {
    const { getFfmpegBinPath } = await import('../main/asr/audioExtractor');
    const { TTSRunner } = await import('../main/render/ttsRunner');
    const { TaskStore } = await import('../main/store/taskStore');
    const calls: Array<{ text: string; voice: string; speed: number }> = [];
    let generation = 0;
    // Replace only the network provider. Timing, cache, manifest and MP3 merge
    // use real application code and real FFmpeg-generated speech substitutes.
    client.synthesize = async (text, voice = 'vi-VN-HoaiMyNeural', speed = 1) => {
      calls.push({ text, voice, speed });
      const duration = (text.includes('Too long') ? 12 : text === 'Hello changed.' ? 2.6 : 0.4) / speed;
      const { stdout } = await promisify(execFile)(getFfmpegBinPath(), ['-v', 'error', '-f', 'lavfi',
        '-i', `sine=frequency=${440 + (++generation % 97) * 110}:duration=${duration}`,
        '-c:a', 'libmp3lame', '-f', 'mp3', 'pipe:1'], { encoding: 'buffer' });
      return { audio: stdout };
    };
    const srt = path.join(dir, 'source.srt');
    const write = (second = 'world.') => fs.writeFileSync(srt,
      `1\n00:00:00,000 --> 00:00:01,000\nHello\n\n2\n00:00:01,000 --> 00:00:02,000\n${second}\n\n3\n00:00:03,000 --> 00:00:04,000\nLast.\n`);
    write();
    const task = TaskStore.create({ fileName: 'source.mp4', filePath: path.join(dir, 'source.mp4'), srtPath: srt, projectDir: dir });
    const initial = await TTSRunner.runTTS(task.id, 'vi-VN-HoaiMyNeural', 1, undefined, {}, 'edge');
    assert.equal(initial?.status, 'done', initial?.errorMessage);
    let audioDir = initial!.ttsAudioDir!;
    const initialAudioDir = audioDir;
    const audio = (index: number) => fs.readFileSync(path.join(TaskStore.getById(task.id)!.ttsAudioDir!, `subtitle_${String(index).padStart(4, '0')}.mp3`));
    const manifest = () => JSON.parse(fs.readFileSync(path.join(TaskStore.getById(task.id)!.ttsAudioDir!, 'manifest.json'), 'utf8'));
    const previous = audio(1);
    const untouched = audio(3);
    const shortenedCache = manifest();
    shortenedCache['1'].spokenText = 'Shortened speech from an earlier run.';
    fs.writeFileSync(path.join(audioDir, 'manifest.json'), JSON.stringify(shortenedCache));
    calls.length = 0;
    const restored = await TTSRunner.runTTS(task.id);
    assert.equal(restored?.status, 'done', restored?.errorMessage);
    assert.deepEqual(calls.map((c) => c.text), ['Hello world.'], 'Opting out must not reuse shortened spoken text');
    audioDir = restored!.ttsAudioDir!;
    assert.notEqual(audioDir, initialAudioDir);
    assert.deepEqual(fs.readFileSync(path.join(initialAudioDir, 'subtitle_0001.mp3')), previous, 'The previous run must survive cache reuse');
    calls.length = 0;
    assert.equal((await TTSRunner.regenerateLine(task.id, 2)).ok, true);
    assert.deepEqual(calls.map((c) => c.text), ['Hello world.']);
    assert.notDeepEqual(audio(1), previous);
    assert.deepEqual(audio(2), audio(1));
    assert.deepEqual(audio(3), untouched);
    assert.equal(manifest()['2'].leaderIndex, 1);
    assert.ok(fs.existsSync(TaskStore.getById(task.id)!.ttsMergedAudioPath!));

    write('changed.');
    assert.equal((await TTSRunner.regenerateLine(task.id, 2)).ok, true);
    assert.equal(manifest()['1'].text, 'Hello changed.');
    assert.ok(manifest()['1'].timingAttempts.some((attempt: any) => attempt.strategy === 'rate'));
    assert.ok(manifest()['1'].requiredTempo <= 1.35);
    assert.deepEqual(audio(3), untouched);

    assert.equal((await TTSRunner.regenerateLine(task.id, 2, undefined, 1, 'edge', { '2': 'vi-VN-NamMinhNeural' })).ok, true);
    assert.equal(manifest()['2'].voice, 'vi-VN-NamMinhNeural');
    assert.ok(!manifest()['2'].isGroupMember, 'A former member must become independent when its voice differs');
    assert.equal(TaskStore.getById(task.id)!.ttsVoiceOverrides!['2'], 'vi-VN-NamMinhNeural');
    assert.equal((await TTSRunner.regenerateLine(task.id, 2, undefined, 1, 'edge', {})).ok, true);
    assert.equal(manifest()['2'].leaderIndex, 1);
    assert.deepEqual(audio(2), audio(1));

    // An active regeneration owns the task so another line cannot overwrite it.
    const synthesizer = client.synthesize;
    let unblock!: () => void;
    client.synthesize = async (...args) => {
      await new Promise<void>((resolve) => { unblock = resolve; });
      return synthesizer(...args);
    };
    const pending = TTSRunner.regenerateLine(task.id, 2);
    await new Promise((resolve) => setTimeout(resolve, 10));
    assert.equal((await TTSRunner.regenerateLine(task.id, 1)).ok, false);
    client.synthesize = synthesizer;
    unblock();
    assert.equal((await pending).ok, true);

    const safeAudio = audio(1);
    const completedMp3 = TaskStore.getById(task.id)!.ttsMergedAudioPath;
    write('Too long.');
    const failed = await TTSRunner.regenerateLine(task.id, 2);
    assert.equal(failed.ok, false);
    assert.match(failed.error || '', /TTS timing conflict/);
    assert.deepEqual(audio(1), safeAudio, 'Do not replace the chosen audio with an invalid candidate');
    assert.equal(TaskStore.getById(task.id)!.ttsMergedAudioPath, completedMp3, 'Keep the completed MP3 pointer on failure');
    assert.equal(TaskStore.getById(task.id)!.ttsNeedsRegeneration, true, 'Preserved old audio must stay blocked for new dubbing');
    assert.equal(TTSRunner.isRunning(task.id), false);
    console.log('PASS: member regeneration, cache reuse, timing adaptation, voice split/rejoin, MP3 refresh and concurrent/failure guards');
  } finally {
    client.synthesize = original;
    fs.rmSync(dir, { recursive: true, force: true });
  }
}
main().catch((err) => { console.error(err); process.exitCode = 1; });
