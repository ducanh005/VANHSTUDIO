/**
 * Vanhsub AI Video Studio - Core TypeScript Schemas & Defaults
 * Conforms to AI_STUDIO_SPEC.md §5.1 & §5.2 and PROJECT.md
 */

// ============================================================================
// 1. Configuration Schemas (§5.1)
// ============================================================================

export type LlmProvider = 'deepseek' | 'openai' | 'custom' | 'chatgpt_web' | 'gemini_web';

export interface AiStudioLlmConfig {
  /** Nhà cung cấp mô hình ngôn ngữ lớn: 'deepseek' | 'openai' | 'custom' | 'chatgpt_web' | 'gemini_web' */
  provider: LlmProvider;
  /** API Key (được mã hóa DPAPI khi lưu trữ trên đĩa, tiền tố 'enc:v1:') */
  apiKey: string;
  /** Tên model định danh (vd: 'deepseek-chat', 'gpt-4o') */
  model: string;
  /** Base URL tùy chỉnh endpoint hoặc proxy (tùy chọn) */
  baseUrl?: string;
  /** Độ sáng tạo: 0.0 - 1.0 (mặc định 0.6) */
  temperature: number;
  /** Preset kịch bản: 'youtube_story' | 'tiktok_short' | 'affiliate_sales' | string */
  systemPromptPreset: string;
  /** Chế độ hiển thị khi dùng ChatGPT Web: 'offscreen' | 'visible' */
  chatgptWebMode?: 'offscreen' | 'visible';
  /** Chế độ hiển thị khi dùng Gemini Web: 'offscreen' | 'visible' */
  geminiWebMode?: 'offscreen' | 'visible';
}

export type TtsVoiceProvider = 'edge_tts' | 'tiktok_tts' | 'local_onnx' | 'piper_local';

export const TIKTOK_STUDIO_VOICES = [
  { id: 'BV074_streaming', label: 'Tiếng Việt — Nữ (BV074)', gender: 'female', lang: 'vi' },
  { id: 'BV075_streaming', label: 'Tiếng Việt — Nam (BV075)', gender: 'male', lang: 'vi' },
  { id: 'en_male_narration', label: 'Story Teller (English)', gender: 'male', lang: 'en' },
  { id: 'en_us_001', label: 'English US — Female', gender: 'female', lang: 'en' },
] as const;

export interface AiStudioVoiceConfig {
  /** Local Kokoro-FastAPI base URL; never starts or installs the service. */
  kokoroBaseUrl?: string;
  kokoroTimeoutMs?: number;
  /** Nhà cung cấp giọng đọc: 'edge_tts' | 'tiktok_tts' | 'local_onnx' */
  provider: TtsVoiceProvider;
  /** ID giọng đọc (vd: 'vi-VN-HoaiMyNeural', 'vi-VN-NamMinhNeural', 'BV074_streaming', 'BV075_streaming') */
  voiceId: string;
  /** Tốc độ đọc (vd: '-5%', '+0%', '+10%') */
  rate: string;
  /** Cao độ giọng (vd: '-2Hz', '+0Hz', '+2Hz') */
  pitch: string;
  /** Âm lượng giọng đọc (vd: '+0%') */
  volume: string;
  /** Tự động trích xuất timestamp từng từ qua metadata WordBoundary */
  autoWordAlignment: boolean;
}

export type FlowAspectRatio = '16:9' | '9:16' | '1:1';
export type FlowOutputMode = 'image' | 'video';
export type FlowShotMode = 'single' | 'multi';
export type FlowGranularity = 'detailed' | 'balanced' | 'fast';

export interface StoryboardSynthesis {
  total_shots: number;
  image_shots: number;
  video_shots: number;
  total_duration_sec: number;
  avg_duration_per_shot_sec: number;
  is_too_fragmented: boolean;
  warning?: string;
  estimated_production_time_sec: number;
  estimated_credits: number;
  granularity: FlowGranularity;
}

export interface AiStudioFlowEngineConfig {
  flowCreditConsent?: boolean;
  flowCreditProjectId?: string;
  flowGenerationLimit?: number;
  flowMaxCredits?: number;
  flowModelLabel?: string;
  flowAllowUnknownCost?: boolean;
  flowVideoMode?: 't2v' | 'i2v';
  /** Trusted episode context; never accepts a renderer-selected receipt path. */
  flowReceiptDir?: string;

  officialImageModel?: string;
  officialVideoModel?: string;
  officialVideoMode?: 't2v' | 'i2v';
  officialConsent?: boolean;
  officialConsentProjectId?: string;
  officialRequestLimit?: number;
  officialAllowTrim?: boolean;
  officialCostAcknowledged?: boolean;
  officialBudgetNote?: string;
  /** Runtime request identity for explicit regeneration; stable across retries. */
  generationNonce?: string;
  /** Động cơ sinh visual media: 'flow' (Google Flow Automation) | 'synthetic' | 'rpc' | 'flow_rpc' */
  engine?: 'flow' | 'synthetic' | 'rpc' | 'flow_rpc' | string;
  /** Mã dự án trên Google Flow (UUID hoặc target project ID) */
  projectId?: string;
  /** Tên dự án trên Google Flow */
  projectName?: string;
  /** @deprecated Bãi bỏ hoàn toàn trong Milestone 1 - Hệ thống không còn fallback sang synthetic scene card */
  allowSyntheticFallback?: boolean;
  /** @deprecated Bãi bỏ hoàn toàn trong Milestone 1 */
  fallbackToSynthetic?: boolean;
  /** Chế độ hiển thị cửa sổ sảnh Flow: 'offscreen' | 'live_window' */
  uiMode?: 'offscreen' | 'live_window';
  /** Tỷ lệ khung hình tạo ảnh/video: '16:9' | '9:16' | '1:1' */
  aspectRatio: FlowAspectRatio;
  /** Chế độ đầu ra từ Google Flow: 'image' (ảnh tĩnh) | 'video' (clip chuyển động) */
  outputMode: FlowOutputMode;
  /**
   * Chế độ phân cảnh thị giác (Visual Pacing):
   * - 'single' (Khuyến nghị mặc định): 1 câu kịch bản = 1 phân cảnh duy nhất (1:1), tiết kiệm thời gian & chi phí.
   * - 'multi': Tự động chia nhỏ câu thoại dài thành 2-4 góc quay con (Multi-shot cinematic).
   */
  shotMode?: FlowShotMode;
  /**
   * Mức độ chi tiết hoá phân cảnh (Granularity):
   * - 'detailed': Chi tiết theo từng câu (1 shot/câu, thời gian sản xuất & credit tối đa).
   * - 'balanced' (Mặc định): AI tự cân bằng, gộp các câu mô tả tĩnh liền kề thành 1 shot ảnh duy nhất kèm Ken Burns zoom/pan.
   * - 'fast': Ưu tiên gộp nhiều câu ngắn liền kề thành 1 shot dài hơn (~8-15s) để sản xuất nhanh nhất & tiết kiệm credit.
   */
  granularity?: FlowGranularity;
  /** Tiền tố phong cách hình ảnh (bổ sung vào prompt tiếng Anh) */
  stylePromptPrefix: string;
  /** Negative prompt loại bỏ chi tiết thừa */
  negativePrompt: string;
  /** Số biến thể ảnh sinh ra cho mỗi phân cảnh (1, 2, hoặc 4) */
  outputsPerScene: 1 | 2 | 4;
  /** Thư mục tải về lưu trữ assets sinh ra (rỗng = tự động theo thư mục dự án) */
  downloadDir: string;
  /** Đường dẫn tệp ảnh tham chiếu cục bộ (tùy chọn) */
  referenceImagePath?: string;
  /** Số task sinh đồng thời (khuyến nghị 1) */
  concurrency: number;
  /** Thời gian nghỉ bắt buộc (giây) giữa 2 cảnh liên tiếp (mặc định 8-12s) */
  cooldownSec?: number;
  /** Bỏ qua thời gian nghỉ cooldown (dùng cho test) */
  skipCooldown?: boolean;
  /** Số lần thử lại tối đa khi gặp lỗi tạm thời (RATE_LIMITED, UPSTREAM_ERROR, TIMEOUT) */
  maxRetries?: number;
  /** Thời gian cơ sở cho Exponential Backoff (ms, mặc định 10000ms = 10s) */
  backoffBaseMs?: number;
  /** Alias bật fallback tường minh */
  explicitFallback?: boolean;
  /** Ưu tiên sử dụng Direct UI Generation qua CDP Trusted Click (bỏ qua Pure RPC) */
  preferUiGen?: boolean;
  /** Thời gian chờ tối đa cho UI Generation (ms, mặc định 90000ms cho ảnh, 180000ms cho video) */
  uiTimeoutMs?: number;
  /** Cho phép tự động hạ cấp sang hiệu ứng Ken Burns khi sinh video AI thất bại (mặc định: false - không tự ý thay thế) */
  allowKenBurnsFallback?: boolean;
  /** Bật giải mã toàn bộ khung hình bằng FFmpeg khi xác thực media (mặc định: false) */
  fullMediaDecode?: boolean;
  /** Thời gian chờ tối đa khi giải mã FFmpeg (ms, mặc định: 30000ms = 30s) */
  mediaDecodeTimeoutMs?: number;
  /** API Key cho Official Gemini / Veo API (tùy chọn) */
  apiKey?: string;
}

export type RenderingResolution = '1080p' | '720p' | '4k';
export type RenderingFps = 30 | 60;

export interface AiStudioRenderingConfig {
  /** Độ phân giải video xuất xưởng: '1080p' | '720p' | '4k' */
  resolution: RenderingResolution;
  /** Tốc độ khung hình (FPS): 30 | 60 */
  fps: RenderingFps;
  /** Bật/tắt hiệu ứng chuyển động Ken Burns (Zoom/Pan ảnh tĩnh) */
  kenBurnsEffect: boolean;
  /** Tỷ lệ phóng to khi thực hiện Ken Burns (vd: 1.15) */
  kenBurnsScale: number;
  /** Thời gian chuyển cảnh giữa các phân cảnh (giây, vd: 0.5) */
  transitionDuration: number;
  /** Đường dẫn file nhạc nền mặc định (tùy chọn) */
  defaultBgmPath?: string;
  /** Âm lượng nhạc nền (0.05 - 0.20) */
  bgmVolume: number;
  /** Tự động hạ âm lượng nhạc nền khi có tiếng nói (Audio Ducking) */
  autoAudioDucking: boolean;
}

export type SubtitlePreset = 'tiktok_bold' | 'minimalist' | 'classic_bar' | 'karaoke_glow';

export interface AiStudioSubtitleConfig {
  /** Bật/tắt phụ đề gắn liền video (hardsub/burn-in) */
  enabled: boolean;
  /** Preset kiểu hiển thị phụ đề */
  preset: SubtitlePreset;
  /** Cỡ chữ phụ đề */
  fontSize: number;
  /** Mã màu chữ chính (Hex, vd: '#FFFFFF') */
  primaryColor: string;
  /** Mã màu viền chữ (Hex, vd: '#000000') */
  outlineColor: string;
  /** Độ dày viền chữ (pixels, vd: 3) */
  outlineWidth: number;
  /** Vị trí theo % chiều cao màn hình tính từ trên xuống (vd: 80) */
  positionY: number;
}

// ============================================================================
// 1.5 Channel Profile & Personality Settings (Cấu hình Kênh & Bộ não)
// ============================================================================

export type ChannelImageSource = 'ai_flow_meta' | 'ai_static' | 'ai_video';
export type ChannelSeriesType = 'anthology_new_topic' | 'connected_series' | 'standalone';
export type ChannelEvaluationLlm = 'gemini_web' | 'chatgpt_web' | 'deepseek' | 'openai';
export type ChannelLongDuration = '20_30_sec' | '1_3_min' | '3_5_min' | '5_8_min' | '8_12_min' | '12_18_min' | '18_28_min';
export type ChannelShortDuration = '30_60_sec' | '60_90_sec' | '90_120_sec' | '120_180_sec';
export type ChannelCharacterSync = 'per_video' | 'consistent_channel' | 'none';
export type ChannelCharacterImageMode = 'ai_draw' | 'upload_photo' | 'studio_preset';
export type ChannelVisualMode = 'blend' | 'image_only' | 'video_only';

export interface ChannelVideoStyle {
  id: string;
  name: string;
  description: string;
  systemPrompt?: string;
}

export interface ChannelProfileConfig {
  /** Tên project / Kênh */
  projectName?: string;
  /** Tên host đại diện */
  hostName?: string;
  /** Mô tả host đại diện để AI tạo */
  hostDescription?: string;
  /** Đường dẫn / URL ảnh host đại diện */
  hostAvatarUrl?: string;
  /** Danh sách nhân vật đại diện kênh */
  channelCharacters?: Array<{ id: string; name: string; descriptionEn: string; avatarUrl?: string }>;
  /** Phong cách bối cảnh & vũ trụ thị giác toàn dự án (áp dụng cố định cho Storyboard) */
  projectBackgroundPrompt?: string;
  /** Preset phong cách nghệ thuật thị giác đã chọn */
  visualArtStylePreset?: 'cinematic' | 'anime_ghibli' | 'dark_fantasy' | 'cyberpunk' | 'history_doc' | '3d_pixar' | 'custom' | string;
  /** Thư mục cục bộ tùy chọn để lưu ảnh và video (rỗng = mặc định thư mục dự án) */
  customMediaDir?: string;
  /** Chế độ hiển thị cửa sổ Google Flow: 'live_window' (mở cửa sổ trực tiếp) | 'offscreen' (chạy ngầm) */
  flowUiMode?: 'offscreen' | 'live_window';
  /** 1. Nguồn hình */
  imageSource: ChannelImageSource;
  /** 2. Kiểu video (bộ não AI) đã chọn */
  videoStyleId: string;
  /** Danh sách các kiểu video tùy biến */
  videoStyles: ChannelVideoStyle[];
  /** 3. Ngách của kênh (gõ cụ thể để khác biệt) */
  channelNiche: string;
  /** 4. Kiểu chuỗi tập (chống trùng chủ đề) */
  seriesType: ChannelSeriesType;
  /** 5. Mô tả chi tiết kênh */
  channelDescription: string;
  /** 6. Định hướng kênh */
  channelOrientation: string;
  /** 7. Master prompt viết kịch bản */
  masterPrompt: string;
  /** URL cuộc trò chuyện ChatGPT Web tương ứng với kênh (để giữ ngữ cảnh xuyên suốt) */
  chatgptConversationUrl?: string;
  /** 8. Tra cứu dữ kiện trước khi viết */
  researchFactBeforeWrite: boolean;
  /** 9. AI chấm điểm & cải thiện kịch bản */
  evaluationLlm: ChannelEvaluationLlm;
  /** 10. Hook của kênh (câu chốt thương hiệu) */
  channelHook: string;
  /** 11. Độ dài Video dài mục tiêu */
  targetLongDuration: ChannelLongDuration;
  /** 12. Độ dài Shorts mục tiêu */
  targetShortDuration: ChannelShortDuration;
  /** 13. AI provider (văn bản) */
  aiProvider: 'default' | 'chatgpt_web' | 'gemini_web' | 'deepseek' | 'openai';
  /** 14. Giọng đọc (TTS) */
  ttsEngine: 'edge_tts' | 'tiktok_tts' | 'kokoro_tts' | 'piper_local';
  /** 15. Giọng cụ thể */
  specificVoice: string;
  /** 16. Đồng bộ nhân vật */
  characterSync: ChannelCharacterSync;
  /** 17. Vai của nhân vật đại diện */
  characterRole: string;
  /** 18. Ảnh nhân vật */
  characterImageMode: ChannelCharacterImageMode;
  /** 19. Profile Chrome của kênh */
  chromeProfile: string;
  /** 20. Tạo ảnh/video bằng */
  visualEngine: 'google_flow' | 'comfyui' | 'mock';
  /** 21. Chế độ hình */
  visualMode: ChannelVisualMode;
  /** 22. Số cảnh video mở đầu */
  videoScenesIntro: number;
  /** 23. Số cảnh video phần thân */
  videoScenesBody: number;
  /** 24. Thời gian ảnh tĩnh min (giây) */
  staticImageDurationMin: number;
  /** 25. Thời gian ảnh tĩnh max (giây) */
  staticImageDurationMax: number;
  /** 26. Model video */
  videoModel: string;
  /** 27. Model ảnh */
  imageModel: string;
}

export interface SavedProjectProfile {
  id: string;
  name: string;
  channelProfile: ChannelProfileConfig;
  flowConfig?: Partial<AiStudioFlowEngineConfig>;
  updatedAt: number;
  /** Thư mục xuất dữ liệu thực tế trên ổ đĩa cho project này */
  outputDir?: string;
  /** Link hoặc mã dự án trên Google Flow (vd: https://flow.google.com/project/...) */
  flowProjectUrl?: string;
  /** Danh sách các ý tưởng đã sinh/thiết lập cho project này */
  ideas?: IdeaBlueprint[];
  /** Ý tưởng đang chọn hoặc sản xuất gần nhất */
  selectedIdea?: IdeaBlueprint | null;
  /** ID phiên pipeline gần nhất của project */
  lastSessionId?: string;
  /** Trạng thái phiên làm việc gần nhất (Kịch bản, phân cảnh, điểm số, v.v.) */
  savedSession?: PipelineSessionState | null;
}

export interface AiStudioConfig {
  /** 1. LLM Settings (Kịch bản & Phân tích) */
  llm: AiStudioLlmConfig;
  /** 2. TTS & Voice Settings (Giọng đọc & Lồng tiếng) */
  voice: AiStudioVoiceConfig;
  /** 3. Google Flow Engine Settings (Sinh Ảnh & Video) */
  flowEngine: AiStudioFlowEngineConfig;
  /** 4. Video Assembly & Rendering (Dựng phim FFmpeg) */
  rendering: AiStudioRenderingConfig;
  /** 5. Subtitle Styling (Đặc tính phụ đề gắn liền video) */
  subtitles: AiStudioSubtitleConfig;
  /** 6. Channel Profile Settings (Cấu hình Kênh & Bộ não) */
  channelProfile?: ChannelProfileConfig;
  /** Thư mục xuất dữ liệu thực tế mặc định hoặc của project hiện hành */
  outputDir?: string;
  /** Link hoặc mã dự án Google Flow của project hiện hành */
  flowProjectUrl?: string;
  /** 7. Danh sách các project / kênh đã lưu */
  savedProjects?: SavedProjectProfile[];
  /** ID của project đang được kích hoạt */
  activeProjectId?: string;
}

/** Deep partial type for safe partial updates */
export type DeepPartial<T> = {
  [P in keyof T]?: NonNullable<T[P]> extends (infer U)[]
    ? T[P]
    : NonNullable<T[P]> extends ReadonlyArray<infer U>
    ? T[P]
    : NonNullable<T[P]> extends Function
    ? T[P]
    : NonNullable<T[P]> extends object
    ? DeepPartial<NonNullable<T[P]>> | (null extends T[P] ? null : never)
    : T[P];
};

export type PartialAiStudioConfig = DeepPartial<AiStudioConfig>;

// ============================================================================
// 2. Default Constants Matching AI_STUDIO_SPEC.md §5.2
// ============================================================================

export const DEFAULT_LLM_CONFIG: Readonly<AiStudioLlmConfig> = Object.freeze({
  provider: 'gemini_web',
  geminiWebMode: 'visible',
  apiKey: '',
  model: '',
  baseUrl: '',
  temperature: 0.6,
  systemPromptPreset: 'youtube_story',
});

export const DEFAULT_VOICE_CONFIG: Readonly<AiStudioVoiceConfig> = Object.freeze({
  provider: 'piper_local',
  voiceId: 'vi_VN-vais1000-medium',
  rate: '+0%',
  pitch: '+0Hz',
  volume: '+0%',
  autoWordAlignment: true,
});

export const DEFAULT_FLOW_ENGINE_CONFIG: Readonly<AiStudioFlowEngineConfig> = Object.freeze({
  engine: 'playwright',
  uiMode: 'live_window',
  preferUiGen: true,
  maxRetries: 0,
  flowVideoMode: 't2v',
  flowGenerationLimit: 1,
  flowCreditConsent: false,
  aspectRatio: '16:9',
  outputMode: 'image',
  shotMode: 'single',
  granularity: 'balanced',
  stylePromptPrefix: 'Cinematic lighting, high resolution, detailed photorealistic, 4k',
  negativePrompt: 'watermark, text, blurry, distortion, lowres, no text, no subtitles, no speech bubbles, no words, clean visual illustration',
  outputsPerScene: 1,
  downloadDir: '',
  concurrency: 1,
});

export const DEFAULT_RENDERING_CONFIG: Readonly<AiStudioRenderingConfig> = Object.freeze({
  resolution: '1080p',
  fps: 30,
  kenBurnsEffect: true,
  kenBurnsScale: 1.15,
  transitionDuration: 0.5,
  defaultBgmPath: '',
  bgmVolume: 0.12,
  autoAudioDucking: true,
});

export const DEFAULT_SUBTITLE_CONFIG: Readonly<AiStudioSubtitleConfig> = Object.freeze({
  enabled: true,
  preset: 'tiktok_bold',
  fontSize: 24,
  primaryColor: '#FFFFFF',
  outlineColor: '#000000',
  outlineWidth: 3,
  positionY: 80,
});

export const DEFAULT_CHANNEL_PROFILE_CONFIG: Readonly<ChannelProfileConfig> = Object.freeze({
  imageSource: 'ai_flow_meta',
  videoStyleId: '',
  videoStyles: [
    {
      id: 'survival_documentary',
      name: 'Sinh tồn & Lịch sử tiền sử',
      description: 'Phong cách kịch tính, chân thực về đời sống và sinh tồn con người thời kỳ cổ xưa',
      systemPrompt: 'Phong cách kể chuyện sinh tồn tiền sử, nhấn mạnh vào sự khắc nghiệt của thiên nhiên, bản năng sinh tồn và khám phá khảo cổ.',
    },
    {
      id: 'science_mystery',
      name: 'Khoa học & Bí ẩn đại dương',
      description: 'Khám phá những hiện tượng khoa học chưa có lời giải và thế giới tự nhiên bí ẩn',
      systemPrompt: 'Phong cách phóng sự tài liệu khoa học khám phá, logic chặt chẽ, tạo cảm giác tò mò và thán phục.',
    },
    {
      id: 'finance_wealth',
      name: 'Tài chính & Kinh tế vĩ mô',
      description: 'Phân tích dòng tiền, sự kiện kinh tế lớn và bài học đầu tư thực chiến',
      systemPrompt: 'Phong cách chuyên gia tài chính sắc bén, góc nhìn thực tế, ngôn từ cuốn hút và có tính cảnh báo.',
    },
  ],
  projectName: '',
  hostName: '',
  hostDescription: '',
  hostAvatarUrl: '',
  channelCharacters: [],
  channelNiche: '',
  seriesType: 'anthology_new_topic',
  channelDescription: '',
  channelOrientation: '',
  masterPrompt: '',
  researchFactBeforeWrite: false,
  evaluationLlm: 'gemini_web',
  channelHook: '',
  targetLongDuration: '3_5_min',
  targetShortDuration: '90_120_sec',
  aiProvider: 'default',
  ttsEngine: 'piper_local',
  specificVoice: 'vi_VN-vais1000-medium',
  characterSync: 'per_video',
  characterRole: '',
  characterImageMode: 'ai_draw',
  chromeProfile: 'auto',
  visualEngine: 'google_flow',
  visualMode: 'blend',
  videoScenesIntro: 3,
  videoScenesBody: 10,
  staticImageDurationMin: 5,
  staticImageDurationMax: 8,
  videoModel: 'Omni 1.1 Flash',
  imageModel: '⭐ Nano Banana 2',
});

export const DEFAULT_AI_STUDIO_CONFIG: Readonly<AiStudioConfig> = Object.freeze({
  llm: DEFAULT_LLM_CONFIG,
  voice: DEFAULT_VOICE_CONFIG,
  flowEngine: DEFAULT_FLOW_ENGINE_CONFIG,
  rendering: DEFAULT_RENDERING_CONFIG,
  subtitles: DEFAULT_SUBTITLE_CONFIG,
  channelProfile: DEFAULT_CHANNEL_PROFILE_CONFIG,
  savedProjects: [],
  activeProjectId: '',
});

// ============================================================================
// 3. UI Catalog & Preset Metadata
// ============================================================================

export interface SystemPromptPresetOption {
  id: string;
  name: string;
  description: string;
}

export const SYSTEM_PROMPT_PRESETS: ReadonlyArray<SystemPromptPresetOption> = Object.freeze([
  {
    id: 'youtube_story',
    name: 'Kể chuyện / Review phim (YouTube)',
    description: 'Phong cách dẫn dắt lôi cuốn, mở đầu kịch tính, nhịp điệu vừa phải',
  },
  {
    id: 'tiktok_short',
    name: 'Viral Short / TikTok',
    description: 'Tiết tấu dồn dập, giật hook ngay 3 giây đầu, giữ chân người xem cao',
  },
  {
    id: 'affiliate_sales',
    name: 'Bán hàng / Review sản phẩm',
    description: 'Tập trung vào nỗi đau khách hàng, nêu giải pháp và kêu gọi hành động (CTA)',
  },
  {
    id: 'explainer_edu',
    name: 'Kiến thức / Phổ biến khoa học',
    description: 'Rõ ràng, ngắn gọn, dùng các phép so sánh hình ảnh dễ liên tưởng',
  },
]);

export interface EdgeTtsVoiceOption {
  id: string;
  name: string;
  gender: 'female' | 'male';
  locale: string;
  description: string;
}

export const EDGE_TTS_VOICES: ReadonlyArray<EdgeTtsVoiceOption> = Object.freeze([
  {
    id: 'vi-VN-HoaiMyNeural',
    name: 'Hoài My (Nữ)',
    gender: 'female',
    locale: 'vi-VN',
    description: 'Giọng nữ chuẩn Hà Nội, tự nhiên, truyền cảm, phù hợp kể chuyện và tin tức',
  },
  {
    id: 'vi-VN-NamMinhNeural',
    name: 'Nam Minh (Nam)',
    gender: 'male',
    locale: 'vi-VN',
    description: 'Giọng nam trầm ấm, đĩnh đạc, phù hợp review phim và tài liệu',
  },
]);

// ============================================================================
// 4. Pipeline Engine & Checkpoint State Types (M2/M3 Contract)
// ============================================================================

export type AiStudioStageId = 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8;

export type AiStudioStageName =
  | 'source'
  | 'script'
  | 'voice'
  | 'alignment'
  | 'storyboard'
  | 'visuals'
  | 'render'
  | 'metadata';

export type AiStudioStageStatus = 'pending' | 'running' | 'success' | 'error' | 'skipped';

export type CameraAngleType =
  | 'wide_establishing'
  | 'medium_shot'
  | 'close_up'
  | 'low_angle'
  | 'high_angle'
  | 'point_of_view'
  | 'extreme_close_up'
  | 'extreme_wide'
  | 'dutch_angle'
  | 'over_the_shoulder';

export type CameraMovementType =
  | 'pan_left_to_right'
  | 'pan_right_to_left'
  | 'dolly_in'
  | 'dolly_out'
  | 'pedestal_up'
  | 'static'
  | 'ken_burns_pan_zoom'
  | 'tilt_up'
  | 'tilt_down'
  | 'tracking'
  | 'orbit'
  | 'crane'
  | 'handheld_shake';

export interface CinematographyPlan {
  media_type: 'video' | 'image';
  camera_angle:
    | 'wide_establishing'
    | 'medium_shot'
    | 'close_up'
    | 'low_angle'
    | 'high_angle'
    | 'point_of_view';
  camera_motion:
    | 'pan_left_to_right'
    | 'pan_right_to_left'
    | 'dolly_in'
    | 'dolly_out'
    | 'pedestal_up'
    | 'static';
  duration_sec: number;
  visual_action_description: string;
}

export interface ScriptBeatLine {
  id: string;
  index: number;
  speaker?: string;
  // Column 1: Voiceover (Audio)
  text: string;
  voiceDirection?: string;
  // Column 2: Visual Action & Camera Movement
  visualAction?: string;
  visualNote?: string;
  cameraAngle?: CameraAngleType | string;
  cameraMovement?: CameraMovementType | string;
  suggestedMediaType?: 'image' | 'video';
  // Timing & Artifacts
  startMs?: number;
  endMs?: number;
  durationMs?: number;
  audioPath?: string;
  visualPromptEn?: string;
  assetPath?: string;
  assetType?: 'image' | 'video';
  estimatedDurationSec?: number;
  beatType?: 'hook' | 'intro' | 'body' | 'climax' | 'outro';
}

export interface WordTimestamp {
  word: string;
  startMs: number;
  endMs: number;
}

export interface StoryboardScene {
  officialGenerationNonce?: string;
  officialTrimAllowed?: boolean;
  manualMediaOnly?: boolean;
  mediaProvenance?: { source: 'manual_import'; assetPath: string; sha256: string; importedAt: string; sessionId: string; sceneId: string; projectId?: string; automaticGeneration: false }
    | { source:'google_flow_ui';assetPath:string;sha256:string;projectId:string;sessionId:string;sceneId:string;requestKey:string;assetId?:string;referenceSha256?:string;automaticGeneration:true;quotedCredits:number|null;actualCredits:null;hardCapVerified:false }
    | { source:'official_api';provider:'official_gemini_api';model:string;task:'t2i'|'t2v'|'i2v';assetPath:string;sha256:string;sessionId:string;sceneId:string;projectId:string;requestKey:string;requestId?:string;referenceSha256?:string;generatedAt:string;automaticGeneration:true;durationSec?:number;width:number;height:number;fps?:number };
  id: string;
  shotId?: string;
  sceneId?: string;
  sceneNumber?: number;
  index?: number;
  lineIndex: number;
  startMs: number;
  endMs: number;
  durationMs: number;
  lineText: string;
  visualPrompt: string;
  motionPrompt?: string;
  negativePrompt?: string;
  motionType: 'ken_burns' | 'video';
  assetPath?: string;
  imagePath?: string;
  videoPath?: string;
  referenceImagePath?: string;
  referenceAssets?: string[];
  inputImageAsset?: string;
  status: 'pending' | 'generating' | 'ready' | 'error';
  error?: string;
  fillMode?: 'freeze_last_frame' | 'none';
  originalMediaDurationSec?: number;
}

export interface SeoMetadata {
  source?: 'provider' | 'manual_authored';
  title: string;
  description: string;
  hashtags: string[];
  thumbnailPrompt: string;
}

export interface IdeaBlueprint {
  topic: string;
  title?: string;
  aspectRatio?: '16:9' | '9:16';
  targetAudience?: string;
  narrativeAngle: string;
  hookConcept: string;
  pacing?: 'fast' | 'moderate' | 'slow';
  estimatedDurationSec?: number;
  keyBeats?: string[];
  outline?: string[];
  existingScript?: string;
  thumbnailConcept?: string;
  thumbnailPrompt?: string;
  rawSummary?: string;
}

export interface ScriptQualityAuditResult {
  retentionScore: number;
  hookScore: number;
  pacingScore: number;
  hookAnalysis: string;
  retentionLoopSuggestions: string[];
  ctaEvaluation: string;
  overallFeedback: string;
}

export interface PipelineSessionState {
  manualMode?: boolean;
  productionRevision?: number;
  sessionId: string;
  /** Runtime only; recomputed on lookup. */
  jobActive?: boolean;
  error?: string;
  configSnapshot?: AiStudioSessionConfig;
  projectId?: string;
  topic: string;
  currentStage: AiStudioStageId;
  stageName: AiStudioStageName;
  status: 'idle' | 'running' | 'awaiting_approval' | 'completed' | 'failed' | 'cancelled';
  progress: number; // 0 - 100
  gatedMode?: boolean;
  stages: Record<
    number,
    {
      status: AiStudioStageStatus;
      stageName: string;
      startedAt?: number;
      completedAt?: number;
      error?: string;
    }
  >;
  artifacts: {
    ideaSummary?: string;
    blueprint?: IdeaBlueprint;
    scriptLines?: ScriptBeatLine[];
    audioPath?: string;
    srtPath?: string;
    wordsAlignment?: WordTimestamp[];
    alignmentSource?: 'word_boundary' | 'estimated_per_line' | 'mixed';
    scenes?: StoryboardScene[];
    storyboardSynthesis?: StoryboardSynthesis;
    mediaDir?: string;
    videoPath?: string;
    metadata?: SeoMetadata;
    scriptEvaluation?: ScriptEvaluation;
    scriptHistory?: {
      lines: ScriptBeatLine[];
      evaluation?: ScriptEvaluation;
      timestamp: number;
    }[];
  };
  outputDir?: string;
  flowProjectUrl?: string;
  createdAt: number;
  updatedAt: number;
  /** Stable episode ownership and paths; independent of the currently selected channel. */
  ownerProjectId?: string;
  workspaceDir?: string;
  mediaDir?: string;
}

export type AiStudioSessionConfig = Pick<AiStudioConfig, 'llm' | 'voice' | 'flowEngine' | 'rendering' | 'subtitles' | 'channelProfile'>;

export interface PipelineProgressPayload {
  sessionId: string;
  stage: number;
  stageName: string;
  progress: number;
  status: AiStudioStageStatus | 'awaiting_approval';
  message?: string;
  error?: string;
  artifacts?: Partial<PipelineSessionState['artifacts']>;
  lastAction?: any;
  sessionStatus?: PipelineSessionState['status'];
}

export type PipelineStageStatus = AiStudioStageStatus;
export type PipelineProgressEvent = PipelineProgressPayload;

// Payload and Result contracts for IPC
export interface StartPipelinePayload {
  topic: string;
  projectId?: string;
  blueprint?: IdeaBlueprint;
  gatedMode?: boolean;
  outputDir?: string;
  flowProjectUrl?: string;
  options?: PartialAiStudioConfig;
}

export interface StartPipelineResult {
  sessionId: string;
}

export interface StartManualMediaPayload { projectId: string; srtPath: string; audioPath: string }

export interface AutoFillIdeaPayload {
  topic: string;
  aspectRatio?: '16:9' | '9:16';
  channelProfile?: Partial<ChannelProfileConfig>;
}

export interface AutoFillIdeaResult {
  title: string;
  hookConcept: string;
  narrativeAngle: string;
  outline: string[];
  thumbnailConcept: string;
  thumbnailPrompt: string;
}

export interface ApproveStagePayload {
  sessionId: string;
  currentStage: number;
  updatedArtifacts?: Partial<PipelineSessionState['artifacts']>;
}

export interface ApproveStageResult {
  success: boolean;
  nextStage?: number;
}

export interface ResumePipelinePayload {
  sessionId: string;
  fromStage?: number;
  mode?: 'resume_missing' | 'regenerate_selected' | 'regenerate_all';
  selectedShotIds?: string[];
  storyboardOptions?: Pick<AiStudioFlowEngineConfig, 'shotMode' | 'granularity'>;
  updatedArtifacts?: Record<string, unknown>;
}

export interface UpdateSceneFillModePayload {
  sessionId: string;
  sceneIds?: string[];
  fillMode: 'freeze_last_frame' | 'none';
}

export interface UpdateSceneFillModeResult {
  success: boolean;
  scenes?: StoryboardScene[];
}

export interface ResumePipelineResult {
  success: boolean;
}

export interface CancelPipelinePayload {
  sessionId: string;
}

export interface CancelPipelineResult {
  success: boolean;
}

export interface GetPipelineStatePayload {
  sessionId: string;
}

export interface RenderSingleLineVoicePayload {
  lineIndex: number;
  text: string;
  voiceConfig: AiStudioVoiceConfig;
}

export interface RenderSingleLineVoiceResult {
  audioPath: string;
  durationMs: number;
}

export interface RegenerateSceneAssetPayload {
  sceneId: string;
  visualPrompt: string;
  flowConfig?: Partial<AiStudioFlowEngineConfig>;
  referenceImagePath?: string;
  sessionId?: string;
  mode?: 'image' | 'video' | 'both';
}

export interface RegenerateSceneAssetResult {
  assetPath: string;
  imagePath?: string;
  videoPath?: string;
  error?: string;
}

export interface ImportSceneMediaPayload {
  sessionId: string;
  sceneId: string;
  filePath: string;
  mediaType?: 'image' | 'video';
}

export interface ImportSceneMediaResult {
  success: boolean;
  assetPath: string;
  imagePath?: string;
  videoPath?: string;
  error?: string;
}

export interface RenderVideoPayload {
  sessionId: string;
  customSettings?: DeepPartial<AiStudioRenderingConfig & AiStudioSubtitleConfig>;
}

export interface RenderVideoResult {
  videoPath: string;
}

export interface GenerateMasterPromptPayload {
  channelProfile: Partial<ChannelProfileConfig>;
}

export interface GenerateMasterPromptResult {
  masterPrompt: string;
  chatgptConversationUrl?: string;
}

export interface ScriptCriteriaScore {
  id: 'D1' | 'D2' | 'D3' | 'D4' | 'D5' | 'D6' | 'D7' | 'D8' | 'D9' | 'D10';
  name: string;
  score: number; // 0 - 10
  feedback?: string;
}

export interface ScriptEvaluation {
  method?: 'llm';
  provider?: AiStudioLlmConfig['provider'];
  overallScore: number; // 0 - 100
  lowestScore: number; // 0 - 10
  criteria: ScriptCriteriaScore[];
  failedCriteria: string[]; // e.g. ['D1', 'D5', 'D7']
  critique: string;
  notice?: string;
  evaluatedAt: number;
}

export interface EvaluateScriptPayload {
  sessionId?: string;
  lines: ScriptBeatLine[];
  blueprint?: IdeaBlueprint;
  channelProfile?: Partial<ChannelProfileConfig>;
}

export interface EvaluateScriptResult {
  session?: PipelineSessionState;
  evaluation: ScriptEvaluation;
}

export interface RefineScriptPayload {
  sessionId?: string;
  lines: ScriptBeatLine[];
  instructions?: string;
  mode?: 'improve_weaknesses' | 'custom_prompt';
  blueprint?: IdeaBlueprint;
  channelProfile?: Partial<ChannelProfileConfig>;
}

export interface RefineScriptResult {
  session?: PipelineSessionState;
  lines: ScriptBeatLine[];
  evaluation?: ScriptEvaluation;
}

export interface UpdateScriptLinesPayload {
  sessionId: string;
  lines: ScriptBeatLine[];
}

export interface UpdateScriptLinesResult {
  session?: PipelineSessionState;
  success: boolean;
  scriptLines: ScriptBeatLine[];
}

export interface SelfTestDiagnosticsResult {
  bridge: { ok: boolean; message: string; port: number; details?: string };
  session: { ok: boolean; message: string; status: string; detail?: string };
  disk: { ok: boolean; message: string; path?: string };
  llm: { ok: boolean; message: string; provider: string };
  overallReady: boolean;
  timestamp: number;
}

// ============================================================================
// 6. CapCut Desktop Draft Export Types (Milestone 5)
// ============================================================================

export interface CapCutDraftSceneItem {
  id?: string;
  path: string;
  durationSec: number;
  type?: 'video' | 'image';
}

export interface CapCutDraftSubtitleItem {
  text: string;
  startSec: number;
  endSec: number;
}

export interface CapCutDraftProjectData {
  id?: string;
  title?: string;
  durationSec?: number;
  scenes?: CapCutDraftSceneItem[];
  voiceoverPath?: string;
  bgmPath?: string;
  subtitles?: CapCutDraftSubtitleItem[];
}

export interface CapCutDraftExportOptions {
  targetDir?: string;
  targetDirectory?: string;
  projectData?: CapCutDraftProjectData;
  sessionState?: PipelineSessionState;
  sessionId?: string;
  projectId?: string;
  // Direct top-level fields for convenience
  id?: string;
  title?: string;
  durationSec?: number;
  scenes?: CapCutDraftSceneItem[];
  voiceoverPath?: string;
  bgmPath?: string;
  subtitles?: CapCutDraftSubtitleItem[];
}

export interface CapCutDraftExportResult {
  draftPath: string;
  contentJsonPath: string;
  metaInfoJsonPath: string;
  tracksSummary: {
    videoClipsCount: number;
    voiceoverTracksCount: number;
    bgmTracksCount: number;
    subtitlesCount: number;
    totalDurationUs: number;
  };
  trackSummary: {
    videoClipsCount: number;
    voiceoverTracksCount: number;
    bgmTracksCount: number;
    subtitlesCount: number;
    totalDurationUs: number;
  };
}

