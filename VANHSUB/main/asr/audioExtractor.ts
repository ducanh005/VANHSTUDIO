import path from 'path';
import fs from 'fs';
import { execFile } from 'child_process';
import ffmpeg from 'fluent-ffmpeg';
import ffmpegInstaller from '@ffmpeg-installer/ffmpeg';
import { CancelledError } from '../lib/cancel';

// Thiết lập đường dẫn ffmpeg binary (hỗ trợ cả môi trường dev và packaged asar)
const rawFfmpegPath = (ffmpegInstaller as any)?.path || (ffmpegInstaller as any)?.default?.path || '';
if (rawFfmpegPath) {
  ffmpeg.setFfmpegPath(rawFfmpegPath.replace('app.asar', 'app.asar.unpacked'));
}

let _ffmpegBin: string | null = null;

/** Đường dẫn ffmpeg binary để gọi trực tiếp qua execFile (spawn riêng cho từng lệnh) */
export function getFfmpegBinPath(): string {
  if (_ffmpegBin) return _ffmpegBin;
  const raw =
    (ffmpegInstaller as any)?.path || (ffmpegInstaller as any)?.default?.path || 'ffmpeg';
  _ffmpegBin = String(raw).replace('app.asar', 'app.asar.unpacked');
  return _ffmpegBin;
}

/**
 * Đọc thời lượng (giây) của file media bằng ffmpeg — không cần ffprobe riêng:
 * ffmpeg in "Duration: HH:MM:SS.ms" vào stderr rồi thoát lỗi vì không có output.
 * Lỗi → trả về 0 (caller coi như không biết duration).
 */
export function getMediaDurationSec(inputPath: string): Promise<number> {
  return new Promise((resolve) => {
    execFile(getFfmpegBinPath(), ['-i', inputPath], (_err, _stdout, stderr) => {
      const m = /Duration:\s*(\d+):(\d+):(\d+(?:\.\d+)?)/.exec(stderr || '');
      if (m) {
        resolve(Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3]));
      } else {
        resolve(0);
      }
    });
  });
}

export interface AudioExtractResult {
  wavPath: string;
  duration?: number;
}

/**
 * Trích audio GỐC đầy đủ chất lượng (44.1kHz stereo) từ video — đầu vào cho
 * AI tách lời thoại (demucs cần audio stereo đầy dải tần, không phải 16k mono
 * như đầu vào Whisper).
 */
export function extractFullQualityAudio(
  inputPath: string,
  outputWavPath: string,
  onProgress?: (percent: number) => void,
  options?: { shouldStop?: () => boolean },
): Promise<void> {
  return new Promise((resolve, reject) => {
    if (options?.shouldStop?.()) return reject(new CancelledError());
    if (!fs.existsSync(inputPath)) {
      return reject(new Error(`Không tìm thấy file đầu vào: ${inputPath}`));
    }

    const outDir = path.dirname(outputWavPath);
    if (!fs.existsSync(outDir)) {
      fs.mkdirSync(outDir, { recursive: true });
    }

    let timer: ReturnType<typeof setInterval> | undefined;
    let settled = false;
    let killed = false;
    const finish = (error?: Error) => {
      if (settled) return;
      settled = true;
      if (timer) clearInterval(timer);
      if (options?.shouldStop?.()) reject(new CancelledError());
      else if (error) reject(new Error(`Lỗi trích xuất audio gốc bằng ffmpeg: ${error.message}`));
      else resolve();
    };
    const command = ffmpeg(inputPath)
      .noVideo()
      .audioFrequency(44100)
      .audioChannels(2)
      .audioCodec('pcm_s16le')
      .format('wav')
      .output(outputWavPath)
      .on('start', () => {
        // fluent-ffmpeg spawns this worker directly. Kill only this owned process,
        // and wait for its terminal event before releasing the task/cleaning temp.
        const checkStop = () => {
          if (!settled && !killed && options?.shouldStop?.()) {
            killed = true;
            command.kill('SIGKILL');
          }
        };
        if (options?.shouldStop) timer = setInterval(checkStop, 150);
        checkStop();
      })
      .on('progress', (progress) => {
        if (options?.shouldStop?.()) return;
        if (progress && progress.percent && onProgress) {
          onProgress(Math.min(99, Math.round(progress.percent)));
        }
      })
      .on('end', () => finish())
      .on('error', (err) => finish(err));
    try {
      command.run();
    } catch (error) {
      finish(error instanceof Error ? error : new Error(String(error)));
    }
  });
}

/**
 * Trích xuất hoặc chuyển đổi file media (video/audio) thành file WAV 16kHz 16-bit mono
 * chuẩn đầu vào của Whisper ASR.
 */
export function extract16kHzWav(
  inputPath: string,
  outputWavPath?: string,
  onProgress?: (percent: number) => void,
): Promise<AudioExtractResult> {
  return new Promise((resolve, reject) => {
    if (!fs.existsSync(inputPath)) {
      return reject(new Error(`Không tìm thấy file đầu vào: ${inputPath}`));
    }

    const targetPath =
      outputWavPath ||
      path.join(
        path.dirname(inputPath),
        `${path.parse(inputPath).name}_temp_16k.wav`,
      );

    // Nếu file đầu vào đã là WAV 16k và cùng đường dẫn
    if (inputPath === targetPath && fs.existsSync(targetPath)) {
      return resolve({ wavPath: targetPath });
    }

    const outDir = path.dirname(targetPath);
    if (!fs.existsSync(outDir)) {
      fs.mkdirSync(outDir, { recursive: true });
    }

    ffmpeg(inputPath)
      .noVideo()
      .audioFrequency(16000)
      .audioChannels(1)
      .audioCodec('pcm_s16le')
      .format('wav')
      .output(targetPath)
      .on('progress', (progress) => {
        if (progress && progress.percent && onProgress) {
          onProgress(Math.min(99, Math.round(progress.percent)));
        }
      })
      .on('end', () => {
        resolve({ wavPath: targetPath });
      })
      .on('error', (err) => {
        reject(new Error(`Lỗi trích xuất audio bằng ffmpeg: ${err.message}`));
      })
      .run();
  });
}
