import { selectVisualJobs } from './visualJobs';
import { applySceneMedia } from './sceneArtifacts';
import { parseSrtStrict } from '../lib/srt';
import type { StartManualMediaPayload } from './types';
import { fullDecodeMediaWithFfmpeg } from '../browser-automation/mediaValidator';
import { toStoredScriptScenes } from './scriptStorage';
import { invalidateSessionArtifacts } from './sessionArtifacts';
import { assertUsableScript } from '../../shared/aiStudioScript';
import fs from 'fs';
import path from 'path';
import os from 'os';
import crypto from 'crypto';
import type { IAiStudioPipelineEngineDelegate } from './ipc';
import type {
  PipelineSessionState,
  PipelineProgressEvent,
  StartPipelinePayload,
  StartPipelineResult,
  ResumePipelinePayload,
  ResumePipelineResult,
  CancelPipelinePayload,
  CancelPipelineResult,
  GetPipelineStatePayload,
  RenderSingleLineVoicePayload,
  RenderSingleLineVoiceResult,
  RegenerateSceneAssetPayload,
  RegenerateSceneAssetResult,
  ImportSceneMediaPayload,
  ImportSceneMediaResult,
  RenderVideoPayload,
  RenderVideoResult,
  AutoFillIdeaPayload,
  AutoFillIdeaResult,
  ApproveStagePayload,
  ApproveStageResult,
  AiStudioConfig,
  AiStudioFlowEngineConfig,
  AiStudioVoiceConfig,
  AiStudioStageId,
  AiStudioStageName,
  StoryboardScene,
} from './types';
import { getDecryptedAiStudioConfig, updateAiStudioConfig, resolveAiStudioCwd } from '../store/aiStudioStore';
import { aiStudioLlmService } from './services/AiStudioLlmService';
import { aiStudioTtsService } from './services/AiStudioTtsService';
import { aiStudioVisualService } from './services/AiStudioVisualService';
import { aiStudioVideoAssembler } from './services/AiStudioVideoAssembler';
import { AiStudioDiskStorageManager } from './storage/AiStudioDiskStorageManager';
import { captureSessionConfig, resolveProductionConfig, restoreSessionConfig } from './sessionConfig';
import { assertStudioLlmReady } from './llmReadiness';
import { stageApprovalIssue } from '../../shared/studioStageReadiness';
import { applyScriptLines } from './sessionArtifacts';
import {prepareOfficialMedia,runOfficialMediaStage} from './officialMediaStage';
import {studioMediaReadiness} from '../../shared/officialMediaConfig';
import {flowCreditReadiness} from '../../shared/flowCreditPolicy';
import { cancelSessionOperation, isSessionOperationActive, registerSessionProcess, reserveSessionOperation, withSessionOperation } from './sessionOperations';
import {
  assertSessionWorkspaceOwner,
  newSessionWorkspace,
  readSessionCheckpoint,
  validateSessionId,
  writeSessionCheckpoint,
} from './storage/sessionWorkspace';
import type {
  PipelineActionLogEntry,
  PipelineFactsData,
  PipelineScriptData,
  PipelineTimingData,
  PipelineStoryboardData,
  StoryboardSceneItem,
  StoryboardShotItem,
} from './types/storage';
import { aiStudioStoryboardService } from './services/AiStudioStoryboardService';
import { aiStudioStyleRefsService } from './services/AiStudioStyleRefsService';
import { aiStudioModelConfigService } from './services/AiStudioModelConfigService';
import { FlowMediaAutomationEngine } from '../workflow/flow-engine/FlowMediaAutomationEngine';
import { GoogleVeoSessionManager, OFFSCREEN_X, OFFSCREEN_Y } from '../veo/GoogleVeoSessionManager';
import { GoogleFlowBrowserMutex } from '../workflow/dispatcher/GoogleFlowBrowserMutex';
import { FlowBridgeServer } from '../workflow/flow-engine/rpc/FlowBridgeServer';
import { BrowserAutomationAdapter } from '../browser-automation/BrowserAutomationAdapter';
import { broadcastPipelineActionLog } from './ipc';
import {
  BibleStore,
  CharacterAnchorConfig,
  SettingAnchorConfig,
  buildVeoMotionPrompt,
} from '../store/bibleStore';

/**
 * Resolves the root directory where AI Studio pipeline sessions and checkpoints are persisted.
 * Uses the dedicated workspace directory if set, or app userData, or temp directory.
 */
export function resolveAiStudioSessionsRoot(): string {
  const customCwd = resolveAiStudioCwd();
  if (customCwd) {
    return path.join(customCwd, 'sessions');
  }
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const electron = require('electron');
    const userData = electron?.app?.getPath?.('userData');
    if (userData) {
      return path.join(userData, 'sessions');
    }
  } catch {}
  return path.join(os.tmpdir(), 'vanhsub-ai-studio', 'sessions');
}

/** Stage metadata definitions for the 8-step pipeline */
const STAGE_CONFIG: Record<
  AiStudioStageId,
  { name: AiStudioStageName; label: string; baseProgress: number }
> = {
  1: { name: 'source', label: 'Dữ kiện (Idea Blueprint)', baseProgress: 10 },
  2: { name: 'script', label: 'Kịch bản (Script Generation)', baseProgress: 25 },
  3: { name: 'voice', label: 'Lồng tiếng (Edge-TTS Voice)', baseProgress: 40 },
  4: { name: 'alignment', label: 'Trích xuất Time (Alignment)', baseProgress: 55 },
  5: { name: 'storyboard', label: 'Storyboard (Visual Prompts)', baseProgress: 70 },
  6: { name: 'visuals', label: 'Ảnh / Video (Visual Assets)', baseProgress: 85 },
  7: { name: 'render', label: 'Dựng phim (FFmpeg Assembly)', baseProgress: 95 },
  8: { name: 'metadata', label: 'SEO & Xuất bản (Metadata)', baseProgress: 100 },
};

/**
 * AiStudioPipelineEngine: Central Orchestration Engine for AI Video Studio
 *
 * Implements the IAiStudioPipelineEngineDelegate contract:
 * - Coordinates the 8-stage automated video generation pipeline.
 * - Atomic checkpoint persistence (`session.json`) after each completed stage.
 * - Validated state transitions with IllegalStateTransitionError protection.
 * - Resumption from any stage with upstream preservation and downstream eviction.
 * - Granular operations (single-line voice, single-scene visual, custom video render).
 * - Graceful process management and AbortController cancellation.
 */
// Helper trích xuất ID dự án Google Flow từ link hoặc UUID
export function extractFlowProjectId(urlOrId?: string): string | undefined {
  if (!urlOrId || !urlOrId.trim()) return undefined;
  const str = urlOrId.trim();
  const match = str.match(/\/project\/([a-zA-Z0-9_-]+)/);
  if (match && match[1]) return match[1];
  if (/^[a-zA-Z0-9_-]{8,}$/.test(str) && !str.startsWith('http')) return str;
  return undefined;
}

export class AiStudioPipelineEngine implements IAiStudioPipelineEngineDelegate {
  private activeSessions = new Map<string, PipelineSessionState>();
  private memorySessions = new Map<string, any>();

  // ==========================================================================
  // Session Directory Helpers
  // ==========================================================================
  public getSessionDir(sessionId: string, customOutputDir?: string): string {
    validateSessionId(sessionId);
    const state = this.activeSessions.get(sessionId) || this.loadSessionState(sessionId);
    if (state?.workspaceDir) return path.resolve(state.workspaceDir);
    // Existing episodes keep their original files; never redirect them on a project switch.
    if (state?.outputDir) return path.resolve(state.outputDir);
    if (customOutputDir?.trim()) return newSessionWorkspace(customOutputDir, sessionId);
    return path.join(resolveAiStudioSessionsRoot(), sessionId);
  }

  private loadSessionState(sessionId: string): PipelineSessionState | null {
    validateSessionId(sessionId);
    const catalogRoot = resolveAiStudioSessionsRoot();
    const catalogState = readSessionCheckpoint(path.join(catalogRoot, `${sessionId}.json`), sessionId);
    const config = getDecryptedAiStudioConfig();
    const owner = config.savedProjects?.find((p) =>
      p.lastSessionId === sessionId || p.savedSession?.sessionId === sessionId
    );
    const candidates = [
      catalogState?.workspaceDir || catalogState?.outputDir,
      path.join(catalogRoot, sessionId),
      owner?.outputDir,
    ].filter((p): p is string => Boolean(p));
    for (const dir of candidates) {
      const state = readSessionCheckpoint(path.join(dir, 'session.json'), sessionId);
      if (!state) continue;
      // Capture the verified legacy directory too, including sessions without outputDir.
      state.workspaceDir ||= path.resolve(dir);
      state.ownerProjectId ||= owner?.id;
      state.mediaDir ||= state.artifacts.mediaDir || path.join(dir, '05_media');
      this.activeSessions.set(sessionId, state);
      return state;
    }
    if (catalogState) {
      catalogState.workspaceDir ||= catalogState.outputDir || path.join(catalogRoot, sessionId);
      catalogState.ownerProjectId ||= owner?.id;
      catalogState.mediaDir ||= catalogState.artifacts.mediaDir || path.join(catalogState.workspaceDir, '05_media');
      this.activeSessions.set(sessionId, catalogState);
    }
    return catalogState;
  }

  public getSessionAssetsDir(sessionId: string, customOutputDir?: string): string {
    const workspaceDir = this.getSessionDir(sessionId, customOutputDir);
    const state = this.activeSessions.get(sessionId);
    if (state) assertSessionWorkspaceOwner(state, workspaceDir, resolveAiStudioSessionsRoot());
    const revision = state?.productionRevision || 0;
    const dir = path.join(workspaceDir, ...(revision ? ['revisions', `rev_${revision}`] : []), 'assets');
    fs.mkdirSync(dir, { recursive: true });
    return dir;
  }

  // ==========================================================================
  // Disk Storage & Action Log Helper (spec §1.1, §1.2, §3)
  // ==========================================================================
  public getDiskStorageManager(sessionId: string, customMediaDir?: string, customOutputDir?: string): AiStudioDiskStorageManager {
    const sessionDir = this.getSessionDir(sessionId, customOutputDir);
    const state = this.activeSessions.get(sessionId);
    const mediaDir = state?.mediaDir || (customMediaDir ? newSessionWorkspace(customMediaDir, sessionId) : undefined);
    assertSessionWorkspaceOwner(state || {
      sessionId, workspaceDir: sessionDir, mediaDir, artifacts: {},
    } as PipelineSessionState, sessionDir, resolveAiStudioSessionsRoot());

    const storage = new AiStudioDiskStorageManager(sessionId, {
      baseDir: state?.productionRevision ? path.join(sessionDir, 'revisions', `rev_${state.productionRevision}`) : sessionDir,
      customMediaDir: mediaDir && state?.productionRevision ? path.join(mediaDir, 'revisions', `rev_${state.productionRevision}`) : mediaDir,
      exactProjectDir: true,
    });
    storage.ensureDirectories();
    storage.ensureIndex();

    // Intercept appendActionLog to stream to renderer via IPC channel 'aiStudio:pipeline:actionLog'
    const originalAppend = storage.appendActionLog.bind(storage);
    storage.appendActionLog = (entry: PipelineActionLogEntry) => {
      originalAppend(entry);
      this.emitActionLog(entry);
    };

    return storage;
  }

  public emitActionLog(entry: PipelineActionLogEntry): void {
    broadcastPipelineActionLog(entry);
  }

  // ==========================================================================
  // Atomic State Persistence
  // ==========================================================================
  public persistSessionStateAtomic(state: PipelineSessionState): void {
    validateSessionId(state.sessionId);
    const sessionDir = state.workspaceDir || state.outputDir || path.join(resolveAiStudioSessionsRoot(), state.sessionId);
    assertSessionWorkspaceOwner(state, sessionDir, resolveAiStudioSessionsRoot());
    state.workspaceDir = path.resolve(sessionDir);
    state.mediaDir ||= state.artifacts?.mediaDir || path.join(sessionDir, '05_media');
    state.updatedAt = Date.now();
    writeSessionCheckpoint(path.join(sessionDir, 'session.json'), state);
    // Stable catalog permits lookup after restart regardless of the selected project.
    writeSessionCheckpoint(path.join(resolveAiStudioSessionsRoot(), `${state.sessionId}.json`), state);
    this.activeSessions.set(state.sessionId, state);
  }

  public async getState(payload: GetPipelineStatePayload): Promise<PipelineSessionState | null> {
    const { sessionId } = payload;
    const state = this.activeSessions.get(sessionId) || this.loadSessionState(sessionId);
    if (!state) return null;
    const jobActive = isSessionOperationActive(sessionId);
    return { ...state, jobActive, ...(state.status === 'running' && !jobActive ? {
      status: 'failed' as const, error: 'Phiên đã bị gián đoạn. Bạn có thể tiếp tục từ checkpoint đã lưu.',
    } : {}) };
  }

  private persistFailureCheckpoint(state: PipelineSessionState): void {
    try { this.persistSessionStateAtomic(state); }
    catch (err) {
      // A failed disk write must not turn the background error handler into an unhandled rejection.
      console.error(`[AiStudioPipelineEngine] Cannot persist failed/cancelled session ${state.sessionId}:`, err);
    }
  }

  private launchPipeline(
    session: PipelineSessionState,
    stage: AiStudioStageId,
    onProgress: (event: PipelineProgressEvent) => void,
    lease = reserveSessionOperation(session.sessionId),
    runOptions?: { mode?: 'resume_missing' | 'regenerate_selected' | 'regenerate_all'; selectedShotIds?: string[] }
  ): void {
    setTimeout(() => {
      void (async () => {
        try {
          await this.runPipelineLoop(session, stage, onProgress, lease.controller.signal, runOptions);
          lease.controller.signal.throwIfAborted();
        } catch (err: any) {
          const cancelled = lease.controller.signal.aborted || session.status === 'cancelled';
          session.status = cancelled ? 'cancelled' : 'failed';
          session.error = cancelled ? 'Đã hủy bởi người dùng' : (err?.message || String(err));
          if (session.stages[session.currentStage]?.status !== 'success') {
            session.stages[session.currentStage] = { ...session.stages[session.currentStage], status: 'error', error: session.error };
          }
          this.persistFailureCheckpoint(session);
          try {
            onProgress({ sessionId: session.sessionId, stage: session.currentStage, stageName: session.stageName,
              progress: session.progress, status: 'error', error: session.error, sessionStatus: session.status });
          } catch (notifyError) { console.error('[AiStudioPipelineEngine] Cannot notify pipeline failure:', notifyError); }
        } finally { lease.release(); }
      })();
    }, 20);
  }

  public async getSessionConfig(sessionId: string): Promise<AiStudioConfig> {
    const session = await this.getState({ sessionId });
    if (!session) throw new Error('Không tìm thấy phiên AI Studio.');
    return this.resolveSessionConfig(session);
  }

  public async getMediaReadiness(sessionId?:string) {
    if(!sessionId){const config=getDecryptedAiStudioConfig();return config.flowEngine.engine==='official_api'||config.flowEngine.engine==='manual'?studioMediaReadiness(config.flowEngine,config.activeProjectId):flowCreditReadiness(config.flowEngine,config.activeProjectId);}
    const session=await this.getState({sessionId});if(!session)throw new Error('Không tìm thấy episode.');
    if(session.manualMode)return {status:'BLOCKED',route:'manual',liveVerified:false,reasons:['Episode nhập thủ công: không gọi provider generation.']};
    const config=this.resolveSessionConfig(session);
          if(config.flowEngine.engine!=='official_api')return flowCreditReadiness(config.flowEngine,session.ownerProjectId||session.projectId,selectVisualJobs(session.artifacts.scenes||[]).length);
      const base=studioMediaReadiness(config.flowEngine,session.ownerProjectId||session.projectId);
    if(base.status!=='CONFIGURATION_READY')return base;
    try{const plan=await prepareOfficialMedia(session,config,this.getDiskStorageManager(sessionId));return {...base,requestsNeeded:plan.needed,requestsUsed:plan.used};}
    catch(error){const message=error instanceof Error?error.message:'Preflight thất bại.';return{...base,status:message.startsWith('UNSUPPORTED')?'UNSUPPORTED':message.startsWith('BLOCKED')?'BLOCKED':'FAILED',reasons:[message]};}
  }

  private resolveSessionConfig(session: PipelineSessionState): AiStudioConfig {
    const current = getDecryptedAiStudioConfig();
    let owner = current.savedProjects?.find((p) => p.id === session.ownerProjectId);
    if (!session.configSnapshot && !session.ownerProjectId && session.outputDir) {
      const canonical = (dir: string) => (fs.existsSync(dir) ? fs.realpathSync(dir) : path.resolve(dir)).toLowerCase();
      const owners = (current.savedProjects || []).filter((p) => p.outputDir && canonical(p.outputDir) === canonical(session.outputDir!));
      if (owners.length === 1) {
        owner = owners[0];
        session.ownerProjectId = owner.id;
      }
    }
    if (!session.configSnapshot) {
      // Legacy sessions have no historical global config; recover only from their verified owner.
      if (!owner && current.activeProjectId) {
        throw new Error('Phiên cũ chưa có cấu hình cố định và chưa xác định được dự án sở hữu. Hãy mở đúng dự án chứa phiên hoặc tạo tập mới.');
      }
      const base = owner ? { ...current, channelProfile: owner.channelProfile, flowEngine: {
        ...current.flowEngine, ...owner.flowConfig,
        projectId: extractFlowProjectId(owner.flowProjectUrl) || owner.flowConfig?.projectId,
        projectName: owner.name,
      } } : current;
      session.flowProjectUrl ||= owner?.flowProjectUrl;
      session.configSnapshot = captureSessionConfig(resolveProductionConfig(base, {}, session.artifacts.blueprint));
      this.persistSessionStateAtomic(session);
    }
    return {
      ...current, ...restoreSessionConfig(session.configSnapshot),
      activeProjectId: session.ownerProjectId || '', outputDir: session.outputDir,
      flowProjectUrl: session.flowProjectUrl,
    };
  }

  // ==========================================================================
  // Pipeline Cancellation
  // ==========================================================================
  public async cancel(payload: CancelPipelinePayload): Promise<CancelPipelineResult> {
    const { sessionId } = payload;

    cancelSessionOperation(sessionId);

    // 3. Mark session as cancelled
    const session = await this.getState({ sessionId });
    if (session && ['running', 'idle', 'awaiting_approval'].includes(session.status)) {
      session.stages = session.stages || ({} as any);
      session.status = 'cancelled';
      if (session.stages[session.currentStage] && session.stages[session.currentStage].status !== 'success') {
        session.stages[session.currentStage].status = 'error';
        session.stages[session.currentStage].error = 'Đã hủy bởi người dùng';
      }
      this.persistSessionStateAtomic(session);
    }

    return { success: true };
  }

  // ==========================================================================
  // Pipeline Start (Auto-Pilot One-Click Mode)
  // ==========================================================================
  /** Create a real manually authored episode from selected, validated artifacts; no AI calls. */
  public async startManualMedia(payload: StartManualMediaPayload): Promise<StartPipelineResult> {
    const config = getDecryptedAiStudioConfig();
    const project = config.savedProjects?.find(p => p.id === payload.projectId);
    if (!project || config.activeProjectId !== project.id || !project.outputDir) throw new Error('Mở đúng project có thư mục output trước khi nhập SRT/audio.');
    if (!fs.statSync(payload.srtPath).isFile() || fs.statSync(payload.srtPath).size > 4 * 1024 * 1024 || path.extname(payload.srtPath).toLowerCase() !== '.srt') throw new Error('SRT không hợp lệ hoặc quá lớn.');
    if (!['.mp3', '.wav', '.m4a', '.flac', '.aac', '.ogg'].includes(path.extname(payload.audioPath).toLowerCase())) throw new Error('Loại audio không hỗ trợ.');
    const cues = parseSrtStrict(fs.readFileSync(payload.srtPath, 'utf8'));
    if (!cues.length || cues.length > 1000 || cues.some((c, i) => c.startMs < 0 || c.endMs <= c.startMs || (i > 0 && c.startMs < cues[i-1].endMs))) throw new Error('SRT cần 1–1000 câu có timing hợp lệ, không chồng lấn.');
    const decoded = await fullDecodeMediaWithFfmpeg(payload.audioPath);
    if (!decoded.fullyDecoded) throw new Error('Audio không giải mã đầy đủ được; từ chối nhập.');
    const duration = await aiStudioVideoAssembler.probeDuration(payload.audioPath);
    if (Math.abs(duration * 1000 - cues[cues.length-1].endMs) > 750) throw new Error('Audio và điểm kết thúc SRT chênh quá 750ms. Hãy đồng bộ trước khi nhập.');
    // Recheck project after asynchronous media validation, before allocating output.
    if (getDecryptedAiStudioConfig().activeProjectId !== project.id) throw new Error('Project đang chọn đã thay đổi.');
    const sessionId = `manual-${Date.now()}-${crypto.randomBytes(4).toString('hex')}`;
    const workspaceDir = newSessionWorkspace(project.outputDir, sessionId);
    const storage = new AiStudioDiskStorageManager(sessionId, { baseDir: workspaceDir, exactProjectDir: true });
    const audioPath = path.join(storage.paths.voiceDir, 'narration' + path.extname(payload.audioPath).toLowerCase());
    fs.copyFileSync(payload.audioPath, audioPath, fs.constants.COPYFILE_EXCL);
    const srtPath = path.join(storage.paths.timingDir, 'manual.srt');
    fs.copyFileSync(payload.srtPath, srtPath, fs.constants.COPYFILE_EXCL);
    const scriptLines = cues.map((cue, index) => ({ id: `line_${index+1}`, index: index+1, text: cue.text, startMs: cue.startMs, endMs: cue.endMs, durationMs: cue.endMs-cue.startMs }));
    const scenes: StoryboardScene[] = cues.map((cue, index) => ({
      id: `scene_${index+1}_shot_1`, shotId: `scene_${index+1}_shot_1`, sceneId: `scene_${index+1}`, lineIndex: index,
      startMs: index ? cues[index-1].endMs : 0, endMs: cue.endMs, durationMs: cue.endMs-(index ? cues[index-1].endMs : 0),
      lineText: cue.text, visualPrompt: '', motionType: 'ken_burns', status: 'pending', manualMediaOnly: true,
    }));
    const state: PipelineSessionState = {
      sessionId, manualMode: true, ownerProjectId: project.id, topic: 'Storyboard thủ công từ SRT', currentStage: 5,
      stageName: 'storyboard', status: 'awaiting_approval', progress: 62.5, gatedMode: true,
      outputDir: project.outputDir, workspaceDir, mediaDir: storage.paths.mediaDir, configSnapshot: captureSessionConfig(config),
      stages: Object.fromEntries(Array.from({ length:8 }, (_,i) => [i+1,{ status: i===7 ? 'skipped' : i<5 ? 'success' : 'pending', stageName: STAGE_CONFIG[(i+1) as AiStudioStageId].label }])),
      artifacts: { audioPath, srtPath, scriptLines, scenes, alignmentSource: 'estimated_per_line' }, createdAt: Date.now(), updatedAt: Date.now(),
    };
    storage.saveScript({ scenes: toStoredScriptScenes(scriptLines) });
    this.persistSessionStateAtomic(state);
    return { sessionId };
  }

  public async start(
    payload: StartPipelinePayload,
    onProgress: (event: PipelineProgressEvent) => void
  ): Promise<StartPipelineResult> {
    const topic = payload.blueprint?.title || payload.topic;
    const gatedMode = payload.gatedMode !== false;

    // Hard-block check: outputDir bắt buộc phải có để tránh rò rỉ chéo dự án
    const currentConfig = getDecryptedAiStudioConfig();
    if (payload.projectId && payload.projectId !== currentConfig.activeProjectId) {
      throw new Error('Dự án đang chọn đã thay đổi. Mở lại đúng dự án trước khi bắt đầu để tránh dùng nhầm cấu hình.');
    }
    const config = resolveProductionConfig(currentConfig, payload.options, payload.blueprint);
    assertStudioLlmReady(config);
    const activeProject = config.savedProjects?.find((p) => p.id === config.activeProjectId);
    const resolvedOutputDir =
      payload.outputDir?.trim() ||
      activeProject?.outputDir?.trim() ||
      config.outputDir?.trim() ||
      config.channelProfile?.customMediaDir?.trim() ||
      (process.env.VANHSUB_AI_STUDIO_DIR ? path.join(process.env.VANHSUB_AI_STUDIO_DIR, 'output') : undefined);

    if (!resolvedOutputDir) {
      throw new Error(
        'Vui lòng cấu hình thư mục lưu trữ (Output Directory) riêng cho dự án này trước khi bắt đầu. ' +
        'Hệ thống đã chặn để tránh lưu đè hoặc sử dụng nhầm dữ liệu/ảnh nhân vật của dự án khác.'
      );
    }

    const sessionId = `ai-studio-${Date.now()}-${crypto.randomBytes(4).toString('hex')}`;

    const session: PipelineSessionState = {
      sessionId,
      topic,
      currentStage: 1,
      stageName: 'source',
      status: 'running',
      progress: 5,
      gatedMode,
      outputDir: resolvedOutputDir,
      ownerProjectId: activeProject?.id,
      configSnapshot: captureSessionConfig(config),
      workspaceDir: newSessionWorkspace(resolvedOutputDir, sessionId),
      mediaDir: (config.channelProfile?.customMediaDir || config.flowEngine.downloadDir)
        ? newSessionWorkspace(config.channelProfile?.customMediaDir || config.flowEngine.downloadDir!, sessionId)
        : path.join(newSessionWorkspace(resolvedOutputDir, sessionId), '05_media'),
      flowProjectUrl: payload.flowProjectUrl?.trim() || activeProject?.flowProjectUrl?.trim() || undefined,
      stages: {
        1: { status: 'pending', stageName: STAGE_CONFIG[1].label },
        2: { status: 'pending', stageName: STAGE_CONFIG[2].label },
        3: { status: 'pending', stageName: STAGE_CONFIG[3].label },
        4: { status: 'pending', stageName: STAGE_CONFIG[4].label },
        5: { status: 'pending', stageName: STAGE_CONFIG[5].label },
        6: { status: 'pending', stageName: STAGE_CONFIG[6].label },
        7: { status: 'pending', stageName: STAGE_CONFIG[7].label },
        8: { status: 'pending', stageName: STAGE_CONFIG[8].label },
      },
      artifacts: {
        blueprint: payload.blueprint,
        ideaSummary: payload.blueprint?.rawSummary || payload.blueprint?.title || topic,
        characterAnchor: aiStudioStyleRefsService.resolveCharacterAnchorFromConfig(config),
        settingAnchor: aiStudioStyleRefsService.resolveSettingAnchorFromConfig(config),
      } as any,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };

    this.persistSessionStateAtomic(session);

    this.launchPipeline(session, 1, onProgress);

    return { sessionId };
  }

  public async autoFillIdea(payload: AutoFillIdeaPayload): Promise<AutoFillIdeaResult> {
    const config = getDecryptedAiStudioConfig();
    const effectiveChannelProfile = {
      ...(config.channelProfile || {}),
      ...(payload.channelProfile || {}),
    };
    const blueprint = await aiStudioLlmService.analyzeIdeaBlueprint(
      payload.topic,
      config.llm,
      payload.aspectRatio || '16:9',
      undefined,
      effectiveChannelProfile
    );
    return {
      title: blueprint.title || blueprint.topic,
      hookConcept: blueprint.hookConcept,
      narrativeAngle: blueprint.narrativeAngle,
      outline: blueprint.outline || blueprint.keyBeats || [],
      thumbnailConcept: blueprint.thumbnailConcept || '',
      thumbnailPrompt: blueprint.thumbnailPrompt || '',
    };
  }

  public async approveStage(
    payload: ApproveStagePayload,
    onProgress: (event: PipelineProgressEvent) => void
  ): Promise<ApproveStageResult> {
    const lease = reserveSessionOperation(payload.sessionId);
    try {
      const session = await this.getState({ sessionId: payload.sessionId });
      if (!session) {
        throw new Error(`Session không tồn tại: ${payload.sessionId}`);
      }
      if (session.manualMode) throw new Error('Phiên thủ công: nhập media cho scene và dùng Xuất video thủ công; không chạy provider tự động.');
      if (!Number.isInteger(payload.currentStage) || payload.currentStage !== session.currentStage ||
          session.status !== 'awaiting_approval' || session.stages[session.currentStage]?.status !== 'success') {
        throw new Error('Chỉ được duyệt bước hiện tại đã hoàn tất và đang chờ duyệt.');
      }

      if (payload.currentStage === 2) {
        assertUsableScript({ ...session.artifacts, ...payload.updatedArtifacts }.scriptLines);
      }
      if ([1, 4, 7].includes(payload.currentStage)) assertStudioLlmReady(this.resolveSessionConfig(session));
      const candidate = { ...session, artifacts: { ...session.artifacts, ...payload.updatedArtifacts } };
      const issue = stageApprovalIssue(candidate);
      if (issue) throw new Error(issue);
      if (payload.currentStage === 3 || payload.currentStage === 7) {
        const file = payload.currentStage === 3 ? candidate.artifacts.audioPath : candidate.artifacts.videoPath;
        if (!file || !fs.existsSync(file) || !fs.statSync(file).isFile() || !fs.statSync(file).size) throw new Error('Media đã duyệt không còn tồn tại.');
      }
      if (payload.currentStage === 6) {
        for (const scene of candidate.artifacts.scenes || []) {
          const file = scene.assetPath || scene.videoPath || scene.imagePath;
          if (!file || !fs.existsSync(file) || !fs.statSync(file).isFile() || !fs.statSync(file).size) throw new Error('Media của scene không còn hợp lệ.');
        }
      }
      if (payload.updatedArtifacts) {
        if (payload.currentStage !== 2 || Object.keys(payload.updatedArtifacts).some(key => key !== 'scriptLines')) {
          throw new Error('Duyệt stage không được thay đường dẫn artifact. Hãy dùng chức năng sửa/nhập tương ứng.');
        }
        applyScriptLines(session, payload.updatedArtifacts.scriptLines!);
      }

      const nextStage = (payload.currentStage + 1) as AiStudioStageId;
      if (nextStage > 8) {
        session.status = 'completed';
        session.progress = 100;
        this.persistSessionStateAtomic(session);
        onProgress({
          sessionId: session.sessionId,
          stage: 8,
          stageName: 'Hoàn thành',
          progress: 100,
          status: 'success',
          message: 'Đã hoàn thành toàn bộ quy trình sản xuất video AI Studio!',
          artifacts: session.artifacts,
        });
        lease.release();
        return { success: true };
      }

      session.status = 'running';
      delete session.error;
      session.currentStage = nextStage;
      session.stageName = STAGE_CONFIG[nextStage].name;
      this.persistSessionStateAtomic(session);

      this.launchPipeline(session, nextStage, onProgress, lease);

      return { success: true, nextStage };
    } catch (err) { lease.release(); throw err; }
  }

  // ==========================================================================
  // Pipeline Resume (Checkpoint Restoration & Error Recovery)
  // ==========================================================================
  public async resume(
    payload: ResumePipelinePayload,
    onProgress: (event: PipelineProgressEvent) => void
  ): Promise<ResumePipelineResult> {
    const lease = reserveSessionOperation(payload.sessionId);
    try {
      const session = await this.getState({ sessionId: payload.sessionId });
      if (!session) {
        throw new Error(`Session không tồn tại: ${payload.sessionId}`);
      }

      if (session.manualMode) throw new Error('Phiên thủ công chỉ nhập media và xuất video; không chạy provider tự động.');
      session.stages = session.stages || ({} as any);
      session.artifacts = session.artifacts || ({} as any);

      const targetStage = (payload.fromStage ?? (session.status === 'cancelled' && session.stages[session.currentStage]?.status === 'success'
        ? session.currentStage + 1 : session.currentStage)) as AiStudioStageId;
      if (!Number.isInteger(targetStage) || targetStage < 1 || targetStage > 8) throw new Error('Bước chạy lại phải nằm trong khoảng 1–8.');

      // Validate state transition integrity: cannot resume stage N without completed stage N-1
      if (targetStage > 1) {
        const prevStage = (targetStage - 1) as AiStudioStageId;
        const prevStageCompleted = session.stages[prevStage]?.status === 'success';
        if (!prevStageCompleted) {
          throw new Error(
            `IllegalStateTransitionError: Không thể chuyển tới bước ${targetStage} (${STAGE_CONFIG[targetStage]?.label}) khi bước ${prevStage} chưa hoàn tất thành công.`
          );
        }
      }

      if (payload.mode && payload.mode !== 'resume_missing') {
        if (targetStage !== 6) throw new Error('Tạo lại media phải bắt đầu từ Bước 6.');
        selectVisualJobs(session.artifacts.scenes || [], payload.mode, payload.selectedShotIds);
      }

      if (targetStage === 3) assertUsableScript(session.artifacts.scriptLines);
      if ([1, 2, 5, 8].includes(targetStage)) assertStudioLlmReady(this.resolveSessionConfig(session));

      if (payload.storyboardOptions) {
        if (targetStage !== 5) throw new Error('Thay đổi cách phân cảnh phải chạy lại từ Bước 5.');
        const { shotMode, granularity } = payload.storyboardOptions;
        if ((shotMode && !['single', 'multi'].includes(shotMode)) ||
            (granularity && !['detailed', 'balanced', 'fast'].includes(granularity))) {
          throw new Error('Cấu hình phân cảnh không hợp lệ.');
        }
        const config = this.resolveSessionConfig(session);
        session.configSnapshot = captureSessionConfig({ ...config, flowEngine: {
          ...config.flowEngine, ...(shotMode ? { shotMode } : {}), ...(granularity ? { granularity } : {}),
        } });
      }

      if(targetStage===6&&this.resolveSessionConfig(session).flowEngine.engine==='official_api'&&payload.mode&&payload.mode!=='resume_missing'){
        const config=this.resolveSessionConfig(session),candidate=structuredClone(session);
        for(const scene of selectVisualJobs(candidate.artifacts.scenes||[],payload.mode,payload.selectedShotIds))scene.officialGenerationNonce=crypto.randomUUID();
        await prepareOfficialMedia(candidate,config,this.getDiskStorageManager(session.sessionId),payload.mode,payload.selectedShotIds,lease.controller.signal);
        session.artifacts.scenes=candidate.artifacts.scenes;
      }
      invalidateSessionArtifacts(session, targetStage);

      session.status = 'running';
      delete session.error;
      session.currentStage = targetStage;
      session.stageName = STAGE_CONFIG[targetStage].name;
      this.persistSessionStateAtomic(session);

      const runOptions = {
        mode: payload.mode || 'resume_missing',
        selectedShotIds: payload.selectedShotIds,
      };

      this.launchPipeline(session, targetStage, onProgress, lease, runOptions);

      return { success: true };
    } catch (err) { lease.release(); throw err; }
  }

  // ==========================================================================
  // Core 8-Stage Execution Loop
  // ==========================================================================
  private async runPipelineLoop(
    session: PipelineSessionState,
    startStage: AiStudioStageId,
    onProgress: (event: PipelineProgressEvent) => void,
    signal: AbortSignal,
    runOptions?: {
      mode?: 'resume_missing' | 'regenerate_selected' | 'regenerate_all';
      selectedShotIds?: string[];
    }
  ): Promise<void> {
    const config = this.resolveSessionConfig(session);
    const activeProject = config.savedProjects?.find((p) => p.id === config.activeProjectId);
    const sessionDir = this.getSessionDir(session.sessionId);
    const effectiveOutputDir =
      session.workspaceDir || session.outputDir ||
      (fs.existsSync(sessionDir) ? sessionDir : undefined);

    if (!effectiveOutputDir || !effectiveOutputDir.trim()) {
      throw new Error(
        'Chưa cấu hình thư mục lưu trữ (Output Directory) riêng cho dự án này. ' +
        'Vui lòng thiết lập thư mục trong Cấu hình Dự án trước khi tiếp tục sinh ảnh/video.'
      );
    }

    const assetsDir = this.getSessionAssetsDir(session.sessionId, effectiveOutputDir);
    const effectiveMediaDir = session.mediaDir;
    const storage = this.getDiskStorageManager(session.sessionId, effectiveMediaDir, effectiveOutputDir);

    session.stages = session.stages || ({} as any);
    session.artifacts = session.artifacts || ({} as any);

    try {
      for (let stageNum = startStage; stageNum <= 8; stageNum++) {
        if (signal.aborted || session.status === 'cancelled') {
          session.status = 'cancelled';
          if (session.stages && session.stages[session.currentStage]) {
            session.stages[session.currentStage].status = 'error';
            session.stages[session.currentStage].error = 'Đã hủy bởi người dùng';
          }
          this.persistSessionStateAtomic(session);
          return;
        }

        const stage = stageNum as AiStudioStageId;
        const stageMeta = STAGE_CONFIG[stage];

        session.currentStage = stage;
        session.stageName = stageMeta.name;
        session.stages[stage] = session.stages[stage] || { status: 'pending', stageName: stageMeta.label };
        session.stages[stage].status = 'running';
        session.stages[stage].startedAt = Date.now();
        session.progress = stageMeta.baseProgress - 5;
        this.persistSessionStateAtomic(session);

        onProgress({
          sessionId: session.sessionId,
          stage,
          stageName: stageMeta.label,
          progress: session.progress,
          status: 'running',
          message: `Đang thực hiện công đoạn ${stage}/8: ${stageMeta.label}...`,
        });

        // Execute stage
        switch (stage) {
          case 1: {
            // Stage 1: Dữ kiện (Source / Idea Blueprint)
            if (session.artifacts.blueprint && (session.artifacts.blueprint.title || session.artifacts.blueprint.topic)) {
              session.artifacts.ideaSummary =
                session.artifacts.blueprint.rawSummary ||
                session.artifacts.blueprint.title ||
                session.artifacts.blueprint.topic;
            } else {
              const blueprint = await aiStudioLlmService.analyzeIdeaBlueprint(
                session.topic,
                config.llm,
                config.flowEngine.aspectRatio === '9:16' ? '9:16' : '16:9',
                (msg: string) => {
                  onProgress({
                    sessionId: session.sessionId,
                    stage: 1,
                    stageName: stageMeta.label,
                    progress: session.progress,
                    status: 'running',
                    message: msg,
                  });
                },
                config.channelProfile
              );
              session.artifacts.blueprint = blueprint;
              session.artifacts.ideaSummary = blueprint.rawSummary;
            }

            // Task 1: Save facts (Stage 1) into storage (00_facts/facts.json)
            const blueprint = session.artifacts.blueprint;
            const outlineBeats = blueprint?.outline || blueprint?.keyBeats || [];
            const factsList = outlineBeats.map((content: string, idx: number) => ({
              id: `f${idx + 1}`,
              content,
            }));
            if (factsList.length === 0 && session.topic) {
              factsList.push({ id: 'f1', content: session.topic });
            }
            const factsData: PipelineFactsData = {
              project_id: session.sessionId,
              topic: session.topic,
              facts: factsList,
            };
            storage.saveFacts(factsData);
            storage.appendActionLog({
              ts: new Date().toISOString(),
              action: 'input',
              target: '00_facts/facts.json',
              retry: 0,
              status: 'ok',
              details: { factCount: factsList.length, topic: session.topic },
            });
            break;
          }

          case 2: {
            // Stage 2: Kịch bản (Script Generation)
            const scriptLines = await aiStudioLlmService.generateScript(
              session.topic,
              config.llm,
              (msg: string) => {
                onProgress({
                  sessionId: session.sessionId,
                  stage: 2,
                  stageName: stageMeta.label,
                  progress: session.progress,
                  status: 'running',
                  message: msg,
                });
              },
              session.artifacts.blueprint,
              config.channelProfile
            );
            signal.throwIfAborted();
            assertUsableScript(scriptLines);
            session.artifacts.scriptLines = scriptLines;
            try {
              const evaluation = await aiStudioLlmService.evaluateScript(
                scriptLines,
                session.artifacts.blueprint,
                config.channelProfile,
                config.llm
              );
              session.artifacts.scriptEvaluation = evaluation;
            } catch (evalErr) {
              console.warn('[AiStudioPipelineEngine] Script auto-evaluation error (non-fatal):', evalErr);
            }

            // Task 1: Save script (Stage 2) into storage (01_script/script.json)
            const scriptScenes = toStoredScriptScenes(scriptLines || []);
            const scriptData: PipelineScriptData = {
              scenes: scriptScenes,
            };
            storage.saveScript(scriptData);
            storage.appendActionLog({
              ts: new Date().toISOString(),
              action: 'input',
              target: '01_script/script.json',
              retry: 0,
              status: 'ok',
              details: { sceneCount: scriptScenes.length },
            });
            break;
          }

          case 3: {
            // Stage 3: Lồng tiếng (Edge-TTS Voiceover)
            const voiceoverPath = path.join(assetsDir, 'voiceover.mp3');
            const scriptLines = session.artifacts.scriptLines || [];
            assertUsableScript(scriptLines);

            // Ưu tiên giọng đọc cụ thể và provider trong ChannelProfile nếu đã cấu hình
            const isKokoro = config.channelProfile?.ttsEngine === 'kokoro_tts' ||
              (!config.channelProfile?.ttsEngine && config.voice.provider === 'local_onnx');
            const isPiper = config.channelProfile?.ttsEngine === 'piper_local' ||
              (!config.channelProfile?.ttsEngine && config.voice.provider === 'piper_local');
            const isTikTok = config.channelProfile?.ttsEngine
              ? config.channelProfile.ttsEngine === 'tiktok_tts'
              : config.voice.provider === 'tiktok_tts';
            const defaultVoice = isPiper ? 'vi_VN-vais1000-medium' : isKokoro ? 'af_heart' : isTikTok ? 'BV074_streaming' : 'vi-VN-HoaiMyNeural';

            const voiceConfig: AiStudioVoiceConfig = {
              ...config.voice,
              provider: isPiper ? 'piper_local' : isKokoro ? 'local_onnx' : isTikTok ? 'tiktok_tts' : 'edge_tts',
              voiceId: config.channelProfile?.specificVoice || config.voice.voiceId || defaultVoice,
            };

            const ttsResult = await aiStudioTtsService.synthesizeVoiceover(
              scriptLines,
              voiceConfig,
              voiceoverPath,
              signal
            );
            signal.throwIfAborted();
            session.artifacts.audioPath = ttsResult.audioPath;
            session.artifacts.scriptLines = scriptLines;
            session.artifacts.alignmentSource = ttsResult.alignmentSource;
            if (ttsResult.wordTimestamps && ttsResult.wordTimestamps.length > 0) {
              session.artifacts.wordsAlignment = ttsResult.wordTimestamps;
            }
            // Cache raw metadata in memory for stage 4
            this.memorySessions.set(`${session.sessionId}:ttsMetadata`, ttsResult.rawMetadata);

            // Sync per-line audio into 02_voice/{scene_id}.mp3
            for (let i = 0; i < scriptLines.length; i++) {
              const line = scriptLines[i];
              const sceneId = `scene_${String(i + 1).padStart(2, '0')}`;
              const destVoicePath = storage.getVoiceAudioPath(sceneId);
              if (line.audioPath && fs.existsSync(line.audioPath)) {
                try {
                  fs.copyFileSync(line.audioPath, destVoicePath);
                  const durSec = line.durationMs ? Math.round((line.durationMs / 1000) * 100) / 100 : 4.0;
                  storage.updateSceneMetadata(sceneId, {
                    voice_path: storage.getVoiceAudioRelativePath(sceneId),
                    voice_duration_sec: durSec,
                  });
                } catch (copyErr) {
                  console.warn(`[AiStudioPipelineEngine] Failed to copy voice file for ${sceneId}:`, copyErr);
                }
              }
            }

            storage.appendActionLog({
              ts: new Date().toISOString(),
              action: 'download',
              target: '02_voice',
              retry: 0,
              status: 'ok',
              details: { voiceoverPath, lineCount: scriptLines.length },
            });
            break;
          }

          case 4: {
            // Stage 4: Trích xuất Time (Alignment)
            const rawMetadata = this.memorySessions.get(`${session.sessionId}:ttsMetadata`) || [];
            const fullText = (session.artifacts.scriptLines || []).map((l) => l.text).join(' ');
            const audioPath = session.artifacts.audioPath!;
            const audioDurationSec = await aiStudioTtsService.probeMediaDuration(audioPath);
            const totalDurationMs = Math.round(audioDurationSec * 1000);

            const alignResult = aiStudioTtsService.extractAlignment(
              rawMetadata,
              fullText,
              session.artifacts.scriptLines || [],
              totalDurationMs,
              session.artifacts.wordsAlignment
            );
            session.artifacts.wordsAlignment = alignResult.wordsAlignment;
            session.artifacts.alignmentSource ||= alignResult.alignmentSource;
            session.artifacts.scriptLines = alignResult.alignedLines;

            // Probe timing if 02_voice exists
            const scriptScenes = (session.artifacts.scriptLines || []).map((_, idx) => `scene_${String(idx + 1).padStart(2, '0')}`);
            const hasVoiceFiles = fs.existsSync(storage.paths.voiceDir) &&
              fs.readdirSync(storage.paths.voiceDir).some(f => f.endsWith('.mp3'));

            if (hasVoiceFiles) {
              try {
                await aiStudioStoryboardService.extractTiming(storage, scriptScenes);
              } catch (probeErr) {
                console.warn('[AiStudioPipelineEngine] extractTiming probing warning in Stage 4:', probeErr);
              }
            }

            storage.appendActionLog({
              ts: new Date().toISOString(),
              action: 'probe',
              target: '03_timing/timing.json',
              retry: 0,
              status: 'ok',
              details: { totalDurationMs, alignedLineCount: alignResult.alignedLines.length },
            });
            break;
          }

          case 5: {
            // Stage 5: Storyboard (Visual Prompts & Dynamic Probed Audio Timing)
            const scriptLines = session.artifacts.scriptLines || [];
            const scriptScenes = toStoredScriptScenes(scriptLines || []);
            const scriptData: PipelineScriptData = { scenes: scriptScenes };
            storage.saveScript(scriptData);

            // Probing real audio timing (via 02_voice/ or audio clips) and writing 03_timing/timing.json
            let timingData = storage.readTiming();
            const voiceFilesExist = fs.existsSync(storage.paths.voiceDir) &&
              fs.readdirSync(storage.paths.voiceDir).some(f => f.endsWith('.mp3'));

            if (!timingData || !timingData.scenes || timingData.scenes.length === 0) {
              if (voiceFilesExist) {
                try {
                  timingData = await aiStudioStoryboardService.extractTiming(
                    storage,
                    scriptScenes.map(s => s.scene_id)
                  );
                } catch (probeErr) {
                  console.warn('[AiStudioPipelineEngine] Audio probing encountered warning, using fallback timeline:', probeErr);
                }
              }

              if (!timingData || !timingData.scenes || timingData.scenes.length === 0) {
                let timelineSec = 0;
                const timingScenes = scriptScenes.map((sc, idx) => {
                  const line = scriptLines[idx];
                  const durationSec = line?.durationMs ? Math.round((line.durationMs / 1000) * 100) / 100 : 4.0;
                  const startSec = Math.round(timelineSec * 100) / 100;
                  const endSec = Math.round((timelineSec + durationSec) * 100) / 100;
                  timelineSec += durationSec;
                  return {
                    scene_id: sc.scene_id,
                    audio_file: storage.getVoiceAudioRelativePath(sc.scene_id),
                    start_sec: startSec,
                    end_sec: endSec,
                    duration_sec: durationSec,
                  };
                });
                timingData = {
                  project_id: session.sessionId,
                  probed_engine: 'ffprobe',
                  scenes: timingScenes,
                  total_duration_sec: Math.round(timelineSec * 100) / 100,
                };
                storage.saveTiming(timingData);
              }
            }

            // Smooth progress updates from 55% to 70%
            const numScenes = scriptScenes.length || 1;
            for (let i = 0; i < numScenes; i++) {
              const sc = scriptScenes[i];
              const pct = 55 + Math.round(((i + 1) / numScenes) * 14);
              onProgress({
                sessionId: session.sessionId,
                stage: 5,
                stageName: STAGE_CONFIG[5].label,
                progress: pct,
                status: 'running',
                message: `Đang sinh kịch bản hình ảnh phân cảnh ${i + 1}/${numScenes} (${sc?.scene_id || ''})...`,
                lastAction: {
                  ts: new Date().toISOString(),
                  scene_id: sc?.scene_id,
                  action: 'input',
                  target: '04_storyboard',
                  retry: 0,
                  status: 'ok',
                },
              });
            }

            // Generate dynamic storyboard via AiStudioStoryboardService.generateStoryboard()
            const storyboardData = await aiStudioStoryboardService.generateStoryboard({
              storage,
              script: scriptData,
              timing: timingData,
              stylePromptPrefix: config.flowEngine.stylePromptPrefix,
              negativePrompt: config.flowEngine.negativePrompt,
              channelProfile: config.channelProfile,
              backgroundPrompt: config.channelProfile?.projectBackgroundPrompt,
              shotMode: config.flowEngine.shotMode,
              granularity: config.flowEngine.granularity || 'balanced',
              llmConfig: config.llm,
              topic: session.artifacts.blueprint?.title || session.artifacts.blueprint?.topic || 'Video Production',
            });

            // Adapt storyboard shots to session.artifacts.scenes for backwards compatibility with Stage 7
            const legacyScenes: StoryboardScene[] = [];
            const timingScenes = timingData.scenes || [];
            let accumulatedMs = 0;

            storyboardData.scenes.forEach((sc, scIdx) => {
              const isSingleShotScene = sc.shots.length === 1;
              sc.shots.forEach((shot) => {
                const startMs = isSingleShotScene && typeof sc.start_sec === 'number'
                  ? Math.round(sc.start_sec * 1000)
                  : typeof shot.start_sec === 'number'
                  ? Math.round(shot.start_sec * 1000)
                  : (timingScenes.find((t) => t.scene_id === sc.scene_id)?.start_sec ? Math.round(timingScenes.find((t) => t.scene_id === sc.scene_id)!.start_sec * 1000) : accumulatedMs);
                const durationMs = isSingleShotScene && typeof sc.duration_sec === 'number' && sc.duration_sec > 0
                  ? Math.round(sc.duration_sec * 1000)
                  : typeof shot.duration_sec === 'number'
                  ? Math.round(shot.duration_sec * 1000)
                  : Math.round((shot.expected_duration_sec || 4.0) * 1000);
                const endMs = startMs + durationMs;

                // Tôn trọng hoàn toàn quyết định media_type của Storyboard từ AI đạo diễn:
                // media_type='video' → animate via I2V; 'image' → Ken Burns static.
                // Không để cấu hình outputMode mặc định đè bẹp các phân cảnh video thành ảnh tĩnh.
                const motionType = shot.media_type === 'video' ? 'video' : 'ken_burns';

                const lineText = shot.dialogue_lines && shot.dialogue_lines.length > 0
                  ? shot.dialogue_lines.join(' ')
                  : (sc.narration || '');

                const lineIndex = shot.assigned_sentences && shot.assigned_sentences.length > 0
                  ? shot.assigned_sentences[0] - 1
                  : scIdx;

                legacyScenes.push({
                  id: shot.shot_id,
                  shotId: shot.shot_id,
                  lineIndex,
                  startMs,
                  endMs,
                  durationMs,
                  lineText,
                  visualPrompt: shot.image_prompt,
                  motionPrompt: shot.motion_note,
                  negativePrompt: config.flowEngine.negativePrompt || 'blurry, low quality, distorted, watermark, no text, no subtitles, no speech bubbles, no words, clean visual illustration',
                  motionType,
                  status: 'pending',
                });

                accumulatedMs = Math.max(accumulatedMs, endMs);

                // Record assigned_sentences and assigned_scene_ids in index.json shot metadata
                storage.updateShotMetadata(sc.scene_id, shot.shot_id, {
                  start_sec: shot.start_sec,
                  duration_sec: shot.duration_sec,
                  expected_duration_sec: shot.expected_duration_sec,
                  assigned_sentences: shot.assigned_sentences,
                  assigned_scene_ids: shot.assigned_scene_ids,
                  dialogue_lines: shot.dialogue_lines,
                  previous_shot_id: shot.previous_shot_id,
                });
              });
            });

            session.artifacts.scenes = legacyScenes;
            session.artifacts.storyboardSynthesis = storyboardData.synthesis;
            session.progress = 70;

            const syn = storyboardData.synthesis;
            const pacingInfo = syn ? ` [TB ${syn.avg_duration_per_shot_sec}s/shot, ~${Math.round(syn.estimated_production_time_sec / 60)}p, ~${syn.estimated_credits} credits]` : '';

            onProgress({
              sessionId: session.sessionId,
              stage: 5,
              stageName: STAGE_CONFIG[5].label,
              progress: 70,
              status: 'running',
              message: `Hoàn tất Storyboard (${storyboardData.scenes.length} phân cảnh, ${legacyScenes.length} góc quay media)${pacingInfo}.`,
              artifacts: session.artifacts,
            });
            break;
          }

          case 6: {
            if(config.flowEngine.engine==='official_api'){
              await runOfficialMediaStage(session,config,storage,signal,()=>this.persistSessionStateAtomic(session),runOptions?.mode,runOptions?.selectedShotIds,pct=>onProgress({sessionId:session.sessionId,stage:6,stageName:STAGE_CONFIG[6].label,progress:pct,status:'running',message:'Đang tạo/kiểm định media qua Official API.',artifacts:session.artifacts}));
              if(selectVisualJobs(session.artifacts.scenes||[]).length)throw new Error('OFFICIAL_MEDIA_INCOMPLETE: còn scene thiếu media hợp lệ.');
              session.progress=85;break;
            }
            if(config.flowEngine.engine==='manual'){
              if(selectVisualJobs(session.artifacts.scenes||[]).length)throw new Error('BLOCKED: đã chọn Manual Import. Nhập ảnh/video vào từng scene; không gọi provider.');
              session.progress=85;break;
            }
            // Stage 6: Ảnh / Video (Visual Assets via Google Flow Pure Web RPC mặc định)
            const isLegacyDom = config.flowEngine.engine === 'dom' || config.flowEngine.engine === 'legacy_dom';
            const isRpcEngine = !isLegacyDom;
            if (isRpcEngine) {
              let scenes = session.artifacts.scenes || [];
              if (scenes.length === 0) {
                // Phục hồi scenes từ Storyboard trong storage nếu session.artifacts.scenes rỗng
                const storyboard = storage.readStoryboard();
                if (storyboard?.scenes && storyboard.scenes.length > 0) {
                  scenes = [];
                  for (let sIdx = 0; sIdx < storyboard.scenes.length; sIdx++) {
                    const sc = storyboard.scenes[sIdx];
                    for (const shot of sc.shots) {
                      // Tôn trọng hoàn toàn quyết định media_type của Storyboard từ AI đạo diễn:
                      const motionType = shot.media_type === 'video' ? 'video' : 'ken_burns';
                      scenes.push({
                        id: shot.shot_id,
                        shotId: shot.shot_id,
                        sceneId: sc.scene_id,
                        lineIndex: shot.assigned_sentences?.[0] ? shot.assigned_sentences[0] - 1 : sIdx,
                        startMs: Math.round(shot.start_sec * 1000),
                        endMs: Math.round((shot.start_sec + shot.duration_sec) * 1000),
                        durationMs: Math.round(shot.duration_sec * 1000),
                        lineText: shot.dialogue_lines?.join(' ') || sc.narration || '',
                        visualPrompt: shot.image_prompt,
                        negativePrompt: config.flowEngine.negativePrompt || 'blurry, low quality, distorted, watermark, no text, no subtitles, no speech bubbles, no words, clean visual illustration',
                        motionType,
                        status: 'pending',
                      });
                    }
                  }
                  session.artifacts.scenes = scenes;
                }
              }

              const jobs = selectVisualJobs(scenes, runOptions?.mode, runOptions?.selectedShotIds);
              if (!jobs.length) {
                session.artifacts.scenes = scenes;
                session.progress = 85;
                break;
              }

              const flowReady=flowCreditReadiness(config.flowEngine,session.ownerProjectId||session.projectId,jobs.length);
              if(flowReady.status!=='CONFIGURATION_READY')throw new Error('FLOW_CREDITS_BLOCKED: '+flowReady.reasons.join(' '));
              for(const sc of scenes)if(sc.mediaProvenance?.source==='google_flow_ui'&&(!sc.assetPath||!fs.existsSync(sc.assetPath)||crypto.createHash('sha256').update(fs.readFileSync(sc.assetPath)).digest('hex')!==sc.mediaProvenance.sha256))throw new Error('FLOW_ARTIFACT_INTEGRITY_FAILED');
              const targetVisualDir = storage.paths.mediaDir || assetsDir;

              const onSceneComplete = async (completedScene: StoryboardScene, idx: number) => {
                const shotId = completedScene.shotId || completedScene.id;
                let targetSceneId = (completedScene as any).sceneId;
                if (!targetSceneId) {
                  const idxData = storage.readIndex();
                  for (const [sId, sData] of Object.entries(idxData.scenes || {})) {
                    if (sData.shots && sData.shots[shotId]) {
                      targetSceneId = sId;
                      break;
                    }
                  }
                  if (!targetSceneId) {
                    targetSceneId = shotId.includes('_shot_') ? shotId.split('_shot_')[0] : shotId;
                  }
                }

                if (completedScene.videoPath && fs.existsSync(completedScene.videoPath)) {
                  try {
                    const durSec = await aiStudioVideoAssembler.probeDuration(completedScene.videoPath);
                    if (durSec > 0) {
                      completedScene.originalMediaDurationSec = Number(durSec.toFixed(3));
                    }
                  } catch {}
                  storage.updateShotMetadata(targetSceneId, shotId, {
                    status: 'video_ready',
                    video_path: completedScene.videoPath,
                    ...(completedScene.imagePath && fs.existsSync(completedScene.imagePath)
                      ? { image_path: completedScene.imagePath }
                      : {}),
                  });
                } else if (completedScene.imagePath && fs.existsSync(completedScene.imagePath)) {
                  storage.updateShotMetadata(targetSceneId, shotId, {
                    status: 'image_ready',
                    image_path: completedScene.imagePath,
                    video_path: '',
                  });
                }

                this.persistSessionStateAtomic(session);

                const stepProgress = 70 + Math.round(((idx + 1) / jobs.length) * 15);
                onProgress({
                  sessionId: session.sessionId,
                  stage: 6,
                  stageName: STAGE_CONFIG[6].label,
                  progress: Math.min(84, stepProgress),
                  status: 'running',
                  message: `[RPC] Hoàn tất media phân cảnh ${idx + 1}/${jobs.length}`,
                  artifacts: {
                    ...session.artifacts,
                    scenes: session.artifacts.scenes,
                  },
                });
              };

              let targetFlowProjectId = extractFlowProjectId(
                session.flowProjectUrl ||
                activeProject?.flowProjectUrl ||
                (config.flowEngine?.projectId && config.flowEngine.projectId.trim() ? config.flowEngine.projectId : undefined)
              );
              if (!['playwright','browser_automation'].includes(config.flowEngine.engine||'') && FlowBridgeServer.getInstance().isConnected()) {
                if (signal?.aborted) throw new Error('Tác vụ đã bị huỷ.');
                // Nếu session và activeProject chưa liên kết cụ thể, kiểm tra xem Chrome có đang mở sẵn 1 project Flow không
                if (!targetFlowProjectId) {
                  try {
                    const tabInfo = await FlowBridgeServer.getInstance().getFlowTabInfo(2000);
                    if (tabInfo?.projectId) {
                      // Đảm bảo không chiếm nhầm project Flow của một dự án khác trong VanhSub
                      const isOwnedByOther = config.savedProjects?.some(
                        (p) => p.id !== config.activeProjectId && extractFlowProjectId(p.flowProjectUrl) === tabInfo.projectId
                      );
                      if (!isOwnedByOther) {
                        targetFlowProjectId = tabInfo.projectId;
                        console.log(
                          `[AiStudioPipelineEngine] 🔗 Tự động liên kết với dự án Google Flow đang mở trên Chrome: ${targetFlowProjectId}`
                        );
                      } else {
                        console.log(
                          `[AiStudioPipelineEngine] 🛡️ Dự án Flow ${tabInfo.projectId} trên Chrome đã thuộc dự án khác trong VanhSub. Sẽ tự động tạo dự án mới riêng biệt trên Flow.`
                        );
                      }
                    }
                  } catch (e: any) {
                    console.warn('[AiStudioPipelineEngine] Không thể tự động lấy projectId từ tab Chrome:', e?.message || e);
                  }
                }

                const linked = await GoogleFlowBrowserMutex.getInstance().runExclusive(
                  () => FlowBridgeServer.getInstance().ensureProject(targetFlowProjectId || undefined)
                );
                targetFlowProjectId = linked.projectId;
                session.flowProjectUrl = `https://labs.google/fx/vi/tools/flow/project/${linked.projectId}`;
                this.persistSessionStateAtomic(session);

                // Lưu liên kết lâu dài vào cấu hình activeProject nếu trước đó chưa có
                if (activeProject && !activeProject.flowProjectUrl) {
                  activeProject.flowProjectUrl = session.flowProjectUrl;
                  try {
                    const currentCfg = getDecryptedAiStudioConfig();
                    const updatedProjects = (currentCfg.savedProjects || []).map((p) =>
                      p.id === activeProject.id ? { ...p, flowProjectUrl: session.flowProjectUrl } : p
                    );
                    updateAiStudioConfig({
                      savedProjects: updatedProjects,
                      ...(currentCfg.activeProjectId === activeProject.id ? { flowProjectUrl: session.flowProjectUrl } : {}),
                    });
                    console.log(`[AiStudioPipelineEngine] 💾 Đã lưu liên kết Flow Project ${linked.projectId} vào hồ sơ dự án "${activeProject.name || activeProject.id}"`);
                  } catch (cfgErr) {
                    console.warn('[AiStudioPipelineEngine] Cảnh báo lưu flowProjectUrl vào savedProjects:', cfgErr);
                  }
                }
              }
              const effectiveFlowEngineConfig: AiStudioFlowEngineConfig = {
                ...config.flowEngine,
                projectId: targetFlowProjectId || undefined,
                flowReceiptDir:path.join(session.workspaceDir!,'.flow-receipts'),
                flowCreditProjectId:session.ownerProjectId||session.projectId,
                generationNonce: runOptions?.mode && runOptions.mode !== 'resume_missing' ? crypto.randomUUID() : undefined,
              };

              const dispatchResult = await aiStudioVisualService.dispatchVisualAssets(
                jobs,
                effectiveFlowEngineConfig,
                targetVisualDir,
                (pct, msg) => {
                  onProgress({
                    sessionId: session.sessionId,
                    stage: 6,
                    stageName: STAGE_CONFIG[6].label,
                    progress: 70 + Math.round(pct * 0.15),
                    status: 'running',
                    message: msg,
                  });
                },
                signal,
                onSceneComplete
              );
              const results = new Map(dispatchResult.scenes.map(scene => [scene.shotId || scene.id, scene]));
              session.artifacts.scenes = scenes.map(scene => results.get(scene.shotId || scene.id) || scene);
              if (selectVisualJobs(session.artifacts.scenes).length) {
                throw new Error('Còn shot thiếu media. Hãy chạy phần còn thiếu trước khi duyệt dựng video.');
              }
              session.artifacts.mediaDir = targetVisualDir;
              session.progress = 85;
              this.persistSessionStateAtomic(session);

              onProgress({
                sessionId: session.sessionId,
                stage: 6,
                stageName: STAGE_CONFIG[6].label,
                progress: 85,
                status: 'running',
                message: `Đã hoàn tất toàn bộ media assets (${dispatchResult.scenes.length} phân cảnh).`,
                artifacts: session.artifacts,
              });
              break;
            }

            // Resolve storyboard from storage
            let storyboard = storage.readStoryboard();
            if (!storyboard || !storyboard.scenes || storyboard.scenes.length === 0) {
              const scenes = session.artifacts.scenes || [];
              if (scenes.length === 0) {
                throw new Error('Không tìm thấy dữ liệu Storyboard trong thư mục dự án.');
              }
              const timingScenes = (storage.readTiming()?.scenes) || [];
              storyboard = {
                project_id: session.sessionId,
                scenes: scenes.map((s, idx) => {
                  const sceneId = s.id.includes('_shot_') ? s.id.split('_shot_')[0] : s.id;
                  const tItem = timingScenes.find((t) => t.scene_id === sceneId);
                  const startSec = typeof s.startMs === 'number' ? s.startMs / 1000 : (tItem?.start_sec ?? 0);
                  const durSec = typeof s.durationMs === 'number' ? s.durationMs / 1000 : (tItem?.duration_sec ?? 4.0);
                  const endSec = startSec + durSec;
                  const assignedSentences = typeof s.lineIndex === 'number' ? [s.lineIndex + 1] : [idx + 1];
                  const dialogueLines = s.lineText ? [s.lineText] : [];

                  return {
                    scene_id: sceneId,
                    narration: s.lineText,
                    start_sec: startSec,
                    end_sec: endSec,
                    duration_sec: durSec,
                    assigned_sentences: assignedSentences,
                    assigned_scene_ids: [sceneId],
                    shots: [{
                      shot_id: s.id,
                      shot_index: 1,
                      start_sec: startSec,
                      duration_sec: durSec,
                      expected_duration_sec: durSec,
                      assigned_sentences: assignedSentences,
                      assigned_scene_ids: [sceneId],
                      dialogue_lines: dialogueLines,
                      image_prompt: s.visualPrompt,
                      motion_note: 'subtle camera motion',
                      media_type: (s.motionType === 'video' ? 'video' : 'image') as 'image' | 'video',
                      reason: `Phục hồi từ legacy scene data: motionType="${s.motionType}"`,
                      confidence: 'low' as 'high' | 'medium' | 'low',
                    }],
                  };
                }),
              };
              storage.saveStoryboard(storyboard);
            }
            // storyboard is guaranteed non-null here (either loaded or just created above)
            const resolvedStoryboard = storyboard!;

            // Dual UI Modes (Offscreen vs Live Window)
            const bridge = FlowBridgeServer.getInstance();
            const isBridgeConnected = bridge.isConnected();
            const sessionMgr = GoogleVeoSessionManager.getInstance();
            const mutex = GoogleFlowBrowserMutex.getInstance();

            let lobbyWin: any = null;
            if (!isBridgeConnected) {
              // Mở sảnh Google Flow theo uiMode đã cấu hình (mặc định offscreen) khi KHÔNG dùng Chrome Extension
              const flowUiMode: 'offscreen' | 'live_window' =
                config.channelProfile?.flowUiMode || config.flowEngine?.uiMode || 'offscreen';
              lobbyWin = sessionMgr.getLobbyWindow();
              if (!lobbyWin || lobbyWin.isDestroyed()) {
                await sessionMgr.openLobbyWindow({ uiMode: flowUiMode });
                lobbyWin = sessionMgr.getLobbyWindow();
              } else if (flowUiMode === 'offscreen') {
                sessionMgr.hideLobbyOffscreen();
              }
              if (flowUiMode === 'live_window' && lobbyWin && !lobbyWin.isDestroyed()) {
                lobbyWin.show();
                lobbyWin.focus();
              }
            }

            // Flatten all shots
            interface ShotWorkItem {
              sceneId: string;
              shot: StoryboardShotItem;
            }
            const allShots: ShotWorkItem[] = [];
            for (const sc of resolvedStoryboard.scenes) {
              for (const shot of sc.shots) {
                allShots.push({ sceneId: sc.scene_id, shot });
              }
            }

            const totalShots = allShots.length;
            const videoShotCount = allShots.filter(s => s.shot.media_type === 'video' || config.flowEngine.outputMode === 'video').length;
            const totalSteps = totalShots + videoShotCount;
            let completedSteps = 0;

            // ================================================================
            // STEP 0: Ensure Style Refs (1 time per project — idempotent)
            // ================================================================
            onProgress({
              sessionId: session.sessionId,
              stage: 6,
              stageName: STAGE_CONFIG[6].label,
              progress: 70,
              status: 'running',
              message: 'Đang kiểm tra/thiết lập style references (nhân vật & background)...',
            });

            // Ưu tiên: hostAvatarUrl (ảnh user upload trong AutoPilotView) -> channelCharacters[0].avatarUrl -> referenceImagePath
            const rawCharAvatar =
              config.channelProfile?.hostAvatarUrl ||
              config.channelProfile?.channelCharacters?.[0]?.avatarUrl ||
              config.flowEngine?.referenceImagePath;

            const isCharSourceValid = Boolean(
              rawCharAvatar &&
              (rawCharAvatar.startsWith('data:image/') ||
               rawCharAvatar.startsWith('file://') ||
               fs.existsSync(rawCharAvatar))
            );

            const rawBgImage = config.flowEngine?.referenceImagePath;
            const isBgSourceValid = Boolean(
              rawBgImage &&
              (rawBgImage.startsWith('data:image/') ||
               rawBgImage.startsWith('file://') ||
               fs.existsSync(rawBgImage))
            );

            const charAnchor: CharacterAnchorConfig | undefined =
              (session.artifacts as any)?.characterAnchor ||
              aiStudioStyleRefsService.resolveCharacterAnchorFromConfig(config);
            const settingAnchor: SettingAnchorConfig | undefined =
              (session.artifacts as any)?.settingAnchor ||
              aiStudioStyleRefsService.resolveSettingAnchorFromConfig(config);

            const styleRefsResult = await aiStudioStyleRefsService.ensureStyleRefs({
              storage,
              win: lobbyWin,
              characterAnchor: charAnchor,
              settingAnchor: settingAnchor,
              // Pass user-provided image paths if available
              userCharacterImagePath: isCharSourceValid ? rawCharAvatar : (charAnchor?.referenceImagePaths?.[0] || undefined),
              userBackgroundImagePath: isBgSourceValid ? rawBgImage : (settingAnchor?.referenceImagePaths?.[0] || undefined),
              // Text prompts for AI generation fallback
              characterStylePrompt: charAnchor?.visualTraits
                || config.channelProfile?.hostDescription
                || config.channelProfile?.channelCharacters?.[0]?.descriptionEn
                || 'a professional video host character',
              backgroundStylePrompt: settingAnchor?.environmentTraits
                || config.channelProfile?.projectBackgroundPrompt
                || 'clean modern studio background, professional lighting',
              aspectRatio: config.flowEngine.aspectRatio,
            });

            (session.artifacts as any).characterAnchor = charAnchor;
            (session.artifacts as any).settingAnchor = settingAnchor;

            // FIXED canonical reference paths for ALL shots (no chain dependency)
            const characterRefPath = storage.getStyleRefPath('character');
            const backgroundRefPath = storage.getStyleRefPath('background');
            const styleManifestHash = storage.hashStyleManifest();
            const { manifest: styleManifest } = styleRefsResult;

            console.log(
              `[Stage 6] Style refs ready (${styleRefsResult.alreadySetUp ? 'cached' : 'newly setup'}). ` +
              `hash=${styleManifestHash}`
            );

            // ================================================================
            // STEP 1: Get/create model_config.json for this project
            // ================================================================
            const modelConfig = aiStudioModelConfigService.getOrCreateModelConfig(storage);

            const runMode = runOptions?.mode || 'resume_missing';
            const selectedIds = new Set(runOptions?.selectedShotIds || []);

            // Tính toán số shot thực tế cần xử lý
            const missingShots = allShots.filter((s) => !storage.isAssetValid(s.sceneId, s.shot.shot_id, 'image'));
            let targetShotsCount = 0;
            let modeLabel = 'Tiếp tục (chỉ phần thiếu)';

            if (runMode === 'regenerate_all') {
              targetShotsCount = totalShots;
              modeLabel = 'Chạy lại toàn bộ';
            } else if (runMode === 'regenerate_selected') {
              targetShotsCount = allShots.filter((s) => selectedIds.has(s.shot.shot_id)).length;
              modeLabel = `Chạy lại ${targetShotsCount} shot đã chọn`;
            } else {
              targetShotsCount = missingShots.length;
              modeLabel = `Tiếp tục (${targetShotsCount} shot còn thiếu)`;
            }

            console.log(
              `[Stage 6] 🚀 Bắt đầu Stage 6 với chế độ: [${modeLabel}]. ` +
              `Tổng số: ${totalShots} shots, số shot sẽ sinh mới: ${targetShotsCount} shots. (Mode: ${runMode})`
            );

            onProgress({
              sessionId: session.sessionId,
              stage: 6,
              stageName: STAGE_CONFIG[6].label,
              progress: 70,
              status: 'running',
              message: `[${modeLabel}] Bắt đầu xử lý ${targetShotsCount}/${totalShots} phân cảnh...`,
            });

            // ================================================================
            // STEP 2: Per-shot generation loop
            // ================================================================
            for (let idx = 0; idx < allShots.length; idx++) {
              const { sceneId, shot } = allShots[idx];

              if (signal.aborted || (session.status as string) === 'cancelled') {
                throw new Error('Quá trình tạo visual media đã bị hủy bởi người dùng.');
              }

              const isSelected = selectedIds.has(shot.shot_id);

              // Nếu chạy chế độ regenerate_selected mà shot này KHÔNG được chọn: bỏ qua, giữ nguyên asset cũ
              const effectiveMediaType = (shot.media_type === 'video' || config.flowEngine.outputMode === 'video') ? 'video' : 'image';
              if (runMode === 'regenerate_selected' && !isSelected) {
                completedSteps += (effectiveMediaType === 'video' ? 2 : 1);
                continue;
              }

              // Quyết định forceRegenerate:
              // - regenerate_all: forceRegenerate = true cho tất cả
              // - regenerate_selected: forceRegenerate = true cho các shot được chọn
              // - resume_missing: forceRegenerate = false (FlowMediaAutomationEngine tự skip nếu asset đã hợp lệ)
              const forceRegenerate = runMode === 'regenerate_all' || (runMode === 'regenerate_selected' && isSelected);

              // 2a. Resolve model for this shot (preferred_model > config default > builtin)
              const modelInfo = aiStudioModelConfigService.resolveModelForShot(
                modelConfig,
                effectiveMediaType,
                shot.preferred_model
              );

              // 2b. Validate video duration limit (detection only — no auto-split here)
              if (effectiveMediaType === 'video' && shot.expected_duration_sec) {
                const durationError = aiStudioModelConfigService.validateVideoDuration(
                  modelInfo,
                  shot.shot_id,
                  shot.expected_duration_sec
                );
                if (durationError) {
                  console.error(durationError);
                  storage.appendActionLog(FlowMediaAutomationEngine.createActionLog({
                    scene_id: sceneId,
                    shot_id: shot.shot_id,
                    action: 'poll',
                    target: 'duration_validation',
                    status: 'failed',
                    details: { error: durationError },
                  }));
                  completedSteps++; // count as processed to keep progress consistent
                  continue; // skip this shot
                }
              }

              // 2c. Determine which reference images to upload based on model max_ref_images
              const { refsToUpload, backgroundSentAs } =
                aiStudioModelConfigService.resolveReferenceUploads(
                  modelInfo,
                  characterRefPath,
                  backgroundRefPath
                );

              // 2d. Compose final prompt in spec order:
              //     character_style_prompt + [background_style_prompt if bg not uploaded] + image_prompt + [motion_note if video]
              const compositePrompt = aiStudioModelConfigService.buildCompositePrompt({
                characterStylePrompt: styleManifest.character_style_prompt,
                backgroundStylePrompt: styleManifest.background_style_prompt,
                imagePrompt: shot.image_prompt,
                motionNote: shot.motion_note,
                mediaType: effectiveMediaType,
                backgroundSentAs,
              });

              // 2e: Step A — Text-to-Image (always runs for every shot)
              const t2iProgress = 70 + Math.round((completedSteps / totalSteps) * 15);
              onProgress({
                sessionId: session.sessionId,
                stage: 6,
                stageName: STAGE_CONFIG[6].label,
                progress: Math.min(84, t2iProgress),
                status: 'running',
                message: `[T2I/${effectiveMediaType.toUpperCase()}] Shot ${shot.shot_id} (${idx + 1}/${totalShots}) — model: ${modelInfo.modelName}, refs: ${refsToUpload.length} imgs, bg: ${backgroundSentAs}`,
                lastAction: {
                  ts: new Date().toISOString(),
                  scene_id: sceneId,
                  shot_id: shot.shot_id,
                  action: 'input',
                  target: 'prompt_input',
                  retry: 0,
                  status: 'ok',
                },
              });

              const activeProj = config.savedProjects?.find((p) => p.id === config.activeProjectId);
              const targetFlowProjectId = extractFlowProjectId(activeProj?.flowProjectUrl || (config as any).flowProjectUrl);
              const targetFlowProjectName = activeProj?.name || (config as any).projectName || (config as any).topic;

              const imgResult = await mutex.runExclusive(async () => {
                return FlowMediaAutomationEngine.generateImageForShot({
                  storage,
                  win: lobbyWin,
                  sceneId,
                  shotId: shot.shot_id,
                  prompt: compositePrompt,
                  aspectRatio: config.flowEngine.aspectRatio,
                  targetProjectId: targetFlowProjectId,
                  targetProjectName: targetFlowProjectName,
                  // Primary reference: character_ref (always), background_ref (if model supports 2+)
                  referenceImagePath: refsToUpload.length > 0 ? refsToUpload[0] : undefined,     // character_ref always at index 0
                  referenceImagePaths: refsToUpload,       // full list for multi-ref models
                  forceRegenerate,
                });
              }, `ai_studio_t2i_${shot.shot_id}`);

              if (!imgResult.success) {
                throw new Error(`Tạo ảnh thất bại cho ${shot.shot_id}: ${imgResult.error || 'Unknown error'}`);
              }

              // Write style provenance metadata to index.json
              storage.updateShotMetadata(sceneId, shot.shot_id, {
                model_used: modelInfo.modelName,
                style_manifest_hash: styleManifestHash,
                references_used: refsToUpload.map(p => path.basename(p)),
                background_sent_as: backgroundSentAs,
              });

              // Cập nhật ngay lập tức vào session.artifacts.scenes để UI hiển thị ảnh theo thời gian thực
              if (session.artifacts.scenes) {
                const targetScene = session.artifacts.scenes.find(
                  (s) => s.id === shot.shot_id || s.shotId === shot.shot_id
                );
                if (targetScene) {
                  targetScene.imagePath = imgResult.imagePath;
                  targetScene.shotId = shot.shot_id;
                  if (!targetScene.videoPath) {
                    targetScene.assetPath = imgResult.imagePath;
                  }
                  targetScene.status = 'ready';
                }
                this.persistSessionStateAtomic(session);
              }

              completedSteps++;

              // Gửi event tiến độ kèm artifacts cập nhật để giao diện hiển thị ảnh ngay lập tức
              onProgress({
                sessionId: session.sessionId,
                stage: 6,
                stageName: STAGE_CONFIG[6].label,
                progress: Math.min(84, t2iProgress),
                status: 'running',
                message: `[T2I] Đã tạo thành công ảnh cho shot ${shot.shot_id} (${idx + 1}/${totalShots})`,
                lastAction: {
                  ts: new Date().toISOString(),
                  scene_id: sceneId,
                  shot_id: shot.shot_id,
                  action: 'download',
                  target: imgResult.relativePath,
                  retry: 0,
                  status: 'ok',
                },
                artifacts: {
                  ...session.artifacts,
                  scenes: session.artifacts.scenes,
                },
              });

              // 2f: Step B — Image-to-Video (for video shots or global video mode)
              const shouldGenerateVideo = shot.media_type === 'video' || config.flowEngine.outputMode === 'video';
              if (shouldGenerateVideo) {
                if (signal.aborted || (session.status as string) === 'cancelled') {
                  throw new Error('Quá trình tạo visual media đã bị hủy bởi người dùng.');
                }

                // Resolve matching script beat line to extract visual action and camera movement
                const assignedIndices = shot.assigned_sentences || [];
                const matchingLines = (session.artifacts.scriptLines || []).filter((l) =>
                  assignedIndices.includes(l.index) || assignedIndices.includes(l.index + 1)
                );
                const primaryLine = matchingLines[0];
                const visualAction = primaryLine?.visualAction || primaryLine?.visualNote || shot.image_prompt || '';
                const cameraMovement = primaryLine?.cameraMovement || shot.motion_note || 'steady cinematic camera motion';

                // Enrich Veo motion prompt: [Character Anchor Traits] + [Subject Action] + [Camera Movement]
                const richMotionPrompt = charAnchor
                  ? buildVeoMotionPrompt(charAnchor, visualAction, cameraMovement)
                  : buildVeoMotionPrompt({
                      characterName: config.channelProfile?.hostName,
                      characterTraits: config.channelProfile?.hostDescription,
                      visualAction,
                      cameraMovement,
                      motionNote: shot.motion_note,
                    });

                const i2vProgress = 70 + Math.round((completedSteps / totalSteps) * 15);
                onProgress({
                  sessionId: session.sessionId,
                  stage: 6,
                  stageName: STAGE_CONFIG[6].label,
                  progress: Math.min(84, i2vProgress),
                  status: 'running',
                  message: `[I2V] Shot ${shot.shot_id} (${completedSteps + 1}/${totalSteps}) — ${richMotionPrompt}`,
                  lastAction: {
                    ts: new Date().toISOString(),
                    scene_id: sceneId,
                    shot_id: shot.shot_id,
                    action: 'upload',
                    target: 'file_input',
                    retry: 0,
                    status: 'ok',
                  },
                });

                const vidResult = await mutex.runExclusive(async () => {
                  return FlowMediaAutomationEngine.generateVideoForShot({
                    storage,
                    win: lobbyWin,
                    sceneId,
                    shotId: shot.shot_id,
                    sourceImagePath: imgResult.imagePath,
                    motionNote: shot.motion_note,
                    prompt: richMotionPrompt,
                    characterAnchor: charAnchor,
                    visualAction,
                    cameraMovement,
                    expectedDurationSec: shot.expected_duration_sec || 4.0,
                    tolerancePct: 15.0,
                    forceRegenerate,
                  });
                }, `ai_studio_i2v_${shot.shot_id}`);

                if (!vidResult.success) {
                  console.warn(`[AiStudioPipelineEngine] I2V failed for ${shot.shot_id}, falling back to static image:`, vidResult.error);
                } else {
                  if (vidResult.needsReview) {
                    console.info(`[AiStudioPipelineEngine] Shot ${shot.shot_id} duration deviation flagged needs_review: true (actual: ${vidResult.actualDurationSec}s, expected: ${vidResult.expectedDurationSec}s, dev: ${vidResult.deviationPct}%)`);
                  }
                  if (vidResult.videoPath && session.artifacts.scenes) {
                    const targetScene = session.artifacts.scenes.find(
                      (s) => s.id === shot.shot_id || s.shotId === shot.shot_id
                    );
                    if (targetScene) {
                      targetScene.videoPath = vidResult.videoPath;
                      targetScene.assetPath = vidResult.videoPath;
                      targetScene.status = 'ready';
                    }
                    this.persistSessionStateAtomic(session);
                  }

                  onProgress({
                    sessionId: session.sessionId,
                    stage: 6,
                    stageName: STAGE_CONFIG[6].label,
                    progress: Math.min(84, i2vProgress),
                    status: 'running',
                    message: `[I2V] Đã tạo thành công video cho shot ${shot.shot_id}`,
                    lastAction: {
                      ts: new Date().toISOString(),
                      scene_id: sceneId,
                      shot_id: shot.shot_id,
                      action: 'download',
                      target: vidResult.relativePath,
                      retry: 0,
                      status: 'ok',
                    },
                    artifacts: {
                      ...session.artifacts,
                      scenes: session.artifacts.scenes,
                    },
                  });
                }
                completedSteps++;
              }
            }

            // Refresh index.json and sync final local asset paths into session.artifacts.scenes
            const finalIndex = storage.readIndex();
            const updatedScenes = (session.artifacts.scenes || []).map((scene) => {
              for (const sc of Object.values(finalIndex.scenes || {})) {
                const shotMeta = sc.shots?.[scene.id] || (scene.shotId ? sc.shots?.[scene.shotId] : undefined);
                if (shotMeta) {
                  if (shotMeta.image_path) {
                    scene.imagePath = storage.resolvePath(shotMeta.image_path);
                  }
                  if (shotMeta.video_path) {
                    scene.videoPath = storage.resolvePath(shotMeta.video_path);
                  }
                  const relativeAsset = shotMeta.video_path || shotMeta.image_path;
                  if (relativeAsset) {
                    scene.assetPath = storage.resolvePath(relativeAsset);
                    scene.status = 'ready';
                  }
                  if (shotMeta.shot_id) {
                    scene.shotId = shotMeta.shot_id;
                  }
                }
              }
              return scene;
            });

            session.artifacts.scenes = updatedScenes;
            session.artifacts.mediaDir = storage.paths.mediaDir;
            session.progress = 85;

            onProgress({
              sessionId: session.sessionId,
              stage: 6,
              stageName: STAGE_CONFIG[6].label,
              progress: 85,
              status: 'running',
              message: `Đã hoàn tất toàn bộ media assets (${totalShots} shots).`,
              artifacts: session.artifacts,
            });
            break;
          }

          case 7: {
            // Stage 7: Dựng phim (FFmpeg Assembly)
            const finalVideoPath = path.join(assetsDir, `final_video_${crypto.randomUUID()}.mp4`);
            const scenes = session.artifacts.scenes || [];
            const audioPath = session.artifacts.audioPath!;

            const assemblyResult = await aiStudioVideoAssembler.assembleVideo({
              scenes,
              voiceoverAudioPath: audioPath,
              outputPath: finalVideoPath,
              renderingConfig: config.rendering,
              subtitleConfig: config.subtitles,
              aspectRatio: config.flowEngine.aspectRatio,
              wordsAlignment: session.artifacts.wordsAlignment,
              scriptLines: session.artifacts.scriptLines,
              signal,
              onRegisterProcess: (cmd) => {
                registerSessionProcess(session.sessionId, cmd);
              },
              onProgress: (pct) => {
                onProgress({
                  sessionId: session.sessionId,
                  stage: 7,
                  stageName: STAGE_CONFIG[7].label,
                  progress: 85 + Math.round(pct * 0.1),
                  status: 'running',
                  message: `Đang render video FFmpeg: ${pct}%...`,
                });
              },
            });

            session.artifacts.videoPath = assemblyResult.videoPath;
            session.artifacts.srtPath = path.join(assetsDir, 'subtitles.ass');
            break;
          }

          case 8: {
            // Stage 8: SEO & Xuất bản (Metadata)
            const metadata = await aiStudioLlmService.generateSeoMetadata(
              session.topic,
              session.artifacts.scriptLines || [],
              config.llm
            );
            signal.throwIfAborted();
            session.artifacts.metadata = metadata;
            break;
          }
        }

        signal.throwIfAborted();
        // Mark stage as completed
        session.stages[stage].status = 'success';
        session.stages[stage].completedAt = Date.now();
        session.progress = stageMeta.baseProgress;
        this.persistSessionStateAtomic(session);

        // Gated Approval Check: Pause and wait for explicit user approval before next stage
        if (session.gatedMode && stage < 8) {
          session.status = 'awaiting_approval';
          this.persistSessionStateAtomic(session);

          onProgress({
            sessionId: session.sessionId,
            stage,
            stageName: stageMeta.label,
            progress: session.progress,
            status: 'awaiting_approval',
            message: `Công đoạn ${stage}/8 (${stageMeta.label}) đã hoàn thành. Đang chờ phê duyệt từ bạn để tiếp tục...`,
            artifacts: session.artifacts,
          });

          return; // Pause loop until user calls approveStage
        }

        onProgress({
          sessionId: session.sessionId,
          stage,
          stageName: stageMeta.label,
          progress: session.progress,
          status: 'success',
          artifacts: session.artifacts,
        });
      }

      // All 8 stages finished successfully
      session.status = 'completed';
      session.progress = 100;
      this.persistSessionStateAtomic(session);


      onProgress({
        sessionId: session.sessionId,
        stage: 8,
        stageName: 'Hoàn thành',
        progress: 100,
        status: 'success',
        message: 'Đã hoàn thành toàn bộ quy trình sản xuất video AI Studio!',
        artifacts: session.artifacts,
      });
    } catch (err: any) {
      if (signal.aborted || session.status === 'cancelled') {
        session.status = 'cancelled';
        if (session.stages && session.stages[session.currentStage]) {
          session.stages[session.currentStage].status = 'error';
          session.stages[session.currentStage].error = 'Đã hủy bởi người dùng';
        }
        this.persistSessionStateAtomic(session);
        return;
      }
      throw err;
    }
  }

  // ==========================================================================
  // Granular Step Handlers
  // ==========================================================================
  public async renderSingleLineVoice(
    payload: RenderSingleLineVoicePayload
  ): Promise<RenderSingleLineVoiceResult> {
    return aiStudioTtsService.renderSingleLineVoice(payload);
  }

  private blockUnapprovedFlowRegeneration(): void {
    throw new Error('FLOW_REGENERATION_REQUIRES_NEW_APPROVAL: tạo job/episode mới để duyệt credit; không vượt receipt hoặc sửa snapshot cũ.');
  }

  public async regenerateSceneAsset(
    payload: RegenerateSceneAssetPayload,
    onProgress?: (pct: number, msg: string) => void,
    signal?: AbortSignal
  ): Promise<RegenerateSceneAssetResult> {
    if (!payload.sessionId) {
      if(payload.flowConfig?.engine==='official_api'||getDecryptedAiStudioConfig().flowEngine.engine==='official_api')throw new Error('OFFICIAL_SESSION_REQUIRED: generation phải thuộc episode và scene cụ thể.');
      throw new Error('FLOW_SESSION_REQUIRED: generation cần episode và quyền credit riêng; không nhận receipt path từ renderer.');
    }
    return withSessionOperation(payload.sessionId, (jobSignal) => this.regenerateSceneAssetInternal(
      payload, onProgress, signal ? AbortSignal.any([signal, jobSignal]) : jobSignal
    ));
  }

  private async regenerateSceneAssetInternal(
    payload: RegenerateSceneAssetPayload,
    onProgress?: (pct: number, msg: string) => void,
    signal?: AbortSignal
  ): Promise<RegenerateSceneAssetResult> {
    if (payload.sessionId) {
      const ownerSession = await this.getState({ sessionId: payload.sessionId });
      signal?.throwIfAborted();
      if (ownerSession?.manualMode) throw new Error('Phiên thủ công không gọi provider tạo media; hãy nhập ảnh/video từ máy.');
      if (!ownerSession) throw new Error('Không tìm thấy phiên AI Studio để tạo lại media.');
      if (!ownerSession.artifacts.scenes?.some(scene => scene.id === payload.sceneId || scene.shotId === payload.sceneId)) throw new Error('Phân cảnh không tồn tại trong phiên này.');
      if (!/^[\w-]+$/.test(payload.sceneId)) throw new Error('ID phân cảnh không hợp lệ.');
      // Ownership failures must not be swallowed by the legacy provider fallback.
      const storage = this.getDiskStorageManager(payload.sessionId, ownerSession.mediaDir);
      const config = this.resolveSessionConfig(ownerSession);
      if(config.flowEngine.engine==='manual')throw new Error('Manual Import không gọi generation; hãy chọn media từ máy.');
      if(config.flowEngine.engine==='official_api'){
        if(payload.mode==='both')throw new Error('UNSUPPORTED: Official API cần chọn Ảnh hoặc Video rõ ràng; I2V dùng keyframe đã nhập.');
        const candidate=structuredClone(ownerSession),target=candidate.artifacts.scenes!.find(s=>s.id===payload.sceneId||s.shotId===payload.sceneId)!;
        target.motionType=payload.mode==='image'?'ken_burns':'video';target.visualPrompt=payload.visualPrompt||target.visualPrompt;
        target.officialGenerationNonce=crypto.randomUUID();
        await prepareOfficialMedia(candidate,config,storage,'regenerate_selected',[payload.sceneId],signal);signal?.throwIfAborted();
        candidate.configSnapshot=captureSessionConfig(config);this.persistSessionStateAtomic(candidate);
        await runOfficialMediaStage(candidate,config,storage,signal||new AbortController().signal,()=>this.persistSessionStateAtomic(candidate),'regenerate_selected',[payload.sceneId],pct=>onProgress?.(pct,'Official API'));
        const missing=selectVisualJobs(candidate.artifacts.scenes||[]).length>0;
        candidate.currentStage=missing?5:6;candidate.stageName=missing?'storyboard':'visuals';candidate.status='awaiting_approval';candidate.stages[candidate.currentStage]={status:'success',stageName:STAGE_CONFIG[candidate.currentStage].label};this.persistSessionStateAtomic(candidate);
        return {imagePath:target.imagePath,videoPath:target.videoPath,assetPath:target.assetPath!};
      }
      this.blockUnapprovedFlowRegeneration();
      try {
        const shotId = payload.sceneId;
        const sceneId = shotId.includes('_shot_') ? shotId.split('_shot_')[0] : shotId;
        const sessionMgr = GoogleVeoSessionManager.getInstance();
        const mutex = GoogleFlowBrowserMutex.getInstance();

        const activeProj = config.savedProjects?.find((p) => p.id === config.activeProjectId);
        let targetFlowProjectId = extractFlowProjectId(
          ownerSession?.flowProjectUrl ||
          payload.flowConfig?.projectId ||
          activeProj?.flowProjectUrl ||
          (config as any).flowProjectUrl
        );
        if (!targetFlowProjectId) throw new Error('Phiên chưa có project Flow riêng. Hãy chạy bước tạo media trước khi tạo lại cảnh.');
        if (payload.flowConfig?.projectId && extractFlowProjectId(payload.flowConfig.projectId) !== targetFlowProjectId) {
          throw new Error('Project tạo lại cảnh không khớp project đã lưu của phiên.');
        }
        const targetFlowProjectName = activeProj?.name || (config as any).projectName || (config as any).topic;

        const existingScene = ownerSession?.artifacts?.scenes?.find((s) => s.id === shotId || s.shotId === shotId);
        const effectivePayload: RegenerateSceneAssetPayload = {
          ...payload,
          ...(payload.mode === 'video' && existingScene
            ? {
                imagePath: existingScene.imagePath,
                inputImageAsset: (existingScene as any).inputImageAsset,
                motionPrompt:
                  (existingScene as any).motionPrompt ||
                  (existingScene as any).cameraMovement ||
                  payload.visualPrompt,
              }
            : {}),
          flowConfig: {
            ...config.flowEngine,
            ...payload.flowConfig,
            projectId: payload.flowConfig?.projectId || targetFlowProjectId || undefined,
          },
        } as RegenerateSceneAssetPayload;

        // Mặc định luôn ưu tiên Pure Web RPC trừ khi người dùng chỉ định rõ engine === 'dom'
        const isLegacyDom =
          effectivePayload.flowConfig?.engine === 'dom' ||
          effectivePayload.flowConfig?.engine === 'legacy_dom' ||
          config.flowEngine.engine === 'dom' ||
          config.flowEngine.engine === 'legacy_dom';
        const isRpc = !isLegacyDom;

        if (isRpc) {
          const adapter = BrowserAutomationAdapter.getInstance();
          if (!adapter.isConnected('flow')) {
            try {
              await adapter.connect({ provider: 'flow' });
            } catch {
              // Port 9224 not active, continue with existing connection mode
            }
          }
          const rpcRes = await aiStudioVisualService.regenerateSceneAsset(
            effectivePayload,
            storage.paths.mediaDir,
            onProgress,
            signal
          );
          let probedMediaDur: number | undefined;
          if (rpcRes.assetPath && fs.existsSync(rpcRes.assetPath)) {
            signal?.throwIfAborted();
            const session = await this.getState({ sessionId: payload.sessionId });
            if (session && session.artifacts.scenes) {
              signal?.throwIfAborted();
              const targetScene = session.artifacts.scenes.find((s) => s.id === shotId || s.shotId === shotId);
              if (targetScene) {
                applySceneMedia(session, shotId, { imagePath: rpcRes.imagePath, videoPath: rpcRes.videoPath, visualPrompt: payload.visualPrompt });
                if (rpcRes.videoPath) {
                  probedMediaDur = await aiStudioVideoAssembler.probeDuration(rpcRes.videoPath);
                  targetScene.originalMediaDurationSec = probedMediaDur;
                }
                if ((rpcRes as any).inputImageAsset) (targetScene as any).inputImageAsset = (rpcRes as any).inputImageAsset;
                this.persistSessionStateAtomic(session);
              }
            }
            if (rpcRes.videoPath) {
              storage.updateShotMetadata(sceneId, shotId, {
                status: 'video_ready',
                video_path: rpcRes.videoPath,
              });
            } else if (rpcRes.imagePath) {
              storage.updateShotMetadata(sceneId, shotId, {
                status: 'image_ready',
                image_path: rpcRes.imagePath,
                video_path: '',
              });
            }
          }
          return {
            ...rpcRes,
            ...(probedMediaDur !== undefined ? { originalMediaDurationSec: probedMediaDur } : {}),
          } as RegenerateSceneAssetResult;
        }

        // Đảm bảo cửa sổ Flow sẵn sàng theo uiMode đã cấu hình (mặc định offscreen) khi KHÔNG dùng Chrome Extension
        let lobbyWin: any = null;
        if (!FlowBridgeServer.getInstance().isConnected()) {
          const flowUiMode: 'offscreen' | 'live_window' =
            config.channelProfile?.flowUiMode || config.flowEngine?.uiMode || 'offscreen';
          lobbyWin = sessionMgr.getLobbyWindow();
          if (!lobbyWin || lobbyWin.isDestroyed()) {
            await sessionMgr.openLobbyWindow({ uiMode: flowUiMode });
            lobbyWin = sessionMgr.getLobbyWindow();
          } else if (flowUiMode === 'offscreen') {
            sessionMgr.hideLobbyOffscreen();
          }
          if (flowUiMode === 'live_window' && lobbyWin && !lobbyWin.isDestroyed()) {
            lobbyWin.show();
            lobbyWin.focus();
          }
        }

        const session = await this.getState({ sessionId: payload.sessionId });
        const sc = session?.artifacts.scenes?.find((s) => s.id === shotId || s.shotId === shotId);
        const defaultMode = sc?.motionType === 'video' ? 'video' : (payload.flowConfig?.outputMode === 'video' ? 'video' : 'both');
        const mode = payload.mode || defaultMode;

        if (mode === 'video') {
          const expectedDurationSec = sc ? sc.durationMs / 1000 : 4.0;
          const charAnchor = (session?.artifacts as any)?.characterAnchor ||
            aiStudioStyleRefsService.resolveCharacterAnchorFromConfig(config);
          const scLine = session?.artifacts.scriptLines?.find((l) => l.index === sc?.lineIndex || l.id === sc?.id);
          const visualAction = scLine?.visualAction || scLine?.visualNote || sc?.visualPrompt || '';
          const cameraMovement = scLine?.cameraMovement || 'steady cinematic camera motion';
          const richPrompt = charAnchor
            ? buildVeoMotionPrompt(charAnchor, visualAction, cameraMovement)
            : buildVeoMotionPrompt({
                characterName: config.channelProfile?.hostName,
                characterTraits: config.channelProfile?.hostDescription,
                visualAction,
                cameraMovement,
              });

          const vidResult = await mutex.runExclusive(async () => {
            return FlowMediaAutomationEngine.generateVideoForShot({
              storage,
              win: lobbyWin,
              sceneId,
              shotId,
              prompt: richPrompt,
              characterAnchor: charAnchor,
              visualAction,
              cameraMovement,
              expectedDurationSec,
              forceRegenerate: true,
            });
          }, `regenerate_vid_${shotId}`);

          if (vidResult.success && vidResult.videoPath) {
            if (session && session.artifacts.scenes) {
              signal?.throwIfAborted();
              const targetScene = session.artifacts.scenes.find((s) => s.id === shotId || s.shotId === shotId);
              if (targetScene) {
                applySceneMedia(session, shotId, { videoPath: vidResult.videoPath });
                this.persistSessionStateAtomic(session);
              }
            }
            return { assetPath: vidResult.videoPath, videoPath: vidResult.videoPath };
          }
        }

        // Chuẩn hoá lấy đường dẫn ảnh tham chiếu từ style_refs/character_ref.png trên đĩa
        let effectiveRef: string | undefined;
        const canonicalCharPath = storage.getStyleRefPath('character');
        if (storage.isFileValidNonEmpty(canonicalCharPath)) {
          effectiveRef = canonicalCharPath;
        } else if (payload.referenceImagePath && fs.existsSync(payload.referenceImagePath) && fs.statSync(payload.referenceImagePath).size > 0) {
          effectiveRef = payload.referenceImagePath;
        } else {
          // Fallback an toàn: nếu chưa có file trên đĩa nhưng có avatar/config (kể cả Base64), giải mã và lưu ngay vào style_refs
          const rawAvatar =
            config.channelProfile?.hostAvatarUrl ||
            config.channelProfile?.channelCharacters?.[0]?.avatarUrl ||
            config.flowEngine?.referenceImagePath;
          if (rawAvatar) {
            const saved = aiStudioStyleRefsService.saveImageSource(rawAvatar, canonicalCharPath);
            if (saved && storage.isFileValidNonEmpty(canonicalCharPath)) {
              effectiveRef = canonicalCharPath;
            }
          }
        }

        if (mode === 'image') {
          const imgResult = await mutex.runExclusive(async () => {
            return FlowMediaAutomationEngine.generateImageForShot({
              storage,
              win: lobbyWin,
              sceneId,
              shotId,
              prompt: payload.visualPrompt,
              aspectRatio: payload.flowConfig?.aspectRatio || config.flowEngine.aspectRatio,
              targetProjectId: targetFlowProjectId,
              targetProjectName: targetFlowProjectName,
              referenceImagePath: effectiveRef,
              forceRegenerate: true,
            });
          }, `regenerate_img_${shotId}`);

          if (imgResult.success && imgResult.imagePath) {
            const session = await this.getState({ sessionId: payload.sessionId });
            if (session && session.artifacts.scenes) {
              signal?.throwIfAborted();
              const sc = session.artifacts.scenes.find((s) => s.id === shotId || s.shotId === shotId);
              if (sc) {
                applySceneMedia(session, shotId, { imagePath: imgResult.imagePath, visualPrompt: payload.visualPrompt });
                this.persistSessionStateAtomic(session);
              }
            }
            return { assetPath: imgResult.imagePath, imagePath: imgResult.imagePath };
          }
        } else {
          // mode === 'both': Tạo ảnh mới trước, sau đó tạo video từ ảnh mới
          const imgResult = await mutex.runExclusive(async () => {
            return FlowMediaAutomationEngine.generateImageForShot({
              storage,
              win: lobbyWin,
              sceneId,
              shotId,
              prompt: payload.visualPrompt,
              aspectRatio: payload.flowConfig?.aspectRatio || config.flowEngine.aspectRatio,
              targetProjectId: targetFlowProjectId,
              targetProjectName: targetFlowProjectName,
              referenceImagePath: effectiveRef,
              forceRegenerate: true,
            });
          }, `regenerate_both_img_${shotId}`);

          let imagePath = imgResult.imagePath;
          let videoPath: string | undefined;

          if (imgResult.success && imgResult.imagePath) {
            const session = await this.getState({ sessionId: payload.sessionId });
            const sc = session?.artifacts.scenes?.find((s) => s.id === shotId || s.shotId === shotId);
            const expectedDurationSec = sc ? sc.durationMs / 1000 : 4.0;
            const charAnchor = (session?.artifacts as any)?.characterAnchor ||
              aiStudioStyleRefsService.resolveCharacterAnchorFromConfig(config);
            const scLine = session?.artifacts.scriptLines?.find((l) => l.index === sc?.lineIndex || l.id === sc?.id);
            const visualAction = scLine?.visualAction || scLine?.visualNote || sc?.visualPrompt || '';
            const cameraMovement = scLine?.cameraMovement || 'steady cinematic camera motion';
            const richPrompt = charAnchor
              ? buildVeoMotionPrompt(charAnchor, visualAction, cameraMovement)
              : buildVeoMotionPrompt({
                  characterName: config.channelProfile?.hostName,
                  characterTraits: config.channelProfile?.hostDescription,
                  visualAction,
                  cameraMovement,
                });

            const vidResult = await mutex.runExclusive(async () => {
              return FlowMediaAutomationEngine.generateVideoForShot({
                storage,
                win: lobbyWin,
                sceneId,
                shotId,
                sourceImagePath: imgResult.imagePath,
                prompt: richPrompt,
                characterAnchor: charAnchor,
                visualAction,
                cameraMovement,
                expectedDurationSec,
                forceRegenerate: true,
              });
            }, `regenerate_both_vid_${shotId}`);

            if (vidResult.success && vidResult.videoPath) {
              videoPath = vidResult.videoPath;
            }

            if (session && session.artifacts.scenes) {
              signal?.throwIfAborted();
              const targetScene = session.artifacts.scenes.find((s) => s.id === shotId || s.shotId === shotId);
              if (targetScene) {
                applySceneMedia(session, shotId, { imagePath: imgResult.imagePath, videoPath, visualPrompt: payload.visualPrompt });
                this.persistSessionStateAtomic(session);
              }
            }
            return {
              assetPath: videoPath || imgResult.imagePath,
              imagePath: imgResult.imagePath,
              videoPath,
            };
          }
        }
      } catch (regErr) {
        const isLegacyDom =
          payload.flowConfig?.engine === 'dom' ||
          payload.flowConfig?.engine === 'legacy_dom' ||
          config?.flowEngine?.engine === 'dom' ||
          config?.flowEngine?.engine === 'legacy_dom';
        const isRpc = !isLegacyDom;
        if (isRpc) {
          throw regErr;
        }
        console.warn('[AiStudioPipelineEngine] Storage-backed regenerateSceneAsset error, falling back to visual service:', regErr);
      }
    }

    const cfg = getDecryptedAiStudioConfig();
    const activePrj = cfg.savedProjects?.find((p) => p.id === cfg.activeProjectId);
    const fallbackProjectId = extractFlowProjectId(
      payload.flowConfig?.projectId ||
      activePrj?.flowProjectUrl ||
      (cfg as any).flowProjectUrl
    );
    const effectiveFallbackPayload: RegenerateSceneAssetPayload = {
      ...payload,
      flowConfig: {
        ...payload.flowConfig,
        projectId: payload.flowConfig?.projectId || fallbackProjectId || undefined,
      },
    };
    return aiStudioVisualService.regenerateSceneAsset(effectiveFallbackPayload, undefined, onProgress, signal);
  }

  public async importSceneMedia(
    payload: ImportSceneMediaPayload
  ): Promise<ImportSceneMediaResult> {
    return withSessionOperation(payload.sessionId, (signal) => this.importSceneMediaInternal(payload, signal));
  }

  private async importSceneMediaInternal(
    payload: ImportSceneMediaPayload, signal: AbortSignal
  ): Promise<ImportSceneMediaResult> {
    const { sessionId, sceneId, filePath, mediaType } = payload;
    if (!sessionId || !sceneId || !filePath) {
      return { success: false, assetPath: '', error: 'Thiếu thông tin phiên, phân cảnh hoặc đường dẫn tệp' };
    }

    if (!fs.existsSync(filePath)) {
      return { success: false, assetPath: '', error: `Tệp không tồn tại: ${filePath}` };
    }

    try {
      const ownerSession = await this.getState({ sessionId });
      signal.throwIfAborted();
      if (!ownerSession) throw new Error('Không tìm thấy phiên AI Studio để nhập media.');
      if (!ownerSession.artifacts.scenes?.some(scene => scene.id === sceneId || scene.shotId === sceneId)) throw new Error('Phân cảnh không tồn tại trong phiên này.');
      if (!/^[\w-]+$/.test(sceneId)) throw new Error('ID phân cảnh không hợp lệ.');
      const storage = this.getDiskStorageManager(sessionId, ownerSession.mediaDir);
      const shotId = sceneId;
      const actualSceneId = shotId.includes('_shot_') ? shotId.split('_shot_')[0] : shotId;

      const ext = path.extname(filePath).toLowerCase();
      const isVideo = mediaType ? mediaType === 'video' : ['.mp4', '.mkv', '.mov', '.avi', '.webm'].includes(ext);
      const targetKind = isVideo ? 'vid' : 'img';

      // Tạo đường dẫn phiên bản mới trong thư mục media
      const nextVer = storage.getNextMediaVersion(shotId, targetKind);
      let destPath = nextVer.absolutePath;
      const digest = crypto.createHash('sha256');

      // Copy tệp vào thư mục media của session
      fs.copyFileSync(filePath, destPath);

      try {
        destPath = await aiStudioVisualService.validateMediaFile(destPath, isVideo ? 'video' : 'image', { fullDecode: true });
        if (fs.statSync(destPath).size < 512) await fullDecodeMediaWithFfmpeg(destPath);
        for await (const chunk of fs.createReadStream(destPath)) { signal.throwIfAborted(); digest.update(chunk); }
        signal.throwIfAborted();
      } catch (error) {
        // Only discard the new failed candidate, never the user's source or prior versions.
        if (fs.existsSync(destPath)) fs.unlinkSync(destPath);
        if (destPath !== nextVer.absolutePath && fs.existsSync(nextVer.absolutePath)) fs.unlinkSync(nextVer.absolutePath);
        const candidateBase = nextVer.absolutePath.slice(0, -path.extname(nextVer.absolutePath).length);
        for (const extension of ['.png', '.jpg', '.webp', '.gif', '.mp4', '.webm']) {
          const candidate = candidateBase + extension;
          if (fs.existsSync(candidate)) fs.unlinkSync(candidate);
        }
        throw error;
      }
      const relativePath = path.relative(storage.paths.projectDir, destPath).replace(/\\/g, '/');
      const provenance = { source: 'manual_import' as const, assetPath: destPath, sha256: digest.digest('hex'), importedAt: new Date().toISOString(), sessionId, sceneId: shotId, projectId: ownerSession.ownerProjectId || ownerSession.projectId, automaticGeneration: false as const };

      // Cập nhật index.json
      if (isVideo) {
        storage.updateShotMetadata(actualSceneId, shotId, {
          video_path: relativePath,
          current_video_version: nextVer.version,
        });
      } else {
        storage.updateShotMetadata(actualSceneId, shotId, {
          image_path: relativePath,
          current_image_version: nextVer.version,
          video_path: '',
          current_video_version: undefined,
        });
      }

      storage.appendActionLog({
        ts: new Date().toISOString(),
        scene_id: actualSceneId,
        shot_id: shotId,
        action: 'upload',
        target: isVideo ? 'manual_video_import' : 'manual_image_import',
        retry: 0,
        status: 'ok',
        details: { message: 'Người dùng nạp tệp thủ công', source: filePath, destination: destPath },
      });

      // Cập nhật session state
      const session = await this.getState({ sessionId });
      signal.throwIfAborted();
      if (session && session.artifacts.scenes) {
        const targetScene = session.artifacts.scenes.find((s) => s.id === shotId || s.shotId === shotId);
        if (targetScene) {
          const keepI2V=!isVideo&&!session.manualMode&&targetScene.motionType==='video'&&this.resolveSessionConfig(session).flowEngine.engine==='official_api'&&this.resolveSessionConfig(session).flowEngine.officialVideoMode==='i2v';
          applySceneMedia(session, shotId, { imagePath: isVideo ? undefined : destPath, videoPath: isVideo ? destPath : undefined, provenance });
          if(keepI2V){targetScene.motionType='video';targetScene.status='pending';session.currentStage=5;session.stageName='storyboard';session.status='awaiting_approval';session.stages[5]={status:'success',stageName:STAGE_CONFIG[5].label};session.stages[6]={status:'pending',stageName:STAGE_CONFIG[6].label};}
          if (isVideo) targetScene.originalMediaDurationSec = await aiStudioVideoAssembler.probeDuration(destPath);
          this.persistSessionStateAtomic(session);
        }
      }

      return {
        success: true,
        assetPath: destPath,
        imagePath: !isVideo ? destPath : undefined,
        videoPath: isVideo ? destPath : undefined,
      };
    } catch (err: any) {
      console.error('[AiStudioPipelineEngine] Lỗi importSceneMedia:', err);
      return { success: false, assetPath: '', error: err?.message || String(err) };
    }
  }

  public async renderVideo(payload: RenderVideoPayload): Promise<RenderVideoResult> {
    return withSessionOperation(payload.sessionId, (signal) => this.renderVideoInternal(payload, signal));
  }

  public async saveManualSeo(input:{sessionId:string;title:string;description:string;hashtags:string[]}) {
    return withSessionOperation(input.sessionId, async () => {
      const session=await this.getState({sessionId:input.sessionId});
      if (!session?.manualMode) throw new Error('SEO thủ công chỉ lưu khi đã chọn chế độ nhập thủ công.');
      if (typeof input.title!=='string' || !input.title.trim() || input.title.length>100 ||
        typeof input.description!=='string' || !input.description.trim() || input.description.length>10000 ||
        !Array.isArray(input.hashtags) || input.hashtags.length>30 || input.hashtags.some(tag=>typeof tag!=='string'||!tag.trim()||tag.length>100)) throw new Error('SEO thủ công không hợp lệ.');
      const metadata={title:input.title.trim(),description:input.description.trim(),hashtags:input.hashtags.map(tag=>tag.trim()),thumbnailPrompt:'',source:'manual_authored' as const};
      const file=path.join(this.getSessionAssetsDir(session.sessionId),`seo_manual_${crypto.randomUUID()}.json`);
      fs.mkdirSync(path.dirname(file),{recursive:true});
      fs.writeFileSync(file,JSON.stringify(metadata,null,2),{flag:'wx'});
      session.artifacts.metadata=metadata;
      session.stages[8]={status:'success',stageName:'SEO nhập thủ công'};
      this.persistSessionStateAtomic(session);
      return {session,metadataPath:file};
    });
  }

  private async renderVideoInternal(payload: RenderVideoPayload, signal: AbortSignal): Promise<RenderVideoResult> {
    const session = await this.getState({ sessionId: payload.sessionId });
    if (!session || !session.artifacts.audioPath || !session.artifacts.scenes) {
      throw new Error(`Session assets không tìm thấy cho việc dựng lại video: ${payload.sessionId}`);
    }
    if (session.manualMode && session.artifacts.scenes.some(s => s.status !== 'ready' || !s.assetPath)) throw new Error('Cần nhập media hợp lệ cho tất cả scene trước khi xuất.');

    const config = this.resolveSessionConfig(session);
    const assetsDir = this.getSessionAssetsDir(session.sessionId);
    const outputPath = path.join(assetsDir, `final_video_${Date.now()}.mp4`);

    // Merge custom rendering/subtitle settings if provided
    const mergedRendering: AiStudioConfig['rendering'] = {
      ...config.rendering,
      ...(payload.customSettings as any),
    };
    const mergedSubtitles: AiStudioConfig['subtitles'] = {
      ...config.subtitles,
      ...(payload.customSettings as any),
    };

    const assemblyResult = await aiStudioVideoAssembler.assembleVideo({
      scenes: session.artifacts.scenes,
      voiceoverAudioPath: session.artifacts.audioPath,
      outputPath,
      renderingConfig: mergedRendering,
      subtitleConfig: mergedSubtitles,
      aspectRatio: config.flowEngine.aspectRatio,
      wordsAlignment: session.artifacts.wordsAlignment,
      scriptLines: session.artifacts.scriptLines,
      signal,
      onRegisterProcess: (cmd) => registerSessionProcess(session.sessionId, cmd),
    });

    signal.throwIfAborted();
    session.artifacts.videoPath = assemblyResult.videoPath;
    if (session.manualMode) {
      session.currentStage = 7; session.stageName = 'render'; session.status = 'completed'; session.progress = 100;
      session.stages[6] = { status: 'success', stageName: 'Media nhập thủ công đã kiểm định' };
      session.stages[7] = { status: 'success', stageName: STAGE_CONFIG[7].label };
      session.stages[8] = session.artifacts.metadata?.source === 'manual_authored'
        ? {status:'success',stageName:'SEO nhập thủ công'}
        : { status: 'skipped', stageName: 'Không yêu cầu SEO cho video thủ công' };
    }
    this.persistSessionStateAtomic(session);

    return { videoPath: assemblyResult.videoPath };
  }
}

export const aiStudioPipelineEngine = new AiStudioPipelineEngine();
