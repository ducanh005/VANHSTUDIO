import React, { useEffect, useState } from 'react';
import { AlertCircle, CheckCircle2, Cpu, HardDrive, Loader2, Zap } from 'lucide-react';
import { 
  WHISPER_MODELS, 
  type ModelInfo, 
  type SystemInfo,
  recommendModel,
  canRunModel,
  formatBytes,
  formatRAM
} from '../lib/modelSelector';

interface ASRModelSelectorProps {
  currentModel: string;
  onModelChange: (modelName: string) => void;
}

export default function ASRModelSelector({ currentModel, onModelChange }: ASRModelSelectorProps) {
  const [systemInfo, setSystemInfo] = useState<SystemInfo | null>(null);
  const [recommendedModel, setRecommendedModel] = useState<string>('large-v3-turbo');
  const [selectedModel, setSelectedModel] = useState<string>(currentModel);
  const [canRun, setCanRun] = useState<{ canRun: boolean; warnings: string[] } | null>(null);
  const [loadingSystemInfo, setLoadingSystemInfo] = useState(true);

  // Load system info
  useEffect(() => {
    if (typeof window === 'undefined' || !window.vanhsub?.models?.getSystemInfo) return;

    setLoadingSystemInfo(true);
    window.vanhsub.models
      .getSystemInfo()
      .then((info: any) => {
        setSystemInfo(info);
        const recommended = recommendModel(info);
        setRecommendedModel(recommended);
      })
      .catch((err: any) => {
        console.error('Lỗi khi lấy system info:', err);
        setSystemInfo(null);
      })
      .finally(() => {
        setLoadingSystemInfo(false);
      });
  }, []);

  // Kiểm tra model có thể chạy trên máy hiện tại. KHÔNG gọi onModelChange ở
  // đây — trước đây effect gọi onModelChange với onModelChange trong deps,
  // tạo vòng lặp vô hạn: update task → broadcast → re-render → hàm prop mới
  // → effect chạy lại → update task... (ghi đĩa + IPC liên tục)
  useEffect(() => {
    if (!systemInfo) return;
    setCanRun(canRunModel(selectedModel, systemInfo));
  }, [selectedModel, systemInfo]);

  // Theo currentModel prop khi đổi tác vụ / nạp cài đặt (không báo ngược lên
  // parent — chỉ hiển thị)
  useEffect(() => {
    setSelectedModel(currentModel);
  }, [currentModel]);

  if (loadingSystemInfo) {
    return (
      <div className="rounded-lg border border-border bg-surface p-5">
        <div className="flex items-center justify-center gap-2 text-text-muted">
          <Loader2 className="h-4 w-4 animate-spin" />
          <span className="text-xs">Đang lấy thông tin hệ thống...</span>
        </div>
      </div>
    );
  }

  if (!systemInfo) {
    return (
      <div className="rounded-lg border border-rose-500/40 bg-rose-500/10 p-5 text-rose-300 text-xs">
        Không thể lấy thông tin hệ thống. Vui lòng restart app.
      </div>
    );
  }

  const selectedModelInfo = WHISPER_MODELS[selectedModel];
  const ramGB = systemInfo.totalMemory / 1024;
  const freeRAMGB = systemInfo.freeMemory / 1024;

  return (
    <div className="flex flex-col gap-4 rounded-lg border border-border bg-surface p-5">
      {/* Header */}
      <div className="flex items-center gap-2 border-b border-border pb-3 text-sm font-bold text-white">
        <Cpu className="h-4 w-4 text-accent" />
        <span>Whisper ASR Model (Phiên âm giọng nói)</span>
      </div>

      {/* System Info */}
      <div className="grid grid-cols-2 gap-3 rounded-lg border border-border bg-surface p-3">
        <div>
          <div className="text-[10px] uppercase tracking-wider text-text-muted">RAM</div>
          <div className="mt-1 text-xs font-mono text-accent">
            {freeRAMGB.toFixed(1)} GB / {ramGB.toFixed(1)} GB
          </div>
        </div>
        <div>
          <div className="text-[10px] uppercase tracking-wider text-text-muted">CPU</div>
          <div className="mt-1 text-xs font-mono text-accent">
            {systemInfo.cpuCores} cores
          </div>
        </div>
        <div>
          <div className="text-[10px] uppercase tracking-wider text-text-muted">Model</div>
          <div className="mt-1 truncate text-xs font-mono text-text">
            {systemInfo.cpuModel}
          </div>
        </div>
        <div>
          <div className="text-[10px] uppercase tracking-wider text-text-muted">Platform</div>
          <div className="mt-1 text-xs font-mono text-text capitalize">
            {systemInfo.platform}
          </div>
        </div>
      </div>

      {/* Recommendation */}
      <div className="rounded-lg border border-accent/40 bg-accent-tint p-3">
        <div className="mb-1 flex items-start gap-2">
          <Zap className="h-3.5 w-3.5 text-accent mt-0.5 flex-shrink-0" />
          <div className="text-xs">
            <div className="font-semibold text-accent">Khuyến nghị: {WHISPER_MODELS[recommendedModel].displayName}</div>
            <div className="mt-0.5 text-text">
              {WHISPER_MODELS[recommendedModel].useCase}
            </div>
          </div>
        </div>
      </div>

      {/* Model Selection */}
      <div>
        <label className="mb-2 block font-medium text-text text-xs">Chọn Model</label>
        <select
          value={selectedModel}
          onChange={(e) => {
            const next = e.target.value;
            setSelectedModel(next);
            onModelChange(next);
          }}
          className="w-full rounded-md border border-border bg-surface-2 px-3 py-2 text-xs text-white focus:outline-none focus:border-accent/40"
        >
          {Object.entries(WHISPER_MODELS).map(([key, model]) => (
            <option key={key} value={key}>
              {model.displayName} - {model.size}
            </option>
          ))}
        </select>
      </div>

      {/* Model Details */}
      {selectedModelInfo && (
        <div className="grid grid-cols-2 gap-2 rounded-lg border border-border bg-surface p-3">
          <div>
            <div className="text-[10px] uppercase tracking-wider text-text-muted">Kích thước</div>
            <div className="mt-1 text-xs font-medium text-text">{selectedModelInfo.size}</div>
          </div>
          <div>
            <div className="text-[10px] uppercase tracking-wider text-text-muted">Độ chính xác</div>
            <div className="mt-1 text-xs font-medium text-text">{selectedModelInfo.accuracy}</div>
          </div>
          <div>
            <div className="text-[10px] uppercase tracking-wider text-text-muted">Tốc độ (CPU)</div>
            <div className="mt-1 text-xs font-medium text-text">{selectedModelInfo.speedCPU}</div>
          </div>
          <div>
            <div className="text-[10px] uppercase tracking-wider text-text-muted">RAM yêu cầu</div>
            <div className="mt-1 text-xs font-medium text-text">
              {formatRAM(selectedModelInfo.ramRequired)}
            </div>
          </div>
        </div>
      )}

      {/* Warnings */}
      {canRun && canRun.warnings.length > 0 && (
        <div className="rounded-lg border border-rose-500/40 bg-rose-500/10 p-3">
          {canRun.warnings.map((warning, i) => (
            <div key={i} className="mb-1 flex items-start gap-2 text-xs text-rose-300 last:mb-0">
              <AlertCircle className="h-3.5 w-3.5 mt-0.5 flex-shrink-0" />
              <span>{warning}</span>
            </div>
          ))}
        </div>
      )}

      {/* Success */}
      {canRun && canRun.canRun && (
        <div className="flex items-start gap-2 rounded-lg border border-emerald-500/40 bg-emerald-500/10 p-3">
          <CheckCircle2 className="h-3.5 w-3.5 text-emerald-400 mt-0.5 flex-shrink-0" />
          <span className="text-xs text-emerald-300">
            ✓ Máy của bạn đủ resource để chạy model này.
          </span>
        </div>
      )}

      {/* Info */}
      <div className="rounded-lg border border-border bg-surface p-3">
        <div className="text-[11px] text-text-muted space-y-1">
          <p>
            <strong>Lần đầu:</strong> Download model (~{selectedModelInfo?.size || '140 MB'}) khi chạy transcription đầu tiên
          </p>
          <p>
            <strong>Sau đó:</strong> Model được cache, transcription sẽ nhanh hơn
          </p>
          <p>
            <strong>Offline:</strong> Tất cả model hoạt động offline, không cần internet
          </p>
        </div>
      </div>
    </div>
  );
}
