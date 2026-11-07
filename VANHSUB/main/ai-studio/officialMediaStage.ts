import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import {studioMediaReadiness,officialCapabilityIssue} from '../../shared/officialMediaConfig';
import {decodeImageDimensions,fullDecodeMediaWithFfmpeg} from '../browser-automation/mediaValidator';
import {VisualProviderRouter,VisualGenerationRequest} from './providers/VisualProviderRouter';
import {selectVisualJobs,VisualRunMode} from './visualJobs';
import {invalidateSessionArtifacts} from './sessionArtifacts';
import type {AiStudioConfig,PipelineSessionState,StoryboardScene} from './types';
import type {AiStudioDiskStorageManager} from './storage/AiStudioDiskStorageManager';

const sha=(value:Buffer|string)=>crypto.createHash('sha256').update(value).digest('hex');
function ownFile(file:string,session:PipelineSessionState) {
  const absolute=fs.realpathSync(file);
  const roots=[session.workspaceDir,session.mediaDir].filter((p):p is string=>!!p&&fs.existsSync(p)).map(p=>fs.realpathSync(p));
  if(!roots.some(root=>{const rel=path.relative(root,absolute);return rel!==''&&!path.isAbsolute(rel)&&rel!=='..'&&!rel.startsWith('..'+path.sep);}))throw new Error('OFFICIAL_KEYFRAME_OWNERSHIP_INVALID');
  return absolute;
}

/** Readiness uses the frozen episode settings. No network or secret fields in the result. */
export async function prepareOfficialMedia(session:PipelineSessionState,config:AiStudioConfig,storage:AiStudioDiskStorageManager,mode:VisualRunMode='resume_missing',selected:string[]=[],signal?:AbortSignal) {
  signal?.throwIfAborted();
  const readiness=studioMediaReadiness(config.flowEngine,session.ownerProjectId||session.projectId);
  if(readiness.status!=='CONFIGURATION_READY')throw new Error(`${readiness.status}: ${readiness.reasons.join(' ')}`);
  const all=session.artifacts.scenes;
  if(!Array.isArray(all)||!all.length||all.some(s=>!s||!/^[\w-]+$/.test(s.shotId||s.id))||new Set(all.map(s=>s.shotId||s.id)).size!==all.length)throw new Error('OFFICIAL_STORYBOARD_INVALID');
  for(const scene of all){const p=scene.mediaProvenance;if(p?.source==='official_api'){
    if(p.sessionId!==session.sessionId||p.projectId!==(session.ownerProjectId||session.projectId)||p.sceneId!==(scene.shotId||scene.id))throw new Error('OFFICIAL_ARTIFACT_OWNERSHIP_INVALID');
    if(scene.assetPath===p.assetPath&&fs.existsSync(p.assetPath)&&sha(fs.readFileSync(p.assetPath))!==p.sha256)throw new Error('OFFICIAL_ARTIFACT_HASH_CHANGED');
  }}
  const jobs=selectVisualJobs(all,mode,selected),requests:Array<{scene:StoryboardScene;req:VisualGenerationRequest}>=[];
  fs.mkdirSync(storage.paths.mediaDir,{recursive:true});
  const probe=path.join(storage.paths.mediaDir,`.official-write-probe-${crypto.randomUUID()}`);
  try{fs.writeFileSync(probe,'write probe',{flag:'wx'});}finally{if(fs.existsSync(probe))fs.unlinkSync(probe);}
  const receiptDir=path.join(session.workspaceDir!,'.official-receipts');fs.mkdirSync(receiptDir,{recursive:true});
  for(const scene of jobs) {
    signal?.throwIfAborted();
    if(typeof scene.visualPrompt!=='string'||!scene.visualPrompt.trim()||scene.visualPrompt.length>12000||!Number.isFinite(scene.durationMs)||scene.durationMs<=0)throw new Error('OFFICIAL_SCENE_PROMPT_OR_TIMING_INVALID');
    const task=scene.motionType==='video'?(config.flowEngine.officialVideoMode||'t2v'):'t2i';
    const model=task==='t2i'?config.flowEngine.officialImageModel:config.flowEngine.officialVideoModel;
    let referenceImage:string|undefined,referenceHash:string|undefined;
    if(task==='i2v') {
      if(!scene.imagePath)throw new Error('BLOCKED: I2V thiếu keyframe của scene. Hãy nhập ảnh riêng cho scene trước.');
      referenceImage=ownFile(scene.imagePath,session);
      const bytes=fs.readFileSync(referenceImage);if(bytes.length>20*1024*1024||!['png','jpeg'].includes(decodeImageDimensions(bytes).format))throw new Error('OFFICIAL_KEYFRAME_INVALID');
      const decoded=await fullDecodeMediaWithFfmpeg(referenceImage);if(!decoded.fullyDecoded)throw new Error('OFFICIAL_KEYFRAME_DECODE_FAILED');
      signal?.throwIfAborted();
      referenceHash=sha(bytes);
      if(scene.mediaProvenance?.assetPath===scene.imagePath&&scene.mediaProvenance.sha256!==referenceHash)throw new Error('OFFICIAL_KEYFRAME_HASH_CHANGED');
      if(scene.mediaProvenance && (scene.mediaProvenance.sessionId!==session.sessionId||scene.mediaProvenance.sceneId!==(scene.shotId||scene.id)||scene.mediaProvenance.projectId!==(session.ownerProjectId||session.projectId)))throw new Error('OFFICIAL_KEYFRAME_PROVENANCE_OWNERSHIP_INVALID');
    }
    const negatives=scene.negativePrompt||config.flowEngine.negativePrompt;
    const prompt=[scene.visualPrompt,task!=='t2i'&&scene.motionPrompt?'Motion: '+scene.motionPrompt:'',negatives?'Avoid: '+negatives:''].filter(Boolean).join('\n');
    if(prompt.length>12000)throw new Error('OFFICIAL_PROMPT_TOO_LONG');
    const req:VisualGenerationRequest={idempotencyKey:'',mediaType:task==='t2i'?'image':'video',model,task,prompt,aspectRatio:config.flowEngine.aspectRatio,resolution:'720p',expectedDurationSec:scene.durationMs/1000,allowTimelineTrim:config.flowEngine.officialAllowTrim===true,referenceImage,referenceHash,projectId:session.ownerProjectId||session.projectId,sessionId:session.sessionId,sceneId:scene.shotId||scene.id,apiKey:config.flowEngine.apiKey,receiptDir,requestLimit:config.flowEngine.officialRequestLimit};
    const issue=officialCapabilityIssue(req);if(issue)throw new Error(issue);
    req.idempotencyKey=sha(JSON.stringify([session.sessionId,req.projectId,req.sceneId,model,task,req.prompt,req.aspectRatio,referenceHash,scene.officialGenerationNonce||config.flowEngine.generationNonce||'initial']));
    req.targetPath=path.join(storage.paths.mediaDir,`${req.sceneId}_official_${req.idempotencyKey.slice(0,24)}.${req.mediaType==='image'?'png':'mp4'}`);
    requests.push({scene,req});
  }
  const used=fs.readdirSync(receiptDir).filter(n=>n.endsWith('.operation.json')).length;
  for(const {req} of requests){const file=path.join(receiptDir,`${req.idempotencyKey}.operation.json`);if(fs.existsSync(file)){
    const records=fs.readFileSync(file,'utf8').split('\n').flatMap(line=>{try{return[JSON.parse(line)];}catch{return[];}});
    if(records.at(-1)?.state!=='COMPLETED'&&!fs.existsSync(file+'.response.json')&&!records.some(r=>r.interactionId))throw new Error('BLOCKED: submission chưa xác định, cần đối soát; không POST lại.');
  }}
  for(const {req} of requests)for(const name of fs.readdirSync(receiptDir).filter(n=>n.endsWith('.operation.json')&&n!==`${req.idempotencyKey}.operation.json`)){
    const records=fs.readFileSync(path.join(receiptDir,name),'utf8').split('\n').flatMap(line=>{try{return[JSON.parse(line)];}catch{return[];}});
    if(records[0]?.sceneId===req.sceneId&&records.at(-1)?.state!=='COMPLETED')throw new Error('BLOCKED: scene có submission chưa đối soát. Không dùng generation mới để vượt receipt cũ.');
  }
  const needed=requests.filter(({req})=>!fs.existsSync(path.join(receiptDir,`${req.idempotencyKey}.operation.json`))).length;
  if(used+needed>config.flowEngine.officialRequestLimit!)throw new Error(`BLOCKED: giới hạn request episode không đủ (${used} đã giữ chỗ + ${needed} mới / ${config.flowEngine.officialRequestLimit}). Không gửi request.`);
  return {readiness,requests,used,needed};
}

/** Called inside the existing stage/session lease. Every scene checkpoint follows full validation. */
export async function runOfficialMediaStage(session:PipelineSessionState,config:AiStudioConfig,storage:AiStudioDiskStorageManager,signal:AbortSignal,persist:()=>void,mode:VisualRunMode='resume_missing',selected:string[]=[],progress?:(percent:number)=>void) {
  const plan=await prepareOfficialMedia(session,config,storage,mode,selected,signal);signal.throwIfAborted();
  for(let index=0;index<plan.requests.length;index++) {
    const{scene,req}=plan.requests[index];req.signal=signal;
    const result=await VisualProviderRouter.getInstance().generateOfficial(req);signal.throwIfAborted();
    if(result.state!=='COMPLETED'||!result.sha256||!result.mediaInfo||!result.model||sha(fs.readFileSync(result.localPath))!==result.sha256)throw new Error('OFFICIAL_ARTIFACT_INTEGRITY_FAILED');
    if(req.mediaType==='video'&&result.mediaInfo.durationSec!<scene.durationMs/1000-0.08&&scene.fillMode!=='freeze_last_frame')throw new Error('TIMELINE_DURATION_MISMATCH: generated clip quá ngắn; đã giữ receipt/output. Chọn fill mode rõ ràng hoặc media khác, không tự generation lại.');
    if(req.mediaType==='video'&&result.mediaInfo.durationSec!>scene.durationMs/1000+0.08&&req.allowTimelineTrim!==true)throw new Error('TIMELINE_DURATION_MISMATCH: clip dài hơn scene; cần cho phép trim rõ ràng. Đã giữ receipt/output, không tự generation lại.');
    scene.officialTrimAllowed=req.mediaType==='video'&&req.allowTimelineTrim===true;
    invalidateSessionArtifacts(session,7);
    scene.assetPath=result.localPath;scene.status='ready';delete scene.error;
    if(req.mediaType==='image'){scene.imagePath=result.localPath;delete scene.videoPath;}else{scene.videoPath=result.localPath;scene.originalMediaDurationSec=result.mediaInfo.durationSec;}
    scene.mediaProvenance={source:'official_api',provider:'official_gemini_api',model:result.model,task:req.task!,assetPath:result.localPath,sha256:result.sha256,sessionId:session.sessionId,sceneId:req.sceneId!,projectId:req.projectId!,requestKey:req.idempotencyKey,requestId:result.operationId,referenceSha256:result.referenceHash,generatedAt:new Date().toISOString(),automaticGeneration:true,...result.mediaInfo};
    const sceneId=scene.sceneId||((scene.shotId||scene.id).includes('_shot_')?(scene.shotId||scene.id).split('_shot_')[0]:scene.id);
    storage.updateShotMetadata(sceneId,scene.shotId||scene.id,{[req.mediaType==='image'?'image_path':'video_path']:result.localPath,status:req.mediaType==='image'?'image_ready':'video_ready'});
    persist();progress?.(55+Math.round((index+1)/plan.requests.length*30));
  }
}
