import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertCircle,
  CheckCircle2,
  Crosshair,
  FileVideo,
  Globe2,
  GripVertical,
  KeyRound,
  Languages,
  ListPlus,
  Loader2,
  MessageSquareText,
  Plus,
  Redo2,
  RefreshCw,
  Scissors,
  Sparkles,
  Trash2,
  Undo2,
  Wand2,
  XCircle,
  GitMerge,
  Filter,
} from 'lucide-react';
import type { Task } from '../types/task';
import { formatMs, parseSrt, parseTimecode, serializeSrt, type SrtLine } from '../lib/srt';
import { calculateCps, breakVietnameseLines, splitLineSmart } from '../lib/nlpSegmenter';
import { sanitizeSubtitles, isOcrGarbageLine, isLineUntranslated } from '../lib/subtitleSanitizer';
import { subscribeVideoPreviewClock } from '../lib/videoPreviewClock';

type Props = {
  tasks: Task[];
  selectedTaskId?: string | null;
  onSelectTaskId?: (id: string | null) => void;
  onNavigateTab?: (tab: string) => void;
  isActive?: boolean;
};

let lineSeq = 0;
const EDITOR_PAGE_SIZE = 100;

function makeLineId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return `line-${crypto.randomUUID()}`;
  }
  return `line-${Date.now()}-${++lineSeq}-${Math.random().toString(36).slice(2, 8)}`;
}

/** Ô nhập thời gian: cho phép gõ tự do, chỉ commit giá trị hợp lệ khi blur/Enter. */
function TimeField({ valueMs, onChangeMs }: { valueMs: number; onChangeMs: (ms: number) => void }) {
  const [draft, setDraft] = useState(formatMs(valueMs));
  const [focused, setFocused] = useState(false);

  useEffect(() => {
    if (!focused) setDraft(formatMs(valueMs));
  }, [valueMs, focused]);

  const commit = () => {
    const parsed = parseTimecode(draft);
    if (parsed !== null) onChangeMs(parsed);
  };

  return (
    <input
      type="text"
      value={focused ? draft : formatMs(valueMs)}
      onFocus={(e) => {
        setFocused(true);
        setDraft(formatMs(valueMs));
        requestAnimationFrame(() => e.target.select());
      }}
      onBlur={() => {
        setFocused(false);
        commit();
      }}
      onChange={(e) => setDraft(e.target.value)}
      onKeyDown={(e) => {
        if (e.key === 'Enter') {
          commit();
          (e.target as HTMLInputElement).blur();
        }
      }}
      className="w-[104px] rounded bg-bg px-1.5 py-0.5 text-[11px] text-text border border-border font-mono focus:border-accent/40 focus:outline-none"
    />
  );
}

function NudgeButton({ label, onClick, title }: { label: string; onClick: () => void; title: string }) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={title}
      className="inline-flex h-5 min-w-[26px] items-center justify-center rounded border border-border bg-surface-2 px-1 text-[9px] font-mono text-text hover:bg-surface-3 hover:text-white cursor-pointer"
    >
      {label}
    </button>
  );
}

function TimeRow({
  label,
  valueMs,
  onChangeMs,
  onSyncVideo,
}: {
  label: string;
  valueMs: number;
  onChangeMs: (ms: number) => void;
  onSyncVideo: () => void;
}) {
  return (
    <div className="flex items-center gap-1.5">
      <span className="w-10 shrink-0 text-[10px] font-semibold uppercase tracking-wide text-text-muted">
        {label}
      </span>
      <TimeField valueMs={valueMs} onChangeMs={onChangeMs} />
      <NudgeButton label="-1s" title="Lùi 1 giây" onClick={() => onChangeMs(Math.max(0, valueMs - 1000))} />
      <NudgeButton label="-0.1" title="Lùi 0.1 giây" onClick={() => onChangeMs(Math.max(0, valueMs - 100))} />
      <NudgeButton label="+0.1" title="Thêm 0.1 giây" onClick={() => onChangeMs(valueMs + 100)} />
      <NudgeButton label="+1s" title="Thêm 1 giây" onClick={() => onChangeMs(valueMs + 1000)} />
      <button
        type="button"
        onClick={onSyncVideo}
        title="Gán bằng thời điểm phát hiện tại của video"
        className="inline-flex h-5 w-5 items-center justify-center rounded border border-accent/40 bg-accent-tint text-accent hover:bg-accent-tint/25 cursor-pointer"
      >
        <Crosshair className="h-3 w-3" />
      </button>
    </div>
  );
}

const TARGET_LANGUAGES = [
  { code: 'vi', label: 'Tiếng Việt' },
  { code: 'en', label: 'English' },
  { code: 'ja', label: '日本語 (Nhật)' },
  { code: 'ko', label: '한국어 (Hàn)' },
  { code: 'zh', label: '中文 (Trung)' },
];

export default function SubtitleEditor({
  tasks,
  selectedTaskId: controlledTaskId,
  onSelectTaskId,
  onNavigateTab,
  isActive = true,
}: Props) {
  const [internalTaskId, setInternalTaskId] = useState<string | null>(null);
  const selectedTaskId = controlledTaskId !== undefined ? controlledTaskId : internalTaskId;

  const setSelectedTaskId = (id: string | null) => {
    if (onSelectTaskId) onSelectTaskId(id);
    else setInternalTaskId(id);
  };

  const [lines, setLines] = useState<SrtLine[]>([]);
  const [editorPage, setEditorPage] = useState(0);
  const pageCount = Math.max(1, Math.ceil(lines.length / EDITOR_PAGE_SIZE));
  const pageStart = Math.min(editorPage, pageCount - 1) * EDITOR_PAGE_SIZE;
  const [loading, setLoading] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [statusMessage, setStatusMessage] = useState('');
  const [statusError, setStatusError] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);

  // Kéo thả sắp xếp vị trí câu phụ đề
  const [draggedIndex, setDraggedIndex] = useState<number | null>(null);
  const [dragOverIndex, setDragOverIndex] = useState<number | null>(null);
  const [dragOverPosition, setDragOverPosition] = useState<'above' | 'below'>('below');
  const [newlyAddedId, setNewlyAddedId] = useState<string | null>(null);

  // Dịch thuật & Đối chiếu song ngữ
  const [targetLanguage, setTargetLanguage] = useState('vi');
  const [showBilingual, setShowBilingual] = useState(true);
  const [originalLines, setOriginalLines] = useState<SrtLine[]>([]);
  const [glossary, setGlossary] = useState('');

  // Trình xem trước video
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const currentTimeMsRef = useRef(0);
  const [currentTimeMs, setCurrentTimeMs] = useState(0);
  const [durationMs, setDurationMs] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const activeRowRef = useRef<HTMLDivElement | null>(null);

  // AI (Gemini)
  const [aiBusyIndex, setAiBusyIndex] = useState<number | null>(null);
  const [aiActionType, setAiActionType] = useState<'polish' | 'translate' | null>(null);
  const [hasApiKey, setHasApiKey] = useState(false);
  const [geminiModelName, setGeminiModelName] = useState('gemini-3.8-flash');
  const [keyDraft, setKeyDraft] = useState('');
  const [showKeyInput, setShowKeyInput] = useState(false);
  const [savingKey, setSavingKey] = useState(false);
  const [isCleaningSubtitles, setIsCleaningSubtitles] = useState(false);

  // Nguồn SRT đang hiệu đính
  const [srtSource, setSrtSource] = useState<'original' | 'translated' | 'overlay_original' | 'overlay_translated'>('original');
  const prevTaskIdRef = useRef<string | null>(null);
  const prevTranslatedSrtPathRef = useRef<string | undefined>(undefined);
  const prevTranslatedOverlaySrtPathRef = useRef<string | undefined>(undefined);

  const selectedTask = tasks.find((t) => t.id === selectedTaskId) || null;
  const isTranslating = selectedTask?.status === 'translating';
  const hasTranslatedSrt = !!selectedTask?.translatedSrtPath;
  const hasOriginalSrt = !!selectedTask?.srtPath;
  const hasOverlayOriginalSrt = !!selectedTask?.overlaySrtPath;
  const hasOverlayTranslatedSrt = !!selectedTask?.translatedOverlaySrtPath;
  const isOverlayTrack = srtSource === 'overlay_original' || srtSource === 'overlay_translated';
  const isTranslatedView = srtSource === 'translated' || srtSource === 'overlay_translated';
  const hasActiveOriginal = isOverlayTrack ? hasOverlayOriginalSrt : hasOriginalSrt;
  const hasActiveTranslated = isOverlayTrack ? hasOverlayTranslatedSrt : hasTranslatedSrt;
  const referenceSrtPath = isOverlayTrack ? selectedTask?.overlaySrtPath : selectedTask?.srtPath;

  const mediaUrl = useMemo(() => {
    if (!selectedTask?.filePath) return '';
    return `vanhmedia://local/${encodeURIComponent(selectedTask.filePath)}`;
  }, [selectedTask]);

  const activeIndex = useMemo(
    () => lines.findIndex((l) => currentTimeMs >= l.startMs && currentTimeMs < l.endMs),
    [lines, currentTimeMs]
  );

  useEffect(() => {
    const video = videoRef.current;
    if (!video || !isActive) return;
    return subscribeVideoPreviewClock(video, (timeMs) => {
      currentTimeMsRef.current = timeMs;
      setCurrentTimeMs(timeMs);
    });
  }, [isActive, mediaUrl, hasOriginalSrt]);

  const detectedGarbageCount = useMemo(() => {
    if (lines.length === 0) return 0;
    return lines.filter((l) => isOcrGarbageLine(l)).length;
  }, [lines]);

  // R4: Phát hiện danh sách các dòng chưa được dịch (trùng nội dung câu gốc) khi xem bản dịch
  const untranslatedIndices = useMemo(() => {
    if (!isTranslatedView || lines.length === 0 || originalLines.length === 0) {
      return [];
    }
    const list: number[] = [];
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const orig =
        originalLines.find((o) => o.id === line.id)?.text ??
        originalLines[i]?.text ??
        originalLines.find((o) => Math.abs(o.startMs - line.startMs) < 1000)?.text;
      if (!orig || !orig.trim() || !line.text || !line.text.trim()) continue;
      if (isLineUntranslated(orig, line.text, glossary)) {
        list.push(i);
      }
    }
    return list;
  }, [isTranslatedView, lines, originalLines, glossary]);

  // File SRT đang mở: thoại gốc/dịch hoặc overlay gốc/dịch
  const activeSrtPath = useMemo(() => {
    if (!selectedTask) return '';
    if (srtSource === 'translated' && selectedTask.translatedSrtPath) {
      return selectedTask.translatedSrtPath;
    }
    if (srtSource === 'overlay_translated' && selectedTask.translatedOverlaySrtPath) {
      return selectedTask.translatedOverlaySrtPath;
    }
    if (srtSource === 'overlay_original' && selectedTask.overlaySrtPath) {
      return selectedTask.overlaySrtPath;
    }
    return selectedTask.srtPath || selectedTask.overlaySrtPath || '';
  }, [selectedTask, srtSource]);

  // Tự chọn task đầu tiên có SRT nếu chưa chọn task nào
  useEffect(() => {
    if (!selectedTaskId && tasks.length > 0) {
      const firstWithSrt = tasks.find((t) => t.srtPath || t.overlaySrtPath);
      if (firstWithSrt) setSelectedTaskId(firstWithSrt.id);
    }
  }, [tasks, selectedTaskId]);

  // Khi tab được kích hoạt lại (chuyển sang tab Hiệu đính) và không có thay đổi dở: tự làm mới để nhận thay đổi từ tab khác
  useEffect(() => {
    if (isActive && !dirty) {
      setReloadKey((k) => k + 1);
    }
  }, [isActive]);

  // Chỉ khởi tạo srtSource mặc định khi ĐỔI sang một task khác hoặc khi vừa dịch xong
  useEffect(() => {
    if (selectedTaskId !== prevTaskIdRef.current) {
      prevTaskIdRef.current = selectedTaskId;
      prevTranslatedSrtPathRef.current = selectedTask?.translatedSrtPath;
      prevTranslatedOverlaySrtPathRef.current = selectedTask?.translatedOverlaySrtPath;
      if (selectedTask?.translatedSrtPath) {
        setSrtSource('translated');
      } else if (selectedTask?.srtPath) {
        setSrtSource('original');
      } else if (selectedTask?.translatedOverlaySrtPath) {
        setSrtSource('overlay_translated');
      } else if (selectedTask?.overlaySrtPath) {
        setSrtSource('overlay_original');
      } else {
        setSrtSource('original');
      }
      return;
    }

    // Nếu cùng task nhưng bản dịch vừa hoàn thành
    if (!prevTranslatedSrtPathRef.current && selectedTask?.translatedSrtPath) {
      prevTranslatedSrtPathRef.current = selectedTask.translatedSrtPath;
      if (!isOverlayTrack) {
        setSrtSource('translated');
      }
      setReloadKey((k) => k + 1);
      setStatusMessage('Bản dịch AI đã hoàn tất! Đã tự động chuyển sang xem bản dịch.');
    } else if (!prevTranslatedOverlaySrtPathRef.current && selectedTask?.translatedOverlaySrtPath) {
      prevTranslatedOverlaySrtPathRef.current = selectedTask.translatedOverlaySrtPath;
      if (isOverlayTrack) {
        setSrtSource('overlay_translated');
      }
      setReloadKey((k) => k + 1);
      setStatusMessage('Đã dịch xong file bảng/thông tin (overlay)!');
    } else {
      prevTranslatedSrtPathRef.current = selectedTask?.translatedSrtPath;
      prevTranslatedOverlaySrtPathRef.current = selectedTask?.translatedOverlaySrtPath;
    }
  }, [selectedTaskId, selectedTask?.translatedSrtPath, selectedTask?.translatedOverlaySrtPath, selectedTask?.srtPath, selectedTask?.overlaySrtPath, isOverlayTrack]);

  const handleTaskChange = (newTaskId: string | null) => {
    if (newTaskId === selectedTaskId) return;
    if (dirty && !window.confirm('Có thay đổi phụ đề chưa lưu. Bạn có chắc muốn đổi tác vụ? Thay đổi chưa lưu sẽ mất.')) {
      return;
    }
    setSelectedTaskId(newTaskId);
  };

  const handleSourceChange = (src: 'original' | 'translated' | 'overlay_original' | 'overlay_translated') => {
    if (src === srtSource) return;
    if (dirty && !window.confirm('Thay đổi chưa lưu của file đang mở sẽ mất khi đổi nguồn. Tiếp tục?')) {
      return;
    }
    setSrtSource(src);
  };

  // Kiểm tra Gemini API key & model đã lưu
  useEffect(() => {
    if (typeof window === 'undefined' || !window.vanhsub?.settings) return;
    Promise.all([
      window.vanhsub.settings.get('geminiApiKey'),
      window.vanhsub.settings.get('geminiModel'),
    ])
      .then(([keyVal, modelVal]) => {
        setHasApiKey(!!(keyVal && String(keyVal).trim()));
        setKeyDraft(keyVal ? String(keyVal) : '');
        if (modelVal) setGeminiModelName(String(modelVal));
      })
      .catch(() => setHasApiKey(false));

    window.vanhsub.settings
      .get('targetLanguage')
      .then((v: string) => {
        if (v) setTargetLanguage(v);
      })
      .catch(() => {});

    window.vanhsub.settings
      .get('glossary')
      .then((g: string) => {
        if (g) setGlossary(g);
      })
      .catch(() => {});
  }, []);

  // Tải file gốc để đối chiếu khi ở chế độ bản dịch (hỗ trợ cả thoại và overlay)
  useEffect(() => {
    if (!referenceSrtPath) {
      setOriginalLines([]);
      return;
    }
    let cancelled = false;
    window.vanhsub.tasks
      .readSrt(referenceSrtPath)
      .then((content) => {
        if (cancelled) return;
        setOriginalLines(parseSrt(content));
      })
      .catch(() => {
        if (!cancelled) setOriginalLines([]);
      });

    return () => {
      cancelled = true;
    };
  }, [referenceSrtPath, reloadKey]);

  // Tải SRT khi đổi tác vụ, đổi nguồn hoặc khi reloadKey tăng
  useEffect(() => {
    if (!selectedTaskId || !activeSrtPath) {
      setLines([]);
      return;
    }

    let cancelled = false;
    setLoading(true);
    setStatusError(false);
    setStatusMessage('Đang tải file SRT...');
    const sourceLabel =
      srtSource === 'translated'
        ? 'Bản dịch'
        : srtSource === 'overlay_translated'
          ? 'Bảng/Overlay (Dịch)'
          : srtSource === 'overlay_original'
            ? 'Bảng/Overlay (Gốc)'
            : 'Bản gốc';
    window.vanhsub.tasks
      .readSrt(activeSrtPath)
      .then((content) => {
        if (cancelled) return;
        const parsed = parseSrt(content);
        setLines(parsed);
        undoStackRef.current = [];
        redoStackRef.current = [];
        setCanUndo(false);
        setCanRedo(false);
        setDirty(false);
        setLoading(false);
        setStatusMessage(`Đã nạp ${parsed.length} dòng phụ đề (${sourceLabel})`);
      })
      .catch((err: any) => {
        if (cancelled) return;
        setLoading(false);
        setStatusError(true);
        setStatusMessage('Không thể đọc file SRT: ' + (err?.message || err));
      });

    return () => {
      cancelled = true;
    };
  }, [selectedTaskId, activeSrtPath, srtSource, reloadKey]);

  // Tự cuộn tới dòng đang phát
  useEffect(() => { setEditorPage(0); }, [selectedTaskId, activeSrtPath]);
  useEffect(() => { setEditorPage(page => Math.min(page, pageCount - 1)); }, [pageCount]);
  useEffect(() => {
    if (activeIndex >= 0 && isPlaying) setEditorPage(Math.floor(activeIndex / EDITOR_PAGE_SIZE));
  }, [activeIndex, isPlaying]);
  useEffect(() => {
    if (activeIndex >= 0 && isPlaying) {
      activeRowRef.current?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    }
  }, [activeIndex, isPlaying, editorPage]);

  // Ngăn xếp Undo / Redo cho thao tác biên tập phụ đề
  const undoStackRef = useRef<SrtLine[][]>([]);
  const redoStackRef = useRef<SrtLine[][]>([]);
  const [canUndo, setCanUndo] = useState(false);
  const [canRedo, setCanRedo] = useState(false);
  const lastUndoPushTimeRef = useRef<number>(0);

  const pushUndo = (currentLines: SrtLine[], force = false) => {
    const now = Date.now();
    if (!force && now - lastUndoPushTimeRef.current < 800) {
      return;
    }
    lastUndoPushTimeRef.current = now;
    undoStackRef.current = [...undoStackRef.current.slice(-50), currentLines];
    redoStackRef.current = [];
    setCanUndo(true);
    setCanRedo(false);
  };

  const handleUndo = () => {
    if (undoStackRef.current.length === 0) return;
    const previous = undoStackRef.current.pop()!;
    redoStackRef.current.push(lines);
    setLines(previous);
    setDirty(true);
    setCanUndo(undoStackRef.current.length > 0);
    setCanRedo(true);
    setStatusMessage('Đã hoàn tác (Undo).');
  };

  const handleRedo = () => {
    if (redoStackRef.current.length === 0) return;
    const next = redoStackRef.current.pop()!;
    undoStackRef.current.push(lines);
    setLines(next);
    setDirty(true);
    setCanUndo(true);
    setCanRedo(redoStackRef.current.length > 0);
    setStatusMessage('Đã làm lại (Redo).');
  };

  // Phím tắt Undo (Ctrl+Z) và Redo (Ctrl+Y / Ctrl+Shift+Z)
  useEffect(() => {
    if (!isActive) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      const activeEl = document.activeElement;
      const isTyping = activeEl && (activeEl.tagName === 'INPUT' || activeEl.tagName === 'TEXTAREA');

      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') {
        if (!e.shiftKey) {
          if (!isTyping) {
            e.preventDefault();
            handleUndo();
          }
        } else {
          e.preventDefault();
          handleRedo();
        }
      } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'y') {
        if (!isTyping) {
          e.preventDefault();
          handleRedo();
        }
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isActive, lines]);

  const updateLine = (index: number, patch: Partial<SrtLine>) => {
    pushUndo(lines, false);
    setLines((prev) => prev.map((line, i) => (i === index ? { ...line, ...patch } : line)));
    setDirty(true);
  };

  const deleteLine = (index: number) => {
    pushUndo(lines, true);
    setLines((prev) => prev.filter((_, i) => i !== index));
    setDirty(true);
  };

  const addLine = () => {
    setEditorPage(Math.floor(lines.length / EDITOR_PAGE_SIZE));
    pushUndo(lines, true);
    const newId = makeLineId();
    const last = lines[lines.length - 1];
    const startMs = last ? last.endMs : 0;
    setLines((prev) => [
      ...prev,
      { id: newId, startMs, endMs: startMs + 3000, text: '' },
    ]);
    setNewlyAddedId(newId);
    setDirty(true);
    setStatusMessage('Đã thêm dòng mới ở cuối danh sách. Bạn có thể giữ icon ⠿ để kéo dòng đến vị trí mong muốn.');
    setTimeout(() => {
      const el = document.getElementById(`srt-line-${newId}`);
      el?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }, 50);
  };

  const insertLineAfter = (index: number) => {
    setEditorPage(Math.floor((index + 1) / EDITOR_PAGE_SIZE));
    pushUndo(lines, true);
    const newId = makeLineId();
    const current = lines[index];
    const next = lines[index + 1];
    const startMs = current ? current.endMs : 0;
    const endMs = next && next.startMs > startMs ? Math.min(startMs + 3000, next.startMs) : startMs + 3000;
    const newLine: SrtLine = { id: newId, startMs, endMs, text: '' };
    setLines((prev) => {
      const copy = [...prev];
      copy.splice(index + 1, 0, newLine);
      return copy;
    });
    setNewlyAddedId(newId);
    setDirty(true);
    setStatusMessage(`Đã chèn dòng mới sau câu #${index + 1}.`);
    setTimeout(() => {
      const el = document.getElementById(`srt-line-${newId}`);
      el?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }, 50);
  };

  // Tự động ngắt dòng hiển thị (\n, tối đa 37 ký tự/dòng) bảo toàn 100% id, startMs, endMs
  const handleVisualWrapLines = () => {
    if (lines.length === 0 || loading) return;
    pushUndo(lines, true);
    let wrappedCount = 0;
    const updated = lines.map((line) => {
      const hasOverflow = line.text.includes('\n')
        ? line.text.split(/\r?\n/).some((sub) => sub.trim().length > 37)
        : line.text.length > 37;
      if (hasOverflow) {
        const wrapped = breakVietnameseLines(line.text.replace(/\r?\n/g, ' '), 37);
        if (wrapped !== line.text) wrappedCount++;
        return { ...line, text: wrapped };
      }
      return line;
    });
    setLines(updated);
    setDirty(true);
    setStatusMessage(
      `Đã ngắt dòng hiển thị (\\n) cho ${wrappedCount} câu dài. Bảo toàn 100% mốc thời gian và số lượng dòng!`
    );
  };

  // Lọc bỏ rác OCR, ký tự đơn lẻ, dấu câu trôi nổi và khối siêu ngắn (<150ms)
  const handleSanitizeGarbage = () => {
    if (lines.length === 0 || loading) return;
    pushUndo(lines, true);
    const { cleaned, removedCount } = sanitizeSubtitles(lines);
    if (removedCount > 0) {
      setLines(cleaned);
      setDirty(true);
      setStatusError(false);
      setStatusMessage(`Đã dọn sạch ${removedCount} dòng phụ đề rác OCR. Nhớ bấm "Lưu thay đổi"!`);
    } else {
      setStatusError(false);
      setStatusMessage('Phụ đề đã sạch! Không tìm thấy dòng rác OCR nào.');
    }
  };

  const splitLine = (index: number) => {
    const item = lines[index];
    if (!item) return;

    pushUndo(lines, true);

    const currentVideoMs = currentTimeMsRef.current;
    const { line1, line2 } = splitLineSmart(item, currentVideoMs);

    setLines((prev) => {
      const copy = [...prev];
      copy.splice(index, 1, line1, line2);
      return copy;
    });
    setNewlyAddedId(line2.id);
    setDirty(true);
    setStatusMessage(`Đã cắt thông minh câu #${index + 1} tại ${formatMs(line1.endMs)}.`);
  };

  const mergeLineWithNext = (index: number) => {
    if (index < 0 || index >= lines.length - 1) return;
    const curr = lines[index];
    const next = lines[index + 1];
    if (!curr || !next) return;

    pushUndo(lines, true);

    const mergedText = [curr.text.trim(), next.text.trim()].filter(Boolean).join(' ');
    const mergedLine: SrtLine = {
      ...curr,
      endMs: Math.max(curr.endMs, next.endMs),
      text: mergedText,
    };

    setLines((prev) => {
      const copy = [...prev];
      copy.splice(index, 2, mergedLine);
      return copy;
    });
    setDirty(true);
    setStatusMessage(`Đã gộp câu #${index + 1} và #${index + 2}.`);
  };

  const handleDragStart = (e: React.DragEvent, index: number) => {
    setDraggedIndex(index);
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', String(index));
  };

  const handleDragOver = (e: React.DragEvent, index: number) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    if (draggedIndex === null) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const midY = rect.top + rect.height / 2;
    const position = e.clientY < midY ? 'above' : 'below';
    if (dragOverIndex !== index || dragOverPosition !== position) {
      setDragOverIndex(index);
      setDragOverPosition(position);
    }
  };

  const handleDrop = (e: React.DragEvent, targetIndex: number) => {
    e.preventDefault();
    if (draggedIndex === null) return;
    if (draggedIndex === targetIndex) {
      setDraggedIndex(null);
      setDragOverIndex(null);
      return;
    }

    let insertAt = dragOverPosition === 'above' ? targetIndex : targetIndex + 1;
    if (draggedIndex < insertAt) {
      insertAt -= 1;
    }
    if (insertAt === draggedIndex) {
      setDraggedIndex(null);
      setDragOverIndex(null);
      return;
    }

    const next = [...lines];
    const [moved] = next.splice(draggedIndex, 1);
    next.splice(insertAt, 0, moved);

    // Tự động điều chỉnh startMs và endMs để khớp logic timeline xung quanh
    const prevLine = insertAt > 0 ? next[insertAt - 1] : null;
    const nextLine = insertAt < next.length - 1 ? next[insertAt + 1] : null;
    const originalDuration = Math.max(1000, (moved.endMs || 0) - (moved.startMs || 0));

    if (prevLine && nextLine) {
      if (nextLine.startMs > prevLine.endMs) {
        moved.startMs = prevLine.endMs;
        moved.endMs = Math.min(prevLine.endMs + originalDuration, nextLine.startMs);
        if (moved.endMs <= moved.startMs) {
          moved.endMs = moved.startMs + Math.max(500, Math.floor((nextLine.startMs - prevLine.endMs) / 2));
        }
      } else {
        moved.startMs = prevLine.endMs;
        moved.endMs = moved.startMs + originalDuration;
      }
    } else if (prevLine && !nextLine) {
      moved.startMs = prevLine.endMs;
      moved.endMs = moved.startMs + originalDuration;
    } else if (!prevLine && nextLine) {
      moved.endMs = nextLine.startMs;
      moved.startMs = Math.max(0, nextLine.startMs - originalDuration);
    }

    setLines(next);
    setDirty(true);
    setStatusMessage(`Đã chuyển câu #${draggedIndex + 1} đến vị trí #${insertAt + 1} và cân chỉnh timeline.`);
    setDraggedIndex(null);
    setDragOverIndex(null);
  };

  const handleDragEnd = () => {
    setDraggedIndex(null);
    setDragOverIndex(null);
  };

  const setLineTimeFromVideo = (index: number, field: 'startMs' | 'endMs') => {
    const video = videoRef.current;
    if (!video) return;
    const timeMs = Math.round(video.currentTime * 1000);
    const line = lines[index];
    if (field === 'startMs') {
      updateLine(index, { startMs: timeMs, endMs: Math.max(line.endMs, timeMs + 200) });
    } else {
      updateLine(index, { endMs: Math.max(line.startMs + 200, timeMs) });
    }
  };

  const seekTo = (ms: number) => {
    const video = videoRef.current;
    if (!video || !Number.isFinite(ms)) return;
    video.currentTime = Math.max(0, ms / 1000);
    currentTimeMsRef.current = Math.max(0, ms);
    setCurrentTimeMs(Math.max(0, ms));
  };

  const handleTimelineClick = (e: React.MouseEvent<HTMLDivElement>) => {
    if (durationMs <= 0) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const ratio = Math.min(1, Math.max(0, (e.clientX - rect.left) / rect.width));
    seekTo(Math.round(ratio * durationMs));
  };

  const handleSave = async () => {
    if (!activeSrtPath) return;

    try {
      setLoading(true);
      setStatusError(false);
      setStatusMessage('Đang lưu file SRT...');
      await window.vanhsub.tasks.writeSrt(activeSrtPath, serializeSrt(lines));
      if (!isTranslatedView) {
        setOriginalLines(lines);
      }
      setDirty(false);
      setLoading(false);
      setStatusMessage(
        `Đã lưu thành công ${lines.length} dòng (${
          srtSource === 'overlay_translated'
            ? 'Bảng/Overlay dịch'
            : srtSource === 'overlay_original'
              ? 'Bảng/Overlay gốc'
              : srtSource === 'translated'
                ? 'Bản dịch'
                : 'Bản gốc'
        })!`,
      );
      setTimeout(() => setStatusMessage(''), 4000);
    } catch (err: any) {
      setLoading(false);
      setStatusError(true);
      setStatusMessage('Lỗi khi lưu SRT: ' + (err?.message || err));
    }
  };

  // Phím tắt Ctrl + S để lưu nhanh, Ctrl + Shift + W để ngắt dòng hiển thị (\n)
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (!isActive) return;
      if ((e.ctrlKey || e.metaKey) && (e.key === 's' || e.code === 'KeyS')) {
        e.preventDefault();
        if (activeSrtPath) {
          void handleSave();
        }
      }
      if ((e.ctrlKey || e.metaKey) && e.shiftKey && (e.key === 'W' || e.key === 'w' || e.code === 'KeyW')) {
        e.preventDefault();
        handleVisualWrapLines();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isActive, activeSrtPath, lines, srtSource]);

  // Hiệu đính 1 câu (sửa lỗi chính tả, ngữ pháp, mượt văn)
  const handlePolishLine = async (index: number) => {
    if (aiBusyIndex !== null) return;
    setStatusError(false);
    setStatusMessage(`Đang gọi Gemini hiệu đính câu #${index + 1}...`);
    setAiBusyIndex(index);
    setAiActionType('polish');
    try {
      const polished = await window.vanhsub.ai.polishLine({
        text: lines[index].text,
        prev: lines[index - 1]?.text,
        next: lines[index + 1]?.text,
      });
      updateLine(index, { text: polished });
      setStatusMessage(`Đã hiệu đính câu #${index + 1} bằng Gemini — nhớ bấm "Lưu thay đổi".`);
    } catch (err: any) {
      const message: string = err?.message || String(err);
      setStatusError(true);
      setStatusMessage(message);
      if (message.includes('API key')) setShowKeyInput(true);
    } finally {
      setAiBusyIndex(null);
      setAiActionType(null);
    }
  };

  // Dịch nhanh 1 câu theo targetLanguage
  const handleTranslateLine = async (index: number) => {
    if (aiBusyIndex !== null) return;
    const targetLabel = TARGET_LANGUAGES.find((l) => l.code === targetLanguage)?.label || targetLanguage;
    setStatusError(false);
    setStatusMessage(`Đang gọi Gemini dịch câu #${index + 1} sang ${targetLabel}...`);
    setAiBusyIndex(index);
    setAiActionType('translate');
    try {
      const origText =
        isTranslatedView
          ? originalLines.find((o) => o.id === lines[index].id)?.text ||
            originalLines[index]?.text ||
            originalLines.find((o) => Math.abs(o.startMs - lines[index].startMs) < 1000)?.text ||
            lines[index].text
          : lines[index].text;

      // R2: Cách ly ngữ cảnh — chỉ truyền câu trước nếu câu đó thực sự đã được dịch
      let prevContextText: string | undefined;
      if (index > 0) {
        const prevCandidate = lines[index - 1]?.text;
        const origPrev =
          originalLines.find((o) => o.id === lines[index - 1]?.id)?.text ||
          originalLines[index - 1]?.text;
        if (
          prevCandidate &&
          prevCandidate.trim() &&
          (!origPrev || !isLineUntranslated(origPrev, prevCandidate, glossary))
        ) {
          prevContextText = prevCandidate;
        }
      }

      const translated = await window.vanhsub.ai.translateLine({
        text: origText,
        targetLanguage,
        prev: prevContextText,
        next: undefined,
      });

      if (translated && isLineUntranslated(origText, translated, glossary)) {
        setStatusError(true);
        setStatusMessage(`Cảnh báo: Mô hình trả về câu chưa dịch ("${translated}"). Vui lòng thử lại.`);
      } else {
        updateLine(index, { text: translated });
        setStatusMessage(`Đã dịch câu #${index + 1} sang ${targetLabel} — nhớ bấm "Lưu thay đổi".`);
      }
    } catch (err: any) {
      const message: string = err?.message || String(err);
      setStatusError(true);
      setStatusMessage(message);
      if (message.includes('API key')) setShowKeyInput(true);
    } finally {
      setAiBusyIndex(null);
      setAiActionType(null);
    }
  };

  const [isTranslatingRemaining, setIsTranslatingRemaining] = useState(false);
  const [translatingRemainingProgress, setTranslatingRemainingProgress] = useState(0);

  // R4: Dịch 1-click tất cả các câu chưa dịch (Safety Net Recovery)
  const handleTranslateRemainingLines = async () => {
    if (untranslatedIndices.length === 0 || isTranslatingRemaining || loading) return;
    if (!hasApiKey) {
      setShowKeyInput(true);
      setStatusError(true);
      setStatusMessage('Cần có Gemini API Key để dịch các câu còn lại — vui lòng nhập key.');
      return;
    }

    setIsTranslatingRemaining(true);
    setTranslatingRemainingProgress(0);
    setStatusError(false);
    const targetLabel = TARGET_LANGUAGES.find((l) => l.code === targetLanguage)?.label || targetLanguage;
    setStatusMessage(`Đang dịch ${untranslatedIndices.length} câu chưa dịch sang ${targetLabel}...`);

    let translatedCount = 0;
    const updatedLines = [...lines];
    pushUndo(lines, true);

    try {
      for (let step = 0; step < untranslatedIndices.length; step++) {
        const idx = untranslatedIndices[step];
        const line = updatedLines[idx];
        const origText =
          originalLines.find((o) => o.id === line.id)?.text ||
          originalLines[idx]?.text ||
          originalLines.find((o) => Math.abs(o.startMs - line.startMs) < 1000)?.text ||
          line.text;

        setTranslatingRemainingProgress(step + 1);
        setStatusMessage(`Đang dịch câu #${idx + 1} (${step + 1}/${untranslatedIndices.length})...`);

        // R2: Cách ly ngữ cảnh — chỉ truyền câu trước nếu câu đó thực sự đã được dịch
        let prevContextText: string | undefined;
        if (idx > 0) {
          const prevCandidate = updatedLines[idx - 1]?.text;
          const origPrev =
            originalLines.find((o) => o.id === updatedLines[idx - 1]?.id)?.text ||
            originalLines[idx - 1]?.text;
          if (
            prevCandidate &&
            prevCandidate.trim() &&
            (!origPrev || !isLineUntranslated(origPrev, prevCandidate, glossary))
          ) {
            prevContextText = prevCandidate;
          }
        }

        try {
          const translated = await window.vanhsub.ai.translateLine({
            text: origText,
            targetLanguage,
            prev: prevContextText,
            next: undefined,
          });

          if (
            translated &&
            translated.trim() &&
            !isLineUntranslated(origText, translated, glossary)
          ) {
            updatedLines[idx] = { ...line, text: translated.trim() };
            translatedCount++;
            setLines([...updatedLines]);
            setDirty(true);
          } else {
            console.warn(`Câu #${idx + 1} vẫn chưa được dịch thực sự:`, translated);
          }
        } catch (itemErr: any) {
          console.warn(`Lỗi khi dịch câu #${idx + 1}:`, itemErr);
        }
      }

      if (translatedCount > 0) {
        setLines(updatedLines);
        setDirty(true);
        setStatusMessage(
          `Đã hoàn tất dịch ${translatedCount}/${untranslatedIndices.length} câu sang ${targetLabel}! Nhớ bấm "Lưu thay đổi".`
        );
      } else {
        setStatusError(true);
        setStatusMessage(
          `Không thể dịch tự động ${untranslatedIndices.length} câu sót (mô hình vẫn giữ nguyên nội dung gốc). Bạn có thể chỉnh sửa thủ công.`
        );
      }
    } catch (err: any) {
      setStatusError(true);
      setStatusMessage('Lỗi khi dịch các câu sót: ' + (err?.message || err));
    } finally {
      setIsTranslatingRemaining(false);
      setTranslatingRemainingProgress(0);
    }
  };

  // Dọn dẹp, gộp câu lặp và sửa lỗi chính tả bằng Gemini AI
  const handleAiCleanSubtitles = async () => {
    if (lines.length === 0 || isCleaningSubtitles || loading) return;
    if (!hasApiKey) {
      setShowKeyInput(true);
      setStatusError(true);
      setStatusMessage('Cần có Gemini API Key để AI dọn dẹp phụ đề — vui lòng nhập key.');
      return;
    }

    const originalCount = lines.length;
    setIsCleaningSubtitles(true);
    setStatusError(false);
    setStatusMessage(`Đang gọi Gemini AI rà soát & gộp câu trùng lặp cho ${originalCount} dòng...`);

    try {
      const itemsToClean = lines.map((l) => ({
        startMs: l.startMs,
        endMs: l.endMs,
        text: l.text,
      }));

      const cleaned = await window.vanhsub.ai.cleanSubtitles(itemsToClean);
      if (cleaned && cleaned.length > 0) {
        const newLines: SrtLine[] = cleaned.map((c) => ({
          id: makeLineId(),
          startMs: c.startMs,
          endMs: c.endMs,
          text: c.text,
        }));

        setLines(newLines);
        setDirty(true);
        const savedCount = originalCount - newLines.length;
        const msg =
          savedCount > 0
            ? `AI đã gộp gọn: từ ${originalCount} dòng còn ${newLines.length} dòng (đã lọc ${savedCount} câu lặp/nhiễu). Nhớ bấm "Lưu thay đổi"!`
            : `AI đã chuẩn hoá chính tả & câu chữ cho ${newLines.length} dòng. Nhớ bấm "Lưu thay đổi"!`;
        setStatusMessage(msg);
      } else {
        setStatusMessage('AI không tìm thấy thay đổi cần gộp.');
      }
    } catch (err: any) {
      const message: string = err?.message || String(err);
      setStatusError(true);
      setStatusMessage('Lỗi khi AI dọn dẹp phụ đề: ' + message);
      if (message.includes('API key')) setShowKeyInput(true);
    } finally {
      setIsCleaningSubtitles(false);
    }
  };

  // Chạy dịch toàn bộ tác vụ bằng Gemini AI
  const handleStartFullTranslate = async () => {
    if (!selectedTaskId) return;
    if (dirty) {
      await handleSave();
    }
    setStatusError(false);
    const targetLabel = TARGET_LANGUAGES.find((l) => l.code === targetLanguage)?.label || targetLanguage;
    setStatusMessage(`Đã gửi yêu cầu dịch toàn bộ sang ${targetLabel} bằng Gemini...`);
    try {
      await window.vanhsub.translate.start(selectedTaskId, targetLanguage, {
        targetTrack: isOverlayTrack ? 'overlay' : 'primary',
      });
    } catch (err: any) {
      setStatusError(true);
      setStatusMessage(err?.message || String(err));
    }
  };

  const handleCancelTranslate = async () => {
    if (!selectedTaskId) return;
    try {
      await window.vanhsub.translate.cancel(selectedTaskId);
      setStatusMessage('Đã gửi yêu cầu dừng dịch.');
    } catch {
      // bỏ qua
    }
  };

  const handleSaveKey = async () => {
    setSavingKey(true);
    try {
      await window.vanhsub.settings.set('geminiApiKey', keyDraft.trim());
      setHasApiKey(keyDraft.trim().length > 0);
      setShowKeyInput(false);
      setStatusError(false);
      setStatusMessage('Đã lưu Gemini API key thành công');
    } catch (err: any) {
      setStatusError(true);
      setStatusMessage('Không lưu được key: ' + (err?.message || err));
    } finally {
      setSavingKey(false);
    }
  };

  const posPercent = (ms: number) =>
    durationMs > 0 ? Math.min(100, Math.max(0, (ms / durationMs) * 100)) : 0;

  const editorTasks = tasks.filter((t) => t.srtPath || t.overlaySrtPath);

  return (
    <div className="flex flex-1 flex-col gap-4 overflow-hidden p-6">
      {/* Thanh công cụ trên */}
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-border bg-surface p-4">
        <div className="flex flex-wrap items-center gap-3">
          <label className="text-xs font-semibold text-text">Tác vụ:</label>
          <select
            value={selectedTaskId || ''}
            onChange={(e) => handleTaskChange(e.target.value || null)}
            className="rounded-md border border-border bg-surface-2 px-3 py-1.5 text-xs text-text focus:outline-none"
          >
            <option value="">-- Chọn tác vụ đã có SRT --</option>
            {editorTasks.map((t) => (
              <option key={t.id} value={t.id}>
                {t.fileName}
              </option>
            ))}
          </select>

          {/* Nguồn phụ đề đang hiệu đính: thoại gốc/dịch & (nếu có) bảng/overlay gốc/dịch */}
          {selectedTaskId && (selectedTask?.srtPath || selectedTask?.overlaySrtPath) && (
            <div className="flex flex-wrap items-center gap-1.5">
              <label className="text-xs font-semibold text-text">Đang sửa:</label>
              <div className="flex overflow-hidden rounded-md border border-border bg-bg">
                {hasOriginalSrt && (
                  <>
                    <button
                      type="button"
                      onClick={() => handleSourceChange('original')}
                      className={[
                        'px-3 py-1.5 text-[11px] font-medium transition cursor-pointer',
                        srtSource === 'original'
                          ? 'bg-accent-tint text-accent font-semibold'
                          : 'bg-surface-2 text-text hover:bg-surface-3',
                      ].join(' ')}
                    >
                      Bản gốc (.srt)
                    </button>
                    <button
                      type="button"
                      onClick={() => handleSourceChange('translated')}
                      disabled={!hasTranslatedSrt}
                      title={
                        hasTranslatedSrt
                          ? 'Sửa bản dịch (file các bước TTS/Xuất video sẽ dùng)'
                          : 'Chưa có bản dịch — bấm "Dịch bằng Gemini" để tạo'
                      }
                      className={[
                        'border-l border-border px-3 py-1.5 text-[11px] font-medium transition',
                        srtSource === 'translated'
                          ? 'bg-accent-tint text-accent font-semibold cursor-pointer'
                          : hasTranslatedSrt
                            ? 'bg-surface-2 text-text hover:bg-surface-3 cursor-pointer'
                            : 'bg-surface-2 text-text-muted cursor-not-allowed',
                      ].join(' ')}
                    >
                      Bản dịch {hasTranslatedSrt ? '✓' : '(chưa có)'}
                    </button>
                  </>
                )}
                {hasOverlayOriginalSrt && (
                  <>
                    <button
                      type="button"
                      onClick={() => handleSourceChange('overlay_original')}
                      className={[
                        `${hasOriginalSrt ? 'border-l border-border ' : ''}px-3 py-1.5 text-[11px] font-medium transition cursor-pointer`,
                        srtSource === 'overlay_original'
                          ? 'bg-amber-500/20 text-amber-300 font-semibold'
                          : 'bg-surface-2 text-text hover:bg-surface-3',
                      ].join(' ')}
                    >
                      Bảng/Overlay gốc
                    </button>
                    <button
                      type="button"
                      onClick={() => handleSourceChange('overlay_translated')}
                      disabled={!hasOverlayTranslatedSrt}
                      title={
                        hasOverlayTranslatedSrt
                          ? 'Sửa bản dịch của file bảng/thông tin vùng trên'
                          : 'Chưa có bản dịch cho bảng/overlay — chọn tab này rồi bấm "Dịch bằng Gemini"'
                      }
                      className={[
                        'border-l border-border px-3 py-1.5 text-[11px] font-medium transition',
                        srtSource === 'overlay_translated'
                          ? 'bg-amber-500/20 text-amber-300 font-semibold cursor-pointer'
                          : hasOverlayTranslatedSrt
                            ? 'bg-surface-2 text-text hover:bg-surface-3 cursor-pointer'
                            : 'bg-surface-2 text-text-muted cursor-not-allowed',
                      ].join(' ')}
                    >
                      Bảng/Overlay dịch {hasOverlayTranslatedSrt ? '✓' : '(chưa có)'}
                    </button>
                  </>
                )}
              </div>

              <button
                type="button"
                onClick={() => {
                  if (dirty && !window.confirm('Tải lại sẽ xoá các thay đổi chưa lưu. Tiếp tục?')) return;
                  setReloadKey((k) => k + 1);
                }}
                title="Tải lại file SRT từ đĩa để đồng bộ mới nhất"
                className="rounded-md border border-border bg-surface-2 p-1.5 text-text hover:bg-surface-3 hover:text-white transition cursor-pointer"
              >
                <RefreshCw className={`h-3.5 w-3.5 ${loading ? 'animate-spin text-accent' : ''}`} />
              </button>
            </div>
          )}

          {/* Nút dịch toàn bộ file đang chọn trực tiếp trong Editor */}
          {selectedTaskId && (
            <div className="flex items-center gap-1.5">
              <div className="flex items-center gap-1 rounded-md border border-border bg-surface-2 px-2 py-1">
                <span className="text-[10px] font-semibold text-text-muted">Sang:</span>
                <select
                  value={targetLanguage}
                  onChange={(e) => {
                    const newLang = e.target.value;
                    setTargetLanguage(newLang);
                    if (window.vanhsub?.settings) {
                      window.vanhsub.settings.set('targetLanguage', newLang).catch(() => {});
                    }
                  }}
                  disabled={isTranslating}
                  className="bg-transparent text-xs text-text focus:outline-none cursor-pointer disabled:opacity-50"
                >
                  {TARGET_LANGUAGES.map((l) => (
                    <option key={l.code} value={l.code} className="bg-surface-2 text-white">
                      {l.label}
                    </option>
                  ))}
                </select>
              </div>

              {isTranslating ? (
                <button
                  type="button"
                  onClick={handleCancelTranslate}
                  className="inline-flex items-center gap-1.5 rounded-md border border-rose-500/40 bg-rose-500/10 px-3 py-1.5 text-xs font-medium text-rose-400 hover:bg-rose-500/20 cursor-pointer"
                >
                  <XCircle className="h-3.5 w-3.5" />
                  <span>Huỷ dịch {selectedTask?.progress ? `(${selectedTask.progress}%)` : ''}</span>
                </button>
              ) : (
                <button
                  type="button"
                  onClick={handleStartFullTranslate}
                  disabled={loading}
                  title={
                    isOverlayTrack
                      ? hasOverlayTranslatedSrt
                        ? 'Dịch lại file bảng/overlay bằng Gemini'
                        : 'Dịch file bảng/overlay bằng Gemini'
                      : hasTranslatedSrt
                        ? 'Dịch lại toàn bộ phụ đề thoại bằng Gemini'
                        : 'Dịch toàn bộ phụ đề thoại sang ngôn ngữ đã chọn'
                  }
                  className="inline-flex items-center gap-1.5 rounded-md border border-accent/40 bg-accent-tint px-3 py-1.5 text-xs font-semibold text-accent hover:bg-accent-tint/25 cursor-pointer disabled:opacity-50 transition"
                >
                  <Globe2 className="h-3.5 w-3.5" />
                  <span>
                    {hasActiveTranslated ? 'Dịch lại (Gemini)' : 'Dịch bằng Gemini'}
                    {isOverlayTrack ? ' [Bảng]' : ''}
                  </span>
                </button>
              )}
            </div>
          )}

          {/* Nút bật/tắt đối chiếu song ngữ khi sửa bản dịch */}
          {selectedTaskId && isTranslatedView && hasActiveOriginal && (
            <button
              type="button"
              onClick={() => setShowBilingual((v) => !v)}
              title="Bật/tắt khung hiển thị câu gốc để đối chiếu khi sửa bản dịch"
              className={[
                'inline-flex items-center gap-1.5 rounded-md border px-2.5 py-1.5 text-[11px] font-medium transition cursor-pointer',
                showBilingual
                  ? 'border-accent/40 bg-accent-tint text-accent'
                  : 'border-border bg-surface-2 text-text-muted hover:text-text',
              ].join(' ')}
            >
              <Languages className="h-3.5 w-3.5" />
              <span>{showBilingual ? 'Đang đối chiếu gốc' : 'Bật đối chiếu gốc'}</span>
            </button>
          )}

          {/* Cảnh báo lệch số dòng giữa bản dịch và bản gốc */}
          {selectedTaskId && isTranslatedView && originalLines.length > 0 && lines.length !== originalLines.length && (
            <span
              title={`Số dòng bản dịch (${lines.length} dòng) khác với bản gốc (${originalLines.length} dòng) do có thêm/xoá câu.`}
              className="inline-flex items-center gap-1 rounded-full border border-amber-500/40 bg-amber-500/10 px-2.5 py-1 text-[10px] font-medium text-amber-300"
            >
              <AlertCircle className="h-3 w-3 text-amber-400" />
              Lệch dòng ({lines.length}/{originalLines.length})
            </span>
          )}

          {/* R4: Chỉ báo trạng thái câu chưa dịch & Nút 1-click dịch câu sót (Recovery Safety Net) */}
          {selectedTaskId && isTranslatedView && untranslatedIndices.length > 0 && (
            <div className="flex items-center gap-1.5">
              <span
                title={`Phát hiện ${untranslatedIndices.length} câu chưa được dịch sang ngôn ngữ đích (nội dung trùng với câu gốc).`}
                className="inline-flex items-center gap-1 rounded-full border border-amber-500/40 bg-amber-500/10 px-2.5 py-1 text-[10px] font-semibold text-amber-300"
              >
                <AlertCircle className="h-3 w-3 text-amber-400" />
                Chưa dịch ({untranslatedIndices.length})
              </span>

              <button
                type="button"
                onClick={handleTranslateRemainingLines}
                disabled={loading || isTranslatingRemaining || isTranslating}
                title={`Dịch tự động ${untranslatedIndices.length} câu chưa dịch còn lại bằng Gemini`}
                className="inline-flex items-center gap-1.5 rounded-md border border-amber-500/40 bg-amber-500/20 px-2.5 py-1 text-xs font-semibold text-amber-200 hover:bg-amber-500/30 cursor-pointer disabled:opacity-50 transition"
              >
                {isTranslatingRemaining ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin text-amber-300" />
                ) : (
                  <Sparkles className="h-3.5 w-3.5 text-amber-300" />
                )}
                <span>
                  {isTranslatingRemaining
                    ? `Đang dịch (${translatingRemainingProgress}/${untranslatedIndices.length})...`
                    : `Dịch ${untranslatedIndices.length} câu sót`}
                </span>
              </button>
            </div>
          )}

          {/* Nút Ngắt dòng hiển thị (\n) */}
          {lines.length > 0 && (
            <button
              type="button"
              onClick={handleVisualWrapLines}
              disabled={loading || isCleaningSubtitles || isTranslating}
              title="Tự động ngắt dòng hiển thị (\n) cho các câu dài vượt quá 37 ký tự, bảo toàn 100% mốc thời gian và số dòng [Ctrl+Shift+W]"
              className="inline-flex items-center gap-1.5 rounded-md border border-accent/40 bg-accent-tint px-3 py-1.5 text-xs font-semibold text-accent hover:bg-accent-tint/25 cursor-pointer disabled:opacity-50 transition"
            >
              <Sparkles className="h-3.5 w-3.5 text-accent" />
              <span>Ngắt dòng hiển thị (\n)</span>
            </button>
          )}

          {/* Nút Lọc rác & Làm sạch */}
          {lines.length > 0 && (
            <button
              type="button"
              onClick={handleSanitizeGarbage}
              disabled={loading || isCleaningSubtitles || isTranslating}
              title="Tự động phát hiện và loại bỏ các dòng rác OCR (1 ký tự, dấu câu trôi nổi, nhiễu khung hình <150ms)"
              className="inline-flex items-center gap-1.5 rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-1.5 text-xs font-semibold text-amber-300 hover:bg-amber-500/25 cursor-pointer disabled:opacity-50 transition"
            >
              <Filter className="h-3.5 w-3.5 text-amber-400" />
              <span>Lọc rác & Làm sạch</span>
              {detectedGarbageCount > 0 && (
                <span className="rounded-full bg-rose-500/90 px-1.5 py-0.2 text-[10px] font-bold text-white leading-none">
                  {detectedGarbageCount}
                </span>
              )}
            </button>
          )}

          {/* Nút AI Dọn Dẹp & Lọc Trùng Phụ Đề */}
          {lines.length > 0 && (
            <button
              type="button"
              onClick={handleAiCleanSubtitles}
              disabled={loading || isCleaningSubtitles || isTranslating}
              title="Dùng Gemini AI quét và gộp các câu phụ đề lặp lại do OCR, ghép câu ngắt vụn và sửa lỗi chính tả"
              className="inline-flex items-center gap-1.5 rounded-md border border-accent/40 bg-accent-tint px-3 py-1.5 text-xs font-semibold text-accent hover:bg-accent-tint cursor-pointer disabled:opacity-50 transition"
            >
              {isCleaningSubtitles ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin text-accent" />
              ) : (
                <Wand2 className="h-3.5 w-3.5 text-accent" />
              )}
              <span>{isCleaningSubtitles ? 'Đang dọn dẹp...' : 'AI Gọn Phụ Đề'}</span>
            </button>
          )}

          {/* Gemini Key status badge */}
          <button
            type="button"
            onClick={() => setShowKeyInput((v) => !v)}
            title="Cấu hình Gemini API key & Model"
            className={[
              'inline-flex items-center gap-1.5 rounded-md border px-2.5 py-1.5 text-[11px] font-medium transition cursor-pointer',
              hasApiKey
                ? 'border-emerald-500/40 bg-emerald-500/10 text-emerald-400 hover:bg-emerald-500/20'
                : 'border-border bg-surface-2 text-text hover:bg-surface-3',
            ].join(' ')}
          >
            <KeyRound className="h-3 w-3" />
            <span>{hasApiKey ? `Gemini: ${geminiModelName}` : 'Chưa có Gemini Key'}</span>
          </button>

          {showKeyInput && (
            <div className="flex items-center gap-2 rounded-md border border-border bg-surface-2 px-2.5 py-1.5">
              <input
                type="password"
                value={keyDraft}
                onChange={(e) => setKeyDraft(e.target.value)}
                placeholder="Dán Gemini API key (AIza...)"
                className="w-56 bg-transparent text-xs text-text placeholder:text-text-muted focus:outline-none"
              />
              <button
                type="button"
                onClick={handleSaveKey}
                disabled={savingKey || !keyDraft.trim()}
                className="bg-accent text-white hover:bg-accent-hover rounded-lg px-2.5 py-1 text-[11px] font-semibold cursor-pointer disabled:opacity-50"
              >
                {savingKey ? '...' : 'Lưu'}
              </button>
            </div>
          )}

          {statusMessage && (
            <span className={`max-w-[280px] truncate text-xs font-mono ${statusError ? 'text-rose-400' : 'text-accent'}`} title={statusMessage}>
              {statusMessage}
            </span>
          )}
        </div>

        <div className="flex items-center gap-2">
          {selectedTaskId && (
            <div className="flex items-center gap-1 rounded-md border border-border bg-surface-2 p-1">
              <button
                type="button"
                onClick={handleUndo}
                disabled={!canUndo}
                title="Hoàn tác (Ctrl+Z)"
                className="inline-flex items-center gap-1 rounded-lg px-2 py-1 text-xs text-text hover:bg-surface-3 hover:text-white cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed transition"
              >
                <Undo2 className="h-3.5 w-3.5" />
                <span className="hidden sm:inline">Undo</span>
              </button>
              <button
                type="button"
                onClick={handleRedo}
                disabled={!canRedo}
                title="Làm lại (Ctrl+Y / Ctrl+Shift+Z)"
                className="inline-flex items-center gap-1 rounded-lg px-2 py-1 text-xs text-text hover:bg-surface-3 hover:text-white cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed transition"
              >
                <Redo2 className="h-3.5 w-3.5" />
                <span className="hidden sm:inline">Redo</span>
              </button>
            </div>
          )}

          {selectedTaskId && (
            <button
              type="button"
              onClick={handleSave}
              disabled={loading}
              className={`inline-flex items-center gap-2 rounded-md px-4 py-2 text-xs font-semibold cursor-pointer disabled:opacity-50 transition ${
                dirty
                  ? 'bg-accent text-white hover:bg-accent-hover   animate-pulse'
                  : 'border border-border bg-surface-2 text-text hover:bg-surface-3'
              }`}
            >
              {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4 text-emerald-400" />}
              <span>{dirty ? 'Lưu thay đổi (*)' : 'Đã lưu (.srt)'}</span>
            </button>
          )}
        </div>
      </div>

      {/* Tiến trình khi task đang dịch */}
      {selectedTask && isTranslating && (
        <div className="rounded-lg border border-accent/40 bg-accent-tint p-3.5">
          <div className="mb-1.5 flex items-center justify-between text-xs">
            <span className="flex items-center gap-2 font-medium text-accent">
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
              <span>{selectedTask.stageDescription || 'Đang dịch phụ đề bằng Gemini...'}</span>
            </span>
            <span className="font-mono font-bold text-white">{selectedTask.progress}%</span>
          </div>
          <div className="h-1.5 overflow-hidden rounded-full bg-surface-2">
            <div
              className="h-full rounded-full bg-accent transition-all duration-300"
              style={{ width: `${selectedTask.progress}%` }}
            />
          </div>
        </div>
      )}

      {/* Thống kê chi tiết OCR theo Rule 17 */}
      {selectedTask?.ocrStats && (
        <div className="flex flex-wrap items-center gap-4 rounded-lg border border-accent/40 bg-surface px-4 py-2.5 text-xs text-text">
          <div className="flex items-center gap-1.5 font-semibold text-accent">
            <Sparkles className="h-4 w-4" />
            <span>Thống kê OCR:</span>
          </div>
          <div className="flex items-center gap-1.5">
            <span className="text-text-muted">OCR detected:</span>
            <span className="font-mono font-bold text-white">{selectedTask.ocrStats.finalEvents}</span>
            <span className="text-text-muted">subtitle events</span>
          </div>
          <span className="text-text-faint">•</span>
          <div className="flex items-center gap-1.5">
            <span className="text-text-muted">High confidence:</span>
            <span className="font-mono font-bold text-emerald-400">{selectedTask.ocrStats.highConfidence}</span>
          </div>
          <span className="text-text-faint">•</span>
          <div className="flex items-center gap-1.5">
            <span className="text-text-muted">Needs review:</span>
            <span className="font-mono font-bold text-amber-400">{selectedTask.ocrStats.needsReview}</span>
          </div>
          <span className="text-text-faint">•</span>
          <div className="flex items-center gap-1.5">
            <span className="text-text-muted">Duplicates removed:</span>
            <span className="font-mono font-bold text-accent">{selectedTask.ocrStats.duplicatesRemoved}</span>
          </div>
        </div>
      )}

      {/* Nội dung chính */}
      {!selectedTaskId ? (
        <div className="flex flex-1 flex-col items-center justify-center rounded-lg border border-dashed border-border bg-surface p-12 text-center text-text-muted text-xs">
          <MessageSquareText className="h-10 w-10 text-text-faint mb-3 animate-pulse" />
          <span>
            Chọn một tác vụ đã hoàn thành phiên âm (có file .srt) ở menu phía trên để bắt đầu hiệu đính.
          </span>
        </div>
      ) : !(selectedTask?.srtPath || selectedTask?.overlaySrtPath) ? (
        <div className="flex flex-1 flex-col items-center justify-center rounded-lg border border-dashed border-border bg-surface p-12 text-center text-text-muted text-xs">
          <MessageSquareText className="h-10 w-10 text-text-faint mb-3" />
          <span>Tác vụ này chưa có file .srt — hãy chạy "Bắt đầu phiên âm" ở Trang chủ trước.</span>
        </div>
      ) : (
        <div className="grid flex-1 grid-cols-[1fr_380px] gap-5 overflow-hidden">
          {/* Cột trái: danh sách phụ đề */}
          <div className="flex flex-col overflow-hidden rounded-lg border border-border bg-surface p-4">
            <div className="mb-3 flex items-center justify-between border-b border-border pb-3">
              <div className="flex items-center gap-2">
                <h3 className="text-xs font-bold uppercase tracking-wider text-text">
                  {srtSource === 'overlay_translated'
                    ? 'Bảng / Overlay bản dịch'
                    : srtSource === 'overlay_original'
                      ? 'Bảng / Overlay bản gốc'
                      : srtSource === 'translated'
                        ? 'Phụ đề bản dịch'
                        : 'Phụ đề bản gốc'}{' '}
                  ({lines.length} dòng)
                </h3>
                {dirty && (
                  <span className="rounded bg-amber-500/20 px-1.5 py-0.5 text-[10px] font-semibold text-amber-400">
                    Chưa lưu
                  </span>
                )}
              </div>
              <button
                type="button"
                onClick={addLine}
                className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-surface-2 px-2.5 py-1 text-[11px] font-medium text-text hover:bg-surface-3 cursor-pointer"
              >
                <Plus className="h-3.5 w-3.5 text-accent" />
                Thêm dòng
              </button>
            </div>

            {loading && lines.length === 0 ? (
              <div className="flex flex-1 items-center justify-center text-xs text-text-muted">
                <Loader2 className="mr-2 h-4 w-4 animate-spin text-accent" />
                Đang tải phụ đề...
              </div>
            ) : (
              <div className="flex-1 space-y-2.5 overflow-y-auto pr-1">
                {lines.length > EDITOR_PAGE_SIZE && <div className="flex flex-wrap items-center gap-2 rounded border border-border p-2 text-xs" aria-label="Phân trang phụ đề">
                  <button type="button" disabled={editorPage === 0} onClick={() => setEditorPage(page => page - 1)} className="rounded border border-border px-2 py-1 disabled:opacity-40">Trang trước</button>
                  <label className="flex items-center gap-1">Trang
                    <input aria-label="Trang phụ đề" type="number" min={1} max={pageCount} value={Math.min(editorPage + 1, pageCount)}
                      className="w-16 rounded border border-border bg-surface px-2 py-1"
                      onChange={event => { const page = Number(event.target.value); if (Number.isInteger(page) && page >= 1 && page <= pageCount) setEditorPage(page - 1); }} />
                    / {pageCount}
                  </label>
                  <button type="button" disabled={editorPage >= pageCount - 1} onClick={() => setEditorPage(page => page + 1)} className="rounded border border-border px-2 py-1 disabled:opacity-40">Trang sau</button>
                  <span className="text-text-muted">Dòng {pageStart + 1}–{Math.min(pageStart + EDITOR_PAGE_SIZE, lines.length)} / {lines.length}</span>
                </div>}
                {lines.slice(pageStart, pageStart + EDITOR_PAGE_SIZE).map((item, offset) => {
                  const index = pageStart + offset;
                  const isActiveLine = index === activeIndex;
                  const isBusyThis = aiBusyIndex === index;
                  const isDragging = draggedIndex === index;
                  const isDragOver = dragOverIndex === index && draggedIndex !== index;
                  const isNewlyAdded = item.id === newlyAddedId;
                  const isUntranslatedItem = isTranslatedView && untranslatedIndices.includes(index);

                  return (
                    <div
                      key={item.id}
                      id={`srt-line-${item.id}`}
                      ref={isActiveLine ? activeRowRef : null}
                      onClick={() => seekTo(item.startMs)}
                      onDragOver={(e) => handleDragOver(e, index)}
                      onDrop={(e) => handleDrop(e, index)}
                      className={[
                        'group relative flex flex-col gap-2 rounded-lg border bg-surface p-3 text-xs transition duration-150',
                        isDragging ? 'opacity-40 scale-[0.98]' : '',
                        isDragOver && dragOverPosition === 'above'
                          ? 'border-t-2 !border-t-brand-cyan  '
                          : '',
                        isDragOver && dragOverPosition === 'below'
                          ? 'border-b-2 !border-b-brand-cyan  '
                          : '',
                        isActiveLine
                          ? 'border-accent/40 ring-1 ring-accent/30  '
                          : isNewlyAdded
                          ? 'border-emerald-500/60 ring-1 ring-emerald-500/30'
                          : isUntranslatedItem
                          ? 'border-amber-500/50 bg-amber-500/5 ring-1 ring-amber-500/20'
                          : 'border-border hover:border-accent/40',
                      ].filter(Boolean).join(' ')}
                    >
                      <div className="flex items-center justify-between text-[11px] text-text-muted font-mono">
                        <div className="flex items-center gap-2">
                          <div
                            draggable
                            onDragStart={(e) => handleDragStart(e, index)}
                            onDragEnd={handleDragEnd}
                            className="cursor-grab active:cursor-grabbing p-1 -ml-1 text-text-muted hover:text-accent transition rounded hover:bg-surface-2 flex items-center justify-center"
                            title="Nhấn giữ và kéo để di chuyển câu phụ đề này đến vị trí mong muốn"
                          >
                            <GripVertical className="h-3.5 w-3.5" />
                          </div>
                          <span className="rounded-md bg-surface-2 px-2 py-0.5 font-bold text-accent">
                            #{index + 1}
                          </span>
                          <span className="text-[10px] text-text-muted">
                            {formatMs(item.startMs)} → {formatMs(item.endMs)}
                          </span>
                          {isNewlyAdded && (
                            <span className="inline-flex items-center gap-1 rounded bg-emerald-500/20 px-1.5 py-0.5 text-[9px] font-semibold text-emerald-400 border border-emerald-500/30">
                              Mới thêm • Kéo ⠿ để dời
                            </span>
                          )}
                          {isUntranslatedItem && (
                            <span className="inline-flex items-center gap-1 rounded bg-amber-500/20 px-1.5 py-0.5 text-[9px] font-semibold text-amber-300 border border-amber-500/40">
                              <AlertCircle className="h-2.5 w-2.5 text-amber-400" />
                              Chưa dịch
                            </span>
                          )}
                          {item.needsReview && (
                            <span className="inline-flex items-center gap-1 rounded bg-amber-500/20 px-1.5 py-0.5 text-[9px] font-semibold text-amber-400 border border-amber-500/30">
                              <AlertCircle className="h-2.5 w-2.5" />
                              Cần duyệt
                            </span>
                          )}

                          {/* Length & CPS Badges */}
                          <div className="flex items-center gap-1.5">
                            {item.text.split(/\r?\n/).map((subLine, lIdx) => {
                              const len = subLine.trim().length;
                              const isOver = len > 37;
                              return (
                                <span
                                  key={lIdx}
                                  title={
                                    isOver
                                      ? `Dòng ${lIdx + 1} vượt quá 37 ký tự (${len}/37)`
                                      : `Độ dài dòng ${lIdx + 1}: ${len}/37 ký tự`
                                  }
                                  className={`font-mono px-1.5 py-0.5 rounded text-[9px] font-semibold border ${
                                    isOver
                                      ? 'bg-rose-500/20 text-rose-300 border-rose-500/40 animate-pulse'
                                      : len > 32
                                      ? 'bg-amber-500/20 text-amber-300 border-amber-500/40'
                                      : 'bg-surface-2 text-text-muted border-border'
                                  }`}
                                >
                                  {item.text.split(/\r?\n/).length > 1 ? `D${lIdx + 1}: ` : ''}[{len}/37]
                                </span>
                              );
                            })}
                            {(() => {
                              const cps = calculateCps(item);
                              const isOptimal = cps >= 15 && cps <= 21;
                              const isHigh = cps > 21;
                              return (
                                <span
                                  title={`Tốc độ đọc: ${cps} CPS (Khuyến nghị: 15-21 CPS)`}
                                  className={`font-mono px-1.5 py-0.5 rounded text-[9px] font-semibold border ${
                                    isHigh
                                      ? 'bg-rose-500/20 text-rose-300 border-rose-500/40'
                                      : isOptimal
                                      ? 'bg-emerald-500/20 text-emerald-300 border-emerald-500/40'
                                      : 'bg-surface-2 text-text-muted border-border'
                                  }`}
                                >
                                  {cps} CPS
                                </span>
                              );
                            })()}
                          </div>
                        </div>
                        <div className="flex items-center gap-1">
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              splitLine(index);
                            }}
                            className="opacity-0 transition group-hover:opacity-100 text-text-muted hover:text-amber-400 cursor-pointer p-1 rounded hover:bg-surface-2"
                            title="Cắt đôi câu phụ đề này (Split) tại vị trí video hoặc giữa câu"
                          >
                            <Scissors className="h-3.5 w-3.5" />
                          </button>
                          {index < lines.length - 1 && (
                            <button
                              type="button"
                              onClick={(e) => {
                                e.stopPropagation();
                                mergeLineWithNext(index);
                              }}
                              className="opacity-0 transition group-hover:opacity-100 text-text-muted hover:text-indigo-400 cursor-pointer p-1 rounded hover:bg-surface-2"
                              title="Gộp câu này với câu kế tiếp (Merge)"
                            >
                              <GitMerge className="h-3.5 w-3.5" />
                            </button>
                          )}
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              insertLineAfter(index);
                            }}
                            className="opacity-0 transition group-hover:opacity-100 text-text-muted hover:text-accent cursor-pointer p-1 rounded hover:bg-surface-2"
                            title="Chèn thêm 1 dòng ngay phía dưới dòng này"
                          >
                            <ListPlus className="h-3.5 w-3.5" />
                          </button>
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              deleteLine(index);
                            }}
                            className="opacity-0 transition group-hover:opacity-100 text-rose-400 hover:text-rose-300 cursor-pointer p-1 rounded hover:bg-surface-2"
                            title="Xoá dòng"
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </button>
                        </div>
                      </div>

                      <div onClick={(e) => e.stopPropagation()} className="flex flex-col gap-1.5">
                        <TimeRow
                          label="Start"
                          valueMs={item.startMs}
                          onChangeMs={(ms) => updateLine(index, { startMs: Math.max(0, ms), endMs: Math.max(item.endMs, ms + 200) })}
                          onSyncVideo={() => setLineTimeFromVideo(index, 'startMs')}
                        />
                        <TimeRow
                          label="End"
                          valueMs={item.endMs}
                          onChangeMs={(ms) => updateLine(index, { endMs: Math.max(item.startMs + 200, ms) })}
                          onSyncVideo={() => setLineTimeFromVideo(index, 'endMs')}
                        />
                      </div>

                      {/* Hiển thị câu gốc để đối chiếu khi đang sửa bản dịch */}
                      {isTranslatedView && showBilingual && (
                        <div
                          onClick={(e) => e.stopPropagation()}
                          className="rounded-md border border-border bg-bg p-2.5 text-xs"
                        >
                          <div className="mb-1 text-[10px] font-semibold uppercase tracking-wider text-accent flex items-center gap-1.5">
                            <span className="h-1.5 w-1.5 rounded-full bg-accent-tint" />
                            <span>Bản gốc đối chiếu:</span>
                          </div>
                          <p className="font-normal text-text leading-relaxed whitespace-pre-line">
                            {originalLines.find((o) => o.id === item.id)?.text ||
                              originalLines[index]?.text ||
                              originalLines.find((o) => Math.abs(o.startMs - item.startMs) < 1000)?.text ||
                              '—'}
                          </p>
                        </div>
                      )}

                      <div onClick={(e) => e.stopPropagation()} className="flex items-start gap-2">
                        <textarea
                          rows={2}
                          value={item.text}
                          onChange={(e) => updateLine(index, { text: e.target.value })}
                          placeholder={isTranslatedView ? 'Nội dung bản dịch...' : 'Nội dung câu phụ đề...'}
                          className="flex-1 rounded-md border border-border bg-bg p-2 text-xs text-white placeholder:text-text-faint focus:border-accent/40 focus:outline-none"
                        />
                        <div className="flex flex-col gap-1">
                          {/* Sửa câu bằng AI (Hiệu đính ngữ pháp/văn phong) */}
                          <button
                            type="button"
                            onClick={() => handlePolishLine(index)}
                            disabled={aiBusyIndex !== null || !item.text.trim()}
                            title="Hiệu đính câu này bằng Gemini — sửa chính tả, ngữ pháp, làm mượt câu"
                            className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-lg border border-accent/40 bg-accent-tint text-accent transition hover:bg-accent-tint/25 disabled:cursor-not-allowed disabled:opacity-40 cursor-pointer"
                          >
                            {isBusyThis && aiActionType === 'polish' ? (
                              <Loader2 className="h-3.5 w-3.5 animate-spin" />
                            ) : (
                              <Wand2 className="h-3.5 w-3.5" />
                            )}
                          </button>

                          {/* Dịch câu này theo ngôn ngữ đích */}
                          <button
                            type="button"
                            onClick={() => handleTranslateLine(index)}
                            disabled={aiBusyIndex !== null || !item.text.trim()}
                            title={`Dịch câu này sang ${TARGET_LANGUAGES.find((l) => l.code === targetLanguage)?.label || targetLanguage} bằng Gemini`}
                            className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-lg border border-emerald-500/40 bg-emerald-500/10 text-emerald-400 transition hover:bg-emerald-500/25 disabled:cursor-not-allowed disabled:opacity-40 cursor-pointer"
                          >
                            {isBusyThis && aiActionType === 'translate' ? (
                              <Loader2 className="h-3.5 w-3.5 animate-spin" />
                            ) : (
                              <Globe2 className="h-3.5 w-3.5" />
                            )}
                          </button>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {/* Cột phải: xem trước video + timeline */}
          <div className="flex flex-col gap-3 overflow-y-auto rounded-lg border border-border bg-surface p-4">
            <h3 className="text-xs font-bold uppercase tracking-wider text-text">
              Xem trước &amp; Timeline
            </h3>

            {mediaUrl ? (
              <div className="relative overflow-hidden rounded-lg border border-border bg-black">
                <video
                  ref={videoRef}
                  src={mediaUrl}
                  controls
                  onLoadedMetadata={(e) =>
                    setDurationMs(
                      Number.isFinite(e.currentTarget.duration) ? e.currentTarget.duration * 1000 : 0
                    )
                  }
                  onPlay={() => setIsPlaying(true)}
                  onPause={() => setIsPlaying(false)}
                  className="w-full max-h-[300px]"
                />
                {activeIndex >= 0 && lines[activeIndex]?.text && (
                  <div className="pointer-events-none absolute inset-x-3 bottom-12 flex justify-center">
                    <span className="max-w-full whitespace-pre-line rounded-lg bg-black/75 px-3 py-1.5 text-center text-xs leading-snug text-white">
                      {lines[activeIndex].text}
                    </span>
                  </div>
                )}
              </div>
            ) : (
              <div className="flex h-[180px] flex-col items-center justify-center rounded-lg border border-border bg-bg text-center">
                <FileVideo className="h-10 w-10 text-slate-700 mb-2" />
                <span className="text-xs text-text-muted">Không có file media để xem trước</span>
              </div>
            )}

            <div className="flex items-center justify-between text-[11px] text-text-muted font-mono">
              <span>{formatMs(currentTimeMs)}</span>
              <span>{formatMs(durationMs)}</span>
            </div>

            {/* Timeline: mỗi khối = 1 dòng phụ đề, bấm để nhảy tới */}
            <div
              onClick={handleTimelineClick}
              className={[
                'relative h-12 w-full overflow-hidden rounded-md border border-border bg-bg',
                durationMs > 0 ? 'cursor-pointer' : '',
              ].join(' ')}
              title="Bấm để nhảy tới vị trí này trên video"
            >
              {durationMs > 0 &&
                lines.map((line, index) => {
                  const left = posPercent(line.startMs);
                  const width = Math.max(0.4, posPercent(line.endMs) - left);
                  return (
                    <div
                      key={line.id}
                      onClick={(e) => {
                        e.stopPropagation();
                        setEditorPage(Math.floor(index / EDITOR_PAGE_SIZE));
                        seekTo(line.startMs);
                      }}
                      title={`#${index + 1} · ${formatMs(line.startMs)} → ${formatMs(line.endMs)}\n${line.text}`}
                      className={[
                        'absolute bottom-5 top-1 min-w-[2px] rounded-[3px] cursor-pointer transition-colors',
                        index === activeIndex
                          ? 'bg-accent-tint'
                          : 'bg-accent-tint/50 hover:bg-accent-tint',
                      ].join(' ')}
                      style={{ left: `${left}%`, width: `${width}%` }}
                    />
                  );
                })}
              {durationMs > 0 && (
                <div
                  className="pointer-events-none absolute bottom-0 top-0 w-0.5 bg-rose-500/90"
                  style={{ left: `${posPercent(currentTimeMs)}%` }}
                />
              )}
              {durationMs <= 0 && (
                <div className="flex h-full items-center justify-center text-[11px] text-text-faint">
                  Timeline sẽ hiện khi video tải xong
                </div>
              )}
            </div>

            <div className="space-y-1.5 rounded-lg border border-border bg-surface p-3 text-[11px] leading-relaxed text-text-muted">
              <p>• Bấm vào một dòng hoặc khối trên timeline để video nhảy tới câu đó.</p>
              <p>• Nút ⊕ (Crosshair) gán thời điểm bắt đầu/kết thúc bằng vị trí phát hiện tại.</p>
              <p>• Nút Hiệu đính AI sửa lỗi ngữ pháp, nút Dịch chuyển đổi ngôn ngữ phụ đề.</p>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
