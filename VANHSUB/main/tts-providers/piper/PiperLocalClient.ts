import fs from 'fs';
import path from 'path';
import os from 'os';
import crypto from 'crypto';
import { spawn } from 'child_process';
import { kokoroSpeed } from '../kokoro/KokoroClient';

export const PIPER_VI_VOICE = 'vi_VN-vais1000-medium';
const MODEL_SHA = 'ec7c89e2c85f4d1edc24b6120c18aaf1bda614f06b511567eb9c7c0de15e2dab';
const WORKER_HASHES = new Set(['8f4dc9dcd6f5ae298e620ea8efb29d122842a158cc21dcdafa4f327a1b381e25',
  'c40c93ca71d544d77d4f3cdee593a69ef562e73678229539492e24f039bd2dea']);
let verified = '';
let active = false;

/** Only known installation slots; renderer cannot select an arbitrary executable/script. */
function installedRuntime() {
  const local = process.env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local');
  for (const app of ['VANHSUB', 'VANHSUB-InternalBeta-20261016']) {
    const root = path.join(local, app, 'Local TTS Piper');
    if (fs.existsSync(path.join(root, 'venv', 'Scripts', 'python.exe'))) return root;
  }
  throw new Error('Piper tiếng Việt chưa được cài trong thư mục runtime riêng. Không tự tải model hoặc cài Python.');
}

function runtimePaths() {
  const root = installedRuntime(), python = path.join(root, 'venv', 'Scripts', 'python.exe');
  const worker = path.join(root, 'piper_server.py'), model = path.join(root, 'models', `${PIPER_VI_VOICE}.onnx`);
  const configFile = `${model}.json`;
  for (const file of [python, worker, model, configFile]) {
    if (!fs.existsSync(file) || !fs.statSync(file).isFile()) throw new Error('Piper: thiếu runtime/model tiếng Việt đã cài.');
  }
  const stamp = [worker, model, configFile].map(file => `${file}:${fs.statSync(file).mtimeMs}:${fs.statSync(file).size}`).join('|');
  if (stamp !== verified) {
    const hash = (file: string) => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
    if (!WORKER_HASHES.has(hash(worker)) || hash(model) !== MODEL_SHA) throw new Error('Piper: worker/model không khớp bản đã kiểm tra; không chạy.');
    const config = JSON.parse(fs.readFileSync(configFile, 'utf8'));
    if (config.language?.code !== 'vi_VN' || config.audio?.sample_rate !== 22050) throw new Error('Piper: config không thuộc model tiếng Việt 22050 Hz đã kiểm tra.');
    verified = stamp;
  }
  return { python, worker, model };
}

export function piperLocalStatus() {
  try { runtimePaths(); return { ready: true, voice: PIPER_VI_VOICE, language: 'vi_VN', cpuOnly: true }; }
  catch (error) { return { ready: false, voice: PIPER_VI_VOICE, language: 'vi_VN', cpuOnly: true,
    reason: error instanceof Error ? error.message : 'Piper chưa sẵn sàng.' }; }
}

/** Reuse the already installed worker; no server, download, shell command or external provider. */
export async function synthesizePiperSpeech(text: string, voice: string, rate: string, signal?: AbortSignal): Promise<Buffer> {
  if (voice !== PIPER_VI_VOICE) throw new Error('Piper: chọn đúng voice vi_VN-vais1000-medium; không thay giọng ngầm.');
  const speed = kokoroSpeed(rate);
  if (speed < 0.5 || speed > 2 || !text.trim() || text.length > 6000) throw new Error('Piper: mỗi đoạn tối đa 6000 ký tự, tốc độ từ -50% đến +100%.');
  signal?.throwIfAborted();
  if (active) throw new Error('Piper local đang xử lý một tác vụ; hãy chờ hoặc hủy trước khi chạy lại.');
  const { python, worker, model } = runtimePaths();
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'vanhsub-piper-'));
  const output = path.join(workspace, 'speech.wav');
  active = true;
  try {
    await new Promise<void>((resolve, reject) => {
      const child = spawn(python, [worker, '--worker', model, output], { windowsHide: true,
        stdio: ['pipe', 'ignore', 'ignore'], env: { ...process.env, OMP_NUM_THREADS: '2', OPENBLAS_NUM_THREADS: '2',
          HF_HUB_OFFLINE: '1', TRANSFORMERS_OFFLINE: '1', PIP_NO_INDEX: '1', PYTHONDONTWRITEBYTECODE: '1' } });
      let failure: Error | undefined;
      const abort = () => { failure = new Error('Piper: đã hủy tổng hợp.'); child.kill(); };
      const timer = setTimeout(() => { failure = new Error('Piper: quá thời gian tổng hợp 90 giây.'); child.kill(); }, 90000);
      signal?.addEventListener('abort', abort, { once: true });
      child.on('error', () => { failure = new Error('Piper: không khởi chạy được worker đã cài.'); });
      child.stdin.on('error', () => { /* Failure is reported only after the owned child closes. */ });
      child.on('spawn', () => { if (signal?.aborted) abort(); });
      child.on('close', code => {
        clearTimeout(timer); signal?.removeEventListener('abort', abort);
        failure || code !== 0 ? reject(failure || new Error('Piper: tổng hợp thất bại; không chuyển engine.')) : resolve();
      });
      child.stdin.end(JSON.stringify({ input: text, speed }));
    });
    signal?.throwIfAborted();
    if (!fs.existsSync(output) || fs.statSync(output).size > 32 * 1024 * 1024) throw new Error('Piper: audio trả về không hợp lệ.');
    return fs.readFileSync(output);
  } finally { active = false; fs.rmSync(workspace, { recursive: true, force: true }); }
}
