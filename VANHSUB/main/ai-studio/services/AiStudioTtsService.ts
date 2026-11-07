import fs from 'fs';
import { assertUsableScript } from '../../../shared/aiStudioScript';
import path from 'path';
import os from 'os';
import { synthesizeKokoroSpeech, kokoroUrl, kokoroSpeed } from '../../tts-providers/kokoro/KokoroClient';
import { synthesizePiperSpeech, piperLocalStatus, PIPER_VI_VOICE } from '../../tts-providers/piper/PiperLocalClient';
import ffmpeg from 'fluent-ffmpeg';
import ffmpegInstaller from '@ffmpeg-installer/ffmpeg';
import ffprobeInstaller from '@ffprobe-installer/ffprobe';
import type { ProsodyOptions } from 'msedge-tts';
import { synthesizeEdgeSpeech, isTtsAccessDenied } from '../../tts-providers/edge/edgeSpeech';
import type { TiktokTTSProvider } from '../../tts-providers/tiktok/types';
import type {
  AiStudioVoiceConfig,
  ScriptBeatLine,
  WordTimestamp,
  RenderSingleLineVoicePayload,
  RenderSingleLineVoiceResult,
  TtsVoiceProvider,
} from '../types';

// Setup FFmpeg & FFprobe binary paths
const rawFfmpegPath = (ffmpegInstaller as any)?.path || (ffmpegInstaller as any)?.default?.path || '';
const rawFfprobePath = (ffprobeInstaller as any)?.path || (ffprobeInstaller as any)?.default?.path || '';

if (rawFfmpegPath) {
  ffmpeg.setFfmpegPath(rawFfmpegPath.replace('app.asar', 'app.asar.unpacked'));
}
if (rawFfprobePath) {
  ffmpeg.setFfprobePath(rawFfprobePath.replace('app.asar', 'app.asar.unpacked'));
}

export interface TtsSynthesisResult {
  audioPath: string;
  durationMs: number;
  sizeBytes: number;
  rawMetadata: any[];
  wordTimestamps: WordTimestamp[];
  alignmentSource?: 'word_boundary' | 'estimated_per_line' | 'mixed';
  sampleRate?: number;
  audioFormat?: 'mp3';
}

export interface AlignmentResult {
  wordsAlignment: WordTimestamp[];
  alignedLines: ScriptBeatLine[];
  totalDurationMs: number;
  alignmentSource: 'word_boundary' | 'estimated_per_line';
}

export class AiStudioTtsService {
  private static instance: AiStudioTtsService | null = null;
  private tikTokProvider: TiktokTTSProvider | null = null;

  public static getInstance(): AiStudioTtsService {
    if (!AiStudioTtsService.instance) {
      AiStudioTtsService.instance = new AiStudioTtsService();
    }
    return AiStudioTtsService.instance;
  }

  /** Cho phép tiêm provider TikTok TTS tùy chỉnh (hữu ích cho unit test) */
  public setTikTokProvider(provider: TiktokTTSProvider | null): void {
    this.tikTokProvider = provider;
  }

  /** Lấy singleton TikTok TTS Provider từ hệ thống phiên TikTok */
  public getTikTokProvider(): TiktokTTSProvider | null {
    if (this.tikTokProvider) return this.tikTokProvider;
    try {
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const { getSharedTikTokProvider } = require('../../tts-providers/tiktok/sessionStores');
      this.tikTokProvider = getSharedTikTokProvider();
      return this.tikTokProvider;
    } catch (err: any) {
      console.warn('[AiStudioTtsService] Could not initialize shared TikTok TTS provider:', err?.message || err);
      return null;
    }
  }

  // ==========================================================================
  // Helper: Normalize Voice ID
  // ==========================================================================
  public normalizeVoiceId(voiceId?: string, provider?: TtsVoiceProvider): string {
    if (provider === 'piper_local') {
      if (voiceId !== PIPER_VI_VOICE) throw new Error('Piper: chọn voice vi_VN-vais1000-medium.');
      return voiceId;
    }
    if (provider === 'local_onnx') {
      if (!/^[a-zA-Z0-9_.-]{1,128}$/.test(voiceId || '')) throw new Error('Kokoro: chọn ID giọng hợp lệ.');
      return voiceId!;
    }
    const v = (voiceId || '').toLowerCase().trim();

    if (provider === 'tiktok_tts' || v.startsWith('bv0') || v.includes('tiktok')) {
      // Ưu tiên voice ID TikTok tường minh (vd: BV074_streaming, en_male_narration, en_us_001)
      if (voiceId && (voiceId.startsWith('BV0') || voiceId.startsWith('en_') || voiceId.startsWith('es_') || voiceId.startsWith('fr_'))) {
        return voiceId;
      }
      if (v.includes('nu') || v.includes('nữ') || v.includes('female')) {
        return 'BV074_streaming';
      }
      if (v.includes('nam') || v.includes('male')) {
        return 'BV075_streaming';
      }
      return 'BV074_streaming';
    }

    // Edge-TTS: Ưu tiên voice ID tường minh
    if (voiceId && voiceId.startsWith('vi-VN-')) {
      return voiceId;
    }
    if (v.includes('nu') || v.includes('nữ') || v.includes('female') || v.includes('hoaimy')) {
      return 'vi-VN-HoaiMyNeural';
    }
    if (v.includes('nam') || v.includes('male') || v.includes('namminh')) {
      return 'vi-VN-NamMinhNeural';
    }
    return 'vi-VN-HoaiMyNeural';
  }

  // ==========================================================================
  // Helper: Chunk Text For TikTok TTS (limit ~300 chars)
  // ==========================================================================
  public chunkTextForTikTok(text: string, maxChars = 220): string[] {
    const trimmed = text.trim();
    if (!trimmed || trimmed.length <= maxChars) return trimmed ? [trimmed] : [];

    const rawParts = trimmed.split(/(?<=[.!?,\n;:])\s+/);
    const result: string[] = [];
    let currentChunk = '';

    for (const part of rawParts) {
      if (!part) continue;
      if (part.length > maxChars) {
        const words = part.split(/\s+/);
        for (const word of words) {
          if (!currentChunk) {
            currentChunk = word;
          } else if ((currentChunk + ' ' + word).length <= maxChars) {
            currentChunk += ' ' + word;
          } else {
            result.push(currentChunk.trim());
            currentChunk = word;
          }
        }
      } else if (!currentChunk) {
        currentChunk = part;
      } else if ((currentChunk + ' ' + part).length <= maxChars) {
        currentChunk += ' ' + part;
      } else {
        result.push(currentChunk.trim());
        currentChunk = part;
      }
    }

    if (currentChunk.trim()) {
      result.push(currentChunk.trim());
    }

    return result;
  }

  // ==========================================================================
  // Helper: Sanitize Text For TTS (Strip Unpronounceable Glyphs / Stars / Emojis)
  // ==========================================================================
  public sanitizeTextForTts(text: string): string {
    if (!text) return '';
    return text
      // Strip star sequences and decorative rating glyphs (e.g. ⭐⭐⭐⭐⭐, ★, ☆, ✨, 🌟, 💫)
      .replace(/[⭐★☆✨🌟💫✦✧]+/g, ' ')
      // Normalize decorative quotes and ornate bracket blocks
      .replace(/[«»‹›“”„‟〔〕〈〉《》【】〖〗]/g, '"')
      // Strip emoticons and non-verbal emojis / symbols
      .replace(/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/gu, ' ')
      // Normalize multiple spaces
      .replace(/\s+/g, ' ')
      .trim();
  }

  // ==========================================================================
  // Helper: Concat Audio Files via FFmpeg Concat Demuxer
  // ==========================================================================
  public async concatAudioFiles(inputPaths: string[], outputPath: string, signal?: AbortSignal): Promise<void> {
    signal?.throwIfAborted();
    if (inputPaths.length === 0) return;
    if (inputPaths.length === 1) {
      fs.mkdirSync(path.dirname(outputPath), { recursive: true });
      fs.copyFileSync(inputPaths[0], outputPath);
      return;
    }

    fs.mkdirSync(path.dirname(outputPath), { recursive: true });
    const listFilePath = path.join(
      path.dirname(outputPath),
      `concat_list_${Date.now()}_${Math.random().toString(36).slice(2, 7)}.txt`
    );
    const listContent = inputPaths
      .map((p) => `file '${p.replace(/\\/g, '/').replace(/'/g, "'\\''")}'`)
      .join('\n');
    fs.writeFileSync(listFilePath, listContent, 'utf8');

    try {
      try {
        await this.runAudioCommand(ffmpeg()
          .input(listFilePath)
          .inputOptions(['-f', 'concat', '-safe', '0'])
          .outputOptions(['-c', 'copy'])
          .output(outputPath), signal);
      } catch (error) {
        signal?.throwIfAborted();
        if (error instanceof Error && error.message.includes('hết thời gian')) throw error;
        await this.runAudioCommand(ffmpeg()
              .input(listFilePath)
              .inputOptions(['-f', 'concat', '-safe', '0'])
              .audioCodec('libmp3lame')
              .audioBitrate('48k')
              .output(outputPath), signal);
      }
    } finally {
      try {
        if (fs.existsSync(listFilePath)) {
          fs.unlinkSync(listFilePath);
        }
      } catch {}
    }
  }

  private async runAudioCommand(command: ffmpeg.FfmpegCommand, signal?: AbortSignal): Promise<void> {
    signal?.throwIfAborted();
    await new Promise<void>((resolve, reject) => {
      let done = false;
      let terminalError: Error | undefined;
      const finish = (error?: Error) => {
        if (done) return; done = true; clearTimeout(timer); signal?.removeEventListener('abort', abort);
        error ? reject(error) : resolve();
      };
      const abort = () => { terminalError = new Error('TTS đã bị hủy.'); command.kill('SIGKILL'); };
      const timer = setTimeout(() => { terminalError = new Error('TTS: FFmpeg hết thời gian xử lý.'); command.kill('SIGKILL'); }, 30000);
      signal?.addEventListener('abort', abort, { once: true });
      command.on('start', () => { if (terminalError || signal?.aborted) abort(); });
      command.on('end', () => finish(terminalError || (signal?.aborted ? new Error('TTS đã bị hủy.') : undefined)));
      command.on('error', error => finish(terminalError || error));
      command.run();
    });
  }

  // ==========================================================================
  // Helper: Synthesize Single Speech Chunk (Safe WebSocket with timeout & retry)
  // ==========================================================================
  public async synthesizeSingleSpeechChunk(
    text: string,
    targetVoice: string,
    prosody: ProsodyOptions,
    outputPath: string,
    signal?: AbortSignal,
    provider?: TtsVoiceProvider,
    onMetadata?: (items: any[]) => void,
    voiceConfig?: AiStudioVoiceConfig
  ): Promise<Buffer> {
    if (provider === 'local_onnx' || provider === 'piper_local') {
      const engine = provider === 'piper_local' ? 'Piper' : 'Kokoro';
      if (voiceConfig?.pitch && !/^[-+]?0(?:\.0+)?Hz$/.test(voiceConfig.pitch)) throw new Error(`${engine} chưa hỗ trợ đổi cao độ; đặt pitch +0Hz.`);
      const volume = String(prosody.volume || '+0%');
      if (!/^[+-]?\d+(?:\.\d+)?%$/.test(volume)) throw new Error(`${engine}: âm lượng không hợp lệ.`);
      const gain = 1 + parseFloat(volume) / 100;
      if (gain <= 0 || gain > 3) throw new Error(`${engine}: âm lượng phải lớn hơn -100% và không quá +200%.`);
      const buffer = provider === 'piper_local'
        ? await synthesizePiperSpeech(text, targetVoice, String(prosody.rate || '+0%'), signal)
        : await synthesizeKokoroSpeech(text, targetVoice, String(prosody.rate || '+0%'), voiceConfig?.kokoroBaseUrl, signal, voiceConfig?.kokoroTimeoutMs);
      const raw = `${outputPath}.wav`;
      try {
        fs.writeFileSync(raw, buffer, { flag: 'wx' });
        await this.runAudioCommand(ffmpeg(raw).inputOptions(['-xerror']).noVideo().audioCodec('libmp3lame')
          .audioFrequency(24000).audioChannels(1).audioBitrate('96k').audioFilters(`volume=${gain}`).output(outputPath), signal);
        await this.probeMediaDuration(outputPath);
        signal?.throwIfAborted();
        return fs.readFileSync(outputPath);
      } catch (error) {
        signal?.throwIfAborted();
        throw new Error(`${engine}: audio không giải mã được hoặc FFmpeg thất bại.`);
      } finally { if (fs.existsSync(raw)) fs.unlinkSync(raw); }
    }
    const isTikTok = provider === 'tiktok_tts' || targetVoice.startsWith('BV0') || targetVoice.startsWith('en_');

    if (isTikTok) {
      const tikTok = this.getTikTokProvider();
      if (tikTok && tikTok.hasSession()) {
        try {
          if (signal?.aborted) {
            throw new Error('Quá trình tạo giọng đọc đã bị hủy bởi người dùng.');
          }

          const chunks = this.chunkTextForTikTok(text, 220);
          const chunkBuffers: Buffer[] = [];

          for (const chunk of chunks) {
            if (signal?.aborted) {
              throw new Error('Quá trình tạo giọng đọc đã bị hủy bởi người dùng.');
            }
            const res = await tikTok.synthesize(chunk, targetVoice);
            if (res.audio && res.audio.length > 0) {
              chunkBuffers.push(res.audio);
            }
          }

          if (chunkBuffers.length > 0) {
            const finalBuffer = Buffer.concat(chunkBuffers);
            fs.mkdirSync(path.dirname(outputPath), { recursive: true });
            fs.writeFileSync(outputPath, finalBuffer);
            return finalBuffer;
          }
        } catch (err: any) {
          if (signal?.aborted) throw err;
          throw new Error('TikTok TTS thất bại; không tự chuyển sang Edge. Kiểm tra session/provider hoặc chọn engine khác rõ ràng.');
        }
      } else {
        throw new Error('Chưa lưu session TikTok hoặc session không khả dụng. Không tự chuyển engine.');
      }

      throw new Error('TikTok TTS không trả audio; không tự chuyển engine.');
    }

    const maxRetries = 3;
    let lastError: any = null;

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      if (signal?.aborted) {
        throw new Error('Quá trình tạo giọng đọc đã bị hủy bởi người dùng.');
      }

      try {
        const { audio: audioBuffer, metadata } = await synthesizeEdgeSpeech(text, targetVoice, prosody, { signal, wordBoundaries: true, timeoutMs: 45_000 });
        signal?.throwIfAborted();
        fs.writeFileSync(outputPath, audioBuffer);
        onMetadata?.(metadata);
        return audioBuffer;
      } catch (err: any) {
        if (isTtsAccessDenied(err)) throw err;
        lastError = err;
        if (signal?.aborted) {
          throw new Error('Quá trình tạo giọng đọc đã bị hủy bởi người dùng.');
        }
        if (attempt < maxRetries) {
          console.warn(
            `[AiStudioTtsService] Tổng hợp câu "${text.slice(0, 35)}..." lần ${attempt} thất bại, thử lại sau ${attempt * 600}ms:`,
            err?.message || err
          );
          await new Promise((r) => setTimeout(r, attempt * 600));
        }
      }
    }

    throw new Error(`TTS Voiceover synthesis failed: ${lastError?.message || lastError}`);
  }

  // ==========================================================================
  // Stage 3: Robust Voiceover Synthesis (Line-by-Line + Concat)
  // ==========================================================================
  public async synthesizeVoiceover(
    textOrLines: string | ScriptBeatLine[],
    voiceConfig: AiStudioVoiceConfig,
    outputPath: string,
    signal?: AbortSignal
  ): Promise<TtsSynthesisResult> {
    if (Array.isArray(textOrLines)) assertUsableScript(textOrLines);
    else assertUsableScript([{ text: textOrLines }]);
    if (voiceConfig.provider === 'local_onnx') {
      kokoroUrl(voiceConfig.kokoroBaseUrl, 'speech');
      kokoroSpeed(voiceConfig.rate || '+0%');
      this.normalizeVoiceId(voiceConfig.voiceId, 'local_onnx');
    }
    if (voiceConfig.provider === 'piper_local') {
      this.normalizeVoiceId(voiceConfig.voiceId, 'piper_local');
      const status = piperLocalStatus();
      if (!status.ready) throw new Error(status.reason || 'Piper chưa sẵn sàng.');
    }
    signal?.throwIfAborted();
    fs.mkdirSync(path.dirname(outputPath), { recursive: true });
    const workspace = fs.mkdtempSync(path.join(path.dirname(outputPath), '.tts-'));
    const input = Array.isArray(textOrLines) ? structuredClone(textOrLines) : textOrLines;
    try {
      const result = await this.synthesizeInWorkspace(input, voiceConfig, path.join(workspace, 'voiceover.mp3'), signal);
      signal?.throwIfAborted();
      // Same-volume rename: never delete/truncate a completed output before success.
      fs.renameSync(result.audioPath, outputPath);
      if (Array.isArray(input) && Array.isArray(textOrLines)) input.forEach((line, i) => Object.assign(textOrLines[i], line));
      return { ...result, audioPath: outputPath, ...(['local_onnx','piper_local'].includes(voiceConfig.provider) ? { sampleRate: 24000, audioFormat: 'mp3' as const } : {}) };
    } catch (error) {
      // Only this invocation's newly created staging directory; never previous output/artifacts.
      fs.rmSync(workspace, { recursive: true, force: true });
      throw error;
    }
  }

  private async synthesizeInWorkspace(textOrLines: string | ScriptBeatLine[], voiceConfig: AiStudioVoiceConfig,
    outputPath: string, signal?: AbortSignal): Promise<TtsSynthesisResult> {
    fs.mkdirSync(path.dirname(outputPath), { recursive: true });
    const provider: TtsVoiceProvider =
      voiceConfig.provider !== 'local_onnx' && (voiceConfig.provider === 'tiktok_tts' || voiceConfig.voiceId?.startsWith('BV0'))
        ? 'tiktok_tts'
        : (voiceConfig.provider || 'edge_tts');
    const targetVoice = this.normalizeVoiceId(voiceConfig.voiceId, provider);

    const prosody: ProsodyOptions = {
      rate: voiceConfig.rate || '+0%',
      pitch: voiceConfig.pitch || '+0Hz',
      volume: voiceConfig.volume || '+0%',
    };

    // ------------------------------------------------------------------------
    // CASE A: Array of ScriptBeatLine[] (Line-by-line synthesis)
    // ------------------------------------------------------------------------
    if (Array.isArray(textOrLines)) {
      if (textOrLines.length === 0) {
        throw new Error('Danh sách câu kịch bản không được để trống.');
      }

      const voiceDir = path.join(path.dirname(outputPath), 'voice');
      fs.mkdirSync(voiceDir, { recursive: true });

      const lineAudioPaths: string[] = [];
      const allWordTimestamps: WordTimestamp[] = [];
      const allMetadata: any[] = [];
      let boundaryLines = 0;
      let currentMs = 0;

      for (let i = 0; i < textOrLines.length; i++) {
        if (signal?.aborted) {
          throw new Error('Quá trình tạo giọng đọc đã bị hủy bởi người dùng.');
        }

        if (i > 0) {
          await new Promise((r) => setTimeout(r, 200));
        }

        const line = textOrLines[i];
        const sanitizedLine = this.sanitizeTextForTts(line.text);
        if (!sanitizedLine) throw new Error(`Dòng ${i + 1} không có nội dung đọc được.`);

        const lineAudioPath = path.join(voiceDir, `line_${i + 1}.mp3`);
        let metadata: any[] = [];
        await this.synthesizeSingleSpeechChunk(sanitizedLine, targetVoice, prosody, lineAudioPath, signal, provider, items => { metadata = items; }, voiceConfig);

        const durSec = await this.probeMediaDuration(lineAudioPath);
        const durMs = Math.round(durSec * 1000);

        line.durationMs = durMs;
        line.audioPath = lineAudioPath;
        line.startMs = currentMs;
        line.endMs = currentMs + durMs;

        const lineWords = this.extractWordTimestamps(metadata, sanitizedLine, durMs);
        if (this.hasCompleteBoundaries(metadata, sanitizedLine, durMs)) boundaryLines++;
        allMetadata.push(...metadata.map(item => ({ ...item, Data: { ...item.Data, Offset: Number(item.Data?.Offset || 0) + currentMs * 10000 } })));
        for (const wt of lineWords) {
          allWordTimestamps.push({
            word: wt.word,
            startMs: wt.startMs + currentMs,
            endMs: wt.endMs + currentMs,
          });
        }

        currentMs += durMs;
        lineAudioPaths.push(lineAudioPath);
      }

      await this.concatAudioFiles(lineAudioPaths, outputPath, signal);
      const totalDurSec = await this.probeMediaDuration(outputPath);
      const totalDurationMs = Math.round(totalDurSec * 1000) || currentMs;

      return {
        audioPath: outputPath,
        durationMs: totalDurationMs,
        sizeBytes: fs.existsSync(outputPath) ? fs.statSync(outputPath).size : 0,
        rawMetadata: allMetadata,
        wordTimestamps: allWordTimestamps,
        alignmentSource: boundaryLines === textOrLines.length ? 'word_boundary' : boundaryLines ? 'mixed' : 'estimated_per_line',
      };
    }

    // ------------------------------------------------------------------------
    // CASE B: Single String
    // ------------------------------------------------------------------------
    const rawFullText = textOrLines.trim();
    if (!rawFullText) {
      throw new Error('Văn bản lồng tiếng không được để trống.');
    }

    const sanitized = this.sanitizeTextForTts(rawFullText);
    if (!sanitized) throw new Error('Văn bản không có nội dung đọc được.');

    // If text is long (>= 220 chars for TikTok, >= 1000 chars for Edge), split into sentence chunks
    const chunkThreshold = provider === 'tiktok_tts' ? 220 : 1000;
    if (sanitized.length >= chunkThreshold) {
      const sentenceSplits = sanitized
        .split(/(?<=[.!?\n])\s+/)
        .map((s) => s.trim())
        .filter(Boolean);

      const mockLines: ScriptBeatLine[] = sentenceSplits.map((text, idx) => ({
        id: `chunk_${idx + 1}`,
        index: idx + 1,
        text,
      }));

      return this.synthesizeInWorkspace(mockLines, { ...voiceConfig, provider }, outputPath, signal);
    }

    // Short text: Synthesize directly
    let metadata: any[] = [];
    await this.synthesizeSingleSpeechChunk(sanitized, targetVoice, prosody, outputPath, signal, provider, items => { metadata = items; }, voiceConfig);
    const durationSec = await this.probeMediaDuration(outputPath);
    const durationMs = Math.round(durationSec * 1000);
    const wordTimestamps = this.extractWordTimestamps(metadata, sanitized, durationMs);

    return {
      audioPath: outputPath,
      durationMs,
      sizeBytes: fs.existsSync(outputPath) ? fs.statSync(outputPath).size : 0,
      rawMetadata: metadata,
      wordTimestamps,
      alignmentSource: this.hasCompleteBoundaries(metadata, sanitized, durationMs) ? 'word_boundary' : 'estimated_per_line',
    };
  }

  // ==========================================================================
  // Stage 4: Word-Boundary Alignment Extraction
  // ==========================================================================
  private hasCompleteBoundaries(metadata: any[], text: string, durationMs: number): boolean {
    const key = (value: string) => value.toLocaleLowerCase().replace(/[^\p{L}\p{N}]/gu, '');
    const boundaries = metadata.filter(item => item?.Type === 'WordBoundary' && item.Data);
    return boundaries.length > 0 && boundaries.every(item => {
      const start = Number(item.Data.Offset) / 10000;
      const duration = Number(item.Data.Duration) / 10000;
      return typeof item.Data.text?.Text === 'string' && Number.isFinite(start) && Number.isFinite(duration) && start >= 0 && start < durationMs && duration > 0;
    }) && key(boundaries.map(item => item.Data.text.Text).join(' ')) === key(text);
  }

  public extractWordTimestamps(
    rawMetadata: any[],
    fullText: string,
    totalDurationMs: number
  ): WordTimestamp[] {
    const extracted: WordTimestamp[] = [];

    if (Array.isArray(rawMetadata) && this.hasCompleteBoundaries(rawMetadata, fullText, totalDurationMs)) {
      for (const item of rawMetadata) {
        if (item.Type === 'WordBoundary' && item.Data) {
          const offsetTicks = item.Data.Offset || 0;
          const durationTicks = item.Data.Duration || 0;
          const text = item.Data.text?.Text || '';
          // 1 tick = 100 ns = 0.0001 ms
          const startMs = Math.round(offsetTicks / 10000);
          const endMs = Math.round((offsetTicks + durationTicks) / 10000);
          if (text && Number.isFinite(startMs) && Number.isFinite(endMs) && startMs >= 0 && endMs > startMs && startMs < totalDurationMs) {
            extracted.push({ word: text, startMs, endMs: Math.min(endMs, totalDurationMs) });
          }
        }
      }
    }

    // Fallback: Syllabic distribution if metadata was omitted by server
    if (extracted.length === 0) {
      return this.calculateSyllabicAlignment(fullText, totalDurationMs);
    }

    return extracted.sort((a, b) => a.startMs - b.startMs);
  }

  public extractAlignment(
    rawMetadata: any[],
    scriptText: string,
    scriptLines: ScriptBeatLine[],
    totalDurationMs: number,
    existingWords?: WordTimestamp[]
  ): AlignmentResult {
    const alignedLines: ScriptBeatLine[] = JSON.parse(JSON.stringify(scriptLines));
    const measured = alignedLines.every(line => line.durationMs && line.durationMs > 0);
    const weights = alignedLines.map(line => measured ? line.durationMs! : this.sanitizeTextForTts(line.text).length);
    const sum = weights.reduce((a, b) => a + b, 0);
    let currentMs = 0;

    for (let i = 0; i < alignedLines.length; i++) {
      const line = alignedLines[i];
      const lineDurationMs = i === alignedLines.length - 1 ? totalDurationMs - currentMs : Math.round(weights[i] / Math.max(1, sum) * totalDurationMs);
      line.startMs = currentMs;
      line.endMs = currentMs + lineDurationMs;
      line.durationMs = lineDurationMs;
      currentMs += lineDurationMs;
    }

    const preserved = existingWords?.length && existingWords.every((word, index) =>
      Number.isFinite(word.startMs) && Number.isFinite(word.endMs) && word.startMs >= 0 && word.endMs > word.startMs &&
      word.startMs < totalDurationMs && word.endMs <= totalDurationMs + 100 && (!index || word.startMs >= existingWords[index - 1].startMs));
    const wordsAlignment = preserved ? existingWords!.map(word => ({ ...word, endMs: Math.min(word.endMs, totalDurationMs) }))
      : rawMetadata.length ? this.extractWordTimestamps(rawMetadata, this.sanitizeTextForTts(scriptText), totalDurationMs)
      : alignedLines.flatMap(line => this.calculateSyllabicAlignment(this.sanitizeTextForTts(line.text), line.durationMs || 0)
        .map(word => ({ ...word, startMs: word.startMs + (line.startMs || 0), endMs: word.endMs + (line.startMs || 0) })));

    return {
      wordsAlignment,
      alignedLines,
      totalDurationMs,
      alignmentSource: this.hasCompleteBoundaries(rawMetadata, this.sanitizeTextForTts(scriptText), totalDurationMs) ? 'word_boundary' : 'estimated_per_line',
    };
  }

  public calculateSyllabicAlignment(text: string, totalDurationMs: number): WordTimestamp[] {
    const words = text.trim().split(/\s+/).filter(Boolean);
    if (words.length === 0) return [];
    if (!Number.isFinite(totalDurationMs) || totalDurationMs <= 0) return [];
    const safeDuration = totalDurationMs;
    const perWord = safeDuration / words.length;

    return words.map((w, idx) => ({
      word: w,
      startMs: Math.round(idx * perWord),
      endMs: Math.round((idx + 1) * perWord),
    }));
  }

  // ==========================================================================
  // Granular Step: Single-Line Voice Re-Synthesis
  // ==========================================================================
  public async renderSingleLineVoice(
    payload: RenderSingleLineVoicePayload,
    outputDir?: string
  ): Promise<RenderSingleLineVoiceResult> {
    const targetDir = outputDir || path.join(os.tmpdir(), 'vanhsub-single-lines');
    fs.mkdirSync(targetDir, { recursive: true });

    const lineAudioPath = path.join(
      targetDir,
      `line_${payload.lineIndex}_${Date.now()}.mp3`
    );

    const result = await this.synthesizeVoiceover(payload.text, payload.voiceConfig, lineAudioPath);
    return {
      audioPath: result.audioPath,
      durationMs: result.durationMs,
    };
  }

  // ==========================================================================
  // Prober Helper
  // ==========================================================================
  public async probeMediaDuration(mediaPath: string): Promise<number> {
    return new Promise((resolve, reject) => {
      ffmpeg.ffprobe(mediaPath, (err, metadata) => {
        if (err) return reject(err);
        const duration = Number(metadata?.format?.duration);
        if (!Number.isFinite(duration) || duration <= 0) return reject(new Error('TTS audio không có thời lượng hợp lệ.'));
        resolve(duration);
      });
    });
  }
}

export const aiStudioTtsService = AiStudioTtsService.getInstance();
