import React, { useState, useEffect, useCallback, useRef } from 'react';
import {
  Sparkles,
  Key,
  Eye,
  EyeOff,
  CheckCircle2,
  AlertCircle,
  ExternalLink,
  Loader2,
  Trash2,
  ShieldCheck,
  Zap,
  X,
  Cpu,
  Globe,
  ShieldAlert,
  Timer,
  Wifi,
  Calendar,
  RefreshCw,
  LogOut,
  ChevronDown,
  ChevronUp,
} from 'lucide-react';
import { toast } from 'sonner';

interface ApiKeyConfigModalProps {
  isOpen: boolean;
  onClose: () => void;
  onKeyUpdated?: (hasKey: boolean) => void;
  initialTab?: 'free_session' | 'api_key' | 'simulation';
}

type TabType = 'free_session' | 'api_key' | 'simulation';

export default function ApiKeyConfigModal({
  isOpen,
  onClose,
  onKeyUpdated,
  initialTab = 'free_session',
}: ApiKeyConfigModalProps) {
  const [activeTab, setActiveTab] = useState<TabType>(initialTab);

  // Gemini API Key State
  const [apiKey, setApiKey] = useState('');
  const [showKey, setShowKey] = useState(false);
  const [isTestingApiKey, setIsTestingApiKey] = useState(false);
  const [apiKeyTestResult, setApiKeyTestResult] = useState<{ ok: boolean; message: string } | null>(null);

  // Google Veo Free Session State
  const [sessionStatus, setSessionStatus] = useState<
    'active' | 'expired' | 'unauthenticated' | 'rate_limited' | 'captcha_required' | 'out_of_credits' | 'unknown'
  >('unknown');
  const [hasSession, setHasSession] = useState(false);
  const [accountEmail, setAccountEmail] = useState<string | undefined>();
  const [lastChecked, setLastChecked] = useState<number | undefined>();
  const [isValidatingSession, setIsValidatingSession] = useState(false);
  const [isOpeningLobby, setIsOpeningLobby] = useState(false);
  const [validationDetail, setValidationDetail] = useState<string>('');

  // Anti-Spam status & cooldown
  const [remainingCooldown, setRemainingCooldown] = useState(0);
  const [antiSpamLocked, setAntiSpamLocked] = useState(false);
  const [showSpamGuidelines, setShowSpamGuidelines] = useState(true);

  // Manual Cookie Input
  const [showManualCookieInput, setShowManualCookieInput] = useState(false);
  const [manualCookieValue, setManualCookieValue] = useState('');
  const [isSavingCookie, setIsSavingCookie] = useState(false);

  // Lobby Debug State
  const [isLobbyDebug, setIsLobbyDebug] = useState(false);
  const [isTogglingLobbyDebug, setIsTogglingLobbyDebug] = useState(false);

  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);

  // Cooldown countdown timer interval
  const timerRef = useRef<NodeJS.Timeout | null>(null);

  const loadAllStatus = useCallback(async () => {
    setIsLoading(true);
    try {
      if (typeof window !== 'undefined' && window.vanhsub?.settings) {
        const [storedKey, storedMode] = await Promise.all([
          window.vanhsub.settings.get('geminiApiKey'),
          window.vanhsub.settings.get('veoMode'),
        ]);
        setApiKey(typeof storedKey === 'string' ? storedKey : '');
        if (storedMode && ['free_session', 'api_key', 'simulation'].includes(String(storedMode))) {
          setActiveTab(storedMode as TabType);
        }
      }

      if (typeof window !== 'undefined' && window.vanhsub?.veo?.status) {
        const statusRes = await window.vanhsub.veo.status();
        setHasSession(Boolean(statusRes.hasSession));
        setSessionStatus(statusRes.sessionStatus || 'unknown');
        setAccountEmail(statusRes.email);
        setLastChecked(statusRes.lastChecked);
        if (statusRes.antiSpam) {
          setRemainingCooldown(statusRes.antiSpam.remainingCooldownSec || 0);
          setAntiSpamLocked(Boolean(statusRes.antiSpam.isLocked));
        }
      }

      if (typeof window !== 'undefined' && window.vanhsub?.veo?.isLobbyDebug) {
        const debugVisible = await window.vanhsub.veo.isLobbyDebug();
        setIsLobbyDebug(Boolean(debugVisible));
      }
    } catch (err) {
      console.error('Lỗi khi nạp trạng thái Veo:', err);
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!isOpen) return;
    loadAllStatus();

    // Khởi động đồng hồ đếm ngược nếu có cooldown
    if (timerRef.current) clearInterval(timerRef.current);
    timerRef.current = setInterval(() => {
      setRemainingCooldown((prev) => (prev > 0 ? prev - 1 : 0));
    }, 1000);

    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, [isOpen, loadAllStatus]);

  if (!isOpen) return null;

  // =========================================================================
  // ACTIONS CHO CHẾ ĐỘ SẢNH MIỄN PHÍ
  // =========================================================================

  const handleOpenLobby = async () => {
    setIsOpeningLobby(true);
    try {
      if (typeof window !== 'undefined' && window.vanhsub?.veo?.openLobby) {
        await window.vanhsub.veo.openLobby();
        toast.info('Đang mở Sảnh Google Veo. Vui lòng đăng nhập tài khoản Google của bạn trong cửa sổ xuất hiện.');
        // Sau khi mở sảnh, tự động kiểm tra lại trạng thái sau 3s
        setTimeout(() => {
          handleValidateSession(false);
        }, 3000);
      }
    } catch (err: any) {
      toast.error('Lỗi mở sảnh Google Veo: ' + (err?.message || err));
    } finally {
      setIsOpeningLobby(false);
    }
  };

  const handleValidateSession = async (showToast = true) => {
    setIsValidatingSession(true);
    setValidationDetail('');
    try {
      if (typeof window !== 'undefined' && window.vanhsub?.veo?.validate) {
        const res = await window.vanhsub.veo.validate();
        setSessionStatus(res.status);
        setValidationDetail(res.detail);
        setLastChecked(res.lastChecked);
        setHasSession(res.valid);
        if (res.email) setAccountEmail(res.email);

        if (res.valid) {
          if (showToast) toast.success('Session Google Veo đang hoạt động hoàn hảo! Sẵn sàng sinh video.');
        } else {
          if (showToast) {
            if (res.status === 'expired') {
              toast.error('Session Google đã hết hạn hoặc đã đăng xuất. Vui lòng bấm "Mở sảnh Google" để đăng nhập lại!');
            } else if (res.status === 'captcha_required') {
              toast.warning('Google yêu cầu giải Captcha. Vui lòng mở sảnh để hoàn tất!');
            } else if (res.status === 'rate_limited') {
              toast.warning('Google đang giới hạn tần suất (Rate Limit 429). Vui lòng đợi hoặc đổi tài khoản!');
            } else {
              toast.error(res.detail || 'Session không hợp lệ.');
            }
          }
        }
      }
    } catch (err: any) {
      setValidationDetail('Lỗi kiểm tra: ' + (err?.message || err));
      if (showToast) toast.error('Không thể kiểm tra session Google');
    } finally {
      setIsValidatingSession(false);
    }
  };

  const handleSaveManualCookie = async () => {
    const raw = manualCookieValue.trim();
    if (!raw) {
      toast.error('Vui lòng dán chuỗi cookie hợp lệ từ trình duyệt!');
      return;
    }
    setIsSavingCookie(true);
    try {
      if (typeof window !== 'undefined' && window.vanhsub?.veo?.saveSession) {
        const res = await window.vanhsub.veo.saveSession(raw);
        if (res.ok) {
          toast.success('Đã lưu Cookie phiên làm việc!');
          setManualCookieValue('');
          setShowManualCookieInput(false);
          await handleValidateSession(true);
        } else {
          toast.error(res.error || 'Không thể lưu cookie');
        }
      }
    } catch (err: any) {
      toast.error('Lỗi khi lưu: ' + (err?.message || err));
    } finally {
      setIsSavingCookie(false);
    }
  };

  const handleClearSession = async () => {
    if (!confirm('Bạn có chắc chắn muốn xóa session Google Veo đã lưu trên máy?')) return;
    try {
      if (typeof window !== 'undefined' && window.vanhsub?.veo?.clearSession) {
        await window.vanhsub.veo.clearSession();
        setHasSession(false);
        setSessionStatus('unauthenticated');
        setValidationDetail('Đã xóa session đăng nhập.');
        toast.info('Đã xóa session Google Veo.');
      }
    } catch (err: any) {
      toast.error('Lỗi xóa session: ' + (err?.message || err));
    }
  };

  const handleToggleLobbyDebug = async () => {
    setIsTogglingLobbyDebug(true);
    try {
      if (isLobbyDebug) {
        if (typeof window !== 'undefined' && window.vanhsub?.veo?.hideLobbyOffscreen) {
          await window.vanhsub.veo.hideLobbyOffscreen();
          setIsLobbyDebug(false);
          toast.info('Đã ẩn cửa sổ Flow ra ngoài vùng màn hình (-3000, -3000).');
        }
      } else {
        if (typeof window !== 'undefined' && window.vanhsub?.veo?.showLobbyDebug) {
          await window.vanhsub.veo.showLobbyDebug();
          setIsLobbyDebug(true);
          toast.success('Đã hiện cửa sổ Flow trên màn hình để debug (100, 100).');
        }
      }
    } catch (err: any) {
      toast.error('Lỗi khi đổi trạng thái hiển thị cửa sổ Flow: ' + (err?.message || err));
    } finally {
      setIsTogglingLobbyDebug(false);
    }
  };

  // =========================================================================
  // ACTIONS CHO API KEY & LƯU CHẾ ĐỘ
  // =========================================================================

  const handleTestApiKey = async () => {
    const key = apiKey.trim();
    if (!key) {
      toast.error('Vui lòng nhập Gemini API Key trước khi kiểm tra!');
      return;
    }

    setIsTestingApiKey(true);
    setApiKeyTestResult(null);

    try {
      if (typeof window !== 'undefined' && window.vanhsub?.settings) {
        await window.vanhsub.settings.set('geminiApiKey', key);
      }

      if (typeof window !== 'undefined' && window.vanhsub?.ai?.polishLine) {
        await window.vanhsub.ai.polishLine({ text: 'Xin chào Google AI' });
        setApiKeyTestResult({
          ok: true,
          message: 'Kết nối thành công! Key hợp lệ cho Google Veo 3.1, Imagen 3 và Gemini Director.',
        });
        toast.success('Kết nối Google Gemini AI thành công!');
        if (onKeyUpdated) onKeyUpdated(true);
      } else {
        if ((key.startsWith('AIza') || key.startsWith('AQ.')) && key.length >= 35) {
          setApiKeyTestResult({ ok: true, message: 'Định dạng Key hợp lệ chuẩn Google AI Studio / Cloud!' });
          toast.success('Định dạng key hợp lệ!');
          if (onKeyUpdated) onKeyUpdated(true);
        } else {
          setApiKeyTestResult({
            ok: false,
            message: 'Key không đúng định dạng chuẩn của Google (thường bắt đầu bằng "AIza..." hoặc "AQ...").',
          });
        }
      }
    } catch (err: any) {
      setApiKeyTestResult({
        ok: false,
        message: err?.message || 'Không thể kết nối đến Google Gemini API. Vui lòng kiểm tra lại key.',
      });
      toast.error('Kiểm tra kết nối thất bại');
    } finally {
      setIsTestingApiKey(false);
    }
  };

  const handleApplyModeAndSave = async () => {
    setIsSaving(true);
    try {
      if (typeof window !== 'undefined' && window.vanhsub?.settings) {
        await window.vanhsub.settings.set('veoMode', activeTab);
        if (activeTab === 'api_key') {
          await window.vanhsub.settings.set('geminiApiKey', apiKey.trim());
        }
      }

      if (typeof window !== 'undefined' && window.vanhsub?.veo?.setMode) {
        await window.vanhsub.veo.setMode(activeTab);
      }

      if (activeTab === 'free_session') {
        toast.success('Đã áp dụng Chế độ Sảnh Miễn Phí (Google Veo Credits)!');
      } else if (activeTab === 'api_key') {
        toast.success('Đã áp dụng Chế độ API Key Trả phí (Google Cloud)!');
      } else {
        toast.success('Đã áp dụng Chế độ Mô phỏng Offline (FFmpeg)!');
      }

      if (onKeyUpdated) {
        onKeyUpdated(activeTab === 'free_session' ? hasSession : Boolean(apiKey.trim()));
      }
      onClose();
    } catch (err: any) {
      toast.error('Lỗi khi lưu cấu hình: ' + (err?.message || err));
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4 animate-in fade-in duration-200">
      <div className="w-full max-w-2xl max-h-[92vh] rounded-lg border border-border bg-[#0d131f] p-6 flex flex-col gap-4 text-text overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-border pb-3 shrink-0">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-md bg-accent p-0.5">
              <div className="flex h-full w-full items-center justify-center rounded-[10px] bg-[#0d131f]">
                <Sparkles className="h-5 w-5 text-amber-400" />
              </div>
            </div>
            <div>
              <h2 className="text-base font-bold text-white flex items-center gap-2">
                <span>Cấu hình Google Veo & Gemini AI</span>
                <span className="text-[10px] px-2 py-0.5 rounded-full bg-indigo-950/80 border border-indigo-700/60 text-indigo-300 font-semibold uppercase tracking-wider">
                  v3.1
                </span>
              </h2>
              <p className="text-xs text-text-muted">
                Chọn Chế độ Sảnh Miễn Phí (tận dụng credit web) hoặc API Key trả phí
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg text-text-muted hover:text-white hover:bg-surface-2 transition-colors cursor-pointer"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* 3-Mode Selector Tabs */}
        <div className="grid grid-cols-3 gap-2 bg-bg p-1 rounded-md border border-border shrink-0">
          <button
            type="button"
            onClick={() => setActiveTab('free_session')}
            className={`flex items-center justify-center gap-2 py-2 px-3 rounded-lg text-xs font-semibold transition-all cursor-pointer ${
              activeTab === 'free_session'
                ? 'bg-success text-white  '
                : 'text-text-muted hover:text-text hover:bg-surface'
            }`}
          >
            <Globe className="w-4 h-4" />
            <span>Sảnh Miễn Phí (0đ)</span>
            <span className="hidden sm:inline text-[10px] px-1.5 py-0.2 rounded bg-black/25 text-emerald-200">
              Khuyên dùng
            </span>
          </button>

          <button
            type="button"
            onClick={() => setActiveTab('api_key')}
            className={`flex items-center justify-center gap-2 py-2 px-3 rounded-lg text-xs font-semibold transition-all cursor-pointer ${
              activeTab === 'api_key'
                ? 'bg-accent text-white  '
                : 'text-text-muted hover:text-text hover:bg-surface'
            }`}
          >
            <Key className="w-4 h-4" />
            <span>API Key Trả Phí</span>
          </button>

          <button
            type="button"
            onClick={() => setActiveTab('simulation')}
            className={`flex items-center justify-center gap-2 py-2 px-3 rounded-lg text-xs font-semibold transition-all cursor-pointer ${
              activeTab === 'simulation'
                ? 'bg-warning text-white  '
                : 'text-text-muted hover:text-text hover:bg-surface'
            }`}
          >
            <Cpu className="w-4 h-4" />
            <span>Mô Phỏng Offline</span>
          </button>
        </div>

        {/* Scrollable Tab Content */}
        <div className="flex-1 overflow-y-auto space-y-4 pr-1 scrollbar-thin scrollbar-thumb-slate-800">
          {/* =========================================================================
              TAB 1: CHẾ ĐỘ SẢNH MIỄN PHÍ (GOOGLE VEO FREE SESSION)
              ========================================================================= */}
          {activeTab === 'free_session' && (
            <div className="space-y-4">
              {/* Session Health Status Card */}
              <div
                className={`p-4 rounded-md border flex flex-col gap-3 transition-colors ${
                  sessionStatus === 'active'
                    ? 'bg-emerald-950/30 border-emerald-800/80 text-emerald-200'
                    : sessionStatus === 'out_of_credits'
                    ? 'bg-rose-950/30 border-rose-800/80 text-rose-200'
                    : sessionStatus === 'expired'
                    ? 'bg-rose-950/30 border-rose-800/80 text-rose-200'
                    : sessionStatus === 'rate_limited'
                    ? 'bg-amber-950/30 border-amber-800/80 text-amber-200'
                    : sessionStatus === 'captcha_required'
                    ? 'bg-orange-950/30 border-orange-800/80 text-orange-200'
                    : 'bg-surface border-border text-text'
                }`}
              >
                <div className="flex items-start justify-between">
                  <div className="flex items-start gap-3">
                    {sessionStatus === 'active' ? (
                      <CheckCircle2 className="w-5 h-5 text-emerald-400 shrink-0 mt-0.5" />
                    ) : sessionStatus === 'out_of_credits' || sessionStatus === 'expired' ? (
                      <AlertCircle className="w-5 h-5 text-rose-400 shrink-0 mt-0.5" />
                    ) : (
                      <Globe className="w-5 h-5 text-amber-400 shrink-0 mt-0.5" />
                    )}
                    <div>
                      <div className="font-bold text-sm flex items-center gap-2">
                        <span>
                          {sessionStatus === 'active'
                            ? 'Session Sảnh Google Veo Đang Hoạt Động (Sẵn sàng)'
                            : sessionStatus === 'out_of_credits'
                            ? 'Tài Khoản Đã Hết Tín Dụng Google Flow'
                            : sessionStatus === 'expired'
                            ? 'Session Đã Hết Hạn hoặc Đã Đăng Xuất'
                            : sessionStatus === 'rate_limited'
                            ? 'Google Đang Giới Hạn Tần Suất (Rate Limit 429)'
                            : sessionStatus === 'captcha_required'
                            ? 'Google Yêu Cầu Giải Captcha Chống Bot'
                            : 'Chưa Đăng Nhập Sảnh Google Veo'}
                        </span>
                      </div>
                      <p className="text-xs opacity-90 mt-0.5 leading-relaxed">
                        {sessionStatus === 'active'
                          ? 'Hệ thống đã nhận diện phiên làm việc hợp lệ. Video sẽ được tạo bằng credit miễn phí từ Google Labs.'
                          : sessionStatus === 'out_of_credits'
                          ? 'Tài khoản Google của bạn đã dùng hết credit Google Flow miễn phí. Bạn có thể đổi tài khoản khác trên Sảnh.'
                          : sessionStatus === 'expired'
                          ? 'Google đã ngắt phiên đăng nhập. Vui lòng bấm "Mở Sảnh Google" bên dưới để đăng nhập lại chỉ trong 5 giây!'
                          : 'Đăng nhập tài khoản Google vào sảnh để app tự động bắt session cookie và sử dụng credit Veo miễn phí.'}
                      </p>
                      {accountEmail && (
                        <p className="text-[11px] font-mono mt-1 text-text-muted">
                          Tài khoản: <span className="text-white font-medium">{accountEmail}</span>
                        </p>
                      )}
                      {lastChecked && (
                        <p className="text-[10px] text-text-muted mt-0.5">
                          Kiểm tra lần cuối: {new Date(lastChecked).toLocaleTimeString('vi-VN')}
                        </p>
                      )}
                    </div>
                  </div>

                  {/* Cooldown Badge */}
                  {remainingCooldown > 0 && (
                    <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-amber-500/20 border border-amber-500/40 text-amber-300 text-xs font-mono shrink-0">
                      <Timer className="w-3.5 h-3.5 animate-spin" />
                      <span>Hồi chiêu: {remainingCooldown}s</span>
                    </div>
                  )}
                </div>

                {/* Validation Detail Note */}
                {validationDetail && (
                  <div className="text-[11px] p-2 rounded-lg bg-black/40 border border-border font-mono text-text">
                    {validationDetail}
                  </div>
                )}

                {/* Main Action Buttons */}
                <div className="flex flex-wrap items-center gap-2 pt-1">
                  <button
                    type="button"
                    onClick={handleOpenLobby}
                    disabled={isOpeningLobby}
                    className="flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-bold transition-colors cursor-pointer disabled:opacity-50"
                    title="Mở cửa sổ trình duyệt chính thức của Google để đăng nhập nhận credit"
                  >
                    {isOpeningLobby ? (
                      <Loader2 className="w-3.5 h-3.5 animate-spin" />
                    ) : (
                      <ExternalLink className="w-3.5 h-3.5" />
                    )}
                    <span>Mở Sảnh Google Veo (Đăng nhập)</span>
                  </button>

                  <button
                    type="button"
                    onClick={() => handleValidateSession(true)}
                    disabled={isValidatingSession}
                    className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-surface-2 hover:bg-surface-3 text-text text-xs font-semibold border border-border transition-colors cursor-pointer disabled:opacity-50"
                    title="Kiểm tra ngay lập tức xem session còn sống không (< 1.5s) để không mất thời gian render"
                  >
                    {isValidatingSession ? (
                      <Loader2 className="w-3.5 h-3.5 animate-spin text-amber-400" />
                    ) : (
                      <RefreshCw className="w-3.5 h-3.5 text-accent" />
                    )}
                    <span>Kiểm tra Session ngay</span>
                  </button>

                  <button
                    type="button"
                    onClick={() => setShowManualCookieInput((prev) => !prev)}
                    className="text-xs text-text-muted hover:text-text px-2 py-1.5 rounded-lg hover:bg-surface-2 transition-colors"
                  >
                    {showManualCookieInput ? 'Ẩn ô dán cookie' : 'Dán Cookie thủ công'}
                  </button>

                  <button
                    type="button"
                    onClick={handleToggleLobbyDebug}
                    disabled={isTogglingLobbyDebug}
                    className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold border transition-colors cursor-pointer disabled:opacity-50 ${
                      isLobbyDebug
                        ? 'bg-amber-500/20 hover:bg-amber-500/30 text-amber-300 border-amber-500/40'
                        : 'bg-surface-2 hover:bg-surface-3 text-text border-border'
                    }`}
                    title={
                      isLobbyDebug
                        ? 'Đưa cửa sổ Google Flow ra ngoài vùng màn hình (Offscreen: -3000, -3000)'
                        : 'Đưa cửa sổ Google Flow về màn hình chính (100, 100) để theo dõi trực tiếp quá trình automation'
                    }
                  >
                    {isTogglingLobbyDebug ? (
                      <Loader2 className="w-3.5 h-3.5 animate-spin" />
                    ) : isLobbyDebug ? (
                      <EyeOff className="w-3.5 h-3.5 text-amber-400" />
                    ) : (
                      <Eye className="w-3.5 h-3.5 text-text-muted" />
                    )}
                    <span>{isLobbyDebug ? 'Ẩn cửa sổ Flow' : 'Hiện cửa sổ Flow để debug'}</span>
                  </button>

                  {hasSession && (
                    <button
                      type="button"
                      onClick={handleClearSession}
                      className="ml-auto text-xs text-rose-400 hover:text-rose-300 hover:bg-rose-950/40 px-2 py-1.5 rounded-lg transition-colors flex items-center gap-1 cursor-pointer"
                      title="Xóa session đã lưu trên máy"
                    >
                      <LogOut className="w-3.5 h-3.5" />
                      <span>Xóa Session</span>
                    </button>
                  )}
                </div>

                {/* Collapsible Manual Cookie Form */}
                {showManualCookieInput && (
                  <div className="mt-2 pt-2 border-t border-border space-y-2 animate-in fade-in duration-150">
                    <div className="flex items-center justify-between">
                      <label className="text-[11px] font-semibold text-text">
                        Dán chuỗi Cookie từ trình duyệt (hoặc Bearer Token):
                      </label>
                      <span className="text-[10px] text-emerald-400">
                        ✓ Khắc phục triệt để lỗi "Ứng dụng không tin cậy"
                      </span>
                    </div>
                    <div className="p-2.5 rounded-lg bg-indigo-950/40 border border-indigo-800/50 text-[11px] text-text space-y-1.5">
                      <p className="font-semibold text-indigo-300">Cách lấy chuỗi Cookie đầy đủ từ Chrome / Edge / Cốc Cốc:</p>
                      <ol className="list-decimal list-inside space-y-1 text-text-muted text-[10px]">
                        <li>Truy cập <span className="text-white font-mono">flow.google.com</span> trên trình duyệt và đăng nhập tài khoản Google.</li>
                        <li>Bấm <b>F12</b> $\rightarrow$ Chọn tab <b>Network (Mạng)</b> $\rightarrow$ F5 tải lại trang $\rightarrow$ Bấm vào dòng request đầu tiên (<span className="text-white font-mono">flow.google.com</span>).</li>
                        <li>Ở bảng bên phải, tìm phần <b>Request Headers</b> $\rightarrow$ Chuột phải vào dòng <b>Cookie:</b> $\rightarrow$ Chọn <b>Copy value</b> (sẽ copy toàn bộ chuỗi).</li>
                        <li>Hoặc dùng tiện ích extension <b>Cookie-Editor</b> $\rightarrow$ Bấm <b>Export $\rightarrow$ Header String</b>.</li>
                      </ol>
                      <p className="text-[10px] text-amber-300 bg-amber-950/40 p-1.5 rounded border border-amber-800/40">
                        ⚠️ <b>Lưu ý quan trọng</b>: Google <b>bắt buộc</b> phải có đủ bộ cookie (<code className="text-amber-200">SID</code>, <code className="text-amber-200">HSID</code>, <code className="text-amber-200">SSID</code>, <code className="text-amber-200">__Secure-1PSID</code>). Nếu chỉ dán một mình giá trị <code className="text-amber-200">SID</code> thì Google sẽ từ chối xác thực ngay lập tức!
                      </p>
                    </div>
                    <textarea
                      value={manualCookieValue}
                      onChange={(e) => setManualCookieValue(e.target.value)}
                      placeholder="SID=...; HSID=...; SSID=...; __Secure-1PSID=..."
                      rows={2}
                      className="w-full text-[11px] font-mono rounded-lg bg-bg border border-border p-2 text-white placeholder-slate-600 focus:outline-none focus:border-indigo-500"
                    />
                    <div className="flex justify-end gap-2">
                      <button
                        type="button"
                        onClick={handleSaveManualCookie}
                        disabled={isSavingCookie || !manualCookieValue.trim()}
                        className="px-3 py-1 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-semibold disabled:opacity-50 cursor-pointer"
                      >
                        {isSavingCookie ? 'Đang lưu...' : 'Lưu & Kiểm tra'}
                      </button>
                    </div>
                  </div>
                )}
              </div>

              {/* =========================================================================
                  CẢNH BÁO AN TOÀN & CHỐNG SPAM GOOGLE (THEO ĐẶC TẢ YÊU CẦU CỦA USER)
                  ========================================================================= */}
              <div className="rounded-md border border-amber-800/50 bg-amber-950/20 p-3.5 space-y-2.5">
                <div
                  className="flex items-center justify-between cursor-pointer"
                  onClick={() => setShowSpamGuidelines((prev) => !prev)}
                >
                  <div className="flex items-center gap-2">
                    <ShieldAlert className="w-4 h-4 text-amber-400" />
                    <h3 className="text-xs font-bold text-amber-300 uppercase tracking-wide">
                      Cảnh báo Quan trọng: Tránh Bị Google Nghi Ngờ Spam & Khóa Nick
                    </h3>
                  </div>
                  <button type="button" className="text-amber-400">
                    {showSpamGuidelines ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
                  </button>
                </div>

                {showSpamGuidelines && (
                  <div className="space-y-2 text-xs text-text pt-1">
                    <div className="flex items-start gap-2.5 p-2 rounded-lg bg-black/40 border border-amber-900/40">
                      <ShieldAlert className="w-4 h-4 text-rose-400 shrink-0 mt-0.5" />
                      <div>
                        <span className="font-bold text-rose-300">1. Tuyệt đối dùng tài khoản phụ (Burner Account):</span>
                        <p className="text-[11px] text-text-muted mt-0.5 leading-relaxed">
                          Không nên dùng tài khoản Google chính có dữ liệu quan trọng, Google Drive hay thẻ ngân hàng. Hãy tạo riêng 1 tài khoản Google phụ để trải nghiệm sảnh Veo miễn phí.
                        </p>
                      </div>
                    </div>

                    <div className="flex items-start gap-2.5 p-2 rounded-lg bg-black/40 border border-amber-900/40">
                      <Timer className="w-4 h-4 text-amber-400 shrink-0 mt-0.5" />
                      <div>
                        <span className="font-bold text-amber-300">2. Giãn cách an toàn (Cooldown 45 giây):</span>
                        <p className="text-[11px] text-text-muted mt-0.5 leading-relaxed">
                          Google theo dõi tốc độ gọi lệnh. App tự động khóa giãn cách tối thiểu 45s giữa 2 lần render kèm độ trễ ngẫu nhiên (human jitter) để không bị gắn cờ Bot.
                        </p>
                      </div>
                    </div>

                    <div className="flex items-start gap-2.5 p-2 rounded-lg bg-black/40 border border-amber-900/40">
                      <Wifi className="w-4 h-4 text-sky-400 shrink-0 mt-0.5" />
                      <div>
                        <span className="font-bold text-sky-300">3. Sử dụng mạng Internet sạch:</span>
                        <p className="text-[11px] text-text-muted mt-0.5 leading-relaxed">
                          Không dùng VPN miễn phí, proxy công cộng hoặc IP Datacenter vì Google sẽ lập tức yêu cầu reCAPTCHA hoặc trả về lỗi 403 Forbidden.
                        </p>
                      </div>
                    </div>

                    <div className="flex items-start gap-2.5 p-2 rounded-lg bg-black/40 border border-amber-900/40">
                      <Calendar className="w-4 h-4 text-emerald-400 shrink-0 mt-0.5" />
                      <div>
                        <span className="font-bold text-emerald-300">4. Giới hạn Quota hàng ngày:</span>
                        <p className="text-[11px] text-text-muted mt-0.5 leading-relaxed">
                          Google Labs cấp hạn mức credit nhất định theo ngày cho mỗi tài khoản. Khi thấy báo hết lượt, hãy đợi sang ngày hôm sau hoặc đổi tài khoản khác.
                        </p>
                      </div>
                    </div>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* =========================================================================
              TAB 2: CHẾ ĐỘ API KEY TRẢ PHÍ (GEMINI / VERTEX AI)
              ========================================================================= */}
          {activeTab === 'api_key' && (
            <div className="space-y-4">
              <div className="p-3.5 rounded-md bg-indigo-950/30 border border-indigo-800/60 text-indigo-200 text-xs flex items-start gap-2.5">
                <Zap className="w-4 h-4 text-indigo-400 shrink-0 mt-0.5" />
                <p className="leading-relaxed">
                  Chế độ chính thức: Gọi thẳng vào Google Vertex AI / Gemini API qua API Key của bạn. Phù hợp cho công việc chuyên nghiệp cần tốc độ cao, không phụ thuộc sảnh web.
                </p>
              </div>

              <div className="space-y-2">
                <div className="flex items-center justify-between text-xs">
                  <label className="font-semibold text-text flex items-center gap-1.5">
                    <Key className="w-3.5 h-3.5 text-amber-400" />
                    <span>Google Gemini API Key</span>
                  </label>
                  <a
                    href="https://aistudio.google.com/app/apikey"
                    target="_blank"
                    rel="noreferrer"
                    className="text-[11px] text-indigo-400 hover:text-indigo-300 flex items-center gap-1 hover:underline"
                  >
                    <span>Lấy API Key tại Google AI Studio</span>
                    <ExternalLink className="w-3 h-3" />
                  </a>
                </div>

                <div className="relative flex items-center">
                  <input
                    type={showKey ? 'text' : 'password'}
                    value={apiKey}
                    onChange={(e) => setApiKey(e.target.value)}
                    placeholder="AIzaSy... (dán key lấy từ aistudio.google.com)"
                    className="w-full text-xs font-mono rounded-md bg-bg border border-border px-3.5 py-2.5 pr-10 text-white placeholder-slate-600 focus:outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 transition-colors"
                  />
                  <button
                    type="button"
                    onClick={() => setShowKey(!showKey)}
                    className="absolute right-3 text-text-muted hover:text-text transition-colors"
                    title={showKey ? 'Ẩn key' : 'Hiện key'}
                  >
                    {showKey ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                  </button>
                </div>

                <p className="text-[11px] text-text-muted">
                  * Khóa được mã hóa bằng DPAPI (Windows safeStorage) an toàn trên ổ đĩa máy tính của bạn.
                </p>
              </div>

              {apiKeyTestResult && (
                <div
                  className={`p-3 rounded-md border text-xs flex items-center gap-2 ${
                    apiKeyTestResult.ok
                      ? 'bg-emerald-950/40 border-emerald-800 text-emerald-300'
                      : 'bg-rose-950/40 border-rose-800 text-rose-300'
                  }`}
                >
                  {apiKeyTestResult.ok ? (
                    <CheckCircle2 className="w-4 h-4 shrink-0 text-emerald-400" />
                  ) : (
                    <AlertCircle className="w-4 h-4 shrink-0 text-rose-400" />
                  )}
                  <span>{apiKeyTestResult.message}</span>
                </div>
              )}

              <div className="flex justify-end">
                <button
                  type="button"
                  onClick={handleTestApiKey}
                  disabled={!apiKey.trim() || isTestingApiKey}
                  className="flex items-center gap-1.5 px-3.5 py-2 rounded-md bg-surface hover:bg-surface-2 border border-border text-xs font-semibold text-text hover:text-white transition-colors disabled:opacity-50 cursor-pointer"
                >
                  {isTestingApiKey ? (
                    <>
                      <Loader2 className="w-3.5 h-3.5 animate-spin text-amber-400" />
                      <span>Đang kiểm tra kết nối...</span>
                    </>
                  ) : (
                    <>
                      <ShieldCheck className="w-3.5 h-3.5 text-indigo-400" />
                      <span>Kiểm tra API Key</span>
                    </>
                  )}
                </button>
              </div>
            </div>
          )}

          {/* =========================================================================
              TAB 3: CHẾ ĐỘ MÔ PHỎNG OFFLINE (FFMPEG PREVIEW)
              ========================================================================= */}
          {activeTab === 'simulation' && (
            <div className="space-y-3">
              <div className="p-4 rounded-md bg-amber-950/20 border border-amber-800/60 text-amber-200 text-xs space-y-2">
                <div className="flex items-center gap-2 font-bold text-amber-300">
                  <Cpu className="w-4 h-4 text-amber-400" />
                  <span>Chế độ Mô phỏng Offline An toàn (100% Miễn phí & Không cần mạng)</span>
                </div>
                <p className="leading-relaxed text-[11px] opacity-90">
                  Khi bật chế độ này, app sẽ dùng FFmpeg cục bộ để tạo các clip video gradient hoạt họa mô phỏng đúng thời lượng, tỷ lệ khung hình (16:9 / 9:16) và nội dung prompt.
                </p>
                <ul className="list-disc list-inside text-[11px] text-text-muted space-y-1 pt-1">
                  <li>Thử nghiệm toàn bộ đồ thị DAG, Storyboard Studio, Master Timeline.</li>
                  <li>Không tốn quota Google, không lo hết hạn session.</li>
                  <li>Chuyển video sang Sub Mode mượt mà.</li>
                </ul>
              </div>
            </div>
          )}
        </div>

        {/* Footer Actions */}
        <div className="flex items-center justify-between pt-3 border-t border-border shrink-0">
          <div className="text-[11px] text-text-muted">
            Chế độ đang chọn:{' '}
            <span className="font-bold text-white uppercase">
              {activeTab === 'free_session'
                ? 'Sảnh Miễn Phí (Veo Credits)'
                : activeTab === 'api_key'
                ? 'API Key Google'
                : 'Mô Phỏng Offline'}
            </span>
          </div>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={onClose}
              className="px-3.5 py-2 rounded-md text-xs font-semibold text-text-muted hover:text-white hover:bg-surface-2 transition-colors"
            >
              Đóng
            </button>

            <button
              type="button"
              onClick={handleApplyModeAndSave}
              disabled={isSaving}
              className="flex items-center gap-1.5 px-4 py-2 rounded-md bg-accent hover:from-amber-400 hover:to-indigo-500 text-xs font-bold text-white transition-all disabled:opacity-50 cursor-pointer"
            >
              {isSaving ? (
                <>
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  <span>Đang lưu...</span>
                </>
              ) : (
                <span>Áp dụng & Lưu Cài Đặt</span>
              )}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
