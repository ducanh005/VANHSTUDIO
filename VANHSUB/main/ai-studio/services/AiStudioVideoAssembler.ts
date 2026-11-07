import fs from 'fs';
import path from 'path';
import ffmpeg from 'fluent-ffmpeg';
import ffmpegInstaller from '@ffmpeg-installer/ffmpeg';
import ffprobeInstaller from '@ffprobe-installer/ffprobe';
import type {
  AiStudioRenderingConfig,
  AiStudioSubtitleConfig,
  FlowAspectRatio,
  RenderingResolution,
  ScriptBeatLine,
  StoryboardScene,
  WordTimestamp,
} from '../types';

// Setup FFmpeg & FFprobe binary paths
const rawFfmpegPath = (ffmpegInstaller as any)?.path || (ffmpegInstaller as any)?.default?.path || '';
const rawFfprobePath = (ffprobeInstaller as any)?.path || (ffprobeInstaller as any)?.default?.path || '';

if (rawFfmpegPath) {
  ffmpeg.setFfmpegPath(rawFfmpegPath.replace('app.asar', 'app.asar.unpacked'));
}
if (rawFfprobePath) {
  ffmpeg.setFfprobePath(rawFfprobePath.replace('app.asar', 'app.asar.unpacked'));
}

/**
 * Escapes Windows path for libass subtitles filter in FFmpeg.
 * Converts backslashes to forward slashes and escapes drive letter colons (e.g. C: -> C\:)
 */
export function escapeFfmpegSubtitlesPath(subPath: string): string {
  let escaped = subPath.replace(/\\/g, '/');
  escaped = escaped.replace(/^([A-Za-z]):/, '$1\\:');
  return escaped;
}

export interface KenBurnsMotionProfile {
  name: string;
  panEquation: string;
  zoomEquation: string;
  scaleFilter: string;
}

export type KenBurnsMotionType =
  | 'pan_left_to_right'
  | 'pan_right_to_left'
  | 'zoom_in_third_left'
  | 'zoom_in_third_right'
  | 'zoom_out_wide'
  | 'push_in_hero';

export const CINEMATIC_CAMERA_MOTION_PROFILES: ReadonlyArray<KenBurnsMotionType> = [
  'pan_left_to_right',
  'pan_right_to_left',
  'zoom_in_third_left',
  'zoom_in_third_right',
  'zoom_out_wide',
  'push_in_hero',
] as const;

export interface VideoAssemblyOptions {
  scenes: StoryboardScene[];
  voiceoverAudioPath: string;
  outputPath: string;
  renderingConfig: AiStudioRenderingConfig;
  subtitleConfig: AiStudioSubtitleConfig;
  aspectRatio?: FlowAspectRatio;
  wordsAlignment?: WordTimestamp[];
  scriptLines?: ScriptBeatLine[];
  transitionSfxPath?: string;
  enableTransitionSfx?: boolean;
  onProgress?: (percent: number) => void;
  signal?: AbortSignal;
  onRegisterProcess?: (proc: ffmpeg.FfmpegCommand) => void;
}

export interface VideoAssemblyResult {
  videoPath: string;
  durationSec: number;
  fileSizeBytes: number;
  width: number;
  height: number;
}

export interface TimelineMismatchDetail {
  sceneId: string;
  shotId?: string;
  expectedDurationSec: number;
  actualDurationSec: number;
  missingDurationSec: number;
}

export class TimelineDurationMismatchError extends Error {
  public readonly code = 'TIMELINE_DURATION_MISMATCH';
  public readonly mismatches: TimelineMismatchDetail[];

  constructor(mismatches: TimelineMismatchDetail[]) {
    const lines = mismatches.map((m) => {
      const idLabel = m.shotId && m.shotId !== m.sceneId ? `${m.sceneId} (${m.shotId})` : m.sceneId;
      return `- Cảnh ${idLabel} cần ${m.expectedDurationSec.toFixed(1)} giây, video hiện có ${m.actualDurationSec.toFixed(1)} giây, còn thiếu ${m.missingDurationSec.toFixed(1)} giây.`;
    });
    const summary = lines.join('\n');
    super(
      `Không thể xuất video: Phát hiện clip video ngắn hơn thời lượng yêu cầu của phân cảnh:\n${summary}\n` +
      `Vui lòng thay thế clip hoặc điều chỉnh thời lượng phân cảnh trước khi xuất.`
    );
    this.name = 'TimelineDurationMismatchError';
    this.mismatches = mismatches;
  }
}

export class AiStudioVideoAssembler {
  private static instance: AiStudioVideoAssembler | null = null;

  public static getInstance(): AiStudioVideoAssembler {
    if (!AiStudioVideoAssembler.instance) {
      AiStudioVideoAssembler.instance = new AiStudioVideoAssembler();
    }
    return AiStudioVideoAssembler.instance;
  }

  // ==========================================================================
  // Dimensions Calculator
  // ==========================================================================
  public getDimensions(
    aspectRatio: FlowAspectRatio = '16:9',
    resolution: RenderingResolution = '1080p'
  ): { width: number; height: number } {
    const shortEdge = resolution === '720p' ? 720 : resolution === '4k' ? 2160 : 1080;
    if (aspectRatio === '9:16') {
      return { width: shortEdge, height: shortEdge * 16 / 9 };
    }
    if (aspectRatio === '1:1') {
      return { width: shortEdge, height: shortEdge };
    }
    return { width: shortEdge * 16 / 9, height: shortEdge };
  }

  // ==========================================================================
  // Dynamic Pan/Zoom Ken Burns (6 Cinematic Profiles with 1.5x Upscaling)
  // ==========================================================================
  /**
   * Generates 6 cinematic camera motion profiles with 1.5x pre-upscaling
   * to eliminate subpixel shimmering on Windows FFmpeg zoompan filter.
   */
  public static getKenBurnsProfiles(
    width: number,
    height: number,
    durationSec: number,
    fps = 25
  ): KenBurnsMotionProfile[] {
    const frames = Math.max(1, Math.ceil(durationSec * fps));
    const preUpscaleW = Math.round(width * 1.5);
    const preUpscaleH = Math.round(height * 1.5);
    const scaleFilter = `scale=${preUpscaleW}:${preUpscaleH}:force_original_aspect_ratio=increase,crop=${preUpscaleW}:${preUpscaleH}`;

    return [
      {
        name: 'Pan L->R',
        panEquation: `x='(iw-iw/zoom)*(on/${frames})':y='(ih-ih/zoom)/2'`,
        zoomEquation: `z='1.15'`,
        scaleFilter,
      },
      {
        name: 'Pan R->L',
        panEquation: `x='(iw-iw/zoom)*(1-on/${frames})':y='(ih-ih/zoom)/2'`,
        zoomEquation: `z='1.15'`,
        scaleFilter,
      },
      {
        name: 'Zoom 1/3 Left',
        panEquation: `x='(iw*0.33)-(iw/zoom*0.33)':y='(ih/2)-(ih/zoom/2)'`,
        zoomEquation: `z='min(zoom+0.0015,1.25)'`,
        scaleFilter,
      },
      {
        name: 'Zoom 1/3 Right',
        panEquation: `x='(iw*0.67)-(iw/zoom*0.67)':y='(ih/2)-(ih/zoom/2)'`,
        zoomEquation: `z='min(zoom+0.0015,1.25)'`,
        scaleFilter,
      },
      {
        name: 'Zoom-out Wide',
        panEquation: `x='(iw-iw/zoom)/2':y='(ih-ih/zoom)/2'`,
        zoomEquation: `z='max(1.25-0.0015*on,1.0)'`,
        scaleFilter,
      },
      {
        name: 'Push-in Hero',
        panEquation: `x='(iw-iw/zoom)/2':y='(ih-ih/zoom)/2'`,
        zoomEquation: `z='min(1.0+0.002*on,1.20)'`,
        scaleFilter,
      },
    ];
  }

  public getKenBurnsProfiles(
    width: number,
    height: number,
    durationSec: number,
    fps = 25
  ): KenBurnsMotionProfile[] {
    return AiStudioVideoAssembler.getKenBurnsProfiles(width, height, durationSec, fps);
  }

  // ==========================================================================
  // Dynamic Audio Ducking & SFX Filter Chain
  // ==========================================================================
  /**
   * Builds the FFmpeg audio filter chain for Dynamic Audio Ducking (-18dB)
   * using sidechaincompress and scene transition SFX insertion at Tk - 0.2s.
   */
  public static buildDuckingAndSfxFilterChain(
    hasBgm: boolean,
    cutTimestampsSec: number[] = [],
    sfxInputsCount: number = 0
  ): string {
    const filterParts: string[] = [];

    if (hasBgm) {
      filterParts.push(`[voice_in]asplit=2[voice_main][voice_sidechain]`);
      filterParts.push(
        `[bgm_in][voice_sidechain]sidechaincompress=threshold=0.03:ratio=8:attack=25:release=400:knee=2.5[bgm_ducked]`
      );
      if (sfxInputsCount > 0) {
        filterParts.push(
          `[voice_main][bgm_ducked]amix=inputs=2:duration=first:dropout_transition=2,volume=2[audio_mix]`
        );
        let currentMix = '[audio_mix]';
        for (let i = 0; i < sfxInputsCount; i++) {
          const cutTime = cutTimestampsSec[i] !== undefined ? cutTimestampsSec[i] : (i + 1) * 4.0;
          const sfxDelayMs = Math.max(0, Math.round((cutTime - 0.2) * 1000));
          const sfxDelayedLabel = `[sfx_${i}_delayed]`;
          const nextMixLabel = i === sfxInputsCount - 1 ? '[aout]' : `[sfx_mix_${i}]`;
          filterParts.push(`[sfx_${i}]adelay=${sfxDelayMs}|${sfxDelayMs},apad${sfxDelayedLabel}`);
          filterParts.push(
            `${currentMix}${sfxDelayedLabel}amix=inputs=2:duration=first:dropout_transition=0,volume=2${nextMixLabel}`
          );
          currentMix = nextMixLabel;
        }
      } else {
        filterParts.push(
          `[voice_main][bgm_ducked]amix=inputs=2:duration=first:dropout_transition=2,volume=2[aout]`
        );
      }
    } else {
      filterParts.push(`[voice_in]anull[aout]`);
    }

    return filterParts.join(';');
  }

  public buildDuckingAndSfxFilterChain(
    hasBgm: boolean,
    cutTimestampsSec: number[] = [],
    sfxInputsCount: number = 0
  ): string {
    return AiStudioVideoAssembler.buildDuckingAndSfxFilterChain(
      hasBgm,
      cutTimestampsSec,
      sfxInputsCount
    );
  }

  // ==========================================================================
  // ASS Subtitle File Compiler
  // ==========================================================================
  public compileAssSubtitles(
    words: WordTimestamp[],
    scriptLines: ScriptBeatLine[],
    subtitleConfig: AiStudioSubtitleConfig,
    width: number,
    height: number,
    outputPath: string,
    totalDurationMs = 5000
  ): string {
    const posPercent = subtitleConfig.positionY || 80;
    const marginV = Math.round((height * (100 - posPercent)) / 100);

    // Convert hex '#RRGGBB' to ASS '&H00BBGGRR&'
    const formatAssColor = (hex: string) => {
      const clean = hex.replace('#', '');
      const r = clean.slice(0, 2) || 'FF';
      const g = clean.slice(2, 4) || 'FF';
      const b = clean.slice(4, 6) || 'FF';
      return `&H00${b}${g}${r}&`;
    };

    const primaryCol = formatAssColor(subtitleConfig.primaryColor || '#FFFFFF');
    const outlineCol = formatAssColor(subtitleConfig.outlineColor || '#000000');
    const fontSize = subtitleConfig.fontSize || 24;
    const outlineWidth = subtitleConfig.outlineWidth || 3;

    const formatTime = (ms: number) => {
      const totalCs = Math.floor(Math.max(0, ms) / 10);
      const cs = totalCs % 100;
      const totalS = Math.floor(totalCs / 100);
      const s = totalS % 60;
      const totalM = Math.floor(totalS / 60);
      const m = totalM % 60;
      const h = Math.floor(totalM / 60);
      return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}.${String(cs).padStart(2, '0')}`;
    };

    const header = `[Script Info]
Title: Vanhsub AI Studio Auto Subtitles
ScriptType: v4.00+
PlayResX: ${width}
PlayResY: ${height}
WrapStyle: 0
ScaledBorderAndShadow: yes

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
Style: TikTokBold,Arial,${fontSize},${primaryCol},&H000000FF&,${outlineCol},&H80000000&,-1,0,0,0,100,100,0,0,1,${outlineWidth},1,2,20,20,${marginV},1

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
`;

    const dialogueLines: string[] = [];

    if (words && words.length > 0) {
      // Group words into punchy chunks of 3-4 words (TikTok bold style)
      const chunkSize = 4;
      for (let i = 0; i < words.length; i += chunkSize) {
        const chunk = words.slice(i, i + chunkSize);
        const start = formatTime(chunk[0].startMs);
        const end = formatTime(chunk[chunk.length - 1].endMs);
        const text = chunk.map((c) => c.word).join(' ');
        dialogueLines.push(`Dialogue: 0,${start},${end},TikTokBold,,0,0,0,,${text}`);
      }
    } else if (scriptLines && scriptLines.length > 0) {
      for (const line of scriptLines) {
        const start = formatTime(line.startMs || 0);
        const end = formatTime(line.endMs || 3000);
        dialogueLines.push(`Dialogue: 0,${start},${end},TikTokBold,,0,0,0,,${line.text}`);
      }
    } else {
      dialogueLines.push(`Dialogue: 0,0:00:00.00,${formatTime(totalDurationMs)},TikTokBold,,0,0,0,,Vanhsub AI Studio`);
    }

    const content = header + dialogueLines.join('\n') + '\n';
    fs.mkdirSync(path.dirname(outputPath), { recursive: true });
    fs.writeFileSync(outputPath, content, 'utf8');
    return outputPath;
  }

  // ==========================================================================
  // Timeline Duration Validation Guard (spec: frame boundary tolerance ~0.06 - 0.08s)
  // ==========================================================================
  /**
   * Validates each scene's media duration against its timeline duration requirement.
   * - Static images (.png, .jpg, etc.) are looped via FFmpeg `-loop 1 -t` and are not blocked.
   * - Videos longer than required are permitted and trimmed without error.
   * - Videos shorter than required beyond frame boundary tolerance (~0.08s) are collected and flagged.
   */
  public async validateTimelineDurations(
    scenes: StoryboardScene[],
    fps = 25
  ): Promise<{ valid: boolean; mismatches: TimelineMismatchDetail[] }> {
    const mismatches: TimelineMismatchDetail[] = [];
    // Frame boundary tolerance: ~0.06 - 0.08s (2 frames at 25fps)
    const tolerance = Math.max(0.08, 1.5 / fps);

    for (let i = 0; i < scenes.length; i++) {
      const sc = scenes[i];
      const resolvedPath = sc.assetPath || sc.videoPath || sc.imagePath;
      if (!resolvedPath || !fs.existsSync(resolvedPath)) {
        continue;
      }

      const isVideo = /\.(mp4|webm|mov|mkv)$/i.test(resolvedPath);
      if (!isVideo) {
        // Static image: Extended via FFmpeg -loop 1 -t, perfectly valid
        continue;
      }

      let durSec = 4.0;
      if (typeof sc.durationMs === 'number' && sc.durationMs > 0) {
        durSec = sc.durationMs / 1000;
      } else if (typeof sc.endMs === 'number' && typeof sc.startMs === 'number' && sc.endMs > sc.startMs) {
        durSec = (sc.endMs - sc.startMs) / 1000;
      }

      try {
        const actualDur = await this.probeDuration(resolvedPath);
        sc.originalMediaDurationSec = Math.round(actualDur * 100) / 100;
        if (sc.mediaProvenance?.source === 'official_api' && actualDur > durSec + tolerance && sc.officialTrimAllowed !== true) {
          throw new Error('OFFICIAL_TRIM_NOT_APPROVED: cần cho phép trim clip official trước khi render.');
        }
        if (actualDur < durSec - tolerance) {
          if (sc.fillMode !== 'freeze_last_frame') {
            mismatches.push({
              sceneId: sc.id || sc.shotId || `scene_${i + 1}`,
              shotId: sc.shotId,
              expectedDurationSec: Math.round(durSec * 100) / 100,
              actualDurationSec: Math.round(actualDur * 100) / 100,
              missingDurationSec: Math.round((durSec - actualDur) * 100) / 100,
            });
          }
        }
      } catch (err) {
        if (err instanceof Error && err.message.startsWith('OFFICIAL_TRIM_NOT_APPROVED')) throw err;
        console.warn(`[AiStudioVideoAssembler] Could not probe duration for ${resolvedPath}:`, err);
      }
    }

    return {
      valid: mismatches.length === 0,
      mismatches,
    };
  }

  // ==========================================================================
  // Stage 7: Video Assembly & Rendering
  // ==========================================================================
  public async assembleVideo(options: VideoAssemblyOptions): Promise<VideoAssemblyResult> {
    const {
      scenes,
      voiceoverAudioPath,
      outputPath,
      renderingConfig,
      subtitleConfig,
      aspectRatio = '16:9',
      wordsAlignment = [],
      scriptLines = [],
      onProgress,
      signal,
      onRegisterProcess,
    } = options;

    if (!fs.existsSync(voiceoverAudioPath)) {
      throw new Error(`Voiceover audio file not found at: ${voiceoverAudioPath}`);
    }

    // Pre-validate timeline durations before running expensive FFmpeg rendering
    const timelineCheck = await this.validateTimelineDurations(scenes, renderingConfig.fps === 60 ? 60 : 30);
    if (!timelineCheck.valid) {
      throw new TimelineDurationMismatchError(timelineCheck.mismatches);
    }

    fs.mkdirSync(path.dirname(outputPath), { recursive: true });
    const { width, height } = this.getDimensions(aspectRatio, renderingConfig.resolution);
    const fps = renderingConfig.fps === 60 ? 60 : 30;
    const audioDurationSec = await this.probeDuration(voiceoverAudioPath);
    const totalDurationMs = Math.round(audioDurationSec * 1000);

    // 1. Generate ASS Subtitles
    const assPath = path.join(path.dirname(outputPath), 'subtitles.ass');
    this.compileAssSubtitles(
      wordsAlignment,
      scriptLines,
      subtitleConfig,
      width,
      height,
      assPath,
      totalDurationMs
    );
    const escapedAss = escapeFfmpegSubtitlesPath(assPath);

    // 2. Resolve all visual segments from scenes
    interface VisualSegment {
      path: string;
      durationSec: number;
      frames: number;
      actualDurationSec?: number;
      isVideo: boolean;
      shotId?: string;
      fillMode?: 'freeze_last_frame' | 'none';
    }

    const isVideoFile = (filePath: string) => /\.(mp4|webm|mov|mkv)$/i.test(filePath);

    if (!scenes.length) throw new Error('Thiếu media: chưa có scene để dựng phim.');
    const segments: VisualSegment[] = [];

    for (let i = 0; i < scenes.length; i++) {
      const sc = scenes[i];
      const resolvedPath = sc.assetPath || sc.imagePath || sc.videoPath;
      if (!resolvedPath || !fs.existsSync(resolvedPath) || !fs.statSync(resolvedPath).isFile() || fs.statSync(resolvedPath).size === 0) {
        throw new Error(`Thiếu media hợp lệ cho scene ${sc.id}; không dùng ảnh của scene khác thay thế.`);
      }

      let durSec = 4.0;
      if (typeof sc.durationMs === 'number' && sc.durationMs > 0) {
        durSec = sc.durationMs / 1000;
      } else if (typeof sc.endMs === 'number' && typeof sc.startMs === 'number' && sc.endMs > sc.startMs) {
        durSec = (sc.endMs - sc.startMs) / 1000;
      }

      const isVideo = isVideoFile(resolvedPath);
      let actualDur: number | undefined;
      if (isVideo) {
        try {
          actualDur = await this.probeDuration(resolvedPath);
          sc.originalMediaDurationSec = Math.round(actualDur * 100) / 100;
        } catch (probeErr) {
          console.warn(`[AiStudioVideoAssembler] Could not probe segment duration for ${resolvedPath}:`, probeErr);
        }
      }

      segments.push({
        path: resolvedPath,
        durationSec: Math.max(1 / fps, durSec),
        frames: 0,
        actualDurationSec: actualDur,
        isVideo,
        shotId: sc.shotId || sc.id,
        fillMode: sc.fillMode,
      });
    }

    // Đảm bảo tổng thời lượng visual bao phủ đủ audioDurationSec để tránh cắt hụt video
    let totalVisualSec = segments.reduce((sum, s) => sum + s.durationSec, 0);
    const visualAudioDiff = audioDurationSec - totalVisualSec;
    if (visualAudioDiff > 0.08 && segments.length > 0) {
      segments[segments.length - 1].durationSec += visualAudioDiff;
      totalVisualSec = segments.reduce((sum, s) => sum + s.durationSec, 0);
    }

    // Round cumulative cut positions, rather than rounding every scene up independently.
    // Independent trim durations accumulate extra frames and drift from the subtitle timeline.
    let cumulativeSec = 0, previousEndFrame = 0;
    for (const segment of segments) {
      cumulativeSec += segment.durationSec;
      const endFrame = Math.max(previousEndFrame + 1, Math.round(cumulativeSec * fps));
      segment.frames = endFrame - previousEndFrame;
      segment.durationSec = segment.frames / fps;
      previousEndFrame = endFrame;
    }
    totalVisualSec = previousEndFrame / fps;

    console.log(
      `[AiStudioVideoAssembler] 🎬 Bắt đầu dựng phim đa phân cảnh: ${segments.length} segments, ` +
      `tổng thời lượng visual ~${totalVisualSec}s, audio: ${audioDurationSec}s`
    );

    // 3. Build FFmpeg Command & Filtergraph
    const cmd = ffmpeg();
    const filterChain: string[] = [];
    const concatInputs: string[] = [];

    segments.forEach((seg, i) => {
      const safeScale = `scale=${width}:${height}:force_original_aspect_ratio=increase,crop=${width}:${height},setsar=1,fps=${fps}`;
      if (seg.isVideo) {
        const actualDur = seg.actualDurationSec || 0;
        const needsPadding =
          seg.fillMode === 'freeze_last_frame' &&
          actualDur > 0 &&
          actualDur < seg.durationSec - 0.08;

        if (needsPadding) {
          cmd.input(seg.path);
          const missingSec = Math.max(0.1, Number((seg.durationSec - actualDur + 0.5).toFixed(2)));
          filterChain.push(
            `[${i}:v]${safeScale},tpad=stop_mode=clone:stop_duration=${missingSec},trim=end_frame=${seg.frames},setpts=N/(${fps}*TB)[v${i}]`
          );
        } else {
          // Keep narration coverage if the last segment is extended to the audio tail.
          cmd.input(seg.path).inputOptions(['-stream_loop -1']);
          filterChain.push(`[${i}:v]${safeScale},trim=end_frame=${seg.frames},setpts=N/(${fps}*TB)[v${i}]`);
        }
      } else {
        cmd.input(seg.path);
        if (renderingConfig.kenBurnsEffect) {
          // One source frame expands into exactly one scene, not frames per looped input frame.
          const frames = seg.frames;
          const profiles = AiStudioVideoAssembler.getKenBurnsProfiles(width, height, seg.durationSec, fps);

          // Select profile from scene/beat metadata or alternate modulo
          const requestedMotion =
            (seg as any).cameraMotion ||
            (seg as any).cameraMovement ||
            (scenes[i] as any)?.cameraMotion ||
            (scenes[i] as any)?.cameraMovement ||
            scriptLines[i]?.cameraMovement;

          let profile: KenBurnsMotionProfile;
          if (requestedMotion === 'pan_left_to_right') {
            profile = profiles[0];
          } else if (requestedMotion === 'pan_right_to_left') {
            profile = profiles[1];
          } else if (requestedMotion === 'zoom_in_third_left') {
            profile = profiles[2];
          } else if (requestedMotion === 'zoom_in_third_right') {
            profile = profiles[3];
          } else if (requestedMotion === 'zoom_out_wide' || requestedMotion === 'dolly_out') {
            profile = profiles[4];
          } else if (requestedMotion === 'push_in_hero' || requestedMotion === 'dolly_in') {
            profile = profiles[5];
          } else {
            profile = profiles[i % profiles.length];
          }

          // 1.5x pre-upscaling before zoompan eliminates pixel shimmer on Windows FFmpeg
          const preScale = `${profile.scaleFilter},setsar=1`;
          const zoompan = `zoompan=${profile.zoomEquation}:${profile.panEquation}:d=${frames}:s=${width}x${height}:fps=${fps}`;
          filterChain.push(`[${i}:v]${preScale},${zoompan},trim=end_frame=${frames},setpts=N/(${fps}*TB)[v${i}]`);
        } else {
          cmd.inputOptions(['-loop 1', `-framerate ${fps}`, `-t ${seg.durationSec + 1 / fps}`]);
          filterChain.push(`[${i}:v]${safeScale},trim=end_frame=${seg.frames},setpts=N/(${fps}*TB)[v${i}]`);
        }
      }
      concatInputs.push(`[v${i}]`);
    });

    if (segments.length === 1) {
      filterChain.push(`[v0]null[vconcat]`);
    } else {
      filterChain.push(`${concatInputs.join('')}concat=n=${segments.length}:v=1:a=0[vconcat]`);
    }

    if (subtitleConfig.enabled) {
      filterChain.push(`[vconcat]subtitles=filename='${escapedAss}'[vout]`);
    } else {
      filterChain.push(`[vconcat]null[vout]`);
    }

    // Audio inputs: Voiceover audio input at index segments.length
    const voiceInputIdx = segments.length;
    cmd.input(voiceoverAudioPath);

    const requestedBgmVolume = renderingConfig.bgmVolume ?? 0.12;
    if (!Number.isFinite(requestedBgmVolume) || requestedBgmVolume < 0 || requestedBgmVolume > 1) {
      throw new Error('Âm lượng nhạc nền phải nằm trong khoảng 0–100%.');
    }
    const hasBgm = Boolean(renderingConfig.defaultBgmPath && requestedBgmVolume > 0);
    if (hasBgm && !fs.existsSync(renderingConfig.defaultBgmPath!)) throw new Error('Không tìm thấy file nhạc nền đã cấu hình.');

    let bgmInputIdx = -1;
    if (hasBgm) {
      bgmInputIdx = segments.length + 1;
      cmd.input(renderingConfig.defaultBgmPath!).inputOptions(['-stream_loop -1']);
    }

    // Calculate cut timestamps Tk between consecutive scenes for transition SFX insertion
    const cutTimestampsSec: number[] = [];
    let accumulatedSec = 0;
    for (let i = 0; i < segments.length - 1; i++) {
      accumulatedSec += segments[i].durationSec;
      cutTimestampsSec.push(Math.round(accumulatedSec * 100) / 100);
    }

    // Resolve transition SFX asset if available
    let resolvedSfxPath = options.transitionSfxPath || (renderingConfig as any).transitionSfxPath;
    if (!resolvedSfxPath) {
      const candidates = [
        path.join(process.cwd(), 'resources', 'sfx', 'whoosh.wav'),
        path.join(process.cwd(), 'resources', 'sfx', 'impact.wav'),
      ];
      for (const cand of candidates) {
        if (fs.existsSync(cand)) {
          resolvedSfxPath = cand;
          break;
        }
      }
    }

    const sfxEnabled = options.enableTransitionSfx !== false;
    const hasSfx = Boolean(
      sfxEnabled &&
      resolvedSfxPath &&
      fs.existsSync(resolvedSfxPath) &&
      cutTimestampsSec.length > 0
    );

    let sfxInputIdx = -1;
    if (hasSfx) {
      sfxInputIdx = hasBgm ? segments.length + 2 : segments.length + 1;
      cmd.input(resolvedSfxPath!);
      const sfxCount = cutTimestampsSec.length;
      if (sfxCount === 1) {
        filterChain.push(`[${sfxInputIdx}:a]volume=0.35[sfx_0]`);
      } else {
        const sfxLabels = Array.from({ length: sfxCount }, (_, idx) => `[sfx_${idx}]`).join('');
        filterChain.push(`[${sfxInputIdx}:a]volume=0.35,asplit=${sfxCount}${sfxLabels}`);
      }
    }

    // Construct Audio Ducking & SFX Filtergraph
    // Bundled FFmpeg 4.x normalizes amix by two. Restore the sum; padded SFX
    // keeps both inputs alive so normalization cannot change after a short effect.
    const autoDucking = renderingConfig.autoAudioDucking !== false;
    const bgmVol = requestedBgmVolume;

    if (hasBgm) {
      filterChain.push(`[${voiceInputIdx}:a]aformat=sample_fmts=fltp:sample_rates=48000:channel_layouts=stereo,volume=1.0[voice_in]`);
      filterChain.push(`[${bgmInputIdx}:a]aformat=sample_fmts=fltp:sample_rates=48000:channel_layouts=stereo,atrim=duration=${audioDurationSec},asetpts=PTS-STARTPTS,volume=${bgmVol}[bgm_in]`);

      if (autoDucking) {
        const duckingChain = AiStudioVideoAssembler.buildDuckingAndSfxFilterChain(
          true,
          cutTimestampsSec,
          hasSfx ? cutTimestampsSec.length : 0
        );
        filterChain.push(duckingChain);
      } else {
        if (hasSfx) {
          filterChain.push(`[voice_in][bgm_in]amix=inputs=2:duration=first:dropout_transition=2,volume=2[audio_mix]`);
          let currentMix = '[audio_mix]';
          for (let i = 0; i < cutTimestampsSec.length; i++) {
            const cutTime = cutTimestampsSec[i] || (i + 1) * 4.0;
            const sfxDelayMs = Math.max(0, Math.round((cutTime - 0.2) * 1000));
            const sfxDelayedLabel = `[sfx_${i}_delayed]`;
            const nextMixLabel = i === cutTimestampsSec.length - 1 ? '[aout]' : `[sfx_mix_${i}]`;
            filterChain.push(`[sfx_${i}]adelay=${sfxDelayMs}|${sfxDelayMs},apad${sfxDelayedLabel}`);
            filterChain.push(
              `${currentMix}${sfxDelayedLabel}amix=inputs=2:duration=first:dropout_transition=0,volume=2${nextMixLabel}`
            );
            currentMix = nextMixLabel;
          }
        } else {
          filterChain.push(`[voice_in][bgm_in]amix=inputs=2:duration=first:dropout_transition=2,volume=2[aout]`);
        }
      }
    } else if (hasSfx) {
      filterChain.push(`[${voiceInputIdx}:a]volume=1.0[voice_main]`);
      let currentMix = '[voice_main]';
      for (let i = 0; i < cutTimestampsSec.length; i++) {
        const cutTime = cutTimestampsSec[i] || (i + 1) * 4.0;
        const sfxDelayMs = Math.max(0, Math.round((cutTime - 0.2) * 1000));
        const sfxDelayedLabel = `[sfx_${i}_delayed]`;
        const nextMixLabel = i === cutTimestampsSec.length - 1 ? '[aout]' : `[sfx_mix_${i}]`;
        filterChain.push(`[sfx_${i}]adelay=${sfxDelayMs}|${sfxDelayMs},apad${sfxDelayedLabel}`);
        filterChain.push(
          `${currentMix}${sfxDelayedLabel}amix=inputs=2:duration=first:dropout_transition=0,volume=2${nextMixLabel}`
        );
        currentMix = nextMixLabel;
      }
    }

    const hasAudioMix = hasBgm || hasSfx;
    if (hasAudioMix) filterChain.push('[aout]alimiter=limit=0.95:level=0[audio_safe]');

    onRegisterProcess?.(cmd);

    await new Promise<void>((resolve, reject) => {
      const abortHandler = () => {
        try {
          (cmd as any).kill?.('SIGKILL');
        } catch {}
      };

      if (signal) {
        if (signal.aborted) return reject(new Error('Quá trình dựng video bị hủy bởi người dùng.'));
        signal.addEventListener('abort', abortHandler, { once: true });
      }

      cmd
        .on('start', () => { if (signal?.aborted) abortHandler(); })
        .complexFilter(filterChain.join(';'))
        .outputOptions([
          '-map [vout]',
          hasAudioMix ? '-map [audio_safe]' : `-map ${voiceInputIdx}:a`,
          '-c:v libx264',
          '-pix_fmt yuv420p',
          '-preset veryfast',
          '-threads 2',
          '-filter_complex_threads 1',
          '-c:a aac',
          '-b:a 128k',
          `-t ${audioDurationSec}`,
          `-r ${fps}`,
        ])
        .output(outputPath)
        .on('progress', (p) => {
          if (onProgress && p?.percent) {
            onProgress(Math.min(99, Math.round(p.percent)));
          }
        })
        .on('end', () => {
          signal?.removeEventListener('abort', abortHandler);
          if (signal?.aborted) return reject(new Error('Quá trình dựng video bị hủy bởi người dùng.'));
          if (onProgress) onProgress(100);
          resolve();
        })
        .on('error', (err, _stdout, stderr) => {
          signal?.removeEventListener('abort', abortHandler);
          if (signal?.aborted) return reject(new Error('Quá trình dựng video bị hủy bởi người dùng.'));
          console.error('[AiStudioVideoAssembler] FFmpeg render stderr:', stderr);
          reject(new Error(`FFmpeg video assembly failed: ${err.message}`));
        })
        .run();
    });

    if (!fs.existsSync(outputPath)) {
      throw new Error(`Output video file was not created: ${outputPath}`);
    }

    const stat = fs.statSync(outputPath);
    const outputDurationSec = await this.probeDuration(outputPath);
    if (Math.abs(outputDurationSec - audioDurationSec) > Math.max(0.15, 2 / fps)) {
      throw new Error(`Video không bao phủ đúng giọng đọc: ${outputDurationSec.toFixed(2)}s / ${audioDurationSec.toFixed(2)}s.`);
    }
    return {
      videoPath: outputPath,
      durationSec: outputDurationSec,
      fileSizeBytes: stat.size,
      width,
      height,
    };
  }

  // ==========================================================================
  // Prober Helper
  // ==========================================================================
  public async probeDuration(mediaPath: string): Promise<number> {
    return new Promise((resolve, reject) => {
      ffmpeg.ffprobe(mediaPath, (err, data) => {
        if (err) return reject(err);
        resolve(Number(data?.format?.duration) || 5);
      });
    });
  }
}

export const aiStudioVideoAssembler = AiStudioVideoAssembler.getInstance();
