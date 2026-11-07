import { MsEdgeTTS, OUTPUT_FORMAT, type ProsodyOptions } from 'msedge-tts';
import { CancelledError } from '../../lib/cancel';

export function isTtsAccessDenied(error: any): boolean {
  return error?.code === 'TTS_PROVIDER_ACCESS_DENIED' || /\b(?:401|403)\b|TTS_PROVIDER_ACCESS_DENIED/.test(error?.message || '');
}

export function edgeAccessDeniedError(): Error {
  return Object.assign(new Error('TTS_PROVIDER_ACCESS_DENIED: Edge TTS từ chối truy cập (401/403). Không tự thử lại. Hãy chọn VietTTS local đã cấu hình hoặc provider có quyền truy cập hợp lệ.'), { code: 'TTS_PROVIDER_ACCESS_DENIED', retryable: false });
}

/** One ordinary library request. No token, identity or handshake overrides. */
export function synthesizeEdgeSpeech(text: string, voice: string, prosody: ProsodyOptions, options: {
  signal?: AbortSignal; shouldStop?: () => boolean; wordBoundaries?: boolean; timeoutMs?: number;
} = {}): Promise<{ audio: Buffer; metadata: any[] }> {
  if (options.signal?.aborted || options.shouldStop?.()) return Promise.reject(new CancelledError());
  const tts = new MsEdgeTTS();
  return new Promise((resolve, reject) => {
    let settled = false, audioStream: any, metadataStream: any;
    const chunks: Buffer[] = [], metadata: any[] = [];
    const onData = (chunk: Buffer) => chunks.push(chunk);
    const onMetadata = (chunk: Buffer) => { try { const data = JSON.parse(chunk.toString('utf8')); if (Array.isArray(data.Metadata)) metadata.push(...data.Metadata); } catch {} };
    const onError = (error: Error) => finish(error);
    const onEnd = () => finish();
    const onAbort = () => finish(new CancelledError());
    const timer = setTimeout(() => finish(new Error('Edge TTS timeout.')), options.timeoutMs ?? 25_000);
    const cancelPoll = options.shouldStop ? setInterval(() => { if (options.shouldStop?.()) onAbort(); }, 100) : undefined;
    const finish = (error?: Error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer); if (cancelPoll) clearInterval(cancelPoll);
      options.signal?.removeEventListener('abort', onAbort);
      audioStream?.removeListener('data', onData); audioStream?.removeListener('end', onEnd);
      metadataStream?.removeListener('data', onMetadata);
      // Error handlers remain until the detached streams are collected, absorbing late close errors.
      try { tts.close(); } catch {}
      if (error) reject(isTtsAccessDenied(error) ? edgeAccessDeniedError() : error);
      else { const audio = Buffer.concat(chunks); audio.length ? resolve({ audio, metadata }) : reject(new Error('Edge TTS trả về âm thanh rỗng.')); }
    };
    options.signal?.addEventListener('abort', onAbort, { once: true });
    Promise.resolve().then(async () => {
      if (settled) return;
      await tts.setMetadata(voice, OUTPUT_FORMAT.AUDIO_24KHZ_48KBITRATE_MONO_MP3, { wordBoundaryEnabled: !!options.wordBoundaries, sentenceBoundaryEnabled: false });
      if (settled) return;
      ({ audioStream, metadataStream } = tts.toStream(text, prosody));
      audioStream.on('data', onData); audioStream.on('error', onError); audioStream.on('end', onEnd);
      metadataStream?.on('data', onMetadata); metadataStream?.on('error', () => {});
    }).catch(onError);
  });
}
