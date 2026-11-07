import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import ffmpeg from '@ffmpeg-installer/ffmpeg';

async function main() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'manual-episode-'));
  process.env.VANHSUB_AI_STUDIO_DIR=path.join(root,'config');
  try {
    const { updateAiStudioConfig }=await import('../main/store/aiStudioStore');
    const { AiStudioPipelineEngine }=await import('../main/ai-studio/AiStudioPipelineEngine');
    updateAiStudioConfig({ activeProjectId:'manual-owner',savedProjects:[{id:'manual-owner',name:'Manual',outputDir:path.join(root,'project'),channelProfile:{},updatedAt:1}] } as any);
    const audio=path.join(root,'voice.wav'),srt=path.join(root,'input.srt');
    execFileSync(ffmpeg.path,['-v','error','-i',path.resolve('node_modules/nodejs-whisper/cpp/whisper.cpp/bindings/go/samples/jfk.wav'),'-t','2','-ar','22050',audio],{windowsHide:true});
    fs.writeFileSync(srt,'1\n00:00:00,000 --> 00:00:02,000\nManual narration.\n');
    const engine=new AiStudioPipelineEngine();
    await assert.rejects(engine.startManualMedia({projectId:'other',srtPath:srt,audioPath:audio}),/project/);
    const a=await engine.startManualMedia({projectId:'manual-owner',srtPath:srt,audioPath:audio});
    const b=await engine.startManualMedia({projectId:'manual-owner',srtPath:srt,audioPath:audio});
    assert.notEqual(a.sessionId,b.sessionId);
    const state=(await new AiStudioPipelineEngine().getState(a))!;
    assert.equal(state.manualMode,true);assert.equal(state.ownerProjectId,'manual-owner');assert.equal(state.artifacts.scenes?.length,1);
    assert.equal(state.artifacts.scenes?.[0].manualMediaOnly,true);assert.equal(state.artifacts.scenes?.[0].status,'pending');
    assert.deepEqual(fs.readFileSync(state.artifacts.audioPath!),fs.readFileSync(audio));
    await assert.rejects(engine.resume({...a},()=>{}),/thủ công/);
    await assert.rejects(engine.regenerateSceneAsset({...a,sceneId:'scene_1_shot_1',visualPrompt:'must not generate'}),/thủ công/);
    await assert.rejects(engine.renderVideo(a),/scene/);
    fs.writeFileSync(srt,'1\n00:00:00,000 --> 00:00:15,000\nWrong duration.\n');
    await assert.rejects(engine.startManualMedia({projectId:'manual-owner',srtPath:srt,audioPath:audio}),/750ms/);
    console.log('PASS: real public-speech artifact import, owner/duration checks, separate episode paths, persistent manual source and automatic provider guards');
  } finally {fs.rmSync(root,{recursive:true,force:true});}
}
main().catch(e=>{console.error(e);process.exitCode=1});
