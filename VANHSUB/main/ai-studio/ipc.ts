import { applyScriptLines, invalidateSessionArtifacts } from './sessionArtifacts';
import { assertUsableScript } from '../../shared/aiStudioScript';
import { listKokoroVoices } from './kokoroVoices';
import { kokoroUrl } from '../tts-providers/kokoro/KokoroClient';
import { getStudioLlmReadiness } from './llmReadiness';
import { piperLocalStatus } from '../tts-providers/piper/PiperLocalClient';
import {connectFlowReadOnly} from './flowConnection';
import { guardRendererInvoke } from '../security/rendererTrust';
import { validateIpcPayload } from '../security/ipcPayload';
import type { StartManualMediaPayload } from './types';
/**
 * AI Video Studio - IPC Communication Router
 *
 * Encapsulates all Electron IPC handlers for the AI Video Studio subsystem:
 * - Milestone 1: Configuration management (get, set, reset) via aiStudioStore
 * - Milestone 2: Pipeline execution & granular step operations via Engine Delegate
 */

import fs from 'fs';
import path from 'path';
import os from 'os';
import { ipcMain, type IpcMainInvokeEvent } from 'electron';
import { AiStudioPipelineEngine } from './AiStudioPipelineEngine';
import {
  getDecryptedAiStudioConfig,
  updateAiStudioConfig,
  resetAiStudioConfig,
} from '../store/aiStudioStore';
import { FlowBridgeServer } from '../workflow/flow-engine/rpc/FlowBridgeServer';
import { GoogleVeoSessionManager } from '../veo/GoogleVeoSessionManager';
import { ChatGptWebSessionManager } from './chatgpt/ChatGptWebSessionManager';
import { GeminiWebSessionManager } from './gemini/GeminiWebSessionManager';
import { aiStudioLlmService } from './services/AiStudioLlmService';
import { CapCutDraftExporter } from './services/CapCutDraftExporter';
import { withSessionOperation } from './sessionOperations';
import type {
  AiStudioConfig,
  PartialAiStudioConfig,
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
  RenderVideoPayload,
  RenderVideoResult,
  AutoFillIdeaPayload,
  AutoFillIdeaResult,
  ApproveStagePayload,
  ApproveStageResult,
  GenerateMasterPromptPayload,
  GenerateMasterPromptResult,
  EvaluateScriptPayload,
  EvaluateScriptResult,
  RefineScriptPayload,
  RefineScriptResult,
  UpdateScriptLinesPayload,
  UpdateScriptLinesResult,
  UpdateSceneFillModePayload,
  UpdateSceneFillModeResult,
  ImportSceneMediaPayload,
  ImportSceneMediaResult,
  SelfTestDiagnosticsResult,
  CapCutDraftExportResult,
} from './types';

// ============================================================================
// Milestone 2 Engine Delegate Contract
// ============================================================================

export interface IAiStudioPipelineEngineDelegate {
  start(
    payload: StartPipelinePayload,
    onProgress: (event: PipelineProgressEvent) => void
  ): Promise<StartPipelineResult>;

  resume(
    payload: ResumePipelinePayload,
    onProgress: (event: PipelineProgressEvent) => void
  ): Promise<ResumePipelineResult>;

  cancel(payload: CancelPipelinePayload): Promise<CancelPipelineResult>;

  getState(payload: GetPipelineStatePayload): Promise<PipelineSessionState | null>;
  getSessionConfig?(sessionId: string): Promise<AiStudioConfig>;
  getMediaReadiness?(sessionId?:string):Promise<unknown>;
  saveManualSeo?(input:{sessionId:string;title:string;description:string;hashtags:string[]}):Promise<{session:PipelineSessionState;metadataPath:string}>;

  persistSessionStateAtomic?(state: PipelineSessionState): void;

  autoFillIdea?(payload: AutoFillIdeaPayload): Promise<AutoFillIdeaResult>;

  approveStage?(
    payload: ApproveStagePayload,
    onProgress: (event: PipelineProgressEvent) => void
  ): Promise<ApproveStageResult>;

  renderSingleLineVoice(
    payload: RenderSingleLineVoicePayload
  ): Promise<RenderSingleLineVoiceResult>;

  regenerateSceneAsset(
    payload: RegenerateSceneAssetPayload,
    onProgress?: (pct: number, msg: string) => void,
    signal?: AbortSignal
  ): Promise<RegenerateSceneAssetResult>;

  importSceneMedia?(
    payload: ImportSceneMediaPayload
  ): Promise<ImportSceneMediaResult>;
  startManualMedia?(payload: StartManualMediaPayload): Promise<StartPipelineResult>;

  renderVideo(payload: RenderVideoPayload): Promise<RenderVideoResult>;
}

let pipelineEngineDelegate: IAiStudioPipelineEngineDelegate | null = null;

/**
 * Registers the Milestone 2 Pipeline Engine delegate.
 * In Milestone 2, AiStudioPipelineEngine attaches here without modifying this router.
 */
export function setAiStudioPipelineEngine(
  delegate: IAiStudioPipelineEngineDelegate | null
): void {
  pipelineEngineDelegate = delegate;
}

/**
 * Returns the currently active delegate (useful for tests or diagnostics).
 */
export function getAiStudioPipelineEngine(): IAiStudioPipelineEngineDelegate | null {
  return pipelineEngineDelegate;
}

/**
 * Broadcasts a structured action log entry to all open Electron windows.
 * Channel: 'aiStudio:pipeline:actionLog'
 * Format: { ts, scene_id, shot_id, action, target, retry, status, details }
 */
export function broadcastPipelineActionLog(entry: any): void {
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const electron = require('electron');
    const BrowserWindow = electron?.BrowserWindow;
    if (BrowserWindow && typeof BrowserWindow.getAllWindows === 'function') {
      const windows = BrowserWindow.getAllWindows();
      for (const win of windows) {
        if (!win.isDestroyed() && win.webContents && !win.webContents.isDestroyed()) {
          win.webContents.send('aiStudio:pipeline:actionLog', entry);
        }
      }
    }
  } catch (err) {
    // Non-fatal if running outside Electron or in unit tests
  }
}

// ============================================================================
// Safe IPC Registration Helper
// ============================================================================

/**
 * Safely registers an IPC invoke handler by unregistering any existing handler
 * for the same channel. Prevents "Attempted to register a second handler" errors.
 */
function safeHandle(
  channel: string,
  handler: (event: IpcMainInvokeEvent, ...args: any[]) => any
): void {
  try {
    ipcMain.removeHandler(channel);
  } catch {
    // Ignore error if channel was not previously registered
  }
  ipcMain.handle(channel, guardRendererInvoke((event, ...args) => {
    validateIpcPayload(channel, args);
    if (channel === 'aiStudio:scene:updateFillMode') {
      return withSessionOperation(args[0]?.sessionId, () => Promise.resolve(handler(event, ...args)));
    }
    return handler(event, ...args);
  }));
}

// ============================================================================
// IPC Handler Registration Entry Point
// ============================================================================

export function registerAiStudioIpc(resolveExternalFile?: (file: string, extensions: Set<string>) => string): void {
  safeHandle('aiStudio:flow:connectReadOnly',async()=>connectFlowReadOnly());
  safeHandle('aiStudio:media:readiness',async(_event,payload)=>{
    if(!pipelineEngineDelegate?.getMediaReadiness)throw new Error('Media readiness chưa sẵn sàng.');
    return pipelineEngineDelegate.getMediaReadiness(payload?.sessionId);
  });
  safeHandle('aiStudio:manualSeo:save', async (_event,input) => {
    if (!pipelineEngineDelegate?.saveManualSeo) throw new Error('Lưu SEO thủ công chưa sẵn sàng.');
    return pipelineEngineDelegate.saveManualSeo(input);
  });
  safeHandle('aiStudio:voices:piperStatus', async () => piperLocalStatus());
  safeHandle('aiStudio:readiness', async () => getStudioLlmReadiness(getDecryptedAiStudioConfig()));
  safeHandle('aiStudio:voices:kokoro', async () => listKokoroVoices(kokoroUrl(getDecryptedAiStudioConfig().voice.kokoroBaseUrl, 'voices')));
  safeHandle('aiStudio:pipeline:startManualMedia', async (_event, payload: StartManualMediaPayload) => {
    if (!resolveExternalFile || !pipelineEngineDelegate?.startManualMedia) throw new Error('Manual media import chưa sẵn sàng.');
    return pipelineEngineDelegate.startManualMedia({ ...payload,
      srtPath: resolveExternalFile(payload.srtPath, new Set(['.srt'])),
      audioPath: resolveExternalFile(payload.audioPath, new Set(['.mp3', '.wav', '.m4a', '.flac', '.aac', '.ogg'])),
    });
  });
  // Automatically wire Milestone 2 Pipeline Engine delegate if not yet registered
  if (!pipelineEngineDelegate) {
    const engine = new AiStudioPipelineEngine();
    setAiStudioPipelineEngine(engine);
  }
  // --------------------------------------------------------------------------
  // Milestone 1 Channels: Dedicated Configuration Store
  // --------------------------------------------------------------------------

  /**
   * Channel: aiStudio:config:get
   * Retrieves the current AI Studio configuration with decrypted secrets for UI.
   */
  safeHandle('aiStudio:config:get', async (): Promise<AiStudioConfig> => {
    try {
      return getDecryptedAiStudioConfig();
    } catch (err: any) {
      console.error('[AI-Studio-IPC] Error fetching configuration:', err);
      throw new Error(`Failed to retrieve AI Studio config: ${err?.message || err}`);
    }
  });

  /**
   * Channel: aiStudio:config:set
   * Updates partial AI Studio configuration and returns the merged result with decrypted secrets.
   */
  safeHandle(
    'aiStudio:config:set',
    async (_event, updates: PartialAiStudioConfig): Promise<AiStudioConfig> => {
      try {
        if (!updates || typeof updates !== 'object') {
          throw new Error('Invalid config updates payload: expected an object');
        }
        const updatedConfig = updateAiStudioConfig(updates, { decrypted: true });
        try {
          if (updates.flowEngine && 'projectId' in updates.flowEngine) {
            const pid = updates.flowEngine.projectId?.trim() || null;
            GoogleVeoSessionManager.getInstance().setCurrentProjectId(pid);
          } else if ('activeProjectId' in updates && !updates.activeProjectId) {
            GoogleVeoSessionManager.getInstance().resetCurrentProjectId();
          }
        } catch {}
        return updatedConfig;
      } catch (err: any) {
        console.error('[AI-Studio-IPC] Error updating configuration:', err);
        throw new Error(`Failed to update AI Studio config: ${err?.message || err}`);
      }
    }
  );

  /**
   * Channel: aiStudio:config:reset
   * Resets configuration back to technical specification default values.
   */
  safeHandle('aiStudio:config:reset', async (): Promise<AiStudioConfig> => {
    try {
      return resetAiStudioConfig();
    } catch (err: any) {
      console.error('[AI-Studio-IPC] Error resetting configuration:', err);
      throw new Error(`Failed to reset AI Studio config: ${err?.message || err}`);
    }
  });

  // --------------------------------------------------------------------------
  // Milestone 2 Channels: Pipeline Control & Granular Step Operations
  // --------------------------------------------------------------------------

  /**
   * Channel: aiStudio:pipeline:start
   * Starts a new automated 8-stage video generation pipeline.
   */
  safeHandle(
    'aiStudio:pipeline:start',
    async (event, payload: StartPipelinePayload): Promise<StartPipelineResult> => {
      if (pipelineEngineDelegate?.start) {
        return pipelineEngineDelegate.start(payload, (progressEvent: PipelineProgressEvent) => {
          try {
            if (!event.sender.isDestroyed()) {
              event.sender.send('aiStudio:pipeline:progress', progressEvent);
            }
          } catch (emitErr) {
            console.error('[AI-Studio-IPC] Failed to emit pipeline progress event:', emitErr);
          }
        });
      }
      throw new Error(
        '[M2-STUB] aiStudio:pipeline:start is scheduled for Milestone 2 (Pipeline Engine).'
      );
    }
  );

  /**
   * Channel: aiStudio:pipeline:resume
   * Resumes a paused/failed pipeline from a specific checkpoint stage.
   */
  safeHandle(
    'aiStudio:pipeline:resume',
    async (event, payload: ResumePipelinePayload): Promise<ResumePipelineResult> => {
      if (pipelineEngineDelegate?.resume) {
        return pipelineEngineDelegate.resume(payload, (progressEvent: PipelineProgressEvent) => {
          try {
            if (!event.sender.isDestroyed()) {
              event.sender.send('aiStudio:pipeline:progress', progressEvent);
            }
          } catch (emitErr) {
            console.error('[AI-Studio-IPC] Failed to emit pipeline progress event:', emitErr);
          }
        });
      }
      throw new Error(
        '[M2-STUB] aiStudio:pipeline:resume is scheduled for Milestone 2 (Pipeline Engine).'
      );
    }
  );

  /**
   * Channel: aiStudio:pipeline:cancel
   * Cancels a currently executing pipeline session.
   */
  safeHandle(
    'aiStudio:pipeline:cancel',
    async (_event, payload: CancelPipelinePayload): Promise<CancelPipelineResult> => {
      if (pipelineEngineDelegate?.cancel) {
        return pipelineEngineDelegate.cancel(payload);
      }
      throw new Error(
        '[M2-STUB] aiStudio:pipeline:cancel is scheduled for Milestone 2 (Pipeline Engine).'
      );
    }
  );

  /**
   * Channel: aiStudio:pipeline:getState
   * Retrieves the persisted state of a pipeline session.
   */
  safeHandle(
    'aiStudio:pipeline:getState',
    async (_event, payload: GetPipelineStatePayload): Promise<PipelineSessionState | null> => {
      if (pipelineEngineDelegate?.getState) {
        return pipelineEngineDelegate.getState(payload);
      }
      return null;
    }
  );

  /**
   * Channel: aiStudio:idea:autoFill
   * Automatically generates and fills out idea blueprint fields using the active LLM provider.
   */
  safeHandle(
    'aiStudio:idea:autoFill',
    async (_event, payload: AutoFillIdeaPayload): Promise<AutoFillIdeaResult> => {
      if (pipelineEngineDelegate?.autoFillIdea) {
        return pipelineEngineDelegate.autoFillIdea(payload);
      }
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
  );

  /**
   * Channel: aiStudio:pipeline:approveStage
   * Approves current completed stage in gated pipeline and triggers the next stage.
   */
  safeHandle(
    'aiStudio:pipeline:approveStage',
    async (event, payload: ApproveStagePayload): Promise<ApproveStageResult> => {
      if (pipelineEngineDelegate?.approveStage) {
        return pipelineEngineDelegate.approveStage(payload, (progressEvent: PipelineProgressEvent) => {
          try {
            if (!event.sender.isDestroyed()) {
              event.sender.send('aiStudio:pipeline:progress', progressEvent);
            }
          } catch (emitErr) {
            console.error('[AI-Studio-IPC] Failed to emit pipeline progress event on approve:', emitErr);
          }
        });
      }
      throw new Error('Pipeline engine delegate does not support approveStage.');
    }
  );

  /**
   * Channel: aiStudio:channel:generateMasterPrompt
   * Generates a tailored Master Prompt for the channel based on niche, description & orientation.
   */
  safeHandle(
    'aiStudio:channel:generateMasterPrompt',
    async (
      _event,
      payload: GenerateMasterPromptPayload
    ): Promise<GenerateMasterPromptResult> => {
      try {
        const config = getDecryptedAiStudioConfig();
        const masterPrompt = await aiStudioLlmService.generateMasterPromptForChannel(
          payload.channelProfile,
          config.llm
        );
        return {
          masterPrompt,
          chatgptConversationUrl: payload.channelProfile?.chatgptConversationUrl,
        };
      } catch (err: any) {
        console.error('[AI-Studio-IPC] Error generating master prompt:', err);
        throw new Error(`Lỗi tạo Master Prompt cho kênh: ${err?.message || err}`);
      }
    }
  );

  /**
   * Channel: aiStudio:script:evaluate
   * Evaluates dialogue script lines across 10 dimensions D1 - D10.
   */
  safeHandle(
    'aiStudio:script:evaluate',
    async (
      _event,
      payload: EvaluateScriptPayload
    ): Promise<EvaluateScriptResult> => {
      const execute = async (signal?: AbortSignal): Promise<EvaluateScriptResult> => {
        try {
          const session = payload.sessionId && pipelineEngineDelegate
            ? await pipelineEngineDelegate.getState({ sessionId: payload.sessionId }) : undefined;
          signal?.throwIfAborted();
          if (payload.sessionId && !session) throw new Error('Session không tồn tại.');
          const lines = session ? session.artifacts.scriptLines || [] : payload.lines || [];
          assertUsableScript(lines);
          const config = payload.sessionId && pipelineEngineDelegate?.getSessionConfig
            ? await pipelineEngineDelegate.getSessionConfig(payload.sessionId)
            : getDecryptedAiStudioConfig();
          const evaluation = await aiStudioLlmService.evaluateScript(
            lines,
            session?.artifacts.blueprint || payload.blueprint,
            payload.sessionId ? config.channelProfile : (payload.channelProfile || config.channelProfile),
            config.llm
          );
          signal?.throwIfAborted();

          if (session && pipelineEngineDelegate) {
            session.artifacts.scriptEvaluation = evaluation;
            pipelineEngineDelegate.persistSessionStateAtomic?.(session);
          }

          return { evaluation, session: session ? { ...session, jobActive: false } : undefined };
        } catch (err: any) {
          console.error('[AI-Studio-IPC] Error evaluating script:', err);
          throw new Error(`Lỗi chấm điểm kịch bản: ${err?.message || err}`);
        }
      };
      return payload.sessionId ? withSessionOperation(payload.sessionId, execute) : execute();
    }
  );

  /**
   * Channel: aiStudio:script:refine
   * Refines script lines to improve weak criteria or follow custom instructions.
   */
  safeHandle(
    'aiStudio:script:refine',
    async (
      _event,
      payload: RefineScriptPayload
    ): Promise<RefineScriptResult> => {
      const execute = async (signal?: AbortSignal): Promise<RefineScriptResult> => {
        try {
          const session = payload.sessionId && pipelineEngineDelegate
            ? await pipelineEngineDelegate.getState({ sessionId: payload.sessionId }) : undefined;
          signal?.throwIfAborted();
          if (payload.sessionId && !session) throw new Error('Session không tồn tại.');
          const lines = session ? session.artifacts.scriptLines || [] : payload.lines || [];
          assertUsableScript(lines);
          const config = payload.sessionId && pipelineEngineDelegate?.getSessionConfig
            ? await pipelineEngineDelegate.getSessionConfig(payload.sessionId)
            : getDecryptedAiStudioConfig();
          const refined: RefineScriptResult = await aiStudioLlmService.refineScript(
            lines,
            payload.instructions,
            payload.mode || 'improve_weaknesses',
            session?.artifacts.blueprint || payload.blueprint,
            payload.sessionId ? config.channelProfile : (payload.channelProfile || config.channelProfile),
            config.llm
          );
          signal?.throwIfAborted();

          if (session && pipelineEngineDelegate) {
            applyScriptLines(session, refined.lines);
            session.artifacts.scriptEvaluation = refined.evaluation;
            refined.lines = session.artifacts.scriptLines!;
            refined.session = { ...session, jobActive: false };
            pipelineEngineDelegate.persistSessionStateAtomic?.(session);
          }

          return refined;
        } catch (err: any) {
          console.error('[AI-Studio-IPC] Error refining script:', err);
          throw new Error(`Lỗi cải thiện kịch bản: ${err?.message || err}`);
        }
      };
      return payload.sessionId ? withSessionOperation(payload.sessionId, execute) : execute();
    }
  );

  /**
   * Channel: aiStudio:script:updateLines
   * Updates dialogue script lines directly (inline editing) and persists to session.
   */
  safeHandle(
    'aiStudio:script:updateLines',
    async (
      _event,
      payload: UpdateScriptLinesPayload
    ): Promise<UpdateScriptLinesResult> => {
      return withSessionOperation(payload.sessionId, async (signal) => {
        try {
          if (!payload.sessionId) {
            throw new Error('Thiếu sessionId khi cập nhật câu thoại kịch bản.');
          }

          if (!pipelineEngineDelegate) throw new Error('Pipeline chưa sẵn sàng.');
          const session = await pipelineEngineDelegate.getState({ sessionId: payload.sessionId });
          signal.throwIfAborted();
          if (!session) throw new Error('Session không tồn tại.');
          applyScriptLines(session, payload.lines);
          pipelineEngineDelegate.persistSessionStateAtomic?.(session);
          return { success: true, scriptLines: session.artifacts.scriptLines!, session: { ...session, jobActive: false } };
        } catch (err: any) {
          console.error('[AI-Studio-IPC] Error updating script lines:', err);
          throw new Error(`Lỗi cập nhật câu thoại kịch bản: ${err?.message || err}`);
        }
      });
    }
  );

  /**
   * Channel: aiStudio:scene:updateFillMode
   * Updates fillMode ('freeze_last_frame' | 'none') on session scenes to preserve duration decisions.
   */
  safeHandle(
    'aiStudio:scene:updateFillMode',
    async (
      _event,
      payload: UpdateSceneFillModePayload
    ): Promise<UpdateSceneFillModeResult> => {
      try {
        if (!payload.sessionId) {
          throw new Error('Thiếu sessionId khi cập nhật chế độ bù thời lượng phân cảnh.');
        }
        if (!['freeze_last_frame', 'none'].includes(payload.fillMode) ||
            (payload.sceneIds !== undefined && (!Array.isArray(payload.sceneIds) || payload.sceneIds.some(id => typeof id !== 'string')))) {
          throw new Error('Chế độ hoặc danh sách phân cảnh không hợp lệ.');
        }

        if (pipelineEngineDelegate) {
          const session = await pipelineEngineDelegate.getState({ sessionId: payload.sessionId });
          if (session && session.artifacts?.scenes) {
            session.artifacts.scenes.forEach((sc) => {
              if (
                !payload.sceneIds ||
                payload.sceneIds.length === 0 ||
                payload.sceneIds.includes(sc.id) ||
                payload.sceneIds.includes(sc.shotId || '')
              ) {
                sc.fillMode = payload.fillMode;
              }
            });
            invalidateSessionArtifacts(session, 7);
            session.currentStage = 6;
            session.stageName = 'visuals';
            session.status = 'awaiting_approval';
            if (typeof pipelineEngineDelegate.persistSessionStateAtomic === 'function') {
              pipelineEngineDelegate.persistSessionStateAtomic(session);
            }
            return { success: true, scenes: session.artifacts.scenes };
          }
        }

        return { success: false };
      } catch (err: any) {
        console.error('[AI-Studio-IPC] Error updating scene fillMode:', err);
        throw new Error(`Lỗi cập nhật chế độ bù thời lượng: ${err?.message || err}`);
      }
    }
  );

  /**
   * Channel: aiStudio:step:renderSingleLineVoice
   * Synthesizes audio for a single dialogue line via Edge TTS.
   */
  safeHandle(
    'aiStudio:step:renderSingleLineVoice',
    async (
      _event,
      payload: RenderSingleLineVoicePayload
    ): Promise<RenderSingleLineVoiceResult> => {
      if (pipelineEngineDelegate?.renderSingleLineVoice) {
        return pipelineEngineDelegate.renderSingleLineVoice(payload);
      }
      throw new Error(
        '[M2-STUB] aiStudio:step:renderSingleLineVoice is scheduled for Milestone 2 (TTS Service).'
      );
    }
  );

  /**
   * Channel: aiStudio:step:regenerateSceneAsset
   * Regenerates a single visual asset via Google Flow Engine (or synthetic fallback).
   */
  safeHandle(
    'aiStudio:step:regenerateSceneAsset',
    async (
      _event,
      payload: RegenerateSceneAssetPayload
    ): Promise<RegenerateSceneAssetResult> => {
      if (pipelineEngineDelegate?.regenerateSceneAsset) {
        return pipelineEngineDelegate.regenerateSceneAsset(payload);
      }
      throw new Error(
        '[M2-STUB] aiStudio:step:regenerateSceneAsset is scheduled for Milestone 2 (Visual Service).'
      );
    }
  );

  /**
   * Channel: aiStudio:step:importSceneMedia
   * Imports an external image or video file into the project's media storage for a scene.
   */
  safeHandle(
    'aiStudio:step:importSceneMedia',
    async (
      _event,
      payload: ImportSceneMediaPayload
    ): Promise<ImportSceneMediaResult> => {
      if (pipelineEngineDelegate?.importSceneMedia) {
        return pipelineEngineDelegate.importSceneMedia(payload);
      }
      throw new Error(
        'aiStudio:step:importSceneMedia is not supported by current delegate.'
      );
    }
  );

  /**
   * Channel: aiStudio:step:renderVideo
   * Triggers FFmpeg video assembly for a session.
   */
  safeHandle(
    'aiStudio:step:renderVideo',
    async (_event, payload: RenderVideoPayload): Promise<RenderVideoResult> => {
      if (pipelineEngineDelegate?.renderVideo) {
        return pipelineEngineDelegate.renderVideo(payload);
      }
      throw new Error(
        '[M2-STUB] aiStudio:step:renderVideo is scheduled for Milestone 2 (Video Assembler).'
      );
    }
  );

  // --------------------------------------------------------------------------
  // ChatGPT Web Automation Channels (Zero API Cost Mode)
  // --------------------------------------------------------------------------
  safeHandle('aiStudio:chatgpt:checkLogin', async () => {
    return ChatGptWebSessionManager.getInstance().checkLoginStatus();
  });

  safeHandle('aiStudio:chatgpt:openLogin', async () => {
    return ChatGptWebSessionManager.getInstance().openLoginWindow();
  });

  safeHandle('aiStudio:chatgpt:closeLogin', async () => {
    ChatGptWebSessionManager.getInstance().closeWindow();
    return { success: true };
  });

  safeHandle('aiStudio:chatgpt:logout', async () => {
    await ChatGptWebSessionManager.getInstance().logout();
    return { success: true };
  });

  // --------------------------------------------------------------------------
  // Gemini Web Automation Channels (Zero API Cost Mode)
  // --------------------------------------------------------------------------
  safeHandle('aiStudio:gemini:checkLogin', async () => {
    return GeminiWebSessionManager.getInstance().checkLoginStatus();
  });

  safeHandle('aiStudio:gemini:openLogin', async () => {
    return GeminiWebSessionManager.getInstance().openLoginWindow();
  });

  safeHandle('aiStudio:gemini:closeLogin', async () => {
    GeminiWebSessionManager.getInstance().closeWindow();
    return { success: true };
  });

  safeHandle('aiStudio:gemini:logout', async () => {
    await GeminiWebSessionManager.getInstance().logout();
    return { success: true };
  });

  // --------------------------------------------------------------------------
  // Milestone 3: 1-Click Self-Test Diagnostics (Bridge, Lobby, Disk, LLM)
  // --------------------------------------------------------------------------
  safeHandle('aiStudio:diagnostics:selfTest', async (): Promise<SelfTestDiagnosticsResult> => {
    const config = getDecryptedAiStudioConfig();
    const activeProj = config.savedProjects?.find((p) => p.id === config.activeProjectId);

    // 1. Kiểm tra Chrome Bridge WebSocket (Port 9222 / 8765)
    const checkBridge = async () => {
      try {
        const bridge = FlowBridgeServer.getInstance();
        const connected = bridge.isConnected();
        const port = bridge.getPort() || 9222;
        if (connected) {
          let tabDetail = '';
          try {
            const tabInfo = await bridge.getFlowTabInfo(2000);
            if (tabInfo?.projectId) {
              tabDetail = ` — Tab Flow đang mở dự án: ${tabInfo.projectId}`;
            } else if (tabInfo?.url) {
              tabDetail = ` — Tab Flow: ${tabInfo.url}`;
            }
          } catch {}
          return {
            ok: true,
            message: `Chrome Extension Bridge đang kết nối tốt (Port ${port}/8765)${tabDetail}`,
            port,
          };
        }
        return {
          ok: false,
          message: `Chrome Bridge chưa kết nối (lắng nghe trên port ${port} và 8765). Hãy mở Chrome và nạp extension VanhSub Flow Bridge.`,
          port,
        };
      } catch (err: any) {
        return {
          ok: false,
          message: `Lỗi kiểm tra Bridge: ${err?.message || err}`,
          port: 9222,
        };
      }
    };

    // 2. Kiểm tra Google Flow Session trong Electron Lobby (<= 2500ms timeout)
    const checkSession = async () => {
      try {
        const sessionMgr = GoogleVeoSessionManager.getInstance();
        let timer: NodeJS.Timeout | null = null;
        const res = await Promise.race([
          sessionMgr.validateSession(),
          new Promise<any>((_, reject) => {
            timer = setTimeout(() => reject(new Error('Timeout kiểm tra session (>2.5s)')), 2500);
          }),
        ]);
        if (timer) clearTimeout(timer);
        if (res && res.valid) {
          return {
            ok: true,
            message: res.detail || 'Phiên Google Flow sẵn sàng trong Sảnh Electron',
            status: res.status,
            detail: res.detail,
          };
        }
        return {
          ok: false,
          message: res?.detail || 'Chưa đăng nhập Google Flow trong Sảnh Electron',
          status: res?.status || 'unauthenticated',
          detail: res?.detail,
        };
      } catch (err: any) {
        return {
          ok: false,
          message: `Chưa xác thực Sảnh: ${err?.message || err}`,
          status: 'error',
          detail: err?.message,
        };
      }
    };

    // 3. Kiểm tra quyền ghi thư mục xuất Disk (<= 500ms)
    const checkDisk = async () => {
      const outputDir =
        activeProj?.outputDir?.trim() ||
        config.outputDir?.trim() ||
        path.join(os.homedir(), 'Videos', 'VANHSUB_Output');
      try {
        if (!fs.existsSync(outputDir)) {
          fs.mkdirSync(outputDir, { recursive: true });
        }
        const testFile = path.join(outputDir, `.vanhsub_perm_test_${Date.now()}`);
        fs.writeFileSync(testFile, 'test');
        fs.unlinkSync(testFile);
        return {
          ok: true,
          message: `Thư mục lưu trữ sẵn sàng và có toàn quyền ghi`,
          path: outputDir,
        };
      } catch (err: any) {
        return {
          ok: false,
          message: `Không có quyền ghi vào thư mục: ${outputDir} (${err?.message || err})`,
          path: outputDir,
        };
      }
    };

    // 4. Kiểm tra cấu hình AI (LLM / TTS) (<= 200ms)
    const checkLlm = async () => {
      const provider =
        (activeProj?.channelProfile?.aiProvider && activeProj.channelProfile.aiProvider !== 'default'
          ? activeProj.channelProfile.aiProvider
          : config.channelProfile?.aiProvider && config.channelProfile.aiProvider !== 'default'
          ? config.channelProfile.aiProvider
          : config.llm?.provider) || 'gemini_web';

      let hasKey = false;
      if (provider === 'openai') {
        hasKey = Boolean(config.llm?.apiKey || process.env.OPENAI_API_KEY);
      } else if (provider === 'deepseek') {
        hasKey = Boolean(config.llm?.apiKey || process.env.DEEPSEEK_API_KEY);
      } else if (provider === 'chatgpt_web') {
        const status = await ChatGptWebSessionManager.getInstance().checkLoginStatus();
        hasKey = status.isLoggedIn;
      } else if (provider === 'gemini_web') {
        const status = await GeminiWebSessionManager.getInstance().checkLoginStatus();
        hasKey = status.isLoggedIn;
      } else {
        hasKey = Boolean(config.llm?.apiKey);
      }

      if (hasKey) {
        return {
          ok: true,
          message: `Mô hình AI [${provider}] đã sẵn sàng hoạt động`,
          provider,
        };
      }
      return {
        ok: false,
        message: `Mô hình [${provider}] chưa cấu hình API Key hoặc phiên web chưa đăng nhập`,
        provider,
      };
    };

    const [bridgeRes, sessionRes, diskRes, llmRes] = await Promise.all([
      checkBridge(),
      checkSession(),
      checkDisk(),
      checkLlm(),
    ]);

    const overallReady = (bridgeRes.ok || sessionRes.ok) && diskRes.ok;

    return {
      bridge: bridgeRes,
      session: sessionRes,
      disk: diskRes,
      llm: llmRes,
      overallReady,
      timestamp: Date.now(),
    };
  });

  // --------------------------------------------------------------------------
  // Milestone 5 Channel: 1-Click CapCut Desktop Draft Export
  // --------------------------------------------------------------------------

  /**
   * Channel: aiStudio:export:capcutDraft
   * Exports an AI Studio project or pipeline session into a valid CapCut Desktop draft.
   */
  safeHandle(
    'aiStudio:export:capcutDraft',
    async (_event, payload: any, maybeTargetDir?: string): Promise<CapCutDraftExportResult> => {
      try {
        if (typeof payload === 'string' && maybeTargetDir) {
          return await CapCutDraftExporter.exportToCapCutDraft(maybeTargetDir, payload);
        }
        if (maybeTargetDir) {
          return await CapCutDraftExporter.exportToCapCutDraft(payload, maybeTargetDir);
        }
        return await CapCutDraftExporter.exportToCapCutDraft(payload);
      } catch (err: any) {
        console.error('[AI-Studio-IPC] Error exporting CapCut draft:', err);
        throw new Error(`Failed to export CapCut draft: ${err?.message || err}`);
      }
    }
  );

  console.log('[AI Studio] Registered 20 IPC channels successfully (including 1-Click CapCut Export).');
}
