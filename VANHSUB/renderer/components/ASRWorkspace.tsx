import React, { useEffect, useMemo, useState } from 'react';
import {
  AudioLines,
  Copy,
  FileUp,
  FolderOpen,
  Loader2,
  Play,
  RefreshCw,
  ScanText,
  Sparkles,
  Square,
  Cpu,
  Users,
  Zap,
  ChevronDown,
  ChevronUp,
  Sliders,
} from 'lucide-react';
import type { Task, TaskStatus } from '../types/task';
import type { OcrStartOptions } from '../types/electron';
import { parseSrt } from '../lib/srt';

import OcrConfigModal, { type OcrModalStartPayload } from './OcrConfigModal';

/**
 * Workspace dành riêng cho giai đoạn Phụ đề & ASR:
 * - Phiên âm / phiên âm lại từng tác vụ với model Whisper tuỳ chọn
 * - Quét phụ đề cứng (hardsub) bằng OCR cho video
 * - Nhập file .srt có sẵn (bỏ qua phiên âm)
 * - Xem nhanh + copy phụ đề đã tạo
 */

const STATUS_STYLE: Record<TaskStatus, { label: string; cls: string }> = {
  queued: { label: 'Chờ xử lý', cls: 'border-border bg-surface-2 text-text-muted' },
  transcribing: { label: 'Đang phiên âm', cls: 'border-accent/40 bg-accent-tint text-accent' },
  ocr: { label: 'Đang quét OCR', cls: 'border-accent/40 bg-accent-tint text-accent' },
  translating: { label: 'Đang dịch', cls: 'border-accent/40 bg-accent-tint text-accent' },
  exporting: { label: 'Đang xuất', cls: 'border-accent/40 bg-accent-tint text-accent' },
  dubbing: { label: 'Đang lồng tiếng', cls: 'border-accent/40 bg-accent-tint text-accent' },
  done: { label: 'Hoàn tất', cls: 'border-emerald-500/30 bg-emerald-500/10 text-emerald-400' },
  error: { label: 'Lỗi', cls: 'border-rose-500/30 bg-rose-500/10 text-rose-400' },
  cancelled: { label: 'Đã huỷ', cls: 'border-amber-500/30 bg-amber-500/10 text-amber-400' },
};

const AUDIO_EXTENSIONS = ['mp3', 'wav', 'm4a', 'flac', 'aac', 'ogg', 'opus', 'wma'];

function isAudioFile(filePath: string): boolean {
  const ext = filePath.split('.').pop()?.toLowerCase() || '';
  return AUDIO_EXTENSIONS.includes(ext);
}

type ASRWorkspaceProps = {
  tasks: Task[];
  selectedTaskId?: string | null;
  onSelectTaskId?: (id: string | null) => void;
};

export default function ASRWorkspace({ tasks, selectedTaskId: propSelectedTaskId, onSelectTaskId }: ASRWorkspaceProps) {
  const [internalTaskId, setInternalTaskId] = useState<string | null>(null);
  const selectedTaskId = propSelectedTaskId !== undefined ? propSelectedTaskId : internalTaskId;
  const setSelectedTaskId = (id: string | null) => {
    if (onSelectTaskId) onSelectTaskId(id);
    else setInternalTaskId(id);
  };
  const [model, setModel] = useState('large-v3-turbo');
  const [asrEngine, setAsrEngine] = useState<'faster-whisper' | 'whisper-cpp'>('faster-whisper');
  const [enableDiarization, setEnableDiarization] = useState(false);
  const [speakerCount, setSpeakerCount] = useState<number>(2);
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [fwStatus, setFwStatus] = useState<{ available: boolean; useCuda: boolean; reason?: string } | null>(null);
  const [srtContent, setSrtContent] = useState<string | null>(null);
  const [overlaySrtContent, setOverlaySrtContent] = useState<string | null>(null);
  const [previewTrack, setPreviewTrack] = useState<'primary' | 'overlay'>('primary');
  const [starting, setStarting] = useState(false);
  const [loadingConfig, setLoadingConfig] = useState(false);
  const [message, setMessage] = useState('');
  const [isError, setIsError] = useState(false);
  const [isOcrModalOpen, setIsOcrModalOpen] = useState(false);
  const [modalLaunchPurpose, setModalLaunchPurpose] = useState<'ocr' | 'hybrid'>('ocr');

  const selectedTask = tasks.find((t) => t.id === selectedTaskId) || null;
  const isTranscribing = selectedTask?.status === 'transcribing';
  const isOcrRunning = selectedTask?.status === 'ocr';
  const isHybridRunning =
    (selectedTask?.status as string) === 'hybrid' ||
    Boolean(selectedTask?.stageDescription?.includes('[Hybrid]') && (isTranscribing || isOcrRunning));
  const isBusy = isTranscribing || isOcrRunning || isHybridRunning || starting || loadingConfig ||
    ['translating', 'dubbing', 'exporting'].includes(selectedTask?.status || '');
  const isAudio = selectedTask ? isAudioFile(selectedTask.filePath) : false;
  const hasSrt = !!(selectedTask?.srtPath || selectedTask?.overlaySrtPath);
  const hasOverlaySrt = !!selectedTask?.overlaySrtPath;

  // Thăm dò khả dụng Faster-Whisper & CUDA khi nạp component
  useEffect(() => {
    if (typeof window !== 'undefined' && window.vanhsub?.asr?.checkFasterWhisper) {
      window.vanhsub.asr.checkFasterWhisper().then(setFwStatus).catch(() => {});
    }
  }, []);

  // Mặc định chọn task đầu tiên hoặc fallback nếu task hiện tại bị xoá
  useEffect(() => {
    if (tasks.length === 0) {
      if (selectedTaskId !== null) setSelectedTaskId(null);
      return;
    }
    const exists = tasks.some((t) => t.id === selectedTaskId);
    if (!exists) {
      setSelectedTaskId(tasks[0].id);
    }
  }, [tasks, selectedTaskId]);

  // Đồng bộ model, engine và diarization khi đổi tác vụ
  useEffect(() => {
    let cancelled = false;
    setLoadingConfig(false);
    if (selectedTask) {
      setModel(selectedTask.asrModel || 'large-v3-turbo');
      setAsrEngine(selectedTask.asrEngine || 'faster-whisper');
      setEnableDiarization(Boolean(selectedTask.enableDiarization));
      setSpeakerCount(selectedTask.speakerCount || 2);
      if ((!selectedTask.asrModel || !selectedTask.asrEngine || selectedTask.enableDiarization === undefined) && window.vanhsub?.settings) {
        setLoadingConfig(true);
        Promise.all((['asrModel', 'asrEngine', 'enableDiarization'] as const).map((key) => window.vanhsub.settings.get(key)))
          .then(([defaultModel, defaultEngine, defaultDiarization]) => {
            if (cancelled) return;
            setModel(selectedTask.asrModel || defaultModel || 'large-v3-turbo');
            setAsrEngine(selectedTask.asrEngine || defaultEngine || 'faster-whisper');
            setEnableDiarization(selectedTask.enableDiarization ?? Boolean(defaultDiarization));
          }).catch(() => {}).finally(() => { if (!cancelled) setLoadingConfig(false); });
      }
    }
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedTask?.id]);

  // Tải nội dung phụ đề (cả thoại chính và file overlay nếu có) khi đổi task / hoàn tất
  useEffect(() => {
    const srtPath = selectedTask?.srtPath;
    const ovPath = selectedTask?.overlaySrtPath;
    if (typeof window === 'undefined' || !window.vanhsub?.tasks?.readSrt) {
      setSrtContent(null);
      setOverlaySrtContent(null);
      return;
    }
    let cancelled = false;
    if (srtPath) {
      window.vanhsub.tasks
        .readSrt(srtPath)
        .then((content) => {
          if (!cancelled) setSrtContent(content);
        })
        .catch(() => {
          if (!cancelled) setSrtContent(null);
        });
    } else {
      setSrtContent(null);
    }

    if (ovPath) {
      window.vanhsub.tasks
        .readSrt(ovPath)
        .then((content) => {
          if (!cancelled) setOverlaySrtContent(content);
        })
        .catch(() => {
          if (!cancelled) setOverlaySrtContent(null);
        });
    } else {
      setOverlaySrtContent(null);
      setPreviewTrack('primary');
    }
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedTask?.srtPath, selectedTask?.overlaySrtPath, selectedTask?.status, selectedTask?.updatedAt]);

  const lineCount = useMemo(() => (srtContent ? parseSrt(srtContent).length : 0), [srtContent]);
  const overlayLineCount = useMemo(
    () => (overlaySrtContent ? parseSrt(overlaySrtContent).length : 0),
    [overlaySrtContent],
  );
  const displayedQuickPreview =
    previewTrack === 'overlay' || (!selectedTask?.srtPath && overlaySrtContent)
      ? overlaySrtContent
      : srtContent;

  const handleModelChange = (m: string) => {
    setModel(m);
    if (selectedTask && typeof window !== 'undefined' && window.vanhsub?.tasks?.update) {
      window.vanhsub.tasks.update(selectedTask.id, { asrModel: m }).catch(() => {});
    }
  };

  const handleEngineChange = (engine: 'faster-whisper' | 'whisper-cpp') => {
    setAsrEngine(engine);
    if (selectedTask && typeof window !== 'undefined' && window.vanhsub?.tasks?.update) {
      window.vanhsub.tasks.update(selectedTask.id, { asrEngine: engine }).catch(() => {});
    }
  };

  const handleDiarizationToggle = (enabled: boolean) => {
    setEnableDiarization(enabled);
    if (selectedTask && typeof window !== 'undefined' && window.vanhsub?.tasks?.update) {
      window.vanhsub.tasks.update(selectedTask.id, { enableDiarization: enabled }).catch(() => {});
    }
  };

  const handleSpeakerCountChange = (count: number) => {
    setSpeakerCount(count);
    if (selectedTask && typeof window !== 'undefined' && window.vanhsub?.tasks?.update) {
      window.vanhsub.tasks.update(selectedTask.id, { speakerCount: count }).catch(() => {});
    }
  };

  const handleStart = async (force: boolean) => {
    if (!selectedTask || isBusy) return;
    if (
      force &&
      !window.confirm('Phiên âm lại sẽ GHI ĐÈ phụ đề hiện có của tác vụ này. Tiếp tục?')
    ) {
      return;
    }
    setStarting(true);
    setMessage('');
    setIsError(false);
    try {
      await window.vanhsub.tasks.update(selectedTask.id, {
        asrModel: model,
        asrEngine,
        enableDiarization,
        speakerCount: enableDiarization ? speakerCount : undefined,
      });
      await window.vanhsub.tasks.start(selectedTask.id);
      setMessage('Đã bắt đầu phiên âm — theo dõi tiến trình bên dưới và ở Trang chủ.');
    } catch (err: any) {
      setIsError(true);
      setMessage(err?.message || String(err));
    } finally {
      setStarting(false);
    }
  };

  // Mở modal cấu hình OCR cho video
  const handleStartOcr = () => {
    if (!selectedTask || isBusy || isAudio) return;
    if (
      hasSrt &&
      !window.confirm(
        'Tác vụ đã có phụ đề. Quét OCR sẽ tạo file .srt mới và trỏ tác vụ sang file đó (file cũ vẫn giữ trên đĩa). Tiếp tục?'
      )
    ) {
      return;
    }
    setModalLaunchPurpose('ocr');
    setIsOcrModalOpen(true);
  };

  // Thực thi OCR hoặc Hybrid với cấu hình từ modal dùng chung
  const handleExecuteOcrModal = async (options: OcrModalStartPayload) => {
    if (!selectedTask) return;
    setMessage('');
    setIsError(false);
    if (modalLaunchPurpose === 'hybrid') {
      setStarting(true);
      setMessage('Đang khởi chạy Kết hợp Whisper + OCR (Độ chính xác tuyệt đối)...');
      try {
        if (!window.vanhsub?.tasks?.startHybrid) {
          throw new Error('Chức năng startHybrid chưa sẵn sàng trên hệ thống.');
        }
        await window.vanhsub.tasks.startHybrid(selectedTask.id, {
          asrModel: model,
          ocrMode: options.mode,
          ocrFps: options.fps,
          ocrLanguage: options.language,
          ocrCustomRegion: options.customRegion,
          ocrDualRegions: options.dualRegions,
          dualEngine: options.dualEngine,
          useGeminiAi: options.useGeminiAi,
        });
        const modeLabel = options.mode ? options.mode.toUpperCase() : 'AUTO';
        setMessage(
          `Đang chạy Kết hợp Whisper + OCR (${modeLabel}${options.useGeminiAi ? ' + Gemini AI' : ''})...`,
        );
      } catch (err: any) {
        setIsError(true);
        setMessage(err?.message || String(err));
      } finally {
        setStarting(false);
      }
      return;
    }

    try {
      await window.vanhsub.ocr.start(selectedTask.id, options);
      const modeLabel = options.mode ? options.mode.toUpperCase() : 'AUTO';
      setMessage(`Đã bắt đầu quét OCR (chế độ ${modeLabel}) — theo dõi tiến trình ở Trang chủ.`);
    } catch (err: any) {
      setIsError(true);
      setMessage(err?.message || String(err));
    }
  };

  // Huỷ phiên âm đang chạy — dừng giữa các chunk audio
  const handleCancelTranscribe = async () => {
    if (!selectedTask || !isTranscribing) return;
    try {
      await window.vanhsub.tasks.cancel(selectedTask.id);
      setMessage('Đã gửi yêu cầu huỷ phiên âm — dừng sau chunk hiện tại.');
    } catch (err: any) {
      setIsError(true);
      setMessage(err?.message || String(err));
    }
  };

  const handleCancelOcr = async () => {
    if (!selectedTask || !isOcrRunning) return;
    try {
      await window.vanhsub.ocr.cancel(selectedTask.id);
      setMessage('Đã gửi yêu cầu huỷ quét OCR — dừng sau khung hình hiện tại.');
    } catch (err: any) {
      setIsError(true);
      setMessage(err?.message || String(err));
    }
  };

  const handleStartHybrid = () => {
    if (!selectedTask || isBusy) return;
    if (isAudio) {
      setIsError(true);
      setMessage('Chế độ Kết hợp Whisper + OCR chỉ hỗ trợ file video (cần hình ảnh để quét chữ).');
      return;
    }
    if (
      hasSrt &&
      !window.confirm(
        'Tác vụ đã có phụ đề. Kết hợp Whisper + OCR sẽ tạo file .srt mới và trỏ tác vụ sang file đó. Tiếp tục?'
      )
    ) {
      return;
    }
    setModalLaunchPurpose('hybrid');
    setIsOcrModalOpen(true);
  };

  const handleCancelHybrid = async () => {
    if (!selectedTask || !isHybridRunning) return;
    try {
      if (window.vanhsub?.tasks?.cancelHybrid) {
        await window.vanhsub.tasks.cancelHybrid(selectedTask.id);
      }
      setMessage('Đã gửi yêu cầu huỷ tác vụ kết hợp Whisper + OCR.');
    } catch (err: any) {
      setIsError(true);
      setMessage(err?.message || String(err));
    }
  };

  const handleImportSrt = async () => {
    if (!selectedTask) return;
    if (typeof window === 'undefined' || !window.vanhsub?.dialog?.openSrtFile) return;
    try {
      const srtPath = await window.vanhsub.dialog.openSrtFile();
      if (!srtPath) return;
      await window.vanhsub.tasks.importSrt(selectedTask.id, srtPath);
      setMessage('Đã nhập file phụ đề .srt — có thể dịch hoặc tạo lồng tiếng luôn.');
    } catch (err: any) {
      setIsError(true);
      setMessage(err?.message || 'Không thể nhập file SRT.');
    }
  };

  const handleCopy = async () => {
    if (!srtContent) return;
    try {
      await navigator.clipboard.writeText(srtContent);
      setMessage('Đã copy toàn bộ phụ đề vào clipboard.');
    } catch {
      setIsError(true);
      setMessage('Không copy được phụ đề.');
    }
  };

  const handleOpenFolder = async () => {
    if (!selectedTask) return;
    try {
      await window.vanhsub.dialog.showInFolder(selectedTask.srtPath || selectedTask.filePath);
    } catch {
      // bỏ qua
    }
  };

  return (
    <div className="flex flex-1 flex-col gap-4 overflow-hidden p-6">
      {/* Thanh tiêu đề */}
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-border bg-surface p-4">
        <div className="flex items-center gap-2 text-xs font-semibold text-text">
          <AudioLines className="h-4 w-4 text-accent" />
          <span>Phiên âm & Quản lý phụ đề</span>
          {selectedTask && (
            <span className="ml-2 max-w-[280px] truncate text-text-muted" title={selectedTask.fileName}>
              {selectedTask.fileName}
            </span>
          )}
        </div>
        {message && (
          <span
            className={`max-w-[420px] truncate text-xs font-mono ${isError ? 'text-rose-400' : 'text-accent'}`}
            title={message}
          >
            {message}
          </span>
        )}
      </div>

      <div className="grid min-h-0 flex-1 grid-cols-[300px_minmax(0,1fr)] gap-4 overflow-hidden">
        {/* Danh sách tác vụ */}
        <div className="flex min-h-0 flex-col overflow-hidden rounded-lg border border-border bg-surface">
          <div className="border-b border-border px-4 py-2.5 text-xs font-semibold text-text">
            Tác vụ ({tasks.length})
          </div>
          <div className="flex-1 space-y-1.5 overflow-y-auto p-2.5">
            {tasks.length === 0 && (
              <p className="py-6 text-center text-xs text-text-muted">
                Chưa có tác vụ — thêm video ở Trang chủ.
              </p>
            )}
            {tasks.map((t) => {
              const isTaskHybrid =
                (t.status as string) === 'hybrid' ||
                Boolean(t.stageDescription?.includes('[Hybrid]') && (t.status === 'transcribing' || t.status === 'ocr'));
              const st = isTaskHybrid
                ? { label: 'Đang kết hợp', cls: 'border-accent/40 bg-accent-tint text-accent' }
                : STATUS_STYLE[t.status] || { label: t.status, cls: 'border-border bg-surface-2 text-text-muted' };
              return (
                <button
                  key={t.id}
                  type="button"
                  onClick={() => setSelectedTaskId(t.id)}
                  className={[
                    'w-full rounded-md border p-2.5 text-left text-xs transition cursor-pointer',
                    t.id === selectedTaskId
                      ? 'border-accent/40 bg-accent/5'
                      : 'border-border bg-surface hover:bg-surface',
                  ].join(' ')}
                >
                  <p className="truncate font-medium text-text" title={t.fileName}>
                    {t.fileName}
                  </p>
                  <div className="mt-1.5 flex items-center gap-1.5">
                    <span
                      className={`rounded-full border px-2 py-0.5 text-[10px] font-medium ${st.cls}`}
                    >
                      {st.label}
                    </span>
                    <span className="rounded bg-surface-2 px-1.5 py-0.5 font-mono text-[10px] text-text-muted">
                      {t.asrModel || 'base'}
                    </span>
                    {t.srtPath && (
                      <span className="font-mono text-[10px] text-emerald-500">✓ SRT</span>
                    )}
                  </div>
                </button>
              );
            })}
          </div>
        </div>

        {/* Chi tiết tác vụ */}
        <div className="flex min-h-0 flex-col gap-4 overflow-y-auto rounded-lg border border-border bg-surface p-4">
          {!selectedTask ? (
            <div className="flex flex-1 items-center justify-center text-xs text-text-muted">
              Chọn một tác vụ để phiên âm hoặc xem phụ đề.
            </div>
          ) : (
            <>
              {/* Hành động */}
              <div className="flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  onClick={() => handleStart(hasSrt)}
                  disabled={isBusy}
                  className="bg-accent text-white hover:bg-accent-hover inline-flex items-center gap-2 rounded-md px-4 py-2 text-xs font-semibold cursor-pointer disabled:opacity-50"
                >
                  {isTranscribing ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : hasSrt ? (
                    <RefreshCw className="h-4 w-4" />
                  ) : (
                    <Play className="h-4 w-4" />
                  )}
                  <span>
                    {isTranscribing
                      ? 'Đang phiên âm...'
                      : hasSrt
                        ? 'Phiên âm lại'
                        : 'Bắt đầu phiên âm'}
                  </span>
                </button>
                {isTranscribing && (
                  <button
                    type="button"
                    onClick={handleCancelTranscribe}
                    className="inline-flex items-center gap-2 rounded-md border border-amber-500/40 bg-amber-500/10 px-3.5 py-2 text-xs font-medium text-amber-400 hover:bg-amber-500/20 cursor-pointer"
                  >
                    <Square className="h-3 w-3 fill-amber-400" />
                    <span>Huỷ phiên âm</span>
                  </button>
                )}
                {isAudio ? (
                  <button
                    type="button"
                    disabled
                    title="OCR chỉ hỗ trợ file video có phụ đề ghẽ trong khung hình"
                    className="inline-flex items-center gap-2 rounded-md border border-border bg-surface px-3.5 py-2 text-xs font-medium text-text-muted disabled:opacity-60"
                  >
                    <ScanText className="h-3.5 w-3.5" />
                    <span>Quét OCR</span>
                  </button>
                ) : isOcrRunning ? (
                  <button
                    type="button"
                    onClick={handleCancelOcr}
                    className="inline-flex items-center gap-2 rounded-md border border-amber-500/40 bg-amber-500/10 px-3.5 py-2 text-xs font-medium text-amber-400 hover:bg-amber-500/20 cursor-pointer"
                  >
                    <Square className="h-3 w-3 fill-amber-400" />
                    <span>Huỷ quét OCR</span>
                  </button>
                ) : (
                  <button
                    type="button"
                    onClick={handleStartOcr}
                    disabled={isBusy}
                    title="Video có phụ đề ghẽ sẵn trong khung hình? Quét bằng OCR để tạo phụ đề — không cần phiên âm"
                    className="inline-flex items-center gap-2 rounded-md border border-accent/40 bg-accent-tint px-3.5 py-2 text-xs font-semibold text-accent hover:bg-accent-tint cursor-pointer disabled:opacity-50"
                  >
                    <ScanText className="h-3.5 w-3.5" />
                    <span>Quét OCR</span>
                  </button>
                )}
                {/* Nút Kết hợp Whisper + OCR (R2 - Độ chính xác tuyệt đối) */}
                {isAudio ? (
                  <button
                    type="button"
                    disabled
                    title="Chế độ Kết hợp Whisper + OCR yêu cầu file video (cần hình ảnh để quét chữ)"
                    className="inline-flex items-center gap-2 rounded-md border border-border bg-surface px-3.5 py-2 text-xs font-medium text-text-muted disabled:opacity-60"
                  >
                    <Sparkles className="h-3.5 w-3.5" />
                    <span>Kết hợp Whisper + OCR</span>
                  </button>
                ) : isHybridRunning ? (
                  <button
                    type="button"
                    onClick={handleCancelHybrid}
                    className="inline-flex items-center gap-2 rounded-md border border-amber-500/40 bg-amber-500/10 px-3.5 py-2 text-xs font-medium text-amber-400 hover:bg-amber-500/20 cursor-pointer"
                  >
                    <Square className="h-3 w-3 fill-amber-400" />
                    <span>Huỷ kết hợp</span>
                  </button>
                ) : (
                  <button
                    type="button"
                    onClick={handleStartHybrid}
                    disabled={isBusy}
                    title="Chạy đồng thời Whisper ASR và Quét OCR: Neo mốc thời gian theo khung hình video và dùng giọng nói để sửa lỗi chữ"
                    className="inline-flex items-center gap-2 rounded-md border border-accent/40 bg-accent-tint px-3.5 py-2 text-xs font-semibold text-accent hover:bg-accent/20 cursor-pointer disabled:opacity-50"
                  >
                    <Sparkles className="h-3.5 w-3.5 text-accent" />
                    <span>Kết hợp Whisper + OCR</span>
                  </button>
                )}
                <button
                  type="button"
                  onClick={handleImportSrt}
                  disabled={isBusy}
                  title="Video đã có sẵn phụ đề .srt? Nhập vào để bỏ qua phiên âm"
                  className="inline-flex items-center gap-2 rounded-md border border-border bg-surface-2 px-3.5 py-2 text-xs font-medium text-text hover:bg-surface-3 cursor-pointer disabled:opacity-50"
                >
                  <FileUp className="h-3.5 w-3.5" />
                  <span>Nhập SRT</span>
                </button>
                {hasSrt && (
                  <>
                    <button
                      type="button"
                      onClick={handleCopy}
                      className="inline-flex items-center gap-2 rounded-md border border-border bg-surface-2 px-3.5 py-2 text-xs font-medium text-text hover:bg-surface-3 cursor-pointer"
                    >
                      <Copy className="h-3.5 w-3.5" />
                      <span>Copy phụ đề</span>
                    </button>
                    <button
                      type="button"
                      onClick={handleOpenFolder}
                      className="inline-flex items-center gap-2 rounded-md border border-border bg-surface-2 px-3.5 py-2 text-xs font-medium text-text hover:bg-surface-3 cursor-pointer"
                    >
                      <FolderOpen className="h-3.5 w-3.5" />
                      <span>Mở thư mục</span>
                    </button>
                  </>
                )}
              </div>

              {/* Hiển thị tiến trình chi tiết khi tác vụ đang chạy */}
              {selectedTask && isBusy && (
                <div className="flex flex-col gap-1.5 rounded-md border border-border bg-bg p-3 text-xs">
                  <div className="flex items-center justify-between text-text">
                    <div className="flex items-center gap-2">
                      <Loader2 className="h-3.5 w-3.5 animate-spin text-accent" />
                      <span className="font-medium">{selectedTask.stageDescription || 'Đang xử lý tác vụ...'}</span>
                    </div>
                    <span className="font-mono text-[11px] text-accent">{selectedTask.progress || 0}%</span>
                  </div>
                  <div className="h-1.5 w-full overflow-hidden rounded-full bg-surface-2">
                    <div
                      className="h-full bg-accent-tint transition-all duration-300"
                      style={{ width: `${selectedTask.progress || 0}%` }}
                    />
                  </div>
                </div>
              )}

              {/* Cấu hình Nhận diện Giọng nói Hợp nhất (Unified ASR Control Bar) */}
              <div className="rounded-lg border border-border bg-surface p-3.5 space-y-3">
                {/* Header: Tiêu đề + Trạng thái GPU + Nút bật/tắt Nâng cao */}
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <Zap className="h-4 w-4 text-accent" />
                    <span className="text-xs font-semibold text-white">Cấu hình nhận diện giọng nói</span>
                    <span className="text-[10px] text-text-muted hidden sm:inline">• Whisper ASR</span>
                  </div>

                  <div className="flex items-center gap-2">
                    {/* Badge trạng thái phần cứng */}
                    {asrEngine === 'faster-whisper' ? (
                      <span
                        className={`inline-flex items-center gap-1 text-[10px] px-2 py-0.5 rounded-full border font-mono ${
                          fwStatus?.available
                            ? fwStatus.useCuda
                              ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-400'
                              : 'border-blue-500/30 bg-blue-500/10 text-blue-400'
                            : 'border-amber-500/30 bg-amber-500/10 text-amber-400'
                        }`}
                        title={fwStatus?.reason || 'Faster-Whisper Engine'}
                      >
                        {fwStatus?.useCuda ? <Zap className="h-2.5 w-2.5" /> : <Cpu className="h-2.5 w-2.5" />}
                        {fwStatus?.available
                          ? fwStatus.useCuda
                            ? 'CUDA GPU (RTX 3050)'
                            : 'CPU int8'
                          : 'Tự fallback whisper.cpp'}
                      </span>
                    ) : (
                      <span className="inline-flex items-center gap-1 text-[10px] px-2 py-0.5 rounded-full border border-surface-3 bg-surface-2 text-text-muted font-mono">
                        <Cpu className="h-2.5 w-2.5" />
                        Native C++
                      </span>
                    )}

                    {/* Nút bật/tắt mục nâng cao */}
                    <button
                      type="button"
                      onClick={() => setShowAdvanced(!showAdvanced)}
                      className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[11px] font-medium transition cursor-pointer border ${
                        showAdvanced
                          ? 'border-accent/40 bg-accent-tint text-accent'
                          : 'border-border bg-surface-2 text-text-muted hover:text-white'
                      }`}
                      title="Tuỳ chỉnh sâu: Đổi Engine, xem thông số kỹ thuật"
                    >
                      <Sliders className="h-3 w-3" />
                      <span>Nâng cao</span>
                      {showAdvanced ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
                    </button>
                  </div>
                </div>

                {/* Dòng điều khiển chính: Chọn Model & Tách người nói (1 hàng duy nhất) */}
                <div className="grid grid-cols-1 md:grid-cols-12 gap-2.5 items-center">
                  <div className="md:col-span-7 flex items-center gap-2">
                    <label className="text-[11px] text-text-muted shrink-0 font-medium">Model:</label>
                    <select
                      value={model}
                      onChange={(e) => handleModelChange(e.target.value)}
                      className="w-full rounded-md border border-border bg-surface-2 px-2.5 py-1.5 text-xs font-medium text-white focus:outline-none focus:border-accent/40 cursor-pointer"
                    >
                      <option value="large-v3-turbo">⭐ Large Turbo (Chuẩn nhất & Khuyên dùng — 1.6 GB)</option>
                      <option value="medium">Medium (Tiếng Việt phong phú — 1.5 GB)</option>
                      <option value="small">Small (Chất lượng khá — 461 MB)</option>
                      <option value="base">Base (Cân bằng & Nhẹ — 140 MB)</option>
                      <option value="tiny">Tiny (Siêu nhanh / Máy yếu — 39 MB)</option>
                    </select>
                  </div>

                  <div className="md:col-span-5 flex items-center justify-between md:justify-end gap-2 bg-surface-2/60 rounded-md border border-border/60 px-2.5 py-1">
                    <label className="flex items-center gap-1.5 cursor-pointer select-none">
                      <input
                        type="checkbox"
                        checked={enableDiarization}
                        onChange={(e) => handleDiarizationToggle(e.target.checked)}
                        className="h-3.5 w-3.5 rounded border-border bg-surface-2 text-accent focus:ring-accent/30"
                      />
                      <div className="flex items-center gap-1 text-[11px] text-text">
                        <Users className="h-3 w-3 text-accent" />
                        <span>Tách người nói</span>
                      </div>
                    </label>

                    {enableDiarization && (
                      <div className="flex items-center gap-1.5 pl-2 border-l border-border/80">
                        <span className="text-[10px] text-text-muted">Số người:</span>
                        <input
                          type="number"
                          min={1}
                          max={10}
                          value={speakerCount}
                          onChange={(e) => handleSpeakerCountChange(Math.max(1, parseInt(e.target.value) || 2))}
                          className="w-10 rounded border border-border bg-bg px-1 py-0.5 text-center font-mono text-[11px] text-white focus:border-accent/40 focus:outline-none"
                        />
                      </div>
                    )}
                  </div>
                </div>

                {/* Panel Nâng cao: Thu gọn mặc định, mở ra khi người dùng cần tuỳ biến Engine */}
                {showAdvanced && (
                  <div className="pt-2.5 border-t border-border/60 space-y-2 text-xs">
                    <div className="text-[11px] font-medium text-text-muted">Động cơ nhận diện (ASR Engine):</div>
                    <div className="grid grid-cols-2 gap-2">
                      <button
                        type="button"
                        onClick={() => handleEngineChange('faster-whisper')}
                        className={`flex flex-col text-left p-2 rounded-md border transition cursor-pointer ${
                          asrEngine === 'faster-whisper'
                            ? 'border-accent/40 bg-accent-tint text-white'
                            : 'border-border bg-bg text-text-muted hover:border-border'
                        }`}
                      >
                        <div className="flex items-center justify-between">
                          <span className="font-medium text-xs text-accent">Faster-Whisper (Mặc định)</span>
                          <span className="text-[9px] px-1 py-0.2 rounded bg-accent-tint text-accent font-mono">Nhanh 3-4x</span>
                        </div>
                        <p className="mt-0.5 text-[10px] text-text-muted leading-tight">
                          CTranslate2, GPU CUDA, timestamps theo từ, tách người nói. Tự động fallback nếu lỗi.
                        </p>
                      </button>

                      <button
                        type="button"
                        onClick={() => handleEngineChange('whisper-cpp')}
                        className={`flex flex-col text-left p-2 rounded-md border transition cursor-pointer ${
                          asrEngine === 'whisper-cpp'
                            ? 'border-accent/40 bg-accent-tint text-white'
                            : 'border-border bg-bg text-text-muted hover:border-border'
                        }`}
                      >
                        <div className="flex items-center justify-between">
                          <span className="font-medium text-xs text-white">Whisper.cpp</span>
                          <span className="text-[9px] px-1 py-0.2 rounded bg-surface-2 text-text-muted font-mono">Native C++</span>
                        </div>
                        <p className="mt-0.5 text-[10px] text-text-muted leading-tight">
                          Chạy binary C++ độc lập không cần Python. Độ ổn định cao, dự phòng khi Python lỗi.
                        </p>
                      </button>
                    </div>

                    <div className="flex items-center justify-between text-[10px] text-text-muted pt-0.5">
                      <span>💡 Gợi ý: Giữ Faster-Whisper + Large Turbo để đạt chất lượng phiên âm cao nhất.</span>
                    </div>
                  </div>
                )}
              </div>

              {/* Xem nhanh phụ đề */}
              <div className="flex min-h-[200px] flex-1 flex-col overflow-hidden rounded-lg border border-border bg-surface">
                <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border px-4 py-2.5 text-xs font-semibold text-text">
                  <div className="flex items-center gap-2">
                    <span>
                      Phụ đề{' '}
                      {selectedTask?.srtPath && (
                        <span className="font-mono text-[11px] text-text-muted">({lineCount} dòng thoại)</span>
                      )}
                      {hasOverlaySrt && (
                        <span className="ml-1.5 font-mono text-[11px] text-amber-300">
                          + {overlayLineCount} dòng bảng/thông tin
                        </span>
                      )}
                    </span>
                    {hasOverlaySrt && (
                      <div className="ml-2 flex overflow-hidden rounded border border-border bg-bg">
                        <button
                          type="button"
                          onClick={() => setPreviewTrack('primary')}
                          className={`px-2 py-0.5 text-[10px] font-medium cursor-pointer ${
                            previewTrack === 'primary' ? 'bg-accent-tint text-accent font-semibold' : 'text-text-muted hover:text-white'
                          }`}
                        >
                          Thoại chính
                        </button>
                        <button
                          type="button"
                          onClick={() => setPreviewTrack('overlay')}
                          className={`border-l border-border px-2 py-0.5 text-[10px] font-medium cursor-pointer ${
                            previewTrack === 'overlay' ? 'bg-amber-500/20 text-amber-300 font-semibold' : 'text-text-muted hover:text-white'
                          }`}
                        >
                          Bảng/Overlay
                        </button>
                      </div>
                    )}
                  </div>
                  {selectedTask?.speakers && selectedTask.speakers.length > 0 && (
                    <div className="flex items-center gap-1.5 text-[11px] font-normal text-accent">
                      <Users className="h-3.5 w-3.5" />
                      <span>{selectedTask.speakers.length} người nói ({selectedTask.speakers.join(', ')})</span>
                    </div>
                  )}
                </div>
                {selectedTask?.ocrStats && (
                  <div className="flex flex-wrap items-center gap-2 border-b border-border bg-bg px-4 py-1.5 text-[11px] text-text">
                    <Sparkles className="h-3.5 w-3.5 text-accent" />
                    <span>OCR detected: <strong className="text-white">{selectedTask.ocrStats.finalEvents}</strong> events</span>
                    <span className="text-text-faint">•</span>
                    <span>High conf: <strong className="text-emerald-400">{selectedTask.ocrStats.highConfidence}</strong></span>
                    <span className="text-text-faint">•</span>
                    <span>Review: <strong className="text-amber-400">{selectedTask.ocrStats.needsReview}</strong></span>
                    <span className="text-text-faint">•</span>
                    <span>Deduped: <strong className="text-accent">{selectedTask.ocrStats.duplicatesRemoved}</strong></span>
                  </div>
                )}
                <div className="min-h-0 flex-1 overflow-y-auto p-3 font-mono text-[11px] leading-relaxed">
                  {!hasSrt ? (
                    <p className="py-8 text-center text-text-muted">
                      {isHybridRunning
                        ? 'Đang kết hợp Whisper + OCR — phụ đề sẽ xuất hiện ở đây khi xong...'
                        : isOcrRunning
                          ? 'Đang quét phụ đề bằng OCR — kết quả sẽ hiện ở đây khi xong...'
                          : isTranscribing
                            ? 'Đang phiên âm Whisper — kết quả sẽ hiện ở đây khi xong...'
                            : 'Tác vụ chưa có phụ đề — bấm "Bắt đầu phiên âm", "Quét OCR", "Kết hợp Whisper + OCR" hoặc "Nhập SRT".'}
                    </p>
                  ) : displayedQuickPreview === null ? (
                    <p className="py-8 text-center text-text-muted">Đang tải phụ đề...</p>
                  ) : (
                    <pre className="whitespace-pre-wrap text-text">{displayedQuickPreview}</pre>
                  )}
                </div>
              </div>
            </>
          )}
        </div>
      </div>

      {/* Modal Cấu hình OCR / Hybrid đa chế độ */}
      <OcrConfigModal
        isOpen={isOcrModalOpen}
        onClose={() => setIsOcrModalOpen(false)}
        task={selectedTask}
        launchPurpose={modalLaunchPurpose}
        onStartOcr={handleExecuteOcrModal}
      />
    </div>
  );
}
