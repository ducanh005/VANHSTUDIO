import fs from 'fs';
import path from 'path';
import os from 'os';
import ffmpeg from 'fluent-ffmpeg';
import ffmpegInstaller from '@ffmpeg-installer/ffmpeg';
import ffprobeInstaller from '@ffprobe-installer/ffprobe';

// Thiết lập đường dẫn ffmpeg binary — cùng pattern phòng thủ với audioExtractor.ts
// (hỗ trợ cả môi trường dev và packaged asar)
const rawFfmpegPath = (ffmpegInstaller as any)?.path || (ffmpegInstaller as any)?.default?.path || '';
try {
  if (rawFfmpegPath) {
    ffmpeg.setFfmpegPath(rawFfmpegPath.replace('app.asar', 'app.asar.unpacked'));
  }
} catch (err) {
  console.error('Lỗi khi thiết lập đường dẫn ffmpeg:', err);
}

// ffprobe đi kèm app (trước đây phụ thuộc ffprobe trong PATH hệ thống —
// máy sạch sẽ khiến progress hardsub kẹt 0% vì không đọc được duration)
const rawFfprobePath =
  (ffprobeInstaller as any)?.path || (ffprobeInstaller as any)?.default?.path || '';
try {
  if (rawFfprobePath) {
    ffmpeg.setFfprobePath(rawFfprobePath.replace('app.asar', 'app.asar.unpacked'));
  }
} catch (err) {
  console.error('Lỗi khi thiết lập đường dẫn ffprobe:', err);
}

/**
 * Escape đường dẫn phụ đề cho filter ffmpeg subtitles trên Windows:
 * đổi \ thành /, escape dấu hai chấm của ổ đĩa (C:/ -> C\:/).
 * Phần caller chịu trách nhiệm bọc nháy đơn quanh giá trị để chịu được dấu cách.
 */
function escapeFfmpegSubtitlesPath(srtPath: string): string {
  // Thay đổi dấu gạch chéo ngược thành gạch chéo xuôi
  let escaped = srtPath.replace(/\\/g, '/');
  // Escape dấu hai chấm của ổ đĩa bằng MỘT backslash: C:/abc -> C\:/abc
  // (ffmpeg filter chỉ unescape đúng 1 cấp; '\\:' sẽ thành đường dẫn sai)
  escaped = escaped.replace(/^([A-Za-z]):/, '$1\\:');
  return escaped;
}

/**
 * Style phụ đề hardsub — chuyển thành chuỗi force_style (ASS) của libass.
 * Màu người dùng nhập dạng #RRGGBB; ASS dùng &HAABBGGRR (BGR + alpha 00=đục).
 */
export interface SubtitleStyle {
  fontName: string;
  /** Cỡ chữ theo đơn vị ASS (PlayResY 288) — 14-40 là hợp lý */
  fontSize: number;
  primaryColour: string;
  outlineColour: string;
  /** 30-100 (100 = chữ đục hoàn toàn) */
  opacity: number;
  outline: number;
  shadow: number;
  bold: boolean;
  /** 1 = viền + bóng, 3 = nền box đặc */
  borderStyle: 1 | 3;
  /** 1..9 theo Numpad: 2=đáy-giữa, 4=giữa-trái, 5=tâm, 8=đỉnh-giữa */
  alignment: 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9;
  marginV: number;
  marginH?: number;
  isVertical?: boolean;
  posPercent?: { x: number; y: number };
}

const clampNum = (n: number, min: number, max: number, fallback: number): number =>
  Number.isFinite(n) ? Math.min(max, Math.max(min, Math.round(n))) : fallback;

function sanitizeFontName(name: string): string {
  const cleaned = String(name || '').replace(/[^A-Za-z0-9 _-]/g, '').trim();
  return cleaned || 'Arial';
}

function hexToAss(hex: string, opacityPct: number): string {
  const m = /^#?([0-9a-fA-F]{6})$/.exec(String(hex || ''));
  const valid = m ? m[1] : 'ffffff';
  const r = parseInt(valid.slice(0, 2), 16);
  const g = parseInt(valid.slice(2, 4), 16);
  const b = parseInt(valid.slice(4, 6), 16);
  const alpha = Math.round(((100 - clampNum(opacityPct, 0, 100, 100)) / 100) * 255);
  const toHex = (n: number) => n.toString(16).padStart(2, '0').toUpperCase();
  return `&H${toHex(alpha)}${toHex(b)}${toHex(g)}${toHex(r)}`;
}

/** Dựng giá trị force_style — các trường số/màu tự sinh nên không lo escape */
export function buildForceStyle(style: SubtitleStyle): string {
  const isBox = style.borderStyle === 3;
  const alignment = style.alignment >= 1 && style.alignment <= 9 ? style.alignment : 2;
  const marginV = clampNum(style.marginV, 0, 120, 25);
  const marginL = clampNum(style.marginH ?? 20, 0, 150, 20);
  const marginR = clampNum(style.marginH ?? 20, 0, 150, 20);
  const parts = [
    `FontName=${sanitizeFontName(style.fontName)}`,
    `FontSize=${clampNum(style.fontSize, 8, 99, 18)}`,
    `PrimaryColour=${hexToAss(style.primaryColour, style.opacity)}`,
    `OutlineColour=${hexToAss(style.outlineColour, 100)}`,
    `BackColour=${isBox ? hexToAss(style.outlineColour, 95) : '&H80000000'}`,
    `BorderStyle=${isBox ? 3 : 1}`,
    `Outline=${isBox && style.outline === 0 ? 3 : clampNum(style.outline, 0, 8, 2)}`,
    `Shadow=${isBox ? 0 : clampNum(style.shadow, 0, 6, 1)}`,
    `Bold=${style.bold ? 1 : 0}`,
    `Alignment=${alignment}`,
    `MarginV=${marginV}`,
    `MarginL=${marginL}`,
    `MarginR=${marginR}`,
  ];
  return parts.join(',');
}

/**
 * Vùng che phụ đề cũ (hardsub gốc in sẵn trong video):
 * áp dụng filter che TRƯỚC filter subtitles để phụ đề mới không đè lên chữ cũ.
 */
export interface MaskRegion {
  /** Vị trí dải che — phụ đề phim thường nằm ở đáy khung hình */
  position: 'bottom' | 'top';
  /** Chiều cao dải che theo % chiều cao khung hình (5-50) */
  heightPercent: number;
  /** solid = tô đen, blur = làm mờ vùng đó (vẫn lộ mờ khung hình gốc) */
  mode: 'solid' | 'blur';
}

export type MaskMode = 'blur' | 'gaussian' | 'glass' | 'pixelate' | 'solid';

/** Vùng che mờ tự do (Bounding box mask) theo tọa độ % và khung thời gian */
export interface CustomMaskRegion {
  id?: string;             // ID định danh từng vùng
  name?: string;           // Tên gợi nhớ
  xPercent: number;        // 0..100
  yPercent: number;        // 0..100
  widthPercent: number;    // 0..100
  heightPercent: number;   // 0..100
  mode: MaskMode;
  intensity?: number;      // 1..100 (mặc định 40)
  colorHex?: string;       // "#000000"
  startSec?: number;       // Giây bắt đầu (0 = từ đầu)
  endSec?: number;         // Giây kết thúc (0 = hết video)
  enabled?: boolean;       // Bật/tắt vùng che
}

/** Cấu hình Watermark (Logo hoặc văn bản bản quyền) */
export interface WatermarkOptions {
  type: 'text' | 'image';
  content: string;         // Chữ hoặc đường dẫn ảnh PNG
  opacity?: number;        // 0..1 (mặc định 0.8)
  scalePercent?: number;   // Kích thước tương đối 5..50%
  fontSize?: number;
  position: 'top_left' | 'top_right' | 'bottom_left' | 'bottom_right' | 'center' | 'custom' | 'floating' | 'bounce';
  customPos?: { xPercent: number; yPercent: number };
  speed?: 'slow' | 'medium' | 'fast';
}

/** Tùy chọn định dạng & tỉ lệ xuất video */
export interface ExportFormatOptions {
  aspectRatio?: 'original' | '16:9' | '9:16' | '1:1';
  resolution?: 'original' | '1080p' | '720p' | '480p';
  fps?: number;            // 24 | 30 | 60
  bitrateKbps?: number;    // ví dụ 6000
  videoCodec?: 'libx264' | 'libx265';
  preset?: 'ultrafast' | 'veryfast' | 'fast' | 'medium';
  /** R4 CapCut Mini: Phản chiếu gương ngang (lật ngược video, giữ xuôi phụ đề & logo) */
  mirrorHorizontal?: boolean;
  /** R4 CapCut Mini: Tua nhanh video từ 1.00x đến 2.00x (bước 0.01x, ví dụ 1.02, 1.03) */
  speed?: number;
}

export interface RenderOptions {
  videoPath: string;
  srtPath: string;
  outputPath: string;
  /** Che vùng phụ đề cũ kiểu dải ngang cố định */
  mask?: MaskRegion | null;
  /** Che vùng tự do đơn (tương thích ngược) */
  customMask?: CustomMaskRegion | null;
  /** Danh sách nhiều vùng che mờ tự do */
  customMasks?: CustomMaskRegion[] | null;
  /** Watermark thương hiệu */
  watermark?: WatermarkOptions | null;
  /** Tùy chọn tỉ lệ (16:9, 9:16 TikTok) & độ phân giải */
  formatOptions?: ExportFormatOptions | null;
  /** Style phụ đề tùy chỉnh (force_style ASS) — bỏ qua nếu không truyền */
  style?: SubtitleStyle | null;
  onProgress?: (percent: number) => void;
  /** Callback nhận instance command FFmpeg ngay khi khởi tạo để hỗ trợ huỷ/kill */
  onCommandCreated?: (command: ffmpeg.FfmpegCommand) => void;
}

/** Chuẩn hoá chiều cao dải che về khoảng hợp lệ */
function clampMaskHeight(heightPercent: number): number {
  return Math.min(50, Math.max(5, Math.round(heightPercent || 22)));
}

/**
 * Sinh đoạn filter che dải phụ đề cũ (dùng trong filter_complex).
 * Dùng biến ih/iw của ffmpeg nên tự scale theo mọi độ phân giải video.
 */
function buildMaskFilter(mask: MaskRegion): string {
  const height = clampMaskHeight(mask.heightPercent);
  const bandH = `ih*${height}/100`;
  const bandY = mask.position === 'top' ? '0' : `ih-${bandH}`;

  if (mask.mode === 'blur') {
    // Tách dải phụ đề ra làm mờ rồi chồng lại đúng vị trí.
    const overlayY = mask.position === 'top' ? '0' : `main_h-main_h*${height}/100`;
    return (
      `split=2[base][bandsrc];` +
      `[bandsrc]crop=iw:${bandH}:0:${bandY},boxblur=16:2[band];` +
      `[base][band]overlay=0:${overlayY}`
    );
  }
  return `drawbox=x=0:y=${bandY}:w=iw:h=${bandH}:color=black@1:t=fill`;
}

/**
 * Dựng filter cho vùng che mờ tự do (Custom Bounding Box Mask)
 * Hỗ trợ idx để sinh nhãn phân nhánh độc lập, tránh xung đột khi ghép nhiều vùng
 */
export function buildCustomMaskFilter(
  mask: CustomMaskRegion,
  inLabel: string,
  outLabel: string,
  idx: number = 0
): string {
  const safeX = Math.max(0, Math.min(99.5, mask.xPercent));
  const safeY = Math.max(0, Math.min(99.5, mask.yPercent));
  const safeW = Math.max(0.5, Math.min(100 - safeX, mask.widthPercent));
  const safeH = Math.max(0.5, Math.min(100 - safeY, mask.heightPercent));

  const cropX = `iw*${safeX}/100`;
  const cropY = `ih*${safeY}/100`;
  const cropW = `iw*${safeW}/100`;
  const cropH = `ih*${safeH}/100`;

  const overX = `main_w*${safeX}/100`;
  const overY = `main_h*${safeY}/100`;

  const hasTime = (mask.startSec !== undefined && mask.startSec > 0) || (mask.endSec !== undefined && mask.endSec > 0);
  const timeExpr = hasTime
    ? `:enable='between(t,${mask.startSec || 0},${mask.endSec && mask.endSec > 0 ? mask.endSec : 999999})'`
    : '';

  const baseLbl = `cm_base_${idx}`;
  const srcLbl = `cm_src_${idx}`;
  const effLbl = `cm_eff_${idx}`;

  // 1. Làm mờ Gauss (Gaussian Blur) mịn màng, tự nhiên
  if (mask.mode === 'gaussian') {
    const sigma = Math.max(2, Math.min(40, Math.round((mask.intensity || 40) * 0.4)));
    return (
      `[${inLabel}]split=2[${baseLbl}][${srcLbl}];` +
      `[${srcLbl}]crop=${cropW}:${cropH}:${cropX}:${cropY},gblur=sigma=${sigma}:steps=2[${effLbl}];` +
      `[${baseLbl}][${effLbl}]overlay=${overX}:${overY}${timeExpr}[${outLabel}]`
    );
  }

  // 2. Kính mờ nghệ thuật (Frosted Glass)
  if (mask.mode === 'glass') {
    const blurRadius = Math.max(4, Math.min(30, Math.round((mask.intensity || 40) * 0.3)));
    const rawTint = mask.colorHex ? mask.colorHex.replace('#', '') : 'white';
    const tint = /^[0-9a-fA-F]{6}$/.test(rawTint) ? `0x${rawTint}` : rawTint;
    return (
      `[${inLabel}]split=2[${baseLbl}][${srcLbl}];` +
      `[${srcLbl}]crop=${cropW}:${cropH}:${cropX}:${cropY},boxblur=${blurRadius}:1:2:1,eq=contrast=1.12:brightness=0.03,drawbox=color=${tint}@0.15:t=fill[${effLbl}];` +
      `[${baseLbl}][${effLbl}]overlay=${overX}:${overY}${timeExpr}[${outLabel}]`
    );
  }

  // 3. Điểm ảnh (Pixelate / Mosaic ô vuông)
  if (mask.mode === 'pixelate') {
    const scaleDown = Math.max(4, Math.min(30, Math.round((mask.intensity || 40) * 0.25)));
    return (
      `[${inLabel}]split=2[${baseLbl}][${srcLbl}];` +
      `[${srcLbl}]crop=${cropW}:${cropH}:${cropX}:${cropY},scale=iw/${scaleDown}:ih/${scaleDown},scale=${cropW}:${cropH}:flags=neighbor[${effLbl}];` +
      `[${baseLbl}][${effLbl}]overlay=${overX}:${overY}${timeExpr}[${outLabel}]`
    );
  }

  // 4. Hộp màu / Tô đặc (Solid Color / Black Box)
  if (mask.mode === 'solid') {
    const rawColor = mask.colorHex ? mask.colorHex.replace('#', '') : 'black';
    const color = /^[0-9a-fA-F]{6}$/.test(rawColor) ? `0x${rawColor}` : rawColor;
    const intensity = mask.intensity !== undefined ? mask.intensity : 100;
    const alpha = Math.max(0.1, Math.min(1.0, intensity / 100));
    const drawboxTime = hasTime ? `:enable='between(t,${mask.startSec || 0},${mask.endSec && mask.endSec > 0 ? mask.endSec : 999999})'` : '';
    return `[${inLabel}]drawbox=x=${cropX}:y=${cropY}:w=${cropW}:h=${cropH}:color=${color}@${alpha}:t=fill${drawboxTime}[${outLabel}]`;
  }

  // 5. Mặc định: Làm mờ hộp chuẩn (Box Blur với chroma_radius an toàn)
  const blurRadius = Math.max(4, Math.min(30, Math.round((mask.intensity || 40) * 0.35)));
  return (
    `[${inLabel}]split=2[${baseLbl}][${srcLbl}];` +
    `[${srcLbl}]crop=${cropW}:${cropH}:${cropX}:${cropY},boxblur=${blurRadius}:1:2:1[${effLbl}];` +
    `[${baseLbl}][${effLbl}]overlay=${overX}:${overY}${timeExpr}[${outLabel}]`
  );
}

/**
 * Dựng filter chuyển đổi tỉ lệ khung hình (16:9, 9:16 TikTok, 1:1)
 */
function buildAspectRatioFilter(aspectRatio: string | undefined, inLabel: string, outLabel: string): string {
  if (aspectRatio === '9:16') {
    // Khung dọc 1080x1920 (TikTok/Shorts/Reels) — đệm viền đen
    return `[${inLabel}]scale=1080:1920:force_original_aspect_ratio=decrease,pad=1080:1920:(ow-iw)/2:(oh-ih)/2:black[${outLabel}]`;
  }
  if (aspectRatio === '16:9') {
    return `[${inLabel}]scale=1920:1080:force_original_aspect_ratio=decrease,pad=1920:1080:(ow-iw)/2:(oh-ih)/2:black[${outLabel}]`;
  }
  if (aspectRatio === '1:1') {
    return `[${inLabel}]scale=1080:1080:force_original_aspect_ratio=decrease,pad=1080:1080:(ow-iw)/2:(oh-ih)/2:black[${outLabel}]`;
  }
  return `[${inLabel}]null[${outLabel}]`;
}

export interface VideoMetadata {
  duration: number;
  hasAudio: boolean;
  audioStreamCount?: number;
  width?: number;
  height?: number;
}

/**
 * Trích xuất thời lượng (giây) và kiểm tra audio stream bằng ffprobe.
 */
export function getVideoMetadata(videoPath: string): Promise<VideoMetadata> {
  return new Promise((resolve) => {
    ffmpeg.ffprobe(videoPath, (err, metadata) => {
      if (err || !metadata) {
        resolve({ duration: 0, hasAudio: false });
        return;
      }
      const duration = Number(metadata.format?.duration) || 0;
      const audioStreamCount = metadata.streams?.filter((s) => s.codec_type === 'audio').length || 0;
      const hasAudio = audioStreamCount > 0;
      const vStream = Array.isArray(metadata.streams) ? metadata.streams.find((s) => s.codec_type === 'video') : undefined;
      const width = vStream?.width;
      const height = vStream?.height;
      resolve({ duration, hasAudio, audioStreamCount, width, height });
    });
  });
}

/**
 * Trích xuất thời lượng video (giây) bằng ffmpeg.ffprobe hoặc fallback.
 * (Giữ tương thích ngược)
 */
export async function getVideoDuration(videoPath: string): Promise<number> {
  const meta = await getVideoMetadata(videoPath);
  return meta.duration;
}

/**
 * Tính toán thời lượng hiệu dụng sau khi tua nhanh: effectiveDuration = rawDuration / speed
 */
export function calculateEffectiveDuration(rawDuration: number, speed?: number): number {
  const clampedSpeed = typeof speed === 'number' && !isNaN(speed)
    ? Math.max(1.0, Math.min(2.0, Math.round(speed * 100) / 100))
    : 1.0;
  return clampedSpeed > 1.0 && rawDuration > 0 ? rawDuration / clampedSpeed : rawDuration;
}

/**
 * Tính toán phần trăm tiến trình render mượt mà dựa trên thời lượng hiệu dụng
 */
export function calculateRenderProgress(currentSec: number, effectiveDuration: number): number {
  if (effectiveDuration <= 0) return 0;
  return Math.min(99.9, Math.round(((currentSec / effectiveDuration) * 100) * 10) / 10);
}

/**
 * Chuyển đổi chuỗi timemark (HH:MM:SS.ms) sang giây.
 */
export function timemarkToSeconds(timemark: string): number {
  if (!timemark) return 0;
  const parts = timemark.split(':');
  if (parts.length === 3) {
    const h = Number(parts[0]) || 0;
    const m = Number(parts[1]) || 0;
    const s = Number(parts[2]) || 0;
    return h * 3600 + m * 60 + s;
  }
  if (parts.length === 2) {
    const m = Number(parts[0]) || 0;
    const s = Number(parts[1]) || 0;
    return m * 60 + s;
  }
  return Number(timemark) || 0;
}

export interface HardsubFilterGraphInput {
  formatOptions?: ExportFormatOptions | null;
  customMasks?: CustomMaskRegion[] | null;
  customMask?: CustomMaskRegion | null;
  mask?: MaskRegion | null;
  watermark?: WatermarkOptions | null;
  escapedSubPath: string;
  styleSuffix?: string;
  hasAudio: boolean;
  audioStreamCount?: number;
}

export interface HardsubFilterGraphOutput {
  filterChains: string[];
  hasAudioFilter: boolean;
  audioOutputLabels: string[];
  effectiveSpeed: number;
}

/**
 * Xây dựng filtergraph hoàn chỉnh cho burnHardsub với kiến trúc đa tầng CapCut Mini:
 * [0:v] -> [v_aspect] -> [v_mirror] -> [v_mask] -> [v_sub] -> [v_wm] -> [v_speed] -> [vout]
 * [0:a:0] -> [atempo] -> [aout]
 */
export function buildHardsubFilterGraph(options: HardsubFilterGraphInput): HardsubFilterGraphOutput {
  const {
    formatOptions,
    customMasks,
    customMask,
    mask,
    watermark,
    escapedSubPath,
    styleSuffix = '',
    hasAudio,
  } = options;

  const filterChains: string[] = [];
  let currentVLabel = '0:v';

  // 1. Tỉ lệ khung hình (Aspect Ratio / Scaling)
  if (formatOptions?.aspectRatio && formatOptions.aspectRatio !== 'original') {
    const nextLabel = 'v_aspect';
    filterChains.push(buildAspectRatioFilter(formatOptions.aspectRatio, currentVLabel, nextLabel));
    currentVLabel = nextLabel;
  }

  // 2. CapCut Mini: Phản chiếu gương ngang (Horizontal Mirror) - ÁP DỤNG TRƯỚC PHỤ ĐỀ
  if (formatOptions?.mirrorHorizontal) {
    const nextLabel = 'v_mirror';
    filterChains.push(`[${currentVLabel}]hflip[${nextLabel}]`);
    currentVLabel = nextLabel;
  }

  // 3. Vùng che mờ (Custom Masks hoặc Mask dải cố định)
  const activeMasks: CustomMaskRegion[] = [];
  if (customMasks && Array.isArray(customMasks) && customMasks.length > 0) {
    activeMasks.push(...customMasks.filter((m) => m.enabled !== false));
  } else if (customMask && customMask.enabled !== false) {
    activeMasks.push(customMask);
  }

  if (activeMasks.length > 0) {
    for (let i = 0; i < activeMasks.length; i++) {
      const nextLabel = `v_mask_${i}`;
      filterChains.push(buildCustomMaskFilter(activeMasks[i], currentVLabel, nextLabel, i));
      currentVLabel = nextLabel;
    }
  } else if (mask) {
    const nextLabel = 'v_mask';
    const height = clampMaskHeight(mask.heightPercent);
    const bandH = `ih*${height}/100`;
    const bandY = mask.position === 'top' ? '0' : `ih-${bandH}`;
    if (mask.mode === 'blur') {
      const overlayY = mask.position === 'top' ? '0' : `main_h-main_h*${height}/100`;
      filterChains.push(
        `[${currentVLabel}]split=2[m_base][m_band];` +
        `[m_band]crop=iw:${bandH}:0:${bandY},boxblur=16:2[m_blur];` +
        `[m_base][m_blur]overlay=0:${overlayY}[${nextLabel}]`
      );
    } else {
      filterChains.push(`[${currentVLabel}]drawbox=x=0:y=${bandY}:w=iw:h=${bandH}:color=black@1:t=fill[${nextLabel}]`);
    }
    currentVLabel = nextLabel;
  }

  // 4. Phụ đề (Subtitles / ASS)
  const subNextLabel = 'v_sub';
  filterChains.push(`[${currentVLabel}]subtitles=filename='${escapedSubPath}'${styleSuffix}[${subNextLabel}]`);
  currentVLabel = subNextLabel;

  // 5. Watermark (Hình ảnh hoặc Chữ)
  if (watermark && watermark.content) {
    const wmSpeed = watermark.speed || 'medium';
    const speedMult = wmSpeed === 'slow' ? 0.6 : wmSpeed === 'fast' ? 1.5 : 1.0;

    const wx = (0.42 * speedMult).toFixed(3);
    const wx2 = (0.42 * 1.62 * speedMult).toFixed(3);
    const wy = (0.31 * speedMult).toFixed(3);
    const wy2 = (0.31 * 1.41 * speedMult).toFixed(3);

    const tx = (6.4 / speedMult).toFixed(2);
    const ty = (4.5 / speedMult).toFixed(2);
    const cycleX = (2 * (6.4 / speedMult)).toFixed(2);
    const cycleY = (2 * (4.5 / speedMult)).toFixed(2);

    if (watermark.type === 'image' && fs.existsSync(watermark.content)) {
      const wmScale = Math.max(5, Math.min(50, watermark.scalePercent || 15)) / 100;
      const wmOpacity = Math.max(0.1, Math.min(1.0, watermark.opacity ?? 0.8));

      let wmPos = 'x=W-w-25:y=H-h-25';
      if (watermark.position === 'bounce') {
        wmPos = `x='(W-w)*(1-abs(mod(t,${cycleX})-${tx})/${tx})':y='(H-h)*(1-abs(mod(t,${cycleY})-${ty})/${ty})'`;
      } else if (watermark.position === 'floating') {
        wmPos = `x='(W-w)*(0.5+0.38*sin(t*${wx})+0.10*sin(t*${wx2}))':y='(H-h)*(0.5+0.38*cos(t*${wy})+0.10*cos(t*${wy2}))'`;
      } else if (watermark.position === 'top_left') {
        wmPos = 'x=25:y=25';
      } else if (watermark.position === 'top_right') {
        wmPos = 'x=W-w-25:y=25';
      } else if (watermark.position === 'bottom_left') {
        wmPos = 'x=25:y=H-h-25';
      } else if (watermark.position === 'center') {
        wmPos = 'x=(W-w)/2:y=(H-h)/2';
      } else if (watermark.position === 'custom' && watermark.customPos) {
        wmPos = `x=W*${watermark.customPos.xPercent / 100}:y=H*${watermark.customPos.yPercent / 100}`;
      }

      const nextLabel = 'v_wm';
      filterChains.push(
        `[1:v][${currentVLabel}]scale2ref=w=main_w*${wmScale}:h=-1[wm_scaled][wm_base];` +
        `[wm_scaled]format=rgba,colorchannelmixer=aa=${wmOpacity}[wm_prep];` +
        `[wm_base][wm_prep]overlay=${wmPos}[${nextLabel}]`
      );
      currentVLabel = nextLabel;
    } else if (watermark.type === 'text' && watermark.content.trim()) {
      const wmOpacity = Math.max(0.1, Math.min(1.0, watermark.opacity ?? 0.8));
      const fontSize = Math.max(14, Math.min(80, Math.round((watermark.scalePercent || 18) * 1.8)));
      const escapedContent = watermark.content
        .replace(/\\/g, '\\\\')
        .replace(/'/g, "\\'")
        .replace(/:/g, '\\:')
        .replace(/%/g, '\\%');

      let posX = 'w-text_w-25';
      let posY = 'h-text_h-25';

      if (watermark.position === 'bounce') {
        posX = `'(w-text_w)*(1-abs(mod(t,${cycleX})-${tx})/${tx})'`;
        posY = `'(h-text_h)*(1-abs(mod(t,${cycleY})-${ty})/${ty})'`;
      } else if (watermark.position === 'floating') {
        posX = `'(w-text_w)*(0.5+0.38*sin(t*${wx})+0.10*sin(t*${wx2}))'`;
        posY = `'(h-text_h)*(0.5+0.38*cos(t*${wy})+0.10*cos(t*${wy2}))'`;
      } else if (watermark.position === 'top_left') {
        posX = '25'; posY = '25';
      } else if (watermark.position === 'top_right') {
        posX = 'w-text_w-25'; posY = '25';
      } else if (watermark.position === 'bottom_left') {
        posX = '25'; posY = 'h-text_h-25';
      } else if (watermark.position === 'center') {
        posX = '(w-text_w)/2'; posY = '(h-text_h)/2';
      } else if (watermark.position === 'custom' && watermark.customPos) {
        posX = `w*${watermark.customPos.xPercent / 100}`;
        posY = `h*${watermark.customPos.yPercent / 100}`;
      }

      const nextLabel = 'v_wm';
      filterChains.push(
        `[${currentVLabel}]drawtext=text='${escapedContent}':fontsize=${fontSize}:fontcolor=white@${wmOpacity}:shadowcolor=black@${wmOpacity}:shadowx=2:shadowy=2:x=${posX}:y=${posY}[${nextLabel}]`
      );
      currentVLabel = nextLabel;
    }
  }

  // Resize the composed frame so subtitle/mask/logo proportions stay unchanged.
  // Resolution names refer to the short edge, including portrait and square video.
  const shortEdge = { original: 0, '1080p': 1080, '720p': 720, '480p': 480 }[formatOptions?.resolution || 'original'];
  if (shortEdge) {
    const nextLabel = 'v_resolution';
    filterChains.push(
      `[${currentVLabel}]scale=w='if(gte(iw,ih),-2,${shortEdge})':h='if(gte(iw,ih),${shortEdge},-2)'[${nextLabel}]`
    );
    currentVLabel = nextLabel;
  }

  // 6. CapCut Mini: Tua nhanh video (Speedup setpts) - ÁP DỤNG SAU PHỤ ĐỀ & WATERMARK
  const rawSpeed = formatOptions?.speed;
  const speed = typeof rawSpeed === 'number' && !isNaN(rawSpeed)
    ? Math.max(1.0, Math.min(2.0, Math.round(rawSpeed * 100) / 100))
    : 1.0;

  if (speed > 1.0) {
    const nextLabel = 'v_speed';
    filterChains.push(`[${currentVLabel}]setpts=PTS/${speed}[${nextLabel}]`);
    currentVLabel = nextLabel;
  }

  // Đổi label video cuối cùng thành vout
  const lastChainIndex = filterChains.length - 1;
  const lastChain = filterChains[lastChainIndex];
  filterChains[lastChainIndex] = lastChain.replace(new RegExp(`\\[${currentVLabel}\\]$`), '[vout]');

  // 7. CapCut Mini: Tua nhanh âm thanh (Speedup atempo) - Chỉ khi video có audio stream
  let hasAudioFilter = false;
  const audioOutputLabels: string[] = [];
  if (hasAudio && speed > 1.0) {
    for (let index = 0; index < (options.audioStreamCount ?? 1); index++) {
      const label = index === 0 ? 'aout' : `aout_${index}`;
      filterChains.push(`[0:a:${index}]atempo=${speed}[${label}]`);
      audioOutputLabels.push(label);
    }
    hasAudioFilter = true;
  }

  return {
    filterChains,
    hasAudioFilter,
    audioOutputLabels,
    effectiveSpeed: speed,
  };
}

/**
 * Ghi cứng phụ đề (Hardsub) vào video với chuỗi filter đa tầng Mini CapCut.
 */
export async function burnHardsub(options: RenderOptions): Promise<void> {
  const { videoPath, srtPath, outputPath, onProgress, customMask, mask, watermark, formatOptions } = options;

  if (!fs.existsSync(videoPath)) {
    throw new Error(`Video gốc không tồn tại: ${videoPath}`);
  }
  if (!fs.existsSync(srtPath)) {
    throw new Error(`File phụ đề không tồn tại: ${srtPath}`);
  }

  // Phân biệt đuôi file .ass hay .srt
  const isAss = path.extname(srtPath).toLowerCase() === '.ass';
  const ext = isAss ? '.ass' : '.srt';
  const tempSrtPath = path.join(os.tmpdir(), `vanhsub_temp_${Date.now()}_render${ext}`);
  fs.copyFileSync(srtPath, tempSrtPath);

  const escapedSubPath = escapeFfmpegSubtitlesPath(tempSrtPath);
  const { duration: rawDuration, hasAudio, audioStreamCount } = await getVideoMetadata(videoPath);

  const styleSuffix = !isAss && options.style
    ? `:force_style='${buildForceStyle(options.style)}'`
    : '';

  const { filterChains, hasAudioFilter, audioOutputLabels, effectiveSpeed } = buildHardsubFilterGraph({
    formatOptions,
    customMasks: options.customMasks,
    customMask,
    mask,
    watermark,
    escapedSubPath,
    styleSuffix,
    hasAudio,
    audioStreamCount,
  });

  const effectiveDuration = calculateEffectiveDuration(rawDuration, effectiveSpeed);

  return new Promise<void>((resolve, reject) => {
    const cleanup = () => {
      try {
        if (fs.existsSync(tempSrtPath)) {
          fs.unlinkSync(tempSrtPath);
        }
      } catch (e) {
        console.error('Lỗi dọn dẹp file phụ đề tạm:', e);
      }
    };

    const command = ffmpeg(videoPath);
    options.onCommandCreated?.(command);

    // Nếu watermark là ảnh hợp lệ thì add input 1
    if (watermark && watermark.content && watermark.type === 'image' && fs.existsSync(watermark.content)) {
      command.input(watermark.content);
    }

    command.complexFilter(filterChains.join(';'));

    if (hasAudioFilter) {
      command.outputOptions([
        '-map', '[vout]',
        ...audioOutputLabels.flatMap((label) => ['-map', `[${label}]`]),
      ]);
    } else if (hasAudio) {
      command.outputOptions([
        '-map', '[vout]',
        '-map', '0:a?',
      ]);
    } else {
      command.outputOptions([
        '-map', '[vout]',
      ]);
    }

    const vCodec = formatOptions?.videoCodec || 'libx264';
    const preset = formatOptions?.preset || 'veryfast';
    command.videoCodec(vCodec).outputOptions([
      '-crf 23',
      `-preset ${preset}`,
      '-pix_fmt yuv420p',
    ]);

    if (Number.isFinite(Number(formatOptions?.fps)) && Number(formatOptions?.fps) > 0) {
      command.outputOptions([`-r ${Number(formatOptions?.fps)}`]);
    }
    if (formatOptions?.bitrateKbps && formatOptions.bitrateKbps > 0) {
      command.outputOptions([`-b:v ${formatOptions.bitrateKbps}k`]);
    }

    if (hasAudio) {
      command.audioCodec('aac');
    } else {
      command.noAudio();
    }

    command
      .output(outputPath)
      .on('start', (cmd) => {
        console.log('Bắt đầu ffmpeg burn hardsub với command:', cmd);
      })
      .on('progress', (progress) => {
        if (!onProgress) return;
        let percent = progress.percent;
        if (
          percent === undefined ||
          isNaN(percent) ||
          percent < 0 ||
          (effectiveSpeed > 1.0 && effectiveDuration > 0 && progress.timemark)
        ) {
          if (effectiveDuration > 0 && progress.timemark) {
            const currentSec = timemarkToSeconds(progress.timemark);
            percent = calculateRenderProgress(currentSec, effectiveDuration);
          } else {
            percent = 0;
          }
        }
        onProgress(Math.round(percent * 10) / 10);
      })
      .on('end', () => {
        cleanup();
        if (onProgress) onProgress(100);
        resolve();
      })
      .on('error', (err) => {
        cleanup();
        console.error('Lỗi ffmpeg hardsub:', err.message);
        reject(new Error(`Lỗi render ffmpeg: ${err.message}`));
      })
      .run();
  });
}

/**
 * Đóng gói phụ đề mềm (Softsub) vào container MP4.
 */
export async function muxSoftsub(options: Omit<RenderOptions, 'onProgress'>): Promise<void> {
  const { videoPath, srtPath, outputPath } = options;

  if (!fs.existsSync(videoPath)) {
    throw new Error(`Video gốc không tồn tại: ${videoPath}`);
  }
  if (!fs.existsSync(srtPath)) {
    throw new Error(`File phụ đề không tồn tại: ${srtPath}`);
  }

  return new Promise<void>((resolve, reject) => {
    const command = ffmpeg(videoPath);
    options.onCommandCreated?.(command);

    command
      .input(srtPath)
      .outputOptions([
        '-c:v copy',
        '-c:a copy',
        '-c:s mov_text',
        '-map 0:v',
        '-map 0:a?',
        '-map 1:s'
      ])
      .output(outputPath)
      .on('start', (cmd) => {
        console.log('Bắt đầu ffmpeg mux softsub với command:', cmd);
      })
      .on('end', () => {
        resolve();
      })
      .on('error', (err) => {
        reject(new Error(`Lỗi muxing ffmpeg: ${err.message}`));
      })
      .run();
  });
}
