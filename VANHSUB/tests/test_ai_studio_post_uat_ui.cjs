const assert = require('node:assert/strict'), fs = require('node:fs'), os = require('node:os'), path = require('node:path');
const esbuild = require('esbuild'), { chromium } = require('playwright-core'), { pathToFileURL } = require('node:url');
(async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'studio-post-uat-ui-')); let browser;
  try {
    await esbuild.build({ stdin: { resolveDir: process.cwd(), loader: 'tsx', contents: `
      import React from 'react'; import {createRoot} from 'react-dom/client';
      import {AutoPilotHeader} from './renderer/components/ai-studio/autopilot/AutoPilotHeader';
      import ScriptWorkspaceView from './renderer/components/ai-studio/ScriptWorkspaceView';
      import ChannelConfigModal from './renderer/components/ai-studio/ChannelConfigModal';
      import AiStudioSettingsTab from './renderer/components/ai-studio/AiStudioSettingsTab';
      import {useAiStudioStore,mergeAiStudioConfig} from './renderer/lib/store/aiStudioStore';
      import {DEFAULT_AI_STUDIO_CONFIG} from './renderer/types/aiStudio';
      window.voiceCalls=0; window.voiceReply='success'; window.pendingVoices=[];
      window.vanhsub={tiktokTts:{status:async()=>({hasSession:false})},aiStudio:{getKokoroVoices:async()=>{
        window.voiceCalls++; if(window.voiceReply==='error')throw Error("Error invoking remote method 'aiStudio:voices:kokoro': Error: Server unavailable");
        if(window.voiceReply==='defer')return new Promise(r=>window.pendingVoices.push(r));
        return window.voiceReply==='empty'?[]:[{id:'af_heart',name:'Heart'}];
      }}};
      const root=createRoot(document.getElementById('root')); const noop=()=>{};
      const config=structuredClone(DEFAULT_AI_STUDIO_CONFIG); useAiStudioStore.setState({config});
      window.settings=()=>{
        const before={...config,llm:{...config.llm,provider:'custom',apiKey:'fixture-key',model:'fixture-model',baseUrl:'https://example.invalid/v1'}};
        window.providerOnlyMerged=mergeAiStudioConfig(before,{llm:{provider:'openai'}}).llm;
        useAiStudioStore.setState({config:before});
        let current=before;
        window.vanhsub.aiStudio.updateConfig=async patch=>{window.savedPatch=patch;current=mergeAiStudioConfig(current,patch);return current;};
        root.render(<AiStudioSettingsTab/>);
      };
      window.header=(status)=>root.render(<AutoPilotHeader projectName="Test" activeTab="video" aiProviderName="DeepSeek"
        session={JSON.parse(JSON.stringify({sessionId:'fixture',topic:'Fixture topic',status}))} ideasCount={0}
        isRunning={status==='running'} isGatedMode={true} onTabChange={noop} onToggleFlowLive={noop} onOpenChannelConfig={noop}
        onOpenAdvancedDrawer={noop} onToggleGatedMode={noop} onCancelRun={noop} onResumeRun={noop}/>);
      window.workspace=(text,status='awaiting_approval',id='fixture')=>root.render(<ScriptWorkspaceView session={{sessionId:id,topic:'Test',
        currentStage:2,status,stages:{2:{status:'success'}},artifacts:{scriptLines:text===null?[]:[{id:'line',index:1,text}]}} as any}
        onProceedToVoice={noop} onRegenerateScript={noop} onBackToIdeas={noop}/>);
      window.channel=(open=true,engine='kokoro_tts')=>{
        useAiStudioStore.setState({config:{...config,channelProfile:{...config.channelProfile,ttsEngine:engine}}});
        root.render(<ChannelConfigModal isOpen={open} onClose={noop}/>);
      };
    ` }, bundle: true, platform: 'browser', format: 'iife', outfile: path.join(dir, 'bundle.js') });
    fs.writeFileSync(path.join(dir, 'index.html'), '<div id="root"></div><script src="bundle.js"></script>');
    browser = await chromium.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true });
    const page = await browser.newPage(); page.setDefaultTimeout(5000);
    await page.goto(pathToFileURL(path.join(dir, 'index.html')).href);
    for (const [status, label] of Object.entries({failed:'Đã thất bại',running:'Đang xử lý',awaiting_approval:'Chờ duyệt',paused:'Tạm dừng',error:'Đã thất bại',cancelled:'Đã hủy',completed:'Đã hoàn tất',idle:'Sẵn sàng'})) {
      await page.evaluate(status => window.header(status), status);
      await page.getByText(`${label}: Fixture topic`, { exact: true }).waitFor();
      assert.equal(await page.getByText(/AI 3\/5/).count(), 0);
      await page.getByText(/^Chưa đánh giá · DeepSeek$/).waitFor();
    }
    const voice = () => page.getByRole('button', { name: 'Tiếp tục: Duyệt & Lồng tiếng ▸', exact: true });
    const score = () => page.getByRole('button', { name: 'Chấm lại điểm', exact: true });
    const improve = () => page.getByRole('button', { name: 'Cải thiện điểm', exact: true });
    await page.evaluate(() => window.workspace('Xin chào, đây là kịch bản hợp lệ.'));
    await voice().waitFor(); assert.equal(await voice().isEnabled(), true); assert.equal(await score().isEnabled(), true);
    await page.evaluate(() => window.workspace(null, 'failed', 'empty-session'));
    await page.waitForFunction(() => document.body.textContent.includes('0 phân đoạn'));
    for (const button of [voice(), score(), improve()]) assert.equal(await button.isDisabled(), true);
    await page.evaluate(() => window.workspace('... ⭐', 'awaiting_approval'));
    for (const button of [voice(), score(), improve()]) await button.waitFor();
    assert.equal(await voice().isDisabled(), true); assert.equal(await score().isDisabled(), true);
    await page.evaluate(() => window.workspace('Nội dung còn lại', 'failed'));
    await page.waitForFunction(() => document.body.textContent.includes('Nội dung còn lại'));
    assert.equal(await voice().isDisabled(), true, 'Failed stage cannot be approved directly');

    await page.evaluate(() => { window.voiceReply='defer'; window.channel(); });
    await page.getByText('Đang tải danh sách giọng Kokoro...', { exact: true }).waitFor();
    await page.waitForFunction(() => window.pendingVoices.length === 1);
    await page.evaluate(() => window.pendingVoices.shift()([{id:'af_heart',name:'Heart'}]));
    await page.getByText('Đã tải 1 giọng Kokoro.', { exact: true }).waitFor();
    const retry = page.getByRole('button', { name: 'Tải lại giọng Kokoro', exact: true });
    await page.evaluate(() => window.voiceReply='empty'); await retry.click();
    await page.getByText('Server Kokoro chưa có giọng khả dụng.', { exact: true }).waitFor();
    await page.evaluate(() => window.voiceReply='error'); await retry.click();
    await page.getByText('Server unavailable', { exact: true }).waitFor();
    const calls = await page.evaluate(() => window.voiceCalls);
    await page.waitForTimeout(200); assert.equal(await page.evaluate(() => window.voiceCalls), calls, 'No automatic retry loop');
    await page.evaluate(() => window.voiceReply='success'); await retry.click();
    await page.getByText('Đã tải 1 giọng Kokoro.', { exact: true }).waitFor();
    await page.evaluate(() => { window.voiceReply='defer'; window.channel(false); });
    await page.getByRole('heading', {name:'Cấu hình kênh',exact:false}).waitFor({state:'hidden'});
    await page.evaluate(() => window.channel(true)); await page.waitForFunction(() => window.pendingVoices.length === 1);
    await page.evaluate(() => window.channel(true, 'tiktok_tts'));
    await page.evaluate(() => window.pendingVoices.shift()([{id:'late',name:'Late voice'}]));
    assert.equal(await page.getByText('Đã tải 1 giọng Kokoro.', {exact:true}).count(), 0);
    await page.evaluate(()=>window.settings());
    await page.getByPlaceholder('sk-...').waitFor();
    assert.equal(await page.getByPlaceholder('sk-...').inputValue(),'fixture-key');
    assert.equal(await page.getByLabel('Custom LLM Base URL').inputValue(),'https://example.invalid/v1');
    await page.locator('select').first().selectOption('openai');
    assert.equal(await page.getByPlaceholder('sk-...').inputValue(),'');
    assert.equal(await page.getByPlaceholder('deepseek-chat').inputValue(),'');
    await page.getByRole('status').filter({hasText:'Thiếu API Key'}).waitFor();
    await page.getByRole('button',{name:'Lưu cấu hình',exact:true}).click();
    await page.waitForFunction(()=>Boolean(window.savedPatch));
    const saved=await page.evaluate(()=>({patch:window.savedPatch.llm,optimistic:window.providerOnlyMerged}));
    for(const llm of [saved.patch,saved.optimistic]){
      assert.equal(llm.provider,'openai');assert.equal(llm.apiKey,'');assert.equal(llm.model,'');assert.equal(llm.baseUrl,undefined);
    }
    await page.locator('select').nth(1).selectOption('local_onnx');
    assert.equal(await page.getByLabel('Kokoro Base URL (HTTP loopback)',{exact:true}).inputValue(),'http://127.0.0.1:8880/v1');
    assert.equal(await page.getByLabel('Kokoro voice ID',{exact:true}).inputValue(),'af_heart');
    await page.getByLabel('Kokoro Base URL (HTTP loopback)',{exact:true}).fill('http://127.0.0.1:8899/v1');
    await page.getByRole('button',{name:'Lưu cấu hình',exact:true}).click();
    await page.waitForFunction(()=>window.savedPatch?.voice?.kokoroBaseUrl==='http://127.0.0.1:8899/v1');
    console.log('PASS: mounted React session statuses, unmeasured AI badge, empty/stale/failed script actions and Kokoro loading/success/empty/error/retry/late response. Fixture IPC; not live provider or Electron E2E.');
  } finally { await browser?.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
