import fs from 'fs';import path from 'path';import crypto from 'crypto';import {execFile} from 'child_process';
import ffmpeg from '@ffmpeg-installer/ffmpeg';import ffprobe from '@ffprobe-installer/ffprobe';
import type {APIRequestContext} from 'playwright-core';
import {detectFormatFromBuffer,decodeImageDimensions} from './mediaValidator';

export function assertFlowCdnUrl(url:string){
  const u=new URL(url);if(u.protocol!=='https:'||u.username||u.password||!['flow-content.google','flow.google.com','googleusercontent.com','googleapis.com','gstatic.com'].some(h=>u.hostname===h||u.hostname.endsWith('.'+h)))throw Error('FLOW_DOWNLOAD_URL_UNTRUSTED');return u;
}
const bin=(f:string)=>f.replace(/app\.asar([\\/])/,'app.asar.unpacked$1');
async function run(file:string,args:string[],signal?:AbortSignal){return await new Promise<string>((resolve,reject)=>{execFile(bin(file),args,{windowsHide:true,timeout:30000,maxBuffer:1024*1024,signal},(error,stdout)=>error?reject(Error(signal?.aborted?'FLOW_CANCELLED':'FLOW_NATIVE_VALIDATION_FAILED')):resolve(stdout));});}
/** Complete validation before exclusive atomic publication; never normalize by overwriting an old file. */
export async function saveFlowImage(request:APIRequestContext,url:string,outputPath:string,signal?:AbortSignal,beforePublish?:(artifact:{localPath:string;sha256:string})=>Promise<void>){
  assertFlowCdnUrl(url);signal?.throwIfAborted();fs.mkdirSync(path.dirname(outputPath),{recursive:true});
  // APIRequestContext has no per-request AbortSignal. Detach promptly on cancellation and
  // dispose its late response; the shared browser context is never disposed or copied.
  const pending=request.get(url,{timeout:30000,maxRedirects:0});let aborted=false,rejectCancelled:(e:Error)=>void=()=>{};
  const cancelled=new Promise<never>((_,reject)=>{rejectCancelled=reject;});
  const stop=()=>{aborted=true;rejectCancelled(Error('FLOW_CANCELLED'));};signal?.addEventListener('abort',stop,{once:true});if(signal?.aborted)stop();
  let response:any,tmp:string|undefined;
  try{
    response=await (signal?Promise.race([pending,cancelled]):pending);signal?.throwIfAborted();if(!response.ok())throw Error('FLOW_DOWNLOAD_FAILED');
    const headers=response.headers(),declared=Number(headers['content-length']||0);if(declared>128*1024*1024)throw Error('FLOW_DOWNLOAD_SIZE_INVALID');
    const bytes=await response.body();signal?.throwIfAborted();if(bytes.length<64||bytes.length>128*1024*1024)throw Error('FLOW_DOWNLOAD_SIZE_INVALID');
    const detected=detectFormatFromBuffer(bytes),mime=(headers['content-type']||'').split(';')[0].trim().toLowerCase();
    if(!['png','jpeg','webp','gif'].includes(detected.format)||(mime&&mime!=='application/octet-stream'&&mime!==detected.mimeType&&!(mime==='image/jpg'&&detected.format==='jpeg')))throw Error('FLOW_IMAGE_MIME_OR_MAGIC_INVALID');
    const dimensions=decodeImageDimensions(bytes);if(dimensions.width<200||dimensions.height<200)throw Error('FLOW_IMAGE_DIMENSIONS_INVALID');
    const finalPath=outputPath.replace(/\.[^.\\/]+$/,'')+detected.extension;if(fs.existsSync(finalPath))throw Error('FLOW_OUTPUT_EXISTS');
    tmp=path.join(path.dirname(finalPath),'.flow-'+crypto.randomUUID()+'.pending'+detected.extension);
    const fd=fs.openSync(tmp,'wx');try{fs.writeFileSync(fd,bytes);fs.fsyncSync(fd);}finally{fs.closeSync(fd);}
    const probe=JSON.parse(await run(ffprobe.path,['-v','error','-show_streams','-of','json',tmp],signal));
    if(!probe.streams?.some((s:any)=>s.codec_type==='video'&&s.width===dimensions.width&&s.height===dimensions.height))throw Error('FLOW_IMAGE_PROBE_INVALID');
    await run(ffmpeg.path,['-v','error','-i',tmp,'-f','null','-'],signal);signal?.throwIfAborted();
    const sha256=crypto.createHash('sha256').update(bytes).digest('hex');await beforePublish?.({localPath:finalPath,sha256});signal?.throwIfAborted();
    fs.linkSync(tmp,finalPath);return {localPath:finalPath,sha256,width:dimensions.width,height:dimensions.height,mimeType:detected.mimeType};
  }finally{
    signal?.removeEventListener('abort',stop);if(response)await response.dispose();else if(aborted)pending.then(r=>r.dispose()).catch(()=>{});
    if(tmp&&fs.existsSync(tmp))fs.unlinkSync(tmp);
  }
}
