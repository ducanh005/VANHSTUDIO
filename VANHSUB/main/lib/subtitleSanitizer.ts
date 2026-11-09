import type { SrtLine } from './srt';

export interface SanitizeOptions {
  /**
   * Danh sách phân đoạn Whisper đối chiếu âm thanh.
   * Nếu cung cấp, các phân đoạn có thời lượng ngắn (< minDurationMs) nhưng khớp với
   * âm thanh lời thoại Whisper sẽ được bảo toàn thay vì bị loại bỏ.
   */
  whisperSegments?: SrtLine[];

  /**
   * Thời lượng tối thiểu (mili-giây) của một khối phụ đề hợp lệ.
   * Mặc định: 150ms.
   */
  minDurationMs?: number;

  /**
   * Loại bỏ các khối chỉ chứa 1 ký tự đơn lẻ hoặc 1 ký tự kèm dấu câu (ví dụ: 'c', 'A', 'a', '.', '-').
   * Mặc định: true.
   */
  removeSingleChars?: boolean;

  /**
   * Loại bỏ các khối chỉ chứa dấu câu hoặc ký hiệu trôi nổi không có chữ cái (\p{L}) hay số (\p{N}).
   * Mặc định: true.
   */
  removeFloatingPunctuation?: boolean;
}

export interface SanitizeResult {
  cleaned: SrtLine[];
  removedCount: number;
  removedItems: SrtLine[];
}

/**
 * Regex phát hiện ký tự dị thường / Unicode glitches:
 * - Ký tự thay thế lỗi giải mã: \uFFFD ()
 * - Vùng mã riêng tư Private Use Area: \uE000-\uF8FF
 * - Ký tự vẽ khung Box Drawing: \u2500-\u257F
 * - Khối hình học Block Elements: \u2580-\u259F
 * - Ký tự điều khiển (Control chars): \u0000-\u0008, \u000B, \u000C, \u000E-\u001F
 */
const UNICODE_GLITCH_REGEX = /[\uFFFD\uE000-\uF8FF\u2500-\u259F\u0000-\u0008\u000B\u000C\u000E-\u001F]/u;
const PUA_OR_REPLACEMENT_REGEX = /[\uFFFD\uE000-\uF8FF]/u;

/**
 * Kiểm tra xem một dòng phụ đề có phải là rác OCR hay không dựa trên 4 quy tắc:
 * - Rule G1: Ký tự đơn lẻ ('c', 'A', 'a', '.', '-', v.v.).
 * - Rule G2: Dấu câu / ký hiệu trôi nổi không chứa chữ cái (\p{L}) hoặc chữ số (\p{N}).
 * - Rule G3: Thời lượng siêu ngắn (< 150ms) không khớp với bất kỳ âm thanh lời thoại nào từ Whisper.
 * - Rule G4: Ký tự Unicode dị thường / lỗi decode (PUA, Box Drawing, Block Elements, \uFFFD).
 */
export function isOcrGarbageLine(line: SrtLine, options?: SanitizeOptions): boolean {
  if (!line || typeof line.text !== 'string') {
    return true;
  }

  const trimmed = line.text.trim();
  if (trimmed.length === 0) {
    return true;
  }

  // Mốc thời gian không hợp lệ
  if (isNaN(line.startMs) || isNaN(line.endMs) || line.startMs < 0 || line.endMs <= line.startMs) {
    return true;
  }

  const minDurationMs = Math.max(0, options?.minDurationMs ?? 150);
  const removeSingleChars = options?.removeSingleChars ?? true;
  const removeFloatingPunctuation = options?.removeFloatingPunctuation ?? true;

  // Rule G4: Ký tự Unicode dị thường (PUA, Replacement character )
  if (PUA_OR_REPLACEMENT_REGEX.test(trimmed)) {
    return true;
  }

  // Rule G2: Dấu câu & ký hiệu trôi nổi không chứa bất kỳ chữ cái (\p{L}) hoặc chữ số (\p{N}) nào
  if (removeFloatingPunctuation && !/[\p{L}\p{N}]/u.test(trimmed)) {
    return true;
  }

  // Tách riêng chữ và số để kiểm tra Rule G1
  const alphanumericOnly = trimmed.replace(/[^\p{L}\p{N}]/gu, '');

  // Rule G1: 1 ký tự đơn lẻ (hoặc chỉ có 1 ký tự chữ/số bị bao quanh bởi dấu câu/ký hiệu)
  // Ngoại lệ: Ký tự chữ tượng hình CJK (Hán tự, Hiragana, Katakana) mang ý nghĩa trọn vẹn của một từ/câu đối thoại (ví dụ: '好', '是', '谁', '等')
  if (removeSingleChars) {
    const isCjk = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}]/u.test(alphanumericOnly);
    if (!isCjk && (trimmed.length <= 1 || alphanumericOnly.length <= 1)) {
      return true;
    }
  }

  // Rule G4: Box Drawing hoặc Block Elements không có đủ nội dung chữ/số hợp lệ
  if (UNICODE_GLITCH_REGEX.test(trimmed)) {
    const stripped = trimmed.replace(new RegExp(UNICODE_GLITCH_REGEX.source, 'gu'), '').trim();
    if (stripped.length <= 1 || !/[\p{L}\p{N}]/u.test(stripped)) {
      return true;
    }
  }

  // Rule G3: Thời lượng hiển thị siêu ngắn (< 150ms)
  const duration = line.endMs - line.startMs;
  if (duration <= 0) {
    return true;
  }

  if (duration < minDurationMs) {
    if (options?.whisperSegments !== undefined && options.whisperSegments.length > 0) {
      const hasWhisperAudio = options.whisperSegments.some(
        (w) => w.endMs >= line.startMs && w.startMs <= line.endMs
      );
      if (!hasWhisperAudio) {
        return true;
      }
    } else {
      // Không có tín hiệu Whisper chứng thực âm thanh -> xác định là nhiễu chớp khung hình
      return true;
    }
  }

  return false;
}

/**
 * Lọc sạch danh sách phụ đề, loại bỏ các dòng rác OCR theo tiêu chuẩn.
 */
export function sanitizeSubtitles(lines: SrtLine[], options?: SanitizeOptions): SanitizeResult {
  if (!lines || !Array.isArray(lines) || lines.length === 0) {
    return {
      cleaned: [],
      removedCount: 0,
      removedItems: [],
    };
  }

  const cleaned: SrtLine[] = [];
  const removedItems: SrtLine[] = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (isOcrGarbageLine(line, options)) {
      removedItems.push(line);
    } else {
      cleaned.push(line);
    }
  }

  return {
    cleaned,
    removedCount: removedItems.length,
    removedItems,
  };
}

export interface UntranslatedOptions {
  /**
   * Cho biết nguồn phụ đề có phải là ngôn ngữ CJK (tiếng Trung, Nhật, Hàn) hay không.
   * Nếu nguồn là CJK, mà một dòng cụ thể hoàn toàn KHÔNG chứa ký tự CJK
   * (chỉ chứa từ Latinh ngắn, watermark, brand, số... ví dụ: "Aenon", "Pauouco", "MISSION"),
   * thì khi mô hình giữ nguyên dạng từ này, nó được coi là foreign token hợp lệ và miễn trừ kiểm tra.
   */
  isSourceCjk?: boolean;
  /** Ngôn ngữ đích cần dịch (mặc định: 'vi') */
  targetLanguage?: string;
}

/**
 * Kiểm tra xem một dòng phụ đề có bị coi là chưa dịch hay không (R1: Untranslated Line Detection).
 * Trả về true nếu bản dịch giống hệt câu gốc (target === source) và KHÔNG thuộc diện miễn trừ.
 * Các trường hợp miễn trừ (exempted tokens):
 * 1. Dòng rỗng hoặc chỉ chứa dấu câu, ký hiệu, nốt nhạc (không có chữ cái \p{L} hay chữ số \p{N}).
 * 2. Dòng chỉ chứa chữ số và ký tự số (ví dụ: "123", "2024", "$100", "50%").
 * 3. Từ mượn / viết tắt ngắn toàn cầu (ví dụ: "OK", "O.K.").
 * 4. Khớp chính xác với bảng thuật ngữ bắt buộc (glossary) quy định giữ nguyên dạng.
 * 5. Ngoại lệ từ ngoại lai Latinh/watermark: Nguồn là CJK nhưng dòng chỉ chứa chữ cái Latinh ngắn (không có chữ CJK).
 */
export function isLineUntranslated(
  source: string,
  target: string,
  glossary?: string,
  options?: UntranslatedOptions
): boolean {
  const sourceTrim = (source || '').trim();
  const targetTrim = (target || '').trim();

  // Nếu target rỗng -> chưa dịch
  if (!targetTrim) return true;

  // Loại bỏ các thẻ định dạng phụ đề (HTML tags <i>, <b>, <u>, <font...>, hoặc ASS override {\...})
  // trước khi trích xuất ký tự chữ/số để tránh việc mô hình chỉ thêm/bớt thẻ định dạng mà giữ nguyên câu gốc
  const stripSubtitleTags = (s: string) => s.replace(/<[^>]+>|\{[^}]+\}/gu, '');
  const sourceClean = stripSubtitleTags(sourceTrim);
  const targetClean = stripSubtitleTags(targetTrim);

  // Chuẩn hóa loại bỏ toàn bộ dấu câu và ký tự phân cách để so sánh cốt lõi chữ/số
  const sourceAlpha = (sourceClean || sourceTrim).toLowerCase().replace(/[^\p{L}\p{N}]/gu, '');
  const targetAlpha = (targetClean || targetTrim).toLowerCase().replace(/[^\p{L}\p{N}]/gu, '');

  const isExactOrAlphaMatch =
    targetTrim.toLowerCase() === sourceTrim.toLowerCase() ||
    (sourceClean && targetClean && targetClean.toLowerCase() === sourceClean.toLowerCase()) ||
    (sourceAlpha.length > 0 && sourceAlpha === targetAlpha);

  // Nếu target khác source cả về chuỗi thô lẫn sau khi chuẩn hóa chữ/số -> đã được dịch
  if (!isExactOrAlphaMatch) {
    return false;
  }

  // target trùng khớp source: kiểm tra các ngoại lệ (exempted tokens)
  // 1. Không có chữ cái (\p{L}) hoặc chữ số (\p{N}) -> dấu câu, nốt nhạc, ký hiệu -> Miễn trừ
  if (!/[\p{L}\p{N}]/u.test(sourceClean || sourceTrim)) {
    return false;
  }

  // 2. Không chứa bất kỳ chữ cái nào (chỉ có số, ký hiệu tiền tệ, phần trăm, thời gian...) -> Miễn trừ
  if (!/\p{L}/u.test(sourceClean || sourceTrim)) {
    return false;
  }

  // 2b. Ký tự đơn lẻ hoặc đoạn rác OCR ngắn không phải CJK (ví dụ: "L", "V", "T", "S", "E", "D", "a", "s", "à") -> Miễn trừ
  const isCjk = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]/u.test(sourceClean || sourceTrim);
  if (!isCjk && sourceAlpha.length <= 1) {
    return false;
  }

  // 2c. Dòng mã / số / ký hiệu lẫn lộn chữ cái ngắn (ví dụ: "@806", "e 22", "3 07", "0A A88", "8 3 07", "mN:", "FA +", "29 C -") -> Miễn trừ
  const letterCount = (sourceClean.match(/\p{L}/gu) || []).length;
  if (!isCjk && letterCount <= 2 && sourceClean.length <= 12) {
    return false;
  }

  // 2d. Mã watermark / thương hiệu / handle viết hoa toàn bộ (ví dụ: "ANGELANJ", "PACLIDAORK", "WUE", "ANGELANI") -> Miễn trừ
  if (!isCjk && /^[A-Z0-9_ -]{2,25}$/.test(sourceClean.trim()) && !/[a-z]/.test(sourceClean)) {
    const words = sourceClean.trim().split(/\s+/);
    if (words.length <= 4 && words.every((w) => w.length <= 15)) {
      return false;
    }
  }

  // 2e. Từ đơn cực ngắn (<= 3 ký tự) đã có sẵn dấu thanh tiếng Việt khi dịch sang tiếng Việt (ví dụ: "SỐ", "à") -> Miễn trừ
  const targetLang = (options?.targetLanguage || 'vi').toLowerCase();
  if (
    (targetLang === 'vi' || targetLang.startsWith('vi-')) &&
    sourceClean.length <= 4 &&
    sourceAlpha.length <= 3 &&
    /[ăâđêôơưĂÂĐÊÔƠƯáàảãạấầẩẫậắằẳẵặéèẻẽẹếềểễệíìỉĩịóòỏõọốồổỗộớờởỡợúùủũụứừửữựýỳỷỹỵ]/u.test(sourceClean)
  ) {
    return false;
  }

  // 3. Từ mượn / viết tắt / từ cảm thán toàn cầu ("OK", "O.K.", "Okay", "SOS")
  // Chuẩn hóa loại bỏ toàn bộ dấu câu và ký hiệu bao quanh (ví dụ: "OK.", "OK!", "(OK)", "O.K.!")
  const alphaUpper = (sourceClean || sourceTrim).toUpperCase().replace(/[^\p{L}\p{N}]/gu, '');
  if (alphaUpper === 'OK' || alphaUpper === 'OKAY' || alphaUpper === 'SOS') {
    return false;
  }

  // 4. Khớp thuật ngữ glossary (hỗ trợ cả dấu phân cách = và :, cùng dấu câu kèm theo như "VANHSUB!")
  if (glossary) {
    const rawLines = glossary.split('\n').map((l) => l.trim().replace(/^[-•*]\s*/, '')).filter(Boolean);
    const sourceCleanNorm = sourceAlpha;
    const targetCleanNorm = targetAlpha;

    for (const gLine of rawLines) {
      const match = gLine.match(/^(.+?)[=:](.+)$/);
      if (match) {
        const src = match[1].trim().toLowerCase();
        const tgt = match[2].trim().toLowerCase();
        if (
          (src === sourceTrim.toLowerCase() && tgt === targetTrim.toLowerCase()) ||
          (stripSubtitleTags(src).toLowerCase() === sourceClean.toLowerCase() &&
           stripSubtitleTags(tgt).toLowerCase() === targetClean.toLowerCase()) ||
          (src.replace(/[^\p{L}\p{N}]/gu, '') === sourceCleanNorm &&
           tgt.replace(/[^\p{L}\p{N}]/gu, '') === targetCleanNorm)
        ) {
          return false;
        }
      }
    }
  }

  // 5. Ngoại lệ từ ngoại lai Latinh/watermark khi nguồn là CJK:
  // Nếu video nguồn là CJK nhưng dòng phụ đề cụ thể hoàn toàn KHÔNG chứa ký tự CJK
  // (chỉ chứa chữ cái Latinh ngắn, thương hiệu, watermark, tên riêng... ví dụ: "Aenon", "Pauouco", "CapCut")
  // và độ dài <= 40 ký tự, thì việc giữ nguyên dạng là hợp lệ.
  if (options?.isSourceCjk) {
    const hasCjk = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]/u.test(
      sourceClean || sourceTrim
    );
    if (!hasCjk && (sourceClean || sourceTrim).length <= 40) {
      return false;
    }
  }

  return true;
}

