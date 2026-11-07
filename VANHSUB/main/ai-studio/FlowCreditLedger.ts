import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import {assertFlowQuote} from '../../shared/flowCreditPolicy';

/** Reservations are durable before UI submission. Unknown outcome never permits another click. */
export class FlowCreditLedger {
  readonly file:string;
  constructor(readonly dir:string,readonly key:string){
    if(!path.isAbsolute(dir)||!/^[a-f0-9]{64}$/.test(key))throw Error('FLOW_LEDGER_INVALID');
    fs.mkdirSync(dir,{recursive:true});this.file=path.join(dir,key+'.flow.json');
  }
  read(){return fs.existsSync(this.file)?JSON.parse(fs.readFileSync(this.file,'utf8')):null;}
  reserve(approval:any,observed:any){
    const lock=path.join(this.dir,'.reserve.lock');const lockFd=fs.openSync(lock,'wx');
    try{
    if(this.read())throw Error('FLOW_SUBMISSION_EXISTS: đối soát receipt, không tự generation lại.');
    const entries=fs.readdirSync(this.dir).filter(n=>n.endsWith('.flow.json')).map(n=>JSON.parse(fs.readFileSync(path.join(this.dir,n),'utf8')));
    if(entries.some(r=>![1,2].includes(r.version)||r.outputs!==1||!['NOT_SUBMITTED','SUBMITTING','GENERATING','FAILED','RECONCILIATION_REQUIRED','COMPLETED'].includes(r.state)||(r.quotedCredits!==null&&(!Number.isFinite(r.quotedCredits)||r.quotedCredits<0))))throw Error('FLOW_LEDGER_CORRUPT: không suy budget từ receipt hỏng.');
    if(entries.some(r=>r.sceneId===approval.sceneId&&r.state!=='COMPLETED'))throw Error('FLOW_SCENE_RECONCILIATION_REQUIRED');
    if(entries.length>=approval.limit)throw Error('FLOW_OUTPUT_LIMIT');
    // Unknown quotes consume the entire approved budget; no further reservation is safe.
    const used=entries.reduce((sum,r)=>sum+(r.quotedCredits===null?approval.maxCredits:r.quotedCredits),0);
    assertFlowQuote({...approval,remainingCredits:Math.max(0,approval.maxCredits-used)},observed);
    const fd=fs.openSync(this.file,'wx');try{fs.writeFileSync(fd,JSON.stringify({version:2,state:'SUBMITTING',phase:'BEFORE_INPUT',requestKey:this.key,sceneId:approval.sceneId,projectId:approval.projectId,sessionId:approval.sessionId,promptSha256:approval.promptSha256,baselineAssetIds:approval.baselineAssetIds||[],model:approval.model,task:approval.task,outputs:1,quotedCredits:observed.credits,actualCredits:null,hardCapVerified:false,createdAt:new Date().toISOString()}));fs.fsyncSync(fd);}finally{fs.closeSync(fd);}
    }finally{fs.closeSync(lockFd);fs.unlinkSync(lock);}
  }
  transition(state:'NOT_SUBMITTED'|'SUBMITTING'|'GENERATING'|'FAILED'|'RECONCILIATION_REQUIRED',details?:{assetId?:string;mediaUrl?:string;promptSha256?:string}){
    const record=this.read();if(record?.version!==2||record.state==='COMPLETED')throw Error('FLOW_RECEIPT_TRANSITION_REFUSED');
    if(details?.promptSha256&&record.promptSha256!==details.promptSha256)throw Error('FLOW_RECEIPT_PROMPT_MISMATCH');
    const remote=details?.assetId&&details.mediaUrl?{assetId:details.assetId,url:details.mediaUrl}:record.remote;
    this.write({...record,state,phase:state==='SUBMITTING'?'CLICK_STARTED':state,remote,updatedAt:new Date().toISOString()});
  }
  private write(record:any){
    const tmp=this.file+'.'+crypto.randomUUID()+'.pending',fd=fs.openSync(tmp,'wx');try{fs.writeFileSync(fd,JSON.stringify(record));fs.fsyncSync(fd);}finally{fs.closeSync(fd);}fs.renameSync(tmp,this.file);
  }
  validatedArtifact(artifact:{localPath:string;sha256:string}){
    const record=this.read();if(record?.version!==2||!record.remote||record.state==='COMPLETED')throw Error('FLOW_RECEIPT_TRANSITION_REFUSED');
    this.write({...record,validatedArtifact:artifact});
  }
  complete(result:{localPath:string;sha256:string;assetId?:string;referenceSha256?:string}){
    const record=this.read();if(record?.version!==2||(record.task==='t2i'&&(!record.remote||record.remote.assetId!==result.assetId)))throw Error('FLOW_RECEIPT_REMOTE_UNVERIFIED');
    if(!path.isAbsolute(result.localPath)||!fs.existsSync(result.localPath)||crypto.createHash('sha256').update(fs.readFileSync(result.localPath)).digest('hex')!==result.sha256)throw Error('FLOW_RECEIPT_ARTIFACT_UNVERIFIED');
    this.write({...record,...result,state:'COMPLETED',updatedAt:new Date().toISOString()});
  }
}
