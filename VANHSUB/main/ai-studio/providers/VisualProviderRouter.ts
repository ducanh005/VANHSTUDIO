/**
 * VisualProviderRouter.ts
 *
 * Unified Multi-Provider Visual Router for AI Image & Video Generation.
 * Manages provider hierarchy, official API fallback, idempotency, and graceful degradation:
 * 1. Primary: Google Flow (Pure RPC or Browser Automation via Chrome Extension Bridge / Playwright)
 * 2. Secondary: Official Gemini / Veo API (when configured with API Key)
 * 3. Fallback: Ken Burns Dynamic Motion (for video when keyframe image exists)
 */

import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import type { JobState } from '../../browser-automation/types';
import { OfficialGeminiVisualProvider } from './OfficialGeminiVisualProvider';

export type VisualProviderType =
  | 'google_flow_rpc'
  | 'official_gemini_api'
  | 'browser_automation'
  | 'ken_burns_fallback';

export interface VisualGenerationRequest {
  idempotencyKey: string;
  mediaType: 'image' | 'video';
  prompt: string;
  motionPrompt?: string;
  aspectRatio: string;
  durationSeconds?: number;
  model?: string;
  task?: 't2i' | 't2v' | 'i2v';
  resolution?: string;
  expectedDurationSec?: number;
  allowTimelineTrim?: boolean;
  sessionId?: string;
  referenceHash?: string;
  receiptDir?: string;
  requestLimit?: number;
  referenceImage?: string;
  projectId?: string;
  sceneId?: string;
  jobId?: string;
  targetPath?: string;
  apiKey?: string;
  signal?: AbortSignal;
  onProgress?: (pct: number, msg: string) => void;
}

export interface VisualGenerationResult {
  provider: VisualProviderType;
  mediaType: 'image' | 'video';
  localPath: string;
  operationId?: string;
  assetUrl?: string;
  state: JobState;
  model?: string;
  sha256?: string;
  referenceHash?: string;
  mediaInfo?: { width: number; height: number; durationSec?: number; fps?: number };
}

export interface JobRecord {
  jobId: string;
  idempotencyKey: string;
  state: JobState;
  createdAt: number;
  updatedAt: number;
  provider?: VisualProviderType;
  mediaType: 'image' | 'video';
  localPath?: string;
  error?: string;
  retryCount: number;
}

export interface IdempotencyKeyParams {
  workspaceScope?: string;
  generationNonce?: string;
  projectId?: string;
  sceneId?: string;
  sceneIndex?: number;
  prompt: string;
  motionPrompt?: string;
  negativePrompt?: string;
  mediaType: 'image' | 'video';
  aspectRatio?: string;
  resolution?: string;
  model?: string;
  seed?: number;
  inputAsset?: string;
  referenceImage?: string;
  stylePrefix?: string;
}

export class VisualProviderRouter {
  private static instance: VisualProviderRouter | null = null;
  private jobRegistry: Map<string, JobRecord> = new Map();
  private inFlightPromises: Map<string, Promise<VisualGenerationResult>> = new Map();

  public static getInstance(): VisualProviderRouter {
    if (!VisualProviderRouter.instance) {
      VisualProviderRouter.instance = new VisualProviderRouter();
    }
    return VisualProviderRouter.instance;
  }

  /**
   * Tạo idempotency key xác định duy nhất từ prompt và toàn bộ tham số
   * (model, seed, input keyframe, motion prompt, resolution, aspectRatio) để tránh gửi trùng lặp.
   */
  public generateIdempotencyKey(params: IdempotencyKeyParams): string {
    const parts = [
      params.workspaceScope || 'legacy_scope',
      params.generationNonce || 'resume',
      params.projectId || 'default',
      params.sceneId || (params.sceneIndex !== undefined ? `scene_${params.sceneIndex}` : 'scene_0'),
      params.mediaType,
      params.aspectRatio || '16:9',
      params.resolution || 'default',
      params.model || 'default',
      params.seed !== undefined && params.seed !== null ? `seed_${params.seed}` : 'seed_none',
      params.inputAsset ? `in_${params.inputAsset}` : (params.referenceImage ? `ref_${path.basename(params.referenceImage)}` : 'in_none'),
      (params.stylePrefix || '').trim(),
      (params.negativePrompt || '').trim(),
      (params.motionPrompt || '').trim(),
      params.prompt.trim(),
    ];
    const raw = parts.join('|');
    return crypto.createHash('sha256').update(raw).digest('hex').slice(0, 32);
  }

  /**
   * Lấy bản ghi trạng thái của job theo idempotencyKey.
   */
  public getJob(idempotencyKey: string): JobRecord | undefined {
    return this.jobRegistry.get(idempotencyKey);
  }

  /**
   * Đăng ký hoặc chuyển trạng thái của một job.
   */
  public updateJobState(
    idempotencyKey: string,
    state: JobState,
    meta?: Partial<JobRecord>
  ): JobRecord {
    const now = Date.now();
    let record = this.jobRegistry.get(idempotencyKey);
    if (!record) {
      record = {
        jobId: crypto.randomUUID(),
        idempotencyKey,
        state,
        createdAt: now,
        updatedAt: now,
        mediaType: meta?.mediaType || 'image',
        retryCount: 0,
        ...meta,
      };
    } else {
      record.state = state;
      record.updatedAt = now;
      if (meta) {
        Object.assign(record, meta);
      }
    }
    this.jobRegistry.set(idempotencyKey, record);
    return record;
  }

  /**
   * Kiểm tra xem job có đang trong tiến trình (SUBMITTING / SUBMITTED / PROCESSING) hay không.
   * Ngăn chặn gửi trùng lặp request (Idempotency Enforcement).
   */
  public isJobActive(idempotencyKey: string): boolean {
    const record = this.jobRegistry.get(idempotencyKey);
    if (!record) return false;
    return (
      record.state === 'SUBMITTING' ||
      record.state === 'SUBMITTED' ||
      record.state === 'PROCESSING'
    );
  }

  /**
   * Xoá bộ nhớ đệm job (dành cho kiểm thử hoặc reset thủ công).
   */
  public clearRegistry(): void {
    this.jobRegistry.clear();
    this.inFlightPromises.clear();
  }

  /**
   * Kiểm tra xem Official Gemini / Veo API có khả dụng với API Key được cung cấp không.
   */
  public isOfficialApiConfigured(apiKey?: string): boolean {
    const key = apiKey || process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY;
    return typeof key === 'string' && key.trim().length > 10;
  }

  /** Paid API is explicit opt-in, never an automatic fallback from a blocked Flow job. */
  public generateOfficial(req: VisualGenerationRequest): Promise<VisualGenerationResult> {
    const active = this.inFlightPromises.get(req.idempotencyKey);
    if (active) return active;
    // Revalidate durable receipt and content hash, even after an earlier in-memory completion.
    const pending = new OfficialGeminiVisualProvider().generate(req).finally(() => this.inFlightPromises.delete(req.idempotencyKey));
    this.inFlightPromises.set(req.idempotencyKey, pending);
    return pending;
  }

  /**
   * Thực thi yêu cầu sinh hình ảnh/video qua router với bảo vệ idempotency.
   */
  public async executeWithIdempotency(
    req: VisualGenerationRequest,
    executor: (req: VisualGenerationRequest) => Promise<VisualGenerationResult>
  ): Promise<VisualGenerationResult> {
    const key = req.idempotencyKey;

    // Nếu đã hoàn tất trước đó và file vẫn tồn tại trên đĩa, trả về ngay kết quả COMPLETED
    const existing = this.jobRegistry.get(key);
    if (existing && existing.state === 'COMPLETED' && existing.localPath && fs.existsSync(existing.localPath)) {
      return {
        provider: existing.provider || 'google_flow_rpc',
        mediaType: existing.mediaType,
        localPath: existing.localPath,
        state: 'COMPLETED',
      };
    }

    // Nếu đang có tiến trình chạy song song cho cùng idempotencyKey, chia sẻ Promise thay vì gửi request kép
    const inFlight = this.inFlightPromises.get(key);
    if (inFlight) {
      return inFlight;
    }

    this.updateJobState(key, 'SUBMITTING', { mediaType: req.mediaType });

    const promise = (async () => {
      try {
        if (req.signal?.aborted) {
          this.updateJobState(key, 'FAILED', { error: 'CANCELLED' });
          throw new Error('CANCELLED');
        }

        this.updateJobState(key, 'SUBMITTED');
        this.updateJobState(key, 'PROCESSING');

        const result = await executor(req);

        // Xác thực nghiêm ngặt: Chỉ đánh dấu COMPLETED khi tệp thực sự tồn tại trên ổ đĩa và > 0 byte
        const isValidFile =
          result.localPath &&
          fs.existsSync(result.localPath) &&
          fs.statSync(result.localPath).size > 0;

        if (isValidFile) {
          this.updateJobState(key, result.state || 'COMPLETED', {
            provider: result.provider,
            localPath: result.localPath,
          });
        } else {
          this.updateJobState(key, 'FAILED', {
            provider: result.provider,
            error: 'OUTPUT_FILE_MISSING_OR_EMPTY: Tệp đầu ra chưa được lưu hoặc rỗng',
          });
          result.state = 'FAILED';
        }

        return result;
      } catch (err: any) {
        const errMsg = err?.message || String(err);
        const isBlocked =
          errMsg.includes('PUBLIC_ERROR_UNUSUAL_ACTIVITY') ||
          errMsg.includes('BLOCKED_REQUIRES_USER') ||
          (err as any)?.code === 'PUBLIC_ERROR_UNUSUAL_ACTIVITY';

        const finalState: JobState = isBlocked
          ? 'BLOCKED_REQUIRES_USER'
          : errMsg.includes('CANCELLED')
          ? 'FAILED'
          : errMsg.includes('TIMEOUT')
          ? 'TIMED_OUT'
          : 'FAILED';

        this.updateJobState(key, finalState, { error: errMsg });
        throw err;
      } finally {
        this.inFlightPromises.delete(key);
      }
    })();

    this.inFlightPromises.set(key, promise);
    return promise;
  }
}
