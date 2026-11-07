import React, { useState, useEffect, useRef } from 'react';
import { studioLlmReadiness } from '../../../shared/studioLlmReadiness';
import PiperRuntimeStatus from './PiperRuntimeStatus';
import MediaRouteSettings from './MediaRouteSettings';
import {
  Save,
  RotateCcw,
  Sparkles,
  Mic,
  Film,
  Video,
  Subtitles,
  Eye,
  EyeOff,
  CheckCircle2,
  AlertCircle,
  Settings,
  LogOut,
  ExternalLink,
} from 'lucide-react';
import { useAiStudioStore } from '../../lib/store/aiStudioStore';
import { mergeSettingsDraft, settingsDraftPatch, STUDIO_CONFIG_SECTIONS, type StudioConfigSection } from '../../lib/studioConfigDraft';
import type {
  AiStudioConfig,
  LlmProviderType,
  VoiceProviderType,
  FlowAspectRatio,
  RenderResolution,
  SubtitlePreset,
} from '../../types/aiStudio';

export default function AiStudioSettingsTab() {
  const { config, updateConfig, resetConfig, isLoading, isSaving } =
    useAiStudioStore();

  const [form, setFormState] = useState<AiStudioConfig>(config);
  const llmReadiness = studioLlmReadiness(form.llm);
  const dirtySections = useRef(new Map<StudioConfigSection, number>());
  const editVersion = useRef(0);
  const setForm = (next: AiStudioConfig) => {
    for (const section of STUDIO_CONFIG_SECTIONS) {
      if (next[section] !== form[section]) dirtySections.current.set(section, ++editVersion.current);
    }
    setFormState(next);
  };
  const [showApiKey, setShowApiKey] = useState(false);
  const [saveMessage, setSaveMessage] = useState<string | null>(null);

  // ChatGPT Web Automation status state
  const [chatGptStatus, setChatGptStatus] = useState<{
    isLoggedIn: boolean;
    userEmail?: string;
  } | null>(null);
  const [isCheckingChatGpt, setIsCheckingChatGpt] = useState(false);
  const [isOpeningChatGptLogin, setIsOpeningChatGptLogin] = useState(false);
  const [isLoggingOutChatGpt, setIsLoggingOutChatGpt] = useState(false);

  // Gemini Web Automation status state
  const [geminiStatus, setGeminiStatus] = useState<{
    isLoggedIn: boolean;
    userEmail?: string;
  } | null>(null);
  const [isCheckingGemini, setIsCheckingGemini] = useState(false);
  const [isOpeningGeminiLogin, setIsOpeningGeminiLogin] = useState(false);
  const [isLoggingOutGemini, setIsLoggingOutGemini] = useState(false);

  // TikTok TTS session state
  const [hasTikTokSession, setHasTikTokSession] = useState<boolean>(false);
  const [tikTokSessionInput, setTikTokSessionInput] = useState<string>('');
  const [showTikTokSession, setShowTikTokSession] = useState(false);
  const [tikTokValidateResult, setTikTokValidateResult] = useState<{ valid: boolean; detail: string } | null>(null);
  const [isValidatingTikTok, setIsValidatingTikTok] = useState(false);
  const [isSavingTikTokSession, setIsSavingTikTokSession] = useState(false);

  const checkTikTokStatus = async () => {
    if (typeof window === 'undefined' || !window.vanhsub?.tiktokTts?.status) return;
    try {
      const res = await window.vanhsub.tiktokTts.status();
      setHasTikTokSession(Boolean(res?.hasSession));
    } catch {
      setHasTikTokSession(false);
    }
  };

  const handleSaveTikTokSession = async () => {
    if (!tikTokSessionInput.trim() || !window.vanhsub?.tiktokTts?.saveSession) return;
    setIsSavingTikTokSession(true);
    try {
      const res = await window.vanhsub.tiktokTts.saveSession(tikTokSessionInput.trim());
      if (res.ok) {
        setHasTikTokSession(true);
        setTikTokSessionInput('');
        setTikTokValidateResult({ valid: true, detail: 'Đã lưu session TikTok thành công!' });
      } else {
        setTikTokValidateResult({ valid: false, detail: res.error || 'Lỗi lưu session' });
      }
    } finally {
      setIsSavingTikTokSession(false);
    }
  };

  const handleValidateTikTok = async () => {
    if (!window.vanhsub?.tiktokTts?.validate) return;
    setIsValidatingTikTok(true);
    try {
      const res = await window.vanhsub.tiktokTts.validate();
      setTikTokValidateResult(res);
      setHasTikTokSession(res.valid);
    } catch (err: any) {
      setTikTokValidateResult({ valid: false, detail: err?.message || 'Lỗi kết nối TikTok' });
    } finally {
      setIsValidatingTikTok(false);
    }
  };

  const checkChatGptStatus = async () => {
    if (typeof window === 'undefined' || !window.vanhsub?.aiStudio?.checkChatGptLogin) return;
    setIsCheckingChatGpt(true);
    try {
      const res = await window.vanhsub.aiStudio.checkChatGptLogin();
      setChatGptStatus(res);
    } catch {
      setChatGptStatus({ isLoggedIn: false });
    } finally {
      setIsCheckingChatGpt(false);
    }
  };

  const handleOpenChatGptLogin = async () => {
    if (typeof window === 'undefined' || !window.vanhsub?.aiStudio?.openChatGptLogin) return;
    setIsOpeningChatGptLogin(true);
    try {
      await window.vanhsub.aiStudio.openChatGptLogin();
      await checkChatGptStatus();
      // Polling up to 60s while login window is active
      let polls = 0;
      const pollTimer = setInterval(async () => {
        polls++;
        if (polls > 30) {
          clearInterval(pollTimer);
          return;
        }
        try {
          const res = await window.vanhsub?.aiStudio?.checkChatGptLogin?.();
          if (res?.isLoggedIn) {
            setChatGptStatus(res);
            clearInterval(pollTimer);
          }
        } catch {
          // ignore
        }
      }, 2000);
    } finally {
      setIsOpeningChatGptLogin(false);
    }
  };

  const handleLogoutChatGpt = async () => {
    if (typeof window === 'undefined' || !window.vanhsub?.aiStudio?.logoutChatGptLogin) return;
    setIsLoggingOutChatGpt(true);
    try {
      await window.vanhsub.aiStudio.logoutChatGptLogin();
      setChatGptStatus({ isLoggedIn: false });
    } catch (err) {
      console.error('Failed to logout ChatGPT Web:', err);
    } finally {
      setIsLoggingOutChatGpt(false);
    }
  };

  const checkGeminiStatus = async () => {
    if (typeof window === 'undefined' || !window.vanhsub?.aiStudio?.checkGeminiLogin) return;
    setIsCheckingGemini(true);
    try {
      const res = await window.vanhsub.aiStudio.checkGeminiLogin();
      setGeminiStatus(res);
    } catch {
      setGeminiStatus({ isLoggedIn: false });
    } finally {
      setIsCheckingGemini(false);
    }
  };

  const handleOpenGeminiLogin = async () => {
    if (typeof window === 'undefined' || !window.vanhsub?.aiStudio?.openGeminiLogin) return;
    setIsOpeningGeminiLogin(true);
    try {
      await window.vanhsub.aiStudio.openGeminiLogin();
      await checkGeminiStatus();
      // Polling up to 60s while login window is active
      let polls = 0;
      const pollTimer = setInterval(async () => {
        polls++;
        if (polls > 30) {
          clearInterval(pollTimer);
          return;
        }
        try {
          const res = await window.vanhsub?.aiStudio?.checkGeminiLogin?.();
          if (res?.isLoggedIn) {
            setGeminiStatus(res);
            clearInterval(pollTimer);
          }
        } catch {
          // ignore
        }
      }, 2000);
    } finally {
      setIsOpeningGeminiLogin(false);
    }
  };

  const handleLogoutGemini = async () => {
    if (typeof window === 'undefined' || !window.vanhsub?.aiStudio?.logoutGeminiLogin) return;
    setIsLoggingOutGemini(true);
    try {
      await window.vanhsub.aiStudio.logoutGeminiLogin();
      setGeminiStatus({ isLoggedIn: false });
    } catch (err) {
      console.error('Failed to logout Gemini Web:', err);
    } finally {
      setIsLoggingOutGemini(false);
    }
  };

  useEffect(() => {
    setFormState((draft) => mergeSettingsDraft(draft, config, dirtySections.current.keys()));
  }, [config]);

  useEffect(() => {
    checkTikTokStatus();
  }, []);

  useEffect(() => {
    if (form.llm.provider === 'chatgpt_web') {
      checkChatGptStatus();
    } else if (form.llm.provider === 'gemini_web') {
      checkGeminiStatus();
    }
  }, [form.llm.provider]);

  const handleSave = async () => {
    try {
      const submitted = new Map(dirtySections.current);
      if (!submitted.size) {
        setSaveMessage('Không có thay đổi cần lưu.');
        return;
      }
      const saved = await updateConfig(settingsDraftPatch(form, submitted.keys()));
      if (!saved) {
        setSaveMessage(`Lỗi: ${useAiStudioStore.getState().error || 'Không thể lưu cấu hình.'}`);
        return;
      }
      for (const [section, version] of submitted) {
        if (dirtySections.current.get(section) === version) dirtySections.current.delete(section);
      }
      setFormState((draft) => mergeSettingsDraft(draft, useAiStudioStore.getState().config, dirtySections.current.keys()));
      setSaveMessage('Đã lưu cấu hình AI Studio thành công!');
      setTimeout(() => setSaveMessage(null), 3000);
    } catch (err: any) {
      setSaveMessage(`Lỗi: ${err?.message || 'Không thể lưu'}`);
    }
  };

  const handleReset = async () => {
    if (window.confirm('Bạn có chắc muốn khôi phục toàn bộ cấu hình AI Studio về mặc định?')) {
      const reset = await resetConfig();
      if (!reset) {
        setSaveMessage(`Lỗi: ${useAiStudioStore.getState().error || 'Không thể khôi phục cấu hình.'}`);
        return;
      }
      dirtySections.current.clear();
      setFormState(useAiStudioStore.getState().config);
      setSaveMessage('Đã khôi phục cài đặt mặc định.');
      setTimeout(() => setSaveMessage(null), 3000);
    }
  };

  return (
    <div className="flex h-full flex-col overflow-y-auto p-6 text-text">
      <div className="mb-6 flex items-center justify-between border-b border-border pb-4">
        <div>
          <h2 className="text-xl font-bold tracking-tight text-white flex items-center gap-2">
            <Sparkles className="h-5 w-5 text-accent" />
            Cấu hình Phân hệ AI Video Studio
          </h2>
          <p className="text-xs text-text-muted mt-1">
            Kho lưu trữ cấu hình riêng biệt, độc lập hoàn toàn với cài đặt chung của Vanhsub.
          </p>
        </div>
        <div className="flex items-center gap-3">
          {saveMessage && (
            <span className={`flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-lg border ${saveMessage.startsWith('Lỗi:') ? 'text-rose-400 bg-rose-500/10 border-rose-500/20' : 'text-emerald-400 bg-emerald-500/10 border-emerald-500/20'}`}>
              {saveMessage.startsWith('Lỗi:') ? <AlertCircle className="h-4 w-4" /> : <CheckCircle2 className="h-4 w-4" />}
              {saveMessage}
            </span>
          )}
          <button
            type="button"
            onClick={handleReset}
            disabled={isSaving}
            className="flex items-center gap-1.5 rounded-md border border-border bg-surface-2 px-3.5 py-2 text-xs font-medium text-text hover:bg-surface-3 hover:text-white transition cursor-pointer"
          >
            <RotateCcw className="h-3.5 w-3.5" />
            Khôi phục mặc định
          </button>
          <button
            type="button"
            onClick={handleSave}
            disabled={isSaving}
            className="bg-accent text-white hover:bg-accent-hover flex items-center gap-1.5 rounded-md px-4 py-2 text-xs font-semibold text-white cursor-pointer"
          >
            <Save className="h-3.5 w-3.5" />
            {isSaving ? 'Đang lưu...' : 'Lưu cấu hình'}
          </button>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
        {/* 1. LLM Settings */}
        <div className="rounded-lg border border-border bg-surface p-5">
          <div className="mb-4 flex items-center gap-2 border-b border-border pb-3">
            <Sparkles className="h-4 w-4 text-accent" />
            <h3 className="text-sm font-semibold text-white">1. Mô hình Ngôn ngữ (LLM Script)</h3>
          </div>
          <div className="space-y-3.5 text-xs">
            <div role="status" className="rounded border border-border p-2 text-text-muted">
              {llmReadiness.ready ? `Cấu hình LLM hợp lệ · ${llmReadiness.model || llmReadiness.provider}` : llmReadiness.reasons.join(' ')}
              <p>{llmReadiness.warnings.join(' ')}</p>
            </div>
            <div>
              <label className="mb-1 block font-medium text-text">Nhà cung cấp (Provider)</label>
              <select
                value={form.llm.provider}
                onChange={(e) =>
                  setForm({
                    ...form,
                    llm: { ...form.llm, provider: e.target.value as LlmProviderType, apiKey: '', model: '', baseUrl: undefined },
                  })
                }
                className="w-full rounded-md border border-border bg-bg px-3 py-2 text-text focus:border-accent/40 focus:outline-none"
              >
                <option value="chatgpt_web">⚡ ChatGPT Web (Chế độ Tiết kiệm — Miễn phí 100% token)</option>
                <option value="gemini_web">⚡ Gemini Web (Chế độ Tiết kiệm — Miễn phí 100% token)</option>
                <option value="deepseek">DeepSeek (Khuyến nghị API - Siêu rẻ, nhạy bén)</option>
                <option value="openai">OpenAI (GPT-4o / GPT-4o-mini)</option>
                <option value="custom">Custom Endpoint (OpenAI-compatible)</option>
              </select>
              <p className="mt-1 text-[10px] text-text-muted">
                Đổi nhà cung cấp sẽ xóa key, model và endpoint trong bản nháp. Nhập cấu hình phù hợp trước khi lưu.
              </p>
              {form.llm.provider === 'custom' && <div className="mt-2">
                <label htmlFor="studio-llm-endpoint">Custom LLM Base URL</label>
                <input id="studio-llm-endpoint" value={form.llm.baseUrl || ''} placeholder="https://server.example/v1"
                  onChange={e => setForm({...form,llm:{...form.llm,baseUrl:e.target.value}})} className="mt-1 w-full rounded border border-border bg-bg p-2" />
              </div>}
            </div>

            {form.llm.provider === 'chatgpt_web' ? (
              <div className="space-y-3 rounded-md border border-emerald-500/30 bg-emerald-950/20 p-3.5">
                <div className="flex items-center justify-between">
                  <span className="font-medium text-emerald-300">Trạng thái ChatGPT Web:</span>
                  {chatGptStatus?.isLoggedIn ? (
                    <span className="flex items-center gap-1.5 text-xs font-semibold text-emerald-400 bg-emerald-500/10 px-2.5 py-1 rounded-md border border-emerald-500/30">
                      <CheckCircle2 className="h-3.5 w-3.5" />
                      Đã đăng nhập
                    </span>
                  ) : (
                    <span className="flex items-center gap-1.5 text-xs font-semibold text-amber-400 bg-amber-500/10 px-2.5 py-1 rounded-md border border-amber-500/30">
                      <AlertCircle className="h-3.5 w-3.5" />
                      Chưa đăng nhập
                    </span>
                  )}
                </div>

                <div className="flex flex-wrap items-center gap-2">
                  {chatGptStatus?.isLoggedIn ? (
                    <>
                      <button
                        type="button"
                        onClick={handleOpenChatGptLogin}
                        disabled={isOpeningChatGptLogin}
                        className="flex-1 rounded-md bg-surface-2 hover:bg-surface-3 text-text font-medium py-2 px-3 text-xs transition cursor-pointer flex items-center justify-center gap-1.5 border border-border"
                        title="Mở cửa sổ ChatGPT Web để xem hoặc thao tác trực tiếp"
                      >
                        <ExternalLink className="h-3.5 w-3.5 text-emerald-400" />
                        {isOpeningChatGptLogin ? 'Đang mở...' : 'Mở cửa sổ Web'}
                      </button>
                      <button
                        type="button"
                        onClick={handleLogoutChatGpt}
                        disabled={isLoggingOutChatGpt}
                        className="rounded-md border border-rose-900/40 bg-rose-950/30 hover:bg-rose-900/50 text-rose-300 py-2 px-3 text-xs transition cursor-pointer flex items-center gap-1.5"
                        title="Đăng xuất phiên ChatGPT Web trên máy này"
                      >
                        <LogOut className="h-3.5 w-3.5" />
                        {isLoggingOutChatGpt ? 'Đang thoát...' : 'Đăng xuất'}
                      </button>
                      <button
                        type="button"
                        onClick={checkChatGptStatus}
                        disabled={isCheckingChatGpt}
                        className="rounded-md border border-border bg-surface-2 hover:bg-surface-3 text-text py-2 px-3 text-xs transition cursor-pointer"
                      >
                        {isCheckingChatGpt ? 'Đang kiểm tra...' : 'Kiểm tra lại'}
                      </button>
                    </>
                  ) : (
                    <>
                      <button
                        type="button"
                        onClick={handleOpenChatGptLogin}
                        disabled={isOpeningChatGptLogin}
                        className="flex-1 rounded-md bg-emerald-600 hover:bg-emerald-500 text-white font-medium py-2 px-3 text-xs transition cursor-pointer flex items-center justify-center gap-1.5"
                      >
                        <Sparkles className="h-3.5 w-3.5" />
                        {isOpeningChatGptLogin ? 'Đang mở cửa sổ...' : 'Đăng nhập ChatGPT Web'}
                      </button>
                      <button
                        type="button"
                        onClick={checkChatGptStatus}
                        disabled={isCheckingChatGpt}
                        className="rounded-md border border-border bg-surface-2 hover:bg-surface-3 text-text py-2 px-3 text-xs transition cursor-pointer"
                      >
                        {isCheckingChatGpt ? 'Đang kiểm tra...' : 'Kiểm tra lại'}
                      </button>
                    </>
                  )}
                </div>

                <div className="pt-2 border-t border-border">
                  <label className="flex items-center gap-2 text-xs text-text cursor-pointer">
                    <input
                      type="checkbox"
                      checked={form.llm.chatgptWebMode === 'visible'}
                      onChange={(e) =>
                        setForm({
                          ...form,
                          llm: {
                            ...form.llm,
                            chatgptWebMode: e.target.checked ? 'visible' : 'offscreen',
                          },
                        })
                      }
                      className="rounded border-border bg-surface text-accent focus:ring-accent/30"
                    />
                    <span>Xem trực tiếp AI gõ chữ (Mở cửa sổ Live trên màn hình)</span>
                  </label>
                  <p className="text-[11px] text-text-muted mt-1 pl-5">
                    Mặc định: Chạy ngầm trong nền (Offscreen) hoàn toàn không che khuất màn hình.
                  </p>
                </div>

                <p className="text-[11px] text-emerald-400/90 leading-relaxed">
                  💡 <strong>Chế độ Tiết kiệm (Zero API Cost):</strong> Tự động hóa tài khoản ChatGPT miễn phí trên trình duyệt qua phiên lưu trữ vĩnh viễn. Không cần thẻ tín dụng, không mất phí API token.
                </p>
              </div>
            ) : form.llm.provider === 'gemini_web' ? (
              <div className="space-y-3 rounded-md border border-blue-500/30 bg-blue-950/20 p-3.5">
                <div className="flex items-center justify-between">
                  <span className="font-medium text-blue-300">Trạng thái Gemini Web (Google):</span>
                  {geminiStatus?.isLoggedIn ? (
                    <span className="flex items-center gap-1.5 text-xs font-semibold text-blue-400 bg-blue-500/10 px-2.5 py-1 rounded-md border border-blue-500/30">
                      <CheckCircle2 className="h-3.5 w-3.5" />
                      Đã đăng nhập
                    </span>
                  ) : (
                    <span className="flex items-center gap-1.5 text-xs font-semibold text-amber-400 bg-amber-500/10 px-2.5 py-1 rounded-md border border-amber-500/30">
                      <AlertCircle className="h-3.5 w-3.5" />
                      Chưa đăng nhập
                    </span>
                  )}
                </div>

                <div className="flex flex-wrap items-center gap-2">
                  {geminiStatus?.isLoggedIn ? (
                    <>
                      <button
                        type="button"
                        onClick={handleOpenGeminiLogin}
                        disabled={isOpeningGeminiLogin}
                        className="flex-1 rounded-md bg-surface-2 hover:bg-surface-3 text-text font-medium py-2 px-3 text-xs transition cursor-pointer flex items-center justify-center gap-1.5 border border-border"
                        title="Mở cửa sổ Gemini Web để xem hoặc thao tác trực tiếp"
                      >
                        <ExternalLink className="h-3.5 w-3.5 text-blue-400" />
                        {isOpeningGeminiLogin ? 'Đang mở...' : 'Mở cửa sổ Web'}
                      </button>
                      <button
                        type="button"
                        onClick={handleLogoutGemini}
                        disabled={isLoggingOutGemini}
                        className="rounded-md border border-rose-900/40 bg-rose-950/30 hover:bg-rose-900/50 text-rose-300 py-2 px-3 text-xs transition cursor-pointer flex items-center gap-1.5"
                        title="Đăng xuất phiên Gemini Web trên máy này"
                      >
                        <LogOut className="h-3.5 w-3.5" />
                        {isLoggingOutGemini ? 'Đang thoát...' : 'Đăng xuất'}
                      </button>
                      <button
                        type="button"
                        onClick={checkGeminiStatus}
                        disabled={isCheckingGemini}
                        className="rounded-md border border-border bg-surface-2 hover:bg-surface-3 text-text py-2 px-3 text-xs transition cursor-pointer"
                      >
                        {isCheckingGemini ? 'Đang kiểm tra...' : 'Kiểm tra lại'}
                      </button>
                    </>
                  ) : (
                    <>
                      <button
                        type="button"
                        onClick={handleOpenGeminiLogin}
                        disabled={isOpeningGeminiLogin}
                        className="flex-1 rounded-md bg-blue-600 hover:bg-blue-500 text-white font-medium py-2 px-3 text-xs transition cursor-pointer flex items-center justify-center gap-1.5"
                      >
                        <Sparkles className="h-3.5 w-3.5" />
                        {isOpeningGeminiLogin ? 'Đang mở cửa sổ...' : 'Đăng nhập Gemini Web'}
                      </button>
                      <button
                        type="button"
                        onClick={checkGeminiStatus}
                        disabled={isCheckingGemini}
                        className="rounded-md border border-border bg-surface-2 hover:bg-surface-3 text-text py-2 px-3 text-xs transition cursor-pointer"
                      >
                        {isCheckingGemini ? 'Đang kiểm tra...' : 'Kiểm tra lại'}
                      </button>
                    </>
                  )}
                </div>

                <div className="pt-2 border-t border-border">
                  <label className="flex items-center gap-2 text-xs text-text cursor-pointer">
                    <input
                      type="checkbox"
                      checked={form.llm.geminiWebMode === 'visible'}
                      onChange={(e) =>
                        setForm({
                          ...form,
                          llm: {
                            ...form.llm,
                            geminiWebMode: e.target.checked ? 'visible' : 'offscreen',
                          },
                        })
                      }
                      className="rounded border-border bg-surface text-accent focus:ring-accent/30"
                    />
                    <span>Xem trực tiếp AI gõ chữ (Mở cửa sổ Live trên màn hình)</span>
                  </label>
                  <p className="text-[11px] text-text-muted mt-1 pl-5">
                    Mặc định: Chạy ngầm trong nền (Offscreen) hoàn toàn không che khuất màn hình.
                  </p>
                </div>

                <p className="text-[11px] text-blue-400/90 leading-relaxed">
                  💡 <strong>Chế độ Tiết kiệm Gemini (Zero API Cost):</strong> Tự động hóa tài khoản Gemini của bạn tại <code>gemini.google.com</code> qua phiên đăng nhập Google lưu vĩnh viễn trên máy.
                </p>
              </div>
            ) : (
              <>
                <div>
                  <label className="mb-1 block font-medium text-text">API Key</label>
                  <div className="relative">
                    <input
                      type={showApiKey ? 'text' : 'password'}
                      value={form.llm.apiKey}
                      onChange={(e) =>
                        setForm({
                          ...form,
                          llm: { ...form.llm, apiKey: e.target.value },
                        })
                      }
                      placeholder="sk-..."
                      className="w-full rounded-md border border-border bg-bg px-3 py-2 pr-10 text-text focus:border-accent/40 focus:outline-none"
                    />
                    <button
                      type="button"
                      onClick={() => setShowApiKey(!showApiKey)}
                      className="absolute right-3 top-2.5 text-text-muted hover:text-text cursor-pointer"
                    >
                      {showApiKey ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                    </button>
                  </div>
                  <p className="mt-1 text-[10px] text-text-muted">
                    Khóa được mã hoá an toàn DPAPI khi lưu trữ trên máy.
                  </p>
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="mb-1 block font-medium text-text">Model</label>
                    <input
                      type="text"
                      value={form.llm.model}
                      onChange={(e) =>
                        setForm({
                          ...form,
                          llm: { ...form.llm, model: e.target.value },
                        })
                      }
                      placeholder="deepseek-chat"
                      className="w-full rounded-md border border-border bg-bg px-3 py-2 text-text focus:border-accent/40 focus:outline-none"
                    />
                  </div>
                  <div>
                    <label className="mb-1 block font-medium text-text">Độ sáng tạo (Temp: {form.llm.temperature})</label>
                    <input
                      type="range"
                      min="0"
                      max="1"
                      step="0.1"
                      value={form.llm.temperature}
                      onChange={(e) =>
                        setForm({
                          ...form,
                          llm: { ...form.llm, temperature: parseFloat(e.target.value) },
                        })
                      }
                      className="mt-2 w-full accent-brand-cyan"
                    />
                  </div>
                </div>
              </>
            )}
          </div>
        </div>

        {/* 2. TTS & Voice Settings */}
        <div className="rounded-lg border border-border bg-surface p-5">
          <div className="mb-4 flex items-center justify-between border-b border-border pb-3">
            <div className="flex items-center gap-2">
              <Mic className="h-4 w-4 text-accent" />
              <h3 className="text-sm font-semibold text-white">2. Giọng đọc &amp; Lồng tiếng</h3>
            </div>
            {form.voice.provider === 'tiktok_tts' && (
              <span className={`text-[11px] font-medium flex items-center gap-1.5 ${hasTikTokSession ? 'text-emerald-400' : 'text-amber-400'}`}>
                {hasTikTokSession ? (
                  <>
                    <CheckCircle2 className="h-3.5 w-3.5" />
                    Đã có Session TikTok
                  </>
                ) : (
                  <>
                    <AlertCircle className="h-3.5 w-3.5" />
                    Chưa có Session TikTok
                  </>
                )}
              </span>
            )}
          </div>
          <div className="space-y-3.5 text-xs">
            <div>
              <label className="mb-1 block font-medium text-text">Công nghệ Giọng đọc (TTS Engine)</label>
              <select
                value={form.voice.provider || 'edge_tts'}
                onChange={(e) => {
                  const nextProv = e.target.value as VoiceProviderType;
                  setForm({
                    ...form,
                    voice: {
                      ...form.voice,
                      provider: nextProv,
                      voiceId: nextProv === 'piper_local' ? 'vi_VN-vais1000-medium' : nextProv === 'local_onnx' ? 'af_heart' : nextProv === 'tiktok_tts' ? 'BV074_streaming' : 'vi-VN-HoaiMyNeural',
                    },
                  });
                }}
                className="w-full rounded-md border border-border bg-bg px-3 py-2 text-text focus:border-accent/40 focus:outline-none cursor-pointer"
              >
                <option value="edge_tts">Microsoft Edge TTS (Việt Nam / Đa ngôn ngữ, miễn phí, ổn định)</option>
                <option value="tiktok_tts">TikTok TTS (Giọng đọc đặc trưng từ Session TikTok)</option>
                <option value="local_onnx">Kokoro (server local, không tự cài/chạy)</option>
                <option value="piper_local">Piper tiếng Việt (model đã cài, CPU, không cần server)</option>
              </select>
            </div>

            <div>
              <label className="mb-1 block font-medium text-text">
                {form.voice.provider === 'piper_local' ? 'Giọng đọc Piper tiếng Việt' : form.voice.provider === 'local_onnx' ? 'Giọng đọc Kokoro' : form.voice.provider === 'tiktok_tts' ? 'Giọng đọc TikTok' : 'Giọng đọc tiếng Việt (Edge TTS)'}
              </label>
              {form.voice.provider === 'piper_local' ? (
                <div><p>Voice cố định: vi_VN-vais1000-medium. Dùng runtime đã cài riêng; không tải model, không mở server. Tốc độ -50% đến +100%, pitch +0Hz. Timing từng từ là ước lượng.</p><PiperRuntimeStatus/></div>
              ) : form.voice.provider === 'local_onnx' ? (
                <div className="space-y-2">
                  <label htmlFor="studio-kokoro-url">Kokoro Base URL (HTTP loopback)</label>
                  <input id="studio-kokoro-url" value={form.voice.kokoroBaseUrl || 'http://127.0.0.1:8880/v1'}
                    onChange={e => setForm({...form,voice:{...form.voice,kokoroBaseUrl:e.target.value}})} className="w-full rounded border border-border bg-bg p-2" />
                  <label htmlFor="studio-kokoro-voice">Kokoro voice ID</label>
                  <input id="studio-kokoro-voice" value={form.voice.voiceId} onChange={e => setForm({...form,voice:{...form.voice,voiceId:e.target.value}})} className="w-full rounded border border-border bg-bg p-2" />
                  <p>Lưu URL trước khi tải catalog trong Cấu hình kênh. Kokoro xuất MP3 mono 24 kHz; không đổi pitch. Chưa nghiệm thu tiếng Việt.</p>
                </div>
              ) : form.voice.provider === 'tiktok_tts' ? (
                <select
                  value={form.voice.voiceId || 'BV074_streaming'}
                  onChange={(e) =>
                    setForm({
                      ...form,
                      voice: { ...form.voice, voiceId: e.target.value },
                    })
                  }
                  className="w-full rounded-md border border-border bg-bg px-3 py-2 text-text focus:border-accent/40 focus:outline-none cursor-pointer"
                >
                  <option value="BV074_streaming">TikTok — Tiếng Việt Nữ (BV074)</option>
                  <option value="BV075_streaming">TikTok — Tiếng Việt Nam (BV075)</option>
                  <option value="en_male_narration">TikTok — Story Teller (Anh/Mỹ)</option>
                  <option value="en_us_001">TikTok — Jessie Nữ (Anh/Mỹ)</option>
                </select>
              ) : (
                <select
                  value={form.voice.voiceId || 'vi-VN-HoaiMyNeural'}
                  onChange={(e) =>
                    setForm({
                      ...form,
                      voice: { ...form.voice, voiceId: e.target.value },
                    })
                  }
                  className="w-full rounded-md border border-border bg-bg px-3 py-2 text-text focus:border-accent/40 focus:outline-none cursor-pointer"
                >
                  <option value="vi-VN-HoaiMyNeural">Hoài My (Nữ — Truyền cảm, tự nhiên)</option>
                  <option value="vi-VN-NamMinhNeural">Nam Minh (Nam — Trầm ấm, đĩnh đạc)</option>
                </select>
              )}
            </div>

            {form.voice.provider === 'tiktok_tts' && (
              <div className="rounded-md border border-border bg-bg p-3.5 space-y-2.5">
                <div className="flex items-center justify-between">
                  <span className="font-semibold text-text">Cấu hình TikTok Session ID</span>
                  <button
                    type="button"
                    onClick={handleValidateTikTok}
                    disabled={isValidatingTikTok}
                    className="text-[11px] text-accent hover:underline cursor-pointer disabled:opacity-50"
                  >
                    {isValidatingTikTok ? 'Đang kiểm tra...' : 'Kiểm tra kết nối'}
                  </button>
                </div>

                <div className="flex items-center gap-2">
                  <div className="relative flex-1">
                    <input
                      type={showTikTokSession ? 'text' : 'password'}
                      value={tikTokSessionInput}
                      onChange={(e) => setTikTokSessionInput(e.target.value)}
                      placeholder={hasTikTokSession ? '•••••••••••••••• (Đã lưu session)' : 'Dán sessionid TikTok vào đây...'}
                      className="w-full rounded-lg border border-border bg-surface px-3 py-1.5 text-xs text-text focus:border-accent/40 focus:outline-none pr-8"
                    />
                    <button
                      type="button"
                      onClick={() => setShowTikTokSession(!showTikTokSession)}
                      className="absolute right-2.5 top-2 text-text-muted hover:text-text cursor-pointer"
                    >
                      {showTikTokSession ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
                    </button>
                  </div>
                  <button
                    type="button"
                    onClick={handleSaveTikTokSession}
                    disabled={!tikTokSessionInput.trim() || isSavingTikTokSession}
                    className="rounded-lg bg-accent-tint border border-accent/40 px-3 py-1.5 text-xs font-semibold text-accent hover:bg-accent/30 disabled:opacity-40 cursor-pointer"
                  >
                    {isSavingTikTokSession ? 'Đang lưu...' : 'Lưu Session'}
                  </button>
                </div>

                {tikTokValidateResult && (
                  <p className={`text-[11px] ${tikTokValidateResult.valid ? 'text-emerald-400' : 'text-amber-400'}`}>
                    {tikTokValidateResult.detail}
                  </p>
                )}

                <p className="text-[11px] text-text-muted leading-relaxed">
                  💡 <strong>Cơ chế tự phục hồi (Graceful Fallback):</strong> Nếu phiên TikTok chưa cấu hình hoặc hết hạn, hệ thống sẽ tự động chuyển sang giọng Edge TTS tiếng Việt tương ứng (Hoài My / Nam Minh) để tiến trình sản xuất video không bị gián đoạn.
                </p>
              </div>
            )}

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="mb-1 block font-medium text-text">Tốc độ đọc</label>
                <select
                  value={form.voice.rate}
                  onChange={(e) =>
                    setForm({
                      ...form,
                      voice: { ...form.voice, rate: e.target.value },
                    })
                  }
                  className="w-full rounded-md border border-border bg-bg px-3 py-2 text-text focus:border-accent/40 focus:outline-none"
                >
                  <option value="-15%">-15% (Chậm rãi)</option>
                  <option value="-5%">-5% (Vừa phải)</option>
                  <option value="+0%">+0% (Chuẩn)</option>
                  <option value="+10%">+10% (Hơi nhanh)</option>
                  <option value="+20%">+20% (Nhanh - TikTok)</option>
                </select>
              </div>

              <div>
                <label className="mb-1 block font-medium text-text">Trích xuất Time từng từ</label>
                <div className="flex items-center gap-2 mt-2">
                  <input
                    type="checkbox"
                    id="autoWordAlignment"
                    checked={form.voice.autoWordAlignment}
                    onChange={(e) =>
                      setForm({
                        ...form,
                        voice: { ...form.voice, autoWordAlignment: e.target.checked },
                      })
                    }
                    className="h-4 w-4 rounded accent-brand-cyan"
                  />
                  <label htmlFor="autoWordAlignment" className="text-text cursor-pointer">
                    Bật Word-boundary
                  </label>
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* 3. Google Flow Engine Settings */}
        <div className="rounded-lg border border-border bg-surface p-5">
          <div className="mb-4 flex items-center gap-2 border-b border-border pb-3">
            <Film className="h-4 w-4 text-accent" />
            <h3 className="text-sm font-semibold text-white">3. Media (Ảnh/Video)</h3>
          </div>
            <MediaRouteSettings value={form.flowEngine} projectId={config.activeProjectId} onChange={flowEngine=>setForm({...form,flowEngine})}/>
          <div className="space-y-3.5 text-xs">
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="mb-1 block font-medium text-text">Tỷ lệ khung hình</label>
                <select
                  value={form.flowEngine.aspectRatio}
                  onChange={(e) =>
                    setForm({
                      ...form,
                      flowEngine: { ...form.flowEngine, aspectRatio: e.target.value as FlowAspectRatio },
                    })
                  }
                  className="w-full rounded-md border border-border bg-bg px-3 py-2 text-text focus:border-accent/40 focus:outline-none"
                >
                  <option value="16:9">16:9 (YouTube ngang)</option>
                  <option value="9:16">9:16 (TikTok / Reels)</option>
                  <option value="1:1">1:1 (Vuông)</option>
                </select>
              </div>

              <div>
                <label className="mb-1 block font-medium text-text">Chế độ đầu ra</label>
                <select
                  value={form.flowEngine.outputMode}
                  onChange={(e) =>
                    setForm({
                      ...form,
                      flowEngine: { ...form.flowEngine, outputMode: e.target.value as any },
                    })
                  }
                  className="w-full rounded-md border border-border bg-bg px-3 py-2 text-text focus:border-accent/40 focus:outline-none"
                >
                  <option value="image">Ảnh tĩnh + Ken Burns Motion</option>
                  <option value="video">Video chuyển động</option>
                </select>
              </div>
            </div>

            <div>
              <label className="mb-1 block font-medium text-text">
                Chế độ phân cảnh thị giác (Visual Pacing)
              </label>
              <select
                value={form.flowEngine.shotMode || 'single'}
                onChange={(e) =>
                  setForm({
                    ...form,
                    flowEngine: { ...form.flowEngine, shotMode: e.target.value as any },
                  })
                }
                className="w-full rounded-md border border-border bg-bg px-3 py-2 text-text focus:border-accent/40 focus:outline-none"
              >
                <option value="single">1 câu kịch bản = 1 phân cảnh (1:1 - Khuyến nghị, nhanh &amp; tiết kiệm lượt)</option>
                <option value="multi">Đa góc quay điện ảnh (Multi-shot - Tự động chia 2-4 góc máy)</option>
              </select>
              <p className="mt-1 text-[11px] text-text-muted">
                Chế độ 1:1 đảm bảo mỗi câu thoại có đúng 1 media tương ứng, không bị lặp lại phân cảnh và tiết kiệm credit.
              </p>
            </div>

            <div>
              <label className="mb-1 block font-medium text-text">
                Mức độ chi tiết hoá phân cảnh (Granularity)
              </label>
              <select
                value={form.flowEngine.granularity || 'balanced'}
                onChange={(e) =>
                  setForm({
                    ...form,
                    flowEngine: { ...form.flowEngine, granularity: e.target.value as any },
                  })
                }
                className="w-full rounded-md border border-border bg-bg px-3 py-2 text-text focus:border-accent/40 focus:outline-none"
              >
                <option value="detailed">🎯 Chi tiết (1 shot/câu, bám sát nội dung nhất)</option>
                <option value="balanced">⚖️ Cân bằng (Mặc định - AI tự gộp các câu mô tả tĩnh &amp; tối ưu pacing)</option>
                <option value="fast">⚡ Nhanh (Ưu tiên gộp nhiều câu vào 1 shot ~8-15s, tiết kiệm credit &amp; thời gian)</option>
              </select>
              <p className="mt-1 text-[11px] text-text-muted">
                Ở mức "Cân bằng" hoặc "Nhanh", AI tự động nhận diện các đoạn mô tả tĩnh kéo dài để gộp thành 1 shot ảnh kèm hiệu ứng Ken Burns, tránh giật hình và tiết kiệm thời gian sinh media.
              </p>
            </div>

            <div>
              <label className="mb-1 block font-medium text-text">Tiền tố phong cách (Style Prefix)</label>
              <input
                type="text"
                value={form.flowEngine.stylePromptPrefix}
                onChange={(e) =>
                  setForm({
                    ...form,
                    flowEngine: { ...form.flowEngine, stylePromptPrefix: e.target.value },
                  })
                }
                className="w-full rounded-md border border-border bg-bg px-3 py-2 text-text focus:border-accent/40 focus:outline-none"
              />
            </div>

            <div>
              <label className="mb-1 block font-medium text-text">Negative Prompt</label>
              <input
                type="text"
                value={form.flowEngine.negativePrompt}
                onChange={(e) =>
                  setForm({
                    ...form,
                    flowEngine: { ...form.flowEngine, negativePrompt: e.target.value },
                  })
                }
                className="w-full rounded-md border border-border bg-bg px-3 py-2 text-text focus:border-accent/40 focus:outline-none"
              />
            </div>
          </div>
        </div>

        {/* 4. Rendering & Subtitle Settings */}
        <div className="rounded-lg border border-border bg-surface p-5">
          <div className="mb-4 flex items-center gap-2 border-b border-border pb-3">
            <Video className="h-4 w-4 text-accent" />
            <h3 className="text-sm font-semibold text-white">4. Dựng phim (FFmpeg) & Phụ đề</h3>
          </div>
          <div className="space-y-3.5 text-xs">
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="mb-1 block font-medium text-text">Độ phân giải</label>
                <select
                  value={form.rendering.resolution}
                  onChange={(e) =>
                    setForm({
                      ...form,
                      rendering: { ...form.rendering, resolution: e.target.value as RenderResolution },
                    })
                  }
                  className="w-full rounded-md border border-border bg-bg px-3 py-2 text-text focus:border-accent/40 focus:outline-none"
                >
                  <option value="1080p">1080p (Full HD)</option>
                  <option value="720p">720p (Nhanh)</option>
                  <option value="4k">4K (Ultra HD)</option>
                </select>
              </div>

              <div>
                <label className="mb-1 block font-medium text-text">Kiểu hiển thị phụ đề</label>
                <select
                  value={form.subtitles.preset}
                  onChange={(e) =>
                    setForm({
                      ...form,
                      subtitles: { ...form.subtitles, preset: e.target.value as SubtitlePreset },
                    })
                  }
                  className="w-full rounded-md border border-border bg-bg px-3 py-2 text-text focus:border-accent/40 focus:outline-none"
                >
                  <option value="tiktok_bold">TikTok Bold (Chữ to nổi bật)</option>
                  <option value="minimalist">Minimalist (Tinh gọn, thanh lịch)</option>
                  <option value="karaoke_glow">Karaoke Glow (Phát sáng)</option>
                </select>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="mb-1 block font-medium text-text">
                  Âm lượng nhạc nền ({Math.round(form.rendering.bgmVolume * 100)}%)
                </label>
                <div className="mb-2 flex items-center gap-2">
                  <input className="min-w-0 flex-1 rounded border border-border bg-surface px-2 py-1 text-xs" readOnly value={form.rendering.defaultBgmPath || ''} placeholder="Chưa chọn nhạc nền" title={form.rendering.defaultBgmPath} />
                  <button type="button" disabled={isSaving} className="rounded border border-border px-2 py-1 text-xs" onClick={async () => {
                    try {
                      if (!window.vanhsub?.dialog?.openAudioFile) throw new Error('Chức năng chọn nhạc chưa sẵn sàng.');
                      const selected = await window.vanhsub.dialog.openAudioFile();
                      if (!selected) return;
                      dirtySections.current.set('rendering', ++editVersion.current);
                      setFormState(current => ({ ...current, rendering: { ...current.rendering, defaultBgmPath: selected } }));
                    } catch (error) { setSaveMessage(`Lỗi chọn nhạc: ${error instanceof Error ? error.message : String(error)}`); }
                  }}>Chọn</button>
                  {form.rendering.defaultBgmPath && <button type="button" disabled={isSaving} className="rounded border border-border px-2 py-1 text-xs" onClick={() => setForm({ ...form, rendering: { ...form.rendering, defaultBgmPath: undefined } })}>Bỏ</button>}
                </div>
                <input
                  type="range"
                  min="0"
                  max="0.30"
                  step="0.01"
                  value={form.rendering.bgmVolume}
                  onChange={(e) =>
                    setForm({
                      ...form,
                      rendering: { ...form.rendering, bgmVolume: parseFloat(e.target.value) },
                    })
                  }
                  className="mt-2 w-full accent-brand-cyan"
                />
              </div>

              <div className="flex flex-col justify-center">
                <div className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    id="kenBurns"
                    checked={form.rendering.kenBurnsEffect}
                    onChange={(e) =>
                      setForm({
                        ...form,
                        rendering: { ...form.rendering, kenBurnsEffect: e.target.checked },
                      })
                    }
                    className="h-4 w-4 rounded accent-brand-cyan"
                  />
                  <label htmlFor="kenBurns" className="text-text cursor-pointer">
                    Hiệu ứng Ken Burns (Zoom/Pan)
                  </label>
                </div>
                <div className="flex items-center gap-2 mt-2">
                  <input
                    type="checkbox"
                    id="audioDucking"
                    checked={form.rendering.autoAudioDucking}
                    onChange={(e) =>
                      setForm({
                        ...form,
                        rendering: { ...form.rendering, autoAudioDucking: e.target.checked },
                      })
                    }
                    className="h-4 w-4 rounded accent-brand-cyan"
                  />
                  <label htmlFor="audioDucking" className="text-text cursor-pointer">
                    Hạ nhạc nền khi nói (Ducking)
                  </label>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
