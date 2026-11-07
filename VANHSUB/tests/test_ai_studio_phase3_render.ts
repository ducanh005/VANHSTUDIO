import assert from 'node:assert/strict';import fs from 'node:fs';import os from 'node:os';import path from 'node:path';import {getEventListeners} from 'node:events';
import {AiStudioVideoAssembler} from '../main/ai-studio/services/AiStudioVideoAssembler';import {DEFAULT_AI_STUDIO_CONFIG} from '../main/ai-studio/types';
import {execFileSync} from 'node:child_process';import ffmpeg from '@ffmpeg-installer/ffmpeg';import sharp from 'sharp';
async function main(){
 const input=JSON.parse(fs.readFileSync('temp/aistudio-phase3/long-input.json','utf8')),root=fs.mkdtempSync(path.join(os.tmpdir(),'studio-phase3-render-'));
 const assembler=new AiStudioVideoAssembler(),controller=new AbortController(),old=path.join(root,'prior-completed.mp4');fs.writeFileSync(old,'Existing output must survive a later failed candidate');const bytes=fs.readFileSync(old);
 const scene:any={id:'scene',lineIndex:0,startMs:0,endMs:input.durationMs,durationMs:input.durationMs,lineText:'Giọng Việt thật',visualPrompt:'Original diagram',motionType:'ken_burns',assetPath:input.images[0],status:'ready'};
 const options:any={scenes:[scene],voiceoverAudioPath:input.audio,outputPath:path.join(root,'new-candidate.mp4'),renderingConfig:{...DEFAULT_AI_STUDIO_CONFIG.rendering,resolution:'720p',fps:30},subtitleConfig:{...DEFAULT_AI_STUDIO_CONFIG.subtitles,enabled:false},aspectRatio:'16:9'};
 await assert.rejects(()=>assembler.assembleVideo({...options,scenes:[scene,{...scene,id:'missing',assetPath:path.join(root,'missing.png')}] }),/thiếu|không tồn tại|Media/i);
 const corrupt=path.join(root,'corrupt.png');fs.writeFileSync(corrupt,'Not a decodable image');await assert.rejects(()=>assembler.assembleVideo({...options,scenes:[{...scene,assetPath:corrupt}]}));
 const before=new AbortController();before.abort();await assert.rejects(()=>assembler.assembleVideo({...options,signal:before.signal}));assert.equal(getEventListeners(before.signal,'abort').length,0);
 let pid=0;
 await assert.rejects(()=>assembler.assembleVideo({...options,signal:controller.signal,onRegisterProcess:(cmd:any)=>cmd.on('start',()=>{pid=cmd.ffmpegProc?.pid||0;setTimeout(()=>controller.abort(),150);})}),/hủy/);
 assert.ok(pid>0);assert.equal(getEventListeners(controller.signal,'abort').length,0);
 const deadline=Date.now()+2000;let alive=true;while(Date.now()<deadline){try{process.kill(pid,0);}catch{alive=false;break;}await new Promise(r=>setTimeout(r,50));}assert.equal(alive,false,'Owned FFmpeg must exit before acceptance');assert.deepEqual(fs.readFileSync(old),bytes);
 // Non-frame-aligned cuts exposed accumulated ceil/centisecond rounding in long projects.
 const short=path.join(root,'real-vietnamese-short.wav');execFileSync(ffmpeg.path,['-v','error','-i',input.audio,'-t','10.34',short],{windowsHide:true});
 const cuts=Array.from({length:20},(_,i)=>({...scene,id:`cut_${i}`,startMs:i*517,endMs:(i+1)*517,durationMs:517,assetPath:input.images[i%2?11:0]}));
 const sequence=path.join(root,'fractional-cuts.mp4');await assembler.assembleVideo({...options,scenes:cuts,voiceoverAudioPath:short,outputPath:sequence,renderingConfig:{...options.renderingConfig,kenBurnsEffect:false}});
 const frame=execFileSync(ffmpeg.path,['-v','error','-ss','9.366667','-i',sequence,'-frames:v','1','-f','image2pipe','-vcodec','png','pipe:1'],{windowsHide:true,maxBuffer:4*1024*1024});
 const region={left:80,top:90,width:1100,height:280},actual=await sharp(frame).extract(region).removeAlpha().raw().toBuffer();
 const distance=async(file:string)=>{const ref=await sharp(file).extract(region).removeAlpha().raw().toBuffer();let sum=0;for(let i=0;i<actual.length;i++)sum+=Math.abs(actual[i]-ref[i]);return sum/actual.length;};
 const correct=await distance(input.images[0]),previous=await distance(input.images[11]);assert.ok(correct<2&&correct<previous/2,`Cumulative cut drift: correct=${correct}, previous=${previous}`);
 fs.writeFileSync('temp/aistudio-phase3/render-guard-result.json',JSON.stringify({missingMediaRejected:true,corruptMediaRejected:true,preAbortRejected:true,ownedFfmpegExited:true,abortListeners:0,priorOutputPreserved:true,fractionalCuts:20,lateCutCorrectFrame:true,correctFrameMae:correct,previousFrameMae:previous},null,2));console.log('PASS: missing/corrupt media, pre-abort, native FFmpeg cancellation, owned-process exit, prior output preservation and 20 fractional-duration scene cuts without cumulative drift.');
}
main().catch(e=>{console.error(e);process.exitCode=1;});
