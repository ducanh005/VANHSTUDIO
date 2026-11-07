import crypto from 'crypto';
import type {Page,Request,Response,Locator} from 'playwright-core';
import type {BrowserAutomationAdapter} from './BrowserAutomationAdapter';
import type {FlowGenerationAutomationOptions,FlowGenerationAutomationResult} from './types';

const RPC='ogiZ0b',UUID=/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
const canonical=(s:string)=>s.replace(/\r\n?/g,'\n').trim();
/** Editor paragraphs may serialize with one or two newlines; word content must still match exactly. */
const lineCanonical=(s:string)=>canonical(s).replace(/\n{2,}/g,'\n');
/** Read document line boundaries, not CSS-dependent innerText paragraph spacing. */
export async function readFlowPrompt(editor:Locator):Promise<string>{
  return editor.evaluate(root=>{
    const nodes=Array.from(root.childNodes);
    const blocks=nodes.filter(n=>n instanceof HTMLElement&&['P','DIV'].includes(n.tagName));
    if(blocks.length&&blocks.length!==nodes.length)throw Error('FLOW_PROMPT_UNSUPPORTED_NODE');
    const lines:string[]=[];
    for(const scope of blocks.length?blocks:[root]){
      const children=Array.from(scope.childNodes);let text='';
      const walker=document.createTreeWalker(scope,NodeFilter.SHOW_TEXT|NodeFilter.SHOW_ELEMENT);
      while(walker.nextNode()){
        const node=walker.currentNode;
        if(node.nodeType===Node.TEXT_NODE){text+=node.textContent||'';continue;}
        if(!(node instanceof HTMLElement))continue;
        if(node.getAttribute('contenteditable')==='false'||!['SPAN','STRONG','EM','B','I','U','S','BR'].includes(node.tagName))throw Error('FLOW_PROMPT_UNSUPPORTED_NODE');
        if(node.tagName==='BR'&&!node.classList.contains('ProseMirror-trailingBreak')&&!(blocks.length&&children.length===1))text+='\n';
      }
      lines.push(text);
    }
    return lines.join('\n');
  });
}
/** Passive inspection only. Never constructs/sends a Google RPC or reads auth headers. */
export function inspectUiImageRequest(url:string,body:string|null,project:string,prompt:string){
  try{
    const u=new URL(url);if(u.protocol!=='https:'||!['flow.google.com','labs.google'].includes(u.hostname)||!u.pathname.endsWith('/data/batchexecute'))return null;
    const tree=JSON.parse(new URLSearchParams(body||'').get('f.req')||'null'),frames:any[]=[];
    const visit=(v:any)=>{if(!Array.isArray(v))return;if(v[0]===RPC&&typeof v[1]==='string'){frames.push(JSON.parse(v[1]));return;}for(const x of v)visit(x);};visit(tree);
    if(frames.length!==1)return null;const args=frames[0],strings:string[]=[];
    const leaves=(v:any)=>{if(typeof v==='string')strings.push(v);else if(Array.isArray(v))for(const x of v)leaves(x);};leaves(args);
    if(!strings.includes(project))return null;
    const promptMatches=strings.filter(s=>lineCanonical(s)===lineCanonical(prompt)).length===1;
    // Legacy fixture shape [[prompt],1,...] or real Flow shape: one ogiZ0b frame carrying the prompt in a single [[[prompt]]] output slot.
    const frameJson=JSON.stringify(args);
    const legacyOutput=Array.isArray(args[0])&&args[0].length===1&&args[1]===1;
    const realOutputCount=frameJson.split('[[['+JSON.stringify(prompt)+']]]').length-1;
    const singleOutput=legacyOutput||realOutputCount===1;
    if(!promptMatches||!singleOutput)console.warn('[FlowT2i] request inspection detail:',JSON.stringify({promptMatches,singleOutput,frameArgsShape:Array.isArray(args[0])?`args[0].length=${args[0].length}`:'not-array',args1:args[1],closest:strings.filter(s=>s.length>10).map(s=>lineCanonical(s).slice(0,80))}));
    return {projectMatches:true,promptMatches,singleOutput};
  }catch{return null;}
}
export function inspectUiImageResponse(text:string):{assetId:string;url:string}[]{
  // Strictly select this RPC's own frame; no fallback to unrelated wrb.fr responses.
  const frames:any[]=[];const visit=(v:any)=>{if(!Array.isArray(v))return;if(v[0]==='wrb.fr'&&v[1]===RPC){try{frames.push(JSON.parse(v[2]));}catch{}return;}for(const x of v)visit(x);};
  const clean=text.replace(/^\)\]\}'\s*/,'').trim();try{visit(JSON.parse(clean));}catch{for(const line of clean.split('\n'))try{visit(JSON.parse(line));}catch{}}
  if(frames.length!==1)return [];const results:{assetId:string;url:string}[]=[];
  // Real payload nests the signed URL inside sub-arrays whose own UUIDs are scene/episode ids, not the asset.
  // The asset id is therefore taken from the URL itself when present; single-output = exactly one distinct URL.
  const collect=(v:any)=>{if(!Array.isArray(v))return;
   const urls=v.filter((x:any)=>typeof x==='string'&&x.startsWith('https://'));
   if(urls.length===1){const u=urls[0];const m=u.match(/[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}/i);const local=v.filter((x:any)=>typeof x==='string'&&UUID.test(x));
    if(m||local.length)results.push({assetId:(m&&m[0])||local[0],url:u});return;}
   for(const x of v)collect(x);};collect(frames[0]);
  const byUrl=[...new Map(results.map(x=>[x.url,x])).values()];
  if(byUrl.length!==1)return [];
  return [{assetId:byUrl[0].assetId,url:byUrl[0].url}];
}

/** Snapshot is read-only and serializable by both Electron webpack and source test runners. */
export async function readT2iGallery(page:Page){
  return page.evaluate(()=>{
    const projectId=location.pathname.match(/\/project\/([^/]+)/)?.[1]||null;
    const cards=Array.from(document.querySelectorAll('flow-grid-tile-container,flow-asset-card,[data-testid="generation-tile"]')).filter(e=>!e.parentElement?.closest('flow-grid-tile-container,flow-asset-card,[data-testid="generation-tile"]'));
    const tiles=cards.map(e=>{
      const im=e.querySelector('img') as HTMLImageElement|null,url=im?.currentSrc||im?.src||'';
      const id=im?.getAttribute('data-media-id')||e.getAttribute('data-media-id')||e.getAttribute('data-asset-id')||url.match(/[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}/i)?.[0]||'';
      return {id,url,width:im?.naturalWidth||0,height:im?.naturalHeight||0,project:e.getAttribute('data-project-id')||projectId,
        pending:!!e.querySelector('[role="progressbar"],mat-progress-spinner,flow-loading-indicator,.loading')||e.classList.contains('generating')||/(?:^|\s)\d{1,3}%/.test(e.textContent||''),
        failed:!!e.querySelector('[role="alert"],.error-banner,[data-status="failed"]')};
    });
    const alerts=Array.from(document.querySelectorAll('[role="alert"],.error-banner,mat-snack-bar-container')).map(e=>e.textContent||'').join(' ');
    return {projectId,tiles,security:!!document.querySelector('iframe[src*="bframe"]')||/unusual activity|bất thường|captcha|rate limit/i.test(alerts)};
  });
}

export async function runApprovedT2i(adapter:BrowserAutomationAdapter,o:FlowGenerationAutomationOptions):Promise<FlowGenerationAutomationResult>{
  const prompt=canonical(o.prompt),promptSha256=crypto.createHash('sha256').update(prompt).digest('hex');
  if(!o.projectId||!o.beforeInput||!o.beforeSubmit||!o.onSubmissionState||!prompt)return {ok:false,state:'NOT_SUBMITTED',errorCode:'FLOW_T2I_GATES_REQUIRED'};
  let page:Page|undefined,reserved=false,touched=false,clickStarted=false,clicks=0,unexpected=false,matched:Request|undefined,responseMedia:{assetId:string;url:string}[]=[];
  const requests=new Set<Request>();let security=false,requestCount=0,responseFailed=false,closed=false;
  const context=adapter.getContext('flow');if(!context)return {ok:false,state:'NOT_SUBMITTED',errorCode:'FLOW_CDP_REQUIRED'};
  const seenBodies=new Set<string>();
  const onRequest=(r:Request)=>{const body=r.postData()||'';const q=inspectUiImageRequest(r.url(),body,o.projectId!,prompt);if(!q)return;
   // Pre-click ogiZ0b-shaped calls are UI drafts/prefetches, not generations; input-side self-submits are caught by the gallery diff + durable receipt.
   if(!clickStarted)return;
   const bodySig=crypto.createHash('sha256').update(body).digest('hex').slice(0,16);if(seenBodies.has(bodySig))return;seenBodies.add(bodySig);requestCount++;if(!q.promptMatches||!q.singleOutput||requestCount!==1){unexpected=true;if(requestCount!==1)console.warn('[FlowT2i] distinct generation request #'+requestCount+' bodySig='+bodySig+' len='+body.length);return;}matched=r;requests.add(r);};
  const onResponse=(r:Response)=>{if(!requests.has(r.request()))return;void (async()=>{try{const text=await r.text();if(closed)return;if(/PUBLIC_ERROR_UNUSUAL_ACTIVITY|CAPTCHA|RESOURCE_EXHAUSTED/.test(text)){security=true;console.warn('[FlowT2i] provider security signal in matched response');return;}if(!r.ok()){responseFailed=true;return;}responseMedia=inspectUiImageResponse(text);if(!responseMedia.length)console.warn('[FlowT2i] matched response yielded no media; head:',text.slice(0,2500));}catch{}})();};
  const result=(state:FlowGenerationAutomationResult['state'],code:string):FlowGenerationAutomationResult=>({ok:false,state,errorCode:code,projectId:o.projectId,sceneId:o.sceneId,promptSha256});
  try{
    o.signal?.throwIfAborted();
    page=await adapter.getOrCreateTab('flow',{targetUrl:`https://flow.google.com/project/${o.projectId}`,automationOwned:true,repurposeBlank:false,bringToFront:o.bringToFront,predicate:p=>(typeof p==='string'?p:p.url()).includes('/project/'+o.projectId),timeoutMs:20000});
    const session=await adapter.evaluateFlowSessionState(page);if(session.state!=='FLOW_READY'||session.projectId!==o.projectId)return result('NOT_SUBMITTED','FLOW_SESSION_OR_PROJECT_UNVERIFIED');
    // Grid and settings render asynchronously after navigation; reading earlier yields a false-empty baseline and an unreadable quote.
    // Require two consecutive equal reads (2.5s apart) so an empty project settles fast while a late-rendering grid keeps waiting.
    const settledPage=page;
    const settleGallery=async()=>{
      const read=async()=>{try{return await readT2iGallery(settledPage);}catch{return null;}};
      let prev2=await read(),prev=await read();
      for(let waited=0;waited<16000;waited+=2500){
        await settledPage.waitForTimeout(2500);
        const next=await read();
        if(prev2&&prev&&next&&next.projectId===prev2.projectId&&prev2.projectId===prev.projectId&&next.security===prev.security&&prev.security===prev2.security&&JSON.stringify(next.tiles)===JSON.stringify(prev.tiles)&&JSON.stringify(prev.tiles)===JSON.stringify(prev2.tiles))return next;
        prev2=prev;prev=next??prev;
      }
      return prev;
    };
    const baseline=await settleGallery();if(!baseline||baseline.projectId!==o.projectId||baseline.security||baseline.tiles.some(t=>t.pending))return result('NOT_SUBMITTED','FLOW_PROJECT_BUSY_OR_BLOCKED');
    const oldIds=new Set(baseline.tiles.map(t=>t.id).filter(Boolean)),oldUrls=new Set(baseline.tiles.map(t=>t.url).filter(Boolean));
    // Durable credit reservation MUST precede prompt/chip changes, even if input itself submits.
    await o.beforeInput(page,{assetIds:[...oldIds]});reserved=true;
    context.on('request',onRequest);context.on('response',onResponse);
    const editor=page.locator('flow-prompt-box .ProseMirror,flow-prompt-box [contenteditable="true"],[data-testid="prompt-box"] [contenteditable="true"]').first();
    await editor.waitFor({state:'visible',timeout:8000});o.signal?.throwIfAborted();touched=true;await editor.fill(prompt);
    if(canonical(await readFlowPrompt(editor))!==prompt)throw Error('FLOW_PROMPT_INTEGRITY_FAILED');
    const afterInput=await readT2iGallery(page);
    if(unexpected||afterInput.projectId!==o.projectId||afterInput.tiles.length!==baseline.tiles.length||afterInput.tiles.some(t=>(t.id&&!oldIds.has(t.id))||(t.url&&!oldUrls.has(t.url))||t.pending))throw Error('FLOW_INPUT_SIDE_EFFECT_REQUIRES_RECONCILIATION');
    await o.beforeSubmit(page);o.signal?.throwIfAborted();
    if(canonical(await readFlowPrompt(editor))!==prompt)throw Error('FLOW_PROMPT_CHANGED_BEFORE_CLICK');
    const finalGallery=await readT2iGallery(page);if(unexpected||finalGallery.security||finalGallery.projectId!==o.projectId||JSON.stringify(finalGallery.tiles)!==JSON.stringify(baseline.tiles))throw Error('FLOW_INPUT_SIDE_EFFECT_REQUIRES_RECONCILIATION');
    const buttons=page.locator('flow-prompt-box button[aria-label="Bắt đầu tạo" i],flow-prompt-box button[aria-label="Generate" i],flow-prompt-box flow-generate-icon-button button,[data-testid="prompt-box"] button[aria-label="Generate" i]');
    const visible=[];for(const b of await buttons.all())if(await b.isVisible())visible.push(b);
    if(visible.length!==1||await visible[0].isDisabled())throw Error('FLOW_GENERATE_BUTTON_UNVERIFIED');
    clickStarted=true;clicks++;await o.onSubmissionState('SUBMITTING',{promptSha256});
    o.signal?.throwIfAborted();
    await visible[0].click({timeout:5000});
    const end=Date.now()+(o.timeoutMs||90000);let generating=false;
    while(Date.now()<end){
      o.signal?.throwIfAborted();const g=await readT2iGallery(page);
      if(g.projectId!==o.projectId||unexpected||security||g.security||clicks!==1||requestCount>1)throw Error('FLOW_SUBMISSION_RECONCILIATION_REQUIRED: pid='+(g.projectId!==o.projectId)+' unexp='+unexpected+' sec='+(security||g.security)+' clicks='+clicks+' rc='+requestCount+' tiles='+g.tiles.length);
      const newTiles=g.tiles.filter(t=>(t.id&&!oldIds.has(t.id))||(t.url&&!oldUrls.has(t.url)));
      if(!generating&&(matched||newTiles.length||g.tiles.some(t=>t.pending))){generating=true;await o.onSubmissionState('GENERATING',{promptSha256});}
      if(matched&&responseFailed&&newTiles.some(t=>t.failed)){await o.onSubmissionState('FAILED',{promptSha256});return result('FAILED','FLOW_PROVIDER_FAILED');}
      if(newTiles.some(t=>t.failed))throw Error('FLOW_PROVIDER_FAILED_RECONCILIATION_REQUIRED');
      if(responseMedia.length>1||newTiles.filter(t=>t.url&&!t.pending).length>1)throw Error('FLOW_AMBIGUOUS_OUTPUT');
      if(matched&&responseMedia.length===1){
        const m=responseMedia[0];
        // Correlate by asset id + project: the tile preview URL (flow.google.com/asb) differs from the response CDN URL; the download uses only the response URL.
        const tiles=newTiles.filter(t=>t.id===m.assetId&&t.project===o.projectId&&!t.pending&&t.width>=200&&t.height>=200);
        if(tiles.length===1){await o.onSubmissionState('GENERATING',{assetId:m.assetId,mediaUrl:m.url,promptSha256});return {ok:true,state:'GENERATING',remoteMediaReady:true,firstImageUrl:m.url,assetId:m.assetId,projectId:o.projectId,sceneId:o.sceneId,promptSha256};}
      }
      await page.waitForTimeout(200);
    }
    throw Error('FLOW_TIMEOUT_RECONCILIATION_REQUIRED');
  }catch(e){
    const state=reserved&&(touched||clickStarted)?'RECONCILIATION_REQUIRED':'NOT_SUBMITTED';
    if(reserved)await o.onSubmissionState(state,{promptSha256});
    return result(state,o.signal?.aborted?'FLOW_CANCELLED':(e instanceof Error&&/^FLOW_[A-Z_]+$/.test(e.message)?e.message:'FLOW_RECONCILIATION_REQUIRED'));
  }finally{closed=true;context.off('request',onRequest);context.off('response',onResponse);}
}
