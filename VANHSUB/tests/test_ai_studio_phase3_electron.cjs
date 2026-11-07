// Real production Electron + native render, isolated from Beta and provider accounts.
// Only OS picker return values are stubbed; actual trusted IPC validates every import.
const assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path'),crypto=require('node:crypto');
const {_electron}=require('playwright-core'),{execFileSync}=require('node:child_process');
const ffmpeg=require('@ffmpeg-installer/ffmpeg'),ffprobe=require('@ffprobe-installer/ffprobe');
const hash=p=>crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex');
(async()=>{
 const stage=process.env.VANHSUB_UAT_BUILD,input=JSON.parse(fs.readFileSync('temp/aistudio-phase3/long-input.json'));
 const manifest=JSON.parse(fs.readFileSync(path.join(stage,'build-check-result.json')));assert.ok(manifest.results.every(x=>x.exitCode===0));
 const previous=process.env.VANHSUB_PHASE3_EXISTING?JSON.parse(fs.readFileSync(process.env.VANHSUB_PHASE3_EXISTING)):null;
 const root=previous?.root||fs.mkdtempSync(path.join(os.tmpdir(),'VANHSUB tiếng Việt Phase3 ')),projectId='phase3-ai-race-vi',checks=[],pids=[];
 const env={...process.env,NODE_ENV:'production',VANHSUB_AUDIT_USER_DATA_DIR:path.join(root,'user'),VANHSUB_AI_STUDIO_DIR:path.join(root,'studio'),VANHSUB_SETTINGS_DIR:path.join(root,'settings'),VANHSUB_TASKS_DIR:path.join(root,'tasks'),VANHSUB_BIBLE_DIR:path.join(root,'bible'),VANHSUB_VOICE_SAMPLES_DIR:path.join(root,'samples'),VANHSUB_DISABLE_FLOW_BRIDGE:'1',VANHSUB_ALLOW_INSECURE_TEST_SECRETS:'0'};
 delete env.ELECTRON_RUN_AS_NODE;delete env.NODE_OPTIONS;
 let app,page,sessionId;
 const read=()=>page.evaluate(id=>window.vanhsub.aiStudio.getPipelineState({sessionId:id}),sessionId);
 const launch=async()=>{
  app=await _electron.launch({executablePath:path.join(manifest.dependencies,'electron/dist/electron.exe'),args:[stage],cwd:stage,env,timeout:30000});
  pids.push(await app.evaluate(()=>process.pid));page=await app.firstWindow();page.setDefaultTimeout(15000);
  await page.waitForFunction(()=>!!window.vanhsub?.aiStudio);
  const onboarding=page.getByRole('dialog',{name:'Hướng dẫn VANHSUB',exact:true});await onboarding.waitFor({timeout:1500}).catch(()=>{});
  if(await onboarding.isVisible())await onboarding.getByTitle('Đóng (Esc)',{exact:true}).click();
 };
 const enter=async()=>{await page.getByRole('button',{name:'AI Studio HOT',exact:true}).click();await page.getByRole('button',{name:'Vào Studio Tiếp Tục',exact:true}).click();};
 try{
  await launch();assert.equal(await app.evaluate(({app})=>app.getPath('userData')),path.join(root,'user'));
  if(previous){
   sessionId=previous.sessionId;await enter();await page.getByText('Storyboard thủ công · media nhập từ máy',{exact:true}).waitFor();
   const stored=await read();assert.equal(hash(stored.artifacts.audioPath),previous.audioHash);assert.equal(hash(stored.artifacts.videoPath),previous.videoHash);
   checks.push('Reopen previously accepted 49-scene project on final render build; do not repeat unchanged imports/TTS');
  }else{
  await page.evaluate(async({root,projectId})=>{
   const api=window.vanhsub.aiStudio,c=await api.getConfig();const profile={...c.channelProfile,projectName:'Cuộc đua AI 2023–2026',channelNiche:'Công nghệ',aiProvider:'default',ttsEngine:'piper_local',specificVoice:'vi_VN-vais1000-medium'};
   await api.updateConfig({activeProjectId:projectId,channelProfile:profile,llm:{...c.llm,apiKey:''},flowEngine:{...c.flowEngine,aspectRatio:'16:9'},rendering:{...c.rendering,resolution:'720p',fps:30,kenBurnsEffect:false},subtitles:{...c.subtitles,enabled:true},savedProjects:[{id:projectId,name:'Cuộc đua AI 2023–2026',channelProfile:profile,outputDir:root,updatedAt:Date.now()}]});
  },{root:path.join(root,'Dự án nghiệm thu'),projectId});
  await page.reload();await enter();
  await app.evaluate(({dialog},files)=>{dialog.showOpenDialog=async()=>{if(!files.length)throw Error('Unexpected picker');return {canceled:false,filePaths:[files.shift()]};};},[input.srt,input.audio,...input.cues.map(c=>input.images[c.imageIndex])]);
  await page.getByRole('button',{name:'Nhập SRT + audio thủ công',exact:true}).click();await page.getByText('Storyboard thủ công · media nhập từ máy',{exact:true}).waitFor();
  sessionId=await page.evaluate(async id=>(await window.vanhsub.aiStudio.getConfig()).savedProjects.find(p=>p.id===id).lastSessionId,projectId);
  let state=await read();assert.equal(state.manualMode,true);assert.equal(state.artifacts.scenes.length,49);
  assert.equal(await page.getByRole('button',{name:'Xuất video thủ công',exact:true}).isDisabled(),true);
  assert.match(await page.locator('[data-stage="8"]').innerText(),/Bỏ qua/);
  assert.match(await page.locator('[data-stage="3"]').innerText(),/Nhập thủ công/);
  for(let i=0;i<input.cues.length;i++){
   await page.getByRole('button',{name:'Chọn ảnh',exact:true}).nth(i).click();
   const deadline=Date.now()+20000;let imported=false;
   while(Date.now()<deadline){if((await read()).artifacts.scenes[i].status==='ready'){imported=true;break;}await page.waitForTimeout(100);}
   assert.ok(imported,`Scene ${i+1} import did not finish`);
   await page.waitForFunction(index=>{const b=[...document.querySelectorAll('button')].filter(b=>b.textContent.trim()==='Chọn ảnh')[index];return b&&!b.disabled;},i);
  }
  await page.getByRole('button',{name:'Xuất video thủ công',exact:true}).waitFor();
  state=await read();
  for(let i=0;i<49;i++){
   const scene=state.artifacts.scenes[i],p=scene.mediaProvenance;
   assert.equal(scene.status,'ready');assert.ok(scene.assetPath.startsWith(path.join(root,'Dự án nghiệm thu')));
   assert.equal(hash(scene.assetPath),hash(input.images[input.cues[i].imageIndex]));
   assert.equal(p.source,'manual_import');assert.equal(p.sessionId,sessionId);assert.equal(p.sceneId,scene.shotId||scene.id);assert.equal(p.projectId,projectId);assert.equal(p.automaticGeneration,false);assert.equal(p.sha256,hash(scene.assetPath));
  }
  const audioHash=hash(state.artifacts.audioPath),sceneHashes=state.artifacts.scenes.map(s=>hash(s.assetPath));
  checks.push('UI import real 236s Vietnamese audio/SRT and 49 scene images; validate every SHA256, project/scene ownership and manual provenance');
  await app.close();app=null;await launch();await enter();
  await page.getByText('Storyboard thủ công · media nhập từ máy',{exact:true}).waitFor();state=await read();assert.equal(hash(state.artifacts.audioPath),audioHash);assert.deepEqual(state.artifacts.scenes.map(s=>hash(s.assetPath)),sceneHashes);
  checks.push('Real Electron restart before render preserves all 49 media artifacts and actual narration');
  // Rename only a file created by this isolated test; restore in finally.
  const missing=state.artifacts.scenes[0].assetPath;fs.renameSync(missing,missing+'.test-held');
  try{
   await page.getByRole('button',{name:'Xuất video thủ công',exact:true}).click();
   await page.waitForFunction(()=>{const b=[...document.querySelectorAll('button')].find(b=>b.textContent==='Xuất video thủ công');return b&&!b.disabled;});
   state=await read();assert.equal(state.artifacts.videoPath,undefined);assert.equal(hash(state.artifacts.audioPath),audioHash);
  }finally{fs.renameSync(missing+'.test-held',missing);}
  checks.push('Missing scene file preflight returns UI to idle and preserves completed audio');
  }
  let state=await read();const audioHash=hash(state.artifacts.audioPath),beforeVideo=state.artifacts.videoPath;
  const started=Date.now();await page.getByRole('button',{name:'Xuất video thủ công',exact:true}).click();
  const renderDeadline=Date.now()+300000;let newOutput=false;
  while(Date.now()<renderDeadline){state=await read();if(!state.jobActive&&state.artifacts.videoPath&&state.artifacts.videoPath!==beforeVideo){newOutput=true;break;}await page.waitForTimeout(200);}
  assert.ok(newOutput,'UI render did not produce a new completed artifact');
  await page.getByText('Đã hoàn tất: Storyboard thủ công từ SRT',{exact:true}).waitFor({timeout:300000});
  const renderElapsedMs=Date.now()-started;state=await read();assert.equal(state.status,'completed');assert.equal(state.stages[8].status,previous?'success':'skipped');
  const video=state.artifacts.videoPath,probe=JSON.parse(execFileSync(ffprobe.path,['-v','error','-show_streams','-show_format','-of','json',video],{encoding:'utf8',windowsHide:true}));
  const vs=probe.streams.find(s=>s.codec_type==='video'),as=probe.streams.find(s=>s.codec_type==='audio');assert.equal(vs.width,1280);assert.equal(vs.height,720);assert.equal(vs.codec_name,'h264');assert.equal(as.codec_name,'aac');
  assert.ok(Math.abs(Number(probe.format.duration)-input.durationMs/1000)<0.15);assert.ok(Math.abs(Number(as.duration)-input.durationMs/1000)<0.15);
  execFileSync(ffmpeg.path,['-v','error','-xerror','-i',video,'-f','null','-'],{windowsHide:true,timeout:90000});
  const videoHash=hash(video);checks.push('Real UI 720p30 16:9 3m56s FFmpeg render, full decode and audio/video duration validation');
  if(previous){assert.equal(hash(previous.video),previous.videoHash);checks.push('Rerender creates a new output and preserves the previous completed MP4 hash');}
  await page.getByText('SEO nhập thủ công — không gọi LLM hoặc đăng tải',{exact:true}).click();
  await page.getByLabel('Tiêu đề SEO thủ công',{exact:true}).fill(input.seo.title);await page.getByLabel('Mô tả SEO thủ công',{exact:true}).fill(input.seo.description);await page.getByLabel('Hashtags SEO thủ công',{exact:true}).fill(input.seo.hashtags.join(' '));await page.getByRole('button',{name:'Lưu SEO thủ công',exact:true}).click();
  await page.getByText('SEO đã lưu · người dùng biên soạn',{exact:true}).waitFor();state=await read();assert.equal(state.artifacts.metadata.source,'manual_authored');assert.match(await page.locator('[data-stage="8"]').innerText(),/Nhập thủ công/);
  await page.screenshot({path:'temp/aistudio-phase3/ui-long-completed.png'});
  await app.close();app=null;await launch();await enter();await page.getByText('Đã hoàn tất: Storyboard thủ công từ SRT',{exact:true}).waitFor();
  state=await read();assert.equal(hash(state.artifacts.videoPath),videoHash);assert.equal(hash(state.artifacts.audioPath),audioHash);assert.equal(state.artifacts.metadata.source,'manual_authored');assert.equal(state.stages[8].status,'success');
  checks.push('Manual SEO UI save and second real restart preserve completed output hashes and metadata provenance');
  fs.writeFileSync('temp/aistudio-phase3/electron-result.json',JSON.stringify({stage,root,sessionId,video,videoHash,audioHash,renderElapsedMs,durationSec:Number(probe.format.duration),width:vs.width,height:vs.height,fps:vs.r_frame_rate,checks,pids,baselineAcceptance:process.env.VANHSUB_PHASE3_EXISTING,tts:'real native installed Piper vi_VN',script:'manually authored',images:'original diagrams',timing:'estimated_per_line',liveLlm:false,liveMediaProvider:false,osPicker:'return values stubbed in baseline import; trusted IPC validation unchanged'},null,2));
  console.log(JSON.stringify({checks,renderElapsedMs,durationSec:probe.format.duration}));
 }catch(e){if(page&&!page.isClosed()){await page.screenshot({path:'temp/aistudio-phase3/electron-failure.png'}).catch(()=>{});fs.writeFileSync('temp/aistudio-phase3/electron-failure.txt',await page.locator('body').innerText().catch(()=>''));}throw e;}
 finally{await app?.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
