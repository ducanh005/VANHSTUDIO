import { WorkflowStorageManager } from './WorkflowStorageManager';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { app } from 'electron';
import type { WorkflowNodeEvent, ExecutionContext, ResolvedInputs, NodeExecutionOutput } from './types';
import { AdapterRegistry } from './adapters/AdapterRegistry';
import { QcEngine } from './qcEngine';
import { VideoProcessor } from './videoProcessor';
import { TaskStore } from '../store/taskStore';
import { SettingsStore } from '../store/settingsStore';
import { GoogleVeoAntiSpamGuard } from '../veo/GoogleVeoAntiSpamGuard';
import { GoogleFlowBrowserMutex } from './dispatcher/GoogleFlowBrowserMutex';
import { createNodeProgressReporter } from './progress';

export interface WorkflowGraphData {
  id: string;
  name: string;
  nodes: Array<{
    id: string;
    type?: string;
    data: {
      nodeType: string;
      category: string;
      label: string;
      config: Record<string, any>;
      runtime?: any;
    };
  }>;
  edges: Array<{
    id: string;
    source: string;
    target: string;
    sourceHandle?: string;
    targetHandle?: string;
  }>;
}

export class WorkflowExecutionEngine {
  private activeRuns = new Set<string>();
  public static async withBrowserMutex<T>(task: () => Promise<T>): Promise<T> {
    return GoogleFlowBrowserMutex.getInstance().runExclusive(task, 'legacy_workflow_engine');
  }

  public cancel(workflowId: string): void {
    this.activeRuns.delete(workflowId);
  }

  public isRunning(workflowId: string): boolean {
    return this.activeRuns.has(workflowId);
  }

  /**
   * Thực thi toàn bộ đồ thị Node DAG
   */
  public async execute(graph: WorkflowGraphData, onEvent: (event: WorkflowNodeEvent) => void): Promise<{ success: boolean; outputs: Record<string, any>; error?: string }> {
    const id = graph.id || `wf_${Date.now()}`;
    const release = WorkflowStorageManager.getInstance().reserveWorkflow(id);
    try { return await this.executeGraph({ ...graph, id }, onEvent); }
    finally { this.activeRuns.delete(id); release(); }
  }

  private async executeGraph(
    graph: WorkflowGraphData,
    onEvent: (event: WorkflowNodeEvent) => void
  ): Promise<{ success: boolean; outputs: Record<string, any>; error?: string }> {
    const workflowId = graph.id || `wf_${Date.now()}`;
    this.activeRuns.add(workflowId);

    const isCancelled = () => !this.activeRuns.has(workflowId);

    // Thư mục làm việc tạm thời cho workflow
    const tempDir = WorkflowStorageManager.getInstance().getWorkflowTempDir(workflowId);
    fs.mkdirSync(tempDir, { recursive: true });

    // Thư mục export mặc định
    const exportDir = SettingsStore.get('exportDir') || path.join(os.homedir(), 'Downloads');

    const nodes = graph.nodes || [];
    const edges = graph.edges || [];

    // Bản đồ node id -> node object
    const nodeMap = new Map<string, (typeof nodes)[0]>();
    for (const node of nodes) {
      nodeMap.set(node.id, node);
    }

    // 1. Xây dựng đồ thị DAG: Bậc vào (in-degree) và danh sách kề (adjacency list)
    const inDegree = new Map<string, number>();
    const pendingDependencies = new Map<string, number>();
    const adjacency = new Map<string, Array<{ target: string; sourceHandle?: string; targetHandle?: string }>>();
    const incomingEdges = new Map<string, Array<{ source: string; sourceHandle?: string; targetHandle?: string }>>();

    for (const node of nodes) {
      inDegree.set(node.id, 0);
      pendingDependencies.set(node.id, 0);
      adjacency.set(node.id, []);
      incomingEdges.set(node.id, []);
    }

    for (const edge of edges) {
      if (inDegree.has(edge.target)) {
        inDegree.set(edge.target, (inDegree.get(edge.target) || 0) + 1);
        pendingDependencies.set(edge.target, (pendingDependencies.get(edge.target) || 0) + 1);
      }
      adjacency.get(edge.source)?.push({
        target: edge.target,
        sourceHandle: edge.sourceHandle,
        targetHandle: edge.targetHandle,
      });
      incomingEdges.get(edge.target)?.push({
        source: edge.source,
        sourceHandle: edge.sourceHandle,
        targetHandle: edge.targetHandle,
      });
    }

    // 2. Phát hiện chu trình (Cycle Detection bằng thuật toán Kahn)
    const inDegreeCopy = new Map(inDegree);
    const queueForCycle: string[] = [];
    for (const [id, deg] of inDegreeCopy.entries()) {
      if (deg === 0) queueForCycle.push(id);
    }

    let visitedCount = 0;
    while (queueForCycle.length > 0) {
      const curr = queueForCycle.shift()!;
      visitedCount++;
      for (const edge of adjacency.get(curr) || []) {
        const nextDeg = (inDegreeCopy.get(edge.target) || 0) - 1;
        inDegreeCopy.set(edge.target, nextDeg);
        if (nextDeg === 0) {
          queueForCycle.push(edge.target);
        }
      }
    }

    if (visitedCount < nodes.length) {
      const err = 'Đồ thị chứa chu trình khép kín (Cycle Loop)! Vui lòng kiểm tra lại dây nối các node.';
      this.activeRuns.delete(workflowId);
      return { success: false, outputs: {}, error: err };
    }

    // 3. Khởi tạo trạng thái thực thi
    const nodeOutputs = new Map<string, NodeExecutionOutput>();
    const nodeStatus = new Map<string, WorkflowNodeEvent['status']>();

    for (const node of nodes) {
      nodeStatus.set(node.id, 'queued');
      onEvent({
        workflowId,
        nodeId: node.id,
        status: 'queued',
        progress: 0,
      });
    }

    // Cơ chế Last-Frame Chaining toàn cục theo thứ tự thời gian
    let globalLastFrameUrl: string | undefined = undefined;

    // Hàng đợi các node sẵn sàng chạy (bậc vào = 0)
    const readyQueue: string[] = [];
    for (const [id, deg] of inDegree.entries()) {
      if (deg === 0) readyQueue.push(id);
    }

    // Danh sách các node đang chạy đồng thời (Concurrency Control)
    const runningPromises = new Map<string, Promise<void>>();
    const maxConcurrency = 2; // Tối đa 2 model chạy đồng thời để tránh rate limit

    const markDescendantsBlocked = (failedNodeId: string) => {
      const queue = [failedNodeId];
      while (queue.length > 0) {
        const parent = queue.shift()!;
        for (const edge of adjacency.get(parent) || []) {
          if (nodeStatus.get(edge.target) !== 'blocked' && nodeStatus.get(edge.target) !== 'failed') {
            nodeStatus.set(edge.target, 'blocked');
            onEvent({
              workflowId,
              nodeId: edge.target,
              status: 'blocked',
              error: `Bị chặn do node cha #${parent.slice(-5)} gặp lỗi`,
            });
            queue.push(edge.target);
          }
        }
      }
    };

    try {
      while ((readyQueue.length > 0 || runningPromises.size > 0) && !isCancelled()) {
        // Khởi động các node sẵn sàng chạy cho tới khi đầy concurrency
        while (readyQueue.length > 0 && runningPromises.size < maxConcurrency && !isCancelled()) {
          const nodeId = readyQueue.shift()!;
          const node = nodeMap.get(nodeId);
          if (!node || nodeStatus.get(nodeId) === 'blocked') continue;

          const startTime = Date.now();
          nodeStatus.set(nodeId, 'running');
          onEvent({
            workflowId,
            nodeId,
            status: 'running',
            progress: 10,
          });

          // Giải quyết inputs từ các node cha
          const resolvedInputs: ResolvedInputs = {};
          for (const inc of incomingEdges.get(nodeId) || []) {
            const parentOut = nodeOutputs.get(inc.source);
            if (parentOut) {
              if (inc.targetHandle) {
                const val = inc.sourceHandle ? parentOut[inc.sourceHandle] : parentOut;
                resolvedInputs[inc.targetHandle] = val;
              }
              // Tự động kế thừa projectId từ node cha nếu có
              if (parentOut.projectId && !resolvedInputs['projectId']) {
                resolvedInputs['projectId'] = parentOut.projectId;
              }
            }
          }

          // Last-frame chaining injection tự động
          if (!resolvedInputs['init_frame'] && globalLastFrameUrl) {
            resolvedInputs['init_frame'] = globalLastFrameUrl;
          }

          const ctx: ExecutionContext = {
            workflowId,
            nodeId,
            tempDir,
            exportDir,
            onProgress: createNodeProgressReporter((percent: number) => {
              onEvent({
                workflowId,
                nodeId,
                status: 'running',
                progress: percent,
              });
            }),
            isCancelled,
          };

          const nodeWatchdogMs = 180_000;
          let watchdogTimer: NodeJS.Timeout;
          const watchdogPromise = new Promise<never>((_, reject) => {
            watchdogTimer = setTimeout(() => {
              reject(
                new Error(
                  `Node #${nodeId.slice(-5)} (${node.data.label || node.data.nodeType}) chạy quá hạn (${nodeWatchdogMs / 1000}s), tự động dừng để tránh treo workflow.`
                )
              );
            }, nodeWatchdogMs);
          });

          const taskPromise = Promise.race([
            this.executeLeasedNode(node, resolvedInputs, ctx),
            watchdogPromise,
          ])
            .finally(() => {
              clearTimeout(watchdogTimer);
            })
            .then((output) => {
              if (isCancelled()) return;

              nodeOutputs.set(nodeId, output);
              nodeStatus.set(nodeId, 'success');

              // Lưu last-frame nếu node có sinh ra
              if (output.last_frame || output.lastFrameUrl) {
                globalLastFrameUrl = output.last_frame || output.lastFrameUrl;
              }

              const durationMs = Date.now() - startTime;
              onEvent({
                workflowId,
                nodeId,
                status: 'success',
                progress: 100,
                thumbnailUrl:
                  output.last_frame ||
                  output.lastFrameUrl ||
                  output.thumbnailUrl ||
                  output.image ||
                  output.image_out ||
                  output.face_image,
                outputUrl: output.video || output.video_out || output.outputUrl || output.exportedPath,
                outputData: output,
                durationMs,
              });

              // Kích hoạt các node con nếu đã giải quyết xong mọi phụ thuộc
              for (const edge of adjacency.get(nodeId) || []) {
                const childId = edge.target;
                const remaining = (pendingDependencies.get(childId) || 1) - 1;
                pendingDependencies.set(childId, remaining);

                if (remaining === 0 && nodeStatus.get(childId) !== 'blocked') {
                  readyQueue.push(childId);
                }
              }
            })
            .catch((err: any) => {
              console.error(`Lỗi thực thi node ${nodeId}:`, err);
              nodeStatus.set(nodeId, 'failed');
              onEvent({
                workflowId,
                nodeId,
                status: 'failed',
                error: err?.message || String(err),
                durationMs: Date.now() - startTime,
              });

              // Cô lập lỗi: đánh dấu tất cả các node con là blocked
              markDescendantsBlocked(nodeId);
            })
            .finally(() => {
              runningPromises.delete(nodeId);
            });

          runningPromises.set(nodeId, taskPromise);
        }

        // Chờ ít nhất một task hoàn thành trước khi duyệt tiếp
        if (runningPromises.size > 0) {
          await Promise.race(runningPromises.values());
        }
      }

      if (isCancelled()) {
        console.log(`[Workflow Engine] Workflow ${workflowId} đã bị hủy bởi người dùng.`);
        for (const node of nodes) {
          const st = nodeStatus.get(node.id);
          if (st === 'running' || st === 'queued') {
            nodeStatus.set(node.id, 'failed');
            onEvent({
              workflowId,
              nodeId: node.id,
              status: 'failed',
              error: 'Đã hủy bởi người dùng',
            });
          }
        }
        this.activeRuns.delete(workflowId);
        return {
          success: false,
          outputs: Object.fromEntries(nodeOutputs),
          error: 'Workflow đã bị hủy bởi người dùng.',
        };
      }

      this.activeRuns.delete(workflowId);

      const allSuccess = Array.from(nodeStatus.values()).every((s) => s === 'success');
      return {
        success: allSuccess,
        outputs: Object.fromEntries(nodeOutputs),
      };
    } catch (e: any) {
      this.activeRuns.delete(workflowId);
      return {
        success: false,
        outputs: {},
        error: e?.message || String(e),
      };
    }
  }

  /**
   * Thực thi một Node đơn lẻ độc lập (Run Individual Node)
   */
  public async executeNode(graph: WorkflowGraphData, nodeId: string, onEvent: (event: WorkflowNodeEvent) => void): Promise<{ success: boolean; output?: NodeExecutionOutput; error?: string }> {
    const id = graph.id || `wf_node_${Date.now()}`;
    const release = WorkflowStorageManager.getInstance().reserveWorkflow(id);
    this.activeRuns.add(id);
    try { return await this.executeIndividualNode({ ...graph, id }, nodeId, onEvent); }
    finally { this.activeRuns.delete(id); release(); }
  }

  private async executeIndividualNode(
    graph: WorkflowGraphData,
    nodeId: string,
    onEvent: (event: WorkflowNodeEvent) => void
  ): Promise<{ success: boolean; output?: NodeExecutionOutput; error?: string }> {
    const workflowId = graph.id || `wf_node_${Date.now()}`;
    const nodes = graph.nodes || [];
    const edges = graph.edges || [];

    const targetNode = nodes.find((n) => n.id === nodeId);
    if (!targetNode) {
      return { success: false, error: `Không tìm thấy node #${nodeId}` };
    }

    const tempDir = WorkflowStorageManager.getInstance().getWorkflowTempDir(workflowId);
    fs.mkdirSync(tempDir, { recursive: true });
    const exportDir = SettingsStore.get('exportDir') || path.join(os.homedir(), 'Downloads');

    const nodeMap = new Map<string, (typeof nodes)[0]>();
    for (const n of nodes) nodeMap.set(n.id, n);

    const isCancelled = () => !this.activeRuns.has(workflowId);

    // Thu thập resolvedInputs từ các node cha
    const resolvedInputs: ResolvedInputs = {};
    for (const edge of edges) {
      if (edge.target === nodeId) {
        const parentNode = nodeMap.get(edge.source);
        if (parentNode) {
          // Lấy outputData từ runtime trước đó nếu có
          let parentOut: any = parentNode.data.runtime?.outputData;
          // Nếu node cha là input tĩnh chưa chạy (text-prompt, style-lock, character-ref, load-image, load-video...), thực thi nhanh
          if (
            !parentOut &&
            ['text-prompt', 'style-lock', 'character-ref', 'load-image', 'load-video', 'scene-ref', 'camera-path'].includes(
              parentNode.data.nodeType
            )
          ) {
            const parentCtx: ExecutionContext = {
              workflowId,
              nodeId: parentNode.id,
              tempDir,
              exportDir,
              onProgress: () => {},
              isCancelled,
            };
            try {
              parentOut = await this.executeLeasedNode(parentNode, {}, parentCtx);
            } catch {}
          }

          if (parentOut) {
            if (edge.targetHandle) {
              const val = edge.sourceHandle ? parentOut[edge.sourceHandle] : parentOut;
              resolvedInputs[edge.targetHandle] = val;
            }
            // Tự động kế thừa projectId từ node cha nếu có
            if (parentOut.projectId && !resolvedInputs['projectId']) {
              resolvedInputs['projectId'] = parentOut.projectId;
            }
          }
        }
      }
    }

    const startTime = Date.now();
    onEvent({
      workflowId,
      nodeId,
      status: 'running',
      progress: 10,
    });

    const ctx: ExecutionContext = {
      workflowId,
      nodeId,
      tempDir,
      exportDir,
      onProgress: createNodeProgressReporter((percent: number) => {
        onEvent({
          workflowId,
          nodeId,
          status: 'running',
          progress: percent,
        });
      }),
      isCancelled,
    };

    try {
      const output = await this.executeLeasedNode(targetNode, resolvedInputs, ctx);
      if (isCancelled()) throw new Error('Workflow đã bị hủy.');
      const durationMs = Date.now() - startTime;
      onEvent({
        workflowId,
        nodeId,
        status: 'success',
        progress: 100,
        thumbnailUrl:
          output.last_frame ||
          output.lastFrameUrl ||
          output.thumbnailUrl ||
          output.image ||
          output.image_out ||
          output.face_image,
        outputUrl: output.video || output.video_out || output.outputUrl || output.exportedPath,
        outputData: output,
        durationMs,
      });
      return { success: true, output };
    } catch (err: any) {
      const durationMs = Date.now() - startTime;
      onEvent({
        workflowId,
        nodeId,
        status: 'failed',
        error: err?.message || String(err),
        durationMs,
      });
      return { success: false, error: err?.message || String(err) };
    }
  }

  /**
   * Xử lý thực thi cho từng loại node cụ thể
   */
  private async executeLeasedNode(node: WorkflowGraphData['nodes'][number], inputs: ResolvedInputs, context: ExecutionContext): Promise<NodeExecutionOutput> {
    const release = WorkflowStorageManager.getInstance().retainWorkflow(context.workflowId);
    try { return await this.executeSingleNode(node, inputs, context); }
    finally { release(); }
  }

  private async executeSingleNode(
    node: { data: { nodeType: string; config: Record<string, any> } },
    inputs: ResolvedInputs,
    ctx: ExecutionContext
  ): Promise<NodeExecutionOutput> {
    const { nodeType, config } = node.data;
    const adapterRegistry = AdapterRegistry.getInstance();

    switch (nodeType) {
      case 'text-prompt':
        return {
          text: config.prompt || '',
          prompt: config.prompt || '',
          negativePrompt: config.negativePrompt || '',
        };

      case 'load-image':
        return {
          image: config.sourceUrl || '',
          aspectRatio: config.aspectRatio || '16:9',
        };

      case 'load-video':
        return {
          video: config.videoUrl || '',
        };

      case 'character-ref':
        return {
          character: config,
          character_out: config,
          face_image: config.referenceImageUrl || '',
          image: config.referenceImageUrl || '',
          thumbnailUrl: config.referenceImageUrl || '',
          name: config.characterName || 'Nhân vật',
          characterName: config.characterName || 'Nhân vật',
          description: config.description || '',
        };

      case 'scene-ref':
        return {
          scene: config,
          mood: config.lightingMood || '',
        };

      case 'camera-path':
        return {
          camera_control: config,
          motion: config.motionType || 'pan_right',
        };

      case 'google-flow-video':
      case 'kling-video': {
        const adapter = adapterRegistry.get('google-flow');
        let prompt = '';
        if (typeof inputs['prompt'] === 'string') {
          prompt = inputs['prompt'];
        } else if (inputs['prompt'] && typeof inputs['prompt'] === 'object') {
          prompt = inputs['prompt'].prompt || inputs['prompt'].text || '';
        }
        if (!prompt) {
          prompt = config.prompt || '';
        }
        // Fallback thông minh: Nếu node video chưa có prompt riêng, lấy prompt từ node ảnh/kịch bản đầu vào
        if (!prompt) {
          for (const val of Object.values(inputs)) {
            if (typeof val === 'string' && val.length > 5 && !val.includes('/') && !val.includes('\\')) {
              prompt = val;
              break;
            } else if (val && typeof val === 'object') {
              if (val.prompt) {
                prompt = String(val.prompt);
                break;
              }
              if (val.text) {
                prompt = String(val.text);
                break;
              }
            }
          }
        }
        if (!prompt) {
          prompt = 'Smooth cinematic animation, fluid dynamic motion, expressive character performance, 4k render';
        }

        // Tự động append Character lock vào prompt nếu có
        const charInput = inputs['character'] || (inputs['prompt'] && inputs['prompt'].character_locked ? inputs['prompt'] : null);
        if (charInput) {
          const charObj = charInput.character_locked || charInput.character || charInput;
          const charName = charObj.characterName || charObj.name || '';
          const charDesc = charObj.description || '';
          if (charName || charDesc) {
            prompt = `${prompt} [Consistent Character: ${charName}${charDesc ? ' - ' + charDesc : ''}]`.trim();
          }
        }

        // Tự động append Style lock nếu có
        if (inputs['style']) {
          const styleVal = inputs['style'].style_out || inputs['style'].stylePrompt || inputs['style'];
          if (typeof styleVal === 'string') {
            prompt = `${prompt} ${styleVal}`.trim();
          }
        }

        // Tự động append Scene continuity nếu có
        if (inputs['scene']) {
          const sceneVal = inputs['scene'].scene_out || inputs['scene'];
          const sceneName = sceneVal.sceneName || sceneVal.name || '';
          const mood = sceneVal.lightingMood || sceneVal.mood || '';
          if (sceneName || mood) {
            prompt = `${prompt} [Scene: ${sceneName}${mood ? ' - ' + mood : ''}]`.trim();
          }
        }

        // Tự động append Camera motion nếu có
        if (inputs['camera']) {
          const motion = inputs['camera'].motion || inputs['camera'].motionType;
          if (motion) {
            prompt = `${prompt} [Camera: ${motion}]`.trim();
          }
        }

        const initFrameUrl = inputs['init_frame'] || inputs['image'] || inputs['sourceUrl'] || inputs['initFrameUrl'] || config.initFrameUrl;
        const rawDuration = Number(config.durationSeconds || 4);
        const durationSeconds = rawDuration <= 5 ? 4 : rawDuration <= 7 ? 6 : rawDuration <= 9 ? 8 : 10;
        const aspectRatio = config.aspectRatio || '16:9';
        const seed = config.seed ? Number(config.seed) : undefined;
        const modelVariant = config.modelVariant || 'omni-flash';
        const outputCount = Number(config.outputCount || 1);

        const targetProjectId = inputs['projectId'] || inputs['project_id'] || config.projectId || undefined;

        const result = await WorkflowExecutionEngine.withBrowserMutex(async () => {
          return adapter.generateVideo(
            {
              prompt,
              initFrameUrl,
              durationSeconds,
              aspectRatio,
              seed,
              modelVariant,
              outputCount,
              projectId: targetProjectId,
            },
            ctx
          );
        });

        return {
          video: result.videoUrl,
          last_frame: result.lastFrameUrl,
          duration: result.durationSeconds,
          projectId: result.projectId || targetProjectId,
        };
      }

      case 'export-video': {
        const videoInput = inputs['video_in'] || inputs['video'];
        if (!videoInput || !fs.existsSync(videoInput)) {
          throw new Error('Không tìm thấy video đầu vào để xuất!');
        }

        const fileName = config.fileName || `VANHSUB_Output_${Date.now()}.mp4`;
        const destPath = path.join(ctx.exportDir, fileName);

        // Copy sang thư mục đích
        fs.copyFileSync(videoInput, destPath);

        return {
          exportedPath: destPath,
          video: destPath,
        };
      }

      case 'send-to-sub-mode': {
        const videoInput = inputs['video_in'] || inputs['video'];
        if (!videoInput || !fs.existsSync(videoInput)) {
          throw new Error('Không có video hợp lệ để chuyển sang Sub Mode!');
        }

        const taskName = config.taskName || `Video sinh từ Workflow (${new Date().toLocaleTimeString()})`;

        // Tự động tạo task mới trong TaskStore của Sub Mode
        const newTask = TaskStore.create({
          fileName: taskName,
          filePath: videoInput,
          workflow: 'full-dubbing',
          status: 'queued',
          progress: 0,
          stageDescription: 'Sẵn sàng phiên âm ASR & dịch thuật từ Workflow Mode',
        });

        return {
          taskId: newTask.id,
          task: newTask,
          video: videoInput,
        };
      }

      case 'trim': {
        const videoInput = inputs['video_in'] || inputs['video'];
        if (!videoInput || !fs.existsSync(videoInput)) {
          throw new Error('Không tìm thấy video đầu vào để cắt gọt (trim)!');
        }
        const startTime = Number(config.startTime ?? 0);
        const endTime = Number(config.endTime ?? 5);
        const outPath = path.join(ctx.tempDir, `trim_${ctx.nodeId}_${Date.now()}.mp4`);
        await VideoProcessor.trimVideo(videoInput, outPath, startTime, endTime, ctx);
        const dur = await VideoProcessor.getVideoDuration(outPath);
        return {
          video: outPath,
          video_out: outPath,
          duration: dur,
        };
      }

      case 'concat': {
        const list: string[] = [];
        // Ưu tiên các cổng định danh theo thứ tự: video_a, video_b, video_c, video_d, video_e...
        const orderedHandles = ['video_a', 'video_b', 'video_c', 'video_d', 'video_e', 'video_1', 'video_2', 'video_3', 'video_4'];
        for (const h of orderedHandles) {
          const v = inputs[h];
          if (typeof v === 'string' && v && fs.existsSync(v) && !list.includes(v)) {
            list.push(v);
          }
        }
        // Thêm bất kỳ video input nào khác chưa có trong danh sách
        for (const [k, v] of Object.entries(inputs)) {
          if (typeof v === 'string' && v && fs.existsSync(v) && !list.includes(v)) {
            if (v.endsWith('.mp4') || v.endsWith('.mov') || v.endsWith('.mkv') || k.startsWith('video')) {
              list.push(v);
            }
          }
        }
        if (list.length === 0) {
          throw new Error('Không có video hợp lệ nào được đưa vào node concat!');
        }
        const outPath = path.join(ctx.tempDir, `concat_${ctx.nodeId}_${Date.now()}.mp4`);
        const transitionEffect = config.transitionEffect || config.effect || 'none';
        const transitionDuration = Number(config.transitionDuration || config.duration || 0.5);
        await VideoProcessor.concatVideos(list, outPath, ctx, {
          effect: transitionEffect,
          duration: transitionDuration,
        });
        const dur = await VideoProcessor.getVideoDuration(outPath);
        return {
          video: outPath,
          video_out: outPath,
          duration: dur,
        };
      }

      case 'transition': {
        const videoA = inputs['video_a'];
        const videoB = inputs['video_b'];
        if (!videoA || !videoB) {
          return { video_out: videoA || videoB, video: videoA || videoB };
        }
        const outPath = path.join(ctx.tempDir, `transition_${ctx.nodeId}_${Date.now()}.mp4`);
        await VideoProcessor.applyTransition(
          videoA,
          videoB,
          outPath,
          {
            effect: config.effect || 'cross_dissolve',
            duration: Number(config.duration || 0.5),
          },
          ctx
        );
        const dur = await VideoProcessor.getVideoDuration(outPath);
        return {
          video: outPath,
          video_out: outPath,
          duration: dur,
          effect: config.effect || 'cross_dissolve',
        };
      }

      case 'color-match': {
        const videoTarget = inputs['video_target'] || inputs['video'];
        if (!videoTarget || !fs.existsSync(videoTarget)) {
          throw new Error('Không tìm thấy video cần chỉnh màu cho node color-match!');
        }
        const refImage = inputs['reference_image'] || inputs['image'] || '';
        const outPath = path.join(ctx.tempDir, `colormatch_${ctx.nodeId}_${Date.now()}.mp4`);
        await VideoProcessor.colorMatchVideo(videoTarget, refImage, outPath, Number(config.intensity || 0.75), ctx);
        return {
          video: outPath,
          video_out: outPath,
        };
      }

      case 'upscale': {
        const videoInput = inputs['video_in'] || inputs['video'];
        if (!videoInput || !fs.existsSync(videoInput)) {
          throw new Error('Không tìm thấy video đầu vào để upscale!');
        }
        const outPath = path.join(ctx.tempDir, `upscale_${ctx.nodeId}_${Date.now()}.mp4`);
        await VideoProcessor.upscaleVideo(videoInput, config.scaleFactor || '2x', outPath, ctx);
        return {
          video: outPath,
          video_out: outPath,
        };
      }

      case 'character-lock': {
        const charIn = inputs['character_in'] || config;
        const faceWeight = config.faceWeight ?? 0.9;
        const costumeLock = config.costumeLock ?? true;
        return {
          character_locked: {
            ...charIn,
            faceWeight,
            costumeLock,
            isLocked: true,
          },
          character: charIn,
        };
      }

      case 'style-lock': {
        const palette = config.colorPalette || 'flat_vivid';
        const lens = config.lensType || 'flat_2d';
        const stylePrompt = config.stylePrompt || '';
        const negativePrompt = config.negativePrompt || '';

        let styleToken = '';
        if (stylePrompt) {
          styleToken = `[Master Art Style: ${stylePrompt}] [Color Palette: ${palette}, Perspective: ${lens}]`;
          if (negativePrompt) {
            styleToken += ` [Negative: ${negativePrompt}]`;
          }
        } else {
          styleToken = `[Style: ${palette}, Lens: ${lens}, Cinematic 8k Color Grade]`;
        }

        return {
          style_out: styleToken,
          stylePrompt,
          negativePrompt,
          colorPalette: palette,
          lensType: lens,
        };
      }

      case 'scene-continuity': {
        const sceneIn = inputs['scene_in'] || config;
        return {
          scene_out: {
            ...sceneIn,
            timeOfDay: config.timeOfDay || 'sunset',
          },
        };
      }

      case 'qc-check': {
        const shotA = inputs['shot_a'];
        const shotB = inputs['shot_b'];

        const qcRes = await QcEngine.evaluate(shotA, shotB, {
          faceSimilarityThreshold: Number(config.faceSimilarityThreshold || 85),
          colorTolerance: Number(config.colorTolerance || 15),
          autoReject: Boolean(config.autoReject),
        });

        if (config.autoReject && !qcRes.passed) {
          throw new Error(`QC Kiểm định không đạt: ${qcRes.details}`);
        }

        return {
          qc_passed: qcRes.passed,
          similarityScore: qcRes.score,
          colorDelta: qcRes.colorDelta,
          status: qcRes.status,
          details: qcRes.details,
        };
      }

      case 'google-imagen': {
        const adapter = adapterRegistry.get('google-flow');
        const rawInputPrompt = typeof inputs['prompt'] === 'object'
          ? inputs['prompt'].prompt || inputs['prompt'].text
          : inputs['prompt'];
        const baseConfigPrompt = config.prompt || '';

        let prompt = '';
        if (baseConfigPrompt && rawInputPrompt && baseConfigPrompt !== rawInputPrompt) {
          prompt = `${baseConfigPrompt}. [Script Context: ${rawInputPrompt}]`;
        } else {
          prompt = baseConfigPrompt || rawInputPrompt || 'Cinematic artwork';
        }

        // Tự động append Character lock vào prompt nếu có
        const charInput = inputs['character'];
        if (charInput) {
          const charObj = charInput.character_locked || charInput.character || charInput;
          const charName = charObj.characterName || charObj.name || '';
          const charDesc = charObj.description || '';
          if (charName || charDesc) {
            prompt = `${prompt} [Consistent Character: ${charName}${charDesc ? ' - ' + charDesc : ''}]`.trim();
          }
        }

        // Tự động append Style lock nếu có
        if (inputs['style']) {
          const styleVal = inputs['style'].style_out || inputs['style'].stylePrompt || inputs['style'];
          if (typeof styleVal === 'string') {
            prompt = `${prompt} ${styleVal}`.trim();
          }
        }

        // Tự động append Scene continuity nếu có
        if (inputs['scene']) {
          const sceneVal = inputs['scene'].scene_out || inputs['scene'];
          const sceneName = sceneVal.sceneName || sceneVal.name || '';
          const mood = sceneVal.lightingMood || sceneVal.mood || '';
          if (sceneName || mood) {
            prompt = `${prompt} [Scene: ${sceneName}${mood ? ' - ' + mood : ''}]`.trim();
          }
        }

        const aspectRatio = config.aspectRatio || '16:9';
        const imageEngine = config.imageEngine || 'banana-pro';
        const outputCount = Number(config.outputCount || 1);
        const targetProjectId = inputs['projectId'] || inputs['project_id'] || config.projectId || undefined;

        const imgRes = await WorkflowExecutionEngine.withBrowserMutex(async () => {
          return adapter.generateImage!({ prompt, aspectRatio, imageEngine, outputCount, projectId: targetProjectId }, ctx);
        });
        return {
          image: imgRes.imageUrl,
          sourceUrl: imgRes.imageUrl,
          prompt,
          projectId: imgRes.projectId || targetProjectId,
        };
      }

      case 'gemini-director': {
        const adapter = adapterRegistry.get('google-flow');
        const idea = inputs['idea_in'] || config.idea || config.prompt || '';
        const charInput = inputs['character'];
        const charName = charInput?.name || charInput?.characterName;
        const dirRes = await adapter.directPrompt!(
          {
            idea,
            tone: config.directorTone,
            lighting: config.lightingStyle,
            characterName: charName,
          },
          ctx
        );
        return {
          prompt_out: dirRes.prompt,
          prompt: dirRes.prompt,
          text: dirRes.prompt,
          negative_prompt_out: dirRes.negativePrompt,
          negativePrompt: dirRes.negativePrompt,
          camera_suggestion: dirRes.camera,
        };
      }

      case 'prompt-concat': {
        const separator = config.separator ?? ', ';
        const parts: string[] = [];
        for (const key of ['text_a', 'text_b', 'text_c']) {
          const val = inputs[key];
          if (val) {
            if (typeof val === 'string') {
              parts.push(val.trim());
            } else if (typeof val === 'object' && val.prompt) {
              parts.push(String(val.prompt).trim());
            } else if (typeof val === 'object' && val.text) {
              parts.push(String(val.text).trim());
            }
          }
        }
        const joined = parts.join(separator);
        return {
          text_out: joined,
          text: joined,
          prompt: joined,
        };
      }

      case 'conditional': {
        const condVal = inputs['condition'];
        let isPass = true;
        if (condVal !== undefined) {
          if (typeof condVal === 'boolean') {
            isPass = condVal;
          } else if (typeof condVal === 'object' && condVal !== null) {
            isPass = Boolean(condVal.qc_passed ?? condVal.passed ?? (condVal.score ? condVal.score >= 80 : true));
          }
        }

        const videoIn = inputs['input_video'] || inputs['video'] || '';
        return {
          passed: isPass,
          true_branch: isPass ? videoIn : undefined,
          false_branch: !isPass ? videoIn : undefined,
          video: videoIn,
        };
      }

      case 'batch': {
        const promptIn = inputs['prompt_in'] || inputs['prompt'] || config.prompt || '';
        const size = Number(config.batchSize || 3);
        const list = [];
        for (let i = 0; i < size; i++) {
          list.push(`${promptIn} (Variation #${i + 1})`);
        }
        return {
          batch_out: list,
          seeds: Array.from({ length: size }, (_, i) => 1000 + i),
        };
      }

      case 'queue-gate': {
        const inputVal = inputs['in'] || inputs['video_in'] || inputs['image_in'] || inputs['input'];
        let delaySec = Number(config.delaySeconds || 25);

        if (config.mode === 'auto_session') {
          const status = GoogleVeoAntiSpamGuard.getInstance().getStatus();
          delaySec = Math.max(5, status.remainingCooldownSec || 20);
        }

        const totalMs = delaySec * 1000;
        let elapsedMs = 0;
        const stepMs = 1000;

        while (elapsedMs < totalMs) {
          if (ctx.isCancelled()) {
            throw new Error('Tác vụ hàng đợi đã bị hủy.');
          }
          const percent = Math.min(99, Math.round((elapsedMs / totalMs) * 100));
          ctx.onProgress(percent);
          await new Promise((r) => setTimeout(r, Math.min(stepMs, totalMs - elapsedMs)));
          elapsedMs += stepMs;
        }

        ctx.onProgress(100);

        return {
          out: inputVal,
          video_out: typeof inputVal === 'string' ? inputVal : undefined,
          image_out: typeof inputVal === 'string' ? inputVal : undefined,
          video: typeof inputVal === 'string' ? inputVal : undefined,
          image: typeof inputVal === 'string' ? inputVal : undefined,
        };
      }

      default:
        // Pass-through cho các node khác
        return {
          ...config,
          ...inputs,
        };
    }
  }
}
