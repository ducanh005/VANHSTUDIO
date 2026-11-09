import https from 'https';
import OpenAI from 'openai';
import { jsonrepair } from 'jsonrepair';
import { SettingsStore } from '../store/settingsStore';
import { isLineUntranslated } from '../lib/subtitleSanitizer';

// Gemini tương thích endpoint OpenAI — dùng lại SDK openai theo quyết định kỹ thuật đã chốt.
const GEMINI_OPENAI_BASE_URL = 'https://generativelanguage.googleapis.com/v1beta/openai/';

/**
 * Danh sách model dự phòng tốc độ cao khi model chính bị quá tải (503),
 * timeout, hết quota (429) hoặc không khả dụng (404).
 */
export const GEMINI_FALLBACK_MODELS = [
  'gemini-3.5-flash-lite',
  'gemini-3.6-flash',
  'gemini-3.1-flash-lite',
  'gemini-3.5-flash',
  'gemini-3.8-flash',
] as const;

let cachedWorkingFallback: { requestedModel: string; workingModel: string; expiresAt: number } | null = null;

/**
 * Chuẩn hoá tên model: tự động nâng cấp các model thế hệ cũ (1.5 / 2.0 / 2.5 đã ngừng hỗ trợ)
 * sang model khả dụng hiện tại.
 */
export function resolveEffectiveGeminiModel(rawModel?: string): string {
  const trimmed = (rawModel || '').trim();
  if (!trimmed) return 'gemini-3.8-flash';
  if (/^gemini-(1\.5|2\.0|2\.5)-/i.test(trimmed)) {
    return 'gemini-3.5-flash-lite';
  }
  return trimmed;
}

function isRetryableOrFallbackGeminiError(err: any): boolean {
  const status = err?.status ?? err?.response?.status;
  if (status === 401 || status === 403) return false;
  if (status === 404 || status === 429 || status === 500 || status === 502 || status === 503 || status === 504) {
    return true;
  }
  const msg = String(err?.message || '');
  if (status === 400 && /model|thinking level|not supported|not available|no longer available/i.test(msg)) {
    return true;
  }
  if (
    err?.code === 'ETIMEDOUT' ||
    err?.code === 'ECONNRESET' ||
    err?.code === 'ECONNABORTED' ||
    err?.name === 'TimeoutError' ||
    err?.name === 'APIConnectionTimeoutError' ||
    err?.name === 'APIConnectionError' ||
    /timed?\s*out|timeout|high demand|unavailable|overloaded|socket hang up/i.test(msg)
  ) {
    return true;
  }
  return false;
}

/**
 * Custom fetch dùng https.request (IPv4, Connection: close) cho Gemini API
 * nhằm tránh lỗi treo keep-alive socket / IPv6 happy-eyeballs của undici trong Electron trên Windows.
 */
const geminiIpv4Fetch: typeof fetch = async (input: any, init?: any): Promise<Response> => {
  const urlStr = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
  const u = new URL(urlStr);
  const method = init?.method || 'POST';
  const rawHeaders: Record<string, string> = {};

  if (init?.headers) {
    if (typeof init.headers.forEach === 'function') {
      init.headers.forEach((v: string, k: string) => {
        rawHeaders[k] = v;
      });
    } else if (Array.isArray(init.headers)) {
      for (const [k, v] of init.headers) rawHeaders[k] = String(v);
    } else if (typeof init.headers === 'object') {
      for (const [k, v] of Object.entries(init.headers)) {
        if (v !== undefined && v !== null) rawHeaders[k] = String(v);
      }
    }
  }

  const bodyStr =
    init?.body === undefined || init?.body === null
      ? ''
      : typeof init.body === 'string'
        ? init.body
        : Buffer.isBuffer(init.body)
          ? init.body.toString('utf8')
          : String(init.body);
  const bodyBuf = Buffer.from(bodyStr, 'utf8');

  rawHeaders['Connection'] = 'close';
  if (bodyBuf.length > 0) {
    rawHeaders['Content-Length'] = String(bodyBuf.length);
  }

  return new Promise<Response>((resolve, reject) => {
    const signal: AbortSignal | undefined = init?.signal;
    if (signal?.aborted) {
      const abortErr = new Error('Request timed out.');
      abortErr.name = 'AbortError';
      return reject(abortErr);
    }

    const req = https.request(
      {
        hostname: u.hostname,
        port: u.port ? Number(u.port) : 443,
        path: u.pathname + u.search,
        method,
        family: 4,
        agent: false,
        headers: rawHeaders,
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on('data', (chunk) => chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)));
        res.on('end', () => {
          cleanup();
          const resBody = Buffer.concat(chunks);
          const resHeaders = new Headers();
          for (const [k, v] of Object.entries(res.headers)) {
            if (Array.isArray(v)) {
              for (const item of v) resHeaders.append(k, item);
            } else if (typeof v === 'string') {
              resHeaders.set(k, v);
            }
          }
          resolve(
            new Response(resBody, {
              status: res.statusCode || 200,
              statusText: res.statusMessage || '',
              headers: resHeaders,
            })
          );
        });
        res.on('error', (err) => {
          cleanup();
          reject(err);
        });
      }
    );

    const onAbort = () => {
      const abortErr = new Error('Request timed out.');
      abortErr.name = 'AbortError';
      req.destroy(abortErr);
      reject(abortErr);
    };

    const cleanup = () => {
      if (signal) {
        signal.removeEventListener('abort', onAbort);
      }
    };

    if (signal) {
      signal.addEventListener('abort', onAbort, { once: true });
    }

    req.on('error', (err) => {
      cleanup();
      reject(err);
    });

    if (bodyBuf.length > 0) {
      req.write(bodyBuf);
    }
    req.end();
  });
};

export function friendlyGeminiError(err: any): string {
  const status = err?.status ?? err?.response?.status;
  if (status === 401 || status === 403) {
    return 'Gemini API key không hợp lệ hoặc không có quyền — kiểm tra lại key đã nhập.';
  }
  if (status === 429) {
    return 'Vượt giới hạn tốc độ của Gemini (rate limit). Đợi vài giây rồi thử lại.';
  }
  if (status === 503) {
    return 'Máy chủ Gemini đang quá tải tạm thời (503 High Demand). Hãy thử lại hoặc chọn model Gemini 3.5 Flash Lite.';
  }
  if (status === 404) {
    return `Model "${SettingsStore.get('geminiModel')}" không khả dụng với key này.`;
  }
  if (
    err?.code === 'ETIMEDOUT' ||
    err?.name === 'TimeoutError' ||
    err?.name === 'APIConnectionTimeoutError' ||
    err?.code === 'ECONNABORTED' ||
    /timed?\s*out/i.test(String(err?.message || ''))
  ) {
    return 'Gemini phản hồi quá chậm (timeout) — kiểm tra kết nối mạng rồi thử lại.';
  }
  return `Lỗi gọi Gemini: ${err?.message || 'không xác định'}`;
}

/** Tạo client OpenAI trỏ tới Gemini kèm cơ chế tự động dự phòng model khi quá tải/timeout. */
export function createGeminiClient(): { client: OpenAI; model: string } {
  const apiKey = SettingsStore.get('geminiApiKey').trim();
  if (!apiKey) {
    throw new Error(
      'Chưa cấu hình Gemini API key. Vào Cài đặt (hoặc bấm nút "Gemini API" ở màn hình hiệu đính) để nhập key — lấy miễn phí tại aistudio.google.com.'
    );
  }
  const rawModel = SettingsStore.get('geminiModel') || 'gemini-3.8-flash';
  const model = resolveEffectiveGeminiModel(rawModel);
  const client = new OpenAI({
    apiKey,
    baseURL: GEMINI_OPENAI_BASE_URL,
    timeout: 30_000,
    maxRetries: 0, // retry tự quản lý ở từng module kèm fallback model
    fetch: geminiIpv4Fetch,
  });

  const completions = client.chat.completions as any;
  completions.create = async (params: any, options?: any) => {
    const protoCreate = Object.getPrototypeOf(completions).create;
    const requestedModel = resolveEffectiveGeminiModel(params?.model || model);

    const now = Date.now();
    const preferredStartModel =
      cachedWorkingFallback &&
      cachedWorkingFallback.requestedModel === requestedModel &&
      cachedWorkingFallback.expiresAt > now
        ? cachedWorkingFallback.workingModel
        : requestedModel;

    const candidates: string[] = [preferredStartModel];
    for (const fb of GEMINI_FALLBACK_MODELS) {
      if (!candidates.includes(fb)) {
        candidates.push(fb);
      }
    }

    let lastErr: any = null;
    for (let i = 0; i < candidates.length; i++) {
      const candidateModel = candidates[i];
      const isGemini3Or4 = /gemini-3|gemini-4|gemini-flash-latest|gemini-pro-latest/i.test(candidateModel);
      const nextParams: any = {
        ...params,
        model: candidateModel,
      };
      if (isGemini3Or4) {
        if (!nextParams.reasoning_effort) nextParams.reasoning_effort = 'low';
        if (nextParams.temperature === undefined) nextParams.temperature = 1.0;
      } else {
        delete nextParams.reasoning_effort;
      }

      // Giới hạn timeout ngắn hơn (12s) cho model đầu nếu còn model dự phòng phía sau
      // để tránh treo lâu khi gemini-3.8-flash bị quá tải 503/timeout.
      const attemptOptions =
        i < candidates.length - 1 && !options?.timeout
          ? { ...options, timeout: 12_000 }
          : options;

      try {
        const res = await protoCreate.call(completions, nextParams, attemptOptions);
        if (candidateModel !== requestedModel) {
          cachedWorkingFallback = {
            requestedModel,
            workingModel: candidateModel,
            expiresAt: Date.now() + 10 * 60 * 1000,
          };
          console.log(
            `[Gemini] Đã tự động chuyển sang model dự phòng ổn định "${candidateModel}" (do "${requestedModel}" đang quá tải/timeout).`
          );
        }
        return res;
      } catch (err: any) {
        lastErr = err;
        if (!isRetryableOrFallbackGeminiError(err) || i === candidates.length - 1) {
          throw err;
        }
        console.warn(
          `[Gemini] Model "${candidateModel}" phản hồi lỗi (${err?.status || err?.message || 'timeout'}) — tự động chuyển sang model dự phòng "${candidates[i + 1]}"...`
        );
      }
    }
    throw lastErr;
  };

  return { client, model };
}

const POLISH_SYSTEM_PROMPT = `Bạn là biên tập viên phụ đề phim chuyên nghiệp.
Nhiệm vụ: hiệu đính câu người dùng cung cấp — sửa lỗi chính tả, ngữ pháp, dấu câu và làm câu tự nhiên hơn theo văn nói, giữ NGUYÊN nghĩa và đủ các ý của bản gốc.
Yêu cầu:
- Luôn giữ NGUYÊN ngôn ngữ của câu gốc: câu nào tiếng Việt thì chỉnh tiếng Việt, câu tiếng Anh thì chỉnh tiếng Anh... tuyệt đối không dịch sang ngôn ngữ khác.
- Không lược bỏ hoặc thêm ý mới.
- Giữ độ dài gần tương đương bản gốc để phụ đề không tràn màn hình.
- Nếu bản gốc đã tốt thì chỉ tinh chỉnh nhẹ.
- Chỉ trả về DUY NHẤT câu đã chỉnh, không giải thích, không bọc ngoặc kép.`;

export interface PolishLinePayload {
  text: string;
  prev?: string;
  next?: string;
}

export async function polishSubtitleLine(payload: PolishLinePayload): Promise<string> {
  const { client, model } = createGeminiClient();

  const contextParts: string[] = [];
  if (payload.prev?.trim()) contextParts.push(`Câu trước đó (chỉ để tham khảo ngữ cảnh): "${payload.prev.trim()}"`);
  if (payload.next?.trim()) contextParts.push(`Câu sau đó (chỉ để tham khảo ngữ cảnh): "${payload.next.trim()}"`);

  try {
    const isGemini3 = /gemini-3|gemini-flash-latest/i.test(model);
    const completionParams: any = {
      model,
      messages: [
        { role: 'system', content: POLISH_SYSTEM_PROMPT },
        {
          role: 'user',
          content: [contextParts.join('\n'), `Câu cần hiệu đính: "${payload.text}"`]
            .filter(Boolean)
            .join('\n'),
        },
      ],
    };
    if (isGemini3) {
      completionParams.reasoning_effort = 'low';
      completionParams.temperature = 1.0;
    } else {
      completionParams.temperature = 0.3;
    }

    const completion = await client.chat.completions.create(completionParams);

    const result = completion.choices[0]?.message?.content?.trim();
    if (!result) throw new Error('Gemini trả về kết quả rỗng, thử lại nhé.');

    // Bỏ ngoặc kép bọc ngoài nếu model có thêm vào
    return result.replace(/^["“']+|["”']+$/g, '').trim();
  } catch (err: any) {
    throw new Error(friendlyGeminiError(err));
  }
}

export interface TranslateLinePayload {
  text: string;
  targetLanguage?: string;
  prev?: string;
  next?: string;
  customClient?: { client: any; model: string };
}

function buildGlossaryPrompt(): string {
  const raw = (SettingsStore.get('glossary') || '').trim();
  if (!raw) return '';
  const lines = raw
    .split('\n')
    .map((l) => l.trim().replace(/^[-•*]\s*/, ''))
    .filter(Boolean);
  if (lines.length === 0) return '';
  return `\nBẢNG THUẬT NGỮ BẮT BUỘC:\n${lines.map((l) => `- ${l}`).join('\n')}`;
}

function buildStyleGuidePrompt(): string {
  const raw = (SettingsStore.get('translationStyleGuide') || '').trim();
  if (!raw) return '';
  return `\nVĂN PHONG & QUY TẮC XƯNG HÔ:\n${raw}`;
}

export async function translateSubtitleLine(payload: TranslateLinePayload): Promise<string> {
  const { client, model } = payload.customClient || createGeminiClient();
  const targetLang = payload.targetLanguage || SettingsStore.get('targetLanguage') || 'vi';

  const contextParts: string[] = [];
  if (payload.prev?.trim()) contextParts.push(`Ngữ cảnh câu trước: "${payload.prev.trim()}"`);
  if (payload.next?.trim()) contextParts.push(`Ngữ cảnh câu sau: "${payload.next.trim()}"`);

  const prompt =
    `Bạn là biên dịch viên phụ đề phim chuyên nghiệp.
Nhiệm vụ: Dịch DUY NHẤT câu sau sang ngôn ngữ: "${targetLang}".
Yêu cầu:
- BẮT BUỘC dịch thực sự sang ngôn ngữ đích "${targetLang}", tuyệt đối không sao chép hoặc giữ nguyên văn bản gốc chưa dịch.
- Giữ nguyên ngữ nghĩa, dịch tự nhiên theo văn nói phụ đề phim, ngắn gọn súc tích, tối đa 2 dòng hiển thị (dưới 70 ký tự).
- Chỉ trả về DUY NHẤT câu đã dịch, không giải thích, không bọc ngoặc kép.` +
    buildGlossaryPrompt() +
    buildStyleGuidePrompt();

  try {
    const isGemini3 = /gemini-3|gemini-flash-latest/i.test(model);
    const completionParams: any = {
      model,
      messages: [
        { role: 'system', content: prompt },
        {
          role: 'user',
          content: [contextParts.join('\n'), `Câu cần dịch: "${payload.text}"`]
            .filter(Boolean)
            .join('\n'),
        },
      ],
    };
    if (isGemini3) {
      completionParams.reasoning_effort = 'low';
      completionParams.temperature = 1.0;
    } else {
      completionParams.temperature = 0.3;
    }

    const completion = await client.chat.completions.create(completionParams);

    const result = completion.choices[0]?.message?.content?.trim();
    if (!result) throw new Error('Gemini trả về kết quả rỗng, thử lại nhé.');

    let cleaned = result.replace(/^["“']+|["”']+$/g, '').trim();

    // R1: Nếu model trả về câu chưa dịch (trùng câu gốc không thuộc diện miễn trừ), thử lại 1 lần với prompt leo thang
    const glossary = SettingsStore.get('glossary') || '';
    if (isLineUntranslated(payload.text, cleaned, glossary)) {
      const retryPrompt =
        `Bạn là hệ thống dịch thuật máy tự động chính xác cao.
CẢNH BÁO: Lần dịch trước đã trả về câu chưa dịch giống hệt câu gốc.
Nhiệm vụ: BẮT BUỘC dịch thực sự câu sau sang ngôn ngữ đích: "${targetLang}".
Yêu cầu:
- TUYỆT ĐỐI KHÔNG lặp lại hoặc sao chép nguyên văn bản gốc ("${payload.text}").
- Trả về DUY NHẤT câu đã dịch sang "${targetLang}", không giải thích, không bọc trong ngoặc kép.` +
        buildGlossaryPrompt() +
        buildStyleGuidePrompt();

      const retryCompletion = await client.chat.completions.create({
        ...completionParams,
        messages: [
          { role: 'system', content: retryPrompt },
          { role: 'user', content: `Câu cần dịch: "${payload.text}"` },
        ],
      });

      const retryResult = retryCompletion.choices[0]?.message?.content?.trim();
      if (retryResult) {
        cleaned = retryResult.replace(/^["“']+|["”']+$/g, '').trim();
      }
    }

    return cleaned;
  } catch (err: any) {
    throw new Error(friendlyGeminiError(err));
  }
}

export interface CleanSubtitlesItem {
  startMs: number;
  endMs: number;
  text: string;
}

export interface AiGroupedSubtitle {
  sourceIndices: number[];
  text: string;
}

export type AiGroupedOutput = AiGroupedSubtitle;

export const MAX_SUBTITLE_GAP_MS = 1500;
export const MAX_SUBTITLE_DURATION_MS = 7000;
export const MAX_LINES_PER_GROUP = 4;

/**
 * Ghép nối và tính toán timestamp tất định (deterministic) từ kết quả gộp của AI:
 * 1. startMs = original[min(sourceIndices)].startMs
 * 2. endMs = original[max(sourceIndices)].endMs
 * 3. Max Gap Guard: Tách cụm nếu khoảng lặng giữa 2 dòng liên tiếp > maxGapMs (mặc định 1500ms)
 * 4. Max Duration & Size Guard: Tách cụm nếu thời lượng > 7000ms hoặc quá 4 dòng để tránh lệch timeline video
 * 5. Missing Index Recovery: Tự động khôi phục các dòng bị AI bỏ sót để bảo toàn 100% dữ liệu
 */
export function resolveGroupedTimestamps(
  originalItems: CleanSubtitlesItem[],
  aiGroups: AiGroupedSubtitle[],
  maxGapMs: number = MAX_SUBTITLE_GAP_MS,
  maxDurationMs: number = MAX_SUBTITLE_DURATION_MS
): CleanSubtitlesItem[] {
  if (!originalItems || originalItems.length === 0) return [];
  if (originalItems.length === 1) {
    if (aiGroups && aiGroups.length > 0 && typeof aiGroups[0]?.text === 'string' && aiGroups[0].text.trim()) {
      return [
        {
          startMs: originalItems[0].startMs,
          endMs: originalItems[0].endMs,
          text: aiGroups[0].text.trim(),
        },
      ];
    }
    return [...originalItems];
  }

  // Chuẩn hóa phát hiện 1-based indexing từ AI (nếu model trả về 1..N thay vì 0..N-1)
  const allRawIndices: number[] = [];
  if (Array.isArray(aiGroups)) {
    for (const g of aiGroups) {
      if (Array.isArray(g?.sourceIndices)) {
        for (const idx of g.sourceIndices) {
          const n = typeof idx === 'number' ? idx : parseInt(String(idx), 10);
          if (!isNaN(n)) allRawIndices.push(n);
        }
      }
    }
  }
  const isOneBased =
    allRawIndices.length > 0 &&
    !allRawIndices.includes(0) &&
    allRawIndices.includes(originalItems.length) &&
    allRawIndices.every((idx) => idx >= 1 && idx <= originalItems.length);

  const result: CleanSubtitlesItem[] = [];
  const claimedIndices = new Set<number>();

  if (Array.isArray(aiGroups)) {
    for (const group of aiGroups) {
      if (!group || !Array.isArray(group.sourceIndices) || group.sourceIndices.length === 0) {
        continue;
      }

      // Chuẩn hóa và lọc chỉ số hợp lệ
      const normalizedIndices: number[] = [];
      for (const rawIdx of group.sourceIndices) {
        let idx = typeof rawIdx === 'number' ? rawIdx : parseInt(String(rawIdx), 10);
        if (isNaN(idx)) continue;
        if (isOneBased) idx -= 1;
        if (idx >= 0 && idx < originalItems.length && !claimedIndices.has(idx)) {
          normalizedIndices.push(idx);
        }
      }

      // Sắp xếp thứ tự tăng dần và loại bỏ trùng lặp trong nhóm
      const uniqueSorted = Array.from(new Set(normalizedIndices)).sort((a, b) => a - b);
      if (uniqueSorted.length === 0) continue;

      // Áp dụng Max Gap Guard & Max Duration Guard:
      // Tách nhóm nếu:
      // - khoảng lặng giữa 2 dòng liên tiếp > maxGapMs (1500ms)
      // - hoặc tổng thời lượng cụm vượt quá maxDurationMs (7000ms theo chuẩn phụ đề)
      // - hoặc số dòng gộp trong 1 cụm vượt quá MAX_LINES_PER_GROUP (4 dòng)
      // - hoặc chỉ số không liên tiếp (curIdx !== prevIdx + 1) để tránh nuốt dòng thoại trung gian
      const clusters: number[][] = [[uniqueSorted[0]]];
      for (let k = 1; k < uniqueSorted.length; k++) {
        const prevIdx = uniqueSorted[k - 1];
        const curIdx = uniqueSorted[k];
        const gap = originalItems[curIdx].startMs - originalItems[prevIdx].endMs;
        const currentCluster = clusters[clusters.length - 1];
        const clusterStartMs = originalItems[currentCluster[0]].startMs;
        const potentialEndMs = originalItems[curIdx].endMs;
        const clusterDuration = potentialEndMs - clusterStartMs;

        if (
          gap > maxGapMs ||
          clusterDuration > maxDurationMs ||
          currentCluster.length >= MAX_LINES_PER_GROUP ||
          curIdx !== prevIdx + 1
        ) {
          clusters.push([curIdx]);
        } else {
          currentCluster.push(curIdx);
        }
      }

      // Đánh dấu CHÍNH XÁC các chỉ số đã được gộp trong từng cụm (không nuốt các dòng chưa được gộp)
      clusters.forEach((c) => {
        c.forEach((idx) => {
          claimedIndices.add(idx);
        });
      });

      const rawText = typeof group.text === 'string' ? group.text.trim() : '';

      // Sinh phụ đề cho từng cluster sau khi qua Max Gap Guard
      if (clusters.length === 1) {
        const c = clusters[0];
        const startMs = originalItems[c[0]].startMs;
        const endMs = Math.max(startMs + 100, originalItems[c[c.length - 1]].endMs);
        const text = rawText || c.map((i) => originalItems[i].text).join(' ').trim();
        result.push({ startMs, endMs, text });
      } else {
        // Trường hợp bị Max Gap Guard tách thành nhiều cụm độc lập
        const newlineParts = rawText.split('\n').map((s) => s.trim()).filter(Boolean);
        clusters.forEach((c, cIdx) => {
          const startMs = originalItems[c[0]].startMs;
          const endMs = Math.max(startMs + 100, originalItems[c[c.length - 1]].endMs);
          let text = '';
          if (newlineParts.length === clusters.length) {
            text = newlineParts[cIdx];
          } else {
            text = c.map((i) => originalItems[i].text).join(' ').trim();
          }
          result.push({ startMs, endMs, text });
        });
      }
    }
  }

  // MISSING INDEX RECOVERY: Tự động khôi phục 100% các dòng bị AI bỏ sót
  for (let i = 0; i < originalItems.length; i++) {
    if (!claimedIndices.has(i)) {
      result.push({
        startMs: originalItems[i].startMs,
        endMs: Math.max(originalItems[i].startMs + 100, originalItems[i].endMs),
        text: originalItems[i].text,
      });
    }
  }

  // Sắp xếp lại theo trục thời gian startMs tăng dần
  result.sort((a, b) => a.startMs - b.startMs || a.endMs - b.endMs);

  // Chống chồng chéo timestamp (overlap clamping an toàn)
  for (let i = 0; i < result.length - 1; i++) {
    if (result[i].endMs > result[i + 1].startMs) {
      if (result[i + 1].startMs > result[i].startMs) {
        result[i].endMs = result[i + 1].startMs;
      } else {
        result[i + 1].startMs = result[i].endMs;
        if (result[i + 1].endMs <= result[i + 1].startMs) {
          result[i + 1].endMs = result[i + 1].startMs + 300;
        }
      }
    }
  }

  return result;
}

/**
 * Dùng Gemini AI để rà soát toàn bộ file phụ đề bằng cơ chế Structured Indexing:
 * 1. Gắn chỉ số index: 0, 1, 2... cho từng dòng đầu vào.
 * 2. Yêu cầu AI trả về mảng sourceIndices: number[] cùng text đã làm sạch (không tự tính startMs/endMs).
 * 3. TypeScript tự động liên kết startMs = original[min].startMs, endMs = original[max].endMs.
 * 4. Max Gap Guard: Tách nhóm nếu khoảng trống giữa 2 dòng liên tiếp > 1500ms.
 * 5. Missing Index Recovery: Tự động bảo toàn các dòng bị bỏ quên.
 */
export async function cleanAndDeduplicateSubtitles(
  items: CleanSubtitlesItem[],
  onProgress?: (percent: number) => void
): Promise<CleanSubtitlesItem[]> {
  if (!items || items.length === 0) return [];
  if (items.length === 1) return [...items];

  const { client, model } = createGeminiClient();

  const CHUNK_SIZE = 50;
  const cleanedAll: CleanSubtitlesItem[] = [];
  const totalChunks = Math.ceil(items.length / CHUNK_SIZE);

  for (let chunkIdx = 0; chunkIdx < totalChunks; chunkIdx++) {
    const startIdx = chunkIdx * CHUNK_SIZE;
    const chunk = items.slice(startIdx, startIdx + CHUNK_SIZE);

    const inputPayload = chunk.map((item, i) => ({
      index: i,
      text: item.text,
    }));

    const prompt = `Bạn là chuyên gia biên tập phụ đề video chuyên nghiệp.
Dưới đây là danh sách các dòng phụ đề OCR được đánh số thứ tự index từ 0 đến ${chunk.length - 1}.

Nhiệm vụ:
1. GỘP CÂU TRÙNG LẶP / KARAOKE / CHỮ HIỆN DẦN (RẤT QUAN TRỌNG):
   - Một câu nói hiển thị nhiều frame liên tiếp hoặc chữ hiện dần theo kiểu karaoke dẫn đến bị tách thành 2-4 dòng lặp nhau hoặc sai khác nhỏ 1-2 ký tự mờ.
   -> GỘP lại thành MỘT câu duy nhất, liệt kê tất cả các index của dòng gốc trong mảng sourceIndices.
2. CÂU BỊ NGẮT VỤN:
   - Nếu 2-3 câu liên tiếp là các vế ngắt của cùng một câu trọn vẹn, hãy ghép lại thành câu hoàn chỉnh tự nhiên.
   - TUYỆT ĐỐI KHÔNG gộp các câu độc lập có ý nghĩa tách biệt thành một khối kéo dài, làm lệch thời điểm xuất hiện trên video.
   - Tôn trọng nhịp ngắt thoại của video: không gộp dồn quá nhiều câu vào một khối duy nhất (tối đa không quá 3-4 dòng liên tiếp cho cùng 1 câu).
3. SỬA LỖI CHÍNH TẢ OCR:
   - Sửa các lỗi nhận diện quang học (nhầm lẫn l/1, 0/O, rn/m, sai dấu thanh tiếng Việt).
4. GIỮ NGUYÊN Ý NGHĨA VÀ NGÔN NGỮ:
   - Tuyệt đối không bịa thêm nội dung, không dịch sang ngôn ngữ khác.
5. QUY TẮC BẮT BUỘC VỀ CHỈ SỐ:
   - Trả về mảng sourceIndices: number[] chứa danh sách index dòng gốc được gộp vào câu đó (ví dụ: [0, 1] hoặc [2]).
   - TUYỆT ĐỐI KHÔNG sinh trường startMs hay endMs.
   - Không được bỏ sót các câu độc lập có ý nghĩa (câu đơn lẻ thì sourceIndices có 1 phần tử, ví dụ [3]).

ĐẦU VÀO JSON:
${JSON.stringify(inputPayload, null, 2)}

ĐẦU RA BẮT BUỘC:
Trả về DUY NHẤT một chuỗi JSON mảng các đối tượng:
[
  { "sourceIndices": [0, 1], "text": "Hôm nay tôi đi làm rất vui" },
  { "sourceIndices": [2], "text": "Thời tiết hôm nay rất đẹp" }
]
Không giải thích thêm, không bọc trong markdown.`;

    try {
      const isGemini3 = /gemini-3|gemini-flash-latest/i.test(model);
      const completionParams: any = {
        model,
        messages: [
          { role: 'system', content: 'Bạn là chuyên gia biên tập phụ đề video. Luôn trả về định dạng JSON thuần.' },
          { role: 'user', content: prompt },
        ],
      };
      if (isGemini3) {
        completionParams.reasoning_effort = 'low';
        completionParams.temperature = 1.0;
      } else {
        completionParams.temperature = 0.2;
      }

      const completion = await client.chat.completions.create(completionParams);

      const raw = completion.choices[0]?.message?.content?.trim() || '[]';
      const cleanJson = raw.replace(/^```json\s*/i, '').replace(/\s*```$/i, '').trim();

      let parsed: any;
      try {
        parsed = JSON.parse(cleanJson);
      } catch {
        parsed = JSON.parse(jsonrepair(cleanJson));
      }

      let groupsArray: any[] = [];
      if (Array.isArray(parsed)) {
        groupsArray = parsed;
      } else if (parsed && typeof parsed === 'object') {
        const arrayKeys = ['groups', 'subtitles', 'items', 'result', 'results', 'data', 'output'];
        for (const k of arrayKeys) {
          if (Array.isArray(parsed[k]) && parsed[k].length > 0) {
            groupsArray = parsed[k];
            break;
          }
        }
        if (groupsArray.length === 0) {
          for (const v of Object.values(parsed)) {
            if (Array.isArray(v) && v.length > 0) {
              groupsArray = v as any[];
              break;
            }
          }
        }
      }

      if (groupsArray.length > 0) {
        const resolved = resolveGroupedTimestamps(chunk, groupsArray, MAX_SUBTITLE_GAP_MS, MAX_SUBTITLE_DURATION_MS);
        cleanedAll.push(...resolved);
      } else {
        cleanedAll.push(...chunk);
      }
    } catch (err: any) {
      console.warn(`[AI Clean] Lỗi chunk ${chunkIdx + 1}/${totalChunks}:`, err?.message || err);
      cleanedAll.push(...chunk);
    }

    onProgress?.(Math.round(((chunkIdx + 1) / totalChunks) * 100));
  }

  // Sắp xếp lại theo startMs và tránh chồng đè timestamp giữa các chunk
  cleanedAll.sort((a, b) => a.startMs - b.startMs || a.endMs - b.endMs);
  for (let i = 0; i < cleanedAll.length - 1; i++) {
    if (cleanedAll[i].endMs > cleanedAll[i + 1].startMs) {
      if (cleanedAll[i + 1].startMs > cleanedAll[i].startMs) {
        cleanedAll[i].endMs = cleanedAll[i + 1].startMs;
      }
    }
  }

  return cleanedAll;
}


