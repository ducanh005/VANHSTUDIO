import fs from 'fs';
import path from 'path';
import { spawn } from 'child_process';
import { CancelledError } from '../lib/cancel';
import { killProcessTree } from '../lib/processTree';
import { resolvePythonExecutable } from '../lib/pythonEnv';
import { segmentWordsToSubtitles } from './wordSegmenter';
import { serializeSrt } from '../lib/srt';

export interface FasterWhisperOptions {
  modelName?: string;
  language?: string;
  device?: 'auto' | 'cuda' | 'cpu';
  computeType?: 'auto' | 'float16' | 'int8' | 'float32';
  wordTimestamps?: boolean;
  enableDiarization?: boolean;
  speakerCount?: number;
  hfToken?: string;
  onProgress?: (progress: number, stage?: string) => void;
  shouldStop?: () => boolean;
}

export interface FasterWhisperResult {
  srtPath: string;
  speakers?: string[];
  words?: Array<{ word: string; startMs: number; endMs: number; probability?: number; speaker?: string }>;
}

/**
 * Định vị đường dẫn file script sidecar faster_whisper_server.py
 */
export function resolveFasterWhisperScriptPath(): string {
  try {
    const electron = require('electron');
    const app = electron.app;
    if (app?.isPackaged) {
      const prodPath = path.join(process.resourcesPath, 'asr', 'faster_whisper_server.py');
      if (fs.existsSync(prodPath)) return prodPath;
    }
    if (app?.getAppPath) {
      const appPath = path.join(app.getAppPath(), 'main', 'asr', 'python', 'faster_whisper_server.py');
      if (fs.existsSync(appPath)) return appPath;
    }
  } catch {}

  const localPath = path.join(process.cwd(), 'main', 'asr', 'python', 'faster_whisper_server.py');
  if (fs.existsSync(localPath)) return localPath;

  return path.join(__dirname, 'python', 'faster_whisper_server.py');
}

/**
 * Thực thi Faster-Whisper ASR qua Python sidecar
 */
export async function runFasterWhisper(
  audioPath: string,
  options: FasterWhisperOptions = {}
): Promise<FasterWhisperResult> {
  if (!fs.existsSync(audioPath)) {
    throw new Error(`Không tìm thấy file audio: ${audioPath}`);
  }

  const scriptPath = resolveFasterWhisperScriptPath();
  if (!fs.existsSync(scriptPath)) {
    throw new Error(`Không tìm thấy script Faster-Whisper tại: ${scriptPath}`);
  }

  const pythonBin = resolvePythonExecutable();
  const outputSrtPath = `${audioPath}.faster.srt`;

  const args: string[] = [
    scriptPath,
    '--audio', audioPath,
    '--output', outputSrtPath,
    '--model', options.modelName || 'large-v3-turbo',
    '--device', options.device || 'auto',
    '--compute_type', options.computeType || 'auto',
    '--language', options.language || 'auto',
  ];

  if (options.wordTimestamps !== false) {
    args.push('--word_timestamps');
  }
  if (options.enableDiarization) {
    args.push('--diarize');
  }
  if (options.speakerCount && options.speakerCount > 0) {
    args.push('--num_speakers', String(options.speakerCount));
  }
  if (options.hfToken) {
    args.push('--hf_token', options.hfToken);
  }

  return new Promise<FasterWhisperResult>((resolve, reject) => {
    let stopped = false;
    let stopPollTimer: NodeJS.Timeout | null = null;
    let lastErrorMsg = '';
    let donePayload: any = null;
    let stdoutBuffer = '';

    const child = spawn(pythonBin, args, { windowsHide: true });

    const cleanup = () => {
      if (stopPollTimer) {
        clearInterval(stopPollTimer);
        stopPollTimer = null;
      }
    };

    if (options.shouldStop) {
      stopPollTimer = setInterval(() => {
        try {
          if (!stopped && options.shouldStop?.()) {
            stopped = true;
            cleanup();
            killProcessTree(child);
            reject(new CancelledError());
          }
        } catch {}
      }, 300);
    }

    const processJsonLine = (line: string) => {
      const trimmed = line.trim();
      if (!trimmed || !trimmed.startsWith('{')) return;
      try {
        const msg = JSON.parse(trimmed);
        if (msg.type === 'progress') {
          options.onProgress?.(msg.percent, msg.stage);
        } else if (msg.type === 'warning') {
          console.warn(`[Faster-Whisper] ${msg.msg}`);
        } else if (msg.type === 'error') {
          lastErrorMsg = msg.message;
          console.error(`[Faster-Whisper] Lỗi: ${msg.message}`);
        } else if (msg.type === 'done') {
          donePayload = msg;
        }
      } catch {}
    };

    child.stdout.on('data', (chunk) => {
      stdoutBuffer += chunk.toString();
      const lines = stdoutBuffer.split('\n');
      stdoutBuffer = lines.pop() || '';
      for (const line of lines) {
        processJsonLine(line);
      }
    });

    let stderrData = '';
    child.stderr.on('data', (chunk) => {
      stderrData += chunk.toString();
    });

    child.on('error', (err) => {
      cleanup();
      reject(new Error(`Không thể khởi chạy tiến trình Python (${pythonBin}): ${err.message}`));
    });

    child.on('close', (code) => {
      cleanup();
      if (stdoutBuffer) {
        processJsonLine(stdoutBuffer);
      }

      if (stopped) {
        return reject(new CancelledError());
      }

      if (code === 0 && fs.existsSync(outputSrtPath)) {
        const words = donePayload?.words || [];
        if (words.length > 0) {
          try {
            const naturalLines = segmentWordsToSubtitles(words);
            if (naturalLines.length > 0) {
              fs.writeFileSync(outputSrtPath, serializeSrt(naturalLines), 'utf-8');
            }
          } catch (segErr) {
            console.warn('[Faster-Whisper] Lỗi hậu xử lý phân đoạn từ tự nhiên:', segErr);
          }
        }

        return resolve({
          srtPath: outputSrtPath,
          speakers: donePayload?.speakers || [],
          words,
        });
      }

      const errMsg = lastErrorMsg || stderrData.trim().slice(-300) || `Tiến trình kết thúc với mã lỗi ${code}`;
      reject(new Error(`Faster-Whisper thất bại: ${errMsg}`));
    });
  });
}
