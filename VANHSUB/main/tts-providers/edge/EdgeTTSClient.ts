import type { ProsodyOptions } from 'msedge-tts';
import { synthesizeEdgeSpeech, isTtsAccessDenied } from './edgeSpeech';
import { CancelledError } from '../../lib/cancel';

export interface EdgeVoiceInfo {
  id: string;
  name: string;
  gender: 'Female' | 'Male';
  locale: string;
}

export const EDGE_VIETNAMESE_VOICES: EdgeVoiceInfo[] = [
  {
    id: 'vi-VN-HoaiMyNeural',
    name: 'Hoài My (Nữ - Truyền cảm, Tự nhiên)',
    gender: 'Female',
    locale: 'vi-VN',
  },
  {
    id: 'vi-VN-NamMinhNeural',
    name: 'Nam Minh (Nam - Trầm ấm, Phóng sự)',
    gender: 'Male',
    locale: 'vi-VN',
  },
];

/**
 * EdgeTTSClient: Client tổng hợp tiếng Việt qua Microsoft Edge Speech API
 * Dùng thư viện Read Aloud không chính thức; provider có thể từ chối truy cập.
 */
export class EdgeTTSClient {
  private static instance: EdgeTTSClient | null = null;

  public static getInstance(): EdgeTTSClient {
    if (!EdgeTTSClient.instance) {
      EdgeTTSClient.instance = new EdgeTTSClient();
    }
    return EdgeTTSClient.instance;
  }

  public getVoices(): EdgeVoiceInfo[] {
    return EDGE_VIETNAMESE_VOICES;
  }

  /**
   * Tổng hợp văn bản thành MP3 Buffer
   * @param text Nội dung cần đọc
   * @param voice Tên voice (mặc định 'vi-VN-HoaiMyNeural')
   * @param speed Tốc độ đọc (0.5 đến 2.0, mặc định 1.0)
   */
  public async synthesize(
    text: string,
    voice: string = 'vi-VN-HoaiMyNeural',
    speed: number = 1.0,
    shouldStop?: () => boolean
  ): Promise<{ audio: Buffer }> {
    const trimmed = text.trim();
    if (!trimmed) {
      throw new Error('Văn bản cần đọc đang trống.');
    }

    // Chuẩn hóa voice name: nếu người dùng truyền voice TikTok hoặc tên ngắn, fallback về Hoài My
    let targetVoice = voice;
    const isKnownEdgeVoice = EDGE_VIETNAMESE_VOICES.some((v) => v.id === voice);
    if (!isKnownEdgeVoice) {
      if (voice.toLowerCase().includes('nam') || voice.toLowerCase().includes('male')) {
        targetVoice = 'vi-VN-NamMinhNeural';
      } else {
        targetVoice = 'vi-VN-HoaiMyNeural';
      }
    }

    // Chuyển đổi speed (1.0 -> 0%, 1.2 -> +20%, 0.8 -> -20%)
    const ratePercent = Math.round((Math.max(0.5, Math.min(2.0, speed)) - 1.0) * 100);
    const rateStr = ratePercent >= 0 ? `+${ratePercent}%` : `${ratePercent}%`;

    const prosodyOptions: ProsodyOptions = {
      rate: rateStr,
      pitch: '+0Hz',
      volume: '+0%',
    };

    let lastError: any = null;
    const maxRetries = 2;

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      if (shouldStop?.()) throw new CancelledError();
      try {
        return await synthesizeEdgeSpeech(trimmed, targetVoice, prosodyOptions, { shouldStop });
      } catch (err: any) {
        if (shouldStop?.() || err instanceof CancelledError || isTtsAccessDenied(err)) throw err;
        lastError = err;

        if (attempt < maxRetries) {
          console.warn(`[EdgeTTSClient] Lần thử ${attempt}/${maxRetries} thất bại (${err?.message || err}). Đang thử lại sau 800ms...`);
          await new Promise((r) => setTimeout(r, 800));
        }
      }
    }

    console.error('[EdgeTTSClient] Lỗi tổng hợp giọng nói sau các lần thử:', lastError);
    throw new Error(`Edge TTS: ${lastError?.message || String(lastError)}`);
  }
}
