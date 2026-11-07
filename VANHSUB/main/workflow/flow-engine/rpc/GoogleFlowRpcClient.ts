/**
 * GoogleFlowRpcClient.ts
 *
 * Module lõi giao tiếp Web RPC nội bộ với Google Flow trong ngữ cảnh Electron Session.
 * Thực hiện upload asset, gửi yêu cầu sinh ảnh (Imagen/Nano), sinh video (Veo),
 * và polling trạng thái generation thông qua Web RPC nội bộ thay thế hoàn toàn việc click DOM giả lập.
 *
 * Tính năng chính:
 * 1. Tự động kế thừa phiên đăng nhập Google hiện hữu, cookies và CSRF token (at) từ session partition.
 * 2. Upload asset cục bộ lên dịch vụ lưu trữ của Flow qua maseQ RPC và trả về asset_id / media_id hợp lệ.
 * 3. Sinh ảnh (generate_image - ogiZ0b) với prompt, aspect ratio, seed, reference assets.
 * 4. Sinh video (generate_video - MZZa6b / YhhmEf) với prompt, aspect ratio, duration, input image asset và tùy chọn audio.
 * 5. Async Polling State Machine theo dõi vòng đời: queued -> processing -> completed / failed.
 * 6. Structured Error Handling bóc tách rõ ràng:
 *    - SESSION_EXPIRED (retryable: false)
 *    - RATE_LIMITED (retryable: true, kèm retryAfterMs)
 *    - CONTENT_REJECTED / CONTENT_POLICY_VIOLATION (retryable: false)
 *    - TIMEOUT (retryable: true)
 *    - UPSTREAM_ERROR (retryable: true)
 */

import fs from 'fs';
import path from 'path';
import { v4 as uuidv4 } from 'uuid';

import {
  FLOW_HOST,
  RECAPTCHA_SITE_KEY,
  CAPTCHA_ACTION_IMAGE,
  CAPTCHA_ACTION_VIDEO,
  WIZ_DATA_AT_TOKEN_KEY,
  RPC_GEN_IMAGE,
  RPC_GEN_VIDEO_REFERENCES,
  RPC_GEN_VIDEO_TEXT,
  RPC_OPERATION,
  RPC_MEDIA,
  RPC_PROJECT_MEDIA,
  RPC_UPLOAD_IMAGE,
  OPERATION_POLL_INTERVAL_MS,
  OPERATION_POLL_TIMEOUT_MS,
  IMAGE_GEN_TIMEOUT_MS,
  VIDEO_GEN_TIMEOUT_MS,
  PREFLIGHT_CHECK_TIMEOUT_MS,
  RPC_REQUEST_TIMEOUT_MS,
  RPC_TRANSIENT_RETRY_DELAY_MS,
  IMAGE_TRANSIENT_MAX_RETRIES,
  CAPTCHA_SLOT,
  PROJECT_ID_SLOT,
} from './FlowBatchConstants';

import {
  buildEnvelope,
  parseBatchResponse,
  buildUploadPayload,
  buildGenImagePayload,
  buildGenVideoPayload,
  buildGenVideoTextPayload,
  buildPollOperationPayload,
  buildMediaUrlPayload,
  buildListProjectMediaPayload,
  extractGeneratedImages,
  extractOperationStatus,
  extractPollStatus,
  type GenImagePayloadOptions,
  type GenVideoPayloadOptions,
  type GenVideoTextPayloadOptions,
  type GeneratedImage,
  type OperationStatus,
  type MediaUrls,
} from './FlowBatchBuilder';

import { FlowBridgeServer } from './FlowBridgeServer';
import { GoogleFlowBrowserMutex } from '../../dispatcher/GoogleFlowBrowserMutex';

// ══════════════════════════════════════════════════════════════════════════════
// 1. Structured Error Handling & Types
// ══════════════════════════════════════════════════════════════════════════════

export type FlowRpcErrorCode =
  | 'SESSION_EXPIRED'
  | 'RATE_LIMITED'
  | 'PUBLIC_ERROR_UNUSUAL_ACTIVITY'
  | 'UNUSUAL_ACTIVITY'
  | 'BOT_FLAGGED'
  | 'CAPTCHA_SCORE_LOW'
  | 'CONTENT_REJECTED'
  | 'CONTENT_POLICY_VIOLATION'
  | 'TIMEOUT'
  | 'UPSTREAM_ERROR'
  | 'OUT_OF_CREDITS'
  | 'INVALID_ARGUMENT'
  | 'CANCELLED'
  | 'NETWORK_ERROR'
  | 'BRIDGE_DISCONNECTED'
  | 'UNKNOWN';

export interface GoogleFlowRpcErrorOptions {
  code: FlowRpcErrorCode;
  retryable?: boolean;
  retryAfterMs?: number;
  httpStatus?: number;
  status?: number; // Alias cho httpStatus
  suggestedAction?: 'REAUTH_REQUIRED' | 'RETRY_WITH_BACKOFF' | 'ABORT_HALT' | 'WAIT_AND_RETRY';
  details?: unknown;
  cause?: unknown;
}

export class GoogleFlowRpcError extends Error {
  public readonly code: FlowRpcErrorCode;
  public readonly retryable: boolean;
  public readonly retryAfterMs?: number;
  public readonly httpStatus?: number;
  public readonly suggestedAction?: string;
  public readonly details?: unknown;

  constructor(message: string, options: GoogleFlowRpcErrorOptions) {
    super(message);
    this.name = 'GoogleFlowRpcError';
    this.code = options.code;
    this.retryable = options.retryable ?? false;
    this.retryAfterMs = options.retryAfterMs;
    this.httpStatus = options.httpStatus ?? options.status;
    this.suggestedAction = options.suggestedAction;
    this.details = options.details;
    if (options.cause) {
      this.cause = options.cause;
    }
    Object.setPrototypeOf(this, GoogleFlowRpcError.prototype);
  }

  public get isContentPolicyViolation(): boolean {
    return this.code === 'CONTENT_POLICY_VIOLATION' || this.code === 'CONTENT_REJECTED';
  }

  public get isUnusualActivity(): boolean {
    const msg = (this.message || '').toLowerCase();
    return (
      this.code === 'PUBLIC_ERROR_UNUSUAL_ACTIVITY' ||
      this.code === 'UNUSUAL_ACTIVITY' ||
      this.code === 'BOT_FLAGGED' ||
      this.code === 'CAPTCHA_SCORE_LOW' ||
      Boolean((this.details as any)?.isUnusualActivity) ||
      msg.includes('public_error_unusual_activity') ||
      msg.includes('unusual_activity') ||
      msg.includes('unusual activity') ||
      msg.includes('bot_flagged') ||
      msg.includes('captcha_score_low')
    );
  }
}

/**
 * Tính toán thời gian lùi bước luỹ tiến (Exponential Backoff):
 * Formula: 2^(retry) * 10s (cap ở 120s)
 * @param retryCount Lần retry (0-indexed: 0 -> 10s, 1 -> 20s, 2 -> 40s, 3 -> 80s, 4 -> 120s)
 * @param baseMs Thời gian cơ sở (mặc định 10,000ms = 10s)
 * @param maxMs Thời gian trần tối đa (mặc định 120,000ms = 120s)
 */
export function calculateExponentialBackoffMs(
  retryCount: number,
  baseMs = 10_000,
  maxMs = 120_000
): number {
  const safeRetry = typeof retryCount === 'number' && Number.isFinite(retryCount) ? Math.max(0, Math.floor(retryCount)) : 0;
  const safeBase = typeof baseMs === 'number' && Number.isFinite(baseMs) && baseMs >= 0 ? baseMs : 10_000;
  const safeMax = typeof maxMs === 'number' && Number.isFinite(maxMs) && maxMs >= 0 ? maxMs : 120_000;
  const exp = Math.pow(2, safeRetry);
  const delay = exp * safeBase;
  return Math.min(safeMax, Math.round(delay));
}

/**
 * Ngủ có hỗ trợ ngắt tức thì qua AbortSignal và ném CANCELLED.
 */
export async function sleepWithSignal(ms: number, signal?: AbortSignal): Promise<void> {
  if (signal?.aborted) {
    throw new GoogleFlowRpcError('Tác vụ đã bị người dùng huỷ bỏ.', { code: 'CANCELLED', retryable: false });
  }
  return new Promise((resolve, reject) => {
    let timer: NodeJS.Timeout | null = null;
    const onAbort = () => {
      if (timer) clearTimeout(timer);
      reject(new GoogleFlowRpcError('Tác vụ đã bị người dùng huỷ bỏ.', { code: 'CANCELLED', retryable: false }));
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

/**
 * Kiểm tra xem một lỗi có phải là do phát hiện hành vi tự động / reCAPTCHA bot flag hay không.
 */
export function isUnusualActivityError(err: unknown): boolean {
  if (!err) return false;
  if (err instanceof GoogleFlowRpcError) {
    return err.isUnusualActivity;
  }
  const msg = String((err as any)?.message || (err as any)?.code || err || '').toLowerCase();
  return (
    msg.includes('public_error_unusual_activity') ||
    msg.includes('unusual_activity') ||
    msg.includes('unusual activity') ||
    msg.includes('bot_flagged') ||
    msg.includes('captcha_score_low')
  );
}

/**
 * Phân loại lỗi RPC chi tiết thành GoogleFlowRpcError có cấu trúc.
 */
export function classifyFlowRpcError(
  err: unknown,
  context?: { url?: string; httpStatus?: number; rawResponse?: string }
): GoogleFlowRpcError {
  if (err instanceof GoogleFlowRpcError) {
    return err;
  }

  const rawMsg = (err instanceof Error ? err.message : typeof err === 'string' ? err : JSON.stringify(err)) || '';
  const lowerMsg = rawMsg.toLowerCase();
  const httpStatus = context?.httpStatus;

  // 1. Hết hạn phiên / Chưa đăng nhập / Cửa sổ bị đóng / Không có quyền
  if (
    httpStatus === 401 ||
    httpStatus === 403 ||
    lowerMsg.includes('session expired') ||
    lowerMsg.includes('hết hạn phiên') ||
    lowerMsg.includes('flow.google.com/about') ||
    lowerMsg.includes('accounts.google.com') ||
    lowerMsg.includes('servicelogin') ||
    lowerMsg.includes('cookie string rỗng') ||
    lowerMsg.includes('chưa đăng nhập') ||
    lowerMsg.includes('chưa có phiên') ||
    lowerMsg.includes('verify p1 failed') ||
    lowerMsg.includes('không tìm thấy at token') ||
    lowerMsg.includes('no_at_token') ||
    lowerMsg.includes('no_flow_tab') ||
    lowerMsg.includes('tab_not_in_project') ||
    lowerMsg.includes('unauthorized') ||
    lowerMsg.includes('forbidden') ||
    lowerMsg.includes('xsrf') ||
    lowerMsg.includes('csrf') ||
    lowerMsg.includes('reauth_required') ||
    lowerMsg.includes('object has been destroyed') ||
    lowerMsg.includes('webcontents was destroyed') ||
    lowerMsg.includes('render frame was disposed')
  ) {
    const isNoTab = lowerMsg.includes('no_flow_tab');
    const isNotInProject = lowerMsg.includes('tab_not_in_project');
    const customMsg = isNotInProject
      ? 'Tab Google Chrome hiện chưa ở trong trang dự án (https://flow.google.com/). Vui lòng đăng nhập và mở một Dự án (Project) hoặc bấm "+ New project" trên Google Chrome!'
      : isNoTab
      ? 'Không tìm thấy tab Google Flow đang mở trên Google Chrome. Vui lòng mở trang https://flow.google.com/ trên Chrome.'
      : 'Phiên đăng nhập Google Flow đã hết hạn hoặc chưa đăng nhập. Vui lòng đăng nhập lại.';
    return new GoogleFlowRpcError(
      customMsg,
      {
        code: 'SESSION_EXPIRED',
        retryable: false,
        httpStatus: httpStatus || 401,
        suggestedAction: 'REAUTH_REQUIRED',
        details: { rawMsg, context },
        cause: err,
      }
    );
  }

  // 2. Vi phạm chính sách an toàn / Bộ lọc nội dung nhạy cảm
  if (
    lowerMsg.includes('policy violation') ||
    lowerMsg.includes('content policy') ||
    lowerMsg.includes('vi phạm chính sách') ||
    lowerMsg.includes('safety') ||
    lowerMsg.includes('safety_blocked') ||
    lowerMsg.includes('safety filter') ||
    lowerMsg.includes('sensitive content') ||
    lowerMsg.includes('cannot generate this image') ||
    lowerMsg.includes('cannot generate this video') ||
    lowerMsg.includes('cannot generate') ||
    lowerMsg.includes('harmful content') ||
    lowerMsg.includes('harmful') ||
    lowerMsg.includes('prompt_blocked') ||
    lowerMsg.includes('content_filter') ||
    lowerMsg.includes('content_rejected') ||
    lowerMsg.includes('content rejected') ||
    lowerMsg.includes('nsfw') ||
    lowerMsg.includes('inappropriate content')
  ) {
    const isSpecificRejected =
      lowerMsg.includes('content_rejected') || lowerMsg.includes('content rejected');
    return new GoogleFlowRpcError(
      'Nội dung prompt vi phạm bộ lọc an toàn hoặc chính sách sử dụng của Google Flow.',
      {
        code: isSpecificRejected ? 'CONTENT_REJECTED' : 'CONTENT_POLICY_VIOLATION',
        retryable: false,
        suggestedAction: 'ABORT_HALT',
        details: { rawMsg, context },
        cause: err,
      }
    );
  }

  // 2.1. Phát hiện hoạt động bất thường (reCAPTCHA bot detection)
  if (
    lowerMsg.includes('public_error_unusual_activity') ||
    lowerMsg.includes('unusual_activity') ||
    lowerMsg.includes('unusual activity') ||
    lowerMsg.includes('bot_flagged') ||
    lowerMsg.includes('captcha_score_low') ||
    lowerMsg.includes('empty_captcha_token') ||
    lowerMsg.includes('captcha_execute_error') ||
    lowerMsg.includes('empty_token') ||
    lowerMsg.includes('execute_hang') ||
    lowerMsg.includes('render_error') ||
    lowerMsg.includes('execute_failed') ||
    lowerMsg.includes('recaptcha evaluation failed')
  ) {
    const code: FlowRpcErrorCode = (
      lowerMsg.includes('captcha_score_low') ||
      lowerMsg.includes('empty_captcha_token') ||
      lowerMsg.includes('captcha_execute_error') ||
      lowerMsg.includes('empty_token') ||
      lowerMsg.includes('execute_hang') ||
      lowerMsg.includes('render_error') ||
      lowerMsg.includes('execute_failed')
    )
      ? 'CAPTCHA_SCORE_LOW'
      : lowerMsg.includes('bot_flagged')
      ? 'BOT_FLAGGED'
      : (lowerMsg.includes('public_error_unusual_activity')
          ? 'PUBLIC_ERROR_UNUSUAL_ACTIVITY'
          : 'UNUSUAL_ACTIVITY');
    return new GoogleFlowRpcError(
      'Google Flow tạm thời chặn lệnh tạo do phát hiện hành vi tự động (PUBLIC_ERROR_UNUSUAL_ACTIVITY - reCAPTCHA bot flag). ' +
      'Dừng retry tự động mù quáng để tránh bị khoá phiên; chuyển sang trạng thái cần người dùng xác minh (BLOCKED_REQUIRES_USER).',
      {
        code,
        retryable: false,
        retryAfterMs: 0,
        suggestedAction: 'ABORT_HALT',
        details: { rawMsg, context, isUnusualActivity: true, state: 'BLOCKED_REQUIRES_USER' },
        cause: err,
      }
    );
  }

  // 3. Quá giới hạn tần suất (Rate limit / 429)
  if (
    httpStatus === 429 ||
    lowerMsg.includes('429') ||
    lowerMsg.includes('too many requests') ||
    lowerMsg.includes('quá nhiều yêu cầu') ||
    lowerMsg.includes('rate limit') ||
    lowerMsg.includes('slow down') ||
    lowerMsg.includes('try again in') ||
    lowerMsg.includes('resource exhausted') ||
    lowerMsg.includes('quota exceeded')
  ) {
    const match = lowerMsg.match(/try again in (\d+)\s*(s|sec|seconds)?/i);
    const retryAfterMs = match ? parseInt(match[1], 10) * 1000 : 8000;
    return new GoogleFlowRpcError(
      'Yêu cầu bị giới hạn tần suất bởi Google Flow (Rate Limit). Vui lòng thử lại sau giây lát.',
      {
        code: 'RATE_LIMITED',
        retryable: true,
        retryAfterMs,
        httpStatus: 429,
        suggestedAction: 'RETRY_WITH_BACKOFF',
        details: { rawMsg, context },
        cause: err,
      }
    );
  }

  // 4. Hết tín dụng (Out of credits)
  if (
    lowerMsg.includes('out of credits') ||
    lowerMsg.includes('hết tín dụng') ||
    lowerMsg.includes('hết credit') ||
    lowerMsg.includes('không đủ credit') ||
    lowerMsg.includes('insufficient credits')
  ) {
    return new GoogleFlowRpcError(
      'Tài khoản Google Flow đã hết tín dụng sinh media.',
      {
        code: 'OUT_OF_CREDITS',
        retryable: false,
        suggestedAction: 'ABORT_HALT',
        details: { rawMsg, context },
        cause: err,
      }
    );
  }

  // 5. Quá thời gian chờ (Timeout)
  if (
    lowerMsg.includes('timeout') ||
    lowerMsg.includes('timed out') ||
    lowerMsg.includes('quá thời gian')
  ) {
    return new GoogleFlowRpcError(
      'Tác vụ đã vượt quá thời gian chờ cho phép.',
      {
        code: 'TIMEOUT',
        retryable: true,
        suggestedAction: 'RETRY_WITH_BACKOFF',
        details: { rawMsg, context },
        cause: err,
      }
    );
  }

  // 6. Huỷ bỏ bởi người dùng (Cancelled)
  if (
    lowerMsg.includes('cancelled') ||
    lowerMsg.includes('canceled') ||
    lowerMsg.includes('đã bị huỷ') ||
    lowerMsg.includes('đã bị hủy') ||
    lowerMsg.includes('bị huỷ') ||
    lowerMsg.includes('bị hủy') ||
    lowerMsg.includes('huỷ bỏ') ||
    lowerMsg.includes('hủy bỏ') ||
    lowerMsg.includes('user abort') ||
    lowerMsg.includes('abort')
  ) {
    return new GoogleFlowRpcError('Tác vụ đã bị người dùng huỷ bỏ.', {
      code: 'CANCELLED',
      retryable: false,
      suggestedAction: 'ABORT_HALT',
      details: { rawMsg, context },
      cause: err,
    });
  }

  // 7. Lỗi máy chủ Google (5xx / Upstream Error)
  if (
    (httpStatus && httpStatus >= 500) ||
    lowerMsg.includes('500 internal') ||
    lowerMsg.includes('502 bad gateway') ||
    lowerMsg.includes('503 service') ||
    lowerMsg.includes('504 gateway') ||
    lowerMsg.includes('upstream') ||
    lowerMsg.includes('backend error') ||
    lowerMsg.includes('transient')
  ) {
    return new GoogleFlowRpcError(
      'Máy chủ Google Flow gặp lỗi nội bộ tạm thời (Upstream Error).',
      {
        code: 'UPSTREAM_ERROR',
        retryable: true,
        httpStatus: httpStatus || 500,
        suggestedAction: 'RETRY_WITH_BACKOFF',
        details: { rawMsg, context },
        cause: err,
      }
    );
  }

  // 8. Tham số không hợp lệ
  if (
    lowerMsg.includes('invalid') ||
    lowerMsg.includes('không tồn tại') ||
    lowerMsg.includes('file rỗng') ||
    lowerMsg.includes('prompt rỗng')
  ) {
    return new GoogleFlowRpcError(rawMsg || 'Tham số yêu cầu không hợp lệ.', {
      code: 'INVALID_ARGUMENT',
      retryable: false,
      suggestedAction: 'ABORT_HALT',
      details: { rawMsg, context },
      cause: err,
    });
  }

  // 9. Lỗi mạng
  if (
    lowerMsg.includes('network') ||
    lowerMsg.includes('econnrefused') ||
    lowerMsg.includes('econnreset') ||
    lowerMsg.includes('etimedout') ||
    lowerMsg.includes('failed to fetch')
  ) {
    return new GoogleFlowRpcError('Lỗi kết nối mạng đến Google Flow.', {
      code: 'NETWORK_ERROR',
      retryable: true,
      suggestedAction: 'RETRY_WITH_BACKOFF',
      details: { rawMsg, context },
      cause: err,
    });
  }

  // 10. Mất kết nối hoặc chưa kết nối Chrome Extension Bridge
  if (
    lowerMsg.includes('bridge_disconnected') ||
    lowerMsg.includes('extension_disconnected') ||
    lowerMsg.includes('extension_not_connected') ||
    lowerMsg.includes('extension chưa kết nối') ||
    lowerMsg.includes('chưa có chrome extension') ||
    lowerMsg.includes('extension_client_unavailable') ||
    lowerMsg.includes('bridge_send_failed') ||
    lowerMsg.includes('chrome bridge chưa kết nối')
  ) {
    return new GoogleFlowRpcError(
      'Chrome Extension (VanhSub Flow Bridge) chưa được kết nối hoặc đã ngắt kết nối. ' +
      'Vui lòng mở Google Chrome, đảm bảo tiện ích mở rộng đã được bật và có ít nhất 1 tab flow.google.com đang mở.',
      {
        code: 'BRIDGE_DISCONNECTED',
        retryable: true,
        retryAfterMs: 5000,
        suggestedAction: 'RETRY_WITH_BACKOFF',
        details: { rawMsg, context },
        cause: err,
      }
    );
  }

  return new GoogleFlowRpcError(rawMsg || 'Lỗi không xác định khi tương tác với Google Flow RPC.', {
    code: 'UNKNOWN',
    retryable: false,
    httpStatus,
    details: { rawMsg, context },
    cause: err,
  });
}

// ══════════════════════════════════════════════════════════════════════════════
// 2. Polling Lifecycle State Machine
// ══════════════════════════════════════════════════════════════════════════════

export type PollingLifecycleState = 'queued' | 'processing' | 'completed' | 'failed';

export interface PollingStateTransition {
  from: PollingLifecycleState;
  to: PollingLifecycleState;
  timestamp: number;
  details?: string;
}

export interface PollingProgressInfo {
  state: PollingLifecycleState;
  percentage: number;
  message: string;
  elapsedMs: number;
  pollCount: number;
  operationId: string;
}

export class FlowPollingStateMachine {
  private _state: PollingLifecycleState = 'queued';
  private readonly _transitions: PollingStateTransition[] = [];
  private readonly _onTransition?: (t: PollingStateTransition) => void;

  constructor(onTransition?: (t: PollingStateTransition) => void) {
    this._onTransition = onTransition;
  }

  public get currentState(): PollingLifecycleState {
    return this._state;
  }

  public get isTerminal(): boolean {
    return this._state === 'completed' || this._state === 'failed';
  }

  public get transitions(): ReadonlyArray<PollingStateTransition> {
    return this._transitions;
  }

  public transitionTo(nextState: PollingLifecycleState, details?: string): void {
    if (this._state === nextState) return;

    if (this.isTerminal) {
      throw new Error(
        `[FlowPollingStateMachine] Không thể chuyển từ trạng thái kết thúc "${this._state}" sang "${nextState}".`
      );
    }

    // Kiểm tra tính hợp lệ của luồng chuyển đổi:
    // queued -> processing, completed, failed
    // processing -> completed, failed
    const valid =
      (this._state === 'queued' && (nextState === 'processing' || nextState === 'completed' || nextState === 'failed')) ||
      (this._state === 'processing' && (nextState === 'completed' || nextState === 'failed'));

    if (!valid) {
      throw new Error(
        `[FlowPollingStateMachine] Bước chuyển đổi trạng thái không hợp lệ: "${this._state}" -> "${nextState}".`
      );
    }

    const transition: PollingStateTransition = {
      from: this._state,
      to: nextState,
      timestamp: Date.now(),
      details,
    };

    this._state = nextState;
    this._transitions.push(transition);
    this._onTransition?.(transition);
  }
}

// ══════════════════════════════════════════════════════════════════════════════
// 3. Adapter & Client Option Types
// ══════════════════════════════════════════════════════════════════════════════

export interface SessionContextAdapter {
  executeJavaScript<T = any>(code: string): Promise<T>;
  getCookies(domain: string): Promise<Array<{ name: string; value: string }>>;
  fetch(url: string, init?: any): Promise<{ ok: boolean; status: number; text(): Promise<string>; json(): Promise<any> }>;
  isWindowValid(): boolean;
  getUrl(): string;
  loadURL?(url: string): Promise<void>;
  focus?(): void;
  show?(): void;
}

export interface GoogleFlowRpcClientOptions {
  /**
   * Partition của Electron session (mặc định: 'persist:google_veo' khớp với lobbyWindow).
   */
  partition?: string;
  /**
   * Custom host (mặc định: 'https://flow.google.com').
   */
  flowHost?: string;
  /**
   * Adapter tùy chọn để chạy mock test hoặc inject session runner.
   */
  sessionAdapter?: SessionContextAdapter;
  /**
   * Số lần retry khi gặp lỗi tạm thời (transient). Mặc định 2.
   */
  maxRetries?: number;
  /**
   * Timeout cho mỗi HTTP request RPC (ms). Mặc định 60s.
   */
  requestTimeoutMs?: number;
}

export interface UploadAssetParams {
  /** Đường dẫn file cục bộ */
  filePath?: string;
  file_path?: string; // Alias snake_case
  /** Buffer dữ liệu nếu không dùng filePath */
  buffer?: Buffer;
  /** Tên file */
  filename?: string;
  /** MIME type (tự động nhận diện từ extension nếu không truyền) */
  mimeType?: string;
  mime_type?: string; // Alias snake_case
  /** UUID của project trên Google Flow */
  projectId?: string;
  project_id?: string; // Alias snake_case
  /** Cửa sổ BrowserWindow của lobbyWindow (tùy chọn) */
  win?: any;
}

export interface UploadAssetResult {
  assetId: string;
  mediaId: string; // Alias tương thích
  asset_id: string; // Alias snake_case
  filename: string;
  mimeType: string;
  sizeBytes: number;
}

export type GoogleFlowUploadAssetParams = UploadAssetParams;
export type GoogleFlowUploadAssetResult = UploadAssetResult;

export interface GenerateImageRpcParams {
  prompt: string;
  aspectRatio?: string; // '16:9' | '9:16' | '1:1' | '4:3' | '3:4' (mặc định '16:9')
  aspect_ratio?: string; // Alias snake_case
  seed?: number;
  referenceAssets?: string[];
  reference_assets?: string[]; // Alias snake_case
  referenceMediaIds?: string[]; // Alias
  baseImageAsset?: string;
  base_image_asset?: string; // Alias snake_case
  outputCount?: number;
  output_count?: number; // Alias snake_case
  imageModel?: string; // GEM_PIX_2 / NARWHAL / HARBOR_SEAL / banana-pro
  image_model?: string; // Alias snake_case
  projectId?: string;
  project_id?: string; // Alias snake_case
  editAssetId?: string | null;
  edit_asset_id?: string | null; // Alias snake_case
  win?: any;
  signal?: AbortSignal;
  maxRetries?: number;
  maxAttempts?: number;
  backoffBaseMs?: number;
}

export type GenerateImageParams = GenerateImageRpcParams;
export type GoogleFlowGenerateImageParams = GenerateImageRpcParams;

export interface RpcGenerateImageResult {
  images: Array<{
    assetId: string;
    mediaId: string;
    url: string;
  }>;
  firstImageUrl?: string;
  projectId: string;
}

export type GoogleFlowGenerateImageResult = RpcGenerateImageResult;

export interface GenerateVideoRpcParams {
  prompt: string;
  aspectRatio?: string | number; // '16:9' | '9:16' | 1 | 2
  aspect_ratio?: string | number; // Alias snake_case
  duration?: number | string; // 4, 6, 8...
  duration_seconds?: number | string; // Alias snake_case
  durationSeconds?: number | string; // Alias camelCase
  inputImageAsset?: string; // Asset ID của ảnh đầu vào (ảnh tham chiếu)
  input_image_asset?: string; // Alias snake_case
  imageMediaId?: string; // Alias
  referenceAssets?: string[];
  reference_assets?: string[]; // Alias snake_case
  audio?: boolean | { enabled?: boolean; voice?: string; soundEffects?: boolean };
  videoModel?: string;
  video_model?: string; // Alias snake_case
  projectId?: string;
  project_id?: string; // Alias snake_case
  win?: any;
  signal?: AbortSignal;
  maxRetries?: number;
  maxAttempts?: number;
  backoffBaseMs?: number;
}

export type GenerateVideoParams = GenerateVideoRpcParams;
export type GoogleFlowGenerateVideoParams = GenerateVideoRpcParams;

export interface RpcGenerateVideoResult {
  operationId: string;
  projectId: string;
  status: string;
  done: boolean;
  videoUrl?: string;
  imageUrl?: string;
}

export type GoogleFlowGenerateVideoResult = RpcGenerateVideoResult;

export interface PollGenerationParams {
  operationId?: string;
  operation_id?: string; // Alias snake_case
  projectId?: string;
  project_id?: string; // Alias snake_case
  targetAssetId?: string;
  target_asset_id?: string; // Alias snake_case
  pollIntervalMs?: number;
  poll_interval_ms?: number; // Alias snake_case
  timeoutMs?: number;
  timeout_ms?: number; // Alias snake_case
  onProgress?: (info: PollingProgressInfo) => void;
  onStateChange?: (transition: PollingStateTransition) => void;
  isCancelled?: () => boolean;
  signal?: AbortSignal;
  abortSignal?: AbortSignal;
  win?: any;
}

export interface PollGenerationResult {
  state: 'completed';
  operationId: string;
  assetId?: string;
  videoUrl?: string;
  imageUrl?: string;
  elapsedMs: number;
  pollCount: number;
}

interface AtTokenCache {
  token: string;
  fSid?: string;
  bl?: string;
  cachedAt: number;
}

const AT_TOKEN_CACHE_TTL_MS = 50 * 60 * 1000;
const _tokenCacheByPartition = new Map<string, AtTokenCache>();

// ══════════════════════════════════════════════════════════════════════════════
// 4. Core GoogleFlowRpcClient Implementation
// ══════════════════════════════════════════════════════════════════════════════

export class GoogleFlowRpcClient {
  protected readonly _partition: string;
  protected readonly _flowHost: string;
  protected readonly _sessionAdapter?: SessionContextAdapter;
  protected readonly _maxRetries: number;
  protected readonly _requestTimeoutMs: number;
  protected _lastProjectId?: string;

  constructor(options: GoogleFlowRpcClientOptions | string = 'persist:google_veo') {
    if (typeof options === 'string') {
      this._partition = options;
      this._flowHost = FLOW_HOST;
      this._maxRetries = 2;
      this._requestTimeoutMs = RPC_REQUEST_TIMEOUT_MS;
    } else {
      this._partition = options.partition ?? 'persist:google_veo';
      this._flowHost = options.flowHost ?? FLOW_HOST;
      this._sessionAdapter = options.sessionAdapter;
      this._maxRetries = options.maxRetries ?? 2;
      this._requestTimeoutMs = options.requestTimeoutMs ?? RPC_REQUEST_TIMEOUT_MS;
    }
  }

  public get partition(): string {
    return this._partition;
  }

  public static invalidateAllTokenCaches(): void {
    _tokenCacheByPartition.clear();
  }

  // ── Cookies & CSRF Extraction ──────────────────────────────────────────────

  /**
   * Lấy toàn bộ cookies của flow.google.com và .google.com từ Electron session partition.
   */
  public async getCookieString(): Promise<string> {
    if (this._sessionAdapter) {
      const flowCookies = await this._sessionAdapter.getCookies('flow.google.com');
      const googleCookies = await this._sessionAdapter.getCookies('.google.com');
      const cookieMap = new Map<string, string>();
      for (const c of googleCookies || []) cookieMap.set(c.name, c.value);
      for (const c of flowCookies || []) cookieMap.set(c.name, c.value);
      return Array.from(cookieMap.entries())
        .map(([name, value]) => `${name}=${value}`)
        .join('; ');
    }

    try {
      let electron: any = null;
      try {
        electron = require('electron');
      } catch {}
      const session = electron?.session;

      if (session && typeof session.fromPartition === 'function') {
        const ses = session.fromPartition(this._partition);

        const flowCookies = await ses.cookies.get({ domain: 'flow.google.com' });
        const googleCookies = await ses.cookies.get({ domain: '.google.com' });

        const cookieMap = new Map<string, string>();
        for (const c of googleCookies || []) cookieMap.set(c.name, c.value);
        for (const c of flowCookies || []) cookieMap.set(c.name, c.value);

        return Array.from(cookieMap.entries())
          .map(([name, value]) => `${name}=${value}`)
          .join('; ');
      }

      try {
        const { GoogleVeoSessionManager } = require('../../../veo/GoogleVeoSessionManager');
        const sessionMgr = GoogleVeoSessionManager.getInstance();
        const storedCookie = await sessionMgr.getEffectiveCookieString();
        if (storedCookie) return storedCookie;
      } catch {}

      return '';
    } catch (e: any) {
      throw classifyFlowRpcError(e);
    }
  }

  /**
   * Lấy XSRF token `at` từ window object của trang Flow đang mở.
   * Tự động kích hoạt cơ chế Self-Healing Session nếu bị redirect sang /about hoặc thiếu token.
   */
  public async getAtToken(win?: any, allowHealing = true): Promise<string> {
    const cached = _tokenCacheByPartition.get(this._partition);
    if (cached && Date.now() - cached.cachedAt < AT_TOKEN_CACHE_TTL_MS) {
      return cached.token;
    }

    let currentUrl = '';
    try {
      if (win && !win.isDestroyed?.() && typeof win.webContents?.getURL === 'function') {
        currentUrl = (win.webContents.getURL() || '').toLowerCase();
      }
    } catch {}

    const isRedirectedToAbout =
      currentUrl.includes('/about') ||
      currentUrl.includes('flow.google.com/about') ||
      currentUrl.includes('accounts.google.com');

    const script = `
      (function() {
        let fSid = undefined;
        let bl = undefined;
        try {
          const wizData = window.WIZ_global_data;
          if (wizData && typeof wizData === 'object') {
            if (wizData.FdrFJe) fSid = String(wizData.FdrFJe);
            if (wizData.cfb2h) bl = String(wizData.cfb2h);
            if (wizData['${WIZ_DATA_AT_TOKEN_KEY}']) {
              return { token: wizData['${WIZ_DATA_AT_TOKEN_KEY}'], fSid, bl };
            }
          }
        } catch(e) {}
        
        try {
          const scripts = Array.from(document.querySelectorAll('script'));
          for (const s of scripts) {
            const text = s.textContent || '';
            const patterns = [
              /"SNlM0e"\s*:\s*"([^"]{20,}?)"/,
              /"at"\s*:\s*"(AIQ-[^"]+?)"/,
              /"at"\s*:\s*"(AF[^"]+?)"/,
              /"csrfToken"\s*:\s*"([^"]+?)"/,
            ];
            for (const pattern of patterns) {
              const m = text.match(pattern);
              if (m && m[1]) return { token: m[1], fSid, bl };
            }
          }
        } catch(e) {}

        try {
          const meta = document.querySelector('meta[name="at"], meta[name="_at"]');
          if (meta) {
            const content = meta.getAttribute('content');
            if (content) return { token: content, fSid, bl };
          }
        } catch(e) {}

        return { token: null, fSid, bl };
      })()
    `;

    let sessionData: { token: string | null; fSid?: string; bl?: string } | null = null;

    if (!isRedirectedToAbout) {
      if (this._sessionAdapter) {
        sessionData = await this._sessionAdapter.executeJavaScript(script);
      } else if (win && !win.isDestroyed?.()) {
        sessionData = await win.webContents.executeJavaScript(script);
      } else {
        throw new GoogleFlowRpcError(
          'Không thể lấy CSRF at token: lobbyWindow chưa được khởi tạo hoặc đã bị đóng.',
          { code: 'SESSION_EXPIRED', retryable: false }
        );
      }
    }

    let token = sessionData?.token;

    // Tự động phục hồi phiên nếu token rỗng hoặc bị chuyển hướng sang /about
    if ((!token || isRedirectedToAbout) && allowHealing) {
      console.warn(
        `[GoogleFlowRpcClient] 🩺 Phát hiện thiếu CSRF at token hoặc bị chuyển hướng (${currentUrl || 'no-token'}). ` +
        `Kích hoạt Auto-Reconnect Session Healing...`
      );
      this.invalidateAtTokenCache();

      try {
        const { GoogleVeoSessionManager } = require('../../../veo/GoogleVeoSessionManager');
        const sessionMgr = GoogleVeoSessionManager.getInstance();
        const activeWin = win || sessionMgr.getLobbyWindow();
        const healResult = await sessionMgr.recoverSessionOnRedirect(activeWin, this._lastProjectId);

        if (healResult.success) {
          // Thử lấy lại token sau khi đã phục hồi phiên thành công
          return await this.getAtToken(activeWin, false);
        } else if (healResult.requiresUserInteraction) {
          throw new GoogleFlowRpcError(
            'Phiên Google Flow cần đăng nhập lại hoặc giải CAPTCHA. Cửa sổ Sảnh đã được mở trên màn hình để bạn thao tác.',
            { code: 'SESSION_EXPIRED', retryable: false, suggestedAction: 'REAUTH_REQUIRED' }
          );
        }
      } catch (healErr: any) {
        if (healErr instanceof GoogleFlowRpcError) throw healErr;
        console.warn('[GoogleFlowRpcClient] Session healing gặp lỗi:', healErr?.message || healErr);
      }
    }

    if (!token) {
      throw new GoogleFlowRpcError(
        'Không tìm thấy CSRF at token (WIZ_global_data.SNlM0e) trong context phiên Google Flow.',
        { code: 'SESSION_EXPIRED', retryable: false }
      );
    }

    _tokenCacheByPartition.set(this._partition, {
      token,
      fSid: sessionData?.fSid,
      bl: sessionData?.bl,
      cachedAt: Date.now(),
    });

    return token;
  }

  public invalidateAtTokenCache(): void {
    _tokenCacheByPartition.delete(this._partition);
  }

  /**
   * Mint fresh reCAPTCHA token trực tiếp trong page context của tab Flow.
   */
  public async mintCaptchaToken(
    win?: any,
    action: typeof CAPTCHA_ACTION_IMAGE | typeof CAPTCHA_ACTION_VIDEO = CAPTCHA_ACTION_IMAGE
  ): Promise<string> {
    if (win && !win.isDestroyed?.() && typeof win.webContents?.getURL === 'function') {
      const currentUrl = (win.webContents.getURL() || '').toLowerCase();
      if (
        currentUrl.includes('accounts.google.com') ||
        currentUrl.includes('flow.google.com/about') ||
        currentUrl.includes('servicelogin')
      ) {
        console.warn(`[GoogleFlowRpcClient] 🩺 mintCaptchaToken phát hiện chuyển hướng (${currentUrl}). Thử phục hồi phiên...`);
        try {
          const { GoogleVeoSessionManager } = require('../../../veo/GoogleVeoSessionManager');
          const sessionMgr = GoogleVeoSessionManager.getInstance();
          const healResult = await sessionMgr.recoverSessionOnRedirect(win, this._lastProjectId);
          if (!healResult.success && healResult.requiresUserInteraction) {
            throw new GoogleFlowRpcError(
              'Chưa đăng nhập Google Flow hoặc phiên làm việc đã hết hạn. Vui lòng mở Sảnh Google Flow trên giao diện để đăng nhập tài khoản.',
              { code: 'SESSION_EXPIRED', retryable: false, suggestedAction: 'REAUTH_REQUIRED' }
            );
          }
        } catch (healErr: any) {
          if (healErr instanceof GoogleFlowRpcError) throw healErr;
        }
      }
      if (currentUrl.startsWith('http') && currentUrl.includes('flow.google.com') && !currentUrl.includes('/project/')) {
        try {
          const { GoogleVeoSessionManager } = require('../../../veo/GoogleVeoSessionManager');
          const sessionMgr = GoogleVeoSessionManager.getInstance();
          await sessionMgr.ensureProjectContext(win);
        } catch (navErr) {
          console.warn('[GoogleFlowRpcClient] Tự động chuyển vào project context thất bại:', navErr);
        }
      }

      // Tự động mô phỏng chuỗi tương tác chuột thực tế để reCAPTCHA Enterprise thu thập telemetry tự nhiên
      try {
        if (typeof win.webContents?.sendInputEvent === 'function') {
          const jitterMoves = [
            { x: 320, y: 240 },
            { x: 390, y: 280 },
            { x: 460, y: 320 },
            { x: 530, y: 300 },
            { x: 620, y: 260 },
          ];
          for (const m of jitterMoves) {
            win.webContents.sendInputEvent({ type: 'mouseMove', x: m.x, y: m.y });
            await new Promise((r) => setTimeout(r, 20));
          }
        }
      } catch {}
    }

    const script = `
      new Promise(function(resolve, reject) {
        var siteKey = '${RECAPTCHA_SITE_KEY}';
        try {
          if (window.WIZ_global_data && window.WIZ_global_data.xZbWve) {
            siteKey = window.WIZ_global_data.xZbWve;
          } else {
            var script = document.querySelector('script[src*="recaptcha"]');
            if (script && script.src) {
              var m = script.src.match(/render=([a-zA-Z0-9_-]+)/);
              if (m && m[1]) siteKey = m[1];
            }
          }
        } catch(e) {}

        var action = '${action}';
        var attempts = 0;
        var maxAttempts = 36;

        try {
          if (document.hidden) {
            Object.defineProperty(document, 'hidden', { value: false, configurable: true });
            Object.defineProperty(document, 'visibilityState', { value: 'visible', configurable: true });
            window.dispatchEvent(new Event('visibilitychange'));
          }
          window.dispatchEvent(new Event('focus'));
        } catch(e) {}

        function tryMint() {
          if (window.grecaptcha && window.grecaptcha.enterprise && typeof window.grecaptcha.enterprise.execute === 'function') {
            window.grecaptcha.enterprise.execute(siteKey, { action: action })
              .then(function(token) { resolve({ token: token, siteKey: siteKey }); })
              .catch(function(err) { reject(err); });
            return;
          }

          attempts++;
          if (attempts >= maxAttempts) {
            var cur = window.location.href;
            if (cur.includes('about') || cur.includes('accounts.google.com') || cur.includes('ServiceLogin')) {
              reject(new Error('SESSION_EXPIRED: Trang đang ở ' + cur + ' (chưa đăng nhập hoặc hết hạn phiên)'));
            } else if (!cur.includes('/project/')) {
              reject(new Error('PROJECT_NOT_LOADED: Cửa sổ Flow chưa vào trang dự án (/project/...). URL: ' + cur));
            } else {
              reject(new Error('grecaptcha.enterprise không tải được trên trang dự án (' + cur + ').'));
            }
            return;
          }

          setTimeout(tryMint, 500);
        }

        tryMint();
      })
    `;

    let captchaData: { token: string; siteKey: string } | null = null;
    try {
      if (this._sessionAdapter) {
        captchaData = await this._sessionAdapter.executeJavaScript(script);
      } else if (win && !win.isDestroyed?.()) {
        try {
          if (!win.isMinimized?.()) win.focus?.();
        } catch {}
        captchaData = await win.webContents.executeJavaScript(script);
      } else {
        throw new GoogleFlowRpcError(
          'lobbyWindow cần mở để tạo reCAPTCHA Enterprise token.',
          { code: 'SESSION_EXPIRED', retryable: false }
        );
      }
    } catch (err: any) {
      if (err instanceof GoogleFlowRpcError) throw err;
      const errMsg = err?.message || String(err);
      if (
        errMsg.includes('SESSION_EXPIRED') ||
        errMsg.includes('chưa đăng nhập') ||
        errMsg.includes('accounts.google.com') ||
        errMsg.includes('flow.google.com/about')
      ) {
        throw new GoogleFlowRpcError(
          'Phiên làm việc Google Flow đã hết hạn hoặc chưa đăng nhập. Vui lòng mở sảnh Google Flow để đăng nhập lại.',
          {
            code: 'SESSION_EXPIRED',
            retryable: false,
            suggestedAction: 'REAUTH_REQUIRED',
            cause: err,
          }
        );
      }
      throw new GoogleFlowRpcError(
        `Không thể tạo reCAPTCHA token: ${errMsg}`,
        {
          code: 'UPSTREAM_ERROR',
          retryable: true,
          suggestedAction: 'RETRY_WITH_BACKOFF',
          cause: err,
        }
      );
    }

    const token = captchaData?.token;
    if (!token || typeof token !== 'string') {
      throw new GoogleFlowRpcError('reCAPTCHA Enterprise token rỗng.', {
        code: 'UPSTREAM_ERROR',
        retryable: true,
      });
    }

    return token;
  }

  // ── Core RPC Dispatcher ────────────────────────────────────────────────────

  public async callFlowRPC(
    win: any | null | undefined,
    rpcId: string,
    innerPayload: unknown[],
    projectId?: string,
    opts: {
      needsCaptcha?: boolean;
      captchaAction?: typeof CAPTCHA_ACTION_IMAGE | typeof CAPTCHA_ACTION_VIDEO;
      maxRetries?: number;
      label?: string;
      signal?: AbortSignal;
    } = {}
  ): Promise<unknown> {
    const {
      needsCaptcha = false,
      captchaAction = CAPTCHA_ACTION_IMAGE,
      maxRetries = this._maxRetries,
      label = rpcId,
      signal,
    } = opts;

    if (projectId && projectId !== PROJECT_ID_SLOT) {
      this._lastProjectId = projectId;
    }

    let lastError: Error | null = null;
    let attempt = 0;
    let hasHealedSession = false;

    while (attempt <= maxRetries) {
      attempt++;
      try {
        const cookieStr = await this.getCookieString();
        if (!cookieStr || cookieStr.length < 10) {
          throw new GoogleFlowRpcError(
            'Không tìm thấy session cookies của Google Flow. Phiên có thể chưa đăng nhập.',
            { code: 'SESSION_EXPIRED', retryable: false }
          );
        }

        let xsrfToken: string;
        if (win && !win.isDestroyed?.()) {
          xsrfToken = await this.getAtToken(win);
        } else if (this._sessionAdapter) {
          xsrfToken = await this.getAtToken();
        } else {
          const cached = _tokenCacheByPartition.get(this._partition);
          if (cached && Date.now() - cached.cachedAt < AT_TOKEN_CACHE_TTL_MS) {
            xsrfToken = cached.token;
          } else {
            throw new GoogleFlowRpcError(
              'Không có CSRF at token hợp lệ (cache rỗng, window không tồn tại).',
              { code: 'SESSION_EXPIRED', retryable: false }
            );
          }
        }

        if (needsCaptcha && (win || this._sessionAdapter)) {
          await this.mintCaptchaToken(win, captchaAction);
        }

        const cachedSession = _tokenCacheByPartition.get(this._partition);
        const fSid = cachedSession?.fSid;
        const bl = cachedSession?.bl;
        const envelope = buildEnvelope(rpcId, innerPayload, xsrfToken, cookieStr, projectId, fSid, bl);

        let rawText: string;

        if (this._sessionAdapter) {
          const res = await this._sessionAdapter.fetch(envelope.url, {
            method: 'POST',
            headers: envelope.headers,
            body: envelope.body,
          });
          rawText = await res.text();
          if (!res.ok) {
            throw classifyFlowRpcError(new Error(`HTTP ${res.status}: ${rawText.slice(0, 200)}`), {
              httpStatus: res.status,
              rawResponse: rawText,
            });
          }
        } else if (win && !win.isDestroyed?.()) {
          const fetchUrl = envelope.url.startsWith('https://flow.google.com')
            ? envelope.url.replace('https://flow.google.com', '')
            : envelope.url;

          rawText = await win.webContents.executeJavaScript(`
            (async function() {
              try {
                const res = await window.fetch(${JSON.stringify(fetchUrl)}, {
                  method: 'POST',
                  headers: {
                    'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8',
                    'X-Same-Domain': '1'
                  },
                  body: ${JSON.stringify(envelope.body)},
                  credentials: 'include'
                });
                const text = await res.text();
                if (!res.ok) {
                  return 'HTTP_ERROR:' + res.status + ':' + text.slice(0, 300);
                }
                return text;
              } catch (e) {
                return 'FETCH_EXCEPTION:' + (e.message || String(e));
              }
            })()
          `);

          if (typeof rawText !== 'string') {
            throw classifyFlowRpcError(new Error('Phản hồi in-page executeJavaScript rỗng hoặc không hợp lệ.'));
          }

          if (rawText.startsWith('HTTP_ERROR:')) {
            const parts = rawText.split(':');
            const status = parseInt(parts[1], 10) || 500;
            const errBody = rawText.slice(parts[0].length + parts[1].length + 2);
            throw classifyFlowRpcError(new Error(`HTTP ${status}: ${errBody}`), {
              httpStatus: status,
              rawResponse: errBody,
            });
          }
          if (rawText.startsWith('FETCH_EXCEPTION:')) {
            throw classifyFlowRpcError(new Error(`In-page fetch failed: ${rawText.slice(16)}`));
          }
        } else {
          // Electron net.fetch / session.fetch từ main process hoặc Node fetch
          let electron: any = null;
          try {
            electron = require('electron');
          } catch {}
          const session = electron?.session;

          if (session && typeof session.fromPartition === 'function') {
            const ses = session.fromPartition(this._partition);
            const controller = new AbortController();
            const timeout = setTimeout(() => controller.abort(), this._requestTimeoutMs);
            try {
              const response = await ses.fetch(envelope.url, {
                method: 'POST',
                headers: envelope.headers,
                body: envelope.body,
                signal: controller.signal,
              });
              rawText = await response.text();
              if (!response.ok) {
                throw classifyFlowRpcError(new Error(`HTTP ${response.status}: ${rawText.slice(0, 200)}`), {
                  httpStatus: response.status,
                  rawResponse: rawText,
                });
              }
            } finally {
              clearTimeout(timeout);
            }
          } else if (typeof fetch === 'function') {
            const controller = new AbortController();
            const timeout = setTimeout(() => controller.abort(), this._requestTimeoutMs);
            try {
              const cookieStr = await this.getCookieString().catch(() => '');
              const headers: Record<string, string> = { ...envelope.headers };
              if (cookieStr && !headers['Cookie'] && !headers['cookie']) {
                headers['Cookie'] = cookieStr;
              }
              const response = await fetch(envelope.url, {
                method: 'POST',
                headers,
                body: envelope.body,
                signal: controller.signal,
              });
              rawText = await response.text();
              if (!response.ok) {
                throw classifyFlowRpcError(new Error(`HTTP ${response.status}: ${rawText.slice(0, 200)}`), {
                  httpStatus: response.status,
                  rawResponse: rawText,
                });
              }
            } finally {
              clearTimeout(timeout);
            }
          } else {
            throw new GoogleFlowRpcError('Môi trường không hỗ trợ fetch (thiếu Electron session và global fetch)', {
              code: 'SESSION_EXPIRED',
              status: 401,
            });
          }
        }

        const result = parseBatchResponse(rawText, rpcId);
        if (!result.ok) {
          const errStr = JSON.stringify(result.error);
          const classified = classifyFlowRpcError(new Error(`RPC ${label} failed: ${errStr}`), {
            rawResponse: rawText,
          });

          if (classified.retryable && attempt <= maxRetries) {
            const expDelay = calculateExponentialBackoffMs(attempt - 1, 10000, 120000);
            const delay = classified.retryAfterMs ? Math.max(classified.retryAfterMs, expDelay) : expDelay;
            console.log(
              `[GoogleFlowRpcClient] ⏳ Tác vụ ${label} gặp lỗi tạm thời [${classified.code}]. ` +
              `Exponential Backoff lần ${attempt}/${maxRetries}: chờ ${Math.round(delay / 1000)}s...`
            );
            await sleepWithSignal(delay, signal);
            lastError = classified;
            continue;
          }
          throw classified;
        }

        return result.data;
      } catch (err: any) {
        const classified = classifyFlowRpcError(err);
        lastError = classified;
        if (classified.code === 'SESSION_EXPIRED') {
          this.invalidateAtTokenCache();
          if (attempt <= maxRetries && !hasHealedSession) {
            hasHealedSession = true;
            console.warn(`[GoogleFlowRpcClient] 🩺 Phát hiện SESSION_EXPIRED trong ${label}. Kích hoạt Auto-Reconnect Session Healing...`);
            try {
              const { GoogleVeoSessionManager } = require('../../../veo/GoogleVeoSessionManager');
              const sessionMgr = GoogleVeoSessionManager.getInstance();
              const healRes = await sessionMgr.recoverSessionOnRedirect(win, projectId || this._lastProjectId);
              if (healRes.success) {
                console.log(`[GoogleFlowRpcClient] 🩺 Phục hồi session thành công, retry RPC ${label}...`);
                continue;
              } else if (healRes.requiresUserInteraction) {
                await sessionMgr.showLobbyForDebug();
                throw classified;
              }
            } catch (healErr: any) {
              if (healErr instanceof GoogleFlowRpcError) throw healErr;
              console.warn('[GoogleFlowRpcClient] Session healing in callFlowRPC failed:', healErr?.message || healErr);
            }
          }
        }
        if (classified.retryable && attempt <= maxRetries) {
          const expDelay = calculateExponentialBackoffMs(attempt - 1, 10000, 120000);
          const delay = classified.retryAfterMs ? Math.max(classified.retryAfterMs, expDelay) : expDelay;
          console.log(
            `[GoogleFlowRpcClient] ⏳ Tác vụ ${label} gặp lỗi tạm thời [${classified.code}]. ` +
            `Exponential Backoff lần ${attempt}/${maxRetries}: chờ ${Math.round(delay / 1000)}s...`
          );
          await sleepWithSignal(delay, signal);
        } else {
          throw classified;
        }
      }
    }

    throw lastError ?? new GoogleFlowRpcError(`${label} thất bại sau ${attempt} lần thử.`, {
      code: 'UNKNOWN',
      retryable: false,
    });
  }

  // ── Asset Upload ───────────────────────────────────────────────────────────

  /**
   * Upload tệp cục bộ lên dịch vụ lưu trữ của Google Flow và nhận diện asset_id hợp lệ.
   * Hỗ trợ các cách gọi:
   * 1. uploadAsset({ filePath, projectId, win, ... })
   * 2. uploadAsset(filePath, projectId)
   * 3. uploadAsset(win, filePath, projectId)
   */
  public async uploadAsset(
    winOrParams: any,
    maybeFilePathOrBuffer?: string | Buffer | any,
    maybeFilenameOrProjectId?: string,
    maybeProjectId?: string
  ): Promise<UploadAssetResult> {
    let params: UploadAssetParams;

    if (Buffer.isBuffer(winOrParams) || (winOrParams && winOrParams instanceof Uint8Array)) {
      if (typeof maybeFilenameOrProjectId === 'string' && typeof maybeFilePathOrBuffer === 'string') {
        params = {
          buffer: Buffer.from(winOrParams),
          filename: maybeFilePathOrBuffer,
          projectId: maybeFilenameOrProjectId,
        };
      } else {
        params = {
          buffer: Buffer.from(winOrParams),
          projectId: typeof maybeFilePathOrBuffer === 'string' ? maybeFilePathOrBuffer : '',
        };
      }
    } else if (typeof winOrParams === 'string') {
      if (typeof maybeFilenameOrProjectId === 'string') {
        params = {
          filePath: winOrParams,
          filename: typeof maybeFilePathOrBuffer === 'string' ? maybeFilePathOrBuffer : undefined,
          projectId: maybeFilenameOrProjectId,
        };
      } else {
        params = {
          filePath: winOrParams,
          projectId: typeof maybeFilePathOrBuffer === 'string' ? maybeFilePathOrBuffer : '',
        };
      }
    } else if (Buffer.isBuffer(maybeFilePathOrBuffer) || (maybeFilePathOrBuffer && maybeFilePathOrBuffer instanceof Uint8Array)) {
      if (typeof maybeProjectId === 'string') {
        params = {
          win: winOrParams,
          buffer: Buffer.from(maybeFilePathOrBuffer),
          filename: maybeFilenameOrProjectId,
          projectId: maybeProjectId,
        };
      } else {
        params = {
          win: winOrParams,
          buffer: Buffer.from(maybeFilePathOrBuffer),
          projectId: maybeFilenameOrProjectId || '',
        };
      }
    } else if (typeof maybeFilePathOrBuffer === 'string') {
      if (typeof maybeProjectId === 'string') {
        params = {
          win: winOrParams,
          filePath: maybeFilePathOrBuffer,
          filename: maybeFilenameOrProjectId,
          projectId: maybeProjectId,
        };
      } else {
        params = {
          win: winOrParams,
          filePath: maybeFilePathOrBuffer,
          projectId: maybeFilenameOrProjectId || '',
        };
      }
    } else {
      params = winOrParams || {};
    }

    const projectId = params.projectId || params.project_id || '';
    const win = params.win;
    const targetFilePath = params.filePath || params.file_path;

    let buffer: Buffer;
    let filename: string;
    let mimeType: string;

    if (targetFilePath) {
      if (!fs.existsSync(targetFilePath)) {
        throw new GoogleFlowRpcError(`File không tồn tại: "${targetFilePath}"`, {
          code: 'INVALID_ARGUMENT',
          retryable: false,
        });
      }
      buffer = fs.readFileSync(targetFilePath);
      filename = params.filename || path.basename(targetFilePath);
      const ext = path.extname(targetFilePath).toLowerCase();
      mimeType =
        params.mimeType ||
        params.mime_type ||
        (ext === '.png'
          ? 'image/png'
          : ext === '.jpg' || ext === '.jpeg'
          ? 'image/jpeg'
          : ext === '.webp'
          ? 'image/webp'
          : 'image/png');
    } else if (params.buffer) {
      buffer = params.buffer;
      filename = params.filename || 'uploaded_asset.png';
      mimeType = params.mimeType || params.mime_type || 'image/png';
    } else {
      throw new GoogleFlowRpcError('Cần cung cấp filePath hoặc buffer để upload asset.', {
        code: 'INVALID_ARGUMENT',
        retryable: false,
      });
    }

    if (buffer.length === 0) {
      throw new GoogleFlowRpcError(`File dữ liệu rỗng: "${filename}"`, {
        code: 'INVALID_ARGUMENT',
        retryable: false,
      });
    }

    const base64Data = buffer.toString('base64');

    // Kiểm tra Chrome Extension Bridge nếu đang active
    const bridge = FlowBridgeServer.getInstance();
    if (bridge.isConnected()) {
      const effectivePid = projectId && projectId !== PROJECT_ID_SLOT ? projectId : undefined;
      const uploadPayload = buildUploadPayload({
        projectId: effectivePid || PROJECT_ID_SLOT,
        base64Data,
        mimeType,
        filename,
        captchaToken: CAPTCHA_SLOT,
      });
      const rawText = await bridge.sendBatchRpc(
        RPC_UPLOAD_IMAGE,
        uploadPayload,
        CAPTCHA_ACTION_IMAGE,
        effectivePid
      );
      const res = parseBatchResponse(rawText, RPC_UPLOAD_IMAGE);
      if (!res.ok) {
        throw classifyFlowRpcError(new Error(`Extension Bridge upload error: ${JSON.stringify(res.error)}`));
      }
      const mediaId = this._extractMediaId(res.data);
      if (!mediaId) {
        throw new GoogleFlowRpcError('Không thể extract asset_id từ upload response của Extension.', {
          code: 'UPSTREAM_ERROR',
          retryable: false,
        });
      }
      return {
        assetId: mediaId,
        mediaId,
        asset_id: mediaId,
        filename,
        mimeType,
        sizeBytes: buffer.length,
      };
    }

    // Direct Electron session upload
    let captchaToken = CAPTCHA_SLOT;
    if (win || this._sessionAdapter) {
      captchaToken = await this.mintCaptchaToken(win, CAPTCHA_ACTION_IMAGE);
    }

    const uploadPayload = buildUploadPayload({
      projectId,
      base64Data,
      mimeType,
      filename,
      captchaToken,
    });

    const data = await this.callFlowRPC(win, RPC_UPLOAD_IMAGE, uploadPayload, projectId, {
      needsCaptcha: false,
      label: `maseQ(upload:${filename})`,
      maxRetries: 2,
    });

    const assetId = this._extractMediaId(data);
    if (!assetId) {
      throw new GoogleFlowRpcError(
        `Không thể extract asset_id từ response maseQ. Data: ${JSON.stringify(data)?.slice(0, 200)}`,
        { code: 'UPSTREAM_ERROR', retryable: true }
      );
    }

    return {
      assetId,
      mediaId: assetId,
      asset_id: assetId,
      filename,
      mimeType,
      sizeBytes: buffer.length,
    };
  }

  /** Alias cho uploadAsset */
  public async upload_asset(
    winOrParams: any,
    maybeFilePath?: string,
    maybeProjectId?: string
  ): Promise<UploadAssetResult> {
    return this.uploadAsset(winOrParams, maybeFilePath, maybeProjectId);
  }

  /** Tương thích với FlowRpcClient cũ */
  public async uploadReferenceImage(
    win: any,
    filePath: string,
    projectId: string
  ): Promise<{ mediaId: string; url?: string }> {
    const res = await this.uploadAsset(win, filePath, projectId);
    return { mediaId: res.assetId };
  }

  // ── Image Generation ───────────────────────────────────────────────────────

  /**
   * Tự động phục hồi khi gặp PUBLIC_ERROR_UNUSUAL_ACTIVITY (reCAPTCHA bot flag).
   * Kéo Sảnh Google Flow từ chế độ offscreen ra màn hình chính, kích hoạt layout GPU render,
   * thực hiện cơ chế dự phòng số 1 (CDP Trusted Click phần hardware) qua Chrome DevTools Protocol,
   * và mô phỏng tương tác người dùng tự nhiên để nâng reCAPTCHA Enterprise score lên mức an toàn.
   */
  public async handleUnusualActivityRecovery(win?: any, projectId?: string, signal?: AbortSignal): Promise<any> {
    console.warn(
      '[GoogleFlowRpcClient] 🛡️ Phát hiện PUBLIC_ERROR_UNUSUAL_ACTIVITY (reCAPTCHA bot flag). ' +
      'Tự động kích hoạt cơ chế dự phòng số 1 (CDP Trusted Click phần hardware)...'
    );

    try {
      const bridge = FlowBridgeServer.getInstance();
      if (bridge.isConnected()) {
        await bridge.recoverUnusualActivity(15000, projectId || this._lastProjectId, signal);
        return win;
      }
    } catch (brErr: any) {
      console.warn('[GoogleFlowRpcClient] Bridge recoverUnusualActivity warning:', brErr?.message || brErr);
      if (FlowBridgeServer.getInstance().isConnected()) {
        return win;
      }
    }

    let activeWin = win;
    try {
      const { GoogleVeoSessionManager } = require('../../../veo/GoogleVeoSessionManager');
      const sessionMgr = GoogleVeoSessionManager.getInstance();
      await sessionMgr.showLobbyForDebug();
      activeWin = sessionMgr.getLobbyWindow() || win;
    } catch (e) {
      console.warn('[GoogleFlowRpcClient] showLobbyForDebug warning:', e);
    }

    if (activeWin && !activeWin.isDestroyed?.()) {
      try {
        activeWin.focus?.();

        // 1. CDP Trusted Click (phần hardware qua Chrome DevTools Protocol)
        let cdpSuccess = false;
        const dbg = activeWin.webContents?.debugger;
        if (dbg) {
          try {
            if (!dbg.isAttached()) {
              dbg.attach('1.3');
            }
            if (dbg.isAttached()) {
              await dbg.sendCommand('Input.dispatchMouseEvent', {
                type: 'mouseMoved',
                x: 450,
                y: 350,
              });
              await new Promise((r) => setTimeout(r, 50));
              await dbg.sendCommand('Input.dispatchMouseEvent', {
                type: 'mousePressed',
                x: 450,
                y: 350,
                button: 'left',
                clickCount: 1,
              });
              await new Promise((r) => setTimeout(r, 80));
              await dbg.sendCommand('Input.dispatchMouseEvent', {
                type: 'mouseReleased',
                x: 450,
                y: 350,
                button: 'left',
                clickCount: 1,
              });
              cdpSuccess = true;
              console.log('[GoogleFlowRpcClient] 🖱️ Đã phát tín hiệu CDP Trusted Click phần hardware thành công.');
            }
          } catch (cdpErr: any) {
            console.warn('[GoogleFlowRpcClient] CDP Trusted Click error:', cdpErr?.message || cdpErr);
          }
        }

        // 2. Tương tác bổ trợ qua Electron native sendInputEvent
        if (typeof activeWin.webContents?.sendInputEvent === 'function') {
          const jitterMoves = [
            { x: 350, y: 250 },
            { x: 420, y: 310 },
            { x: 500, y: 280 },
            { x: 620, y: 360 },
            { x: 700, y: 400 },
          ];
          for (const m of jitterMoves) {
            activeWin.webContents.sendInputEvent({ type: 'mouseMove', x: m.x, y: m.y });
            await new Promise((r) => setTimeout(r, 40));
          }
          if (!cdpSuccess) {
            activeWin.webContents.sendInputEvent({ type: 'mouseDown', x: 500, y: 280, button: 'left', clickCount: 1 });
            await new Promise((r) => setTimeout(r, 60));
            activeWin.webContents.sendInputEvent({ type: 'mouseUp', x: 500, y: 280, button: 'left', clickCount: 1 });
          }
        }
      } catch {}
    }

    // Đợi 2.5s để Chromium hoàn tất layout render trên màn hình và reCAPTCHA script nhận diện viewport
    await new Promise((r) => setTimeout(r, 2500));
    return activeWin;
  }

  /** Alias tương thích ngược cho internal / subclass override */
  protected async _handleUnusualActivityAutoRecovery(win?: any, projectId?: string, signal?: AbortSignal): Promise<any> {
    return await this.handleUnusualActivityRecovery(win, projectId, signal);
  }

  /**
   * Gửi lệnh tạo ảnh (generate_image) với các tham số: prompt, aspect ratio, seed, reference assets.
   * Hỗ trợ:
   * 1. generateImage({ prompt, aspectRatio, seed, referenceAssets, projectId, win, ... })
   * 2. generateImage(prompt, { aspectRatio, seed, ... })
   * 3. generateImage(win, { prompt, aspectRatio, seed, ... })
   */
  public async generateImage(
    winOrParams: any,
    maybePromptOrOpts?: any,
    maybeOpts?: any
  ): Promise<RpcGenerateImageResult> {
    return await GoogleFlowBrowserMutex.getInstance().runExclusive(async () => {
      let params: GenerateImageParams;

      if (typeof winOrParams === 'string') {
        if (typeof maybePromptOrOpts === 'string') {
          params = { prompt: winOrParams, projectId: maybePromptOrOpts, ...(typeof maybeOpts === 'object' ? maybeOpts : {}) };
        } else if (maybePromptOrOpts && typeof maybePromptOrOpts === 'object') {
          params = { prompt: winOrParams, ...maybePromptOrOpts };
        } else {
          params = { prompt: winOrParams };
        }
      } else if (typeof maybePromptOrOpts === 'string') {
        params = { win: winOrParams, prompt: maybePromptOrOpts, ...(typeof maybeOpts === 'object' ? maybeOpts : {}) };
      } else if (maybePromptOrOpts && typeof maybePromptOrOpts === 'object') {
        params = { ...maybePromptOrOpts, win: winOrParams };
      } else {
        params = winOrParams || {};
      }

      const {
        prompt,
        aspectRatio = params.aspect_ratio || '16:9',
        seed = Math.floor(Math.random() * 2147483647),
        outputCount = params.output_count ?? 1,
        imageModel = params.image_model || 'GEM_PIX_2',
        projectId = params.project_id || '',
        editAssetId = params.edit_asset_id ?? null,
        baseImageAsset = params.base_image_asset,
        win,
        signal = params.signal,
      } = params;

      if (projectId && projectId !== PROJECT_ID_SLOT) {
        this._lastProjectId = projectId;
      }

      if (signal?.aborted) {
        throw new GoogleFlowRpcError('Tác vụ đã bị người dùng huỷ bỏ.', { code: 'CANCELLED', retryable: false });
      }

      if (!prompt || typeof prompt !== 'string' || prompt.trim().length === 0) {
        throw new GoogleFlowRpcError('Prompt tạo ảnh không được để trống.', {
          code: 'INVALID_ARGUMENT',
          retryable: false,
        });
      }

      const timeoutMs = (params as any).timeoutMs || IMAGE_GEN_TIMEOUT_MS;
      let timeoutTimer: NodeJS.Timeout | null = null;
      const timeoutPromise = new Promise<never>((_, reject) => {
        timeoutTimer = setTimeout(() => {
          reject(
            new GoogleFlowRpcError(
              `Quá thời gian sinh ảnh từ Google Flow (Timeout ${Math.round(timeoutMs / 1000)}s). Vui lòng thử lại hoặc kết nối Chrome Bridge.`,
              { code: 'TIMEOUT', retryable: true, suggestedAction: 'RETRY_WITH_BACKOFF' }
            )
          );
        }, timeoutMs);
      });

      const executeGen = async (): Promise<RpcGenerateImageResult> => {

      const rawRefs: unknown =
        params.referenceAssets ||
        params.reference_assets ||
        params.referenceMediaIds;
      const referenceMediaIds = Array.isArray(rawRefs)
        ? (rawRefs as string[])
        : typeof rawRefs === 'string' && rawRefs.trim()
        ? [rawRefs.trim()]
        : [];

      // Kiểm tra Extension Bridge nếu đang active trên Chrome
      const bridge = FlowBridgeServer.getInstance();
      if (bridge.isConnected()) {
        const finalProjectId = projectId?.trim() || '';
        if (!finalProjectId || finalProjectId === PROJECT_ID_SLOT) {
          throw new GoogleFlowRpcError('FLOW_PROJECT_REQUIRED: Chưa liên kết project Flow cho tác vụ. Không sử dụng project đang mở.', { code: 'INVALID_ARGUMENT', retryable: false });
        }
        const cleanProjectId = finalProjectId && finalProjectId !== PROJECT_ID_SLOT ? finalProjectId : undefined;
        const payloadProjectId = cleanProjectId || PROJECT_ID_SLOT;

        // Tự động upload các referenceMediaIds là đường dẫn file cục bộ trên đĩa
        const resolvedRefIds: string[] = [];
        for (const refItem of referenceMediaIds) {
          if (refItem && !this._sessionAdapter && fs.existsSync(refItem)) {
            try {
              const upRes = await this.uploadAsset({ filePath: refItem, projectId: cleanProjectId || '', win });
              if (upRes?.mediaId) {
                resolvedRefIds.push(upRes.mediaId);
                continue;
              }
            } catch (upErr: any) {
              console.warn(`[GoogleFlowRpcClient] Không thể upload ảnh tham chiếu "${refItem}":`, upErr?.message || upErr);
            }
          }
          resolvedRefIds.push(refItem);
        }

        console.log(`[GoogleFlowRpcClient] 🌐 [Chrome Extension Bridge] Đang tạo ảnh (project: ${cleanProjectId || 'auto-tab'}): "${prompt.slice(0, 40)}"...`);
        const innerPayload = buildGenImagePayload({
          prompt,
          aspectRatio,
          outputCount,
          referenceMediaIds: resolvedRefIds,
          baseImageMediaId: baseImageAsset,
          imageModel,
          projectId: payloadProjectId,
          editAssetId,
          captchaToken: CAPTCHA_SLOT,
          seed,
        });

        let rawText = '';
        try {
          rawText = await bridge.sendBatchRpc(
            RPC_GEN_IMAGE,
            innerPayload,
            CAPTCHA_ACTION_IMAGE,
            cleanProjectId,
            undefined,
            signal
          );
        } catch (bridgeErr: any) {
          throw classifyFlowRpcError(bridgeErr);
        }
        const res = parseBatchResponse(rawText, RPC_GEN_IMAGE);
        if (!res.ok) {
          throw classifyFlowRpcError(new Error(`Extension Bridge image error: ${JSON.stringify(res.error)}`));
        }
        const images = extractGeneratedImages(res.data);
        if (!images || images.length === 0) {
          throw new GoogleFlowRpcError(
            `Không trích xuất được ảnh nào từ response Extension ogiZ0b. Raw data: ${JSON.stringify(res.data)?.slice(0, 300)}`,
            { code: 'UPSTREAM_ERROR', retryable: true }
          );
        }
        const formatted = images.map((img) => ({
          assetId: img.mediaId,
          mediaId: img.mediaId,
          url: img.url,
        }));
        return {
          images: formatted,
          firstImageUrl: formatted[0]?.url,
          projectId: finalProjectId,
        };
      }

      let activeWin = win;
      let lastGenErr: any = null;
      const maxAttempts = typeof params.maxAttempts === 'number'
        ? Math.max(1, params.maxAttempts)
        : typeof params.maxRetries === 'number'
        ? Math.max(1, params.maxRetries + 1)
        : 3;
      const baseMs = typeof params.backoffBaseMs === 'number' ? params.backoffBaseMs : 10000;

      for (let attempt = 1; attempt <= maxAttempts; attempt++) {
        try {
          let captchaToken = CAPTCHA_SLOT;
          if (activeWin || this._sessionAdapter) {
            captchaToken = await this.mintCaptchaToken(activeWin, CAPTCHA_ACTION_IMAGE);
          }

          const innerPayload = buildGenImagePayload({
            prompt,
            aspectRatio,
            outputCount,
            referenceMediaIds,
            baseImageMediaId: baseImageAsset,
            imageModel,
            projectId,
            editAssetId,
            captchaToken,
            seed,
          });

          const data = await this.callFlowRPC(activeWin, RPC_GEN_IMAGE, innerPayload, projectId, {
            needsCaptcha: false,
            maxRetries: 0,
            label: `ogiZ0b(image:${prompt.slice(0, 30)})`,
          });

          const images = extractGeneratedImages(data);
          if (!images || images.length === 0) {
            throw new GoogleFlowRpcError(
              `Không trích xuất được ảnh nào từ response ogiZ0b. Raw data: ${JSON.stringify(data)?.slice(0, 300)}`,
              { code: 'UPSTREAM_ERROR', retryable: true }
            );
          }

          const formatted = images.map((img) => ({
            assetId: img.mediaId,
            mediaId: img.mediaId,
            url: img.url,
          }));

          return {
            images: formatted,
            firstImageUrl: formatted[0]?.url,
            projectId,
          };
        } catch (err: any) {
          lastGenErr = err;
          if (signal?.aborted) {
            throw new GoogleFlowRpcError('Tác vụ đã bị người dùng huỷ bỏ.', { code: 'CANCELLED', retryable: false });
          }
          const classified = classifyFlowRpcError(err);
          if (classified.code === 'CANCELLED') {
            throw classified;
          }
          const isUnusual = isUnusualActivityError(err);

          // PUBLIC_ERROR_UNUSUAL_ACTIVITY là tín hiệu bot challenge từ Google: Dừng an toàn, không retry
          if (isUnusual) {
            console.warn(
              `[GoogleFlowRpcClient] 🛡️ Phát hiện PUBLIC_ERROR_UNUSUAL_ACTIVITY (attempt ${attempt}/${maxAttempts}). ` +
              `Dừng workflow an toàn (ABORT_HALT), không retry tự động để bảo vệ tài khoản.`
            );
            throw classified;
          }

          if (attempt < maxAttempts && classified.retryable) {
            const delay = calculateExponentialBackoffMs(attempt - 1, baseMs, 120000);
            const waitMs = baseMs === 0 ? 0 : (classified.retryAfterMs ? Math.max(classified.retryAfterMs, delay) : delay);
            console.warn(
              `[GoogleFlowRpcClient] Sinh ảnh gặp lỗi [${classified.code}] (attempt ${attempt}/${maxAttempts}). ` +
              `Giãn cách lùi bước: chờ ${Math.round(waitMs / 1000)}s...`
            );
            await sleepWithSignal(waitMs, signal);
            continue;
          }
          throw classified;
        }
      }

      throw lastGenErr ? classifyFlowRpcError(lastGenErr) : new GoogleFlowRpcError('Sinh ảnh thất bại.', { code: 'UNKNOWN' });
      };

      try {
        return await Promise.race([executeGen(), timeoutPromise]);
      } finally {
        if (timeoutTimer) clearTimeout(timeoutTimer);
      }
    }, 'google_flow_rpc_generate_image');
  }

  /** Alias snake_case */
  public async generate_image(
    winOrParams: any,
    maybeOpts?: any
  ): Promise<RpcGenerateImageResult> {
    return this.generateImage(winOrParams, maybeOpts);
  }

  // ── Video Generation ───────────────────────────────────────────────────────

  /**
   * Gửi lệnh tạo video (generate_video) với các tham số:
   * prompt, aspect ratio, duration, input image asset và tùy chọn audio.
   * Hỗ trợ:
   * 1. generateVideo({ prompt, aspectRatio, duration, inputImageAsset, audio, ... })
   * 2. generateVideo(prompt, { aspectRatio, duration, inputImageAsset, ... })
   * 3. generateVideo(win, { prompt, aspectRatio, duration, ... })
   */
  public async generateVideo(
    winOrParams: any,
    maybePromptOrOpts?: any,
    maybeOpts?: any
  ): Promise<RpcGenerateVideoResult> {
    return await GoogleFlowBrowserMutex.getInstance().runExclusive(async () => {
      let params: GenerateVideoParams;

      if (typeof winOrParams === 'string') {
        if (typeof maybePromptOrOpts === 'string') {
          params = { prompt: winOrParams, projectId: maybePromptOrOpts, ...(typeof maybeOpts === 'object' ? maybeOpts : {}) };
        } else if (maybePromptOrOpts && typeof maybePromptOrOpts === 'object') {
          params = { prompt: winOrParams, ...maybePromptOrOpts };
        } else {
          params = { prompt: winOrParams };
        }
      } else if (typeof maybePromptOrOpts === 'string') {
        params = { win: winOrParams, prompt: maybePromptOrOpts, ...(typeof maybeOpts === 'object' ? maybeOpts : {}) };
      } else if (maybePromptOrOpts && typeof maybePromptOrOpts === 'object') {
        params = { ...maybePromptOrOpts, win: winOrParams };
      } else {
        params = winOrParams || {};
      }

      const {
        prompt,
        aspectRatio = params.aspect_ratio || '16:9',
        duration = params.duration_seconds ?? params.durationSeconds ?? 8,
        videoModel = params.video_model,
        audio,
        projectId = params.project_id || '',
        win,
        signal = params.signal,
      } = params;

      if (signal?.aborted) {
        throw new GoogleFlowRpcError('Tác vụ đã bị người dùng huỷ bỏ.', { code: 'CANCELLED', retryable: false });
      }

      const rawRefCandidate: unknown =
        params.referenceAssets ||
        params.reference_assets;

      if (projectId && projectId !== PROJECT_ID_SLOT) {
        this._lastProjectId = projectId;
      }

      let inputImageAsset =
        typeof params.inputImageAsset === 'string' && params.inputImageAsset
          ? params.inputImageAsset
          : typeof params.input_image_asset === 'string' && params.input_image_asset
          ? params.input_image_asset
          : typeof params.imageMediaId === 'string' && params.imageMediaId
          ? params.imageMediaId
          : Array.isArray(rawRefCandidate) && rawRefCandidate.length > 0
          ? (rawRefCandidate[0] as string)
          : typeof rawRefCandidate === 'string' && rawRefCandidate.trim()
          ? rawRefCandidate.trim()
          : undefined;

      if (!prompt || typeof prompt !== 'string' || prompt.trim().length === 0) {
        throw new GoogleFlowRpcError('Prompt tạo video không được để trống.', {
          code: 'INVALID_ARGUMENT',
          retryable: false,
        });
      }

      const timeoutMs = (params as any).timeoutMs || VIDEO_GEN_TIMEOUT_MS;
      let timeoutTimer: NodeJS.Timeout | null = null;
      const timeoutPromise = new Promise<never>((_, reject) => {
        timeoutTimer = setTimeout(() => {
          reject(
            new GoogleFlowRpcError(
              `Quá thời gian gửi yêu cầu tạo video từ Google Flow (Timeout ${Math.round(timeoutMs / 1000)}s).`,
              { code: 'TIMEOUT', retryable: true, suggestedAction: 'RETRY_WITH_BACKOFF' }
            )
          );
        }, timeoutMs);
      });

      const executeGenVideo = async (): Promise<RpcGenerateVideoResult> => {

      const parsedDuration = typeof duration === 'string' ? parseInt(duration, 10) : duration;
      const durationSec = parsedDuration && parsedDuration > 0 ? parsedDuration : 8;

      // Kiểm tra Extension Bridge nếu đang active trên Chrome
      const bridge = FlowBridgeServer.getInstance();
      if (bridge.isConnected()) {
        const resolvedProjectId = (projectId && projectId !== PROJECT_ID_SLOT) ? projectId.trim() : '';
        if (!resolvedProjectId) {
          throw new GoogleFlowRpcError('FLOW_PROJECT_REQUIRED: Chưa liên kết project Flow cho tác vụ. Không sử dụng project đang mở.', { code: 'INVALID_ARGUMENT', retryable: false });
        }
        const payloadProjectId = resolvedProjectId || PROJECT_ID_SLOT;
        const bridgeProjectId = resolvedProjectId || undefined;

        let resolvedVideoAsset = inputImageAsset;
        if (
          resolvedVideoAsset &&
          (resolvedVideoAsset.includes('/') || resolvedVideoAsset.includes('\\')) &&
          fs.existsSync(resolvedVideoAsset)
        ) {
          try {
            console.log(`[GoogleFlowRpcClient] 📤 Tự động upload frame đầu cho video từ đường dẫn local: ${resolvedVideoAsset}`);
            const uploaded = await this.uploadAsset(null, resolvedVideoAsset, bridgeProjectId || '');
            if (uploaded?.mediaId) {
              resolvedVideoAsset = uploaded.mediaId;
            }
          } catch (upErr: any) {
            console.warn(`[GoogleFlowRpcClient] ⚠️ Không thể upload frame đầu ${resolvedVideoAsset}: ${upErr?.message || upErr}`);
          }
        }

        console.log(`[GoogleFlowRpcClient] 🌐 [Chrome Extension Bridge] Đang tạo video (project: ${bridgeProjectId || 'auto-tab'}): "${prompt.slice(0, 40)}"...`);
        const rpcName = resolvedVideoAsset ? RPC_GEN_VIDEO_REFERENCES : RPC_GEN_VIDEO_TEXT;
        const innerPayload = resolvedVideoAsset
          ? buildGenVideoPayload({
              imageMediaId: resolvedVideoAsset,
              aspectRatio,
              durationSeconds: durationSec,
              videoModel,
              prompt,
              projectId: payloadProjectId,
              captchaToken: CAPTCHA_SLOT,
              audio,
            })
          : buildGenVideoTextPayload({
              prompt,
              aspectRatio,
              durationSeconds: durationSec,
              videoModel,
              projectId: payloadProjectId,
              captchaToken: CAPTCHA_SLOT,
              audio,
            });

        let rawText = '';
        try {
          rawText = await bridge.sendBatchRpc(
            rpcName,
            innerPayload,
            CAPTCHA_ACTION_VIDEO,
            bridgeProjectId,
            undefined,
            signal
          );
        } catch (bridgeErr: any) {
          throw classifyFlowRpcError(bridgeErr);
        }
        const res = parseBatchResponse(rawText, rpcName);
        if (!res.ok) {
          throw classifyFlowRpcError(new Error(`Extension Bridge video error: ${JSON.stringify(res.error)}`));
        }
        const opStatus = extractOperationStatus(res.data, rpcName);
        if (!opStatus.operationId) {
          throw new GoogleFlowRpcError(
            `Không thể trích xuất operationId từ phản hồi Extension video. Raw data: ${JSON.stringify(res.data)?.slice(0, 300)}`,
            { code: 'UPSTREAM_ERROR', retryable: true }
          );
        }
        return {
          operationId: opStatus.operationId,
          projectId: opStatus.projectId || resolvedProjectId || projectId,
          status: opStatus.status || 'RUNNING',
          done: opStatus.done,
          videoUrl: opStatus.videoUrl,
          imageUrl: opStatus.imageUrl,
        };
      }

      let activeWin = win;
      let lastVideoErr: any = null;
      const maxAttempts = typeof params.maxAttempts === 'number'
        ? Math.max(1, params.maxAttempts)
        : typeof params.maxRetries === 'number'
        ? Math.max(1, params.maxRetries + 1)
        : 3;
      const baseMs = typeof params.backoffBaseMs === 'number' ? params.backoffBaseMs : 10000;

      for (let attempt = 1; attempt <= maxAttempts; attempt++) {
        try {
          // Trường hợp 1: Text-to-Video nếu không có inputImageAsset
          if (!inputImageAsset) {
            let captchaToken = CAPTCHA_SLOT;
            if (activeWin || this._sessionAdapter) {
              captchaToken = await this.mintCaptchaToken(activeWin, CAPTCHA_ACTION_VIDEO);
            }
            const innerPayload = buildGenVideoTextPayload({
              prompt,
              aspectRatio,
              durationSeconds: durationSec,
              videoModel,
              projectId,
              captchaToken,
              audio,
            });

            const data = await this.callFlowRPC(activeWin, RPC_GEN_VIDEO_TEXT, innerPayload, projectId, {
              needsCaptcha: false,
              maxRetries: 0,
              label: 'YhhmEf(text2video)',
            });

            const status = extractOperationStatus(data, RPC_GEN_VIDEO_TEXT);
            if (!status.operationId) {
              throw new GoogleFlowRpcError(
                `Không thể trích xuất operationId từ phản hồi tạo video. Raw data: ${JSON.stringify(data)?.slice(0, 300)}`,
                {
                  code: 'UPSTREAM_ERROR',
                  retryable: true,
                  details: { data },
                }
              );
            }

            return {
              operationId: status.operationId,
              projectId: status.projectId || projectId,
              status: status.status || 'RUNNING',
              done: status.done,
              videoUrl: status.videoUrl,
              imageUrl: status.imageUrl,
            };
          }

          // Trường hợp 2: Image-to-Video / Reference-to-Video (MZZa6b)
          let resolvedVideoAsset = inputImageAsset;
          if (
            resolvedVideoAsset &&
            typeof resolvedVideoAsset === 'string' &&
            (resolvedVideoAsset.includes('/') || resolvedVideoAsset.includes('\\') || /\.(png|jpe?g|webp)$/i.test(resolvedVideoAsset)) &&
            fs.existsSync(resolvedVideoAsset)
          ) {
            try {
              console.log(`[GoogleFlowRpcClient] 📤 [Direct Mode] Tự động upload frame đầu cho video từ đường dẫn local: ${resolvedVideoAsset}`);
              const uploaded = await this.uploadAsset(activeWin, resolvedVideoAsset, projectId);
              if (uploaded?.mediaId) {
                resolvedVideoAsset = uploaded.mediaId;
                inputImageAsset = uploaded.mediaId;
              }
            } catch (upErr: any) {
              console.warn(`[GoogleFlowRpcClient] ⚠️ [Direct Mode] Không thể upload frame đầu ${resolvedVideoAsset}: ${upErr?.message || upErr}`);
            }
          }

          let captchaToken = CAPTCHA_SLOT;
          if (activeWin || this._sessionAdapter) {
            captchaToken = await this.mintCaptchaToken(activeWin, CAPTCHA_ACTION_VIDEO);
          }

          const innerPayload = buildGenVideoPayload({
            imageMediaId: resolvedVideoAsset,
            aspectRatio,
            durationSeconds: durationSec,
            videoModel,
            prompt,
            projectId,
            captchaToken,
            audio,
          });

          const data = await this.callFlowRPC(activeWin, RPC_GEN_VIDEO_REFERENCES, innerPayload, projectId, {
            needsCaptcha: false,
            maxRetries: 0,
            label: 'MZZa6b(video)',
          });

          const status = extractOperationStatus(data, RPC_GEN_VIDEO_REFERENCES);
          if (!status.operationId) {
            throw new GoogleFlowRpcError(
              `Không thể trích xuất operationId từ phản hồi tạo video tham chiếu. Raw data: ${JSON.stringify(data)?.slice(0, 300)}`,
              {
                code: 'UPSTREAM_ERROR',
                retryable: true,
                details: { data },
              }
            );
          }

          return {
            operationId: status.operationId,
            projectId: status.projectId || projectId,
            status: status.status || 'RUNNING',
            done: status.done,
            videoUrl: status.videoUrl,
            imageUrl: status.imageUrl,
          };
        } catch (err: any) {
          lastVideoErr = err;
          if (signal?.aborted) {
            throw new GoogleFlowRpcError('Tác vụ đã bị người dùng huỷ bỏ.', { code: 'CANCELLED', retryable: false });
          }
          const classified = classifyFlowRpcError(err);
          if (classified.code === 'CANCELLED') {
            throw classified;
          }
          const isUnusual = isUnusualActivityError(err);

          // PUBLIC_ERROR_UNUSUAL_ACTIVITY là tín hiệu bot challenge từ Google: Dừng an toàn, không retry
          if (isUnusual) {
            console.warn(
              `[GoogleFlowRpcClient] 🛡️ Phát hiện PUBLIC_ERROR_UNUSUAL_ACTIVITY (attempt ${attempt}/${maxAttempts}). ` +
              `Dừng workflow an toàn (ABORT_HALT), không retry tự động để bảo vệ tài khoản.`
            );
            throw classified;
          }

          if (attempt < maxAttempts && classified.retryable) {
            const delay = calculateExponentialBackoffMs(attempt - 1, baseMs, 120000);
            const waitMs = baseMs === 0 ? 0 : (classified.retryAfterMs ? Math.max(classified.retryAfterMs, delay) : delay);
            console.warn(
              `[GoogleFlowRpcClient] Sinh video gặp lỗi [${classified.code}] (attempt ${attempt}/${maxAttempts}). ` +
              `Giãn cách lùi bước: chờ ${Math.round(waitMs / 1000)}s...`
            );
            await sleepWithSignal(waitMs, signal);
            continue;
          }
          throw classified;
        }
      }

      throw lastVideoErr ? classifyFlowRpcError(lastVideoErr) : new GoogleFlowRpcError('Sinh video thất bại.', { code: 'UNKNOWN' });
      };

      try {
        return await Promise.race([executeGenVideo(), timeoutPromise]);
      } finally {
        if (timeoutTimer) clearTimeout(timeoutTimer);
      }
    }, 'google_flow_rpc_generate_video');
  }

  /** Alias snake_case */
  public async generate_video(
    winOrParams: any,
    maybeOpts?: any
  ): Promise<RpcGenerateVideoResult> {
    return this.generateVideo(winOrParams, maybeOpts);
  }

  // ── Polling State Machine & Status Extraction ──────────────────────────────

  /**
   * Async Polling State Machine theo dõi vòng đời tác vụ từ:
   * queued -> processing -> completed / failed.
   *
   * Dừng chính xác khi có kết quả hoặc khi gặp lỗi terminal.
   * Phân loại lỗi với mã trạng thái quan trọng (SESSION_EXPIRED, RATE_LIMITED, CONTENT_POLICY_VIOLATION).
   */
  public async pollGeneration(params: PollGenerationParams): Promise<PollGenerationResult> {
    const operationId = params.operationId || params.operation_id;
    const projectId = params.projectId || params.project_id || '';
    const targetAssetId = params.targetAssetId || params.target_asset_id;
    const pollIntervalMs = params.pollIntervalMs || params.poll_interval_ms || OPERATION_POLL_INTERVAL_MS;
    const timeoutMs = params.timeoutMs || params.timeout_ms || OPERATION_POLL_TIMEOUT_MS;
    const {
      onProgress,
      onStateChange,
      isCancelled,
      win,
    } = params;

    if (!operationId || typeof operationId !== 'string' || !operationId.trim()) {
      throw new GoogleFlowRpcError('Cần cung cấp operationId hợp lệ để polling.', {
        code: 'INVALID_ARGUMENT',
        retryable: false,
      });
    }

    const sm = new FlowPollingStateMachine(onStateChange);
    const startTime = Date.now();
    let pollCount = 0;

    const isCancelledFn = (): boolean => {
      if (params.isCancelled?.()) return true;
      if (params.signal?.aborted) return true;
      if (params.abortSignal?.aborted) return true;
      return false;
    };

    // Khởi đầu ở trạng thái 'queued'
    onProgress?.({
      state: 'queued',
      percentage: 5,
      message: 'Đang xếp hàng tạo video trên Google Flow...',
      elapsedMs: 0,
      pollCount: 0,
      operationId,
    });

    while (true) {
      if (isCancelledFn()) {
        if (!sm.isTerminal) sm.transitionTo('failed', 'Cancelled by user');
        throw new GoogleFlowRpcError('Tác vụ đã bị huỷ bởi người dùng.', {
          code: 'CANCELLED',
          retryable: false,
        });
      }

      const elapsed = Date.now() - startTime;
      if (elapsed >= timeoutMs) {
        if (!sm.isTerminal) sm.transitionTo('failed', `Timeout after ${elapsed}ms`);
        throw new GoogleFlowRpcError(
          `Polling operation timeout sau ${Math.round(elapsed / 1000)}s. Operation ${operationId} chưa hoàn tất.`,
          {
            code: 'TIMEOUT',
            retryable: true,
            suggestedAction: 'RETRY_WITH_BACKOFF',
          }
        );
      }

      pollCount++;

      try {
        const bridge = FlowBridgeServer.getInstance();
        const resolvedPollProjectId = (projectId && projectId !== PROJECT_ID_SLOT) ? projectId.trim() : '';
        if (bridge.isConnected() && !resolvedPollProjectId) {
          throw new GoogleFlowRpcError('FLOW_PROJECT_REQUIRED: Không xác định được project của tác vụ cần theo dõi.', { code: 'INVALID_ARGUMENT', retryable: false });
        }
        const payloadPollProjectId = resolvedPollProjectId || projectId || PROJECT_ID_SLOT;
        const bridgePollProjectId = resolvedPollProjectId || undefined;
        const innerPayload = buildPollOperationPayload(operationId, payloadPollProjectId);
        let data: unknown;
        if (bridge.isConnected()) {
          const rawText = await bridge.sendBatchRpc(
            RPC_OPERATION,
            innerPayload,
            undefined,
            bridgePollProjectId
          );
          const res = parseBatchResponse(rawText, RPC_OPERATION);
          if (!res.ok) {
            throw classifyFlowRpcError(new Error(`Extension Bridge poll error: ${JSON.stringify(res.error)}`));
          }
          data = res.data;
        } else {
          data = await this.callFlowRPC(win || null, RPC_OPERATION, innerPayload, projectId, {
            needsCaptcha: false,
            label: `jwpduf(poll#${pollCount})`,
          });
        }

        const status = extractPollStatus(data, operationId);

        // Kiểm tra lỗi terminal trực tiếp từ phản hồi của Google Flow
        if (status.error || status.status === 'FAILED' || status.status === 'ERROR' || status.status === 'REJECTED') {
          const errMsg = status.error || `Tác vụ generation thất bại với trạng thái: ${status.status}`;
          const classified = classifyFlowRpcError(new Error(errMsg), {
            rawResponse: JSON.stringify(data),
          });
          if (!sm.isTerminal) sm.transitionTo('failed', classified.message);
          throw new GoogleFlowRpcError(classified.message, {
            code: classified.code,
            retryable: false,
            httpStatus: classified.httpStatus,
            suggestedAction: (classified.suggestedAction as any) || 'ABORT_HALT',
            details: classified.details,
            cause: classified,
          });
        }

        const isStillQueued = status.status === 'QUEUED' || status.status === 'PENDING';
        if (isStillQueued) {
          onProgress?.({
            state: 'queued',
            percentage: 5,
            message: `Đang xếp hàng tạo video trên Google Flow... (${Math.round(elapsed / 1000)}s)`,
            elapsedMs: elapsed,
            pollCount,
            operationId,
          });
        } else {
          // Chuyển sang 'processing' nếu đang ở 'queued'
          if (sm.currentState === 'queued') {
            sm.transitionTo('processing', `Poll #${pollCount} active (status: ${status.status || 'RUNNING'})`);
          }

          const pct = Math.min(92, Math.round(10 + (elapsed / timeoutMs) * 80));
          onProgress?.({
            state: 'processing',
            percentage: pct,
            message: `Đang sinh video... (${Math.round(elapsed / 1000)}s)`,
            elapsedMs: elapsed,
            pollCount,
            operationId,
          });
        }

        // Kiểm tra hoàn tất
        if (status.done) {
          let videoUrl = status.videoUrl;
          let imageUrl = status.imageUrl;
          const targetId = targetAssetId || status.mediaId;

          // Nếu chưa có direct videoUrl, truy vấn thêm qua as29s
          if (!videoUrl && targetId) {
            try {
              videoUrl = (await this.getMediaUrl(targetId, projectId, win)) || undefined;
            } catch {}
          }

          // Fallback qua Zzl0ze nếu vẫn chưa có
          if (!videoUrl) {
            try {
              const allMedia = await this.listProjectMedia(projectId, win);
              const found = allMedia.find((m) => m.mediaId === targetId) || allMedia[allMedia.length - 1];
              videoUrl = found?.videoUrl;
              imageUrl = imageUrl || found?.imageUrl;
            } catch {}
          }

          sm.transitionTo('completed', `Done after ${elapsed}ms`);
          onProgress?.({
            state: 'completed',
            percentage: 100,
            message: 'Video đã sẵn sàng!',
            elapsedMs: elapsed,
            pollCount,
            operationId,
          });

          return {
            state: 'completed',
            operationId,
            assetId: targetId,
            videoUrl,
            imageUrl,
            elapsedMs: elapsed,
            pollCount,
          };
        }
      } catch (pollErr: any) {
        const classified = classifyFlowRpcError(pollErr);
        // Nếu là lỗi fatal không thể retry (session expired, vi phạm chính sách) -> dừng ngay
        if (!classified.retryable) {
          if (!sm.isTerminal) sm.transitionTo('failed', classified.message);
          throw classified;
        }
      }

      if (isCancelledFn()) {
        if (!sm.isTerminal) sm.transitionTo('failed', 'Cancelled by user');
        throw new GoogleFlowRpcError('Tác vụ đã bị huỷ bởi người dùng.', {
          code: 'CANCELLED',
          retryable: false,
        });
      }

      const safePollInterval = Math.max(10, pollIntervalMs);
      await new Promise<void>((resolve) => {
        let timer: any = null;
        const onAbort = () => {
          if (timer) clearTimeout(timer);
          cleanup();
          resolve();
        };
        const cleanup = () => {
          params.signal?.removeEventListener?.('abort', onAbort);
          params.abortSignal?.removeEventListener?.('abort', onAbort);
        };
        params.signal?.addEventListener?.('abort', onAbort);
        params.abortSignal?.addEventListener?.('abort', onAbort);
        timer = setTimeout(() => {
          cleanup();
          resolve();
        }, safePollInterval);
      });
    }
  }

  /** Alias snake_case */
  public async poll_generation(params: PollGenerationParams): Promise<PollGenerationResult> {
    return this.pollGeneration(params);
  }

  /**
   * Tương thích với FlowRpcClient.pollOperation cũ.
   */
  public async pollOperation(
    operationIdOrParams: string | PollGenerationParams,
    projectId?: string,
    onProgress?: (pct: number, msg: string) => void,
    isCancelled?: () => boolean
  ): Promise<OperationStatus> {
    if (typeof operationIdOrParams === 'object') {
      const res = await this.pollGeneration(operationIdOrParams);
      return {
        operationId: res.operationId,
        mediaId: res.assetId,
        videoUrl: res.videoUrl,
        imageUrl: res.imageUrl,
        done: true,
        status: 'CAE',
      };
    }

    let actualProjectId = typeof projectId === 'string' ? projectId : '';
    let actualOnProgress = onProgress;
    let actualIsCancelled = isCancelled;

    if (typeof projectId === 'function') {
      actualIsCancelled = onProgress as any;
      actualOnProgress = projectId;
      actualProjectId = '';
    }

    const res = await this.pollGeneration({
      operationId: operationIdOrParams,
      projectId: actualProjectId,
      onProgress: actualOnProgress ? (info) => actualOnProgress!(info.percentage, info.message) : undefined,
      isCancelled: actualIsCancelled,
    });

    return {
      operationId: res.operationId,
      mediaId: res.assetId,
      videoUrl: res.videoUrl,
      imageUrl: res.imageUrl,
      done: true,
      status: 'CAE',
    };
  }

  // ── Media & Project Helpers ────────────────────────────────────────────────

  /**
   * Lấy URL trực tiếp của 1 media item qua as29s RPC.
   */
  public async getMediaUrl(mediaId: string, projectId?: string, win?: any): Promise<string | null> {
    const innerPayload = buildMediaUrlPayload(mediaId);
    const bridge = FlowBridgeServer.getInstance();
    if (bridge.isConnected()) {
      try {
        const rawText = await bridge.sendBatchRpc(RPC_MEDIA, innerPayload, undefined, projectId);
        const res = parseBatchResponse(rawText, RPC_MEDIA);
        const raw = JSON.stringify(res.data);
        const videoMatch = raw.match(/https:\/\/[^"'\s\\]*(?:\.mp4|\.webm|\/video[^"'\s\\]*)/i) ||
          raw.match(/https:\/\/(?:flow-content\.google|storage\.googleapis\.com)[^"'\s\\]+/);
        if (videoMatch) return videoMatch[0];
      } catch (err: any) {
        console.warn(`[GoogleFlowRpcClient] getMediaUrl qua Bridge thất bại, fallback callFlowRPC:`, err?.message || err);
      }
    }
    const data = await this.callFlowRPC(win || null, RPC_MEDIA, innerPayload, projectId, {
      needsCaptcha: false,
      label: `as29s(mediaUrl:${mediaId.slice(0, 8)})`,
    });
    const rawText = JSON.stringify(data);
    const m = rawText.match(/https:\/\/[^"'\s\\]*(?:\.mp4|\.webm|\/video[^"'\s\\]*)/i) || rawText.match(/https:\/\/[^"'\s\\]+/);
    return m ? m[0] : null;
  }

  /**
   * Liệt kê danh sách media trong dự án qua Zzl0ze RPC.
   */
  public async listProjectMedia(projectId: string, win?: any): Promise<MediaUrls[]> {
    const innerPayload = buildListProjectMediaPayload(projectId);
    let data: unknown;
    const bridge = FlowBridgeServer.getInstance();
    if (bridge.isConnected()) {
      try {
        const rawText = await bridge.sendBatchRpc(RPC_PROJECT_MEDIA, innerPayload, undefined, projectId);
        const res = parseBatchResponse(rawText, RPC_PROJECT_MEDIA);
        data = res.data;
      } catch (err: any) {
        console.warn(`[GoogleFlowRpcClient] listProjectMedia qua Bridge thất bại, fallback callFlowRPC:`, err?.message || err);
      }
    }
    if (!data) {
      data = await this.callFlowRPC(win || null, RPC_PROJECT_MEDIA, innerPayload, projectId, {
        needsCaptcha: false,
        label: `Zzl0ze(listMedia)`,
      });
    }

    const results: MediaUrls[] = [];
    const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

    const findMedia = (node: unknown): void => {
      if (!Array.isArray(node)) return;
      const possibleMediaId = node.find((x) => typeof x === 'string' && UUID_RE.test(x)) as string | undefined;
      const videoUrl = node.find(
        (x) => typeof x === 'string' && x.includes('flow-content.google') && x.includes('.mp4')
      ) as string | undefined;
      const imageUrl = node.find(
        (x) => typeof x === 'string' && x.includes('flow-content.google') && !x.includes('.mp4')
      ) as string | undefined;

      if (possibleMediaId) {
        results.push({ mediaId: possibleMediaId, videoUrl, imageUrl });
      } else {
        for (const item of node) findMedia(item);
      }
    };

    findMedia(data);
    return results;
  }

  // ── Internal Helpers ───────────────────────────────────────────────────────

  private _extractMediaId(data: unknown): string | null {
    const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

    if (Array.isArray(data) && data.length > 0) {
      const firstRecord = data[0];
      if (Array.isArray(firstRecord) && firstRecord.length > 0) {
        const candidate = firstRecord[0];
        if (typeof candidate === 'string' && UUID_RE.test(candidate)) {
          return candidate;
        }
      }
      if (typeof firstRecord === 'string' && UUID_RE.test(firstRecord)) {
        return firstRecord;
      }
    }

    const findUuid = (node: unknown): string | null => {
      if (typeof node === 'string' && UUID_RE.test(node)) return node;
      if (Array.isArray(node)) {
        for (const item of node) {
          const found = findUuid(item);
          if (found) return found;
        }
      }
      return null;
    };

    return findUuid(data);
  }
}

// ══════════════════════════════════════════════════════════════════════════════
// 5. Singleton Helper
// ══════════════════════════════════════════════════════════════════════════════

let _defaultClient: GoogleFlowRpcClient | null = null;

export function getGoogleFlowRpcClient(partitionOrOptions?: string | GoogleFlowRpcClientOptions): GoogleFlowRpcClient {
  if (partitionOrOptions) {
    if (typeof partitionOrOptions === 'string') {
      if (!_defaultClient || _defaultClient.partition !== partitionOrOptions) {
        _defaultClient = new GoogleFlowRpcClient(partitionOrOptions);
      }
    } else {
      return new GoogleFlowRpcClient(partitionOrOptions);
    }
  } else if (!_defaultClient) {
    _defaultClient = new GoogleFlowRpcClient('persist:google_veo');
  }
  return _defaultClient;
}

getGoogleFlowRpcClient.reset = function (): void {
  _defaultClient = null;
};
