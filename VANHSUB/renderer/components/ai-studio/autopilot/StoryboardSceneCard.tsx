import React from 'react';
import {
  RotateCcw,
  Film,
  Video,
  Image as ImageIcon,
  CheckCircle2,
  Clock,
  Copy,
  FolderOpen,
  Maximize2,
  Sparkles,
  Camera,
  Compass,
} from 'lucide-react';
import type { StoryboardScene } from '../../../types/aiStudio';
import { toMediaUrl } from './PipelineTrackerPanel';

export interface StoryboardSceneCardProps {
  scene?: StoryboardScene;
  sceneIndex?: number;
  allScenes?: StoryboardScene[];
  isSelected?: boolean;
  onToggleSelect?: () => void;
  isRegenerating?: boolean;
  isImporting?: boolean;
  isSessionBusy?: boolean;
  onRegenerate?: (mode: 'image' | 'video' | 'both') => void;
  onImportMedia?: (type: 'image' | 'video') => void;
  onPreview?: (media: {
    type: 'image' | 'video';
    url: string;
    shotId?: string;
    narration?: string;
    prompt?: string;
    durationMs?: number;
  }) => void;
  onOpenFolder?: (path?: string) => void;
  onToggleFillMode?: (mode: 'freeze_last_frame' | 'none') => void;
}

export const StoryboardSceneCard: React.FC<StoryboardSceneCardProps> = ({
  scene,
  sceneIndex = 0,
  allScenes = [],
  isSelected = false,
  onToggleSelect = () => {},
  isRegenerating = false,
  isImporting = false,
  isSessionBusy = false,
  onRegenerate = () => {},
  onImportMedia = () => {},
  onPreview = () => {},
  onOpenFolder = () => {},
  onToggleFillMode,
}) => {
  if (!scene) return null;

  const targetSceneId = scene.shotId || scene.id;
  const isSceneBusy = isRegenerating || isImporting;
  const disableActions = isSceneBusy || isSessionBusy;

  const hasVideo =
    !!scene.videoPath ||
    (!!scene.assetPath && scene.assetPath.toLowerCase().endsWith('.mp4'));
  const videoUrl = scene.videoPath || (hasVideo ? scene.assetPath : undefined);
  const hasImage = !!scene.imagePath || (!!scene.assetPath && !hasVideo);
  const imageUrl = scene.imagePath || (!hasVideo ? scene.assetPath : undefined);

  // Phân cấp Phân cảnh (Scene) và Góc quay (Shot)
  const currentLineIndex = scene.lineIndex !== undefined ? scene.lineIndex : sceneIndex;
  const shotsForSameScene = allScenes.filter(
    (s) => (s.lineIndex !== undefined ? s.lineIndex : -1) === currentLineIndex
  );
  const isMultiShot = shotsForSameScene.length > 1;
  const shotIndexInScene = isMultiShot
    ? shotsForSameScene.findIndex((s) => (s.shotId || s.id) === targetSceneId) + 1
    : 1;
  const totalShotsInScene = shotsForSameScene.length;
  const sceneDisplayNum = currentLineIndex + 1;

  // Camera angle and motion tags
  const sceneAny = scene as any;
  const cameraAngle = sceneAny.cameraAngle || sceneAny.camera_angle;
  const cameraMotion = sceneAny.cameraMotion || sceneAny.camera_motion;
  const kenBurnsProfile = sceneAny.kenBurnsProfile || (scene.motionType === 'ken_burns' ? 'Dynamic 1/3 Pan/Zoom' : undefined);

  const processedDurSec = (
    typeof scene.durationMs === 'number' && scene.durationMs > 0
      ? scene.durationMs / 1000
      : typeof scene.endMs === 'number' && typeof scene.startMs === 'number' && scene.endMs > scene.startMs
      ? (scene.endMs - scene.startMs) / 1000
      : 4.0
  ).toFixed(1);
  const originalDurSec =
    typeof scene.originalMediaDurationSec === 'number' && scene.originalMediaDurationSec > 0
      ? scene.originalMediaDurationSec.toFixed(1)
      : null;

  return (
    <div className="rounded-lg border border-border bg-[#0B101E] p-4 space-y-3 text-xs">
      {/* Header phân cảnh */}
      <div className="flex items-center justify-between font-mono text-[11px] border-b border-border pb-2">
        <div className="flex items-center gap-2 flex-wrap">
          <input
            type="checkbox"
            checked={isSelected}
            onChange={onToggleSelect}
            className="h-3.5 w-3.5 rounded border-border bg-surface text-cyan-500 focus:ring-cyan-500/30 cursor-pointer"
            title={`Chọn phân cảnh ${targetSceneId} để chạy lại`}
          />
          {isMultiShot ? (
            <div className="flex items-center gap-1.5 flex-wrap">
              <span className="font-bold text-white bg-surface-2 px-2.5 py-0.5 rounded flex items-center gap-1">
                <span>Phân cảnh {sceneDisplayNum}</span>
                <span className="text-accent font-semibold">• Góc {shotIndexInScene}/{totalShotsInScene}</span>
              </span>
              <span className="rounded bg-indigo-950/80 text-indigo-300 border border-indigo-700/40 px-1.5 py-0.5 text-[9px] font-semibold">
                Đa góc quay
              </span>
              <span className="text-[10px] text-text-muted font-mono">
                [{targetSceneId}]
              </span>
            </div>
          ) : (
            <div className="flex items-center gap-1.5">
              <span className="font-bold text-white bg-surface-2 px-2.5 py-0.5 rounded">
                Phân cảnh {sceneDisplayNum}
              </span>
              <span className="text-[10px] text-text-muted font-mono">
                [{targetSceneId}]
              </span>
            </div>
          )}
          <div className="flex items-center gap-1.5 flex-wrap">
            {scene.mediaProvenance?.source === 'manual_import' && scene.mediaProvenance.assetPath === scene.assetPath && (
              <span className="rounded bg-amber-500/15 px-1.5 py-0.5 text-amber-300" title="Media nhập thủ công đã kiểm định; không phải generation tự động thành công.">Nhập thủ công</span>
            )}
            {scene.mediaProvenance?.source==='official_api'&&scene.mediaProvenance.assetPath===scene.assetPath&&<span className="rounded bg-cyan-500/15 px-1.5 py-0.5 text-cyan-300" title={`${scene.mediaProvenance.model} · ${scene.mediaProvenance.task}`}>Official API · đã kiểm định</span>}
              {scene.mediaProvenance?.source==='google_flow_ui'&&scene.mediaProvenance.assetPath===scene.assetPath&&<span className="rounded bg-emerald-500/15 px-1.5 py-0.5 text-emerald-300" title="Artifact đã kiểm định. Credit thực tế chưa đối soát; không phải bằng chứng nghiệm thu toàn pipeline.">Flow credits · media đã kiểm định</span>}
              <span className="text-text-muted">
              Xử lý: {processedDurSec}s
            </span>
            {originalDurSec && (
              <span className="text-text-muted" title={`Thời lượng tệp media gốc: ${originalDurSec}s`}>
                • Gốc: {originalDurSec}s
              </span>
            )}
            {scene.fillMode === 'freeze_last_frame' && (
              <span
                className="inline-flex items-center gap-1 rounded bg-amber-500/20 text-amber-300 border border-amber-500/30 px-1.5 py-0.5 text-[9px] font-semibold"
                title="Bù đủ thời lượng phân cảnh bằng cách giữ khung hình cuối của clip"
              >
                ❄️ Giữ khung hình cuối
              </span>
            )}
          </div>

          {/* Camera angle & motion badges */}
          {cameraAngle && (
            <span className="inline-flex items-center gap-1 rounded bg-blue-950/60 text-blue-300 border border-blue-800/40 px-2 py-0.5 text-[10px] font-semibold" title="Góc máy quay">
              <Camera className="h-2.5 w-2.5" />
              <span>{cameraAngle}</span>
            </span>
          )}
          {cameraMotion && (
            <span className="inline-flex items-center gap-1 rounded bg-purple-950/60 text-purple-300 border border-purple-800/40 px-2 py-0.5 text-[10px] font-semibold" title="Chuyển động máy quay">
              <Compass className="h-2.5 w-2.5" />
              <span>{cameraMotion}</span>
            </span>
          )}
          {kenBurnsProfile && (
            <span className="inline-flex items-center gap-1 rounded bg-amber-950/60 text-amber-300 border border-amber-800/40 px-2 py-0.5 text-[10px] font-semibold" title="Chỉ dẫn Ken Burns chuyển động ảnh">
              <Sparkles className="h-2.5 w-2.5 text-amber-400" />
              <span>{kenBurnsProfile}</span>
            </span>
          )}
        </div>

        <div className="flex items-center gap-1.5">
          {hasVideo ? (
            <span className="rounded-full bg-emerald-500/20 px-2.5 py-0.5 text-[10px] font-bold text-emerald-300 border border-emerald-500/30 flex items-center gap-1">
              <CheckCircle2 className="h-2.5 w-2.5" /> Video sẵn sàng
            </span>
          ) : hasImage ? (
            <span className="rounded-full bg-accent/20 px-2.5 py-0.5 text-[10px] font-bold text-accent border border-accent/40 flex items-center gap-1">
              <CheckCircle2 className="h-2.5 w-2.5" /> Đã có Ảnh
            </span>
          ) : (
            <span className="rounded-full bg-surface-2 px-2.5 py-0.5 text-[10px] text-text-muted border border-border flex items-center gap-1">
              <Clock className="h-2.5 w-2.5" /> Chờ tạo media
            </span>
          )}
        </div>
      </div>

      {/* Lời thoại / Narration */}
      <div>
        <span className="text-[10px] uppercase font-bold text-text-muted tracking-wider">
          {isMultiShot ? (
            <span className="flex items-center gap-1">
              <span>Lời thoại</span>
              <span className="text-accent normal-case font-medium">
                (Góc {shotIndexInScene}/{totalShotsInScene} - Cảnh {sceneDisplayNum}):
              </span>
            </span>
          ) : (
            'Lời thoại:'
          )}
        </span>
        <p className="text-white font-medium text-[13px] leading-relaxed mt-0.5">
          {scene.lineText}
        </p>
      </div>

      {/* Prompt sinh ảnh / video */}
      <div className="text-[11px] bg-bg p-2.5 rounded-md border border-border space-y-1">
        <div className="flex items-center justify-between text-text-muted text-[10px]">
          <span className="font-semibold text-text flex items-center gap-1">
            <Sparkles className="h-3 w-3 text-amber-400" /> Prompt Visual Flow:
          </span>
          <button
            type="button"
            onClick={() => navigator.clipboard.writeText(scene.visualPrompt || '')}
            className="hover:text-white transition flex items-center gap-1 text-[10px] cursor-pointer"
            title="Sao chép prompt"
          >
            <Copy className="h-2.5 w-2.5" /> Copy
          </button>
        </div>
        <p className="text-text italic font-mono text-[11px] leading-relaxed break-words">
          {scene.visualPrompt}
        </p>
      </div>

      {/* Hiển thị Media Thực Tế */}
      {hasVideo ? (
        <div className="space-y-2 pt-1">
          <div
            onClick={() =>
              onPreview({
                type: 'video',
                url: videoUrl!,
                shotId: scene.shotId || `Phân cảnh #${sceneIndex + 1}`,
                narration: scene.lineText,
                prompt: scene.visualPrompt,
                durationMs: scene.durationMs,
              })
            }
            className="group relative rounded-lg overflow-hidden border border-border bg-black aspect-video max-h-72 flex items-center justify-center cursor-pointer hover:border-accent/40 transition duration-300"
            title="Bấm để xem video phóng to toàn màn hình"
          >
            <video
              src={toMediaUrl(videoUrl)}
              controls
              preload="metadata"
              className="w-full h-full object-contain transition-transform duration-300 ease-out group-hover:scale-105"
            />
            <div className="absolute inset-0 bg-gradient-to-t from-black/75 via-transparent to-black/20 opacity-0 group-hover:opacity-100 transition-opacity duration-200 pointer-events-none flex flex-col justify-between p-3">
              <div className="flex items-center justify-end">
                <span className="rounded-lg bg-black/80 px-2.5 py-1 text-[10px] font-bold text-white border border-white/20 flex items-center gap-1">
                  <Maximize2 className="h-3 w-3 text-accent" /> Bấm để xem lớn
                </span>
              </div>
              <div className="text-[11px] text-text font-medium truncate">
                🎬 {scene.shotId || `Phân cảnh #${sceneIndex + 1}`}
              </div>
            </div>
          </div>

          <div className="flex flex-wrap items-center justify-between gap-2 text-[11px] text-text-muted px-1">
            <span className="truncate max-w-sm font-mono text-[10px]" title={videoUrl}>
              📹 {videoUrl}
            </span>
            <button
              type="button"
              onClick={() => onOpenFolder(videoUrl)}
              className="text-accent hover:underline flex items-center gap-1 shrink-0 font-medium cursor-pointer"
            >
              <FolderOpen className="h-3 w-3" /> Mở tệp video
            </button>
          </div>

          {/* Hiển thị kèm ảnh nguồn nếu có (Image-to-Video) */}
          {scene.imagePath && (
            <div className="flex items-center gap-2 p-2 bg-bg rounded-md border border-border text-[11px]">
              <div
                onClick={() =>
                  onPreview({
                    type: 'image',
                    url: scene.imagePath!,
                    shotId: `${scene.shotId || `Cảnh #${sceneIndex + 1}`} (Ảnh nguồn Image-to-Video)`,
                    narration: scene.lineText,
                    prompt: scene.visualPrompt,
                  })
                }
                className="group relative h-12 w-20 overflow-hidden rounded-lg border border-border shrink-0 cursor-pointer hover:border-cyan-400 transition"
                title="Bấm để xem ảnh nguồn phóng to"
              >
                <img
                  src={toMediaUrl(scene.imagePath)}
                  alt={`Ảnh nguồn #${sceneIndex + 1}`}
                  className="h-full w-full object-cover transition-transform duration-300 group-hover:scale-110"
                />
                <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center pointer-events-none">
                  <Maximize2 className="h-3.5 w-3.5 text-white drop-shadow" />
                </div>
              </div>
              <div className="flex-1 min-w-0">
                <span className="text-[10px] text-text-muted block font-semibold">
                  Ảnh nguồn Image-to-Video:
                </span>
                <p className="text-text truncate font-mono text-[10px]">{scene.imagePath}</p>
              </div>
              <button
                type="button"
                onClick={() => onOpenFolder(scene.imagePath)}
                className="text-accent hover:underline shrink-0 text-[11px] cursor-pointer"
              >
                Mở ảnh
              </button>
            </div>
          )}
        </div>
      ) : hasImage ? (
        <div className="space-y-2 pt-1">
          <div
            onClick={() =>
              onPreview({
                type: 'image',
                url: imageUrl!,
                shotId: scene.shotId || `Phân cảnh #${sceneIndex + 1}`,
                narration: scene.lineText,
                prompt: scene.visualPrompt,
                durationMs: scene.durationMs,
              })
            }
            className="group relative rounded-lg overflow-hidden border border-border bg-black max-h-72 flex items-center justify-center cursor-pointer hover:border-accent/40 transition duration-300"
            title="Bấm để xem ảnh phóng to chi tiết"
          >
            <img
              src={toMediaUrl(imageUrl)}
              alt={`Ảnh phân cảnh #${sceneIndex + 1}`}
              className="max-h-72 w-full object-contain rounded-lg transition-transform duration-300 ease-out group-hover:scale-105"
            />
            <div className="absolute inset-0 bg-gradient-to-t from-black/75 via-transparent to-black/20 opacity-0 group-hover:opacity-100 transition-opacity duration-200 pointer-events-none flex flex-col justify-between p-3">
              <div className="flex items-center justify-end">
                <span className="rounded-lg bg-black/80 px-2.5 py-1 text-[10px] font-bold text-white border border-white/20 flex items-center gap-1">
                  <Maximize2 className="h-3 w-3 text-accent" /> Bấm để xem lớn
                </span>
              </div>
              <div className="text-[11px] text-text font-medium truncate">
                🖼️ {scene.shotId || `Phân cảnh #${sceneIndex + 1}`}
              </div>
            </div>
          </div>

          <div className="flex flex-wrap items-center justify-between gap-2 text-[11px] text-text-muted px-1">
            <span className="truncate max-w-sm font-mono text-[10px]" title={imageUrl}>
              🖼️ {imageUrl}
            </span>
            <button
              type="button"
              onClick={() => onOpenFolder(imageUrl)}
              className="text-accent hover:underline flex items-center gap-1 shrink-0 font-medium cursor-pointer"
            >
              <FolderOpen className="h-3 w-3" /> Mở tệp ảnh
            </button>
          </div>
        </div>
      ) : (
        <div className="rounded-md border border-dashed border-border bg-bg p-3 text-center text-text-muted text-[11px] flex items-center justify-center gap-2">
          <Clock className="h-3.5 w-3.5 text-text-faint" />
          <span>{scene.manualMediaOnly ? 'Chọn ảnh hoặc video từ máy để gắn vào cảnh này.' : 'Chưa có media. Kiểm tra route của episode rồi tạo ở Bước 6 hoặc nhập từ máy.'}</span>
        </div>
      )}

      {/* Loading / Progress indicator khi đang thao tác */}
      {isSceneBusy && (
        <div className="rounded-md bg-surface-2 border border-cyan-700/50 p-2.5 flex items-center gap-2.5 text-accent text-[11px] animate-pulse">
          <RotateCcw className="h-3.5 w-3.5 animate-spin text-accent shrink-0" />
          <span>
            {isRegenerating
              ? `Đang kết nối Google Flow để tạo lại media cho ${targetSceneId}...`
              : `Đang sao chép và nạp tệp media vào thư mục dự án...`}
          </span>
        </div>
      )}

      {/* Thanh công cụ thao tác tay: Tạo lại AI & Chọn từ máy */}
      <div className="flex flex-wrap items-center justify-between gap-2 pt-2.5 border-t border-border text-[11px]">
        {/* Nhóm 1: Tạo lại qua Flow */}
        <div className="flex items-center gap-1.5 flex-wrap">
          <span className="text-text-muted font-semibold text-[10px] uppercase tracking-wider">
            Tạo lại AI:
          </span>
          <button
            type="button"
            onClick={() => onRegenerate('image')}
            disabled={disableActions || scene.manualMediaOnly}
            className="rounded-lg border border-cyan-800/60 bg-surface-2 hover:bg-cyan-900/70 px-2.5 py-1 text-[11px] font-semibold text-accent hover:text-cyan-100 transition cursor-pointer flex items-center gap-1 disabled:opacity-50"
            title="Sinh lại ảnh AI mới từ visual prompt của phân cảnh này qua Flow"
          >
            <RotateCcw className={`h-3 w-3 ${isRegenerating ? 'animate-spin' : ''}`} />
            <span>Tạo lại Ảnh</span>
          </button>

          <button
            type="button"
            onClick={() => onRegenerate('video')}
            disabled={disableActions || scene.manualMediaOnly}
            className="rounded-lg border border-emerald-800/60 bg-emerald-950/40 hover:bg-emerald-900/70 px-2.5 py-1 text-[11px] font-semibold text-emerald-300 hover:text-emerald-100 transition cursor-pointer flex items-center gap-1 disabled:opacity-50"
            title="Sinh lại video Veo từ ảnh hiện tại của phân cảnh này qua Flow"
          >
            <Film className={`h-3 w-3 ${isRegenerating ? 'animate-pulse' : ''}`} />
            <span>Tạo lại Video</span>
          </button>
        </div>

        {/* Nhóm 2: Chọn từ máy tính */}
        <div className="flex items-center gap-1.5 flex-wrap">
          <span className="text-text-muted font-semibold text-[10px] uppercase tracking-wider">
            Nạp từ máy:
          </span>
          <button
            type="button"
            onClick={() => onImportMedia('image')}
            disabled={disableActions}
            className="rounded-lg border border-border bg-surface hover:bg-surface-2 px-2.5 py-1 text-[11px] font-medium text-text hover:text-white transition cursor-pointer flex items-center gap-1 disabled:opacity-50"
            title="Chọn tệp ảnh từ máy tính (PNG, JPG, WEBP) để gán cho phân cảnh này"
          >
            <ImageIcon className="h-3 w-3 text-accent" />
            <span>Chọn ảnh</span>
          </button>

          <button
            type="button"
            onClick={() => onImportMedia('video')}
            disabled={disableActions}
            className="rounded-lg border border-border bg-surface hover:bg-surface-2 px-2.5 py-1 text-[11px] font-medium text-text hover:text-white transition cursor-pointer flex items-center gap-1 disabled:opacity-50"
            title="Chọn tệp video từ máy tính (MP4, WEBM, MOV) để gán cho phân cảnh này"
          >
            <Video className="h-3 w-3 text-emerald-400" />
            <span>Chọn video</span>
          </button>
        </div>

        {/* Nhóm 3: Tùy chọn giữ khung hình cuối */}
        {hasVideo && onToggleFillMode && (
          <div className="flex items-center gap-1.5 flex-wrap">
            <button
              type="button"
              onClick={() => onToggleFillMode(scene.fillMode === 'freeze_last_frame' ? 'none' : 'freeze_last_frame')}
              disabled={isSceneBusy}
              className={`rounded-lg border px-2.5 py-1 text-[11px] font-medium transition cursor-pointer flex items-center gap-1 disabled:opacity-50 ${
                scene.fillMode === 'freeze_last_frame'
                  ? 'border-amber-500/60 bg-amber-950/60 text-amber-300 hover:bg-amber-900/70'
                  : 'border-border bg-surface hover:bg-surface-2 text-text-muted hover:text-white'
              }`}
              title="Bật/Tắt giữ khung hình cuối để bù đủ thời lượng phân cảnh khi xuất video"
            >
              <span>{scene.fillMode === 'freeze_last_frame' ? '✓ Giữ khung cuối: BẬT' : 'Giữ khung cuối: TẮT'}</span>
            </button>
          </div>
        )}
      </div>
    </div>
  );
};

export default StoryboardSceneCard;
