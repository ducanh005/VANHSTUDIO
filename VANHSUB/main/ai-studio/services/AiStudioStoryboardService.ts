/**
 * AiStudioStoryboardService
 * Probes real audio timing via ffprobe and generates audio-synchronized storyboards.
 * Conforms to spec-pipeline-video-automation.md §2 (Stages 4 & 5) and orchestrator_4/PROJECT.md.
 *
 * KEY FEATURE: AI-driven media_type decision (image vs video) per shot, based on:
 *   - Narration/visual_note content analysis (motion keywords, static keywords)
 *   - Scene duration vs model generation limits
 *   - Confidence scoring with fallback to 'image' when uncertain
 */

import fs from 'fs';
import path from 'path';
import { execFile } from 'child_process';
import { promisify } from 'util';
import ffmpeg from 'fluent-ffmpeg';
import ffprobeInstaller from '@ffprobe-installer/ffprobe';

import {
  AiStudioDiskStorageManager,
  PipelineScriptData,
  PipelineTimingData,
  PipelineStoryboardData,
  SceneTimingItem,
  StoryboardSceneItem,
  StoryboardShotItem,
  ScriptSceneItem,
  ShotMediaType,
  ShotConfidence,
} from '../storage/AiStudioDiskStorageManager';
import type {
  ChannelProfileConfig,
  FlowGranularity,
  StoryboardSynthesis,
  AiStudioLlmConfig,
  CinematographyPlan,
  CameraAngleType,
  CameraMovementType,
  ScriptBeatLine,
} from '../types';
import { AiStudioLlmService } from './AiStudioLlmService';

declare module '../storage/AiStudioDiskStorageManager' {
  interface StoryboardShotItem {
    camera_angle?: string;
    camera_movement?: string;
    visual_action?: string;
  }
}
declare module '../types/storage' {
  interface StoryboardShotItem {
    camera_angle?: string;
    camera_movement?: string;
    visual_action?: string;
  }
}

const execFileAsync = promisify(execFile);

// Configure FFprobe binary path from project installer
const rawFfprobePath = (ffprobeInstaller as any)?.path || (ffprobeInstaller as any)?.default?.path || '';
const resolvedFfprobePath = rawFfprobePath ? rawFfprobePath.replace('app.asar', 'app.asar.unpacked') : '';

if (resolvedFfprobePath) {
  ffmpeg.setFfprobePath(resolvedFfprobePath);
}

export interface VisualArtStylePresetItem {
  id: string;
  name: string;
  badge: string;
  stylePrefix: string;
  defaultBackground: string;
}

export const VISUAL_ART_STYLE_PRESETS: Record<string, VisualArtStylePresetItem> = {
  cinematic: {
    id: 'cinematic',
    name: 'Điện ảnh Chân thực (Cinematic Real)',
    badge: 'Phổ biến',
    stylePrefix: 'Cinematic movie lighting, 8k resolution, photorealistic masterpiece, 35mm film grain, anamorphic lens, highly detailed textures, dramatic lighting',
    defaultBackground: 'Modern cinematic studio environment, dramatic atmospheric backlighting, soft natural shadows, high contrast depth of field',
  },
  anime_ghibli: {
    id: 'anime_ghibli',
    name: 'Anime Ghibli (Miyazaki Style)',
    badge: 'Nghệ thuật',
    stylePrefix: 'Studio Ghibli aesthetic, lush hand-painted background, vibrant colors, gentle sunlight, whimsical atmosphere, highly detailed anime illustration by Hayao Miyazaki',
    defaultBackground: 'Idyllic countryside hillside with lush rolling green grass, vibrant wild flowers, blue sky with fluffy watercolor clouds',
  },
  dark_fantasy: {
    id: 'dark_fantasy',
    name: 'Kỳ ảo Đen tối (Dark Fantasy Epic)',
    badge: 'Huyền bí',
    stylePrefix: 'Dark fantasy epic, grimdark aesthetic, atmospheric volumetric fog, moody chiaroscuro lighting, intricate gothic architecture, Unreal Engine 5 render, 8k',
    defaultBackground: 'Ancient ruined gothic cathedral cloaked in misty moonlight, weathered stone pillars, eerie floating embers, deep mysterious shadows',
  },
  cyberpunk: {
    id: 'cyberpunk',
    name: 'Tương lai Cyberpunk (Sci-Fi Neon)',
    badge: 'Khoa học',
    stylePrefix: 'Cyberpunk sci-fi aesthetic, vibrant neon reflections, octane render, futuristic high-tech dystopian cityscape, intricate mechanical details, cinematic 8k',
    defaultBackground: 'Rain-slicked futuristic Neo-Tokyo street at midnight, glowing neon signs in violet and cyan, towering holographic billboards, flying traffic streaks',
  },
  history_doc: {
    id: 'history_doc',
    name: 'Tài liệu Lịch sử (National Geographic)',
    badge: 'Tài liệu',
    stylePrefix: 'National Geographic documentary photography, historical realism, authentic period textures, dramatic natural daylight, 8k resolution, raw documentary focus',
    defaultBackground: 'Authentic historical ancient workshop with rustic wooden workbenches, parchment scrolls, brass measuring tools, dust motes in soft window light',
  },
  '3d_pixar': {
    id: '3d_pixar',
    name: 'Hoạt hình 3D Pixar (Disney 3D CGI)',
    badge: '3D Vui nhộn',
    stylePrefix: 'Pixar 3D animation style, Disney modern CGI render, charming stylized lighting, soft subsurface scattering, vibrant warm colors, 8k resolution',
    defaultBackground: 'Cozy whimsical studio room with colorful wooden furniture, warm ambient lighting, cute stylized props on bookshelves',
  },
};

// ============================================================================
// Media Type Decision Engine & Contextual AI Cinematographer Contracts
// (Replaced legacy static keyword regex lists with Contextual AI Cinematographer)
// ============================================================================

/**
 * Result from the media type decision engine.
 */
export interface MediaTypeDecision {
  media_type: ShotMediaType;
  reason: string;
  confidence: ShotConfidence;
  videoScore: number;
  imageScore: number;
  camera_angle?: CameraAngleType | string;
  camera_motion?: CameraMovementType | string;
  duration_sec?: number;
  dramaticTension?: number;
}

export interface GenerateStoryboardOptions {
  storage: AiStudioDiskStorageManager;
  script?: PipelineScriptData;
  timing?: PipelineTimingData;
  stylePromptPrefix?: string;
  negativePrompt?: string;
  decompositionThresholdSec?: number; // Default 5.0s
  channelProfile?: Partial<ChannelProfileConfig>;
  backgroundPrompt?: string;
  /**
   * Pacing / shot decomposition mode:
   * - 'single': 1:1 mapping (1 shot per script scene). Recommended default for AutoPilot.
   * - 'multi': Decompose scenes longer than thresholdSec into 2-4 shots.
   */
  shotMode?: 'single' | 'multi';
  /**
   * Mức độ chi tiết hoá phân cảnh (Granularity):
   * - 'detailed': Chi tiết theo từng câu (1 shot/câu, thời gian sản xuất & credit tối đa).
   * - 'balanced' (Mặc định): AI tự cân bằng, gộp các câu mô tả tĩnh liền kề thành 1 shot ảnh duy nhất kèm Ken Burns zoom/pan.
   * - 'fast': Ưu tiên gộp nhiều câu ngắn liền kề thành 1 shot dài hơn (~8-15s) để sản xuất nhanh nhất & tiết kiệm credit.
   */
  granularity?: FlowGranularity;
  /**
   * Maximum video clip duration the model supports per generation call (seconds).
   * If a video shot is longer than this, it will be split into multi-clip sub-shots.
   * Default: 8s (safe for most models; Veo supports up to 8s per call).
   */
  maxVideoClipDurationSec?: number;
  customPromptGenerator?: (
    scene: ScriptSceneItem,
    shotIndex: number,
    totalShots: number,
    durationSec: number
  ) => { image_prompt: string; motion_note: string };
  /**
   * Two-Tier Smart Storyboard Clustering (Milestone 2 / R2):
   * Groups consecutive dialogue lines into 4.0s - 10.0s shots.
   * Tier 1: LLM Semantic Clustering (AiStudioLlmService)
   * Tier 2: Deterministic Greedy Semantic Fallback
   */
  enableClustering?: boolean;
  llmConfig?: AiStudioLlmConfig;
  topic?: string;
}

export class AiStudioStoryboardService {
  private static instance: AiStudioStoryboardService;

  public static getInstance(): AiStudioStoryboardService {
    if (!AiStudioStoryboardService.instance) {
      AiStudioStoryboardService.instance = new AiStudioStoryboardService();
    }
    return AiStudioStoryboardService.instance;
  }

  // ==========================================================================
  // 1. Audio Duration Probing (Phase 4 / spec §2)
  // ==========================================================================

  /**
   * Probes the actual audio duration (in seconds) of an audio file using ffprobe.
   * Absolutely forbids character-count or word-count estimation.
   * Rejects if file is missing, empty (0 bytes), or corrupt.
   */
  public async probeAudioDuration(audioPath: string): Promise<number> {
    if (!audioPath || typeof audioPath !== 'string') {
      throw new Error(`Invalid audio path provided to probeAudioDuration: "${audioPath}"`);
    }

    if (!fs.existsSync(audioPath)) {
      throw new Error(`Audio file does not exist on disk: ${audioPath}`);
    }

    const stat = fs.statSync(audioPath);
    if (!stat.isFile() || stat.size === 0) {
      throw new Error(`Audio file is empty or 0 bytes: ${audioPath}`);
    }

    // 1. Try fluent-ffmpeg ffprobe
    try {
      const dur = await this.probeViaFluentFfmpeg(audioPath);
      if (Number.isFinite(dur) && dur > 0) {
        return Math.round(dur * 100) / 100;
      }
    } catch (fluentErr: any) {
      // Fall through to execFile if fluent probe fails
    }

    // 2. Try direct execFile of ffprobe binary
    try {
      const dur = await this.probeViaExecFile(audioPath);
      if (Number.isFinite(dur) && dur > 0) {
        return Math.round(dur * 100) / 100;
      }
    } catch (execErr: any) {
      throw new Error(
        `Failed to probe audio duration via ffprobe for "${audioPath}". Error: ${execErr?.message || String(execErr)}`
      );
    }

    throw new Error(`ffprobe returned an invalid or zero duration for audio file: "${audioPath}"`);
  }

  private probeViaFluentFfmpeg(audioPath: string): Promise<number> {
    return new Promise((resolve, reject) => {
      ffmpeg.ffprobe(audioPath, (err, metadata) => {
        if (err) return reject(err);
        const formatDur = metadata?.format?.duration;
        const streamDur = metadata?.streams?.find(s => s.duration)?.duration;
        const dur = parseFloat(String(formatDur ?? streamDur ?? '0'));
        if (Number.isFinite(dur) && dur > 0) {
          resolve(dur);
        } else {
          reject(new Error(`fluent-ffmpeg returned non-positive duration: ${dur}`));
        }
      });
    });
  }

  private async probeViaExecFile(audioPath: string): Promise<number> {
    const ffprobeBin = resolvedFfprobePath || 'ffprobe';
    const args = [
      '-v', 'error',
      '-show_entries', 'format=duration',
      '-of', 'default=noprint_wrappers=1:nokey=1',
      audioPath,
    ];

    const { stdout, stderr } = await execFileAsync(ffprobeBin, args);
    if (stderr && stderr.trim().length > 0 && !stdout) {
      throw new Error(`ffprobe error output: ${stderr}`);
    }

    const dur = parseFloat(stdout.trim());
    if (!Number.isFinite(dur) || dur <= 0) {
      throw new Error(`ffprobe stdout output invalid duration: "${stdout.trim()}"`);
    }

    return dur;
  }

  // ==========================================================================
  // 2. Timing Extraction & 03_timing/timing.json Persistence
  // ==========================================================================

  /**
   * Probes audio duration for all scenes in 02_voice/{scene_id}.mp3,
   * generates 03_timing/timing.json, and updates index.json.
   */
  public async extractTiming(
    storage: AiStudioDiskStorageManager,
    customSceneIds?: string[]
  ): Promise<PipelineTimingData> {
    storage.ensureDirectories();

    // 1. Determine scenes to probe
    let sceneIds: string[] = customSceneIds || [];

    if (sceneIds.length === 0) {
      const script = storage.readScript();
      if (script && Array.isArray(script.scenes) && script.scenes.length > 0) {
        sceneIds = script.scenes.map(s => s.scene_id);
      }
    }

    if (sceneIds.length === 0) {
      // Discover existing voice files in 02_voice/
      if (fs.existsSync(storage.paths.voiceDir)) {
        const files = fs.readdirSync(storage.paths.voiceDir);
        sceneIds = files
          .filter(f => f.endsWith('.mp3'))
          .map(f => f.replace(/\.mp3$/, ''))
          .sort();
      }
    }

    if (sceneIds.length === 0) {
      // Check index.json scenes
      const idx = storage.readIndex();
      sceneIds = Object.keys(idx.scenes);
    }

    if (sceneIds.length === 0) {
      throw new Error(
        `No scenes discovered for timing extraction in project "${storage.projectId}". Please ensure script.json or voice files exist.`
      );
    }

    // 2. Probe each scene's audio file and compute timeline
    const sceneTimingList: SceneTimingItem[] = [];
    let currentTimelineSec = 0;

    for (const sceneId of sceneIds) {
      const audioPath = storage.getVoiceAudioPath(sceneId);
      const relativeAudioPath = storage.getVoiceAudioRelativePath(sceneId);

      const durSec = await this.probeAudioDuration(audioPath);
      const start_sec = Math.round(currentTimelineSec * 100) / 100;
      const end_sec = Math.round((currentTimelineSec + durSec) * 100) / 100;
      currentTimelineSec += durSec;

      const timingItem: SceneTimingItem = {
        scene_id: sceneId,
        audio_file: relativeAudioPath,
        start_sec,
        end_sec,
        duration_sec: durSec,
      };

      sceneTimingList.push(timingItem);

      // Update index.json scene metadata
      storage.updateSceneMetadata(sceneId, {
        voice_path: relativeAudioPath,
        voice_duration_sec: durSec,
        timing: {
          start_sec,
          end_sec,
          duration_sec: durSec,
        },
      });
    }

    const total_duration_sec = Math.round(currentTimelineSec * 100) / 100;

    const timingData: PipelineTimingData = {
      project_id: storage.projectId,
      probed_engine: 'ffprobe',
      scenes: sceneTimingList,
      total_duration_sec,
    };

    // 3. Persist 03_timing/timing.json
    storage.saveTiming(timingData);

    // 4. Record action log
    storage.appendActionLog({
      ts: new Date().toISOString(),
      action: 'probe',
      target: '03_timing/timing.json',
      retry: 0,
      status: 'ok',
      details: {
        scene_count: sceneTimingList.length,
        total_duration_sec,
      },
    });

    return timingData;
  }

  // ==========================================================================
  // 3. AI Media Type Decision Engine
  // ==========================================================================

  // ==========================================================================
  // 3. Contextual AI Cinematographer Engine (Milestone 2 / R2)
  // ==========================================================================

  /**
   * Static accessor for Contract 2 Cinematography planning.
   * Conforms to PROJECT.md § Interface Contracts (Contract 2).
   */
  public static async planShotCinematography(
    scene: ScriptBeatLine,
    fullContext: ScriptBeatLine[] = []
  ): Promise<CinematographyPlan> {
    return AiStudioStoryboardService.getInstance().planShotCinematography(scene, fullContext);
  }

  /**
   * Plans cinematography contextually for an individual script beat line in accordance with Contract 2.
   * If scene.suggestedMediaType is provided, honors it directly without overriding.
   * Derives media_type, camera_angle, camera_motion, and strictly clamps Veo video duration to [2.0s, 8.0s].
   */
  public async planShotCinematography(
    scene: ScriptBeatLine,
    fullContext: ScriptBeatLine[] = []
  ): Promise<CinematographyPlan> {
    const text = (scene.text || '').trim();
    const visual = (scene.visualAction || scene.visualNote || '').trim();
    const totalScenes = fullContext && fullContext.length > 0 ? fullContext.length : 1;
    const sceneIndex = scene.index ?? (fullContext && fullContext.length > 0 ? fullContext.indexOf(scene) + 1 : 1);

    const tension = this.analyzeDramaticTension(scene, sceneIndex, totalScenes);
    const duration = scene.estimatedDurationSec ?? (scene.durationMs ? scene.durationMs / 1000 : undefined);

    const basePlan = this.planCinematography(text, visual, tension, duration);

    // If scene.suggestedMediaType is explicitly provided, honor it as primary mediaType
    const explicitMedia: 'video' | 'image' | undefined = scene.suggestedMediaType;
    const media_type: 'video' | 'image' = explicitMedia || basePlan.media_type;

    // Validate and honor camera angle and motion if provided in scene
    const validAngles: CinematographyPlan['camera_angle'][] = [
      'wide_establishing',
      'medium_shot',
      'close_up',
      'low_angle',
      'high_angle',
      'point_of_view',
    ];
    const validMotions: CinematographyPlan['camera_motion'][] = [
      'pan_left_to_right',
      'pan_right_to_left',
      'dolly_in',
      'dolly_out',
      'pedestal_up',
      'static',
    ];

    let camera_angle = basePlan.camera_angle;
    if (scene.cameraAngle && validAngles.includes(scene.cameraAngle as any)) {
      camera_angle = scene.cameraAngle as CinematographyPlan['camera_angle'];
    }

    let camera_motion = basePlan.camera_motion;
    if (scene.cameraMovement && validMotions.includes(scene.cameraMovement as any)) {
      camera_motion = scene.cameraMovement as CinematographyPlan['camera_motion'];
    } else if (media_type === 'video' && camera_motion === 'static') {
      camera_motion = 'dolly_out';
    }

    // Clamp duration according to Contract 2 (clamped to 2.0s - 8.0s for video)
    let duration_sec = basePlan.duration_sec;
    if (media_type === 'video') {
      duration_sec = Math.min(8.0, Math.max(2.0, duration_sec));
    } else {
      duration_sec = Math.max(2.0, duration_sec);
    }

    return {
      media_type,
      camera_angle,
      camera_motion,
      duration_sec,
      visual_action_description: visual || text,
    };
  }

  /**
   * Static accessor for Contextual AI Cinematography planning.
   * Matches SpecificationOracles.planCinematography specification.
   */
  public static planCinematography(
    narration: string,
    visualNote: string | undefined,
    dramaticTension: number = 0.5,
    suggestedDuration?: number
  ): CinematographyPlan {
    return AiStudioStoryboardService.getInstance().planCinematography(
      narration,
      visualNote,
      dramaticTension,
      suggestedDuration
    );
  }

  /**
   * Plans cinematography contextually based on narration, visual note, and dramatic tension.
   * Fully replaces static keyword regex lists with contextual AI Cinematographer.
   * Derives media_type, camera_angle, camera_motion, and strictly clamps Veo duration (2.0s - 8.0s).
   */
  public planCinematography(
    narration: string,
    visualNote: string | undefined,
    dramaticTension: number = 0.5,
    suggestedDuration?: number
  ): CinematographyPlan {
    const text = `${narration || ''} ${visualNote || ''}`.toLowerCase();

    // Contextual semantic detection:
    // Action verbs and physical dynamics
    const isAction =
      text.includes('chạy') ||
      text.includes('đuổi') ||
      text.includes('chiến đấu') ||
      text.includes('bước đi') ||
      text.includes('nhảy') ||
      text.includes('run') ||
      text.includes('walk') ||
      text.includes('explosion') ||
      text.includes('action') ||
      dramaticTension >= 0.7;

    const media_type: 'video' | 'image' = isAction ? 'video' : 'image';

    // Contextual camera angle & motion selection
    let camera_angle: CinematographyPlan['camera_angle'] = 'medium_shot';
    let camera_motion: CinematographyPlan['camera_motion'] = 'static';

    if (text.includes('bối cảnh') || text.includes('toàn cảnh') || text.includes('thành phố')) {
      camera_angle = 'wide_establishing';
      camera_motion = 'pan_left_to_right';
    } else if (text.includes('khuôn mặt') || text.includes('cảm xúc') || text.includes('ánh mắt')) {
      camera_angle = 'close_up';
      camera_motion = 'dolly_in';
    } else if (dramaticTension > 0.8) {
      camera_angle = 'low_angle';
      camera_motion = 'dolly_in';
    } else if (media_type === 'video') {
      camera_motion = 'dolly_out';
    }

    let duration_sec = suggestedDuration ?? (media_type === 'video' ? 5.0 : 4.0);
    if (isNaN(duration_sec) || duration_sec < 0) {
      duration_sec = 2.0;
    }
    if (media_type === 'video') {
      duration_sec = Math.min(8.0, Math.max(2.0, duration_sec));
    } else {
      duration_sec = Math.max(2.0, duration_sec);
    }

    return {
      media_type,
      camera_angle,
      camera_motion,
      duration_sec,
      visual_action_description: visualNote || narration,
    };
  }

  /**
   * Static accessor for dramatic tension analysis.
   */
  public static analyzeDramaticTension(
    sceneOrNarration: ScriptBeatLine | string,
    visualNoteOrIndex?: string | number,
    beatTypeOrTotal?: string | number
  ): number {
    return AiStudioStoryboardService.getInstance().analyzeDramaticTension(
      sceneOrNarration,
      visualNoteOrIndex,
      beatTypeOrTotal
    );
  }

  /**
   * Analyzes emotional tone and dramatic tension from the script text or ScriptBeatLine.
   * Distinguishes metaphorical states from physical action.
   */
  public analyzeDramaticTension(
    sceneOrNarration: ScriptBeatLine | string,
    visualNoteOrIndex?: string | number,
    beatTypeOrTotal?: string | number
  ): number {
    let narration = '';
    let visualNote = '';
    let beatType: string | undefined = undefined;
    let sceneIndex: number | undefined = undefined;
    let totalScenes: number | undefined = undefined;

    if (typeof sceneOrNarration === 'object' && sceneOrNarration !== null) {
      const beat = sceneOrNarration as ScriptBeatLine;
      narration = beat.text || '';
      visualNote = beat.visualAction || beat.visualNote || '';
      beatType = beat.beatType;
      if (typeof visualNoteOrIndex === 'number') sceneIndex = visualNoteOrIndex;
      if (typeof beatTypeOrTotal === 'number') totalScenes = beatTypeOrTotal;
    } else {
      narration = typeof sceneOrNarration === 'string' ? sceneOrNarration : '';
      if (typeof visualNoteOrIndex === 'string') visualNote = visualNoteOrIndex;
      if (typeof beatTypeOrTotal === 'string') beatType = beatTypeOrTotal;
    }

    const text = `${narration || ''} ${visualNote || ''}`.toLowerCase();
    if (!text.trim()) return 0.5;

    let tension = 0.5;

    // Metaphorical expressions check (e.g. "bước vào giai đoạn trầm cảm" -> psychological, not action)
    const isMetaphor =
      text.includes('bước vào giai đoạn') ||
      text.includes('đi đến quyết định') ||
      text.includes('chạy đua với thời gian') ||
      text.includes('bước ngoặt tư duy');

    if (isMetaphor) {
      tension -= 0.25;
    }

    // High tension keywords: conflict, confrontation, weapon, urgency
    if (
      text.includes('họng súng') ||
      text.includes('đối mặt') ||
      text.includes('kẻ thù') ||
      text.includes('trốn thoát') ||
      text.includes('kẻ bám đuổi') ||
      text.includes('nguy hiểm') ||
      text.includes('tử thần') ||
      text.includes('bùng nổ') ||
      text.includes('chiến đấu') ||
      text.includes('sụp đổ') ||
      text.includes('sát thủ')
    ) {
      tension += 0.35;
    }

    // Micro-action under extreme tension (e.g., standing frozen before a gun, sweat dripping)
    if (text.includes('đứng bất động') && (text.includes('súng') || text.includes('mồ hôi') || text.includes('kẻ'))) {
      tension = Math.max(tension, 0.85);
    }

    // Static, contemplative, expository or data keywords
    if (
      text.includes('bản đồ') ||
      text.includes('biểu đồ') ||
      text.includes('số liệu') ||
      text.includes('thống kê') ||
      text.includes('tĩnh lặng') ||
      text.includes('chiêm ngưỡng') ||
      text.includes('nhàn hạ') ||
      text.includes('lịch sử') ||
      text.includes('nguồn gốc') ||
      text.includes('tài liệu')
    ) {
      tension -= 0.3;
    }

    if (beatType === 'climax') tension += 0.25;
    if (beatType === 'hook') tension += 0.15;
    if (beatType === 'outro') tension -= 0.15;

    if (!beatType && sceneIndex !== undefined && totalScenes !== undefined && totalScenes > 1) {
      if (sceneIndex === 1) tension += 0.15;
      else if (sceneIndex >= Math.floor(totalScenes * 0.7) && sceneIndex < totalScenes) tension += 0.2;
      else if (sceneIndex === totalScenes) tension -= 0.15;
    }

    return Math.min(1.0, Math.max(0.0, Math.round(tension * 100) / 100));
  }

  /**
   * Contextual AI Cinematographer replacing static keyword regex matching.
   * Determines media_type ('video' | 'image'), camera_angle, camera_motion, and clamps Veo duration (2s-8s).
   * Directly honors contextOptions.suggestedMediaType when supplied by Two-Column Script or user.
   */
  public decideMediaType(
    narration: string,
    visualNote: string | undefined,
    durationSec: number,
    contextOptions?: {
      dramaticTension?: number;
      beatType?: string;
      sceneIndex?: number;
      totalScenes?: number;
      suggestedMediaType?: 'video' | 'image';
    }
  ): MediaTypeDecision {
    // 1. Honor explicit suggestedMediaType from Two-Column Audiovisual Script / user decision
    if (contextOptions?.suggestedMediaType) {
      const explicitType = contextOptions.suggestedMediaType;
      let tension = contextOptions?.dramaticTension;
      if (tension === undefined) {
        tension = this.analyzeDramaticTension(narration, visualNote, contextOptions?.beatType);
      }
      const plan = this.planCinematography(narration, visualNote, tension, durationSec);

      let effectiveDur = durationSec ?? (explicitType === 'video' ? 5.0 : 4.0);
      if (isNaN(effectiveDur) || effectiveDur < 0) {
        effectiveDur = 2.0;
      }
      effectiveDur = explicitType === 'video'
        ? Math.min(8.0, Math.max(2.0, effectiveDur))
        : Math.max(2.0, effectiveDur);

      const camera_motion = explicitType === 'video' && plan.camera_motion === 'static'
        ? 'dolly_out'
        : plan.camera_motion;

      return {
        media_type: explicitType,
        reason: `Chỉ định trực tiếp từ Kịch bản 2 cột (suggestedMediaType: ${explicitType}) — góc máy ${plan.camera_angle}, chuyển động ${camera_motion}`,
        confidence: 'high',
        videoScore: explicitType === 'video' ? 3 : 0,
        imageScore: explicitType === 'image' ? 3 : 0,
        camera_angle: plan.camera_angle,
        camera_motion,
        duration_sec: effectiveDur,
        dramaticTension: tension,
      };
    }

    const rawText = `${narration || ''} ${visualNote || ''}`.trim();
    if (!rawText) {
      // Empty text boundary case (T2.B2.1)
      const clamped = Math.min(8.0, Math.max(2.0, durationSec || 4.0));
      return {
        media_type: 'image',
        reason: 'Nội dung phân cảnh rỗng — mặc định sử dụng ảnh tĩnh bảo thủ',
        confidence: 'low',
        videoScore: 0,
        imageScore: 0,
        camera_angle: 'medium_shot',
        camera_motion: 'static',
        duration_sec: clamped,
        dramaticTension: 0.0,
      };
    }

    // Determine dramatic tension
    let tension = contextOptions?.dramaticTension;
    if (tension === undefined) {
      tension = this.analyzeDramaticTension(narration, visualNote, contextOptions?.beatType);
    }

    const plan = this.planCinematography(narration, visualNote, tension, durationSec);

    let finalMediaType = plan.media_type;
    let confidence: ShotConfidence = 'high';
    let reason = '';

    if (durationSec < 2.0 && contextOptions?.dramaticTension === undefined) {
      finalMediaType = 'image';
      reason = `Shot quá ngắn (${durationSec}s < 2s) để tạo video có nghĩa — dùng ảnh tĩnh kèm hiệu ứng Ken Burns`;
      confidence = 'high';
    } else if (finalMediaType === 'video') {
      reason = `Contextual AI Cinematographer: Phân cảnh hành động/cao trào (căng thẳng kịch tính ${Math.round(tension * 100)}%) — đề xuất video với góc quay ${plan.camera_angle} và chuyển động ${plan.camera_motion}`;
      confidence = tension >= 0.8 ? 'high' : 'medium';
    } else {
      reason = `Contextual AI Cinematographer: Phân cảnh mô tả bối cảnh/tĩnh lặng/thông tin (căng thẳng kịch tính ${Math.round(tension * 100)}%) — đề xuất ảnh tĩnh tối ưu chi phí`;
      confidence = tension <= 0.3 ? 'high' : 'medium';
    }

    return {
      media_type: finalMediaType,
      reason,
      confidence,
      videoScore: finalMediaType === 'video' ? 3 : 0,
      imageScore: finalMediaType === 'image' ? 3 : 0,
      camera_angle: plan.camera_angle,
      camera_motion: plan.camera_motion,
      duration_sec: plan.duration_sec,
      dramaticTension: tension,
    };
  }

  // ==========================================================================
  // 3.5. Deterministic Greedy Semantic Clustering Helpers (Milestone 2 / R2)
  // ==========================================================================

  /**
   * Checks if there is a discernible context shift between two adjacent script scenes.
   */
  public hasSceneContextShift(sceneA: ScriptSceneItem, sceneB: ScriptSceneItem): boolean {
    if (!sceneA || !sceneB) return false;
    const textB = (sceneB.narration || '').toLowerCase().trim();

    // Context shift transitions: time leaps, sudden turns, location changes
    const shiftKeywords = [
      'tuy nhiên', 'nhưng rồi', 'bất ngờ', 'đột nhiên', 'mặt khác',
      'sau đó', 'vài năm sau', 'năm 18', 'năm 19', 'năm 20', 'thế kỷ',
      'ngày hôm sau', 'vào đêm', 'buổi sáng', 'sáng hôm sau',
      'bên ngoài', 'trong khi đó', 'ngược lại', 'bước sang', 'đến khi'
    ];

    for (const kw of shiftKeywords) {
      if (textB.startsWith(kw) || textB.includes(` ${kw} `) || textB.includes(` ${kw},`)) {
        return true;
      }
    }

    return false;
  }

  private finalizeDeterministicCluster(
    group: Array<{ scene: ScriptSceneItem; timing: SceneTimingItem; index: number }>,
    clusterIndex: number
  ) {
    const first = group[0];
    const last = group[group.length - 1];
    const start_sec = Math.round(first.timing.start_sec * 100) / 100;
    const end_sec = Math.round(last.timing.end_sec * 100) / 100;
    const duration_sec = Math.round((end_sec - start_sec) * 100) / 100;
    const assigned_indices = group.map((g) => g.index);
    const assigned_scene_ids = group.map((g) => g.scene.scene_id);
    const dialogue_lines = group.map((g) => g.scene.narration);
    const combined_narration = dialogue_lines.join(' ');
    const visual_notes = group.map((g) => g.scene.visual_note).filter(Boolean) as string[];

    return {
      cluster_index: clusterIndex,
      assigned_indices,
      assigned_scene_ids,
      dialogue_lines,
      combined_narration,
      visual_notes,
      start_sec,
      end_sec,
      duration_sec,
      raw_items: [...group],
    };
  }

  private mergeIntoLastDeterministicCluster(
    lastCluster: {
      cluster_index: number;
      assigned_indices: number[];
      assigned_scene_ids: string[];
      dialogue_lines: string[];
      combined_narration: string;
      visual_notes: string[];
      start_sec: number;
      end_sec: number;
      duration_sec: number;
      raw_items?: Array<{ scene: ScriptSceneItem; timing: SceneTimingItem; index: number }>;
    },
    group: Array<{ scene: ScriptSceneItem; timing: SceneTimingItem; index: number }>
  ) {
    const lastItem = group[group.length - 1];
    lastCluster.end_sec = Math.round(lastItem.timing.end_sec * 100) / 100;
    lastCluster.duration_sec = Math.round((lastCluster.end_sec - lastCluster.start_sec) * 100) / 100;
    lastCluster.assigned_indices.push(...group.map((g) => g.index));
    lastCluster.assigned_scene_ids.push(...group.map((g) => g.scene.scene_id));
    const newLines = group.map((g) => g.scene.narration);
    lastCluster.dialogue_lines.push(...newLines);
    lastCluster.combined_narration = lastCluster.dialogue_lines.join(' ');
    const newVisual = group.map((g) => g.scene.visual_note).filter(Boolean) as string[];
    lastCluster.visual_notes.push(...newVisual);
    if (lastCluster.raw_items) {
      lastCluster.raw_items.push(...group);
    }
  }

  private partitionPool(
    items: Array<{ scene: ScriptSceneItem; timing: SceneTimingItem; index: number }>,
    minSec: number = 4.0,
    maxSec: number = 10.5,
    idealSec: number = 6.5
  ): Array<Array<{ scene: ScriptSceneItem; timing: SceneTimingItem; index: number }>> | null {
    const n = items.length;
    if (n === 0) return null;
    if (n === 1) {
      const dur = Math.round((items[0].timing.end_sec - items[0].timing.start_sec) * 100) / 100;
      if (dur >= minSec && dur <= maxSec) {
        return [items];
      }
      return null;
    }

    const getDur = (j: number, i: number) => {
      return Math.round((items[i].timing.end_sec - items[j].timing.start_sec) * 100) / 100;
    };

    // dp[i] = lowest variance cost to partition items[0...i-1] into valid slices
    const dp = new Array<number>(n + 1).fill(Infinity);
    const parent = new Array<number>(n + 1).fill(-1);
    dp[0] = 0;

    for (let i = 1; i <= n; i++) {
      for (let j = 0; j < i; j++) {
        if (dp[j] !== Infinity) {
          const dur = getDur(j, i - 1);
          if (dur >= minSec && dur <= maxSec) {
            const cost = dp[j] + Math.pow(dur - idealSec, 2);
            if (cost < dp[i]) {
              dp[i] = cost;
              parent[i] = j;
            }
          }
        }
      }
    }

    if (dp[n] === Infinity) {
      return null;
    }

    const partition: Array<Array<{ scene: ScriptSceneItem; timing: SceneTimingItem; index: number }>> = [];
    let curr = n;
    while (curr > 0) {
      const prev = parent[curr];
      partition.unshift(items.slice(prev, curr));
      curr = prev;
    }
    return partition;
  }

  /**
   * Deterministic Greedy Semantic Clustering fallback:
   * Groups consecutive dialogue lines into 4.0s - 10.0s shots (ideal 5s - 8s).
    * Directly extracts start_sec and end_sec from timing.json to guarantee 0.00s drift.
   */
  public clusterSentencesDeterministically(
    scriptScenes: ScriptSceneItem[],
    timingScenes: SceneTimingItem[],
    granularityOrMinSec: FlowGranularity | number = 'balanced',
    customMaxSec?: number,
    customIdealSec?: number
  ): Array<{
    cluster_index: number;
    assigned_indices: number[];
    assigned_scene_ids: string[];
    dialogue_lines: string[];
    combined_narration: string;
    visual_notes: string[];
    start_sec: number;
    end_sec: number;
    duration_sec: number;
  }> {
    let granularity: FlowGranularity = 'balanced';
    let targetMinSec: number;
    let idealMaxSec: number;
    let targetMaxSec: number;

    if (typeof granularityOrMinSec === 'number') {
      targetMinSec = granularityOrMinSec;
      targetMaxSec = customMaxSec ?? 10.0;
      idealMaxSec = customIdealSec ?? 9.5;
    } else {
      granularity = granularityOrMinSec || 'balanced';
      switch (granularity) {
        case 'fast':
          // Gộp tối đa: 2–4 câu/shot (lý tưởng 7–12s, trần 16s)
          targetMinSec = 6.0;
          idealMaxSec = 12.0;
          targetMaxSec = 16.0;
          break;
        case 'detailed':
          // Tách chi tiết: 1–2 câu/shot (lý tưởng 3–5.5s, trần 7s)
          targetMinSec = 2.5;
          idealMaxSec = 5.5;
          targetMaxSec = 7.0;
          break;
        case 'balanced':
        default:
          // Cân bằng điện ảnh: 2–3 câu/shot (lý tưởng 5–8s, chuẩn hóa 4s–10s)
          targetMinSec = 4.0;
          idealMaxSec = 9.5;
          targetMaxSec = 10.0;
          break;
      }
    }

    console.log(
      `🔀 [GRANULARITY ENGINE V2 ACTIVE] Chế độ Granularity: "${granularity.toUpperCase()}" ` +
      `(min: ${targetMinSec}s, ideal: ${idealMaxSec}s, max: ${targetMaxSec}s)`
    );

    const timingMap = new Map<string, SceneTimingItem>();
    for (const t of timingScenes) {
      timingMap.set(t.scene_id, t);
    }

    const items = scriptScenes.map((sc, idx) => {
      const t = timingMap.get(sc.scene_id) || timingScenes[idx] || {
        scene_id: sc.scene_id,
        start_sec: 0,
        end_sec: 4.0,
        duration_sec: 4.0,
      };
      return {
        scene: sc,
        timing: t,
        index: idx + 1,
      };
    });

    const clusters: Array<{
      cluster_index: number;
      assigned_indices: number[];
      assigned_scene_ids: string[];
      dialogue_lines: string[];
      combined_narration: string;
      visual_notes: string[];
      start_sec: number;
      end_sec: number;
      duration_sec: number;
      raw_items?: Array<{ scene: ScriptSceneItem; timing: SceneTimingItem; index: number }>;
    }> = [];

    let currentGroup: Array<{ scene: ScriptSceneItem; timing: SceneTimingItem; index: number }> = [];
    let currentDur = 0;

    for (let i = 0; i < items.length; i++) {
      const item = items[i];
      const dur = item.timing.duration_sec || 3.5;
      const isStatic = this.isStaticOrDescriptiveNarration(item.scene.narration, item.scene.visual_note);

      // Nếu đang có nhóm: kiểm tra xem có nên chốt shot trước khi thêm câu này
      if (currentGroup.length > 0) {
        const nextDur = Math.round((currentDur + dur) * 100) / 100;
        const wouldExceedMax = nextDur > targetMaxSec;
        const wouldExceedIdeal = currentDur >= targetMinSec && (nextDur >= idealMaxSec);

        const prevItem = currentGroup[currentGroup.length - 1];
        const prevStatic = this.isStaticOrDescriptiveNarration(prevItem.scene.narration, prevItem.scene.visual_note);
        const bothStatic = prevStatic && isStatic;
        const hasShift = this.hasSceneContextShift(prevItem.scene, item.scene);

        let shouldSeal = false;
        let sealReason = '';

        if (wouldExceedMax) {
          shouldSeal = true;
          sealReason = `Thời lượng vượt trần tối đa (${nextDur.toFixed(1)}s > ${targetMaxSec}s)`;
        } else if (hasShift && currentDur >= targetMinSec) {
          shouldSeal = true;
          sealReason = `Phát hiện chuyển ngữ cảnh/bối cảnh (${prevItem.scene.scene_id} -> ${item.scene.scene_id})`;
        } else if (wouldExceedIdeal) {
          shouldSeal = true;
          sealReason = `Đạt vùng thời lượng lý tưởng (${currentDur.toFixed(1)}s >= ${targetMinSec}s, thêm câu thành ${nextDur.toFixed(1)}s >= ${idealMaxSec}s)`;
        }

        if (shouldSeal) {
          console.log(
            `[GRANULARITY V2] 🔒 Chốt Shot #${clusters.length + 1} (${currentGroup.map(g => '#' + g.index).join(', ')}): ` +
            `${currentDur.toFixed(1)}s — Lý do: ${sealReason}`
          );
          clusters.push(this.finalizeDeterministicCluster(currentGroup, clusters.length + 1));
          currentGroup = [];
          currentDur = 0;
        } else {
          console.log(
            `[GRANULARITY V2] ➕ Gộp câu #${item.index} (${dur.toFixed(1)}s, static=${isStatic}) vào Shot #${clusters.length + 1} ` +
            `→ Thời lượng mới: ${nextDur.toFixed(1)}s`
          );
        }
      }

      currentGroup.push(item);
      currentDur += dur;
    }

    if (currentGroup.length > 0) {
      if (clusters.length === 0) {
        clusters.push(this.finalizeDeterministicCluster(currentGroup, 1));
      } else {
        const lastCluster = clusters[clusters.length - 1];
        const combinedDur = Math.round((lastCluster.duration_sec + currentDur) * 100) / 100;

        if (currentDur >= targetMinSec && currentDur <= targetMaxSec) {
          console.log(
            `[GRANULARITY V2] 🔒 Chốt Shot cuối #${clusters.length + 1} (${currentGroup.map(g => '#' + g.index).join(', ')}): ` +
            `${currentDur.toFixed(1)}s`
          );
          clusters.push(this.finalizeDeterministicCluster(currentGroup, clusters.length + 1));
        } else if (combinedDur <= 10.5 && (currentDur < targetMinSec || combinedDur <= targetMaxSec)) {
          console.log(
            `[GRANULARITY V2] 🧲 Gộp câu đuôi (${currentGroup.map(g => '#' + g.index).join(', ')}) vào Shot #${clusters.length} để tránh shot quá ngắn.`
          );
          this.mergeIntoLastDeterministicCluster(lastCluster, currentGroup);
        } else {
          let rebalanced = false;
          const maxLookback = Math.min(clusters.length, 5);
          for (let lookback = 1; lookback <= maxLookback; lookback++) {
            const pooledClusters = clusters.slice(clusters.length - lookback);
            const pool = [...pooledClusters.flatMap(c => (c as any).raw_items || []), ...currentGroup];
            const partition = this.partitionPool(pool, targetMinSec, 10.5);
            if (partition) {
              console.log(
                `[GRANULARITY V2] ⚖️ Tái cân bằng câu đuôi: Chia lại ${lookback === 1 ? `Shot #${clusters.length}` : `${lookback} shot trước`} thành ${partition.length} shot đạt chuẩn 4s-10s`
              );
              clusters.splice(clusters.length - lookback, lookback);
              for (let pIdx = 0; pIdx < partition.length; pIdx++) {
                clusters.push(this.finalizeDeterministicCluster(partition[pIdx], clusters.length + 1));
              }
              rebalanced = true;
              break;
            }
          }

          if (!rebalanced) {
            if (combinedDur <= 10.5) {
              this.mergeIntoLastDeterministicCluster(lastCluster, currentGroup);
            } else {
              const pool = [...((lastCluster as any).raw_items || []), ...currentGroup];
              const relaxed = this.partitionPool(pool, 3.5, 10.5) || this.partitionPool(pool, 3.0, 10.5);
              if (relaxed && relaxed.length >= 2) {
                clusters.pop();
                for (const p of relaxed) {
                  clusters.push(this.finalizeDeterministicCluster(p, clusters.length + 1));
                }
              } else if (currentDur >= 3.5) {
                clusters.push(this.finalizeDeterministicCluster(currentGroup, clusters.length + 1));
              } else {
                this.mergeIntoLastDeterministicCluster(lastCluster, currentGroup);
              }
            }
          }
        }
      }
    }

    // Comprehensive Safety Check across all clusters:
    // If any cluster violates [targetMinSec, 10.5] (and total audio >= targetMinSec),
    // first attempt to cascade rebalance across all preceding clusters, or globally partition.
    const totalScriptDur = items.reduce((sum, it) => sum + (it.timing.duration_sec || 0), 0);
    const hasAnyDefect = totalScriptDur >= targetMinSec && clusters.some(c => c.duration_sec < targetMinSec || c.duration_sec > 10.5);

    if (hasAnyDefect) {
      // 1. Try global DP partition across all items with optimal pacing
      const globalPartition = this.partitionPool(items, targetMinSec, 10.5, (targetMinSec + Math.min(targetMaxSec, 10.0)) / 2);
      if (globalPartition && globalPartition.length > 0) {
        clusters.length = 0;
        for (let pIdx = 0; pIdx < globalPartition.length; pIdx++) {
          clusters.push(this.finalizeDeterministicCluster(globalPartition[pIdx], pIdx + 1));
        }
      } else {
        // 2. Cascade lookback across all clusters for local defect repair
        for (let lookback = 2; lookback <= clusters.length; lookback++) {
          const pooledClusters = clusters.slice(clusters.length - lookback);
          const pool = pooledClusters.flatMap(c => (c as any).raw_items || []);
          const partition = this.partitionPool(pool, targetMinSec, 10.5);
          if (partition) {
            clusters.splice(clusters.length - lookback, lookback);
            for (let pIdx = 0; pIdx < partition.length; pIdx++) {
              clusters.push(this.finalizeDeterministicCluster(partition[pIdx], clusters.length + 1));
            }
            break;
          }
        }
      }
    }

    // Re-index all clusters cluster_index sequentially
    clusters.forEach((c, idx) => {
      c.cluster_index = idx + 1;
    });

    const totalDur = clusters.reduce((s, c) => s + c.duration_sec, 0);
    const avgDur = clusters.length > 0 ? (totalDur / clusters.length).toFixed(1) : '0';
    console.log(
      `📊 [GRANULARITY ENGINE V2 SUMMARY]\n` +
      `   * Mức thiết lập: ${granularity.toUpperCase()}\n` +
      `   * Tổng câu thoại gốc: ${scriptScenes.length}\n` +
      `   * Tổng shot được tạo ra: ${clusters.length}\n` +
      `   * Tỷ lệ nén: ${clusters.length}/${scriptScenes.length} (${Math.round((clusters.length / scriptScenes.length) * 100)}%)\n` +
      `   * Thời lượng trung bình: ${avgDur}s/shot`
    );

    return clusters;
  }

  // ==========================================================================
  // 4. Storyboard Generation & Validation (Phase 5 / spec §2)
  // ==========================================================================

  /**
   * Generates storyboard scenes and decomposed shots from script and probed timing.
   * Each shot receives an AI-decided media_type ('image' | 'video') and a human-readable
   * reason for the decision — no black-box outputs.
   *
   * Multi-clip splitting: if a video shot exceeds maxVideoClipDurationSec, it is split
   * into consecutive sub-shots (e.g. scene_01_shot_2a, scene_01_shot_2b) so each
   * generation call stays within model limits.
   *
   * Enforces absolute uniqueness of shot_ids formatted as {scene_id}_shot_{n}.
   * Persists to 04_storyboard/storyboard.json and updates index.json.
   */
  public async generateStoryboard(
    options: GenerateStoryboardOptions
  ): Promise<PipelineStoryboardData> {
    const { storage } = options;
    storage.ensureDirectories();

    const maxVideoClipSec = options.maxVideoClipDurationSec || 8.0;

    // 1. Resolve Script data
    const script = options.script || storage.readScript();
    if (!script || !Array.isArray(script.scenes) || script.scenes.length === 0) {
      throw new Error(
        `Cannot generate storyboard: script is missing or empty in project "${storage.projectId}"`
      );
    }

    // 2. Resolve Timing data
    let timing = options.timing || storage.readTiming();
    if (!timing || !Array.isArray(timing.scenes) || timing.scenes.length === 0) {
      // Auto-extract timing if missing
      timing = await this.extractTiming(storage, script.scenes.map(s => s.scene_id));
    }

    const timingMap = new Map<string, SceneTimingItem>();
    for (const t of timing.scenes) {
      timingMap.set(t.scene_id, t);
    }

    const presetKey = options.channelProfile?.visualArtStylePreset;
    const preset = presetKey && VISUAL_ART_STYLE_PRESETS[presetKey];
    const defaultPrefix = preset ? preset.stylePrefix : 'Cinematic lighting, 8k resolution, detailed photorealistic, masterpiece';
    const stylePrefix = options.stylePromptPrefix || defaultPrefix;
    const effectiveBgPrompt = options.backgroundPrompt || options.channelProfile?.projectBackgroundPrompt;
    const granularity: FlowGranularity = options.granularity || (options.shotMode === 'multi' ? 'detailed' : 'balanced');
    const thresholdSec = options.decompositionThresholdSec || 5.0;
    const isSingleShot = (options.shotMode === 'single' || granularity === 'fast') && options.shotMode !== 'multi';

    const processedScenes = script.scenes.map((scriptScene) => {
      const timingItem = timingMap.get(scriptScene.scene_id);
      if (!timingItem) {
        throw new Error(
          `Missing timing data for scene "${scriptScene.scene_id}". Ensure audio timing extraction has run.`
        );
      }
      return {
        ...scriptScene,
        duration_sec: timingItem.duration_sec,
      };
    });

    const enableClustering = options.shotMode !== 'single' && options.shotMode !== 'multi' && (options.enableClustering === true ||
      (options.enableClustering !== false &&
       options.shotMode !== 'single' &&
       options.shotMode !== 'multi' &&
       !options.customPromptGenerator &&
       script.scenes.length >= 4));

    let storyboardScenes: StoryboardSceneItem[] = [];

    if (enableClustering) {
      let clusteredScenes: StoryboardSceneItem[] | null = null;

      // Tier 1: Try LLM Semantic Clustering
      if (options.llmConfig) {
        try {
          const llmResult = await AiStudioLlmService.getInstance().clusterAndGenerateStoryboard({
            scriptLines: script.scenes,
            timingData: timing,
            stylePromptPrefix: stylePrefix,
            negativePrompt: options.negativePrompt,
            channelProfile: options.channelProfile,
            backgroundPrompt: effectiveBgPrompt,
            config: options.llmConfig,
            topic: options.topic || storage.projectId,
          });

          if (llmResult && Array.isArray(llmResult.shots) && llmResult.shots.length > 0) {
            const llmScenes: StoryboardSceneItem[] = [];
            let prevShotId: string | undefined = undefined;

            for (let idx = 0; idx < llmResult.shots.length; idx++) {
              const s = llmResult.shots[idx];
              const sceneId = `scene_${String(idx + 1).padStart(2, '0')}`;
              const assignedIndices: number[] = Array.isArray(s.assigned_sentences) && s.assigned_sentences.length > 0
                ? s.assigned_sentences
                : [idx + 1];

              const firstIdx = Math.max(0, Math.min(script.scenes.length - 1, assignedIndices[0] - 1));
              const lastIdx = Math.max(firstIdx, Math.min(script.scenes.length - 1, assignedIndices[assignedIndices.length - 1] - 1));

              const firstTiming = timing.scenes[firstIdx];
              const lastTiming = timing.scenes[lastIdx];
              const start_sec = firstTiming ? Math.round(firstTiming.start_sec * 100) / 100 : 0;
              const end_sec = lastTiming ? Math.round(lastTiming.end_sec * 100) / 100 : (start_sec + 5.0);
              let duration_sec = Math.round((end_sec - start_sec) * 100) / 100;
              const isVideo = s.media_type === 'video';
              if (isVideo) {
                duration_sec = Math.min(8.0, Math.max(2.0, duration_sec));
              }

              const assigned_scene_ids = script.scenes.slice(firstIdx, lastIdx + 1).map((sc) => sc.scene_id);
              const dialogue_lines = script.scenes.slice(firstIdx, lastIdx + 1).map((sc) => sc.narration);
              const combined_narration = dialogue_lines.join(' ');

              const shotId = `${sceneId}_shot_1`;
              const shot: StoryboardShotItem = {
                shot_id: shotId,
                shot_index: 1,
                start_sec,
                duration_sec,
                expected_duration_sec: duration_sec,
                assigned_sentences: assignedIndices,
                assigned_scene_ids,
                dialogue_lines,
                previous_shot_id: prevShotId,
                image_prompt: s.image_prompt,
                motion_note: s.motion_note || 'Slow cinematic push in',
                camera_angle: s.camera_angle || (isVideo ? 'medium_shot' : 'wide_establishing'),
                camera_movement: s.camera_movement || s.motion_note || 'slow push in camera',
                visual_action: s.visual_action || combined_narration,
                media_type: isVideo ? 'video' : 'image',
                reason: s.reason || `LLM phân cảnh cụm ${assigned_scene_ids.join(', ')}`,
                confidence: s.confidence || 'high',
              };
              prevShotId = shotId;

              llmScenes.push({
                scene_id: sceneId,
                start_sec,
                end_sec,
                duration_sec,
                narration: combined_narration,
                assigned_sentences: assignedIndices,
                assigned_scene_ids,
                shots: [shot],
              });
            }

            if (llmScenes.length > 0) {
              clusteredScenes = llmScenes;
            }
          }
        } catch {
          throw new Error('LLM không tạo được storyboard hợp lệ. Giữ nguyên script/audio/timing; không tự thay bằng phân cảnh mẫu.');
        }
      }

      // Tier 2: Deterministic Greedy Semantic Clustering fallback
      if (!clusteredScenes) {
        const clusters = this.clusterSentencesDeterministically(script.scenes, timing.scenes, granularity);
        const fallbackScenes: StoryboardSceneItem[] = [];
        let prevShotId: string | undefined = undefined;

        for (let cIdx = 0; cIdx < clusters.length; cIdx++) {
          const cluster = clusters[cIdx];
          const sceneId = `scene_${String(cIdx + 1).padStart(2, '0')}`;
          const shotId = `${sceneId}_shot_1`;

          const assignedScenes = script.scenes.filter((sc) => cluster.assigned_scene_ids.includes(sc.scene_id));
          const clusterItemWithMedia = assignedScenes.find(
            (sc: any) => sc.suggestedMediaType || sc.suggested_media_type || sc.media_type
          ) as any;
          const clusterExplicitMedia = clusterItemWithMedia
            ? (clusterItemWithMedia.suggestedMediaType || clusterItemWithMedia.suggested_media_type || clusterItemWithMedia.media_type)
            : undefined;

          const decision = this.decideMediaType(
            cluster.combined_narration,
            cluster.visual_notes.join('. '),
            cluster.duration_sec,
            clusterExplicitMedia ? { suggestedMediaType: clusterExplicitMedia } : undefined
          );
          const syntheticScene: ScriptSceneItem = {
            scene_id: sceneId,
            narration: cluster.combined_narration,
            visual_note: cluster.visual_notes.join('. ') || cluster.combined_narration,
          };
          const imagePrompt = this.buildShotPrompt(
            syntheticScene,
            1,
            1,
            stylePrefix,
            options.channelProfile,
            effectiveBgPrompt
          );
          const motionNote = this.buildMotionNote(1, 1, decision.media_type, {
            narration: cluster.combined_narration,
            visualNote: cluster.visual_notes.join('. '),
            cameraMotion: decision.camera_motion,
            cameraAngle: decision.camera_angle,
          });

          let effectiveDur = cluster.duration_sec;
          if (decision.media_type === 'video') {
            effectiveDur = Math.min(8.0, Math.max(2.0, effectiveDur));
          }

          const shot: StoryboardShotItem = {
            shot_id: shotId,
            shot_index: 1,
            start_sec: cluster.start_sec,
            duration_sec: effectiveDur,
            expected_duration_sec: effectiveDur,
            assigned_sentences: cluster.assigned_indices,
            assigned_scene_ids: cluster.assigned_scene_ids,
            dialogue_lines: cluster.dialogue_lines,
            previous_shot_id: prevShotId,
            image_prompt: imagePrompt,
            motion_note: motionNote,
            camera_angle: decision.camera_angle,
            camera_movement: decision.camera_motion,
            visual_action: cluster.visual_notes.join('. ') || cluster.combined_narration,
            media_type: decision.media_type,
            reason: decision.reason,
            confidence: decision.confidence,
          };
          prevShotId = shotId;

          fallbackScenes.push({
            scene_id: sceneId,
            start_sec: cluster.start_sec,
            end_sec: cluster.end_sec,
            duration_sec: cluster.duration_sec,
            narration: cluster.combined_narration,
            assigned_sentences: cluster.assigned_indices,
            assigned_scene_ids: cluster.assigned_scene_ids,
            shots: [shot],
          });
        }

        clusteredScenes = fallbackScenes;
      }

      storyboardScenes = clusteredScenes || [];
    } else {
      // Non-clustered mode (1:1 or per-scene multi-shot decomposition)
      let timelineSec = 0;
      let prevShotId: string | undefined = undefined;

      for (let scIdx = 0; scIdx < processedScenes.length; scIdx++) {
        const scriptScene = processedScenes[scIdx];
        const durationSec = scriptScene.duration_sec;
        const timingItem = timingMap.get(scriptScene.scene_id);
        const sceneStartSec = timingItem ? timingItem.start_sec : timelineSec;
        let shotCurrentSec = sceneStartSec;
        const shots: StoryboardShotItem[] = [];

        if (options.customPromptGenerator) {
          // Use custom shot planner if provided — still apply AI media_type decision
          const numShots = isSingleShot
            ? 1
            : durationSec > thresholdSec
            ? Math.max(2, Math.ceil(durationSec / 4.0))
            : 1;
          const baseDur = Math.round((durationSec / numShots) * 100) / 100;

          for (let i = 1; i <= numShots; i++) {
            const shotId = `${scriptScene.scene_id}_shot_${i}`;
            const isLast = i === numShots;
            const shotDur = isLast ? Math.round((durationSec - baseDur * (numShots - 1)) * 100) / 100 : baseDur;
            const customPrompt = options.customPromptGenerator(scriptScene as any, i, numShots, shotDur);
            const explicitMedia = (scriptScene as any).suggestedMediaType || (scriptScene as any).suggested_media_type || (scriptScene as any).media_type;
            const decision = this.decideMediaType(
              scriptScene.narration,
              scriptScene.visual_note,
              shotDur,
              explicitMedia ? { suggestedMediaType: explicitMedia } : undefined
            );
            decision.camera_angle = scriptScene.cameraAngle || decision.camera_angle;
            decision.camera_motion = scriptScene.cameraMovement || decision.camera_motion;
            const effectiveShotDur = shotDur;

            shots.push({
              shot_id: shotId,
              shot_index: i,
              start_sec: Math.round(shotCurrentSec * 100) / 100,
              duration_sec: effectiveShotDur,
              expected_duration_sec: decision.media_type === 'video' ? Math.min(maxVideoClipSec, Math.max(2, effectiveShotDur)) : effectiveShotDur,
              assigned_sentences: [scIdx + 1],
              assigned_scene_ids: [scriptScene.scene_id],
              dialogue_lines: [scriptScene.narration],
              previous_shot_id: prevShotId,
              image_prompt: customPrompt.image_prompt,
              motion_note: customPrompt.motion_note,
              camera_angle: decision.camera_angle,
              camera_movement: decision.camera_motion,
              visual_action: scriptScene.visual_note || scriptScene.narration,
              media_type: decision.media_type,
              reason: decision.reason,
              confidence: decision.confidence,
            });
            prevShotId = shotId;
            shotCurrentSec += effectiveShotDur;
          }
        } else {
          // Default intelligent duration-based decomposition with AI media_type decision
          const sceneExplicitMedia = (scriptScene as any).suggestedMediaType || (scriptScene as any).suggested_media_type || (scriptScene as any).media_type;
          const isStaticScene = granularity === 'balanced' &&
            !sceneExplicitMedia && !scriptScene.cameraAngle && !scriptScene.cameraMovement &&
            this.isStaticOrDescriptiveNarration(scriptScene.narration, scriptScene.visual_note) &&
            durationSec <= 10.0;

          const rawShots = (isSingleShot || isStaticScene)
            ? [{ index: 1, durationSec }]
            : this.decomposeSceneIntoRawShots(scriptScene as any, durationSec, thresholdSec);

          for (const raw of rawShots) {
            const decision = (isStaticScene && !sceneExplicitMedia)
              ? {
                  media_type: 'image' as const,
                  reason: 'Cân bằng pacing: Phân cảnh mô tả tĩnh được giữ làm 1 shot ảnh kèm hiệu ứng Ken Burns để chống giật hình và tối ưu chi phí.',
                  confidence: 'high' as const,
                  videoScore: 0,
                  imageScore: 3,
                  camera_angle: 'wide_establishing',
                  camera_motion: 'static',
                  duration_sec: raw.durationSec,
                }
              : this.decideMediaType(
                  scriptScene.narration,
                  scriptScene.visual_note,
                  raw.durationSec,
                  sceneExplicitMedia ? { suggestedMediaType: sceneExplicitMedia } : undefined
                );
            decision.camera_angle = scriptScene.cameraAngle || decision.camera_angle;
            decision.camera_motion = scriptScene.cameraMovement || decision.camera_motion;
            const imagePrompt = this.buildShotPrompt(scriptScene as any, raw.index, rawShots.length, stylePrefix, options.channelProfile, effectiveBgPrompt);
            const motionNote = isStaticScene
              ? 'Ken Burns subtle pan and slow zoom in'
              : this.buildMotionNote(raw.index, rawShots.length, decision.media_type, {
                  narration: scriptScene.narration,
                  visualNote: scriptScene.visual_note,
                  cameraMotion: decision.camera_motion,
                  cameraAngle: decision.camera_angle,
                });

            const effectiveShotDur = raw.durationSec;

            // Multi-clip splitting: if video shot exceeds model limit, split into sub-shots
            if (decision.media_type === 'video' && effectiveShotDur > maxVideoClipSec && !isSingleShot) {
              const subShots = this.splitIntoMultiClips(
                scriptScene.scene_id,
                raw.index,
                effectiveShotDur,
                maxVideoClipSec,
                imagePrompt,
                motionNote,
                decision,
                Math.round(shotCurrentSec * 100) / 100,
                [scIdx + 1],
                [scriptScene.scene_id],
                [scriptScene.narration],
                prevShotId
              );
              shots.push(...subShots);
              if (subShots.length > 0) {
                prevShotId = subShots[subShots.length - 1].shot_id;
              }
              shotCurrentSec += effectiveShotDur;
            } else {
              const shotId = `${scriptScene.scene_id}_shot_${raw.index}`;
              shots.push({
                shot_id: shotId,
                shot_index: raw.index,
                start_sec: Math.round(shotCurrentSec * 100) / 100,
                duration_sec: effectiveShotDur,
                expected_duration_sec: decision.media_type === 'video' ? Math.min(maxVideoClipSec, Math.max(2, effectiveShotDur)) : effectiveShotDur,
                assigned_sentences: [scIdx + 1],
                assigned_scene_ids: [scriptScene.scene_id],
                dialogue_lines: [scriptScene.narration],
                previous_shot_id: prevShotId,
                image_prompt: imagePrompt,
                motion_note: motionNote,
                camera_angle: decision.camera_angle,
                camera_movement: decision.camera_motion,
                visual_action: scriptScene.visual_note || scriptScene.narration,
                media_type: decision.media_type,
                reason: decision.reason,
                confidence: decision.confidence,
              });
              prevShotId = shotId;
              shotCurrentSec += effectiveShotDur;
            }
          }
        }

        // Re-index shot_index sequentially after any multi-clip expansion
        shots.forEach((shot, idx) => {
          (shot as any).shot_index = idx + 1;
        });

        // Playback duration follows narration; generation clip length is a separate constraint.
        const totalShotDur = shots.reduce((acc, shot) => acc + (shot.duration_sec || 0), 0);
        const diff = durationSec - totalShotDur;
        if (Math.abs(diff) > 0.01 && shots.length > 0) {
          const lastShot = shots[shots.length - 1];
          lastShot.duration_sec = Math.round((lastShot.duration_sec! + diff) * 100) / 100;
          lastShot.expected_duration_sec = lastShot.media_type === 'video'
            ? Math.min(maxVideoClipSec, Math.max(2, lastShot.duration_sec)) : lastShot.duration_sec;
        }

        storyboardScenes.push({
          scene_id: scriptScene.scene_id,
          start_sec: sceneStartSec,
          end_sec: sceneStartSec + durationSec,
          duration_sec: durationSec,
          narration: scriptScene.narration,
          assigned_sentences: [scIdx + 1],
          assigned_scene_ids: [scriptScene.scene_id],
          shots,
        });

        timelineSec = sceneStartSec + durationSec;
      }
    }

    // 4. Bước TỔNG HỢP (Synthesis) & Tính toán ước tính sản xuất
    const synthesis = this.synthesizeStoryboard(storyboardScenes, granularity);

    const storyboardData: PipelineStoryboardData = {
      project_id: storage.projectId,
      scenes: storyboardScenes,
      synthesis,
    };

    // 5. Validate storyboard (uniqueness, required fields)
    this.validateStoryboard(storyboardData);

    // 6. Persist 04_storyboard/storyboard.json
    storage.saveStoryboard(storyboardData);

    // 7. Update index.json scene and shot metadata
    for (const sc of storyboardScenes) {
      storage.updateSceneMetadata(sc.scene_id, {
        narration: sc.narration,
        timing: typeof sc.start_sec === 'number' && typeof sc.duration_sec === 'number'
          ? {
              start_sec: sc.start_sec,
              end_sec: sc.end_sec || (sc.start_sec + sc.duration_sec),
              duration_sec: sc.duration_sec,
            }
          : undefined,
      });

      for (const shot of sc.shots) {
        storage.updateShotMetadata(sc.scene_id, shot.shot_id, {
          image_prompt_used: shot.image_prompt,
          motion_note: shot.motion_note,
          start_sec: shot.start_sec,
          duration_sec: shot.duration_sec,
          expected_duration_sec: shot.expected_duration_sec,
          assigned_sentences: shot.assigned_sentences,
          assigned_scene_ids: shot.assigned_scene_ids,
          dialogue_lines: shot.dialogue_lines,
          previous_shot_id: shot.previous_shot_id,
          status: 'pending',
        });
      }
    }

    // 8. Append action log
    const totalShots = synthesis.total_shots;
    const videoShots = synthesis.video_shots;
    const imageShots = synthesis.image_shots;
    storage.appendActionLog({
      ts: new Date().toISOString(),
      action: 'storyboard',
      target: '04_storyboard/storyboard.json',
      retry: 0,
      status: 'ok',
      details: {
        scene_count: storyboardScenes.length,
        shot_count: totalShots,
        image_shots: imageShots,
        video_shots: videoShots,
        avg_duration_per_shot_sec: synthesis.avg_duration_per_shot_sec,
        estimated_production_time_sec: synthesis.estimated_production_time_sec,
        estimated_credits: synthesis.estimated_credits,
        granularity,
      },
    });

    console.log(
      `[AiStudioStoryboardService] ✅ Storyboard tạo xong [${granularity.toUpperCase()}]: ${storyboardScenes.length} scene, ${totalShots} shot (${imageShots} ảnh / ${videoShots} video, TB ${synthesis.avg_duration_per_shot_sec}s/shot, ~${Math.round(synthesis.estimated_production_time_sec / 60)} phút, ~${synthesis.estimated_credits} credits)`
    );
    if (synthesis.is_too_fragmented && synthesis.warning) {
      console.warn(`[AiStudioStoryboardService] ⚠️ ${synthesis.warning}`);
    }

    return storyboardData;
  }

  /**
   * Phân tích nội dung narration và visual_note để phát hiện các câu mô tả tĩnh,
   * thiếu chuyển động mạnh, hoặc lặp lại bối cảnh — phục vụ gom cụm phân cảnh.
   */
  public isStaticOrDescriptiveNarration(narration: string, visualNote?: string): boolean {
    const rawText = (narration + ' ' + (visualNote || '')).toLowerCase();

    // Loại trừ các cụm từ dễ nhầm lẫn sang động từ mạnh
    const text = rawText
      .replace(/đánh giá/g, '')
      .replace(/đánh dấu/g, '')
      .replace(/đánh đổi/g, '')
      .replace(/hành động cụ thể/g, '');

    // Động từ chuyển động mạnh hoặc biến cố kịch bản gay cấn -> KHÔNG PHẢI TĨNH
    const dynamicKeywords = [
      'chạy', 'nhảy', 'bay', 'lao', 'đuổi', 'chiến đấu', ' nổ ', ' bùng nổ', 'rơi', 'sụp đổ',
      'phóng', 'va chạm', 'biến hình', 'tấn công', 'chém', 'bắn', 'bùng phát', 'di cư',
      'run', 'jump', 'fly', 'chase', 'fight', 'explode', 'fall', 'crash', 'transform', 'dash', 'attack'
    ];
    if (dynamicKeywords.some(kw => text.includes(kw))) {
      return false;
    }

    // Từ khóa mô tả tĩnh, nhận định, bối cảnh chung, suy nghĩ, giải thích, lịch sử
    const staticKeywords = [
      'là một', 'vẫn là', 'đang đứng', 'ngồi im', 'tĩnh lặng', 'bầu trời', 'khung cảnh',
      'nhìn chung', 'như đã biết', 'không gian', 'mô tả', 'cảnh quan', 'vẻ đẹp', 'được biết',
      'ý nghĩa', 'lý do', 'thực tế', 'trong khi đó', 'thời bấy giờ', 'xung quanh', 'tổng quan',
      'lịch sử', 'hình thành', 'phát triển', 'bắt đầu', 'ra đời', 'xuất hiện', 'nguồn gốc',
      'thời kỳ', 'giai đoạn', 'câu chuyện', 'giới thiệu', 'thế giới',
      'standing', 'sitting', 'silent', 'landscape', 'scenery', 'atmosphere', 'calm', 'peaceful', 'overview', 'history'
    ];
    if (staticKeywords.some(kw => text.includes(kw))) {
      return true;
    }

    // Nếu câu ngắn dưới 55 ký tự và không có động từ mạnh -> xem là mô tả bối cảnh
    return text.trim().length < 55;
  }

  /**
   * Bước TỔNG HỢP (Storyboard Synthesis) & Đề xuất / Dự toán Sản xuất
   */
  public synthesizeStoryboard(
    scenes: StoryboardSceneItem[],
    granularity: FlowGranularity = 'balanced'
  ): StoryboardSynthesis {
    const totalShots = scenes.reduce((sum, s) => sum + s.shots.length, 0);
    const videoShots = scenes.reduce((sum, s) => sum + s.shots.filter(sh => sh.media_type === 'video').length, 0);
    const imageShots = totalShots - videoShots;
    const totalDurationSec = scenes.reduce((sum, s) => sum + s.duration_sec, 0);
    const avgDurationPerShotSec = totalShots > 0 ? Math.round((totalDurationSec / totalShots) * 10) / 10 : 0;
    const isTooFragmented = avgDurationPerShotSec > 0 && avgDurationPerShotSec < 2.5;

    let warning: string | undefined;
    if (isTooFragmented) {
      warning = `Phân cảnh đang quá vụn (trung bình ${avgDurationPerShotSec}s/shot < 2.5s). Khuyến nghị chuyển sang mức "Cân bằng" hoặc "Nhanh" để gộp các câu thoại liền kề, tối ưu thời gian sản xuất và tiết kiệm credit.`;
    }

    // Thời gian ước tính: ~22s cho ảnh và ~65s cho video
    const estimatedProductionTimeSec = imageShots * 22 + videoShots * 65;
    // Credit ước tính: 1 credit / ảnh, 5 credits / video
    const estimatedCredits = imageShots * 1 + videoShots * 5;

    return {
      total_shots: totalShots,
      image_shots: imageShots,
      video_shots: videoShots,
      total_duration_sec: Math.round(totalDurationSec * 10) / 10,
      avg_duration_per_shot_sec: avgDurationPerShotSec,
      is_too_fragmented: isTooFragmented,
      warning,
      estimated_production_time_sec: estimatedProductionTimeSec,
      estimated_credits: estimatedCredits,
      granularity,
    };
  }

  // ==========================================================================
  // 5. Multi-Clip Splitting (spec: exceed model generation limit)
  // ==========================================================================

  /**
   * Splits a single video shot that exceeds maxVideoClipSec into consecutive
   * sub-shots, each within model limits. Sub-shot IDs use suffix _a, _b, _c...
   * e.g. scene_01_shot_2a, scene_01_shot_2b
   */
  private splitIntoMultiClips(
    sceneId: string,
    shotIndex: number,
    totalDurationSec: number,
    maxClipSec: number,
    imagePrompt: string,
    motionNote: string,
    decision: MediaTypeDecision,
    startSec = 0,
    assignedSentences: number[] = [1],
    assignedSceneIds: string[] = [sceneId],
    dialogueLines: string[] = [],
    initialPreviousShotId?: string
  ): StoryboardShotItem[] {
    const subShots: StoryboardShotItem[] = [];
    const safeMaxClipSec = Math.min(8.0, Math.max(2.0, maxClipSec));
    const numClips = Math.ceil(totalDurationSec / safeMaxClipSec);
    const clipDur = Math.round((totalDurationSec / numClips) * 100) / 100;
    const suffixes = 'abcdefghijklmnopqrstuvwxyz';

    console.log(
      `[AiStudioStoryboardService] 🎬 Multi-clip split: ${sceneId}_shot_${shotIndex} (${totalDurationSec}s) → ${numClips} clips à ${clipDur}s (limit: ${safeMaxClipSec}s/clip)`
    );

    let currentStart = startSec;
    let prevId = initialPreviousShotId;

    for (let c = 0; c < numClips; c++) {
      const isLast = c === numClips - 1;
      let subDur = isLast
        ? Math.round((totalDurationSec - clipDur * (numClips - 1)) * 100) / 100
        : clipDur;
      // Strictly clamp video clip duration within Veo limits [2.0s, 8.0s]
      subDur = Math.min(8.0, Math.max(2.0, subDur));
      const shotId = `${sceneId}_shot_${shotIndex}${suffixes[c]}`;

      subShots.push({
        shot_id: shotId,
        shot_index: shotIndex,
        start_sec: currentStart,
        duration_sec: subDur,
        expected_duration_sec: subDur,
        assigned_sentences: assignedSentences,
        assigned_scene_ids: assignedSceneIds,
        dialogue_lines: dialogueLines,
        previous_shot_id: prevId,
        image_prompt: imagePrompt,
        motion_note: c === 0 ? motionNote : `continuous: ${motionNote}`,
        camera_angle: decision.camera_angle,
        camera_movement: decision.camera_motion,
        visual_action: dialogueLines.join(' '),
        media_type: 'video',
        reason: `${decision.reason} [Multi-clip ${c + 1}/${numClips}: shot dài ${totalDurationSec}s vượt giới hạn ${safeMaxClipSec}s/lần generate]`,
        confidence: decision.confidence,
      });

      prevId = shotId;
      currentStart = Math.round((currentStart + subDur) * 100) / 100;
    }

    return subShots;
  }

  // ==========================================================================
  // 6. Storyboard Validation
  // ==========================================================================

  /**
   * Enforces:
   * - Absolute uniqueness of all shot_ids across the storyboard
   * - Hierarchical format {scene_id}_shot_{n}
   * - `media_type` must be 'image' or 'video'
   * - `reason` must be non-empty string
   * Throws a descriptive error if any constraint is violated.
   */
  public validateStoryboard(storyboard: PipelineStoryboardData): void {
    if (!storyboard || !Array.isArray(storyboard.scenes)) {
      throw new Error('Invalid storyboard data: missing scenes array');
    }

    const seenShotIds = new Map<string, string>(); // shot_id → scene_id

    for (const sc of storyboard.scenes) {
      if (!sc.scene_id || typeof sc.scene_id !== 'string') {
        throw new Error(`Storyboard scene has missing or invalid scene_id: "${sc.scene_id}"`);
      }

      if (!Array.isArray(sc.shots) || sc.shots.length === 0) {
        throw new Error(`Storyboard scene "${sc.scene_id}" has no shots defined`);
      }

      const expectedPrefix = `${sc.scene_id}_shot_`;

      for (const shot of sc.shots) {
        if (!shot.shot_id || typeof shot.shot_id !== 'string') {
          throw new Error(`Shot in scene "${sc.scene_id}" is missing shot_id`);
        }

        // Validate hierarchical naming contract
        if (!shot.shot_id.startsWith(expectedPrefix)) {
          throw new Error(
            `Invalid shot_id format: "${shot.shot_id}". Must strictly follow hierarchical pattern "${expectedPrefix}{n}"`
          );
        }

        // Validate uniqueness across the entire storyboard
        if (seenShotIds.has(shot.shot_id)) {
          const priorScene = seenShotIds.get(shot.shot_id);
          throw new Error(
            `Duplicate shot_id detected: "${shot.shot_id}". Found in scene "${sc.scene_id}" but was already registered in scene "${priorScene}". All shot_ids must be globally unique.`
          );
        }

        // Validate media_type (if present)
        if (shot.media_type !== undefined && shot.media_type !== 'image' && shot.media_type !== 'video') {
          throw new Error(
            `Shot "${shot.shot_id}" has invalid or missing media_type: "${shot.media_type}". Must be "image" or "video".`
          );
        }

        // Validate reason is non-empty (if media_type is present)
        if (shot.media_type !== undefined && (!shot.reason || typeof shot.reason !== 'string' || shot.reason.trim().length === 0)) {
          throw new Error(
            `Shot "${shot.shot_id}" is missing required "reason" field. Every shot must explain why image/video was chosen.`
          );
        }

        seenShotIds.set(shot.shot_id, sc.scene_id);
      }
    }
  }

  // ==========================================================================
  // 7. Internal Helpers
  // ==========================================================================

  /**
   * Decomposes a scene's total duration into raw shot time slots.
   * Returns array of { index, durationSec } for further processing.
   */
  private decomposeSceneIntoRawShots(
    scene: ScriptSceneItem,
    durationSec: number,
    thresholdSec: number
  ): Array<{ index: number; durationSec: number }> {
    if (durationSec <= thresholdSec) {
      return [{ index: 1, durationSec }];
    }

    const numShots = Math.max(2, Math.min(4, Math.ceil(durationSec / 4.0)));
    const baseDur = Math.round((durationSec / numShots) * 100) / 100;
    const result: Array<{ index: number; durationSec: number }> = [];

    for (let i = 1; i <= numShots; i++) {
      const isLast = i === numShots;
      const shotDur = isLast
        ? Math.round((durationSec - baseDur * (numShots - 1)) * 100) / 100
        : baseDur;
      result.push({ index: i, durationSec: shotDur });
    }

    return result;
  }

  // ==========================================================================
  // Prompt Synthesis Helpers
  // ==========================================================================

  /**
   * Chuyển thể nội dung lời thoại thô / dẫn chuyện sang mô tả bối cảnh trực quan điện ảnh thuần túy
   * bằng tiếng Anh chuẩn (Visual Concept / Scene Illustration), loại bỏ hoàn toàn câu nói và phụ đề (R3).
   */
  public convertNarrationToVisualConcept(narration: string, visualNote?: string): string {
    const rawNote = (visualNote || '').trim();
    const hasVietnameseDiacritics = /[àáạảãâầấậẩẫăằắặẳẵèéẹẻẽêềếệểễìíịỉĩòóọỏõôồốộổỗơờớợởỡùúụủũưừứựửữỳýỵỷỹđ]/i;

    // Explicit visual instructions keep their subject, actions and setting in any language.
    if (rawNote) return rawNote.replace(/["“”'‘’«»]/g, '').trim();

    // 2. Nếu visual_note là tiếng Việt hoặc chỉ có narration:
    let text = (rawNote || narration || '').trim();

    // Strip speaker markers
    text = text.replace(/^(?:người dẫn|dẫn chuyện|nhân vật|mc|host|narrator|voiceover|speaker)[\s\d]*:?\s*/gi, '');
    // Strip dialogue attribution verbs and trailing quoted speech
    text = text.replace(/(?:nói|bảo|thốt lên|thì thầm|hét lên|reo lên|hỏi|đáp|trả lời|nhủ|hô vang|kêu lên)\s*:\s*.*$/gi, '').trim();
    // Strip explicit dialogue indicator words
    text = text.replace(/(?:lời thoại|phụ đề|câu nói|subtitles?|dialogue):?\s*/gi, '').trim();
    // Strip quotation marks
    text = text.replace(/["“”'‘’«»]/g, '').trim();

    // Nếu đã là tiếng Anh và không còn tiếng Việt:
    if (!hasVietnameseDiacritics.test(text) && text.length > 5) {
      return text;
    }

    // 3. Chuyển thể ngữ cảnh tiếng Việt sang các lớp mô tả thị giác điện ảnh chuẩn tiếng Anh
    const lower = text.toLowerCase();
    const visualConcepts: string[] = [];

    // Setting & Environment mapping
    if (lower.includes('tokyo') || lower.includes('nhật bản') || lower.includes('mặt trời mọc')) {
      visualConcepts.push('historic 19th century Japanese setting, authentic traditional architectural details');
    }
    if (lower.includes('phố') || lower.includes('đường') || lower.includes('ngõ') || lower.includes('ginza')) {
      visualConcepts.push('historic cobblestone urban streets, vintage period architecture');
    }
    if (lower.includes('đại học') || lower.includes('thí nghiệm') || lower.includes('giáo sư') || lower.includes('học trò') || lower.includes('phòng')) {
      visualConcepts.push('vintage academic laboratory, scientific apparatus and vintage instruments');
    }
    if (lower.includes('công nghiệp') || lower.includes('nhà máy') || lower.includes('kỷ nguyên') || lower.includes('mạng lưới')) {
      visualConcepts.push('nascent industrial era atmosphere, early modern infrastructure');
    }
    if (lower.includes('biển') || lower.includes('đại dương') || lower.includes('sóng')) {
      visualConcepts.push('vast dramatic seascape, cinematic ocean waves');
    }
    if (lower.includes('núi') || lower.includes('rừng') || lower.includes('cây')) {
      visualConcepts.push('misty wilderness landscape, dramatic natural scenery');
    }

    // Lighting & Atmosphere mapping
    if (lower.includes('đêm') || lower.includes('tối') || lower.includes('bóng tối') || lower.includes('màn đêm')) {
      visualConcepts.push('atmospheric night setting, deep dramatic shadows');
    } else if (lower.includes('hoàng hôn') || lower.includes('chiều')) {
      visualConcepts.push('warm golden hour sunset lighting, dramatic evening glow');
    } else if (lower.includes('bình minh') || lower.includes('sáng') || lower.includes('ánh nắng')) {
      visualConcepts.push('warm morning illumination, soft natural sunlight');
    }

    if (lower.includes('đèn dầu') || lower.includes('ánh lửa') || lower.includes('leo lét') || lower.includes('lập lòe')) {
      visualConcepts.push('flickering lantern illumination, warm historic lamp glow');
    } else if (lower.includes('điện') || lower.includes('hồ quang') || lower.includes('bừng sáng') || lower.includes('chói lòa') || lower.includes('tia sáng')) {
      visualConcepts.push('brilliant electric arc illumination, radiant glowing light beam');
    }

    // Action & Mood mapping
    if (lower.includes('kinh ngạc') || lower.includes('sững sờ') || lower.includes('bước ngoặt') || lower.includes('lịch sử')) {
      visualConcepts.push('monumental historic breakthrough moment, dramatic sense of wonder');
    }
    if (lower.includes('người dân') || lower.includes('đoàn người') || lower.includes('đám đông')) {
      visualConcepts.push('period-authentic human figures, authentic atmospheric silhouettes');
    }

    if (visualConcepts.length > 0) {
      return visualConcepts.join(', ');
    }

    // Fallback nếu câu tiếng Việt có visual_note cụ thể
    if (rawNote) {
      return rawNote.replace(/["“”'‘’«»]/g, '').trim();
    }
    return 'cinematic period narrative scene illustration, atmospheric environmental lighting, highly detailed staging';
  }

  public buildShotPrompt(
    scene: ScriptSceneItem,
    shotIndex: number,
    totalShots: number,
    stylePrefix: string,
    channelProfile?: Partial<ChannelProfileConfig>,
    backgroundPrompt?: string
  ): string {
    // Contextual camera angle determination (eliminates static modulo shotIndex logic)
    const rawAngle = (scene as any).camera_angle || (scene as any).cameraAngle;
    let effectiveAngle = rawAngle;

    if (!effectiveAngle) {
      const plan = this.planCinematography(scene.narration, scene.visual_note);
      effectiveAngle = plan.camera_angle;
    }

    let anglePrefix = 'Medium cinematic shot';
    switch (effectiveAngle) {
      case 'wide_establishing':
      case 'extreme_wide':
        anglePrefix = 'Wide establishing cinematic shot';
        break;
      case 'close_up':
      case 'extreme_close_up':
        anglePrefix = 'Close-up dramatic focus shot';
        break;
      case 'low_angle':
        anglePrefix = 'Dramatic low-angle hero shot';
        break;
      case 'high_angle':
        anglePrefix = 'Cinematic high-angle perspective shot';
        break;
      case 'point_of_view':
      case 'pov':
        anglePrefix = 'First-person point-of-view perspective shot';
        break;
      case 'medium_shot':
      default:
        anglePrefix = 'Medium action tracking shot';
        break;
    }

    // Clean raw dialogue / quotes and convert narration to pure visual concept in standard English (R3)
    const cleanVisualContent = this.convertNarrationToVisualConcept(scene.narration, scene.visual_note);

    // 1. Detect Character Appearance / Outfits
    let characterSnippet = '';
    const sceneText = `${scene.visual_note || ''} ${scene.narration || ''}`.toLowerCase();

    if (channelProfile?.channelCharacters && channelProfile.channelCharacters.length > 0) {
      for (const char of channelProfile.channelCharacters) {
        if (char.name && sceneText.includes(char.name.toLowerCase())) {
          characterSnippet = `featuring character ${char.name}${char.descriptionEn ? ` (${char.descriptionEn.trim()})` : ''}`;
          break;
        }
      }
    }

    if (!characterSnippet && channelProfile?.hostDescription) {
      const hostName = (channelProfile.hostName || '').toLowerCase();
      const hasHostMention = Boolean(hostName && sceneText.includes(hostName));
      const hasGenericCharacterMention = /\b(host|mc|người dẫn|nhân vật|chuyên gia|tôi|anh ấy|cô ấy|cậu bé|chàng trai|cô gái|narrator|protagonist|character)\b/i.test(sceneText);

      if (hasHostMention || hasGenericCharacterMention) {
        const hName = channelProfile.hostName ? `${channelProfile.hostName}: ` : '';
        characterSnippet = `featuring ${hName}${channelProfile.hostDescription.trim()}`;
      }
    }

    // 2. Detect Project Background Style
    const effectiveBg = (backgroundPrompt || channelProfile?.projectBackgroundPrompt || '').trim();
    const bgSnippet = effectiveBg ? `in ${effectiveBg}` : '';

    // 3. Assemble prompt layers: [Art Style] + [Camera Angle & Action] + [Character] + [Background] + [Quality Details] + [Anti-text Instruction]
    const promptParts: string[] = [stylePrefix, `${anglePrefix} of ${cleanVisualContent}`];
    if (characterSnippet) {
      promptParts.push(characterSnippet);
      promptParts.push('character depicted in natural active pose, seamlessly interacting with the scene, consistent identity, dynamic environmental lighting');
    }
    if (bgSnippet) {
      promptParts.push(bgSnippet);
    }
    promptParts.push('sharp focus, highly detailed, photorealistic');
    promptParts.push('no text, no subtitles, no speech bubbles, no words, clean visual illustration');

    return promptParts.join(', ');
  }

  public buildMotionNote(
    shotIndex: number,
    totalShots: number,
    mediaType: ShotMediaType,
    context?: {
      narration?: string;
      visualNote?: string;
      cameraMotion?: string;
      cameraAngle?: string;
    }
  ): string {
    // Contextual camera motion planning (eliminates static modulo shotIndex logic)
    let motionType = context?.cameraMotion;
    if (!motionType && (context?.narration || context?.visualNote)) {
      const plan = this.planCinematography(context.narration || '', context.visualNote);
      motionType = plan.camera_motion;
    }

    if (mediaType === 'image') {
      switch (motionType) {
        case 'pan_left_to_right':
          return 'Ken Burns: slow pan right, establishing drift';
        case 'pan_right_to_left':
          return 'Ken Burns: slow pan left, revealing vista';
        case 'dolly_in':
          return 'Ken Burns: slow zoom in, focus pull';
        case 'dolly_out':
          return 'Ken Burns: subtle zoom out, gentle drift';
        case 'pedestal_up':
          return 'Ken Burns: gentle tilt up, expansive view';
        case 'static':
        default:
          return 'Ken Burns: slow zoom in from wide';
      }
    }

    // Video media type: derive professional camera movement contextually
    switch (motionType) {
      case 'pan_left_to_right':
        return 'slow pan right, cinematic establishing movement';
      case 'pan_right_to_left':
        return 'slow pan left, cinematic sweeping vista';
      case 'dolly_in':
        return 'slow push in camera, tracking subject';
      case 'dolly_out':
        return 'slow dolly out, revealing expansive action';
      case 'pedestal_up':
        return 'pedestal up camera rising smoothly';
      case 'static':
        return 'steady stationary camera framing, subtle ambient motion';
      default: {
        const text = `${context?.narration || ''} ${context?.visualNote || ''}`.toLowerCase();
        if (text.includes('chạy') || text.includes('đuổi') || text.includes('tiến')) {
          return 'slow push in camera, tracking subject';
        }
        if (text.includes('toàn cảnh') || text.includes('thành phố')) {
          return 'slow pan right, cinematic establishing movement';
        }
        if (text.includes('cảm xúc') || text.includes('khuôn mặt')) {
          return 'subtle dynamic zoom, dramatic focal emphasis';
        }
        return 'slow push in camera, steady cinematic framing';
      }
    }
  }
}

export const aiStudioStoryboardService = AiStudioStoryboardService.getInstance();
