import assert from 'node:assert/strict';
import fs from 'node:fs';import os from 'node:os';import path from 'node:path';
import http from 'node:http';import {once,getEventListeners} from 'node:events';
import {AiStudioLlmService} from '../main/ai-studio/services/AiStudioLlmService';
import {AiStudioTtsService} from '../main/ai-studio/services/AiStudioTtsService';
import {stageApprovalIssue} from '../shared/studioStageReadiness';
import {validateIpcPayload} from '../main/security/ipcPayload';

async function main(){
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'studio-phase3-core-'));
  process.env.VANHSUB_AI_STUDIO_DIR=path.join(root,'config');process.env.VANHSUB_BIBLE_DIR=path.join(root,'bible');process.env.VANHSUB_ALLOW_INSECURE_TEST_SECRETS='1';
  let content:any={lines:[{text:'Một câu hợp lệ.'},{text:'Một câu thứ hai.'},{text:'Một câu kết thúc.'}]},calls=0;
  const server=http.createServer(async(req,res)=>{for await(const _ of req){}calls++;res.setHeader('Content-Type','application/json');res.end(JSON.stringify({choices:[{message:{content:typeof content==='string'?content:JSON.stringify(content)}}]}));});
  server.listen(0,'127.0.0.1');await once(server,'listening');
  const config:any={provider:'custom',apiKey:'synthetic-only',baseUrl:`http://127.0.0.1:${(server.address() as any).port}/v1`,model:'fixture',temperature:0.6};
  const llm=new AiStudioLlmService();
  try{
    assert.equal((await llm.generateScript('Fixture',config)).length,3);
    for(const bad of [{lines:[{text:''},{text:''},{text:''}]},{lines:[{text:4},{text:'A'},{text:'B'}]},{wrong:'schema'},'```json\n{not:valid\n```']){
      content=bad;await assert.rejects(()=>llm.generateScript('Fixture',config),/schema|hợp lệ/);
    }
    content={title:'Invalid'};await assert.rejects(()=>llm.generateSeoMetadata('Fixture',[],config),/SEO/);
    await assert.rejects(()=>llm.generateSeoMetadata('Fixture',[],{provider:'gemini_web'} as any),/adapter SEO/);
    content={title:'Tiêu đề SEO hợp lệ',description:'Mô tả được cung cấp bởi HTTP fixture nhằm kiểm tra schema, không phải LLM thật.',hashtags:['#test','#schema','#offline'],thumbnailPrompt:'An original timeline illustration for an offline technical test.'};
    assert.equal((await llm.generateSeoMetadata('Fixture',[],config)).title,content.title);
    const timeout=new AiStudioLlmService();(timeout as any).createClient=()=>({model:'fixture',client:{chat:{completions:{create:async()=>{throw Error('Provider timeout synthetic-only');}}}}});
    await assert.rejects(()=>timeout.generateScript('Fixture',config),error=>error instanceof Error&&error.message.includes('timeout')&&!error.message.includes(config.apiKey));
    const tts=new AiStudioTtsService();tts.setTikTokProvider({hasSession:()=>false} as any);
    await assert.rejects(()=>tts.synthesizeSingleSpeechChunk('Xin chào','BV074_streaming',{},path.join(root,'never.mp3'),undefined,'tiktok_tts'),/Không tự chuyển engine/);
    tts.setTikTokProvider({hasSession:()=>true,synthesize:async()=>{throw Error('Fixture provider error');}} as any);
    await assert.rejects(()=>tts.synthesizeSingleSpeechChunk('Xin chào','BV074_streaming',{},path.join(root,'never.mp3'),undefined,'tiktok_tts'),/không tự chuyển/);
    assert.equal(fs.existsSync(path.join(root,'never.mp3')),false);
    for(const stage of [2,3,4,5,6,7,8])assert.ok(stageApprovalIssue({currentStage:stage,artifacts:{}}));
    assert.equal(stageApprovalIssue({currentStage:6,artifacts:{scenes:[{id:'s',durationMs:1000,status:'ready',assetPath:'file'}]}}),null);
    validateIpcPayload('aiStudio:voices:piperStatus',[]);
    assert.throws(()=>validateIpcPayload('aiStudio:voices:piperStatus',[{runtime:'untrusted.exe'}]));
    validateIpcPayload('aiStudio:manualSeo:save',[{sessionId:'manual-fixture',title:'Title',description:'Description',hashtags:[]}]);
    assert.throws(()=>validateIpcPayload('aiStudio:manualSeo:save',[{sessionId:'manual-fixture',title:'Title',description:'Description',hashtags:[],filePath:'C:/untrusted'}]));
    const {AiStudioPipelineEngine}=await import('../main/ai-studio/AiStudioPipelineEngine');
    const {DEFAULT_AI_STUDIO_CONFIG}=await import('../main/ai-studio/types');
    const {captureSessionConfig}=await import('../main/ai-studio/sessionConfig');
    const cfg=structuredClone(DEFAULT_AI_STUDIO_CONFIG);cfg.llm.apiKey='synthetic-not-called';cfg.channelProfile.aiProvider='default';cfg.channelProfile.ttsEngine='piper_local';cfg.channelProfile.specificVoice='vi_VN-vais1000-medium';
    const seed=(id:string,stage:number)=>{const s:any={sessionId:id,topic:'Fixture',currentStage:stage,stageName:'voice',status:'awaiting_approval',gatedMode:true,
      configSnapshot:captureSessionConfig(cfg),workspaceDir:path.join(root,id),mediaDir:path.join(root,id,'media'),stages:{[stage]:{status:'success'}},artifacts:{},createdAt:1,updatedAt:1};return s;};
    let engine=new AiStudioPipelineEngine();
    for(const stage of [3,4,5,6,7,8]){const s=seed(`invalid-${stage}`,stage);engine.persistSessionStateAtomic(s);const f=path.join(s.workspaceDir,'session.json'),before=fs.readFileSync(f);await assert.rejects(()=>engine.approveStage({sessionId:s.sessionId,currentStage:stage as any},()=>{}));assert.deepEqual(fs.readFileSync(f),before);}
    const voice:any={provider:'piper_local',voiceId:'vi_VN-vais1000-medium',rate:'+0%',pitch:'+0Hz',volume:'+0%',autoWordAlignment:true};
    const old=path.join(root,'old.mp3');fs.writeFileSync(old,'Completed previous output');const lines:any[]=[{id:'vi',index:1,text:'Không được làm mất âm thanh đã hoàn thành khi người dùng hủy tác vụ.'}];const oldLines=structuredClone(lines);
    const abort=new AbortController();const pending=tts.synthesizeVoiceover(lines,voice,old,abort.signal);setTimeout(()=>abort.abort(),300);
    await assert.rejects(()=>pending);assert.equal(fs.readFileSync(old,'utf8'),'Completed previous output');assert.deepEqual(lines,oldLines);assert.equal(getEventListeners(abort.signal,'abort').length,0);
    const real=seed('piper-stage3',2);real.artifacts.scriptLines=[{id:'vi',index:1,text:'Tiếng Việt cần được kiểm tra bằng âm thanh thật.'}];engine.persistSessionStateAtomic(real);
    await engine.approveStage({sessionId:real.sessionId,currentStage:2},()=>{});
    const settled=async()=>{for(let i=0;i<1000;i++){const s=(await engine.getState({sessionId:real.sessionId}))!;if(!s.jobActive)return s;await new Promise(r=>setTimeout(r,25));}throw Error('Piper stage timed out');};
    let current=await settled();assert.equal(current.currentStage,3);assert.equal(current.status,'awaiting_approval');const audio=fs.readFileSync(current.artifacts.audioPath!);
    engine=new AiStudioPipelineEngine();const start=Date.now();await engine.approveStage({sessionId:real.sessionId,currentStage:3},()=>{});current=await settled();assert.equal(current.currentStage,4);assert.equal(current.status,'awaiting_approval');assert.deepEqual(fs.readFileSync(current.artifacts.audioPath!),audio);assert.equal(current.artifacts.alignmentSource,'estimated_per_line');
    const manual=seed('manual-seo',7);manual.manualMode=true;manual.status='completed';manual.artifacts.videoPath=path.join(root,'old-video.mp4');fs.writeFileSync(manual.artifacts.videoPath,'Completed previous video');engine.persistSessionStateAtomic(manual);
    const saved=await engine.saveManualSeo({sessionId:manual.sessionId,title:'Tiêu đề nhập tay',description:'Metadata được biên soạn thủ công, không phải output provider.',hashtags:['#test']});
    assert.equal(saved.session.artifacts.metadata?.source,'manual_authored');assert.equal(saved.session.stages[8].status,'success');assert.ok(fs.existsSync(saved.metadataPath));assert.equal(fs.readFileSync(manual.artifacts.videoPath,'utf8'),'Completed previous video');
    await assert.rejects(()=>engine.saveManualSeo({sessionId:real.sessionId,title:'Not manual',description:'Cannot silently switch modes',hashtags:[]}),/chế độ/);
    fs.writeFileSync(path.join(process.env.VANHSUB_TEST_EVIDENCE_DIR || 'temp/aistudio-phase3','core-result.json'),JSON.stringify({httpFixtureCalls:calls,piperStage3:'real native synthesis',restartStage:current.currentStage,timingAdvanceMs:Date.now()-start,alignment:'estimated_per_line',cancelOldOutputPreserved:true,manualSeoSource:'manual_authored',llmLive:false},null,2));
    console.log('PASS: custom LLM HTTP fixture + invalid schema/timeout/SEO fail-closed, no TikTok fallback, artifact approval guards, native Vietnamese Piper stage3/cancel/restart->timing, manual SEO provenance. LLM fixture is NOT Live.');
  }finally{server.closeAllConnections();await new Promise<void>(r=>server.close(()=>r()));}
}
main().catch(e=>{console.error(e);process.exitCode=1;});
