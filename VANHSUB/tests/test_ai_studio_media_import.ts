import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import ffmpegInstaller from '@ffmpeg-installer/ffmpeg';

async function main() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'studio-import-media-'));
  process.env.VANHSUB_AI_STUDIO_DIR = path.join(root, 'config');
  try {
    const { AiStudioPipelineEngine } = await import('../main/ai-studio/AiStudioPipelineEngine');
    const engine = new AiStudioPipelineEngine();
    const session: any = {
      sessionId: 'media-import', topic: 'Test', currentStage: 8, stageName: 'metadata', status: 'completed', progress: 100,
      workspaceDir: path.join(root, 'episode'), mediaDir: path.join(root, 'custom-media'),
      stages: Object.fromEntries(Array.from({ length: 8 }, (_, i) => [i + 1, { status: 'success', stageName: `Step ${i + 1}` }])),
      artifacts: { audioPath: 'voice.mp3', scenes: [{ id: 'scene_01_shot_1', shotId: 'scene_01_shot_1', lineIndex: 0, status: 'ready', motionType: 'video', videoPath: 'old-video.mp4', imagePath: 'old-image.png', assetPath: 'old-video.mp4' }], videoPath: 'old-final.mp4', srtPath: 'old.srt', metadata: { title: 'Old' } }, createdAt: Date.now(), updatedAt: Date.now(),
    };
    engine.persistSessionStateAtomic(session);
    const png = path.join(root, 'source.png'), jpg = path.join(root, 'source.jpg'), video = path.join(root, 'source.mp4');
    const make = (args: string[]) => execFileSync(ffmpegInstaller.path, ['-v', 'error', ...args], { windowsHide: true });
    make(['-f', 'lavfi', '-i', 'color=red:s=64x64', '-frames:v', '1', png]);
    make(['-f', 'lavfi', '-i', 'color=blue:s=64x64', '-frames:v', '1', jpg]);
    make(['-f', 'lavfi', '-i', 'color=green:s=64x64:d=0.5', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', video]);
    const sourceBytes = fs.readFileSync(png);
    const bad = path.join(root, 'bad.png'); fs.writeFileSync(bad, Buffer.alloc(1024, 1));
    const checkpoint = fs.readFileSync(path.join(session.workspaceDir, 'session.json'), 'utf8');
    const importFile = (filePath: string, mediaType: 'image' | 'video', sceneId = 'scene_01_shot_1') => engine.importSceneMedia({ sessionId: session.sessionId, sceneId, filePath, mediaType });
    assert.equal((await importFile(bad, 'image')).success, false);
    assert.equal((await importFile(png, 'video')).success, false);
    assert.equal((await importFile(png, 'image', 'unknown-shot')).success, false);
    assert.equal(fs.readFileSync(path.join(session.workspaceDir, 'session.json'), 'utf8'), checkpoint);
    const result = await importFile(png, 'image');
    assert.equal(result.success, true, result.error);
    let updated = (await engine.getState({ sessionId: session.sessionId }))!;
    assert.equal(updated.artifacts.scenes![0].videoPath, undefined);
    assert.equal(updated.artifacts.scenes![0].assetPath, result.imagePath);
    assert.equal(updated.artifacts.scenes![0].mediaProvenance?.source, 'manual_import');
    assert.equal(updated.artifacts.scenes![0].mediaProvenance?.automaticGeneration, false);
    assert.equal(updated.artifacts.scenes![0].mediaProvenance?.sceneId, 'scene_01_shot_1');
    assert.equal(updated.artifacts.scenes![0].mediaProvenance?.sessionId, session.sessionId);
    assert.match(updated.artifacts.scenes![0].mediaProvenance?.sha256 || '', /^[a-f0-9]{64}$/);
    assert.equal(updated.artifacts.scenes![0].motionType, 'ken_burns');
    assert.equal(updated.artifacts.videoPath, undefined);
    assert.equal(updated.artifacts.metadata, undefined);
    assert.equal(updated.currentStage, 6);
    assert.equal(updated.stages[7].status, 'pending');
    assert.deepEqual(fs.readFileSync(png), sourceBytes);
    const oldImage = result.assetPath;
    const resultVideo = await importFile(video, 'video');
    assert.equal(resultVideo.success, true, resultVideo.error);
    updated = (await engine.getState({ sessionId: session.sessionId }))!;
    assert.equal(updated.artifacts.scenes![0].motionType, 'video');
    assert.equal(updated.artifacts.scenes![0].mediaProvenance?.assetPath, resultVideo.videoPath);
    assert.equal(updated.artifacts.scenes![0].imagePath, oldImage, 'Video keeps its keyframe');
    const disguised = path.join(root, 'jpeg-disguised.png'); fs.copyFileSync(jpg, disguised);
    const disguisedBytes = fs.readFileSync(disguised);
    const normalized = await importFile(disguised, 'image');
    assert.equal(normalized.success, true, normalized.error);
    assert.ok(normalized.assetPath.endsWith('.jpg'));
    assert.deepEqual(fs.readFileSync(disguised), disguisedBytes);
    assert.ok(fs.existsSync(oldImage));
    assert.ok(fs.existsSync(resultVideo.assetPath));
    const storage = engine.getDiskStorageManager(session.sessionId);
    assert.equal(storage.getCurrentMediaVersion('scene_01_shot_1', 'img')!.absolutePath, normalized.assetPath);
    const metadata = storage.readIndex().scenes.scene_01.shots!.scene_01_shot_1;
    assert.equal(metadata.video_path, '');
    assert.equal(path.resolve(storage.paths.projectDir, metadata.image_path!), normalized.assetPath);
    console.log('PASS: actual FFmpeg imports, corrupt/type/unknown-shot rejection, immutable sources, image replacing video, downstream invalidation and normalized version history');
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
