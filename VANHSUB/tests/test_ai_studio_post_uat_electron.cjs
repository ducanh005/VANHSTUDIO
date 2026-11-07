// Production renderer/preload/main acceptance in an entirely new test profile.
// Requires build-check output; never launches the installed Beta or reads its data.
const assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path'),crypto=require('node:crypto');
const {_electron}=require('playwright-core');
const http=require('node:http'),{once}=require('node:events');
const {execFileSync}=require('node:child_process'),ffmpeg=require('@ffmpeg-installer/ffmpeg'),ffprobe=require('@ffprobe-installer/ffprobe');
(async()=>{
  const stage=process.env.VANHSUB_UAT_BUILD;
  assert.ok(stage && fs.existsSync(path.join(stage,'build-check-result.json')), 'Supply a private build-check stage');
  const manifest=JSON.parse(fs.readFileSync(path.join(stage,'build-check-result.json')));
  assert.ok(manifest.results.every(x=>x.exitCode===0));
  const server=http.createServer((_req,res)=>{res.statusCode=503;res.setHeader('Content-Type','application/json');res.end(JSON.stringify({error:{message:'Offline fixture unavailable'}}));});
  server.listen(0,'127.0.0.1');await once(server,'listening');
  const endpoint=`http://127.0.0.1:${server.address().port}/v1`;
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'studio-post-uat-electron-'));
  const env={...process.env,NODE_ENV:'production',VANHSUB_AUDIT_USER_DATA_DIR:path.join(root,'user'),
    VANHSUB_AI_STUDIO_DIR:path.join(root,'studio'),VANHSUB_SETTINGS_DIR:path.join(root,'settings'),
    VANHSUB_TASKS_DIR:path.join(root,'tasks'),VANHSUB_BIBLE_DIR:path.join(root,'bible'),
    VANHSUB_VOICE_SAMPLES_DIR:path.join(root,'samples'),VANHSUB_DISABLE_FLOW_BRIDGE:'1',VANHSUB_ALLOW_INSECURE_TEST_SECRETS:'0'};
  delete env.ELECTRON_RUN_AS_NODE;delete env.NODE_OPTIONS;
  const executablePath=path.join(manifest.dependencies,'electron/dist/electron.exe');
  let app,page;const checks=[],mainPids=[];let sessionId, factPath, factHash,runtimeVersion;
  const launch=async()=>{
    app=await _electron.launch({executablePath,args:[stage],cwd:stage,env,timeout:30000});
    const runtime=await app.evaluate(()=>({pid:process.pid,version:process.versions.electron}));mainPids.push(runtime.pid);runtimeVersion=runtime.version;
    page=await app.firstWindow({timeout:30000});page.setDefaultTimeout(10000);
    await page.waitForFunction(()=>Boolean(window.vanhsub?.aiStudio),{timeout:30000});
    const onboarding=page.getByRole('dialog',{name:'Hướng dẫn VANHSUB',exact:true});
    await onboarding.waitFor({state:'visible',timeout:2000}).catch(()=>{});
    if(await onboarding.isVisible()) await onboarding.getByTitle('Đóng (Esc)',{exact:true}).click();
    await page.getByRole('button',{name:'AI Studio HOT',exact:true}).waitFor();
  };
  const read=()=>page.evaluate(id=>window.vanhsub.aiStudio.getPipelineState({sessionId:id}),sessionId);
  const settled=async()=>{for(let i=0;i<200;i++){const s=await read();if(!s.jobActive)return s;await page.waitForTimeout(30);}throw Error('Pipeline did not settle');};
  const saveProjectSession=async state=>page.evaluate(async state=>{
    const api=window.vanhsub.aiStudio,c=await api.getConfig();
    await api.updateConfig({savedProjects:c.savedProjects.map(p=>p.id==='post-uat-fixture'?{...p,lastSessionId:state.sessionId,savedSession:state}:p)});
  },state);
  const enter=async()=>{
    const onboarding=page.getByRole('dialog',{name:'Hướng dẫn VANHSUB',exact:true});
    if(await onboarding.isVisible()) await onboarding.getByTitle('Đóng (Esc)',{exact:true}).click();
    await page.getByRole('button',{name:'AI Studio HOT',exact:true}).click();
    await page.getByRole('button',{name:'Vào Studio Tiếp Tục',exact:true}).click();
  };
  try{
    await launch();
    const actualProfile=await app.evaluate(({app})=>app.getPath('userData'));assert.equal(actualProfile,path.join(root,'user'));
    const providerSwitch=await page.evaluate(async()=>{
      const api=window.vanhsub.aiStudio;
      await api.updateConfig({llm:{provider:'deepseek',apiKey:'synthetic-test-key',model:'synthetic-model',baseUrl:'https://example.invalid/v1'}});
      const next=await api.updateConfig({llm:{provider:'openai'}});
      return {provider:next.llm.provider,keyCleared:next.llm.apiKey==='',modelCleared:next.llm.model==='',urlCleared:next.llm.baseUrl===undefined};
    });
    assert.deepEqual(providerSwitch,{provider:'openai',keyCleared:true,modelCleared:true,urlCleared:true});
    checks.push('Real settings IPC provider-only switch clears foreign DPAPI credential/model/endpoint');
    await page.evaluate(async output=>{
      const api=window.vanhsub.aiStudio,c=await api.getConfig();
      const profile={...c.channelProfile,projectName:'Post UAT fixture',channelNiche:'Offline acceptance',channelOrientation:'Test',aiProvider:'deepseek',ttsEngine:'kokoro_tts'};
      await api.updateConfig({activeProjectId:'post-uat-fixture',channelProfile:profile,llm:{...c.llm,provider:'deepseek',apiKey:''},
        savedProjects:[{id:'post-uat-fixture',name:'Post UAT fixture',channelProfile:profile,outputDir:output,updatedAt:Date.now()}]});
    },path.join(root,'project'));
    const missing=await page.evaluate(async()=>{try{await window.vanhsub.aiStudio.autoFillIdea({topic:'Offline acceptance',aspectRatio:'16:9'});return '';}catch(e){return e.message;}});
    assert.match(missing,/API Key.*deepseek/);checks.push('Actual missing-key IPC rejection');
    const readiness=await page.evaluate(()=>window.vanhsub.aiStudio.getReadiness());assert.equal(readiness.ready,false);
    const denied=await page.evaluate(async()=>{try{await window.vanhsub.aiStudio.startPipeline({topic:'Missing configuration'});return '';}catch(e){return e.message;}});assert.match(denied,/API Key/);
    await page.evaluate(async endpoint=>{await window.vanhsub.aiStudio.updateConfig({llm:{provider:'custom',apiKey:'synthetic-fixture-key',model:'fixture-model',baseUrl:endpoint},channelProfile:{aiProvider:'default',specificVoice:'af_heart'},voice:{kokoroBaseUrl:endpoint}});},endpoint);
    ({sessionId}=await page.evaluate(()=>window.vanhsub.aiStudio.startPipeline({projectId:'post-uat-fixture',topic:'Offline acceptance',
      blueprint:{topic:'Offline acceptance',title:'Offline acceptance',outline:['Manually supplied fixture fact']},gatedMode:true})));
    let state=await settled();assert.equal(state.status,'awaiting_approval');
    factPath=path.join(state.workspaceDir,'00_facts/facts.json');factHash=crypto.createHash('sha256').update(fs.readFileSync(factPath)).digest('hex');
    await page.evaluate(id=>window.vanhsub.aiStudio.approveStage({sessionId:id,currentStage:1}),sessionId);
    state=await settled();assert.equal(state.status,'failed');assert.match(state.error,/503/);
    for(const method of ['evaluateScript','refineScript']){
      const message=await page.evaluate(async({method,id})=>{try{await window.vanhsub.aiStudio[method]({sessionId:id,lines:[{id:'injected',index:1,text:'Caller cannot replace an absent canonical script.'}]});return '';}catch(e){return e.message;}},{method,id:sessionId});
      assert.match(message,/Kịch bản/);
    }
    const invalidResume=await page.evaluate(async id=>{try{await window.vanhsub.aiStudio.resumePipeline({sessionId:id,fromStage:3});return '';}catch(e){return e.message;}},sessionId);
    assert.match(invalidResume,/chưa hoàn tất|Kịch bản/);
    checks.push('Canonical empty-script IPC evaluate/refine/resume guards');
    await saveProjectSession(state);
    // Fixture setup used real IPC outside the renderer store; reload to read its persisted catalog.
    await page.reload();await page.getByRole('button',{name:'AI Studio HOT',exact:true}).waitFor();await enter();
    await page.getByText('Đã thất bại: Offline acceptance',{exact:true}).waitFor();
    assert.equal(await page.getByText(/AI 3\/5/).count(),0);
    for(const name of ['Tiếp tục: Duyệt & Lồng tiếng ▸','Chấm lại điểm','Cải thiện điểm']){
      assert.equal(await page.getByRole('button',{name,exact:true}).isDisabled(),true);
    }
    checks.push('Production renderer failed-state label and empty-script actions');
    await app.close();app=null;await launch();await enter();
    await page.getByText('Đã thất bại: Offline acceptance',{exact:true}).waitFor();
    state=await read();assert.equal(state.currentStage,2);assert.equal(state.status,'failed');
    assert.equal(crypto.createHash('sha256').update(fs.readFileSync(factPath)).digest('hex'),factHash);
    checks.push('Separate-profile restart retains failed stage/facts and accurate UI');
    const edit=await page.evaluate(id=>window.vanhsub.aiStudio.updateScriptLines({sessionId:id,lines:[{id:'line',index:1,text:'Manually authored valid test narration.'}]}),sessionId);
    assert.equal(edit.success,true);await saveProjectSession(edit.session);
    await page.reload();await page.getByRole('button',{name:'AI Studio HOT',exact:true}).waitFor();await enter();
    assert.equal(await page.getByRole('button',{name:'Tiếp tục: Duyệt & Lồng tiếng ▸',exact:true}).isEnabled(),true);
    await page.evaluate(id=>window.vanhsub.aiStudio.approveStage({sessionId:id,currentStage:2}),sessionId);
    state=await settled();assert.equal(state.currentStage,3);assert.equal(state.status,'failed');assert.match(state.error,/Kokoro.*503/);
    assert.equal(state.artifacts.audioPath,undefined);checks.push('Valid manual script passes gate; Kokoro HTTP 503 fails closed without Edge fallback');
    const voices=await page.evaluate(async()=>{try{return {voices:await window.vanhsub.aiStudio.getKokoroVoices()};}catch(e){return {error:e.message};}});
    assert.ok(Array.isArray(voices.voices)||/Không tải được giọng Kokoro/.test(voices.error));
    checks.push(voices.error?'Actual Kokoro catalog IPC bounded unavailable error':'Actual local catalog IPC returns schema-valid voices; synthesis not tested');
    await page.getByRole('button',{name:'⚙ Cấu hình',exact:true}).click();
    await page.getByRole('heading',{name:'Cấu hình kênh',exact:false}).waitFor();
    await page.waitForFunction(()=>{const button=document.querySelector('[aria-label="Tải lại giọng Kokoro"]');return button&&!button.disabled;});
    assert.equal(await page.getByText('Đang tải danh sách giọng Kokoro...',{exact:true}).count(),0);
    await page.screenshot({path:'temp/aistudio-phase2/ui-kokoro.png'});
    checks.push('Production Kokoro modal leaves loading and enables explicit retry');
    await page.getByText('Đóng',{exact:true}).click();
    const audio=path.join(root,'Giọng đọc thử.wav'),srt=path.join(root,'Phụ đề thử.srt'),image=path.join(root,'Ảnh thử.png');
    execFileSync(ffmpeg.path,['-v','error','-i',path.resolve('node_modules/nodejs-whisper/cpp/whisper.cpp/bindings/go/samples/jfk.wav'),'-t','2','-ar','24000',audio],{windowsHide:true});
    execFileSync(ffmpeg.path,['-v','error','-f','lavfi','-i','color=blue:s=1280x720','-frames:v','1',image],{windowsHide:true});
    fs.writeFileSync(srt,'1\n00:00:00,000 --> 00:00:02,000\nManual subtitle fixture.\n');
    // Only the OS picker return value is a fixture. Trusted IPC still grants path capabilities normally.
    await app.evaluate(({dialog},files)=>{dialog.showOpenDialog=async()=>{if(!files.length)throw Error('Unexpected file picker');return {canceled:false,filePaths:[files.shift()]};};},[srt,audio,image]);
    await page.evaluate(()=>window.vanhsub.aiStudio.updateConfig({llm:{apiKey:''},rendering:{resolution:'720p',fps:30}}));
    await page.getByRole('button',{name:'Nhập SRT + audio thủ công',exact:true}).click();
    await page.getByText('Storyboard thủ công · media nhập từ máy',{exact:true}).waitFor();
    assert.equal(await page.getByText('Kokoro: server trả HTTP 503; không tự thử lại.',{exact:true}).count(),0,'New manual episode must not inherit the previous session error');
    await page.waitForFunction(async old=>{const c=await window.vanhsub.aiStudio.getConfig();const id=c.savedProjects.find(p=>p.id==='post-uat-fixture').lastSessionId;return id&&id!==old;},sessionId);
    const manualSession=await page.evaluate(async()=>{const c=await window.vanhsub.aiStudio.getConfig();return c.savedProjects.find(p=>p.id==='post-uat-fixture').lastSessionId;});
    assert.ok(manualSession&&manualSession!==sessionId);
    const manualRead=()=>page.evaluate(id=>window.vanhsub.aiStudio.getPipelineState({sessionId:id}),manualSession);
    let manual=await manualRead();assert.equal(manual.manualMode,true);assert.equal(manual.artifacts.scenes.length,1);
    assert.equal(await page.getByRole('button',{name:'Xuất video thủ công',exact:true}).isDisabled(),true);
    await page.getByRole('button',{name:'Chọn ảnh',exact:true}).click();
    await page.waitForFunction(()=>{const button=[...document.querySelectorAll('button')].find(b=>b.textContent==='Xuất video thủ công');return button&&!button.disabled;});
    manual=await manualRead();const imported=manual.artifacts.scenes[0];
    assert.equal(imported.status,'ready');assert.deepEqual(fs.readFileSync(imported.assetPath),fs.readFileSync(image));
    assert.ok(imported.assetPath.startsWith(path.join(root,'project')));
    const audioHash=crypto.createHash('sha256').update(fs.readFileSync(manual.artifacts.audioPath)).digest('hex');
    await page.getByRole('button',{name:'Xuất video thủ công',exact:true}).click();
    await page.getByText('Đã hoàn tất: Storyboard thủ công từ SRT',{exact:true}).waitFor({timeout:60000});
    manual=await manualRead();assert.equal(manual.status,'completed');assert.equal(manual.stages[8].status,'skipped');
    const video=manual.artifacts.videoPath;
    const probe=JSON.parse(execFileSync(ffprobe.path,['-v','error','-show_streams','-show_format','-of','json',video],{encoding:'utf8',windowsHide:true}));
    assert.ok(probe.streams.some(s=>s.codec_type==='video'));assert.ok(probe.streams.some(s=>s.codec_type==='audio'));
    assert.ok(Math.abs(Number(probe.format.duration)-2)<0.15);
    execFileSync(ffmpeg.path,['-v','error','-xerror','-i',video,'-f','null','-'],{windowsHide:true});
    const videoHash=crypto.createHash('sha256').update(fs.readFileSync(video)).digest('hex');
    checks.push('UI manual SRT/speech import -> validated scene image -> real 720p FFmpeg export without LLM/Flow');
    await page.screenshot({path:'temp/aistudio-phase2/ui-manual-completed.png'});
    await app.close();app=null;await launch();await enter();
    await page.getByText('Đã hoàn tất: Storyboard thủ công từ SRT',{exact:true}).waitFor();
    manual=await manualRead();assert.equal(manual.status,'completed');
    assert.equal(crypto.createHash('sha256').update(fs.readFileSync(manual.artifacts.audioPath)).digest('hex'),audioHash);
    assert.equal(crypto.createHash('sha256').update(fs.readFileSync(manual.artifacts.videoPath)).digest('hex'),videoHash);
    checks.push('Completed manual export persists across real Electron restart with unchanged audio/video hashes');
    fs.writeFileSync('temp/aistudio-phase2/manual-output.json',JSON.stringify({root,video,videoHash,audioHash,durationSec:Number(probe.format.duration),width:probe.streams.find(s=>s.codec_type==='video').width,fixture:'Public speech + manually written SRT + FFmpeg fixture PNG; OS file picker selection stubbed; no live provider'},null,2));
    fs.writeFileSync('temp/aistudio-phase2/electron-result.json',JSON.stringify({stage,profile:root,checks,runtimeVersion,mainPids,liveProvider:false,fixtures:'manual text, public speech and fixture PNG; OS picker results stubbed; no live provider',catalogAvailable:!voices.error},null,2));
    console.log(JSON.stringify({checks,liveProvider:false}));
  }catch(error){
    if(page&&!page.isClosed()){
      await page.screenshot({path:'temp/aistudio-phase2/electron-failure.png'}).catch(()=>{});
      fs.writeFileSync('temp/aistudio-phase2/electron-failure.txt',await page.locator('body').innerText().catch(()=>''));
    }
    throw error;
  }finally{await app?.close();server.closeAllConnections();await new Promise(r=>server.close(r));}
})().catch(e=>{console.error(e);process.exitCode=1;});
