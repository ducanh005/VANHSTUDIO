const assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const esbuild=require('esbuild'),{chromium}=require('playwright-core'),{pathToFileURL}=require('node:url');
(async()=>{const dir=fs.mkdtempSync(path.join(os.tmpdir(),'vanhsub-tts-panel-'));let browser;
try{await esbuild.build({stdin:{resolveDir:process.cwd(),loader:'tsx',contents:`
import React from 'react';import {createRoot} from 'react-dom/client';import TTSPage from './renderer/components/TTSPage';
window.fixtureText='Original line.';window.reads=0;window.defer=false;window.pending=[];
window.vanhsub={settings:{get:async k=>k==='ttsVoice'?'vi-VN-HoaiMyNeural':1},tts:{getEdgeVoices:async()=>[]},tasks:{readSrt:async()=>{window.reads++;if(window.defer)return new Promise(r=>window.pending.push(r));return '1\\n00:00:00,000 --> 00:00:01,000\\n'+window.fixtureText+'\\n';}}};
const root=createRoot(document.getElementById('root'));window.mount=(id='task-a')=>root.render(<TTSPage tasks={[{id,fileName:id+'.mp4',filePath:id+'.mp4',srtPath:id+'.srt',status:'done',progress:100,createdAt:'2026-10-20',ttsVoice:'vi-VN-HoaiMyNeural'}] as any} selectedTaskId={id}/>);window.mount();
`},bundle:true,platform:'browser',format:'iife',outfile:path.join(dir,'bundle.js')});
fs.writeFileSync(path.join(dir,'index.html'),'<div id="root"></div><script src="bundle.js"></script>');
browser=await chromium.launch({executablePath:process.env.VANHSUB_TEST_CHROME||'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true});const page=await browser.newPage();page.on('pageerror', e=>console.error('PAGE ERROR:',e.message));page.setDefaultTimeout(5000);await page.goto(pathToFileURL(path.join(dir,'index.html')).href);
const toggle=page.getByRole('button',{name:'Gán giọng theo câu',exact:true});await toggle.click();await page.getByText('Original line.',{exact:true}).waitFor();
await toggle.click();await page.evaluate(()=>{window.fixtureText='Edited line.'});await toggle.click();await page.getByText('Edited line.',{exact:true}).waitFor();assert.equal(await page.getByText('Original line.',{exact:true}).count(),0);assert.equal(await page.evaluate(()=>window.reads),2);
await toggle.click();await page.evaluate(()=>{window.defer=true});await toggle.click();await page.waitForFunction(()=>window.pending.length===1);await page.evaluate(()=>window.mount('task-b'));await page.getByText('task-b.mp4',{exact:true}).first().waitFor();await page.evaluate(()=>{window.defer=false;window.fixtureText='Task B line.';window.pending[0]('1\n00:00:00,000 --> 00:00:01,000\nStale task A line.\n')});await toggle.click();await page.getByText('Task B line.',{exact:true}).waitFor();assert.equal(await page.getByText('Stale task A line.',{exact:true}).count(),0);
console.log('PASS: real React TTS panel reloads edited SRT and rejects late cross-task reads; headless fixture IPC, not Electron/provider E2E');
}finally{await browser?.close();}})().catch(e=>{console.error(e);process.exitCode=1});
