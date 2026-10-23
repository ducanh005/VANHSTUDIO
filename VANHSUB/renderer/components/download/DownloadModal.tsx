import React, { useState, useEffect } from 'react';
import * as Dialog from '@radix-ui/react-dialog';
import {
  Download,
  Link2,
  Loader2,
  Play,
  CheckCircle2,
  AlertCircle,
  Clock,
  User,
  Sparkles,
  Clipboard,
  X,
  Layers,
  FolderOpen,
  RotateCcw,
  Edit3,
  Minimize2,
  XCircle,
} from 'lucide-react';
import { toast } from 'sonner';
import { backgroundDownloadManager } from '../../lib/downloadManager';
import { MediaInspectionPanel } from './MediaInspectionPanel';

export const PLATFORM_BADGES = {
  youtube: 'bg-red-500/10 text-red-400 border border-red-500/30',
  douyin: 'bg-accent/10 text-accent border border-accent/30',
  tiktok: 'bg-cyan-500/10 text-cyan-400 border border-cyan-500/30',
  bilibili: 'bg-pink-500/10 text-pink-400 border border-pink-500/30',
};

interface MediaInfo {
  url: string;
  cleanUrl: string;
  platform: 'youtube' | 'douyin' | 'bilibili' | 'tiktok' | 'other';
  title: string;
  author?: string;
  duration?: number;
  durationFormatted?: string;
  thumbnail?: string;
  availableQualities: Array<{
    id: string;
    label: string;
  }>;
  /** URL MP4 không watermark — từ amemv API cho Douyin/TikTok */
  noWatermarkUrl?: string;
}

interface DownloadProgress {
  percent: number;
  speed?: string;
  eta?: string;
  status: 'downloading' | 'processing' | 'completed' | 'error';
  stageDescription?: string;
}

interface DownloadModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSuccess?: (task: any) => void;
  initialUrl?: string;
}

export const DownloadModal: React.FC<DownloadModalProps> = ({
  open,
  onOpenChange,
  onSuccess,
  initialUrl,
}) => {
  const downloadState = React.useSyncExternalStore(
    backgroundDownloadManager.subscribe,
    backgroundDownloadManager.getState,
    backgroundDownloadManager.getState
  );
  const activeDownload = downloadState.active;

  const [urlInput, setUrlInput] = useState('');
  const [isInspecting, setIsInspecting] = useState(false);
  const [mediaInfo, setMediaInfo] = useState<MediaInfo | null>(null);
  const [selectedQuality, setSelectedQuality] = useState<string>('1080p');
  const [error, setError] = useState<string | null>(null);
  const [saveDir, setSaveDir] = useState<string>('');
  const [defaultDir, setDefaultDir] = useState<string>('');
  const [customTitle, setCustomTitle] = useState<string>('');
  const [isCancelling, setIsCancelling] = useState(false);
  const [cleanMetadata, setCleanMetadata] = useState(true);

  const isDownloading = Boolean(activeDownload?.isDownloading);
  const progress = activeDownload?.progress || null;

  // Xác định video hiện tại trong modal đã hoàn tất tải và tạo tác vụ hay chưa
  const isCurrentCompleted = Boolean(
    !isDownloading &&
    activeDownload &&
    activeDownload.progress?.status === 'completed' &&
    ((activeDownload.cleanUrl && mediaInfo?.cleanUrl && activeDownload.cleanUrl === mediaInfo.cleanUrl) ||
     (activeDownload.url && urlInput.trim() && activeDownload.url === urlInput.trim()) ||
     (activeDownload.completedTask && (activeDownload.title === customTitle || activeDownload.title === mediaInfo?.title)))
  );

  // Đồng bộ thông tin khi mở modal trong lúc đang có tải ngầm
  useEffect(() => {
    if (activeDownload && open) {
      if (activeDownload.isDownloading) {
        if (!urlInput) setUrlInput(activeDownload.url);
        setCleanMetadata(activeDownload.cleanMetadata !== false);
        if (!customTitle) setCustomTitle(activeDownload.title);
        if (!mediaInfo) {
          setMediaInfo({
            url: activeDownload.url,
            cleanUrl: activeDownload.cleanUrl,
            platform: activeDownload.platform,
            title: activeDownload.title,
            author: activeDownload.author,
            duration: activeDownload.duration,
            durationFormatted: activeDownload.durationFormatted,
            thumbnail: activeDownload.thumbnail,
            availableQualities: [{ id: activeDownload.quality || '1080p', label: activeDownload.quality || '1080p' }],
            noWatermarkUrl: activeDownload.noWatermarkUrl,
          });
        }
      } else if (!urlInput && !initialUrl && activeDownload.progress?.status === 'completed' && !mediaInfo) {
        // Mở lại xem kết quả của video vừa hoàn tất
        setUrlInput(activeDownload.url);
        setCustomTitle(activeDownload.title);
        setMediaInfo({
          url: activeDownload.url,
          cleanUrl: activeDownload.cleanUrl,
          platform: activeDownload.platform,
          title: activeDownload.title,
          author: activeDownload.author,
          duration: activeDownload.duration,
          durationFormatted: activeDownload.durationFormatted,
          thumbnail: activeDownload.thumbnail,
          availableQualities: [{ id: activeDownload.quality || '1080p', label: activeDownload.quality || '1080p' }],
          noWatermarkUrl: activeDownload.noWatermarkUrl,
        });
      }
    }
  }, [activeDownload, open, initialUrl]);

  // Lấy thư mục lưu trữ mặc định và tùy chọn đã lưu
  useEffect(() => {
    if (!open) return;

    let isMounted = true;
    const initDirs = async () => {
      try {
        let def = '';
        if (window.vanhsub?.downloader?.getDefaultDir) {
          def = await window.vanhsub.downloader.getDefaultDir();
        } else if (window.vanhsub?.settings?.get) {
          const exportDir = await window.vanhsub.settings.get('exportDir');
          if (exportDir) def = exportDir;
        }
        if (!isMounted) return;
        setDefaultDir(def);

        const saved = typeof window !== 'undefined' ? localStorage.getItem('vanhsub_download_dir') : null;
        if (saved) {
          setSaveDir(saved);
        } else if (def) {
          setSaveDir(def);
        }
      } catch (err) {
        console.error('Lỗi lấy thư mục mặc định:', err);
      }
    };

    initDirs();

    return () => {
      isMounted = false;
    };
  }, [open]);

  // Cập nhật initialUrl nếu được truyền vào
  useEffect(() => {
    if (open && initialUrl) {
      setUrlInput(initialUrl);
      setMediaInfo(null);
      setCustomTitle('');
      setError(null);
      if (!activeDownload?.isDownloading) {
        backgroundDownloadManager.dismiss();
      }
    }
  }, [open, initialUrl]);

  // Reset state khi mở/đóng modal (không reset nếu đang có video tải chạy nền)
  useEffect(() => {
    if (!open && !activeDownload?.isDownloading) {
      setUrlInput('');
      setMediaInfo(null);
      setCustomTitle('');
      setError(null);
      setIsInspecting(false);
    }
  }, [open, activeDownload?.isDownloading]);

  // Dọn sạch giao diện để người dùng nhập link và tải video tiếp theo
  const handleResetForNextDownload = () => {
    setUrlInput('');
    setMediaInfo(null);
    setCustomTitle('');
    setError(null);
    setIsInspecting(false);
    backgroundDownloadManager.dismiss();
  };

  // Mở tác vụ vừa tải thành công và bắt đầu làm việc
  const handleOpenCreatedTask = () => {
    if (activeDownload?.completedTask) {
      onSuccess?.(activeDownload.completedTask);
    }
    onOpenChange(false);
  };

  // Chọn thư mục lưu trữ mới qua hộp thoại hệ thống
  const handleChooseDirectory = async () => {
    try {
      if (!window.vanhsub?.dialog?.chooseDirectory) {
        toast.error('Tính năng chọn thư mục chưa sẵn sàng');
        return;
      }
      const dir = await window.vanhsub.dialog.chooseDirectory();
      if (dir) {
        setSaveDir(dir);
        localStorage.setItem('vanhsub_download_dir', dir);
        toast.success('Đã chọn thư mục lưu trữ mới');
      }
    } catch (err) {
      console.error('Lỗi khi chọn thư mục:', err);
      toast.error('Không thể chọn thư mục');
    }
  };

  // Đặt lại thư mục lưu về mặc định
  const handleResetDefaultDir = () => {
    localStorage.removeItem('vanhsub_download_dir');
    setSaveDir(defaultDir);
    toast.info('Đã khôi phục về thư mục lưu mặc định');
  };

  // Dán từ clipboard
  const handlePasteClipboard = async () => {
    try {
      const text = await navigator.clipboard.readText();
      if (text) {
        setUrlInput(text);
        setError(null);
      }
    } catch {
      toast.error('Không thể đọc từ khay nhớ tạm');
    }
  };

  // Phân tích link
  const handleInspect = async () => {
    if (!urlInput.trim()) {
      setError('Vui lòng nhập hoặc dán liên kết video');
      return;
    }

    // Nếu lượt tải trước đó đã hoàn tất, dọn dẹp để bắt đầu lượt tải mới
    if (!activeDownload?.isDownloading && activeDownload?.progress?.status === 'completed') {
      backgroundDownloadManager.dismiss();
    }

    setIsInspecting(true);
    setError(null);
    setMediaInfo(null);
    setCustomTitle('');

    try {
      if (!window.vanhsub?.downloader?.inspect) {
        throw new Error('Tính năng tải video chưa sẵn sàng trong môi trường này');
      }

      const info = await window.vanhsub.downloader.inspect(urlInput.trim());
      setMediaInfo(info);
      setCustomTitle(info.title || '');
      if (info.availableQualities && info.availableQualities.length > 0) {
        setSelectedQuality(info.availableQualities[0].id);
      }
      toast.success('Đã phân tích thông tin video thành công!');
    } catch (err: any) {
      console.error('Lỗi phân tích URL:', err);
      setError(err.message || 'Không thể phân tích video từ liên kết này. Vui lòng kiểm tra lại URL.');
      toast.error('Phân tích liên kết thất bại');
    } finally {
      setIsInspecting(false);
    }
  };

  // Tải video (quản lý qua backgroundDownloadManager để tải xuyên suốt các tab)
  const handleDownload = async () => {
    const targetUrl = mediaInfo?.cleanUrl || urlInput.trim();
    if (!targetUrl || !mediaInfo) return;

    if (!activeDownload?.isDownloading && activeDownload?.progress?.status === 'completed') {
      backgroundDownloadManager.dismiss();
    }

    setError(null);
    try {
      const result = await backgroundDownloadManager.startDownload({
        url: urlInput.trim(),
        cleanUrl: targetUrl,
        platform: mediaInfo.platform,
        title: customTitle.trim() || mediaInfo.title,
        author: mediaInfo.author,
        duration: mediaInfo.duration,
        durationFormatted: mediaInfo.durationFormatted,
        thumbnail: mediaInfo.thumbnail,
        quality: selectedQuality,
        noWatermarkUrl: mediaInfo.noWatermarkUrl,
        outputDir: saveDir.trim() || undefined,
        customFileName: customTitle.trim() || undefined,
        cleanMetadata,
      });

      onSuccess?.(result.task);
      if (!result.result.inspection) onOpenChange(false);
    } catch (err: any) {
      console.error('Lỗi tải video:', err);
      setError(err?.message || 'Tải video thất bại');
    }
  };

  // Huỷ tiến trình tải video
  const handleCancelDownload = async () => {
    setIsCancelling(true);
    try {
      if (window.vanhsub?.downloader?.cancel) {
        await window.vanhsub.downloader.cancel();
      }
      backgroundDownloadManager.dismiss();
      toast.info('Đã dừng tải video');
    } catch (err: any) {
      toast.error('Lỗi khi huỷ tải: ' + (err?.message || err));
    } finally {
      setIsCancelling(false);
    }
  };

  // Huy hiệu nền tảng
  const renderPlatformBadge = (platform?: string) => {
    switch (platform) {
      case 'douyin':
        return (
          <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-md text-[11px] font-medium bg-surface-2 text-text border border-border">
            <span className="h-1.5 w-1.5 rounded-full bg-accent" />
            Douyin (TikTok Trung Quốc)
          </span>
        );
      case 'bilibili':
        return (
          <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-md text-[11px] font-medium bg-surface-2 text-text border border-border">
            <span className="h-1.5 w-1.5 rounded-full bg-accent" />
            Bilibili Video
          </span>
        );
      case 'youtube':
        return (
          <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-md text-[11px] font-medium bg-surface-2 text-text border border-border">
            <span className="h-1.5 w-1.5 rounded-full bg-accent" />
            YouTube / Shorts
          </span>
        );
      case 'tiktok':
        return (
          <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-md text-[11px] font-medium bg-surface-2 text-text border border-border">
            <span className="h-1.5 w-1.5 rounded-full bg-accent" />
            TikTok Quốc Tế
          </span>
        );
      default:
        return (
          <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-md text-[11px] font-medium bg-surface-2 text-text-muted border border-border">
            <Link2 className="h-3 w-3" />
            Liên kết trực tuyến
          </span>
        );
    }
  };

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-[100] bg-black/60 data-[state=open]:animate-in data-[state=open]:fade-in-0" />
        <Dialog.Content className="fixed left-1/2 top-1/2 z-[100] w-[640px] max-w-[94vw] max-h-[90vh] -translate-x-1/2 -translate-y-1/2 overflow-y-auto rounded-lg border border-border bg-surface p-5 outline-none data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=open]:zoom-in-95 text-text">
          <div className="flex items-center justify-between pb-3 border-b border-border">
            <div className="flex items-center gap-2.5">
              <div className="flex h-8 w-8 items-center justify-center rounded-md bg-surface-2 border border-border text-accent">
                <Download className="h-4 w-4" />
              </div>
              <div>
                <Dialog.Title className="text-sm font-semibold text-text">
                  Tải video từ liên kết (Douyin, YouTube, Bilibili...)
                </Dialog.Title>
                <Dialog.Description className="text-xs text-text-muted">
                  Dán đường link, hệ thống sẽ tự động bóc tách thông tin và gom vào thư mục dự án riêng.
                </Dialog.Description>
              </div>
            </div>
            <Dialog.Close asChild>
              <button
                type="button"
                className="flex h-7 w-7 items-center justify-center rounded-md border border-border bg-surface-2 text-text-muted transition hover:bg-surface-3 hover:text-text cursor-pointer"
                title={isDownloading ? 'Thu nhỏ cửa sổ tải (video vẫn tiếp tục tải ngầm)' : 'Đóng'}
              >
                {isDownloading ? (
                  <Minimize2 className="h-3.5 w-3.5 text-accent" />
                ) : (
                  <X className="h-3.5 w-3.5" />
                )}
              </button>
            </Dialog.Close>
          </div>

        <div className="space-y-3.5 mt-2">
          {/* Ô nhập liên kết */}
          <div className="space-y-1.5">
            <div className="flex items-center justify-between text-xs text-text-muted">
              <span>Đường dẫn video (URL):</span>
              <button
                type="button"
                onClick={handlePasteClipboard}
                disabled={isInspecting || isDownloading}
                className="inline-flex items-center gap-1 text-accent hover:text-accent-hover cursor-pointer disabled:opacity-50"
              >
                <Clipboard className="h-3 w-3" />
                Dán từ khay nhớ tạm
              </button>
            </div>
            <div className="relative flex items-center">
              <input
                type="text"
                value={urlInput}
                onChange={(e) => {
                  setUrlInput(e.target.value);
                  if (isCurrentCompleted && e.target.value.trim() !== activeDownload?.url) {
                    setMediaInfo(null);
                    setCustomTitle('');
                    backgroundDownloadManager.dismiss();
                  }
                }}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !isInspecting && !isDownloading) {
                    handleInspect();
                  }
                }}
                disabled={isInspecting || isDownloading}
                placeholder="Dán link Douyin, YouTube, Bilibili, TikTok..."
                className="w-full rounded-md border border-border bg-surface-2 px-3 py-2 pr-24 font-mono text-xs text-text placeholder:text-text-faint focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent/25 transition"
              />
              <div className="absolute right-1.5 flex items-center gap-1">
                {urlInput && (
                  <button
                    type="button"
                    onClick={handleResetForNextDownload}
                    disabled={isInspecting || isDownloading}
                    className="p-1 text-text-muted hover:text-text rounded-md cursor-pointer"
                    title="Xóa để nhập liên kết mới"
                  >
                    <X className="h-3.5 w-3.5" />
                  </button>
                )}
                <button
                  type="button"
                  onClick={handleInspect}
                  disabled={isInspecting || isDownloading || !urlInput.trim()}
                  className="inline-flex items-center gap-1 rounded-md bg-accent px-3 py-1 text-xs font-medium text-white hover:bg-accent-hover disabled:opacity-50 cursor-pointer transition"
                >
                  {isInspecting ? (
                    <>
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                      <span>Kiểm tra...</span>
                    </>
                  ) : (
                    <>
                      <Sparkles className="h-3.5 w-3.5" />
                      <span>Phân tích</span>
                    </>
                  )}
                </button>
              </div>
            </div>
            <p className="text-[11px] text-text-faint">
              Mẹo: Với Douyin, bạn có thể dán nguyên văn bản chia sẻ từ app điện thoại (hệ thống sẽ tự lọc link).
            </p>
          </div>

          {/* Chọn thư mục lưu trữ */}
          <div className="space-y-1.5 rounded-md border border-border bg-surface-2 p-3">
            <div className="flex items-center justify-between text-xs">
              <span className="flex items-center gap-1.5 font-medium text-text-muted">
                <FolderOpen className="h-3.5 w-3.5 text-text-muted" />
                <span>Thư mục lưu video & dự án:</span>
              </span>
              {saveDir && defaultDir && saveDir !== defaultDir && (
                <button
                  type="button"
                  onClick={handleResetDefaultDir}
                  disabled={isDownloading}
                  className="inline-flex items-center gap-1 text-[11px] text-text-muted hover:text-text transition cursor-pointer disabled:opacity-50"
                  title="Khôi phục về thư mục mặc định của hệ thống"
                >
                  <RotateCcw className="h-3 w-3" />
                  Mặc định
                </button>
              )}
            </div>

            <div className="flex items-center gap-2">
              <input
                type="text"
                value={saveDir || defaultDir || ''}
                onChange={(e) => {
                  setSaveDir(e.target.value);
                  if (e.target.value.trim()) {
                    localStorage.setItem('vanhsub_download_dir', e.target.value.trim());
                  }
                }}
                disabled={isDownloading}
                placeholder="Đang tải thư mục mặc định..."
                title={saveDir || defaultDir}
                className="flex-1 truncate rounded-md border border-border bg-surface px-3 py-1.5 font-mono text-[11px] text-text placeholder:text-text-faint focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent/25 disabled:opacity-60"
              />
              <button
                type="button"
                onClick={handleChooseDirectory}
                disabled={isDownloading}
                className="inline-flex shrink-0 items-center gap-1.5 rounded-md border border-border bg-surface px-3 py-1.5 text-xs font-medium text-text hover:bg-surface-3 transition cursor-pointer disabled:opacity-50"
              >
                <FolderOpen className="h-3.5 w-3.5 text-text-muted" />
                <span>Chọn thư mục</span>
              </button>
            </div>
            <p className="text-[11px] text-text-faint">
              Hệ thống sẽ tự động tạo thư mục dự án riêng bên trong thư mục này chứa video và toàn bộ tệp xử lý.
            </p>
          </div>

          {/* Lỗi nếu có */}
          {error && (
            <div className="flex items-start gap-2.5 rounded-md border border-danger/30 bg-danger/10 p-3 text-xs text-danger">
              <AlertCircle className="h-4 w-4 shrink-0 mt-0.5" />
              <div className="flex-1 leading-relaxed">{error}</div>
            </div>
          )}

          {/* Khung xem trước thông tin video đã phân tích */}
          {mediaInfo && (
            <div className="rounded-md border border-border bg-surface-2 p-3.5 space-y-3">
              <div className="flex items-center justify-between">
                {renderPlatformBadge(mediaInfo.platform)}
                {mediaInfo.durationFormatted && (
                  <span className="inline-flex items-center gap-1 text-xs text-text-muted">
                    <Clock className="h-3 w-3 text-text-faint" />
                    {mediaInfo.durationFormatted}
                  </span>
                )}
              </div>

              <div className="flex gap-4">
                {/* Thumbnail */}
                <div className="relative h-20 w-32 shrink-0 rounded-md overflow-hidden bg-surface border border-border flex items-center justify-center">
                  {mediaInfo.thumbnail ? (
                    <img
                      src={mediaInfo.thumbnail}
                      alt={mediaInfo.title}
                      className="h-full w-full object-cover"
                    />
                  ) : (
                    <Play className="h-6 w-6 text-text-faint" />
                  )}
                </div>

                {/* Info */}
                <div className="flex-1 min-w-0 space-y-2">
                  {/* Tên file / Tiêu đề có thể chỉnh sửa */}
                  <div className="space-y-1">
                    <div className="flex items-center justify-between text-[11px]">
                      <span className="font-medium text-text-muted flex items-center gap-1.5">
                        <Edit3 className="h-3 w-3 text-accent" />
                        <span>Tên file lưu trữ:</span>
                      </span>
                      {customTitle && mediaInfo.title && customTitle !== mediaInfo.title && (
                        <button
                          type="button"
                          onClick={() => setCustomTitle(mediaInfo.title)}
                          disabled={isDownloading}
                          className="inline-flex items-center gap-1 text-[10px] text-text-muted hover:text-text transition cursor-pointer disabled:opacity-50"
                          title="Đặt lại tên theo tiêu đề gốc của video"
                        >
                          <RotateCcw className="h-2.5 w-2.5" />
                          Tiêu đề gốc
                        </button>
                      )}
                    </div>
                    <input
                      type="text"
                      value={customTitle}
                      onChange={(e) => setCustomTitle(e.target.value)}
                      disabled={isDownloading}
                      placeholder="Nhập tên file bạn muốn lưu..."
                      className="w-full rounded-md border border-border bg-surface px-2.5 py-1.5 text-xs text-text placeholder:text-text-faint focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent/25 font-medium"
                    />
                  </div>

                  {mediaInfo.author && (
                    <p className="inline-flex items-center gap-1 text-xs text-text-muted">
                      <User className="h-3 w-3 text-text-faint" />
                      {mediaInfo.author}
                    </p>
                  )}

                  {/* Lựa chọn chất lượng */}
                  <div className="pt-1 flex items-center gap-2">
                    <span className="text-[11px] text-text-muted shrink-0">Chất lượng:</span>
                    <div className="flex flex-wrap gap-1.5">
                      {mediaInfo.availableQualities.map((q) => (
                        <button
                          key={q.id}
                          type="button"
                          onClick={() => setSelectedQuality(q.id)}
                          disabled={isDownloading}
                          className={`px-2.5 py-1 rounded-md text-xs font-medium transition cursor-pointer ${
                            selectedQuality === q.id
                              ? 'bg-accent text-white'
                              : 'bg-surface border border-border text-text-muted hover:text-text hover:bg-surface-3'
                          }`}
                        >
                          {q.label}
                        </button>
                      ))}
                    </div>
                  </div>
                </div>
              </div>

              {/* Badge không watermark cho Douyin/TikTok */}
              {(mediaInfo.platform === 'douyin' || mediaInfo.platform === 'tiktok') && mediaInfo.noWatermarkUrl && (
                <div className="flex items-center gap-2 px-3 py-2 rounded-md bg-surface border border-border text-[11px] text-text-muted">
                  <span className="h-1.5 w-1.5 rounded-full bg-accent shrink-0" />
                  <span>Ưu tiên luồng phát không watermark. Logo hoặc ID có sẵn trong hình vẫn có thể còn; kết quả cần được kiểm tra sau tải.</span>
                </div>
              )}

              {mediaInfo.platform === 'douyin' && <label className="flex items-start gap-2 text-xs text-text">
                <input type="checkbox" checked={cleanMetadata} disabled={isDownloading} onChange={event => setCleanMetadata(event.target.checked)} />
                <span>Tạo bản biên tập riêng, làm sạch ID kỹ thuật trong metadata. Giữ nguyên bản tải gốc. Tự kiểm tra file và lấy mẫu khung hình sau tải.</span>
              </label>}

              {/* Thông báo thư mục lưu trữ & tên file */}
              <div className="flex items-center gap-2 px-3 py-2 rounded-md bg-surface border border-border text-[11px] text-text-muted">
                <Layers className="h-3.5 w-3.5 text-text-muted shrink-0" />
                <span className="truncate">
                  Dự án & video sẽ được lưu tại:{' '}
                  <strong className="font-mono text-text" title={saveDir || defaultDir}>
                    {saveDir || defaultDir || 'Thư mục mặc định'}
                  </strong>
                  {' → '}
                  <span className="font-mono text-accent font-medium">
                    {(customTitle.trim() || mediaInfo.title || 'video').replace(/[\\/:*?"<>|]/g, '_')}_vanhsub/
                  </span>
                </span>
              </div>
            </div>
          )}

          {/* Trạng thái hoàn thành tải video (100% & đã thêm vào workspace) */}
          {isCurrentCompleted && (
            <div className="rounded-md border border-emerald-500/30 bg-emerald-500/10 p-3.5 space-y-2.5 text-text">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2.5">
                  <div className="flex h-7 w-7 items-center justify-center rounded-full bg-emerald-500/20 text-emerald-400">
                    <CheckCircle2 className="h-4 w-4" />
                  </div>
                  <div>
                    <h4 className="text-xs font-semibold text-emerald-300">
                      Tải video hoàn tất (100%) & Đã thêm vào khâu làm việc
                    </h4>
                    <p className="text-[11px] text-emerald-200/80">
                      Tác vụ đã sẵn sàng trong ứng dụng. Bạn có thể bấm biên tập ngay hoặc dọn form để tải tiếp video khác.
                    </p>
                  </div>
                </div>
                <span className="rounded bg-emerald-500/20 px-2 py-0.5 text-[10px] font-medium text-emerald-300 uppercase border border-emerald-500/30">
                  {activeDownload?.platform || mediaInfo?.platform}
                </span>
              </div>
              <div className="flex flex-wrap items-center justify-between gap-2 pt-2 border-t border-emerald-500/20 text-[11px]">
                <span className="text-text-muted truncate max-w-[340px]">
                  Tệp: <strong className="text-text font-mono">{activeDownload?.completedTask?.fileName || customTitle || mediaInfo?.title}</strong>
                </span>
                <button
                  type="button"
                  onClick={handleResetForNextDownload}
                  className="inline-flex items-center gap-1.5 text-accent hover:text-accent-hover font-medium cursor-pointer transition"
                  title="Dọn sạch form để chuẩn bị tải video tiếp theo"
                >
                  <RotateCcw className="h-3 w-3" />
                  <span>Dọn form để tải video tiếp theo</span>
                </button>
              </div>
            </div>
          )}

          {/* Báo cáo kiểm tra watermark & metadata cho Douyin */}
          {activeDownload?.inspection && isCurrentCompleted && (
            <MediaInspectionPanel report={activeDownload.inspection} title="Kết quả kiểm tra watermark & metadata" />
          )}

          {/* Thanh tiến trình tải khi đang chạy */}
          {isDownloading && progress && (
            <div className="rounded-md border border-border bg-surface-2 p-3 space-y-2">
              <div className="flex items-center justify-between text-xs">
                <span className="font-medium text-text flex items-center gap-1.5">
                  <Loader2 className="h-3.5 w-3.5 animate-spin text-accent" />
                  {progress.stageDescription || 'Đang tải video...'}
                </span>
                <span className="font-mono font-medium text-accent">
                  {progress.percent.toFixed(1)}%
                </span>
              </div>

              {/* Progress track */}
              <div className="h-1.5 w-full rounded-full bg-surface-3 overflow-hidden">
                <div
                  className="h-full bg-accent rounded-full transition-all duration-300"
                  style={{ width: `${progress.percent}%` }}
                />
              </div>

              <div className="flex items-center justify-between text-[11px] text-text-muted font-mono">
                <span>{progress.speed ? `Tốc độ: ${progress.speed}` : ''}</span>
                <span>{progress.eta ? `Còn lại: ${progress.eta}` : ''}</span>
              </div>
            </div>
          )}
        </div>

        {/* Footer Actions */}
        <div className="mt-4 flex items-center justify-between gap-2.5 pt-3 border-t border-border">
          <div>
            {isDownloading && (
              <span className="text-[11px] text-accent flex items-center gap-1.5 font-medium">
                <span className="relative flex h-2 w-2">
                  <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-accent opacity-75"></span>
                  <span className="relative inline-flex rounded-full h-2 w-2 bg-accent"></span>
                </span>
                Đang tải chạy nền — bạn có thể thu nhỏ hoặc chuyển tab khác
              </span>
            )}
            {isCurrentCompleted && (
              <span className="text-[11px] text-emerald-400 flex items-center gap-1.5 font-medium">
                <CheckCircle2 className="h-3.5 w-3.5 text-emerald-400" />
                Đã thêm vào khâu làm việc
              </span>
            )}
          </div>

          <div className="flex items-center gap-2">
            {isDownloading && (
              <button
                type="button"
                onClick={handleCancelDownload}
                disabled={isCancelling}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium text-danger bg-danger/10 border border-danger/30 hover:bg-danger/20 transition cursor-pointer disabled:opacity-50"
              >
                {isCancelling ? (
                  <>
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    <span>Đang huỷ...</span>
                  </>
                ) : (
                  <>
                    <XCircle className="h-3.5 w-3.5" />
                    <span>Huỷ tải video</span>
                  </>
                )}
              </button>
            )}

            <button
              type="button"
              onClick={() => onOpenChange(false)}
              className="inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-md text-xs font-medium text-text bg-surface-2 border border-border hover:bg-surface-3 transition cursor-pointer"
            >
              {isDownloading ? (
                <>
                  <Minimize2 className="h-3.5 w-3.5 text-accent" />
                  <span>Thu nhỏ & Chạy nền</span>
                </>
              ) : (
                <span>Đóng</span>
              )}
            </button>

            {/* Trạng thái đã hoàn tất: Các nút chuyển hướng rõ ràng */}
            {isCurrentCompleted && (
              <>
                <button
                  type="button"
                  onClick={handleOpenCreatedTask}
                  className="inline-flex items-center gap-1.5 rounded-md border border-accent/40 bg-accent/10 px-3.5 py-1.5 text-xs font-medium text-accent hover:bg-accent/20 transition cursor-pointer"
                  title="Chuyển ngay đến tác vụ trong khâu làm việc"
                >
                  <Sparkles className="h-3.5 w-3.5" />
                  <span>Bắt đầu làm việc</span>
                </button>
                <button
                  type="button"
                  onClick={handleResetForNextDownload}
                  className="inline-flex items-center gap-1.5 rounded-md bg-accent px-4 py-1.5 text-xs font-medium text-white hover:bg-accent-hover transition cursor-pointer shadow-sm"
                  title="Dọn sạch form để dán liên kết video tiếp theo"
                >
                  <RotateCcw className="h-3.5 w-3.5" />
                  <span>Tải video khác</span>
                </button>
              </>
            )}

            {/* Chưa tải: Nút bắt đầu tải */}
            {mediaInfo && !isDownloading && !isCurrentCompleted && (
              <button
                type="button"
                onClick={handleDownload}
                className="inline-flex items-center gap-2 rounded-md bg-accent px-4 py-1.5 text-xs font-medium text-white hover:bg-accent-hover transition cursor-pointer"
              >
                <Download className="h-3.5 w-3.5" />
                <span>Tải video & Bắt đầu làm việc</span>
              </button>
            )}

            {isDownloading && (
              <div className="inline-flex items-center gap-2 rounded-md bg-accent-tint border border-accent/30 px-3 py-1.5 text-xs font-medium text-accent">
                <Loader2 className="h-3.5 w-3.5 animate-spin text-accent" />
                <span>Đang tải xuống ({progress?.percent ?? 0}%)...</span>
              </div>
            )}
          </div>
        </div>
      </Dialog.Content>
    </Dialog.Portal>
  </Dialog.Root>
  );
};
