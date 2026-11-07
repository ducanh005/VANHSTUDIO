import React from 'react';
import {
  ShieldAlert,
  Image as ImageIcon,
  Type,
  FolderOpen,
  Clock,
  Layers,
  Sparkles,
  Eye,
  EyeOff,
  Plus,
  Trash2,
  Copy,
  Waves,
  Grid,
  Square,
  ChevronUp,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Activity,
} from 'lucide-react';
import type { CustomMaskRegion, WatermarkOptions, MaskMode } from '../../types/electron';

interface OverlayMaskEditorProps {
  // Hỗ trợ danh sách đa vùng che mờ
  customMasks?: CustomMaskRegion[];
  activeMaskIndex?: number;
  onSelectMask?: (index: number) => void;
  onAddMask?: () => void;
  onRemoveMask?: (index: number) => void;
  onToggleMaskItem?: (index: number, enabled: boolean) => void;
  onDuplicateMask?: (index: number) => void;

  // Tương thích ngược với customMask đơn lẻ
  customMask?: CustomMaskRegion;
  customMaskEnabled: boolean;
  onToggleMask: (enabled: boolean) => void;
  onChangeMask: (partial: Partial<CustomMaskRegion>, index?: number) => void;

  watermark: WatermarkOptions;
  watermarkEnabled: boolean;
  onToggleWatermark: (enabled: boolean) => void;
  onChangeWatermark: (partial: Partial<WatermarkOptions>) => void;

  currentVideoTime?: number;
}

export const OverlayMaskEditor: React.FC<OverlayMaskEditorProps> = ({
  customMasks,
  activeMaskIndex = 0,
  onSelectMask,
  onAddMask,
  onRemoveMask,
  onToggleMaskItem,
  onDuplicateMask,
  customMask,
  customMaskEnabled,
  onToggleMask,
  onChangeMask,
  watermark,
  watermarkEnabled,
  onToggleWatermark,
  onChangeWatermark,
  currentVideoTime = 0,
}) => {
  // Chuẩn hoá danh sách mask: ưu tiên customMasks, fallback về [customMask]
  const masksList: CustomMaskRegion[] =
    customMasks && customMasks.length > 0
      ? customMasks
      : customMask
      ? [customMask]
      : [
          {
            id: 'mask_1',
            name: 'Vùng che #1',
            xPercent: 10,
            yPercent: 75,
            widthPercent: 80,
            heightPercent: 20,
            mode: 'blur',
            intensity: 40,
            enabled: true,
          },
        ];

  const currentIdx = Math.max(0, Math.min(masksList.length - 1, activeMaskIndex));
  const activeMask = masksList[currentIdx] || masksList[0];

  const handleMaskChange = (partial: Partial<CustomMaskRegion>) => {
    onChangeMask(partial, currentIdx);
  };

  const handleSelectImage = async () => {
    if (!window.vanhsub?.dialog?.openImageFile) return;
    const selected = await window.vanhsub.dialog.openImageFile();
    if (selected) {
      onChangeWatermark({ content: selected, type: 'image' });
    }
  };

  // Áp dụng vị trí mẫu nhanh (Presets)
  const applyPreset = (preset: 'bottom_sub' | 'top_logo' | 'top_right' | 'top_left' | 'bottom_right' | 'full') => {
    switch (preset) {
      case 'bottom_sub':
        handleMaskChange({ xPercent: 5, yPercent: 75, widthPercent: 90, heightPercent: 20 });
        break;
      case 'top_logo':
        handleMaskChange({ xPercent: 5, yPercent: 5, widthPercent: 90, heightPercent: 15 });
        break;
      case 'top_right':
        handleMaskChange({ xPercent: 70, yPercent: 5, widthPercent: 26, heightPercent: 15 });
        break;
      case 'top_left':
        handleMaskChange({ xPercent: 4, yPercent: 5, widthPercent: 26, heightPercent: 15 });
        break;
      case 'bottom_right':
        handleMaskChange({ xPercent: 70, yPercent: 75, widthPercent: 26, heightPercent: 20 });
        break;
      case 'full':
        handleMaskChange({ xPercent: 0, yPercent: 0, widthPercent: 100, heightPercent: 100 });
        break;
    }
  };

  // D-pad vi chỉnh từng %
  const nudgeMask = (dx: number, dy: number) => {
    const newX = Math.max(0, Math.min(100 - activeMask.widthPercent, activeMask.xPercent + dx));
    const newY = Math.max(0, Math.min(100 - activeMask.heightPercent, activeMask.yPercent + dy));
    handleMaskChange({
      xPercent: Math.round(newX * 10) / 10,
      yPercent: Math.round(newY * 10) / 10,
    });
  };

  return (
    <div className="grid gap-4 lg:grid-cols-2">
      {/* 1. Vùng che mờ đa điểm & Chỉnh tay (Multi-mask Bounding Boxes) */}
      <div className="flex flex-col gap-3.5 rounded-lg border border-border bg-surface p-4">
        {/* Header chính */}
        <div className="flex items-center justify-between border-b border-border pb-3">
          <div className="flex items-center gap-2">
            <ShieldAlert className="h-4 w-4 text-accent" />
            <span className="text-xs font-semibold text-text">
              Vùng che mờ đa điểm (Multi-mask Bounding Box)
            </span>
            {customMaskEnabled && (
              <span className="rounded-full bg-accent-tint px-2 py-0.5 text-[10px] font-mono font-bold text-accent">
                {masksList.filter((m) => m.enabled !== false).length}/{masksList.length} vùng bật
              </span>
            )}
          </div>
          <label className="relative inline-flex items-center cursor-pointer">
            <input
              type="checkbox"
              checked={customMaskEnabled}
              onChange={(e) => onToggleMask(e.target.checked)}
              className="sr-only peer"
            />
            <div className="w-9 h-5 bg-surface-2 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-slate-300 after:border after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-accent"></div>
          </label>
        </div>

        {customMaskEnabled ? (
          <div className="flex flex-col gap-3.5">
            {/* Thanh danh sách các vùng che (Mask Tabs) */}
            <div className="flex flex-col gap-2 rounded-md border border-border bg-bg p-2.5">
              <div className="flex items-center justify-between">
                <span className="text-[11px] font-medium text-text-muted">Danh sách vùng che:</span>
                <div className="flex items-center gap-1.5">
                  {onDuplicateMask && (
                    <button
                      type="button"
                      onClick={() => onDuplicateMask(currentIdx)}
                      className="inline-flex items-center gap-1 rounded-lg border border-border bg-surface-2 px-2 py-1 text-[11px] text-text hover:bg-surface-3 transition cursor-pointer"
                      title="Nhân bản vùng che hiện tại"
                    >
                      <Copy className="h-3 w-3 text-accent" />
                      <span>Nhân bản</span>
                    </button>
                  )}
                  {onAddMask && (
                    <button
                      type="button"
                      onClick={onAddMask}
                      className="inline-flex items-center gap-1 rounded-lg border border-accent/40 bg-accent-tint px-2.5 py-1 text-[11px] font-semibold text-accent hover:bg-accent/30 transition cursor-pointer"
                      title="Thêm một vùng che mới"
                    >
                      <Plus className="h-3.5 w-3.5" />
                      <span>Thêm vùng</span>
                    </button>
                  )}
                </div>
              </div>

              {/* Danh sách tab vùng che */}
              <div className="flex flex-wrap gap-1.5">
                {masksList.map((m, idx) => {
                  const isSelected = idx === currentIdx;
                  const isItemEnabled = m.enabled !== false;
                  return (
                    <div
                      key={m.id || idx}
                      onClick={() => onSelectMask?.(idx)}
                      className={`group flex items-center gap-1.5 rounded-lg border px-2.5 py-1 text-[11px] font-medium transition cursor-pointer ${
                        isSelected
                          ? 'border-accent/40 bg-accent-tint text-accent  ring-1 ring-accent/30'
                          : 'border-border bg-surface-2 text-text-muted hover:bg-surface-2 hover:text-text'
                      }`}
                    >
                      {/* Bật/tắt riêng vùng này */}
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          if (onToggleMaskItem) {
                            onToggleMaskItem(idx, !isItemEnabled);
                          } else {
                            handleMaskChange({ enabled: !isItemEnabled });
                          }
                        }}
                        className={`p-0.5 rounded hover:bg-surface-3/60 transition ${
                          isItemEnabled ? 'text-accent' : 'text-text-faint'
                        }`}
                        title={isItemEnabled ? 'Vùng đang bật (click để tắt)' : 'Vùng đang tắt (click để bật)'}
                      >
                        {isItemEnabled ? <Eye className="h-3 w-3" /> : <EyeOff className="h-3 w-3" />}
                      </button>

                      <span className="truncate max-w-[120px]">{m.name || `Vùng #${idx + 1}`}</span>

                      {/* Xoá vùng nếu danh sách > 1 */}
                      {masksList.length > 1 && onRemoveMask && (
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            onRemoveMask(idx);
                          }}
                          className="opacity-60 hover:opacity-100 text-rose-400 hover:text-rose-300 p-0.5 rounded transition"
                          title="Xoá vùng che này"
                        >
                          <Trash2 className="h-2.5 w-2.5" />
                        </button>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>

            {/* Chi tiết chỉnh sửa vùng đang chọn */}
            <div className="flex flex-col gap-3 rounded-md border border-border bg-surface p-3">
              {/* Tên vùng */}
              <div className="flex items-center gap-2">
                <span className="text-[11px] text-text-muted w-16 shrink-0">Tên vùng:</span>
                <input
                  type="text"
                  value={activeMask.name || `Vùng #${currentIdx + 1}`}
                  onChange={(e) => handleMaskChange({ name: e.target.value })}
                  placeholder="Ví dụ: Che logo góc phải, Che sub cũ..."
                  className="flex-1 rounded-lg border border-border bg-surface-2 px-2.5 py-1 text-xs text-text placeholder-slate-500 focus:border-accent/40 focus:outline-none"
                />
              </div>

              {/* 5 Kiểu che mờ */}
              <div>
                <span className="text-[11px] text-text-muted mb-1.5 block">Kiểu che mờ:</span>
                <div className="grid grid-cols-3 sm:grid-cols-5 gap-1.5">
                  {[
                    { mode: 'blur' as MaskMode, label: 'Làm mờ', icon: Sparkles, desc: 'Box Blur chuẩn' },
                    { mode: 'gaussian' as MaskMode, label: 'Gauss mịn', icon: Waves, desc: 'Gaussian mịn màng' },
                    { mode: 'glass' as MaskMode, label: 'Kính mờ', icon: Layers, desc: 'Frosted Glass sang trọng' },
                    { mode: 'pixelate' as MaskMode, label: 'Điểm ảnh', icon: Grid, desc: 'Mosaic ô vuông' },
                    { mode: 'solid' as MaskMode, label: 'Hộp màu', icon: Square, desc: 'Tô đặc che kín' },
                  ].map((item) => {
                    const Icon = item.icon;
                    const isSelected = activeMask.mode === item.mode;
                    return (
                      <button
                        key={item.mode}
                        type="button"
                        onClick={() => {
                          if (item.mode === 'solid') {
                            handleMaskChange({
                              mode: 'solid',
                              intensity: 100,
                              colorHex: activeMask.colorHex || '#000000',
                            });
                          } else {
                            handleMaskChange({
                              mode: item.mode,
                              intensity: activeMask.intensity === 100 ? 40 : (activeMask.intensity || 40),
                            });
                          }
                        }}
                        className={`flex flex-col items-center gap-1 rounded-lg border p-1.5 text-center transition cursor-pointer ${
                          isSelected
                            ? 'border-accent/40 bg-accent/15 text-accent  ring-1 ring-accent/30'
                            : 'border-border bg-surface-2 text-text-muted hover:text-white hover:bg-surface-2'
                        }`}
                        title={item.desc}
                      >
                        <Icon className="h-3.5 w-3.5" />
                        <span className="text-[10px] font-semibold">{item.label}</span>
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* Vị trí mẫu nhanh (Presets) */}
              <div>
                <span className="text-[11px] text-text-muted mb-1.5 block">Căn vị trí nhanh:</span>
                <div className="grid grid-cols-3 sm:grid-cols-6 gap-1">
                  {[
                    { id: 'bottom_sub', label: 'Đáy (Sub)' },
                    { id: 'top_logo', label: 'Đỉnh (Logo)' },
                    { id: 'top_right', label: 'Góc trên P' },
                    { id: 'top_left', label: 'Góc trên T' },
                    { id: 'bottom_right', label: 'Góc dưới P' },
                    { id: 'full', label: 'Toàn màn' },
                  ].map((p) => (
                    <button
                      key={p.id}
                      type="button"
                      onClick={() => applyPreset(p.id as any)}
                      className="rounded border border-border bg-surface-2 px-1.5 py-1 text-[10px] font-medium text-text hover:border-accent/40 hover:bg-surface-2 hover:text-accent transition cursor-pointer text-center"
                    >
                      {p.label}
                    </button>
                  ))}
                </div>
              </div>

              {/* Tọa độ X, Y, W, H - Hỗ trợ cả Slider VÀ Gõ tay số % */}
              <div className="grid grid-cols-2 gap-3 pt-1">
                {/* Vị trí X */}
                <div className="rounded-lg border border-border bg-bg p-2">
                  <div className="flex items-center justify-between text-[11px] text-text-muted mb-1">
                    <span>X (Trái):</span>
                    <div className="flex items-center gap-1">
                      <input
                        type="number"
                        min={0}
                        max={Math.max(0, 100 - (activeMask.widthPercent || 4))}
                        step={0.5}
                        value={activeMask.xPercent}
                        onChange={(e) => {
                          const maxX = Math.max(0, 100 - (activeMask.widthPercent || 4));
                          handleMaskChange({ xPercent: Math.max(0, Math.min(maxX, Number(e.target.value) || 0)) });
                        }}
                        className="w-12 rounded border border-border bg-surface-2 px-1 py-0.5 text-right font-mono text-[11px] text-accent focus:outline-none"
                      />
                      <span className="font-mono text-text-muted">%</span>
                    </div>
                  </div>
                  <input
                    type="range"
                    min={0}
                    max={Math.max(0, 100 - (activeMask.widthPercent || 4))}
                    step={0.5}
                    value={activeMask.xPercent}
                    onChange={(e) => handleMaskChange({ xPercent: Number(e.target.value) })}
                    className="w-full accent-accent h-1.5 bg-surface-2 rounded-lg cursor-pointer"
                  />
                </div>

                {/* Vị trí Y */}
                <div className="rounded-lg border border-border bg-bg p-2">
                  <div className="flex items-center justify-between text-[11px] text-text-muted mb-1">
                    <span>Y (Đỉnh):</span>
                    <div className="flex items-center gap-1">
                      <input
                        type="number"
                        min={0}
                        max={Math.max(0, 100 - (activeMask.heightPercent || 4))}
                        step={0.5}
                        value={activeMask.yPercent}
                        onChange={(e) => {
                          const maxY = Math.max(0, 100 - (activeMask.heightPercent || 4));
                          handleMaskChange({ yPercent: Math.max(0, Math.min(maxY, Number(e.target.value) || 0)) });
                        }}
                        className="w-12 rounded border border-border bg-surface-2 px-1 py-0.5 text-right font-mono text-accent focus:outline-none"
                      />
                      <span className="font-mono text-text-muted">%</span>
                    </div>
                  </div>
                  <input
                    type="range"
                    min={0}
                    max={Math.max(0, 100 - (activeMask.heightPercent || 4))}
                    step={0.5}
                    value={activeMask.yPercent}
                    onChange={(e) => handleMaskChange({ yPercent: Number(e.target.value) })}
                    className="w-full accent-accent h-1.5 bg-surface-2 rounded-lg cursor-pointer"
                  />
                </div>

                {/* Chiều rộng W */}
                <div className="rounded-lg border border-border bg-bg p-2">
                  <div className="flex items-center justify-between text-[11px] text-text-muted mb-1">
                    <span>Chiều rộng (W):</span>
                    <div className="flex items-center gap-1">
                      <input
                        type="number"
                        min={2}
                        max={Math.max(2, 100 - (activeMask.xPercent || 0))}
                        step={0.5}
                        value={activeMask.widthPercent}
                        onChange={(e) => {
                          const maxW = Math.max(2, 100 - (activeMask.xPercent || 0));
                          handleMaskChange({ widthPercent: Math.max(2, Math.min(maxW, Number(e.target.value) || 2)) });
                        }}
                        className="w-12 rounded border border-border bg-surface-2 px-1 py-0.5 text-right font-mono text-accent focus:outline-none"
                      />
                      <span className="font-mono text-text-muted">%</span>
                    </div>
                  </div>
                  <input
                    type="range"
                    min={2}
                    max={Math.max(2, 100 - (activeMask.xPercent || 0))}
                    step={0.5}
                    value={activeMask.widthPercent}
                    onChange={(e) => handleMaskChange({ widthPercent: Number(e.target.value) })}
                    className="w-full accent-accent h-1.5 bg-surface-2 rounded-lg cursor-pointer"
                  />
                </div>

                {/* Chiều cao H */}
                <div className="rounded-lg border border-border bg-bg p-2">
                  <div className="flex items-center justify-between text-[11px] text-text-muted mb-1">
                    <span>Chiều cao (H):</span>
                    <div className="flex items-center gap-1">
                      <input
                        type="number"
                        min={2}
                        max={Math.max(2, 100 - (activeMask.yPercent || 0))}
                        step={0.5}
                        value={activeMask.heightPercent}
                        onChange={(e) => {
                          const maxH = Math.max(2, 100 - (activeMask.yPercent || 0));
                          handleMaskChange({ heightPercent: Math.max(2, Math.min(maxH, Number(e.target.value) || 2)) });
                        }}
                        className="w-12 rounded border border-border bg-surface-2 px-1 py-0.5 text-right font-mono text-accent focus:outline-none"
                      />
                      <span className="font-mono text-text-muted">%</span>
                    </div>
                  </div>
                  <input
                    type="range"
                    min={2}
                    max={Math.max(2, 100 - (activeMask.yPercent || 0))}
                    step={0.5}
                    value={activeMask.heightPercent}
                    onChange={(e) => handleMaskChange({ heightPercent: Number(e.target.value) })}
                    className="w-full accent-accent h-1.5 bg-surface-2 rounded-lg cursor-pointer"
                  />
                </div>
              </div>

              {/* Phím điều hướng vi chỉnh (D-pad nudge) */}
              <div className="flex items-center justify-between rounded-lg border border-border bg-bg px-3 py-2">
                <span className="text-[10px] text-text-muted">Vi chỉnh vị trí (D-pad):</span>
                <div className="flex items-center gap-1">
                  <button
                    type="button"
                    onClick={() => nudgeMask(-1, 0)}
                    className="rounded bg-surface-2 p-1 text-text hover:bg-surface-3 hover:text-accent transition cursor-pointer"
                    title="Sang trái 1%"
                  >
                    <ChevronLeft className="h-3.5 w-3.5" />
                  </button>
                  <div className="flex flex-col gap-0.5">
                    <button
                      type="button"
                      onClick={() => nudgeMask(0, -1)}
                      className="rounded bg-surface-2 p-1 text-text hover:bg-surface-3 hover:text-accent transition cursor-pointer"
                      title="Lên trên 1%"
                    >
                      <ChevronUp className="h-3.5 w-3.5" />
                    </button>
                    <button
                      type="button"
                      onClick={() => nudgeMask(0, 1)}
                      className="rounded bg-surface-2 p-1 text-text hover:bg-surface-3 hover:text-accent transition cursor-pointer"
                      title="Xuống dưới 1%"
                    >
                      <ChevronDown className="h-3.5 w-3.5" />
                    </button>
                  </div>
                  <button
                    type="button"
                    onClick={() => nudgeMask(1, 0)}
                    className="rounded bg-surface-2 p-1 text-text hover:bg-surface-3 hover:text-accent transition cursor-pointer"
                    title="Sang phải 1%"
                  >
                    <ChevronRight className="h-3.5 w-3.5" />
                  </button>
                </div>
              </div>

              {/* Cường độ hiệu ứng & Màu sắc */}
              <div className="grid grid-cols-2 gap-3">
                {activeMask.mode === 'solid' ? (
                  <div>
                    <div className="flex justify-between text-[11px] text-text-muted mb-1">
                      <span>Độ đục / Che kín:</span>
                      <span className="font-mono text-accent">{activeMask.intensity ?? 100}%</span>
                    </div>
                    <input
                      type="range"
                      min={10}
                      max={100}
                      value={activeMask.intensity ?? 100}
                      onChange={(e) => handleMaskChange({ intensity: Number(e.target.value) })}
                      className="w-full accent-accent h-1.5 bg-surface-2 rounded-lg cursor-pointer"
                    />
                    <span className="text-[9px] text-text-muted block mt-0.5">
                      {(activeMask.intensity ?? 100) >= 95 ? 'Đặc hoàn toàn (100% không nhìn xuyên)' : 'Đang có độ trong suốt nhẹ'}
                    </span>
                  </div>
                ) : (
                  <div>
                    <div className="flex justify-between text-[11px] text-text-muted mb-1">
                      <span>Cường độ mờ:</span>
                      <span className="font-mono text-accent">{activeMask.intensity ?? 40}</span>
                    </div>
                    <input
                      type="range"
                      min={10}
                      max={100}
                      value={activeMask.intensity ?? 40}
                      onChange={(e) => handleMaskChange({ intensity: Number(e.target.value) })}
                      className="w-full accent-accent h-1.5 bg-surface-2 rounded-lg cursor-pointer"
                    />
                  </div>
                )}

                {(activeMask.mode === 'solid' || activeMask.mode === 'glass') && (
                  <div>
                    <div className="flex justify-between text-[11px] text-text-muted mb-1">
                      <span>Màu sắc che phủ:</span>
                      <span className="font-mono text-accent">{activeMask.colorHex || '#000000'}</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <input
                        type="color"
                        value={activeMask.colorHex || '#000000'}
                        onChange={(e) => handleMaskChange({ colorHex: e.target.value })}
                        className="h-7 w-9 rounded cursor-pointer bg-transparent border-0 p-0"
                      />
                      <div className="flex gap-1">
                        {['#000000', '#ffffff', '#1e293b', '#0f172a'].map((c) => (
                          <button
                            key={c}
                            type="button"
                            onClick={() => handleMaskChange({ colorHex: c })}
                            style={{ backgroundColor: c }}
                            className="h-5 w-5 rounded border border-border hover:scale-110 transition cursor-pointer"
                            title={c}
                          />
                        ))}
                      </div>
                    </div>
                  </div>
                )}
              </div>

              {/* Khung thời gian hiệu lực */}
              <div className="rounded-md border border-border bg-bg p-2.5">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-[11px] font-medium text-text">
                    Thời gian áp dụng (giây):
                  </span>
                  <span className="text-[10px] text-text-muted">
                    (Bỏ trống / 0 = suốt toàn video)
                  </span>
                </div>
                <div className="grid grid-cols-2 gap-2 text-xs">
                  <div className="flex items-center gap-1.5">
                    <span className="text-[10px] text-text-muted">Từ:</span>
                    <input
                      type="number"
                      min={0}
                      step={0.5}
                      placeholder="0s"
                      value={activeMask.startSec ?? ''}
                      onChange={(e) =>
                        handleMaskChange({
                          startSec: e.target.value ? Number(e.target.value) : undefined,
                        })
                      }
                      className="w-full rounded-lg border border-border bg-surface-2 px-2 py-1 text-xs text-text"
                    />
                    <button
                      type="button"
                      onClick={() => handleMaskChange({ startSec: Math.round(currentVideoTime * 10) / 10 })}
                      className="p-1 rounded bg-surface-2 text-text-muted hover:text-accent transition cursor-pointer"
                      title="Lấy thời gian hiện tại của video"
                    >
                      <Clock className="h-3.5 w-3.5" />
                    </button>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <span className="text-[10px] text-text-muted">Đến:</span>
                    <input
                      type="number"
                      min={0}
                      step={0.5}
                      placeholder="Hết"
                      value={activeMask.endSec ?? ''}
                      onChange={(e) =>
                        handleMaskChange({
                          endSec: e.target.value ? Number(e.target.value) : undefined,
                        })
                      }
                      className="w-full rounded-lg border border-border bg-surface-2 px-2 py-1 text-xs text-text"
                    />
                    <button
                      type="button"
                      onClick={() => handleMaskChange({ endSec: Math.round(currentVideoTime * 10) / 10 })}
                      className="p-1 rounded bg-surface-2 text-text-muted hover:text-accent transition cursor-pointer"
                      title="Lấy thời gian hiện tại của video"
                    >
                      <Clock className="h-3.5 w-3.5" />
                    </button>
                  </div>
                </div>
              </div>
            </div>
          </div>
        ) : (
          <p className="text-xs leading-relaxed text-text-muted py-2">
            Bật tính năng này để thêm nhiều vùng che mờ tự do, che logo kênh, chữ quảng cáo hoặc phụ đề cũ với 5 kiểu che mờ (Gaussian Blur, Kính mờ, Điểm ảnh, Tô màu).
          </p>
        )}
      </div>

      {/* 2. Watermark / Logo thương hiệu */}
      <div className="flex flex-col gap-3 rounded-lg border border-border bg-surface p-4">
        <div className="flex items-center justify-between border-b border-border pb-3">
          <div className="flex items-center gap-2">
            <Layers className="h-4 w-4 text-accent" />
            <span className="text-xs font-semibold text-text">
              Watermark / Logo thương hiệu
            </span>
          </div>
          <label className="relative inline-flex items-center cursor-pointer">
            <input
              type="checkbox"
              checked={watermarkEnabled}
              onChange={(e) => onToggleWatermark(e.target.checked)}
              className="sr-only peer"
            />
            <div className="w-9 h-5 bg-surface-2 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-slate-300 after:border after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-accent"></div>
          </label>
        </div>

        {watermarkEnabled ? (
          <div className="flex flex-col gap-3">
            {/* Loại watermark: Text vs Image */}
            <div className="flex items-center gap-2">
              <span className="text-xs text-text-muted">Loại:</span>
              <div className="flex rounded-lg border border-border bg-surface-2 p-0.5">
                <button
                  type="button"
                  onClick={() => onChangeWatermark({ type: 'text' })}
                  className={`flex items-center gap-1.5 rounded-md px-2.5 py-1 text-[11px] font-medium transition cursor-pointer ${
                    watermark.type === 'text'
                      ? 'bg-accent-tint text-accent '
                      : 'text-text-muted hover:text-white'
                  }`}
                >
                  <Type className="h-3 w-3" />
                  <span>Văn bản</span>
                </button>
                <button
                  type="button"
                  onClick={() => onChangeWatermark({ type: 'image' })}
                  className={`flex items-center gap-1.5 rounded-md px-2.5 py-1 text-[11px] font-medium transition cursor-pointer ${
                    watermark.type === 'image'
                      ? 'bg-accent-tint text-accent '
                      : 'text-text-muted hover:text-white'
                  }`}
                >
                  <ImageIcon className="h-3 w-3" />
                  <span>Hình ảnh / Logo</span>
                </button>
              </div>
            </div>

            {/* Nội dung text hoặc chọn ảnh */}
            {watermark.type === 'text' ? (
              <div>
                <label className="mb-1 block text-[11px] font-medium text-text-muted">
                  Nội dung chữ:
                </label>
                <input
                  type="text"
                  placeholder="Ví dụ: @vanhstudio_official"
                  value={watermark.content || ''}
                  onChange={(e) => onChangeWatermark({ content: e.target.value })}
                  className="w-full rounded-md border border-border bg-surface-2 px-3 py-1.5 text-xs text-text placeholder-slate-500 focus:border-accent/40 focus:outline-none"
                />
              </div>
            ) : (
              <div>
                <label className="mb-1 block text-[11px] font-medium text-text-muted">
                  File ảnh logo (PNG, JPG, WebP):
                </label>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={handleSelectImage}
                    className="inline-flex items-center gap-1.5 rounded-md border border-border bg-surface-2 px-3 py-1.5 text-xs font-medium text-text hover:bg-surface-3 transition cursor-pointer shrink-0"
                  >
                    <FolderOpen className="h-3.5 w-3.5 text-accent" />
                    <span>Chọn ảnh...</span>
                  </button>
                  <span
                    className="flex-1 truncate font-mono text-[11px] text-text-muted"
                    title={watermark.content}
                  >
                    {watermark.content
                      ? watermark.content.split(/[/\\]/).pop()
                      : 'Chưa chọn file'}
                  </span>
                </div>
              </div>
            )}

            {/* Vị trí watermark: Cố định hoặc Chuyển động */}
            <div>
              <div className="flex items-center justify-between mb-1.5">
                <label className="text-[11px] font-medium text-text-muted">Vị trí hiển thị:</label>
                {(watermark.position === 'floating' || watermark.position === 'bounce') && (
                  <span className="flex items-center gap-1 rounded bg-amber-500/15 px-2 py-0.5 text-[10px] font-semibold text-amber-400 border border-amber-500/30">
                    <Activity className="h-2.5 w-2.5 animate-spin" />
                    Chống cắt góc / Re-up
                  </span>
                )}
              </div>

              {/* 2 Chế độ chuyển động chạy khắp màn hình */}
              <div className="grid grid-cols-2 gap-2 mb-2">
                <button
                  type="button"
                  onClick={() => onChangeWatermark({ position: 'floating' })}
                  className={`flex items-center justify-center gap-1.5 rounded-md border p-2 text-center text-[11px] font-medium transition cursor-pointer ${
                    watermark.position === 'floating'
                      ? 'border-amber-400 bg-amber-500/20 text-amber-300  ring-1 ring-amber-400/40'
                      : 'border-border bg-surface-2 text-text hover:bg-surface-2 hover:text-white'
                  }`}
                >
                  <Waves className="h-3.5 w-3.5 text-amber-400" />
                  <span>Lượn sóng khắp màn</span>
                </button>
                <button
                  type="button"
                  onClick={() => onChangeWatermark({ position: 'bounce' })}
                  className={`flex items-center justify-center gap-1.5 rounded-md border p-2 text-center text-[11px] font-medium transition cursor-pointer ${
                    watermark.position === 'bounce'
                      ? 'border-amber-400 bg-amber-500/20 text-amber-300  ring-1 ring-amber-400/40'
                      : 'border-border bg-surface-2 text-text hover:bg-surface-2 hover:text-white'
                  }`}
                >
                  <Activity className="h-3.5 w-3.5 text-amber-400" />
                  <span>Nảy cạnh DVD</span>
                </button>
              </div>

              {/* Các vị trí cố định */}
              <div className="grid grid-cols-3 gap-1.5">
                {[
                  { id: 'top_left', label: 'Trên Trái' },
                  { id: 'center', label: 'Chính Giữa' },
                  { id: 'top_right', label: 'Trên Phải' },
                  { id: 'bottom_left', label: 'Dưới Trái' },
                  { id: 'bottom_right', label: 'Dưới Phải' },
                ].map((pos) => (
                  <button
                    key={pos.id}
                    type="button"
                    onClick={() => onChangeWatermark({ position: pos.id as any })}
                    className={`rounded-lg border px-2 py-1.5 text-center text-[11px] font-medium transition cursor-pointer ${
                      watermark.position === pos.id
                        ? 'border-accent/40 bg-accent/15 text-accent '
                        : 'border-border bg-surface-2 text-text-muted hover:text-white'
                    }`}
                  >
                    {pos.label}
                  </button>
                ))}
              </div>
            </div>

            {/* Tốc độ di chuyển nếu bật chạy khắp màn hình */}
            {(watermark.position === 'floating' || watermark.position === 'bounce') && (
              <div className="rounded-md border border-amber-500/30 bg-amber-500/5 p-2.5">
                <div className="flex items-center justify-between mb-1.5">
                  <span className="text-[11px] font-medium text-amber-300">Tốc độ chạy:</span>
                  <span className="text-[10px] text-text-muted">
                    {watermark.speed === 'slow' ? 'Chậm êm dịu' : watermark.speed === 'fast' ? 'Nhanh' : 'Tiêu chuẩn'}
                  </span>
                </div>
                <div className="grid grid-cols-3 gap-1.5">
                  {[
                    { id: 'slow', label: 'Chậm' },
                    { id: 'medium', label: 'Vừa' },
                    { id: 'fast', label: 'Nhanh' },
                  ].map((s) => (
                    <button
                      key={s.id}
                      type="button"
                      onClick={() => onChangeWatermark({ speed: s.id as any })}
                      className={`rounded-lg border px-2 py-1 text-center text-[11px] font-medium transition cursor-pointer ${
                        (watermark.speed || 'medium') === s.id
                          ? 'border-amber-400/80 bg-amber-500/20 text-amber-300'
                          : 'border-border bg-surface-2 text-text-muted hover:text-white'
                      }`}
                    >
                      {s.label}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {/* Độ mờ (Opacity) & Tỉ lệ kích thước (Scale) */}
            <div className="grid grid-cols-2 gap-3">
              <div>
                <div className="flex justify-between text-[11px] text-text-muted mb-1">
                  <span>Độ mờ (Opacity):</span>
                  <span className="font-mono text-accent">
                    {Math.round((watermark.opacity ?? 0.8) * 100)}%
                  </span>
                </div>
                <input
                  type="range"
                  min={10}
                  max={100}
                  value={Math.round((watermark.opacity ?? 0.8) * 100)}
                  onChange={(e) => onChangeWatermark({ opacity: Number(e.target.value) / 100 })}
                  className="w-full accent-accent h-1.5 bg-surface-2 rounded-lg cursor-pointer"
                />
              </div>

              <div>
                <div className="flex justify-between text-[11px] text-text-muted mb-1">
                  <span>Kích thước tỉ lệ:</span>
                  <span className="font-mono text-accent">
                    {watermark.scalePercent ?? 18}%
                  </span>
                </div>
                <input
                  type="range"
                  min={5}
                  max={45}
                  value={watermark.scalePercent ?? 18}
                  onChange={(e) => onChangeWatermark({ scalePercent: Number(e.target.value) })}
                  className="w-full accent-accent h-1.5 bg-surface-2 rounded-lg cursor-pointer"
                />
              </div>
            </div>
          </div>
        ) : (
          <p className="text-xs leading-relaxed text-text-muted py-2">
            Bật tính năng này để chèn logo công ty, kênh TikTok, YouTube hoặc watermark bản quyền lên video. Hỗ trợ chế độ chạy lượn khắp màn hình chống cắt crop re-up!
          </p>
        )}
      </div>
    </div>
  );
};
