import fs from 'fs';
import os from 'os';
import path from 'path';
import Store from 'electron-store';
import { safeStorage } from 'electron';
import { encryptPlatformSecret } from '../security/secretStorage';
import { planLegacySecretMigration } from '../security/legacySecrets';

/**
 * Chiến lược tìm phụ đề khi quét OCR:
 * - auto:    quét TOÀN khung, tự phân loại band nào là phụ đề (bỏ watermark,
 *            logo, chữ trên cảnh) — không phụ thuộc vị trí phụ đề
 * - bottom:  chỉ quét dải 30% đáy khung (nhanh nhất)
 * - full:    quét toàn khung, giữ TẤT CẢ text tìm được
 * - custom:  quét vùng người dùng kéo chọn (ocrCustomRegion)
 */
export type OcrMode = 'auto' | 'bottom' | 'full' | 'custom';

/** Vùng quét custom — toạ độ theo tỷ lệ 0-1 của khung hình (x,y = đỉnh trái) */
export interface OcrCustomRegion {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface AppSettings {
  /** Lưu dưới dạng đã mã hoá (prefix 'enc:v1:' + base64) hoặc plaintext fallback */
  geminiApiKey: string;
  geminiModel: string;
  targetLanguage: string;
  /** Model ASR mặc định cho task mới (fallback của task.asrModel) */
  asrModel: string;
  /** Engine ASR mặc định: 'faster-whisper' | 'whisper-cpp' */
  asrEngine?: 'faster-whisper' | 'whisper-cpp';
  /** Thiết bị chạy ASR: 'auto' | 'cuda' | 'cpu' */
  asrDevice?: 'auto' | 'cuda' | 'cpu';
  /** Bật tự động nhận diện người nói (Speaker Diarization) */
  enableDiarization?: boolean;
  /** HuggingFace User Access Token (tuỳ chọn cho mô hình pyannote diarization) */
  hfToken?: string;
  /** Thư mục xuất video mặc định; rỗng = lưu cạnh file gốc */
  exportDir: string;
  /** Số dòng phụ đề mỗi request dịch */
  translateBatchSize: number;
  /** Số request dịch chạy song song */
  translateConcurrency: number;
  /** Tự động dịch ngay sau khi phiên âm xong */
  autoTranslateAfterAsr: boolean;
  /** VietTTS endpoint URL (mặc định: http://localhost:6006 cho Docker local) */
  vietTtsEndpoint: string;
  /** Giọng nói mặc định cho TTS */
  ttsVoice: string;
  /** Tốc độ TTS (0.5 - 2.0) */
  ttsSpeed: number;
  /** Explicit permission to shorten spoken text; subtitle text stays unchanged. */
  ttsAllowShortening: boolean;
  /** Ngôn ngữ quét OCR phụ đề cứng (mã tessdata: vie, eng, …) */
  ocrLanguage: string;
  /** Số khung hình quét mỗi giây khi OCR (0.5 - 5) */
  ocrFps: number;
  /** Chiến lược tìm phụ đề khi quét OCR (xem OcrMode) */
  ocrMode: OcrMode;
  /** Vùng quét khi ocrMode = custom (tỷ lệ 0-1); null = chưa chọn */
  ocrCustomRegion: OcrCustomRegion | null;
  /** Tương thích ngược với ocrRegion cũ */
  ocrRegion?: string;
  /**
   * Chạy lượt OCR thứ hai bằng Tesseract trên cùng crop đã enhance để đối
   * chiếu kết quả với PaddleOCR (chính xác hơn nhưng chậm hơn ~30-40%).
   */
  ocrDualEngine: boolean;
  /** Bảng thuật ngữ dịch nhất quán — mỗi dòng "gốc = bản dịch" */
  glossary: string;
  /** Hướng dẫn văn phong/xưng hô đưa vào prompt dịch (tự do) */
  translationStyleGuide: string;
  /** Đã xem popup hướng dẫn cho người dùng mới (không hiện lại) */
  onboardingCompleted: boolean;
  /** Chế độ tạo video Google Veo: 'free_session' | 'api_key' | 'simulation' */
  veoMode: 'free_session' | 'api_key' | 'simulation';
  /** Chuỗi Cookie phiên đăng nhập Google Labs (đã mã hóa an toàn) */
  veoSessionCookie: string;
  /** Auth / Bearer token Google Labs (đã mã hóa an toàn) */
  veoSessionAuthToken: string;
  /** Email tài khoản Google đăng nhập hiển thị */
  veoAccountEmail: string;
  /** Trạng thái session: active | expired | unauthenticated | rate_limited | captcha_required | out_of_credits | unknown */
  veoSessionStatus: 'active' | 'expired' | 'unauthenticated' | 'rate_limited' | 'captcha_required' | 'out_of_credits' | 'unknown';
  /** Thời điểm kiểm tra trạng thái session lần cuối (timestamp ms) */
  veoLastChecked: number;
  /** Thời gian hồi chiêu chống spam (giây, mặc định 45) */
  veoCooldownSeconds: number;
  /** Đường dẫn tuỳ chỉnh tới trình thực thi Python (nếu rỗng, tự động dò trong PATH / venv) */
  pythonPath?: string;
  /** Số credit Google Flow gần nhất đọc được (hoặc null nếu chưa xác định) */
  veoFlowCredits: number | null;
  /** Thời điểm kiểm tra credit Google Flow lần cuối (timestamp ms) */
  veoFlowCreditsCheckedAt: number;
  /** Link dự án Google Flow đang kích hoạt (vd: https://flow.google.com/project/...) */
  flowProjectUrl?: string;
}

// Lazy singleton — cùng pattern với taskStore.ts để tránh lỗi
// "Please specify the projectName option" khi app chưa ready.
let _store: Store<AppSettings> | null = null;

function getStore(): Store<AppSettings> {
  if (!_store) {
    let cwd: string | undefined = process.env.VANHSUB_SETTINGS_DIR;
    if (!cwd) {
      try {
        const electron = require('electron');
        const electronApp = electron.app;
        if (!electronApp?.name && !electronApp?.getPath) {
          cwd = path.join(os.tmpdir(), 'vanhsub-settings');
        }
      } catch {
        cwd = path.join(os.tmpdir(), 'vanhsub-settings');
      }
    }

    _store = new Store<AppSettings>({
      name: 'vanhsub-settings',
      // Cho phép script test (tsx ngoài Electron) trỏ đúng vào thư mục settings
      // của app — khi có cwd, electron-store không cần tự dò projectName nữa.
      ...(cwd ? { cwd } : {}),
      defaults: {
        geminiApiKey: '',
        geminiModel: 'gemini-3.8-flash',
        targetLanguage: 'vi',
        asrModel: 'base',
        asrEngine: 'faster-whisper',
        asrDevice: 'auto',
        enableDiarization: false,
        hfToken: '',
        exportDir: '',
        translateBatchSize: 15,
        translateConcurrency: 1,
        autoTranslateAfterAsr: false,
        vietTtsEndpoint: 'http://localhost:6006',
        ttsVoice: 'vi-VN-HoaiMyNeural',
        ttsSpeed: 1.0,
        ttsAllowShortening: false,
        ocrLanguage: 'vie',
        ocrFps: 2,
        ocrMode: 'auto',
        ocrCustomRegion: null,
        ocrDualEngine: true,
        glossary: '',
        translationStyleGuide: '',
        onboardingCompleted: false,
        pythonPath: '',
        veoMode: 'free_session',
        veoSessionCookie: '',
        veoSessionAuthToken: '',
        veoAccountEmail: '',
        veoSessionStatus: 'unauthenticated',
        veoLastChecked: 0,
        veoCooldownSeconds: 8,
        veoFlowCredits: null,
        veoFlowCreditsCheckedAt: 0,
        flowProjectUrl: '',
      },
    });

    // Tự động khôi phục cấu hình từ thư mục userData cũ (vanhsub -> vanhstudio) nếu store mới đang ở mặc định
    if (!cwd && _store.path) {
      try {
        const currentDir = path.dirname(_store.path);
        const dirName = path.basename(currentDir);
        if (/^vanhstudio/i.test(dirName)) {
          const legacyDir = path.join(path.dirname(currentDir), dirName.replace(/^vanhstudio/i, 'vanhsub'));
          const legacySettingsPath = path.join(legacyDir, 'vanhsub-settings.json');
          if (fs.existsSync(legacySettingsPath)) {
            const legacyData = JSON.parse(fs.readFileSync(legacySettingsPath, 'utf-8'));
            if (legacyData && typeof legacyData === 'object') {
              const updates: Partial<AppSettings> = {};
              if (_store.get('ocrLanguage') === 'vie' && legacyData.ocrLanguage && legacyData.ocrLanguage !== 'vie') {
                updates.ocrLanguage = legacyData.ocrLanguage;
              }
              if (_store.get('asrModel') === 'base' && legacyData.asrModel && legacyData.asrModel !== 'base') {
                updates.asrModel = legacyData.asrModel;
              }
              if (!_store.get('glossary') && legacyData.glossary) {
                updates.glossary = legacyData.glossary;
              }
              if (!_store.get('translationStyleGuide') && legacyData.translationStyleGuide) {
                updates.translationStyleGuide = legacyData.translationStyleGuide;
              }
              if (!_store.get('exportDir') && legacyData.exportDir) {
                updates.exportDir = legacyData.exportDir;
              }
              if (Object.keys(updates).length > 0) {
                _store.set(updates as any);
              }
            }
          }
        }
      } catch {
        // Bỏ qua lỗi đọc thư mục cũ
      }
    }
  }
  return _store;
}

// =========================================================================
// MÃ HOÁ SECRET — dùng safeStorage (DPAPI trên Windows).
// Chỉ gọi sau khi app ready (tất cả IPC handler đều post-ready).
// =========================================================================

const ENC_PREFIX = 'enc:v1:';
const ENCRYPTED_KEYS = new Set(['geminiApiKey', 'veoSessionCookie', 'veoSessionAuthToken', 'hfToken']);

function encryptSecret(plain: string): string {
  return encryptPlatformSecret(plain, safeStorage);
}

function decryptSecret(stored: string): string {
  if (!stored) return '';
  if (stored.startsWith('enc:v1:headless:')) return Buffer.from(stored.slice('enc:v1:headless:'.length), 'base64').toString('utf8');
  if (!stored.startsWith(ENC_PREFIX)) return stored; // dữ liệu cũ chưa mã hoá
  try {
    return safeStorage.decryptString(Buffer.from(stored.slice(ENC_PREFIX.length), 'base64'));
  } catch {
    return '';
  }
}

export const SettingsStore = {
  migrateLegacySecrets(): number {
    const store = getStore();
    const replacements = planLegacySecretMigration(store.store as any, ENCRYPTED_KEYS, encryptSecret, decryptSecret);
    const count = Object.keys(replacements).length;
    if (count) store.set(replacements as any);
    return count;
  },
  /** get() tự động giải mã các secret (geminiApiKey, veoSessionCookie, veoSessionAuthToken) */
  get<K extends keyof AppSettings>(key: K): AppSettings[K] {
    const raw = getStore().get(key);
    if (key === 'geminiModel' && typeof raw === 'string' && /^gemini-(1\.5|2\.0|2\.5)-/i.test(raw.trim())) {
      return 'gemini-3.5-flash-lite' as AppSettings[K];
    }
    if (key === 'geminiModel' && (raw === 'gemini-flash-latest' || !raw)) {
      return 'gemini-3.8-flash' as AppSettings[K];
    }
    if (ENCRYPTED_KEYS.has(key)) {
      return decryptSecret(String(raw ?? '')) as AppSettings[K];
    }
    return raw;
  },

  /** set() tự động mã hoá các secret trước khi lưu */
  set<K extends keyof AppSettings>(key: K, value: AppSettings[K]): void {
    if (ENCRYPTED_KEYS.has(key)) {
      getStore().set(key, encryptSecret(String(value ?? '')) as AppSettings[K]);
      return;
    }
    getStore().set(key, value);
  },

  hasGeminiKey(): boolean {
    return getStore().get('geminiApiKey').trim().length > 0;
  },

  hasVeoSession(): boolean {
    const cookie = decryptSecret(String(getStore().get('veoSessionCookie') ?? '')).trim();
    const token = decryptSecret(String(getStore().get('veoSessionAuthToken') ?? '')).trim();
    return cookie.length > 0 || token.length > 0;
  },
};
