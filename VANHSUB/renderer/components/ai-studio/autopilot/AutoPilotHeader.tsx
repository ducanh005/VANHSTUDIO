import React, { useState, useEffect, useRef } from 'react';
import {
  Sparkles,
  Play,
  RotateCcw,
  CheckCircle2,
  Clock,
  AlertCircle,
  FileText,
  Mic,
  Film,
  Video,
  Share2,
  FolderOpen,
  Volume2,
  Lightbulb,
  ShieldCheck,
  ArrowRight,
  Target,
  Zap,
  Settings,
  Lock,
  Plus,
  Trash2,
  Upload,
  Copy,
  Image as ImageIcon,
  User,
  XCircle,
  AlertTriangle,
  Square,
  PauseCircle,
  Palette,
  Eye,
  EyeOff,
  ExternalLink,
  HardDrive,
  Maximize2,
  X,
  ChevronDown,
  Check,
  Folder,
  Sliders,
  Cpu,
} from 'lucide-react';
import type { PipelineSessionState } from '../../../types/aiStudio';

export interface AutoPilotHeaderProps {
  projectName: string;
  savedProjects?: Array<{ id: string; name: string }>;
  activeProjectId?: string | null;
  onSwitchProject?: () => void;
  onSelectProject?: (projectId: string) => Promise<void> | void;
  activeTab: 'video' | 'facebook';
  onTabChange: (tab: 'video' | 'facebook') => void;
  aiProviderName: string;
  isFlowWindowOpen: boolean;
  onToggleFlowLive: () => void;
  onOpenChannelConfig: () => void;
  onOpenAdvancedDrawer: () => void;
  session: PipelineSessionState | null;
  ideasCount: number;
  isRunning: boolean;
  isGatedMode: boolean;
  onToggleGatedMode: (enabled: boolean) => void;
  onCancelRun: () => void;
  onResumeRun: () => void;
}

export const AutoPilotHeader: React.FC<AutoPilotHeaderProps> = ({
  projectName,
  savedProjects = [],
  activeProjectId,
  onSwitchProject,
  onSelectProject,
  activeTab,
  onTabChange,
  aiProviderName,
  isFlowWindowOpen,
  onToggleFlowLive,
  onOpenChannelConfig,
  onOpenAdvancedDrawer,
  session,
  ideasCount,
  isRunning,
  isGatedMode,
  onToggleGatedMode,
  onCancelRun,
  onResumeRun,
}) => {
  const sessionLabel: Record<PipelineSessionState['status'], string> = {
    running: 'Đang xử lý', awaiting_approval: 'Chờ duyệt', paused: 'Tạm dừng',
    failed: 'Đã thất bại', error: 'Đã thất bại', cancelled: 'Đã hủy',
    completed: 'Đã hoàn tất', idle: 'Sẵn sàng',
  };
  const [isHeaderDropdownOpen, setIsHeaderDropdownOpen] = useState(false);
  const headerDropdownRef = useRef<HTMLDivElement | null>(null);

  // Đóng Header Dropdown khi click ra ngoài
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (headerDropdownRef.current && !headerDropdownRef.current.contains(e.target as Node)) {
        setIsHeaderDropdownOpen(false);
      }
    };
    if (isHeaderDropdownOpen) {
      document.addEventListener('mousedown', handleClickOutside);
    }
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [isHeaderDropdownOpen]);

  return (
    <>
      {/* ==================================================================== */}
      {/* TOP HEADER BAR (Revo Studio Style)                                    */}
      {/* ==================================================================== */}
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border bg-[#090E18] px-5 py-2.5 shrink-0">
        <div className="flex items-center gap-3">
          {/* Tên Project / Kênh với icon lấp lánh và dropdown chuyển đổi nhanh */}
          <div className="relative flex items-center rounded-lg border border-border bg-[#0F1626]" ref={headerDropdownRef}>
            <button
              type="button"
              onClick={() => setIsHeaderDropdownOpen((prev) => !prev)}
              className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-bold text-white hover:bg-surface-2 transition cursor-pointer"
              title="Bấm để chuyển nhanh dự án hoặc tạo dự án mới"
            >
              <Sparkles className="h-3.5 w-3.5 text-amber-400" />
              <span className="truncate max-w-[160px]">{projectName}</span>
              <ChevronDown
                className={`h-3 w-3 text-text-muted transition-transform duration-200 ${
                  isHeaderDropdownOpen ? 'rotate-180' : ''
                }`}
              />
            </button>

            {onSwitchProject && (
              <button
                type="button"
                onClick={onSwitchProject}
                className="border-l border-border px-2 py-1.5 text-[11px] font-semibold text-accent hover:bg-surface-2 hover:text-white transition cursor-pointer"
                title="Quay lại màn hình thiết lập / quản lý project"
              >
                Đổi
              </button>
            )}

            {/* Dropdown Menu */}
            {isHeaderDropdownOpen && (
              <div className="absolute top-full left-0 mt-1.5 w-64 rounded-lg border border-border bg-[#0E1526] p-2 space-y-1 z-50 animate-in fade-in zoom-in-95 duration-150 shadow-xl">
                <div className="px-2.5 py-1 text-[10px] font-bold uppercase tracking-wider text-text-muted">
                  Dự án đã lưu ({savedProjects.length})
                </div>

                <div className="max-h-52 overflow-y-auto custom-scrollbar space-y-0.5">
                  {savedProjects.map((p) => {
                    const isActive = activeProjectId === p.id || projectName === p.name;
                    return (
                      <button
                        key={p.id}
                        type="button"
                        onClick={async () => {
                          setIsHeaderDropdownOpen(false);
                          if (!isActive && onSelectProject) {
                            await onSelectProject(p.id);
                          }
                        }}
                        className={`w-full flex items-center justify-between rounded-md px-2.5 py-2 text-xs text-left transition cursor-pointer ${
                          isActive
                            ? 'bg-accent/15 text-accent font-bold border border-accent/40'
                            : 'text-text hover:bg-surface-2 hover:text-white'
                        }`}
                      >
                        <div className="flex items-center gap-2 min-w-0">
                          <Folder className="h-3.5 w-3.5 text-amber-400 shrink-0" />
                          <span className="truncate">{p.name}</span>
                        </div>
                        {isActive && <Check className="h-3.5 w-3.5 text-accent shrink-0" />}
                      </button>
                    );
                  })}
                </div>

                <div className="border-t border-border pt-1 mt-1 space-y-0.5">
                  {onSwitchProject && (
                    <button
                      type="button"
                      onClick={() => {
                        setIsHeaderDropdownOpen(false);
                        onSwitchProject();
                      }}
                      className="w-full flex items-center gap-2 rounded-md px-2.5 py-2 text-xs text-text hover:bg-surface-2 hover:text-white transition cursor-pointer"
                    >
                      <Plus className="h-3.5 w-3.5 text-emerald-400 shrink-0" />
                      <span>Tạo dự án mới...</span>
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={() => {
                      setIsHeaderDropdownOpen(false);
                      onOpenChannelConfig();
                    }}
                    className="w-full flex items-center gap-2 rounded-md px-2.5 py-2 text-xs text-text-muted hover:bg-surface-2 hover:text-text transition cursor-pointer"
                  >
                    <Settings className="h-3.5 w-3.5 text-text-muted shrink-0" />
                    <span>Cấu hình kênh &amp; Master Prompt</span>
                  </button>
                </div>
              </div>
            )}
          </div>

          {/* AI STUDIO Badge */}
          <span className="rounded-md bg-[#131C2E] px-2 py-1 text-[11px] font-bold text-text border border-border">
            AI STUDIO
          </span>

          {/* Pill Toggle Switch: 🎥 Video vs 📄 Bài viết FB */}
          <div className="flex items-center rounded-lg bg-[#0F1626] p-0.5 border border-border">
            <button
              type="button"
              onClick={() => onTabChange('video')}
              className={`flex items-center gap-1 rounded-md px-3 py-1 text-xs font-bold transition cursor-pointer ${
                activeTab === 'video'
                  ? 'bg-[#FA5252] text-white'
                  : 'text-text-muted hover:text-text'
              }`}
            >
              <span>🎥 Video</span>
            </button>
            <button
              type="button"
              onClick={() => onTabChange('facebook')}
              className={`flex items-center gap-1 rounded-md px-3 py-1 text-xs font-semibold transition cursor-pointer ${
                activeTab === 'facebook'
                  ? 'bg-[#FA5252] text-white'
                  : 'text-text-muted hover:text-text'
              }`}
            >
              <span>📄 Bài viết FB</span>
            </button>
          </div>

          {/* AI Model Badge */}
          <span className="rounded-md bg-[#121E36] px-2.5 py-0.5 text-[11px] font-mono font-bold text-blue-400 border border-blue-500/20">
            Chưa đánh giá · {aiProviderName}
          </span>
        </div>

        {/* Right Actions */}
        <div className="flex items-center gap-2">
          {/* Nút Mở Sảnh Google Flow */}
          <button
            type="button"
            onClick={onToggleFlowLive}
            className={`flex items-center gap-1.5 rounded-lg border px-3 py-1 text-xs font-semibold transition cursor-pointer ${
              isFlowWindowOpen
                ? 'border-amber-500/50 bg-amber-500/20 text-amber-300 hover:bg-amber-500/30'
                : 'border-border bg-[#0F1626] text-emerald-400 hover:border-emerald-500/40 hover:bg-emerald-950/20'
            }`}
            title="Mở hoặc ẩn cửa sổ Sảnh Google Flow trên màn hình để đăng nhập và quan sát AI trực tiếp"
          >
            <span
              className={`h-2 w-2 rounded-full ${
                isFlowWindowOpen ? 'bg-amber-400' : 'bg-emerald-400 animate-pulse'
              }`}
            />
            <span>{isFlowWindowOpen ? 'Ẩn Sảnh Flow' : '🌐 Mở Sảnh Google Flow'}</span>
          </button>

          {/* Nút Mở Advanced Infrastructure Drawer */}
          <button
            type="button"
            onClick={onOpenAdvancedDrawer}
            className="flex items-center gap-1.5 rounded-lg border border-border bg-[#0F1626] hover:border-cyan-500/40 hover:bg-[#152037] px-2.5 py-1 text-xs font-semibold text-accent transition cursor-pointer"
            title="Mở khay Hạ tầng kỹ thuật nâng cao: Chrome Bridge WebSocket, Sảnh Offscreen, Mutex & Rate Limiter"
          >
            <Sliders className="h-3.5 w-3.5 text-accent" />
            <span>Hạ tầng</span>
          </button>

          {/* Telegram shortcut button */}
          <button
            type="button"
            className="flex items-center gap-1.5 rounded-lg border border-border bg-[#0F1626] px-2.5 py-1 text-xs font-medium text-text hover:text-white hover:border-border transition cursor-pointer"
          >
            <span>Telegram 💬</span>
          </button>

          {/* Thống kê button */}
          <button
            type="button"
            className="flex items-center gap-1.5 rounded-lg border border-border bg-[#0F1626] px-2.5 py-1 text-xs font-medium text-text hover:text-white hover:border-border transition cursor-pointer"
          >
            <span>📊 Thống kê</span>
          </button>

          {/* Cấu hình kênh button */}
          <button
            type="button"
            onClick={onOpenChannelConfig}
            className="flex items-center gap-1.5 rounded-lg border border-border bg-[#0F1626] px-3 py-1 text-xs font-semibold text-text hover:text-white hover:border-border transition cursor-pointer"
          >
            <Settings className="h-3.5 w-3.5 text-accent" />
            <span>⚙ Cấu hình</span>
          </button>
        </div>
      </div>

      {/* Subtitle / Status Line */}
      <div className="border-b border-border bg-[#080C14] px-5 py-1.5 text-xs text-text-muted flex items-center justify-between shrink-0">
        <div className="flex items-center gap-2 truncate">
          <p className="truncate">
            Dây chuyền:{' '}
            {session ? (
              <span className="text-amber-400 font-medium">{sessionLabel[session.status] || 'Chưa xác định'}: {session.topic}</span>
            ) : (
              'chưa có tập'
            )}{' '}
            ·{' '}
            {ideasCount > 0 ? (
              <span className="text-text font-medium">{ideasCount} ý tưởng chờ</span>
            ) : (
              'chưa có ý tưởng chờ'
            )}{' '}
            — bấm <strong className="text-white font-semibold">Sinh ý tưởng</strong>
          </p>

          {session && (
            <div className="flex items-center gap-1.5 shrink-0 ml-1">
              {isRunning ? (
                <button
                  type="button"
                  onClick={onCancelRun}
                  className="inline-flex items-center gap-1 rounded bg-rose-600/90 hover:bg-rose-500 px-2.5 py-0.5 text-[10px] font-bold text-white transition cursor-pointer"
                  title="Hủy / Dừng tiến trình AI đang chạy mà không xóa dữ liệu"
                >
                  <Square className="h-2.5 w-2.5 fill-current" />
                  <span>Hủy tiến trình</span>
                </button>
              ) : (
                <button
                  type="button"
                  onClick={onResumeRun}
                  disabled={session.manualMode}
                  className="inline-flex items-center gap-1 rounded bg-emerald-600/90 hover:bg-emerald-500 px-2.5 py-0.5 text-[10px] font-bold text-white transition cursor-pointer"
                  title="Xem kịch bản & Tiếp tục phiên"
                >
                  <Play className="h-2.5 w-2.5 fill-current" />
                  <span>Tiếp tục</span>
                </button>
              )}
            </div>
          )}
        </div>

        <label className="flex items-center gap-1.5 cursor-pointer text-[11px] text-text-muted hover:text-text">
          <input
            type="checkbox"
            checked={isGatedMode}
            disabled={session?.manualMode}
            onChange={(e) => onToggleGatedMode(e.target.checked)}
            className="rounded border-border bg-surface text-accent focus:ring-0 h-3.5 w-3.5 cursor-pointer"
          />
          <span>Phê duyệt từng bước (Gated)</span>
        </label>
      </div>
    </>
  );
};

export default AutoPilotHeader;
