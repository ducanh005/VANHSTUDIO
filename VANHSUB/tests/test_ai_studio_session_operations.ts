import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

async function main() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'studio-session-operations-'));
  process.env.VANHSUB_AI_STUDIO_DIR = path.join(root, 'config');
  const wait = () => new Promise((resolve) => setTimeout(resolve, 40));
  const deferred = () => {
    let resolve!: () => void;
    const promise = new Promise<void>((done) => { resolve = done; });
    return { promise, resolve };
  };
  try {
    const { AiStudioPipelineEngine } = await import('../main/ai-studio/AiStudioPipelineEngine');
    const { DEFAULT_AI_STUDIO_CONFIG } = await import('../main/ai-studio/types');
    const { captureSessionConfig } = await import('../main/ai-studio/sessionConfig');
    const { isSessionOperationActive, withSessionOperation } = await import('../main/ai-studio/sessionOperations');
    const { aiStudioLlmService } = await import('../main/ai-studio/services/AiStudioLlmService');
    const engine = new AiStudioPipelineEngine();
    const seed = (id: string, stage = 2) => {
      const state: any = {
        sessionId: id, topic: id, currentStage: stage, stageName: 'script', status: 'awaiting_approval', progress: 25,
        configSnapshot: captureSessionConfig({...DEFAULT_AI_STUDIO_CONFIG,llm:{...DEFAULT_AI_STUDIO_CONFIG.llm,apiKey:'synthetic-lease-fixture'}}), workspaceDir: path.join(root, id), mediaDir: path.join(root, id, 'media'),
        stages: Object.fromEntries(Array.from({ length: stage }, (_, i) => [i + 1, { status: 'success', stageName: 'Test' }])),
        artifacts: { scriptLines: [{ id: 'l1', index: 1, text: 'Original narration' }] }, createdAt: Date.now(), updatedAt: Date.now(),
      };
      engine.persistSessionStateAtomic(state);
      return state;
    };
    const original = seed('approve');
    const unchanged = fs.readFileSync(path.join(original.workspaceDir, 'session.json'), 'utf8');
    await assert.rejects(() => engine.approveStage({ sessionId: 'approve', currentStage: 7, updatedArtifacts: { audioPath: 'wrong' } }, () => {}), /Chỉ được duyệt/);
    assert.equal(fs.readFileSync(path.join(original.workspaceDir, 'session.json'), 'utf8'), unchanged);
    assert.equal(isSessionOperationActive('approve'), false);
    await assert.rejects(() => engine.resume({ sessionId: 'approve', fromStage: 0 as any }, () => {}), /1–8/);
    assert.equal(fs.readFileSync(path.join(original.workspaceDir, 'session.json'), 'utf8'), unchanged);
    const hold = deferred();
    let runs = 0, lastStage = 0;
    (engine as any).runPipelineLoop = async (_session: any, stage: number) => { runs++; lastStage = stage; await hold.promise; };
    const approvals = await Promise.allSettled([
      engine.approveStage({ sessionId: 'approve', currentStage: 2 }, () => {}),
      engine.approveStage({ sessionId: 'approve', currentStage: 2 }, () => {}),
    ]);
    assert.equal(approvals.filter((r) => r.status === 'fulfilled').length, 1);
    assert.equal(approvals.filter((r) => r.status === 'rejected').length, 1);
    assert.equal((await engine.getState({ sessionId: 'approve' }))!.jobActive, true);
    await assert.rejects(() => engine.resume({ sessionId: 'approve' }, () => {}), /đang có tác vụ/);
    await assert.rejects(() => engine.renderVideo({ sessionId: 'approve' }), /đang có tác vụ/);
    await assert.rejects(() => engine.regenerateSceneAsset({ sessionId: 'approve', sceneId: 'shot', visualPrompt: 'test' }), /đang có tác vụ/);
    await assert.rejects(() => engine.importSceneMedia({ sessionId: 'approve', sceneId: 'shot', filePath: 'test' }), /đang có tác vụ/);
    await engine.cancel({ sessionId: 'approve' });
    assert.equal(isSessionOperationActive('approve'), true, 'Cancel cannot release a still-running provider');
    await assert.rejects(() => engine.resume({ sessionId: 'approve' }, () => {}), /đang có tác vụ/);
    await wait();
    assert.equal(runs, 1);
    hold.resolve();
    await wait();
    assert.equal(isSessionOperationActive('approve'), false);
    assert.equal((await engine.getState({ sessionId: 'approve' }))!.status, 'cancelled');

    seed('waiting');
    await engine.cancel({ sessionId: 'waiting' });
    const cancelledWaiting = (await engine.getState({ sessionId: 'waiting' }))!;
    assert.equal(cancelledWaiting.status, 'cancelled');
    assert.equal(cancelledWaiting.stages[2].status, 'success');
    await engine.resume({ sessionId: 'waiting' }, () => {});
    await wait();
    assert.equal(lastStage, 3, 'Resume after cancelling an approval gate must not regenerate a completed stage');

    const edit = seed('editing');
    const editHold = deferred();
    const editJob = withSessionOperation(edit.sessionId, async (signal) => { await editHold.promise; signal.throwIfAborted(); return 'edited'; });
    await assert.rejects(() => engine.approveStage({ sessionId: edit.sessionId, currentStage: 2 }, () => {}), /đang có tác vụ/);
    await engine.cancel({ sessionId: edit.sessionId });
    const editRejected = assert.rejects(editJob, /abort/i);
    editHold.resolve();
    await editRejected;
    assert.equal(isSessionOperationActive(edit.sessionId), false);

    const realEngine = new AiStudioPipelineEngine();
    const metadataHold = deferred();
    const metadataSession = { ...seed('metadata', 8), status: 'failed' as const };
    realEngine.persistSessionStateAtomic(metadataSession);
    aiStudioLlmService.generateSeoMetadata = async () => { await metadataHold.promise; return { title: 'Late result', description: 'Late', hashtags: [] }; };
    const events: any[] = [];
    await realEngine.resume({ sessionId: metadataSession.sessionId, fromStage: 8 }, (event) => events.push(event));
    await wait();
    await realEngine.cancel({ sessionId: metadataSession.sessionId });
    metadataHold.resolve();
    await wait();
    const stopped = (await realEngine.getState({ sessionId: metadataSession.sessionId }))!;
    assert.equal(stopped.status, 'cancelled');
    assert.equal(stopped.artifacts.metadata, undefined, 'A late provider result must not be committed after cancellation');
    assert.ok(!events.some((event) => event.status === 'success'));
    assert.equal(events.at(-1).sessionStatus, 'cancelled');
    const interrupted = { ...seed('interrupted'), status: 'running' as const };
    engine.persistSessionStateAtomic(interrupted);
    const recovered = (await new AiStudioPipelineEngine().getState({ sessionId: interrupted.sessionId }))!;
    assert.equal(recovered.status, 'failed');
    assert.equal(recovered.jobActive, false);
    assert.match(recovered.error!, /gián đoạn/);
    assert.equal(fs.readFileSync(path.join(interrupted.workspaceDir, 'session.json'), 'utf8').includes('jobActive'), false);
    console.log('PASS: approval integrity, duplicate exclusion, guarded mutations, cancellation lease retention, gate resume, late-result rejection and interrupted-job recovery');
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
}
main().catch((err) => { console.error(err); process.exitCode = 1; });
