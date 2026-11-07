import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

async function main() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'beta-owner-progress-'));
  process.env.VANHSUB_SETTINGS_DIR = root;
  const { WorkflowExecutionEngine } = await import('../main/workflow/executionEngine');
  const { AdapterRegistry } = await import('../main/workflow/adapters/AdapterRegistry');
  const { GoogleVeoSessionManager } = await import('../main/veo/GoogleVeoSessionManager');
  const { WorkflowStorageManager } = await import('../main/workflow/WorkflowStorageManager');
  const adapter = AdapterRegistry.getInstance().get('google-flow'), manager = GoogleVeoSessionManager.getInstance();
  const original = { video: adapter.generateVideo, image: adapter.generateImage, current: manager.getCurrentProjectId, dir: WorkflowStorageManager.getInstance().getWorkflowTempDir };
  let owner: unknown, currentReads = 0;
  try {
    manager.getCurrentProjectId = () => { currentReads++; return 'unrelated-global-project'; };
    WorkflowStorageManager.getInstance().getWorkflowTempDir = id => path.join(root, id);
    adapter.generateVideo = async (params, ctx) => { owner = params.projectId; [5,25,8,NaN,110].forEach(ctx.onProgress); return { videoUrl: 'offline-fixture', durationSeconds: 4 }; };
    adapter.generateImage = async (params, ctx) => { owner = params.projectId; ctx.onProgress(25); ctx.onProgress(8); return { imageUrl: 'offline-fixture' }; };
    for (const type of ['google-flow-video', 'google-imagen']) {
      for (const projectId of [undefined, 'explicit-owned-project']) {
        const engine = new WorkflowExecutionEngine(), events: any[] = [];
        const graph: any = { id: 'offline-owner-' + type, name: 'Offline ownership', nodes: [{id:'node-1', data:{nodeType:type, category:'model', label:'Fixture', config:{prompt:'fixture',projectId}}}], edges:[] };
        const result = await engine.execute(graph, e => events.push(e));
        assert.equal(result.success, true); assert.equal(owner, projectId);
        const progress = events.filter(e => e.status === 'running').map(e => e.progress);
        assert.ok(progress.every((p,i) => Number.isFinite(p) && p < 100 && (!i || p >= progress[i-1])), JSON.stringify(progress));
        assert.equal(events.at(-1).progress, 100);
      }
    }
    assert.equal(currentReads, 0, 'A workflow cannot adopt the global last-opened project');
    console.log('PASS offline: explicit project ownership, no global fallback, monotonic per-attempt progress and terminal 100');
  } finally {
    adapter.generateVideo=original.video; adapter.generateImage=original.image; manager.getCurrentProjectId=original.current; WorkflowStorageManager.getInstance().getWorkflowTempDir=original.dir;
    fs.rmSync(root,{recursive:true,force:true});
  }
}
main().catch(e=>{ console.error(e); process.exitCode=1; });
