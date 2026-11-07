import axios from 'axios';

export const DEFAULT_KOKORO_URL = 'http://127.0.0.1:8880/v1';

/** Only explicit local services. No remote text exfiltration, credentials or redirects. */
export function kokoroUrl(base = DEFAULT_KOKORO_URL, route: 'speech' | 'voices'): string {
  let url: URL;
  try { url = new URL(base); } catch { throw new Error('Kokoro: URL local không hợp lệ.'); }
  if (url.protocol !== 'http:' || !['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname) ||
      url.username || url.password || url.search || url.hash || !/^\/v1\/?$/.test(url.pathname)) {
    throw new Error('Kokoro chỉ nhận URL HTTP local dạng http://127.0.0.1:8880/v1.');
  }
  url.pathname = `/v1/audio/${route}`;
  return url.href;
}

export function kokoroSpeed(rate = '+0%'): number {
  if (!/^[+-]?\d+(?:\.\d+)?%$/.test(rate)) throw new Error('Kokoro: tốc độ phải có dạng +10% hoặc -10%.');
  const speed = 1 + parseFloat(rate) / 100;
  if (speed < 0.25 || speed > 4) throw new Error('Kokoro: tốc độ phải nằm trong khoảng -75% đến +300%.');
  return speed;
}

/** OpenAI-compatible Kokoro-FastAPI contract. One POST only; never retries or changes engine. */
export async function synthesizeKokoroSpeech(text: string, voice: string, rate: string,
  base?: string, signal?: AbortSignal, timeoutMs = 90000): Promise<Buffer> {
  const endpoint = kokoroUrl(base, 'speech'), speed = kokoroSpeed(rate);
  if (!/^[a-zA-Z0-9_.-]{1,128}$/.test(voice || '')) throw new Error('Kokoro: chọn ID giọng hợp lệ từ server local.');
  if (!text.trim() || text.length > 10000) throw new Error('Kokoro: mỗi đoạn cần từ 1 đến 10000 ký tự.');
  if (!Number.isFinite(timeoutMs) || timeoutMs < 100 || timeoutMs > 180000) throw new Error('Kokoro: timeout không hợp lệ.');
  signal?.throwIfAborted();
  const deadline = new AbortController(), timer = setTimeout(() => deadline.abort(), timeoutMs);
  try {
    const response = await axios.post(endpoint, { model: 'kokoro', input: text, voice, speed, response_format: 'wav', stream: false }, {
      responseType: 'arraybuffer', signal: signal ? AbortSignal.any([signal, deadline.signal]) : deadline.signal,
      timeout: timeoutMs, maxRedirects: 0, proxy: false, maxContentLength: 32 * 1024 * 1024,
      maxBodyLength: 64 * 1024, headers: { Accept: 'audio/wav' },
    });
    signal?.throwIfAborted();
    const audio = Buffer.from(response.data);
    if (audio.length < 44 || audio.toString('ascii', 0, 4) !== 'RIFF' || audio.toString('ascii', 8, 12) !== 'WAVE') {
      throw new Error('KOKORO_INVALID_AUDIO');
    }
    return audio;
  } catch (error) {
    signal?.throwIfAborted();
    if (deadline.signal.aborted || axios.isAxiosError(error) && error.code === 'ECONNABORTED') throw new Error('Kokoro: hết thời gian tổng hợp; không tự thử lại.');
    if (error instanceof Error && error.message === 'KOKORO_INVALID_AUDIO') throw new Error('Kokoro: server trả audio WAV hỏng hoặc sai định dạng.');
    const status = axios.isAxiosError(error) ? error.response?.status : undefined;
    throw new Error(status ? `Kokoro: server trả HTTP ${status}; không tự thử lại.` : 'Kokoro: không kết nối được server local; kiểm tra dịch vụ đã chạy.');
  } finally { clearTimeout(timer); }
}
