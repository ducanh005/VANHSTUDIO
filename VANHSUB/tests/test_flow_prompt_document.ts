import assert from 'assert/strict';
import {chromium} from 'playwright-core';
import {readFlowPrompt} from '../main/browser-automation/FlowT2iSubmission';
(async()=>{const browser=await chromium.launch({executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true});try{
 const p=await browser.newPage();await p.route('**/*',r=>r.abort());
 const read=async(html:string)=>{await p.setContent('<div id="editor" contenteditable="true">'+html+'</div>');return readFlowPrompt(p.locator('#editor'));};
 assert.equal(await read('<p>Positive.</p><p>Avoid: text.</p>'),'Positive.\nAvoid: text.');
 assert.equal(await p.locator('#editor').innerText(),'Positive.\n\nAvoid: text.','Reproduce real CSS paragraph separator');
 assert.equal(await read('<p>A</p><p><br></p><p>B</p>'),'A\n\nB','Preserve intentional blank paragraph');
 assert.equal(await read('<p>A<br>B<br class="ProseMirror-trailingBreak"></p>'),'A\nB');
 assert.equal(await read('<p>A  B <strong>C</strong></p>'),'A  B C','Do not collapse whitespace');
 assert.notEqual(await read('<p>Positive.</p><p>Avoid: logo.</p>'),'Positive.\nAvoid: text.','Changed negative must still fail');
 assert.notEqual(await read('<p>Positive.</p>'),'Positive.\nAvoid: text.','Missing negative must still fail');
 assert.equal(await read('A<br>B'),'A\nB');
 await assert.rejects(()=>read('<p>A<span contenteditable="false">reference chip</span></p>'),/FLOW_PROMPT_UNSUPPORTED_NODE/);
 console.log('PASS: real Chrome paragraph/newline integrity; whitespace, altered/missing negative and unsupported references. No provider calls.');
}finally{await browser.close();}})().catch(e=>{console.error(e);process.exitCode=1;});
