import React, { useEffect, useRef, useState } from 'react';
import {
  CheckCircle2,
  Cpu,
  FolderOpen,
  Globe2,
  HardDrive,
  Key,
  Languages,
  Layers,
  Loader2,
  Mic,
  RefreshCw,
  Save,
  ScanText,
  Sparkles,
  Trash2,
  Volume2,
  Zap,
} from 'lucide-react';
import ASRModelSelector from './ASRModelSelector';
import type { SettingKey, OcrMode } from '../types/electron';

interface ModelInfo {
  name: string;
  fileName: string;
  size: string;
  filePath: string;
}

export interface GeminiModelOption {
  id: string;
  name: string;
  badge: string;
  badgeColor: string;
  desc: string;
  isRecommended?: boolean;
}

export interface GeminiModelGroup {
  group: string;
  models: GeminiModelOption[];
}

export const GEMINI_MODEL_GROUPS: GeminiModelGroup[] = [
  {
    group: 'Model Free khuyên dùng & Tốc độ cao',
    models: [
      {
        id: 'gemini-3.8-flash',
        name: 'Gemini 3.8 Flash',
        badge: 'Khuyên dùng • Thế hệ mới',
        badgeColor: 'bg-accent-tint text-accent border-accent/40',
        desc: 'Model thế hệ 3.8 Flash mới nhất, ngữ cảnh 1M token, tốc độ cao, dịch thuật và lý luận phụ đề tối ưu.',
        isRecommended: true,
      },
      {
        id: 'gemini-2.5-flash',
        name: 'Gemini 2.5 Flash',
        badge: 'Phổ biến • Free',
        badgeColor: 'bg-blue-500/20 text-blue-400 border-blue-500/40',
        desc: 'Model ổn định, tốc độ nhanh, dịch thuật & hiệu đính chuẩn xác. Miễn phí (15 RPM / 1M TPM).',
      },
      {
        id: 'gemini-2.5-flash-lite',
        name: 'Gemini 2.5 Flash Lite',
        badge: 'Siêu nhanh • Free',
        badgeColor: 'bg-emerald-500/20 text-emerald-400 border-emerald-500/40',
        desc: 'Bản siêu nhẹ & siêu tốc độ, tối ưu quota/rate limit khi dịch khối lượng lớn. Miễn phí (15 RPM).',
      },
      {
        id: 'gemini-2.0-flash',
        name: 'Gemini 2.0 Flash',
        badge: 'Rất ổn định • Free',
        badgeColor: 'bg-blue-500/20 text-blue-400 border-blue-500/40',
        desc: 'Bản Flash 2.0 chuẩn, độ trễ thấp, dịch tự nhiên và ổn định cao. Miễn phí (15 RPM).',
      },
      {
        id: 'gemini-2.0-flash-lite',
        name: 'Gemini 2.0 Flash Lite',
        badge: 'Gọn nhẹ • Free',
        badgeColor: 'bg-teal-500/20 text-teal-400 border-teal-500/40',
        desc: 'Phiên bản Flash 2.0 rút gọn, phản hồi tức thì, tiết kiệm tài nguyên. Miễn phí (15 RPM).',
      },
      {
        id: 'gemini-1.5-flash',
        name: 'Gemini 1.5 Flash',
        badge: 'Kinh điển • Free',
        badgeColor: 'bg-slate-500/20 text-text border-slate-500/40',
        desc: 'Bản 1.5 Flash kinh điển, ổn định dài lâu, dịch phụ đề mượt mà. Miễn phí (15 RPM).',
      },
    ],
  },
  {
    group: 'Model Pro — Dịch thuật & Hiệu đính chuyên sâu',
    models: [
      {
        id: 'gemini-2.5-pro',
        name: 'Gemini 2.5 Pro',
        badge: 'Chính xác cao nhất',
        badgeColor: 'bg-amber-500/20 text-amber-400 border-amber-500/40',
        desc: 'Hiểu sâu ngữ cảnh phức tạp, câu văn cổ trang/chuyên ngành. Miễn phí (2 RPM).',
      },
      {
        id: 'gemini-1.5-pro',
        name: 'Gemini 1.5 Pro',
        badge: 'Pro 1.5 • Free',
        badgeColor: 'bg-amber-500/20 text-amber-400 border-amber-500/40',
        desc: 'Bản 1.5 Pro mạnh mẽ, dịch chi tiết và tự nhiên. Miễn phí.',
      },
    ],
  },
  {
    group: 'Tự động cập nhật bản mới nhất (Alias)',
    models: [
      {
        id: 'gemini-flash-latest',
        name: 'gemini-flash-latest',
        badge: 'Auto Flash',
        badgeColor: 'bg-accent-tint text-accent border-accent/40',
        desc: 'Luôn tự động trỏ tới bản Flash mới nhất của Google.',
      },
      {
        id: 'gemini-pro-latest',
        name: 'gemini-pro-latest',
        badge: 'Auto Pro',
        badgeColor: 'bg-accent-tint text-accent border-accent/40',
        desc: 'Luôn tự động trỏ tới bản Pro mới nhất của Google.',
      },
    ],
  },
];

export const ALL_PRESET_MODELS = GEMINI_MODEL_GROUPS.flatMap((g) => g.models);

export default function SettingsPage() {
  const [apiKey, setApiKey] = useState('');
  const [geminiModel, setGeminiModel] = useState('gemini-2.5-flash');
  const [showCustomModelInput, setShowCustomModelInput] = useState(false);
  const [geminiSavedFlash, setGeminiSavedFlash] = useState(false);
  const [targetLanguage, setTargetLanguage] = useState('vi');
  const [asrModel, setAsrModel] = useState('base');
  const [exportDir, setExportDir] = useState('');
  const [translateBatchSize, setTranslateBatchSize] = useState(15);
  const [translateConcurrency, setTranslateConcurrency] = useState(1);
  const [autoTranslateAfterAsr, setAutoTranslateAfterAsr] = useState(false);
  const [ttsVoice, setTtsVoice] = useState('BV074_streaming');
  const [ttsSpeed, setTtsSpeed] = useState(1.0);
  const [ttsAllowShortening, setTtsAllowShortening] = useState(false);
  const [ocrLanguage, setOcrLanguage] = useState('vie');
  const [ocrFps, setOcrFps] = useState(2);
  const [ocrMode, setOcrMode] = useState<OcrMode>('auto');
  const [ocrDualEngine, setOcrDualEngine] = useState(true);
  const [glossary, setGlossary] = useState('');
  const [translationStyleGuide, setTranslationStyleGuide] = useState('');

  const [modelsList, setModelsList] = useState<ModelInfo[]>([]);
  const [modelsDir, setModelsDir] = useState<{ path: string; exists: boolean } | null>(null);
  const [loadingModels, setLoadingModels] = useState(false);

  const [isSaving, setIsSaving] = useState(false);
  const [savedMessage, setSavedMessage] = useState('');
  const [errorMessage, setErrorMessage] = useState('');
  const [showApiKey, setShowApiKey] = useState(false);

  // TikTok TTS thử nghiệm — sessionid KHÔNG được load lại vào input (chỉ biết has/chưa)
  const [tiktokSessionInput, setTiktokSessionInput] = useState('');
  const [tiktokHasSession, setTiktokHasSession] = useState(false);
  const [tiktokBusy, setTiktokBusy] = useState<'save' | 'validate' | 'remove' | 'preview' | null>(null);
  const [tiktokStatusMsg, setTiktokStatusMsg] = useState('');
  const [tiktokStatusOk, setTiktokStatusOk] = useState(false);
  const tiktokPreviewRef = useRef<HTMLAudioElement | null>(null);

  const [autoSavedFlash, setAutoSavedFlash] = useState(false);
  const autoSaveTimerRef = useRef<number | null>(null);
  const customModelDebounceRef = useRef<NodeJS.Timeout | null>(null);

  // Quản lý Bộ nhớ tạm & Dọn dẹp Ổ đĩa (Workflow Storage GC)
  const [tempStats, setTempStats] = useState<{ totalSizeMb: number; folderCount: number; fileCount: number; tempDir: string } | null>(null);
  const [isCleaningTemp, setIsCleaningTemp] = useState(false);
  const [cleanTempMessage, setCleanTempMessage] = useState('');

  const loadTempStats = async () => {
    if (typeof window === 'undefined' || !window.vanhsub?.workflow?.getTempStorageStats) return;
    try {
      const stats = await window.vanhsub.workflow.getTempStorageStats();
      setTempStats(stats);
    } catch {}
  };

  const handleCleanTemp = async () => {
    if (typeof window === 'undefined' || !window.vanhsub?.workflow?.cleanTempCache) return;
    setIsCleaningTemp(true);
    setCleanTempMessage('');
    try {
      const res = await window.vanhsub.workflow.cleanTempCache(0);
      setCleanTempMessage(`Đã dọn dẹp ${res.deletedFolders} thư mục, giải phóng ${res.freedMb} MB!`);
      await loadTempStats();
      setTimeout(() => setCleanTempMessage(''), 4000);
    } catch (err: any) {
      setCleanTempMessage(`Lỗi: ${err?.message || err}`);
    } finally {
      setIsCleaningTemp(false);
    }
  };

  const autoSaveSetting = async (key: SettingKey, value: unknown) => {
    try {
      await window.vanhsub.settings.set(key, value);
      setAutoSavedFlash(true);
      if (autoSaveTimerRef.current) window.clearTimeout(autoSaveTimerRef.current);
      autoSaveTimerRef.current = window.setTimeout(() => setAutoSavedFlash(false), 2500);
    } catch (err) {
      console.error(`Lỗi khi tự lưu setting ${key}:`, err);
    }
  };

  const handleSelectGeminiModel = (modelId: string) => {
    if (modelId === 'custom') {
      setShowCustomModelInput(true);
      return;
    }
    setGeminiModel(modelId);
    setShowCustomModelInput(false);
    void autoSaveSetting('geminiModel', modelId);
  };

  useEffect(() => {
    if (typeof window === 'undefined' || !window.vanhsub?.settings) return;

    Promise.all([
      window.vanhsub.settings.get('geminiApiKey'),
      window.vanhsub.settings.get('geminiModel'),
      window.vanhsub.settings.get('targetLanguage'),
      window.vanhsub.settings.get('asrModel'),
      window.vanhsub.settings.get('exportDir'),
      window.vanhsub.settings.get('translateBatchSize'),
      window.vanhsub.settings.get('translateConcurrency'),
      window.vanhsub.settings.get('autoTranslateAfterAsr'),
      window.vanhsub.settings.get('ttsVoice'),
      window.vanhsub.settings.get('ttsSpeed'),
      window.vanhsub.settings.get('ocrLanguage'),
      window.vanhsub.settings.get('ocrFps'),
      window.vanhsub.settings.get('ocrMode'),
      window.vanhsub.settings.get('ocrDualEngine'),
      window.vanhsub.settings.get('glossary'),
      window.vanhsub.settings.get('translationStyleGuide'),
      window.vanhsub.settings.get('ttsAllowShortening'),
    ])
      .then(([key, gModel, lang, aModel, expDir, batchSize, concurrency, autoTrans, voice, spd, oLang, oFps, oMode, oDual, glossaryVal, styleVal, allowShortening]) => {
        setTtsAllowShortening(Boolean(allowShortening));
        if (key) setApiKey(key);
        if (gModel) {
          setGeminiModel(gModel);
          if (!ALL_PRESET_MODELS.some((m) => m.id === gModel)) {
            setShowCustomModelInput(true);
          }
        }
        if (lang) setTargetLanguage(lang);
        if (aModel) setAsrModel(aModel);
        if (expDir) setExportDir(expDir);
        if (batchSize) setTranslateBatchSize(Number(batchSize));
        if (concurrency) setTranslateConcurrency(Number(concurrency) || 1);
        if (autoTrans !== undefined) setAutoTranslateAfterAsr(Boolean(autoTrans));
        if (voice) setTtsVoice(String(voice));
        if (spd) setTtsSpeed(Number(spd) || 1.0);
        if (oLang) setOcrLanguage(String(oLang));
        if (oFps) setOcrFps(Number(oFps) || 2);
        if (oMode && ['auto', 'bottom', 'full', 'custom'].includes(String(oMode))) {
          setOcrMode(oMode as OcrMode);
        }
        if (oDual !== undefined) setOcrDualEngine(oDual !== false);
        if (glossaryVal !== undefined) setGlossary(String(glossaryVal || ''));
        if (styleVal !== undefined) setTranslationStyleGuide(String(styleVal || ''));
      })
      .catch((err) => console.error('Lỗi khi nạp cài đặt:', err));

    loadModelsList();
    loadTempStats();
  }, []);

  useEffect(() => {
    if (typeof window === 'undefined' || !window.vanhsub?.settings?.onChange) return;
    let mounted = true;
    const setters: Record<string, (value: any) => void> = {
      geminiApiKey: setApiKey, geminiModel: setGeminiModel, targetLanguage: setTargetLanguage,
      asrModel: setAsrModel, exportDir: setExportDir, translateBatchSize: setTranslateBatchSize,
      translateConcurrency: setTranslateConcurrency, autoTranslateAfterAsr: setAutoTranslateAfterAsr,
      ttsVoice: setTtsVoice, ttsSpeed: setTtsSpeed, ocrLanguage: setOcrLanguage,
      ttsAllowShortening: setTtsAllowShortening,
      ocrFps: setOcrFps, ocrMode: setOcrMode, ocrDualEngine: setOcrDualEngine,
      glossary: setGlossary, translationStyleGuide: setTranslationStyleGuide,
    };
    const unsubscribe = window.vanhsub.settings.onChange((key) => {
      if (setters[key]) window.vanhsub.settings.get(key).then((value) => {
        if (mounted) setters[key](value);
      }).catch(() => {});
    });
    return () => { mounted = false; unsubscribe(); };
  }, []);

  const loadModelsList = async () => {
    if (typeof window === 'undefined' || !window.vanhsub?.models) return;
    setLoadingModels(true);
    try {
      const [list, dir] = await Promise.all([
        window.vanhsub.models.list(),
        window.vanhsub.models.directory?.() ?? Promise.resolve(null),
      ]);
      setModelsList(list || []);
      if (dir) setModelsDir(dir);
    } catch (err) {
      console.error('Lỗi khi tải danh sách model:', err);
    } finally {
      setLoadingModels(false);
    }
  };

  const handleSaveSettings = async () => {
    setIsSaving(true);
    setSavedMessage('');
    setErrorMessage('');
    try {
      await Promise.all([
        window.vanhsub.settings.set('geminiApiKey', apiKey),
        window.vanhsub.settings.set('geminiModel', geminiModel),
        window.vanhsub.settings.set('targetLanguage', targetLanguage),
        window.vanhsub.settings.set('asrModel', asrModel),
        window.vanhsub.settings.set('exportDir', exportDir),
        window.vanhsub.settings.set('translateBatchSize', Number(translateBatchSize)),
        window.vanhsub.settings.set('translateConcurrency', Math.min(8, Math.max(1, Math.round(Number(translateConcurrency) || 1)))),
        window.vanhsub.settings.set('autoTranslateAfterAsr', autoTranslateAfterAsr),
        window.vanhsub.settings.set('ttsVoice', ttsVoice),
        window.vanhsub.settings.set('ttsSpeed', Number(ttsSpeed) || 1.0),
        window.vanhsub.settings.set('ttsAllowShortening', ttsAllowShortening),
        window.vanhsub.settings.set('ocrLanguage', ocrLanguage),
        window.vanhsub.settings.set('ocrFps', Math.min(5, Math.max(0.5, Number(ocrFps) || 2))),
        window.vanhsub.settings.set('ocrMode', ocrMode),
        window.vanhsub.settings.set('ocrRegion', ocrMode === 'bottom' ? 'bottom' : 'full'),
        window.vanhsub.settings.set('ocrDualEngine', ocrDualEngine),
        window.vanhsub.settings.set('glossary', glossary),
        window.vanhsub.settings.set('translationStyleGuide', translationStyleGuide),
      ]);
      setSavedMessage('Đã lưu tất cả cài đặt thành công!');
      setTimeout(() => setSavedMessage(''), 3000);
    } catch (err: any) {
      setErrorMessage(err?.message || 'Không thể lưu cài đặt.');
    } finally {
      setIsSaving(false);
    }
  };

  const handleSaveGeminiSettings = async () => {
    try {
      await Promise.all([
        window.vanhsub.settings.set('geminiApiKey', apiKey),
        window.vanhsub.settings.set('geminiModel', geminiModel),
        window.vanhsub.settings.set('translateBatchSize', Number(translateBatchSize)),
        window.vanhsub.settings.set('targetLanguage', targetLanguage),
        window.vanhsub.settings.set('translateConcurrency', Math.min(8, Math.max(1, Math.round(Number(translateConcurrency) || 1)))),
        window.vanhsub.settings.set('autoTranslateAfterAsr', autoTranslateAfterAsr),
      ]);
      setGeminiSavedFlash(true);
      setTimeout(() => setGeminiSavedFlash(false), 2500);
      setSavedMessage('Đã lưu cấu hình Gemini AI thành công!');
      setTimeout(() => setSavedMessage(''), 3000);
    } catch (err: any) {
      setErrorMessage(err?.message || 'Không thể lưu cấu hình Gemini.');
    }
  };

  const handleChooseExportDir = async () => {
    try {
      const dir = await window.vanhsub.dialog.chooseDirectory();
      if (dir) {
        setExportDir(dir);
      }
    } catch (err) {
      console.error('Lỗi khi chọn thư mục:', err);
    }
  };

  // ---- TikTok TTS (thử nghiệm) ----
  const loadTiktokStatus = async () => {
    try {
      const res = await window.vanhsub.tiktokTts.status();
      setTiktokHasSession(Boolean(res?.hasSession));
    } catch {
      setTiktokHasSession(false);
    }
  };

  useEffect(() => {
    void loadTiktokStatus();
  }, []);

  const handleTiktokSave = async () => {
    const value = tiktokSessionInput.trim();
    setTiktokStatusMsg('');
    if (!value) {
      setTiktokStatusOk(false);
      setTiktokStatusMsg('Chưa nhập sessionid — dán giá trị cookie "sessionid" từ tiktok.com.');
      return;
    }
    setTiktokBusy('save');
    try {
      const res = await window.vanhsub.tiktokTts.saveSession(value);
      if (res.ok) {
        setTiktokSessionInput('');
        setTiktokHasSession(true);
        setTiktokStatusOk(true);
        setTiktokStatusMsg('Đã lưu session (mã hoá trên máy). Bấm "Kiểm tra" để xác thực với TikTok.');
      } else {
        setTiktokStatusOk(false);
        setTiktokStatusMsg(res.error || 'Không lưu được session.');
      }
    } finally {
      setTiktokBusy(null);
    }
  };

  const handleTiktokValidate = async () => {
    setTiktokStatusMsg('');
    setTiktokBusy('validate');
    try {
      const res = await window.vanhsub.tiktokTts.validate();
      setTiktokStatusOk(res.valid);
      setTiktokStatusMsg(res.detail);
    } catch (err: any) {
      setTiktokStatusOk(false);
      setTiktokStatusMsg(err?.message || 'Không kiểm tra được session.');
    } finally {
      setTiktokBusy(null);
    }
  };

  const handleTiktokRemove = async () => {
    setTiktokStatusMsg('');
    setTiktokBusy('remove');
    try {
      const res = await window.vanhsub.tiktokTts.removeSession();
      if (res.ok) {
        setTiktokHasSession(false);
        setTiktokStatusOk(true);
        setTiktokStatusMsg('Đã xoá session khỏi máy.');
      } else {
        setTiktokStatusOk(false);
        setTiktokStatusMsg(res.error || 'Không xoá được session.');
      }
    } finally {
      setTiktokBusy(null);
    }
  };

  // Nghe thử: tổng hợp 1 câu ngắn bằng giọng Việt rồi phát qua vanhmedia://
  const handleTiktokPreview = async () => {
    setTiktokStatusMsg('');
    setTiktokBusy('preview');
    try {
      const res = await window.vanhsub.tiktokTts.synthesize(
        'Xin chào! Đây là giọng đọc thử nghiệm từ TikTok trong VanhStudio.',
        'BV074_streaming',
      );
      if (res.ok) {
        tiktokPreviewRef.current?.pause();
        if (!tiktokPreviewRef.current) tiktokPreviewRef.current = new Audio();
        tiktokPreviewRef.current.src = `vanhmedia://local/${encodeURIComponent(res.filePath)}`;
        await tiktokPreviewRef.current.play();
        setTiktokStatusOk(true);
        setTiktokStatusMsg('Đã tạo audio thử — đang phát giọng Việt nữ (BV074_streaming).');
      } else {
        setTiktokStatusOk(false);
        setTiktokStatusMsg(('error' in res && res.error) ? res.error : 'Lỗi tạo audio thử');
      }
    } catch (err: any) {
      setTiktokStatusOk(false);
      setTiktokStatusMsg(err?.message || 'Không tạo được audio thử.');
    } finally {
      setTiktokBusy(null);
    }
  };

  const handleDeleteModel = async (modelName: string) => {
    if (!confirm(`Bạn có chắc chắn muốn xoá model ASR "${modelName}" khỏi máy?`)) return;
    try {
      await window.vanhsub.models.delete(modelName);
      loadModelsList();
    } catch (err: any) {
      alert('Không thể xoá model: ' + (err?.message || err));
    }
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden text-xs text-text">
      {/* Vùng cuộn nội dung cấu hình */}
      <div className="flex-1 overflow-y-auto p-6 space-y-6">
        {/* Header */}
      <div className="flex items-center justify-between rounded-lg border border-border bg-surface p-4">
        <div>
          <h2 className="text-sm font-bold text-white">Cấu hình Hệ thống & Dịch vụ AI</h2>
          <p className="mt-0.5 text-text-muted">
            Quản lý API Key, thư mục lưu trữ, cấu hình model Whisper ASR và dịch thuật Gemini
          </p>
        </div>
        <button
          type="button"
          disabled={isSaving}
          onClick={handleSaveSettings}
          className="bg-accent text-white hover:bg-accent-hover inline-flex items-center gap-2 rounded-md px-4 py-2 text-xs font-semibold cursor-pointer disabled:opacity-50"
        >
          {isSaving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
          <span>{isSaving ? 'Đang lưu...' : 'Lưu cài đặt'}</span>
        </button>
      </div>

      {savedMessage && (
        <div className="flex items-center gap-2 rounded-lg border border-emerald-500/40 bg-emerald-500/10 p-3 font-medium text-emerald-400">
          <CheckCircle2 className="h-4 w-4" />
          <span>{savedMessage}</span>
        </div>
      )}

      {errorMessage && (
        <div className="rounded-lg border border-rose-500/40 bg-rose-500/10 p-3 text-rose-300">
          {errorMessage}
        </div>
      )}

      {/* ASR Model Selector */}
      <ASRModelSelector 
        currentModel={asrModel}
        onModelChange={setAsrModel}
      />

      <div className="grid gap-6 lg:grid-cols-2">
        {/* Khối 1: Gemini API Key */}
        <div className="flex flex-col gap-4 rounded-lg border border-border bg-surface p-5">
          <div className="flex items-center justify-between border-b border-border pb-3">
            <div className="flex items-center gap-2 text-sm font-bold text-white">
              <Key className="h-4 w-4 text-accent" />
              <span>Gemini AI (Dịch thuật & Hiệu đính)</span>
            </div>
            {geminiSavedFlash && (
              <span className="inline-flex items-center gap-1 rounded-full border border-emerald-500/30 bg-emerald-500/10 px-2 py-0.5 text-[10px] font-semibold text-emerald-400">
                <CheckCircle2 className="h-3 w-3" />
                Đã lưu cấu hình
              </span>
            )}
          </div>

          <div className="space-y-4">
            <div>
              <label className="mb-1 block font-medium text-text">Gemini API Key</label>
              <div className="flex gap-2">
                <input
                  type={showApiKey ? 'text' : 'password'}
                  value={apiKey}
                  onChange={(e) => setApiKey(e.target.value)}
                  placeholder="AIzaSy..."
                  className="flex-1 rounded-md border border-border bg-surface-2 px-3 py-2 font-mono text-xs text-white focus:border-accent/40 focus:outline-none"
                />
                <button
                  type="button"
                  onClick={() => setShowApiKey(!showApiKey)}
                  className="rounded-md border border-border bg-surface-2 px-3 py-2 font-medium text-text hover:bg-surface-3 cursor-pointer"
                >
                  {showApiKey ? 'Ẩn' : 'Hiện'}
                </button>
              </div>
              <p className="mt-1 text-[11px] text-text-muted">
                Lấy API key miễn phí tại{' '}
                <a
                  href="https://aistudio.google.com/"
                  target="_blank"
                  rel="noreferrer"
                  className="text-accent underline hover:text-white font-medium"
                >
                  aistudio.google.com
                </a>
                . Key được mã hoá an toàn trên máy của bạn.
              </p>
            </div>

            {/* Chọn model Gemini */}
            <div className="space-y-2 rounded-lg border border-border bg-bg p-3.5">
              <div className="flex items-center justify-between">
                <label className="flex items-center gap-1.5 font-medium text-text">
                  <Sparkles className="h-3.5 w-3.5 text-accent" />
                  <span>Mô hình Gemini (Model)</span>
                </label>
                {!showCustomModelInput && (
                  <button
                    type="button"
                    onClick={() => setShowCustomModelInput(true)}
                    className="text-[11px] text-text-muted hover:text-accent transition cursor-pointer"
                  >
                    + Nhập model khác
                  </button>
                )}
              </div>

              {/* Quick Pick Chips */}
              <div className="flex flex-wrap gap-1.5 pt-1">
                {ALL_PRESET_MODELS.slice(0, 5).map((m) => {
                  const isActive = geminiModel === m.id && !showCustomModelInput;
                  return (
                    <button
                      key={m.id}
                      type="button"
                      onClick={() => handleSelectGeminiModel(m.id)}
                      className={`inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1 text-[11px] font-medium transition cursor-pointer ${
                        isActive
                          ? 'border-accent/40 bg-accent-tint text-white  '
                          : 'border-border bg-surface text-text-muted hover:border-border hover:text-text'
                      }`}
                    >
                      <span>{m.name}</span>
                      {m.isRecommended && (
                        <span className="rounded bg-accent/30 px-1 py-0.2 text-[9px] font-bold text-accent">
                          Khuyên dùng
                        </span>
                      )}
                    </button>
                  );
                })}
              </div>

              {/* Dropdown Selector */}
              {!showCustomModelInput ? (
                <div className="pt-1">
                  <select
                    value={geminiModel}
                    onChange={(e) => handleSelectGeminiModel(e.target.value)}
                    className="w-full rounded-md border border-border bg-surface-2 px-3 py-2 text-xs text-white focus:border-accent/40 focus:outline-none"
                  >
                    {GEMINI_MODEL_GROUPS.map((grp) => (
                      <optgroup key={grp.group} label={grp.group}>
                        {grp.models.map((m) => (
                          <option key={m.id} value={m.id}>
                            {m.name} — {m.badge}
                          </option>
                        ))}
                      </optgroup>
                    ))}
                    <option value="custom">Nhập model tùy chỉnh khác...</option>
                  </select>
                </div>
              ) : (
                <div className="space-y-1.5 pt-1">
                  <div className="flex gap-2">
                    <input
                      type="text"
                      list="gemini-model-suggestions"
                      value={geminiModel}
                      onChange={(e) => {
                        const v = e.target.value;
                        setGeminiModel(v);
                        if (customModelDebounceRef.current) clearTimeout(customModelDebounceRef.current);
                        customModelDebounceRef.current = setTimeout(() => {
                          void autoSaveSetting('geminiModel', v);
                        }, 500);
                      }}
                      placeholder="gemini-2.5-flash"
                      spellCheck={false}
                      className="flex-1 rounded-md border border-accent/40 bg-surface-2 px-3 py-2 font-mono text-xs text-white focus:border-accent/40 focus:outline-none"
                    />
                    <button
                      type="button"
                      onClick={() => setShowCustomModelInput(false)}
                      className="rounded-md border border-border bg-surface-2 px-3 py-2 text-xs text-text hover:bg-surface-3 cursor-pointer"
                    >
                      Danh sách gợi ý
                    </button>
                  </div>
                  <datalist id="gemini-model-suggestions">
                    {ALL_PRESET_MODELS.map((m) => (
                      <option key={m.id} value={m.id}>
                        {m.name} — {m.badge}
                      </option>
                    ))}
                  </datalist>
                </div>
              )}

              {/* Chi tiết model được chọn */}
              {(() => {
                const current = ALL_PRESET_MODELS.find((m) => m.id === geminiModel);
                if (current) {
                  return (
                    <div className="mt-2 rounded-md border border-border bg-surface p-2.5 text-[11px] leading-relaxed">
                      <div className="flex items-center justify-between gap-2">
                        <span className="font-semibold text-text">{current.name}</span>
                        <span className={`rounded-full border px-2 py-0.5 text-[10px] font-semibold ${current.badgeColor}`}>
                          {current.badge}
                        </span>
                      </div>
                      <p className="mt-1 text-text-muted">{current.desc}</p>
                    </div>
                  );
                }
                return (
                  <p className="mt-1 text-[11px] text-amber-400">
                    Đang sử dụng model tùy chỉnh: <code className="font-mono">{geminiModel}</code> (Hãy đảm bảo tài khoản AI Studio của bạn có quyền truy cập model này).
                  </p>
                );
              })()}
            </div>

            <div className="grid grid-cols-2 gap-3 pt-1">
              <div>
                <label className="mb-1 block font-medium text-text">Batch Size Dịch</label>
                <input
                  type="number"
                  min={1}
                  max={50}
                  value={translateBatchSize}
                  onChange={(e) => setTranslateBatchSize(Number(e.target.value))}
                  className="w-full rounded-md border border-border bg-surface-2 px-3 py-2 font-mono text-xs text-white focus:outline-none"
                />
                <span className="text-[10px] text-text-muted">Số câu / 1 request API</span>
              </div>

              <div>
                <label className="mb-1 block font-medium text-text">Ngôn ngữ đích mặc định</label>
                <select
                  value={targetLanguage}
                  onChange={(e) => setTargetLanguage(e.target.value)}
                  className="w-full rounded-md border border-border bg-surface-2 px-3 py-2 text-xs text-white focus:outline-none"
                >
                  <option value="vi">Tiếng Việt</option>
                  <option value="en">English</option>
                  <option value="ja">Japanese</option>
                  <option value="ko">Korean</option>
                  <option value="zh">Chinese</option>
                </select>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3 pt-1">
              <div>
                <label className="mb-1 block font-medium text-text">Số request dịch song song</label>
                <input
                  type="number"
                  min={1}
                  max={8}
                  value={translateConcurrency}
                  onChange={(e) => setTranslateConcurrency(Number(e.target.value))}
                  className="w-full rounded-md border border-border bg-surface-2 px-3 py-2 font-mono text-xs text-white focus:outline-none"
                />
                <span className="text-[10px] text-text-muted">
                  1 = lần lượt (an toàn với rate limit) — tăng để dịch nhanh hơn
                </span>
              </div>
            </div>

            <div className="pt-2">
              <label className="inline-flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={autoTranslateAfterAsr}
                  onChange={(e) => setAutoTranslateAfterAsr(e.target.checked)}
                  className="h-4 w-4 rounded border-border bg-surface-2 text-accent focus:ring-0"
                />
                <span className="text-xs text-text">Tự động dịch ngay sau khi phiên âm (ASR) hoàn tất</span>
              </label>
            </div>

            {/* Nút lưu cấu hình Gemini */}
            <div className="flex justify-end pt-2 border-t border-border">
              <button
                type="button"
                onClick={handleSaveGeminiSettings}
                className="inline-flex items-center gap-2 rounded-md border border-accent/40 bg-accent-tint px-3.5 py-1.5 text-xs font-semibold text-accent hover:bg-accent-tint cursor-pointer transition"
              >
                <Save className="h-3.5 w-3.5" />
                <span>Lưu cấu hình Gemini</span>
              </button>
            </div>
          </div>
        </div>

        {/* Khối 2: Cấu hình Chung & Xuất file */}
        <div className="flex flex-col gap-4 rounded-lg border border-border bg-surface p-5">
          <div className="flex items-center gap-2 border-b border-border pb-3 text-sm font-bold text-white">
            <Layers className="h-4 w-4 text-accent" />
            <span>Cấu hình Chung & Xuất file</span>
          </div>

          <div className="space-y-4">
            <div>
              <label className="mb-1 block font-medium text-text">Thư mục xuất video mặc định</label>
              <div className="flex gap-2">
                <input
                  type="text"
                  readOnly
                  value={exportDir || 'Lưu cùng thư mục với video gốc (Mặc định)'}
                  className="flex-1 truncate rounded-md border border-border bg-surface-2 px-3 py-2 font-mono text-[11px] text-text focus:outline-none"
                />
                <button
                  type="button"
                  onClick={handleChooseExportDir}
                  className="inline-flex items-center gap-1.5 rounded-md border border-border bg-surface-2 px-3 py-2 font-medium text-text hover:bg-surface-3 cursor-pointer"
                >
                  <FolderOpen className="h-3.5 w-3.5 text-accent" />
                  <span>Chọn</span>
                </button>
                {exportDir && (
                  <button
                    type="button"
                    onClick={() => setExportDir('')}
                    className="rounded-md border border-border bg-surface-2 px-3 py-2 text-text-muted hover:text-white cursor-pointer"
                    title="Đặt lại mặc định"
                  >
                    Mặc định
                  </button>
                )}
              </div>
            </div>

            <div>
              <label className="mb-1 block font-medium text-text">Model Whisper ASR mặc định</label>
              <select
                value={asrModel}
                onChange={(e) => {
                  const v = e.target.value;
                  setAsrModel(v);
                  void autoSaveSetting('asrModel', v);
                }}
                className="w-full rounded-md border border-border bg-surface-2 px-3 py-2 text-xs text-white focus:outline-none"
              >
                <option value="tiny">tiny (75MB - Nhanh nhất, độ chính xác vừa)</option>
                <option value="base">base (147MB - Cân bằng tốc độ & chính xác)</option>
                <option value="small">small (488MB - Chính xác cao hơn)</option>
                <option value="medium">medium (1.5GB - Tốt cho tiếng Việt phong phú)</option>
                <option value="large-v3-turbo">large-v3-turbo (1.6GB - Gần bằng large, nhanh gấp nhiều lần)</option>
                <option value="large">large (2.9GB - Tối đa độ chính xác, rất chậm trên CPU)</option>
              </select>
              <p className="mt-1 text-[11px] text-text-muted">
                Mặc định cho task mới — từng task vẫn chọn được model riêng ở tab Phụ đề &amp; ASR.
                Model nào chưa có trên máy sẽ tự tải khi phiên âm đầu tiên (xem vị trí lưu ở khối bên dưới).
              </p>
            </div>
          </div>
        </div>

        {/* Khối Quản lý Bộ nhớ tạm & Dọn dẹp Ổ đĩa */}
        <div className="flex flex-col gap-4 rounded-lg border border-border bg-surface p-5">
          <div className="flex items-center justify-between border-b border-border pb-3">
            <div className="flex items-center gap-2 text-sm font-bold text-white">
              <HardDrive className="h-4 w-4 text-amber-400" />
              <span>Bộ nhớ tạm &amp; Dọn dẹp Ổ đĩa (Storage GC)</span>
            </div>
            <button
              type="button"
              onClick={loadTempStats}
              className="rounded-lg p-1 text-text-muted hover:bg-surface-2 hover:text-white transition cursor-pointer"
              title="Làm mới dung lượng"
            >
              <RefreshCw className="h-3.5 w-3.5" />
            </button>
          </div>

          <div className="space-y-3">
            <div className="flex items-center justify-between rounded-md border border-border bg-surface-2 p-3">
              <div>
                <span className="block text-xs font-semibold text-text">
                  Dung lượng tạm đang chiếm dụng:
                </span>
                <span className="text-[11px] text-text-muted">
                  Thư mục: <code className="font-mono text-text text-[10px]">{tempStats?.tempDir || '%TEMP%\\vanhsub_workflow'}</code>
                </span>
              </div>
              <div className="text-right">
                <span className="text-base font-bold text-amber-400">
                  {tempStats ? `${tempStats.totalSizeMb} MB` : 'Đang tính...'}
                </span>
                <span className="block text-[10px] text-text-muted">
                  {tempStats ? `${tempStats.folderCount} thư mục (${tempStats.fileCount} files)` : ''}
                </span>
              </div>
            </div>

            <div className="flex items-center justify-between gap-3 pt-1">
              <p className="text-[11px] text-text-muted">
                Hệ thống tự động dọn dẹp các tệp tạm cũ hơn 24 giờ. Bạn cũng có thể dọn dẹp ngay để giải phóng dung lượng ổ cứng.
              </p>
              <button
                type="button"
                disabled={isCleaningTemp}
                onClick={handleCleanTemp}
                className="inline-flex items-center gap-1.5 shrink-0 rounded-md border border-amber-500/40 bg-amber-500/15 px-3.5 py-2 text-xs font-semibold text-amber-300 hover:bg-amber-500/25 transition cursor-pointer disabled:opacity-50"
              >
                {isCleaningTemp ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <Trash2 className="h-3.5 w-3.5" />
                )}
                <span>{isCleaningTemp ? 'Đang dọn...' : 'Dọn dẹp ngay'}</span>
              </button>
            </div>

            {cleanTempMessage && (
              <p className="text-[11px] font-medium text-emerald-400">
                {cleanTempMessage}
              </p>
            )}
          </div>
        </div>

        {/* Khối 3: Quản lý Model Whisper trên đĩa */}
        <div className="flex flex-col gap-4 rounded-lg border border-border bg-surface p-5">
          <div className="flex items-center justify-between border-b border-border pb-3">
            <div className="flex items-center gap-2 text-sm font-bold text-white">
              <HardDrive className="h-4 w-4 text-emerald-400" />
              <span>Model Whisper ASR trên đĩa</span>
            </div>
            <button
              type="button"
              onClick={loadModelsList}
              className="rounded-lg p-1 text-text-muted hover:bg-surface-2 hover:text-white transition cursor-pointer"
              title="Làm mới"
            >
              <RefreshCw className={`h-3.5 w-3.5 ${loadingModels ? 'animate-spin text-accent' : ''}`} />
            </button>
          </div>

          {/* Model đang dùng mặc định + trạng thái tải */}
          <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-accent/40 bg-accent/5 px-3.5 py-3">
            <div className="flex items-center gap-2.5">
              <Cpu className="h-4 w-4 text-accent" />
              <div>
                <div className="text-[10px] uppercase tracking-wider text-text-muted">
                  Model đang dùng mặc định (cho task mới)
                </div>
                <div className="font-mono text-sm font-semibold text-white">whisper {asrModel}</div>
              </div>
            </div>
            {modelsList.some((m) => m.name === asrModel) ? (
              <span className="inline-flex items-center gap-1.5 rounded-full border border-emerald-500/30 bg-emerald-500/10 px-2.5 py-1 text-[11px] font-medium text-emerald-400">
                <CheckCircle2 className="h-3 w-3" />
                Đã tải trên máy
              </span>
            ) : (
              <span className="inline-flex items-center gap-1.5 rounded-full border border-amber-500/30 bg-amber-500/10 px-2.5 py-1 text-[11px] font-medium text-amber-400">
                Chưa tải — tự tải khi phiên âm đầu tiên
              </span>
            )}
          </div>

          {/* Vị trí lưu model trên đĩa */}
          {modelsDir && (
            <div className="rounded-lg border border-border bg-bg px-3.5 py-3">
              <div className="flex items-center justify-between gap-2">
                <span className="text-[10px] uppercase tracking-wider text-text-muted">
                  Vị trí lưu model
                </span>
                <button
                  type="button"
                  onClick={() => window.vanhsub.dialog.showInFolder(modelsDir.path)}
                  className="inline-flex shrink-0 items-center gap-1.5 rounded-lg border border-border bg-surface px-2 py-1 text-[11px] font-medium text-text hover:bg-surface-2 hover:text-white transition cursor-pointer"
                  title="Mở thư mục chứa model trong Explorer"
                >
                  <FolderOpen className="h-3 w-3" />
                  <span>Mở thư mục</span>
                </button>
              </div>
              <p className="mt-1.5 break-all font-mono text-[11px] leading-relaxed text-text-muted" title={modelsDir.path}>
                {modelsDir.path}
                {!modelsDir.exists && (
                  <span className="text-amber-400"> — thư mục sẽ được tạo khi tải model đầu tiên</span>
                )}
              </p>
            </div>
          )}

          {modelsList.length === 0 ? (
            <p className="py-4 text-center text-text-muted text-xs">
              Chưa tìm thấy model offline nào đã tải. Khi bạn bắt đầu phiên âm task đầu tiên, app sẽ tự động tải model base.
            </p>
          ) : (
            <div className="space-y-2">
              {modelsList.map((m) => {
                const isCurrent = m.name === asrModel;
                return (
                  <div
                    key={m.fileName}
                    className={`flex items-center justify-between rounded-md border px-3 py-2.5 ${
                      isCurrent ? 'border-emerald-500/40 bg-emerald-500/5' : 'border-border bg-bg'
                    }`}
                  >
                    <div className="flex items-center gap-2.5">
                      <Cpu className={`h-4 w-4 ${isCurrent ? 'text-emerald-400' : 'text-accent'}`} />
                      <div>
                        <div className="flex items-center gap-2 font-semibold text-white">
                          Model {m.name}
                          {isCurrent && (
                            <span className="rounded-full border border-emerald-500/30 bg-emerald-500/15 px-1.5 py-0.5 text-[9px] font-semibold text-emerald-400">
                              Đang dùng
                            </span>
                          )}
                        </div>
                        <div className="font-mono text-[10px] text-text-muted" title={m.filePath}>
                          {m.fileName}
                        </div>
                      </div>
                    </div>
                    <div className="flex items-center gap-3">
                      <span className="font-mono text-xs font-medium text-text">{m.size}</span>
                      <button
                        type="button"
                        onClick={() => handleDeleteModel(m.name)}
                        className="rounded-lg p-1.5 text-text-muted hover:bg-rose-500/20 hover:text-rose-400 transition cursor-pointer"
                        title="Xoá model khỏi ổ đĩa"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Khối 4: TikTok TTS — Engine Lồng tiếng (~80 giọng đa ngôn ngữ) */}
        <div className="flex flex-col gap-4 rounded-lg border border-border bg-surface p-5">
          <div className="flex items-center gap-2 border-b border-border pb-3 text-sm font-bold text-white">
            <Mic className="h-4 w-4 text-accent" />
            <span>TikTok TTS — Engine Lồng tiếng (~80 giọng đa ngôn ngữ)</span>
          </div>

          <div className="space-y-4">
            <p className="text-[11px] leading-relaxed text-text-muted">
              Dùng API TTS nội bộ của TikTok với <strong className="text-text">sessionid của chính bạn</strong> —
              đăng nhập tiktok.com trên trình duyệt, dùng tiện ích Cookie-Editor copy giá trị cookie{' '}
              <code className="rounded bg-surface px-1 py-0.5 font-mono text-[10px] text-text">sessionid</code>{' '}
              rồi dán vào đây. Session được mã hoá bằng safeStorage của hệ điều hành, không bao giờ hiển thị lại hay ghi
              vào log. Đây là API <strong className="text-text">không chính thức</strong> — TikTok có thể thay đổi
              bất cứ lúc nào; khi có lỗi, mô tả bên dưới sẽ nói rõ nguyên nhân (session hết hạn, rate limit, API đổi…).
              Catalog có 2 giọng tiếng Việt: <code className="font-mono text-[10px]">BV074_streaming</code> (nữ),{' '}
              <code className="font-mono text-[10px]">BV075_streaming</code> (nam).
            </p>

            <div>
              <label className="mb-1 block font-medium text-text">Session TikTok (sessionid)</label>
              <div className="flex gap-2">
                <input
                  type="password"
                  autoComplete="off"
                  value={tiktokSessionInput}
                  onChange={(e) => setTiktokSessionInput(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && !tiktokBusy) void handleTiktokSave();
                  }}
                  placeholder={
                    tiktokHasSession
                      ? '•••••••••••••••• (đã lưu trên máy — nhập session mới để ghi đè)'
                      : 'Dán giá trị cookie sessionid vào đây'
                  }
                  className="w-full rounded-md border border-border bg-surface-2 px-3 py-2 font-mono text-xs text-white placeholder:text-text-muted focus:border-accent/40 focus:outline-none"
                />
                <button
                  type="button"
                  onClick={handleTiktokSave}
                  disabled={tiktokBusy !== null}
                  className="inline-flex shrink-0 items-center gap-1.5 rounded-md border border-accent/40 bg-accent-tint px-3 py-2 text-xs font-semibold text-accent hover:bg-accent-tint cursor-pointer disabled:opacity-50"
                >
                  {tiktokBusy === 'save' ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Save className="h-3.5 w-3.5" />}
                  <span>Lưu</span>
                </button>
                {tiktokHasSession && (
                  <button
                    type="button"
                    onClick={handleTiktokRemove}
                    disabled={tiktokBusy !== null}
                    title="Xoá session khỏi máy"
                    className="inline-flex shrink-0 items-center rounded-md border border-border bg-surface-2 px-2.5 py-2 text-text-muted hover:bg-rose-500/20 hover:text-rose-400 transition cursor-pointer disabled:opacity-50"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                )}
              </div>

              <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
                <span
                  className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] font-medium ${
                    tiktokHasSession
                      ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-400'
                      : 'border-border bg-surface-2 text-text-muted'
                  }`}
                >
                  {tiktokHasSession ? 'Đã lưu session trên máy' : 'Chưa có session'}
                </span>
                <button
                  type="button"
                  onClick={handleTiktokValidate}
                  disabled={tiktokBusy !== null || !tiktokHasSession}
                  title="Gửi 1 request thử tới TikTok để xác nhận session còn hiệu lực"
                  className="inline-flex items-center gap-1.5 rounded-md border border-border bg-surface-2 px-3 py-1.5 text-xs font-medium text-text hover:bg-surface-3 cursor-pointer disabled:opacity-50"
                >
                  {tiktokBusy === 'validate' ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <RefreshCw className="h-3.5 w-3.5" />
                  )}
                  <span>Kiểm tra session</span>
                </button>
              </div>
            </div>

            {tiktokStatusMsg && (
              <p
                className={`rounded-md border px-3 py-2 text-[11px] leading-relaxed ${
                  tiktokStatusOk
                    ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-300'
                    : 'border-rose-500/30 bg-rose-500/10 text-rose-300'
                }`}
              >
                {tiktokStatusMsg}
              </p>
            )}

            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={handleTiktokPreview}
                disabled={tiktokBusy !== null}
                title="Tạo 1 câu ngắn bằng giọng Việt nữ (BV074_streaming) và phát thử"
                className="inline-flex items-center gap-1.5 rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-1.5 text-xs font-medium text-amber-400 hover:bg-amber-500/20 cursor-pointer disabled:opacity-50"
              >
                {tiktokBusy === 'preview' ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <Mic className="h-3.5 w-3.5" />
                )}
                <span>Nghe thử giọng Việt</span>
              </button>
              <span className="text-[10px] text-text-muted">
                Tích hợp vào pipeline lồng tiếng sẽ làm sau khi session của bạn chạy ổn.
              </span>
            </div>
          </div>
        </div>

        {/* Khối Cấu hình Lồng tiếng mặc định (TTS) */}
        <div className="flex flex-col gap-4 rounded-lg border border-border bg-surface p-5">
          <div className="flex items-center justify-between border-b border-border pb-3">
            <div className="flex items-center gap-2 text-sm font-bold text-white">
              <Volume2 className="h-4 w-4 text-accent" />
              <span>Cấu hình Lồng tiếng mặc định (TTS)</span>
            </div>
            {autoSavedFlash && (
              <span className="inline-flex items-center gap-1 rounded-full border border-emerald-500/30 bg-emerald-500/10 px-2 py-0.5 text-[10px] font-semibold text-emerald-400">
                <CheckCircle2 className="h-3 w-3" />
                Đã lưu tự động
              </span>
            )}
          </div>

          <div className="space-y-4 text-xs">
            <p className="text-[11px] text-text-muted">
              Cài đặt giọng đọc và tốc độ mặc định khi tạo mới hoặc chạy lồng tiếng tự động trong quy trình.
              Tự động lưu khi thay đổi.
            </p>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className="mb-1 block font-medium text-text">Giọng đọc mặc định</label>
                <select
                  value={ttsVoice}
                  onChange={(e) => {
                    const v = e.target.value;
                    setTtsVoice(v);
                    void autoSaveSetting('ttsVoice', v);
                  }}
                  className="w-full rounded-md border border-border bg-surface-2 px-3 py-2 text-xs text-white focus:outline-none"
                >
                  <optgroup label="Edge TTS (Miễn phí 100%, Giọng chuẩn Azure)">
                    <option value="vi-VN-HoaiMyNeural">Hoài My (Nữ - Truyền cảm, Tự nhiên)</option>
                    <option value="vi-VN-NamMinhNeural">Nam Minh (Nam - Trầm ấm, Phóng sự)</option>
                  </optgroup>
                  <optgroup label="TikTok TTS">
                    <option value="BV074_streaming">BV074 — Nữ Triển vọng (Tiếng Việt)</option>
                    <option value="BV075_streaming">BV075 — Nam Trầm ấm (Tiếng Việt)</option>
                  </optgroup>
                </select>
              </div>

              <div>
                <label className="mb-1 block font-medium text-text">Tốc độ đọc mặc định</label>
                <select
                  value={ttsSpeed}
                  onChange={(e) => {
                    const v = Number(e.target.value);
                    setTtsSpeed(v);
                    void autoSaveSetting('ttsSpeed', v);
                  }}
                  className="w-full rounded-md border border-border bg-surface-2 px-3 py-2 text-xs text-white focus:outline-none"
                >
                  <option value={0.75}>0.75x — Chậm rãi</option>
                  <option value={0.9}>0.9x — Hơi chậm</option>
                  <option value={1.0}>1.0x — Tiêu chuẩn (Khuyên dùng)</option>
                  <option value={1.1}>1.1x — Hơi nhanh</option>
                  <option value={1.25}>1.25x — Nhanh</option>
                  <option value={1.5}>1.5x — Rất nhanh</option>
                </select>
                <span className="text-[10px] text-text-muted">
                  Áp dụng hiệu quả với Edge TTS; TikTok TTS hiện tại giữ tốc độ gốc
                </span>
              </div>
            </div>
          </div>
        </div>

        <label className="flex items-start gap-2 rounded-lg border border-border bg-surface p-4 text-xs text-text">
          <input type="checkbox" checked={ttsAllowShortening} onChange={(event) => {
            setTtsAllowShortening(event.target.checked);
            void autoSaveSetting('ttsAllowShortening', event.target.checked);
          }} />
          <span>Cho phép AI rút gọn lời đọc khi câu quá dài (cần API Key).
            <span className="mt-1 block text-text-muted">Phụ đề giữ nguyên; lời đọc có thể khác câu chữ. Khi tắt, app chỉ điều chỉnh tốc độ và báo lỗi nếu vẫn không vừa khung.</span>
          </span>
        </label>

        {/* Khối 5: OCR — quét phụ đề cứng trong video */}
        <div className="flex flex-col gap-4 rounded-lg border border-border bg-surface p-5">
          <div className="flex items-center justify-between border-b border-border pb-3">
            <div className="flex items-center gap-2 text-sm font-bold text-white">
              <ScanText className="h-4 w-4 text-accent" />
              <span>Quét phụ đề cứng (OCR)</span>
            </div>
            {autoSavedFlash && (
              <span className="inline-flex items-center gap-1 rounded-full border border-emerald-500/30 bg-emerald-500/10 px-2 py-0.5 text-[10px] font-semibold text-emerald-400">
                <CheckCircle2 className="h-3 w-3" />
                Đã lưu tự động
              </span>
            )}
          </div>

          <div className="space-y-4">
            <p className="text-[11px] text-text-muted">
              Trích phụ đề đã ghẽ sẵn trong khung hình video thành file .srt bằng model
              PaddleOCR PP-OCRv5 (quét kèm Tesseract nếu bật đối chiếu). Cần python đã cài
              gói <code className="rounded bg-surface-2 px-1 py-0.5 text-[10px] text-text">rapidocr</code> (
              <code className="rounded bg-surface-2 px-1 py-0.5 text-[10px] text-text">pip install rapidocr onnxruntime opencv-python</code>).
              Lần quét đầu tải model (~30MB), sau đó lưu offline trong máy. Ngôn ngữ / vùng /
              fps <strong className="text-text">được lưu tự động khi đổi</strong> — áp
              dụng cho lần quét kế tiếp, không cần bấm "Lưu cài đặt".
            </p>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="mb-1 block font-medium text-text">Ngôn ngữ quét</label>
                <select
                  value={ocrLanguage}
                  onChange={(e) => {
                    const v = e.target.value;
                    setOcrLanguage(v);
                    void autoSaveSetting('ocrLanguage', v);
                  }}
                  className="w-full rounded-md border border-border bg-surface-2 px-3 py-2 text-xs text-white focus:outline-none"
                >
                  <option value="vie">Tiếng Việt</option>
                  <option value="eng">English</option>
                  <option value="vie+eng">Việt + Anh (song ngữ)</option>
                  <option value="chi_sim">Chinese (Giản thể)</option>
                  <option value="chi_tra">Chinese (Phồn thể)</option>
                  <option value="jpn">Japanese</option>
                  <option value="kor">Korean</option>
                  <option value="tha">Thai</option>
                </select>
              </div>

              <div>
                <label className="mb-1 block font-medium text-text">Số khung quét mỗi giây</label>
                <input
                  type="number"
                  min={0.5}
                  max={5}
                  step={0.5}
                  value={ocrFps}
                  onChange={(e) => {
                    const v = Number(e.target.value);
                    setOcrFps(v);
                    // Chỉ tự lưu giá trị hợp lệ — gõ dở thì đợi giá trị đạt khoảng cho phép
                    if (v >= 0.5 && v <= 5) void autoSaveSetting('ocrFps', v);
                  }}
                  className="w-full rounded-md border border-border bg-surface-2 px-3 py-2 font-mono text-xs text-white focus:outline-none"
                />
                <span className="text-[10px] text-text-muted">
                  2 khung/giây là cân bằng tốc độ — độ chính xác (quét chậm hơn nhưng đỡ sót dòng)
                </span>
              </div>
            </div>

            {/* Chế độ OCR Mode */}
            <div>
              <label className="mb-2 block font-medium text-text">
                Chế độ quét (OCR Mode)
              </label>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                {[
                  {
                    id: 'auto',
                    title: 'Auto',
                    desc: 'Tự tìm subtitle trên toàn màn hình (AI tracking & loại bỏ watermark)',
                    badge: 'Khuyên dùng',
                    badgeColor: 'border-accent/40 bg-accent/15 text-accent',
                  },
                  {
                    id: 'bottom',
                    title: 'Bottom',
                    desc: 'Chỉ tìm vùng dưới (~35% dải đáy màn hình)',
                  },
                  {
                    id: 'full',
                    title: 'Full Screen',
                    desc: 'Nhận diện tất cả text trên toàn khung hình',
                  },
                  {
                    id: 'custom',
                    title: 'Custom',
                    desc: 'Người dùng kéo vùng cần OCR (chọn khi bấm Quét OCR ở tab Phụ đề & ASR)',
                    badge: 'Kéo vùng',
                    badgeColor: 'border-accent/40 bg-accent-tint text-accent',
                  },
                ].map((item) => {
                  const isSelected = ocrMode === item.id;
                  return (
                    <button
                      key={item.id}
                      type="button"
                      onClick={() => {
                        const m = item.id as OcrMode;
                        setOcrMode(m);
                        void autoSaveSetting('ocrMode', m);
                        void autoSaveSetting('ocrRegion', m === 'bottom' ? 'bottom' : 'full');
                      }}
                      className={`relative flex items-start gap-2.5 rounded-md border p-3 text-left transition cursor-pointer ${
                        isSelected
                          ? 'border-accent/40 bg-accent-tint  '
                          : 'border-border bg-surface hover:border-border'
                      }`}
                    >
                      <div className="mt-0.5 flex h-3.5 w-3.5 shrink-0 items-center justify-center rounded-full border border-slate-600 bg-surface-2">
                        {isSelected && <div className="h-1.5 w-1.5 rounded-full bg-accent" />}
                      </div>
                      <div className="flex-1">
                        <div className="flex items-center gap-1.5">
                          <span className="font-semibold text-white text-xs">{item.title}</span>
                          {item.badge && (
                            <span className={`rounded-full border px-1.5 py-0.2 text-[9px] font-bold ${item.badgeColor}`}>
                              {item.badge}
                            </span>
                          )}
                        </div>
                        <p className="mt-1 text-[10.5px] leading-relaxed text-text-muted">{item.desc}</p>
                      </div>
                    </button>
                  );
                })}
              </div>
            </div>

            <label className="flex cursor-pointer items-start gap-3 rounded-md border border-border bg-surface-2 p-3">
              <input
                type="checkbox"
                checked={ocrDualEngine}
                onChange={(e) => {
                  setOcrDualEngine(e.target.checked);
                  void autoSaveSetting('ocrDualEngine', e.target.checked);
                }}
                className="mt-0.5 h-4 w-4 shrink-0 accent-emerald-500"
              />
              <span>
                <span className="block text-xs font-medium text-text">
                  Đối chiếu 2 engine (PaddleOCR + Tesseract)
                </span>
                <span className="mt-0.5 block text-[10px] text-text-muted">
                  Mỗi dòng chữ được 2 engine đọc riêng rồi so sánh — chính xác hơn rõ rệt với
                  phụ đề mờ/nền bận, đổi lại quét chậm hơn khoảng 30-40%.
                </span>
              </span>
            </label>

            <p className="flex items-start gap-1.5 text-[11px] text-text-muted">
              <Languages className="mt-0.5 h-3.5 w-3.5 shrink-0 text-accent" />
              <span>
                Nút <strong className="text-text">Quét OCR</strong> nằm ở tab{' '}
                <strong className="text-text">Phụ đề &amp; ASR</strong>, cạnh nút Nhập SRT.
              </span>
            </p>
          </div>
        </div>
        {/* Khối 6: Nhất quán bản dịch (Glossary & Văn phong) */}
        <div className="flex flex-col gap-4 rounded-lg border border-border bg-surface p-5">
          <div className="flex items-center gap-2 border-b border-border pb-3 text-sm font-bold text-white">
            <Languages className="h-4 w-4 text-brand-rose" />
            <span>Nhất quán bản dịch (Glossary &amp; Văn phong)</span>
          </div>

          <div className="space-y-4">
            <p className="text-[11px] text-text-muted">
              Hai mục này được đưa thẳng vào prompt khi dịch bằng Gemini — áp dụng cho toàn bộ
              video, giữ tên riêng / thuật ngữ / cách xưng hô đồng nhất từ đầu đến cuối.
            </p>

            <div>
              <label className="mb-1 block font-medium text-text">
                Bảng thuật ngữ — mỗi dòng: <code className="font-mono text-[10px] text-accent">gốc = bản dịch</code>
              </label>
              <textarea
                rows={5}
                value={glossary}
                onChange={(e) => setGlossary(e.target.value)}
                placeholder={'Ví dụ:\nLý Bạch = Lý Bạch\nsword = kiếm\nTiên Đế = Thiên Đế\ngiemony = Zhen Mon'}
                className="w-full rounded-md border border-border bg-surface-2 px-3 py-2 font-mono text-xs text-white placeholder:text-text-faint focus:border-accent/40 focus:outline-none"
              />
            </div>

            <div>
              <label className="mb-1 block font-medium text-text">Văn phong &amp; xưng hô (tự do)</label>
              <textarea
                rows={4}
                value={translationStyleGuide}
                onChange={(e) => setTranslationStyleGuide(e.target.value)}
                placeholder={'Ví dụ:\n- Văn phong cổ trang, trang trọng\n- Vua tự xưng "trẫm", kẻ dưới gọi vua là "bệ hạ"\n- Hai kẻ thù xưng hô "tao/mày", người quen xưng "tôi/cậu"'}
                className="w-full rounded-md border border-border bg-surface-2 px-3 py-2 text-xs text-white placeholder:text-text-faint focus:border-accent/40 focus:outline-none"
              />
            </div>
          </div>
        </div>
      </div>
    </div>

      {/* Thanh lưu cài đặt cố định ở đáy trang — liền mạch, không bị hở */}
      <div className="shrink-0 flex flex-wrap items-center justify-between gap-3 border-t border-border bg-surface px-6 py-3.5">
        <div className="flex items-center gap-2">
          {savedMessage ? (
            <span className="flex items-center gap-1.5 text-xs font-medium text-emerald-400">
              <CheckCircle2 className="h-4 w-4 shrink-0" />
              {savedMessage}
            </span>
          ) : errorMessage ? (
            <span className="text-xs font-medium text-rose-400">
              {errorMessage}
            </span>
          ) : autoSavedFlash ? (
            <span className="flex items-center gap-1.5 text-xs font-medium text-emerald-400">
              <CheckCircle2 className="h-4 w-4 shrink-0" />
              Đã tự động lưu thay đổi vừa chọn!
            </span>
          ) : (
            <span className="text-xs text-text-muted">
              Nhấn <strong className="text-text">"Lưu tất cả thay đổi"</strong> để cập nhật toàn bộ cấu hình vào hệ thống.
            </span>
          )}
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            disabled={isSaving}
            onClick={handleSaveSettings}
            className="bg-accent text-white hover:bg-accent-hover inline-flex items-center gap-2 rounded-md px-5 py-2.5 text-xs font-semibold cursor-pointer hover:opacity-95 transition disabled:opacity-50"
          >
            {isSaving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
            <span>{isSaving ? 'Đang lưu...' : 'Lưu tất cả thay đổi'}</span>
          </button>
        </div>
      </div>
    </div>
  );
}
