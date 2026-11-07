import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import os from 'os';
import {FlowCreditLedger} from '../FlowCreditLedger';
import {flowCreditReadiness,assertFlowQuote} from '../../../shared/flowCreditPolicy';
import {saveFlowImage} from '../../browser-automation/FlowImageArtifact';
import http from 'http';
import https from 'https';
import ffmpeg from 'fluent-ffmpeg';
import ffmpegInstaller from '@ffmpeg-installer/ffmpeg';
import ffprobeInstaller from '@ffprobe-installer/ffprobe';
import { GoogleVeoSessionManager } from '../../veo/GoogleVeoSessionManager';
import { GoogleFlowBrowserMutex } from '../../workflow/dispatcher/GoogleFlowBrowserMutex';
import { FlowBridgeServer } from '../../workflow/flow-engine/rpc/FlowBridgeServer';
import { VisualProviderRouter } from '../providers/VisualProviderRouter';
import { BrowserAutomationAdapter } from '../../browser-automation/BrowserAutomationAdapter';
import { BrowserProcessManager } from '../../browser-automation/BrowserProcessManager';
import {
  getGoogleFlowRpcClient,
  GoogleFlowRpcClient,
  GoogleFlowRpcError,
  classifyFlowRpcError,
  calculateExponentialBackoffMs,
  isUnusualActivityError,
} from '../../workflow/flow-engine/rpc/GoogleFlowRpcClient';
import {
  normalizeAndValidateMediaFile,
  decodeImageDimensions,
  validateVideoWithFfprobe,
  NormalizeMediaOptions,
} from '../../browser-automation/mediaValidator';
import {
  extractGeneratedImages,
  extractOperationStatus,
  parseBatchResponse,
} from '../../workflow/flow-engine/rpc/FlowBatchBuilder';
import {
  RPC_GEN_IMAGE,
  RPC_GEN_VIDEO_REFERENCES,
  RPC_GEN_VIDEO_TEXT,
  RPC_OPERATION,
  RPC_MEDIA,
} from '../../workflow/flow-engine/rpc/FlowBatchConstants';
import type {
  AiStudioFlowEngineConfig,
  FlowAspectRatio,
  RenderingResolution,
  StoryboardScene,
  RegenerateSceneAssetPayload,
  RegenerateSceneAssetResult,
} from '../types';

/**
 * Tính toán thời gian giãn cách an toàn giữa 2 cảnh:
 * Cooldown 8 - 12s kèm random jitter (±2s), đảm bảo luôn >= 8s.
 */
export function calculateCooldownSeconds(minSec = 8, maxSec = 12, jitterSec = 2): number {
  const parsedMin = typeof minSec === 'number' && Number.isFinite(minSec) ? Math.max(0, minSec) : 8;
  const parsedMax = typeof maxSec === 'number' && Number.isFinite(maxSec) ? Math.max(0, maxSec) : 12;
  const safeJitter = typeof jitterSec === 'number' && Number.isFinite(jitterSec) ? Math.abs(jitterSec) : 2;

  const [lo, hi] = parsedMin <= parsedMax ? [parsedMin, parsedMax] : [parsedMax, parsedMin];
  const base = lo + Math.random() * (hi - lo);
  const jitter = (Math.random() * 2 - 1) * safeJitter;
  const total = Math.round(base + jitter);
  return Math.min(hi + safeJitter, Math.max(lo, total));
}

/**
 * Ngủ có thể huỷ bỏ lập tức khi nhận AbortSignal.
 */
export async function sleepAbortable(ms: number, signal?: AbortSignal): Promise<void> {
  if (signal?.aborted) {
    throw new GoogleFlowRpcError('Quá trình tạo hình ảnh đã bị hủy bởi người dùng.', {
      code: 'CANCELLED',
      retryable: false,
    });
  }
  return new Promise((resolve, reject) => {
    let timer: NodeJS.Timeout | null = null;
    const onAbort = () => {
      if (timer) clearTimeout(timer);
      reject(
        new GoogleFlowRpcError('Quá trình tạo hình ảnh đã bị hủy bởi người dùng.', {
          code: 'CANCELLED',
          retryable: false,
        })
      );
    };
    if (signal) {
      signal.addEventListener('abort', onAbort, { once: true });
    }
    timer = setTimeout(() => {
      if (signal) {
        signal.removeEventListener('abort', onAbort);
      }
      resolve();
    }, ms);
  });
}

// Setup FFmpeg & FFprobe binary paths
const rawFfmpegPath = (ffmpegInstaller as any)?.path || (ffmpegInstaller as any)?.default?.path || '';
const rawFfprobePath = (ffprobeInstaller as any)?.path || (ffprobeInstaller as any)?.default?.path || '';

if (rawFfmpegPath) {
  ffmpeg.setFfmpegPath(rawFfmpegPath.replace('app.asar', 'app.asar.unpacked'));
}
if (rawFfprobePath) {
  ffmpeg.setFfprobePath(rawFfprobePath.replace('app.asar', 'app.asar.unpacked'));
}

export interface VisualDispatchResult {
  scenes: StoryboardScene[];
  generatedCount: number;
  modeUsed: 'google_flow' | 'synthetic_fallback';
}

export class AiStudioVisualService {
  private static instance: AiStudioVisualService | null = null;
  private rpcClient: GoogleFlowRpcClient | null = null;

  public static getInstance(): AiStudioVisualService {
    if (!AiStudioVisualService.instance) {
      AiStudioVisualService.instance = new AiStudioVisualService();
    }
    return AiStudioVisualService.instance;
  }

  /**
   * Cung cấp hoặc ghi đè GoogleFlowRpcClient (hỗ trợ kiểm thử và custom session).
   */
  public setRpcClient(client: GoogleFlowRpcClient | null): void {
    this.rpcClient = client;
  }

  /**
   * Lấy GoogleFlowRpcClient hiện hành (singleton hoặc custom instance đã tiêm).
   */
  public getRpcClient(): GoogleFlowRpcClient {
    if (this.rpcClient) {
      return this.rpcClient;
    }
    return getGoogleFlowRpcClient();
  }

  public getVisualProviderRouter(): VisualProviderRouter {
    return VisualProviderRouter.getInstance();
  }

  public getBrowserAutomationAdapter(): BrowserAutomationAdapter {
    return BrowserAutomationAdapter.getInstance();
  }

  public getBrowserProcessManager(): BrowserProcessManager {
    return BrowserProcessManager.getInstance();
  }

  private _preferUiImageGen = false;
  private _preferUiVideoGen = false;

  public isPreferUiImageGen(): boolean {
    return this._preferUiImageGen;
  }

  public isPreferUiVideoGen(): boolean {
    return this._preferUiVideoGen;
  }

  public isPreferUiGen(): boolean {
    return this._preferUiImageGen || this._preferUiVideoGen;
  }

  public setPreferUiImageGen(prefer: boolean): void {
    this._preferUiImageGen = prefer;
  }

  public setPreferUiVideoGen(prefer: boolean): void {
    this._preferUiVideoGen = prefer;
  }

  public setPreferUiGen(prefer: boolean): void {
    this._preferUiImageGen = prefer;
    this._preferUiVideoGen = prefer;
  }

  public resetPreferUiGen(): void {
    this._preferUiImageGen = false;
    this._preferUiVideoGen = false;
  }

  /**
   * Dispatches UI generation request to either Chrome Extension Bridge (port 9222) or
   * BrowserAutomationAdapter Playwright session (port 9224).
   */
  public async executeUiGeneration(
    prompt: string,
    timeoutMs: number,
    projectId: string | undefined,
    mode: 'image' | 'video',
    signal?: AbortSignal,
    options?: {
      inputImageAsset?: string;
      referenceImage?: string;
      jobId?: string;
      sceneId?: string;
    }
  ): Promise<any> {
    const adapter = BrowserAutomationAdapter.getInstance();
    if (adapter.isConnected('flow')) {
      return await adapter.executeFlowGeneration({
        prompt,
        timeoutMs,
        projectId,
        mode,
        signal,
        inputImageAsset: options?.inputImageAsset,
        referenceImage: options?.referenceImage,
        jobId: options?.jobId,
        sceneId: options?.sceneId,
      });
    }
    const bridge = FlowBridgeServer.getInstance();
    if (bridge.isConnected()) {
      return await (bridge as any).triggerUiGen(
        prompt,
        timeoutMs,
        projectId,
        mode,
        signal,
        options
      );
    }
    return await adapter.executeFlowGeneration({
      prompt,
      timeoutMs,
      projectId,
      mode,
      signal,
      inputImageAsset: options?.inputImageAsset,
      referenceImage: options?.referenceImage,
      jobId: options?.jobId,
      sceneId: options?.sceneId,
    });
  }

  // ==========================================================================
  // Dimensions Resolution Helper
  // ==========================================================================
  public resolveDimensions(
    aspectRatio: FlowAspectRatio | string = '16:9',
    resolution?: RenderingResolution
  ): { width: number; height: number } {
    const is1080p = resolution === '1080p';
    const norm = String(aspectRatio || '16:9').trim().toLowerCase();

    if (norm === '9:16' || norm === 'portrait') {
      return is1080p ? { width: 1080, height: 1920 } : { width: 720, height: 1280 };
    }
    if (norm === '1:1' || norm === 'square') {
      return is1080p ? { width: 1080, height: 1080 } : { width: 720, height: 720 };
    }
    if (norm === '3:4') {
      return is1080p ? { width: 810, height: 1080 } : { width: 540, height: 720 };
    }
    if (norm === '4:3') {
      return is1080p ? { width: 1440, height: 1080 } : { width: 960, height: 720 };
    }
    // Default 16:9 / landscape
    return is1080p ? { width: 1920, height: 1080 } : { width: 1280, height: 720 };
  }

  // ==========================================================================
  // Stage 6: Dual-Mode Visual Generation Dispatcher
  // ==========================================================================
  /**
   * Alias for dispatchVisualAssets supporting flexible parameter positioning.
   */
  public async generateSceneVisuals(
    scenes: StoryboardScene[],
    assetsDirOrConfig: string | Partial<AiStudioFlowEngineConfig>,
    configOrAssetsDir?: Partial<AiStudioFlowEngineConfig> | string,
    onProgress?: (pct: number, msg: string) => void,
    onSceneComplete?: (scene: StoryboardScene, index: number) => void | Promise<void>,
    signal?: AbortSignal
  ): Promise<VisualDispatchResult> {
    const assetsDir = typeof assetsDirOrConfig === 'string' ? assetsDirOrConfig : (typeof configOrAssetsDir === 'string' ? configOrAssetsDir : '');
    const flowConfig = typeof assetsDirOrConfig === 'object' ? assetsDirOrConfig : (typeof configOrAssetsDir === 'object' ? configOrAssetsDir : {});
    return this.dispatchVisualAssets(scenes, flowConfig, assetsDir, onProgress, signal, onSceneComplete);
  }

  public async dispatchVisualAssets(
    scenes: StoryboardScene[],
    flowConfig: Partial<AiStudioFlowEngineConfig> = {},
    assetsDir: string,
    onProgress?: (pct: number, msg: string) => void,
    signal?: AbortSignal,
    onSceneComplete?: (scene: StoryboardScene, index: number) => void | Promise<void>
  ): Promise<VisualDispatchResult> {
    if(!this.rpcClient){
      const ready=flowCreditReadiness(flowConfig,flowConfig.flowCreditProjectId,scenes.length);
      if(ready.status!=='CONFIGURATION_READY')throw Error('FLOW_CREDITS_BLOCKED: '+ready.reasons.join(' '));
      if(!this.getBrowserAutomationAdapter().isConnected('flow'))throw Error('FLOW_CDP_REQUIRED: chưa kết nối Chrome Flow riêng; không suy session từ Gemini Web/Electron.');
    }
    fs.mkdirSync(assetsDir, { recursive: true });

    // Mặc định luôn ưu tiên Pure Web RPC trừ khi chọn engine dom hoặc synthetic
    const isLegacyDom = flowConfig.engine === 'dom' || flowConfig.engine === 'legacy_dom';
    const bridge = FlowBridgeServer.getInstance();
    const isBridgeConnected = bridge.isConnected();
    const isPlaywrightConnected = BrowserAutomationAdapter.getInstance().isConnected('flow');
    let useGoogleFlow = Boolean(this.rpcClient || (!isLegacyDom && flowConfig.engine !== 'synthetic'));
    if (!this.rpcClient && useGoogleFlow && !isBridgeConnected && !isPlaywrightConnected) {
      try {
        const sessionMgr = GoogleVeoSessionManager.getInstance();
        const status = await Promise.race([
          sessionMgr.validateSession(),
          new Promise<any>((_, reject) =>
            setTimeout(() => reject(new Error('Preflight session check timeout')), 8000)
          ),
        ]);
        if (!status || !status.valid) {
          const hasExplicitFallback = Boolean(
            flowConfig.allowSyntheticFallback === true ||
            flowConfig.fallbackToSynthetic === true ||
            (flowConfig as any).explicitFallback === true
          );
          if (!hasExplicitFallback) {
            throw new GoogleFlowRpcError(
              `Chưa đăng nhập Google Flow hoặc phiên làm việc đã hết hạn (${status?.detail || 'Chưa xác thực'}). Vui lòng mở Sảnh Google Flow trên giao diện để đăng nhập tài khoản.`,
              { code: 'SESSION_EXPIRED', retryable: false, suggestedAction: 'REAUTH_REQUIRED' }
            );
          } else {
            console.warn('[AiStudioVisualService] Phiên Google Flow chưa xác thực, chuyển sang fallback bản mẫu thiết kế.');
            useGoogleFlow = false;
          }
        }
      } catch (e: any) {
        if (e instanceof GoogleFlowRpcError) throw e;
        console.warn('[AiStudioVisualService] Lỗi khi kiểm tra validateSession:', e);
      }
    }

    let lobbyWin: any = null;
    if (!isBridgeConnected && !isPlaywrightConnected) {
      try {
        const sessionMgr = GoogleVeoSessionManager.getInstance();
        lobbyWin = sessionMgr.getLobbyWindow();
        if (lobbyWin && lobbyWin.isDestroyed()) lobbyWin = null;
      } catch {
        lobbyWin = null;
      }
    }

    let googleFlowSuccessCount = 0;

    for (let i = 0; i < scenes.length; i++) {
      if (signal?.aborted) {
        throw new GoogleFlowRpcError('Tác vụ đã bị người dùng huỷ bỏ.', { code: 'CANCELLED', retryable: false });
      }

      const scene = scenes[i];
      const isSceneVideo = scene.motionType === 'video';
      const existingReadyFile = isSceneVideo
        ? scene.videoPath
        : (scene.imagePath || scene.assetPath);
      if (
        isPlaywrightConnected &&
        scene.status === 'ready' &&
        existingReadyFile &&
        fs.existsSync(existingReadyFile) &&
        fs.statSync(existingReadyFile).size > 0
      ) {
        scene.assetPath = existingReadyFile;
        googleFlowSuccessCount++;
        await onSceneComplete?.(scene, i);
        continue;
      }
      const ext = isSceneVideo && useGoogleFlow ? 'mp4' : 'png';
      const assetPath = path.join(assetsDir, `scene_${(scene.shotId || scene.id).replace(/[^a-zA-Z0-9_-]/g, '_')}_${crypto.randomUUID()}.${ext}`);

      const sceneBasePct = Math.round((i / scenes.length) * 100);
      const sceneWeight = Math.round(100 / scenes.length);

      const sceneProgressCallback = (pct: number, msg: string) => {
        const overallPct = Math.min(99, sceneBasePct + Math.round((pct / 100) * sceneWeight));
        onProgress?.(overallPct, `[Cảnh ${i + 1}/${scenes.length}] ${msg}`);
      };

      onProgress?.(
        sceneBasePct,
        `Đang tạo hình ảnh phân cảnh ${i + 1}/${scenes.length} (${useGoogleFlow ? 'Google Flow AI' : 'Bản mẫu độ phân giải cao'})...`
      );

      // Attempt live Google Flow session if authenticated
      if (useGoogleFlow) {
        let finalPath: string | null = null;
        let lastFlowErr: any = null;
        const maxRetries = 0; // A generation is never automatically resubmitted.

        for (let retry = 0; retry <= maxRetries; retry++) {
          if (signal?.aborted) {
            throw new GoogleFlowRpcError('Tác vụ đã bị người dùng huỷ bỏ.', { code: 'CANCELLED', retryable: false });
          }

          try {
            finalPath = await this.generateViaGoogleFlow(
              scene,
              assetPath,
              flowConfig,
              sceneProgressCallback,
              signal
            );
            break;
          } catch (rawFlowErr: any) {
            if (signal?.aborted) {
              throw new GoogleFlowRpcError('Tác vụ đã bị người dùng huỷ bỏ.', { code: 'CANCELLED', retryable: false });
            }
            const flowErr = classifyFlowRpcError(rawFlowErr);
            lastFlowErr = flowErr;
            if(!this.rpcClient)throw flowErr; // Production UI route never retries or substitutes a failed generation.
            if (flowErr.code === 'CANCELLED') {
              throw flowErr;
            }
            const errorCode = flowErr.code;
            const isUnusual = isUnusualActivityError(flowErr) || errorCode === 'PUBLIC_ERROR_UNUSUAL_ACTIVITY' || errorCode === 'UNUSUAL_ACTIVITY';
            const isTransient =
              !isUnusual &&
              (flowErr.retryable ||
                errorCode === 'RATE_LIMITED' ||
                errorCode === 'UPSTREAM_ERROR' ||
                errorCode === 'TIMEOUT');

            if (isUnusual) {
              console.warn(
                `[AiStudioVisualService] Phát hiện PUBLIC_ERROR_UNUSUAL_ACTIVITY ở cảnh ${i + 1}. ` +
                `Dừng retry tự động (ABORT_HALT) để bảo vệ tài khoản người dùng.`
              );
              throw flowErr;
            }

            if (isTransient && retry < maxRetries) {

              const baseMs = typeof flowConfig.backoffBaseMs === 'number' ? flowConfig.backoffBaseMs : 10000;
              const backoffMs = calculateExponentialBackoffMs(retry, baseMs, 120000);
              const waitMs = baseMs === 0 ? 0 : (flowErr.retryAfterMs ? Math.max(flowErr.retryAfterMs, backoffMs) : backoffMs);
              const waitSec = Math.round(waitMs / 1000);

              console.warn(
                `[AiStudioVisualService] Sinh media Google Flow ở cảnh ${i + 1} gặp lỗi [${errorCode}]. ` +
                `Lũy tiến lùi bước (lần ${retry + 1}/${maxRetries}): chờ ${waitSec}s...`
              );

              if (waitMs < 1000) {
                onProgress?.(
                  sceneBasePct,
                  `[Cảnh ${i + 1}/${scenes.length}] Gặp phản hồi ${errorCode}. Đang giãn cách lùi bước: Đang thử lại (lần ${retry + 1})...`
                );
                await sleepAbortable(waitMs, signal);
              } else {
                const waitSec = Math.round(waitMs / 1000);
                for (let s = waitSec; s > 0; s--) {
                  if (signal?.aborted) {
                    throw new GoogleFlowRpcError('Tác vụ đã bị người dùng huỷ bỏ.', { code: 'CANCELLED', retryable: false });
                  }
                  onProgress?.(
                    sceneBasePct,
                    `[Cảnh ${i + 1}/${scenes.length}] Gặp phản hồi ${errorCode}. Đang giãn cách lùi bước: Còn ${s} giây trước khi thử lại (lần ${retry + 1})...`
                  );
                  await sleepAbortable(1000, signal);
                }
              }
              continue;
            }

            // Hết số lần retry hoặc lỗi không retry được:
            console.warn(
              `[AiStudioVisualService] Sinh media Google Flow thất bại ở cảnh ${i + 1} [Mã lỗi: ${errorCode}]: ${flowErr.message}`
            );

            // Kiểm tra xem phân cảnh đã có ảnh keyframe thực tế hay chưa
            if (scene.imagePath && fs.existsSync(scene.imagePath)) {
              if (flowConfig.allowKenBurnsFallback) {
                console.log(
                  `[AiStudioVisualService] 📸 Phân cảnh ${i + 1} đã có ảnh keyframe thực tế. Chuyển sang ảnh tĩnh Ken Burns theo cấu hình allowKenBurnsFallback.`
                );
                onProgress?.(
                  sceneBasePct,
                  `[Cảnh ${i + 1}/${scenes.length}] Sinh video AI thất bại. Đã chuyển sang ảnh tĩnh Ken Burns theo cấu hình dự phòng.`
                );
                finalPath = scene.imagePath;
                scene.assetPath = scene.imagePath;
                scene.motionType = 'ken_burns';
                delete scene.videoPath;
                break;
              } else {
                console.warn(
                  `[AiStudioVisualService] ⚠️ Sinh video AI cho cảnh ${i + 1} thất bại. allowKenBurnsFallback=false: Báo lỗi chính xác, không tự ý thay video bằng Ken Burns.`
                );
                throw lastFlowErr || flowErr;
              }
            }

            // Hoàn toàn không có ảnh keyframe thực tế -> Ném lỗi có cấu trúc để ActionableErrorBanner xử lý
            throw lastFlowErr || flowErr;
          }
        }

        if (finalPath) {
          scene.assetPath = finalPath;
          if (isSceneVideo && !finalPath.endsWith('.png')) {
            scene.videoPath = finalPath;
          } else {
            scene.imagePath = finalPath;
            delete scene.videoPath;
            scene.motionType = 'ken_burns';
          }
          scene.status = 'ready';
          googleFlowSuccessCount++;
          await onSceneComplete?.(scene, i);

          // Giãn cách cooldown bắt buộc giữa 2 cảnh liên tiếp
          if (i < scenes.length - 1 && !flowConfig.skipCooldown) {
            if (signal?.aborted) {
              throw new GoogleFlowRpcError('Tác vụ đã bị người dùng huỷ bỏ.', { code: 'CANCELLED', retryable: false });
            }

            const cooldownSec = typeof flowConfig.cooldownSec === 'number' && Number.isFinite(flowConfig.cooldownSec)
              ? Math.max(0, Math.round(flowConfig.cooldownSec))
              : calculateCooldownSeconds(8, 12, 2);

            const sceneEndPct = Math.min(99, sceneBasePct + sceneWeight);

            for (let sec = cooldownSec; sec > 0; sec--) {
              if (signal?.aborted) {
                throw new GoogleFlowRpcError('Tác vụ đã bị người dùng huỷ bỏ.', { code: 'CANCELLED', retryable: false });
              }
              onProgress?.(sceneEndPct, `Đang giãn cách an toàn: Còn ${sec} giây trước cảnh tiếp theo...`);
              await sleepAbortable(1000, signal);
            }
          }

          continue;
        }

        // Nếu không có finalPath: sử dụng ảnh keyframe thật nếu có và được phép bởi allowKenBurnsFallback
        if (scene.imagePath && fs.existsSync(scene.imagePath)) {
          if (flowConfig.allowKenBurnsFallback) {
            scene.assetPath = scene.imagePath;
            delete scene.videoPath;
            scene.motionType = 'ken_burns';
            scene.status = 'ready';
            googleFlowSuccessCount++;
            await onSceneComplete?.(scene, i);
            continue;
          } else {
            console.warn(
              `[AiStudioVisualService] ⚠️ Sinh video AI cho cảnh ${i + 1} thất bại. allowKenBurnsFallback=false: Báo lỗi chính xác, không tự ý thay video bằng Ken Burns.`
            );
            throw (
              lastFlowErr ||
              new GoogleFlowRpcError(
                `Sinh video AI cho cảnh ${i + 1} thất bại và allowKenBurnsFallback=false.`,
                { code: 'UPSTREAM_ERROR', retryable: false }
              )
            );
          }
        }

        throw (
          lastFlowErr ||
          new GoogleFlowRpcError(
            `Không thể tạo media cho phân cảnh ${i + 1} và không có ảnh keyframe thực tế.`,
            { code: 'UPSTREAM_ERROR', retryable: true }
          )
        );
      }
    }

    const modeUsed: 'google_flow' = 'google_flow';

    return {
      scenes,
      generatedCount: scenes.filter((s) => s.assetPath && fs.existsSync(s.assetPath)).length,
      modeUsed,
    };
  }

  // ==========================================================================
  // Google Flow Generation Bridge (Pure Web RPC)
  // ==========================================================================
  public async generateViaGoogleFlow(
    scene: StoryboardScene,
    outputPath: string,
    flowConfig: Partial<AiStudioFlowEngineConfig> = {},
    onProgress?: (pct: number, msg: string) => void,
    signal?: AbortSignal
  ): Promise<string> {
    if (!this.rpcClient) {
      if(!['playwright','browser_automation'].includes(flowConfig.engine||''))throw Error('FLOW_UI_REQUIRED: RPC cũ bị khóa; không retry unusual activity hoặc fallback API.');
      return this.generateApprovedFlowUi(scene,outputPath,flowConfig,onProgress,signal);
    }
    const rpcClient = this.getRpcClient();

    const bridge = FlowBridgeServer.getInstance();
    const isBridgeConnected = bridge.isConnected();
    const isPlaywrightConnected = BrowserAutomationAdapter.getInstance().isConnected('flow');

    let lobbyWin: any = null;
    let effectiveProjectId: string | undefined = flowConfig.projectId;

    if (isBridgeConnected || isPlaywrightConnected) {
      // Khi đã có Chrome Extension hoặc Playwright CDP kết nối:
      // BỎ QUA HOÀN TOÀN việc mở hay tương tác với cửa sổ Electron lobby,
      // toàn bộ yêu cầu được chuyển sang Google Chrome thật!
      if (!effectiveProjectId) {
        throw new GoogleFlowRpcError('Chưa liên kết project Google Flow cho phiên này. Hãy chạy lại bước tạo media để tạo project riêng.', { code: 'INVALID_ARGUMENT', retryable: false });
      }
    } else {
      try {
        const procMgr = BrowserProcessManager.getInstance();
        const flowProfile = procMgr.getProfileDir('flow');
        procMgr.cleanupStaleLockFiles(flowProfile);
      } catch (lockErr) {
        console.warn('[AiStudioVisualService] cleanupStaleLockFiles notice:', lockErr);
      }

      try {
        const sessionMgr = GoogleVeoSessionManager.getInstance();
        lobbyWin = sessionMgr.getLobbyWindow();
        if (!lobbyWin || lobbyWin.isDestroyed()) {
          await sessionMgr.openLobbyWindow({ uiMode: 'offscreen' });
          lobbyWin = sessionMgr.getLobbyWindow();
        }
        if (lobbyWin && !lobbyWin.isDestroyed()) {
          await sessionMgr.ensureProjectContext(lobbyWin, flowConfig.projectId);
          effectiveProjectId = sessionMgr.getCurrentProjectId() || flowConfig.projectId;
        }
      } catch {
        lobbyWin = null;
      }
    }

    if (signal?.aborted) {
      throw new GoogleFlowRpcError('Tác vụ đã bị người dùng huỷ bỏ.', { code: 'CANCELLED', retryable: false });
    }

    const isVideo = scene.motionType === 'video';
    const isPlaywrightEngine = flowConfig.engine === 'browser_automation' || flowConfig.engine === 'playwright';
    const isAutomationAvailable = FlowBridgeServer.getInstance().isConnected() || isPlaywrightEngine || isPlaywrightConnected;

    // Normalize output path extension safely without destroying directory names containing dots
    const desiredExt = isVideo ? '.mp4' : '.png';
    const currentExt = path.extname(outputPath);
    let targetPath = outputPath;
    if (currentExt.toLowerCase() !== desiredExt) {
      if (currentExt) {
        targetPath = outputPath.slice(0, -currentExt.length) + desiredExt;
      } else {
        targetPath = outputPath + desiredExt;
      }
    }
    fs.mkdirSync(path.dirname(targetPath), { recursive: true });

    let effectivePrompt = (scene.visualPrompt || scene.lineText || '').trim();
    if (!effectivePrompt) {
      throw new GoogleFlowRpcError('Prompt tạo media không được để trống.', {
        code: 'INVALID_ARGUMENT',
        retryable: false,
      });
    }

    const router = VisualProviderRouter.getInstance();
    const sceneIndex = typeof scene.sceneNumber === 'number' ? scene.sceneNumber : (scene.lineIndex ?? 0);
    const idempotencyKey = router.generateIdempotencyKey({
      workspaceScope: path.resolve(path.dirname(targetPath)),
      generationNonce: flowConfig.generationNonce,
      projectId: effectiveProjectId,
      sceneId: scene.id,
      sceneIndex,
      prompt: effectivePrompt,
      motionPrompt: (scene as any).motionPrompt || (scene as any).cameraMovement,
      negativePrompt: scene.negativePrompt || flowConfig.negativePrompt,
      mediaType: isVideo ? 'video' : 'image',
      aspectRatio: flowConfig.aspectRatio || '16:9',
      model: flowConfig.engine,
      inputAsset: (scene as any).inputImageAsset || (scene as any).input_image_asset,
      referenceImage: scene.referenceImagePath || flowConfig.referenceImagePath,
      stylePrefix: flowConfig.stylePromptPrefix,
    });

    const routerResult = await router.executeWithIdempotency(
      {
        idempotencyKey,
        mediaType: isVideo ? 'video' : 'image',
        prompt: effectivePrompt,
        aspectRatio: flowConfig.aspectRatio || '16:9',
        projectId: effectiveProjectId,
        targetPath,
        apiKey: flowConfig.apiKey,
        signal,
        onProgress,
      },
      async (req) => {
        const mutex = GoogleFlowBrowserMutex.getInstance();
        const producedPath = await mutex.runExclusive(async () => {
          if (signal?.aborted) {
            throw new GoogleFlowRpcError('Tác vụ đã bị người dùng huỷ bỏ.', { code: 'CANCELLED', retryable: false });
          }

          const refAssets = (scene as any).referenceAssets ||
            (scene.referenceImagePath ? [scene.referenceImagePath] : undefined) ||
            (flowConfig.referenceImagePath ? [flowConfig.referenceImagePath] : undefined);

      if (isVideo) {
        let resolvedKeyframeAsset = (scene as any).inputImageAsset || (scene as any).input_image_asset;
        let keyframePath: string | undefined = scene.imagePath && fs.existsSync(scene.imagePath) ? scene.imagePath : undefined;

        // BƯỚC 1: Nếu chưa có keyframe image asset, sinh ảnh keyframe chất lượng cao bằng Imagen (ogiZ0b) trước
        if (!resolvedKeyframeAsset) {
          onProgress?.(8, 'Bước 1/2 (I2V): Đang sinh ảnh keyframe chất lượng cao bằng Imagen (ogiZ0b)...');
          let keyframeTargetPath = targetPath.endsWith('.mp4')
            ? targetPath.replace(/\.mp4$/i, '.png')
            : `${targetPath}_keyframe.png`;

          let imgGenResult: any = null;

          const uiTimeoutImage = typeof flowConfig.uiTimeoutMs === 'number' && flowConfig.uiTimeoutMs > 0 ? flowConfig.uiTimeoutMs : 90000;
          const shouldDirectUiKeyframe = (this._preferUiImageGen || flowConfig.preferUiGen || isPlaywrightEngine || isPlaywrightConnected) && isAutomationAvailable;

          if (shouldDirectUiKeyframe) {
            console.log(
              `[AiStudioVisualService] ⚡ Direct UI Mode: Bỏ qua Pure RPC, trực tiếp sinh ảnh keyframe bằng CDP Trusted UI (isTrusted=true)...`
            );
            try {
              const uiRes = await this.executeUiGeneration(
                effectivePrompt,
                uiTimeoutImage,
                effectiveProjectId,
                'image',
                signal
              );
              console.log(
                `[AiStudioVisualService] 🔍 Kết quả Direct UI keyframe:`,
                uiRes ? (uiRes.ok ? `OK (rpcid=${uiRes.capturedRpc?.rpcid || 'dom'})` : `Lỗi (${uiRes.error})`) : 'NULL'
              );
              if (uiRes && uiRes.ok) {
                if (uiRes.firstImageUrl) {
                  const extractedMediaId =
                    uiRes.assetId ||
                    (uiRes.firstImageUrl.match(/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/i) || [])[1] ||
                    uiRes.firstImageUrl;
                  imgGenResult = {
                    images: [{ url: uiRes.firstImageUrl, mediaId: extractedMediaId, assetId: extractedMediaId }],
                    firstImageUrl: uiRes.firstImageUrl,
                    mediaId: extractedMediaId,
                    projectId: effectiveProjectId,
                  };
                } else if (uiRes.capturedRpc?.response) {
                  let rpcData: any = null;
                  const rpcid = uiRes.capturedRpc.rpcid || RPC_GEN_IMAGE;
                  try {
                    const parsed = parseBatchResponse(uiRes.capturedRpc.response, rpcid);
                    if (parsed.ok) rpcData = parsed.data;
                  } catch {}
                  if (!rpcData && rpcid !== RPC_GEN_IMAGE) {
                    try {
                      const parsed = parseBatchResponse(uiRes.capturedRpc.response, RPC_GEN_IMAGE);
                      if (parsed.ok) rpcData = parsed.data;
                    } catch {}
                  }
                  const imgs = extractGeneratedImages(rpcData || uiRes.capturedRpc.response, rpcid);
                  if (imgs && imgs.length > 0) {
                    imgGenResult = {
                      images: imgs,
                      firstImageUrl: imgs[0].url,
                      projectId: effectiveProjectId,
                    };
                  }
                }
              } else if (uiRes && (uiRes.state === 'BLOCKED_REQUIRES_USER' || uiRes.errorCode === 'BLOCKED_REQUIRES_USER' || String(uiRes.error || '').includes('PUBLIC_ERROR_UNUSUAL_ACTIVITY'))) {
                throw new GoogleFlowRpcError(
                  'Google Flow chặn tác vụ do phát hiện hành vi tự động (BLOCKED_REQUIRES_USER). Cần người dùng tương tác mở tab Chrome để xác minh.',
                  { code: 'PUBLIC_ERROR_UNUSUAL_ACTIVITY', retryable: false, suggestedAction: 'ABORT_HALT' }
                );
              } else if (uiRes && !uiRes.ok && isPlaywrightConnected) {
                throw new GoogleFlowRpcError(
                  uiRes.error || 'Tạo ảnh keyframe qua giao diện Google Flow thất bại.',
                  { code: 'UPSTREAM_ERROR', retryable: false }
                );
              }
            } catch (uiKeyErr: any) {
              if (isUnusualActivityError(uiKeyErr) || uiKeyErr?.code === 'PUBLIC_ERROR_UNUSUAL_ACTIVITY' || isPlaywrightConnected) {
                throw uiKeyErr;
              }
              console.warn('[AiStudioVisualService] Direct UI keyframe warning:', uiKeyErr?.message || uiKeyErr);
            }
          }

          if (!imgGenResult && !this._preferUiImageGen && !isPlaywrightConnected) {
            try {
              imgGenResult = await rpcClient.generateImage({
                prompt: effectivePrompt,
                aspectRatio: flowConfig.aspectRatio || '16:9',
                referenceAssets: refAssets,
                projectId: effectiveProjectId,
                win: lobbyWin,
                signal,
                maxRetries: 0,
                backoffBaseMs: typeof flowConfig.backoffBaseMs === 'number' ? flowConfig.backoffBaseMs : 10000,
              });
            } catch (rpcGenErr: any) {
              const classified = classifyFlowRpcError(rpcGenErr);
              throw classified;
            }
          }

          if (!imgGenResult) {
            throw new GoogleFlowRpcError('Không nhận được kết quả sinh ảnh keyframe từ Google Flow.', {
              code: 'UPSTREAM_ERROR',
              retryable: true,
            });
          }

          const keyframeUrl = imgGenResult.firstImageUrl || imgGenResult.images?.[0]?.url;
          if (!keyframeUrl) {
            throw new GoogleFlowRpcError('Không nhận được URL ảnh keyframe từ Google Flow Imagen RPC.', {
              code: 'UPSTREAM_ERROR',
              retryable: true,
            });
          }

          onProgress?.(18, 'Bước 1/2 (I2V): Đang tải ảnh keyframe từ CDN về thư mục dự án...');
          await this.downloadMediaAsset(keyframeUrl, keyframeTargetPath, {
            signal,
            win: lobbyWin,
            partition: rpcClient.partition,
          });

          try {
            keyframeTargetPath = (await this.validateMediaFile(keyframeTargetPath, 'image', {
              fullDecode: flowConfig.fullMediaDecode,
              decodeTimeoutMs: flowConfig.mediaDecodeTimeoutMs ?? 30000,
            }) as any) || keyframeTargetPath;
          } catch (kErr) {
            try { if (fs.existsSync(keyframeTargetPath)) fs.unlinkSync(keyframeTargetPath); } catch {}
            throw kErr;
          }

          scene.imagePath = keyframeTargetPath;
          keyframePath = keyframeTargetPath;

          // Lấy Media UUID từ Imagen RPC response (mediaId hoặc assetId)
          const keyframeMediaId =
            imgGenResult.images?.[0]?.mediaId ||
            imgGenResult.images?.[0]?.assetId ||
            (imgGenResult as any).mediaId ||
            keyframeUrl ||
            keyframeTargetPath;

          (scene as any).inputImageAsset = keyframeMediaId;
          resolvedKeyframeAsset = keyframeMediaId;
          console.log(`[AiStudioVisualService] ✅ Bước 1 I2V thành công: Keyframe mediaId=${keyframeMediaId}, path=${keyframeTargetPath}`);
        }

        // BƯỚC 2: Gọi Veo Image-to-Video (MZZa6b) với keyframe asset và motion prompt
        const motionPrompt =
          (scene as any).motionPrompt ||
          (scene as any).cameraMovement ||
          (scene as any).cameraMotion ||
          effectivePrompt;

        onProgress?.(25, 'Bước 2/2 (I2V): Đang gửi yêu cầu tạo video chuyển động Veo (MZZa6b)...');

        try {
          let genResult: any = null;

          const uiTimeoutVideo = typeof flowConfig.uiTimeoutMs === 'number' && flowConfig.uiTimeoutMs > 0 ? flowConfig.uiTimeoutMs : 180000;
          const shouldDirectUiVideo = (this._preferUiVideoGen || flowConfig.preferUiGen || isPlaywrightEngine || isPlaywrightConnected) && isAutomationAvailable;

          if (shouldDirectUiVideo) {
            console.log(
              `[AiStudioVisualService] ⚡ Direct UI Mode: Bỏ qua Pure RPC, trực tiếp sinh video bằng CDP Trusted UI (isTrusted=true)...`
            );
            try {
              const uiRes = await this.executeUiGeneration(
                motionPrompt,
                uiTimeoutVideo,
                effectiveProjectId,
                'video',
                signal,
                {
                  inputImageAsset: resolvedKeyframeAsset,
                  sceneId: scene.id,
                }
              );
              console.log(
                `[AiStudioVisualService] 🔍 Kết quả Direct UI video:`,
                uiRes ? (uiRes.ok ? `OK (rpcid=${uiRes.capturedRpc?.rpcid || 'captured'})` : `Lỗi (${uiRes.error})`) : 'NULL'
              );
              if (uiRes && uiRes.ok) {
                if (uiRes.videoUrl) {
                  genResult = {
                    operationId: uiRes.assetId || 'dom-extracted-video',
                    projectId: effectiveProjectId,
                    status: 'COMPLETED',
                    done: true,
                    videoUrl: uiRes.videoUrl,
                  };
                } else if (uiRes.capturedRpc?.response) {
                  let rpcData: any = null;
                  try {
                    const parsed = parseBatchResponse(uiRes.capturedRpc.response, RPC_GEN_VIDEO_REFERENCES);
                    if (parsed.ok) rpcData = parsed.data;
                  } catch {}
                  if (!rpcData) {
                    try {
                      const parsed = parseBatchResponse(uiRes.capturedRpc.response, RPC_GEN_VIDEO_TEXT);
                      if (parsed.ok) rpcData = parsed.data;
                    } catch {}
                  }
                  if (!rpcData) {
                    try {
                      const parsed = parseBatchResponse(uiRes.capturedRpc.response, RPC_OPERATION);
                      if (parsed.ok) rpcData = parsed.data;
                    } catch {}
                  }
                  if (!rpcData) {
                    try {
                      const parsed = parseBatchResponse(uiRes.capturedRpc.response, RPC_MEDIA);
                      if (parsed.ok) rpcData = parsed.data;
                    } catch {}
                  }
                  const opStatus = extractOperationStatus(rpcData || uiRes.capturedRpc.response, RPC_GEN_VIDEO_REFERENCES);
                  if (opStatus && (opStatus.operationId || opStatus.videoUrl)) {
                    genResult = {
                      operationId: opStatus.operationId,
                      projectId: opStatus.projectId || effectiveProjectId,
                      status: opStatus.status || 'RUNNING',
                      done: opStatus.done,
                      videoUrl: opStatus.videoUrl,
                    };
                  }
                }
              } else if (uiRes && (uiRes.state === 'BLOCKED_REQUIRES_USER' || uiRes.errorCode === 'BLOCKED_REQUIRES_USER' || String(uiRes.error || '').includes('PUBLIC_ERROR_UNUSUAL_ACTIVITY'))) {
                throw new GoogleFlowRpcError(
                  'Google Flow chặn tác vụ do phát hiện hành vi tự động (BLOCKED_REQUIRES_USER). Cần người dùng tương tác mở tab Chrome để xác minh.',
                  { code: 'PUBLIC_ERROR_UNUSUAL_ACTIVITY', retryable: false, suggestedAction: 'ABORT_HALT' }
                );
              } else if (uiRes && !uiRes.ok && isPlaywrightConnected) {
                throw new GoogleFlowRpcError(
                  uiRes.error || 'Tạo video I2V qua giao diện Google Flow thất bại.',
                  { code: 'UPSTREAM_ERROR', retryable: false }
                );
              }
            } catch (uiVidDirectErr: any) {
              if (isUnusualActivityError(uiVidDirectErr) || uiVidDirectErr?.code === 'PUBLIC_ERROR_UNUSUAL_ACTIVITY' || isPlaywrightConnected) {
                throw uiVidDirectErr;
              }
              console.warn('[AiStudioVisualService] Direct UI video warning:', uiVidDirectErr?.message || uiVidDirectErr);
            }
          }

          if (!genResult && !this._preferUiVideoGen && !isPlaywrightConnected) {
            try {
              genResult = await rpcClient.generateVideo({
                prompt: motionPrompt,
                aspectRatio: flowConfig.aspectRatio || '16:9',
                referenceAssets: refAssets,
                inputImageAsset: resolvedKeyframeAsset,
                projectId: effectiveProjectId,
                win: lobbyWin,
                signal,
                maxRetries: 0,
                backoffBaseMs: typeof flowConfig.backoffBaseMs === 'number' ? flowConfig.backoffBaseMs : 10000,
              });
            } catch (rpcVidErr: any) {
              const classified = classifyFlowRpcError(rpcVidErr);
              throw classified;
            }
          }

          if (!genResult) {
            throw new GoogleFlowRpcError('Không nhận được kết quả sinh video từ Google Flow.', {
              code: 'UPSTREAM_ERROR',
              retryable: true,
            });
          }

          let finalVideoUrl = genResult.videoUrl;

          if (!finalVideoUrl) {
            if (!genResult.operationId) {
              throw new GoogleFlowRpcError('Không nhận được operationId từ Google Flow RPC video generation.', {
                code: 'UPSTREAM_ERROR',
                retryable: true,
              });
            }

            onProgress?.(35, 'Đang theo dõi tiến trình tạo video (Veo RPC Poller)...');

            const pollResult = await rpcClient.pollGeneration({
              operationId: genResult.operationId,
              projectId: genResult.projectId,
              win: lobbyWin,
              signal,
              onProgress: (pInfo) => {
                const scaledPct = 35 + Math.round((Math.min(100, Math.max(0, pInfo.percentage)) / 100) * 50);
                onProgress?.(
                  scaledPct,
                  `[Veo ${pInfo.state}] ${pInfo.message || 'Đang tạo video...'}`
                );
              },
            });

            finalVideoUrl = pollResult.videoUrl;
          }

          if (!finalVideoUrl) {
            throw new GoogleFlowRpcError('Google Flow RPC hoàn tất nhưng không có videoUrl trong kết quả.', {
              code: 'UPSTREAM_ERROR',
              retryable: true,
            });
          }

          onProgress?.(88, 'Đang tải tệp video từ CDN về thư mục dự án...');
          await this.downloadMediaAsset(finalVideoUrl, targetPath, {
            signal,
            win: lobbyWin,
            partition: rpcClient.partition,
          });

          try {
            targetPath = (await this.validateMediaFile(targetPath, 'video', {
              fullDecode: flowConfig.fullMediaDecode,
              decodeTimeoutMs: flowConfig.mediaDecodeTimeoutMs ?? 30000,
            }) as any) || targetPath;
          } catch (vErr) {
            try { if (fs.existsSync(targetPath)) fs.unlinkSync(targetPath); } catch {}
            throw vErr;
          }

          scene.videoPath = targetPath;
          scene.assetPath = targetPath;
          scene.status = 'ready';
          onProgress?.(100, 'Đã tải hoàn tất video phân cảnh.');
          return targetPath;
        } catch (veoErr: any) {
          // DISPATCH Task 3: Nếu sinh video Veo thất bại nhưng đã có ảnh keyframe thật,
          // sử dụng ảnh keyframe thật (kèm hiệu ứng Ken Burns) làm hình ảnh phân cảnh
          if (keyframePath && fs.existsSync(keyframePath)) {
            if (flowConfig.allowKenBurnsFallback) {
              console.warn(
                `[AiStudioVisualService] ⚠️ Sinh video Veo thất bại: ${veoErr?.message || veoErr}. ` +
                `Fallback sang ảnh keyframe thực tế kèm hiệu ứng Ken Burns theo cấu hình allowKenBurnsFallback: ${keyframePath}`
              );
              scene.imagePath = keyframePath;
              scene.assetPath = keyframePath;
              delete scene.videoPath;
              scene.motionType = 'ken_burns';
              scene.status = 'ready';
              onProgress?.(100, 'Đã chuyển sang ảnh keyframe thực tế (Ken Burns animation) theo cấu hình dự phòng.');
              return keyframePath;
            } else {
              console.warn(
                `[AiStudioVisualService] ⚠️ Sinh video Veo thất bại: ${veoErr?.message || veoErr}. ` +
                `allowKenBurnsFallback=false: Báo lỗi chính xác, không tự ý thay video bằng Ken Burns.`
              );
              throw veoErr;
            }
          }

          // Hoàn toàn không có ảnh keyframe thật -> ném lỗi có cấu trúc
          throw veoErr;
        }
      } else {
        // Image generation
        onProgress?.(15, 'Đang gửi yêu cầu tạo ảnh (Imagen/Nano RPC)...');

        let genResult: any = null;

        const uiTimeoutImage = typeof flowConfig.uiTimeoutMs === 'number' && flowConfig.uiTimeoutMs > 0 ? flowConfig.uiTimeoutMs : 90000;
        const shouldDirectUiImage = (this._preferUiImageGen || flowConfig.preferUiGen || isPlaywrightEngine || isPlaywrightConnected) && isAutomationAvailable;

        if (shouldDirectUiImage) {
          console.log(
            `[AiStudioVisualService] ⚡ Direct UI Mode: Bỏ qua Pure RPC, trực tiếp sinh ảnh bằng CDP Trusted UI (isTrusted=true)...`
          );
          try {
            const uiRes = await this.executeUiGeneration(
              effectivePrompt,
              uiTimeoutImage,
              effectiveProjectId,
              'image',
              signal
            );
            console.log(
              `[AiStudioVisualService] 🔍 Kết quả Direct UI ảnh:`,
              uiRes ? (uiRes.ok ? `OK (rpcid=${uiRes.capturedRpc?.rpcid || 'dom'})` : `Lỗi (${uiRes.error})`) : 'NULL'
            );
            if (uiRes && uiRes.ok) {
              if (uiRes.firstImageUrl) {
                const extractedMediaId =
                  uiRes.assetId ||
                  (uiRes.firstImageUrl.match(/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/i) || [])[1] ||
                  uiRes.firstImageUrl;
                genResult = {
                  images: [{ url: uiRes.firstImageUrl, mediaId: extractedMediaId, assetId: extractedMediaId }],
                  firstImageUrl: uiRes.firstImageUrl,
                  mediaId: extractedMediaId,
                  projectId: effectiveProjectId,
                };
              } else if (uiRes.capturedRpc?.response) {
                let rpcData: any = null;
                const rpcid = uiRes.capturedRpc.rpcid || RPC_GEN_IMAGE;
                try {
                  const parsed = parseBatchResponse(uiRes.capturedRpc.response, rpcid);
                  if (parsed.ok) rpcData = parsed.data;
                } catch {}
                if (!rpcData && rpcid !== RPC_GEN_IMAGE) {
                  try {
                    const parsed = parseBatchResponse(uiRes.capturedRpc.response, RPC_GEN_IMAGE);
                    if (parsed.ok) rpcData = parsed.data;
                  } catch {}
                }
                const imgs = extractGeneratedImages(rpcData || uiRes.capturedRpc.response, rpcid);
                if (imgs && imgs.length > 0) {
                  genResult = {
                    images: imgs,
                    firstImageUrl: imgs[0].url,
                    projectId: effectiveProjectId,
                  };
                }
              }
              } else if (uiRes && (uiRes.state === 'BLOCKED_REQUIRES_USER' || uiRes.errorCode === 'BLOCKED_REQUIRES_USER' || String(uiRes.error || '').includes('PUBLIC_ERROR_UNUSUAL_ACTIVITY'))) {
                throw new GoogleFlowRpcError(
                  'Google Flow chặn tác vụ do phát hiện hành vi tự động (BLOCKED_REQUIRES_USER). Cần người dùng tương tác mở tab Chrome để xác minh.',
                  { code: 'PUBLIC_ERROR_UNUSUAL_ACTIVITY', retryable: false, suggestedAction: 'ABORT_HALT' }
                );
              } else if (uiRes && !uiRes.ok && isPlaywrightConnected) {
                throw new GoogleFlowRpcError(
                  uiRes.error || 'Tạo ảnh qua giao diện Google Flow thất bại.',
                  { code: 'UPSTREAM_ERROR', retryable: false }
                );
              }
            } catch (uiDirectErr: any) {
              if (isUnusualActivityError(uiDirectErr) || uiDirectErr?.code === 'PUBLIC_ERROR_UNUSUAL_ACTIVITY' || isPlaywrightConnected) {
                throw uiDirectErr;
              }
              console.warn('[AiStudioVisualService] Direct UI ảnh warning:', uiDirectErr?.message || uiDirectErr);
            }
          }

          if (!genResult && !this._preferUiImageGen && !isPlaywrightConnected) {
            try {
              genResult = await rpcClient.generateImage({
                prompt: effectivePrompt,
                aspectRatio: flowConfig.aspectRatio || '16:9',
                referenceAssets: refAssets,
                projectId: effectiveProjectId,
                win: lobbyWin,
                signal,
                maxRetries: 0,
                backoffBaseMs: typeof flowConfig.backoffBaseMs === 'number' ? flowConfig.backoffBaseMs : 10000,
              });
            } catch (rpcImgErr: any) {
              const classified = classifyFlowRpcError(rpcImgErr);
              throw classified;
            }
          }

        if (!genResult) {
          throw new GoogleFlowRpcError('Không nhận được kết quả sinh ảnh từ Google Flow.', {
            code: 'UPSTREAM_ERROR',
            retryable: true,
          });
        }

        const imageUrl = genResult.firstImageUrl || genResult.images?.[0]?.url;
        if (!imageUrl) {
          throw new GoogleFlowRpcError('Google Flow RPC hoàn tất nhưng không tìm thấy ảnh trong phản hồi.', {
            code: 'UPSTREAM_ERROR',
            retryable: true,
          });
        }

        onProgress?.(80, 'Đang tải tệp ảnh từ CDN về thư mục dự án...');
        await this.downloadMediaAsset(imageUrl, targetPath, {
          signal,
          win: lobbyWin,
          partition: rpcClient.partition,
        });

        try {
          targetPath = (await this.validateMediaFile(targetPath, 'image', {
            fullDecode: flowConfig.fullMediaDecode,
            decodeTimeoutMs: flowConfig.mediaDecodeTimeoutMs ?? 30000,
          }) as any) || targetPath;
        } catch (iErr) {
          try { if (fs.existsSync(targetPath)) fs.unlinkSync(targetPath); } catch {}
          throw iErr;
        }

        const generatedMediaId =
          genResult.images?.[0]?.mediaId ||
          genResult.images?.[0]?.assetId ||
          (genResult as any).mediaId ||
          (imageUrl.match(/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/i) || [])[1] ||
          imageUrl;
        (scene as any).inputImageAsset = generatedMediaId;

        scene.imagePath = targetPath;
        scene.assetPath = targetPath;
        delete scene.videoPath;
        scene.status = 'ready';
        onProgress?.(100, 'Đã tải hoàn tất ảnh phân cảnh.');
        return targetPath;
      }
    }, `ai_studio_visual_service_${scene.id}`);

        return {
          provider: (producedPath.endsWith('.mp4') ? 'google_flow_rpc' : (isVideo ? 'ken_burns_fallback' : 'google_flow_rpc')) as any,
          mediaType: req.mediaType,
          localPath: producedPath,
          state: 'COMPLETED',
        };
      }
    );

    return routerResult.localPath;
  }

  // ==========================================================================
  // Media Asset Downloader & Storage Guard
  // ==========================================================================
  private async generateApprovedFlowUi(scene:StoryboardScene,outputPath:string,config:Partial<AiStudioFlowEngineConfig>,progress?: (pct:number,msg:string)=>void,signal?:AbortSignal):Promise<string>{
    const ready=flowCreditReadiness(config,config.flowCreditProjectId);
    if(ready.status!=='CONFIGURATION_READY'||!config.flowReceiptDir||!config.projectId)throw Error('FLOW_APPROVAL_REQUIRED: '+ready.reasons.join(' '));
    const adapter=this.getBrowserAutomationAdapter();
    if(!adapter.isConnected('flow'))throw Error('FLOW_CDP_REQUIRED: kết nối đúng Chrome test trước; không dùng cookie/partition khác làm bằng chứng đăng nhập.');
    const mode=scene.motionType==='video'?'video':'image',task=mode==='image'?'t2i':config.flowVideoMode||'t2v';
    const prompt=[scene.visualPrompt||scene.lineText,mode==='video'?scene.motionPrompt:'',scene.negativePrompt||config.negativePrompt?'Avoid: '+(scene.negativePrompt||config.negativePrompt):''].filter(Boolean).join('\n');
    if(!prompt.trim()||prompt.length>12000)throw Error('FLOW_PROMPT_INVALID');
    let referenceHash:string|undefined,assetId:string|undefined;
    if(task==='i2v'){
      const p=scene.mediaProvenance;
      if(p?.source!=='google_flow_ui'||!p.assetId||!scene.imagePath||p.assetPath!==scene.imagePath||p.projectId!==config.projectId||p.sceneId!==(scene.shotId||scene.id)||p.sessionId!==path.basename(path.dirname(config.flowReceiptDir)))throw Error('FLOW_I2V_PROVENANCE_REQUIRED: cần keyframe Flow đã xác minh đúng scene/project; không tự sinh thêm ảnh.');
      referenceHash=crypto.createHash('sha256').update(fs.readFileSync(scene.imagePath)).digest('hex');
      if(referenceHash!==p.sha256)throw Error('FLOW_KEYFRAME_CHANGED');assetId=p.assetId;
    }
    const key=crypto.createHash('sha256').update(JSON.stringify([config.projectId,scene.id,task,prompt,config.flowModelLabel,referenceHash,config.generationNonce||'initial'])).digest('hex');
    const ledger=new FlowCreditLedger(config.flowReceiptDir,key),old=ledger.read();
    const sessionId=path.basename(path.dirname(config.flowReceiptDir)),promptSha256=crypto.createHash('sha256').update(prompt.replace(/\r\n?/g,'\n').trim()).digest('hex');
    if(old&&(old.version!==2||old.projectId!==config.projectId||old.sceneId!==scene.id||old.sessionId!==sessionId||old.promptSha256!==promptSha256))throw Error('FLOW_RECONCILIATION_REQUIRED: receipt cũ hoặc không khớp, không thay đổi hay tự submit lại.');
    if(old?.state==='COMPLETED'){
      if(!old.localPath||!fs.existsSync(old.localPath)||path.dirname(fs.realpathSync(old.localPath))!==fs.realpathSync(path.dirname(outputPath))||crypto.createHash('sha256').update(fs.readFileSync(old.localPath)).digest('hex')!==old.sha256)throw Error('FLOW_RECONCILIATION_REQUIRED: receipt/output cần đối soát, không tự click lại.');
      await this.validateMediaFile(old.localPath,mode,{fullDecode:true});
      scene.mediaProvenance={source:'google_flow_ui',assetPath:old.localPath,sha256:old.sha256,projectId:config.projectId,sessionId:path.basename(path.dirname(config.flowReceiptDir)),sceneId:scene.shotId||scene.id,requestKey:key,assetId:old.assetId,referenceSha256:old.referenceSha256,automaticGeneration:true,quotedCredits:old.quotedCredits,actualCredits:null,hardCapVerified:false};
      if(mode==='image')scene.imagePath=old.localPath;else scene.videoPath=old.localPath;return old.localPath;
    }
    if(old&&!old.remote)throw Error('FLOW_RECONCILIATION_REQUIRED: không có output được đối soát, không tự click lại.');
    const approval={model:config.flowModelLabel!,mode,task,limit:config.flowGenerationLimit!,maxCredits:config.flowMaxCredits!,allowUnknownCost:config.flowAllowUnknownCost===true,sceneId:scene.id,projectId:config.projectId,sessionId,promptSha256};
    signal?.throwIfAborted();progress?.(5,'Google Flow — kiểm tra phiên, model và x1; chưa generation.');
    let lastProgress=5;
    try{
    const result:import('../../browser-automation/types').FlowGenerationAutomationResult=old?.remote?{ok:true,state:'GENERATING',remoteMediaReady:true,firstImageUrl:old.remote.url,assetId:old.remote.assetId,projectId:config.projectId,sceneId:scene.id,promptSha256}:await adapter.executeFlowGeneration({prompt,projectId:config.projectId,mode,signal,sceneId:scene.id,inputImageAsset:assetId,bringToFront:true,timeoutMs:mode==='video'?180000:90000,requireCreditApproval:true,
      beforeInput:async(page,baseline)=>{
        signal?.throwIfAborted();const state=await adapter.evaluateFlowSessionState(page);
        if(state.state!=='FLOW_READY'||state.projectId!==config.projectId)throw Error('FLOW_SESSION_OR_PROJECT_UNVERIFIED');
        const reservedQuote=await adapter.inspectFlowCreditState(page,approval.model);
        if(!reservedQuote.model||reservedQuote.outputs==null||reservedQuote.credits==null)throw Error('FLOW_QUOTE_UNREADABLE: chưa đọc được model/x1/giá trên Flow UI; không giữ chỗ theo quote mù.');
        ledger.reserve({...approval,baselineAssetIds:baseline.assetIds},reservedQuote);
      },
      onSubmissionState:async(state,details)=>{ledger.transition(state,details);lastProgress=Math.max(lastProgress,state==='GENERATING'?35:10);progress?.(lastProgress,state);},
      beforeSubmit:async page=>{
        signal?.throwIfAborted();
        const state=await adapter.evaluateFlowSessionState(page);
        if(state.state!=='FLOW_READY'||state.projectId!==config.projectId)throw Error('FLOW_SESSION_OR_PROJECT_UNVERIFIED');
        const quote=await adapter.inspectFlowCreditState(page,approval.model);
        if(mode==='video')ledger.reserve(approval,quote);
        else{
          const record=ledger.read();if(!record||record.promptSha256!==promptSha256||quote.credits!==record.quotedCredits)throw Error('FLOW_QUOTE_CHANGED');
          assertFlowQuote({...approval,remainingCredits:approval.maxCredits},quote);
        }
      }});
    signal?.throwIfAborted();
    if(!result.ok||(mode==='image'?(!result.remoteMediaReady||result.projectId!==config.projectId||result.sceneId!==scene.id||result.promptSha256!==promptSha256||!result.assetId):result.state!=='COMPLETED'))throw Error('FLOW_STOPPED: '+('errorCode' in result?result.errorCode:'generation chưa xác minh')+'; giữ receipt, không retry hoặc đổi provider.');
    const url=mode==='video'?result.videoUrl:result.firstImageUrl;if(!url)throw Error('FLOW_MEDIA_MISSING');
    let finalPath:string;
    if(mode==='image'){
      const prior=ledger.read().validatedArtifact;
      if(prior&&fs.existsSync(prior.localPath)){
        if(path.dirname(fs.realpathSync(prior.localPath))!==fs.realpathSync(path.dirname(outputPath))||crypto.createHash('sha256').update(fs.readFileSync(prior.localPath)).digest('hex')!==prior.sha256)throw Error('FLOW_ARTIFACT_RECOVERY_MISMATCH');
        await this.validateMediaFile(prior.localPath,'image',{fullDecode:true});signal?.throwIfAborted();finalPath=prior.localPath;
      }else{
        const context=adapter.getContext('flow');if(!context)throw Error('FLOW_DOWNLOAD_SESSION_MISSING');
        finalPath=(await saveFlowImage(context.request,url,outputPath,signal,async artifact=>ledger.validatedArtifact(artifact))).localPath;
      }
    }else{
    const target=outputPath.replace(/\.[^.]+$/,mode==='video'?'.mp4':'.png');
    if(fs.existsSync(target))throw Error('FLOW_OUTPUT_EXISTS');
    await this.downloadMediaAsset(url,target,{signal,browserContextOnly:true});
    const validPath=await this.validateMediaFile(target,mode,{fullDecode:true});finalPath=typeof validPath==='string'?validPath:target;
    }
    const sha256=crypto.createHash('sha256').update(fs.readFileSync(finalPath)).digest('hex');
    ledger.complete({localPath:finalPath,sha256,assetId:result.assetId,referenceSha256:referenceHash});
    const record=ledger.read();
    scene.mediaProvenance={source:'google_flow_ui',assetPath:finalPath,sha256,projectId:config.projectId,sessionId:path.basename(path.dirname(config.flowReceiptDir)),sceneId:scene.shotId||scene.id,requestKey:key,assetId:result.assetId,referenceSha256:referenceHash,automaticGeneration:true,quotedCredits:record.quotedCredits,actualCredits:null,hardCapVerified:false};
    if(mode==='image')scene.imagePath=finalPath;else scene.videoPath=finalPath;
    progress?.(100,'Media Flow đã tải và giải mã; credit thực tế chưa đối soát.');return finalPath;
    }catch(error){const record=ledger.read();if(record?.version===2&&!['COMPLETED','FAILED','NOT_SUBMITTED'].includes(record.state))ledger.transition('RECONCILIATION_REQUIRED',{promptSha256});throw error;}
  }

  public async downloadMediaAsset(
    urlOrData: string,
    destinationPath: string,
    options?: {
      timeoutMs?: number;
      signal?: AbortSignal;
      win?: any;
      partition?: string;
      cookie?: string;
      headers?: Record<string, string>;
      browserContextOnly?: boolean;
    }
  ): Promise<string> {
    fs.mkdirSync(path.dirname(destinationPath), { recursive: true });

    if (!urlOrData || typeof urlOrData !== 'string') {
      throw new Error('Dữ liệu hoặc URL tệp media không hợp lệ');
    }

    if (options?.signal?.aborted) {
      throw new GoogleFlowRpcError('Tác vụ tải tệp đã bị hủy bởi người dùng.', { code: 'CANCELLED', retryable: false });
    }

    let targetUrl = urlOrData.trim();
    if(options?.browserContextOnly){
      const u=new URL(targetUrl);if(u.protocol!=='https:'||u.username||u.password||!['googleusercontent.com','googleapis.com','gstatic.com','labs.google','flow.google.com','flow-content.google'].some(h=>u.hostname===h||u.hostname.endsWith('.'+h)))throw Error('FLOW_DOWNLOAD_URL_UNTRUSTED');
      const context=this.getBrowserAutomationAdapter().getContext('flow');if(!context)throw Error('FLOW_DOWNLOAD_SESSION_MISSING');
      const response=await context.request.get(targetUrl,{timeout:90000,maxRedirects:0});try{if(!response.ok())throw Error('FLOW_DOWNLOAD_FAILED');const bytes=await response.body();options.signal?.throwIfAborted();if(!bytes.length||bytes.length>128*1024*1024)throw Error('FLOW_DOWNLOAD_SIZE_INVALID');fs.writeFileSync(destinationPath,bytes,{flag:'wx'});return destinationPath;}finally{await response.dispose();}
    }

    // 0. Local filesystem path that exists (check before URL normalization)
    if (!targetUrl.startsWith('http://') && !targetUrl.startsWith('https://') && !targetUrl.startsWith('data:') && fs.existsSync(targetUrl)) {
      if (path.resolve(targetUrl) !== path.resolve(destinationPath)) {
        fs.copyFileSync(targetUrl, destinationPath);
      }
      return destinationPath;
    }

    // Chuẩn hoá URL không chứa scheme từ CDN (ví dụ //lh3.googleusercontent.com/...)
    if (targetUrl.startsWith('//')) {
      targetUrl = 'https:' + targetUrl;
    }

    // 1. Data URI (Base64)
    if (targetUrl.startsWith('data:')) {
      const commaIdx = targetUrl.indexOf(',');
      const cleanBase64 = commaIdx >= 0 ? targetUrl.slice(commaIdx + 1) : targetUrl;
      const buf = Buffer.from(cleanBase64, 'base64');
      if (buf.length === 0) {
        throw new Error('Dữ liệu Base64 rỗng, không thể lưu tệp media.');
      }
      fs.writeFileSync(destinationPath, buf);
      return destinationPath;
    }

    // 2. File URI (file://)
    if (targetUrl.startsWith('file://')) {
      let localPath = targetUrl.replace(/^file:\/\//, '');
      if (/^\/[a-zA-Z]:/.test(localPath)) {
        localPath = localPath.slice(1);
      }
      if (!fs.existsSync(localPath)) {
        throw new Error(`Tệp nguồn cục bộ không tồn tại: ${localPath}`);
      }
      if (path.resolve(localPath) !== path.resolve(destinationPath)) {
        fs.copyFileSync(localPath, destinationPath);
      }
      return destinationPath;
    }

    // Lấy cookie xác thực cho Google CDN nếu cần
    let cookieStr = options?.cookie || '';
    if (!cookieStr) {
      try {
        const rpcClient = this.getRpcClient();
        cookieStr = await rpcClient.getCookieString().catch(() => '');
      } catch {}
    }
    if (!cookieStr) {
      try {
        const sessionMgr = GoogleVeoSessionManager.getInstance();
        cookieStr = await sessionMgr.getEffectiveCookieString().catch(() => '');
      } catch {}
    }

    // 4. HTTP / HTTPS URL from CDN
    // Priority A0: BrowserAutomationAdapter Playwright context request (inherits Chrome 9224 cookies directly)
    try {
      const adapter = this.getBrowserAutomationAdapter();
      const flowCtx = adapter.getContext('flow');
      if (flowCtx && typeof (flowCtx as any).request?.get === 'function') {
        const resp = await (flowCtx as any).request.get(targetUrl);
        if (resp && resp.ok()) {
          const bodyBuf = await resp.body();
          if (bodyBuf && bodyBuf.length > 0) {
            fs.writeFileSync(destinationPath, bodyBuf);
            return destinationPath;
          }
        }
      }
    } catch {
      // Continue to next priority
    }

    // Priority A: BrowserWindow execution (if window has webContents and is active)
    // Only use for images, avoid for videos to prevent IPC payload limit and memory exhaustion
    const isVideoTarget = destinationPath.endsWith('.mp4') || destinationPath.endsWith('.webm');
    if (!isVideoTarget && options?.win && !options.win.isDestroyed() && options.win.webContents) {
      try {
        const base64Data = await options.win.webContents.executeJavaScript(`
          (async function() {
            const res = await fetch(${JSON.stringify(targetUrl)});
            if (!res.ok) throw new Error('HTTP ' + res.status);
            const blob = await res.blob();
            return new Promise((resolve, reject) => {
              const reader = new FileReader();
              reader.onloadend = () => resolve(reader.result);
              reader.onerror = reject;
              reader.readAsDataURL(blob);
            });
          })()
        `);
        if (base64Data && typeof base64Data === 'string') {
          const pure = base64Data.replace(/^data:[^;]+;base64,/, '');
          const buf = Buffer.from(pure, 'base64');
          if (buf.length > 0) {
            fs.writeFileSync(destinationPath, buf);
            return destinationPath;
          }
        }
      } catch {
        // Fallback to next download methods
      }
    }

    if (options?.signal?.aborted) {
      try { if (fs.existsSync(destinationPath)) fs.unlinkSync(destinationPath); } catch {}
      throw new GoogleFlowRpcError('Tác vụ tải tệp đã bị hủy bởi người dùng.', { code: 'CANCELLED', retryable: false });
    }

    // Priority B: Electron session net.fetch (inherits Google cookies from partition)
    try {
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const electron = require('electron');
      const ses = electron.session?.fromPartition?.(options?.partition || 'persist:google_veo');
      if (ses && typeof ses.fetch === 'function') {
        const fetchHeaders: Record<string, string> = { ...(options?.headers || {}) };
        if (cookieStr && !fetchHeaders['Cookie'] && !fetchHeaders['cookie']) {
          fetchHeaders['Cookie'] = cookieStr;
        }
        const res = await ses.fetch(targetUrl, { signal: options?.signal, headers: fetchHeaders });
        if (res.ok) {
          const arrBuf = await res.arrayBuffer();
          const buf = Buffer.from(arrBuf);
          if (buf.length > 0) {
            fs.writeFileSync(destinationPath, buf);
            return destinationPath;
          }
        } else if (res.status === 401 || res.status === 403) {
          throw new GoogleFlowRpcError(
            `Phiên đăng nhập hoặc quyền truy cập CDN đã hết hạn (HTTP ${res.status})`,
            { code: 'SESSION_EXPIRED', status: res.status }
          );
        } else if (res.status === 429) {
          throw new GoogleFlowRpcError(
            `Tải tệp từ CDN bị giới hạn tần suất (HTTP ${res.status})`,
            { code: 'RATE_LIMITED', status: 429, retryable: true }
          );
        }
      }
    } catch (err: any) {
      if (options?.signal?.aborted || err?.name === 'AbortError' || err?.code === 'ABORT_ERR' || err?.code === 20) {
        try { if (fs.existsSync(destinationPath)) fs.unlinkSync(destinationPath); } catch {}
        throw new GoogleFlowRpcError('Tác vụ tải tệp đã bị hủy bởi người dùng.', { code: 'CANCELLED', retryable: false });
      }
      if (err?.code === 'SESSION_EXPIRED' || err?.code === 'RATE_LIMITED') {
        throw err;
      }
      if (err?.code === 'ENOSPC' || err?.code === 'EACCES' || err?.code === 'EPERM') {
        throw err;
      }
    }

    if (options?.signal?.aborted) {
      try { if (fs.existsSync(destinationPath)) fs.unlinkSync(destinationPath); } catch {}
      throw new GoogleFlowRpcError('Tác vụ tải tệp đã bị hủy bởi người dùng.', { code: 'CANCELLED', retryable: false });
    }

    // Priority C: Global fetch
    try {
      if (typeof fetch === 'function') {
        const fetchHeaders: Record<string, string> = { ...(options?.headers || {}) };
        if (cookieStr && !fetchHeaders['Cookie'] && !fetchHeaders['cookie']) {
          fetchHeaders['Cookie'] = cookieStr;
        }
        const res = await fetch(targetUrl, { signal: options?.signal, headers: fetchHeaders });
        if (res.ok) {
          const arrBuf = await res.arrayBuffer();
          const buf = Buffer.from(arrBuf);
          if (buf.length > 0) {
            fs.writeFileSync(destinationPath, buf);
            return destinationPath;
          }
        } else if (res.status === 401 || res.status === 403) {
          throw new GoogleFlowRpcError(
            `Phiên đăng nhập hoặc quyền truy cập CDN đã hết hạn (HTTP ${res.status})`,
            { code: 'SESSION_EXPIRED', status: res.status }
          );
        } else if (res.status === 429) {
          throw new GoogleFlowRpcError(
            `Tải tệp từ CDN bị giới hạn tần suất (HTTP ${res.status})`,
            { code: 'RATE_LIMITED', status: 429, retryable: true }
          );
        }
      }
    } catch (err: any) {
      if (options?.signal?.aborted || err?.name === 'AbortError' || err?.code === 'ABORT_ERR' || err?.code === 20) {
        try { if (fs.existsSync(destinationPath)) fs.unlinkSync(destinationPath); } catch {}
        throw new GoogleFlowRpcError('Tác vụ tải tệp đã bị hủy bởi người dùng.', { code: 'CANCELLED', retryable: false });
      }
      if (err?.code === 'SESSION_EXPIRED' || err?.code === 'RATE_LIMITED') {
        throw err;
      }
      if (err?.code === 'ENOSPC' || err?.code === 'EACCES' || err?.code === 'EPERM') {
        throw err;
      }
    }

    if (options?.signal?.aborted) {
      try { if (fs.existsSync(destinationPath)) fs.unlinkSync(destinationPath); } catch {}
      throw new GoogleFlowRpcError('Tác vụ tải tệp đã bị hủy bởi người dùng.', { code: 'CANCELLED', retryable: false });
    }

    // Priority D: Node http / https streaming download
    const reqHeaders: Record<string, string> = { ...(options?.headers || {}) };
    if (cookieStr && !reqHeaders['Cookie'] && !reqHeaders['cookie']) {
      reqHeaders['Cookie'] = cookieStr;
    }
    await this.downloadViaHttp(
      targetUrl,
      destinationPath,
      options?.timeoutMs || 45000,
      5,
      options?.signal,
      reqHeaders
    );

    if (!fs.existsSync(destinationPath) || fs.statSync(destinationPath).size === 0) {
      try { if (fs.existsSync(destinationPath)) fs.unlinkSync(destinationPath); } catch {}
      throw new Error(`Tải tệp media thất bại hoặc tệp rỗng: ${destinationPath}`);
    }

    return destinationPath;
  }

  private async downloadViaHttp(
    url: string,
    dest: string,
    timeoutMs: number = 30000,
    maxRedirects: number = 5,
    signal?: AbortSignal,
    customHeaders?: Record<string, string>
  ): Promise<void> {
    if (signal?.aborted) {
      throw new GoogleFlowRpcError('Tác vụ tải tệp đã bị hủy bởi người dùng.', { code: 'CANCELLED', retryable: false });
    }
    if (maxRedirects <= 0) {
      throw new Error('Quá nhiều lần chuyển hướng khi tải file từ CDN.');
    }

    return new Promise<void>((resolve, reject) => {
      let isFinished = false;
      let activeFileStream: fs.WriteStream | null = null;
      let activeResStream: http.IncomingMessage | null = null;
      const getter = url.startsWith('https:') ? https : http;

      const reqHeaders: Record<string, string> = {
        'User-Agent':
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/133.0.0.0 Safari/537.36',
        Accept: '*/*',
        ...(customHeaders || {}),
      };

      const cleanup = () => {
        try {
          if (activeFileStream && !activeFileStream.destroyed) {
            activeFileStream.destroy();
          }
        } catch {}
        try {
          if (fs.existsSync(dest)) fs.unlinkSync(dest);
        } catch {}
      };

      const abortHandler = () => {
        if (isFinished) return;
        isFinished = true;
        try { req.destroy(); } catch {}
        try { activeResStream?.destroy(); } catch {}
        try { activeFileStream?.destroy(); } catch {}
        cleanup();
        reject(new GoogleFlowRpcError('Tác vụ tải tệp đã bị hủy bởi người dùng.', { code: 'CANCELLED', retryable: false }));
      };

      if (signal) {
        signal.addEventListener('abort', abortHandler, { once: true });
      }

      const finishAndCleanListener = () => {
        if (signal) {
          signal.removeEventListener('abort', abortHandler);
        }
      };

      const req = getter.get(
        url,
        { headers: reqHeaders },
        (res) => {
          activeResStream = res;

          if (res.statusCode && res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
            res.resume();
            finishAndCleanListener();
            const nextUrl = res.headers.location.startsWith('http')
              ? res.headers.location
              : new URL(res.headers.location, url).toString();
            this.downloadViaHttp(nextUrl, dest, timeoutMs, maxRedirects - 1, signal, customHeaders)
              .then(resolve)
              .catch(reject);
            return;
          }

          if (res.statusCode === 401 || res.statusCode === 403) {
            res.resume();
            finishAndCleanListener();
            cleanup();
            reject(
              new GoogleFlowRpcError(
                `Phiên đăng nhập hoặc quyền truy cập CDN đã hết hạn (HTTP ${res.statusCode})`,
                { code: 'SESSION_EXPIRED', status: res.statusCode }
              )
            );
            return;
          }

          if (res.statusCode === 429) {
            res.resume();
            finishAndCleanListener();
            cleanup();
            reject(
              new GoogleFlowRpcError(
                'Tải tệp từ CDN bị giới hạn tần suất (HTTP 429)',
                { code: 'RATE_LIMITED', status: 429, retryable: true }
              )
            );
            return;
          }

          // Chấp nhận HTTP 200 (OK) và HTTP 206 (Partial Content)
          if (res.statusCode !== 200 && res.statusCode !== 206) {
            res.resume();
            finishAndCleanListener();
            cleanup();
            reject(new Error(`Tải tệp từ CDN thất bại với mã HTTP ${res.statusCode}`));
            return;
          }

          let expectedBytes = -1;
          const cl = res.headers['content-length'];
          if (cl) {
            const parsed = parseInt(cl, 10);
            if (!isNaN(parsed) && parsed > 0) {
              expectedBytes = parsed;
            }
          }

          let downloadedBytes = 0;
          res.on('data', (chunk) => {
            downloadedBytes += chunk.length;
          });

          res.on('error', (err) => {
            if (isFinished) return;
            isFinished = true;
            finishAndCleanListener();
            try { file.destroy(); } catch {}
            cleanup();
            reject(new Error(`Lỗi luồng mạng tải CDN: ${err.message}`));
          });

          fs.mkdirSync(path.dirname(dest), { recursive: true });
          const file = fs.createWriteStream(dest);
          activeFileStream = file;
          res.pipe(file);

          file.on('finish', () => {
            if (isFinished) return;
            isFinished = true;
            finishAndCleanListener();
            file.close((closeErr) => {
              if (closeErr) {
                cleanup();
                reject(closeErr);
                return;
              }
              if (expectedBytes > 0 && downloadedBytes !== expectedBytes) {
                cleanup();
                reject(
                  new Error(
                    `Tải tệp không hoàn chỉnh: nhận được ${downloadedBytes}/${expectedBytes} bytes`
                  )
                );
                return;
              }
              if (downloadedBytes === 0) {
                cleanup();
                reject(new Error(`Tải tệp thất bại: dữ liệu nhận được 0 bytes: ${dest}`));
                return;
              }
              resolve();
            });
          });

          file.on('error', (err) => {
            if (isFinished) return;
            isFinished = true;
            finishAndCleanListener();
            try { file.destroy(); } catch {}
            cleanup();
            reject(err);
          });
        }
      );

      req.setTimeout(timeoutMs, () => {
        if (!isFinished) {
          isFinished = true;
          finishAndCleanListener();
          try { req.destroy(); } catch {}
          try { activeResStream?.destroy(); } catch {}
          try { activeFileStream?.destroy(); } catch {}
          cleanup();
          reject(new Error(`Tải tệp từ CDN quá hạn (${Math.round(timeoutMs / 1000)}s)`));
        }
      });

      req.on('error', (err) => {
        if (!isFinished) {
          isFinished = true;
          finishAndCleanListener();
          try { activeFileStream?.destroy(); } catch {}
          cleanup();
          reject(err);
        }
      });
    });
  }

  /**
   * Xác minh toàn diện tính hợp lệ và định dạng của tệp media tải về trong production pipeline.
   * Tích hợp normalizeAndValidateMediaFile() để bảo đảm:
   * - Đối với ảnh: Kiểm tra magic bytes thực tế, decode dimensions (không nuốt lỗi), đổi extension theo định dạng thực (.jpg/.png/.webp).
   * - Đối với video: Kiểm tra luồng video, codec, resolution, duration qua FFprobe.
   * - Hỗ trợ FFmpeg full decode khi flowConfig.fullMediaDecode = true.
   * - Quản lý timeout mặc định 30s cho FFmpeg, có thể tùy chỉnh qua flowConfig.mediaDecodeTimeoutMs.
   */
  public async validateMediaFile(
    filePath: string,
    type: 'image' | 'video',
    options?: NormalizeMediaOptions
  ): Promise<string> {
    const norm = await normalizeAndValidateMediaFile(filePath, type, options);
    return norm.finalPath;
  }

  // ==========================================================================
  // High-Resolution Procedural Synthetic Card Generator
  // ==========================================================================
  public async generateSyntheticSceneCard(
    scene: StoryboardScene,
    outputPath: string,
    aspectRatio: FlowAspectRatio = '16:9',
    resolution: RenderingResolution = '720p'
  ): Promise<string> {
    fs.mkdirSync(path.dirname(outputPath), { recursive: true });

    const { width, height } = this.resolveDimensions(aspectRatio, resolution);
    const palette = ['navy', 'darkslategray', 'midnightblue', 'darkslateblue'];
    const color = palette[Math.abs(scene.lineIndex) % palette.length];

    await new Promise<void>((resolve, reject) => {
      ffmpeg()
        .input(`color=c=${color}:s=${width}x${height}:d=1`)
        .inputFormat('lavfi')
        .outputOptions('-vframes 1')
        .output(outputPath)
        .on('end', () => resolve())
        .on('error', (err, _stdout, stderr) => {
          reject(new Error(`FFmpeg synthetic image generation failed: ${err.message} (${stderr})`));
        })
        .run();
    });

    if (!fs.existsSync(outputPath) || fs.statSync(outputPath).size < 100) {
      throw new Error(`Synthetic image file generation failed at: ${outputPath}`);
    }

    // Verify PNG magic bytes [0x89, 0x50, 0x4E, 0x47]
    const headerBuf = Buffer.alloc(4);
    const fd = fs.openSync(outputPath, 'r');
    try {
      fs.readSync(fd, headerBuf, 0, 4, 0);
    } finally {
      fs.closeSync(fd);
    }

    if (
      headerBuf[0] !== 0x89 ||
      headerBuf[1] !== 0x50 ||
      headerBuf[2] !== 0x4e ||
      headerBuf[3] !== 0x47
    ) {
      throw new Error(`Generated asset is not a valid PNG image: ${outputPath}`);
    }

    return outputPath;
  }

  // ==========================================================================
  // Granular Step: Single-Scene Regeneration (F28)
  // ==========================================================================
  public async regenerateSceneAsset(
    payload: RegenerateSceneAssetPayload,
    assetsDir?: string,
    onProgress?: (pct: number, msg: string) => void,
    signal?: AbortSignal
  ): Promise<RegenerateSceneAssetResult> {
    const targetDir = assetsDir || path.join(os.tmpdir(), 'vanhsub-single-scenes');
    fs.mkdirSync(targetDir, { recursive: true });

    const isVideo = payload.mode ? payload.mode !== 'image' : payload.flowConfig?.outputMode === 'video';
    const ext = isVideo ? 'mp4' : 'png';
    const outPath = path.join(targetDir, `scene_${payload.sceneId.replace(/[^a-zA-Z0-9_-]/g, '_')}_${crypto.randomUUID()}.${ext}`);

    const mockScene: StoryboardScene = {
      id: payload.sceneId,
      lineIndex: 0,
      startMs: 0,
      endMs: 4000,
      durationMs: 4000,
      lineText: (payload as any).lineText || '',
      visualPrompt: payload.visualPrompt,
      referenceImagePath: payload.referenceImagePath || payload.flowConfig?.referenceImagePath,
      imagePath: (payload as any).imagePath,
      motionType: isVideo ? 'video' : 'ken_burns',
      status: 'pending',
    };
    if ((payload as any).inputImageAsset) {
      (mockScene as any).inputImageAsset = (payload as any).inputImageAsset;
    }
    if ((payload as any).motionPrompt || (payload as any).cameraMovement) {
      (mockScene as any).motionPrompt = (payload as any).motionPrompt || (payload as any).cameraMovement;
    }

    const flowConfig: AiStudioFlowEngineConfig = {
      aspectRatio: payload.flowConfig?.aspectRatio || '16:9',
      outputMode: isVideo ? 'video' : 'image',
      engine: payload.flowConfig?.engine,
      stylePromptPrefix: payload.flowConfig?.stylePromptPrefix || '',
      negativePrompt: payload.flowConfig?.negativePrompt || '',
      outputsPerScene: 1,
      downloadDir: targetDir,
      concurrency: 1,
      allowSyntheticFallback: payload.flowConfig?.allowSyntheticFallback,
      backoffBaseMs: payload.flowConfig?.backoffBaseMs,
      maxRetries: payload.flowConfig?.maxRetries,
      projectId: payload.flowConfig?.projectId,
      referenceImagePath: payload.referenceImagePath || payload.flowConfig?.referenceImagePath,
      generationNonce: crypto.randomUUID(),
      skipCooldown: payload.flowConfig?.skipCooldown,
      cooldownSec: payload.flowConfig?.cooldownSec,
      fallbackToSynthetic: (payload.flowConfig as any)?.fallbackToSynthetic,
      explicitFallback: (payload.flowConfig as any)?.explicitFallback,
    };

    const isLegacyDom = payload.flowConfig?.engine === 'dom' || payload.flowConfig?.engine === 'legacy_dom';
    const bridge = FlowBridgeServer.getInstance();
    const isBridgeConnected = bridge.isConnected();
    const isPlaywrightConnected = BrowserAutomationAdapter.getInstance().isConnected('flow');
    let useGoogleFlow = Boolean(this.rpcClient || (!isLegacyDom && payload.flowConfig?.engine !== 'synthetic'));
    if (!this.rpcClient && useGoogleFlow && !isBridgeConnected && !isPlaywrightConnected) {
      try {
        const sessionMgr = GoogleVeoSessionManager.getInstance();
        const status = await Promise.race([
          sessionMgr.validateSession(),
          new Promise<any>((_, reject) =>
            setTimeout(() => reject(new Error('Preflight session check timeout')), 8000)
          ),
        ]);
        if (!status || !status.valid) {
          const hasExplicitFallback = Boolean(
            flowConfig.allowSyntheticFallback === true ||
            (payload.flowConfig as any)?.fallbackToSynthetic === true ||
            (payload.flowConfig as any)?.explicitFallback === true
          );
          if (!hasExplicitFallback) {
            throw new GoogleFlowRpcError(
              `Chưa đăng nhập Google Flow hoặc phiên làm việc đã hết hạn (${status?.detail || 'Chưa xác thực'}). Vui lòng mở Sảnh Google Flow trên giao diện để đăng nhập tài khoản hoặc kết nối Chrome Extension.`,
              { code: 'SESSION_EXPIRED', retryable: false, suggestedAction: 'REAUTH_REQUIRED' }
            );
          } else {
            console.warn('[AiStudioVisualService] Phiên Google Flow chưa xác thực, chuyển sang fallback bản mẫu thiết kế.');
            useGoogleFlow = false;
          }
        }
      } catch (e: any) {
        if (e instanceof GoogleFlowRpcError) throw e;
        console.warn('[AiStudioVisualService] Lỗi khi kiểm tra validateSession:', e);
      }
    }

    let lobbyWin: any = null;
    if (!isBridgeConnected && !isPlaywrightConnected) {
      try {
        const sessionMgr = GoogleVeoSessionManager.getInstance();
        lobbyWin = sessionMgr.getLobbyWindow();
        if (!lobbyWin || lobbyWin.isDestroyed()) {
          await Promise.race([
            sessionMgr.openLobbyWindow({ uiMode: 'offscreen' }),
            new Promise<void>((_, reject) =>
              setTimeout(() => reject(new Error('Preflight openLobbyWindow timeout')), 8000)
            ),
          ]);
          lobbyWin = sessionMgr.getLobbyWindow();
        }
      } catch {
        lobbyWin = null;
      }
    }

    let lastErr: any = null;
    if (useGoogleFlow) {
      const maxRetries = 0;

      for (let retry = 0; retry <= maxRetries; retry++) {
        if (signal?.aborted) {
          throw new GoogleFlowRpcError('Tác vụ đã bị người dùng huỷ bỏ.', { code: 'CANCELLED', retryable: false });
        }

        try {
          const finalPath = await this.generateViaGoogleFlow(mockScene, outPath, flowConfig, onProgress, signal);
          return {
            assetPath: finalPath,
            videoPath: isVideo ? finalPath : undefined,
            imagePath: !isVideo ? finalPath : (mockScene.imagePath || undefined),
            ...((mockScene as any).inputImageAsset ? { inputImageAsset: (mockScene as any).inputImageAsset } : {}),
          } as RegenerateSceneAssetResult;
        } catch (err: any) {
          if (signal?.aborted) {
            throw new GoogleFlowRpcError('Tác vụ đã bị người dùng huỷ bỏ.', { code: 'CANCELLED', retryable: false });
          }
          const classified = classifyFlowRpcError(err);
          lastErr = classified;
          if (classified.code === 'CANCELLED') {
            throw classified;
          }
          const errorCode = classified.code;
          const isUnusual = isUnusualActivityError(classified) || errorCode === 'PUBLIC_ERROR_UNUSUAL_ACTIVITY' || errorCode === 'UNUSUAL_ACTIVITY';
          const isTransient =
            !isUnusual &&
            (classified.retryable ||
              errorCode === 'RATE_LIMITED' ||
              errorCode === 'UPSTREAM_ERROR' ||
              errorCode === 'TIMEOUT');

          if (isUnusual) {
            console.warn(
              `[AiStudioVisualService] regenerateSceneAsset phát hiện PUBLIC_ERROR_UNUSUAL_ACTIVITY. ` +
              `Dừng retry tự động (ABORT_HALT) để bảo vệ tài khoản người dùng.`
            );
            throw classified;
          }

          if (isTransient && retry < maxRetries) {

            const baseMs = typeof flowConfig.backoffBaseMs === 'number'
              ? flowConfig.backoffBaseMs
              : typeof payload.flowConfig?.backoffBaseMs === 'number'
              ? payload.flowConfig.backoffBaseMs
              : 10000;
            const backoffMs = calculateExponentialBackoffMs(retry, baseMs, 120000);
            const waitMs = baseMs === 0 ? 0 : (classified.retryAfterMs ? Math.max(classified.retryAfterMs, backoffMs) : backoffMs);
            const waitSec = Math.round(waitMs / 1000);

            console.warn(
              `[AiStudioVisualService] regenerateSceneAsset RPC gặp lỗi [${classified.code}]. ` +
              `Lũy tiến lùi bước (lần ${retry + 1}/${maxRetries}): chờ ${waitSec}s...`
            );

            if (waitMs < 1000) {
              onProgress?.(
                10,
                `Gặp phản hồi ${classified.code}. Đang giãn cách lùi bước: Đang thử lại (lần ${retry + 1})...`
              );
              await sleepAbortable(waitMs, signal);
            } else {
              const waitSec = Math.round(waitMs / 1000);
              for (let s = waitSec; s > 0; s--) {
                if (signal?.aborted) {
                  throw new GoogleFlowRpcError('Tác vụ đã bị người dùng huỷ bỏ.', { code: 'CANCELLED', retryable: false });
                }
                onProgress?.(
                  10,
                  `Gặp phản hồi ${classified.code}. Đang giãn cách lùi bước: Còn ${s} giây trước khi thử lại...`
                );
                await sleepAbortable(1000, signal);
              }
            }
            continue;
          }

          console.warn(`[AiStudioVisualService] regenerateSceneAsset RPC thất bại [Mã lỗi: ${classified.code}]:`, classified.message);

          const hasExplicitFallback = Boolean(
            flowConfig.allowSyntheticFallback === true ||
            (flowConfig as any).fallbackToSynthetic === true ||
            (flowConfig as any).explicitFallback === true
          );

          const isRpcEngine = Boolean(
            this.rpcClient ||
            !isLegacyDom ||
            payload.flowConfig?.engine === 'rpc' ||
            payload.flowConfig?.engine === 'flow_rpc' ||
            (payload.flowConfig as any)?.useRpc === true
          );

          const isTerminal =
            classified.code === 'SESSION_EXPIRED' ||
            classified.code === 'RATE_LIMITED' ||
            classified.code === 'PUBLIC_ERROR_UNUSUAL_ACTIVITY' ||
            classified.code === 'UNUSUAL_ACTIVITY' ||
            classified.code === 'CONTENT_POLICY_VIOLATION' ||
            classified.code === 'CONTENT_REJECTED';

          // Bãi bỏ hoàn toàn synthetic card fallback, ném thẳng lỗi để ActionableErrorBanner xử lý
          throw lastErr || classified;
        }
      }
    }

    if (mockScene.imagePath && fs.existsSync(mockScene.imagePath)) {
      return { assetPath: mockScene.imagePath, imagePath: mockScene.imagePath };
    }

    throw (
      lastErr ||
      new GoogleFlowRpcError('Không thể tạo lại media và không có ảnh keyframe thực tế.', {
        code: 'UPSTREAM_ERROR',
        retryable: true,
      })
    );
  }
}

export const aiStudioVisualService = AiStudioVisualService.getInstance();
