/**
 * main/browser-automation/types.ts
 *
 * Core TypeScript type definitions, interfaces, constants, and error classes
 * for the unified Browser Automation module in VANHSUB Desktop.
 */

import type { ChildProcess } from 'child_process';
import type { Browser, BrowserContext, Page } from 'playwright-core';

// =============================================================================
// 1. Port & Profile Constants
// =============================================================================

/**
 * Port 9222 is strictly reserved for Google Flow Extension Bridge (FlowBridgeServer WebSocket).
 * Under NO circumstances may any Chrome DevTools Protocol (CDP) session bind to 9222.
 */
export const RESERVED_BRIDGE_PORT = 9222;

/**
 * Default CDP port dedicated to ChatGPT Web automation.
 */
export const DEFAULT_CHATGPT_PORT = 9223;

/**
 * Default CDP port dedicated to Google Flow direct CDP automation.
 */
export const DEFAULT_FLOW_PORT = 9224;

/**
 * Default CDP port for generic or ad-hoc browser automation sessions.
 */
export const DEFAULT_GENERIC_PORT = 9225;

// =============================================================================
// 2. Automation Provider Types
// =============================================================================

/**
 * Supported automation providers across VANHSUB pipelines.
 */
export type AutomationProvider = 'chatgpt' | 'flow' | 'generic';

/**
 * Default port mapping per provider.
 */
export const DEFAULT_PROVIDER_PORTS: Record<AutomationProvider, number> = {
  chatgpt: DEFAULT_CHATGPT_PORT,
  flow: DEFAULT_FLOW_PORT,
  generic: DEFAULT_GENERIC_PORT,
};

/**
 * Default Chrome profile directory names per provider.
 */
export const DEFAULT_PROVIDER_PROFILE_NAMES: Record<AutomationProvider, string> = {
  chatgpt: 'chrome_chatgpt_profile',
  flow: 'chrome_flow_profile',
  generic: 'chrome_generic_profile',
};

// =============================================================================
// 3. Process Management Interfaces
// =============================================================================

export interface BrowserLaunchOptions {
  /** Target provider (chatgpt, flow, generic) */
  provider: AutomationProvider;
  /** Custom CDP port (defaults to provider port: 9223 for chatgpt, 9224 for flow). Port 9222 is strictly forbidden. */
  port?: number;
  /** Custom profile directory. Defaults to isolated directory per provider. */
  profileDir?: string;
  /** Whether to launch Chrome headless (default: false for login and anti-bot preservation) */
  headless?: boolean;
  /** Initial navigation URL upon launch */
  startUrl?: string;
  /** Explicit override for Chrome executable binary path */
  executablePath?: string;
  /** Window dimensions (default: 1280x800) */
  windowSize?: { width: number; height: number };
  /** Extra Chrome command line arguments */
  extraArgs?: string[];
  /** Liveness probe timeout in milliseconds (default: 15000ms) */
  timeoutMs?: number;
}

export interface BrowserProcessInfo {
  /** OS Process ID */
  pid: number | null;
  /** Active CDP port */
  port: number;
  /** Path to profile directory */
  profileDir: string;
  /** Whether process is currently alive */
  isAlive: boolean;
  /** Associated automation provider */
  provider: AutomationProvider;
  /** Timestamp when process was launched */
  launchedAt?: number;
  /** Whether this process was directly spawned by manager or discovered */
  spawnedByManager?: boolean;
}

export interface ManagedProcessRecord {
  provider: AutomationProvider;
  port: number;
  profileDir: string;
  pid: number | null;
  childProcess: ChildProcess | null;
  spawnedByManager: boolean;
  createdAt: number;
}

// =============================================================================
// 4. CDP Session & Client Interfaces
// =============================================================================

export interface BrowserSession {
  /** Automation provider */
  provider: AutomationProvider;
  /** Connected Playwright Browser instance */
  browser: Browser;
  /** Persistent BrowserContext (strictly contexts()[0]) */
  context: BrowserContext;
  /** Active CDP port */
  port: number;
  /** Cached active page */
  activePage?: Page;
  /** Connection timestamp */
  connectedAt: number;
}

export interface CdpConnectionOptions {
  /** Automation provider */
  provider?: AutomationProvider;
  /** Target CDP port (default: 9223 for chatgpt, 9224 for flow) */
  port?: number;
  /** Target CDP host (default: 127.0.0.1) */
  host?: string;
  /** Connection attempt timeout in ms (default: 10000ms) */
  timeoutMs?: number;
  /** Maximum retry attempts (default: 5) */
  maxRetries?: number;
  /** Base delay between retries in ms for exponential backoff (default: 500ms) */
  retryBaseDelayMs?: number;
  /** Initial navigation target URL */
  targetUrl?: string;
  /** Auto-reconnect flag on unexpected disconnects */
  autoReconnect?: boolean;
}

export type BrowserConnectionOptions = CdpConnectionOptions;

export type TabPredicate =
  | string
  | RegExp
  | ((pageOrUrl: Page | string, title?: string) => boolean | Promise<boolean>);

export interface TabRoutingOptions {
  targetUrl?: string;
  predicate?: TabPredicate;
  repurposeBlank?: boolean;    // default true
  bringToFront?: boolean;      // default false to avoid focus hijacking
  automationOwned?: boolean;   // mark tab as owned by automation
  timeoutMs?: number;         // default 30000
  waitUntil?: 'domcontentloaded' | 'load' | 'networkidle' | 'commit';
}

export interface SessionRecord {
  provider: AutomationProvider;
  port: number;
  host: string;
  browser: Browser;
  context: BrowserContext;
  activePage: Page | null;
  isDisconnecting: boolean;
  reconnectAttempts: number;
  lastConnectedAt: number;
  trackedPages?: WeakSet<Page>;
  disconnectedEmitted?: boolean;
}

// =============================================================================
// 5. Job Lifecycle & Observation Types
// =============================================================================

/**
 * Unified 8-state job lifecycle for AI media generation operations:
 * - 7 automated states: QUEUED, SUBMITTING, SUBMITTED, PROCESSING, COMPLETED, FAILED, TIMED_OUT
 * - 1 human-in-the-loop state: BLOCKED_REQUIRES_USER (when anti-bot challenge or reCAPTCHA is encountered)
 */
export type JobState =
  | 'NOT_SUBMITTED'
  | 'GENERATING'
  | 'RECONCILIATION_REQUIRED'
  | 'QUEUED'
  | 'SUBMITTING'
  | 'SUBMITTED'
  | 'PROCESSING'
  | 'COMPLETED'
  | 'FAILED'
  | 'TIMED_OUT'
  | 'BLOCKED_REQUIRES_USER';

export interface ObservationResult {
  completed: boolean;
  state: JobState;
  assetUrl?: string;
  mediaId?: string;
  error?: string;
  requiresUserAction?: boolean;
  details?: Record<string, any>;
}

export interface VisualJobRecord {
  jobId: string;
  idempotencyKey: string;
  state: JobState;
  createdAt: number;
  updatedAt: number;
  operationId?: string;
  mediaId?: string;
  localPath?: string;
  error?: string;
  retryCount: number;
}

export interface FlowGenerationAutomationOptions {
  beforeInput?: (page: Page, baseline: {assetIds:string[]}) => Promise<void>;
  onSubmissionState?: (state:'SUBMITTING'|'GENERATING'|'RECONCILIATION_REQUIRED'|'NOT_SUBMITTED'|'FAILED',details?:{assetId?:string;mediaUrl?:string;promptSha256?:string})=>Promise<void>;
  requireCreditApproval?: boolean;
  beforeSubmit?: (page: Page) => Promise<void>;
  prompt: string;
  projectId?: string;
  mode: 'image' | 'video';
  timeoutMs?: number;
  submissionTimeoutMs?: number;
  signal?: AbortSignal;
  jobId?: string;
  sceneId?: string;
  inputImageAsset?: string;
  referenceImage?: string;
  bringToFront?: boolean;
}

export interface FlowGenerationAutomationResult {
  remoteMediaReady?: boolean;
  promptSha256?: string;
  ok: boolean;
  state: JobState;
  jobId?: string;
  sceneId?: string;
  projectId?: string;
  firstImageUrl?: string;
  videoUrl?: string;
  assetId?: string;
  domFallback?: boolean;
  error?: string;
  errorCode?: string;
  capturedRpc?: {
    url: string;
    rpcid: string;
    status: number;
    response: string;
  };
}

export type FlowSessionState = 'FLOW_READY' | 'FLOW_LOADING' | 'LOGIN_REQUIRED' | 'SESSION_UNVERIFIED';

export interface FlowSessionDiagnostic {
  state: FlowSessionState;
  url: string;
  title: string;
  hasPromptBox: boolean;
  hasGenerateButton: boolean;
  hasAvatarOrAccount: boolean;
  accountSnippet?: string;
  hasSignInButton: boolean;
  isProjectLoaded: boolean;
  projectId?: string | null;
  loadingIndicatorPresent: boolean;
  diagnosticMessage: string;
}

// =============================================================================
// 6. Custom Error Hierarchy
// =============================================================================

/**
 * Thrown when any component attempts to bind or connect to port 9222 (reserved for FlowBridgeServer)
 * or when an illegal port conflict occurs between automation providers.
 */
export class PortConflictError extends Error {
  public readonly port: number;
  public readonly conflictingService: string;
  public readonly suggestedPort?: number;

  constructor(
    port: number | string,
    conflictingService = 'FlowBridgeServer',
    customMessage?: string
  ) {
    const numericPort = Number(String(port).trim());
    const message = customMessage || (
      numericPort === RESERVED_BRIDGE_PORT
        ? `[PortConflictError] Port 9222 is strictly reserved for Google Flow Extension Bridge (${conflictingService}). ` +
          `Direct CDP automation must use port 9223 for ChatGPT, 9224 for Google Flow, or another non-9222 port.`
        : `[PortConflictError] Port ${numericPort} conflicts with ${conflictingService}.`
    );
    super(message);
    this.name = 'PortConflictError';
    this.port = numericPort;
    this.conflictingService = conflictingService;
    this.suggestedPort = numericPort === RESERVED_BRIDGE_PORT ? DEFAULT_FLOW_PORT : undefined;
    Object.setPrototypeOf(this, PortConflictError.prototype);
  }
}

/**
 * Alias for PortConflictError for API compatibility.
 */
export class PortConflictGuardError extends PortConflictError {
  constructor(message: string, port: number | string = RESERVED_BRIDGE_PORT) {
    super(port, 'FlowBridgeServer', message);
    this.name = 'PortConflictGuardError';
    Object.setPrototypeOf(this, PortConflictGuardError.prototype);
  }
}

/**
 * Thrown when Chrome executable cannot be located on the host system.
 */
export class ChromeNotFoundError extends Error {
  public readonly checkedLocations?: string[];

  constructor(message = 'Google Chrome executable was not found on this system.', checkedLocations?: string[]) {
    super(`[ChromeNotFoundError] ${message}`);
    this.name = 'ChromeNotFoundError';
    this.checkedLocations = checkedLocations;
    Object.setPrototypeOf(this, ChromeNotFoundError.prototype);
  }
}

/**
 * Thrown when Chrome process launch or lifecycle operation fails.
 */
export class BrowserLaunchError extends Error {
  public readonly provider: AutomationProvider;
  public readonly chromePath?: string;
  public readonly port?: number;
  public readonly causeError?: Error;

  constructor(
    provider: AutomationProvider,
    message: string,
    options?: { chromePath?: string; port?: number; cause?: Error }
  ) {
    super(`[BrowserLaunchError][${provider}] ${message}`);
    this.name = 'BrowserLaunchError';
    this.provider = provider;
    this.chromePath = options?.chromePath;
    this.port = options?.port;
    this.causeError = options?.cause;
    Object.setPrototypeOf(this, BrowserLaunchError.prototype);
  }
}

/**
 * Thrown when browser fails to launch or reach liveness within timeout window.
 */
export class BrowserLaunchTimeoutError extends Error {
  public readonly port: number;
  public readonly timeoutMs: number;

  constructor(port: number, timeoutMs: number) {
    super(`[BrowserLaunchTimeoutError] Browser on port ${port} failed to reach liveness (/json/version) within ${timeoutMs}ms.`);
    this.name = 'BrowserLaunchTimeoutError';
    this.port = port;
    this.timeoutMs = timeoutMs;
    Object.setPrototypeOf(this, BrowserLaunchTimeoutError.prototype);
  }
}

/**
 * Thrown when Playwright CDP fails to attach or loses connection unrecoverably.
 */
export class CdpConnectionError extends Error {
  public readonly provider: AutomationProvider;
  public readonly endpoint: string;
  public readonly attemptCount: number;
  public readonly causeError?: Error;

  constructor(
    provider: AutomationProvider,
    endpoint: string,
    attemptCount: number,
    message: string,
    cause?: Error
  ) {
    super(`[CdpConnectionError][${provider}] Failed to connect to CDP at ${endpoint} after ${attemptCount} attempts: ${message}`);
    this.name = 'CdpConnectionError';
    this.provider = provider;
    this.endpoint = endpoint;
    this.attemptCount = attemptCount;
    this.causeError = cause;
    Object.setPrototypeOf(this, CdpConnectionError.prototype);
  }
}

/**
 * Thrown when attempting operations on an uninitialized or disconnected browser.
 */
export class BrowserNotConnectedError extends Error {
  public readonly provider: AutomationProvider;

  constructor(provider: AutomationProvider) {
    super(`[BrowserNotConnectedError] Browser for provider '${provider}' is not connected.`);
    this.name = 'BrowserNotConnectedError';
    this.provider = provider;
    Object.setPrototypeOf(this, BrowserNotConnectedError.prototype);
  }
}

/**
 * Thrown when persistent browser context (contexts()[0]) cannot be acquired.
 */
export class PersistentContextNotFoundError extends Error {
  public readonly provider: AutomationProvider;

  constructor(provider: AutomationProvider) {
    super(
      `[PersistentContextNotFoundError] Persistent Browser Context (contexts()[0]) not found for provider '${provider}'. ` +
      `Refusing to call browser.newContext() to prevent discarding stored credentials and cookies.`
    );
    this.name = 'PersistentContextNotFoundError';
    this.provider = provider;
    Object.setPrototypeOf(this, PersistentContextNotFoundError.prototype);
  }
}

/**
 * Thrown when a tab matching the predicate cannot be found.
 */
export class TabNotFoundError extends Error {
  public readonly provider: AutomationProvider;

  constructor(provider: AutomationProvider, message = 'Matching tab not found') {
    super(`[TabNotFoundError][${provider}] ${message}`);
    this.name = 'TabNotFoundError';
    this.provider = provider;
    Object.setPrototypeOf(this, TabNotFoundError.prototype);
  }
}

// =============================================================================
// 7. Security & Guard Utilities
// =============================================================================

/**
 * Preemptively asserts that a port is not the reserved bridge port 9222.
 * Robust against string coercion, whitespace, and falsy values.
 * Returns the numeric port if valid, or 0 if undefined/null.
 */
export function assertNotReservedPort(port: number | string | undefined | null): number {
  if (port === undefined || port === null) return 0;
  const rawStr = String(port).trim();
  const num = Number(rawStr);
  if (!isNaN(num) && num === RESERVED_BRIDGE_PORT) {
    throw new PortConflictError(num);
  }
  return num;
}
