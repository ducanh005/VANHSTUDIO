/** Actual installed Vietnamese Piper synthesis. No LLM, HTTP fixture, server or download. */
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import sharp from 'sharp';
import {AiStudioTtsService} from '../main/ai-studio/services/AiStudioTtsService';
import fixture from './fixtures/ai_race_2023_2026_vi.json';

async function main(){
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'vanhsub-ai-race-vi-'));
  const service=new AiStudioTtsService(),started=Date.now();
  const voice={provider:'piper_local' as const,voiceId:'vi_VN-vais1000-medium',rate:'+0%',pitch:'+0Hz',volume:'+0%',autoWordAlignment:true};
  let count=0;const actual=service.synthesizeSingleSpeechChunk.bind(service);
  service.synthesizeSingleSpeechChunk=async(...args)=>{const result=await actual(...args);console.log(JSON.stringify({realPiperChunk:++count,elapsedMs:Date.now()-started}));return result;};
  const lines=fixture.scenes.map((s,i)=>({id:`vi_${i+1}`,index:i+1,text:s.text}));
  const audio=path.join(root,'Cuộc đua AI - tiếng Việt.mp3');
  let synthesis=await service.synthesizeVoiceover(lines,voice,audio);
  if(synthesis.durationMs<180000||synthesis.durationMs>300000){
    voice.rate=`${Math.round((synthesis.durationMs/240000-1)*100)}%`;
    synthesis=await service.synthesizeVoiceover(lines,voice,audio); // One measured adjustment only.
  }
  if(synthesis.durationMs<180000||synthesis.durationMs>300000)throw Error('Measured speech duration outside 3–5 minutes');
  const aligned=service.extractAlignment([],lines.map(l=>l.text).join(' '),lines,synthesis.durationMs,synthesis.wordTimestamps);
  const cues:any[]=[];
  for(let i=0;i<aligned.alignedLines.length;i++){
    const line=aligned.alignedLines[i],words=line.text.split(/\s+/),chunks=[];
    for(let j=0;j<words.length;j+=24)chunks.push(words.slice(j,j+24));
    let start=line.startMs!;
    for(let j=0;j<chunks.length;j++){
      const end=j===chunks.length-1?line.endMs!:start+Math.round(line.durationMs!*chunks[j].length/words.length);
      cues.push({startMs:start,endMs:end,text:chunks[j].join(' '),imageIndex:i});start=end;
    }
  }
  const stamp=(ms:number)=>{const n=Math.round(ms);return `${String(Math.floor(n/3600000)).padStart(2,'0')}:${String(Math.floor(n/60000)%60).padStart(2,'0')}:${String(Math.floor(n/1000)%60).padStart(2,'0')},${String(n%1000).padStart(3,'0')}`;};
  const srt=path.join(root,'Cuộc đua AI - timing ước lượng.srt');
  fs.writeFileSync(srt,cues.map((c,i)=>`${i+1}\n${stamp(c.startMs)} --> ${stamp(c.endMs)}\n${c.text}\n`).join('\n'));
  const images:string[]=[];
  const xml=(s:string)=>s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
  for(let i=0;i<fixture.scenes.length;i++){
    const scene=fixture.scenes[i],image=path.join(root,`Minh họa ${i+1}.png`);
    const svg=`<svg width="1280" height="720" xmlns="http://www.w3.org/2000/svg"><rect width="1280" height="720" fill="#10192d"/><rect x="60" y="60" width="1160" height="570" rx="30" fill="#172843"/><text x="100" y="126" font-family="Arial" font-size="23" fill="#8dbcf7">CUỘC ĐUA AI 2023–2026 · ${i+1}/12</text><text x="100" y="250" font-family="Arial" font-size="66" font-weight="bold" fill="#67e8cd">${xml(scene.year)}</text><text x="100" y="330" font-family="Arial" font-size="42" fill="white">${xml(scene.heading)}</text><path d="M100 425H1170" stroke="#4a75a0" stroke-width="4"/>${['2023','2024','2025','2026'].map((year,j)=>`<circle cx="${150+j*300}" cy="425" r="12" fill="#67e8cd"/><text x="${120+j*300}" y="480" font-family="Arial" font-size="24" fill="#c6d4e8">${year}</text>`).join('')}<text x="100" y="555" font-family="Arial" font-size="20" fill="#c6d4e8">Mốc công bố • Kiểm chứng nguồn • Quyền truy cập • Độ tin cậy</text></svg>`;
    await sharp(Buffer.from(svg)).png().toFile(image);images.push(image);
  }
  const seo={title:fixture.title,description:'Video nghiệm thu kỹ thuật với kịch bản biên soạn, giọng Việt Piper local và minh họa tự tạo. Không phải Full AI Live E2E.',hashtags:['#AI','#KiemChung','#CongNghe'],sources:fixture.sources,source:'manual_authored'};
  fs.writeFileSync(path.join(root,'SEO-biên-soạn.json'),JSON.stringify(seo,null,2));
  const result={root,audio,srt,images,cues,lines:aligned.alignedLines,voice,durationMs:synthesis.durationMs,elapsedMs:Date.now()-started,alignmentSource:'estimated_per_line',tts:'real_installed_Piper_vi_VN',scriptSource:'manual_authored',mediaSource:'original_programmatic_diagrams',seo};
  fs.writeFileSync('temp/aistudio-phase3/long-input.json',JSON.stringify(result,null,2));
  console.log(JSON.stringify({durationMs:result.durationMs,cues:cues.length,elapsedMs:result.elapsedMs,root}));
}
main().catch(e=>{console.error(e);process.exitCode=1;});
