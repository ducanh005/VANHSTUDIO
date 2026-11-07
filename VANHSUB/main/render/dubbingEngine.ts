import fs from 'fs';
import path from 'path';
import os from 'os';
import { execFile } from 'child_process';
import { promisify } from 'util';
import ffmpeg from 'fluent-ffmpeg';
import { parseSrtStrict, serializeSrt, formatMs, scaleSrtLines } from '../lib/srt';
export { scaleSrtLines } from '../lib/srt';
import { getFfmpegBinPath, getMediaDurationSec, extractFullQualityAudio } from '../asr/audioExtractor';
import { separateVocals } from '../audio/vocalSeparation';
import { groupSubtitlesForTts, type SubtitleLine } from './ttsEngine';
import { configuredMaxTempo } from './ttsTiming';

const execFileAsync = promisify(execFile);

/**
 * Parse file SRT thành mảng subtitle lines
 */
function parseSrtFile(srtPath: string): SubtitleLine[] {
  const content = fs.readFileSync(srtPath, 'utf-8');
  return parseSrtStrict(content).map((line, index) => ({
    index: index + 1,
    startTime: formatMs(line.startMs),
    endTime: formatMs(line.endMs),
    text: line.text,
    startMs: line.startMs,
    endMs: line.endMs,
    durationMs: line.endMs - line.startMs,
    speaker: line.speaker,
  }));
}

/**
 * Escape đường dẫn cho file list của ffmpeg concat demuxer (quoting kiểu shell)
 */
function escapeConcatPath(p: string): string {
  return `file '${p.replace(/'/g, "'\\''")}'`;
}

/**
 * Chạy ffmpeg với danh sách tham số (không qua shell nên không lo escape space/unicode)
 */
export async function runFfmpeg(args: string[]): Promise<void> {
  await execFileAsync(getFfmpegBinPath(), args);
}

/** Cache duration audio theo đường dẫn — 1 file chỉ probe 1 lần mỗi lần dub */
type DurationCache = Map<string, number>;

function updateDubTimeline(srtPath: string, schedule?: Record<string, unknown>[], issue?: Record<string, unknown>): void {
  const timelinePath = srtPath.replace(/\.srt$/i, '.timeline.json');
  try {
    const data = fs.existsSync(timelinePath) ? JSON.parse(fs.readFileSync(timelinePath, 'utf8')) : {};
    if (schedule) data.dubbingSchedule = schedule;
    if (issue) {
      const issues = Array.isArray(data.issues) ? data.issues : [];
      issues.push(issue);
      data.issues = issues;
    }
    fs.writeFileSync(timelinePath, JSON.stringify(data, null, 2), 'utf8');
  } catch (err) {
    console.warn('[Dubbing] Could not write timeline diagnostics:', err);
  }
}

async function probeAudioDurationSec(audioFile: string, cache: DurationCache): Promise<number> {
  const cached = cache.get(audioFile);
  if (cached !== undefined) return cached;
  const dur = await getMediaDurationSec(audioFile);
  cache.set(audioFile, dur);
  return dur;
}

// =========================================================================
// CHẾ ĐỘ ĐỒNG BỘ AUDIO-VIDEO
// - 'strict'        : audio nén/pad theo timeline SRT
// - 'flexible'      : giữ lựa chọn UI cũ, vẫn cố định mốc thoại gốc
// - 'video-stretch' : kéo giãn toàn bộ video (setpts) để mỗi khung phụ đề
//                     đủ chỗ cho audio ở tốc độ đọc tự nhiên, hệ số ≤ 1.25
// =========================================================================

export type SyncMode = 'strict' | 'flexible' | 'video-stretch';

/** Any real overrun must be stretched; otherwise the fixed-length chunk cuts speech. */
const TEMPO_THRESHOLD = 1.0;
/** Maximum compression; larger overruns fail instead of cutting speech. */
const MAX_TEMPO = 1.5;
/** Hệ số kéo giãn video tối đa (quá làm video chậm khó chịu) */
const MAX_STRETCH_FACTOR = 1.25;

/**
 * Tính hệ số kéo giãn video tối thiểu để câu nào cũng đủ chỗ chứa audio
 * (ở tốc độ đọc tự nhiên), dùng cùng nhóm câu và khung thoại như bước ghép audio.
 * Trả về 1 nếu audio đã vừa (không cần giãn).
 */
export async function computeVideoStretchFactor(
  srtPath: string,
  ttsAudioDir: string,
  cache?: DurationCache,
): Promise<number> {
  const subtitles = parseSrtFile(srtPath);
  const groups = buildAudioGroups(subtitles, ttsAudioDir, loadAudioManifest(ttsAudioDir));
  const durations = new Map<number, number>();
  const durationCache = cache ?? new Map<string, number>();

  // Probe duration các file audio song song theo lô 8 để không nghẽn đĩa/CPU
  for (let base = 0; base < groups.length; base += 8) {
    const batch = groups.slice(base, base + 8);
    await Promise.all(
      batch.map(async (group) => {
        durations.set(group.startIndex, await probeAudioDurationSec(group.audioFile, durationCache));
      })
    );
  }

  let maxFactor = 1;
  for (const group of groups) {
    const slotSec = (group.endMs - group.startMs) / 1000;
    if (!(slotSec > 0)) throw new Error(`Invalid dialogue duration at subtitle ${group.startIndex}`);
    const audioDur = durations.get(group.startIndex);
    if (!audioDur) continue;
    const factor = audioDur / slotSec / TEMPO_THRESHOLD;
    if (factor > maxFactor) maxFactor = factor;
  }

  if (maxFactor <= 1) return 1;
  return Math.min(MAX_STRETCH_FACTOR, Math.ceil(maxFactor * 100) / 100);
}

/**
 * Tạo 1 segment WAV cho 1 dòng phụ đề:
 * - audio nén atempo (nếu tempo > 1) rồi ĐẶT VÀO VỊ TRÍ adelay trong segment
 *   (giữ đúng timeline kể cả khi câu trước tràn sang — mode flexible)
 * - apad lấp đầy bằng im lặng, thiếu file → segment im lặng toàn phần
 * - cắt đúng -t để tổng timeline không trôi
 */
async function buildSegment(
  audioFile: string | null,
  segDurationSec: number,
  segPath: string,
  opts?: { tempo?: number; delayMs?: number }
): Promise<{ tempo: number; truncated: boolean }> {
  const t = segDurationSec.toFixed(3);
  const tempo = opts?.tempo ?? 1;
  const delayMs = Math.max(0, Math.round(opts?.delayMs ?? 0));

  if (audioFile && fs.existsSync(audioFile)) {
    const filters: string[] = [];
    let truncated = false;

    if (tempo > 1.0001) filters.push(`atempo=${tempo.toFixed(4)}`);
    if (delayMs > 0) filters.push(`adelay=${delayMs}|${delayMs}`);
    filters.push('apad');

    await runFfmpeg([
      '-i', audioFile,
      '-af', filters.join(','),
      '-t', t,
      '-ar', '44100',
      '-ac', '2',
      '-c:a', 'pcm_s16le',
      '-y', segPath,
    ]);
    return { tempo, truncated };
  }

  await runFfmpeg([
    '-f', 'lavfi',
    '-i', 'anullsrc=r=44100:cl=stereo',
    '-t', t,
    '-c:a', 'pcm_s16le',
    '-y', segPath,
  ]);
  return { tempo: 1, truncated: false };
}

/** Thông tin 1 câu TTS tràn thời lượng khung của nó */
export interface TtsOverrun {
  /** Số dòng phụ đề */
  index: number;
  /** Hệ số tăng tốc đã áp dụng (1.0 = không tăng tốc) */
  tempo: number;
  /** true nếu tràn quá 1.5x và vẫn bị cắt phần cuối */
  truncated: boolean;
}

/**
 * Ghép các audio files thành 1 file audio duy nhất đúng timeline SRT.
 *
 * Each group is anchored to its source start. A conflict beyond 1.5x fails
 * explicitly so later speech is never delayed or silently truncated.
 */
interface SentenceAudioGroup {
  startIndex: number;
  endIndex: number;
  startMs: number;
  endMs: number;
  audioFile: string;
  subtitles: SubtitleLine[];
}

function buildAudioGroups(
  subtitles: SubtitleLine[],
  ttsAudioDir: string,
  manifest: Record<string, any>
): SentenceAudioGroup[] {
  const hasManifestGroups = Object.values(manifest).some(
    (m: any) => m && (m.isGroupLeader || m.isGroupMember || Array.isArray(m.groupIndices))
  );

  if (hasManifestGroups) {
    const groups: SentenceAudioGroup[] = [];
    const handledIndices = new Set<number>();

    for (let i = 0; i < subtitles.length; i++) {
      const sub = subtitles[i];
      if (handledIndices.has(sub.index)) continue;

      const mEntry = manifest[String(sub.index)];
      if (mEntry?.isGroupMember && mEntry.leaderIndex) {
        continue;
      }

      if (mEntry?.isGroupLeader && Array.isArray(mEntry.groupIndices)) {
        const memberSubs = subtitles.filter((s) => mEntry.groupIndices.includes(s.index));
        const first = memberSubs[0] || sub;
        const last = memberSubs[memberSubs.length - 1] || sub;
        for (const s of memberSubs) {
          handledIndices.add(s.index);
        }
        groups.push({
          startIndex: first.index,
          endIndex: last.index,
          startMs: first.startMs,
          endMs: last.endMs,
          audioFile: path.join(ttsAudioDir, `subtitle_${String(first.index).padStart(4, '0')}.mp3`),
          subtitles: memberSubs,
        });
      } else {
        handledIndices.add(sub.index);
        groups.push({
          startIndex: sub.index,
          endIndex: sub.index,
          startMs: sub.startMs,
          endMs: sub.endMs,
          audioFile: path.join(ttsAudioDir, `subtitle_${String(sub.index).padStart(4, '0')}.mp3`),
          subtitles: [sub],
        });
      }
    }
    return groups;
  }

  // Fallback: group using groupSubtitlesForTts
  const ttsGroups = groupSubtitlesForTts(subtitles);
  return ttsGroups.map((g) => ({
    startIndex: g.startIndex,
    endIndex: g.endIndex,
    startMs: g.startMs,
    endMs: g.endMs,
    audioFile: path.join(ttsAudioDir, `subtitle_${String(g.startIndex).padStart(4, '0')}.mp3`),
    subtitles: g.subtitles,
  }));
}

function loadAudioManifest(ttsAudioDir: string): Record<string, any> {
  try {
    return JSON.parse(fs.readFileSync(path.join(ttsAudioDir, 'manifest.json'), 'utf-8')) || {};
  } catch {
    return {};
  }
}

export async function mergeAudioFiles(
  srtPath: string,
  ttsAudioDir: string,
  outputAudioPath: string,
  onProgress?: (percent: number) => void,
  opts?: { mode?: SyncMode; mediaDurationMs?: number; maxTempo?: number }
): Promise<{ audioPath: string; overruns: TtsOverrun[] }> {
  const mode = opts?.mode ?? 'strict';
  const maxTempo = opts?.maxTempo ?? MAX_TEMPO;
  if (!(maxTempo >= 1 && maxTempo <= MAX_TEMPO)) throw new Error('Invalid dubbing maxTempo');
  const subtitles = parseSrtFile(srtPath);
  if (subtitles.length === 0) {
    throw new Error('File SRT không có dòng phụ đề hợp lệ để ghép audio.');
  }

  // Đọc manifest.json nếu có để nhận diện SentenceGroup
  const manifest = loadAudioManifest(ttsAudioDir);

  const groups = buildAudioGroups(subtitles, ttsAudioDir, manifest);
  for (const group of groups) {
    const entry = manifest[String(group.startIndex)];
    if (!entry?.sourceTextVerified || typeof entry.text !== 'string') continue;
    const expectedText = group.subtitles.map((sub) => sub.text.trim()).join(' ').replace(/\s+/g, ' ').trim();
    if (entry.text.trim().replace(/\s+/g, ' ') !== expectedText) {
      throw new Error(`TTS manifest text differs from subtitle ${group.startIndex}; regenerate TTS before dubbing`);
    }
    if (!fs.existsSync(group.audioFile)) {
      throw new Error(`TTS audio missing for subtitle ${group.startIndex}: ${group.audioFile}`);
    }
  }

  const workDir = path.join(
    path.dirname(outputAudioPath),
    `.vanhsub_dub_${Date.now()}`
  );
  const tempListFile = path.join(workDir, 'concat.txt');
  const durationCache: DurationCache = new Map();

  try {
    fs.mkdirSync(workDir, { recursive: true });
    console.log(
      `[Dubbing] Ghép audio ${subtitles.length} dòng (${groups.length} nhóm câu, mode ${mode})...`
    );

    const segPaths: string[] = [];
    const overruns: TtsOverrun[] = [];
    const schedule: Record<string, unknown>[] = [];
    let cursorMs = 0;

    for (let i = 0; i < groups.length; i++) {
      const group = groups[i];
      const next = groups[i + 1];
      const slotEndMs = next ? next.startMs : (opts?.mediaDurationMs ?? group.endMs + 500);

      const audioFile = group.audioFile;
      const hasAudio = fs.existsSync(audioFile);
      if (!hasAudio) {
        throw new Error(`Dubbing missing audio at subtitle ${group.startIndex}: ${audioFile}`);
      }
      const audioDurMs = hasAudio
        ? (await probeAudioDurationSec(audioFile, durationCache)) * 1000
        : 0;

      const segPath = path.join(workDir, `seg_${String(i).padStart(5, '0')}.wav`);
      let tempo = 1;
      if (next && next.startMs < group.endMs) {
        throw new Error(`Dubbing timing conflict at subtitle ${group.startIndex}: overlapping dialogue requires separate audio tracks`);
      }

      // Each rendered chunk covers a fixed position on the original media
      // timeline. A long TTS file may be sped up moderately, but never shifts
      // the next voice or gets silently cut by ffmpeg's -t.
      if (group.startMs < cursorMs || slotEndMs <= group.startMs ||
          (opts?.mediaDurationMs !== undefined && group.endMs > opts.mediaDurationMs)) {
        throw new Error(`Dubbing timing conflict at subtitle ${group.startIndex}: overlapping speech requires separate tracks`);
      }
      // Speech belongs to its measured dialogue interval. The remainder of
      // the slot is silence; it must not be borrowed to hide an overlong dub.
      const audioWindowMs = group.endMs - group.startMs;
      const requiredTempo = hasAudio ? audioDurMs / audioWindowMs : 1;
      if (requiredTempo > maxTempo) {
        throw new Error(`Dubbing timing conflict at subtitle ${group.startIndex}: TTS ${Math.round(audioDurMs)} ms exceeds ${Math.round(audioWindowMs)} ms slot (needs ${requiredTempo.toFixed(2)}x; shorten translation or regenerate TTS)`);
      }
      if (requiredTempo > TEMPO_THRESHOLD) {
        tempo = Math.min(maxTempo, requiredTempo * 1.005);
        overruns.push({ index: group.startIndex, tempo, truncated: false });
      }
      await buildSegment(hasAudio ? audioFile : null, (slotEndMs - cursorMs) / 1000, segPath, {
        tempo,
        delayMs: group.startMs - cursorMs,
      });
      schedule.push({ startIndex: group.startIndex, endIndex: group.endIndex,
        sourceStartMs: group.startMs, sourceEndMs: group.endMs,
        renderStartMs: group.startMs, slotEndMs,
        inputAudioDurationMs: Math.round(audioDurMs), requiredTempo,
        appliedTempo: tempo, predictedEndMs: Math.round(group.startMs + audioDurMs / tempo) });
      cursorMs = slotEndMs;

      segPaths.push(segPath);

      if (i % 10 === 0 || i === groups.length - 1) {
        onProgress?.(Math.round(((i + 1) / groups.length) * 95));
      }
    }

    fs.writeFileSync(tempListFile, segPaths.map(escapeConcatPath).join('\n'));

    const isMp3 = outputAudioPath.toLowerCase().endsWith('.mp3');
    const audioCodecArgs = isMp3
      ? ['-c:a', 'libmp3lame', '-b:a', '192k']
      : ['-c:a', 'aac', '-b:a', '192k'];

    await runFfmpeg([
      '-f', 'concat',
      '-safe', '0',
      '-i', tempListFile,
      ...audioCodecArgs,
      '-y', outputAudioPath,
    ]);
    onProgress?.(100);

    if (overruns.length > 0) {
      console.log(`[Dubbing] Đã tăng tốc ${overruns.length}/${subtitles.length} câu để vừa timeline`);
    }
    console.log(`[Dubbing] ✓ Audio merge successful: ${outputAudioPath}`);
    updateDubTimeline(srtPath, schedule);
    return { audioPath: outputAudioPath, overruns };
  } catch (err) {
    const detail = String(err);
    if (/Dubbing timing conflict|Dubbing missing audio/.test(detail)) {
      updateDubTimeline(srtPath, undefined, { severity: 'error',
        code: detail.includes('missing audio') ? 'missing_tts_audio' : 'tts_duration_conflict',
        detail });
    }
    console.error(`[Dubbing] ✗ Audio merge failed:`, err);
    throw new Error(`Không thể ghép audio: ${err}`);
  } finally {
    try {
      if (fs.existsSync(workDir)) fs.rmSync(workDir, { recursive: true, force: true });
    } catch (cleanupErr) {
      console.warn('[Dubbing] Không xoá được thư mục tạm:', cleanupErr);
    }
  }
}

/**
 * Mux (kết hợp) audio dubbed vào video file.
 *
 * - replaceAudio = true : thay audio gốc (hoặc mix nhỏ nhạc nền nếu bật mixOriginalAudio)
 * - replaceAudio = false: giữ cả 2 track (song ngữ)
 * - stretchFactor > 1   : video bị kéo giãn (setpts) → phải re-encode libx264
 * - mode 'flexible'     : bỏ -shortest để không cắt mất đuôi câu cuối (video
 *                         giữ khung cuối vài giây nếu audio dài hơn)
 */
export async function muxAudioToVideo(
  videoPath: string,
  audioPath: string,
  outputVideoPath: string,
  options?: {
    replaceAudio?: boolean;
    mixOriginalAudio?: boolean;
    syncMode?: SyncMode;
    stretchFactor?: number;
    onCommandCreated?: (command: ffmpeg.FfmpegCommand) => void;
  },
  onProgress?: (percent: number) => void
): Promise<string> {
  const replace = options?.replaceAudio ?? true;
  const mixOriginal = Boolean(options?.mixOriginalAudio) && replace;
  const mode = options?.syncMode ?? 'strict';
  const stretchFactor = options?.stretchFactor && options.stretchFactor > 1.001 ? options.stretchFactor : 0;
  const needReencode = stretchFactor > 0;
  const flexible = mode === 'flexible';

  try {
    console.log(
      `[Dubbing] Starting video mux: ${videoPath} + ${audioPath} -> ${outputVideoPath}` +
        (stretchFactor > 0 ? ` (video giãn ${stretchFactor}x)` : '') +
        (mixOriginal ? ' (mix nhạc nền gốc)' : '')
    );
    onProgress?.(10);

    const videoDurationSec = await getMediaDurationSec(videoPath);
    const outputDurationSec = videoDurationSec * (stretchFactor || 1);

    await new Promise<void>((resolve, reject) => {
      const command = ffmpeg(videoPath).input(audioPath);
      options?.onCommandCreated?.(command);

      const outputOptions: string[] = ['-map', '0:v:0'];
      let videoFilters: string | null = null;

      // Video: copy (nhanh) hoặc kéo giãn setpts + re-encode (video-stretch)
      if (needReencode) {
        videoFilters = `setpts=PTS*${stretchFactor}`;
        outputOptions.push('-c:v', 'libx264', '-crf', '23', '-preset', 'veryfast', '-pix_fmt', 'yuv420p');
      } else {
        outputOptions.push('-c:v', 'copy');
      }

      if (!replace) {
        // Bilingual: giữ audio gốc + thêm track lồng tiếng
        outputOptions.push(
          '-c:a', 'aac',
          '-map', needReencode ? '[original_audio]' : '0:a:0',
          '-map', '1:a:0',
          '-disposition:a:0', 'default',
          '-disposition:a:1', 'dub',
        );
        if (needReencode) {
          outputOptions.push('-filter_complex', `[0:a:0]atempo=${1 / stretchFactor}[original_audio]`);
        }
      } else if (mixOriginal) {
        // Mix: nhạc nền/SFX gốc nhỏ lại (0.22) dưới lời thoại lồng tiếng
        outputOptions.push(
          '-c:a', 'aac',
          '-b:a', '192k',
          '-filter_complex',
          // Bundled FFmpeg has no amix normalize option. Pad both inputs to keep
          // its 1/2 normalization constant, compensate, then bound the output.
          `[0:a:0]${needReencode ? `atempo=${1 / stretchFactor},` : ''}volume=0.22,apad[bg];[1:a]apad[tts];[bg][tts]amix=inputs=2:duration=longest:dropout_transition=0,volume=2,atrim=duration=${outputDurationSec},alimiter=limit=0.97[aout]`,
          '-map', '[aout]',
        );
      } else {
        // Thay thế hoàn toàn audio gốc
        outputOptions.push('-c:a', 'aac', '-b:a', '192k', '-map', '1:a:0');
      }

      // KHÔNG dùng -shortest: audio ghép kết thúc ở câu phụ đề cuối (+0.5s đệm),
      // -shortest sẽ cắt mất toàn bộ video phía sau đó (credit, outro...).
      // Giới hạn output bằng -t theo thời lượng video; nếu không đọc được
      // thời lượng thì bỏ qua — lệch tối đa 0.5s đuôi audio là vô hại.
      if (!flexible && videoDurationSec > 0) {
        outputOptions.push('-t', outputDurationSec.toFixed(3));
      }

      if (videoFilters) command.videoFilters(videoFilters);
      command.outputOptions(outputOptions).output(outputVideoPath);

      command
        .on('progress', (progress) => {
          if (!onProgress) return;
          let percent = progress.percent;
          if ((percent === undefined || Number.isNaN(percent)) && progress.timemark && videoDurationSec > 0) {
            const m = /(\d+):(\d+):(\d+(?:\.\d+)?)/.exec(progress.timemark);
            if (m) {
              const sec = Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3]);
              percent = Math.min(99, (sec / videoDurationSec) * 100);
            }
          }
          if (typeof percent === 'number' && !Number.isNaN(percent)) {
            onProgress(10 + Math.max(0, Math.min(85, percent)) * 0.85); // 10-95%
          }
        })
        .on('end', () => resolve())
        .on('error', (err) => reject(new Error(`Không thể kết hợp audio vào video: ${err.message}`)))
        .run();
    });

    onProgress?.(95);
    console.log(`[Dubbing] ✓ Video mux successful: ${outputVideoPath}`);
    return outputVideoPath;
  } catch (err: any) {
    console.error(`[Dubbing] ✗ Video mux failed:`, err);
    throw new Error(err?.message || 'Không thể kết hợp audio vào video');
  }
}

/**
 * Full dubbing pipeline: TTS audio → merge (đúng timeline) → mux video
 */
export async function dubVideo(
  videoPath: string,
  srtPath: string,
  ttsAudioDir: string,
  outputVideoPath: string,
  options?: {
    replaceAudio?: boolean;
    syncMode?: SyncMode;
    mixOriginalAudio?: boolean;
    /** Tách lời thoại gốc khỏi nhạc nền bằng AI (demucs) — nền giữ nguyên, giọng người gốc bị loại */
    vocalSeparation?: boolean;
    onCommandCreated?: (command: ffmpeg.FfmpegCommand) => void;
    shouldStop?: () => boolean;
  },
  onProgress?: (percent: number) => void
): Promise<{ outputPath: string; mergedAudioPath: string; overruns: TtsOverrun[]; stretchFactor: number }> {
  const tempAudioPath = path.join(
    path.dirname(outputVideoPath),
    `.dubbed_audio_${Date.now()}.m4a`
  );
  const syncMode = options?.syncMode ?? 'strict';
  let stretchFactor = 1;
  let scaledSrtPath: string | null = null;
  const separationDir = path.join(os.tmpdir(), `vanhsub_separate_${Date.now()}`);
  let backgroundAudioPath: string | null = null;
  let mixedAudioPath: string | null = null;

  try {
    if (options?.shouldStop?.()) {
      throw new Error('Đã huỷ bởi người dùng');
    }

    console.log(`[Dubbing] Starting full dubbing pipeline (mode ${syncMode})...`);

    let mergeSrtPath = srtPath;
    const sourceDurationSec = await getMediaDurationSec(videoPath);
    if (!(sourceDurationSec > 0)) {
      throw new Error('Cannot validate dubbing against source media duration');
    }

    // video-stretch: tính hệ số giãn, ghi SRT đã scale ra tạm rồi merge theo đó
    if (syncMode === 'video-stretch') {
      onProgress?.(2);
      stretchFactor = await computeVideoStretchFactor(srtPath, ttsAudioDir);
      if (stretchFactor > 1.001) {
        console.log(`[Dubbing] Video-stretch: giãn video ${stretchFactor}x để vừa audio`);
        const scaled = scaleSrtLines(parseSrtStrict(fs.readFileSync(srtPath, 'utf-8')), stretchFactor);
        if (scaled.length > 0) {
          scaledSrtPath = path.join(os.tmpdir(), `vanhsub_scaled_${Date.now()}.srt`);
          fs.writeFileSync(scaledSrtPath, serializeSrt(scaled), 'utf-8');
          mergeSrtPath = scaledSrtPath;
        }
      } else {
        console.log('[Dubbing] Video-stretch: audio đã vừa — dùng timeline gốc');
      }
    }

    // Tách lời thoại gốc bằng AI: giữ nhạc nền/SFX, loại hẳn giọng người gốc
    if (options?.vocalSeparation) {
      onProgress?.(1);
      fs.mkdirSync(separationDir, { recursive: true });
      const origWav = path.join(separationDir, 'original.wav');
      console.log('[Dubbing] Trích audio gốc (44.1kHz stereo) cho AI tách lời...');
      await extractFullQualityAudio(videoPath, origWav, undefined, { shouldStop: options?.shouldStop });
      onProgress?.(3);
      backgroundAudioPath = (await separateVocals(origWav, separationDir, options?.shouldStop)).noVocals;
      onProgress?.(14);
    }

    if (options?.shouldStop?.()) {
      throw new Error('Đã huỷ bởi người dùng');
    }

    // Bước 1: Ghép audio
    onProgress?.(backgroundAudioPath ? 15 : 5);
    const { audioPath, overruns } = await mergeAudioFiles(
      mergeSrtPath,
      ttsAudioDir,
      tempAudioPath,
      (p) => {
        onProgress?.(Math.round((backgroundAudioPath ? 15 : 5) + p * (backgroundAudioPath ? 0.35 : 0.4)));
      },
      { mode: syncMode === 'flexible' ? 'flexible' : 'strict',
        mediaDurationMs: sourceDurationSec * 1000 * stretchFactor, maxTempo: configuredMaxTempo() }
    );

    if (options?.shouldStop?.()) {
      throw new Error('Đã huỷ bởi người dùng');
    }

    // Trộn nhạc nền không lời (từ AI tách) với audio TTS — lời thoại thay giọng
    // người gốc, nhạc/SFX giữ nguyên bản gốc
    let muxAudioInput = audioPath;
    if (backgroundAudioPath) {
      mixedAudioPath = path.join(path.dirname(outputVideoPath), `.dubbed_mix_${Date.now()}.m4a`);
      console.log('[Dubbing] Trộn audio TTS + nhạc nền không lời...');
      await runFfmpeg([
        '-i', audioPath,
        '-i', backgroundAudioPath,
        '-filter_complex',
        `[0:a]apad[tts];[1:a]${stretchFactor > 1.001 ? `atempo=${1 / stretchFactor},` : ''}apad[bg];[tts][bg]amix=inputs=2:duration=longest:dropout_transition=0,volume=2,atrim=duration=${sourceDurationSec * stretchFactor}[aout]`,
        '-map', '[aout]',
        '-c:a', 'aac', '-b:a', '192k',
        '-y', mixedAudioPath,
      ]);
      muxAudioInput = mixedAudioPath;
    }

    if (options?.shouldStop?.()) {
      throw new Error('Đã huỷ bởi người dùng');
    }

    // Bước 2: Mux vào video
    onProgress?.(50);
    const finalPath = await muxAudioToVideo(
      videoPath,
      muxAudioInput,
      outputVideoPath,
      {
        replaceAudio: options?.replaceAudio,
        mixOriginalAudio: options?.mixOriginalAudio && !options.vocalSeparation,
        syncMode,
        stretchFactor,
        onCommandCreated: options?.onCommandCreated,
      },
      (p) => {
        onProgress?.(50 + Math.round(p * 0.5)); // 50-100%
      }
    );

    console.log(`[Dubbing] ✓ Full dubbing complete: ${finalPath}`);
    return { outputPath: finalPath, mergedAudioPath: tempAudioPath, overruns, stretchFactor };
  } catch (err) {
    console.error(`[Dubbing] ✗ Dubbing pipeline failed:`, err);
    throw err;
  } finally {
    // Dọn file audio tạm (trước đây bị leak sau mỗi lần dub)
    try {
      if (fs.existsSync(tempAudioPath)) fs.unlinkSync(tempAudioPath);
    } catch {
      // bỏ qua
    }
    try {
      if (mixedAudioPath && fs.existsSync(mixedAudioPath)) fs.unlinkSync(mixedAudioPath);
    } catch {
      // bỏ qua
    }
    try {
      if (fs.existsSync(separationDir)) fs.rmSync(separationDir, { recursive: true, force: true });
    } catch {
      // bỏ qua
    }
    try {
      if (scaledSrtPath) {
        fs.rmSync(scaledSrtPath, { force: true });
        fs.rmSync(scaledSrtPath.replace(/\.srt$/i, '.timeline.json'), { force: true });
      }
    } catch {
      // bỏ qua
    }
  }
}
