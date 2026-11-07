import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { studioLlmReadiness } from '../shared/studioLlmReadiness';

async function main(){
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'studio-phase2-readiness-'));
  process.env.VANHSUB_AI_STUDIO_DIR=path.join(root,'config');process.env.VANHSUB_BIBLE_DIR=path.join(root,'bible');
  process.env.VANHSUB_ALLOW_INSECURE_TEST_SECRETS='1';
  for(const provider of ['deepseek','openai','custom']) {
    const r=studioLlmReadiness({provider,apiKey:'',model:''});assert.equal(r.ready,false);assert.match(r.reasons.join(' '),/API Key/);
    assert.equal(r.liveVerified,false);
  }
  assert.equal(studioLlmReadiness({provider:'openai',apiKey:'fixture',model:''}).model,'gpt-4o');
  assert.equal(studioLlmReadiness({provider:'custom',apiKey:'fixture',model:'custom'}).ready,false);
  assert.equal(studioLlmReadiness({provider:'custom',apiKey:'fixture',model:'custom',baseUrl:'http://127.0.0.1:1234/v1'}).ready,true);
  for(const baseUrl of ['http://example.invalid/v1','https://private:secret@example.invalid/v1','https://example.invalid/v1?key=secret']) {
    const result=studioLlmReadiness({provider:'custom',apiKey:'sensitive-fixture',model:'model',baseUrl});
    assert.equal(result.ready,false);assert.ok(!JSON.stringify(result).includes('sensitive-fixture'));assert.ok(!JSON.stringify(result).includes(baseUrl));
  }
  const web=studioLlmReadiness({provider:'gemini_web'});assert.ok(web.warnings.some(w=>w.includes('chưa được xác minh')));assert.equal(web.liveVerified,false);
  const {updateAiStudioConfig}=await import('../main/store/aiStudioStore');
  const {DEFAULT_AI_STUDIO_CONFIG}=await import('../main/ai-studio/types');
  const {AiStudioPipelineEngine}=await import('../main/ai-studio/AiStudioPipelineEngine');
  const {captureSessionConfig}=await import('../main/ai-studio/sessionConfig');
  const {getStudioLlmReadiness}=await import('../main/ai-studio/llmReadiness');
  const config=structuredClone(DEFAULT_AI_STUDIO_CONFIG);config.llm.provider='deepseek';config.llm.apiKey='';config.channelProfile.aiProvider='deepseek';
  updateAiStudioConfig({...config,activeProjectId:'owner',savedProjects:[{id:'owner',name:'Fixture',channelProfile:config.channelProfile,outputDir:path.join(root,'project'),updatedAt:Date.now()}]});
  const engine=new AiStudioPipelineEngine();
  await assert.rejects(()=>engine.start({projectId:'owner',topic:'Readiness fixture',blueprint:{topic:'Manual facts',outline:['Manual fact']}},()=>{}),/API Key/);
  assert.equal(fs.existsSync(path.join(root,'project')),false,'Known missing configuration must not create an episode');
  assert.equal(getStudioLlmReadiness({...config,llm:{...config.llm,provider:'openai',apiKey:'foreign-fixture'}}).ready,false,'Project provider mismatch cannot reuse another key');
  const state:any={sessionId:'missing-frozen-key',topic:'Fixture',currentStage:1,stageName:'source',status:'awaiting_approval',progress:10,
    workspaceDir:path.join(root,'old'),mediaDir:path.join(root,'old','media'),configSnapshot:captureSessionConfig(config),
    stages:{1:{status:'success'}},artifacts:{blueprint:{topic:'Manual fact'}},createdAt:Date.now(),updatedAt:Date.now()};
  engine.persistSessionStateAtomic(state);const checkpoint=path.join(state.workspaceDir,'session.json'),bytes=fs.readFileSync(checkpoint);
  await assert.rejects(()=>engine.approveStage({sessionId:state.sessionId,currentStage:1},()=>{}),/API Key/);
  await assert.rejects(()=>engine.resume({sessionId:state.sessionId,fromStage:2},()=>{}),/API Key/);
  assert.deepEqual(fs.readFileSync(checkpoint),bytes,'Rejected continuation must preserve checkpoint');
  updateAiStudioConfig({llm:{apiKey:'new-global-fixture'}});
  await assert.rejects(()=>new AiStudioPipelineEngine().resume({sessionId:state.sessionId,fromStage:2},()=>{}),/API Key/);
  assert.deepEqual(fs.readFileSync(checkpoint),bytes,'Global key must not migrate an old frozen snapshot');
  console.log('PASS: provider/model/custom endpoint readiness, sanitized reasons, no job/checkpoint on missing configuration, frozen resume guard and Web auth uncertainty warning. No live key verification.');
}
main().catch(e=>{console.error(e);process.exitCode=1;});
