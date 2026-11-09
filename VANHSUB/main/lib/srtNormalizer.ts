import fs from 'fs';
import path from 'path';
import { parseSrt, serializeSrt, type SrtLine } from './srt';
import { isOcrGarbageLine } from './subtitleSanitizer';
import {
  deduplicateExact,
  deduplicateProgressiveKaraoke,
  normalizeText,
  stripVietnameseDiacritics,
  levenshteinDistance,
} from './subtitleDeduplication';

export interface AudioAlignOptions {
  /** Cửa sổ thời gian tìm kiếm câu thoại Whisper xung quanh câu OCR (mặc định 2500ms) */
  searchWindowMs?: number;
  /** Ngưỡng tương đồng token/âm vị tối thiểu để xác nhận khớp (mặc định 0.35) */
  minSimilarityThreshold?: number;
  /** Độ phủ token tối thiểu để chấp nhận câu ngắn trong câu thoại dài (mặc định 0.5) */
  minCoverageThreshold?: number;
}

export interface NormalizeSrtOptions {
  /** Keep observed event boundaries. Invalid events are reported for review, not re-timed. */
  preserveEvidenceTiming?: boolean;
  /** Khoảng cách tối đa (ms) giữa 2 dòng liên tiếp để gộp (mặc định 1200ms) */
  maxGapMs?: number;
  /** Thời lượng hiển thị tối thiểu (ms) cho 1 dòng phụ đề (mặc định 200ms) */
  minDisplayDurationMs?: number;
  /** Tốc độ đọc ký tự mỗi giây (CPS - Characters Per Second, mặc định 20) */
  targetCps?: number;
  /** Thời lượng tối đa cho 1 câu phụ đề (mặc định 7000ms) */
  maxDurationMs?: number;
  /** Bật/tắt gộp mảnh câu dở dang (mặc định true) */
  mergeBrokenFragments?: boolean;
  /** Bật/tắt khử trùng lặp karaoke / progressive text (mặc định true) */
  deduplicateKaraoke?: boolean;
  /** Bật/tắt khử trùng lặp nguyên văn (mặc định true) */
  deduplicateExact?: boolean;
  /** Bật/tắt sửa mốc thời gian nghịch đảo & ngắn (mặc định true) */
  fixTimelines?: boolean;
  /** Bật/tắt loại bỏ rác OCR (mặc định true) */
  removeGarbage?: boolean;
  /** Phân đoạn âm thanh Whisper đối chiếu nếu có (R2: Audio Alignment) */
  audioSegments?: SrtLine[];
  /** Tùy chọn căn chỉnh âm thanh */
  audioAlignmentOptions?: AudioAlignOptions;
}

export interface NormalizeSrtStats {
  inputCount: number;
  outputCount: number;
  exactDuplicatesMerged: number;
  karaokeMerged: number;
  fragmentsMerged: number;
  invertedTimelinesFixed: number;
  shortDurationsExtended: number;
  overlapsResolved: number;
  audioAlignedCount: number;
  garbageRemoved: number;
}

export interface NormalizeSrtResult {
  lines: SrtLine[];
  stats: NormalizeSrtStats;
}

/**
 * Tính thời lượng hiển thị tối ưu theo tốc độ đọc ký tự trên giây (CPS - Characters Per Second).
 * Chuẩn phụ đề phim: 15-22 CPS. Mặc định tính theo 20 CPS.
 */
export function calculateDurationForCps(
  text: string,
  targetCps: number = 20,
  minMs: number = 200,
  maxMs: number = 7000
): number {
  const cleanLen = (text || '').trim().replace(/\s+/g, ' ').length;
  if (cleanLen === 0) return minMs;
  const cpsMs = Math.round((cleanLen / Math.max(1, targetCps)) * 1000);
  return Math.max(minMs, Math.min(maxMs, cpsMs));
}

// Tập các từ nối / hư từ / giới từ tiếng Việt thường bắt đầu hoặc kết thúc mảnh câu bị ngắt dở
const VIETNAMESE_CONTINUATION_WORDS = new Set([
  'và', 'nhưng', 'mà', 'thì', 'là', 'rằng', 'của', 'với', 'cho', 'để',
  'ở', 'trong', 'trên', 'dưới', 'đang', 'đã', 'sẽ', 'được', 'bị', 'bởi',
  'vì', 'do', 'nên', 'nếu', 'tuy', 'dù', 'cũng', 'rồi', 'lại', 'ra',
  'vào', 'lên', 'xuống', 'qua', 'về', 'như', 'hoặc', 'hay', 'tại', 'bằng',
  'từ', 'tới', 'đến', 'theo', 'nhất', 'hơn', 'rất', 'quá', 'lắm',
  'thăm', 'gặp', 'thấy', 'nhìn', 'biết', 'tìm', 'chọn', 'yêu', 'thích',
  'xem', 'nghe', 'đọc', 'viết', 'mua', 'bán', 'gọi', 'bảo', 'mời', 'mang'
]);

const ENGLISH_CONTINUATION_WORDS = new Set([
  'and', 'but', 'or', 'nor', 'for', 'so', 'yet', 'because', 'although',
  'though', 'since', 'while', 'where', 'when', 'which', 'that', 'who',
  'whom', 'whose', 'to', 'of', 'in', 'on', 'at', 'by', 'with', 'from',
  'into', 'about', 'between', 'through', 'after', 'before', 'during',
  'without', 'under', 'around', 'among', 'over', 'is', 'are', 'was',
  'were', 'be', 'been', 'being', 'have', 'has', 'had', 'the', 'a',
  'an', 'this', 'that', 'these', 'those', 'my', 'your', 'his', 'her',
  'its', 'our', 'their', 'as', 'than', 'if', 'whether', 'like'
]);

const ALL_CONTINUATION_WORDS = new Set([
  ...VIETNAMESE_CONTINUATION_WORDS,
  ...ENGLISH_CONTINUATION_WORDS
]);

// Dấu kết thúc câu hoàn chỉnh: dấu chấm đơn (không phải ba chấm ...), chấm than, chấm hỏi...
const TERMINAL_PUNCTUATION_RE = /(?<!\.)[.!?。！？]$/;
const ELLIPSIS_RE = /(?:\.\.\.|…)$/;
const NON_TERMINAL_ENDING_RE = /[,，\-–—~:;]$/;
const CONTINUATION_START_PUNCT_RE = /^[,，\-–—~…\.]/;

// Các từ viết tắt phổ biến có dấu chấm ở cuối (không phải dấu kết thúc câu)
const ABBREVIATION_RE = /(?:^|\s)(?:mr|mrs|ms|dr|prof|st|jr|sr|vs|etc|approx|dept|est|vol|no|inc|corp|co|ltd|e\.g|i\.e|a\.m|p\.m|tp|ts|ths|bs|tt|pgs|gs|ks|nxb|tr|v\.v)\.$/i;

/**
 * Kiểm tra xem 2 dòng phụ đề liên tiếp có phải là các mảnh bị ngắt dở dang của cùng một câu hay không.
 */
export function isBrokenSentenceFragment(
  curr: SrtLine,
  next: SrtLine,
  maxGapMs: number = 1200,
  maxDurationMs: number = 7000
): boolean {
  if (!curr?.text || !next?.text) return false;

  const text1 = curr.text.trim();
  const text2 = next.text.trim();
  if (!text1 || !text2) return false;

  // 1. Kiểm tra speaker: nếu cả 2 có speaker thì phải cùng một người nói
  if (curr.speaker && next.speaker && curr.speaker !== next.speaker) {
    return false;
  }

  // 2. Kiểm tra khoảng cách thời gian (gap):
  // Nếu next xảy ra trước curr quá 1000ms (mốc thời gian nghịch đảo thực sự), không gộp
  if (next.startMs < curr.startMs - 1000) {
    return false;
  }

  const gap = next.startMs - curr.endMs;
  if (gap > maxGapMs) {
    return false;
  }

  // Nếu gộp 2 dòng khiến khoảng thời gian hiển thị vượt quá maxDurationMs (chuẩn phụ đề tối đa 7s),
  // không gộp thêm để tránh phụ đề hiển thị quá dài trên màn hình
  const combinedDuration = Math.max(curr.endMs, next.endMs) - Math.min(curr.startMs, next.startMs);
  if (combinedDuration > maxDurationMs) {
    return false;
  }

  // 3. Kiểm tra dấu gạch đầu dòng thoại (Dialogue Dash):
  // Trong quy ước phụ đề, dấu gạch ngang đầu dòng theo sau bởi khoảng trắng ("- " hoặc "– ")
  // là dấu hiệu chuyển lượt người nói (speaker turn), KHÔNG PHẢI mảnh câu bị ngắt dở!
  const isDialogueDash = /^[-–—]\s+|^[-–—][\p{Lu}\p{N}]/u.test(text2);
  if (isDialogueDash) {
    return false;
  }

  // 3b. Kiểm tra banner / tiêu đề chữ hoa toàn bộ (All-caps graphic/banner vs normal dialogue):
  const isAllUpper1 = text1.length > 3 && /^[\p{Lu}\p{N}\s\p{P}]+$/u.test(text1) && !/[\p{Ll}]/u.test(text1);
  const isAllUpper2 = text2.length > 3 && /^[\p{Lu}\p{N}\s\p{P}]+$/u.test(text2) && !/[\p{Ll}]/u.test(text2);
  if (isAllUpper1 !== isAllUpper2) {
    return false;
  }

  // 4. Phân tích ngữ cảnh dấu câu và chữ hoa/thường:
  // Bóc tách dấu ngoặc kép/ngoặc đơn/ngoặc nhọn ở cuối dòng 1 nếu có
  const text1WithoutQuotes = text1.replace(/["'”’»\)\]]+$/, '');
  const isAbbreviation1 = ABBREVIATION_RE.test(text1WithoutQuotes);
  const hasTerminal1 = !isAbbreviation1 && TERMINAL_PUNCTUATION_RE.test(text1WithoutQuotes);
  const hasNonTerminal1 = NON_TERMINAL_ENDING_RE.test(text1WithoutQuotes);

  // Lấy từ cuối cùng của dòng 1 và từ đầu tiên của dòng 2
  const words1 = text1.split(/\s+/).filter(Boolean);
  const words2 = text2.split(/\s+/).filter(Boolean);
  if (words1.length === 0 || words2.length === 0) return false;

  const lastWord1Raw = words1[words1.length - 1];
  const firstWord2Raw = words2[0];

  const lastWord1Clean = lastWord1Raw.replace(/[^\p{L}\p{N}]/gu, '').toLowerCase();
  const firstWord2Clean = firstWord2Raw.replace(/[^\p{L}\p{N}]/gu, '').toLowerCase();

  // Bóc tách dấu ngoặc kép/ngoặc đơn ở đầu từ nếu có (ví dụ: '"chúng', '(đang')
  const firstWord2WithoutQuotes = firstWord2Raw.replace(/^["'«“‘(\[]+/, '');

  // Dòng 2 bắt đầu bằng chữ thường
  const startsWithLowercase2 = /^[\p{Ll}]/u.test(firstWord2WithoutQuotes);

  // Dòng 2 bắt đầu bằng dấu câu nối (dấu phẩy, gạch ngang, ba chấm...)
  const startsWithConnectorPunct2 = CONTINUATION_START_PUNCT_RE.test(text2);

  // Dòng 1 kết thúc bằng từ nối hoặc dòng 2 bắt đầu bằng từ nối
  const isLastWord1Connector = ALL_CONTINUATION_WORDS.has(lastWord1Clean);
  const isFirstWord2Connector = ALL_CONTINUATION_WORDS.has(firstWord2Clean);

  // Nếu dòng 2 bắt đầu bằng chữ hoa, dòng 1 không kết thúc bằng dấu nối,
  // KHÔNG có từ nối ở cuối dòng 1 hay đầu dòng 2, và dòng 1 KHÔNG phải là từ viết tắt:
  // Dòng 2 bắt đầu một câu độc lập mới, không phải mảnh vỡ!
  if (
    /^[\p{Lu}]/u.test(firstWord2WithoutQuotes) &&
    !hasNonTerminal1 &&
    !isFirstWord2Connector &&
    !isLastWord1Connector &&
    !isAbbreviation1
  ) {
    return false;
  }

  // Trường hợp CJK (tiếng Trung, Nhật, Hàn): không phân biệt hoa/thường
  const isCjk = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}]/u.test(text1 + text2);
  if (isCjk && !hasTerminal1 && gap <= maxGapMs) {
    return true;
  }

  // Trường hợp 0: Dòng 1 kết thúc bằng ba chấm (...) và dòng 2 bắt đầu bằng chữ thường hoặc dấu nối
  const hasEllipsis1 = ELLIPSIS_RE.test(text1WithoutQuotes);
  if (hasEllipsis1 && (startsWithLowercase2 || startsWithConnectorPunct2 || isFirstWord2Connector)) {
    return true;
  }

  // Trường hợp 1: Dòng 1 không có dấu kết thúc câu và dòng 2 bắt đầu bằng chữ thường hoặc dấu nối hoặc dòng 1 kết thúc bằng từ viết tắt
  if (!hasTerminal1 && (startsWithLowercase2 || startsWithConnectorPunct2 || isAbbreviation1)) {
    return true;
  }

  // Trường hợp 2: Dòng 1 kết thúc bằng dấu phẩy/gạch nối, và dòng 2 tiếp tục câu
  if (hasNonTerminal1) {
    return true;
  }

  // Trường hợp 3: Có từ nối ở biên (cuối dòng 1 hoặc đầu dòng 2) và dòng 1 không có terminal punct
  if (!hasTerminal1 && (isLastWord1Connector || isFirstWord2Connector)) {
    return true;
  }

  // Trường hợp 4: Cả 2 dòng đều rất ngắn (< 35 ký tự), khoảng lặng cực nhỏ (gap <= 600ms),
  // dòng 1 hoàn toàn không có dấu kết thúc câu
  if (!hasTerminal1 && text1.length < 35 && text2.length < 35 && gap <= 600) {
    return true;
  }

  return false;
}

/**
 * Gộp hai mảnh câu thành một câu hoàn chỉnh, nối text và tính toán lại timeline theo CPS.
 */
export function combineSentenceFragments(
  curr: SrtLine,
  next: SrtLine,
  targetCps: number = 20,
  minDisplayDurationMs: number = 200,
  maxDurationMs: number = 7000
): SrtLine {
  let t1 = curr.text.trim();
  let t2 = next.text.trim();

  // Xóa dấu gạch nối ngắt từ ở cuối dòng 1 hoặc đầu dòng 2
  if (/[-–—]$/.test(t1)) {
    t1 = t1.replace(/[-–—]+$/, '').trim();
  }
  if (/^[-–—]/.test(t2)) {
    t2 = t2.replace(/^[-–—]+/, '').trim();
  }

  // Xóa ellipsis lặp lại nếu cả hai dòng cùng có
  if (/(?:\.\.\.|…)$/.test(t1) && /^(?:\.\.\.|…)/.test(t2)) {
    t2 = t2.replace(/^(?:\.\.\.|…)\s*/, '');
  }

  // Kiểm tra nối từ: nếu là CJK thì ghép trực tiếp không dấu cách, còn lại có khoảng cách
  const isCjk = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}]/u.test(t1 + t2);
  let mergedText = '';
  if (isCjk) {
    mergedText = `${t1}${t2}`.replace(/\s+/g, ' ').trim();
  } else {
    // Nếu t2 bắt đầu bằng dấu câu (như phẩy ,), không chèn khoảng cách trước dấu câu
    if (/^[,\.;:?!]/.test(t2)) {
      mergedText = `${t1}${t2}`;
    } else {
      mergedText = `${t1} ${t2}`;
    }
  }

  const startMs = Math.min(curr.startMs, next.startMs);
  let endMs = Math.max(curr.endMs, next.endMs);

  // Đảm bảo thời lượng hiển thị sau gộp phù hợp tốc độ đọc (CPS)
  const cpsDuration = calculateDurationForCps(mergedText, targetCps, minDisplayDurationMs, maxDurationMs);
  if (endMs - startMs < cpsDuration) {
    endMs = startMs + cpsDuration;
  }
  if (endMs - startMs > maxDurationMs) {
    endMs = startMs + maxDurationMs;
  }

  return {
    id: curr.id,
    startMs,
    endMs,
    text: mergedText,
    speaker: curr.speaker || next.speaker,
    confidence: curr.confidence && next.confidence ? Math.round((curr.confidence + next.confidence) / 2) : curr.confidence ?? next.confidence,
  };
}

function extractTokens(text: string): string[] {
  if (!text) return [];
  const normalized = stripVietnameseDiacritics(text).toLowerCase();

  const cjkChars = [...normalized.matchAll(/[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}]/gu)].map((m) => m[0]);
  if (cjkChars.length > 0) {
    const nonCjkWords = normalized
      .replace(/[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}]/gu, ' ')
      .replace(/[^\p{L}\p{N}\s]/gu, ' ')
      .split(/\s+/)
      .filter(Boolean);
    return [...cjkChars, ...nonCjkWords];
  }

  return normalized
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .split(/\s+/)
    .filter(Boolean);
}

/**
 * Căn chỉnh timeline độ chính xác cao bằng Audio Alignment (Requirement R2)
 * Đối chiếu từng câu OCR với phân đoạn lời thoại Whisper thực tế để triệt tiêu độ trôi lệch timeline OCR.
 */
export function alignTimelineWithAudio(
  ocrLines: SrtLine[],
  whisperLines: SrtLine[],
  options?: AudioAlignOptions
): { alignedLines: SrtLine[]; alignedCount: number } {
  if (!ocrLines || ocrLines.length === 0) return { alignedLines: [], alignedCount: 0 };
  if (!whisperLines || whisperLines.length === 0) {
    return { alignedLines: [...ocrLines], alignedCount: 0 };
  }

  const searchWindowMs = options?.searchWindowMs ?? 2500;
  const minSimilarityThreshold = options?.minSimilarityThreshold ?? 0.35;
  const minCoverageThreshold = options?.minCoverageThreshold ?? 0.5;

  let alignedCount = 0;

  // Giai đoạn 1: Tìm ứng viên Whisper tốt nhất cho từng câu OCR
  const matchResults: Array<{
    ocr: SrtLine;
    bestWhisper: SrtLine | null;
    bestScore: number;
  }> = [];

  for (const ocr of ocrLines) {
    const ocrTokens = extractTokens(ocr.text || '');

    if (ocrTokens.length === 0) {
      matchResults.push({ ocr, bestWhisper: null, bestScore: 0 });
      continue;
    }

    const ocrTokenSet = new Set(ocrTokens);

    // Tìm các ứng viên Whisper trong cửa sổ thời gian [startMs - searchWindowMs, endMs + searchWindowMs]
    const candidates = whisperLines.filter(
      (w) =>
        w.endMs >= ocr.startMs - searchWindowMs &&
        w.startMs <= ocr.endMs + searchWindowMs
    );

    let bestWhisper: SrtLine | null = null;
    let bestScore = 0;

    for (const wh of candidates) {
      const whTokens = extractTokens(wh.text || '');
      if (whTokens.length === 0) continue;

      const whTokenSet = new Set(whTokens);

      let matchCount = 0;
      for (const t of ocrTokenSet) {
        if (whTokenSet.has(t)) matchCount++;
      }

      const coverage = matchCount / (ocrTokens.length || 1);
      const dice = (2 * matchCount) / (ocrTokens.length + whTokens.length || 1);
      const effectiveScore = coverage >= minCoverageThreshold ? Math.max(dice, coverage) : dice;

      if (effectiveScore > bestScore) {
        bestScore = effectiveScore;
        bestWhisper = wh;
      }
    }

    if (bestWhisper && bestScore >= minSimilarityThreshold) {
      matchResults.push({ ocr, bestWhisper, bestScore });
    } else {
      matchResults.push({ ocr, bestWhisper: null, bestScore: 0 });
    }
  }

  // Giai đoạn 2: Phân bổ thời lượng thông minh khi nhiều câu OCR cùng khớp 1 đoạn Whisper
  // Gom tất cả câu OCR cùng khớp vào targetWhisper (kể cả có banner/graphic không tiếng xen giữa)
  const whisperToOcrItems = new Map<SrtLine, Array<{ ocr: SrtLine; index: number }>>();
  for (let i = 0; i < matchResults.length; i++) {
    const item = matchResults[i];
    if (item.bestWhisper) {
      const list = whisperToOcrItems.get(item.bestWhisper) || [];
      list.push({ ocr: item.ocr, index: i });
      whisperToOcrItems.set(item.bestWhisper, list);
    }
  }

  const alignedOcrMap = new Map<number, SrtLine>();

  for (const [targetWhisper, items] of whisperToOcrItems.entries()) {
    const wStart = targetWhisper.startMs;
    const minNeededDuration = items.length * 200;
    const wEnd = Math.max(targetWhisper.endMs, wStart + minNeededDuration);
    const totalDuration = wEnd - wStart;

    if (items.length === 1) {
      alignedCount++;
      const { ocr, index } = items[0];
      alignedOcrMap.set(index, {
        ...ocr,
        startMs: wStart,
        endMs: Math.min(wEnd, wStart + 7000),
        speaker: ocr.speaker || targetWhisper.speaker,
      });
    } else {
      items.sort((a, b) => a.ocr.startMs - b.ocr.startMs);
      const totalLen = items.reduce((sum, it) => sum + Math.max(1, (it.ocr.text || '').trim().length), 0);
      let curStart = wStart;

      for (let k = 0; k < items.length; k++) {
        alignedCount++;
        const it = items[k];
        const textLen = Math.max(1, (it.ocr.text || '').trim().length);
        const isLast = k === items.length - 1;

        let curEnd: number;
        if (isLast) {
          curEnd = wEnd;
        } else {
          const shareMs = Math.round((textLen / totalLen) * totalDuration);
          const remainingSlots = items.length - 1 - k;
          curEnd = Math.min(wEnd - remainingSlots * 200, curStart + Math.max(200, shareMs));
        }

        if (curEnd <= curStart) {
          curEnd = curStart + 200;
        }

        alignedOcrMap.set(it.index, {
          ...it.ocr,
          startMs: curStart,
          endMs: curEnd,
          speaker: it.ocr.speaker || targetWhisper.speaker,
        });

        curStart = curEnd;
      }
    }
  }

  const alignedLines: SrtLine[] = matchResults.map((item, idx) => {
    return alignedOcrMap.get(idx) || { ...item.ocr };
  });

  return { alignedLines, alignedCount };
}

/**
 * Thuật toán chính: Chuẩn hóa toàn diện file phụ đề SRT lỗi OCR (SRT OCR Normalizer)
 *
 * Thực hiện tuần tự các bước:
 * 1. Khắc phục lỗi mốc thời gian nghịch đảo (startMs >= endMs) & hiển thị siêu ngắn (< 200ms).
 * 2. Lọc bỏ rác OCR (PUA, glyphs, 1 ký tự vô nghĩa).
 * 3. Khử trùng lặp nội dung liên tiếp (exact duplicates) và gộp timeline.
 * 4. Nhận diện và gộp các dòng phụ đề hiện dần dạng karaoke / progressive text.
 * 5. Gộp các mảnh câu bị ngắt dở dang thành câu hoàn chỉnh có nghĩa, điều chỉnh CPS.
 * 6. (Tùy chọn) Căn chỉnh timeline theo tiếng nói thực tế từ Whisper (Audio Alignment).
 * 7. Sắp xếp và sửa lỗi overlapping, đảm bảo 100% dòng phụ đề có startMs < endMs và endMs[i-1] <= startMs[i].
 */
export function normalizeSrtLines(
  lines: SrtLine[],
  options?: NormalizeSrtOptions
): NormalizeSrtResult {
  const maxGapMs = options?.maxGapMs ?? 1200;
  const minDisplayDurationMs = options?.minDisplayDurationMs ?? 200;
  const targetCps = options?.targetCps ?? 20;
  const maxDurationMs = options?.maxDurationMs ?? 7000;
  const mergeBrokenFragments = options?.mergeBrokenFragments ?? true;
  const deduplicateKaraoke = options?.deduplicateKaraoke ?? true;
  const deduplicateExactEnabled = options?.deduplicateExact ?? true;
  const fixTimelines = options?.fixTimelines ?? true;
  const removeGarbage = options?.removeGarbage ?? true;

  const stats: NormalizeSrtStats = {
    inputCount: lines ? lines.length : 0,
    outputCount: 0,
    exactDuplicatesMerged: 0,
    karaokeMerged: 0,
    fragmentsMerged: 0,
    invertedTimelinesFixed: 0,
    shortDurationsExtended: 0,
    overlapsResolved: 0,
    audioAlignedCount: 0,
    garbageRemoved: 0,
  };

  if (!lines || lines.length === 0) {
    return { lines: [], stats };
  }

  if (options?.preserveEvidenceTiming) {
    const result = lines.filter((line): line is SrtLine => {
      if (!line || !line.text?.trim()) return false;
      if (options?.removeGarbage !== false && isOcrGarbageLine(line, { minDurationMs: 0 })) {
        stats.garbageRemoved++;
        return false;
      }
      return true;
    })
      .map((line) => ({
        ...line,
        needsReview: line.needsReview || !Number.isFinite(line.startMs) ||
          !Number.isFinite(line.endMs) || line.startMs < 0 || line.endMs <= line.startMs,
      }))
      .sort((a, b) => a.startMs - b.startMs || a.endMs - b.endMs);
    stats.outputCount = result.length;
    return { lines: result, stats };
  }

  // ---------------------------------------------------------------------------
  // BƯỚC 1: Sửa các mốc thời gian nghịch đảo, âm, hoặc quá ngắn & Lọc rác OCR
  // ---------------------------------------------------------------------------
  let cleaned: SrtLine[] = [];

  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i];
    if (!raw || typeof raw.text !== 'string' || !raw.text.trim()) {
      stats.garbageRemoved++;
      continue;
    }

    let startMs = Math.max(0, Math.round(raw.startMs || 0));
    let endMs = Math.round(raw.endMs || 0);

    if (fixTimelines) {
      const cpsDur = Math.max(
        minDisplayDurationMs,
        calculateDurationForCps(raw.text, targetCps, minDisplayDurationMs, maxDurationMs)
      );

      // Trường hợp 1: endMs <= 0 hoặc thiếu endMs: đặt endMs theo CPS, không được đảo startMs về 0!
      if (endMs <= 0) {
        stats.invertedTimelinesFixed++;
        endMs = startMs + cpsDur;
      } else if (startMs > endMs) {
        // Timeline nghịch đảo: startMs > endMs
        stats.invertedTimelinesFixed++;
        const diff = startMs - endMs;
        // Nếu chênh lệch quá lớn (> maxDurationMs), endMs là mốc quang học rác -> đặt endMs theo CPS
        if (diff > maxDurationMs) {
          endMs = startMs + cpsDur;
        } else {
          // Cặp mốc đảo hợp lý (ví dụ: startMs = 5000, endMs = 3000) -> đảo lại
          const temp = startMs;
          startMs = endMs;
          endMs = temp;
        }
      } else if (startMs === endMs) {
        stats.invertedTimelinesFixed++;
        endMs = startMs + cpsDur;
      }

      // Khoảng hiển thị quá ngắn < 200ms
      if (endMs - startMs < minDisplayDurationMs) {
        stats.shortDurationsExtended++;
        endMs = startMs + cpsDur;
      }
    }

    if (removeGarbage && isOcrGarbageLine({ ...raw, startMs, endMs }, { minDurationMs: 0 })) {
      stats.garbageRemoved++;
      continue;
    }

    cleaned.push({
      ...raw,
      id: raw.id || `line-${cleaned.length}`,
      startMs,
      endMs,
      text: normalizeText(raw.text),
    });
  }

  // Sắp xếp sơ bộ theo trục thời gian
  cleaned.sort((a, b) => a.startMs - b.startMs || a.endMs - b.endMs);

  // ---------------------------------------------------------------------------
  // BƯỚC 2: Khử trùng lặp nội dung liên tiếp (exact duplicates) và gộp timeline
  // ---------------------------------------------------------------------------
  if (deduplicateExactEnabled && cleaned.length > 1) {
    const beforeExactCount = cleaned.length;
    cleaned = deduplicateExact(cleaned, { maxGapMs });
    stats.exactDuplicatesMerged = beforeExactCount - cleaned.length;
  }

  // ---------------------------------------------------------------------------
  // BƯỚC 3: Nhận diện và gộp các dòng phụ đề hiện dần dạng karaoke / progressive text
  // ---------------------------------------------------------------------------
  if (deduplicateKaraoke && cleaned.length > 1) {
    const beforeKaraokeCount = cleaned.length;
    cleaned = deduplicateProgressiveKaraoke(cleaned, { maxGapMs });
    stats.karaokeMerged = beforeKaraokeCount - cleaned.length;
  }

  // ---------------------------------------------------------------------------
  // BƯỚC 4: Gộp các mảnh câu bị ngắt dở dang thành câu hoàn chỉnh có nghĩa
  // ---------------------------------------------------------------------------
  if (mergeBrokenFragments && cleaned.length > 1) {
    const mergedList: SrtLine[] = [];
    let i = 0;

    while (i < cleaned.length) {
      let current = { ...cleaned[i] };
      let j = i + 1;

      while (j < cleaned.length) {
        const next = cleaned[j];
        if (isBrokenSentenceFragment(current, next, maxGapMs, maxDurationMs)) {
          current = combineSentenceFragments(
            current,
            next,
            targetCps,
            minDisplayDurationMs,
            maxDurationMs
          );
          stats.fragmentsMerged++;
          j++;
        } else {
          break;
        }
      }

      mergedList.push(current);
      i = j;
    }

    cleaned = mergedList;
  }

  // ---------------------------------------------------------------------------
  // BƯỚC 5: Căn chỉnh timeline bằng Audio Alignment (R2) khi có file âm thanh
  // ---------------------------------------------------------------------------
  if (options?.audioSegments && options.audioSegments.length > 0) {
    const alignRes = alignTimelineWithAudio(cleaned, options.audioSegments, options.audioAlignmentOptions);
    cleaned = alignRes.alignedLines;
    stats.audioAlignedCount = alignRes.alignedCount;
  }

  // ---------------------------------------------------------------------------
  // BƯỚC 6: Sắp xếp & Khắc phục hoàn toàn lỗi overlapping (Strict Timeline Invariant)
  // Đảm bảo 100% dòng đầu ra: startMs < endMs VÀ endMs[i-1] <= startMs[i]
  // ---------------------------------------------------------------------------
  cleaned.sort((a, b) => a.startMs - b.startMs || a.endMs - b.endMs);

  const finalLines: SrtLine[] = [];

  for (let i = 0; i < cleaned.length; i++) {
    const cur = { ...cleaned[i] };

    // Đảm bảo thời lượng tối thiểu cho từng câu
    if (cur.endMs <= cur.startMs) {
      cur.endMs = cur.startMs + Math.max(minDisplayDurationMs, calculateDurationForCps(cur.text, targetCps, minDisplayDurationMs, maxDurationMs));
    }

    if (finalLines.length === 0) {
      finalLines.push(cur);
      continue;
    }

    const prev = finalLines[finalLines.length - 1];

    // Xử lý overlapping: prev.endMs > cur.startMs
    if (prev.endMs > cur.startMs) {
      stats.overlapsResolved++;

      // Nếu 2 dòng có text giống hệt nhau hoặc 1 dòng chứa dòng kia: gộp lại
      const normCur = normalizeText(cur.text).toLowerCase();
      const normPrev = normalizeText(prev.text).toLowerCase();
      const isCjk = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}]/u.test(normPrev + normCur);

      const cleanTrailing = (s: string) => s.replace(/[\p{P}\p{S}\s]+$/gu, '').trim();
      const prevClean = cleanTrailing(normPrev);
      const curClean = cleanTrailing(normCur);

      const isPrevInCur =
        normCur === normPrev ||
        prevClean === curClean ||
        (isCjk
          ? (curClean.startsWith(prevClean) || normCur.startsWith(normPrev))
          : (curClean.startsWith(prevClean + ' ') || normCur.startsWith(normPrev + ' ') || (prevClean.length > 4 && curClean.startsWith(prevClean))));

      const isCurInPrev =
        normCur === normPrev ||
        prevClean === curClean ||
        (isCjk
          ? (prevClean.startsWith(curClean) || normPrev.startsWith(normCur))
          : (prevClean.startsWith(curClean + ' ') || normPrev.startsWith(normCur + ' ') || (curClean.length > 4 && prevClean.startsWith(curClean))));

      if (isCurInPrev) {
        prev.endMs = Math.max(prev.endMs, cur.endMs);
        continue;
      }
      if (isPrevInCur) {
        prev.text = cur.text;
        prev.endMs = Math.max(prev.endMs, cur.endMs);
        continue;
      }

      if (cur.startMs > prev.startMs) {
        // Cắt ngắn prev.endMs để vừa khít cur.startMs
        const availableDuration = cur.startMs - prev.startMs;
        if (availableDuration >= minDisplayDurationMs) {
          prev.endMs = cur.startMs;
        } else {
          // Khoảng cách quá hẹp: dịch cur.startMs về sau
          prev.endMs = prev.startMs + minDisplayDurationMs;
          cur.startMs = prev.endMs;
          if (cur.endMs <= cur.startMs) {
            cur.endMs = cur.startMs + Math.max(minDisplayDurationMs, calculateDurationForCps(cur.text, targetCps, minDisplayDurationMs, maxDurationMs));
          }
        }
      } else {
        // prev.startMs === cur.startMs: tịnh tiến cur.startMs về sau prev
        cur.startMs = prev.endMs;
        if (cur.endMs <= cur.startMs) {
          cur.endMs = cur.startMs + Math.max(minDisplayDurationMs, calculateDurationForCps(cur.text, targetCps, minDisplayDurationMs, maxDurationMs));
        }
      }
    }

    finalLines.push(cur);
  }

  // Lần kiểm tra cuối cùng và đánh số ID lại từ 0..N-1
  const resultLines: SrtLine[] = finalLines.map((line, index) => {
    // Đảm bảo tính bất biến tuyệt đối startMs < endMs
    const safeStart = Math.max(0, line.startMs);
    const safeEnd = Math.max(safeStart + minDisplayDurationMs, line.endMs);
    return {
      ...line,
      id: `line-${index}`,
      startMs: safeStart,
      endMs: safeEnd,
    };
  });

  // Đảm bảo không còn bất kỳ overlap nào giữa các dòng kế tiếp
  for (let i = 1; i < resultLines.length; i++) {
    if (resultLines[i - 1].endMs > resultLines[i].startMs) {
      resultLines[i].startMs = resultLines[i - 1].endMs;
      if (resultLines[i].endMs <= resultLines[i].startMs) {
        resultLines[i].endMs = resultLines[i].startMs + minDisplayDurationMs;
      }
    }
  }

  stats.outputCount = resultLines.length;

  return {
    lines: resultLines,
    stats,
  };
}

/**
 * Chuẩn hóa trực tiếp chuỗi nội dung SRT
 */
export function normalizeSrt(srtContent: string, options?: NormalizeSrtOptions): string {
  const parsed = parseSrt(srtContent);
  const result = normalizeSrtLines(parsed, options);
  return serializeSrt(result.lines);
}

/**
 * Chuẩn hóa trực tiếp file SRT trên đĩa và ghi đè hoặc ghi ra file mới
 */
export function normalizeSrtFile(
  inputSrtPath: string,
  outputSrtPath?: string,
  options?: NormalizeSrtOptions
): NormalizeSrtResult {
  if (!fs.existsSync(inputSrtPath)) {
    throw new Error(`File SRT không tồn tại: ${inputSrtPath}`);
  }

  const rawContent = fs.readFileSync(inputSrtPath, 'utf-8');
  const parsed = parseSrt(rawContent);
  const result = normalizeSrtLines(parsed, options);

  const targetPath = outputSrtPath || inputSrtPath;
  fs.writeFileSync(targetPath, serializeSrt(result.lines), 'utf-8');

  return result;
}
