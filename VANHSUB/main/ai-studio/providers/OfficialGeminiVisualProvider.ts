import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import ffmpeg from 'fluent-ffmpeg';
import ffprobeInstaller from '@ffprobe-installer/ffprobe';
import { detectFormatFromBuffer, decodeImageDimensions, fullDecodeMediaWithFfmpeg, validateVideoWithFfprobe } from '../../browser-automation/mediaValidator';
import { officialCapabilityIssue } from '../../../shared/officialMediaConfig';
import type { VisualGenerationRequest, VisualGenerationResult } from './VisualProviderRouter';

const BASE = 'https://generativelanguage.googleapis.com/v1beta';
export const OFFICIAL_IMAGE_MODEL = 'gemini-3.1-flash-image';
export const OFFICIAL_VIDEO_MODEL = 'gemini-omni-1.1-flash';
const MAX_BYTES = 64 * 1024 * 1024;
const digest = (bytes: Buffer | string) => crypto.createHash('sha256').update(bytes).digest('hex');
ffmpeg.setFfprobePath(ffprobeInstaller.path.replace('app.asar','app.asar.unpacked'));
type StoredOutput = { mime: string; data?: string; uri?: string; operationId?: string };
const validInteractionId = (id: unknown): id is string => typeof id==='string'&&id.length>0&&id.length<=2048&&!/[\u0000-\u0020\u007f]/.test(id)&&id!=='.'&&id!=='..';

/** At most one paid POST per durable receipt. Restart only polls/downloads the existing result. */
export class OfficialGeminiVisualProvider {
  constructor(private readonly request: typeof fetch = fetch,
    private readonly validate: (file: string) => Promise<void> = async file => {
      const result = await fullDecodeMediaWithFfmpeg(file);
      if (!result.fullyDecoded) throw new Error('OFFICIAL_API_MEDIA_DECODE_FAILED');
    }) {}

  async generate(input: VisualGenerationRequest): Promise<VisualGenerationResult> {
    const req = { ...input, model: input.model || (input.mediaType === 'image' ? OFFICIAL_IMAGE_MODEL : OFFICIAL_VIDEO_MODEL) };
    const issue = officialCapabilityIssue(req);
    if (issue) throw new Error(issue);
    if (!req.apiKey?.trim() || !req.targetPath || !path.isAbsolute(req.targetPath) || !/^[\w-]{1,128}$/.test(req.idempotencyKey)) throw new Error('OFFICIAL_API_CONFIG_REQUIRED');
    if (typeof req.prompt !== 'string' || !req.prompt.trim() || req.prompt.length > 12000) throw new Error('OFFICIAL_API_INVALID_PROMPT');
    req.signal?.throwIfAborted();
    const task = req.task || (req.mediaType === 'image' ? 't2i' : req.referenceImage ? 'i2v' : 't2v');
    let reference: {type:string;mime_type:string;data:string} | undefined, referenceHash: string | undefined;
    if (req.referenceImage) {
      const bytes = fs.readFileSync(req.referenceImage);
      if (bytes.length > 20 * 1024 * 1024) throw new Error('INVALID_REFERENCE_IMAGE');
      const image = decodeImageDimensions(bytes);
      if (!['png','jpeg'].includes(image.format)) throw new Error('INVALID_REFERENCE_IMAGE');
      await this.validate(req.referenceImage); req.signal?.throwIfAborted();
      referenceHash = digest(bytes);
      if (req.referenceHash && referenceHash !== req.referenceHash) throw new Error('KEYFRAME_CHANGED_SINCE_PREFLIGHT');
      reference = {type:'image',mime_type:image.mimeType,data:bytes.toString('base64')};
    }
    const receiptDir = req.receiptDir || path.dirname(req.targetPath);
    fs.mkdirSync(receiptDir,{recursive:true});
    const receipt = req.receiptDir ? path.join(receiptDir,`${req.idempotencyKey}.operation.json`) : req.targetPath+'.operation.json';
    const responseFile = receipt+'.response.json';
    const fingerprint = digest(JSON.stringify([req.model,task,req.prompt,req.motionPrompt,req.aspectRatio,req.resolution||'720p',referenceHash,req.projectId,req.sessionId,req.sceneId]));
    let records: any[] = [];
    const append = (record: object) => {const fd=fs.openSync(receipt,'a');try{fs.writeFileSync(fd,'\n'+JSON.stringify({...record,at:new Date().toISOString()}));fs.fsyncSync(fd);}finally{fs.closeSync(fd);}};
    if (fs.existsSync(receipt)) {
      for (const line of fs.readFileSync(receipt,'utf8').split('\n')) { try {records.push(JSON.parse(line));} catch {} }
      if (records[0]?.fingerprint !== fingerprint) throw new Error('OFFICIAL_API_EXISTING_SUBMISSION_REQUIRES_REVIEW');
    } else if (fs.existsSync(req.targetPath)) throw new Error('OUTPUT_ALREADY_EXISTS');
    const headers = {'x-goog-api-key':req.apiKey,'Content-Type':'application/json'};
    const signal = () => req.signal ? AbortSignal.any([req.signal,AbortSignal.timeout(180000)]) : AbortSignal.timeout(180000);
    const limited = async (response: Response, max: number) => {
      if (!response.body) throw new Error('OFFICIAL_API_EMPTY_RESPONSE');
      const chunks: Buffer[]=[];let length=0;
      for await (const raw of response.body as any) { const chunk=Buffer.from(raw);length+=chunk.length;if(length>max)throw new Error('OFFICIAL_API_RESPONSE_TOO_LARGE');chunks.push(chunk); }
      return Buffer.concat(chunks);
    };
    const json = async (url: string, body?: unknown): Promise<any> => {
      const response = await this.request(url,{method:body?'POST':'GET',headers,body:body?JSON.stringify(body):undefined,redirect:'error',signal:signal()});
      if (!response.ok) throw new Error(`OFFICIAL_API_HTTP_${response.status}`);
      const data=JSON.parse((await limited(response,96*1024*1024)).toString('utf8'));
      if (data.error) throw new Error('OFFICIAL_API_OPERATION_FAILED');
      return data;
    };
    const pause = () => new Promise<void>((resolve,reject)=>{const stop=()=>{clearTimeout(timer);req.signal?.removeEventListener('abort',stop);reject(new Error('CANCELLED'));};const timer=setTimeout(()=>{req.signal?.removeEventListener('abort',stop);resolve();},1500);req.signal?.addEventListener('abort',stop,{once:true});if(req.signal?.aborted)stop();});
    const poll = async (initial: any) => {
      let result=initial;const deadline=Date.now()+6*60_000;
      while (['in_progress','requires_action','queued'].includes(result.status)) {
        if(result.status==='requires_action')throw new Error('OFFICIAL_API_REQUIRES_RECONCILIATION');
        if(Date.now()>deadline)throw new Error('OFFICIAL_API_TIMEOUT_POLL_EXISTING_INTERACTION');
        if(!validInteractionId(result.id))throw new Error('OFFICIAL_API_INVALID_INTERACTION_ID');
        await pause();result=await json(`${BASE}/interactions/${encodeURIComponent(result.id)}`);
      }
      return result;
    };
    let output: StoredOutput;
    try {
      if (fs.existsSync(responseFile)) output=JSON.parse(fs.readFileSync(responseFile,'utf8'));
      else {
        let response: any;
        const submitted = [...records].reverse().find(r=>r.interactionId);
        if(records.length && !submitted)throw new Error('OFFICIAL_API_RECONCILIATION_REQUIRED_NO_RESUBMIT');
        if(submitted) response=await poll(await json(`${BASE}/interactions/${encodeURIComponent(submitted.interactionId)}`));
        else {
          if (req.receiptDir && (!Number.isInteger(req.requestLimit)||req.requestLimit!<1||req.requestLimit!>20)) throw new Error('OFFICIAL_API_REQUEST_BUDGET_REQUIRED');
          if(req.receiptDir && fs.readdirSync(receiptDir).filter(name=>name.endsWith('.operation.json')).length>=req.requestLimit!)throw new Error('OFFICIAL_API_REQUEST_BUDGET_EXHAUSTED');
          req.signal?.throwIfAborted();
          const reservation=fs.openSync(receipt,'wx');
          try{fs.writeFileSync(reservation,JSON.stringify({version:2,fingerprint,requestKey:req.idempotencyKey,model:req.model,task,sceneId:req.sceneId,sessionId:req.sessionId,projectId:req.projectId,state:'SUBMITTING',createdAt:new Date().toISOString()}));fs.fsyncSync(reservation);}finally{fs.closeSync(reservation);}
          if(req.mediaType==='image') response=await json(`${BASE}/models/${req.model}:generateContent`,{contents:[{parts:[{text:req.prompt}]}],generationConfig:{responseModalities:['TEXT','IMAGE'],imageConfig:{aspectRatio:req.aspectRatio}}});
          else {
            response=await json(`${BASE}/interactions`,{model:req.model,input:reference?[reference,{type:'text',text:req.motionPrompt||req.prompt}]:req.motionPrompt||req.prompt,
              response_format:{type:'video',aspect_ratio:req.aspectRatio,resolution:'720p',delivery:'uri'},background:false,store:true,stream:false});
            if(validInteractionId(response.id))append({state:'SUBMITTED',interactionId:response.id});
            response=await poll(response);
          }
        }
        req.signal?.throwIfAborted();
        if(req.mediaType==='image') {
          const images=response.candidates?.[0]?.content?.parts?.filter((p:any)=>p.inlineData?.mimeType?.startsWith('image/'))||[];
          if(images.length!==1)throw new Error('OFFICIAL_API_IMAGE_MISSING_OR_AMBIGUOUS');
          output={mime:images[0].inlineData.mimeType,data:images[0].inlineData.data,operationId:response.responseId};
        } else {
          if(response.status!=='completed'||!validInteractionId(response.id)||response.model&&response.model!==req.model)throw new Error('OFFICIAL_API_INVALID_INTERACTION_STATUS_OR_MODEL');
          const videos=(response.steps||[]).filter((s:any)=>s.type==='model_output').flatMap((s:any)=>s.content||[]).filter((c:any)=>c.type==='video');
          if(videos.length!==1)throw new Error('OFFICIAL_API_VIDEO_MISSING_OR_AMBIGUOUS');
          output={mime:videos[0].mime_type,data:videos[0].data,uri:videos[0].uri,operationId:response.id};
        }
        const pendingResponse=responseFile+'.'+crypto.randomUUID()+'.pending';
        const responseFd=fs.openSync(pendingResponse,'wx');
        try {fs.writeFileSync(responseFd,JSON.stringify(output));fs.fsyncSync(responseFd);}finally{fs.closeSync(responseFd);}
        try{fs.linkSync(pendingResponse,responseFile);}finally{fs.unlinkSync(pendingResponse);}
        append({state:'RESPONSE_SAVED'});
      }
      let bytes: Buffer;
      if(output.data) {
        if(typeof output.data!=='string'||output.data.length>MAX_BYTES*4/3+8||!/^[A-Za-z0-9+/]*={0,2}$/.test(output.data)||output.data.length%4!==0)throw new Error('OFFICIAL_API_INVALID_BASE64');
        bytes=Buffer.from(output.data,'base64');
      } else if(output.uri && req.mediaType==='video') {
        const url=new URL(output.uri);
        if(url.origin!=='https://generativelanguage.googleapis.com'||url.username||url.password||url.hash||!/^\/v1beta\/files\/[\w-]+:download$/.test(url.pathname)||[...url.searchParams].some(([k,v])=>k!=='alt'||v!=='media'))throw new Error('OFFICIAL_API_UNTRUSTED_MEDIA_URI');
        const file=url.pathname.match(/\/files\/([\w-]+):download$/)![1];const deadline=Date.now()+6*60_000;
        for(;;){const info=await json(`${BASE}/files/${file}`);if(info.state==='ACTIVE')break;if(info.state==='FAILED')throw new Error('OFFICIAL_API_FILE_FAILED');if(info.state!=='PROCESSING'||Date.now()>deadline)throw new Error('OFFICIAL_API_FILE_NOT_READY');await pause();}
        const response=await this.request(url,{headers:{'x-goog-api-key':req.apiKey},redirect:'error',signal:signal()});
        if(!response.ok)throw new Error(`OFFICIAL_API_DOWNLOAD_HTTP_${response.status}`);
        const mime=response.headers.get('content-type')?.split(';')[0];if(mime && !['video/mp4','application/octet-stream'].includes(mime))throw new Error('OFFICIAL_API_DOWNLOAD_MIME_MISMATCH');
        bytes=await limited(response,MAX_BYTES);
      } else throw new Error('OFFICIAL_API_MEDIA_MISSING');
      const magic=detectFormatFromBuffer(bytes),allowed=req.mediaType==='image'?['image/png','image/jpeg','image/webp']:['video/mp4'];
      if(!bytes.length||bytes.length>MAX_BYTES||!allowed.includes(output.mime)||magic.mimeType!==output.mime)throw new Error('OFFICIAL_API_MIME_MAGIC_MISMATCH');
      const target=path.join(path.dirname(req.targetPath),path.basename(req.targetPath,path.extname(req.targetPath))+magic.extension);
      fs.mkdirSync(path.dirname(target),{recursive:true});
      const candidate=path.join(path.dirname(target),`.official-${crypto.randomUUID()}${magic.extension}`);let mediaInfo:VisualGenerationResult['mediaInfo'];
      try {
        fs.writeFileSync(candidate,bytes,{flag:'wx'});await this.validate(candidate);req.signal?.throwIfAborted();
        if(req.mediaType==='video') {
          const video=await validateVideoWithFfprobe(candidate);
          const probe:any=await new Promise((resolve,reject)=>ffmpeg.ffprobe(candidate,(e,d)=>e?reject(e):resolve(d)));
          const stream=probe.streams.find((s:any)=>s.codec_type==='video'),rate=String(stream?.avg_frame_rate||stream?.r_frame_rate||'0/1').split('/').map(Number),fps=rate[0]/rate[1];
          if(!video.isValid||video.duration<3-1/24||video.duration>10+1/24||!Number.isFinite(fps)||Math.abs(fps-24)>0.01||Math.min(video.width,video.height)!==720)throw new Error('OFFICIAL_API_VIDEO_CAPABILITY_MISMATCH');
          mediaInfo={width:video.width,height:video.height,durationSec:video.duration,fps};
        } else {const image=decodeImageDimensions(bytes);mediaInfo={width:image.width,height:image.height};}
        const aspect=req.aspectRatio==='16:9'?16/9:9/16;if(Math.abs(mediaInfo.width/mediaInfo.height-aspect)>0.025)throw new Error('OFFICIAL_API_ASPECT_MISMATCH');
        req.signal?.throwIfAborted();
        if(fs.existsSync(target)){if(digest(fs.readFileSync(target))!==digest(bytes))throw new Error('OUTPUT_ALREADY_EXISTS');}
        else fs.linkSync(candidate,target);
      } finally {if(fs.existsSync(candidate))fs.unlinkSync(candidate);}
      append({state:'COMPLETED',sha256:digest(bytes),localPath:target,mediaInfo});
      return {provider:'official_gemini_api',model:req.model,mediaType:req.mediaType,localPath:target,operationId:output.operationId,sha256:digest(bytes),referenceHash,mediaInfo,state:'COMPLETED'};
    } catch(error) {
      if(fs.existsSync(receipt))append({state:'RECONCILIATION_REQUIRED'});
      if(req.signal?.aborted)throw new Error('CANCELLED: official submission may require reconciliation; no automatic POST retry.');
      const message=error instanceof Error?error.message:'';
      throw new Error(/^(OFFICIAL_API_|UNSUPPORTED|BLOCKED|OUTPUT_ALREADY|KEYFRAME_)/.test(message)?message:'OFFICIAL_API_FAILED_OR_SUBMISSION_UNCERTAIN_NO_RESUBMIT');
    }
  }
}
