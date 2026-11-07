import { runFfmpeg } from '../lib/ffmpegProcess';
// Tách lời thoại khỏi nhạc nền bằng Demucs (AI source separation — cùng loại
// công nghệ mà CapCut dùng cho tính năng "tách giọng"). Kết quả: file
// no_vocals.wav (nhạc nền/SFX không lời) để trộn với audio TTS, thay vì giữ
// nguyên giọng người gốc trong video.
//
// Yêu cầu môi trường: Python 3 + gói demucs (python -m pip install demucs —
// lần đầu kèm PyTorch ~2GB). Model htdemucs (~80MB) tự tải lần chạy đầu.
// Chạy CPU — thời lượng xử lý xấp xỉ thời lượng audio, video dài cần kiên nhẫn.

import { spawn } from 'child_process';
import fs from 'fs';
import path from 'path';
import { killProcessTree } from '../lib/processTree';
import { CancelledError, isCancelledError } from '../lib/cancel';
import { resolvePythonExecutable } from '../lib/pythonEnv';

export interface DemucsCheck {
  ok: boolean;
  detail: string;
}

function runPython(
  args: string[],
  timeoutMs: number,
  shouldStop?: () => boolean
): Promise<{ code: number; stderr: string }> {
  if (shouldStop?.()) return Promise.reject(new CancelledError());
  return new Promise((resolve, reject) => {
    const pythonBin = resolvePythonExecutable();
    const child = spawn(pythonBin, args, { windowsHide: true });
    let stderr = '';
    const stopTimer = shouldStop
      ? setInterval(() => {
          if (shouldStop()) killProcessTree(child);
        }, 150)
      : undefined;
    const timer = setTimeout(() => {
      try {
        killProcessTree(child);
      } catch {
        // bỏ qua
      }
      reject(new Error('Quá thời gian chạy python.'));
      if (stopTimer) clearInterval(stopTimer);
    }, timeoutMs);

    child.stderr?.on('data', (d) => (stderr += d.toString()));
    child.on('error', (err) => {
      clearTimeout(timer);
      if (stopTimer) clearInterval(stopTimer);
      reject(err);
    });
    child.on('exit', (code) => {
      clearTimeout(timer);
      if (stopTimer) clearInterval(stopTimer);
      if (shouldStop?.()) reject(new CancelledError());
      else resolve({ code: code ?? -1, stderr });
    });
  });
}

/** Kiểm tra máy đã cài sẵn demucs chưa (import nhanh) */
export async function checkDemucs(shouldStop?: () => boolean): Promise<DemucsCheck> {
  try {
    const { code, stderr } = await runPython(['-c', 'import demucs'], 60_000, shouldStop);
    if (code === 0) {
      return { ok: true, detail: 'Demucs đã sẵn sàng.' };
    }
    return {
      ok: false,
      detail:
        'Chưa cài gói demucs. Chạy: python -m pip install demucs (lần đầu tải PyTorch ~2GB).' +
        (stderr.trim() ? ` (${stderr.trim().split('\n').slice(-1)[0]})` : ''),
    };
  } catch (error) {
    if (isCancelledError(error)) throw error;
    return {
      ok: false,
      detail: 'Không chạy được python — cài Python 3 rồi chạy: python -m pip install demucs',
    };
  }
}

export interface StemPaths {
  /** Nhạc nền/SFX không lời */
  noVocals: string;
  /** Giọng hát/thoại đã tách riêng */
  vocals: string;
}

/**
 * Tách lời thoại nhanh bằng FFmpeg DSP (Center Channel Out-of-Phase Cancellation)
 * Hoạt động 100% offline không cần cài Python/PyTorch, thời gian xử lý cực nhanh (< 3s).
 */
export async function separateVocalsFastFfmpeg(
  inputAudioPath: string,
  outDir: string,
  shouldStop?: () => boolean
): Promise<StemPaths> {
  fs.mkdirSync(outDir, { recursive: true });
  const noVocals = path.join(outDir, 'no_vocals.wav');
  const vocals = path.join(outDir, 'vocals.wav');

  await runFfmpeg(
    [
      '-y',
      '-i',
      inputAudioPath,
      '-filter_complex',
      '[0:a]aformat=channel_layouts=stereo,asplit=2[bg][voice];[bg]pan=stereo|c0=c0-c1|c1=c1-c0,volume=1.25[aout];[voice]pan=mono|c0=0.5*c0+0.5*c1,bandpass=f=1200:width_type=h:w=2000[vout]',
      '-map',
      '[aout]',
      noVocals,
      '-map',
      '[vout]',
      vocals,
    ],
    { shouldStop }
  );

  return { noVocals, vocals };
}

/**
 * Tách audio thành 2 stem (vocals / no_vocals) và trả về đường dẫn cả 2 file.
 * Ưu tiên Demucs AI nếu có Python, tự động fallback sang FFmpeg DSP nếu không có Demucs.
 */
export async function separateVocals(
  inputAudioPath: string,
  outDir: string,
  shouldStop?: () => boolean,
  onBackend?: (backend: 'demucs' | 'dsp') => void
): Promise<StemPaths> {
  fs.mkdirSync(outDir, { recursive: true });
  const modelName = 'htdemucs';

  // Kiểm tra Demucs trước khi spawn
  if (shouldStop?.()) throw new CancelledError();
  const demucsCheck = await checkDemucs(shouldStop);
  if (shouldStop?.()) throw new CancelledError();
  if (!demucsCheck.ok) {
    onBackend?.('dsp');
    console.warn(`[VocalSeparation] ${demucsCheck.detail} -> Chuyển sang FFmpeg DSP Vocal Cancellation tự động.`);
    return separateVocalsFastFfmpeg(inputAudioPath, outDir, shouldStop);
  }

  onBackend?.('demucs');
  return new Promise((resolve, reject) => {
    console.log(`[Demucs] Bắt đầu tách lời thoại bằng AI: ${path.basename(inputAudioPath)}`);
    const args = ['-m', 'demucs', '--two-stems=vocals', '-n', modelName, '-o', outDir, inputAudioPath];
    const pythonBin = resolvePythonExecutable();
    const child = spawn(pythonBin, args, { windowsHide: true });
    let stderrTail = '';
    let killed = false;

    const stopTimer = shouldStop
      ? setInterval(() => {
          if (shouldStop() && !killed) {
            killed = true;
            killProcessTree(child);
          }
        }, 300)
      : null;

    child.stdout?.on('data', (d) => {
      const text = d.toString();
      const match = /(\d{1,3})%/.exec(text);
      if (match) console.log(`[Demucs] ${match[1]}%`);
    });
    child.stderr?.on('data', (d) => {
      stderrTail = (stderrTail + d.toString()).slice(-4000);
    });

    child.on('error', async (err) => {
      if (stopTimer) clearInterval(stopTimer);
      if (killed || shouldStop?.()) {
        reject(new CancelledError());
        return;
      }
      console.warn(`[Demucs] Không chạy được python/demucs (${err.message}). Fallback về FFmpeg DSP.`);
      try {
        const fallback = await separateVocalsFastFfmpeg(inputAudioPath, outDir, shouldStop);
        resolve(fallback);
      } catch (fallbackErr) {
        reject(fallbackErr);
      }
    });

    child.on('exit', async (code) => {
      if (stopTimer) clearInterval(stopTimer);
      if (killed || shouldStop?.()) {
        reject(new CancelledError());
        return;
      }
      if (code !== 0) {
        const tail = stderrTail.trim().split('\n').slice(-3).join(' | ');
        console.warn(`[Demucs] Thoát với mã ${code} (${tail}). Fallback về FFmpeg DSP.`);
        try {
          const fallback = await separateVocalsFastFfmpeg(inputAudioPath, outDir, shouldStop);
          resolve(fallback);
        } catch (fallbackErr) {
          reject(isCancelledError(fallbackErr) ? fallbackErr : new Error(`Demucs lỗi và FFmpeg fallback cũng thất bại: ${fallbackErr}`));
        }
        return;
      }
      // Kết quả nằm tại <outDir>/<model>/<tên file không đuôi>/{no_vocals,vocals}.wav
      const stemDir = path.join(outDir, modelName, path.basename(inputAudioPath, path.extname(inputAudioPath)));
      const noVocals = path.join(stemDir, 'no_vocals.wav');
      const vocals = path.join(stemDir, 'vocals.wav');
      if (!fs.existsSync(noVocals)) {
        console.warn(`[Demucs] Không thấy no_vocals.wav tại ${stemDir}. Fallback về FFmpeg DSP.`);
        try {
          const fallback = await separateVocalsFastFfmpeg(inputAudioPath, outDir, shouldStop);
          resolve(fallback);
        } catch (fallbackErr) {
          reject(fallbackErr);
        }
        return;
      }
      console.log(`[Demucs] ✓ Tách xong: ${noVocals}`);
      resolve({ noVocals, vocals: fs.existsSync(vocals) ? vocals : noVocals });
    });
  });
}
