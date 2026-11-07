import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

async function main() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'studio-config-snapshot-'));
  process.env.VANHSUB_AI_STUDIO_DIR = path.join(root, 'config');
  process.env.VANHSUB_BIBLE_DIR = path.join(root, 'bible');
  try {
    const { AiStudioPipelineEngine } = await import('../main/ai-studio/AiStudioPipelineEngine');
    const { updateAiStudioConfig } = await import('../main/store/aiStudioStore');
    const { DEFAULT_CHANNEL_PROFILE_CONFIG } = await import('../main/ai-studio/types');
    const { aiStudioLlmService } = await import('../main/ai-studio/services/AiStudioLlmService');
    const { aiStudioTtsService } = await import('../main/ai-studio/services/AiStudioTtsService');
    const { aiStudioVideoAssembler } = await import('../main/ai-studio/services/AiStudioVideoAssembler');
    const { aiStudioVisualService } = await import('../main/ai-studio/services/AiStudioVisualService');
    const { resolveProductionConfig } = await import('../main/ai-studio/sessionConfig');
    const { getDecryptedAiStudioConfig } = await import('../main/store/aiStudioStore');
    const profileA = { ...DEFAULT_CHANNEL_PROFILE_CONFIG, projectName: 'A', hostName: 'Host A', hostDescription: 'Person A', projectBackgroundPrompt: 'Setting A', aiProvider: 'deepseek' as const, ttsEngine: 'tiktok_tts' as const, specificVoice: 'BV075_streaming' };
    const profileB = { ...profileA, projectName: 'B', hostName: 'Host B' };
    updateAiStudioConfig({
      activeProjectId: 'A', channelProfile: profileA,
      savedProjects: [
        { id: 'A', name: 'A', channelProfile: profileA, outputDir: path.join(root, 'A'), flowProjectUrl: 'https://flow.google.com/project/project_A12345', updatedAt: Date.now() },
        { id: 'B', name: 'B', channelProfile: profileB, outputDir: path.join(root, 'B'), updatedAt: Date.now() },
      ],
      llm: { provider: 'deepseek', apiKey: 'initial-key-A', model: 'initial-model-A' },
      flowEngine: { aspectRatio: '16:9', apiKey: 'flow-secret-A', shotMode: 'multi', granularity: 'balanced' },
    });
    const engine = new AiStudioPipelineEngine();
    const realLoop = (engine as any).runPipelineLoop.bind(engine);
    (engine as any).runPipelineLoop = async () => {};
    const started = await engine.start({
      topic: 'Topic A', blueprint: { topic: 'Topic A', narrativeAngle: 'Angle A', hookConcept: 'Hook A', aspectRatio: '9:16' },
      options: { llm: { provider: 'openai', apiKey: 'override-secret-A', model: 'model-A' }, voice: { provider: 'edge_tts', voiceId: 'vi-VN-NamMinhNeural', rate: '+20%' }, rendering: { resolution: '720p', fps: 60 }, subtitles: { fontSize: 36 } },
    }, () => {});
    await new Promise((resolve) => setTimeout(resolve, 40));
    const session = (await engine.getState(started))!;
    const json = fs.readFileSync(path.join(session.workspaceDir!, 'session.json'), 'utf8');
    assert.ok(!json.includes('override-secret-A') && !json.includes('flow-secret-A'), 'No plaintext credentials in checkpoints');
    assert.ok(session.configSnapshot!.llm.apiKey.startsWith('enc:v1:'));
    assert.equal((session.configSnapshot as any).savedProjects, undefined);
    updateAiStudioConfig({ activeProjectId: 'B', channelProfile: profileB, llm: { provider: 'deepseek', model: 'model-B', apiKey: 'key-B' }, voice: { rate: '-15%' }, flowEngine: { aspectRatio: '1:1', granularity: 'fast' }, rendering: { resolution: '4k', fps: 30 }, subtitles: { fontSize: 12 } });
    const restarted = new AiStudioPipelineEngine();
    const frozen = await restarted.getSessionConfig(session.sessionId);
    assert.equal(frozen.activeProjectId, 'A');
    assert.equal(frozen.channelProfile!.projectName, 'A');
    assert.equal(frozen.llm.provider, 'openai');
    assert.equal(frozen.llm.model, 'model-A');
    assert.equal(frozen.llm.apiKey, 'override-secret-A');
    assert.equal(frozen.flowEngine.apiKey, 'flow-secret-A');
    assert.equal(frozen.flowEngine.aspectRatio, '9:16');
    assert.equal(frozen.rendering.fps, 60);
    assert.equal(frozen.subtitles.fontSize, 36);
    const custom = resolveProductionConfig(frozen, { llm: { provider: 'custom', baseUrl: 'http://localhost:1234/v1' } });
    assert.equal(custom.llm.provider, 'custom');
    assert.equal(resolveProductionConfig(frozen, { voice: { voiceId: 'BV074_streaming' } }).voice.provider, 'tiktok_tts');
    const unownedSnapshot = { ...session, sessionId: 'unowned-snapshot', ownerProjectId: undefined, workspaceDir: path.join(root, 'unowned-snapshot'), mediaDir: path.join(root, 'unowned-snapshot', 'media') };
    engine.persistSessionStateAtomic(unownedSnapshot);
    assert.equal((await engine.getSessionConfig(unownedSnapshot.sessionId)).activeProjectId, '', 'A new project cannot claim an existing snapshot solely through a shared output root');
    const legacy = { ...session, sessionId: 'legacy-config', configSnapshot: undefined, ownerProjectId: undefined, workspaceDir: path.join(root, 'legacy-workspace'), mediaDir: path.join(root, 'legacy-media') };
    engine.persistSessionStateAtomic(legacy);
    const recovered = await engine.getSessionConfig(legacy.sessionId);
    assert.equal(recovered.activeProjectId, 'A', 'A unique verified output root identifies legacy ownership');
    assert.equal(recovered.channelProfile!.hostName, 'Host A');
    assert.equal(recovered.flowEngine.aspectRatio, '9:16');
    assert.equal(recovered.flowEngine.projectId, 'project_A12345');
    assert.ok((await engine.getState({ sessionId: legacy.sessionId }))!.configSnapshot);
    const unknown = { ...session, sessionId: 'unknown-owner-config', configSnapshot: undefined, ownerProjectId: undefined, outputDir: path.join(root, 'unknown'), workspaceDir: path.join(root, 'unknown'), mediaDir: path.join(root, 'unknown', 'media') };
    engine.persistSessionStateAtomic(unknown);
    await assert.rejects(() => engine.getSessionConfig(unknown.sessionId), /chưa xác định được/);

    let scriptConfig: any, voiceConfig: any, renderConfig: any, visualConfig: any;
    aiStudioLlmService.evaluateScript = async () => ({ overallScore: 80, lowestScore: 8, criteria: [], failedCriteria: [], critique: 'Mock review for configuration routing', evaluatedAt: Date.now() });
    aiStudioLlmService.generateScript = async (_topic, config, _progress, _blueprint, channel) => {
      scriptConfig = { config, channel };
      return [{ id: 'line_1', index: 1, text: 'Test narration' }];
    };
    aiStudioTtsService.synthesizeVoiceover = async (lines, config, output) => {
      voiceConfig = config;
      fs.writeFileSync(output, 'test audio');
      return { audioPath: output, durationMs: 1000, sizeBytes: 10, rawMetadata: [], wordTimestamps: [] };
    };
    await realLoop(session, 2, () => {}, new AbortController().signal);
    assert.equal(scriptConfig.config.provider, 'openai');
    assert.equal(scriptConfig.channel.projectName, 'A');
    await realLoop(session, 3, () => {}, new AbortController().signal);
    assert.equal(voiceConfig.provider, 'edge_tts');
    assert.equal(voiceConfig.voiceId, 'vi-VN-NamMinhNeural');
    assert.equal(voiceConfig.rate, '+20%');
    const storage = engine.getDiskStorageManager(session.sessionId);
    const image = path.join(storage.paths.mediaDir, 'image.png');
    fs.writeFileSync(image, 'test image');
    session.artifacts.scenes = [{ id: 'scene_01_shot_1', lineIndex: 0, startMs: 0, endMs: 1000, durationMs: 1000, lineText: 'Test', visualPrompt: 'Test', motionType: 'ken_burns', status: 'ready', assetPath: image }];
    aiStudioVideoAssembler.assembleVideo = async (options) => {
      renderConfig = options;
      fs.writeFileSync(options.outputPath, 'test video');
      return { videoPath: options.outputPath, durationSec: 1, fileSizeBytes: 10, width: 720, height: 1280 };
    };
    await engine.renderVideo({ sessionId: session.sessionId });
    assert.equal(renderConfig.aspectRatio, '9:16');
    assert.equal(renderConfig.renderingConfig.resolution, '720p');
    assert.equal(renderConfig.renderingConfig.fps, 60);
    assert.equal(renderConfig.subtitleConfig.fontSize, 36);
    aiStudioVisualService.regenerateSceneAsset = async (payload) => {
      visualConfig = payload.flowConfig;
      return { assetPath: image, imagePath: image };
    };
    await assert.rejects(() => engine.regenerateSceneAsset({ sessionId: session.sessionId, sceneId: 'scene_01_shot_1', visualPrompt: 'Test' }), /FLOW_REGENERATION_REQUIRES_NEW_APPROVAL/);
    assert.equal(visualConfig, undefined, 'Snapshot without credit approval must not invoke the generation provider');
    const unchangedFlow=(await engine.getSessionConfig(session.sessionId)).flowEngine;
    assert.equal(unchangedFlow.aspectRatio,'9:16');
    assert.deepEqual(unchangedFlow,frozen.flowEngine,'Credit rejection must preserve the frozen episode configuration');
    assert.equal((await engine.getState({sessionId:session.sessionId}))!.flowProjectUrl,'https://flow.google.com/project/project_A12345');
    session.stages[4] = { status: 'success', stageName: 'Alignment' };
    await engine.resume({ sessionId: session.sessionId, fromStage: 5, storyboardOptions: { granularity: 'detailed', shotMode: 'single' } }, () => {});
    assert.equal((await engine.getSessionConfig(session.sessionId)).flowEngine.granularity, 'detailed');
    assert.equal(getDecryptedAiStudioConfig().flowEngine.granularity, 'fast', 'Episode overrides must not change another channel');
    await new Promise((resolve) => setTimeout(resolve, 40));
    await assert.rejects(() => engine.resume({ sessionId: session.sessionId, fromStage: 3, storyboardOptions: { granularity: 'fast' } }, () => {}), /Bước 5/);
    await assert.rejects(() => engine.resume({ sessionId: session.sessionId, fromStage: 5, storyboardOptions: { granularity: 'invalid' as any } }, () => {}), /không hợp lệ/);
    await new Promise((resolve) => setTimeout(resolve, 40));
    console.log('PASS: encrypted snapshots, overrides, restart/project switch, script/voice/render routing, unapproved regeneration rejection and explicit per-session storyboard updates');
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
}
main().catch((err) => { console.error(err); process.exitCode = 1; });
