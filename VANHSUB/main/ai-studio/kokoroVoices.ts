import axios from 'axios';

export interface KokoroVoice { id: string; name: string }

/** Read-only catalog; never falls back to another provider or starts a model/container. */
export async function listKokoroVoices(
  endpoint = 'http://127.0.0.1:8880/v1/audio/voices', timeout = 5000,
): Promise<KokoroVoice[]> {
  const url = new URL(endpoint);
  if (url.protocol !== 'http:' || !['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname) ||
      url.username || url.password || url.search || url.hash || url.pathname !== '/v1/audio/voices') {
    throw new Error('Danh sách giọng Kokoro chỉ dùng server local.');
  }
  let data: any;
  try {
    ({ data } = await axios.get(url.href, { timeout, maxRedirects: 0, proxy: false, maxContentLength: 256 * 1024 }));
  } catch {
    throw new Error('Không tải được giọng Kokoro. Kiểm tra URL đã lưu và server local rồi bấm tải lại.');
  }
  if (!data || !Array.isArray(data.voices) || data.voices.length > 2000) throw new Error('Danh sách giọng Kokoro không đúng định dạng.');
  const voices: KokoroVoice[] = data.voices.map((item: unknown) => {
    const voice = typeof item === 'string' ? { id: item, name: item } : item as KokoroVoice;
    if (!voice || typeof voice.id !== 'string' || !/^[a-zA-Z0-9_.-]{1,128}$/.test(voice.id) ||
        (voice.name !== undefined && (typeof voice.name !== 'string' || voice.name.length > 256))) {
      throw new Error('Danh sách giọng Kokoro không đúng định dạng.');
    }
    return { id: voice.id, name: voice.name || voice.id };
  });
  return Array.from(new Map(voices.map(voice => [voice.id, voice])).values());
}
