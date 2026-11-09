import { nextAvailablePath } from '../lib/paths';
import fs from 'fs';
import path from 'path';
import { jsonrepair } from 'jsonrepair';
import { createGeminiClient, friendlyGeminiError, translateSubtitleLine } from '../ai/geminiClient';
import { SettingsStore } from '../store/settingsStore';
import { parseSrtStrict, serializeSrt, SrtLine } from '../lib/srt';
import { CancelledError } from '../lib/cancel';
import { breakVietnameseLines } from '../lib/nlpSegmenter';
import { isLineUntranslated, isOcrGarbageLine } from '../lib/subtitleSanitizer';

export { isLineUntranslated };

interface BatchItem {
  i: string;
  text: string;
}

interface TranslatedItem {
  i: string;
  text: string;
}

// =========================================================================
// CHECKPOINT — cache bản dịch theo từng batch, lưu xuống đĩa ngay sau mỗi
// batch thành công. Nếu API lỗi / huỷ / app đóng giữa chừng, lần chạy lại
// sẽ tái sử dụng các dòng đã dịch (đúng ngôn ngữ + text gốc không đổi) và
// chỉ dịch phần còn lại. Khi dịch hoàn tất thì xoá checkpoint.
// =========================================================================

interface CheckpointData {
  targetLanguage: string;
  srtMtimeMs?: number;
  totalLines?: number;
  /** key = id dòng phụ đề ('line-0'…); value = text gốc + bản dịch đã có */
  translations: Record<string, { source: string; target: string }>;
}

/** Đường dẫn file checkpoint đi kèm 1 file SRT */
export function getCheckpointPath(srtPath: string): string {
  return path.join(path.dirname(srtPath), `${path.basename(srtPath, '.srt')}.checkpoint.json`);
}

/** Đọc checkpoint (trả về Map rỗng nếu chưa có / sai ngôn ngữ / hỏng file / SRT đã thay đổi) */
export function loadCheckpoint(
  srtPath: string,
  targetLanguage: string,
  expectedTotalLines?: number,
  options?: { isSourceCjk?: boolean; targetLanguage?: string }
): Map<string, string> {
  const result = new Map<string, string>();
  const filePath = getCheckpointPath(srtPath);
  if (!fs.existsSync(filePath)) return result;

  try {
    // Kiểm tra thời gian sửa đổi: nếu file SRT mới hơn checkpoint quá 2s, phụ đề gốc đã thay đổi
    if (fs.existsSync(srtPath)) {
      const srtMtime = fs.statSync(srtPath).mtimeMs;
      const cpMtime = fs.statSync(filePath).mtimeMs;
      if (srtMtime > cpMtime + 2000) {
        console.warn(`[Translate] File SRT đã thay đổi sau lần lưu checkpoint trước — hủy checkpoint cũ.`);
        try { fs.unlinkSync(filePath); } catch {}
        return result;
      }
    }

    const data = JSON.parse(fs.readFileSync(filePath, 'utf-8')) as CheckpointData;
    if (data?.targetLanguage !== targetLanguage || typeof data.translations !== 'object') {
      return result;
    }

    // Nếu checkpoint lưu số dòng khác với số dòng hiện tại của file SRT, phụ đề gốc đã thay đổi
    if (expectedTotalLines !== undefined && typeof data.totalLines === 'number' && data.totalLines !== expectedTotalLines) {
      console.warn(`[Translate] Số dòng file SRT (${expectedTotalLines}) khác số dòng trong checkpoint (${data.totalLines}) — hủy checkpoint cũ.`);
      try { fs.unlinkSync(filePath); } catch {}
      return result;
    }

    for (const [id, entry] of Object.entries(data.translations)) {
      if (entry && typeof entry.source === 'string' && typeof entry.target === 'string') {
        const targetTrim = entry.target.trim();
        const sourceTrim = entry.source.trim();
        if (!targetTrim) continue;
        // Loại bỏ dữ liệu rác/lỗi từ lần chạy trước nếu chưa thực sự dịch
        if (isLineUntranslated(sourceTrim, targetTrim, SettingsStore.get('glossary'), options)) {
          continue;
        }
        result.set(id, JSON.stringify([entry.source, entry.target]));
      }
    }
  } catch {
    // checkpoint hỏng → bỏ qua, dịch lại từ đầu (an toàn hơn là dùng dữ liệu sai)
  }
  return result;
}

/** Ghi checkpoint xuống đĩa (đè file cũ) kèm metadata thời gian sửa đổi */
export function saveCheckpoint(
  srtPath: string,
  targetLanguage: string,
  translations: Record<string, { source: string; target: string }>,
  totalLines?: number
): void {
  let srtMtimeMs: number | undefined;
  try {
    if (fs.existsSync(srtPath)) {
      srtMtimeMs = fs.statSync(srtPath).mtimeMs;
    }
  } catch {}
  const data: CheckpointData = { targetLanguage, translations, srtMtimeMs, totalLines };
  fs.writeFileSync(getCheckpointPath(srtPath), JSON.stringify(data), 'utf-8');
}

// =========================================================================
// GLOSSARY & VĂN PHONG — cấu hình ở Cài đặt, đưa thẳng vào system prompt
// để giữ nhất quán thuật ngữ / xưng hô xuyên suốt bản dịch.
// =========================================================================

function buildGlossaryPrompt(): string {
  const raw = (SettingsStore.get('glossary') || '').trim();
  if (!raw) return '';
  const lines = raw
    .split('\n')
    .map((l) => l.trim().replace(/^[-•*]\s*/, ''))
    .filter(Boolean);
  if (lines.length === 0) return '';
  return `\nBẢNG THUẬT NGỮ BẮT BUỘC — phải dịch đúng và nhất quán theo bảng này cho TOÀN BỘ bản dịch (mỗi dòng có dạng "nguồn = cách dịch"):\n${lines
    .map((l) => `- ${l}`)
    .join('\n')}`;
}

function buildStyleGuidePrompt(): string {
  const raw = (SettingsStore.get('translationStyleGuide') || '').trim();
  if (!raw) return '';
  return `\nVĂN PHONG & QUY TẮC XƯNG HÔ — áp dụng nhất quán toàn bộ bản dịch:\n${raw}`;
}

/** Ghép prompt hệ thống: rules gốc + glossary + style guide */
export function buildSystemPrompt(targetLanguage: string): string {
  const base = `Bạn là biên dịch viên phụ đề phim và video chuyên nghiệp.
Nhiệm vụ: Dịch danh sách các câu phụ đề sang ngôn ngữ đích: "${targetLanguage}".

QUY TẮC BẮT BUỘC:
1. ĐỊNH DẠNG ĐẦU VÀO:
   - Nhận JSON chứa mảng các phần tử: {"i": "id", "text": "nội dung"}.
2. ĐỊNH DẠNG ĐẦU RA:
   - Trả về DUY NHẤT một chuỗi JSON mảng các đối tượng: [{"i": "id", "text": "bản dịch"}].
   - Tuyệt đối không thêm markdown block (\`\`\`json), không giải thích thêm, không kèm văn bản nào khác.
3. TOÀN VẸN 100% VÀ BẮT BUỘC DỊCH SANG NGÔN NGỮ ĐÍCH (RẤT QUAN TRỌNG):
   - MỌI câu trả về PHẢI được dịch thực sự sang ngôn ngữ đích: "${targetLanguage}".
   - TUYỆT ĐỐI KHÔNG sao chép hoặc lặp lại nguyên văn bản gốc chưa dịch (không reproduce verbatim source text).
   - BẮT BUỘC dịch đầy đủ 100% tất cả các câu từ đầu đến cuối danh sách (tỷ lệ sót dòng = 0%).
   - Các câu ngắn ("Ồ!", "Dạ.", "Vâng!", "Hả?"), câu ngắt quãng hay câu đầu file/giữa file đều PHẢI dịch chính xác sang ngôn ngữ đích, tuyệt đối không bỏ qua hoặc giữ nguyên câu gốc chưa dịch.
4. BẢO TOÀN ID:
   - Giữ NGUYÊN 100% định dạng và giá trị của trường "i" cho từng dòng tương ứng (ví dụ: "line-0", "line-1"). Không tự ý đổi ID thành số hay chuỗi khác.
5. CỬA SỔ NGỮ CẢNH TRƯỢT (SLIDING WINDOW CONTEXT):
   - Dữ liệu ngữ cảnh trong trường "context" (nếu có) cung cấp 2-3 câu thoại đã dịch trước đó để giữ nhất quán đại từ nhân xưng, vai vế nhân vật và mạch phim.
   - TUYỆT ĐỐI không dịch lại các câu ngữ cảnh đó và không đưa vào mảng kết quả trả về.
6. VĂN PHONG PHIM — CÔ ĐỌNG, SÚC TÍCH, TỐI ĐA 2 DÒNG HIỂN THỊ (QUAN TRỌNG):
   - Bản dịch phải sát nghĩa, tự nhiên theo văn nói đời thường của phim/video.
   - Câu chữ phải cô đọng, súc tích, độ dài tương xứng với câu gốc và thời lượng hiển thị (CPS chuẩn).
   - TUYỆT ĐỐI không dịch lê thê, dài dòng. Mỗi câu dịch phải có độ dài phù hợp, tối đa 2 dòng hiển thị (mỗi dòng tối đa 37-40 ký tự; tổng độ dài toàn câu không vượt quá 70-74 ký tự). Tuyệt đối không để câu dịch quá dài làm tràn 3-4 dòng trên màn hình.
7. NHẤT QUÁN:
   - Dịch nhất quán: cùng một nhân vật, từ ngữ, tên riêng hoặc thuật ngữ thì dùng cùng một cách dịch ở mọi dòng trong video.`;
  return base + buildGlossaryPrompt() + buildStyleGuidePrompt();
}

/** Prompt dự phòng chặt chẽ dùng khi retry batch bị thiếu dòng hoặc sai định dạng */
export function buildRetrySystemPrompt(targetLanguage: string, expectedCount: number): string {
  const base = `Bạn là hệ thống dịch thuật máy tự động chính xác cao cho phụ đề video.
Nhiệm vụ: Dịch TOÀN BỘ danh sách câu sau sang ngôn ngữ đích: "${targetLanguage}".

QUY TẮC CỰC KỲ NGHIÊM NGẶT (CẢNH BÁO LỖI LẦN TRƯỚC):
1. BẮT BUỘC DỊCH THỰC SỰ SANG "${targetLanguage}": TUYỆT ĐỐI KHÔNG lặp lại hoặc sao chép nguyên văn bản gốc (không reproduce verbatim source text). Mọi câu trả về PHẢI là câu đã dịch sang ngôn ngữ đích "${targetLanguage}". (Ngoại lệ: Đối với tên riêng quốc tế, thương hiệu, mã số hoặc watermark không có từ tương đương, được phép giữ nguyên dạng).
2. Danh sách có chính xác ${expectedCount} câu. Bạn PHẢI trả về đúng mảng JSON gồm chính xác ${expectedCount} phần tử (tỷ lệ sót dòng = 0%).
3. Định dạng trả về: DUY NHẤT chuỗi JSON thuần:
[{"i": "id_gốc", "text": "bản_dịch"}]
4. Giữ NGUYÊN 100% trường "i" của từng câu giống hệt đầu vào. Không bỏ sót bất kỳ câu nào dù ngắn hay dài.
5. Mỗi câu dịch phải ngắn gọn, súc tích, tối đa 2 dòng hiển thị (dưới 70 ký tự toàn câu, mỗi dòng <= 37-40 ký tự).
6. Không giải thích, không bọc trong markdown.`;
  return base + buildGlossaryPrompt() + buildStyleGuidePrompt();
}

/**
 * Định dạng ngắt dòng hiển thị (\n) thuần tuý cho các dòng phụ đề tiếng Việt vượt quá 37 ký tự hoặc có trên 2 dòng.
 * Bảo toàn 100% số lượng dòng, id, startMs, endMs, speaker từ file phụ đề gốc.
 * Tuyệt đối không xé vụn thành nhiều dòng, không tính lại timestamp, không chèn khoảng hở nhân tạo.
 */
export function applyVisualLineWrapping(lines: SrtLine[], isVietnamese = true): SrtLine[] {
  if (!isVietnamese) return lines;
  return lines.map((line) => {
    if (!line.text) return line;
    const rawLines = line.text.split(/\r?\n/);
    const hasLengthOverflow = rawLines.some((sub) => sub.trim().length > 37);
    const hasLineCountOverflow = rawLines.length > 2;

    if (hasLengthOverflow || hasLineCountOverflow) {
      const normalized = line.text.replace(/\r?\n/g, ' ').replace(/[ \t]+/g, ' ').trim();
      const wrapped37 = breakVietnameseLines(normalized, 37);
      const sublines37 = wrapped37.split('\n');

      // Nếu chuẩn 37 bị ngắt thành > 2 dòng:
      // Kiểm tra xem chuẩn 38-42 ký tự (chuẩn hiển thị video cho phép tối đa 37-40 ký tự)
      // có giữ vừa vặn trong 2 dòng không để tránh làm vỡ thành 3 dòng làm choáng màn hình
      if (sublines37.length > 2) {
        for (const limit of [38, 39, 40, 41, 42]) {
          const wrapped = breakVietnameseLines(normalized, limit);
          const sublines = wrapped.split('\n');
          if (sublines.length <= 2 && sublines.every((s) => s.trim().length <= limit)) {
            return {
              ...line,
              text: wrapped,
            };
          }
        }

        // Nếu chuỗi <= 105 ký tự mà vẫn bị ngắt > 2 dòng do phạt ngữ cảnh từ ghép/từ nối:
        // Tìm điểm ngắt khoảng trắng tối ưu nhất thành đúng 2 dòng cân bằng (ưu tiên <= 46 ký tự, tối đa <= 52 ký tự)
        if (normalized.length <= 105 && normalized.includes(' ')) {
          const spaces: number[] = [];
          for (let i = 0; i < normalized.length; i++) {
            if (normalized[i] === ' ') spaces.push(i);
          }

          // Thử ngưỡng chặt trước (46), nếu không có khoảng trắng phù hợp thì nới rộng sang 52
          for (const maxSubline of [46, 52]) {
            let bestIdx = -1;
            let bestDiff = Infinity;
            for (const sp of spaces) {
              const left = normalized.slice(0, sp).trim();
              const right = normalized.slice(sp + 1).trim();
              if (left.length <= maxSubline && right.length <= maxSubline) {
                const diff = Math.abs(left.length - right.length);
                if (diff < bestDiff) {
                  bestDiff = diff;
                  bestIdx = sp;
                }
              }
            }
            if (bestIdx !== -1) {
              return {
                ...line,
                text: `${normalized.slice(0, bestIdx).trim()}\n${normalized.slice(bestIdx + 1).trim()}`,
              };
            }
          }
        }
      }

      return {
        ...line,
        text: wrapped37,
      };
    }
    return line;
  });
}

/**
 * Trích xuất và chuẩn hóa linh hoạt dữ liệu JSON trả về từ Gemini:
 * - Hỗ trợ định dạng mảng: [{"i": "line-0", "text": "..."}], [{"id": "line-0", ...}], [{"index": 0, ...}]
 * - Hỗ trợ cấu trúc bao bọc: { items: [...] }, { translations: [...] }, { result: [...] }, { data: [...] }
 * - Hỗ trợ cấu trúc dictionary: { "line-0": "...", "line-1": "..." } hoặc { "0": "...", "1": "..." }
 * - Hỗ trợ mảng chuỗi đơn thuần theo đúng thứ tự (positional fallback): ["Dịch 1", "Dịch 2"]
 * - Nhận diện ID linh hoạt: ID chuỗi, ID số, ID kèm tiền tố, index 0-based hoặc 1-based.
 * - Không bỏ sót ID 0 (tránh bẫy falsy của JavaScript khi i === 0).
 */
export function extractAndNormalizeTranslationBatch(
  rawContent: string,
  expectedItems: BatchItem[]
): Map<string, string> {
  const resultMap = new Map<string, string>();
  if (!rawContent || !rawContent.trim()) return resultMap;

  const tryParseJson = (text: string): any => {
    if (!text || !text.trim()) return null;
    try {
      return JSON.parse(text);
    } catch {
      try {
        return JSON.parse(jsonrepair(text));
      } catch {
        return null;
      }
    }
  };

  // 1. Trích xuất nội dung code block markdown nếu có
  const fenceMatches = Array.from(rawContent.matchAll(/```(?:json)?\s*([\s\S]*?)\s*```/gi));
  let itemsList: any[] = [];
  let parsed: any = null;

  if (fenceMatches.length > 1) {
    // Có nhiều block markdown: thử parse từng block và gom các items lại
    for (const fm of fenceMatches) {
      const blkParsed = tryParseJson(fm[1].trim());
      if (Array.isArray(blkParsed)) {
        itemsList.push(...blkParsed);
      } else if (blkParsed && typeof blkParsed === 'object') {
        const found = blkParsed.items || blkParsed.translations || blkParsed.result;
        if (Array.isArray(found)) itemsList.push(...found);
        else {
          for (const [k, v] of Object.entries(blkParsed)) {
            const exp = expectedItems.find((e) => e.i === k || e.i.toLowerCase() === k.toLowerCase());
            if (exp && typeof v === 'string' && v.trim()) resultMap.set(exp.i, v.trim());
          }
        }
      }
    }
  }

  if (itemsList.length === 0 && resultMap.size === 0) {
    let cleaned = fenceMatches.length === 1 ? fenceMatches[0][1].trim() : rawContent.trim();
    parsed = tryParseJson(cleaned);

    // Nếu parse trực tiếp chưa thành công (ví dụ do có văn bản bao quanh chứa dấu ngoặc vuông/nhọn):
    // Quét tìm tất cả các vị trí mở ngoặc '[' hoặc '{' và thử trích xuất khối JSON hợp lệ
    if (!parsed || (typeof parsed !== 'object' && !Array.isArray(parsed))) {
      const candidateStarts: number[] = [];
      for (let i = 0; i < cleaned.length; i++) {
        if (cleaned[i] === '[' || cleaned[i] === '{') {
          candidateStarts.push(i);
        }
      }

      for (const startIdx of candidateStarts) {
        const isArr = cleaned[startIdx] === '[';
        const endChar = isArr ? ']' : '}';
        const endIdx = cleaned.lastIndexOf(endChar);
        if (endIdx > startIdx) {
          const candidate = cleaned.slice(startIdx, endIdx + 1);
          parsed = tryParseJson(candidate);
          if (parsed && typeof parsed === 'object') break;
        }
      }
    }
  }

  // 2. Tìm danh sách item trong kết quả
  if (itemsList.length === 0 && parsed) {
    if (Array.isArray(parsed)) {
      itemsList = parsed;
    } else if (typeof parsed === 'object' && parsed !== null) {
    const arrayKeys = [
      'items',
      'translations',
      'result',
      'results',
      'data',
      'subtitles',
      'lines',
      'output',
      'response',
      'dialogue',
      'content',
    ];
    for (const key of arrayKeys) {
      if (Array.isArray(parsed[key]) && parsed[key].length > 0) {
        itemsList = parsed[key];
        break;
      }
    }
    // Nếu chưa thấy, tìm mảng con bất kỳ có phần tử
    if (itemsList.length === 0) {
      for (const val of Object.values(parsed)) {
        if (Array.isArray(val) && val.length > 0) {
          itemsList = val;
          break;
        }
      }
    }

    // Nếu không có mảng con, kiểm tra xem parsed có phải là dictionary mapping id -> text không
    if (itemsList.length === 0) {
      const keys = Object.keys(parsed);
      const isDictNumeric = keys.length === expectedItems.length && keys.every((k) => /^\d+$/.test(k.trim()));
      if (isDictNumeric) {
        const nums = keys.map((k) => parseInt(k.trim(), 10));
        const dictZero = nums.includes(0) && nums.every((n) => n >= 0 && n < expectedItems.length);
        const dictOne = !nums.includes(0) && nums.every((n) => n >= 1 && n <= expectedItems.length);
        if (dictZero || dictOne) {
          for (const [key, val] of Object.entries(parsed)) {
            const num = parseInt(key.trim(), 10);
            const targetExp = dictZero ? expectedItems[num] : expectedItems[num - 1];
            if (targetExp) {
              const textVal =
                typeof val === 'string'
                  ? val
                  : (val as any)?.text ?? (val as any)?.target ?? (val as any)?.translation ?? '';
              if (typeof textVal === 'string' && textVal.trim()) {
                resultMap.set(targetExp.i, textVal.trim());
              }
            }
          }
          if (resultMap.size > 0) return resultMap;
        }
      }

      const matchesAnyExpected = keys.some((k) =>
        expectedItems.some(
          (exp) =>
            exp.i === k ||
            exp.i.endsWith(`-${k}`) ||
            exp.i.replace(/\D/g, '') === k.replace(/\D/g, '') ||
            k === String(expectedItems.indexOf(exp))
        )
      );

      if (matchesAnyExpected) {
        for (const [key, val] of Object.entries(parsed)) {
          const textVal =
            typeof val === 'string'
              ? val
              : (val as any)?.text ?? (val as any)?.target ?? (val as any)?.translation ?? '';
          if (typeof textVal === 'string' && textVal.trim()) {
            const matchedExp = expectedItems.find(
              (exp, idx) =>
                exp.i === key ||
                exp.i.toLowerCase() === key.toLowerCase() ||
                exp.i.replace(/\D/g, '') === key.replace(/\D/g, '') ||
                String(idx) === key
            );
            if (matchedExp) {
              resultMap.set(matchedExp.i, textVal.trim());
            }
          }
        }
        return resultMap;
      }
    }
  }
  }

  // 3. Phân tích từng phần tử trong itemsList (nếu có)
  if (itemsList.length > 0) {
    const allNumericIds: number[] = [];
  for (const it of itemsList) {
    if (typeof it === 'object' && it !== null) {
      const raw = it.i ?? it.id ?? it.index ?? it.line;
      if (typeof raw === 'number') {
        allNumericIds.push(raw);
      } else if (typeof raw === 'string' && /^\d+$/.test(raw.trim())) {
        allNumericIds.push(parseInt(raw.trim(), 10));
      }
    }
  }
  const isOneBased =
    allNumericIds.length === expectedItems.length &&
    !allNumericIds.includes(0) &&
    allNumericIds.includes(expectedItems.length) &&
    allNumericIds.every((n) => n >= 1 && n <= expectedItems.length);

  const isZeroBased =
    allNumericIds.length === expectedItems.length &&
    allNumericIds.includes(0) &&
    allNumericIds.every((n) => n >= 0 && n < expectedItems.length);

  // 3. Phân tích từng phần tử trong itemsList
  for (let idx = 0; idx < itemsList.length; idx++) {
    const item = itemsList[idx];
    if (item === null || item === undefined) continue;

    let text = '';
    let rawId: any = undefined;

    if (typeof item === 'string') {
      text = item.trim();
      if (itemsList.length === expectedItems.length && idx < expectedItems.length) {
        rawId = expectedItems[idx].i;
      }
    } else if (typeof item === 'object') {
      const entries = Object.entries(item);
      const idEntry = entries.find(([k]) =>
        /^(i|id|index|idx|key|line|lineid|line_id|linenumber)$/i.test(k.trim())
      );
      if (idEntry) {
        rawId = idEntry[1];
      }

      const textEntry = entries.find(([k]) =>
        /^(text|target|translation|translated|translatedtext|translated_text|content|subtitle|sub|val|value|result|output)$/i.test(
          k.trim()
        )
      );
      if (textEntry && textEntry[1] !== undefined && textEntry[1] !== null) {
        text = String(textEntry[1]);
      } else if (entries.length === 2 && idEntry) {
        // Nếu đối tượng chỉ có 2 trường (1 trường ID và 1 trường ngôn ngữ/bản dịch), trường còn lại chính là bản dịch
        const otherEntry = entries.find(([k]) => k !== idEntry[0]);
        if (otherEntry && otherEntry[1] !== undefined && otherEntry[1] !== null) {
          text = String(otherEntry[1]);
        }
      } else if (entries.length === 1 && typeof entries[0][1] === 'string') {
        text = entries[0][1];
        if (rawId === undefined) {
          rawId = entries[0][0]; // Khóa duy nhất của object chính là ID dòng!
        }
      } else {
        text =
          item.text ??
          item.target ??
          item.translation ??
          item.translated ??
          item.translatedText ??
          item.translated_text ??
          item.content ??
          item.subtitle ??
          item.sub ??
          item.val ??
          item.value ??
          '';
      }
      if (typeof text !== 'string') text = String(text || '');

      if (rawId === undefined) {
        rawId =
          item.i ??
          item.id ??
          item.ID ??
          item.index ??
          item.idx ??
          item.key ??
          item.line ??
          item.lineId ??
          item.line_id;
      }
    }

    if (!text.trim()) continue;

    let matchedId: string | undefined;

    // 3a. Nếu phát hiện 1-based hoặc 0-based indexing và rawId là số
    if (isOneBased && rawId !== undefined && rawId !== null) {
      const num = typeof rawId === 'number' ? rawId : parseInt(String(rawId).trim(), 10);
      if (!isNaN(num) && num >= 1 && num <= expectedItems.length) {
        matchedId = expectedItems[num - 1].i;
      }
    } else if (isZeroBased && rawId !== undefined && rawId !== null) {
      const num = typeof rawId === 'number' ? rawId : parseInt(String(rawId).trim(), 10);
      if (!isNaN(num) && num >= 0 && num < expectedItems.length) {
        matchedId = expectedItems[num].i;
      }
    }

    if (!matchedId && rawId !== undefined && rawId !== null) {
      const rawIdStr = String(rawId).trim();
      // 3b. Khớp chính xác ID
      const exact = expectedItems.find((exp) => exp.i === rawIdStr);
      if (exact) {
        matchedId = exact.i;
      } else {
        // 3c. Khớp sau khi chuẩn hóa chữ thường và dấu gạch
        const normRaw = rawIdStr.toLowerCase().replace(/[^a-z0-9]/g, '');
        const normMatch = expectedItems.find(
          (exp) => exp.i.toLowerCase().replace(/[^a-z0-9]/g, '') === normRaw
        );
        if (normMatch) {
          matchedId = normMatch.i;
        } else {
          // 3d. Khớp theo chỉ số số học nếu có duy nhất 1 dòng khớp
          const digits = rawIdStr.replace(/\D/g, '');
          if (digits) {
            const digitMatches = expectedItems.filter((exp) => exp.i.replace(/\D/g, '') === digits);
            if (digitMatches.length === 1) {
              matchedId = digitMatches[0].i;
            }
          }
        }
      }
    }

    // 3e. Khớp theo vị trí nếu cùng số lượng phần tử
    if (!matchedId && itemsList.length === expectedItems.length && idx < expectedItems.length) {
      if (!resultMap.has(expectedItems[idx].i)) {
        matchedId = expectedItems[idx].i;
      }
    }

    if (matchedId) {
      resultMap.set(matchedId, text.trim());
    }
  }

  // 4. Khớp bổ sung theo vị trí nếu cùng độ dài mà còn sót dòng
  if (itemsList.length === expectedItems.length) {
    for (let i = 0; i < expectedItems.length; i++) {
      if (!resultMap.has(expectedItems[i].i)) {
        const item = itemsList[i];
        let text = '';
        if (typeof item === 'string') text = item.trim();
        else if (typeof item === 'object' && item !== null) {
          text = item.text ?? item.target ?? item.translation ?? '';
        }
        if (typeof text === 'string' && text.trim()) {
          resultMap.set(expectedItems[i].i, text.trim());
        }
      }
    }
  }
  }

  // 5. Fallback: trích xuất dạng văn bản thuần có ID nếu mô hình không trả về JSON hợp lệ
  if (resultMap.size < expectedItems.length) {
    const rawLines = rawContent.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
    for (const rLine of rawLines) {
      if (rLine.startsWith('```') || /^Dưới đây|^Here is/i.test(rLine)) continue;
      const match = rLine.match(/^(?:[-*•]\s*)?(?:\[([a-zA-Z0-9_-]+)\]|([a-zA-Z0-9_-]+))\s*[:=-]\s*(.+)$/);
      if (match) {
        const idKey = (match[1] || match[2]).trim();
        const lineText = match[3].trim();
        if (lineText) {
          const matchedExp = expectedItems.find(
            (exp, idx) =>
              exp.i.toLowerCase() === idKey.toLowerCase() ||
              exp.i.replace(/\D/g, '') === idKey.replace(/\D/g, '') ||
              String(idx) === idKey
          );
          if (matchedExp && !resultMap.has(matchedExp.i)) {
            resultMap.set(matchedExp.i, lineText);
          }
        }
      }
    }

    if (resultMap.size === 0) {
      const numberedMatches: { num: number; text: string }[] = [];
      for (const rLine of rawLines) {
        const numMatch = rLine.match(/^(\d+)[\.\)]\s*(.+)$/);
        if (numMatch) {
          numberedMatches.push({ num: parseInt(numMatch[1], 10), text: numMatch[2].trim() });
        }
      }
      if (numberedMatches.length === expectedItems.length) {
        const hasZero = numberedMatches.some((m) => m.num === 0);
        numberedMatches.forEach((m, idx) => {
          const targetExp = hasZero ? expectedItems[m.num] : expectedItems[m.num - 1] || expectedItems[idx];
          if (targetExp && m.text && !resultMap.has(targetExp.i)) {
            resultMap.set(targetExp.i, m.text);
          }
        });
      }
    }
  }

  return resultMap;
}


export interface TranslateSubtitlesOptions {
  targetLanguage?: string;
  batchSize?: number;
  concurrency?: number;
  onProgress?: (percent: number) => void;
  shouldStop?: () => boolean;
  checkpointSrtPath?: string;
  customClient?: { client: any; model: string };
}

export async function translateSubtitlesWithContext(
  lines: SrtLine[],
  options?: TranslateSubtitlesOptions
): Promise<SrtLine[]> {
  if (!lines || lines.length === 0) {
    return [];
  }

  const targetLanguage = options?.targetLanguage || 'vi';
  const batchSize = options?.batchSize || SettingsStore.get('translateBatchSize') || 15;
  const { client, model } = options?.customClient || createGeminiClient();
  const systemPrompt = buildSystemPrompt(targetLanguage);
  const srtPath = options?.checkpointSrtPath || '';
  const onProgress = options?.onProgress;
  const shouldStop = options?.shouldStop;

  // Tự động nhận diện ngôn ngữ nguồn chủ đạo có phải CJK (Trung, Nhật, Hàn) hay không
  const sampleLines = lines.slice(0, 100);
  const cjkCharsLines = sampleLines.filter((l) =>
    /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]/u.test(l.text)
  ).length;
  const isSourceCjk = cjkCharsLines > 0 && cjkCharsLines / Math.min(lines.length, 100) >= 0.2;

  // Nạp cache từ checkpoint của lần chạy trước (nếu có)
  const cachedRaw = srtPath ? loadCheckpoint(srtPath, targetLanguage, lines.length, { isSourceCjk, targetLanguage }) : new Map<string, string>();
  // Map id -> bản dịch; chỉ dùng khi text gốc KHÔNG đổi (nếu đổi sẽ dịch lại)
  const cachedTarget = new Map<string, string>();
  const checkpointData: Record<string, { source: string; target: string }> = {};
  for (const [id, packed] of cachedRaw) {
    const [source, target] = JSON.parse(packed) as [string, string];
    const line = lines.find((l) => l.id === id);
    if (line && line.text === source) {
      cachedTarget.set(id, target);
      checkpointData[id] = { source, target };
    }
  }
  const totalCached = cachedTarget.size;
  if (totalCached > 0) {
    console.log(
      `[Translate] Tái sử dụng ${totalCached}/${lines.length} dòng đã dịch từ checkpoint (${targetLanguage})`
    );
  }

  const totalBatches = Math.ceil(lines.length / batchSize);
  const concurrencySetting = Number(SettingsStore.get('translateConcurrency')) || 1;
  const concurrency = Math.min(Math.max(Math.round(concurrencySetting) || 1, 1), 8);
  if (concurrency > 1) {
    console.log(`[Translate] Dịch song song ${concurrency} request cùng lúc`);
  }

  /**
   * Dịch 1 batch, có retry và kiểm tra tính toàn vẹn 100%.
   * Ngữ cảnh = 2 dòng cuối của batch trước (nếu có).
   */
  const translateBatch = async (b: number): Promise<SrtLine[]> => {
    const batchLines = lines.slice(b * batchSize, (b + 1) * batchSize);
    const glossary = SettingsStore.get('glossary') || '';

    // Dòng nào đã có trong cache (text gốc trùng khớp) hoặc trùng text với dòng đã dịch thì dùng lại.
    // Dòng nào rỗng/khoảng trắng hoặc chỉ chứa dấu câu/ký hiệu (không có chữ cái hay chữ số) thì ghi nhận luôn để không gửi lên mô hình AI.
    for (const l of batchLines) {
      if (!l.text || !l.text.trim() || !/[\p{L}\p{N}]/u.test(l.text)) {
        cachedTarget.set(l.id, l.text);
        continue;
      }
      if (cachedTarget.has(l.id)) continue;
      for (const [_, entry] of Object.entries(checkpointData)) {
        if (
          entry.source === l.text &&
          entry.target &&
          !isLineUntranslated(l.text, entry.target, glossary, { isSourceCjk, targetLanguage })
        ) {
          cachedTarget.set(l.id, entry.target);
          break;
        }
      }
    }

    const itemsToTranslate: BatchItem[] = batchLines
      .filter((l) => !cachedTarget.has(l.id) && l.text && l.text.trim())
      .map((l) => ({ i: l.id, text: l.text }));

    let resultMap = new Map<string, string>();

    if (itemsToTranslate.length > 0) {
      let previousContext: { original: string; translated: string }[] = [];
      if (b > 0) {
        const validContextItems: { original: string; translated: string }[] = [];
        // Lấy 2-3 câu thoại đã dịch hợp lệ gần nhất ngay trước batch này (sliding window context)
        for (let idx = b * batchSize - 1; idx >= 0 && validContextItems.length < 3; idx--) {
          const orig = lines[idx];
          const bIdx = Math.floor(idx / batchSize);
          const lIdx = idx % batchSize;
          const transCandidate =
            batchResults[bIdx]?.[lIdx]?.text ||
            cachedTarget.get(orig.id);

          if (
            transCandidate &&
            transCandidate.trim() &&
            !isLineUntranslated(orig.text, transCandidate, glossary, { isSourceCjk, targetLanguage }) &&
            transCandidate.trim().toLowerCase() !== orig.text.trim().toLowerCase()
          ) {
            validContextItems.unshift({
              original: orig.text,
              translated: transCandidate,
            });
          }
        }
        previousContext = validContextItems;
      }

      // Nếu không có ngữ cảnh (như batch 0 đầu file hoặc batch trước đang pending khi chạy song song),
      // không gửi field context rỗng để tránh làm model bối rối
      const baseUserPayload =
        previousContext.length > 0
          ? { context: previousContext, items: itemsToTranslate }
          : { items: itemsToTranslate };

      let attempts = 0;
      let success = false;
      let lastError: any = null;
      const isGemini3 = /gemini-3|gemini-flash-latest/i.test(model);
      const confirmedTranslations = new Map<string, string>();

      while (attempts < 3 && !success) {
        try {
          attempts++;

          // Xác định danh sách dòng còn thiếu hoặc chưa dịch
          const itemsToRetry = itemsToTranslate.filter((item) => !confirmedTranslations.has(item.i));

          // Lần thử đầu dùng system prompt chuẩn; các lần retry sau dùng prompt dự phòng leo thang chặt chẽ
          const activeSystemPrompt =
            attempts === 1
              ? systemPrompt
              : buildRetrySystemPrompt(targetLanguage, itemsToRetry.length);

          const activePayload =
            attempts === 1
              ? baseUserPayload
              : { items: itemsToRetry };

          const completionParams: any = {
            model,
            messages: [
              { role: 'system', content: activeSystemPrompt },
              { role: 'user', content: JSON.stringify(activePayload) },
            ],
          };

          // R3: Thiết lập tham số suy luận Gemini 3.x
          if (isGemini3) {
            completionParams.reasoning_effort = 'low';
            completionParams.temperature = 1.0;
          } else {
            completionParams.temperature = attempts === 1 ? 0.3 : 0.1;
          }

          const response = await client.chat.completions.create(completionParams);

          const rawContent = response.choices[0]?.message?.content?.trim() || '';
          if (!rawContent) {
            throw new Error('Mô hình trả về phản hồi rỗng.');
          }

          // Trích xuất các dòng trả về (khớp linh hoạt cả với itemsToRetry lẫn itemsToTranslate)
          const extractedMap = extractAndNormalizeTranslationBatch(
            rawContent,
            attempts === 1 ? itemsToTranslate : (itemsToRetry.length > 0 ? itemsToRetry : itemsToTranslate)
          );

          // Nếu model trả về cả các ID khác trong batch, thử trích xuất thêm với itemsToTranslate
          if (attempts > 1 && extractedMap.size < itemsToTranslate.length) {
            const fullExtracted = extractAndNormalizeTranslationBatch(rawContent, itemsToTranslate);
            for (const [id, trans] of fullExtracted) {
              if (!extractedMap.has(id)) extractedMap.set(id, trans);
            }
          }

          // Đồng bộ bản dịch cho các dòng có text trùng lặp với dòng đã dịch trong batch trước khi kiểm tra toàn vẹn
          for (const item of itemsToTranslate) {
            const currentTrans = extractedMap.get(item.i) ?? confirmedTranslations.get(item.i);
            if (!currentTrans || isLineUntranslated(item.text, currentTrans, glossary, { isSourceCjk, targetLanguage })) {
              const match = itemsToTranslate.find((other) => {
                if (other.text !== item.text) return false;
                const trans = extractedMap.get(other.i) ?? confirmedTranslations.get(other.i);
                return !!trans && !isLineUntranslated(other.text, trans, glossary, { isSourceCjk, targetLanguage });
              });
              if (match) {
                const trans = extractedMap.get(match.i) ?? confirmedTranslations.get(match.i);
                if (trans) extractedMap.set(item.i, trans);
              }
            }
          }

          // R1: Kiểm tra tính toàn vẹn (Untranslated Line Detection)
          // Bất kỳ dòng nào mà target === source (không thuộc diện miễn trừ) thì bị coi là chưa dịch
          for (const item of itemsToTranslate) {
            const trans = extractedMap.get(item.i);
            if (trans && typeof trans === 'string' && trans.trim()) {
              if (!isLineUntranslated(item.text, trans, glossary, { isSourceCjk, targetLanguage })) {
                confirmedTranslations.set(item.i, trans.trim());
              }
            } else if (!trans) {
              const alphaOnly = item.text.replace(/[^\p{L}\p{N}]/gu, '');
              const isNonCjkGarbage = !isSourceCjk && (alphaOnly.length <= 1 || isOcrGarbageLine({ id: item.i, startMs: 0, endMs: 1000, text: item.text }, { minDurationMs: 0 }));
              if (isNonCjkGarbage && !isLineUntranslated(item.text, item.text, glossary, { isSourceCjk, targetLanguage })) {
                confirmedTranslations.set(item.i, item.text.trim());
              }
            }
          }

          // Cứu vớt ở lần thử thứ 3 (attempts >= 3):
          // Nếu model đã trả về văn bản cho dòng đó (không phải bỏ sót ID hay chuỗi rỗng),
          // nhưng bị coi là chưa dịch (giữ nguyên gốc, ví dụ tên riêng/thuật ngữ/watermark),
          // thì sau 3 lần retry ta chấp nhận để bảo toàn tiến trình dịch không bị dừng ngang.
          if (attempts >= 3) {
            for (const item of itemsToTranslate) {
              if (!confirmedTranslations.has(item.i)) {
                const rawTrans = extractedMap.get(item.i);
                if (rawTrans && typeof rawTrans === 'string' && rawTrans.trim()) {
                  const srtIdx = lines.findIndex((l) => l.id === item.i);
                  const srtNum = srtIdx >= 0 ? `#${srtIdx + 1}` : item.i;
                  console.warn(
                    `[Translate] [Cảnh báo] Chấp nhận giữ nguyên câu gốc cho dòng SRT ${srtNum} [${item.i}] ("${item.text}") sau ${attempts} lần thử (có thể là tên riêng, thương hiệu hoặc watermark).`
                  );
                  confirmedTranslations.set(item.i, rawTrans.trim());
                }
              }
            }
          }

          // Kiểm tra xem còn dòng nào trong itemsToTranslate chưa có bản dịch hợp lệ không
          let unfulfilledItems = itemsToTranslate.filter((item) => !confirmedTranslations.has(item.i));

          // Cơ chế cứu hộ leo thang (Escalated Fallback): Nếu qua các lượt thử mà mô hình vẫn bỏ sót dòng,
          // tiến hành dịch đơn lẻ từng dòng còn thiếu với ngữ cảnh cục bộ để đảm bảo 0% drop rate.
          if (unfulfilledItems.length > 0 && attempts >= 3) {
            console.warn(
              `[Translate] Kích hoạt cơ chế cứu hộ đơn lẻ (single-line fallback) cho ${unfulfilledItems.length} dòng bị bỏ sót...`
            );
            for (const item of unfulfilledItems) {
              try {
                const srtIdx = lines.findIndex((l) => l.id === item.i);
                const prevLine = srtIdx > 0 ? (confirmedTranslations.get(lines[srtIdx - 1]?.id) || lines[srtIdx - 1]?.text) : undefined;
                const nextLine = srtIdx < lines.length - 1 ? lines[srtIdx + 1]?.text : undefined;
                const singleRes = await translateSubtitleLine({
                  text: item.text,
                  targetLanguage,
                  prev: prevLine,
                  next: nextLine,
                  customClient: { client, model },
                });
                const trimmedSingle = singleRes?.trim() || '';
                const hasSourceLetters = /\p{L}/u.test(item.text);
                const hasTargetLetters = /\p{L}/u.test(trimmedSingle);
                const isDummyJson = /^\[\s*\]$|^\{\s*\}$/.test(trimmedSingle);

                if (
                  trimmedSingle &&
                  !isDummyJson &&
                  (!hasSourceLetters || hasTargetLetters)
                ) {
                  confirmedTranslations.set(item.i, trimmedSingle);
                }
              } catch {
                // Tiếp tục thử các dòng khác
              }
            }
            unfulfilledItems = itemsToTranslate.filter((item) => !confirmedTranslations.has(item.i));
            if (unfulfilledItems.length > 0 && attempts >= 3) {
              for (const item of unfulfilledItems) {
                const srtIdx = lines.findIndex((l) => l.id === item.i);
                const srtNum = srtIdx >= 0 ? `#${srtIdx + 1}` : item.i;
                console.warn(
                  `[Translate] [Cảnh báo] Bảo toàn câu gốc cho dòng SRT ${srtNum} [${item.i}] ("${item.text}") sau khi cứu hộ đơn lẻ.`
                );
                confirmedTranslations.set(item.i, item.text.trim());
              }
              unfulfilledItems = [];
            }
          }

          if (unfulfilledItems.length > 0) {
            const details = unfulfilledItems.map((item) => {
              const rawTrans = extractedMap.get(item.i);
              let reason = 'mô hình bỏ sót trong phản hồi (không có ID dòng)';
              if (rawTrans !== undefined) {
                if (!rawTrans.trim()) reason = 'mô hình trả về chuỗi rỗng';
                else if (isLineUntranslated(item.text, rawTrans, glossary, { isSourceCjk, targetLanguage })) {
                  reason = `mô hình giữ nguyên câu gốc chưa dịch ("${rawTrans.trim()}")`;
                }
              }
              const srtIdx = lines.findIndex((l) => l.id === item.i);
              const srtNum = srtIdx >= 0 ? `#${srtIdx + 1}` : item.i;
              return `SRT ${srtNum} [${item.i}] "${item.text}": ${reason}`;
            });

            const detailMsg = details.map((d) => `  • ${d}`).join('\n');
            throw new Error(
              `Batch phản hồi thiếu hoặc chưa dịch ${unfulfilledItems.length}/${itemsToTranslate.length} dòng (${unfulfilledItems.map((m) => m.i).join(', ')}):\n${detailMsg}`
            );
          }

          resultMap = confirmedTranslations;
          success = true;
        } catch (err: any) {
          lastError = err;
          // Rate limit (429) cần backoff dài hơn lỗi thường
          const isRateLimit = err?.status === 429 || err?.response?.status === 429;
          if (attempts < 3) {
            const delay = isRateLimit ? attempts * 8000 : attempts * 1500;
            console.warn(
              `[Translate] Batch ${b + 1} lỗi hoặc thiếu dòng (lần ${attempts}/3):\n${err?.message || err}\n  — Tự động retry với prompt dự phòng sau ${delay}ms...`
            );
            await new Promise((res) => setTimeout(res, delay));
          }
        }
      }

      if (!success) {
        // Checkpoint vẫn còn trên đĩa — lần chạy lại sẽ tiếp tục từ đây
        throw new Error(
          `Dịch thất bại ở batch ${b + 1}/${totalBatches}: ${friendlyGeminiError(lastError)}. ` +
            `Hệ thống không tự ý trả về câu gốc chưa dịch để đảm bảo tính toàn vẹn bản dịch. ` +
            `Các batch đã dịch được lưu tạm trong checkpoint — chạy lại sẽ tiếp tục từ chỗ dừng.\n` +
            `Gợi ý: Nếu câu bị kẹt là tên riêng, thương hiệu hoặc watermark, bạn có thể thêm vào Bảng thuật ngữ (Glossary) trong Cài đặt (ví dụ: "Từ_gốc = Từ_gốc") hoặc chỉnh sửa/xóa dòng đó trong file phụ đề.`
        );
      }
    }

    // Nếu một dòng trong batch có cùng text nguồn với dòng vừa được dịch, đồng bộ bản dịch
    for (const line of batchLines) {
      if (!resultMap.has(line.id) && !cachedTarget.has(line.id)) {
        const match = batchLines.find(
          (other) =>
            other.text === line.text && (resultMap.has(other.id) || cachedTarget.has(other.id))
        );
        if (match) {
          const trans = resultMap.get(match.id) ?? cachedTarget.get(match.id);
          if (trans && !isLineUntranslated(line.text, trans, glossary, { isSourceCjk, targetLanguage })) resultMap.set(line.id, trans);
        }
      }
    }

    // Lưu vào cache + ghi checkpoint NGAY sau mỗi batch (chỉ các dòng mới dịch)
    for (const line of batchLines) {
      const target = resultMap.get(line.id) ?? cachedTarget.get(line.id);
      if (target !== undefined && target.trim()) {
        checkpointData[line.id] = { source: line.text, target };
        cachedTarget.set(line.id, target);
      }
    }
    if (srtPath) {
      saveCheckpoint(srtPath, targetLanguage, checkpointData, lines.length);
    }

    return batchLines.map((line) => {
      const transText = resultMap.get(line.id) ?? cachedTarget.get(line.id);
      if (line.text.trim() && (!transText || !transText.trim())) {
        throw new Error(
          `Dòng phụ đề ${line.id} ("${line.text}") không có bản dịch hợp lệ sau khi gọi mô hình.`
        );
      }
      return { ...line, text: transText ?? line.text };
    });
  };

  // Pool worker: mỗi worker rót lần lượt các batch — số worker = concurrency
  // (setting "Số request dịch song song"). Batch đầu lỗi thì ngừng nhận batch
  // mới, các batch đang chạy chạy nốt (checkpoint vẫn giữ phần đã dịch) rồi
  // mới báo lỗi/huỷ.
  const batchResults: (SrtLine[] | undefined)[] = new Array(totalBatches);
  let nextBatchIndex = 0;
  let completedBatches = 0;
  let failure: unknown = null;
  let cancelled = false;

  const worker = async (): Promise<void> => {
    while (!failure && !cancelled) {
      if (shouldStop?.()) {
        cancelled = true;
        return;
      }
      const b = nextBatchIndex++;
      if (b >= totalBatches) return;
      try {
        batchResults[b] = await translateBatch(b);
        completedBatches++;
        onProgress?.(Math.round((completedBatches / totalBatches) * 100));
      } catch (err) {
        if (!failure) failure = err;
      }
    }
  };

  await Promise.all(Array.from({ length: Math.min(concurrency, totalBatches) }, () => worker()));

  if (failure) throw failure;
  if (cancelled) throw new CancelledError();

  const translatedLines: SrtLine[] = batchResults.filter(
    (r): r is SrtLine[] => Array.isArray(r),
  ).flat();

  if (translatedLines.length !== lines.length) {
    throw new Error(
      `Lỗi toàn vẹn: Số lượng dòng dịch (${translatedLines.length}) không khớp với file phụ đề gốc (${lines.length}).`
    );
  }

  // Bảo toàn 100% số lượng dòng, startMs, endMs, speaker từ file phụ đề gốc (1-1 translation mapping).
  // Đối với các câu dài vượt quá 37 ký tự: dùng breakVietnameseLines để định dạng ngắt dòng
  // hiển thị (\n) thuần tuý trong cùng một SrtLine, tuyệt đối KHÔNG xé nhỏ thành nhiều dòng,
  // KHÔNG tính toán lại timestamp và KHÔNG chèn khoảng hở nhân tạo!
  const isVietnamese = !targetLanguage || targetLanguage === 'vi' || targetLanguage.toLowerCase().startsWith('vi');
  return applyVisualLineWrapping(translatedLines, isVietnamese);
}

export async function translateSrtFile(
  srtPath: string,
  targetLanguage: string = 'vi',
  onProgress?: (percent: number) => void,
  shouldStop?: () => boolean
): Promise<{ translatedSrtPath: string }> {
  if (!fs.existsSync(srtPath)) {
    throw new Error(`File SRT không tồn tại: ${srtPath}`);
  }

  const srtContent = fs.readFileSync(srtPath, 'utf-8');
  const lines = parseSrtStrict(srtContent);
  if (lines.length === 0) {
    throw new Error('File SRT rỗng hoặc không có dòng phụ đề hợp lệ.');
  }

  const finalLines = await translateSubtitlesWithContext(lines, {
    targetLanguage,
    onProgress,
    shouldStop,
    checkpointSrtPath: srtPath,
  });

  const srtDir = path.dirname(srtPath);
  const srtBasename = path.basename(srtPath, '.srt');
  const translatedSrtPath = nextAvailablePath(path.join(srtDir, `${srtBasename}.translated.srt`));

  fs.writeFileSync(translatedSrtPath, serializeSrt(finalLines), 'utf-8');

  // Carry extraction evidence through the one-to-one translation only after
  // verifying each source interval and text. SRT has no metadata channel.
  const evidencePath = srtPath.replace(/\.srt$/i, '.timeline.json');
  if (fs.existsSync(evidencePath) && finalLines.length === lines.length) {
    try {
      const evidence = JSON.parse(fs.readFileSync(evidencePath, 'utf-8'));
      const available = Array.isArray(evidence.segments) ? [...evidence.segments] : [];
      const translatedSegments = finalLines.map((translated, index) => {
        const original = lines[index];
        if (translated.startMs !== original.startMs || translated.endMs !== original.endMs) {
          throw new Error(`Translation changed timestamps at line ${index + 1}`);
        }
        let match = available.findIndex((segment: SrtLine) =>
          segment.startMs === original.startMs && segment.endMs === original.endMs &&
          segment.text.trim() === original.text.trim());
        if (match < 0) {
          match = available.findIndex((segment: SrtLine) =>
            segment.startMs === original.startMs && segment.text.trim() === original.text.trim());
        }
        if (match < 0 && available[index] && available[index].text.trim() === original.text.trim()) {
          match = index;
        }
        let source: SrtLine;
        if (match >= 0) {
          [source] = available.splice(match, 1);
        } else {
          source = {
            id: original.id || `line-${index}`,
            startMs: original.startMs,
            endMs: original.endMs,
            text: original.text,
          };
        }
        return { ...source, startMs: original.startMs, endMs: original.endMs, text: translated.text, originalText: original.text, translationOf: source.id };
      });
      fs.writeFileSync(translatedSrtPath.replace(/\.srt$/i, '.timeline.json'),
        JSON.stringify({ ...evidence, segments: translatedSegments }, null, 2), 'utf-8');
    } catch (err) {
      console.warn('[Translate] Timeline evidence could not be propagated:', err);
    }
  }

  // Dịch hoàn tất — xoá checkpoint (bản dịch đã nằm trong .translated.srt)
  const checkpointFile = getCheckpointPath(srtPath);
  if (fs.existsSync(checkpointFile)) fs.unlinkSync(checkpointFile);

  return { translatedSrtPath };
}
