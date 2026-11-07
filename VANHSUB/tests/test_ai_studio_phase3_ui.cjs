// Component fixture only; never claims provider Live acceptance.
const assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const esbuild=require('esbuild'),{chromium}=require('playwright-core'),{pathToFileURL}=require('node:url');
(async()=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'studio-phase3-ui-'));let browser;
 try{
  await esbuild.build({stdin:{resolveDir:process.cwd(),loader:'tsx',contents:`
   import React from 'react';import{createRoot}from'react-dom/client';
   import{PipelineTrackerPanel}from'./renderer/components/ai-studio/autopilot/PipelineTrackerPanel';
   import{StoryboardGridPanel}from'./renderer/components/ai-studio/autopilot/StoryboardGridPanel';
   import ActionableErrorBanner from'./renderer/components/ai-studio/ActionableErrorBanner';
   import PiperRuntimeStatus from'./renderer/components/ai-studio/PiperRuntimeStatus';
   const root=createRoot(document.getElementById('root')),noop=()=>{};
   window.vanhsub={aiStudio:{getPiperStatus:async()=>({ready:true,voice:'vi_VN-vais1000-medium',language:'vi_VN',cpuOnly:true})}};
   window.tracker=(manual,empty)=>root.render(<PipelineTrackerPanel session={{sessionId:'ui',topic:'test',status:'awaiting_approval',currentStage:3,manualMode:manual,stages:{1:{status:'success'},3:{status:'success'},8:{status:'skipped'}},artifacts:empty?{}:{audioPath:'fixture.mp3',scriptLines:[{id:'a',index:1,text:'Lời đọc hợp lệ.'}]}} as any} isRunning={false} isApproving={false} selectedShotIds={[]} onApproveStage={noop} onRetryStage={noop} onCancelRun={noop} onResumeRun={noop} onToggleFlowLive={noop} isFlowWindowOpen={false} errorMessage={null} errorCode={null} countdownSeconds={null} onDismissError={noop} onOpenChromeBridge={noop} onOpenDiagnostics={noop} onOpenFolder={noop}/>);
   window.grid=()=>root.render(<StoryboardGridPanel session={{manualMode:true,artifacts:{scenes:[]}} as any}/>);
   window.error=(error)=>root.render(<ActionableErrorBanner error={error}/>);
   window.piper=()=>root.render(<PiperRuntimeStatus/>);
  `},bundle:true,platform:'browser',format:'iife',outfile:path.join(root,'bundle.js')});
  fs.writeFileSync(path.join(root,'index.html'),'<div id="root"></div><script src="bundle.js"></script>');
  browser=await chromium.launch({executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true});const page=await browser.newPage();page.setDefaultTimeout(5000);await page.goto(pathToFileURL(path.join(root,'index.html')).href);
  await page.evaluate(()=>window.tracker(false,true));const approve=page.getByRole('button',{name:'Tiếp tục (Duyệt)',exact:true});await approve.waitFor();assert.equal(await approve.isDisabled(),true);assert.equal(await page.getByRole('button',{name:'Tạm dừng',exact:true}).isEnabled(),true);
  await page.evaluate(()=>window.tracker(false,false));await page.waitForFunction(()=>![...document.querySelectorAll('button')].find(b=>b.textContent.includes('Tiếp tục (Duyệt)')).disabled);assert.match(await page.locator('[data-stage="3"]').innerText(),/Chờ duyệt/);
  await page.evaluate(()=>window.tracker(true,false));await page.locator('[data-stage="3"]').getByText('Nhập thủ công',{exact:true}).waitFor();assert.match(await page.locator('[data-stage="8"]').innerText(),/Bỏ qua/);assert.equal(await approve.count(),0);
  await page.evaluate(()=>window.grid());for(const b of await page.getByRole('button').all()){const text=await b.innerText();if(/Tạo lại|Chạy lại|Tiếp tục tạo/.test(text))assert.equal(await b.isDisabled(),true);}
  for(const [error,heading]of [['Bảo mật: thiếu cấu hình API Key','THIẾU HOẶC SAI CẤU HÌNH'],['FFmpeg media hỏng','LỖI MEDIA / TIMING'],['Piper tổng hợp thất bại','LỖI NHÀ CUNG CẤP'],['Ổ đĩa không truy cập được','LỖI HỆ THỐNG'],['PUBLIC_ERROR_UNUSUAL_ACTIVITY','GOOGLE YÊU CẦU XÁC MINH BẢO MẬT']]){await page.evaluate(e=>window.error(e),error);await page.getByRole('heading',{name:heading,exact:true}).waitFor();}
  await page.evaluate(()=>window.piper());await page.getByRole('status').filter({hasText:'Runtime/model Piper tiếng Việt đã được kiểm tra.'}).waitFor();
  console.log('PASS: invalid approval blocked while pause remains usable; approval/manual/skipped labels, manual generation controls, distinct error categories and Vietnamese Piper readiness (UI fixtures only).');
 }finally{await browser?.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
