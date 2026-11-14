import React, { useRef, useState, useEffect } from 'react';
import { Play, Pause, RotateCcw, Volume2, VolumeX, ShieldAlert, Layers } from 'lucide-react';
import type { SrtLine } from '../../lib/srt';
import { formatMs } from '../../lib/srt';
import type {
  SubStyle,
  SubMaskRegion,
  PerLineSubtitleStyle,
  CustomMaskRegion,
  WatermarkOptions,
  KineticConfig,
} from '../../types/electron';
import { calculateWordTimings, detectEmoji } from '../../lib/kineticEngine';

interface VideoPreviewCanvasProps {
  videoPath?: string;
  aspectRatio: 'original' | '16:9' | '9:16' | '1:1';
  customMaskEnabled: boolean;
  customMask?: CustomMaskRegion;
  customMasks?: CustomMaskRegion[];
  classicMask?: SubMaskRegion;
  classicMaskEnabled?: boolean;
  activeMaskIndex?: number;
  onSelectMask?: (index: number) => void;
  onUpdateMask?: (index: number, partial: Partial<CustomMaskRegion>) => void;
  watermarkEnabled: boolean;
  watermark: WatermarkOptions;
  globalStyle: SubStyle;
  perLineStyles: Record<number, PerLineSubtitleStyle>;
  srtLines: SrtLine[];
  currentTime: number;
  onTimeUpdate: (timeSec: number) => void;
  secondarySrtLines?: SrtLine[];
  secondaryStyle?: Partial<SubStyle>;
  dualSubtitlesEnabled?: boolean;
  onUpdateSubtitlePosition?: (pos: { alignment?: SubStyle['alignment']; marginV?: number; marginH?: number; posPercent?: { x: number; y: number } }) => void;
  /** R4 CapCut Mini: Phản chiếu gương ngang khung hình video */
  mirrorHorizontal?: boolean;
  /** R4 CapCut Mini: Tua nhanh tốc độ phát 1.00x đến 2.00x */
  speed?: number;
  /** R3 Kinetic subtitle presets */
  kineticConfig?: KineticConfig;
}

export const VideoPreviewCanvas: React.FC<VideoPreviewCanvasProps> = ({
  videoPath,
  aspectRatio,
  mirrorHorizontal = false,
  speed = 1.0,
  customMaskEnabled,
  customMask,
  customMasks,
  classicMask,
  classicMaskEnabled = false,
  activeMaskIndex = 0,
  onSelectMask,
  onUpdateMask,
  watermarkEnabled,
  watermark,
  globalStyle,
  perLineStyles,
  srtLines,
  currentTime,
  onTimeUpdate,
  secondarySrtLines,
  secondaryStyle,
  dualSubtitlesEnabled = false,
  onUpdateSubtitlePosition,
  kineticConfig,
}) => {
  const videoRef = useRef<HTMLVideoElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [duration, setDuration] = useState(0);
  const [isMuted, setIsMuted] = useState(false);
  const [videoDimensions, setVideoDimensions] = useState<{ width: number; height: number } | null>(null);

  // Kéo thả phụ đề trên canvas
  const [subDragState, setSubDragState] = useState<{
    startX: number;
    startY: number;
    initialX: number;
    initialY: number;
  } | null>(null);

  useEffect(() => {
    setVideoDimensions(null);
  }, [videoPath]);

  // Tỉ lệ khung hình thực tế của canvas preview (khớp 100% video thực tế hoặc tỉ lệ xuất)
  const targetRatio = React.useMemo(() => {
    if (aspectRatio === '9:16') return 9 / 16;
    if (aspectRatio === '1:1') return 1;
    if (aspectRatio === '16:9') return 16 / 9;
    // 'original': ưu tiên lấy tỉ lệ gốc chính xác từ file video đã tải
    if (videoDimensions && videoDimensions.width > 0 && videoDimensions.height > 0) {
      return videoDimensions.width / videoDimensions.height;
    }
    return 16 / 9;
  }, [aspectRatio, videoDimensions]);

  const maxPreviewH = aspectRatio === '9:16' ? 460 : 440;

  // Thời gian video độ phân giải cao 60-120 FPS để chuyển động Watermark lướt mượt mà như bơ
  const [smoothTime, setSmoothTime] = useState(currentTime);

  useEffect(() => {
    if (!isPlaying) {
      setSmoothTime(currentTime);
      return;
    }

    let rafId: number;
    const tick = () => {
      if (videoRef.current) {
        setSmoothTime(videoRef.current.currentTime);
      }
      rafId = requestAnimationFrame(tick);
    };
    rafId = requestAnimationFrame(tick);

    return () => {
      cancelAnimationFrame(rafId);
    };
  }, [isPlaying]);

  useEffect(() => {
    if (!isPlaying) {
      setSmoothTime(currentTime);
    }
  }, [currentTime, isPlaying]);

  // Chuẩn hoá danh sách mask
  const masksList: CustomMaskRegion[] =
    customMasks && customMasks.length > 0
      ? customMasks
      : customMask
      ? [customMask]
      : [];

  const currentActiveIdx = Math.max(0, Math.min(masksList.length - 1, activeMaskIndex));

  // Trạng thái kéo thả di chuyển hoặc co giãn vùng che
  const [dragState, setDragState] = useState<{
    maskIndex: number;
    action: 'move' | 'nw' | 'ne' | 'se' | 'sw' | 'n' | 's' | 'e' | 'w';
    startX: number;
    startY: number;
    initialX: number;
    initialY: number;
    initialW: number;
    initialH: number;
  } | null>(null);

  useEffect(() => {
    if (!dragState) return;

    const handleMouseMove = (e: MouseEvent) => {
      if (!containerRef.current) return;
      const rect = containerRef.current.getBoundingClientRect();
      if (rect.width <= 0 || rect.height <= 0) return;

      const deltaXPercent = ((e.clientX - dragState.startX) / rect.width) * 100;
      const deltaYPercent = ((e.clientY - dragState.startY) / rect.height) * 100;

      if (dragState.action === 'move') {
        const newX = Math.max(0, Math.min(100 - dragState.initialW, dragState.initialX + deltaXPercent));
        const newY = Math.max(0, Math.min(100 - dragState.initialH, dragState.initialY + deltaYPercent));
        onUpdateMask?.(dragState.maskIndex, {
          xPercent: Math.round(newX * 10) / 10,
          yPercent: Math.round(newY * 10) / 10,
        });
      } else {
        let x = dragState.initialX;
        let y = dragState.initialY;
        let w = dragState.initialW;
        let h = dragState.initialH;

        if (dragState.action.includes('e')) {
          w = Math.max(4, Math.min(100 - x, dragState.initialW + deltaXPercent));
        }
        if (dragState.action.includes('s')) {
          h = Math.max(4, Math.min(100 - y, dragState.initialH + deltaYPercent));
        }
        if (dragState.action.includes('w')) {
          const maxShift = dragState.initialX + dragState.initialW - 4;
          const newX = Math.max(0, Math.min(maxShift, dragState.initialX + deltaXPercent));
          w = dragState.initialW + (dragState.initialX - newX);
          x = newX;
        }
        if (dragState.action.includes('n')) {
          const maxShift = dragState.initialY + dragState.initialH - 4;
          const newY = Math.max(0, Math.min(maxShift, dragState.initialY + deltaYPercent));
          h = dragState.initialH + (dragState.initialY - newY);
          y = newY;
        }

        onUpdateMask?.(dragState.maskIndex, {
          xPercent: Math.round(x * 10) / 10,
          yPercent: Math.round(y * 10) / 10,
          widthPercent: Math.round(w * 10) / 10,
          heightPercent: Math.round(h * 10) / 10,
        });
      }
    };

    const handleMouseUp = () => {
      setDragState(null);
    };

    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);
    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
    };
  }, [dragState, onUpdateMask]);

  // Xử lý kéo thả phụ đề trực tiếp trên màn hình xem trước
  useEffect(() => {
    if (!subDragState) return;

    const handleMouseMove = (e: MouseEvent) => {
      if (!containerRef.current) return;
      const rect = containerRef.current.getBoundingClientRect();
      if (rect.width <= 0 || rect.height <= 0) return;

      const deltaXPercent = ((e.clientX - subDragState.startX) / rect.width) * 100;
      const deltaYPercent = ((e.clientY - subDragState.startY) / rect.height) * 100;

      const newX = Math.max(5, Math.min(95, subDragState.initialX + deltaXPercent));
      const newY = Math.max(5, Math.min(95, subDragState.initialY + deltaYPercent));

      onUpdateSubtitlePosition?.({
        posPercent: {
          x: Math.round(newX * 10) / 10,
          y: Math.round(newY * 10) / 10,
        },
      });
    };

    const handleMouseUp = () => {
      setSubDragState(null);
    };

    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);
    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
    };
  }, [subDragState, onUpdateSubtitlePosition]);

  const videoSrc = videoPath ? `vanhmedia://local/${encodeURIComponent(videoPath)}` : '';

  // Đồng bộ tốc độ phát video (playbackRate) khi speed thay đổi
  useEffect(() => {
    if (videoRef.current) {
      const validSpeed = speed && speed >= 1.0 ? speed : 1.0;
      videoRef.current.playbackRate = validSpeed;
    }
  }, [speed]);

  const togglePlay = () => {
    if (!videoRef.current) return;
    if (isPlaying) {
      videoRef.current.pause();
      setIsPlaying(false);
    } else {
      const validSpeed = speed && speed >= 1.0 ? speed : 1.0;
      videoRef.current.playbackRate = validSpeed;
      videoRef.current.play().catch(() => {});
      setIsPlaying(true);
    }
  };

  const handleSeek = (e: React.ChangeEvent<HTMLInputElement>) => {
    const targetTime = Number(e.target.value);
    if (videoRef.current) {
      videoRef.current.currentTime = targetTime;
      onTimeUpdate(targetTime);
    }
  };

  const activeTime = isPlaying ? smoothTime : currentTime;
  const currentTimeMs = Math.round(activeTime * 1000);

  // Tìm câu thoại đang hiển thị tại thời điểm hiện tại
  const activeLineIndex = srtLines.findIndex(
    (l) => currentTimeMs >= l.startMs && currentTimeMs <= l.endMs
  );
  const activeLine = activeLineIndex !== -1 ? srtLines[activeLineIndex] : null;

  // Lấy style áp dụng: style riêng từng câu hoặc style chung
  const lineOverride = activeLineIndex !== -1 ? perLineStyles[activeLineIndex] : null;

  const fontName = lineOverride?.fontName || globalStyle.fontName;
  const fontSize = lineOverride?.fontSize || globalStyle.fontSize;
  const textColor = lineOverride?.textColorHex || globalStyle.primaryColour;
  const outlineColor = lineOverride?.outlineColorHex || globalStyle.outlineColour;
  const outlineWidth = lineOverride?.outlineWidth ?? globalStyle.outline;
  const isBold = lineOverride?.bold ?? globalStyle.bold;
  const isItalic = lineOverride?.italic ?? false;
  const alignment = lineOverride?.alignment ?? globalStyle.alignment;
  const marginV = lineOverride?.marginV ?? globalStyle.marginV ?? 25;
  const marginH = lineOverride?.marginH ?? globalStyle.marginH ?? 20;
  const isVert = lineOverride?.isVertical !== undefined ? lineOverride.isVertical : !!globalStyle.isVertical;
  const posPercent = lineOverride?.posPercent || globalStyle.posPercent;

  // Track phụ đề thứ 2 (Song ngữ / Lời nhạc gốc)
  const activeSecLine =
    dualSubtitlesEnabled && secondarySrtLines && secondarySrtLines.length > 0
      ? secondarySrtLines.find((l) => currentTimeMs >= l.startMs && currentTimeMs <= l.endMs)
      : null;

  const getSubContainerStyle = (
    align: SubStyle['alignment'],
    mV: number,
    mH: number,
    pos?: { x: number; y: number },
    vertical?: boolean
  ): React.CSSProperties => {
    if (pos && Number.isFinite(pos.x) && Number.isFinite(pos.y)) {
      return {
        position: 'absolute',
        left: `${pos.x}%`,
        top: `${pos.y}%`,
        transform: 'translate(-50%, -50%)',
        maxWidth: vertical ? '20%' : '92%',
        zIndex: 25,
      };
    }

    const s: React.CSSProperties = {
      position: 'absolute',
      zIndex: 25,
      maxWidth: vertical ? '20%' : '92%',
    };

    // Chiều dọc
    if (align === 7 || align === 8 || align === 9) {
      s.top = `${(((mV) / 288) * 100).toFixed(2)}%`;
      s.bottom = 'auto';
    } else if (align === 4 || align === 5 || align === 6) {
      s.top = '50%';
      s.bottom = 'auto';
      s.transform = 'translateY(-50%)';
    } else {
      s.bottom = `${(((mV) / 288) * 100).toFixed(2)}%`;
      s.top = 'auto';
    }

    // Chiều ngang
    if (align === 1 || align === 4 || align === 7) {
      s.left = `${(((mH) / 384) * 100).toFixed(2)}%`;
      s.right = 'auto';
    } else if (align === 3 || align === 6 || align === 9) {
      s.right = `${(((mH) / 384) * 100).toFixed(2)}%`;
      s.left = 'auto';
    } else {
      s.left = '50%';
      s.right = 'auto';
      if (s.transform) {
        s.transform = 'translate(-50%, -50%)';
      } else {
        s.transform = 'translateX(-50%)';
      }
    }

    return s;
  };

  // Watermark position classes
  const getWatermarkPositionClass = (pos: WatermarkOptions['position']) => {
    switch (pos) {
      case 'top_left':
        return 'top-4 left-4';
      case 'top_right':
        return 'top-4 right-4';
      case 'bottom_left':
        return 'bottom-8 left-4';
      case 'bottom_right':
        return 'bottom-8 right-4';
      case 'center':
        return 'top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2';
      case 'floating':
      case 'bounce':
      case 'custom':
        return '';
      default:
        return 'top-4 right-4';
    }
  };

  // Tính toán vị trí watermark chuyển động thời gian thực siêu mượt (60 FPS)
  const getAnimatedWatermarkStyle = (): React.CSSProperties => {
    if (!watermarkEnabled || !watermark.content) return {};
    const speed = watermark.speed || 'medium';
    const speedMult = speed === 'slow' ? 0.6 : speed === 'fast' ? 1.5 : 1.0;
    const t = activeTime;
    const wmScale = watermark.scalePercent || 18;
    const maxLeftPct = Math.max(5, 100 - wmScale - 3);
    const maxTopPct = 86; // Tránh đè sát lề đáy / thanh điều khiển

    if (watermark.position === 'floating') {
      // 1. Sóng đôi hòa âm (Harmonic Lissajous): lướt êm ái hình vô cực, không bao giờ bị đứng khựng
      const wx = 0.42 * speedMult;
      const wx2 = wx * 1.62;
      const wy = 0.31 * speedMult;
      const wy2 = wy * 1.41;

      const normX = 0.5 + 0.38 * Math.sin(t * wx) + 0.10 * Math.sin(t * wx2);
      const normY = 0.5 + 0.38 * Math.cos(t * wy) + 0.10 * Math.cos(t * wy2);

      const leftPct = maxLeftPct * Math.max(0, Math.min(1, normX));
      const topPct = maxTopPct * Math.max(0, Math.min(1, normY));

      return {
        left: `${leftPct.toFixed(2)}%`,
        top: `${topPct.toFixed(2)}%`,
        opacity: watermark.opacity ?? 0.8,
        maxWidth: `${wmScale}%`,
        transition: 'none',
        willChange: 'left, top',
      };
    }

    if (watermark.position === 'bounce') {
      // 2. Nảy cạnh DVD chuẩn xác: Vận tốc đều đặn, góc chéo tự nhiên ~42 độ (chu kỳ vô tỉ tránh lặp góc)
      const tx = 6.4 / speedMult;
      const ty = 4.5 / speedMult;
      const cycleX = 2 * tx;
      const cycleY = 2 * ty;

      const modX = ((t % cycleX) + cycleX) % cycleX;
      const modY = ((t % cycleY) + cycleY) % cycleY;

      const normX = 1 - Math.abs(modX - tx) / tx;
      const normY = 1 - Math.abs(modY - ty) / ty;

      const leftPct = maxLeftPct * Math.max(0, Math.min(1, normX));
      const topPct = maxTopPct * Math.max(0, Math.min(1, normY));

      return {
        left: `${leftPct.toFixed(2)}%`,
        top: `${topPct.toFixed(2)}%`,
        opacity: watermark.opacity ?? 0.8,
        maxWidth: `${wmScale}%`,
        transition: 'none',
        willChange: 'left, top',
      };
    }

    if (watermark.position === 'custom' && watermark.customPos) {
      return {
        left: `${watermark.customPos.xPercent}%`,
        top: `${watermark.customPos.yPercent}%`,
        opacity: watermark.opacity ?? 0.8,
        maxWidth: `${wmScale}%`,
      };
    }

    return {
      opacity: watermark.opacity ?? 0.8,
      maxWidth: `${wmScale}%`,
    };
  };

  const getMaskStyleClass = (m: CustomMaskRegion) => {
    switch (m.mode) {
      case 'gaussian':
        return ' bg-surface';
      case 'glass':
        return ' bg-white/10 border border-white/25 shadow-inner';
      case 'pixelate':
        return 'bg-bg backdrop-grayscale contrast-125';
      case 'solid':
        return '';
      default:
        return ' bg-surface';
    }
  };


  const outlineShadow =
    outlineWidth > 0
      ? [
          `${outlineWidth}px 0 0 ${outlineColor}`,
          `0 ${outlineWidth}px 0 ${outlineColor}`,
          `-${outlineWidth}px 0 0 ${outlineColor}`,
          `0 -${outlineWidth}px 0 ${outlineColor}`,
        ].join(', ')
      : 'none';

  return (
    <div className="flex flex-col gap-3 rounded-lg border border-border bg-bg p-4">
      <div className="flex items-center justify-between border-b border-border pb-2.5">
        <div className="flex items-center gap-2">
          <div className="h-2 w-2 rounded-full bg-emerald-400 animate-pulse" />
          <span className="text-xs font-semibold text-text">
            Xem trước Video trực tiếp (Live Preview Mini CapCut)
          </span>
        </div>
        <span className="rounded-full border border-border bg-surface-2 px-2 py-0.5 text-[10px] font-mono text-accent">
          Tỉ lệ: {aspectRatio}
        </span>
      </div>

      {/* Video Container with Aspect Ratio */}
      <div className="flex items-center justify-center overflow-hidden rounded-md bg-bg p-2 relative min-h-[260px] w-full">
        <div
          ref={containerRef}
          style={{
            aspectRatio: `${targetRatio}`,
            maxHeight: `${maxPreviewH}px`,
            maxWidth: '100%',
            width: `min(100%, calc(${maxPreviewH}px * ${targetRatio}))`,
            height: 'auto',
          }}
          className="relative overflow-hidden rounded-lg bg-black select-none mx-auto"
        >
          {videoSrc ? (
            <video
              ref={videoRef}
              src={videoSrc}
              muted={isMuted}
              playsInline
              style={{
                transform: mirrorHorizontal ? 'scaleX(-1)' : undefined,
              }}
              onTimeUpdate={() => {
                if (videoRef.current) {
                  onTimeUpdate(videoRef.current.currentTime);
                }
              }}
              onLoadedMetadata={() => {
                if (videoRef.current) {
                  const validSpeed = speed && speed >= 1.0 ? speed : 1.0;
                  videoRef.current.playbackRate = validSpeed;
                  setDuration(videoRef.current.duration);
                  if (videoRef.current.videoWidth > 0 && videoRef.current.videoHeight > 0) {
                    setVideoDimensions({
                      width: videoRef.current.videoWidth,
                      height: videoRef.current.videoHeight,
                    });
                  }
                }
              }}
              onEnded={() => setIsPlaying(false)}
              className={`h-full w-full pointer-events-none transition-transform duration-200 ${
                aspectRatio === 'original' ? 'object-fill' : 'object-contain'
              }`}
            />
          ) : (
            <div className="flex h-full w-full items-center justify-center text-xs text-text-muted">
              Không có video nguồn
            </div>
          )}

          {/* 0. Dải che phụ đề cổ điển (Classic Bar Mask) */}
          {classicMaskEnabled && classicMask && (
            <div
              className={`absolute inset-x-0 z-10 pointer-events-none transition-all ${
                classicMask.position === 'top' ? 'top-0' : 'bottom-0'
              } ${
                classicMask.mode === 'solid'
                  ? 'bg-black'
                  : ' bg-bg border-y border-border'
              }`}
              style={{
                height: `${Math.min(50, Math.max(5, classicMask.heightPercent || 22))}%`,
              }}
            />
          )}

          {/* 1. Danh sách các vùng che mờ tự do (Hỗ trợ kéo di chuyển & co giãn) */}
          {customMaskEnabled &&
            masksList.map((m, idx) => {
              if (m.enabled === false) return null;
              const isSelected = idx === currentActiveIdx;
              const isTimeActive =
                (!m.startSec && !m.endSec) ||
                (currentTime >= (m.startSec || 0) &&
                  (m.endSec && m.endSec > 0 ? currentTime <= m.endSec : true));

              return (
                <div
                  key={m.id || idx}
                  onClick={(e) => {
                    e.stopPropagation();
                    onSelectMask?.(idx);
                  }}
                  onMouseDown={(e) => {
                    e.stopPropagation();
                    onSelectMask?.(idx);
                    setDragState({
                      maskIndex: idx,
                      action: 'move',
                      startX: e.clientX,
                      startY: e.clientY,
                      initialX: m.xPercent,
                      initialY: m.yPercent,
                      initialW: m.widthPercent,
                      initialH: m.heightPercent,
                    });
                  }}
                  style={{
                    left: `${m.xPercent}%`,
                    top: `${m.yPercent}%`,
                    width: `${m.widthPercent}%`,
                    height: `${m.heightPercent}%`,
                    backgroundColor: m.mode === 'solid' ? (m.colorHex || '#000000') : undefined,
                    opacity: !isTimeActive ? 0.35 : m.mode === 'solid' ? Math.max(0.1, (m.intensity ?? 100) / 100) : 1,
                  }}
                  className={`absolute flex items-center justify-center transition-[opacity] cursor-move select-none ${
                    isSelected
                      ? 'border-2 border-accent/40 shadow-[0_0_12px_rgba(6,182,212,0.6)] z-20'
                      : 'border border-dashed border-cyan-400/60 z-10 hover:border-cyan-300'
                  } ${getMaskStyleClass(m)}`}
                  title={`${m.name || `Vùng #${idx + 1}`} (Nhấp & kéo để dời, kéo góc để đổi cỡ)`}
                >
                  {/* Badge tên vùng */}
                  <div className="absolute top-1 left-1 flex items-center gap-1 rounded bg-black/80 px-1.5 py-0.5 text-[9px] font-mono text-accent pointer-events-none shadow">
                    <ShieldAlert className="h-2.5 w-2.5 text-accent" />
                    <span>
                      {m.name || `#${idx + 1}`} ({m.mode})
                    </span>
                  </div>

                  {/* Handles co giãn kích thước (8 hướng khi vùng đang được chọn) */}
                  {isSelected && (
                    <>
                      {/* 4 Góc */}
                      <div
                        onMouseDown={(e) => {
                          e.stopPropagation();
                          setDragState({
                            maskIndex: idx,
                            action: 'nw',
                            startX: e.clientX,
                            startY: e.clientY,
                            initialX: m.xPercent,
                            initialY: m.yPercent,
                            initialW: m.widthPercent,
                            initialH: m.heightPercent,
                          });
                        }}
                        className="absolute -top-1.5 -left-1.5 h-3 w-3 rounded-full bg-cyan-400 border border-black cursor-nwse-resize hover:scale-125 z-30"
                      />
                      <div
                        onMouseDown={(e) => {
                          e.stopPropagation();
                          setDragState({
                            maskIndex: idx,
                            action: 'ne',
                            startX: e.clientX,
                            startY: e.clientY,
                            initialX: m.xPercent,
                            initialY: m.yPercent,
                            initialW: m.widthPercent,
                            initialH: m.heightPercent,
                          });
                        }}
                        className="absolute -top-1.5 -right-1.5 h-3 w-3 rounded-full bg-cyan-400 border border-black cursor-nesw-resize hover:scale-125 z-30"
                      />
                      <div
                        onMouseDown={(e) => {
                          e.stopPropagation();
                          setDragState({
                            maskIndex: idx,
                            action: 'se',
                            startX: e.clientX,
                            startY: e.clientY,
                            initialX: m.xPercent,
                            initialY: m.yPercent,
                            initialW: m.widthPercent,
                            initialH: m.heightPercent,
                          });
                        }}
                        className="absolute -bottom-1.5 -right-1.5 h-3 w-3 rounded-full bg-cyan-400 border border-black cursor-nwse-resize hover:scale-125 z-30"
                      />
                      <div
                        onMouseDown={(e) => {
                          e.stopPropagation();
                          setDragState({
                            maskIndex: idx,
                            action: 'sw',
                            startX: e.clientX,
                            startY: e.clientY,
                            initialX: m.xPercent,
                            initialY: m.yPercent,
                            initialW: m.widthPercent,
                            initialH: m.heightPercent,
                          });
                        }}
                        className="absolute -bottom-1.5 -left-1.5 h-3 w-3 rounded-full bg-cyan-400 border border-black cursor-nesw-resize hover:scale-125 z-30"
                      />

                      {/* 4 Cạnh */}
                      <div
                        onMouseDown={(e) => {
                          e.stopPropagation();
                          setDragState({
                            maskIndex: idx,
                            action: 'n',
                            startX: e.clientX,
                            startY: e.clientY,
                            initialX: m.xPercent,
                            initialY: m.yPercent,
                            initialW: m.widthPercent,
                            initialH: m.heightPercent,
                          });
                        }}
                        className="absolute -top-1 left-1/2 -translate-x-1/2 h-2 w-5 rounded-full bg-cyan-300 border border-black cursor-ns-resize hover:scale-110 z-30"
                      />
                      <div
                        onMouseDown={(e) => {
                          e.stopPropagation();
                          setDragState({
                            maskIndex: idx,
                            action: 's',
                            startX: e.clientX,
                            startY: e.clientY,
                            initialX: m.xPercent,
                            initialY: m.yPercent,
                            initialW: m.widthPercent,
                            initialH: m.heightPercent,
                          });
                        }}
                        className="absolute -bottom-1 left-1/2 -translate-x-1/2 h-2 w-5 rounded-full bg-cyan-300 border border-black cursor-ns-resize hover:scale-110 z-30"
                      />
                      <div
                        onMouseDown={(e) => {
                          e.stopPropagation();
                          setDragState({
                            maskIndex: idx,
                            action: 'w',
                            startX: e.clientX,
                            startY: e.clientY,
                            initialX: m.xPercent,
                            initialY: m.yPercent,
                            initialW: m.widthPercent,
                            initialH: m.heightPercent,
                          });
                        }}
                        className="absolute top-1/2 -left-1 -translate-y-1/2 h-5 w-2 rounded-full bg-cyan-300 border border-black cursor-ew-resize hover:scale-110 z-30"
                      />
                      <div
                        onMouseDown={(e) => {
                          e.stopPropagation();
                          setDragState({
                            maskIndex: idx,
                            action: 'e',
                            startX: e.clientX,
                            startY: e.clientY,
                            initialX: m.xPercent,
                            initialY: m.yPercent,
                            initialW: m.widthPercent,
                            initialH: m.heightPercent,
                          });
                        }}
                        className="absolute top-1/2 -right-1 -translate-y-1/2 h-5 w-2 rounded-full bg-cyan-300 border border-black cursor-ew-resize hover:scale-110 z-30"
                      />
                    </>
                  )}
                </div>
              );
            })}

          {/* 2. Watermark Overlay Preview (Hỗ trợ chuyển động chạy khắp màn hình) */}
          {watermarkEnabled && watermark.content && (
            <div
              style={getAnimatedWatermarkStyle()}
              className={`absolute z-10 pointer-events-none ${getWatermarkPositionClass(
                watermark.position
              )}`}
            >
              {watermark.type === 'image' ? (
                <img
                  src={`vanhmedia://local/${encodeURIComponent(watermark.content)}`}
                  alt="Watermark"
                  className="max-h-12 w-auto object-contain drop-"
                />
              ) : (
                <span className="font-semibold text-white drop- text-xs px-2 py-0.5 rounded bg-black/50 border border-white/20 whitespace-nowrap">
                  {watermark.content}
                </span>
              )}
            </div>
          )}

          {/* 3. Subtitle Overlay Preview (Phụ đề chính) */}
          {activeLine && (
            <div
              onMouseDown={(e) => {
                if (!onUpdateSubtitlePosition) return;
                e.stopPropagation();
                const defaultX = alignment === 1 || alignment === 4 || alignment === 7 ? 15 : alignment === 3 || alignment === 6 || alignment === 9 ? 85 : 50;
                const defaultY = alignment === 7 || alignment === 8 || alignment === 9 ? 12 : alignment === 4 || alignment === 5 || alignment === 6 ? 50 : 88;
                const initX = posPercent?.x ?? defaultX;
                const initY = posPercent?.y ?? defaultY;
                setSubDragState({
                  startX: e.clientX,
                  startY: e.clientY,
                  initialX: initX,
                  initialY: initY,
                });
              }}
              style={getSubContainerStyle(alignment, marginV, marginH, posPercent, isVert)}
              className={`group/sub flex items-center justify-center transition-all select-none ${
                onUpdateSubtitlePosition ? 'cursor-grab active:cursor-grabbing pointer-events-auto' : 'pointer-events-none'
              }`}
              title={onUpdateSubtitlePosition ? "Nhấp và giữ chuột để kéo phụ đề đến vị trí mong muốn" : undefined}
            >
              {/* Mini CapCut Subtitle Preview: Kinetic Presets or Standard Subtitle */}
              {(() => {
                if (kineticConfig && kineticConfig.preset === 'hormozi') {
                  const wordTimings = calculateWordTimings(activeLine);
                  const relMs = Math.max(0, currentTimeMs - activeLine.startMs);
                  const activeColor = kineticConfig.activeColor || '#FFE500';
                  return (
                    <div className="flex flex-wrap items-center justify-center gap-x-2 gap-y-1 text-center max-w-full">
                      {wordTimings.map((w, idx) => {
                        const isActive = relMs >= w.startMs && relMs <= w.endMs;
                        return (
                          <span
                            key={idx}
                            style={{
                              fontFamily: '"Arial Black", Impact, Montserrat, Arial, sans-serif',
                              fontSize: `${fontSize * 1.05}px`,
                              lineHeight: 1.25,
                              fontWeight: 900,
                              color: isActive ? activeColor : '#FFFFFF',
                              transform: isActive ? 'scale(1.14)' : 'scale(1.0)',
                              textShadow: isActive
                                ? `0 0 14px ${activeColor}, 3px 3px 0 #000, -3px -3px 0 #000, 3px -3px 0 #000, -3px 3px 0 #000`
                                : '2.5px 2.5px 0 #000, -2.5px -2.5px 0 #000, 2.5px -2.5px 0 #000, -2.5px 2.5px 0 #000',
                              transition: 'transform 80ms ease-out, color 80ms ease-out',
                              display: 'inline-block',
                            }}
                          >
                            {w.word.toUpperCase()}
                          </span>
                        );
                      })}
                    </div>
                  );
                }

                if (kineticConfig && kineticConfig.preset === 'mrbeast') {
                  const match = kineticConfig.enableEmoji !== false
                    ? detectEmoji(activeLine.text, kineticConfig.emojiFrequency ?? 'medium', activeLineIndex)
                    : null;
                  const upperText = activeLine.text.toUpperCase();
                  return (
                    <>
                      <style>{`
                        @keyframes vanhsubMrBeastBounce {
                          0% { transform: scale(1.3); }
                          60% { transform: scale(0.95); }
                          100% { transform: scale(1.0); }
                        }
                      `}</style>
                      <div
                        key={`mrbeast-${activeLineIndex}`}
                        style={{
                          fontFamily: 'Impact, "Arial Black", sans-serif',
                          fontSize: `${fontSize * 1.15}px`,
                          lineHeight: 1.25,
                          fontWeight: 900,
                          color: '#FFFFFF',
                          textShadow: '3.5px 3.5px 0 #000, -3.5px -3.5px 0 #000, 3.5px -3.5px 0 #000, -3.5px 3.5px 0 #000',
                          animation: 'vanhsubMrBeastBounce 0.22s cubic-bezier(0.175, 0.885, 0.32, 1.275) both',
                        }}
                        className="text-center break-words max-w-full"
                      >
                        {upperText}
                        {match && (
                          <span className="ml-2 inline-block text-2xl align-middle" style={{ textShadow: 'none' }}>
                            {match.emoji}
                          </span>
                        )}
                      </div>
                    </>
                  );
                }

                if (kineticConfig && kineticConfig.preset === 'minimalist_glow') {
                  const glowCol = kineticConfig.activeColor || '#00F5FF';
                  const blurPx = (kineticConfig.glowBlur || 4) * 2;
                  const dur = Math.max(1, activeLine.endMs - activeLine.startMs);
                  const elapsed = Math.max(0, Math.min(dur, currentTimeMs - activeLine.startMs));
                  const progressPct = (elapsed / dur) * 100;
                  return (
                    <div className="flex flex-col items-center justify-center max-w-full">
                      <span
                        style={{
                          fontFamily: '"Segoe UI", Montserrat, Arial, sans-serif',
                          fontSize: `${fontSize * 0.95}px`,
                          lineHeight: 1.25,
                          color: '#FFFFFF',
                          fontWeight: 600,
                          textShadow: `0 0 ${blurPx}px ${glowCol}, 0 0 4px #FFFFFF, 1px 1px 2px rgba(0,0,0,0.8)`,
                        }}
                        className="text-center break-words max-w-full"
                      >
                        {activeLine.text}
                      </span>
                      {kineticConfig.enableProgressBar !== false && (
                        <div className="w-full max-w-[260px] sm:max-w-[340px] h-1 bg-white/20 rounded-full mt-2 mx-auto overflow-hidden">
                          <div
                            className="h-full rounded-full transition-all duration-75"
                            style={{
                              width: `${progressPct}%`,
                              backgroundColor: glowCol,
                              boxShadow: `0 0 8px ${glowCol}`,
                            }}
                          />
                        </div>
                      )}
                    </div>
                  );
                }

                return (
                  <span
                    style={{
                      fontFamily: `"${fontName}", Arial, sans-serif`,
                      fontSize: `${fontSize * 0.9}px`,
                      lineHeight: 1.25,
                      color: textColor,
                      fontWeight: isBold ? 800 : 500,
                      fontStyle: isItalic ? 'italic' : 'normal',
                      writingMode: isVert ? 'vertical-rl' : 'horizontal-tb',
                      textOrientation: isVert ? 'upright' : 'mixed',
                      letterSpacing: isVert ? '3px' : 'normal',
                      ...(globalStyle.borderStyle === 3
                        ? {
                            backgroundColor: outlineColor || '#000000',
                            padding: isVert ? '10px 4px' : '3px 10px',
                            borderRadius: '3px',
                            boxShadow: '0 2px 8px rgba(0,0,0,0.5)',
                          }
                        : {
                            textShadow: outlineShadow,
                          }),
                    }}
                    className={`text-center break-words max-w-full ${
                      subDragState ? 'ring-2 ring-accent/30 rounded px-1 ' : ''
                    }`}
                  >
                    {activeLine.text}
                  </span>
                );
              })()}
            </div>
          )}

          {/* 4. Secondary Subtitle Overlay Preview (Song ngữ / Lời nhạc gốc) */}
          {dualSubtitlesEnabled && activeSecLine && (
            <div
              style={getSubContainerStyle(
                secondaryStyle?.alignment ?? 4,
                secondaryStyle?.marginV ?? 25,
                secondaryStyle?.marginH ?? 35,
                undefined,
                secondaryStyle?.isVertical !== undefined ? secondaryStyle.isVertical : true
              )}
              className="flex items-center justify-center pointer-events-none transition-all select-none z-20"
            >
              <span
                style={{
                  fontFamily: `"${secondaryStyle?.fontName || 'Arial'}", Arial, sans-serif`,
                  fontSize: `${((secondaryStyle?.fontSize || 18) * 0.85)}px`,
                  lineHeight: 1.25,
                  color: secondaryStyle?.primaryColour || '#FFE135',
                  fontWeight: secondaryStyle?.bold ? 800 : 600,
                  writingMode: (secondaryStyle?.isVertical !== undefined ? secondaryStyle.isVertical : true) ? 'vertical-rl' : 'horizontal-tb',
                  textOrientation: (secondaryStyle?.isVertical !== undefined ? secondaryStyle.isVertical : true) ? 'upright' : 'mixed',
                  letterSpacing: '3px',
                  textShadow: '2px 0 0 #000, 0 2px 0 #000, -2px 0 0 #000, 0 -2px 0 #000',
                }}
                className="text-center break-words whitespace-pre-line max-w-full"
              >
                {activeSecLine.text}
              </span>
            </div>
          )}
        </div>
      </div>

      {/* Video Scrubber & Playback Controls */}
      <div className="flex flex-col gap-2 pt-1">
        <div className="flex items-center gap-3">
          <input
            type="range"
            min={0}
            max={duration || 100}
            step={0.1}
            value={activeTime}
            onChange={handleSeek}
            className="flex-1 accent-accent cursor-pointer h-1.5 rounded-lg bg-surface-2"
          />
        </div>

        <div className="flex items-center justify-between text-xs text-text-muted">
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={togglePlay}
              className="flex h-7 w-7 items-center justify-center rounded-lg bg-surface-2 text-text hover:bg-surface-3 transition cursor-pointer"
            >
              {isPlaying ? (
                <Pause className="h-3.5 w-3.5 fill-current" />
              ) : (
                <Play className="h-3.5 w-3.5 fill-current ml-0.5" />
              )}
            </button>

            <button
              type="button"
              onClick={() => {
                if (videoRef.current) {
                  videoRef.current.currentTime = 0;
                  onTimeUpdate(0);
                }
              }}
              className="flex h-7 w-7 items-center justify-center rounded-lg bg-surface-2 text-text-muted hover:bg-surface-3 hover:text-white transition cursor-pointer"
              title="Về đầu video"
            >
              <RotateCcw className="h-3 w-3" />
            </button>

            <button
              type="button"
              onClick={() => setIsMuted(!isMuted)}
              className="flex h-7 w-7 items-center justify-center rounded-lg bg-surface-2 text-text-muted hover:bg-surface-3 hover:text-white transition cursor-pointer"
              title={isMuted ? 'Bật âm thanh' : 'Tắt tiếng'}
            >
              {isMuted ? <VolumeX className="h-3.5 w-3.5" /> : <Volume2 className="h-3.5 w-3.5" />}
            </button>
          </div>

          <div className="font-mono text-[11px] text-text">
            <span>{formatMs(activeTime * 1000).split(',')[0]}</span>
            <span className="text-text-muted mx-1">/</span>
            <span>{formatMs(duration * 1000).split(',')[0]}</span>
          </div>
        </div>
      </div>
    </div>
  );
};
