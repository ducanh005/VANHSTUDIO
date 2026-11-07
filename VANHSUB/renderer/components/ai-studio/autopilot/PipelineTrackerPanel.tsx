import React from 'react';
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
  ShieldCheck,
  ArrowRight,
  PauseCircle,
  Square,
  Eye,
  EyeOff,
} from 'lucide-react';
import type { PipelineSessionState } from '../../../types/aiStudio';
import ActionableErrorBanner from '../ActionableErrorBanner';
import { stageApprovalIssue } from '../../../../shared/studioStageReadiness';

export const STAGES = [
  { id: 1, name: 'Dữ kiện', icon: FileText },
  { id: 2, name: 'Kịch bản', icon: Sparkles },
  { id: 3, name: 'Lồng tiếng', icon: Mic },
  { id: 4, name: 'Trích xuất Time', icon: Clock },
  { id: 5, name: 'Storyboard', icon: Film },
  { id: 6, name: 'Ảnh / Video', icon: Film },
  { id: 7, name: 'Dựng phim', icon: Video },
  { id: 8, name: 'SEO & Xuất bản', icon: Share2 },
];

export const toMediaUrl = (filePath?: string | null): string => {
  if (!filePath) return '';
  if (
    filePath.startsWith('http://') ||
    filePath.startsWith('https://') ||
    filePath.startsWith('data:') ||
    filePath.startsWith('blob:') ||
    filePath.startsWith('vanhmedia://')
  ) {
    return filePath;
  }
  let cleanPath = filePath;
  if (cleanPath.startsWith('file:///')) {
    cleanPath = cleanPath.replace(/^file:\/\/\//, '');
  } else if (cleanPath.startsWith('file://')) {
    cleanPath = cleanPath.replace(/^file:\/\//, '');
  }
  cleanPath = cleanPath.replace(/\\/g, '/');
  return `vanhmedia://local/${encodeURIComponent(cleanPath)}`;
};

export interface PipelineTrackerPanelProps {
  session: PipelineSessionState | null;
  isRunning: boolean;
  isApproving: boolean;
  selectedShotIds?: string[];
  onApproveStage: () => void;
  onRetryStage: () => void;
  onCancelRun: () => void;
  onResumeRun: (
    fromStage?: number | null,
    mode?: 'resume_missing' | 'regenerate_selected' | 'regenerate_all'
  ) => void;
  onToggleFlowLive: () => void;
  isFlowWindowOpen: boolean;
  errorMessage: string | null;
  errorCode: string | null;
  countdownSeconds: number | null;
  onDismissError: () => void;
  onOpenChromeBridge: () => void;
  onOpenDiagnostics: () => void;
  onApplyFreezeLastFrame?: () => void;
  onOpenFolder: (path?: string) => void;
}

export const PipelineTrackerPanel: React.FC<PipelineTrackerPanelProps> = ({
  session,
  isRunning,
  isApproving,
  selectedShotIds = [],
  onApproveStage,
  onRetryStage,
  onCancelRun,
  onResumeRun,
  onToggleFlowLive,
  isFlowWindowOpen,
  errorMessage,
  errorCode,
  countdownSeconds,
  onDismissError,
  onOpenChromeBridge,
  onOpenDiagnostics,
  onApplyFreezeLastFrame,
  onOpenFolder,
}) => {
  return (
    <div className="flex flex-col h-full bg-[#070A12] overflow-hidden">
      {/* Header Cột 3 */}
      <div className="p-3.5 border-b border-border flex items-center justify-between shrink-0">
        <div className="flex items-center gap-2">
          <h3 className="text-sm font-bold text-white tracking-wide">Tiến độ sản xuất</h3>
          <button
            type="button"
            onClick={onToggleFlowLive}
            className={`rounded-lg px-2 py-0.5 text-[11px] font-medium transition cursor-pointer flex items-center gap-1 border ${
              isFlowWindowOpen
                ? 'bg-amber-500/20 text-amber-300 border-amber-500/40 hover:bg-amber-500/30'
                : 'bg-surface text-text-muted border-border hover:text-white hover:bg-surface-2'
            }`}
            title="Bật/Tắt cửa sổ Google Flow để quan sát AI tạo ảnh & video trực tiếp"
          >
            {isFlowWindowOpen ? <EyeOff className="h-3 w-3" /> : <Eye className="h-3 w-3" />}
            <span>{isFlowWindowOpen ? 'Ẩn Flow' : 'Xem Flow Live'}</span>
          </button>
        </div>
        {session && (
          <div className="flex items-center gap-2">
            <span className="text-xs font-mono font-bold text-accent">
              {session.progress}%
            </span>
            {isRunning ? (
              <button
                type="button"
                onClick={onCancelRun}
                className="rounded px-2.5 py-1 text-[11px] font-bold text-rose-300 bg-rose-950/60 hover:bg-rose-900/80 border border-rose-800/60 transition cursor-pointer flex items-center gap-1"
                title="Hủy / Dừng tiến trình AI đang chạy mà không xóa dữ liệu"
              >
                <Square className="h-2.5 w-2.5 fill-current" />
                <span>Hủy tiến trình</span>
              </button>
            ) : (
              <button
                type="button"
                onClick={() => onResumeRun()}
                disabled={session.manualMode}
                className="rounded px-2.5 py-1 text-[11px] font-bold text-white bg-emerald-600 hover:bg-emerald-500 transition cursor-pointer flex items-center gap-1"
                title="Tiếp tục tiến trình từ bước này"
              >
                <Play className="h-2.5 w-2.5 fill-current" />
                <span>Tiếp tục</span>
              </button>
            )}
          </div>
        )}
      </div>

      {/* Nội dung Tiến độ sản xuất */}
      <div className="flex-1 overflow-y-auto custom-scrollbar p-4 space-y-4">
        {!session ? (
          <div className="h-full flex flex-col items-center justify-center p-6 text-center text-text-muted text-xs">
            <p>Duyệt một ý tưởng để bắt đầu sản xuất.</p>
          </div>
        ) : (
          <>
            {/* Gated Stage Approval Banner (Chờ phê duyệt) */}
            {session.status === 'awaiting_approval' && !session.manualMode && (
              <div className="rounded-lg border border-amber-500/40 bg-gradient-to-r from-amber-950/40 via-slate-900/90 to-slate-950/90 p-4 animate-in fade-in duration-300">
                <div className="flex items-start gap-3">
                  <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-md bg-amber-500/20 border border-amber-500/40 text-amber-400">
                    <ShieldCheck className="h-5 w-5" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <span className="rounded bg-amber-500/20 px-2 py-0.5 text-[10px] font-bold text-amber-300 border border-amber-500/30">
                      BƯỚC {session.currentStage}/8 HOÀN TẤT
                    </span>
                    <h4 className="text-xs font-bold text-white mt-1">
                      {STAGES.find((s) => s.id === session.currentStage)?.name}: Đang chờ duyệt
                    </h4>
                    <p className="text-[11px] text-text-muted mt-0.5">
                      Kiểm tra dữ liệu bên dưới và bấm duyệt để sang bước tiếp theo.
                    </p>
                  </div>
                </div>

                <div className="mt-3 flex items-center justify-end gap-2">
                  <button
                    type="button"
                    onClick={onCancelRun}
                    disabled={isApproving}
                    className="flex items-center gap-1 rounded-lg border border-rose-900/50 bg-rose-950/30 hover:bg-rose-900/50 px-3 py-1.5 text-xs font-semibold text-rose-300 hover:text-rose-200 transition cursor-pointer"
                    title="Tạm dừng tiến trình"
                  >
                    <Square className="h-3 w-3 fill-current" />
                    <span>Tạm dừng</span>
                  </button>

                  <button
                    type="button"
                    onClick={onRetryStage}
                    disabled={isApproving}
                    className="flex items-center gap-1 rounded-lg border border-border bg-surface px-3 py-1.5 text-xs font-semibold text-text hover:text-white transition cursor-pointer"
                  >
                    <RotateCcw className="h-3 w-3" />
                    <span>Chạy lại</span>
                  </button>

                  <button
                    type="button"
                    onClick={onApproveStage}
                    disabled={isApproving || Boolean(stageApprovalIssue(session))}
                    className="flex items-center gap-1.5 rounded-lg bg-gradient-to-r from-emerald-500 to-teal-500 hover:from-emerald-400 hover:to-teal-400 px-4 py-1.5 text-xs font-bold text-white transition active:scale-95 cursor-pointer disabled:opacity-50"
                  >
                    {isApproving ? (
                      <>
                        <RotateCcw className="h-3 w-3 animate-spin" />
                        <span>Đang duyệt...</span>
                      </>
                    ) : (
                      <>
                        <CheckCircle2 className="h-3.5 w-3.5" />
                        <span>Tiếp tục (Duyệt)</span>
                        <ArrowRight className="h-3.5 w-3.5" />
                      </>
                    )}
                  </button>
                </div>
              </div>
            )}

            {/* Banner khi tiến trình đã tạm dừng / hủy tiến trình */}
            {session.status === 'cancelled' && !isRunning && !session.manualMode && (
              <div className="rounded-lg border border-amber-500/40 bg-gradient-to-r from-amber-950/40 via-slate-900/90 to-slate-950/90 p-4 animate-in fade-in duration-300">
                <div className="flex items-start gap-3">
                  <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-md bg-amber-500/20 border border-amber-500/40 text-amber-400">
                    <PauseCircle className="h-5 w-5" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <span className="rounded bg-amber-500/20 px-2 py-0.5 text-[10px] font-bold text-amber-300 border border-amber-500/30">
                      ĐÃ TẠM DỪNG TIẾN TRÌNH
                    </span>
                    <h4 className="text-xs font-bold text-white mt-1">
                      Bước {session.currentStage}/8: {STAGES.find((s) => s.id === session.currentStage)?.name}
                    </h4>
                    <p className="text-[11px] text-text-muted mt-0.5">
                      Tiến trình đã dừng lại. Toàn bộ kịch bản và dữ liệu đã tạo được bảo lưu 100%. Bấm &quot;Tiếp tục&quot; để chạy tiếp.
                    </p>
                  </div>
                </div>

                <div className="mt-3 flex items-center justify-end gap-2 flex-wrap">
                  {session.currentStage === 6 ? (
                    <>
                      {selectedShotIds.length > 0 && (
                        <button
                          type="button"
                          onClick={() => onResumeRun(null, 'regenerate_selected')}
                          className="flex items-center gap-1 rounded-lg border border-amber-600/60 bg-amber-950/60 hover:bg-amber-900/80 px-3 py-1.5 text-xs font-semibold text-amber-300 hover:text-white transition cursor-pointer"
                          title={`Chạy lại tạo mới phiên bản cho ${selectedShotIds.length} shot đã chọn`}
                        >
                          <RotateCcw className="h-3 w-3" />
                          <span>Chạy lại đã chọn ({selectedShotIds.length})</span>
                        </button>
                      )}

                      <button
                        type="button"
                        onClick={() => onResumeRun(null, 'regenerate_all')}
                        className="flex items-center gap-1 rounded-lg border border-border bg-surface hover:bg-surface-2 px-3 py-1.5 text-xs font-semibold text-text hover:text-white transition cursor-pointer"
                        title="Tạo phiên bản mới cho toàn bộ storyboard qua Flow (bảo toàn file cũ)"
                      >
                        <RotateCcw className="h-3 w-3" />
                        <span>Chạy lại toàn bộ</span>
                      </button>

                      <button
                        type="button"
                        onClick={() => onResumeRun(null, 'resume_missing')}
                        className="flex items-center gap-1.5 rounded-lg bg-gradient-to-r from-emerald-500 to-teal-500 hover:from-emerald-400 hover:to-teal-400 px-4 py-1.5 text-xs font-bold text-white transition active:scale-95 cursor-pointer"
                        title="Chỉ tạo các phân cảnh còn thiếu, giữ nguyên phân cảnh đã có"
                      >
                        <Play className="h-3.5 w-3.5 fill-current" />
                        <span>Tiếp tục (chỉ phần thiếu) ▸</span>
                      </button>
                    </>
                  ) : (
                    <>
                      <button
                        type="button"
                        onClick={onRetryStage}
                        className="flex items-center gap-1 rounded-lg border border-border bg-surface px-3 py-1.5 text-xs font-semibold text-text hover:text-white transition cursor-pointer"
                      >
                        <RotateCcw className="h-3 w-3" />
                        <span>Chạy lại bước này</span>
                      </button>

                      <button
                        type="button"
                        onClick={() => onResumeRun()}
                        className="flex items-center gap-1.5 rounded-lg bg-gradient-to-r from-emerald-500 to-teal-500 hover:from-emerald-400 hover:to-teal-400 px-4 py-1.5 text-xs font-bold text-white transition active:scale-95 cursor-pointer"
                      >
                        <Play className="h-3.5 w-3.5 fill-current" />
                        <span>Tiếp tục chạy ▸</span>
                      </button>
                    </>
                  )}
                </div>
              </div>
            )}

            {/* Actionable Error Banner with 1-Click Fixes */}
            {(errorMessage || session.status === 'failed') && (
              <ActionableErrorBanner
                error={errorMessage || 'Tiến trình gặp lỗi kết nối hoặc xử lý dữ liệu.'}
                errorCode={errorCode}
                countdownSeconds={countdownSeconds}
                onDismiss={onDismissError}
                onRetry={onRetryStage}
                onOpenChromeBridge={onOpenChromeBridge}
                onOpenDiagnostics={onOpenDiagnostics}
                onApplyFreezeLastFrame={onApplyFreezeLastFrame}
              />
            )}

            {/* Overall Progress Bar */}
            {session.configSnapshot && (
              <p className="text-[11px] text-text-muted" title="Thông số được lưu riêng cho tập này. Đổi cấu hình chung chỉ áp dụng cho tập mới.">
                Cấu hình tập: {session.configSnapshot.flowEngine.aspectRatio} · {session.configSnapshot.rendering.resolution} · {session.configSnapshot.rendering.fps} fps
              </p>
            )}
            <div className="h-1.5 w-full rounded-full bg-surface-2 overflow-hidden">
              <div
                className="h-full bg-gradient-to-r from-orange-500 to-amber-400 rounded-full transition-all duration-500"
                style={{ width: `${session.progress || 0}%` }}
              />
            </div>

            {/* 8-Stage Progress List */}
            <div className="grid grid-cols-2 gap-2">
              {STAGES.map((st) => {
                const Icon = st.icon;
                const stagesMap = (session?.stages || {}) as Record<number, any>;
                const stageStatus = stagesMap[st.id]?.status || 'pending';
                const isCurrent = session?.currentStage === st.id;

                let statusBadge = (
                  <span className="text-[10px] text-text-muted font-medium">Chờ</span>
                );
                let borderColor = 'border-border bg-[#0B101E]';

                if (stageStatus === 'skipped') {
                  statusBadge = <span className="text-[10px] text-text-muted">Bỏ qua</span>;
                } else if (session?.manualMode && (st.id <= 5 || st.id === 8) && stageStatus === 'success') {
                  statusBadge = <span className="text-[10px] text-cyan-300">Nhập thủ công</span>;
                } else if (session?.status === 'awaiting_approval' && isCurrent && stageStatus === 'success' && !session.manualMode) {
                  statusBadge = <span className="text-[10px] text-amber-400">Chờ duyệt</span>;
                } else if (stageStatus === 'success') {
                  statusBadge = (
                    <span className="inline-flex items-center gap-1 text-[10px] font-semibold text-emerald-400">
                      <CheckCircle2 className="h-3 w-3" /> Xong
                    </span>
                  );
                  borderColor = 'border-emerald-500/30 bg-emerald-500/5';
                } else if (session?.status === 'awaiting_approval' && isCurrent) {
                  statusBadge = (
                    <span className="inline-flex items-center gap-1 text-[10px] font-semibold text-amber-400 animate-pulse">
                      <ShieldCheck className="h-3 w-3" /> Chờ duyệt
                    </span>
                  );
                  borderColor = 'border-amber-500/50 bg-amber-500/10 ring-1 ring-amber-500/40';
                } else if (stageStatus === 'running' || (isCurrent && session?.status === 'running')) {
                  statusBadge = (
                    <span className="inline-flex items-center gap-1 text-[10px] font-semibold text-orange-400 animate-pulse">
                      <RotateCcw className="h-3 w-3 animate-spin" /> Đang chạy
                    </span>
                  );
                  borderColor = 'border-orange-500/50 bg-orange-500/10 ring-1 ring-orange-500/50';
                } else if (stageStatus === 'error') {
                  statusBadge = (
                    <span className="text-[10px] font-semibold text-rose-400">Lỗi</span>
                  );
                  borderColor = 'border-rose-500/40 bg-rose-500/10';
                }

                return (
                  <div
                    key={st.id}
                    data-stage={st.id}
                    className={`flex flex-col justify-between rounded-md border p-2.5 transition-all ${borderColor}`}
                  >
                    <div className="flex items-center justify-between mb-1">
                      <span className="text-[10px] font-mono text-text-muted">#{st.id}</span>
                      <Icon className="h-3.5 w-3.5 text-text-muted" />
                    </div>
                    <div>
                      <div className="text-xs font-bold text-white">{st.name}</div>
                      <div className="mt-0.5">{statusBadge}</div>
                    </div>
                  </div>
                );
              })}
            </div>

            {/* Script & Voice Preview Box */}
            {session.artifacts?.scriptLines && session.artifacts.scriptLines.length > 0 && (
              <div className="rounded-lg border border-border bg-[#0B101E] p-4 space-y-3">
                <div className="flex items-center justify-between">
                  <h4 className="text-xs font-bold uppercase tracking-wider text-text flex items-center gap-1.5">
                    <FileText className="h-3.5 w-3.5 text-accent" />
                    Kịch bản ({session.artifacts.scriptLines.length} câu)
                  </h4>
                  {session.artifacts.audioPath && (
                    <button
                      type="button"
                      onClick={() => onOpenFolder(session.artifacts?.audioPath)}
                      className="flex items-center gap-1 text-[11px] text-accent hover:underline cursor-pointer"
                    >
                      <FolderOpen className="h-3 w-3" /> Mở Audio
                    </button>
                  )}
                </div>

                {/* Audio Player if available */}
                {session.artifacts.audioPath && (
                  <div className="rounded-md border border-border bg-bg p-2.5 flex items-center gap-2.5">
                    <Volume2 className="h-4 w-4 text-accent shrink-0" />
                    <audio
                      controls
                      src={toMediaUrl(session.artifacts.audioPath)}
                      className="w-full h-7"
                    />
                  </div>
                )}

                <div className="max-h-48 space-y-1.5 overflow-y-auto pr-1 text-xs custom-scrollbar">
                  {session.artifacts.scriptLines.map((line, idx) => (
                    <div
                      key={line.id || idx}
                      className="rounded-lg border border-border bg-bg p-2 flex items-start gap-2"
                    >
                      <span className="font-mono text-[9px] text-accent bg-accent-tint px-1 py-0.5 rounded">
                        #{idx + 1}
                      </span>
                      <div className="flex-1">
                        <p className="text-text leading-relaxed text-[11px]">{line.text}</p>
                        {line.visualPromptEn && (
                          <p className="text-[10px] font-mono text-text-muted mt-0.5 line-clamp-1">
                            🎨 {line.visualPromptEn}
                          </p>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Video Preview Box */}
            <div className="rounded-lg border border-border bg-[#0B101E] p-4 space-y-3">
              <h4 className="text-xs font-bold uppercase tracking-wider text-text flex items-center gap-1.5">
                <Video className="h-3.5 w-3.5 text-accent" />
                Video Hoàn Chỉnh
              </h4>

              {session.artifacts?.videoPath ? (
                <div className="space-y-2.5">
                  <div
                    className={`w-full rounded-md overflow-hidden border border-border bg-black ${
                      session.artifacts?.blueprint?.aspectRatio === '9:16'
                        ? 'aspect-[9/16] max-h-[380px] mx-auto'
                        : 'aspect-video'
                    }`}
                  >
                    <video
                      controls
                      autoPlay
                      src={toMediaUrl(session.artifacts.videoPath)}
                      className="w-full h-full object-contain"
                    />
                  </div>
                  <button
                    type="button"
                    onClick={() => onOpenFolder(session.artifacts?.videoPath)}
                    className="w-full bg-accent text-white hover:bg-accent-hover flex items-center justify-center gap-1.5 rounded-md py-2 text-xs font-semibold shadow cursor-pointer"
                  >
                    <FolderOpen className="h-3.5 w-3.5" /> Mở File Video
                  </button>
                </div>
              ) : (
                <div className="aspect-video w-full rounded-md border border-dashed border-border bg-bg flex flex-col items-center justify-center text-text-muted p-4 text-center">
                  <Film className="h-6 w-6 mb-1 text-text-faint animate-pulse" />
                  <p className="text-[11px]">
                    Video hoàn chỉnh sẽ hiển thị tại đây sau khi hoàn tất công đoạn Dựng phim.
                  </p>
                </div>
              )}
            </div>

            {/* SEO Metadata Box */}
            {session.artifacts?.metadata && (
              <div className="rounded-lg border border-border bg-[#0B101E] p-4 space-y-2.5 text-xs">
                <h4 className="font-bold uppercase tracking-wider text-text flex items-center gap-1.5 text-xs">
                  <Share2 className="h-3.5 w-3.5 text-accent" />
                  Gói SEO &amp; Viral
                </h4>
                <div>
                  <span className="text-text-muted font-medium">Tiêu đề:</span>
                  <p className="font-bold text-white mt-0.5">{session.artifacts.metadata.title}</p>
                </div>
                <div>
                  <span className="text-text-muted font-medium">Hashtags:</span>
                  <p className="font-mono text-accent mt-0.5">
                    {session.artifacts.metadata.hashtags.join(' ')}
                  </p>
                </div>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
};

export default PipelineTrackerPanel;
