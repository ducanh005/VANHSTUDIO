import React, { useState, useEffect, useCallback, useRef } from 'react';
import Head from 'next/head';
import {
  CheckCircle2,
  CircleHelp,
  Cpu,
  Download,
  FileUp,
  FileVideo,
  Film,
  Folder,
  FolderOpen,
  Globe,
  Keyboard,
  Layers,
  Link2,
  Loader2,
  MessageSquareText,
  Mic,
  Play,
  Plus,
  RefreshCw,
  Search,
  Settings,
  Sparkles,
  Subtitles,
  Trash2,
  UploadCloud,
  Zap,
  Workflow,
  PanelLeftClose,
  PanelLeftOpen,
  AlertCircle,
  Maximize2,
  Square,
  X,
} from 'lucide-react';
import dynamic from 'next/dynamic';
import type { Task, WorkflowType } from '../types/task';
import { engineForVoice } from '../../main/lib/ttsConfig';
import { t, formatTimeAgo as formatTimeAgoHelper } from '../lib/i18n';
import SubtitleEditor from '../components/SubtitleEditor';
import ASRWorkspace from '../components/ASRWorkspace';
import TTSPage from '../components/TTSPage';
import ExportPage from '../components/ExportPage';
import SettingsPage from '../components/SettingsPage';
import TerminalPanel from '../components/TerminalPanel';
import OnboardingModal from '../components/OnboardingModal';
import { DownloadModal } from '../components/download/DownloadModal';
import AiStudioWorkspace from '../components/ai-studio/AiStudioWorkspace';
import ChromeBridgeModal from '../components/ai-studio/ChromeBridgeModal';
import { backgroundDownloadManager } from '../lib/downloadManager';

const WorkflowCanvas = dynamic(
  () => import('../components/workflow/WorkflowCanvas'),
  { ssr: false }
);

type NavItem = {
  id: string;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  badge?: string;
};

const getNavItems = (): NavItem[] => [
  { id: 'home', label: t('sidebar.home'), icon: Film },
  { id: 'ai-studio', label: 'AI Studio', icon: Sparkles, badge: 'HOT' },
  { id: 'workflow', label: 'Workflow AI', icon: Workflow, badge: 'MỚI' },
  { id: 'subtitles', label: t('sidebar.subtitles'), icon: Subtitles },
  { id: 'editor', label: t('sidebar.editor'), icon: MessageSquareText },
  { id: 'dubbing', label: t('sidebar.dubbing'), icon: Mic },
  { id: 'export', label: t('sidebar.export'), icon: Layers },
  { id: 'settings', label: t('sidebar.settings'), icon: Settings },
];

type ShortcutItem = {
  id: string;
  label: string;
  shortcut: string;
};

const SHORTCUTS: ShortcutItem[] = [
  { id: 'search', label: 'Tìm kiếm nhanh', shortcut: 'Ctrl + K' },
  { id: 'new', label: 'Tạo phụ đề mới', shortcut: 'Ctrl + N' },
  { id: 'editor', label: 'Mở trang hiệu đính', shortcut: 'Ctrl + E' },
  { id: 'settings', label: t('sidebar.settings'), shortcut: 'Ctrl + ,' },
];

// Dùng i18n helper thay vì function riêng

export default function HomePage() {
  const [activeTab, setActiveTab] = useState('home');
  const downloadState = React.useSyncExternalStore(
    backgroundDownloadManager.subscribe,
    backgroundDownloadManager.getState,
    backgroundDownloadManager.getState
  );
  const activeDownload = downloadState.active;

  const [greeting, setGreeting] = useState(t('home.greeting_evening'));
  const [currentDateStr, setCurrentDateStr] = useState('');
  const [tasks, setTasks] = useState<Task[]>([]);
  const [isDragging, setIsDragging] = useState(false);
  const [linkUrl, setLinkUrl] = useState('');
  const [downloadModalOpen, setDownloadModalOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const searchInputRef = useRef<HTMLInputElement>(null);
  const [asrModel, setAsrModel] = useState('base');
  const [defaultTtsVoice, setDefaultTtsVoice] = useState('vi-VN-HoaiMyNeural');
  const defaultTtsLabel = { edge: 'Edge TTS', tiktok: 'TikTok TTS', viettts: 'Local TTS' }[engineForVoice(defaultTtsVoice)];
  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(null);
  const [isSidebarCollapsed, setIsSidebarCollapsed] = useState(false);
  const [isZenMode, setIsZenMode] = useState(false);
  // Popup hướng dẫn người dùng mới: hiện lần đầu mở app, mở lại được bằng nút (?)
  const [showGuide, setShowGuide] = useState(false);
  const [guideReady, setGuideReady] = useState(false);
  const [isFlowLobbyOpen, setIsFlowLobbyOpen] = useState(false);
  const [isChromeBridgeConnected, setIsChromeBridgeConnected] = useState(false);
  const [isChromeBridgeModalOpen, setIsChromeBridgeModalOpen] = useState(false);

  const checkChromeBridge = useCallback(async () => {
    if (typeof window !== 'undefined' && (window as any).vanhsub?.veo?.bridgeStatus) {
      try {
        const res = await (window as any).vanhsub.veo.bridgeStatus();
        setIsChromeBridgeConnected(Boolean(res?.connected));
      } catch {}
    }
  }, []);

  // Kiểm tra trạng thái sảnh và Chrome bridge
  useEffect(() => {
    if (typeof window !== 'undefined' && (window as any).vanhsub?.veo?.isLobbyDebug) {
      (window as any).vanhsub.veo
        .isLobbyDebug()
        .then((open: boolean) => setIsFlowLobbyOpen(!!open))
        .catch(() => {});
    }
    checkChromeBridge();
    const interval = setInterval(checkChromeBridge, 3000);
    return () => clearInterval(interval);
  }, [checkChromeBridge]);

  const handleToggleFlowLobby = async () => {
    try {
      if (isFlowLobbyOpen) {
        if ((window as any).vanhsub?.veo?.hideLobbyOffscreen) {
          await (window as any).vanhsub.veo.hideLobbyOffscreen();
          setIsFlowLobbyOpen(false);
        }
      } else {
        if ((window as any).vanhsub?.veo?.showLobbyDebug) {
          await (window as any).vanhsub.veo.showLobbyDebug();
          setIsFlowLobbyOpen(true);
        } else if ((window as any).vanhsub?.veo?.openLobby) {
          await (window as any).vanhsub.veo.openLobby();
          setIsFlowLobbyOpen(true);
        }
      }
    } catch (err) {
      console.error('Lỗi khi bật/tắt sảnh Google Flow:', err);
    }
  };

  const handleCloseGuide = (dontShowAgain: boolean) => {
    setShowGuide(false);
    if (dontShowAgain && typeof window !== 'undefined' && window.vanhsub?.settings) {
      window.vanhsub.settings.set('onboardingCompleted', true).catch(() => {});
    }
  };

  const loadTasks = useCallback(async () => {
    if (typeof window !== 'undefined' && window.vanhsub?.tasks) {
      try {
        const loadedTasks = await window.vanhsub.tasks.getAll();
        setTasks(loadedTasks || []);
      } catch (err) {
        console.error('Lỗi khi tải danh sách task:', err);
      }
    }
  }, []);

  useEffect(() => {
    const now = new Date();
    const hour = now.getHours();
    if (hour >= 5 && hour < 12) {
      setGreeting(t('home.greeting_morning'));
    } else if (hour >= 12 && hour < 18) {
      setGreeting(t('home.greeting_afternoon'));
    } else {
      setGreeting(t('home.greeting_evening'));
    }

    const options: Intl.DateTimeFormatOptions = {
      weekday: 'long',
      year: 'numeric',
      month: 'long',
      day: 'numeric',
    };
    setCurrentDateStr(now.toLocaleDateString('vi-VN', options));

    loadTasks();

    // Model ASR đang đặt trong Cài đặt (hiển thị ở widget AI Engine + Cấu hình mô hình)
    if (typeof window !== 'undefined' && window.vanhsub?.settings) {
      window.vanhsub.settings.get('ttsVoice').then(v => { if (v) setDefaultTtsVoice(String(v)); }).catch(() => {});
      window.vanhsub.settings
        .get('asrModel')
        .then((v: string) => {
          if (v) setAsrModel(String(v));
        })
        .catch(() => {});

      // Popup hướng dẫn: chỉ hiện nếu người dùng chưa xem lần nào
      window.vanhsub.settings
        .get('onboardingCompleted')
        .then((v: boolean) => {
          setShowGuide(!v);
          setGuideReady(true);
        })
        .catch((err) => {
          console.log('Không đọc được onboardingCompleted, hiện hướng dẫn:', err);
          setShowGuide(true);
          setGuideReady(true);
        });
    }

    if (typeof window !== 'undefined' && window.vanhsub?.tasks?.onUpdate) {
      const unsubscribe = window.vanhsub.tasks.onUpdate((updatedTasks) => {
        setTasks(updatedTasks || []);
      });
      return () => unsubscribe();
    }
  }, [loadTasks]);

  useEffect(() => {
    if (typeof window === 'undefined' || !window.vanhsub?.settings?.onChange) return;
    let mounted = true;
    const unsubscribe = window.vanhsub.settings.onChange((key) => {
      if (key === 'ttsVoice') window.vanhsub.settings.get(key).then(value => {
        if (mounted) setDefaultTtsVoice(String(value || 'vi-VN-HoaiMyNeural'));
      }).catch(() => {});
      if (key === 'asrModel') window.vanhsub.settings.get(key).then((value) => {
        if (mounted) setAsrModel(String(value || 'base'));
      }).catch(() => {});
    });
    return () => { mounted = false; unsubscribe(); };
  }, []);

  useEffect(() => {
    if (activeDownload?.completedTask) {
      loadTasks();
    }
  }, [activeDownload?.completedTask, loadTasks]);

  const handleSelectFiles = useCallback(async (workflow: WorkflowType = 'fast-transcribe') => {
    if (typeof window === 'undefined' || !window.vanhsub?.dialog) return;

    try {
      const filePaths = await window.vanhsub.dialog.openMediaFile();
      if (!filePaths || filePaths.length === 0) return;

      for (const filePath of filePaths) {
        const fileName = filePath.split(/[/\\]/).pop() || 'media_file';
        await window.vanhsub.tasks.create({
          fileName,
          filePath,
          workflow,
          status: 'queued',
          progress: 0,
          stageDescription: 'Đã sẵn sàng phiên âm',
        });
      }
    } catch (err) {
      console.error('Lỗi khi chọn file:', err);
    }
  }, []);

  const handleShortcutAction = useCallback(
    (id: string) => {
      switch (id) {
        case 'search':
          setActiveTab('home');
          setTimeout(() => {
            searchInputRef.current?.focus();
            searchInputRef.current?.select();
          }, 50);
          break;
        case 'new':
          handleSelectFiles('fast-transcribe');
          break;
        case 'editor':
          setActiveTab('editor');
          break;
        case 'settings':
          setActiveTab('settings');
          break;
      }
    },
    [handleSelectFiles]
  );

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const isCtrlOrMeta = e.ctrlKey || e.metaKey;
      if (!isCtrlOrMeta) return;

      const key = e.key?.toLowerCase();
      const code = e.code;

      // Ctrl + K: Tìm kiếm nhanh
      if (key === 'k' || code === 'KeyK') {
        e.preventDefault();
        handleShortcutAction('search');
        return;
      }

      // Ctrl + N: Tạo tác vụ mới
      if (key === 'n' || code === 'KeyN') {
        e.preventDefault();
        handleShortcutAction('new');
        return;
      }

      // Ctrl + E: Mở trang hiệu đính
      if (key === 'e' || code === 'KeyE') {
        e.preventDefault();
        handleShortcutAction('editor');
        return;
      }

      // Ctrl + ,: Mở cài đặt
      if (key === ',' || code === 'Comma') {
        e.preventDefault();
        handleShortcutAction('settings');
        return;
      }

      // Ctrl + B: Thu gọn / Mở rộng Sidebar điều hướng
      if (key === 'b' || code === 'KeyB') {
        e.preventDefault();
        setIsSidebarCollapsed((prev) => !prev);
        return;
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [handleShortcutAction]);

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(true);
  };

  const handleDragLeave = () => {
    setIsDragging(false);
  };

  const handleDrop = async (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);

    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      const files = Array.from(e.dataTransfer.files);
      for (const file of files) {
        // Electron >=32 đã bỏ File.path — lấy đường dẫn qua webUtils ở preload
        const filePath =
          window.vanhsub?.files?.getPath?.(file) || (file as any).path || '';
        if (!filePath || (!filePath.includes('/') && !filePath.includes('\\'))) {
          console.warn('Bỏ qua file không lấy được đường dẫn:', file.name);
          continue;
        }
        const fileName = file.name;
        const sizeMb = (file.size / (1024 * 1024)).toFixed(1) + ' MB';

        if (window.vanhsub?.tasks) {
          await window.vanhsub.tasks.create({
            fileName,
            filePath,
            fileSize: sizeMb,
            workflow: 'fast-transcribe',
            status: 'queued',
            progress: 0,
            stageDescription: 'Đã thêm từ kéo thả',
          });
        }
      }
    }
  };

  const handleDeleteTask = async (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    if (window.vanhsub?.tasks) {
      await window.vanhsub.tasks.delete(id);
    }
  };
  const handleStartTask = async (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    if (window.vanhsub?.tasks) {
      await window.vanhsub.tasks.start(id);
    }
  };

  const handleShowInFolder = (filePath: string, e: React.MouseEvent) => {
    e.stopPropagation();
    if (window.vanhsub?.dialog) {
      if (window.vanhsub.dialog.openFolder) {
        window.vanhsub.dialog.openFolder(filePath);
      } else {
        window.vanhsub.dialog.showInFolder(filePath);
      }
    }
  };

  // Huỷ tác vụ đang chạy hoặc đang chờ
  const handleCancelTask = async (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    if (typeof window === 'undefined' || !window.vanhsub?.tasks?.cancel) return;
    try {
      await window.vanhsub.tasks.cancel(id);
    } catch (err) {
      console.error('Lỗi khi huỷ tác vụ:', err);
    }
  };

  // Chạy cả quy trình còn thiếu (phiên âm → dịch → giọng → ghép)
  const handleRunPipeline = async (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    if (typeof window === 'undefined' || !window.vanhsub?.tasks?.runPipeline) return;
    try {
      await window.vanhsub.tasks.runPipeline(id);
    } catch (err) {
      console.error('Lỗi khi chạy quy trình:', err);
    }
  };

  // Các task còn việc để chạy pipeline: chưa chạy dở, và chưa có video output
  const tasksNeedingPipeline = tasks.filter(
    (t) =>
      !['transcribing', 'ocr', 'translating', 'dubbing', 'exporting'].includes(t.status) &&
      !(t.status === 'done' && t.outputPath)
  );

  // Batch: enqueue tất cả task còn việc — main process tự điều phối tối đa
  // 2 pipeline song song qua hàng đợi
  const handleRunPipelineBatch = async () => {
    if (tasksNeedingPipeline.length === 0) return;
    if (typeof window === 'undefined' || !window.vanhsub?.tasks?.runPipelineBatch) return;
    try {
      await window.vanhsub.tasks.runPipelineBatch(tasksNeedingPipeline.map((t) => t.id));
    } catch (err) {
      console.error('Lỗi khi chạy batch:', err);
    }
  };

  const handleImportSrt = async (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    if (typeof window === 'undefined' || !window.vanhsub?.dialog?.openSrtFile) return;
    try {
      const srtPath = await window.vanhsub.dialog.openSrtFile();
      if (!srtPath) return;
      await window.vanhsub.tasks.importSrt(id, srtPath);
    } catch (err) {
      console.error('Lỗi khi nhập SRT:', err);
    }
  };

  const filteredTasks = tasks.filter((t) =>
    t.fileName.toLowerCase().includes(searchQuery.toLowerCase())
  );

  const completedCount = tasks.filter((t) => t.status === 'done').length;

  return (
    <>
      <Head>
        <title>VanhStudio — Studio Phụ Đề & Lồng Tiếng AI</title>
      </Head>

      <div className="flex h-screen overflow-hidden bg-bg text-text antialiased select-none">
        {/* =========================================================================
            SIDEBAR ĐIỀU HƯỚNG
            ========================================================================= */}
        <aside
          className={`flex flex-col justify-between border-r border-border bg-surface transition-all duration-200 ease-in-out select-none ${
            isZenMode && activeTab === 'workflow'
              ? 'w-0 border-r-0 p-0 overflow-hidden opacity-0 pointer-events-none'
              : isSidebarCollapsed
              ? 'w-[68px] px-2 py-4'
              : 'w-[240px] px-4 py-5'
          }`}
        >
          <div>
            {/* Logo & Collapse Toggle */}
            <div className={`mb-6 flex items-center ${isSidebarCollapsed ? 'flex-col gap-3 justify-center' : 'justify-between px-1'}`}>
              <div className="flex items-center gap-3">
                <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md border border-border bg-surface-2 text-accent">
                  <Sparkles className="h-4.5 w-4.5" />
                </div>
                {!isSidebarCollapsed && (
                  <div className="min-w-0">
                    <div className="text-sm font-semibold tracking-tight text-text flex items-center gap-1.5 truncate">
                      VanhStudio
                      <span className="rounded bg-accent-tint px-1.5 py-0.5 text-[9px] font-medium text-accent">
                        AI PRO
                      </span>
                    </div>
                    <div className="text-[11px] text-text-muted truncate">Studio Phụ đề & Voice</div>
                  </div>
                )}
              </div>

              <button
                type="button"
                onClick={() => setIsSidebarCollapsed(!isSidebarCollapsed)}
                className="p-1.5 rounded-md text-text-muted hover:text-text hover:bg-surface-2 transition-colors cursor-pointer"
                title={isSidebarCollapsed ? 'Mở rộng thanh điều hướng (Ctrl + B)' : 'Thu gọn thanh điều hướng (Ctrl + B)'}
              >
                {isSidebarCollapsed ? (
                  <PanelLeftOpen className="h-4 w-4" />
                ) : (
                  <PanelLeftClose className="h-4 w-4" />
                )}
              </button>
            </div>

            {/* Menu chính */}
            <nav className="space-y-1">
              {getNavItems().map(({ id, label, icon: Icon, badge }) => {
                const active = activeTab === id;
                return (
                  <button
                    key={id}
                    type="button"
                    onClick={() => setActiveTab(id)}
                    title={isSidebarCollapsed ? label : undefined}
                    className={[
                      'group flex w-full items-center rounded-md transition-colors duration-150 relative cursor-pointer',
                      isSidebarCollapsed
                        ? 'justify-center p-2.5'
                        : 'justify-between px-3.5 py-2.5 text-left text-sm font-medium',
                      active
                        ? 'bg-surface-3 text-text before:absolute before:left-0 before:top-1.5 before:bottom-1.5 before:w-[2px] before:bg-accent'
                        : 'text-text-muted hover:bg-surface-2 hover:text-text',
                    ].join(' ')}
                  >
                    <div className={`flex items-center ${isSidebarCollapsed ? 'justify-center' : 'gap-3'}`}>
                      <Icon
                        className={[
                          'h-4 w-4 transition-colors shrink-0',
                          active ? 'text-accent' : 'text-text-muted group-hover:text-text',
                        ].join(' ')}
                      />
                      {!isSidebarCollapsed && <span>{label}</span>}
                    </div>
                    {badge && (
                      isSidebarCollapsed ? (
                        <span className="absolute top-1.5 right-1.5 h-1.5 w-1.5 rounded-full bg-accent" />
                      ) : (
                        <span className="rounded bg-accent-tint px-1.5 py-0.5 text-[10px] font-medium text-accent">
                          {badge}
                        </span>
                      )
                    )}
                  </button>
                );
              })}
            </nav>
          </div>

          {/* Widget Trạng thái AI Engine ở góc dưới */}
          {isSidebarCollapsed ? (
            <div
              className="flex flex-col items-center justify-center p-2.5 rounded-md border border-border bg-surface-2 text-text-muted hover:text-text hover:border-border-strong transition-colors cursor-pointer"
              title={`AI Core Engine: Hoạt động\nASR: Whisper ${asrModel}\nTranslate: Gemini Flash\nTTS: ${defaultTtsLabel}`}
            >
              <Cpu className="h-4 w-4 text-text-muted" />
              <span className="mt-1.5 h-1.5 w-1.5 rounded-full bg-success" />
            </div>
          ) : (
            <div className="rounded-md border border-border bg-surface-2 p-3">
              <div className="mb-2.5 flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Cpu className="h-3.5 w-3.5 text-accent" />
                  <span className="text-xs font-medium text-text">AI Core Engine</span>
                </div>
                <span className="inline-flex items-center gap-1.5 text-[11px] font-medium text-success">
                  <span className="h-1.5 w-1.5 rounded-full bg-success" />
                  Hoạt động
                </span>
              </div>
              <div className="space-y-1.5 text-[11px] text-text-muted">
                <div className="flex items-center justify-between">
                  <span>ASR Model</span>
                  <span className="font-mono text-text">Whisper {asrModel}</span>
                </div>
                <div className="flex items-center justify-between">
                  <span>Translate</span>
                  <span className="font-mono text-text">Gemini Flash API</span>
                </div>
                <div className="flex items-center justify-between">
                  <span>TTS Voice</span>
                  <span className="font-mono text-text">{defaultTtsLabel}</span>
                </div>
              </div>
            </div>
          )}
        </aside>

        {/* =========================================================================
            MAIN CONTENT AREA
            ========================================================================= */}
        <main className="flex flex-1 flex-col overflow-hidden bg-bg text-text">
          {/* Header chính: luôn hiển thị đồng bộ ở mọi tab (chỉ ẩn khi bật Zen Mode để Canvas chiếm trọn màn hình) */}
          {!isZenMode && (
            <header className="flex h-12 shrink-0 items-center justify-between border-b border-border bg-surface px-4 z-20">
              <div className="flex flex-1 items-center gap-4 min-w-0">
                <h2 className="text-sm font-semibold text-text tracking-tight shrink-0">
                  {activeTab === 'ai-studio'
                    ? 'AI Video Studio'
                    : activeTab === 'workflow'
                    ? 'Workflow AI Studio'
                    : activeTab === 'editor'
                    ? 'Hiệu đính Phụ đề'
                    : activeTab === 'dubbing'
                    ? 'Lồng tiếng AI'
                    : activeTab === 'export'
                    ? 'Xuất Video'
                    : activeTab === 'settings'
                    ? 'Cài đặt Hệ thống'
                    : activeTab === 'subtitles'
                    ? 'Không gian Phụ đề'
                    : 'Studio Trang chủ'}
                </h2>

                {/* Universal Search bar */}
                <div className="flex flex-1 items-center justify-center px-4 max-w-lg">
                  <div className="flex w-full items-center gap-2 rounded-md border border-border bg-surface-2 px-3 py-1.5 text-xs text-text transition-colors focus-within:border-accent focus-within:ring-1 focus-within:ring-accent/25">
                    <Search className="h-3.5 w-3.5 text-text-muted shrink-0" />
                    <input
                      ref={searchInputRef}
                      value={searchQuery}
                      onChange={(e) => setSearchQuery(e.target.value)}
                      placeholder="Tìm kiếm tác vụ, phụ đề, tên video..."
                      className="w-full bg-transparent text-xs text-text placeholder:text-text-faint focus:outline-none"
                    />
                    <kbd className="rounded border border-border bg-surface-3 px-1 py-0.5 text-[10px] font-mono text-text-faint shrink-0">
                      Ctrl K
                    </kbd>
                  </div>
                </div>
              </div>

              {/* Header Right Actions */}
              <div className="flex items-center gap-2 shrink-0">
                {/* Nút Chrome Flow Bridge (Khuyên Dùng) */}
                <button
                  type="button"
                  onClick={() => setIsChromeBridgeModalOpen(true)}
                  className={`btn-secondary inline-flex items-center gap-1.5 rounded-md border px-3 py-1.5 text-xs font-medium transition-colors cursor-pointer ${
                    isChromeBridgeConnected
                      ? 'border-success/40 bg-surface-2 text-success hover:bg-surface-3'
                      : 'border-border bg-surface-2 text-text hover:bg-surface-3'
                  }`}
                  title={
                    isChromeBridgeConnected
                      ? 'Chrome Extension đang kết nối! Mọi tác vụ sinh media sẽ xử lý qua tab Chrome thật.'
                      : 'Bấm để mở Google Chrome hoặc xem hướng dẫn nạp Extension 30s để tránh 100% lỗi reCAPTCHA.'
                  }
                >
                  <span className={`h-1.5 w-1.5 rounded-full shrink-0 ${isChromeBridgeConnected ? 'bg-success animate-pulse' : 'bg-text-faint'}`} />
                  <Globe className={`h-4 w-4 shrink-0 ${isChromeBridgeConnected ? 'text-success' : 'text-text-muted'}`} />
                  <span>{isChromeBridgeConnected ? 'Chrome: ĐÃ KẾT NỐI' : 'Kết Nối Chrome (Khuyên Dùng)'}</span>
                </button>

                {/* Nút Mở Sảnh Google Flow */}
                <button
                  type="button"
                  onClick={handleToggleFlowLobby}
                  className={`btn-secondary inline-flex items-center gap-1.5 rounded-md border px-3 py-1.5 text-xs font-medium transition-colors cursor-pointer ${
                    isFlowLobbyOpen
                      ? 'border-warning/40 bg-surface-2 text-warning hover:bg-surface-3'
                      : 'border-border bg-surface-2 text-text hover:bg-surface-3'
                  }`}
                  title="Mở hoặc ẩn cửa sổ Sảnh Google Flow trên màn hình để kiểm tra session nội bộ"
                >
                  <span className={`h-1.5 w-1.5 rounded-full shrink-0 ${isFlowLobbyOpen ? 'bg-warning' : 'bg-text-faint'}`} />
                  <span>{isFlowLobbyOpen ? 'Ẩn Sảnh Flow' : 'Sảnh Electron'}</span>
                </button>

                {/* Nút Hướng Dẫn Sử Dụng */}
                <button
                  type="button"
                  onClick={() => setShowGuide(true)}
                  title="Hướng dẫn sử dụng — quy trình 5 bước cho người mới"
                  className="flex h-8 w-8 items-center justify-center rounded-md border border-border bg-surface-2 text-text-muted hover:text-text hover:bg-surface-3 transition-colors cursor-pointer"
                >
                  <CircleHelp className="h-4 w-4" />
                </button>

                {/* Nút Thêm Tác Vụ Mới */}
                <button
                  type="button"
                  onClick={() => handleSelectFiles('fast-transcribe')}
                  className="btn-primary inline-flex items-center gap-1.5 rounded-md bg-accent hover:bg-accent-hover text-white px-3 py-1.5 text-xs font-medium transition-colors cursor-pointer"
                >
                  <Plus className="h-4 w-4" />
                  <span>Thêm tác vụ mới</span>
                </button>
              </div>
            </header>
          )}

          {/* Banner tiến trình tải video chạy nền khi đang ở các tab khác */}
          {activeDownload && !downloadModalOpen && (
            <div className="flex items-center justify-between border-b border-border bg-surface-2 px-4 py-2 text-xs z-20">
              <div className="flex items-center gap-3 min-w-0">
                <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md border border-border bg-surface-3 text-text-muted">
                  {activeDownload.isDownloading ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin text-accent" />
                  ) : activeDownload.error ? (
                    <AlertCircle className="h-3.5 w-3.5 text-danger" />
                  ) : (
                    <CheckCircle2 className="h-3.5 w-3.5 text-success" />
                  )}
                </div>
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-medium text-text truncate max-w-[280px] md:max-w-[460px]">
                      {activeDownload.title || 'Đang tải video từ liên kết...'}
                    </span>
                    <span className="rounded bg-surface-3 px-1.5 py-0.5 text-[10px] font-medium text-text-muted uppercase border border-border">
                      {activeDownload.platform}
                    </span>
                    {activeDownload.isDownloading && (
                      <span className="text-[11px] font-mono font-medium text-accent">
                        {activeDownload.progress.percent}%
                      </span>
                    )}
                  </div>
                  <div className="flex items-center gap-3 text-[11px] text-text-muted font-mono">
                    <span>{activeDownload.progress.stageDescription || 'Đang tải video chạy nền...'}</span>
                    {activeDownload.progress.speed && <span>• {activeDownload.progress.speed}</span>}
                    {activeDownload.progress.eta && <span>• Còn lại: {activeDownload.progress.eta}</span>}
                  </div>
                </div>
              </div>

              <div className="flex items-center gap-2.5 shrink-0">
                {activeDownload.isDownloading && (
                  <div className="hidden sm:block w-32 h-1 rounded-full bg-surface-3 overflow-hidden">
                    <div
                      className="h-1 bg-accent rounded-full transition-all duration-300"
                      style={{ width: `${activeDownload.progress.percent}%` }}
                    />
                  </div>
                )}
                <button
                  type="button"
                  onClick={() => setDownloadModalOpen(true)}
                  className="btn-secondary inline-flex items-center gap-1.5 rounded-md border border-border bg-surface-3 px-2.5 py-1 text-xs font-medium text-text hover:bg-surface hover:border-border-strong transition-colors cursor-pointer"
                  title="Mở lại hộp thoại tải video"
                >
                  <Maximize2 className="h-3.5 w-3.5 text-text-muted" />
                  <span>Mở chi tiết</span>
                </button>
                {!activeDownload.isDownloading && (
                  <button
                    type="button"
                    onClick={() => backgroundDownloadManager.dismiss()}
                    className="p-1 rounded-md text-text-muted hover:text-text hover:bg-surface-3 transition-colors cursor-pointer"
                    title="Đóng thông báo"
                  >
                    <X className="h-4 w-4" />
                  </button>
                )}
              </div>
            </div>
          )}

          {/* Body Dashboard (2 Columns)
              Các tab luôn mounted, chỉ ẩn bằng CSS — giữ nguyên trạng thái
              (audio đang nghe thử, panel mở, dữ liệu đã tải) khi chuyển tab */}
          <div className={activeTab === 'ai-studio' ? 'flex min-h-0 flex-1 flex-col overflow-hidden' : 'hidden'}>
            <AiStudioWorkspace />
          </div>
          <div className={activeTab === 'workflow' ? 'flex min-h-0 flex-1 flex-col overflow-hidden' : 'hidden'}>
            <WorkflowCanvas
              onNavigateTab={setActiveTab}
              isZenMode={isZenMode}
              onToggleZenMode={setIsZenMode}
              isSidebarCollapsed={isSidebarCollapsed}
              onToggleSidebar={() => setIsSidebarCollapsed((p) => !p)}
            />
          </div>
          <div className={activeTab === 'editor' ? 'flex min-h-0 flex-1 flex-col overflow-hidden' : 'hidden'}>
            <SubtitleEditor
              tasks={tasks}
              selectedTaskId={selectedTaskId}
              onSelectTaskId={setSelectedTaskId}
              onNavigateTab={setActiveTab}
              isActive={activeTab === 'editor'}
            />
          </div>
          <div className={activeTab === 'dubbing' ? 'flex min-h-0 flex-1 flex-col overflow-hidden' : 'hidden'}>
            <TTSPage
              isActive={activeTab === 'dubbing'}
              tasks={tasks}
              selectedTaskId={selectedTaskId}
              onSelectTaskId={setSelectedTaskId}
            />
          </div>
          <div className={activeTab === 'export' ? 'flex min-h-0 flex-1 flex-col overflow-hidden' : 'hidden'}>
            <ExportPage
              tasks={tasks}
              selectedTaskId={selectedTaskId}
              onSelectTaskId={setSelectedTaskId}
            />
          </div>
          <div className={activeTab === 'settings' ? 'flex min-h-0 flex-1 flex-col overflow-hidden' : 'hidden'}>
            <SettingsPage />
          </div>
          <div
            className={
              activeTab === 'subtitles'
                ? 'flex min-h-0 flex-1 flex-col overflow-hidden'
                : 'hidden'
            }
          >
            <ASRWorkspace
              tasks={tasks}
              selectedTaskId={selectedTaskId}
              onSelectTaskId={setSelectedTaskId}
            />
          </div>

          <div
            className={
              activeTab === 'home'
                ? 'grid min-h-0 flex-1 grid-cols-[minmax(0,1fr)_330px] gap-5 overflow-hidden p-6'
                : 'hidden'
            }
          >
            {/* Cột Trái: Drag & Drop & Recent Tasks */}
            <section className="flex flex-col gap-5 overflow-y-auto pr-1">
              {/* Lời chào Hero */}
              <div className="flex items-end justify-between rounded-lg border border-border bg-surface p-4">
                <div>
                  <div className="inline-flex items-center gap-1.5 rounded-md border border-border bg-surface-2 px-2.5 py-1 text-[11px] font-medium text-text-muted">
                    <Sparkles className="h-3 w-3 text-accent" />
                    <span>VanhStudio 2026</span>
                  </div>
                  <h1 className="mt-2 text-xl font-semibold tracking-tight text-text">
                    {greeting}, bắt đầu dự án mới nào!
                  </h1>
                  <p className="mt-1 text-xs text-text-muted">
                    {currentDateStr} · Sẵn sàng tự động hoá quy trình phụ đề và lồng tiếng tiếng Việt
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <span className="rounded-md border border-border bg-surface-2 px-2.5 py-1 text-xs font-medium text-text-muted">
                    <strong className="text-text font-semibold">{tasks.length}</strong> Tác vụ
                  </span>
                  <span className="rounded-md border border-success/30 bg-success/10 px-2.5 py-1 text-xs font-medium text-success">
                    <strong className="font-semibold">{completedCount}</strong> Đã hoàn thành
                  </span>
                </div>
              </div>

              {/* Drag & Drop Zone */}
              <div
                onDragOver={handleDragOver}
                onDragLeave={handleDragLeave}
                onDrop={handleDrop}
                className={[
                  'relative flex flex-col items-center justify-center rounded-lg border border-dashed p-5 text-center transition-colors duration-150',
                  isDragging
                    ? 'border-accent bg-accent-tint'
                    : 'border-border bg-surface hover:bg-surface-2',
                ].join(' ')}
              >
                <div className="flex h-10 w-10 items-center justify-center rounded-md bg-surface-2 border border-border text-text-muted">
                  <UploadCloud className="h-5 w-5 text-accent" />
                </div>
                <h3 className="mt-3 text-sm font-medium text-text">
                  Kéo thả file Video hoặc Audio vào đây
                </h3>
                <p className="mt-1 text-xs text-text-muted">
                  Hỗ trợ MP4, MKV, AVI, MOV, MP3, WAV (Tối đa 2GB) · Tự động phát hiện ngôn ngữ & ASR
                </p>
                <div className="mt-3.5 flex items-center gap-3">
                  <button
                    type="button"
                    onClick={() => handleSelectFiles('fast-transcribe')}
                    className="inline-flex items-center gap-2 rounded-md border border-border bg-surface-2 px-3 py-1.5 text-xs font-medium text-text transition hover:bg-surface-3 cursor-pointer"
                  >
                    <FolderOpen className="h-3.5 w-3.5 text-text-muted" />
                    <span>Duyệt file từ máy tính</span>
                  </button>
                </div>

                {/* Thêm tác vụ từ link video (Douyin, YouTube, Bilibili, TikTok...) */}
                <div className="mt-3 flex w-full max-w-md items-center gap-2">
                  <div className="relative flex-1">
                    <input
                      type="text"
                      value={linkUrl}
                      onChange={(e) => setLinkUrl(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') setDownloadModalOpen(true);
                      }}
                      placeholder="Dán link Douyin, YouTube, Bilibili, TikTok..."
                      className="w-full rounded-md border border-border bg-surface-2 px-3 py-1.5 font-mono text-xs text-text placeholder:text-text-faint focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent/25 transition"
                    />
                  </div>
                  <button
                    type="button"
                    onClick={() => setDownloadModalOpen(true)}
                    title="Tải video độ nét cao từ Douyin, YouTube, Bilibili... và tự động gom vào thư mục dự án"
                    className="inline-flex shrink-0 items-center gap-1.5 rounded-md border border-border bg-surface-2 hover:bg-surface-3 px-3 py-1.5 text-xs font-medium text-text cursor-pointer transition"
                  >
                    <Download className="h-3.5 w-3.5 text-text-muted" />
                    <span>Tải video từ link</span>
                  </button>
                </div>
              </div>

              {/* Recent Tasks List */}
              <div className="rounded-lg border border-border bg-surface p-4">
                <div className="mb-3 flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <h3 className="text-sm font-medium text-text">Tác vụ gần đây</h3>
                    <span className="rounded-md border border-border bg-surface-2 px-2 py-0.5 text-[10px] font-medium text-text-muted">
                      {filteredTasks.length}
                    </span>
                  </div>
                  <div className="flex items-center gap-2">
                    {tasksNeedingPipeline.length > 0 && (
                      <button
                        type="button"
                        onClick={handleRunPipelineBatch}
                        title="Đưa tất cả tác vụ còn việc vào hàng đợi — chạy tối đa 2 tác vụ song song"
                        className="inline-flex items-center gap-1.5 rounded-md border border-accent/30 bg-accent-tint px-2.5 py-1 text-[11px] font-medium text-accent hover:bg-accent/20 cursor-pointer transition"
                      >
                        <Zap className="h-3 w-3" />
                        <span>Chạy batch ({tasksNeedingPipeline.length})</span>
                      </button>
                    )}
                    {tasks.length > 0 && (
                      <button
                        type="button"
                        onClick={loadTasks}
                        className="text-xs font-medium text-text-muted hover:text-text transition flex items-center gap-1 cursor-pointer"
                      >
                        <RefreshCw className="h-3 w-3" />
                        <span>Làm mới</span>
                      </button>
                    )}
                  </div>
                </div>

                {filteredTasks.length === 0 ? (
                  <div className="rounded-md border border-dashed border-border p-6 text-center text-text-faint text-xs">
                    Chưa có tác vụ nào. Hãy kéo thả video hoặc bấm nút thêm tác vụ để bắt đầu!
                  </div>
                ) : (
                  <div className="space-y-1.5">
                    {filteredTasks.map((t) => (
                      <div
                        key={t.id}
                        className="group flex items-center justify-between rounded-md border border-border bg-surface-2 p-2.5 text-xs transition hover:border-border-strong hover:bg-surface-3"
                      >
                        <div className="flex items-center gap-3 min-w-0 flex-1">
                          <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-surface border border-border text-text-muted">
                            <FileVideo className="h-4 w-4" />
                          </div>
                          <div className="min-w-0 flex-1">
                            <div className="truncate font-medium text-text group-hover:text-text">
                              {t.fileName}
                            </div>
                            <div className="mt-0.5 flex flex-wrap items-center gap-2 text-[11px] text-text-muted">
                              <span>{t.fileSize || 'Media file'}</span>
                              <span>•</span>
                              <span>{formatTimeAgoHelper(t.createdAt)}</span>
                              <span>•</span>
                              <span className="text-text font-mono">{t.workflow}</span>
                              {t.projectDir && (
                                <>
                                  <span>•</span>
                                  <span className="inline-flex items-center text-text-muted font-mono text-[10px] bg-surface px-1.5 py-0.5 rounded border border-border">
                                    <Folder className="h-3 w-3 inline text-text-muted mr-1" />
                                    {t.projectDir.split(/[/\\]/).pop()}
                                  </span>
                                </>
                              )}
                            </div>
                          </div>
                        </div>

                        {/* Trạng thái / Tiến trình */}
                        <div className="flex items-center gap-2 shrink-0 pl-3">
                          {t.status === 'done' && (
                            <span className="inline-flex items-center gap-1.5 rounded-md border border-success/30 bg-success/10 px-2.5 py-1 text-[11px] font-medium text-success">
                              <CheckCircle2 className="h-3 w-3" />
                              Đã hoàn thành
                            </span>
                          )}
                          {t.status === 'queued' && !t.srtPath && (
                            <button
                              type="button"
                              onClick={(e) => handleImportSrt(t.id, e)}
                              title="Video đã có phụ đề .srt? Nhập vào để bỏ qua bước phiên âm"
                              className="inline-flex items-center gap-1.5 rounded-md border border-border bg-surface px-2.5 py-1 text-[11px] font-medium text-text-muted hover:bg-surface-3 hover:text-text transition cursor-pointer"
                            >
                              <FileUp className="h-3 w-3" />
                              Nhập SRT
                            </button>
                          )}
                          {t.status === 'queued' && (
                            <button
                              type="button"
                              onClick={(e) => handleStartTask(t.id, e)}
                              className="inline-flex items-center gap-1.5 rounded-md bg-accent px-2.5 py-1 text-[11px] font-medium text-white hover:bg-accent-hover transition cursor-pointer"
                            >
                              <Play className="h-3 w-3 fill-current" />
                              Bắt đầu phiên âm
                            </button>
                          )}
                          {t.status === 'error' && (
                            <button
                              type="button"
                              onClick={(e) => handleStartTask(t.id, e)}
                              className="inline-flex items-center gap-1.5 rounded-md border border-danger/30 bg-danger/10 px-2.5 py-1 text-[11px] font-medium text-danger hover:bg-danger/20 transition cursor-pointer"
                              title={t.errorMessage || 'Lỗi xử lý'}
                            >
                              <RefreshCw className="h-3 w-3" />
                              Thử lại
                            </button>
                          )}
                          {t.status === 'cancelled' && (
                            <button
                              type="button"
                              onClick={(e) => handleStartTask(t.id, e)}
                              className="inline-flex items-center gap-1.5 rounded-md border border-warning/30 bg-warning/10 px-2.5 py-1 text-[11px] font-medium text-warning hover:bg-warning/20 transition cursor-pointer"
                              title="Tác vụ đã bị huỷ — bấm để chạy lại"
                            >
                              <Play className="h-3 w-3 fill-current" />
                              Chạy lại
                            </button>
                          )}
                          {(t.status === 'queued' || (t.status === 'done' && !t.outputPath) || t.status === 'error' || t.status === 'cancelled') && (
                            <button
                              type="button"
                              onClick={(e) => handleRunPipeline(t.id, e)}
                              title="Tự động chạy các bước còn thiếu: phiên âm → dịch → tạo giọng → ghép video (bỏ qua bước đã có kết quả)"
                              className="inline-flex items-center gap-1.5 rounded-md border border-border bg-surface px-2.5 py-1 text-[11px] font-medium text-text hover:bg-surface-3 transition cursor-pointer"
                            >
                              <Zap className="h-3 w-3 text-accent" />
                              Chạy cả quy trình
                            </button>
                          )}
                          {(t.status === 'transcribing' || t.status === 'ocr' || t.status === 'translating' || t.status === 'exporting' || t.status === 'dubbing') && (
                            <div className="flex items-center gap-2">
                              <div className="w-20 rounded-full bg-surface-3 h-1.5 overflow-hidden">
                                <div
                                  className="h-full bg-accent rounded-full transition-all duration-300"
                                  style={{ width: `${t.progress}%` }}
                                />
                              </div>
                              <span className="inline-flex items-center gap-1 text-[11px] font-mono text-accent">
                                <RefreshCw className="h-3 w-3 animate-spin" />
                                {t.progress}%
                              </span>
                              <button
                                type="button"
                                onClick={(e) => handleCancelTask(t.id, e)}
                                className="inline-flex items-center gap-1 rounded-md border border-danger/30 bg-danger/10 px-2 py-0.5 text-[11px] font-medium text-danger hover:bg-danger/20 transition cursor-pointer"
                                title="Dừng tác vụ đang xử lý"
                              >
                                <Square className="h-2.5 w-2.5 fill-current" />
                                Dừng
                              </button>
                            </div>
                          )}

                          <button
                            type="button"
                            onClick={(e) => handleShowInFolder(t.projectDir || t.outputPath || t.filePath, e)}
                            className="flex h-7 w-7 items-center justify-center rounded-md border border-border bg-surface text-text-muted hover:bg-surface-3 hover:text-text transition cursor-pointer"
                            title={t.projectDir ? "Mở thư mục dự án (chứa toàn bộ file video, sub, audio)" : "Mở thư mục chứa file"}
                          >
                            <FolderOpen className="h-3.5 w-3.5" />
                          </button>

                          <button
                            type="button"
                            onClick={(e) => handleDeleteTask(t.id, e)}
                            className="flex h-7 w-7 items-center justify-center rounded-md border border-border bg-surface text-text-muted hover:bg-danger/10 hover:text-danger hover:border-danger/30 transition cursor-pointer"
                            title="Xoá tác vụ"
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </section>

            {/* Cột Phải: Tool Matrix & Quick Utilities */}
            <aside className="flex flex-col gap-4 overflow-y-auto">
              {/* AI Engine Matrix Box */}
              <div className="rounded-lg border border-border bg-surface p-4">
                <div className="mb-3 flex items-center justify-between">
                  <span className="text-xs font-medium uppercase tracking-wider text-text-muted">
                    Cấu hình mô hình
                  </span>
                  <span className="rounded-md bg-success/10 px-2 py-0.5 text-[10px] font-medium text-success border border-success/20">
                    Sẵn sàng
                  </span>
                </div>

                <div className="space-y-2 text-xs">
                  <div className="flex items-center justify-between rounded-md border border-border bg-surface-2 p-2.5">
                    <span className="text-text-muted">Nhận diện ASR</span>
                    <span className="font-medium text-text">Whisper {asrModel}</span>
                  </div>
                  <div className="flex items-center justify-between rounded-md border border-border bg-surface-2 p-2.5">
                    <span className="text-text-muted">Dịch thuật</span>
                    <span className="font-medium text-accent">Gemini Flash API</span>
                  </div>
                  <div className="flex items-center justify-between rounded-md border border-border bg-surface-2 p-2.5">
                    <span className="text-text-muted">Lồng tiếng TTS</span>
                    <span className="font-medium text-text">{defaultTtsLabel}</span>
                  </div>
                </div>
              </div>

              {/* Quick Shortcuts */}
              <div className="rounded-lg border border-border bg-surface p-4">
                <div className="mb-3 flex items-center justify-between">
                  <div className="flex items-center gap-2 text-xs font-medium uppercase tracking-wider text-text-muted">
                    <Keyboard className="h-3.5 w-3.5 text-text-muted" />
                    <span>Phím tắt tiện ích</span>
                  </div>
                  <span className="text-[10px] text-text-faint">Bấm hoặc gõ phím</span>
                </div>
                <div className="space-y-1 text-xs">
                  {SHORTCUTS.map(({ id, label, shortcut }) => (
                    <button
                      key={id}
                      type="button"
                      onClick={() => handleShortcutAction(id)}
                      className="group flex w-full items-center justify-between rounded-md px-2.5 py-1.5 text-left text-text-muted transition hover:bg-surface-2 hover:text-text cursor-pointer"
                      title={`Bấm để kích hoạt (${shortcut})`}
                    >
                      <span className="text-[11px] transition-colors group-hover:text-text">
                        {label}
                      </span>
                      <kbd className="rounded-[4px] border border-border bg-surface-3 px-1.5 py-0.5 text-[10px] font-mono text-text-muted transition group-hover:border-border-strong group-hover:text-text">
                        {shortcut}
                      </kbd>
                    </button>
                  ))}
                </div>
              </div>
            </aside>
          </div>

          {/* Terminal mini: log tiến trình ASR/dịch/TTS/export — nằm ngoài các tab
              nên luôn hiển thị và giữ nguyên nội dung khi chuyển tab */}
          <TerminalPanel />

          {/* Popup hướng dẫn người dùng mới (portal, hiện lần đầu mở app) */}
          <OnboardingModal open={guideReady && showGuide} onClose={handleCloseGuide} />

          {/* Modal tải video từ liên kết Douyin / YouTube / Bilibili / TikTok */}
          <DownloadModal
            open={downloadModalOpen}
            onOpenChange={setDownloadModalOpen}
            initialUrl={linkUrl}
            onSuccess={(task) => {
              setLinkUrl('');
              loadTasks();
              if (task?.id) {
                setSelectedTaskId(task.id);
              }
            }}
          />
          {/* Modal kết nối Chrome Extension Bridge */}
          <ChromeBridgeModal
            isOpen={isChromeBridgeModalOpen}
            onClose={() => setIsChromeBridgeModalOpen(false)}
            isConnected={isChromeBridgeConnected}
            onRefresh={checkChromeBridge}
          />
        </main>
      </div>
    </>
  );
}



