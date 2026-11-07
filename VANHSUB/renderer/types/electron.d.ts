import type { Task, CreateTaskInput } from './task';
import type { MediaInspection } from '../../shared/mediaInspection';
import type {
  AiStudioConfig,
  DeepPartial,
  AiStudioVoiceConfig,
  AiStudioFlowEngineConfig,
  AiStudioRenderingConfig,
  AiStudioSubtitleConfig,
  PipelineSessionState,
  PipelineProgressEvent,
  IdeaBlueprint,
  SelfTestDiagnosticsResult,
  CapCutDraftExportResult,
} from './aiStudio';

export type SettingKey =
  | 'geminiApiKey'
  | 'geminiModel'
  | 'targetLanguage'
  | 'asrModel'
  | 'asrEngine'
  | 'asrDevice'
  | 'enableDiarization'
  | 'hfToken'
  | 'pythonPath'
  | 'exportDir'
  | 'translateBatchSize'
  | 'translateConcurrency'
  | 'autoTranslateAfterAsr'
  | 'vietTtsEndpoint'
  | 'ttsVoice'
  | 'ttsSpeed'
  | 'ttsAllowShortening'
  | 'ocrLanguage'
  | 'ocrFps'
  | 'ocrRegion'
  | 'ocrMode'
  | 'ocrCustomRegion'
  | 'ocrDualEngine'
  | 'glossary'
  | 'translationStyleGuide'
  | 'onboardingCompleted'
  | 'veoMode'
  | 'veoSessionCookie'
  | 'veoSessionAuthToken'
  | 'veoAccountEmail'
  | 'veoSessionStatus'
  | 'veoLastChecked'
  | 'veoCooldownSeconds';

export type OcrMode = 'auto' | 'bottom' | 'full' | 'custom';

export interface OcrCustomRegion {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface OcrStartOptions {
  mode?: OcrMode;
  customRegion?: OcrCustomRegion | null;
  language?: string;
  fps?: number;
  dualEngine?: boolean;
}

/** Giọng đọc clone từ file audio mẫu (đồng bộ với VoiceSample trong main/store) */
export interface VoiceSampleInfo {
  name: string;
  fileName: string;
  originalName: string;
  createdAt: string;
}

/**
 * Style phụ đề hardsub (đồng bộ với SubtitleStyle ở main/render/videoRenderer)
 */
export interface SubStyle {
  fontName: string;
  fontSize: number;
  primaryColour: string;
  outlineColour: string;
  opacity: number;
  outline: number;
  shadow: number;
  bold: boolean;
  borderStyle: 1 | 3;
  /** 1..9 theo Numpad: 1=BL, 2=BC, 3=BR, 4=ML, 5=C, 6=MR, 7=TL, 8=TC, 9=TR */
  alignment: 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9;
  marginV: number;
  marginH?: number;
  isVertical?: boolean;
  posPercent?: { x: number; y: number };
}

export interface SubMaskRegion {
  /** Vị trí dải che — phụ đề phim thường nằm ở đáy khung hình */
  position: 'bottom' | 'top';
  /** Chiều cao dải che theo % chiều cao khung hình (5-50) */
  heightPercent: number;
  /** solid = tô đen, blur = làm mờ vùng đó */
  mode: 'solid' | 'blur';
}

export interface PerLineSubtitleStyle {
  textColorHex?: string;
  outlineColorHex?: string;
  outlineWidth?: number;
  shadowDepth?: number;
  fontSize?: number;
  fontName?: string;
  bold?: boolean;
  italic?: boolean;
  alignment?: 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9;
  marginV?: number;
  marginH?: number;
  isVertical?: boolean;
  posPercent?: { x: number; y: number };
}

export type MaskMode = 'blur' | 'gaussian' | 'glass' | 'pixelate' | 'solid';

export interface CustomMaskRegion {
  id?: string;
  name?: string;
  xPercent: number;
  yPercent: number;
  widthPercent: number;
  heightPercent: number;
  mode: MaskMode;
  intensity?: number;
  colorHex?: string;
  startSec?: number;
  endSec?: number;
  enabled?: boolean;
}

export interface WatermarkOptions {
  type: 'text' | 'image';
  content: string;
  opacity?: number;
  scalePercent?: number;
  fontSize?: number;
  position: 'top_left' | 'top_right' | 'bottom_left' | 'bottom_right' | 'center' | 'custom' | 'floating' | 'bounce';
  customPos?: { xPercent: number; yPercent: number };
  speed?: 'slow' | 'medium' | 'fast';
}

export interface ExportFormatOptions {
  aspectRatio?: 'original' | '16:9' | '9:16' | '1:1';
  resolution?: 'original' | '1080p' | '720p' | '480p';
  fps?: number;
  bitrateKbps?: number;
  videoCodec?: 'libx264' | 'libx265';
  preset?: 'ultrafast' | 'veryfast' | 'fast' | 'medium';
  /** R4 CapCut Mini: Phản chiếu gương ngang (lật ngược video, giữ xuôi phụ đề & logo) */
  mirrorHorizontal?: boolean;
  /** R4 CapCut Mini: Tua nhanh video từ 1.00x đến 2.00x (bước 0.01x, ví dụ 1.02, 1.03) */
  speed?: number;
}

export interface DualSubtitleOption {
  enabled: boolean;
  layoutPreset?: 'douyin_music_left' | 'top_bottom_bilingual' | 'custom';
  secondaryStyle?: Partial<SubStyle>;
}

export type KineticPreset = 'none' | 'hormozi' | 'mrbeast' | 'minimalist_glow';

export interface KineticConfig {
  preset: KineticPreset;
  activeColor?: string;       // Hex color for highlight/karaoke, e.g. "#FFE500"
  enableEmoji?: boolean;      // For MrBeast preset
  emojiFrequency?: 'high' | 'medium' | 'low';
  enableProgressBar?: boolean;// For Minimalist Glow
  glowBlur?: number;          // \blur amount
  fontScale?: number;
}

export interface AdvancedExportOptions {
  videoSource?: 'auto' | 'original' | 'dubbed';
  perLineStyles?: Record<number, PerLineSubtitleStyle>;
  customMask?: CustomMaskRegion | null;
  customMasks?: CustomMaskRegion[] | null;
  watermark?: WatermarkOptions | null;
  formatOptions?: ExportFormatOptions | null;
  dualSubtitles?: DualSubtitleOption | null;
  kineticConfig?: KineticConfig | null;
}

export interface VanhsubAPI {
  tasks: {
    getAll: () => Promise<Task[]>;
    get: (id: string) => Promise<Task | undefined>;
    create: (input: CreateTaskInput) => Promise<Task>;
    update: (id: string, updates: Partial<Task>) => Promise<Task | undefined>;
    delete: (id: string) => Promise<boolean>;
    start: (id: string) => Promise<boolean>;
    cancel: (id: string) => Promise<boolean>;
    startHybrid: (id: string, options?: any) => Promise<boolean>;
    cancelHybrid: (id: string) => Promise<boolean>;
    readSrt: (srtPath: string) => Promise<string>;
    writeSrt: (srtPath: string, content: string) => Promise<boolean>;
    importSrt: (id: string, sourceSrtPath: string) => Promise<Task | undefined>;
    runPipeline: (id: string, opts?: { replaceAudio?: boolean }) => Promise<boolean>;
    runPipelineBatch: (ids: string[]) => Promise<number>;

    onUpdate: (callback: (tasks: Task[]) => void) => () => void;
  };
  settings: {
    get: (key: SettingKey) => Promise<any>;
    set: (key: SettingKey, value: unknown) => Promise<boolean>;
    onChange: (callback: (key: SettingKey) => void) => () => void;
  };
  ai: {
    polishLine: (payload: { text: string; prev?: string; next?: string }) => Promise<string>;
    translateLine: (payload: { text: string; targetLanguage?: string; prev?: string; next?: string }) => Promise<string>;
    cleanSubtitles: (items: Array<{ startMs: number; endMs: number; text: string }>) => Promise<Array<{ startMs: number; endMs: number; text: string }>>;
  };
  translate: {
    start: (id: string, targetLanguage?: string) => Promise<boolean>;
    cancel: (id: string) => Promise<boolean>;
  };
  tts: {
    start: (
      id: string,
      voice?: string,
      speed?: number,
      voiceOverrides?: Record<string, string>,
      engine?: 'viettts' | 'tiktok' | 'edge'
    ) => Promise<boolean>;
    cancel: (id: string) => Promise<boolean>;
    regenerateLine: (id: string, lineIndex: number, options?: {
      voice?: string; speed?: number; engine?: 'edge' | 'tiktok' | 'viettts'; voiceOverrides?: Record<string, string>
    }) => Promise<{ ok: boolean; error?: string }>;
    exportMergedAudio: (
      id: string,
      targetPath?: string,
      mode?: 'strict' | 'flexible'
    ) => Promise<{ ok: boolean; audioPath?: string; error?: string }>;
    voices: () => Promise<string[]>;
    getEdgeVoices: () => Promise<Array<{ id: string; name: string; gender: string; locale: string }>>;
    checkConnection: () => Promise<boolean>;
    preview: (
      text: string,
      voice?: string,
      speed?: number,
      engine?: 'viettts' | 'tiktok' | 'edge'
    ) => Promise<{ audioBase64: string; mimeType: string }>;
    voiceSamples: () => Promise<VoiceSampleInfo[]>;
    addVoiceSample: (
      name: string
    ) => Promise<{ canceled?: boolean; sample?: VoiceSampleInfo; samples?: VoiceSampleInfo[]; error?: string }>;
    addVoiceSampleFromUrl: (
      name: string,
      url: string
    ) => Promise<{ sample?: VoiceSampleInfo; samples?: VoiceSampleInfo[]; error?: string }>;
    removeVoiceSample: (name: string) => Promise<VoiceSampleInfo[]>;
  };
  dubbing: {
    start: (
      id: string,
      replaceAudio?: boolean,
      options?: { syncMode?: 'strict' | 'flexible' | 'video-stretch'; mixOriginalAudio?: boolean; vocalSeparation?: boolean }
    ) => Promise<boolean>;
  };
  tiktokTts: {
    status: () => Promise<{ hasSession: boolean }>;
    saveSession: (sessionId: string) => Promise<{ ok: boolean; error?: string }>;
    removeSession: () => Promise<{ ok: boolean; error?: string }>;
    validate: () => Promise<{ valid: boolean; detail: string }>;
    voices: () => Promise<
      { ok: true; voices: Array<{ id: string; label: string; language: string; gender?: string }> }
      | { ok: false; error: string }
    >;
    synthesize: (text: string, voice: string) => Promise<{ ok: true; filePath: string } | { ok: false; error: string }>;
  };
  veo: {
    openLobby: () => Promise<{ ok: boolean; error?: string }>;
    status: () => Promise<{
      mode: 'free_session' | 'api_key' | 'simulation';
      hasSession: boolean;
      sessionStatus: 'active' | 'expired' | 'unauthenticated' | 'rate_limited' | 'captcha_required' | 'out_of_credits' | 'unknown';
      email?: string;
      credits?: number | null;
      creditsCheckedAt?: number;
      lastChecked?: number;
      antiSpam: {
        allowed: boolean;
        remainingCooldownSec: number;
        cooldownTotalSec: number;
        warningMessage?: string;
        isLocked: boolean;
        lastRequestTimestamp: number;
      };
    }>;
    validate: () => Promise<{
      valid: boolean;
      status: 'active' | 'expired' | 'unauthenticated' | 'rate_limited' | 'captcha_required' | 'out_of_credits' | 'unknown';
      detail: string;
      email?: string;
      quotaRemaining?: string;
      lastChecked: number;
    }>;
    saveSession: (rawInput: string) => Promise<{ ok: boolean; result?: any; error?: string }>;
    clearSession: () => Promise<{ ok: boolean; error?: string }>;
    getAntiSpamStatus: () => Promise<{
      status: {
        allowed: boolean;
        remainingCooldownSec: number;
        cooldownTotalSec: number;
        warningMessage?: string;
        isLocked: boolean;
        lastRequestTimestamp: number;
      };
      guidelines: Array<{
        id: string;
        title: string;
        description: string;
        severity: 'high' | 'medium' | 'info';
        icon: string;
      }>;
    }>;
    setMode: (mode: 'free_session' | 'api_key' | 'simulation') => Promise<{ ok: boolean }>;
    getCredits: (maxAgeMs?: number) => Promise<number | null>;
    showLobbyDebug: () => Promise<boolean>;
    hideLobbyOffscreen: () => Promise<boolean>;
    isLobbyDebug: () => Promise<boolean>;
    openChrome: (url?: string) => Promise<{ ok: boolean; launchedPath?: string; fallback?: boolean; error?: string }>;
    openExtensionFolder: () => Promise<{ ok: boolean; path?: string; error?: string }>;
    openChromeExtensionsPage: () => Promise<{ ok: boolean; error?: string }>;
    bridgeStatus: () => Promise<{ running: boolean; connected: boolean; clientCount: number; port: number }>;
    createPairingCode: () => Promise<{ code: string; expiresAt: number }>;
    revokePairing: () => Promise<boolean>;
  };
  export: {
    start: (
      id: string,
      mode: 'hardsub' | 'softsub',
      mask?: SubMaskRegion | null,
      style?: SubStyle | null,
      advancedOptions?: AdvancedExportOptions | null
    ) => Promise<boolean>;
    separateStems: (id: string) => Promise<boolean>;
  };
  asr: {
    checkFasterWhisper: () => Promise<{ available: boolean; useCuda: boolean; reason?: string }>;
  };
  ocr: {
    start: (id: string, options?: OcrStartOptions) => Promise<boolean>;
    cancel: (id: string) => Promise<boolean>;
  };
  models: {
    list: () => Promise<Array<{ name: string; fileName: string; size: string; filePath: string }>>;
    delete: (modelName: string) => Promise<boolean>;
    /** Thư mục lưu model Whisper trên đĩa (để hiển thị vị trí ở Cài đặt) */
    directory: () => Promise<{ path: string; exists: boolean }>;
    getSystemInfo: () => Promise<{
      totalMemory: number;
      freeMemory: number;
      cpuCores: number;
      cpuModel: string;
      platform: string;
    }>;
  };
  dialog: {
    openMediaFile: () => Promise<string[] | null>;
    openVideoFile?: () => Promise<string | null>;
    openSrtFile: () => Promise<string | null>;
    openImageFile: () => Promise<string | null>;
    openAudioFile: () => Promise<string | null>;
    showInFolder: (filePath: string) => Promise<void>;
    openFolder: (folderPath: string) => Promise<void>;
    chooseDirectory: () => Promise<string | null>;
  };
  downloader: {
    inspect: (url: string) => Promise<{
      url: string;
      cleanUrl: string;
      platform: 'youtube' | 'douyin' | 'bilibili' | 'tiktok' | 'other';
      title: string;
      author?: string;
      duration?: number;
      durationFormatted?: string;
      thumbnail?: string;
      availableQualities: Array<{
        id: string;
        label: string;
      }>;
      /** URL MP4 không watermark — Douyin/TikTok only */
      noWatermarkUrl?: string;
    }>;
    download: (options: { url: string; quality?: string; noWatermarkUrl?: string; outputDir?: string; customFileName?: string; downloadId?: string; cleanMetadata?: boolean }) => Promise<{
      task: Task;
      result: any;
    }>;
    cancel: (downloadId?: string) => Promise<boolean>;
    checkTask: (taskId: string, target: 'source' | 'output') => Promise<MediaInspection>;
    cancelCheck: (taskId: string) => Promise<boolean>;
    getDefaultDir?: () => Promise<string>;
    onProgress: (callback: (progress: {
      percent: number;
      speed?: string;
      eta?: string;
      status: 'downloading' | 'processing' | 'completed' | 'error';
      stageDescription?: string;
    }) => void) => () => void;
  };
  files: {
    getPath: (file: File) => string;
    readImageAsDataUrl: (filePath: string) => Promise<string | null>;
  };
  logs: {
    onLog: (callback: (entry: { level: string; text: string; ts: number }) => void) => () => void;
  };
  workflow: {
    run: (graph: any) => Promise<{ success: boolean; outputs: Record<string, any>; error?: string }>;
    runNode: (graph: any, nodeId: string) => Promise<{ success: boolean; output?: any; error?: string }>;
    cancel: (workflowId: string) => Promise<boolean>;
    compareFrames: (frameA: string, frameB: string, config?: any) => Promise<{
      passed: boolean;
      score: number;
      colorDelta: number;
      status: 'pass' | 'warn' | 'fail';
      details: string;
    }>;
    concatClips: (clipPaths: string[], outPath?: string, options?: { effect?: string; duration?: number }) => Promise<string>;
    getVideoDuration: (videoPath: string) => Promise<number>;
    getTempStorageStats: () => Promise<{ tempDir: string; folderCount: number; fileCount: number; totalSizeBytes: number; totalSizeMb: number }>;
    cleanTempCache: (maxAgeHours?: number) => Promise<{ freedBytes: number; freedMb: number; deletedFolders: number; deletedFiles: number; errors: string[] }>;
    onNodeEvent: (callback: (event: any) => void) => () => void;
  };
  bible: {
    getCharacters: () => Promise<any[]>;
    saveCharacter: (profile: any) => Promise<any>;
    deleteCharacter: (id: string) => Promise<boolean>;
    getScenes: () => Promise<any[]>;
    saveScene: (profile: any) => Promise<any>;
    deleteScene: (id: string) => Promise<boolean>;
  };
  aiStudio: {
    getKokoroVoices: () => Promise<Array<{ id: string; name: string }>>;
    saveManualSeo: (input:{sessionId:string;title:string;description:string;hashtags:string[]}) => Promise<{session:PipelineSessionState;metadataPath:string}>;
    getPiperStatus: () => Promise<{ready:boolean;voice:string;language:string;cpuOnly:boolean;reason?:string}>;
    connectFlowReadOnly: () => Promise<{cdpConnected:boolean;profileVerified:boolean;bridgeConnected:boolean;sessionState:string;projectLoaded:boolean;creditBalance:null;creditPrice:null;liveGenerationVerified:false}>;
    getReadiness: () => Promise<{ready:boolean;provider:string;model:string;reasons:string[];warnings:string[];liveVerified:boolean}>;
    getMediaReadiness: (payload?:{sessionId?:string}) => Promise<{status:string;route:string;reasons:string[];liveVerified:boolean;requestsNeeded?:number;requestsUsed?:number}>;
    // Configuration (Milestone 1)
    getConfig: () => Promise<AiStudioConfig>;
    updateConfig: (updates: DeepPartial<AiStudioConfig>) => Promise<AiStudioConfig>;
    resetConfig: () => Promise<AiStudioConfig>;

    // Configuration Aliases
    get: () => Promise<AiStudioConfig>;
    set: (updates: DeepPartial<AiStudioConfig>) => Promise<AiStudioConfig>;
    reset: () => Promise<AiStudioConfig>;

    // Pipeline Execution (Milestone 2)
    startManualMedia: (payload: { projectId: string; srtPath: string; audioPath: string }) => Promise<{ sessionId: string }>;
    startPipeline: (payload: {
      topic: string;
      projectId?: string;
      blueprint?: IdeaBlueprint;
      gatedMode?: boolean;
      outputDir?: string;
      flowProjectUrl?: string;
      options?: DeepPartial<AiStudioConfig>;
    }) => Promise<{ sessionId: string }>;
    resumePipeline: (payload: {
      sessionId: string;
      fromStage?: number;
      mode?: 'resume_missing' | 'regenerate_selected' | 'regenerate_all';
      selectedShotIds?: string[];
      storyboardOptions?: { shotMode?: 'single' | 'multi'; granularity?: 'detailed' | 'balanced' | 'fast' };
      updatedArtifacts?: any;
    }) => Promise<{ success: boolean }>;
    cancelPipeline: (payload: { sessionId: string }) => Promise<{ success: boolean }>;
    getPipelineState: (payload: { sessionId: string }) => Promise<PipelineSessionState | null>;
    updateSceneFillMode: (payload: {
      sessionId: string;
      sceneIds?: string[];
      fillMode: 'freeze_last_frame' | 'none';
    }) => Promise<{ success: boolean; scenes?: StoryboardScene[] }>;

    // Granular Step Operations (Milestone 2)
    renderSingleLineVoice: (payload: {
      lineIndex: number;
      text: string;
      voiceConfig: AiStudioVoiceConfig;
    }) => Promise<{ audioPath: string; durationMs: number }>;
    regenerateSceneAsset: (payload: {
      sceneId: string;
      visualPrompt: string;
      flowConfig?: Partial<AiStudioFlowEngineConfig>;
      sessionId?: string;
      mode?: 'image' | 'video' | 'both';
    }) => Promise<{ assetPath: string; imagePath?: string; videoPath?: string; error?: string; errorCode?: string }>;
    importSceneMedia: (payload: {
      sessionId: string;
      sceneId: string;
      filePath: string;
      mediaType?: 'image' | 'video';
    }) => Promise<{ success: boolean; assetPath: string; imagePath?: string; videoPath?: string; error?: string }>;
    renderVideo: (payload: {
      sessionId: string;
      customSettings?: DeepPartial<AiStudioRenderingConfig & AiStudioSubtitleConfig>;
    }) => Promise<{ videoPath: string }>;

    // Chế độ từng bước & Tự động điền ý tưởng
    autoFillIdea: (payload: {
      topic: string;
      aspectRatio?: '16:9' | '9:16';
      channelProfile?: Partial<ChannelProfileConfig>;
    }) => Promise<{
      title: string;
      hookConcept: string;
      narrativeAngle: string;
      outline: string[];
      thumbnailConcept: string;
      thumbnailPrompt: string;
    }>;
    approveStage: (payload: {
      sessionId: string;
      currentStage: number;
      updatedArtifacts?: any;
    }) => Promise<{ success: boolean; nextStage?: number }>;
    generateMasterPrompt: (payload: {
      channelProfile: Partial<ChannelProfileConfig>;
    }) => Promise<{ masterPrompt: string; chatgptConversationUrl?: string }>;

    // Chấm điểm kịch bản & Chỉnh sửa kịch bản bằng AI
    evaluateScript: (payload: {
      sessionId?: string;
      lines: any[];
      blueprint?: any;
      channelProfile?: any;
    }) => Promise<{ evaluation: any; session?: import('./aiStudio').PipelineSessionState }>;
    refineScript: (payload: {
      sessionId?: string;
      lines: any[];
      instructions?: string;
      mode?: 'improve_weaknesses' | 'custom_prompt';
      blueprint?: any;
      channelProfile?: any;
    }) => Promise<{ lines: any[]; evaluation?: any; session?: import('./aiStudio').PipelineSessionState }>;
    updateScriptLines: (payload: {
      sessionId: string;
      lines: any[];
    }) => Promise<{ success: boolean; scriptLines: any[]; session?: import('./aiStudio').PipelineSessionState }>;

    // ChatGPT Web Automation (Zero API Cost Mode)
    checkChatGptLogin: () => Promise<{ isLoggedIn: boolean; userEmail?: string; sessionCheckedAt: number }>;
    openChatGptLogin: () => Promise<boolean>;
    closeChatGptLogin: () => Promise<{ success: boolean }>;
    logoutChatGptLogin: () => Promise<{ success: boolean }>;

    // Gemini Web Automation (Zero API Cost Mode)
    checkGeminiLogin: () => Promise<{ isLoggedIn: boolean; userEmail?: string; sessionCheckedAt: number }>;
    openGeminiLogin: () => Promise<boolean>;
    closeGeminiLogin: () => Promise<{ success: boolean }>;
    logoutGeminiLogin: () => Promise<{ success: boolean }>;

    // 1-Click Self-Test Diagnostics
    selfTestDiagnostics: () => Promise<SelfTestDiagnosticsResult>;

    // 1-Click CapCut Desktop Draft Export (Milestone 5)
    exportCapcutDraft: (
      payload: any,
      targetDir?: string
    ) => Promise<CapCutDraftExportResult>;

    // Push Event Subscription
    onPipelineProgress: (callback: (event: PipelineProgressEvent) => void) => () => void;
    onProgress: (callback: (event: PipelineProgressEvent) => void) => () => void;
  };
}

declare global {
  interface Window {
    vanhsub: VanhsubAPI;
    ipc: {
      send: (channel: string, value: any) => void;
      on: (channel: string, callback: (...args: any[]) => void) => () => void;
    };
    debug: {
      testRpcPhase1: (projectId: string) => Promise<any>;
      testUploadImage: (filePath: string, projectId: string) => Promise<any>;
      testGenImage: (prompt: string, projectId: string, refMediaIds?: string[]) => Promise<any>;
      testGenVideo: (prompt: string, projectId: string, sourceImagePath?: string) => Promise<any>;
      testFsmImage?: (prompt: string, projectId: string) => Promise<any>;
    };
  }
}
