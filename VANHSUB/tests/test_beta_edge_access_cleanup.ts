import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { PassThrough } from 'node:stream';
import { MsEdgeTTS } from 'msedge-tts';
import { synthesizeEdgeSpeech } from '../main/tts-providers/edge/edgeSpeech';
import { EdgeTTSClient } from '../main/tts-providers/edge/EdgeTTSClient';
import { AiStudioTtsService } from '../main/ai-studio/services/AiStudioTtsService';

async function main() {
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'edge-access-cleanup-'));process.env.VANHSUB_SETTINGS_DIR=root;
  const original={metadata:MsEdgeTTS.prototype.setMetadata,stream:MsEdgeTTS.prototype.toStream,close:MsEdgeTTS.prototype.close};
  let attempts=0,closes=0;
  try {
    MsEdgeTTS.prototype.close=function(){closes++;} as any;
    MsEdgeTTS.prototype.setMetadata=async function(){ attempts++;throw new Error('Unexpected server response: 403'); } as any;
    await assert.rejects(EdgeTTSClient.getInstance().synthesize('fixture'),/TTS_PROVIDER_ACCESS_DENIED/); assert.equal(attempts,1);
    const old=path.join(root,'old.mp3');fs.writeFileSync(old,'previous complete output');
    await assert.rejects(new AiStudioTtsService().synthesizeSingleSpeechChunk('fixture','vi-VN-HoaiMyNeural',{},old),/TTS_PROVIDER_ACCESS_DENIED/);
    assert.equal(attempts,2);assert.equal(fs.readFileSync(old,'utf8'),'previous complete output');
    const { generateTtsFromSrt }=await import('../main/render/ttsEngine');
    const srt=path.join(root,'test.srt');fs.writeFileSync(srt,'1\n00:00:00,000 --> 00:00:03,000\nFixture.\n');
    const out=path.join(root,'audio');fs.mkdirSync(out);fs.writeFileSync(path.join(out,'subtitle_0001.mp3'),'old-master');
    await assert.rejects(generateTtsFromSrt(srt,out,{engine:'edge',voice:'vi-VN-HoaiMyNeural'}),/TTS_PROVIDER_ACCESS_DENIED/);
    assert.equal(attempts,3,'Outer sentence retry must not multiply denied requests');assert.equal(fs.readFileSync(path.join(out,'subtitle_0001.mp3'),'utf8'),'old-master');
    MsEdgeTTS.prototype.setMetadata=async function(){attempts++;await new Promise(()=>{});} as any;
    const controller=new AbortController();const began=Date.now();const pending=synthesizeEdgeSpeech('fixture','voice',{}, {signal:controller.signal});setTimeout(()=>controller.abort(),15);
    await assert.rejects(pending,/huỷ/);assert.ok(Date.now()-began<500,'Cancellation covers metadata connection, not only audio streaming');
    await assert.rejects(synthesizeEdgeSpeech('fixture','voice',{}, {timeoutMs:15}),/timeout/);
    MsEdgeTTS.prototype.setMetadata=async function(){} as any;
    MsEdgeTTS.prototype.toStream=function(){const audioStream=new PassThrough(),metadataStream=new PassThrough();setTimeout(()=>{metadataStream.end(JSON.stringify({Metadata:[{Type:'WordBoundary'}]}));audioStream.end(Buffer.from('audio-fixture'));},5);return {audioStream,metadataStream};} as any;
    const success=await synthesizeEdgeSpeech('fixture','voice',{}, {wordBoundaries:true});assert.equal(success.audio.toString(),'audio-fixture');assert.equal(success.metadata.length,1);
    assert.equal(closes,6,'Every completed, denied, timed-out or cancelled request closes once');
    console.log('PASS offline: denied requests are not retried, cancellation/timeout cover metadata, old output retained, boundary stream collected');
  } finally {Object.assign(MsEdgeTTS.prototype,{setMetadata:original.metadata,toStream:original.stream,close:original.close});fs.rmSync(root,{recursive:true,force:true});}
}
main().catch(e=>{console.error(e);process.exitCode=1;});
