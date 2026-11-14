import path from 'path';
import fs from 'fs';
import { spawn } from 'child_process';
import { SettingsStore } from '../store/settingsStore';

export interface PythonEnvInfo {
  executable: string;
  version?: string;
  hasTorch: boolean;
  hasCuda: boolean;
  hasFasterWhisper: boolean;
  hasCtranslate2: boolean;
  hasPyannote: boolean;
  hasDemucs: boolean;
  hasRapidOcr: boolean;
}

/**
 * Tìm đường dẫn trình thực thi Python:
 * 1. Từ cài đặt người dùng (SettingsStore: pythonPath)
 * 2. Từ biến môi trường PYTHON_PATH hoặc VIRTUAL_ENV
 * 3. Từ thư mục .venv cục bộ
 * 4. Fallback về lệnh 'python' trong PATH
 */
export function resolvePythonExecutable(): string {
  try {
    const configured = SettingsStore.get('pythonPath');
    if (configured && typeof configured === 'string' && configured.trim().length > 0) {
      const trimmed = configured.trim();
      if (fs.existsSync(trimmed)) {
        return trimmed;
      }
    }
  } catch {}

  if (process.env.PYTHON_PATH && fs.existsSync(process.env.PYTHON_PATH)) {
    return process.env.PYTHON_PATH;
  }

  if (process.env.VIRTUAL_ENV) {
    const venvBin =
      process.platform === 'win32'
        ? path.join(process.env.VIRTUAL_ENV, 'Scripts', 'python.exe')
        : path.join(process.env.VIRTUAL_ENV, 'bin', 'python');
    if (fs.existsSync(venvBin)) {
      return venvBin;
    }
  }

  const localVenv =
    process.platform === 'win32'
      ? path.join(process.cwd(), '.venv', 'Scripts', 'python.exe')
      : path.join(process.cwd(), '.venv', 'bin', 'python');
  if (fs.existsSync(localVenv)) {
    return localVenv;
  }

  return 'python';
}

/**
 * Kiểm tra xem một file thực thi Python có phản hồi hay không
 */
export function checkPythonExecutable(binPath: string): Promise<boolean> {
  return new Promise((resolve) => {
    try {
      const child = spawn(binPath, ['--version'], { windowsHide: true });
      const timer = setTimeout(() => {
        try {
          child.kill();
        } catch {}
        resolve(false);
      }, 3000);

      child.on('error', () => {
        clearTimeout(timer);
        resolve(false);
      });

      child.on('exit', (code) => {
        clearTimeout(timer);
        resolve(code === 0);
      });
    } catch {
      resolve(false);
    }
  });
}

/**
 * Thăm dò môi trường Python hiện tại, kiểm tra sự tồn tại của Torch, CUDA, Faster-Whisper, v.v.
 */
export async function probePythonEnv(): Promise<PythonEnvInfo> {
  const executable = resolvePythonExecutable();
  const defaultInfo: PythonEnvInfo = {
    executable,
    hasTorch: false,
    hasCuda: false,
    hasFasterWhisper: false,
    hasCtranslate2: false,
    hasPyannote: false,
    hasDemucs: false,
    hasRapidOcr: false,
  };

  const probeScript = `
import sys, json, importlib.util

def check_pkg(name):
    try:
        return importlib.util.find_spec(name) is not None
    except Exception:
        return False

info = {
    "version": sys.version.split()[0],
    "hasTorch": check_pkg("torch"),
    "hasCuda": False,
    "hasFasterWhisper": check_pkg("faster_whisper"),
    "hasCtranslate2": check_pkg("ctranslate2"),
    "hasPyannote": check_pkg("pyannote.audio") or check_pkg("pyannote"),
    "hasDemucs": check_pkg("demucs"),
    "hasRapidOcr": check_pkg("rapidocr"),
}

if info["hasTorch"]:
    try:
        import torch
        info["hasCuda"] = bool(torch.cuda.is_available())
    except Exception:
        pass

if not info["hasCuda"] and info["hasCtranslate2"]:
    try:
        import ctranslate2
        info["hasCuda"] = bool(ctranslate2.get_cuda_device_count() > 0)
    except Exception:
        pass

print(json.dumps(info))
`;

  return new Promise<PythonEnvInfo>((resolve) => {
    let stdoutData = '';
    try {
      const child = spawn(executable, ['-c', probeScript], { windowsHide: true });
      const timer = setTimeout(() => {
        try {
          child.kill();
        } catch {}
        resolve(defaultInfo);
      }, 20000);

      child.stdout.on('data', (d) => {
        stdoutData += d.toString();
      });

      child.on('error', () => {
        clearTimeout(timer);
        resolve(defaultInfo);
      });

      child.on('exit', (code) => {
        clearTimeout(timer);
        if (code !== 0) {
          return resolve(defaultInfo);
        }
        try {
          const parsed = JSON.parse(stdoutData.trim().split('\n').pop() || '{}');
          resolve({
            executable,
            version: parsed.version,
            hasTorch: Boolean(parsed.hasTorch),
            hasCuda: Boolean(parsed.hasCuda),
            hasFasterWhisper: Boolean(parsed.hasFasterWhisper),
            hasCtranslate2: Boolean(parsed.hasCtranslate2),
            hasPyannote: Boolean(parsed.hasPyannote),
            hasDemucs: Boolean(parsed.hasDemucs),
            hasRapidOcr: Boolean(parsed.hasRapidOcr),
          });
        } catch {
          resolve(defaultInfo);
        }
      });
    } catch {
      resolve(defaultInfo);
    }
  });
}

/**
 * Kiểm tra tính khả dụng của Faster-Whisper và khả năng tăng tốc GPU CUDA
 */
export async function checkFasterWhisperAvailable(): Promise<{
  available: boolean;
  useCuda: boolean;
  reason?: string;
}> {
  try {
    const env = await probePythonEnv();
    if (!env.hasFasterWhisper || !env.hasCtranslate2) {
      const missing: string[] = [];
      if (!env.hasFasterWhisper) missing.push('faster-whisper');
      if (!env.hasCtranslate2) missing.push('ctranslate2');
      return {
        available: false,
        useCuda: false,
        reason: `Môi trường Python chưa cài đặt gói: ${missing.join(', ')}. Hãy chạy "pip install faster-whisper".`,
      };
    }

    return {
      available: true,
      useCuda: env.hasCuda,
      reason: env.hasCuda
        ? 'Faster-Whisper khả dụng và hỗ trợ tăng tốc GPU CUDA.'
        : 'Faster-Whisper khả dụng (chạy CPU int8, không có CUDA).',
    };
  } catch (err: any) {
    return {
      available: false,
      useCuda: false,
      reason: `Lỗi kiểm tra môi trường: ${err?.message || String(err)}`,
    };
  }
}
