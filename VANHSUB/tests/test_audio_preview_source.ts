import assert from 'node:assert/strict';
import { setAudioPreviewSource, clearAudioPreviewSource } from '../renderer/lib/audioPreviewSource';

async function main() {
  // Actual Blob bytes and object URL lifecycle, without pretending this is playback.
  const audio = { src: '', pause() {}, load() {}, removeAttribute() { this.src=''; } } as unknown as HTMLAudioElement;
  const bytes=Buffer.from([0xff,0xfb,0x90,0x44,0,128,255]);
  setAudioPreviewSource(audio,{audioBase64:bytes.toString('base64'),mimeType:'audio/mpeg'});
  const first=audio.src; assert(first.startsWith('blob:'));
  const response=await fetch(first); assert.equal(response.headers.get('content-type'),'audio/mpeg');
  assert.deepEqual(Buffer.from(await response.arrayBuffer()),bytes);
  setAudioPreviewSource(audio,{audioBase64:bytes.toString('base64'),mimeType:'audio/mpeg'});
  await assert.rejects(fetch(first));
  const second=audio.src; clearAudioPreviewSource(audio); clearAudioPreviewSource(audio);
  await assert.rejects(fetch(second)); assert.equal(audio.src,'');
  console.log('PASS: preview Blob preserves binary audio, replaces/revokes URLs and releases source; playback requires runtime verification.');
}
main().catch(e=>{console.error(e);process.exitCode=1;});
