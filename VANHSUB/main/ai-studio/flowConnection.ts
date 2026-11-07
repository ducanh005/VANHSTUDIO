import path from 'path';
import os from 'os';
import {execFileSync} from 'child_process';
import {BrowserAutomationAdapter} from '../browser-automation/BrowserAutomationAdapter';
import {BrowserProcessManager} from '../browser-automation/BrowserProcessManager';
import {FlowBridgeServer} from '../workflow/flow-engine/rpc/FlowBridgeServer';

/** Fixed loopback endpoint, verified dedicated profile. Does not launch, navigate or submit. */
export async function connectFlowReadOnly(){
  const manager=BrowserProcessManager.getInstance(),pid=manager.findPidByPort(9224);
  if(!pid||process.platform!=='win32')throw Error('FLOW_TEST_BROWSER_REQUIRED: mở Chrome Flow test riêng ở 127.0.0.1:9224.');
  let command='';try{command=execFileSync('powershell.exe',['-NoProfile','-NonInteractive','-Command',`Get-CimInstance Win32_Process -Filter "ProcessId = ${Number(pid)}" | Select-Object -ExpandProperty CommandLine`],{encoding:'utf8',windowsHide:true,timeout:5000});}catch{throw Error('FLOW_PROFILE_UNVERIFIED');}
  const match=command.match(/--user-data-dir=(?:"([^"]+)"|(\S+))/i),profile=match?.[1]||match?.[2];
  const allowed=[manager.getProfileDir('flow'),path.join(process.env.LOCALAPPDATA||path.join(os.homedir(),'AppData','Local'),'VANHSUB-InternalBeta-20261016','Chrome Flow Profile')].map(p=>path.resolve(p).toLowerCase());
  if(!profile||!allowed.includes(path.resolve(profile).toLowerCase())||!/chrome\.exe/i.test(command))throw Error('FLOW_PROFILE_UNVERIFIED: không kết nối profile cá nhân hoặc profile chưa được xác minh.');
  const adapter=BrowserAutomationAdapter.getInstance();await adapter.connect({provider:'flow',port:9224,maxRetries:1,timeoutMs:8000});
  const page=adapter.listTabs('flow').find(p=>{try{const u=new URL(p.url());return u.hostname==='labs.google'||u.hostname==='flow.google.com';}catch{return false;}});
  const state=page?await Promise.race([adapter.evaluateFlowSessionState(page),new Promise<null>(resolve=>{const timer=setTimeout(()=>resolve(null),5000);timer.unref();})]):null;
  return {cdpConnected:true,profileVerified:true,bridgeConnected:FlowBridgeServer.getInstance().isConnected(),sessionState:state?.state||'SESSION_UNVERIFIED',projectLoaded:state?.isProjectLoaded||false,creditBalance:null,creditPrice:null,liveGenerationVerified:false};
}
