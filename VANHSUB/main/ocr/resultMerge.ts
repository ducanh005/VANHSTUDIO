import type { PaddleOcrFrame, PaddleOcrLine } from './paddleEngine';
import type { OcrFrameResult } from './ocrEngine';

/** Kết quả Tesseract đọc 1 crop đơn dòng (lượt OCR thứ hai) */
export interface CropOcrResult {
  text: string;
  confidence: number;
}

/**
 * So sánh kết quả 2 engine OCR và chốt kết quả từng dòng chữ.
 *
 * Lượt 1: PaddleOCR PP-OCRv5 đọc crop đã enhance (trả conf 0-1).
 * Lượt 2: Tesseract đọc CÙNG crop đó (trả conf 0-100) — model khác hoàn toàn
 * về họ (CTC vs LSTM 2 chiều) nên 2 engine đồng thuận là tín hiệu mạnh.
 *
 * Quy tắc chốt mỗi dòng:
 * - Tesseract đọc hụt/rỗng          → lấy Paddle, conf giữ nguyên (×100)
 * - Giống nhau (sim >= 0.75)        → lấy Paddle, conf = max(2 engine) — đồng
 *                                      thuận nâng độ tin cậy
 * - Khác nhau                       → lấy bên conf cao hơn; hòa (chênh <= 5)
 *                                      thì tin Paddle vì model mới hơn
 * Sau cùng lọc dòng có conf < MIN_LINE_CONFIDENCE (cùng ngưỡng pipeline cũ).
 */

/** Ngưỡng coi 2 engine "đọc giống nhau" (tỉ lệ Levenshtein trên text đã chuẩn hoá) */
const AGREE_SIMILARITY = 0.75;

/** Hòa điểm giữa 2 conf thì tin engine nào (Paddle = model chính) */
const TIE_TOLERANCE = 5;

export interface MergedOcrLine {
  text: string;
  confidence: number;
  y0: number;
  x0?: number;
  w?: number;
  h?: number;
  classification?: 'SUBTITLE' | 'OVERLAY' | 'OTHER_TEXT';
  zone?: 'top' | 'bottom';
  /** Text engine thứ hai đọc cùng crop ('' nếu lượt 2 tắt/đọc hụt) */
  altText?: string;
  altConfidence?: number;
  similarity?: number;
  chosen: 'paddle' | 'tess';
}

export interface MergedOcrFrame {
  lines: MergedOcrLine[];
}

export function mergeOcrResults(
  paddle: PaddleOcrFrame[],
  cropResults: Map<string, CropOcrResult>,
  minLineConfidence: number,
): MergedOcrFrame[] {
  return paddle.map((frame) => ({
    lines: frame.lines
      .map((line) => mergeLine(line, cropResults.get(line.crop)))
      .filter((l): l is MergedOcrLine => l !== null && l.confidence >= minLineConfidence && l.text.length > 0),
  }));
}

function mergeLine(line: PaddleOcrLine, alt: CropOcrResult | undefined): MergedOcrLine | null {
  const paddleConf = Math.round(line.conf * 100);
  const paddleText = line.text.trim();
  if (!paddleText && !alt?.text) return null;

  if (!alt || !alt.text.trim()) {
    return {
      text: paddleText,
      confidence: paddleConf,
      y0: line.y0,
      x0: line.x0,
      w: line.w,
      h: line.h,
      classification: line.classification,
      zone: line.zone,
      altText: '',
      chosen: 'paddle',
    };
  }

  const altText = alt.text.trim();
  const similarity = similarityOf(paddleText, altText);

  let text: string;
  let confidence: number;
  let chosen: 'paddle' | 'tess';

  if (similarity >= AGREE_SIMILARITY) {
    // Đồng thuận — giữ bản Paddle, nâng conf bằng bên cao hơn
    text = paddleText;
    confidence = Math.max(paddleConf, alt.confidence);
    chosen = 'paddle';
  } else if (alt.confidence > paddleConf + TIE_TOLERANCE) {
    text = altText;
    confidence = alt.confidence;
    chosen = 'tess';
  } else {
    text = paddleText;
    confidence = paddleConf;
    chosen = 'paddle';
  }

  return {
    text,
    confidence,
    y0: line.y0,
    x0: line.x0,
    w: line.w,
    h: line.h,
    classification: line.classification,
    zone: line.zone,
    altText,
    altConfidence: alt.confidence,
    similarity,
    chosen,
  };
}

/** Chuẩn hoá để so sánh: bỏ khoảng trắng/dấu câu, lowercase — chỉ còn "chữ" */
function normalizeForCompare(text: string): string {
  return text
    .replace(/[\s.,!?;:、。，！？…·'"“”‘’()（）[\]{}<>《》—–\-~*_]+/g, '')
    .toLowerCase();
}

/** Tỉ lệ giống nhau 0-1: 1 - levenshtein/maxLen (0 nếu một bên rỗng) */
export function similarityOf(a: string, b: string): number {
  const ka = normalizeForCompare(a);
  const kb = normalizeForCompare(b);
  if (!ka || !kb) return 0;
  if (ka === kb) return 1;
  const dist = levenshtein(ka, kb);
  return 1 - dist / Math.max(ka.length, kb.length);
}

function levenshtein(a: string, b: string): number {
  if (a.length === 0) return b.length;
  if (b.length === 0) return a.length;
  let prev = new Array<number>(b.length + 1);
  let curr = new Array<number>(b.length + 1);
  for (let j = 0; j <= b.length; j++) prev[j] = j;
  for (let i = 1; i <= a.length; i++) {
    curr[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      curr[j] = Math.min(prev[j] + 1, curr[j - 1] + 1, prev[j - 1] + cost);
    }
    [prev, curr] = [curr, prev];
  }
  return prev[b.length];
}

/** Ép kiểu về OcrFrameResult cho subtitleBuilder (bỏ trường chẩn đoán) */
export function mergedToFrameResults(merged: MergedOcrFrame[]): OcrFrameResult[] {
  return merged.map((f) => {
    const lines = f.lines.map((l) => ({
      text: l.text,
      confidence: l.confidence,
      y0: l.y0,
      x0: l.x0,
      w: l.w,
      h: l.h,
      classification: l.classification,
      zone: l.zone,
    }));
    return {
      text: lines.map((l) => l.text).join(' '),
      confidence: lines.length
        ? lines.reduce((s, l) => s + l.confidence, 0) / lines.length
        : 0,
      lines,
    };
  });
}
