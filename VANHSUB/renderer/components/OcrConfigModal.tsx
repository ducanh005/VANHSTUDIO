import React, { useEffect, useRef, useState } from 'react';
import * as Dialog from '@radix-ui/react-dialog';
import {
  Check,
  Crop,
  Layers,
  Loader2,
  Maximize2,
  Play,
  Pause,
  RotateCcw,
  ScanText,
  Sliders,
  Sparkles,
  X,
} from 'lucide-react';
import type { Task } from '../types/task';
import type { OcrCustomRegion, OcrDualRegions, OcrMode, OcrStartOptions } from '../types/electron';

export interface OcrModalStartPayload extends OcrStartOptions {
  useGeminiAi?: boolean;
}

interface OcrConfigModalProps {
  isOpen: boolean;
  onClose: () => void;
  task: Task | null;
  launchPurpose?: 'ocr' | 'hybrid';
  onStartOcr: (options: OcrModalStartPayload) => Promise<void>;
}

const OCR_MODES: Array<{
  id: OcrMode;
  label: string;
  desc: string;
  badge?: string;
  badgeColor?: string;
}> = [
  {
    id: 'auto',
    label: 'Auto',
    desc: 'Tự tìm subtitle trên toàn màn hình (AI tracking & tự lọc bỏ logo/watermark)',
    badge: 'Khuyên dùng',
    badgeColor: 'bg-accent-tint text-accent border-accent/40',
  },
  {
    id: 'dual',
    label: '2 Vùng (Trên & Dưới)',
    desc: 'Vùng trên quét bảng/thông tin -> xuất file .overlay.srt riêng; vùng dưới quét lời thoại -> không trùng timeline',
    badge: 'Tách 2 file',
    badgeColor: 'border-amber-500/40 bg-amber-500/15 text-amber-300',
  },
  {
    id: 'bottom',
    label: 'Bottom',
    desc: 'Chỉ tìm vùng dưới (Dải đáy màn hình ~35%)',
  },
  {
    id: 'full',
    label: 'Full Screen',
    desc: 'Nhận diện tất cả text trên toàn khung hình (không lọc)',
  },
  {
    id: 'custom',
    label: 'Custom',
    desc: 'Người dùng kéo 1 vùng cần OCR trực tiếp trên video',
    badge: 'Tuỳ chỉnh',
    badgeColor: 'bg-accent-tint text-accent border-accent/40',
  },
];

const DEFAULT_CUSTOM_REGION: OcrCustomRegion = {
  x: 0.05,
  y: 0.68,
  w: 0.90,
  h: 0.28,
};

const DEFAULT_DUAL_REGIONS: OcrDualRegions = {
  top: { x: 0.05, y: 0.05, w: 0.90, h: 0.35 },
  bottom: { x: 0.05, y: 0.68, w: 0.90, h: 0.28 },
};

export default function OcrConfigModal({
  isOpen,
  onClose,
  task,
  launchPurpose = 'ocr',
  onStartOcr,
}: OcrConfigModalProps) {
  const [mode, setMode] = useState<OcrMode>('auto');
  const [language, setLanguage] = useState('vie');
  const [fps, setFps] = useState(2);
  const [dualEngine, setDualEngine] = useState(true);
  const [useGeminiAi, setUseGeminiAi] = useState(true);
  const [customRegion, setCustomRegion] = useState<OcrCustomRegion>(DEFAULT_CUSTOM_REGION);
  const [dualRegions, setDualRegions] = useState<OcrDualRegions>(DEFAULT_DUAL_REGIONS);
  const [activeDualTarget, setActiveDualTarget] = useState<'top' | 'bottom'>('top');
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Video preview & drawing state
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const overlayRef = useRef<HTMLDivElement | null>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [isDrawing, setIsDrawing] = useState(false);
  const [drawStart, setDrawStart] = useState<{ x: number; y: number } | null>(null);

  // Nạp cấu hình đã lưu từ SettingsStore khi mở modal
  useEffect(() => {
    if (!isOpen || typeof window === 'undefined' || !window.vanhsub?.settings) return;

    Promise.all([
      window.vanhsub.settings.get('ocrMode'),
      window.vanhsub.settings.get('ocrLanguage'),
      window.vanhsub.settings.get('ocrFps'),
      window.vanhsub.settings.get('ocrDualEngine'),
      window.vanhsub.settings.get('ocrCustomRegion'),
      window.vanhsub.settings.get('ocrDualRegions'),
      window.vanhsub.settings.get('hybridUseGeminiAi'),
    ])
      .then(([savedMode, savedLang, savedFps, savedDual, savedRegion, savedDualRegions, savedHybridAi]) => {
        if (savedMode && ['auto', 'bottom', 'full', 'custom', 'dual'].includes(String(savedMode))) {
          setMode(savedMode as OcrMode);
        }
        if (savedLang) setLanguage(String(savedLang));
        if (savedFps) setFps(Number(savedFps) || 2);
        if (savedDual !== undefined) setDualEngine(Boolean(savedDual));
        if (savedHybridAi !== undefined) setUseGeminiAi(Boolean(savedHybridAi));
        if (savedRegion && typeof savedRegion === 'object') {
          setCustomRegion(savedRegion as OcrCustomRegion);
        }
        if (
          savedDualRegions &&
          typeof savedDualRegions === 'object' &&
          (savedDualRegions as OcrDualRegions).top &&
          (savedDualRegions as OcrDualRegions).bottom
        ) {
          setDualRegions(savedDualRegions as OcrDualRegions);
        }
      })
      .catch(() => {});
  }, [isOpen]);

  const videoSrc = task?.filePath
    ? `vanhmedia://local/${encodeURIComponent(task.filePath)}`
    : '';

  const handleTimeUpdate = () => {
    if (videoRef.current) {
      setCurrentTime(videoRef.current.currentTime);
    }
  };

  const handleLoadedMetadata = () => {
    if (videoRef.current) {
      setDuration(videoRef.current.duration || 0);
    }
  };

  const togglePlay = () => {
    if (!videoRef.current) return;
    if (videoRef.current.paused) {
      videoRef.current.play().then(() => setIsPlaying(true)).catch(() => {});
    } else {
      videoRef.current.pause();
      setIsPlaying(false);
    }
  };

  const handleSeek = (e: React.ChangeEvent<HTMLInputElement>) => {
    const val = Number(e.target.value);
    setCurrentTime(val);
    if (videoRef.current) {
      videoRef.current.currentTime = val;
    }
  };

  const updateActiveDrawnRegion = (next: OcrCustomRegion) => {
    if (mode === 'dual') {
      setDualRegions((prev) => ({
        ...prev,
        [activeDualTarget]: next,
      }));
    } else {
      setCustomRegion(next);
    }
  };

  // Vẽ vùng custom hoặc dual trên video preview
  const handleMouseDown = (e: React.MouseEvent<HTMLDivElement>) => {
    if ((mode !== 'custom' && mode !== 'dual') || !overlayRef.current) return;
    const rect = overlayRef.current.getBoundingClientRect();
    const x = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
    const y = Math.max(0, Math.min(1, (e.clientY - rect.top) / rect.height));

    setIsDrawing(true);
    setDrawStart({ x, y });
    updateActiveDrawnRegion({ x, y, w: 0.01, h: 0.01 });
  };

  const handleMouseMove = (e: React.MouseEvent<HTMLDivElement>) => {
    if (!isDrawing || !drawStart || !overlayRef.current) return;
    const rect = overlayRef.current.getBoundingClientRect();
    const currentX = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
    const currentY = Math.max(0, Math.min(1, (e.clientY - rect.top) / rect.height));

    const x = Math.min(drawStart.x, currentX);
    const y = Math.min(drawStart.y, currentY);
    const w = Math.max(0.02, Math.abs(currentX - drawStart.x));
    const h = Math.max(0.02, Math.abs(currentY - drawStart.y));

    updateActiveDrawnRegion({
      x: Number(x.toFixed(4)),
      y: Number(y.toFixed(4)),
      w: Number(w.toFixed(4)),
      h: Number(h.toFixed(4)),
    });
  };

  const handleMouseUp = () => {
    setIsDrawing(false);
    setDrawStart(null);
  };

  // Thiết lập vùng mẫu nhanh
  const setPresetRegion = (preset: 'bottom30' | 'bottom50' | 'full') => {
    if (preset === 'bottom30') {
      setCustomRegion({ x: 0.05, y: 0.68, w: 0.90, h: 0.28 });
    } else if (preset === 'bottom50') {
      setCustomRegion({ x: 0.05, y: 0.48, w: 0.90, h: 0.48 });
    } else if (preset === 'full') {
      setCustomRegion({ x: 0.01, y: 0.01, w: 0.98, h: 0.98 });
    }
  };

  const setDualPreset = (preset: 'standard' | 'balanced' | 'compactTop') => {
    if (preset === 'standard') {
      setDualRegions({
        top: { x: 0.05, y: 0.05, w: 0.90, h: 0.35 },
        bottom: { x: 0.05, y: 0.68, w: 0.90, h: 0.28 },
      });
    } else if (preset === 'balanced') {
      setDualRegions({
        top: { x: 0.04, y: 0.04, w: 0.92, h: 0.45 },
        bottom: { x: 0.05, y: 0.66, w: 0.90, h: 0.30 },
      });
    } else {
      setDualRegions({
        top: { x: 0.05, y: 0.04, w: 0.90, h: 0.25 },
        bottom: { x: 0.05, y: 0.64, w: 0.90, h: 0.32 },
      });
    }
  };

  const handleSubmit = async () => {
    if (!task) return;
    setIsSubmitting(true);
    try {
      // Lưu lại cài đặt vừa chọn để lần sau dùng tiếp
      if (typeof window !== 'undefined' && window.vanhsub?.settings) {
        const updates: Array<Promise<any>> = [
          window.vanhsub.settings.set('ocrMode', mode),
          window.vanhsub.settings.set('ocrLanguage', language),
          window.vanhsub.settings.set('ocrFps', fps),
          window.vanhsub.settings.set('ocrDualEngine', dualEngine),
          window.vanhsub.settings.set('ocrCustomRegion', customRegion),
          window.vanhsub.settings.set('ocrDualRegions', dualRegions),
        ];
        if (launchPurpose === 'hybrid') {
          updates.push(window.vanhsub.settings.set('hybridUseGeminiAi', useGeminiAi));
        }
        await Promise.all(updates).catch(() => {});
      }

      await onStartOcr({
        mode,
        customRegion: mode === 'custom' ? customRegion : null,
        dualRegions: mode === 'dual' ? dualRegions : null,
        language,
        fps,
        dualEngine,
        ...(launchPurpose === 'hybrid' ? { useGeminiAi } : {}),
      });

      onClose();
    } finally {
      setIsSubmitting(false);
    }
  };

  const formatTime = (secs: number) => {
    const m = Math.floor(secs / 60);
    const s = Math.floor(secs % 60);
    return `${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
  };

  return (
    <Dialog.Root open={isOpen} onOpenChange={(open) => !open && !isSubmitting && onClose()}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-black/80 animate-fade-in" />
        <Dialog.Content className="fixed left-1/2 top-1/2 z-50 w-[94vw] max-w-4xl -translate-x-1/2 -translate-y-1/2 overflow-hidden rounded-lg border border-border bg-surface p-6 text-xs text-text animate-scale-in max-h-[92vh] flex flex-col">
          {/* Header */}
          <div className="flex items-center justify-between border-b border-border pb-4">
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-accent-tint border border-accent/40 text-accent">
                {launchPurpose === 'hybrid' ? <Sparkles className="h-5 w-5" /> : <ScanText className="h-5 w-5" />}
              </div>
              <div>
                <Dialog.Title className="text-sm font-bold text-white">
                  {launchPurpose === 'hybrid'
                    ? 'Cấu hình Kết hợp Whisper + OCR'
                    : 'Cấu hình Quét Phụ Đề Cứng (OCR)'}
                </Dialog.Title>
                <Dialog.Description className="text-xs text-text-muted mt-0.5">
                  {launchPurpose === 'hybrid'
                    ? 'Chọn vùng quét chữ kết hợp Whisper ASR & Gemini AI để tách bảng trên và thoại dưới'
                    : 'Chọn chế độ quét phụ đề hardsub từ video bằng AI'}
                  {task && <span className="text-text font-medium"> — {task.fileName}</span>}
                </Dialog.Description>
              </div>
            </div>
            <Dialog.Close asChild>
              <button
                type="button"
                disabled={isSubmitting}
                className="rounded-md p-2 text-text-muted hover:bg-surface-2 hover:text-white transition cursor-pointer disabled:opacity-50"
              >
                <X className="h-4 w-4" />
              </button>
            </Dialog.Close>
          </div>

          {/* Content Body */}
          <div className="flex-1 overflow-y-auto py-4 space-y-5 pr-1">
            {/* Lựa chọn 4 chế độ OCR */}
            <div>
              <label className="mb-2 block font-semibold text-text">
                OCR Mode (Chế độ quét)
              </label>
              <div className="grid gap-2.5 sm:grid-cols-2">
                {OCR_MODES.map((item) => {
                  const isSelected = mode === item.id;
                  return (
                    <button
                      key={item.id}
                      type="button"
                      onClick={() => setMode(item.id)}
                      className={`relative flex items-start gap-3 rounded-lg border p-3.5 text-left transition cursor-pointer ${
                        isSelected
                          ? 'border-accent/40 bg-accent-tint  '
                          : 'border-border bg-bg hover:border-border hover:bg-surface-2'
                      }`}
                    >
                      <div className="mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded-full border border-slate-600 bg-surface-2">
                        {isSelected && <div className="h-2 w-2 rounded-full bg-accent" />}
                      </div>
                      <div className="flex-1">
                        <div className="flex items-center gap-2">
                          <span className="font-semibold text-white">{item.label}</span>
                          {item.badge && (
                            <span
                              className={`rounded-full border px-2 py-0.5 text-[9px] font-bold ${
                                item.badgeColor || 'border-border text-text'
                              }`}
                            >
                              {item.badge}
                            </span>
                          )}
                        </div>
                        <p className="mt-1 text-[11px] leading-relaxed text-text-muted">
                          {item.desc}
                        </p>
                      </div>
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Khung video preview khi chọn Custom hoặc 2 Vùng (Dual) */}
            {(mode === 'custom' || mode === 'dual') && (
              <div className="rounded-lg border border-border bg-bg p-4 space-y-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex items-center gap-2 font-medium text-text">
                    <Crop className="h-4 w-4 text-accent" />
                    <span>
                      {mode === 'dual'
                        ? 'Chọn vùng muốn chỉnh rồi kéo thả chuột trực tiếp trên video'
                        : 'Kéo thả chuột trên khung hình để chọn vùng quét'}
                    </span>
                  </div>
                  {mode === 'custom' ? (
                    <div className="flex items-center gap-1.5 text-[11px]">
                      <span className="text-text-muted">Vùng mẫu:</span>
                      <button
                        type="button"
                        onClick={() => setPresetRegion('bottom30')}
                        className="rounded-lg border border-border bg-surface px-2 py-1 text-text hover:bg-surface-2 hover:text-white cursor-pointer"
                      >
                        30% Đáy
                      </button>
                      <button
                        type="button"
                        onClick={() => setPresetRegion('bottom50')}
                        className="rounded-lg border border-border bg-surface px-2 py-1 text-text hover:bg-surface-2 hover:text-white cursor-pointer"
                      >
                        50% Dưới
                      </button>
                      <button
                        type="button"
                        onClick={() => setPresetRegion('full')}
                        className="rounded-lg border border-border bg-surface px-2 py-1 text-text hover:bg-surface-2 hover:text-white cursor-pointer"
                      >
                        Toàn khung
                      </button>
                    </div>
                  ) : (
                    <div className="flex flex-wrap items-center gap-1.5 text-[11px]">
                      <span className="text-text-muted">Mẫu 2 vùng:</span>
                      <button
                        type="button"
                        onClick={() => setDualPreset('standard')}
                        className="rounded-lg border border-border bg-surface px-2 py-1 text-text hover:bg-surface-2 hover:text-white cursor-pointer"
                      >
                        Trên 35% + Dưới 28%
                      </button>
                      <button
                        type="button"
                        onClick={() => setDualPreset('balanced')}
                        className="rounded-lg border border-border bg-surface px-2 py-1 text-text hover:bg-surface-2 hover:text-white cursor-pointer"
                      >
                        Nửa trên + Đáy 30%
                      </button>
                      <button
                        type="button"
                        onClick={() => setDualPreset('compactTop')}
                        className="rounded-lg border border-border bg-surface px-2 py-1 text-text hover:bg-surface-2 hover:text-white cursor-pointer"
                      >
                        Bảng 25% + Dưới 32%
                      </button>
                    </div>
                  )}
                </div>

                {mode === 'dual' && (
                  <div className="flex flex-wrap items-center gap-2 rounded-md border border-border bg-surface p-2">
                    <span className="text-[11px] text-text-muted px-1">Đang vẽ vùng:</span>
                    <button
                      type="button"
                      onClick={() => setActiveDualTarget('top')}
                      className={`inline-flex items-center gap-1.5 rounded-md border px-3 py-1.5 text-[11px] font-semibold transition cursor-pointer ${
                        activeDualTarget === 'top'
                          ? 'border-amber-400 bg-amber-500/20 text-amber-200 ring-1 ring-amber-400/40'
                          : 'border-border bg-bg text-text-muted hover:text-white'
                      }`}
                    >
                      <span className="h-2.5 w-2.5 rounded-sm bg-amber-400" />
                      <span>Vùng Trên: Bảng / Thông tin (File 2)</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => setActiveDualTarget('bottom')}
                      className={`inline-flex items-center gap-1.5 rounded-md border px-3 py-1.5 text-[11px] font-semibold transition cursor-pointer ${
                        activeDualTarget === 'bottom'
                          ? 'border-accent bg-accent-tint text-accent ring-1 ring-accent/40'
                          : 'border-border bg-bg text-text-muted hover:text-white'
                      }`}
                    >
                      <span className="h-2.5 w-2.5 rounded-sm bg-accent" />
                      <span>Vùng Dưới: Phụ đề thoại (File 1)</span>
                    </button>
                  </div>
                )}

                {/* Video và Bounding Box Canvas */}
                <div
                  ref={overlayRef}
                  onMouseDown={handleMouseDown}
                  onMouseMove={handleMouseMove}
                  onMouseUp={handleMouseUp}
                  className="relative aspect-video w-full overflow-hidden rounded-md border border-border bg-black cursor-crosshair select-none flex items-center justify-center"
                >
                  {videoSrc ? (
                    <video
                      ref={videoRef}
                      src={videoSrc}
                      onTimeUpdate={handleTimeUpdate}
                      onLoadedMetadata={handleLoadedMetadata}
                      className="h-full w-full object-contain pointer-events-none"
                    />
                  ) : (
                    <div className="text-text-faint">Không thể xem trước video</div>
                  )}

                  {mode === 'custom' ? (
                    <div
                      className="absolute pointer-events-none rounded border-2 border-accent/60 bg-accent-tint transition-all duration-75"
                      style={{
                        left: `${customRegion.x * 100}%`,
                        top: `${customRegion.y * 100}%`,
                        width: `${customRegion.w * 100}%`,
                        height: `${customRegion.h * 100}%`,
                      }}
                    >
                      <div className="absolute -top-5 left-0 rounded bg-accent px-1.5 py-0.5 font-mono text-[9px] font-bold text-slate-950 shadow">
                        Vùng quét OCR ({(customRegion.w * 100).toFixed(0)}% × {(customRegion.h * 100).toFixed(0)}%)
                      </div>
                    </div>
                  ) : (
                    <>
                      <div
                        className={`absolute pointer-events-none rounded border-2 bg-amber-500/15 transition-all duration-75 ${
                          activeDualTarget === 'top' ? 'border-amber-400 ring-2 ring-amber-400/40' : 'border-amber-500/50 opacity-80'
                        }`}
                        style={{
                          left: `${dualRegions.top.x * 100}%`,
                          top: `${dualRegions.top.y * 100}%`,
                          width: `${dualRegions.top.w * 100}%`,
                          height: `${dualRegions.top.h * 100}%`,
                        }}
                      >
                        <div className="absolute -top-5 left-0 rounded bg-amber-400 px-1.5 py-0.5 font-mono text-[9px] font-bold text-slate-950 shadow">
                          Vùng Trên: Bảng/Overlay ({(dualRegions.top.w * 100).toFixed(0)}% × {(dualRegions.top.h * 100).toFixed(0)}%)
                        </div>
                      </div>
                      <div
                        className={`absolute pointer-events-none rounded border-2 bg-accent-tint transition-all duration-75 ${
                          activeDualTarget === 'bottom' ? 'border-accent ring-2 ring-accent/40' : 'border-accent/50 opacity-80'
                        }`}
                        style={{
                          left: `${dualRegions.bottom.x * 100}%`,
                          top: `${dualRegions.bottom.y * 100}%`,
                          width: `${dualRegions.bottom.w * 100}%`,
                          height: `${dualRegions.bottom.h * 100}%`,
                        }}
                      >
                        <div className="absolute -top-5 left-0 rounded bg-accent px-1.5 py-0.5 font-mono text-[9px] font-bold text-slate-950 shadow">
                          Vùng Dưới: Lời thoại ({(dualRegions.bottom.w * 100).toFixed(0)}% × {(dualRegions.bottom.h * 100).toFixed(0)}%)
                        </div>
                      </div>
                    </>
                  )}
                </div>

                {/* Thanh điều khiển phát video để chọn frame có phụ đề */}
                <div className="flex items-center gap-3 pt-1">
                  <button
                    type="button"
                    onClick={togglePlay}
                    className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-border bg-surface text-text hover:bg-surface-2 cursor-pointer"
                  >
                    {isPlaying ? <Pause className="h-3.5 w-3.5" /> : <Play className="h-3.5 w-3.5" />}
                  </button>

                  <input
                    type="range"
                    min={0}
                    max={duration || 100}
                    step={0.1}
                    value={currentTime}
                    onChange={handleSeek}
                    className="flex-1 accent-brand-cyan h-1 bg-surface-2 rounded-lg cursor-pointer"
                  />

                  <span className="font-mono text-[11px] text-text-muted shrink-0">
                    {formatTime(currentTime)} / {formatTime(duration)}
                  </span>
                </div>

                {/* Toạ độ vùng chọn */}
                {mode === 'custom' ? (
                  <div className="flex flex-wrap items-center justify-between gap-2 border-t border-border pt-2 font-mono text-[11px] text-text-muted">
                    <span>
                      Toạ độ:{' '}
                      <strong className="text-white">
                        X: {(customRegion.x * 100).toFixed(1)}%, Y: {(customRegion.y * 100).toFixed(1)}%
                      </strong>{' '}
                      | Kích thước:{' '}
                      <strong className="text-accent">
                        W: {(customRegion.w * 100).toFixed(1)}%, H: {(customRegion.h * 100).toFixed(1)}%
                      </strong>
                    </span>
                    <span className="text-[10px] text-text-muted">
                      Kéo chuột trên video bất kỳ lúc nào để vẽ lại
                    </span>
                  </div>
                ) : (
                  <div className="flex flex-wrap items-center justify-between gap-2 border-t border-border pt-2 font-mono text-[11px] text-text-muted">
                    <span>
                      Trên:{' '}
                      <strong className="text-amber-300">
                        Y {(dualRegions.top.y * 100).toFixed(0)}%..{((dualRegions.top.y + dualRegions.top.h) * 100).toFixed(0)}%
                      </strong>{' '}
                      | Dưới:{' '}
                      <strong className="text-accent">
                        Y {(dualRegions.bottom.y * 100).toFixed(0)}%..{((dualRegions.bottom.y + dualRegions.bottom.h) * 100).toFixed(0)}%
                      </strong>
                    </span>
                    <span className="text-[10px] text-text-muted">
                      Xuất 2 file: phụ đề chính + file .overlay.srt
                    </span>
                  </div>
                )}
              </div>
            )}

            {/* Các tuỳ chọn nâng cao */}
            <div className="grid gap-4 sm:grid-cols-2 rounded-lg border border-border bg-bg p-4">
              <div>
                <label className="mb-1.5 block font-medium text-text">Ngôn ngữ quét (OCR)</label>
                <select
                  value={language}
                  onChange={(e) => setLanguage(e.target.value)}
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
                <label className="mb-1.5 block font-medium text-text">Tốc độ quét (FPS)</label>
                <select
                  value={fps}
                  onChange={(e) => setFps(Number(e.target.value))}
                  className="w-full rounded-md border border-border bg-surface-2 px-3 py-2 text-xs text-white focus:outline-none"
                >
                  <option value={1}>1 khung / giây (Nhanh nhất)</option>
                  <option value={2}>2 khung / giây (Chuẩn — khuyên dùng)</option>
                  <option value={3}>3 khung / giây (Chính xác cao, chậm hơn)</option>
                </select>
              </div>

              <div className="sm:col-span-2 pt-1 space-y-2">
                <label className="flex cursor-pointer items-start gap-2.5 rounded-md border border-border bg-surface p-2.5">
                  <input
                    type="checkbox"
                    checked={dualEngine}
                    onChange={(e) => setDualEngine(e.target.checked)}
                    className="mt-0.5 h-4 w-4 shrink-0 accent-emerald-500 rounded"
                  />
                  <div>
                    <span className="font-semibold text-text block">
                      Đối chiếu 2 engine (PaddleOCR + Tesseract)
                    </span>
                    <span className="text-[11px] text-text-muted block mt-0.5">
                      So sánh kết quả của cả 2 engine trên cùng vùng chữ để tăng độ chính xác (khuyên dùng khi nền phim bận rộn).
                    </span>
                  </div>
                </label>

                {launchPurpose === 'hybrid' && (
                  <label className="flex cursor-pointer items-start gap-2.5 rounded-md border border-indigo-500/30 bg-indigo-950/20 p-2.5">
                    <input
                      type="checkbox"
                      checked={useGeminiAi}
                      onChange={(e) => setUseGeminiAi(e.target.checked)}
                      className="mt-0.5 h-4 w-4 shrink-0 accent-indigo-400 rounded"
                    />
                    <div>
                      <span className="font-semibold text-indigo-200 block">
                        Dùng Gemini AI đối chiếu Whisper ASR & OCR (Khuyên dùng)
                      </span>
                      <span className="text-[11px] text-text-muted block mt-0.5">
                        So sánh câu thoại từ giọng nói (ASR) với chữ quét dưới màn hình (OCR) để sửa từ đồng âm/mất dấu và tự đẩy bảng/biểu đồ lạc sang file .overlay.srt.
                      </span>
                    </div>
                  </label>
                )}
              </div>
            </div>
          </div>

          {/* Footer Actions */}
          <div className="flex items-center justify-end gap-2 border-t border-border pt-4">
            <button
              type="button"
              disabled={isSubmitting}
              onClick={onClose}
              className="rounded-md border border-border bg-surface-2 px-4 py-2 text-xs font-semibold text-text hover:bg-surface-3 transition cursor-pointer disabled:opacity-50"
            >
              Huỷ
            </button>
            <button
              type="button"
              disabled={isSubmitting}
              onClick={handleSubmit}
              className="bg-accent text-white hover:bg-accent-hover inline-flex items-center gap-2 rounded-md px-5 py-2 text-xs font-semibold cursor-pointer hover:opacity-95 transition disabled:opacity-50"
            >
              {isSubmitting ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : launchPurpose === 'hybrid' ? (
                <Sparkles className="h-4 w-4" />
              ) : (
                <ScanText className="h-4 w-4" />
              )}
              <span>
                {isSubmitting
                  ? 'Đang khởi động...'
                  : launchPurpose === 'hybrid'
                    ? 'Bắt đầu Kết hợp Whisper + OCR'
                    : 'Bắt đầu quét OCR'}
              </span>
            </button>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
