import os from 'os';
import fs from 'fs';
import { createWorker, PSM, type Worker } from 'tesseract.js';
import { CancelledError } from '../lib/cancel';

/** Ngưỡng tin cậy tối thiểu của TỪNG DÒNG chữ để được giữ (0-100) */
export const MIN_LINE_CONFIDENCE = 40;

/**
 * Regex "ký tự hợp lệ" theo ngôn ngữ quét — token KHÔNG chứa ký tự nào của
 * ngôn ngữ là rác từ nền (người/cảnh vật/chữ nước ngoài) và bị loại.
 * Ví dụ video Trung: "| | ss", "UN S", "TSNS IN AN", "7" bị bỏ; "老外" giữ.
 * Vie/eng không áp dụng (bảng chữ Latin trùng với rác nên không phân biệt được).
 */
export const CJK_TOKEN_FILTER: Record<string, RegExp> = {
  chi_sim: /[\u3000-\u303f\u3400-\u9fff\uf900-\ufaff]/,
  chi_tra: /[\u3000-\u303f\u3400-\u9fff\uf900-\ufaff]/,
  jpn: /[\u3000-\u303f\u3040-\u30ff\u3400-\u9fff\uf900-\ufaff]/,
  kor: /[\u3000-\u303f\uac00-\ud7af]/,
};

/**
 * Lọc token của 1 khung theo ngôn ngữ: tách theo khoảng trắng, bỏ token không
 * chứa ký tự của ngôn ngữ, ghép lại liền nhau (CJK không cần space). Trả về
 * text nguyên bản với ngôn ngữ không có filter.
 */
export function filterTokensByLanguage(text: string, tokenFilter: RegExp | null): string {
  if (!tokenFilter || !text.trim()) return text;
  const kept = text
    .split(/\s+/)
    .filter((token) => tokenFilter.test(token));
  return kept.join('');
}

export interface OcrFrameLine {
  /** Text của dòng đã qua lọc token theo ngôn ngữ */
  text: string;
  confidence: number;
  /** Tọa độ y đỉnh của dòng trong khung (px) — chẩn đoán vị trí phụ đề/nhiễu */
  y0: number;
  x0?: number;
  w?: number;
  h?: number;
  classification?: 'SUBTITLE' | 'OVERLAY' | 'OTHER_TEXT';
  zone?: 'top' | 'bottom';
}

export interface OcrFrameResult {
  /** Text của khung = các dòng đạt ngưỡng ghép lại */
  text: string;
  /** Tin cậy trung bình của các dòng đã giữ (0 nếu không giữ dòng nào) */
  confidence: number;
  /** Các dòng đã giữ kèm vị trí — dump chẩn đoán + lọc theo vùng về sau */
  lines: OcrFrameLine[];
}

/** Kết quả Tesseract đọc 1 crop đơn dòng (lượt OCR thứ hai) */
export interface CropOcrResult {
  text: string;
  confidence: number;
}

/** 1 dòng chữ Tesseract trả về trong khung */
interface RecognizedLine {
  text: string;
  confidence: number;
  /** y0 đỉnh dòng trong khung (px), -1 nếu không có bbox */
  y0: number;
}

/** Gom các dòng từ cấu trúc blocks của tesseract.js — bỏ qua nếu version không trả blocks */
function extractLines(data: unknown): RecognizedLine[] {
  const lines: RecognizedLine[] = [];
  const blocks = (data as { blocks?: unknown[] } | null)?.blocks;
  if (!Array.isArray(blocks)) return lines;
  for (const block of blocks) {
    const paragraphs = (block as { paragraphs?: unknown[] })?.paragraphs;
    if (!Array.isArray(paragraphs)) continue;
    for (const para of paragraphs) {
      for (const line of (para as {
        lines?: Array<{ text?: string; confidence?: number; bbox?: { y0?: number } }>;
      })?.lines ?? []) {
        const text = (line.text || '').trim();
        if (!text) continue;
        lines.push({ text, confidence: line.confidence ?? 0, y0: line.bbox?.y0 ?? -1 });
      }
    }
  }
  return lines;
}

/**
 * Pool worker Tesseract dùng chung cho 1 lần quét OCR.
 *
 * Mỗi worker nạp ngôn ngữ đúng 1 lần rồi nhận liên tiếp nhiều khung hình
 * (nạp lại ngôn ngữ cho từng khung sẽ chậm gấp nhiều lần). Số worker được
 * giới hạn thấp vì OCR chạy trên CPU — quá nhiều worker tranh hạt nhân
 * với Whisper/TTS đang chạy nền.
 *
 * Chế độ:
 * - 'block' (PSM 6): quét cả khung/dải phụ đề nhiều dòng (pipeline cũ)
 * - 'line'  (PSM 7): nhận diện 1 crop đúng 1 dòng chữ — lượt OCR thứ hai
 *   chạy trên chính crop đã enhance bởi PaddleOCR sidecar
 */
export type OcrPoolMode = 'block' | 'line';

export class OcrPool {
  private workers: Worker[] = [];
  private tokenFilter: RegExp | null = null;
  private mode: OcrPoolMode = 'block';

  static async create(
    language: string,
    cachePath: string,
    size?: number,
    mode: OcrPoolMode = 'block',
  ): Promise<OcrPool> {
    const workerCount =
      size ?? Math.max(1, Math.min(3, os.cpus().length - 1));

    fs.mkdirSync(cachePath, { recursive: true });

    const pool = new OcrPool();
    pool.tokenFilter = CJK_TOKEN_FILTER[language] ?? null;
    pool.mode = mode;
    pool.workers = await Promise.all(
      Array.from({ length: workerCount }, async () => {
        const worker = await createWorker(language, 1, { cachePath, logger: () => {} });
        // PSM 6 (khối văn bản) quét được cả dải phụ đề crop lẫn toàn khung —
        // trả về nhiều dòng kèm confidence riêng từng dòng để lọc nhiễu nền.
        // PSM 7 (1 dòng) cho crop đơn dòng từ lượt detect của PaddleOCR.
        await worker.setParameters({
          tessedit_pageseg_mode: mode === 'line' ? PSM.SINGLE_LINE : PSM.SINGLE_BLOCK,
        });
        return worker;
      }),
    );
    return pool;
  }

  /**
   * Nhận diện tuần tự từng khung trên pool, chia đều khung cho các worker.
   * Trả về mảng kết quả cùng thứ tự đầu vào. Huỷ mang tính hợp tác — kiểm tra
   * shouldStop trước mỗi khung, khung đang chạy sẽ chạy xong rồi mới dừng.
   *
   * Lọc theo confidence TỪNG DÒNG chứ không phải mean cả khung: video thật
   * có nền bận (người/cảnh vật) kéo mean cả khung xuống dưới ngưỡng dù dòng
   * phụ đề in rõ vẫn conf 60-90 — lọc theo khung sẽ làm mất gần hết kết quả.
   */
  async recognizeFiles(
    files: string[],
    onProgress?: (done: number, total: number) => void,
    shouldStop?: () => boolean,
  ): Promise<OcrFrameResult[]> {
    const results: OcrFrameResult[] = new Array(files.length);
    let nextIndex = 0;
    let done = 0;

    const runWorker = async (worker: Worker): Promise<void> => {
      while (true) {
        if (shouldStop?.()) throw new CancelledError();
        const index = nextIndex++;
        if (index >= files.length) return;

        const { data } = await worker.recognize(files[index], {}, { text: true, blocks: true });

        // Fallback chỉ dành cho trường hợp tesseract KHÔNG trả cấu trúc blocks
        // (version khác). Nếu blocks có mà không dòng nào đạt ngưỡng thì trả
        // khung rỗng — tuyệt đối không bơm lại text nguyên khung đầy nhiễu nền.
        if (!Array.isArray((data as { blocks?: unknown } | null)?.blocks)) {
          const whole = ((data as { text?: string } | null)?.text || '').trim();
          const conf = (data as { confidence?: number } | null)?.confidence ?? 0;
          results[index] = {
            text: whole,
            confidence: whole ? conf : 0,
            lines: whole ? [{ text: whole, confidence: conf, y0: -1 }] : [],
          };
        } else {
          // Lọc theo từng dòng, rồi lọc token rác nền theo ngôn ngữ ngay trong
          // từng dòng (token không chứa ký tự của ngôn ngữ = rác từ nền)
          const kept = extractLines(data)
            .filter((l) => l.confidence >= MIN_LINE_CONFIDENCE)
            .map((l) => ({ ...l, text: filterTokensByLanguage(l.text, this.tokenFilter) }))
            .filter((l) => l.text.length > 0);

          if (kept.length > 0) {
            const meanConf = kept.reduce((s, l) => s + l.confidence, 0) / kept.length;
            results[index] = {
              text: kept.map((l) => l.text).join(' '),
              confidence: meanConf,
              lines: kept,
            };
          } else {
            results[index] = { text: '', confidence: 0, lines: [] };
          }
        }

        done++;
        onProgress?.(done, files.length);
      }
    };

    await Promise.all(this.workers.map((w) => runWorker(w)));
    return results;
  }

  /**
   * Lượt OCR thứ hai: nhận diện từng crop đơn dòng (PSM 7) — chạy trên chính
   * crop đã enhance bởi PaddleOCR sidecar để hai engine đọc cùng dữ liệu.
   *
   * Trả về mảng cùng thứ tự đầu vào, mỗi phần tử là text conf cao nhất của
   * crop (text ''/conf 0 nếu crop không đọc được dòng nào). Text đã lọc token
   * rác nền theo ngôn ngữ (CJK) để so sánh công bằng với PaddleOCR.
   */
  async recognizeCrops(
    files: string[],
    onProgress?: (done: number, total: number) => void,
    shouldStop?: () => boolean,
  ): Promise<CropOcrResult[]> {
    if (this.mode !== 'line') {
      throw new Error('recognizeCrops yêu cầu OcrPool.create(..., mode: "line")');
    }
    const results: CropOcrResult[] = new Array(files.length).fill(null).map(() => ({ text: '', confidence: 0 }));
    let nextIndex = 0;
    let done = 0;

    const runWorker = async (worker: Worker): Promise<void> => {
      while (true) {
        if (shouldStop?.()) throw new CancelledError();
        const index = nextIndex++;
        if (index >= files.length) return;

        const { data } = await worker.recognize(files[index], {}, { text: true, blocks: true });
        const lines = extractLines(data);
        let best = { text: '', confidence: 0 };
        for (const l of lines) {
          const text = filterTokensByLanguage(l.text, this.tokenFilter).trim();
          if (text && l.confidence > best.confidence) best = { text, confidence: l.confidence };
        }
        results[index] = best;

        done++;
        onProgress?.(done, files.length);
      }
    };

    await Promise.all(this.workers.map((w) => runWorker(w)));
    return results;
  }

  async terminate(): Promise<void> {
    await Promise.allSettled(this.workers.map((w) => w.terminate()));
    this.workers = [];
  }
}
