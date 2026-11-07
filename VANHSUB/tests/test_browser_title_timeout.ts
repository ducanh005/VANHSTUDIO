import assert from 'node:assert/strict';
import { BrowserAutomationAdapter } from '../main/browser-automation/BrowserAutomationAdapter';
import { resolveTtsEngine } from '../main/lib/ttsConfig';

async function main() {
  const adapter=BrowserAutomationAdapter.getInstance() as any;
  let titleCalls=0;
  const dead={isClosed:()=>false,url:()=> 'https://flow.google.com/project/owned',title:()=>{titleCalls++;return new Promise(()=>{});}};
  assert.equal(await adapter.matchesPredicate(dead,'/project/owned'),true);
  assert.equal(titleCalls,0);
  const began=Date.now(); assert.equal(await adapter.matchesPredicate(dead,'different-title'),false);
  assert(Date.now()-began<1600,'Unresponsive title must be bounded');
  assert.equal(await adapter.matchesPredicate({isClosed:()=>false,url:()=> 'about:blank',title:async()=> 'healthy'},'healthy'),true);
  assert.equal(resolveTtsEngine('vi_VN-vais1000-medium'),'viettts');
  console.log('PASS: URL routing avoids title RPC, dead title has bounded wait, healthy targets remain selectable; Piper default resolves to local TTS. Does not certify connectOverCDP initialization.');
}
main().catch(e=>{console.error(e);process.exitCode=1;});
