import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import {
  ReactFlow,
  ReactFlowProvider,
  Background,
  Controls,
  MiniMap,
  useReactFlow,
  type NodeTypes,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';

import {
  Play,
  Save,
  Download,
  Upload,
  RotateCcw,
  Sparkles,
  Layers,
  Sliders,
  Maximize2,
  Minimize2,
  FolderOpen,
  Film,
  Coins,
  CheckCircle2,
  AlertCircle,
  Clock,
  ChevronUp,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Users,
  Building,
  Key,
  Settings,
  Undo2,
  Redo2,
  FolderKanban,
} from 'lucide-react';
import { toast } from 'sonner';

import { useWorkflowStore } from '../../lib/store/workflowStore';
import { GenericCategoryNode } from './nodes/GenericCategoryNode';
import NodeLibrary from './NodeLibrary';
import Inspector from './Inspector';
import CharacterBibleModal from './CharacterBibleModal';
import SceneBibleModal from './SceneBibleModal';
import MasterTimeline from './MasterTimeline';
import StoryboardDirectorStudio from './StoryboardDirectorStudio';
import ApiKeyConfigModal from './ApiKeyConfigModal';
import WorkflowManagerModal from './WorkflowManagerModal';
import { WORKFLOW_PRESETS } from '../../lib/workflow/presets';
import { NODE_DEFINITIONS } from '../../lib/workflow/nodeRegistry';
import { calculateGraphCreditEstimate } from '../../lib/workflow/creditCalculator';

function GoogleIcon({ className = 'w-4 h-4' }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24">
      <path
        fill="#4285F4"
        d="M23.745 12.27c0-.7-.06-1.4-.19-2.07H12v4.51h6.6c-.29 1.52-1.14 2.82-2.4 3.68v3.05h3.88c2.27-2.09 3.66-5.17 3.66-9.17z"
      />
      <path
        fill="#34A853"
        d="M12 24c3.24 0 5.95-1.08 7.93-2.91l-3.88-3.05c-1.08.72-2.45 1.16-4.05 1.16-3.12 0-5.77-2.1-6.72-4.93H1.24v3.15C3.26 21.4 7.33 24 12 24z"
      />
      <path
        fill="#FBBC05"
        d="M5.28 14.27c-.25-.72-.38-1.49-.38-2.27s.13-1.55.38-2.27V6.58H1.24C.45 8.16 0 9.98 0 12s.45 3.84 1.24 5.42l4.04-3.15z"
      />
      <path
        fill="#EA4335"
        d="M12 4.75c1.77 0 3.35.61 4.6 1.8l3.42-3.42C17.95 1.19 15.24 0 12 0 7.33 0 3.26 2.6 1.24 6.58l4.04 3.15c.95-2.83 3.6-4.98 6.72-4.98z"
      />
    </svg>
  );
}

const nodeTypes: NodeTypes = {
  genericNode: GenericCategoryNode,
};

export interface WorkflowCanvasProps {
  onNavigateTab?: (tab: string) => void;
  isZenMode?: boolean;
  onToggleZenMode?: (zen: boolean) => void;
  isSidebarCollapsed?: boolean;
  onToggleSidebar?: () => void;
}

function FlowCanvasInner({
  onNavigateTab,
  isZenMode = false,
  onToggleZenMode,
  isSidebarCollapsed,
  onToggleSidebar,
}: WorkflowCanvasProps) {
  const reactFlowWrapper = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const { screenToFlowPosition } = useReactFlow();

  const nodes = useWorkflowStore((s) => s.nodes);
  const edges = useWorkflowStore((s) => s.edges);
  const graphId = useWorkflowStore((s) => s.graphId);
  const graphName = useWorkflowStore((s) => s.graphName);
  const setGraphName = useWorkflowStore((s) => s.setGraphName);
  const onNodesChange = useWorkflowStore((s) => s.onNodesChange);
  const onEdgesChange = useWorkflowStore((s) => s.onEdgesChange);
  const onConnect = useWorkflowStore((s) => s.onConnect);
  const setSelectedNodeId = useWorkflowStore((s) => s.setSelectedNodeId);
  const selectedNodeId = useWorkflowStore((s) => s.selectedNodeId);
  const updateNodeConfig = useWorkflowStore((s) => s.updateNodeConfig);
  const addNode = useWorkflowStore((s) => s.addNode);
  const loadPreset = useWorkflowStore((s) => s.loadPreset);
  const clearCanvas = useWorkflowStore((s) => s.clearCanvas);
  const exportGraphJson = useWorkflowStore((s) => s.exportGraphJson);
  const importGraphJson = useWorkflowStore((s) => s.importGraphJson);
  const updateNodeRuntime = useWorkflowStore((s) => s.updateNodeRuntime);
  const runtimeMap = useWorkflowStore((s) => s.runtimeMap);
  const savedWorkflows = useWorkflowStore((s) => s.savedWorkflows);
  const saveCurrentWorkflow = useWorkflowStore((s) => s.saveCurrentWorkflow);
  const loadSavedWorkflow = useWorkflowStore((s) => s.loadSavedWorkflow);
  const takeSnapshot = useWorkflowStore((s) => s.takeSnapshot);
  const undo = useWorkflowStore((s) => s.undo);
  const redo = useWorkflowStore((s) => s.redo);
  const canUndo = useWorkflowStore((s) => s.canUndo);
  const canRedo = useWorkflowStore((s) => s.canRedo);

  const [showWorkflowManager, setShowWorkflowManager] = useState(false);
  const [showLibrary, setShowLibrary] = useState(true);
  const [showInspector, setShowInspector] = useState(true);
  const [isRunning, setIsRunning] = useState(false);
  const [showQueueDrawer, setShowQueueDrawer] = useState(false);
  const [queueHeight, setQueueHeight] = useState<number>(() => {
    if (typeof window !== 'undefined') {
      const saved = localStorage.getItem('vanhsub_workflow_queue_height');
      if (saved) {
        const parsed = parseInt(saved, 10);
        if (!isNaN(parsed) && parsed >= 140 && parsed <= 650) return parsed;
      }
    }
    return 240;
  });
  const [isQueueMaximized, setIsQueueMaximized] = useState(false);
  const [isQueueDragging, setIsQueueDragging] = useState(false);
  const queueDragStartY = useRef(0);
  const queueDragStartHeight = useRef(240);

  const [activePresetId, setActivePresetId] = useState(WORKFLOW_PRESETS[0].id);
  const [showCharacterBible, setShowCharacterBible] = useState(false);
  const [showSceneBible, setShowSceneBible] = useState(false);
  const [showTimeline, setShowTimeline] = useState(true);
  const [showStudio, setShowStudio] = useState(false);
  const [showApiKeyModal, setShowApiKeyModal] = useState(false);
  const [hasGeminiKey, setHasGeminiKey] = useState(false);
  const [veoMode, setVeoMode] = useState<'free_session' | 'api_key' | 'simulation'>('free_session');
  const [veoSessionStatus, setVeoSessionStatus] = useState<string>('unknown');
  const [veoEmail, setVeoEmail] = useState<string | null>(null);
  const [isBridgeConnected, setIsBridgeConnected] = useState(false);
  const statusRequestRunning = useRef(false);
  const [isOpeningGoogle, setIsOpeningGoogle] = useState(false);

  // Kiểm tra key & Veo status hiện tại
  const checkVeoStatus = useCallback(async () => {
    if (statusRequestRunning.current) return;
    statusRequestRunning.current = true;
    try {
    if (typeof window !== 'undefined' && window.vanhsub?.veo?.status) {
      try {
        const [res, bridge] = await Promise.all([
          window.vanhsub.veo.status(),
          window.vanhsub.veo.bridgeStatus().catch(() => ({ connected: false })),
        ]);
        setIsBridgeConnected(bridge.connected);
        if (res.mode) setVeoMode(res.mode);
        if (res.sessionStatus) setVeoSessionStatus(res.sessionStatus);
        setVeoEmail(res.email || null);
      } catch { setIsBridgeConnected(false); setVeoSessionStatus('unknown'); setVeoEmail(null); }
    }
    } finally { statusRequestRunning.current = false; }
  }, []);

  useEffect(() => {
    if (typeof window !== 'undefined' && window.vanhsub?.settings) {
      window.vanhsub.settings
        .get('geminiApiKey')
        .then((k) => setHasGeminiKey(Boolean(typeof k === 'string' && k.trim())))
        .catch(() => setHasGeminiKey(false));
    }
  }, []);

  const handleOpenGoogleLogin = async () => {
    setIsOpeningGoogle(true);
    try {
      if (typeof window !== 'undefined' && window.vanhsub?.veo?.openLobby) {
        await window.vanhsub.veo.openLobby();
        toast.info('Đang mở cửa sổ đăng nhập Google. Hãy hoàn tất đăng nhập tài khoản Google của bạn.');
        setTimeout(() => {
          checkVeoStatus();
        }, 3000);
      } else {
        setShowApiKeyModal(true);
      }
    } catch (err: any) {
      toast.error('Lỗi khi mở đăng nhập Google: ' + (err?.message || err));
    } finally {
      setIsOpeningGoogle(false);
    }
  };

  const handleQueueResizeStart = (e: React.MouseEvent) => {
    e.preventDefault();
    setIsQueueDragging(true);
    queueDragStartY.current = e.clientY;
    queueDragStartHeight.current = queueHeight;
  };

  useEffect(() => {
    if (!isQueueDragging) return;

    const handleMouseMove = (e: MouseEvent) => {
      const deltaY = queueDragStartY.current - e.clientY;
      const newHeight = Math.min(Math.max(queueDragStartHeight.current + deltaY, 140), 650);
      setQueueHeight(newHeight);
      if (isQueueMaximized) setIsQueueMaximized(false);
    };

    const handleMouseUp = () => {
      setIsQueueDragging(false);
      setQueueHeight((h) => {
        try {
          localStorage.setItem('vanhsub_workflow_queue_height', String(h));
        } catch {}
        return h;
      });
    };

    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);
    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
    };
  }, [isQueueDragging, isQueueMaximized]);

  useEffect(() => {
    checkVeoStatus();
    // Like the header, refresh after pairing/reconnect without reopening Workflow AI.
    const timer = setInterval(checkVeoStatus, 3000);
    window.addEventListener('focus', checkVeoStatus);
    return () => { clearInterval(timer); window.removeEventListener('focus', checkVeoStatus); };
  }, [checkVeoStatus]);

  // Thoát Zen Mode bằng phím Escape
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && isZenMode) {
        if (onToggleZenMode) onToggleZenMode(false);
        setShowLibrary(true);
        setShowInspector(true);
        setShowTimeline(true);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isZenMode, onToggleZenMode]);

  // Phím tắt Canvas: Ctrl+Z (Undo) và Ctrl+Y / Ctrl+Shift+Z (Redo)
  // Tuyệt đối không can thiệp khi đang gõ chữ trong input, textarea hoặc contenteditable
  useEffect(() => {
    const handleCanvasShortcuts = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      if (
        target &&
        (target.tagName === 'INPUT' ||
          target.tagName === 'TEXTAREA' ||
          target.isContentEditable ||
          target.getAttribute('contenteditable') === 'true')
      ) {
        return;
      }

      // Ctrl+Z hoặc Meta+Z (Undo)
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z' && !e.shiftKey) {
        e.preventDefault();
        const state = useWorkflowStore.getState();
        if (state.canUndo) {
          state.undo();
          toast.info('Đã hoàn tác (Undo)');
        }
        return;
      }

      // Ctrl+Y hoặc Meta+Y hoặc Ctrl+Shift+Z (Redo)
      if (
        (e.ctrlKey || e.metaKey) &&
        (e.key.toLowerCase() === 'y' || (e.key.toLowerCase() === 'z' && e.shiftKey))
      ) {
        e.preventDefault();
        const state = useWorkflowStore.getState();
        if (state.canRedo) {
          state.redo();
          toast.info('Đã làm lại (Redo)');
        }
        return;
      }
    };

    window.addEventListener('keydown', handleCanvasShortcuts);
    return () => window.removeEventListener('keydown', handleCanvasShortcuts);
  }, []);

  // Lắng nghe sự kiện thực thi node từ Electron backend realtime
  useEffect(() => {
    if (typeof window !== 'undefined' && window.vanhsub?.workflow?.onNodeEvent) {
      const unsubscribe = window.vanhsub.workflow.onNodeEvent((event) => {
        updateNodeRuntime(event.nodeId, {
          status: event.status,
          progress: event.progress,
          thumbnailUrl: event.thumbnailUrl,
          outputUrl: event.outputUrl,
          outputData: event.outputData,
          error: event.error,
          durationMs: event.durationMs,
        });

        if (event.outputData?.taskId) {
          toast.success('Đã đưa video vào Sub Mode thành công!');
        }
      });
      return unsubscribe;
    }
  }, [updateNodeRuntime]);

  // Tính toán ước tính chi phí render sơ bộ & Credits (Mục 8 đặc tả & Credit Calculator)
  const estimatedStats = useMemo(() => {
    return calculateGraphCreditEstimate(nodes);
  }, [nodes]);

  // Dynamic neutral edges with active accent highlight on running/selected connections
  const styledEdges = useMemo(() => {
    return edges.map((edge) => {
      const isSourceRunning = runtimeMap[edge.source]?.status === 'running';
      const isTargetRunning = runtimeMap[edge.target]?.status === 'running';
      const isSelected = edge.selected || edge.source === selectedNodeId || edge.target === selectedNodeId;
      const isActive = isSourceRunning || isTargetRunning || isSelected;

      return {
        ...edge,
        style: {
          stroke: isActive ? '#4f8cff' : '#26262b',
          strokeWidth: isActive ? 2 : 1.5,
          ...edge.style,
          ...(isActive ? { stroke: '#4f8cff' } : {}),
        },
        animated: edge.animated || isSourceRunning || isTargetRunning,
      };
    });
  }, [edges, runtimeMap, selectedNodeId]);

  // Kéo thả Node từ Library vào Canvas
  const onDragOver = useCallback((event: React.DragEvent) => {
    event.preventDefault();
    event.dataTransfer.dropEffect = 'move';
  }, []);

  const onDrop = useCallback(
    (event: React.DragEvent) => {
      event.preventDefault();
      const nodeType = event.dataTransfer.getData('application/reactflow');
      if (!nodeType) return;

      const position = screenToFlowPosition({
        x: event.clientX,
        y: event.clientY,
      });

      addNode(nodeType, position);
      toast.success(`Đã thêm ${NODE_DEFINITIONS[nodeType]?.label || nodeType}`);
    },
    [screenToFlowPosition, addNode]
  );

  // Xuất file JSON
  const handleExportJson = () => {
    const jsonStr = exportGraphJson();
    const blob = new Blob([jsonStr], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${graphName.replace(/\s+/g, '_')}_workflow.json`;
    a.click();
    URL.revokeObjectURL(url);
    toast.success('Đã xuất cấu hình Workflow JSON');
  };

  // Nhập file JSON
  const handleImportJson = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (event) => {
      const content = event.target?.result as string;
      if (content) {
        const success = importGraphJson(content);
        if (success) {
          toast.success('Đã nạp Workflow thành công');
        } else {
          toast.error('Tệp JSON không hợp lệ hoặc cấu trúc graph bị lỗi');
        }
      }
    };
    reader.readAsText(file);
    e.target.value = '';
  };

  // Chạy đồ thị DAG qua backend Execution Engine (Phase 2)
  const handleRunWorkflow = async () => {
    if (nodes.length === 0) {
      toast.error('Canvas đang trống! Hãy kéo node vào trước khi chạy.');
      return;
    }

    // Thông báo trạng thái Google Flow / Veo
    const hasVeoNode = nodes.some((n) => n.data?.nodeType === 'google-flow-video');
    if (hasVeoNode && veoMode === 'free_session') {
      if (!isBridgeConnected && (veoSessionStatus === 'expired' || veoSessionStatus === 'unauthenticated')) {
        toast.warning(
          'Chưa kết nối phiên Google Flow. Kết nối Chrome Bridge hoặc chọn API có quyền truy cập trước khi tạo video.',
          { duration: 6000 }
        );
      }
    }

    setIsRunning(true);
    if (estimatedStats.totalCredits > 0) {
      toast.info(
        `Bắt đầu chạy Workflow (${estimatedStats.modelCount} node AI). Dự kiến tiêu tốn: ~${estimatedStats.totalCredits} Credits (~$${estimatedStats.totalCostUsd} USD)`
      );
    } else {
      toast.info('Bắt đầu khởi chạy đồ thị DAG...');
    }

    // Reset status của toàn bộ nodes sang queued
    for (const node of nodes) {
      updateNodeRuntime(node.id, { status: 'queued', progress: 0 });
    }

    if (typeof window !== 'undefined' && window.vanhsub?.workflow?.run) {
      try {
        const res = await window.vanhsub.workflow.run({
          id: graphId,
          name: graphName,
          nodes,
          edges,
        });

        if (res.success) {
          toast.success('Đã hoàn thành toàn bộ các node trong Workflow!');
        } else {
          toast.error(res.error || 'Có lỗi xảy ra trong quá trình thực thi!');
        }
      } catch (err: any) {
        toast.error(`Lỗi thực thi: ${err?.message || err}`);
      } finally {
        setIsRunning(false);
      }
    } else {
      // Fallback mô phỏng nếu không có backend Electron
      for (let i = 0; i < nodes.length; i++) {
        const node = nodes[i];
        updateNodeRuntime(node.id, { status: 'running', progress: 30 });
        await new Promise((r) => setTimeout(r, 600));
        updateNodeRuntime(node.id, { status: 'running', progress: 80 });
        await new Promise((r) => setTimeout(r, 600));
        updateNodeRuntime(node.id, {
          status: 'success',
          progress: 100,
          thumbnailUrl:
            node.data.category === 'model' || node.data.category === 'output'
              ? 'https://images.unsplash.com/photo-1578632767115-351597cf2477?auto=format&fit=crop&w=600&q=80'
              : undefined,
        });
      }
      setIsRunning(false);
      toast.success('Đã hoàn thành toàn bộ các node trong Workflow!');
    }
  };

  return (
    <div className="w-full h-full flex flex-col bg-bg text-text overflow-hidden select-none">
      {/* Top Navigation Toolbar */}
      <header className="h-12 shrink-0 border-b border-border bg-surface px-4 flex items-center justify-between gap-2.5 z-10 overflow-x-auto custom-scrollbar min-w-0">
        {/* Left: Workflow Title & Preset Picker */}
        <div className="flex items-center gap-2.5 shrink-0">
          <div className="flex items-center gap-2">
            <div className="p-1.5 rounded-md bg-surface-2 border border-border text-accent">
              <Layers className="w-3.5 h-3.5" />
            </div>
            <input
              type="text"
              value={graphName}
              onChange={(e) => setGraphName(e.target.value)}
              className="bg-transparent border-b border-transparent hover:border-border focus:border-accent font-semibold text-xs text-text px-1 py-0.5 focus:outline-none transition-colors w-40 lg:w-48 truncate"
              title="Nhấp để đổi tên Workflow"
            />
          </div>

          <div className="h-4 w-[1px] bg-border" />

          {/* Template Presets Picker */}
          <div className="flex items-center gap-2">
            <span className="text-xs text-text-muted hidden sm:inline">Mẫu:</span>
            <select
              value={activePresetId}
              onChange={(e) => {
                const id = e.target.value;
                setActivePresetId(id);
                if (id.startsWith('saved_')) {
                  const savedId = id.replace('saved_', '');
                  loadSavedWorkflow(savedId);
                  toast.success('Đã tải workflow đã lưu');
                } else {
                  loadPreset(id);
                  toast.success('Đã tải mẫu workflow mới');
                }
              }}
              className="text-xs rounded-md bg-surface-2 border border-border px-2.5 py-1 text-text focus:outline-none focus:border-accent cursor-pointer"
            >
              {savedWorkflows.length > 0 && (
                <optgroup label="Workflow đã lưu của bạn">
                  {savedWorkflows.map((sw) => (
                    <option key={sw.id} value={`saved_${sw.id}`} className="bg-surface-2 text-text">
                      {sw.name}
                    </option>
                  ))}
                </optgroup>
              )}
              <optgroup label="Mẫu tích hợp sẵn">
                {WORKFLOW_PRESETS.map((preset) => (
                  <option key={preset.id} value={preset.id} className="bg-surface-2 text-text">
                    {preset.name}
                  </option>
                ))}
              </optgroup>
            </select>

            <button
              onClick={() => setShowWorkflowManager(true)}
              title="Quản lý danh sách Workflow đã lưu & Thùng rác (Xoá, Khôi phục)"
              className="flex items-center gap-1.5 px-2.5 py-1 rounded-md bg-surface-2 hover:bg-surface-3 border border-border text-xs font-medium text-text hover:text-text transition-colors cursor-pointer shrink-0"
            >
              <FolderKanban className="w-3.5 h-3.5 text-text-muted" />
              <span className="hidden md:inline">Quản lý</span>
            </button>
          </div>

          <div className="h-4 w-[1px] bg-border hidden sm:block" />

          {/* Consistency Bibles (Character & Scene) */}
          <button
            onClick={() => setShowCharacterBible(true)}
            title="Mở Character Bible (Hồ sơ Nhân vật)"
            className="flex items-center gap-1.5 px-2.5 py-1 rounded-md bg-surface-2 hover:bg-surface-3 border border-border text-xs font-medium text-text hover:text-text transition-colors shrink-0 cursor-pointer"
          >
            <Users className="w-3.5 h-3.5 text-text-muted" />
            <span className="hidden lg:inline">Character Bible</span>
          </button>

          <button
            onClick={() => setShowSceneBible(true)}
            title="Mở Scene Bible (Bối cảnh Không gian)"
            className="flex items-center gap-1.5 px-2.5 py-1 rounded-md bg-surface-2 hover:bg-surface-3 border border-border text-xs font-medium text-text hover:text-text transition-colors shrink-0 cursor-pointer"
          >
            <Building className="w-3.5 h-3.5 text-text-muted" />
            <span className="hidden lg:inline">Scene Bible</span>
          </button>

          <button
            onClick={() => setShowTimeline(!showTimeline)}
            title="Bật/Tắt Master Timeline (Thanh Dựng Phim)"
            className={`flex items-center gap-1.5 px-2.5 py-1 rounded-md border text-xs font-medium transition-colors shrink-0 cursor-pointer ${
              showTimeline
                ? 'bg-surface-3 border-accent text-accent'
                : 'bg-surface-2 border-border text-text-muted hover:text-text'
            }`}
          >
            <Film className="w-3.5 h-3.5" />
            <span className="hidden lg:inline">Timeline</span>
          </button>

          <button
            onClick={() => setShowStudio(true)}
            title="Mở Storyboard Director Studio (Giao diện Đạo diễn 3 bước chuẩn)"
            className="flex items-center gap-1.5 px-2.5 py-1 rounded-md bg-surface-2 hover:bg-surface-3 border border-border text-xs font-medium text-text hover:text-text transition-colors shrink-0 cursor-pointer"
          >
            <Sparkles className="w-3.5 h-3.5 text-accent" />
            <span className="hidden lg:inline">Storyboard Studio</span>
          </button>
        </div>

        {/* Center: Estimated Render Cost & Credits (Mục 8 đặc tả & Credit Calculator) */}
        {estimatedStats.modelCount > 0 && (
          <div className="hidden xl:flex items-center gap-2 px-3 py-1 rounded-md bg-surface-2 border border-border text-xs text-text shrink-0">
            <Coins className="w-3.5 h-3.5 text-warning" />
            <span className="text-text-muted">Dự tính:</span>
            <span className="font-medium font-mono text-warning">~{estimatedStats.totalCredits} Credits</span>
            <span className="text-text-muted font-mono">(~${estimatedStats.totalCostUsd})</span>
            <span className="text-text-faint">•</span>
            <span className="text-text-muted">{estimatedStats.videoSeconds}s ({estimatedStats.modelCount} nodes)</span>
          </div>
        )}

        {/* Right: Actions (Save, Export, Import, Run) */}
        <div className="flex items-center gap-2 shrink-0">
          <input
            type="file"
            ref={fileInputRef}
            onChange={handleImportJson}
            accept=".json"
            className="hidden"
          />

          <button
            onClick={() => {
              saveCurrentWorkflow();
              toast.success(`Đã lưu workflow "${graphName}" thành công!`);
            }}
            title="Lưu workflow hiện tại vào bộ nhớ máy"
            className="flex items-center gap-1.5 px-3 py-1 rounded-md bg-surface-2 hover:bg-surface-3 border border-border text-xs font-medium text-text hover:text-text transition-colors cursor-pointer"
          >
            <Save className="w-3.5 h-3.5 text-text-muted" />
            <span className="hidden sm:inline">Lưu</span>
          </button>

          <button
            onClick={() => fileInputRef.current?.click()}
            title="Nhập Workflow từ file JSON"
            className="flex items-center gap-1.5 px-2.5 py-1 rounded-md bg-surface-2 hover:bg-surface-3 border border-border text-xs font-medium text-text hover:text-text transition-colors"
          >
            <Upload className="w-3.5 h-3.5 text-text-muted" />
            <span className="hidden sm:inline">Nhập</span>
          </button>

          <button
            onClick={handleExportJson}
            title="Xuất Workflow ra file JSON"
            className="flex items-center gap-1.5 px-2.5 py-1 rounded-md bg-surface-2 hover:bg-surface-3 border border-border text-xs font-medium text-text hover:text-text transition-colors"
          >
            <Download className="w-3.5 h-3.5 text-text-muted" />
            <span className="hidden sm:inline">Xuất</span>
          </button>

          {/* Canvas Undo / Redo */}
          <div className="flex items-center bg-surface-2 p-0.5 rounded-md border border-border">
            <button
              onClick={() => {
                if (canUndo) {
                  undo();
                  toast.info('Đã hoàn tác (Undo)');
                }
              }}
              disabled={!canUndo}
              title="Hoàn tác thay đổi canvas (Ctrl+Z)"
              className={`p-1 rounded transition-colors ${
                canUndo
                  ? 'text-text hover:bg-surface-3 hover:text-text cursor-pointer'
                  : 'text-text-faint cursor-not-allowed opacity-40'
              }`}
            >
              <Undo2 className="w-3.5 h-3.5" />
            </button>
            <button
              onClick={() => {
                if (canRedo) {
                  redo();
                  toast.info('Đã làm lại (Redo)');
                }
              }}
              disabled={!canRedo}
              title="Làm lại thay đổi canvas (Ctrl+Y hoặc Ctrl+Shift+Z)"
              className={`p-1 rounded transition-colors ${
                canRedo
                  ? 'text-text hover:bg-surface-3 hover:text-text cursor-pointer'
                  : 'text-text-faint cursor-not-allowed opacity-40'
              }`}
            >
              <Redo2 className="w-3.5 h-3.5" />
            </button>
          </div>

          <button
            onClick={clearCanvas}
            title="Xóa toàn bộ node trên canvas"
            className="p-1.5 rounded-md bg-surface-2 hover:bg-surface-3 border border-border hover:border-danger/40 text-text-muted hover:text-danger transition-colors cursor-pointer"
          >
            <RotateCcw className="w-3.5 h-3.5" />
          </button>

          <div className="h-4 w-[1px] bg-border" />

          {/* Google Login / Veo Session Integration */}
          <div className="flex items-center gap-1.5 bg-surface-2 p-0.5 rounded-md border border-border">
            {veoMode === 'free_session' ? (
              isBridgeConnected || veoSessionStatus === 'active' ? (
                <button
                  onClick={() => setShowApiKeyModal(true)}
                  title={isBridgeConnected ? 'Chrome Bridge đã xác thực. Quyền tạo media được kiểm tra riêng khi chạy.' : `Phiên Google (${veoEmail || 'đã lưu'}). Nhấn để quản lý.`}
                  className="flex items-center gap-1.5 px-2 py-1 rounded bg-surface hover:bg-surface-3 border border-border text-text text-xs font-medium transition-colors cursor-pointer"
                >
                  <GoogleIcon className="w-3.5 h-3.5" />
                  <span className="w-1.5 h-1.5 rounded-full bg-success shrink-0" />
                  <span className="max-w-[110px] truncate text-[11px]">
                    {isBridgeConnected ? 'Chrome: Đã kết nối' : veoEmail ? veoEmail.split('@')[0] : 'Phiên Google'}
                  </span>
                </button>
              ) : (
                <button
                  onClick={handleOpenGoogleLogin}
                  disabled={isOpeningGoogle}
                  title="Đăng nhập tài khoản Google để kích hoạt Google Veo Free"
                  className="flex items-center gap-1.5 px-2.5 py-1 rounded bg-accent hover:bg-accent-hover text-white text-xs font-medium transition-colors cursor-pointer active:scale-95"
                >
                  <GoogleIcon className="w-3.5 h-3.5 bg-white p-0.5 rounded-full shrink-0" />
                  <span>{isOpeningGoogle ? 'Đang mở...' : 'Đăng nhập Google'}</span>
                </button>
              )
            ) : veoMode === 'api_key' ? (
              <button
                onClick={() => setShowApiKeyModal(true)}
                title="Cấu hình Google Gemini API Key"
                className={`flex items-center gap-1.5 px-2 py-1 rounded border text-xs font-medium transition-colors cursor-pointer ${
                  hasGeminiKey
                    ? 'bg-surface hover:bg-surface-3 border-border text-text'
                    : 'bg-surface hover:bg-surface-3 border-warning/40 text-warning'
                }`}
              >
                <Key className="w-3 h-3 text-text-muted" />
                <span className="text-[11px]">
                  {hasGeminiKey ? 'Gemini Key: OK' : 'Cần Gemini Key'}
                </span>
              </button>
            ) : (
              <button
                onClick={() => setShowApiKeyModal(true)}
                title="Chế độ mô phỏng Veo không cần tài khoản"
                className="flex items-center gap-1.5 px-2 py-1 rounded bg-surface hover:bg-surface-3 border border-border text-text text-xs font-medium cursor-pointer"
              >
                <span className="w-1.5 h-1.5 rounded-full bg-text-muted" />
                <span className="text-[11px]">Veo Mô phỏng</span>
              </button>
            )}

            {/* Quick Settings button to open modal & switch modes */}
            <button
              onClick={() => setShowApiKeyModal(true)}
              title="Cài đặt cấu hình AI (Google Session / API Key / Chế độ)"
              className="p-1 rounded hover:bg-surface-3 text-text-muted hover:text-text transition-colors cursor-pointer"
            >
              <Settings className="w-3.5 h-3.5" />
            </button>
          </div>

          {/* Toggle Sidebars */}
          <button
            onClick={() => setShowLibrary((prev) => !prev)}
            title="Ẩn/Hiện Thư viện Node"
            className={`px-2.5 py-1 rounded-md border text-xs font-medium transition-colors cursor-pointer ${
              showLibrary
                ? 'bg-surface-3 border-accent text-accent'
                : 'bg-surface-2 border-border text-text-muted hover:text-text'
            }`}
          >
            Thư viện
          </button>

          <button
            onClick={() => setShowInspector((prev) => !prev)}
            title="Ẩn/Hiện Bảng Điều khiển"
            className={`px-2.5 py-1 rounded-md border text-xs font-medium transition-colors cursor-pointer ${
              showInspector
                ? 'bg-surface-3 border-accent text-accent'
                : 'bg-surface-2 border-border text-text-muted hover:text-text'
            }`}
          >
            Thuộc tính
          </button>

          {/* Zen Focus Mode Button */}
          <button
            onClick={() => {
              const nextZen = !isZenMode;
              if (onToggleZenMode) onToggleZenMode(nextZen);
              if (nextZen) {
                setShowLibrary(false);
                setShowInspector(false);
                setShowTimeline(false);
                setShowQueueDrawer(false);
                toast.info('Đã bật Focus Canvas (Bấm Esc hoặc nút góc phải để thoát)');
              } else {
                setShowLibrary(true);
                setShowInspector(true);
                setShowTimeline(true);
              }
            }}
            title={isZenMode ? 'Thoát Toàn Màn Hình Canvas (Esc)' : 'Toàn màn hình Canvas (Zen Mode)'}
            className={`p-1.5 rounded-md border text-xs font-medium transition-colors cursor-pointer ${
              isZenMode
                ? 'bg-accent border-accent text-white'
                : 'bg-surface-2 border-border text-text-muted hover:text-text'
            }`}
          >
            {isZenMode ? <Minimize2 className="w-3.5 h-3.5" /> : <Maximize2 className="w-3.5 h-3.5" />}
          </button>

          {/* Primary Run / Cancel Button */}
          {isRunning ? (
            <div className="flex items-center gap-1.5">
              <span className="flex items-center gap-1.5 px-3 py-1 rounded-md bg-surface-2 border border-warning/40 text-warning text-xs font-medium">
                <Clock className="w-3.5 h-3.5 animate-spin" />
                <span>Đang render...</span>
              </span>
              <button
                onClick={async () => {
                  if (typeof window !== 'undefined' && window.vanhsub?.workflow?.cancel) {
                    await window.vanhsub.workflow.cancel(graphId);
                    toast.info('Đã gửi yêu cầu hủy render workflow');
                  }
                  setIsRunning(false);
                  for (const node of nodes) {
                    const st = runtimeMap[node.id]?.status;
                    if (st === 'running' || st === 'queued') {
                      updateNodeRuntime(node.id, { status: 'idle', progress: 0, error: 'Đã hủy bởi người dùng' });
                    }
                  }
                }}
                className="px-2.5 py-1 rounded-md bg-danger/10 hover:bg-danger/20 border border-danger/40 text-danger text-xs font-medium transition-colors cursor-pointer active:scale-95"
                title="Hủy quá trình render hiện tại"
              >
                Hủy
              </button>
            </div>
          ) : (
            <button
              onClick={handleRunWorkflow}
              title={
                estimatedStats.totalCredits > 0
                  ? `Khởi chạy toàn bộ đồ thị DAG (${estimatedStats.modelCount} node AI). Dự kiến tiêu tốn: ~${estimatedStats.totalCredits} Credits (~$${estimatedStats.totalCostUsd} USD).`
                  : 'Khởi chạy toàn bộ đồ thị DAG'
              }
              className="flex items-center gap-1.5 px-3 py-1 rounded-md bg-accent hover:bg-accent-hover text-white text-xs font-medium shadow-none transition-colors active:scale-95 cursor-pointer"
            >
              <Play className="w-3.5 h-3.5 fill-current" />
              <span>Chạy Workflow</span>
              {estimatedStats.totalCredits > 0 && (
                <span className="px-1.5 py-0.2 rounded bg-black/20 font-mono text-[10px] text-white/90 border border-white/20">
                  ~{estimatedStats.totalCredits} Cr
                </span>
              )}
            </button>
          )}
        </div>
      </header>

      {/* Main Work Area: Library | Canvas | Inspector */}
      <div className="flex-1 flex overflow-hidden relative">
        {/* Left Sidebar: Node Library with Edge Toggle Handle */}
        {showLibrary ? (
          <div className="relative flex shrink-0 h-full">
            <NodeLibrary onClose={() => setShowLibrary(false)} />
            <button
              onClick={() => setShowLibrary(false)}
              className="absolute -right-3 top-1/2 -translate-y-1/2 z-20 w-5 h-10 bg-surface border border-border hover:border-accent rounded-r-md flex items-center justify-center text-text-muted hover:text-text transition-colors cursor-pointer shadow-none"
              title="Thu gọn Thư viện Node (Ẩn panel)"
            >
              <ChevronLeft className="w-3 h-3" />
            </button>
          </div>
        ) : (
          <button
            onClick={() => setShowLibrary(true)}
            className="absolute left-0 top-1/2 -translate-y-1/2 z-20 px-1 py-3 bg-surface hover:bg-surface-2 border border-l-0 border-border hover:border-border-strong rounded-r-md flex items-center gap-1 text-text-muted hover:text-text text-xs font-medium transition-colors group cursor-pointer shadow-none"
            title="Mở rộng Thư viện Node"
          >
            <ChevronRight className="w-3.5 h-3.5 text-text-muted group-hover:text-text group-hover:translate-x-0.5 transition-transform" />
            <span className="[writing-mode:vertical-lr] tracking-widest text-[10px] py-1 text-text-muted group-hover:text-text">
              THƯ VIỆN
            </span>
          </button>
        )}

        {/* Central Graph Canvas */}
        <div ref={reactFlowWrapper} className="flex-1 h-full relative">
          {/* Zen Mode Exit Floating Button */}
          {isZenMode && (
            <div className="absolute top-4 right-4 z-30 flex items-center gap-2">
              <button
                onClick={() => {
                  if (onToggleZenMode) onToggleZenMode(false);
                  setShowLibrary(true);
                  setShowInspector(true);
                  setShowTimeline(true);
                }}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-md bg-surface-2 hover:bg-surface-3 text-text text-xs font-medium transition-colors border border-border cursor-pointer shadow-none"
              >
                <Minimize2 className="w-3.5 h-3.5 text-text-muted" />
                <span>Thoát Toàn màn hình (Esc)</span>
              </button>
            </div>
          )}

          <ReactFlow
            nodes={nodes}
            edges={styledEdges}
            nodeTypes={nodeTypes}
            onNodesChange={onNodesChange}
            onEdgesChange={onEdgesChange}
            onConnect={onConnect}
            onNodeDragStop={() => takeSnapshot()}
            onNodeClick={(_, node) => setSelectedNodeId(node.id)}
            onPaneClick={() => setSelectedNodeId(null)}
            onDragOver={onDragOver}
            onDrop={onDrop}
            fitView
            fitViewOptions={{ padding: 0.2 }}
            minZoom={0.2}
            maxZoom={2.5}
            defaultViewport={{ x: 0, y: 0, zoom: 0.85 }}
            deleteKeyCode={['Backspace', 'Delete']}
            connectionLineStyle={{ stroke: '#4f8cff', strokeWidth: 1.5 }}
            defaultEdgeOptions={{ style: { stroke: '#26262b', strokeWidth: 1.5 } }}
            className="bg-bg"
          >
            <Background color="#26262b" gap={20} size={1} />
            <Controls className="!bg-surface !border !border-border !rounded-md !shadow-none [&>button]:!bg-surface [&>button]:!border-border [&>button]:!text-text-muted [&>button:hover]:!bg-surface-2 [&>button:hover]:!text-text [&>button]:!fill-current" />
            <MiniMap
              nodeColor={(n) => {
                const nodeData = n.data as any;
                if (nodeData?.category === 'model') return '#4f8cff';
                if (nodeData?.category === 'input') return '#3fb950';
                if (nodeData?.category === 'output') return '#d29922';
                if (nodeData?.category === 'consistency') return '#f85149';
                if (nodeData?.category === 'editing') return '#4f8cff';
                return '#5c5c64';
              }}
              maskColor="rgba(14, 14, 16, 0.75)"
              className="!bg-surface !border !border-border !rounded-md !shadow-none overflow-hidden"
            />
          </ReactFlow>

          {/* Canvas Bottom Overlay: Node Stats & Quick Controls */}
          <div className="absolute bottom-4 left-4 z-10 flex items-center gap-2 bg-surface/95 px-3 py-1.5 rounded-md border border-border text-xs text-text-muted shadow-none">
            <span className="flex items-center gap-1.5">
              <span className="w-2 h-2 rounded-full bg-success" />
              <span className="text-text">{nodes.length} Nodes</span>
            </span>
            <span className="text-text-faint">•</span>
            <span>{edges.length} Kết nối</span>
            <span className="text-text-faint">•</span>
            <button
              onClick={() => setShowQueueDrawer((p) => !p)}
              className="text-accent hover:text-accent-hover font-medium flex items-center gap-1 cursor-pointer transition-colors"
            >
              <span>Hàng đợi Render</span>
              {showQueueDrawer ? <ChevronDown className="w-3 h-3" /> : <ChevronUp className="w-3 h-3" />}
            </button>
          </div>
        </div>

        {/* Right Sidebar: Inspector with Edge Toggle Handle */}
        {showInspector ? (
          <div className="relative flex shrink-0 h-full">
            <button
              onClick={() => setShowInspector(false)}
              className="absolute -left-3 top-1/2 -translate-y-1/2 z-20 w-5 h-10 bg-surface border border-border hover:border-accent rounded-l-md flex items-center justify-center text-text-muted hover:text-text transition-colors cursor-pointer shadow-none"
              title="Thu gọn Bảng Điều khiển (Ẩn panel)"
            >
              <ChevronRight className="w-3 h-3" />
            </button>
            <Inspector onClose={() => setShowInspector(false)} />
          </div>
        ) : (
          <button
            onClick={() => setShowInspector(true)}
            className="absolute right-0 top-1/2 -translate-y-1/2 z-20 px-1 py-3 bg-surface hover:bg-surface-2 border border-r-0 border-border hover:border-border-strong rounded-l-md flex items-center gap-1 text-text-muted hover:text-text text-xs font-medium transition-colors group cursor-pointer shadow-none"
            title="Mở rộng Bảng Điều khiển (Thuộc tính)"
          >
            <span className="[writing-mode:vertical-lr] tracking-widest text-[10px] py-1 text-text-muted group-hover:text-text">
              THUỘC TÍNH
            </span>
            <ChevronLeft className="w-3.5 h-3.5 text-text-muted group-hover:text-text group-hover:-translate-x-0.5 transition-transform" />
          </button>
        )}
      </div>

      {/* Bottom Queue Panel (Mục 4.1 đặc tả: Job Queue status) */}
      {showQueueDrawer && (
        <div
          style={{ height: isQueueMaximized ? '65vh' : `${queueHeight}px` }}
          className="border-t border-border bg-surface p-3 flex flex-col z-20 relative"
        >
          {/* Top Resize Handle */}
          <div
            onMouseDown={handleQueueResizeStart}
            className="absolute top-0 left-0 right-0 h-2 cursor-ns-resize hover:bg-accent/20 transition-colors flex items-center justify-center group z-30 select-none"
            title="Kéo chuột lên/xuống để chỉnh độ cao Hàng đợi & Lịch sử"
          >
            <div className="w-12 h-1 rounded-full bg-surface-3 group-hover:bg-accent transition-colors" />
          </div>

          <div className="flex items-center justify-between pb-2 pt-1 border-b border-border text-xs shrink-0">
            <div className="flex items-center gap-2">
              <Clock className="w-4 h-4 text-accent" />
              <span className="font-semibold text-text">Hàng đợi Render & Nhật ký Thực thi</span>
              <span className="px-2 py-0.5 rounded-md bg-surface-2 border border-border text-text-muted text-[10px] font-mono">
                BullMQ + Redis Ready
              </span>
              <span className="text-text-muted text-[10px]">
                ({nodes.length} nodes)
              </span>
              {estimatedStats.totalCredits > 0 && (
                <span className="px-2 py-0.5 rounded-md bg-warning/10 border border-warning/30 text-warning text-[10px] font-mono font-medium">
                  Tổng dự tính: ~{estimatedStats.totalCredits} Credits (~${estimatedStats.totalCostUsd})
                </span>
              )}
            </div>
            <div className="flex items-center gap-2">
              <button
                onClick={() => setIsQueueMaximized((prev) => !prev)}
                className="p-1 rounded hover:bg-surface-2 text-text-muted hover:text-text transition-colors cursor-pointer"
                title={isQueueMaximized ? 'Thu nhỏ về độ cao mặc định' : 'Phóng to bảng hàng đợi'}
              >
                {isQueueMaximized ? (
                  <Minimize2 className="w-3.5 h-3.5" />
                ) : (
                  <Maximize2 className="w-3.5 h-3.5" />
                )}
              </button>
              <button
                onClick={() => setShowQueueDrawer(false)}
                className="text-text-muted hover:text-text text-xs px-1.5 py-0.5 rounded hover:bg-surface-2 transition-colors cursor-pointer"
              >
                Đóng ▼
              </button>
            </div>
          </div>

          <div className="flex-1 overflow-y-auto pt-2 space-y-1.5 font-mono text-[11px] custom-scrollbar">
            {nodes.length === 0 ? (
              <div className="py-8 text-center text-text-muted italic text-xs">
                Chưa có node nào trên Canvas. Thêm node từ thư viện để bắt đầu.
              </div>
            ) : (
              nodes.map((node) => {
                const r = node.data.runtime || { status: 'idle' };
                return (
                  <div
                    key={node.id}
                    className="flex items-center justify-between px-2.5 py-1.5 rounded-md bg-surface-2 border border-border text-text hover:bg-surface-3 transition-colors"
                  >
                    <div className="flex items-center gap-2">
                      <span className="text-accent font-semibold">{node.id}</span>
                      <span className="text-text-muted">({node.data.label})</span>
                    </div>
                    <div className="flex items-center gap-2">
                      {r.status === 'idle' && <span className="text-text-muted">Chưa chạy</span>}
                      {r.status === 'queued' && <span className="text-accent">Đang chờ queue...</span>}
                      {r.status === 'running' && (
                        <span className="text-warning flex items-center gap-1">
                          <Clock className="w-3 h-3 animate-spin" /> Đang chạy ({r.progress}%)
                        </span>
                      )}
                      {r.status === 'success' && <span className="text-success font-medium">✓ Hoàn tất</span>}
                      {r.status === 'failed' && (
                        <span className="text-danger flex items-center gap-1" title={r.error}>
                          ✗ Thất bại {r.error ? `(${r.error})` : ''}
                        </span>
                      )}
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </div>
      )}

      {/* Master Timeline & Dựng Phim (Phase 4) */}
      {showTimeline && (
        <MasterTimeline
          nodes={nodes}
          nodeRuntime={runtimeMap}
          onSelectNode={(nodeId) => setSelectedNodeId(nodeId)}
          onSendToSubMode={(videoPath, taskName) => {
            if (typeof window !== 'undefined' && window.vanhsub?.tasks?.create) {
              window.vanhsub.tasks.create({
                fileName: taskName || 'Master Sequence từ Workflow',
                filePath: videoPath,
                workflow: 'full-dubbing',
              }).then(() => {
                toast.success('Đã đưa video vào Sub Mode thành công!');
                if (onNavigateTab) onNavigateTab('home');
              });
            } else {
              toast.success('Đã chọn video cho Sub Mode: ' + videoPath);
              if (onNavigateTab) onNavigateTab('home');
            }
          }}
        />
      )}

      {/* Storyboard Director Studio (Phase 6 Simple Mode) */}
      {showStudio && (
        <StoryboardDirectorStudio
          onCloseStudio={() => setShowStudio(false)}
          onSendToSubMode={(videoPath, taskName) => {
            if (typeof window !== 'undefined' && window.vanhsub?.tasks?.create) {
              window.vanhsub.tasks.create({
                fileName: taskName || 'Master Video từ Storyboard',
                filePath: videoPath,
                workflow: 'full-dubbing',
              }).then(() => {
                toast.success('Đã đưa video vào Sub Mode thành công!');
                setShowStudio(false);
                if (onNavigateTab) onNavigateTab('home');
              });
            } else {
              toast.success('Đã chọn video cho Sub Mode: ' + videoPath);
              setShowStudio(false);
              if (onNavigateTab) onNavigateTab('home');
            }
          }}
          onSyncToCanvasGraph={() => {
            toast.success('Đã đồng bộ Storyboard sang Node Canvas!');
            setShowStudio(false);
          }}
        />
      )}

      {/* Character Bible & Scene Bible Modals */}
      <CharacterBibleModal
        isOpen={showCharacterBible}
        onClose={() => setShowCharacterBible(false)}
        onSelectCharacter={(char) => {
          if (selectedNodeId) {
            const node = nodes.find((n) => n.id === selectedNodeId);
            if (node && (node.data.nodeType === 'character-ref' || node.data.nodeType === 'character-lock')) {
              updateNodeConfig(node.id, 'characterName', char.name);
              updateNodeConfig(node.id, 'description', char.description);
              updateNodeConfig(node.id, 'gender', char.gender);
              if (char.ageGroup) updateNodeConfig(node.id, 'ageGroup', char.ageGroup);
              if (char.referenceImages?.[0]) updateNodeConfig(node.id, 'referenceImageUrl', char.referenceImages[0]);
              toast.success(`Đã đồng bộ nhân vật "${char.name}" vào node!`);
              return;
            }
          }
          const existingCharNode = nodes.find((n) => n.data.nodeType === 'character-ref');
          if (existingCharNode) {
            updateNodeConfig(existingCharNode.id, 'characterName', char.name);
            updateNodeConfig(existingCharNode.id, 'description', char.description);
            updateNodeConfig(existingCharNode.id, 'gender', char.gender);
            if (char.ageGroup) updateNodeConfig(existingCharNode.id, 'ageGroup', char.ageGroup);
            if (char.referenceImages?.[0]) updateNodeConfig(existingCharNode.id, 'referenceImageUrl', char.referenceImages[0]);
            setSelectedNodeId(existingCharNode.id);
            toast.success(`Đã cập nhật nhân vật "${char.name}" vào Node "${existingCharNode.data.label || 'Nhân vật'}"!`);
          } else {
            addNode('character-ref', { x: 100, y: 350 });
            toast.success(`Đã thêm Node Nhân vật "${char.name}" vào Canvas!`);
          }
        }}
      />
      <SceneBibleModal
        isOpen={showSceneBible}
        onClose={() => setShowSceneBible(false)}
        onSelectScene={(scene) => {
          if (selectedNodeId) {
            const node = nodes.find((n) => n.id === selectedNodeId);
            if (node && (node.data.nodeType === 'scene-ref' || node.data.nodeType === 'scene-continuity')) {
              updateNodeConfig(node.id, 'sceneName', scene.name);
              updateNodeConfig(node.id, 'description', scene.description);
              updateNodeConfig(node.id, 'environment', scene.environment);
              updateNodeConfig(node.id, 'lightingMood', scene.lightingMood);
              if (scene.colorPalette) updateNodeConfig(node.id, 'colorPalette', scene.colorPalette);
              toast.success(`Đã đồng bộ bối cảnh "${scene.name}" vào node!`);
              return;
            }
          }
          const existingSceneNode = nodes.find((n) => n.data.nodeType === 'scene-ref');
          if (existingSceneNode) {
            updateNodeConfig(existingSceneNode.id, 'sceneName', scene.name);
            updateNodeConfig(existingSceneNode.id, 'description', scene.description);
            updateNodeConfig(existingSceneNode.id, 'environment', scene.environment);
            updateNodeConfig(existingSceneNode.id, 'lightingMood', scene.lightingMood);
            if (scene.colorPalette) updateNodeConfig(existingSceneNode.id, 'colorPalette', scene.colorPalette);
            setSelectedNodeId(existingSceneNode.id);
            toast.success(`Đã cập nhật bối cảnh "${scene.name}" vào Node!`);
          } else {
            addNode('scene-ref', { x: 100, y: 550 });
            toast.success(`Đã thêm Node Bối cảnh "${scene.name}" vào Canvas!`);
          }
        }}
      />

      {/* Google Veo 3.1 & Gemini API Key Modal */}
      <ApiKeyConfigModal
        isOpen={showApiKeyModal}
        onClose={() => {
          setShowApiKeyModal(false);
          checkVeoStatus();
        }}
        onKeyUpdated={() => checkVeoStatus()}
      />

      {/* Quản lý danh sách Workflow & Thùng rác (Xoá mềm, Khôi phục, Xoá vĩnh viễn) */}
      <WorkflowManagerModal
        isOpen={showWorkflowManager}
        onClose={() => setShowWorkflowManager(false)}
      />
    </div>
  );
}

export default function WorkflowCanvas({
  onNavigateTab,
  isZenMode,
  onToggleZenMode,
  isSidebarCollapsed,
  onToggleSidebar,
}: WorkflowCanvasProps) {
  return (
    <ReactFlowProvider>
      <FlowCanvasInner
        onNavigateTab={onNavigateTab}
        isZenMode={isZenMode}
        onToggleZenMode={onToggleZenMode}
        isSidebarCollapsed={isSidebarCollapsed}
        onToggleSidebar={onToggleSidebar}
      />
    </ReactFlowProvider>
  );
}
