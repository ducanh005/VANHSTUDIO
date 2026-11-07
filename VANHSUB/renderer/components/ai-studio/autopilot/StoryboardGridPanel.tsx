import React from 'react';
import {
  Film,
  HardDrive,
  FolderOpen,
  ExternalLink,
  Eye,
  EyeOff,
  Sparkles,
  RotateCcw,
  Play,
  AlertTriangle,
} from 'lucide-react';
import type { PipelineSessionState, StoryboardScene } from '../../../types/aiStudio';
import StoryboardSceneCard from './StoryboardSceneCard';

export interface StoryboardGridPanelProps {
  session: PipelineSessionState | null;
  selectedShotIds?: string[];
  onToggleSelectShot?: (shotId: string) => void;
  onSelectAllShots?: (allIds: string[]) => void;
  granularity?: 'detailed' | 'balanced' | 'fast';
  onChangeGranularity?: (g: 'detailed' | 'balanced' | 'fast') => void;
  shotMode?: 'single' | 'multi';
  mediaDir?: string;
  onSelectCustomMediaDir?: () => void;
  onOpenFolder?: (path?: string) => void;
  isFlowWindowOpen?: boolean;
  onToggleFlowLive?: () => void;
  sceneActionNotice?: string | null;
  onDismissSceneNotice?: () => void;
  regeneratingSceneId?: string | null;
  importingSceneId?: string | null;
  onRegenerateScene?: (scene: StoryboardScene, mode: 'image' | 'video' | 'both') => void;
  onImportManualMedia?: (scene: StoryboardScene, type: 'image' | 'video') => void;
  onPreviewMedia?: (media: {
    type: 'image' | 'video';
    url: string;
    shotId?: string;
    narration?: string;
    prompt?: string;
    durationMs?: number;
  }) => void;
  onRegenerateStoryboardOneToOne?: () => void;
  onResumePipelineRun?: (
    fromStage?: number | null,
    mode?: 'resume_missing' | 'regenerate_selected' | 'regenerate_all'
  ) => void;
  onToggleFillMode?: (sceneId: string, mode: 'freeze_last_frame' | 'none') => void;
  isRunning?: boolean;
}

export const StoryboardGridPanel: React.FC<StoryboardGridPanelProps> = ({
  session,
  selectedShotIds = [],
  onToggleSelectShot = () => {},
  onSelectAllShots = () => {},
  granularity = 'balanced',
  onChangeGranularity = () => {},
  shotMode = 'single',
  mediaDir,
  onSelectCustomMediaDir = () => {},
  onOpenFolder = () => {},
  isFlowWindowOpen = false,
  onToggleFlowLive = () => {},
  sceneActionNotice = null,
  onToggleFillMode,
  onDismissSceneNotice = () => {},
  regeneratingSceneId = null,
  importingSceneId = null,
  onRegenerateScene = () => {},
  onImportManualMedia = () => {},
  onPreviewMedia = () => {},
  onRegenerateStoryboardOneToOne = () => {},
  onResumePipelineRun = () => {},
  isRunning = false,
}) => {
  const scenes = session?.artifacts?.scenes || [];
  const safeSelectedShotIds = selectedShotIds || [];

  return (
    <div className="space-y-4">
      {/* Header Toolbar: Thư mục lưu trữ & Trạng thái Media & Nút xem Flow */}
      <div className="rounded-lg border border-border bg-[#0B101E] p-4 space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border pb-3">
          <div className="flex items-center gap-2">
            <Film className="h-4 w-4 text-accent" />
            <h4 className="text-xs font-bold text-white uppercase tracking-wider">
              Phân cảnh &amp; Media AI (Giai đoạn 5 &amp; 6)
            </h4>
            {scenes.length > 0 && (
              <span className="rounded-full bg-accent/20 px-2 py-0.5 text-[10px] font-bold text-accent border border-accent/40">
                {scenes.filter((s) => s.videoPath || s.imagePath || s.assetPath).length} /{' '}
                {scenes.length} đã có media
              </span>
            )}
            <span
              className={`rounded-full px-2 py-0.5 text-[10px] font-bold border ${
                shotMode === 'single'
                  ? 'bg-emerald-500/15 text-emerald-300 border-emerald-500/30'
                  : 'bg-indigo-500/15 text-indigo-300 border-indigo-500/30'
              }`}
              title={
                shotMode === 'single'
                  ? 'Mỗi câu kịch bản tương ứng đúng 1 phân cảnh media (1:1)'
                  : 'Tự động chia các câu dài thành nhiều góc quay (Multi-shot)'
              }
            >
              {shotMode === 'single'
                ? '🎯 Chuẩn 1:1 (1 Cảnh = 1 Media)'
                : '🎬 Đa góc quay (Multi-shot)'}
            </span>
          </div>

          {/* Nút xem Flow trực tiếp */}
          <button
            type="button"
            onClick={onToggleFlowLive}
            className={`rounded-md px-3 py-1.5 text-xs font-semibold transition cursor-pointer flex items-center gap-1.5 border ${
              isFlowWindowOpen
                ? 'bg-amber-500/20 text-amber-300 border-amber-500/40 hover:bg-amber-500/30'
                : 'bg-surface text-text border-border hover:text-white hover:bg-surface-2'
            }`}
            title="Bật hoặc ẩn cửa sổ Google Flow để theo dõi quá trình tự động sinh media"
          >
            {isFlowWindowOpen ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
            <span>{isFlowWindowOpen ? 'Ẩn cửa sổ Flow' : '👁️ Mở cửa sổ Flow Live'}</span>
          </button>
        </div>

        {/* Lưu trữ media trên máy */}
        <div className="flex flex-wrap items-center justify-between gap-2 text-xs bg-bg p-2.5 rounded-md border border-border">
          <div className="flex items-center gap-2 min-w-0">
            <HardDrive className="h-4 w-4 text-indigo-400 shrink-0" />
            <div className="min-w-0">
              <span className="text-[11px] text-text-muted">Nơi lưu trữ ảnh &amp; video:</span>
              <div
                className="font-mono text-[11px] text-indigo-300 truncate max-w-md"
                title={mediaDir || 'Mặc định thư mục dự án (05_media)'}
              >
                {mediaDir || 'Mặc định thư mục dự án (05_media)'}
              </div>
            </div>
          </div>

          <div className="flex items-center gap-2 shrink-0">
            <button
              type="button"
              onClick={onSelectCustomMediaDir}
              className="rounded-lg border border-border bg-surface hover:bg-surface-2 px-2.5 py-1 text-[11px] font-medium text-text hover:text-white transition cursor-pointer flex items-center gap-1"
              title="Chọn thư mục riêng trên ổ cứng để lưu toàn bộ ảnh & video xuất ra"
            >
              <FolderOpen className="h-3 w-3" />
              <span>Đổi thư mục lưu</span>
            </button>

            {mediaDir && (
              <button
                type="button"
                onClick={() => onOpenFolder(mediaDir)}
                className="rounded-lg border border-indigo-700/50 bg-indigo-950/40 hover:bg-indigo-900/60 px-2.5 py-1 text-[11px] font-medium text-indigo-300 hover:text-indigo-200 transition cursor-pointer flex items-center gap-1"
                title="Mở thư mục chứa ảnh và video trong File Explorer"
              >
                <ExternalLink className="h-3 w-3" />
                <span>Mở thư mục</span>
              </button>
            )}
          </div>
        </div>
      </div>

      {/* Banner thông báo thao tác trên phân cảnh */}
      {sceneActionNotice && (
        <div className="rounded-md border border-accent/40 bg-surface-2 p-3 text-xs text-accent flex items-center justify-between animate-in fade-in duration-200">
          <div className="flex items-center gap-2">
            <Sparkles className="h-4 w-4 text-accent shrink-0" />
            <span>{sceneActionNotice}</span>
          </div>
          <button
            type="button"
            onClick={onDismissSceneNotice}
            className="text-accent hover:text-white text-xs px-1.5 py-0.5 rounded hover:bg-cyan-900/60 transition cursor-pointer"
          >
            ✕
          </button>
        </div>
      )}

      {/* Danh sách phân cảnh và hiển thị Media */}
      {scenes.length > 0 ? (
        <div className="space-y-4">
          {/* Thẻ Dự toán Sản xuất & Pacing */}
          {(() => {
            const syn = (session?.artifacts as any)?.storyboardSynthesis;
            const totalShots = syn?.total_shots || scenes.length;
            const videoShots = syn?.video_shots || scenes.filter((s) => s.motionType === 'video').length;
            const imageShots = syn?.image_shots || (totalShots - videoShots);
            const totalDurationSec = syn?.total_duration_sec || (scenes.reduce((acc, s) => acc + (s.durationMs || 0), 0) / 1000);
            const avgDurationSec = syn?.avg_duration_per_shot_sec || (totalShots > 0 ? Math.round((totalDurationSec / totalShots) * 10) / 10 : 0);
            const isFragmented = syn?.is_too_fragmented ?? (avgDurationSec > 0 && avgDurationSec < 2.5);
            const estTimeSec = syn?.estimated_production_time_sec || (imageShots * 22 + videoShots * 65);
            const estCredits = syn?.estimated_credits || (imageShots * 1 + videoShots * 5);
            const estMin = Math.floor(estTimeSec / 60);
            const estSec = estTimeSec % 60;

            return (
              <div className="rounded-lg border border-border bg-gradient-to-b from-[#0F172A] to-[#0B101E] p-4 space-y-3">
                <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border pb-3">
                  <div className="flex items-center gap-2">
                    <Sparkles className="h-4 w-4 text-amber-400" />
                    <span className="text-xs font-bold text-white uppercase tracking-wider">
                      Dự toán Sản xuất &amp; Pacing Phân cảnh
                    </span>
                  </div>

                  {/* Bộ chuyển Granularity nhanh */}
                  <div className="flex items-center gap-1.5 bg-bg p-1 rounded-md border border-border text-[11px]">
                    <span className="text-text-muted px-1.5 font-medium">Độ chi tiết:</span>
                    {(['detailed', 'balanced', 'fast'] as const).map((g) => {
                      const labels = { detailed: '🎯 Chi tiết', balanced: '⚖️ Cân bằng', fast: '⚡ Nhanh' };
                      const isSel = granularity === g;
                      return (
                        <button
                          key={g}
                          type="button"
                          onClick={() => onChangeGranularity(g)}
                          disabled={isRunning || session?.manualMode}
                          className={`px-2.5 py-1 rounded-lg font-medium transition cursor-pointer disabled:opacity-50 ${
                            isSel
                              ? 'bg-accent/20 text-accent border border-accent/40 shadow'
                              : 'text-text-muted hover:text-white hover:bg-surface'
                          }`}
                          title={
                            g === 'detailed'
                              ? '1 shot/câu, bám sát nội dung nhất'
                              : g === 'balanced'
                              ? 'Tự động gộp các đoạn mô tả tĩnh kéo dài'
                              : 'Gộp nhiều câu ngắn (~8-15s) để sinh nhanh nhất'
                          }
                        >
                          {labels[g]}
                        </button>
                      );
                    })}
                  </div>
                </div>

                {/* 4 Cards Chỉ số Dự toán */}
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5">
                  <div className="rounded-md border border-border bg-bg p-2.5">
                    <span className="text-[10px] uppercase tracking-wider text-text-muted font-semibold block">Tổng phân cảnh</span>
                    <div className="text-sm font-bold text-white mt-0.5">
                      {totalShots} <span className="text-[11px] font-normal text-text-muted">({imageShots} ảnh / {videoShots} clip)</span>
                    </div>
                  </div>

                  <div className="rounded-md border border-border bg-bg p-2.5">
                    <span className="text-[10px] uppercase tracking-wider text-text-muted font-semibold block">Pacing Trung bình</span>
                    <div className="flex items-center gap-1.5 mt-0.5">
                      <span className={`text-sm font-bold ${isFragmented ? 'text-amber-400' : 'text-emerald-400'}`}>
                        {avgDurationSec}s
                      </span>
                      <span className={`text-[10px] px-1.5 py-0.2 rounded font-semibold border ${
                        isFragmented
                          ? 'bg-amber-500/20 text-amber-300 border-amber-500/30'
                          : 'bg-emerald-500/20 text-emerald-300 border-emerald-500/30'
                      }`}>
                        {isFragmented ? '⚠️ Quá vụn' : 'Lý tưởng'}
                      </span>
                    </div>
                  </div>

                  <div className="rounded-md border border-border bg-bg p-2.5">
                    <span className="text-[10px] uppercase tracking-wider text-text-muted font-semibold block">Ước tính thời gian</span>
                    <div className="text-sm font-bold text-indigo-300 mt-0.5">
                      ~{estMin > 0 ? `${estMin}p ` : ''}{estSec}s
                    </div>
                  </div>

                  <div className="rounded-md border border-border bg-bg p-2.5">
                    <span className="text-[10px] uppercase tracking-wider text-text-muted font-semibold block">Ước tính credit</span>
                    <div className="text-sm font-bold text-amber-300 mt-0.5">
                      ~{estCredits} <span className="text-[11px] font-normal text-text-muted">credits</span>
                    </div>
                  </div>
                </div>

                {/* Ghi chú ước tính sơ bộ */}
                <div className="text-[10px] text-text-muted italic pt-1 border-t border-border flex items-center justify-between">
                  <span>* Ước tính sơ bộ dựa trên định mức trung bình của Flow (~22s/ảnh, ~65s/video; 1 cr/ảnh, 5 cr/video).</span>
                </div>

                {/* Cảnh báo nếu phân cảnh quá vụn */}
                {isFragmented && (
                  <div className="rounded-md border border-amber-500/30 bg-amber-950/40 p-2.5 text-xs text-amber-200 flex items-center justify-between gap-2">
                    <div className="flex items-center gap-2">
                      <AlertTriangle className="h-4 w-4 text-amber-400 shrink-0" />
                      <span>
                        {syn?.warning || `Phân cảnh đang quá vụn (trung bình ${avgDurationSec}s/shot < 2.5s). Nên chuyển sang mức "Cân bằng" hoặc "Nhanh" để gộp các câu thoại liền kề.`}
                      </span>
                    </div>
                    <button
                      type="button"
                      onClick={() => onChangeGranularity('balanced')}
                      disabled={isRunning || session?.manualMode}
                      className="shrink-0 px-2 py-0.5 rounded bg-amber-500/20 hover:bg-amber-500/30 text-amber-300 border border-amber-500/40 font-semibold text-[11px] transition cursor-pointer disabled:opacity-50"
                    >
                      Tự động gộp (Cân bằng)
                    </button>
                  </div>
                )}
              </div>
            );
          })()}

          {/* Batch Control Toolbar for Scenes */}
          <div className="flex flex-wrap items-center justify-between gap-2.5 p-3 rounded-md border border-border bg-surface text-xs">
            <div className="flex items-center gap-2">
              <label className="flex items-center gap-1.5 cursor-pointer text-text hover:text-white font-medium select-none">
                <input
                  type="checkbox"
                  checked={
                    safeSelectedShotIds.length === scenes.length &&
                    scenes.length > 0
                  }
                  onChange={() =>
                    onSelectAllShots(
                      scenes.map((s) => s.shotId || s.id)
                    )
                  }
                  className="h-3.5 w-3.5 rounded border-border bg-surface text-cyan-500 focus:ring-cyan-500/30 cursor-pointer"
                />
                <span>
                  Chọn tất cả ({safeSelectedShotIds.length}/{scenes.length})
                </span>
              </label>
            </div>

            <div className="flex items-center gap-2 flex-wrap">
              {safeSelectedShotIds.length > 0 && (
                <button
                  type="button"
                  onClick={() => onResumePipelineRun(null, 'regenerate_selected')}
                  disabled={isRunning || session?.manualMode}
                  className="flex items-center gap-1 rounded-lg border border-amber-600/60 bg-amber-950/60 hover:bg-amber-900/80 px-2.5 py-1 text-[11px] font-semibold text-amber-300 hover:text-white transition cursor-pointer disabled:opacity-50"
                  title={`Chạy lại tạo mới phiên bản cho ${safeSelectedShotIds.length} shot đã chọn`}
                >
                  <RotateCcw className="h-3 w-3" />
                  <span>Chạy lại đã chọn ({safeSelectedShotIds.length})</span>
                </button>
              )}

              <button
                type="button"
                onClick={onRegenerateStoryboardOneToOne}
                disabled={isRunning || session?.manualMode}
                className="flex items-center gap-1 rounded-lg border border-cyan-700/60 bg-surface-2 hover:bg-cyan-900/80 px-2.5 py-1 text-[11px] font-medium text-accent hover:text-white transition cursor-pointer disabled:opacity-50"
                title="Tái tạo lại Storyboard theo chuẩn 1 câu thoại = 1 phân cảnh (1:1), loại bỏ các phân cảnh con bị lặp lại"
              >
                <RotateCcw className="h-3 w-3" />
                <span>Tái tạo Storyboard (1:1)</span>
              </button>

              <button
                type="button"
                onClick={() => onResumePipelineRun(null, 'regenerate_all')}
                disabled={isRunning || session?.manualMode}
                className="flex items-center gap-1 rounded-lg border border-border bg-surface-2 hover:bg-surface-3 px-2.5 py-1 text-[11px] font-medium text-text hover:text-white transition cursor-pointer disabled:opacity-50"
                title="Tạo phiên bản mới cho toàn bộ storyboard qua Flow (bảo toàn file cũ)"
              >
                <RotateCcw className="h-3 w-3" />
                <span>Chạy lại toàn bộ</span>
              </button>

              <button
                type="button"
                onClick={() => onResumePipelineRun(null, 'resume_missing')}
                disabled={isRunning || session?.manualMode}
                className="flex items-center gap-1.5 rounded-lg bg-emerald-600/80 hover:bg-emerald-500 px-3 py-1 text-[11px] font-bold text-white shadow transition cursor-pointer disabled:opacity-50"
                title="Chỉ tạo các phân cảnh chưa có file trên đĩa"
              >
                <Play className="h-3 w-3 fill-current" />
                <span>Tiếp tục (chỉ phần thiếu)</span>
              </button>
            </div>
          </div>

          {/* Cards for each scene */}
          {scenes.map((scene, sIdx) => {
            const targetSceneId = scene.shotId || scene.id;
            return (
              <StoryboardSceneCard
                key={scene.id || sIdx}
                scene={scene}
                sceneIndex={sIdx}
                allScenes={scenes}
                isSelected={safeSelectedShotIds.includes(targetSceneId)}
                onToggleSelect={() => onToggleSelectShot(targetSceneId)}
                isRegenerating={regeneratingSceneId === targetSceneId}
                isImporting={importingSceneId === targetSceneId}
                isSessionBusy={isRunning || Boolean(regeneratingSceneId || importingSceneId)}
                onRegenerate={(mode) => onRegenerateScene(scene, mode)}
                onImportMedia={(type) => onImportManualMedia(scene, type)}
                onPreview={onPreviewMedia}
                onOpenFolder={onOpenFolder}
                onToggleFillMode={
                  onToggleFillMode
                    ? (mode) => onToggleFillMode(targetSceneId, mode)
                    : undefined
                }
              />
            );
          })}
        </div>
      ) : (
        <div className="text-center text-xs text-text-muted py-12 space-y-2 border border-dashed border-border rounded-lg bg-bg">
          <Film className="h-8 w-8 mx-auto text-text-faint stroke-[1.5]" />
          <p>Chưa có phân cảnh visual. Visual sẽ được sinh sau khi duyệt kịch bản và lồng tiếng (Bước 5 &amp; 6).</p>
        </div>
      )}
    </div>
  );
};

export default StoryboardGridPanel;
