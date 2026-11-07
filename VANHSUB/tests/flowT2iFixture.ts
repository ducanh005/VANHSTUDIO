/** Hermetic Chrome UI + HTTP transport fixture. Never connects to a real Google session. */
import fs from 'fs';import {chromium} from 'playwright-core';import {BrowserAutomationAdapter} from '../main/browser-automation/BrowserAutomationAdapter';
export const FIXTURE_ASSET='12345678-1234-4234-8234-123456789abc';
export async function flowT2iFixture(imageFile:string){
 const browser=await chromium.launch({executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true}),context=await browser.newContext();let mode='success',posts=0;
 const bytes=fs.readFileSync(imageFile),url='https://flow-content.google/'+FIXTURE_ASSET+'.png';
 const endpoint='https://labs.google/_/AiSandboxAngularFrontend/data/batchexecute';
 const mediaElement=[FIXTURE_ASSET,null,'aaaabbbb-1234-4234-8234-cccccccccccc',null,null,null,[null,900057535,null,null,null,null,1,'fixture prompt',36,null,null,'aaaabbbb-1234-4234-8234-cccccccccccc',null,url,3,null,null,[1376,768],null,null,[null,url]]];
 const inner=[mediaElement];
 const response=JSON.stringify([[['wrb.fr','ogiZ0b',JSON.stringify(inner),null,null,null,'generic']]]);
 const html=`<style>p{margin:0}</style><button aria-label="Tạo bộ sưu tập" onclick="window.collections++">Collection</button><flow-prompt-box><button aria-label="Google Account">Account</button><button>Fixture Model</button> x1 <button role="radio" aria-checked="true">Image</button> 0 credits per generation <div class="ProseMirror" contenteditable="true" onkeydown="if(event.key==='Enter'){window.early++;send()}">old text</div><button aria-label="Generate" onclick="window.clicks++;send()">Generate</button></flow-prompt-box><script>
 window.clicks=0;window.collections=0;window.early=0;window.fills=0;
 // ProseMirror-mimic: normalize the editor into one <p> per logical line so the DOM matches the real Flow schema (no bare text beside blocks). Debounced so Playwright fill completes first.
 var normTimer=null;function normalizeEditor(){const ed=document.querySelector('.ProseMirror');const kids=Array.prototype.slice.call(ed.childNodes);if(kids.length&&kids.every(n=>n.nodeType===1&&n.tagName==='P'))return;const lines=ed.innerText.replace(/\\n+$/,'').split('\\n');ed.innerHTML=lines.map(l=>l?'<p>'+l.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')+'</p>':'<p><br></p>').join('')||'<p><br></p>';}
 // Real Flow's RPC carries the prompt with single-newline line breaks, not CSS-dependent innerText spacing.
 function editorPrompt(){const ed=document.querySelector('.ProseMirror');const kids=Array.prototype.slice.call(ed.childNodes);const blocks=kids.filter(n=>n.nodeType===1&&['P','DIV'].includes(n.tagName));if(blocks.length&&blocks.length===kids.length)return blocks.map(b=>b.innerText).join('\\n');return ed.innerText;}
 async function send(){const prompt=editorPrompt();const project=location.pathname.split('/project/')[1];const uuid=()=>crypto.randomUUID().toUpperCase();const frame=[[null,null,null,2052833273,3,'BELUGA',null,[null,22,null,null,null,project,null,null,null,null,null,1]],[[[prompt]]],null,null,null,uuid(),uuid()];const body=new URLSearchParams({'f.req':JSON.stringify([[['ogiZ0b',JSON.stringify(frame),null,'generic']]])});await fetch('${endpoint}',{method:'POST',body});if(window.fixtureMode==='timeout'||window.fixtureMode==='old-only')return;const card=document.createElement('flow-grid-tile-container');card.setAttribute('data-project-id',window.fixtureMode==='wrong-project'?'other-project':project);const tile=document.createElement('flow-image-tile'),im=document.createElement('img');im.setAttribute('data-media-id','${FIXTURE_ASSET}');if(window.fixtureMode==='provider-failed'){card.setAttribute('data-asset-id','${FIXTURE_ASSET}');card.innerHTML='<div role="alert">Generation failed</div>';document.body.append(card);return;}if(window.fixtureMode==='progress'){card.innerHTML='<div role="progressbar">60%</div>';document.body.append(card);await new Promise(r=>setTimeout(r,600));card.innerHTML='';}im.src='${url}';tile.append(im);card.append(tile);document.body.append(card);}
 document.querySelector('.ProseMirror').addEventListener('input',()=>{window.fills++;if(window.fixtureMode==='truncate')document.querySelector('.ProseMirror').textContent='altered';clearTimeout(normTimer);normTimer=setTimeout(normalizeEditor,0);if(window.fixtureMode==='early-input'&&!window.autoSent){window.autoSent=true;send();}});
 </script>`;
 await context.route('**/*',async route=>{
   const request=route.request();if(request.url()===endpoint){posts++;return route.fulfill({status:mode==='provider-failed'?400:200,contentType:'application/json',body:mode==='empty-response'?'{}':response});}
   if(request.url()===url)return route.fulfill({contentType:'image/png',body:bytes});
   if(/^https:\/\/(?:labs\.google|flow\.google\.com)\//.test(request.url()))return route.fulfill({contentType:'text/html',body:html});
   return route.abort();
 });
 const adapter=new (BrowserAutomationAdapter as any)() as BrowserAutomationAdapter;
 (adapter as any).sessions.set('flow',{provider:'flow',browser,context,port:9224,isDisconnecting:false,lastConnectedAt:Date.now()});
 const page=await adapter.getOrCreateTab('flow',{targetUrl:'https://labs.google/fx/tools/flow/project/test00001',automationOwned:true,repurposeBlank:false});
 // APIRequestContext is a separate transport from Chrome routing; explicit offline byte fixture.
 let gets=0,disposed=0;
 (context.request as any).get=async(_url:string,options:any)=>{gets++;if(options.maxRedirects!==0)throw Error('Redirects enabled');return {ok:()=>true,headers:()=>({'content-type':'image/png'}),body:async()=>bytes,dispose:async()=>{disposed++;}};};
 return {adapter,browser,context,page,url,bytes,posts:()=>posts,gets:()=>gets,disposed:()=>disposed,
   setMode:async(value:string)=>{mode=value;await page.goto('https://labs.google/fx/tools/flow/project/test00001');await page.evaluate(value=>(window as any).fixtureMode=value,value);},
   addOld:async()=>{await page.evaluate(({id,url})=>{const c=document.createElement('flow-grid-tile-container'),t=document.createElement('flow-image-tile'),im=document.createElement('img');im.dataset.mediaId=id;im.src=url;t.append(im);c.append(t);document.body.append(c);},{id:FIXTURE_ASSET,url});await page.waitForFunction(()=>Array.from(document.images).some(im=>im.naturalWidth>=200));},
   counters:async()=>page.evaluate(()=>({clicks:(window as any).clicks,early:(window as any).early,collections:(window as any).collections,fills:(window as any).fills}))};
}
