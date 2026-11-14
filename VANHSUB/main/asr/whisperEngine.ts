// Module xử lý ASR (Speech-to-Text) bằng whisper.cpp — gọi TRỰC TIẾP binary
// whisper-cli thay vì qua package nodejs-whisper. Lý do: shelljs của
// nodejs-whisper không expose tiến trình con nên không thể huỷ giữa chừng —
// bấm huỷ phải đợi chunk 10 phút đang chạy xong. Spawn trực tiếp cho phép kill
// tiến trình ngay lập tức, đồng thời tự tải model thiếu bằng script chính thức
// của whisper.cpp (hành vi "auto download lần đầu" giữ nguyên như trước).
//
// Đây là "domain logic" thuần túy — KHÔNG import gì từ electron, để có thể test
// độc lập qua script terminal (scripts/test-asr.ts) mà không cần mở app lên.

import fs from 'fs';
import path from 'path';
import os from 'os';
import { execFile, spawn, type ChildProcess } from 'child_process';
import { promisify } from 'util';
import { parseSrt, serializeSrt, type SrtLine } from '../lib/srt';
import { CancelledError } from '../lib/cancel';
import { getFfmpegBinPath, getMediaDurationSec, extract16kHzWav } from './audioExtractor';

const execFileAsync = promisify(execFile);

export interface TranscribeOptions {
  /**
   * Tên model whisper cần dùng, vd: 'base', 'small', 'large-v3-turbo'.
   * whisper.cpp hỗ trợ sẵn định dạng ggml đa ngôn ngữ chuẩn (bao gồm tiếng Việt).
   */
  modelName?: string;

  /**
   * Thư mục lưu model đã tải — để tách khỏi thư mục mặc định của package,
   * dễ quản lý dung lượng và đường dẫn khi đóng gói app.
   */
  modelRootPath?: string;

  /** Tiến trình 0-100 (đo theo chunk khi audio dài — whisper.cpp không có event progress) */
  onProgress?: (percent: number) => void;

  /** Trả về true để huỷ — kill tiến trình whisper-cli đang chạy (kiểm tra 400ms/lần) */
  shouldStop?: () => boolean;
}

export interface TranscribeResult {
  /** Đường dẫn file .srt vừa được tạo ra */
  srtPath: string;
}

const DEFAULT_MODEL = 'large-v3-turbo';

/** Các model nodejs-whisper hỗ trợ (bản đa ngôn ngữ — dùng được cho tiếng Việt) */
const SUPPORTED_MODELS = ['tiny', 'base', 'small', 'medium', 'large', 'large-v3-turbo'];

// =========================================================================
// ĐỊNH VỊ BINARY WHISPER.CPP + MODEL
// ========================================================================

/**
 * Thư mục gốc whisper.cpp đi kèm nodejs-whisper. Thứ tự ưu tiên:
 * 1. app.asar.unpacked (prod — binary không thể chạy từ trong asar)
 * 2. node_modules cạnh thư mục build của main process (dev)
 * 3. node_modules theo cwd (script test chạy từ thư mục repo)
 */
function getWhisperCppDir(): string {
  const candidates: string[] = [];
  if (process.resourcesPath) {
    candidates.push(
      path.resolve(process.resourcesPath, 'app.asar.unpacked', 'node_modules', 'nodejs-whisper', 'cpp', 'whisper.cpp'),
    );
  }
  candidates.push(path.resolve(__dirname, '..', 'node_modules', 'nodejs-whisper', 'cpp', 'whisper.cpp'));
  candidates.push(path.resolve(process.cwd(), 'node_modules', 'nodejs-whisper', 'cpp', 'whisper.cpp'));

  for (const dir of candidates) {
    if (fs.existsSync(path.join(dir, 'build'))) return dir;
  }
  return candidates[candidates.length - 1];
}

function getWhisperCliPath(): string {
  if (process.env.VANHSUB_WHISPER_CLI) {
    const override = path.resolve(process.env.VANHSUB_WHISPER_CLI);
    return fs.existsSync(override) ? override : '';
  }
  const base = getWhisperCppDir();
  const execName = process.platform === 'win32' ? 'whisper-cli.exe' : 'whisper-cli';
  const candidates = [
    ...(process.resourcesPath ? [path.join(process.resourcesPath, 'whisper', execName)] : []),
    path.join(base, 'build', 'bin', execName), // Unix CMake
    path.join(base, 'build', 'bin', 'Release', execName), // Windows CMake Release
    path.join(base, 'build', 'bin', 'Debug', execName), // Windows CMake Debug
  ];
  return candidates.find((c) => fs.existsSync(c)) || '';
}

function resolveModelFile(modelName: string, modelRootPath?: string): string {
  const file = `ggml-${modelName}.bin`;
  if (modelRootPath) return path.resolve(modelRootPath, file);
  if (process.resourcesPath && fs.existsSync(path.join(process.resourcesPath, 'app.asar'))) {
    return path.join(process.env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local'), 'VANHSUB', 'whisper-models', file);
  }
  return path.join(getWhisperCppDir(), 'models', file);
}

// =========================================================================
// HUỶY TIẾN TRÌNH — registry whisper-cli đang chạy, kill được từng task
// (2 pipeline chạy song song cũng chỉ kill đúng tiến trình của mình)
// ========================================================================

const runningWhisperChildren = new Set<ChildProcess>();

function killProcessTree(child: ChildProcess): void {
  try {
    if (process.platform === 'win32' && child.pid) {
      // taskkill /T xoá luôn tiến trình con (nếu có) — kill() chỉ giết direct child
      spawn('taskkill', ['/pid', String(child.pid), '/T', '/F'], { windowsHide: true });
    } else {
      child.kill('SIGKILL');
    }
  } catch {
    // tiến trình đã thoát — bỏ qua
  }
}

// App đóng giữa chừng → dọn tiến trình whisper còn chạy, tránh để tiến trình mồ côi ngốn CPU
process.on('exit', () => {
  for (const child of runningWhisperChildren) {
    try {
      child.kill();
    } catch {
      // bỏ qua
    }
  }
});

// =========================================================================
// CHUNKING CHO AUDIO DÀI — whisper.cpp nạp toàn bộ mel-spectrogram vào RAM,
// audio nhiều giờ sẽ chậm/oom. Chia thành chunk ~10 phút (chồng lấp 2s ở
// biên để không cắt cụt từ), phiên âm từng chunk rồi gộp về 1 file .srt.
// =========================================================================

/** Ngưỡng chuyển sang chia chunk (giây) */
const CHUNK_THRESHOLD_SEC = 900; // 15 phút
/** Độ dài mỗi chunk (giây) */
const CHUNK_SEC = 600; // 10 phút
/** Phần chồng lấp giữa 2 chunk liên tiếp (giây) — tránh cắt cụt từ ở biên */
const CHUNK_OVERLAP_SEC = 2;

export interface ChunkTranscript {
  /** Vị trí bắt đầu của chunk trong audio gốc (ms) */
  offsetMs: number;
  /** Các dòng phụ đề của chunk (timestamp tính theo thời gian local của chunk) */
  lines: SrtLine[];
}

/**
 * Gộp phụ đề các chunk về 1 timeline duy nhất (hàm thuần — test được độc lập).
 *
 * Vùng có thể trùng lặp giữa chunk trước và chunk này có bề rộng 2×overlap:
 * chunk trước được kéo dài thêm `overlap` giây ở đuôi, chunk này bắt đầu sớm
 * `overlap` giây ở đầu. Dòng của chunk này bắt đầu trong vùng đó sẽ bị bỏ nếu
 * chunk trước đang "có tiếng" lúc đó (dòng cuối của chunk trước kết thúc SAU
 * điểm bắt đầu dòng này) — tức là câu thoại kéo dài qua biên, chunk trước đã
 * ghi rồi. Ngược lại (chunk trước im lặng ở vùng đó) thì giữ nguyên dòng.
 */
export function mergeChunkTranscripts(chunks: ChunkTranscript[], overlapMs: number): SrtLine[] {
  const merged: SrtLine[] = [];
  let lastKeptEndMs = 0;

  chunks.forEach((chunk, chunkIndex) => {
    const overlapEndAbs = chunk.offsetMs + overlapMs * 2;

    for (const line of chunk.lines) {
      if (!line.text?.trim()) continue;
      const startMs = chunk.offsetMs + line.startMs;
      const endMs = Math.max(chunk.offsetMs + line.endMs, startMs + 200);

      // Câu thoại kéo dài qua biên chunk — chunk trước đã ghi phần này rồi
      if (chunkIndex > 0 && startMs < overlapEndAbs - 250 && lastKeptEndMs > startMs) {
        continue;
      }

      merged.push({ id: `line-${merged.length}`, startMs, endMs, text: line.text.trim() });
      lastKeptEndMs = endMs;
    }
  });

  return merged.sort((a, b) => a.startMs - b.startMs).map((l, i) => ({ ...l, id: `line-${i}` }));
}

/** Cắt 1 đoạn WAV từ file audio gốc (stream copy — rất nhanh với WAV/PCM) */
async function extractChunkWav(
  inputPath: string,
  outputPath: string,
  startSec: number,
  durationSec: number,
): Promise<void> {
  await execFileAsync(getFfmpegBinPath(), [
    '-ss', String(startSec),
    '-i', inputPath,
    '-t', String(durationSec),
    '-c', 'copy',
    '-y',
    outputPath,
  ]);
}

/**
 * Tự tải model nếu chưa có trên đĩa — dùng script download chính thức của
 * whisper.cpp (đúng cách nodejs-whisper làm trước đây), giữ UX "lần đầu tự tải".
 */
async function ensureModelDownloaded(modelName: string, modelRootPath?: string): Promise<void> {
  const modelFile = resolveModelFile(modelName, modelRootPath);
  if (fs.existsSync(modelFile)) return;

  const modelsDir = path.dirname(modelFile);
  const scriptName = process.platform === 'win32' ? 'download-ggml-model.cmd' : 'download-ggml-model.sh';
  const bundledScriptPath = path.join(getWhisperCppDir(), 'models', scriptName);
  const scriptPath = process.platform === 'win32' && modelsDir !== path.dirname(bundledScriptPath)
    ? path.join(modelsDir, 'bin', scriptName) : bundledScriptPath;
  if (scriptPath !== bundledScriptPath && fs.existsSync(bundledScriptPath)) {
    fs.mkdirSync(path.dirname(scriptPath), { recursive: true });
    fs.copyFileSync(bundledScriptPath, scriptPath);
  }
  if (!fs.existsSync(scriptPath)) {
    throw new Error(
      `Model "${modelName}" chưa có trên đĩa và không tìm thấy script tải model tại: ${scriptPath}`,
    );
  }

  fs.mkdirSync(modelsDir, { recursive: true });
  console.log(`[ASR] Đang tải model ${modelName} về ${modelsDir} (có thể mất vài phút)...`);

  await new Promise<void>((resolve, reject) => {
    const command = process.platform === 'win32'
      ? (process.env.ComSpec || 'cmd.exe')
      : 'bash';
    // The bundled .cmd script compares %1 literally and uses its own models
    // directory by default. Quoting the model argument makes that comparison
    // fail, while quoting %2 breaks its internal path concatenation.
    const args = process.platform === 'win32'
      ? ['/d', '/s', '/c', `""${scriptPath}" ${modelName}"`]
      : [scriptPath, modelName, modelsDir];
    const child = spawn(command, args, { cwd: modelsDir, windowsHide: true,
      windowsVerbatimArguments: process.platform === 'win32' });
    let stdoutTail = '';
    let stderrTail = '';
    child.stdout?.on('data', (d: Buffer) => {
      stdoutTail = (stdoutTail + d.toString()).slice(-2000);
    });
    child.stderr?.on('data', (d: Buffer) => {
      stderrTail = (stderrTail + d.toString()).slice(-2000);
    });
    child.on('error', reject);
    child.on('exit', (code) => {
      const downloadedFile = path.join(path.dirname(scriptPath), path.basename(modelFile));
      if (code === 0 && downloadedFile !== modelFile && fs.existsSync(downloadedFile)) {
        fs.copyFileSync(downloadedFile, modelFile);
      }
      if (code === 0 && fs.existsSync(modelFile)) return resolve();
      reject(
        new Error(
          `Tải model ${modelName} thất bại (exit ${code}, file chưa có). ${[stdoutTail, stderrTail].join('\n').trim().split('\n').slice(-4).join(' | ')}`,
        ),
      );
    });
  });

  console.log(`[ASR] Đã tải xong model ${modelName}`);
}

/**
 * Chạy 1 phiên whisper-cli trên 1 file WAV. Huỷ = kill tiến trình ngay lập tức
 * (kiểm tra shouldStop 400ms/lần) thay vì đợi chunk chạy xong.
 */
function runWhisperCli(
  wavPath: string,
  modelName: string,
  modelRootPath: string | undefined,
  shouldStop?: () => boolean,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const cliPath = getWhisperCliPath();
    if (!cliPath) {
      return reject(
        new Error(
          `Không tìm thấy binary whisper-cli. Chạy npm run build:whisper-cpp trước khi đóng gói; kiểm tra ${getWhisperCppDir()}\\build.`,
        ),
      );
    }

    const modelFile = resolveModelFile(modelName, modelRootPath);
    if (!fs.existsSync(modelFile)) {
      return reject(new Error(`Model Whisper "${modelName}" chưa có trên đĩa tại: ${modelFile}`));
    }

    // Cờ khớp với cấu hình cũ của nodejs-whisper: -osrt (SRT) + -sow true
    // (split on word) + -l auto. Model/file dùng đường dẫn tuyệt đối.
    const args = ['-osrt', '-sow', 'true', '-l', 'auto', '-m', modelFile, '-f', wavPath];

    let stopped = false;
    let stderrTail = '';
    const child = spawn(cliPath, args, { windowsHide: true });
    runningWhisperChildren.add(child);

    // stdout chỉ là log tiến trình — drain để pipe không nghẽn
    child.stdout?.on('data', () => {});
    child.stderr?.on('data', (d: Buffer) => {
      stderrTail = (stderrTail + d.toString()).slice(-4000);
    });

    const stopTimer = shouldStop
      ? setInterval(() => {
          if (shouldStop()) {
            stopped = true;
            killProcessTree(child);
          }
        }, 400)
      : null;

    const cleanup = () => {
      if (stopTimer) clearInterval(stopTimer);
      runningWhisperChildren.delete(child);
    };

    child.on('error', (err) => {
      cleanup();
      reject(err);
    });
    child.on('exit', (code) => {
      cleanup();
      if (stopped) return reject(new CancelledError());
      if (code === 0) return resolve();
      const lastLog = stderrTail.trim().split('\n').slice(-3).join(' | ');
      reject(
        new Error(
          `whisper-cli thoát với mã ${code}. Log gần nhất: ${lastLog || '(trống)'}`,
        ),
      );
    });
  });
}

/** Phiên âm 1 file qua whisper-cli và kiểm tra file .srt đầu ra */
async function whisperToSrt(
  audioPath: string,
  options: TranscribeOptions,
): Promise<string> {
  const modelName = options.modelName ?? DEFAULT_MODEL;
  if (!SUPPORTED_MODELS.includes(modelName)) {
    throw new Error(
      `Model Whisper "${modelName}" không được hỗ trợ. Các model khả dụng: ${SUPPORTED_MODELS.join(', ')}.`,
    );
  }

  // whisper-cli nhận WAV 16kHz — flow của app luôn truyền WAV đã trích sẵn,
  // đường convert giữ lại cho input ngoài (script test) đúng hành vi cũ.
  let wavInput = audioPath;
  let tempWav = false;
  if (path.extname(audioPath).toLowerCase() !== '.wav') {
    const { wavPath } = await extract16kHzWav(audioPath);
    wavInput = wavPath;
    tempWav = true;
  }

  try {
    await ensureModelDownloaded(modelName, options.modelRootPath);
    await runWhisperCli(wavInput, modelName, options.modelRootPath, options.shouldStop);

    // whisper-cli tạo file SRT bằng cách nối ".srt" vào toàn bộ tên file:
    // video.wav -> video.wav.srt
    const srtPath = `${wavInput}.srt`;
    if (!fs.existsSync(srtPath)) {
      throw new Error(
        `whisper-cli chạy xong nhưng không thấy file srt tại: ${srtPath}. ` +
          `Kiểm tra lại output của whisper.cpp.`,
      );
    }

    if (wavInput !== audioPath) {
      // Input ngoài (không phải wav) — chuyển file srt về tên theo file gốc
      const finalSrt = `${audioPath}.srt`;
      fs.renameSync(srtPath, finalSrt);
      return finalSrt;
    }
    return srtPath;
  } finally {
    if (tempWav) {
      try {
        fs.unlinkSync(wavInput);
      } catch {
        // bỏ qua
      }
    }
  }
}

/**
 * Chuyển 1 file audio/video thành phụ đề .srt.
 *
 * Audio ngắn (<= 15 phút): gửi cả file cho whisper.cpp như cũ.
 * Audio dài: chia chunk ~10 phút có chồng lấp 2s, phiên âm từng chunk có
 * báo tiến trình + cho phép huỷ, rồi gộp timestamp về 1 file .srt duy nhất.
 *
 * @param audioPath  Đường dẫn TUYỆT ĐỐI tới file audio (WAV 16kHz đã trích).
 * @param options    Tùy chọn model / tiến trình / huỷ.
 */
export async function transcribe(
  audioPath: string,
  options: TranscribeOptions = {},
): Promise<TranscribeResult> {
  if (!fs.existsSync(audioPath)) {
    throw new Error(`Không tìm thấy file audio: ${audioPath}`);
  }

  const durationSec = await getMediaDurationSec(audioPath);

  // Audio ngắn hoặc không đọc được duration → đi đường 1 file như cũ
  if (durationSec <= CHUNK_THRESHOLD_SEC) {
    const srtPath = await whisperToSrt(audioPath, options);
    options.onProgress?.(100);
    return { srtPath };
  }

  // ---------- Đường chunked cho audio dài ----------
  const totalChunks = Math.ceil(durationSec / CHUNK_SEC);
  const chunkDir = `${audioPath}.chunks`;
  console.log(
    `[ASR] Audio dài ${durationSec.toFixed(0)}s → chia ${totalChunks} chunk (~${CHUNK_SEC}s, chồng lấp ${CHUNK_OVERLAP_SEC}s)`,
  );

  fs.rmSync(chunkDir, { recursive: true, force: true });
  fs.mkdirSync(chunkDir, { recursive: true });

  try {
    const chunks: ChunkTranscript[] = [];

    for (let i = 0; i < totalChunks; i++) {
      if (options.shouldStop?.()) {
        throw new CancelledError();
      }

      const startSec = Math.max(0, i * CHUNK_SEC - CHUNK_OVERLAP_SEC);
      const durSec = Math.min(CHUNK_SEC + CHUNK_OVERLAP_SEC, durationSec - startSec);
      const chunkPath = path.join(chunkDir, `chunk_${String(i).padStart(4, '0')}.wav`);

      await extractChunkWav(audioPath, chunkPath, startSec, durSec);

      const chunkSrtPath = await whisperToSrt(chunkPath, options);
      const chunkLines = parseSrt(fs.readFileSync(chunkSrtPath, 'utf-8'));
      chunks.push({ offsetMs: Math.round(startSec * 1000), lines: chunkLines });

      // Dọn ngay chunk vừa phiên âm xong để tiết kiệm đĩa với video nhiều giờ
      try {
        fs.unlinkSync(chunkPath);
        fs.unlinkSync(chunkSrtPath);
      } catch {
        // bỏ qua — cleanup tổng ở finally sẽ xử lý phần còn lại
      }

      options.onProgress?.(Math.round(((i + 1) / totalChunks) * 100));
      console.log(`[ASR] Xong chunk ${i + 1}/${totalChunks}`);
    }

    const merged = mergeChunkTranscripts(chunks, CHUNK_OVERLAP_SEC * 1000);
    console.log(`[ASR] Gộp ${chunks.length} chunk → ${merged.length} dòng phụ đề`);

    const srtPath = `${audioPath}.srt`;
    fs.writeFileSync(srtPath, merged.length > 0 ? serializeSrt(merged) : '', 'utf-8');
    return { srtPath };
  } finally {
    try {
      fs.rmSync(chunkDir, { recursive: true, force: true });
    } catch (cleanupErr) {
      console.warn('[ASR] Không xoá được thư mục chunk tạm:', cleanupErr);
    }
  }
}
