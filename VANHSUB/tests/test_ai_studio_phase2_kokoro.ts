import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { once, getEventListeners } from 'node:events';
import fluent from 'fluent-ffmpeg';
import { execFileSync } from 'node:child_process';
import ffmpeg from '@ffmpeg-installer/ffmpeg';
import ffprobe from '@ffprobe-installer/ffprobe';
import { AiStudioTtsService } from '../main/ai-studio/services/AiStudioTtsService';
import { kokoroUrl, kokoroSpeed, synthesizeKokoroSpeech } from '../main/tts-providers/kokoro/KokoroClient';

async function main() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'studio-phase2-kokoro-'));
  process.env.VANHSUB_AI_STUDIO_DIR=path.join(root,'config');
  process.env.VANHSUB_BIBLE_DIR=path.join(root,'bible');
  process.env.VANHSUB_ALLOW_INSECURE_TEST_SECRETS='1';
  const wav=path.join(root,'speech.wav');
  execFileSync(ffmpeg.path,['-v','error','-i',path.resolve('node_modules/nodejs-whisper/cpp/whisper.cpp/bindings/go/samples/jfk.wav'),'-t','1.2','-ar','22050',wav],{windowsHide:true});
  const speech=fs.readFileSync(wav), requests:any[]=[];
  let mode='ok',responsesSinceMode=0;
  const server=http.createServer(async(req,res)=>{
    let body='';for await(const part of req)body+=part;
    requests.push(JSON.parse(body));
    if(mode==='hang')return;
    if(mode==='error'||mode==='late-error'&&++responsesSinceMode===2){res.statusCode=503;res.end('private upstream message must not escape');return;}
    res.setHeader('Content-Type','audio/wav');
    res.end(mode==='invalid'?Buffer.from('invalid audio'):mode==='truncated'?speech.subarray(0,44):speech);
  });
  server.listen(0,'127.0.0.1');await once(server,'listening');
  const base=`http://127.0.0.1:${(server.address() as any).port}/v1`;
  const service=new AiStudioTtsService();
  const voice:any={provider:'local_onnx',voiceId:'af_heart',rate:'+20%',pitch:'+0Hz',volume:'+0%',autoWordAlignment:true,kokoroBaseUrl:base,kokoroTimeoutMs:2000};
  const lines:any[]=[{id:'a',index:1,text:'Speech transport fixture one.'},{id:'b',index:1,text:'Speech transport fixture two.'}];
  const output=path.join(root,'Đầu ra có dấu','voice.mp3');
  try {
    const result=await service.synthesizeVoiceover(lines,voice,output);
    assert.equal(requests.length,2);assert.equal(requests[0].speed,1.2);assert.equal(requests[0].voice,'af_heart');
    assert.equal(requests[0].response_format,'wav');assert.equal(requests[0].stream,false);assert.equal(requests[0].model,'kokoro');
    assert.equal(result.sampleRate,24000);assert.equal(result.alignmentSource,'estimated_per_line');
    assert.notEqual(lines[0].audioPath,lines[1].audioPath,'Duplicate legacy line.index must not overwrite another clip');
    assert.equal(lines[1].startMs,lines[0].endMs);assert.ok(result.durationMs>2000);
    const metadata=JSON.parse(execFileSync(ffprobe.path,['-v','error','-show_streams','-show_format','-of','json',output],{encoding:'utf8',windowsHide:true}));
    assert.equal(metadata.streams[0].sample_rate,'24000');assert.equal(metadata.streams[0].channels,1);
    execFileSync(ffmpeg.path,['-v','error','-xerror','-i',output,'-f','null','-'],{windowsHide:true});
    const aligned=service.extractAlignment([],lines.map(l=>l.text).join(' '),lines,result.durationMs,result.wordTimestamps);
    assert.equal(aligned.alignedLines.at(-1)!.endMs,result.durationMs);
    const old=fs.readFileSync(output),oldLines=structuredClone(lines);
    for(const failure of ['invalid','truncated','error','late-error']) {
      mode=failure;responsesSinceMode=0;const before=requests.length;
      await assert.rejects(()=>service.synthesizeVoiceover(lines,voice,output),/Kokoro/);
      assert.equal(requests.length,before+(failure==='late-error'?2:1),'A failed request must not retry or fall back');
      assert.deepEqual(fs.readFileSync(output),old);assert.deepEqual(lines,oldLines);
    }
    mode='hang';let before=requests.length;
    await assert.rejects(()=>service.synthesizeVoiceover(lines,{...voice,kokoroTimeoutMs:100},output),/hết thời gian/);
    assert.equal(requests.length,before+1);assert.deepEqual(fs.readFileSync(output),old);
    const controller=new AbortController();before=requests.length;
    const pending=service.synthesizeVoiceover(lines,voice,output,controller.signal);
    while(requests.length===before)await new Promise(r=>setTimeout(r,5));controller.abort();
    await assert.rejects(()=>pending);assert.equal(requests.length,before+1);assert.deepEqual(fs.readFileSync(output),old);assert.deepEqual(lines,oldLines);
    assert.equal(fs.readdirSync(path.dirname(output)).filter(f=>f.startsWith('.tts-')).length,1,'Failed invocations remove only their staging workspaces');
    assert.equal(kokoroSpeed('-25%'),0.75);assert.throws(()=>kokoroSpeed('-100%'));
    assert.throws(()=>kokoroUrl('https://example.invalid/v1','speech'));
    assert.throws(()=>kokoroUrl('http://127.0.0.1:8880/v1?token=private','speech'));
    await assert.rejects(()=>synthesizeKokoroSpeech('Text','bad voice','+0%',base),/giọng/);

    const ffmpegCancel=new AbortController();let nativePid;
    const command=fluent(wav).inputOptions(['-re','-stream_loop','-1']).format('null').output('-');
    command.once('start',()=>{nativePid=command.ffmpegProc?.pid;ffmpegCancel.abort();});
    await assert.rejects(()=>(service as any).runAudioCommand(command,ffmpegCancel.signal),/hủy/);
    assert.equal(getEventListeners(ffmpegCancel.signal,'abort').length,0);
    if(nativePid)assert.throws(()=>process.kill(nativePid,0));
    mode='ok';
    const {DEFAULT_AI_STUDIO_CONFIG}=await import('../main/ai-studio/types');
    const {captureSessionConfig}=await import('../main/ai-studio/sessionConfig');
    const {AiStudioPipelineEngine}=await import('../main/ai-studio/AiStudioPipelineEngine');
    let engine=new AiStudioPipelineEngine();
    const config=structuredClone(DEFAULT_AI_STUDIO_CONFIG);config.voice=voice;config.channelProfile.ttsEngine='kokoro_tts';config.channelProfile.specificVoice='af_heart';
    const state:any={sessionId:'kokoro-stage3',topic:'Offline contract',currentStage:2,stageName:'script',status:'awaiting_approval',gatedMode:true,
      progress:25,workspaceDir:path.join(root,'episode'),mediaDir:path.join(root,'episode','media'),configSnapshot:captureSessionConfig(config),
      stages:{1:{status:'success'},2:{status:'success'}},artifacts:{scriptLines:[{id:'line',index:1,text:'Offline speech fixture.'}]},createdAt:Date.now(),updatedAt:Date.now()};
    engine.persistSessionStateAtomic(state);await engine.approveStage({sessionId:state.sessionId,currentStage:2},()=>{});
    const wait=async()=>{for(let i=0;i<300;i++){const s=(await engine.getState({sessionId:state.sessionId}))!;if(!s.jobActive)return s;await new Promise(r=>setTimeout(r,20));}throw Error('Stage timeout');};
    let current=await wait();assert.equal(current.currentStage,3);assert.equal(current.status,'awaiting_approval');assert.ok(fs.existsSync(current.artifacts.audioPath!));
    const audio=fs.readFileSync(current.artifacts.audioPath!);before=requests.length;
    engine=new AiStudioPipelineEngine();
    await engine.approveStage({sessionId:state.sessionId,currentStage:3},()=>{});
    current=await wait();assert.equal(current.currentStage,4);assert.equal(current.status,'awaiting_approval');
    assert.equal(requests.length,before,'Restart/advance to timing must not rerun TTS');
    assert.deepEqual(fs.readFileSync(current.artifacts.audioPath!),audio);assert.equal(current.artifacts.alignmentSource,'estimated_per_line');
    fs.writeFileSync('temp/aistudio-phase2/kokoro-runtime-result.json',JSON.stringify({root,output,durationMs:result.durationMs,sampleRate:24000,channels:1,requests:requests.length,cancelledNativeProcessExited:!!nativePid,restartStage:current.currentStage,liveProvider:false,fixture:'Public speech WAV served by contract HTTP fixture; native FFmpeg/FFprobe and real engine stages 3/4'},null,2));
    console.log('PASS: Kokoro HTTP contract, actual speech fixture decoding/24kHz MP3, per-line timing, no retries/fallback, invalid audio/503/timeout/cancel old-output safety, stage3 and restart->stage4 without re-synthesis. NOT synthesis Live.');
  } finally {server.closeAllConnections();await new Promise<void>(r=>server.close(()=>r()));}
}
main().catch(error=>{console.error(error);process.exitCode=1;});
