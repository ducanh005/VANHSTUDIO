import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { once } from 'node:events';
import http from 'node:http';

async function main() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'studio-post-uat-runtime-'));
  process.env.VANHSUB_AI_STUDIO_DIR = path.join(root, 'config');
  process.env.VANHSUB_BIBLE_DIR = path.join(root, 'bible');
  process.env.VANHSUB_ALLOW_INSECURE_TEST_SECRETS = '1'; // Synthetic test keys only.
  const { DEFAULT_AI_STUDIO_CONFIG } = await import('../main/ai-studio/types');
  const { resolveProductionConfig } = await import('../main/ai-studio/sessionConfig');
  const base = structuredClone(DEFAULT_AI_STUDIO_CONFIG);
  base.llm = { ...base.llm, provider: 'deepseek', apiKey: 'fixture-key', model: 'fixture-model', baseUrl: 'https://example.invalid/v1' };
  base.channelProfile.aiProvider = 'openai';
  const selected = resolveProductionConfig(base);
  assert.equal(selected.llm.provider, 'openai');
  assert.equal(selected.llm.apiKey, '', 'Production resolution must not relabel a foreign provider key before snapshot');
  assert.equal(selected.llm.model, ''); assert.equal(selected.llm.baseUrl, undefined);
  const providerOnly = resolveProductionConfig(base, {llm:{provider:'openai'}});
  assert.equal(providerOnly.llm.apiKey,'');
  const explicit = resolveProductionConfig(base, { llm: {provider:'openai',apiKey:'explicit-fixture',model:'explicit-model'} });
  assert.equal(explicit.llm.apiKey, 'explicit-fixture'); assert.equal(explicit.llm.model, 'explicit-model');

  const { AiStudioPipelineEngine } = await import('../main/ai-studio/AiStudioPipelineEngine');
  const { updateAiStudioConfig } = await import('../main/store/aiStudioStore');
  const storedFixture = { provider:'deepseek' as const, apiKey:'fixture-key', model:'fixture-model', baseUrl:'https://example.invalid/v1' };
  updateAiStudioConfig({llm:storedFixture});
  assert.equal(updateAiStudioConfig({llm:{model:'same-provider-model'}},{decrypted:true}).llm.apiKey,'fixture-key');
  const switched = updateAiStudioConfig({llm:{provider:'openai'}},{decrypted:true});
  assert.equal(switched.llm.apiKey,'','A provider-only project switch must clear the previous encrypted key');
  assert.equal(switched.llm.model,''); assert.equal(switched.llm.baseUrl,undefined);
  const replaced = updateAiStudioConfig({llm:{provider:'custom',apiKey:'explicit-fixture',model:'custom-model',baseUrl:'https://example.invalid/custom'}},{decrypted:true});
  assert.equal(replaced.llm.apiKey,'explicit-fixture'); assert.equal(replaced.llm.model,'custom-model');
  assert.throws(()=>updateAiStudioConfig({llm:{provider:'invalid-provider' as any}}),/provider/i);
  const {getAiStudioConfig}=await import('../main/store/aiStudioStore');
  assert.equal(getAiStudioConfig({decrypted:true}).llm.provider,'custom','Invalid provider must not persist');
  const { aiStudioLlmService } = await import('../main/ai-studio/services/AiStudioLlmService');
  const { aiStudioTtsService } = await import('../main/ai-studio/services/AiStudioTtsService');
  const { isSessionOperationActive } = await import('../main/ai-studio/sessionOperations');
  const { captureSessionConfig } = await import('../main/ai-studio/sessionConfig');
  await assert.rejects(() => aiStudioTtsService.synthesizeVoiceover('Valid text',
    {...DEFAULT_AI_STUDIO_CONFIG.voice,provider:'local_onnx',voiceId:'af_heart',kokoroBaseUrl:'https://example.invalid/v1'},path.join(root,'never','kokoro.mp3')),/Kokoro/);
  const engine = new AiStudioPipelineEngine();
  const seed = (id: string, lines: any[], status = 'awaiting_approval') => {
    const state: any = { sessionId:id,topic:'Fixture',currentStage:2,stageName:'script',status,progress:25,
      workspaceDir:path.join(root,id),mediaDir:path.join(root,id,'media'),
      configSnapshot:captureSessionConfig(DEFAULT_AI_STUDIO_CONFIG),
      stages:{1:{status:'success'},2:{status:'success'}},artifacts:{scriptLines:lines},createdAt:Date.now(),updatedAt:Date.now() };
    engine.persistSessionStateAtomic(state); return state;
  };
  for (const [id, lines] of [['empty', []], ['blank', [{id:'l',index:1,text:'... ⭐'}]]] as const) {
    const session = seed(id, [...lines]); const file = path.join(session.workspaceDir,'session.json'), bytes = fs.readFileSync(file);
    await assert.rejects(() => engine.approveStage({sessionId:id,currentStage:2},()=>{}), /Kịch bản/);
    await assert.rejects(() => engine.resume({sessionId:id,fromStage:3},()=>{}), /Kịch bản/);
    assert.deepEqual(fs.readFileSync(file),bytes); assert.equal(isSessionOperationActive(id),false);
    await assert.rejects(() => aiStudioLlmService.evaluateScript([...lines] as any), /Kịch bản/);
    await assert.rejects(() => aiStudioLlmService.refineScript([...lines] as any), /[Kk]ịch bản/);
    await assert.rejects(() => aiStudioTtsService.synthesizeVoiceover([...lines] as any,DEFAULT_AI_STUDIO_CONFIG.voice,path.join(root,'never','voice.mp3')), /Kịch bản/);
    assert.equal(fs.existsSync(path.join(root,'never')),false);
  }
  const valid = seed('valid', [{id:'l',index:1,text:'Xin chào.'}]);
  await assert.rejects(() => engine.approveStage({sessionId:valid.sessionId,currentStage:2,updatedArtifacts:{scriptLines:[]}},()=>{}), /Kịch bản/);
  await assert.rejects(() => engine.approveStage({sessionId:valid.sessionId,currentStage:2,updatedArtifacts:{scriptLines:null} as any},()=>{}), /Kịch bản/);
  seed('failed', [{id:'l',index:1,text:'Xin chào.'}], 'failed');
  await assert.rejects(() => engine.approveStage({sessionId:'failed',currentStage:2},()=>{}), /Chỉ được duyệt/);
  const realLoop = (engine as any).runPipelineLoop;
  (engine as any).runPipelineLoop = async () => {};
  assert.equal((await engine.approveStage({sessionId:valid.sessionId,currentStage:2},()=>{})).nextStage,3);
  await new Promise(r=>setTimeout(r,20)); (engine as any).runPipelineLoop = realLoop;

  updateAiStudioConfig({ activeProjectId:'owner', channelProfile:{...DEFAULT_AI_STUDIO_CONFIG.channelProfile,aiProvider:'deepseek'},
    llm:{provider:'deepseek',apiKey:'frozen-fixture-key'}, savedProjects:[{id:'owner',name:'Fixture',outputDir:path.join(root,'project'),channelProfile:{...DEFAULT_AI_STUDIO_CONFIG.channelProfile,aiProvider:'deepseek'},updatedAt:Date.now()}] });
  const wait = async (e: any, id: string) => {
    for(let i=0;i<200;i++){const state=await e.getState({sessionId:id}); if(!state.jobActive)return state; await new Promise(r=>setTimeout(r,10));}
    throw new Error('Fixture job did not settle');
  };
  const created = await engine.start({projectId:'owner',topic:'Test facts',blueprint:{topic:'Test facts',title:'Test facts',outline:['Verified fixture input']},gatedMode:true},()=>{});
  let session = await wait(engine,created.sessionId); assert.equal(session.status,'awaiting_approval');
  const facts = path.join(session.workspaceDir,'00_facts/facts.json'), factBytes = fs.readFileSync(facts);
  const initialGenerate=aiStudioLlmService.generateScript;
  aiStudioLlmService.generateScript=async()=>{throw new Error('Fixture provider timeout');};
  await engine.approveStage({sessionId:session.sessionId,currentStage:1},()=>{});
  session = await wait(engine,session.sessionId); assert.equal(session.status,'failed'); assert.match(session.error,/Fixture provider timeout/);
  updateAiStudioConfig({llm:{provider:'openai',apiKey:'new-global-fixture-key',model:'other-model'},channelProfile:{aiProvider:'openai'}});
  const restarted = new AiStudioPipelineEngine();
  const frozen = await restarted.getSessionConfig(session.sessionId);
  assert.equal(frozen.llm.provider,'deepseek'); assert.equal(frozen.llm.apiKey,'frozen-fixture-key');
  await restarted.resume({sessionId:session.sessionId,fromStage:2},()=>{});
  session = await wait(restarted,session.sessionId); assert.equal(session.status,'failed'); assert.match(session.error,/Fixture provider timeout/);
  assert.deepEqual(fs.readFileSync(facts),factBytes); assert.equal(session.stages[1].status,'success');
  const evaluate = aiStudioLlmService.evaluateScript;
  let release!: (value: any) => void, calls = 0;
  aiStudioLlmService.generateScript = async (_topic, config) => { calls++; assert.equal(config.provider,'deepseek'); assert.equal(config.apiKey,'frozen-fixture-key'); return new Promise(resolve=>release=resolve); };
  aiStudioLlmService.evaluateScript = async () => ({overallScore:80,lowestScore:8,criteria:[],failedCriteria:[],critique:'Offline fixture',evaluatedAt:Date.now()});
  try {
    await restarted.resume({sessionId:session.sessionId,fromStage:2},()=>{});
    await assert.rejects(()=>restarted.resume({sessionId:session.sessionId,fromStage:2},()=>{}),/đang có tác vụ/);
    for (let i=0;i<100 && !release;i++) await new Promise(r=>setTimeout(r,10));
    assert.equal(calls,1); release([{id:'l',index:1,text:'Offline transport fixture narration.'}]);
    session=await wait(restarted,session.sessionId); assert.equal(session.status,'awaiting_approval'); assert.equal(session.stages[2].status,'success');
    assert.deepEqual(fs.readFileSync(facts),factBytes);
    assert.ok(fs.existsSync(path.join(restarted.getDiskStorageManager(session.sessionId).paths.scriptDir,'script.json')));
  } finally {aiStudioLlmService.generateScript=initialGenerate; aiStudioLlmService.evaluateScript=evaluate;}

  const {listKokoroVoices}=await import('../main/ai-studio/kokoroVoices');
  let response: any={voices:['af_heart']}, code=200, hang=false;
  const server=http.createServer((_req,res)=>{if(hang)return;res.statusCode=code;res.setHeader('Content-Type','application/json');res.end(JSON.stringify(response));});
  server.listen(0,'127.0.0.1');await once(server,'listening');
  const endpoint=`http://127.0.0.1:${(server.address() as any).port}/v1/audio/voices`;
  try {
    assert.deepEqual(await listKokoroVoices(endpoint),[{id:'af_heart',name:'af_heart'}]);
    response={voices:[{id:'af_heart',name:'Heart'}]}; assert.equal((await listKokoroVoices(endpoint))[0].name,'Heart');
    response={voices:[]}; assert.deepEqual(await listKokoroVoices(endpoint),[]);
    response={wrong:[]}; await assert.rejects(()=>listKokoroVoices(endpoint),/định dạng/);
    code=503;await assert.rejects(()=>listKokoroVoices(endpoint),/Không tải/);
    code=200;hang=true;await assert.rejects(()=>listKokoroVoices(endpoint,100),/Không tải/);
    await assert.rejects(()=>listKokoroVoices('https://example.invalid/v1/audio/voices'),/local/);
  } finally {server.closeAllConnections();await new Promise<void>(resolve=>server.close(()=>resolve()));}
  console.log('PASS: script guards, unchanged rejected checkpoints, snapshot credential isolation, provider failure propagation, real checkpoint resume/duplicate exclusion and bounded loopback Kokoro catalog. Offline fixtures, not provider live or IPC transport.');
}
main().catch(error=>{console.error(error);process.exitCode=1;});
