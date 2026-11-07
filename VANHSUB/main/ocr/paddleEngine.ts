import path from 'path';
import fs from 'fs';
import { spawn } from 'child_process';
import { app } from 'electron';

import { CancelledError } from '../lib/cancel';
import { killProcessTree } from '../lib/processTree';
import { SettingsStore } from '../store/settingsStore';

import { resolvePythonExecutable } from '../lib/pythonEnv';
export { resolvePythonExecutable };

/**
 * Gọi sidecar Python chạy PaddleOCR PP-OCRv5 (qua rapidocr + ONNX Runtime).
 *
 * Python làm toàn bộ phần nặng trên pixel (detect → crop → enhance → rec)
 * rồi trả JSONL; Node chỉ điều phối + chạy lượt OCR thứ hai bằng Tesseract
 * trên chính các crop đã enhance (xem resultMerge.ts).
 *
 * Yêu cầu môi trường (giống Demucs): python -m pip install rapidocr onnxruntime opencv-python
 */

export interface PaddleOcrLine {
  text: string;
  /** Confidence 0-1 của model rec */
  conf: number;
  /** y0 đỉnh dòng theo toạ độ VIDEO GỐC (đã map từ khung crop/scale) */
  y0: number;
  x0: number;
  w: number;
  h: number;
  /** Đường dẫn crop PNG đã enhance — đầu vào cho lượt Tesseract */
  crop: string;
  /** Phân loại text: SUBTITLE (phụ đề chính), OVERLAY (tiêu đề/banner), OTHER_TEXT (nhiễu) */
  classification?: 'SUBTITLE' | 'OVERLAY' | 'OTHER_TEXT';
}

export interface PaddleOcrFrame {
  lines: PaddleOcrLine[];
}

export interface PaddleOcrJob {
  frames: string[];
  cropsDir: string;
  outPath: string;
  /** Tên enum LangRec của rapidocr theo thứ tự ưu tiên (fallback dần) */
  recLangNames: string[];
  detVersion: string;
  recVersion: string;
  modelType: string;
  textScore: number;
  videoWidth: number;
  videoHeight: number;
  /** Tỷ lệ offset vùng crop đáy trong khung gốc */
  regionOffsetRatio: number;
  /** Chế độ quét OCR: auto, bottom, full, custom */
  ocrMode?: string;
  /** Toạ độ vùng custom (0-1) khi ocrMode = custom */
  customRegion?: { x: number; y: number; w: number; h: number } | null;
}

export interface RapidOcrCheck {
  ok: boolean;
  detail: string;
}

export const RAPIDOCR_INSTALL_HINT =
  'Chưa cài PaddleOCR (RapidOCR). Cài 1 lần bằng lệnh: python -m pip install rapidocr onnxruntime opencv-python ' +
  '(lần quét đầu tải model ~30MB, cần internet).';

/** Đường dẫn script sidecar — dev chạy từ nguồn, bản build từ extraResources */
export function resolvePaddleScriptPath(): string {
  if (app?.isPackaged) {
    return path.join(process.resourcesPath, 'paddle', 'paddle_server.py');
  }
  return path.join(typeof app?.getAppPath === 'function' ? app.getAppPath() : process.cwd(), 'main', 'ocr', 'paddle', 'paddle_server.py');
}

/** Kiểm tra python + rapidocr đã sẵn sàng chưa (như checkDemucs của Demucs) */
export function checkRapidOcr(timeoutMs = 60_000): Promise<RapidOcrCheck> {
  return new Promise((resolve) => {
    let settled = false;
    const done = (ok: boolean, detail: string) => {
      if (settled) return;
      settled = true;
      resolve({ ok, detail });
    };

    const pythonBin = resolvePythonExecutable();
    const child = spawn(pythonBin, ['-c', 'import rapidocr, cv2'], { windowsHide: true });
    const timer = setTimeout(() => {
      child.kill();
      done(false, 'Quá thời gian kiểm tra python.');
    }, timeoutMs);

    child.on('error', () => {
      clearTimeout(timer);
      done(false, `Không chạy được python (${pythonBin}). ${RAPIDOCR_INSTALL_HINT}`);
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      if (code === 0) return done(true, 'PaddleOCR (RapidOCR) đã sẵn sàng.');
      done(false, RAPIDOCR_INSTALL_HINT);
    });
  });
}

/**
 * Map mã ngôn ngữ tessdata (setting ocrLanguage) sang tên enum LangRec của
 * rapidocr. PP-OCRv5 model "ch" bao trùm giản thể + phồn thể + Anh + Nhật.
 * Tiếng Việt dùng model latin (bảng chữ cái la-tinh có dấu).
 */
export function mapRecLangNames(ocrLanguage: string): string[] {
  switch (ocrLanguage) {
    case 'chi_sim':
    case 'chi_tra':
    case 'jpn':
      return ['CH'];
    case 'kor':
      return ['KOREAN'];
    case 'eng':
      return ['EN'];
    case 'tha':
      // Tên member enum thay đổi giữa các bản rapidocr — thử cả hai cách đặt tên
      return ['THAI', 'TH'];
    default:
      // vie, vie+eng và mọi ngôn ngữ la-tinh khác
      return ['LATIN'];
  }
}

/**
 * Chạy sidecar Python cho toàn bộ danh sách khung.
 *
 * Tiến trình python sống suốt quét; huỷ = kill tiến trình (shouldStop).
 * Kết quả đọc từ file JSONL sau khi python exit 0 — mỗi khung 1 dòng kể cả
 * khi không có dòng chữ nào, nên index khung luôn khớp đầu vào.
 */
export function runPaddleOcr(
  job: PaddleOcrJob,
  opts?: {
    onReady?: () => void;
    onStage?: (stage: string, message: string) => void;
    onProgress?: (done: number, total: number, stage?: string) => void;
    shouldStop?: () => boolean;
  },
): Promise<PaddleOcrFrame[]> {
  return new Promise((resolve, reject) => {
    const jobPath = job.outPath.replace(/\.jsonl$/i, '') + '.job.json';
    fs.writeFileSync(jobPath, JSON.stringify(job), 'utf-8');

    const pythonBin = resolvePythonExecutable();
    const child = spawn(pythonBin, [resolvePaddleScriptPath(), '--job', jobPath], {
      windowsHide: true,
    });

    let stderrTail = '';
    let killed = false;

    const maybeKill = () => {
      if (opts?.shouldStop?.() && !killed && child.exitCode === null) {
        killed = true;
        killProcessTree(child);
      }
    };

    // Polling định kỳ phòng trường hợp Python nghẽn không nhả stdout
    const stopPollTimer = opts?.shouldStop
      ? setInterval(() => {
          maybeKill();
        }, 300)
      : null;

    let buffer = '';
    child.stdout.on('data', (chunk: Buffer) => {
      maybeKill();
      buffer += chunk.toString('utf-8');
      let nl: number;
      while ((nl = buffer.indexOf('\n')) >= 0) {
        const line = buffer.slice(0, nl).trim();
        buffer = buffer.slice(nl + 1);
        if (!line) continue;
        // Sidecar chỉ ghi JSON xuống stdout; dòng lạ (log thư viện) bỏ qua
        let msg: any;
        try {
          msg = JSON.parse(line);
        } catch {
          continue;
        }
        if (msg.type === 'ready') opts?.onReady?.();
        else if (msg.type === 'stage') opts?.onStage?.(msg.name, msg.msg);
        else if (msg.type === 'progress') opts?.onProgress?.(msg.done, msg.total, msg.stage);
        else if (msg.type === 'warning') console.warn(`[PaddleOCR] ${msg.msg}`);
        else if (msg.type === 'error') {
          killed = true;
          killProcessTree(child);
          if (stopPollTimer) clearInterval(stopPollTimer);
          reject(new Error(`PaddleOCR lỗi: ${msg.msg}`));
          return;
        }
      }
    });

    child.stderr.on('data', (chunk: Buffer) => {
      stderrTail = (stderrTail + chunk.toString('utf-8')).slice(-2000);
    });

    child.on('error', (err) => {
      if (stopPollTimer) clearInterval(stopPollTimer);
      reject(new Error(`Không chạy được python: ${err.message}. ${RAPIDOCR_INSTALL_HINT}`));
    });

    child.on('close', (code) => {
      if (stopPollTimer) clearInterval(stopPollTimer);
      if (killed || opts?.shouldStop?.()) return reject(new CancelledError());
      if (code === 2) return reject(new Error(RAPIDOCR_INSTALL_HINT));
      if (code !== 0) {
        return reject(new Error(`Sidecar PaddleOCR thoát với mã ${code}. ${stderrTail.trim()}`));
      }
      try {
        const frames = parsePaddleOutput(job.outPath, job.frames.length);
        resolve(frames);
      } catch (err: any) {
        reject(new Error(`Không đọc được kết quả PaddleOCR: ${err.message}`));
      }
    });
  });
}

/** Đọc JSONL output — trả về đúng số khung đầu vào (khung lỗi = 0 dòng) */
function parsePaddleOutput(outPath: string, frameCount: number): PaddleOcrFrame[] {
  const frames: PaddleOcrFrame[] = Array.from({ length: frameCount }, () => ({ lines: [] }));
  const raw = fs.readFileSync(outPath, 'utf-8');
  for (const line of raw.split('\n')) {
    if (!line.trim()) continue;
    const rec = JSON.parse(line) as { i: number; lines: PaddleOcrLine[] };
    if (rec.i >= 0 && rec.i < frameCount) frames[rec.i] = { lines: rec.lines ?? [] };
  }
  return frames;
}
