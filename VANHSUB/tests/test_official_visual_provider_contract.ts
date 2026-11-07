/** Transport fixtures with real FFmpeg media; never claims Google Live success. */
import assert from 'node:assert/strict';import fs from 'node:fs';import os from 'node:os';import path from 'node:path';import {execFileSync} from 'node:child_process';import crypto from 'node:crypto';
import ffmpeg from '@ffmpeg-installer/ffmpeg';import {OfficialGeminiVisualProvider,OFFICIAL_IMAGE_MODEL,OFFICIAL_VIDEO_MODEL} from '../main/ai-studio/providers/OfficialGeminiVisualProvider';import type {VisualGenerationRequest} from '../main/ai-studio/providers/VisualProviderRouter';
async function main(){
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'official-phase5-')),imageFile=path.join(root,'reference.png'),videoFile=path.join(root,'native.mp4');
 execFileSync(ffmpeg.path,['-v','error','-f','lavfi','-i','color=c=teal:s=1280x720','-frames:v','1',imageFile],{windowsHide:true});
 execFileSync(ffmpeg.path,['-v','error','-f','lavfi','-i','color=c=teal:s=1280x720:r=24','-t','3','-c:v','libx264','-threads','2','-pix_fmt','yuv420p',videoFile],{windowsHide:true});
 const image=fs.readFileSync(imageFile),video=fs.readFileSync(videoFile);let posts=0,gets=0;
 const req=(id:string,videoMode=false):VisualGenerationRequest=>({idempotencyKey:id,mediaType:videoMode?'video':'image',model:videoMode?OFFICIAL_VIDEO_MODEL:OFFICIAL_IMAGE_MODEL,task:videoMode?'t2v':'t2i',prompt:'Fixture only: original diagram',aspectRatio:'16:9',targetPath:path.join(root,id+(videoMode?'.mp4':'.png')),apiKey:'synthetic-key',projectId:'project',sessionId:'session',sceneId:id});
 const completed=(output:any)=>({id:'fixture_interaction',status:'completed',model:OFFICIAL_VIDEO_MODEL,steps:[{type:'model_output',content:[{type:'video',mime_type:'video/mp4',...output}]}]});
 const transport=(async(url:any,options:any)=>{assert.equal(options.headers['x-goog-api-key'],'synthetic-key');assert.equal(options.redirect,'error');assert.ok(!String(url).includes('synthetic-key'));
  if(options.method==='POST'){posts++;const body=JSON.parse(options.body);if(String(url).endsWith(':generateContent')){assert.equal(body.contents[0].parts[0].text,'Fixture only: original diagram');return Response.json({responseId:'fixture_image',candidates:[{content:{parts:[{inlineData:{mimeType:'image/png',data:image.toString('base64')}}]}}]});}
   assert.equal(String(url),'https://generativelanguage.googleapis.com/v1beta/interactions');assert.equal(body.model,OFFICIAL_VIDEO_MODEL);assert.equal(body.response_format.resolution,'720p');assert.equal(body.response_format.delivery,'uri');assert.equal(body.store,true);assert.equal(body.stream,false);assert.equal(body.background,false);assert.ok(!body.instances&&!body.parameters&&!body.durationSeconds);
   if(Array.isArray(body.input)){assert.equal(body.input[0].type,'image');assert.equal(body.input[0].mime_type,'image/png');assert.equal(body.input[0].data,image.toString('base64'));}
   return Response.json(completed({data:video.toString('base64')}));
  }gets++;if(String(url).includes(':download'))return new Response(video,{headers:{'Content-Type':'video/mp4'}});if(String(url).includes('/files/'))return Response.json({state:'ACTIVE'});return Response.json(completed({data:video.toString('base64')}));
 }) as typeof fetch;
 const provider=new OfficialGeminiVisualProvider(transport),imageReq=req('image');const first=await provider.generate(imageReq);assert.equal(first.sha256,crypto.createHash('sha256').update(image).digest('hex'));await new OfficialGeminiVisualProvider(transport).generate(imageReq);assert.equal(posts,1,'Restart recovery must not charge again');
 const t2v=await provider.generate(req('text-video',true));assert.equal(t2v.mediaInfo?.fps,24);assert.equal(t2v.mediaInfo?.durationSec,3);
 const i2v=await provider.generate({...req('image-video',true),task:'i2v',referenceImage:imageFile});assert.equal(i2v.referenceHash,first.sha256);
 const uriProvider=new OfficialGeminiVisualProvider((async(url:any,options:any)=>options.method==='POST'?(posts++,Response.json(completed({uri:'https://generativelanguage.googleapis.com/v1beta/files/fixture:download?alt=media'}))):transport(url,options)) as typeof fetch);
 assert.equal((await uriProvider.generate(req('uri-video',true))).state,'COMPLETED');assert.ok(gets>=2);
 for(const status of [401,403,429,500]){let attempts=0;const p=new OfficialGeminiVisualProvider((async()=>{attempts++;return Response.json({error:{message:'Do not log provider payload'}},{status});}) as typeof fetch),r=req('http-'+status);await assert.rejects(()=>p.generate(r),new RegExp('HTTP_'+status));await assert.rejects(()=>p.generate(r),/NO_RESUBMIT/);assert.equal(attempts,1);}
 let timeoutPosts=0;const timeout=new OfficialGeminiVisualProvider((async()=>{timeoutPosts++;throw Error('Timeout: synthetic-key');}) as typeof fetch),uncertain=req('timeout');await assert.rejects(()=>timeout.generate(uncertain),e=>e instanceof Error&&/UNCERTAIN/.test(e.message)&&!e.message.includes('synthetic-key'));await assert.rejects(()=>timeout.generate(uncertain),/NO_RESUBMIT/);assert.equal(timeoutPosts,1);
 const before=posts;for(const r of [{...req('old-model',true),model:'veo-3.1-fast-generate-preview'},{...req('fps',true),fps:30} as any,{...req('duration',true),durationSeconds:4},{...req('missing-keyframe',true),task:'i2v' as const},{...req('bad-aspect'),aspectRatio:'1:1'},{...req('long-video',true),expectedDurationSec:11}])await assert.rejects(()=>provider.generate(r));assert.equal(posts,before);
 const bad=(data:any)=>new OfficialGeminiVisualProvider((async()=>Response.json(data)) as typeof fetch);
 await assert.rejects(()=>bad({output_video:{data:video.toString('base64')}}).generate(req('sdk-only',true)),/STATUS/);
 await assert.rejects(()=>bad(completed({uri:'https://evil.invalid/video'})).generate(req('host',true)),/UNTRUSTED_MEDIA_URI/);
 await assert.rejects(()=>bad(completed({data:'not base64'})).generate(req('base64',true)),/BASE64/);
 await assert.rejects(()=>bad(completed({data:image.toString('base64')})).generate(req('mime',true)),/MIME_MAGIC/);
 const truncated=video.subarray(0,100);await assert.rejects(()=>bad(completed({data:truncated.toString('base64')})).generate(req('corrupt',true)));assert.ok(!fs.existsSync(req('corrupt',true).targetPath!));
 // Documented model contract: 3–10 seconds at 24 FPS; input scene trimming requires consent.
 await assert.rejects(()=>provider.generate({...req('short-scene',true),expectedDurationSec:1.5}),/UNSUPPORTED/);
 await provider.generate({...req('short-scene-trim',true),expectedDurationSec:1.5,allowTimelineTrim:true});
 for(const [id,duration,rate] of [['short-output',2,24],['wrong-rate',3,30],['long-output',11,24]] as const){
   const f=path.join(root,id+'.fixture.mp4');execFileSync(ffmpeg.path,['-v','error','-f','lavfi','-i',`color=c=teal:s=1280x720:r=${rate}`,'-t',String(duration),'-c:v','libx264','-threads','2','-pix_fmt','yuv420p',f],{windowsHide:true});
   await assert.rejects(()=>bad(completed({data:fs.readFileSync(f).toString('base64')})).generate(req(id,true)),/CAPABILITY_MISMATCH/);assert.ok(!fs.existsSync(req(id,true).targetPath!));
 }
 const aborted=new AbortController();aborted.abort();const prior=posts;await assert.rejects(()=>provider.generate({...req('pre-abort'),signal:aborted.signal}));assert.equal(posts,prior);
 // A known interaction may be GET-polled after cancellation; never POST it again.
 const cancel=new AbortController();let cancelPosts=0,cancelGets=0;
 const pending=new OfficialGeminiVisualProvider((async(_url:any,options:any)=>{if(options.method==='POST'){cancelPosts++;setTimeout(()=>cancel.abort(),20);return Response.json({id:'pending_fixture',status:'in_progress'});}cancelGets++;return Response.json(completed({data:video.toString('base64')}));}) as typeof fetch);
 const pendingReq=req('pending',true);await assert.rejects(()=>pending.generate({...pendingReq,signal:cancel.signal}),/CANCELLED/);await pending.generate(pendingReq);assert.equal(cancelPosts,1);assert.equal(cancelGets,1);
 const budgetDir=path.join(root,'budget');await provider.generate({...req('budget-one'),receiptDir:budgetDir,requestLimit:1});const budgetPosts=posts;await assert.rejects(()=>provider.generate({...req('budget-two'),receiptDir:budgetDir,requestLimit:1}),/BUDGET_EXHAUSTED/);assert.equal(posts,budgetPosts);
 const original=fs.readFileSync(first.localPath);fs.writeFileSync(first.localPath,'User replacement');await assert.rejects(()=>provider.generate(imageReq),/OUTPUT_ALREADY_EXISTS/);assert.equal(fs.readFileSync(first.localPath,'utf8'),'User replacement');fs.writeFileSync(first.localPath,original);
 for(const name of fs.readdirSync(root).filter(n=>n.endsWith('.operation.json')))assert.ok(!fs.readFileSync(path.join(root,name),'utf8').includes('synthetic-key'));
 fs.writeFileSync((process.env.VANHSUB_UAT_EVIDENCE_DIR||'temp/aistudio-phase5')+'/contract-result.json',JSON.stringify({root,imageFile,videoFile,transportFixture:true,liveProvider:false,models:[OFFICIAL_IMAGE_MODEL,OFFICIAL_VIDEO_MODEL],t2i:true,t2v:true,i2vExactReference:true,uri:true,quotaNoRetry:true,uncertainNoResubmit:true,pollAfterCancel:true,budgetEnforced:true,mimeDecodeAndOwnershipSafety:true},null,2));
 console.log('PASS: migrated Interactions REST schema, T2I/T2V/I2V/URI with native media, 401/403/429/500, timeout/cancel/restart no duplicate POST, capability/MIME/decode/budget/output guards. Transport fixture, NOT Live.');
}
main().catch(e=>{console.error(e);process.exitCode=1;});
