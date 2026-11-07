import React, { useState, useEffect, useMemo, useRef } from 'react';
import {
  FileText,
  Copy,
  Edit3,
  Sparkles,
  RotateCcw,
  Check,
  ChevronDown,
  ChevronUp,
  AlertCircle,
  Clock,
  Mic,
  ArrowLeft,
  Trash2,
  CheckCircle2,
  HelpCircle,
  Lightbulb,
  MessageSquare,
  Send,
  Loader2,
  Minimize2,
  Maximize2,
  MoveVertical,
  Image as ImageIcon,
  User,
  XCircle,
  Square,
  Video,
  Camera,
  Film,
} from 'lucide-react';
import type {
  PipelineSessionState,
  ScriptBeatLine,
  ScriptEvaluation,
  IdeaBlueprint,
} from '../../types/aiStudio';
import { useAiStudioStore } from '../../lib/store/aiStudioStore';
import { hasUsableScript } from '../../../shared/aiStudioScript';

export interface ExtendedScriptBeatLine extends ScriptBeatLine {
  beatType?: 'hook' | 'setup' | 'rising_action' | 'climax' | 'resolution' | 'call_to_action' | string;
  voiceDirection?: string;
  visualAction?: string;
  visualNote?: string;
  cameraAngle?: string;
  cameraMovement?: string;
  suggestedMediaType?: 'image' | 'video';
}

function formatCameraAngle(angle?: string): string {
  if (!angle) return 'Trung cảnh';
  const map: Record<string, string> = {
    wide_establishing: 'Toàn cảnh (Wide)',
    medium_shot: 'Trung cảnh (Medium)',
    close_up: 'Cận cảnh (Close-up)',
    low_angle: 'Góc thấp (Low Angle)',
    high_angle: 'Góc cao (High Angle)',
    point_of_view: 'Góc nhìn thứ nhất (POV)',
  };
  return map[angle] || angle;
}

function formatCameraMovement(movement?: string): string {
  if (!movement) return 'Cố định';
  const map: Record<string, string> = {
    pan_left_to_right: 'Lia phải (Pan R)',
    pan_right_to_left: 'Lia trái (Pan L)',
    dolly_in: 'Tiến lại (Dolly In)',
    dolly_out: 'Lùi ra (Dolly Out)',
    pedestal_up: 'Nâng máy (Up)',
    pedestal_down: 'Hạ máy (Down)',
    static: 'Cố định (Static)',
  };
  return map[movement] || movement;
}

interface ScriptWorkspaceViewProps {
  session: PipelineSessionState;
  blueprint?: IdeaBlueprint | null;
  isRunning?: boolean;
  onProceedToVoice: () => void;
  onRegenerateScript: () => void;
  onBackToIdeas: () => void;
  onDeleteVideo?: () => void;
  onCancelProcess?: () => void;
  onSwitchTab?: (tab: 'script' | 'visual' | 'character') => void;
  activeCenterTab?: 'script' | 'visual' | 'character';
  onSessionUpdate?: (updatedSession: PipelineSessionState) => void;
}

export default function ScriptWorkspaceView({
  session,
  blueprint: propBlueprint,
  isRunning = false,
  onProceedToVoice,
  onRegenerateScript,
  onBackToIdeas,
  onDeleteVideo,
  onCancelProcess,
  onSwitchTab,
  activeCenterTab = 'script',
  onSessionUpdate,
}: ScriptWorkspaceViewProps) {
  const { config } = useAiStudioStore();

  const blueprint = propBlueprint || session.artifacts?.blueprint || null;
  const initialLines = (session.artifacts?.scriptLines || []) as ExtendedScriptBeatLine[];

  const [lines, setLines] = useState<ExtendedScriptBeatLine[]>(initialLines);
  const [evaluation, setEvaluation] = useState<ScriptEvaluation | null>(
    session.artifacts?.scriptEvaluation || null
  );
  const [isIdeaAccordionOpen, setIsIdeaAccordionOpen] = useState(false);
  const [editingLineIndex, setEditingLineIndex] = useState<number | null>(null);
  const [editingText, setEditingText] = useState('');
  const [editingVisualAction, setEditingVisualAction] = useState('');
  const [editingCameraAngle, setEditingCameraAngle] = useState('medium_shot');
  const [editingCameraMovement, setEditingCameraMovement] = useState('static');
  const [editingMediaType, setEditingMediaType] = useState<'video' | 'image'>('video');
  const [editingVoiceDirection, setEditingVoiceDirection] = useState('');
  const [copyToast, setCopyToast] = useState<string | null>(null);

  // Script height controls (kéo dài hoặc thu ngắn kịch bản)
  const [scriptHeight, setScriptHeight] = useState<number>(320);
  const [isScriptExpanded, setIsScriptExpanded] = useState<boolean>(false);
  const [isResizingScript, setIsResizingScript] = useState<boolean>(false);
  const [copiedThumbPrompt, setCopiedThumbPrompt] = useState<boolean>(false);
  const ideaSectionRef = useRef<HTMLDivElement>(null);

  const handleMouseDownResizer = (e: React.MouseEvent) => {
    e.preventDefault();
    setIsResizingScript(true);
    setIsScriptExpanded(false);
    const startY = e.clientY;
    const startHeight = scriptHeight;

    const handleMouseMove = (moveEvent: MouseEvent) => {
      const deltaY = moveEvent.clientY - startY;
      const newHeight = Math.max(160, Math.min(850, startHeight + deltaY));
      setScriptHeight(newHeight);
    };

    const handleMouseUp = () => {
      setIsResizingScript(false);
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
    };

    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);
  };

  const handleFocusIdeaSection = () => {
    setIsIdeaAccordionOpen(true);
    setIsScriptExpanded(false);
    setScriptHeight(200);
    setTimeout(() => {
      ideaSectionRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }, 100);
  };

  const handleCopyThumbPrompt = (promptText: string) => {
    if (!promptText) return;
    navigator.clipboard.writeText(promptText);
    setCopiedThumbPrompt(true);
    setTimeout(() => setCopiedThumbPrompt(false), 2500);
  };

  // AI Action Loading states
  const [isSavingScript, setIsSavingScript] = useState(false);
  const [isEvaluating, setIsEvaluating] = useState(false);
  const [isRefining, setIsRefining] = useState(false);
  const [customPromptModalOpen, setCustomPromptModalOpen] = useState(false);
  const [customPromptText, setCustomPromptText] = useState('');

  const scriptBusy = isRunning || isSavingScript || isEvaluating || isRefining;
  const hasScript = hasUsableScript(lines);
  const canApproveScript = hasScript && !scriptBusy && !session.manualMode &&
    session.status === 'awaiting_approval' && session.currentStage === 2 && session.stages?.[2]?.status === 'success';

  // History for Undo
  const [history, setHistory] = useState<
    { lines: ExtendedScriptBeatLine[]; evaluation: ScriptEvaluation | null }[]
  >([]);

  // Sync state when session changes
  useEffect(() => {
    setLines((session.artifacts?.scriptLines || []) as ExtendedScriptBeatLine[]);
    setEvaluation(session.artifacts?.scriptEvaluation || null);
  }, [session.sessionId, session.artifacts?.scriptLines, session.artifacts?.scriptEvaluation]);

  // Calculate statistics (word count & estimated duration)
  const stats = useMemo(() => {
    const totalWords = lines.reduce((acc, l) => acc + (l.text || '').split(/\s+/).filter(Boolean).length, 0);
    const totalSeconds = Math.round(totalWords / 3.3); // ~200 words per minute
    const minutes = Math.floor(totalSeconds / 60);
    const seconds = totalSeconds % 60;
    const formattedDuration = `~${minutes}:${seconds < 10 ? '0' : ''}${seconds}`;
    return {
      count: lines.length,
      words: totalWords,
      duration: formattedDuration,
    };
  }, [lines]);

  // Timestamps calculation for narration beat lines
  const timestamps = useMemo(() => {
    let runningSec = 0;
    return lines.map((l) => {
      const mins = Math.floor(runningSec / 60);
      const secs = Math.floor(runningSec % 60);
      const timeStr = `${mins}:${secs < 10 ? '0' : ''}${secs}`;
      const lineWords = (l.text || '').split(/\s+/).filter(Boolean).length;
      const duration = (l.durationMs ? Math.round(l.durationMs / 1000) : 0) || Math.max(3, Math.round(lineWords / 3.3));
      runningSec += duration;
      return timeStr;
    });
  }, [lines]);

  const notifySessionUpdate = (newLines: ExtendedScriptBeatLine[], newEval: ScriptEvaluation | null, canonical?: PipelineSessionState) => {
    if (!onSessionUpdate) return;
    const updatedSession: PipelineSessionState = {
      ...session,
      artifacts: {
        ...session.artifacts,
        scriptLines: newLines,
        scriptEvaluation: newEval || undefined,
      },
      updatedAt: Date.now(),
    };
    onSessionUpdate(canonical || updatedSession);
  };

  // Trigger AI evaluation
  const handleEvaluate = async () => {
    if (scriptBusy || !hasScript || !window.vanhsub?.aiStudio?.evaluateScript) return;
    setIsEvaluating(true);
    try {
      const result = await window.vanhsub.aiStudio.evaluateScript({
        sessionId: session.sessionId,
        lines,
        blueprint: blueprint || undefined,
        channelProfile: config.channelProfile,
      });
      if (result?.evaluation) {
        setEvaluation(result.evaluation);
        notifySessionUpdate(lines, result.evaluation, result.session);
      }
    } catch (err) {
      console.error('[ScriptWorkspaceView] Evaluate error:', err);
      setCopyToast(`Lỗi chấm điểm: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setIsEvaluating(false);
    }
  };

  // Trigger AI improvement (Cải thiện điểm)
  const handleImproveScore = async () => {
    if (scriptBusy || !hasScript || !window.vanhsub?.aiStudio?.refineScript) return;
    setIsRefining(true);

    try {
      const result = await window.vanhsub.aiStudio.refineScript({
        sessionId: session.sessionId,
        lines,
        mode: 'improve_weaknesses',
        blueprint: blueprint || undefined,
        channelProfile: config.channelProfile,
      });

      if (result?.lines && result.lines.length > 0) {
        setHistory((prev) => [{ lines: [...lines], evaluation }, ...prev]);
        setLines(result.lines as ExtendedScriptBeatLine[]);
        setEvaluation(result.evaluation || null);
        notifySessionUpdate(result.lines as ExtendedScriptBeatLine[], result.evaluation || null, result.session);
      }
    } catch (err) {
      console.error('[ScriptWorkspaceView] Improve error:', err);
      setCopyToast(`Lỗi chỉnh kịch bản: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setIsRefining(false);
    }
  };

  // Submit custom refinement prompt (Yêu cầu của tôi)
  const handleCustomPromptSubmit = async () => {
    if (scriptBusy || !hasScript || !customPromptText.trim() || !window.vanhsub?.aiStudio?.refineScript) return;
    setCustomPromptModalOpen(false);
    setIsRefining(true);

    try {
      const result = await window.vanhsub.aiStudio.refineScript({
        sessionId: session.sessionId,
        lines,
        instructions: customPromptText.trim(),
        mode: 'custom_prompt',
        blueprint: blueprint || undefined,
        channelProfile: config.channelProfile,
      });

      if (result?.lines && result.lines.length > 0) {
        setHistory((prev) => [{ lines: [...lines], evaluation }, ...prev]);
        setLines(result.lines as ExtendedScriptBeatLine[]);
        setEvaluation(result.evaluation || null);
        notifySessionUpdate(result.lines as ExtendedScriptBeatLine[], result.evaluation || null, result.session);
        setCustomPromptText('');
      }
    } catch (err) {
      console.error('[ScriptWorkspaceView] Custom refine error:', err);
      setCopyToast(`Lỗi chỉnh kịch bản: ${err instanceof Error ? err.message : String(err)}`);
      setCustomPromptModalOpen(true);
    } finally {
      setIsRefining(false);
    }
  };

  // Undo last edit
  const handleUndo = async () => {
    if (scriptBusy || history.length === 0 || !window.vanhsub?.aiStudio?.updateScriptLines) return;
    const [previous, ...rest] = history;
    setIsSavingScript(true);
    try {
      const result = await window.vanhsub.aiStudio.updateScriptLines({ sessionId: session.sessionId, lines: previous.lines });
      if (!result.success) throw new Error('Không lưu được kịch bản.');
      setLines(result.scriptLines);
      setEvaluation(result.session?.artifacts.scriptEvaluation || null);
      setHistory(rest);
      notifySessionUpdate(result.scriptLines, null, result.session);
    } catch (err) {
      setCopyToast(`Lỗi lưu: ${err instanceof Error ? err.message : String(err)}`);
    } finally { setIsSavingScript(false); }
  };

  // Start editing a specific line
  const handleStartEditLine = (index: number) => {
    if (scriptBusy) return;
    setEditingLineIndex(index);
    const line = lines[index];
    setEditingText(line?.text || '');
    setEditingVisualAction(line?.visualAction || line?.visualNote || '');
    setEditingCameraAngle(line?.cameraAngle || 'medium_shot');
    setEditingCameraMovement(line?.cameraMovement || 'static');
    setEditingMediaType(line?.suggestedMediaType || 'video');
    setEditingVoiceDirection(line?.voiceDirection || '');
  };

  // Save inline edited line
  const handleSaveInlineEdit = async (index: number) => {
    if (scriptBusy) return;
    if (lines[index]) {
      const updated: ExtendedScriptBeatLine[] = lines.map((line, idx) =>
        idx === index
          ? {
              ...line,
              text: editingText.trim() || line.text,
              visualAction: editingVisualAction.trim() || undefined,
              cameraAngle: editingCameraAngle || undefined,
              cameraMovement: editingCameraMovement || undefined,
              suggestedMediaType: editingMediaType,
              voiceDirection: editingVoiceDirection.trim() || undefined,
            }
          : line
      );
      if (!window.vanhsub?.aiStudio?.updateScriptLines) return;
      setIsSavingScript(true);
      try {
        const result = await window.vanhsub.aiStudio.updateScriptLines({ sessionId: session.sessionId, lines: updated });
        if (!result.success) throw new Error('Không lưu được kịch bản.');
        setHistory((prev) => [{ lines: [...lines], evaluation }, ...prev]);
        setLines(result.scriptLines);
        setEvaluation(result.session?.artifacts.scriptEvaluation || null);
        setEditingLineIndex(null);
        notifySessionUpdate(result.scriptLines, null, result.session);
      } catch (err) {
        setCopyToast(`Lỗi lưu: ${err instanceof Error ? err.message : String(err)}`);
      } finally { setIsSavingScript(false); }
    } else {
      setEditingLineIndex(null);
    }
  };

  // Copy full 2-column script to clipboard
  const handleCopyAudiovisualScript = () => {
    const fullText = lines
      .map((l, idx) => {
        const time = timestamps[idx] || '0:00';
        const visual = l.visualAction || l.visualNote || '(Chưa có mô tả hình ảnh)';
        const cam = [formatCameraAngle(l.cameraAngle), formatCameraMovement(l.cameraMovement)]
          .filter(Boolean)
          .join(' | ');
        const media = l.suggestedMediaType === 'image' ? 'ẢNH' : 'VIDEO';
        return `[#${idx + 1} - ${time} - ${media}]\nTHOẠI: ${l.text}${
          l.voiceDirection ? ` (Chỉ dẫn: ${l.voiceDirection})` : ''
        }\nHÌNH ẢNH: ${visual}${cam ? ` [Góc & Chuyển động: ${cam}]` : ''}`;
      })
      .join('\n\n---\n\n');
    navigator.clipboard.writeText(fullText);
    setCopyToast('Đã sao chép kịch bản 2 cột (Audiovisual) vào clipboard!');
    setTimeout(() => setCopyToast(null), 3000);
  };

  // Copy full script to clipboard
  const handleCopyScript = () => {
    const fullText = lines.map((l) => l.text).join('\n\n');
    navigator.clipboard.writeText(fullText);
    setCopyToast('Đã sao chép toàn bộ kịch bản vào clipboard!');
    setTimeout(() => setCopyToast(null), 3000);
  };

  const title = blueprint?.title || session.topic || 'Kịch bản Video';
  const hookQuote =
    blueprint?.hookConcept ||
    lines[0]?.text ||
    'Một câu chuyện kỳ bí mở ra những bí mật chấn động chưa từng được tiết lộ.';

  return (
    <div className="flex flex-col h-full bg-[#070B14] text-text overflow-hidden">
      
      {/* 1. Top Sub-Navigation Tabs matching Revo Studio */}
      <div className="flex items-center justify-between px-5 pt-3 pb-2 border-b border-border bg-[#090E1A] shrink-0">
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => onSwitchTab?.('script')}
            className={`rounded-md px-4 py-1.5 text-xs font-bold transition cursor-pointer ${
              activeCenterTab === 'script'
                ? 'bg-[#1C263A] text-white border border-border '
                : 'text-text-muted hover:text-white'
            }`}
          >
            Kịch bản &amp; Giọng
          </button>
          <button
            type="button"
            onClick={() => onSwitchTab?.('visual')}
            className={`rounded-md px-4 py-1.5 text-xs font-semibold transition cursor-pointer ${
              activeCenterTab === 'visual'
                ? 'bg-[#1C263A] text-white border border-border '
                : 'text-text-muted hover:text-white'
            }`}
          >
            Phân cảnh Visual
          </button>
          <button
            type="button"
            onClick={() => onSwitchTab?.('character')}
            className={`rounded-md px-4 py-1.5 text-xs font-semibold transition cursor-pointer ${
              activeCenterTab === 'character'
                ? 'bg-[#1C263A] text-white border border-border '
                : 'text-text-muted hover:text-white'
            }`}
          >
            Nhân vật
          </button>
        </div>

        <span className="rounded-full bg-orange-500/20 px-3 py-0.5 text-[11px] font-bold text-orange-400 border border-orange-500/30 uppercase tracking-wider">
          {session.status === 'awaiting_approval' ? 'paused' : session.status}
        </span>
      </div>

      {/* Main Scrollable Viewport */}
      <div className="flex-1 overflow-y-auto custom-scrollbar p-5 space-y-4">
        
        {/* Status Line */}
        <div className="text-xs text-text-muted">
          Trạng thái:{' '}
          <span className="text-amber-400 font-mono font-bold">
            {session.status === 'awaiting_approval' ? 'paused' : session.status}
          </span>
        </div>

        {/* Video Big Title & Hook Quote */}
        <div className="space-y-1.5">
          <h2 className="text-lg md:text-xl font-bold text-white tracking-tight">
            {title}
          </h2>
          <p className="text-xs text-amber-300/90 italic font-medium leading-relaxed">
            &ldquo;{hookQuote.replace(/^["“]+|["”]+$/g, '')}&rdquo;
          </p>
        </div>

        {/* 2. Box: Điểm Kịch Bản (Script Evaluation Box) */}
        <div className="rounded-lg border border-border bg-[#0B101E] p-4 space-y-3.5">
          {/* Header row */}
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-3">
              <span className="flex items-center gap-1.5 text-xs font-bold text-text uppercase tracking-wider">
                Điểm kịch bản
                <HelpCircle className="h-3.5 w-3.5 text-text-muted cursor-help" />
              </span>

              {evaluation && (
                <div className="flex items-center gap-2">
                  <span className="text-base font-extrabold text-white">
                    {evaluation.overallScore}/100
                  </span>
                  <span className="text-[11px] text-text-muted">
                    Thấp nhất {evaluation.lowestScore}/10
                  </span>
                  {evaluation.failedCriteria.length > 0 && (
                    <span className="rounded bg-amber-500/15 border border-amber-500/30 px-2 py-0.5 text-[10px] font-bold text-amber-300">
                      Chưa đạt ở {evaluation.failedCriteria.join(', ')}
                    </span>
                  )}
                </div>
              )}
            </div>

            {/* Actions: Undo / Re-evaluate */}
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={handleEvaluate}
                disabled={scriptBusy || !hasScript}
                className="flex items-center gap-1 rounded-lg border border-border bg-[#0F1626] px-2.5 py-1 text-[11px] text-text hover:text-white transition cursor-pointer"
                title="Chấm lại điểm bằng AI"
              >
                <RotateCcw className={`h-3 w-3 ${isEvaluating ? 'animate-spin text-accent' : ''}`} />
                <span>{isEvaluating ? 'Đang chấm...' : 'Chấm lại điểm'}</span>
              </button>

              {history.length > 0 && (
                <button
                  type="button"
                  onClick={handleUndo}
                  disabled={scriptBusy}
                  className="flex items-center gap-1 rounded-lg border border-border bg-[#0F1626] px-2.5 py-1 text-[11px] text-text hover:text-white transition cursor-pointer"
                >
                  <RotateCcw className="h-3 w-3" />
                  <span>Hoàn tác lượt sửa</span>
                </button>
              )}
            </div>
          </div>

          {/* 10 Dimension Badges D1 to D10 */}
          {evaluation?.criteria && evaluation.criteria.length > 0 && (
            <div className="space-y-1.5">
              <div className="flex flex-wrap gap-1.5">
                {evaluation.criteria.map((c) => {
                  const isFail = c.score <= 5;
                  const isModerate = c.score === 6 || c.score === 7;
                  return (
                    <span
                      key={c.id}
                      title={`${c.name}: ${c.score}/10 — ${c.feedback || ''}`}
                      className={`inline-flex items-center gap-1 rounded-lg px-2.5 py-1 text-[11px] font-mono font-bold border transition cursor-default ${
                        isFail
                          ? 'bg-rose-500/25 border-rose-500/40 text-rose-200'
                          : isModerate
                          ? 'bg-amber-500/20 border-amber-500/30 text-amber-300'
                          : 'bg-emerald-500/20 border-emerald-500/30 text-emerald-300'
                      }`}
                    >
                      <span>{c.id}</span>
                      <span>{c.score}</span>
                    </span>
                  );
                })}
              </div>
              <p className="text-[11px] text-text-muted italic">
                Thang 0-10 mỗi tiêu chí — Đạt = MỌI tiêu chí &ge; 8
              </p>
            </div>
          )}

          {/* Critique text */}
          {evaluation?.critique && (
            <p className="text-xs text-text leading-relaxed">
              {evaluation.critique}
            </p>
          )}

          {/* Review provenance, including checkpoints predating provider evaluation. */}
          {evaluation && (
            <div className="rounded-md border border-amber-500/30 bg-amber-950/20 px-3 py-2 text-[11px] text-amber-200/90 leading-relaxed flex items-start gap-2">
              
              <span>{evaluation.method === 'llm' ? evaluation.notice : 'Điểm lưu từ phiên bản cũ chưa xác định phương pháp chấm. Hãy chấm lại bằng provider đã chọn; dữ kiện chưa được đối chiếu nguồn.'}</span>
            </div>
          )}

          {/* Action buttons: Cải thiện điểm & Yêu cầu của tôi */}
          <div className="flex flex-wrap items-center gap-2 pt-1">
            <button
              type="button"
              onClick={handleImproveScore}
              disabled={scriptBusy || !hasScript}
              className="inline-flex items-center gap-1.5 rounded-md bg-teal-600/90 hover:bg-teal-500 px-3.5 py-1.5 text-xs font-bold text-white shadow transition active:scale-95 disabled:opacity-50 cursor-pointer"
            >
              {isRefining ? (
                <>
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  <span>Đang sửa kịch bản...</span>
                </>
              ) : (
                <>
                  <Sparkles className="h-3.5 w-3.5" />
                  <span>Cải thiện điểm</span>
                </>
              )}
            </button>

            <button
              type="button"
              onClick={() => setCustomPromptModalOpen(true)}
              disabled={scriptBusy || !hasScript}
              className="inline-flex items-center gap-1.5 rounded-md border border-border bg-surface hover:bg-surface-2 px-3.5 py-1.5 text-xs font-semibold text-text transition active:scale-95 disabled:opacity-50 cursor-pointer"
            >
              <span>Yêu cầu của tôi</span>
            </button>
          </div>
        </div>

        {/* 3. Box: Kịch Bản Phân Cảnh 2 Cột (Two-Column Audiovisual Script) */}
        <div className="rounded-lg border border-border bg-[#0B101E] p-4 space-y-3">
          {/* Header row */}
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-2.5">
              <span className="text-xs font-bold text-white flex items-center gap-1.5">
                <FileText className="h-3.5 w-3.5 text-accent" />
                Kịch bản phân cảnh 2 cột (Audiovisual Script)
              </span>
              <span className="text-[11px] font-mono text-text-muted">
                {stats.count} phân đoạn &bull; {stats.words} từ &bull; {stats.duration}
                {session.artifacts?.wordsAlignment?.length ? (
                  <span className="block mt-1 text-[10px] text-text-muted">
                    {session.artifacts.alignmentSource === 'word_boundary' ? 'Mốc từ từ metadata TTS'
                      : session.artifacts.alignmentSource === 'mixed' ? 'Mốc từ: metadata và ước lượng theo đoạn'
                      : session.artifacts.alignmentSource === 'estimated_per_line' ? 'Mốc từ ước lượng theo thời lượng audio từng đoạn'
                      : 'Mốc từ từ phiên bản cũ chưa xác định phương pháp; nên chạy lại alignment'}
                  </span>
                ) : null}
              </span>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              {/* Quick height buttons */}
              <div className="flex items-center rounded-lg border border-border bg-[#090E1A] p-0.5 text-[10px]">
                <button
                  type="button"
                  onClick={() => {
                    setIsScriptExpanded(false);
                    setScriptHeight(200);
                  }}
                  className={`px-2 py-0.5 rounded transition cursor-pointer ${
                    !isScriptExpanded && scriptHeight <= 220
                      ? 'bg-accent-tint text-accent font-bold'
                      : 'text-text-muted hover:text-white'
                  }`}
                  title="Thu ngắn danh sách phân cảnh còn 200px"
                >
                  Thu ngắn (200px)
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setIsScriptExpanded(false);
                    setScriptHeight(360);
                  }}
                  className={`px-2 py-0.5 rounded transition cursor-pointer ${
                    !isScriptExpanded && scriptHeight > 220 && scriptHeight <= 450
                      ? 'bg-accent-tint text-accent font-bold'
                      : 'text-text-muted hover:text-white'
                  }`}
                  title="Độ cao vừa phải (360px)"
                >
                  Vừa (360px)
                </button>
                <button
                  type="button"
                  onClick={() => setIsScriptExpanded((prev) => !prev)}
                  className={`px-2 py-0.5 rounded transition cursor-pointer ${
                    isScriptExpanded
                      ? 'bg-accent-tint text-accent font-bold'
                      : 'text-text-muted hover:text-white'
                  }`}
                  title={isScriptExpanded ? 'Thu lại độ cao mặc định' : 'Mở rộng hiển thị toàn bộ kịch bản'}
                >
                  {isScriptExpanded ? '↕ Thu lại' : '↕ Kéo dài hết'}
                </button>
              </div>

              {blueprint && (
                <button
                  type="button"
                  onClick={handleFocusIdeaSection}
                  className="inline-flex items-center gap-1 rounded-lg border border-amber-500/40 bg-amber-950/25 px-2.5 py-1 text-[11px] font-medium text-amber-300 hover:bg-amber-900/40 hover:text-amber-100 transition cursor-pointer"
                  title="Thu gọn kịch bản và cuộn tới Thông tin ý tưởng & nhân vật"
                >
                  <Lightbulb className="h-3 w-3 text-amber-400" />
                  <span>Xem thông tin ý tưởng</span>
                </button>
              )}

              <button
                type="button"
                onClick={handleCopyAudiovisualScript}
                className="inline-flex items-center gap-1 rounded-lg border border-cyan-500/40 bg-cyan-950/30 px-2.5 py-1 text-[11px] font-medium text-cyan-300 hover:bg-cyan-900/40 hover:text-cyan-100 transition cursor-pointer"
                title="Sao chép kịch bản 2 cột (Lời thoại + Hình ảnh & Góc máy)"
              >
                <Copy className="h-3 w-3 text-cyan-400" />
                <span>Sao chép 2 cột</span>
              </button>

              <button
                type="button"
                onClick={handleCopyScript}
                className="inline-flex items-center gap-1 rounded-lg border border-border bg-[#0F1626] px-2.5 py-1 text-[11px] text-text hover:text-white transition cursor-pointer"
                title="Sao chép chỉ phần lời thoại thuyết minh"
              >
                <Copy className="h-3 w-3" />
                <span>Sao chép thoại</span>
              </button>

              <button
                type="button"
                onClick={() => handleStartEditLine(0)}
                disabled={scriptBusy}
                className="inline-flex items-center gap-1 rounded-lg border border-border bg-[#0F1626] px-2.5 py-1 text-[11px] text-text hover:text-white transition cursor-pointer"
              >
                <Edit3 className="h-3 w-3" />
                <span>Sửa phân cảnh</span>
              </button>
            </div>
          </div>

          <p className="text-[11px] text-amber-400/90 italic">
            Kịch bản 2 cột tiêu chuẩn: Cột 1 Lời thoại (Voiceover) song song Cột 2 Hành động hình ảnh &amp; Máy quay (Visual Action &amp; Camera). Nhấp vào phân cảnh để sửa trực tiếp.
          </p>

          {copyToast && (
            <div className="rounded-lg bg-emerald-950/60 border border-emerald-500/40 px-3 py-1.5 text-xs text-emerald-300 animate-in fade-in">
              {copyToast}
            </div>
          )}

          {/* Column Header Titles for Two-Column Audiovisual Format */}
          <div className="hidden md:grid grid-cols-12 gap-3 px-3 py-2 rounded-md bg-[#080C16] border border-border/80 text-[11px] font-bold text-text-muted uppercase tracking-wider select-none">
            <div className="col-span-1 text-center font-mono text-[10px]"># &bull; Giờ</div>
            <div className="col-span-5 flex items-center gap-1.5 text-cyan-400">
              <Mic className="h-3.5 w-3.5 text-cyan-400" />
              <span>Cột 1: Lời thoại &amp; Diễn xuất (Voiceover / Audio)</span>
            </div>
            <div className="col-span-6 flex items-center gap-1.5 text-amber-400">
              <Video className="h-3.5 w-3.5 text-amber-400" />
              <span>Cột 2: Hành động hình ảnh &amp; Máy quay (Visual &amp; Camera)</span>
            </div>
          </div>

          {/* Script lines list with resizable height */}
          <div
            style={{
              maxHeight: isScriptExpanded ? 'none' : `${scriptHeight}px`,
            }}
            className="space-y-3 overflow-y-auto custom-scrollbar pr-1.5 transition-[max-height] duration-150"
          >
            {lines.map((line, idx) => {
              const isEditing = editingLineIndex === idx;
              const timeLabel = timestamps[idx] || '0:00';

              if (isEditing) {
                // Editing Mode
                return (
                  <div
                    key={line.id || idx}
                    className="rounded-lg border border-accent/40 bg-[#0E1526] p-3 space-y-3 shadow-lg"
                  >
                    {/* Header bar of editing row */}
                    <div className="flex items-center justify-between pb-2 border-b border-border/60 text-xs">
                      <div className="flex items-center gap-2">
                        <span className="font-mono font-bold text-accent">Phân đoạn #{idx + 1}</span>
                        <span className="font-mono text-text-muted text-[11px]">⏱️ {timeLabel}</span>
                      </div>
                      <div className="flex items-center gap-2">
                        <button
                          type="button"
                          onClick={() => setEditingLineIndex(null)}
                          className="rounded px-2.5 py-1 text-[11px] text-text-muted hover:text-white"
                        >
                          Hủy
                        </button>
                        <button
                          type="button"
                          onClick={() => handleSaveInlineEdit(idx)}
                          disabled={scriptBusy}
                          className="inline-flex items-center gap-1 rounded bg-accent hover:bg-cyan-400 px-3 py-1 text-[11px] font-bold text-slate-950 shadow"
                        >
                          <Check className="h-3 w-3" />
                          <span>Lưu phân cảnh</span>
                        </button>
                      </div>
                    </div>

                    {/* Two editing columns */}
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                      {/* Left Column Editor: Voiceover & Voice Direction */}
                      <div className="space-y-2 bg-[#090E1A] p-2.5 rounded-lg border border-border/60">
                        <div className="flex items-center justify-between text-[11px]">
                          <label className="font-semibold text-cyan-300 flex items-center gap-1">
                            <Mic className="h-3 w-3" />
                            Lời thoại (Voiceover)
                          </label>
                        </div>
                        <textarea
                          value={editingText}
                          onChange={(e) => setEditingText(e.target.value)}
                          rows={4}
                          autoFocus
                          placeholder="Nhập lời thoại..."
                          className="w-full rounded-md border border-border bg-[#050811] px-2.5 py-1.5 text-xs text-white focus:border-accent/40 focus:outline-none"
                          onKeyDown={(e) => {
                            if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
                              handleSaveInlineEdit(idx);
                            } else if (e.key === 'Escape') {
                              setEditingLineIndex(null);
                            }
                          }}
                        />
                        <div className="space-y-1">
                          <label className="text-[10px] text-text-muted font-medium">Chỉ dẫn ngữ điệu (Voice Direction):</label>
                          <input
                            type="text"
                            value={editingVoiceDirection}
                            onChange={(e) => setEditingVoiceDirection(e.target.value)}
                            placeholder="VD: Hồi hộp, dồn dập, thì thầm bí ẩn..."
                            className="w-full rounded-md border border-border bg-[#050811] px-2.5 py-1 text-xs text-text focus:border-accent/40 focus:outline-none"
                          />
                        </div>
                      </div>

                      {/* Right Column Editor: Visual Action & Camera Angles */}
                      <div className="space-y-2 bg-[#090E1A] p-2.5 rounded-lg border border-border/60">
                        <div className="flex items-center justify-between text-[11px]">
                          <label className="font-semibold text-amber-300 flex items-center gap-1">
                            <Video className="h-3 w-3" />
                            Hành động hình ảnh (Visual Action)
                          </label>
                          <div className="flex items-center gap-1">
                            <button
                              type="button"
                              onClick={() => setEditingMediaType('video')}
                              className={`px-2 py-0.5 rounded text-[10px] font-bold transition cursor-pointer ${
                                editingMediaType === 'video'
                                  ? 'bg-rose-500/20 text-rose-300 border border-rose-500/40'
                                  : 'text-text-muted hover:text-white'
                              }`}
                            >
                              🎬 Video
                            </button>
                            <button
                              type="button"
                              onClick={() => setEditingMediaType('image')}
                              className={`px-2 py-0.5 rounded text-[10px] font-bold transition cursor-pointer ${
                                editingMediaType === 'image'
                                  ? 'bg-blue-500/20 text-blue-300 border border-blue-500/40'
                                  : 'text-text-muted hover:text-white'
                              }`}
                            >
                              🖼️ Ảnh
                            </button>
                          </div>
                        </div>

                        <textarea
                          value={editingVisualAction}
                          onChange={(e) => setEditingVisualAction(e.target.value)}
                          rows={3}
                          placeholder="Mô tả hành động, bối cảnh hình ảnh..."
                          className="w-full rounded-md border border-border bg-[#050811] px-2.5 py-1.5 text-xs text-white focus:border-accent/40 focus:outline-none"
                          onKeyDown={(e) => {
                            if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
                              handleSaveInlineEdit(idx);
                            } else if (e.key === 'Escape') {
                              setEditingLineIndex(null);
                            }
                          }}
                        />

                        <div className="grid grid-cols-2 gap-2 text-[10px]">
                          <div>
                            <label className="text-text-muted block mb-0.5 font-medium">Góc máy (Angle):</label>
                            <select
                              value={editingCameraAngle}
                              onChange={(e) => setEditingCameraAngle(e.target.value)}
                              className="w-full rounded border border-border bg-[#050811] px-2 py-1 text-xs text-white focus:outline-none"
                            >
                              <option value="wide_establishing">Toàn cảnh (Wide)</option>
                              <option value="medium_shot">Trung cảnh (Medium)</option>
                              <option value="close_up">Cận cảnh (Close-up)</option>
                              <option value="low_angle">Góc thấp (Low Angle)</option>
                              <option value="high_angle">Góc cao (High Angle)</option>
                              <option value="point_of_view">Góc nhìn POV</option>
                            </select>
                          </div>

                          <div>
                            <label className="text-text-muted block mb-0.5 font-medium">Chuyển động (Motion):</label>
                            <select
                              value={editingCameraMovement}
                              onChange={(e) => setEditingCameraMovement(e.target.value)}
                              className="w-full rounded border border-border bg-[#050811] px-2 py-1 text-xs text-white focus:outline-none"
                            >
                              <option value="pan_left_to_right">Lia phải (Pan R)</option>
                              <option value="pan_right_to_left">Lia trái (Pan L)</option>
                              <option value="dolly_in">Tiến lại (Dolly In)</option>
                              <option value="dolly_out">Lùi xa (Dolly Out)</option>
                              <option value="pedestal_up">Nâng máy (Up)</option>
                              <option value="pedestal_down">Hạ máy (Down)</option>
                              <option value="static">Cố định (Static)</option>
                            </select>
                          </div>
                        </div>
                      </div>
                    </div>
                  </div>
                );
              }

              // Display Mode (Clean 2-Column Audiovisual Row)
              return (
                <div
                  key={line.id || idx}
                  className="rounded-lg border border-border/70 bg-[#080D1A] hover:border-slate-700 hover:bg-[#0A1020] transition p-3 space-y-2 group"
                >
                  {/* Row Metadata Bar */}
                  <div className="flex items-center justify-between text-[11px] text-text-muted border-b border-border/40 pb-1.5">
                    <div className="flex items-center gap-2">
                      <span className="font-mono font-bold text-accent text-[11px]">
                        #{String(idx + 1).padStart(2, '0')}
                      </span>
                      <span className="font-mono text-[10px] text-slate-400 bg-black/40 px-1.5 py-0.5 rounded border border-slate-800">
                        {timeLabel}
                      </span>
                      {line.beatType && (
                        <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-slate-800/80 text-slate-300 border border-slate-700/60 uppercase">
                          {line.beatType.replace('_', ' ')}
                        </span>
                      )}
                    </div>

                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        onClick={() => handleStartEditLine(idx)}
                        disabled={scriptBusy}
                        className="opacity-70 group-hover:opacity-100 inline-flex items-center gap-1 rounded border border-border/80 bg-surface px-2 py-0.5 text-[10px] text-text-muted hover:text-white transition cursor-pointer"
                        title="Chỉnh sửa phân cảnh này"
                      >
                        <Edit3 className="h-2.5 w-2.5" />
                        <span>Sửa</span>
                      </button>
                    </div>
                  </div>

                  {/* 2-Column Content Grid */}
                  <div className="grid grid-cols-1 md:grid-cols-12 gap-3 items-start">
                    {/* Left Column: Voiceover Narration & Voice Direction (cols 1-6) */}
                    <div
                      className="md:col-span-6 space-y-1.5 cursor-text pr-2 md:border-r md:border-slate-800/60"
                      onClick={() => handleStartEditLine(idx)}
                    >
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-[10px] font-bold text-cyan-400/90 flex items-center gap-1">
                          <Mic className="h-2.5 w-2.5" />
                          THOẠI
                        </span>
                        {line.voiceDirection && (
                          <span className="text-[10px] italic text-cyan-200/90 bg-cyan-950/40 border border-cyan-800/40 px-1.5 py-0.2 rounded">
                            {line.voiceDirection}
                          </span>
                        )}
                        {line.speaker && (
                          <span className="text-[10px] font-medium text-slate-400 bg-slate-800/50 px-1.5 py-0.2 rounded">
                            {line.speaker}
                          </span>
                        )}
                      </div>
                      <p className="text-xs text-text leading-relaxed font-normal select-text">
                        {line.text}
                      </p>
                    </div>

                    {/* Right Column: Visual Action, Media Type, Camera Angle & Movement (cols 7-12) */}
                    <div
                      className="md:col-span-6 space-y-1.5 cursor-text pl-0 md:pl-1"
                      onClick={() => handleStartEditLine(idx)}
                    >
                      <div className="flex items-center gap-1.5 flex-wrap">
                        <span className="text-[10px] font-bold text-amber-400/90 flex items-center gap-1">
                          <Video className="h-2.5 w-2.5" />
                          HÌNH ẢNH
                        </span>

                        {/* Media Type Badge */}
                        <span
                          className={`text-[10px] font-bold px-1.5 py-0.2 rounded border ${
                            line.suggestedMediaType === 'image'
                              ? 'bg-blue-500/15 border-blue-500/30 text-blue-300'
                              : 'bg-rose-500/15 border-rose-500/30 text-rose-300'
                          }`}
                        >
                          {line.suggestedMediaType === 'image' ? '🖼️ Ảnh' : '🎬 Video'}
                        </span>

                        {/* Camera Angle Badge */}
                        {line.cameraAngle && (
                          <span className="text-[10px] font-mono px-1.5 py-0.2 rounded bg-amber-500/10 border border-amber-500/30 text-amber-300">
                            📐 {formatCameraAngle(line.cameraAngle)}
                          </span>
                        )}

                        {/* Camera Movement Badge */}
                        {line.cameraMovement && (
                          <span className="text-[10px] font-mono px-1.5 py-0.2 rounded bg-emerald-500/10 border border-emerald-500/30 text-emerald-300">
                            🎥 {formatCameraMovement(line.cameraMovement)}
                          </span>
                        )}
                      </div>

                      <p className="text-xs text-slate-300 leading-relaxed font-normal select-text">
                        {line.visualAction || line.visualNote || (
                          <span className="text-text-muted italic text-[11px]">
                            {line.visualPromptEn || '(Chưa có mô tả hình ảnh phân cảnh)'}
                          </span>
                        )}
                      </p>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>

          {/* Draggable Resizer Bar */}
          <div
            onMouseDown={handleMouseDownResizer}
            onDoubleClick={() => setIsScriptExpanded((prev) => !prev)}
            className={`w-full py-1.5 flex items-center justify-center gap-2 rounded-lg border border-dashed transition select-none cursor-row-resize ${
              isResizingScript
                ? 'border-accent/40 bg-accent-tint text-accent'
                : 'border-border bg-surface text-text-muted hover:border-border hover:bg-surface hover:text-text'
            }`}
            title="Kéo lên/xuống để chỉnh độ dài kịch bản • Nhấp đúp để mở rộng toàn bộ"
          >
            <MoveVertical className="h-3.5 w-3.5" />
            <span className="text-[10px] font-mono tracking-wider">
              {isScriptExpanded
                ? 'Đang mở rộng toàn bộ kịch bản • Nhấp đúp để thu lại'
                : `↕ Kéo để kéo dài/thu ngắn (${scriptHeight}px) • Nhấp đúp để bung hết`}
            </span>
          </div>
        </div>

        {/* 4. Box: Thông Tin Ý Tưởng & Nhân Vật (Collapsible Accordion) */}
        {blueprint && (
          <div
            ref={ideaSectionRef}
            className="rounded-lg border border-amber-500/40 bg-[#0B101E] overflow-hidden"
          >
            <button
              type="button"
              onClick={() => setIsIdeaAccordionOpen((prev) => !prev)}
              className="w-full flex items-center justify-between p-3.5 text-xs font-bold text-white hover:bg-surface transition cursor-pointer"
            >
              <div className="flex items-center gap-2">
                <Lightbulb className="h-4 w-4 text-amber-400" />
                <span>Thông tin ý tưởng &amp; Thiết lập nhân vật</span>
                {blueprint.thumbnailPrompt && (
                  <span className="rounded bg-accent-tint border border-accent/40 px-2 py-0.5 text-[10px] font-mono text-accent">
                    Có Thumbnail AI Prompt
                  </span>
                )}
              </div>
              <div className="flex items-center gap-2">
                <span className="text-[11px] text-amber-300/80 font-normal">
                  {isIdeaAccordionOpen ? 'Thu gọn' : 'Xem chi tiết'}
                </span>
                {isIdeaAccordionOpen ? (
                  <ChevronUp className="h-4 w-4 text-amber-400" />
                ) : (
                  <ChevronDown className="h-4 w-4 text-amber-400" />
                )}
              </div>
            </button>

            {isIdeaAccordionOpen && (
              <div className="p-4 pt-2 border-t border-border space-y-4 text-xs">
                
                {/* 1. Host / Character details card */}
                {(config.channelProfile?.hostName || config.channelProfile?.hostDescription || (config.channelProfile?.channelCharacters && config.channelProfile.channelCharacters.length > 0)) && (
                  <div className="rounded-md border border-pink-500/30 bg-pink-950/15 p-3 space-y-2">
                    <div className="flex items-center justify-between">
                      <span className="flex items-center gap-1.5 font-bold text-pink-300 text-xs">
                        <User className="h-3.5 w-3.5 text-pink-400" />
                        Nhân vật đại diện kênh (Character Consistency)
                      </span>
                      <span className="text-[10px] text-pink-400/80 bg-pink-900/30 border border-pink-700/40 px-2 py-0.5 rounded-full font-mono">
                        Đã khóa diện mạo
                      </span>
                    </div>

                    <div className="flex items-start gap-3 pt-1">
                      {config.channelProfile?.hostAvatarUrl ? (
                        <img
                          src={config.channelProfile.hostAvatarUrl}
                          alt="Host Avatar"
                          className="h-10 w-10 rounded-full object-cover border border-pink-500/50 shrink-0"
                        />
                      ) : (
                        <div className="h-10 w-10 rounded-full bg-pink-500/20 border border-pink-500/40 flex items-center justify-center text-pink-300 font-bold shrink-0">
                          {config.channelProfile?.hostName?.slice(0, 1)?.toUpperCase() || 'NV'}
                        </div>
                      )}

                      <div className="space-y-1 min-w-0 flex-1">
                        <div className="flex items-center gap-2">
                          <span className="font-bold text-white text-xs">
                            {config.channelProfile?.hostName || 'Nhân vật chính'}
                          </span>
                          <span className="text-[10px] text-text-muted font-mono">
                            (Host đại diện)
                          </span>
                        </div>
                        <p className="text-[11px] text-text leading-relaxed">
                          {config.channelProfile?.hostDescription || 'Chưa thiết lập mô tả diện mạo chi tiết.'}
                        </p>
                      </div>
                    </div>

                    {/* Additional characters if any */}
                    {config.channelProfile?.channelCharacters && config.channelProfile.channelCharacters.length > 0 && (
                      <div className="pt-2 border-t border-pink-500/20 space-y-1.5">
                        <span className="text-[11px] font-semibold text-pink-200">
                          Nhân vật khác trong kênh:
                        </span>
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                          {config.channelProfile.channelCharacters.map((char) => (
                            <div
                              key={char.id}
                              className="rounded-lg bg-black/30 border border-pink-500/20 p-2 text-[11px] space-y-0.5"
                            >
                              <span className="font-bold text-white">{char.name}</span>
                              <p className="text-text-muted text-[10px] line-clamp-2">{char.descriptionEn}</p>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                )}

                {/* 2. Thumbnail Concept & Prompt card */}
                <div className="rounded-md border border-indigo-500/30 bg-indigo-950/20 p-3 space-y-2.5">
                  <div className="flex items-center justify-between">
                    <span className="flex items-center gap-1.5 font-bold text-indigo-300 text-xs">
                      <ImageIcon className="h-3.5 w-3.5 text-indigo-400" />
                      Thumbnail &amp; Ảnh Bìa Video
                    </span>
                    {blueprint.thumbnailPrompt && (
                      <button
                        type="button"
                        onClick={() => handleCopyThumbPrompt(blueprint.thumbnailPrompt || '')}
                        className="inline-flex items-center gap-1 rounded border border-indigo-500/40 bg-indigo-900/40 px-2.5 py-1 text-[10px] font-bold text-indigo-200 hover:bg-indigo-800 transition cursor-pointer"
                      >
                        <Copy className="h-3 w-3" />
                        <span>{copiedThumbPrompt ? '✓ Đã sao chép prompt!' : 'Sao chép Prompt AI'}</span>
                      </button>
                    )}
                  </div>

                  {blueprint.thumbnailConcept && (
                    <div className="space-y-1">
                      <span className="text-[11px] font-medium text-text-muted">
                        Ý tưởng thị giác (Thumbnail Concept):
                      </span>
                      <p className="text-text text-xs leading-relaxed bg-black/30 p-2.5 rounded-lg border border-indigo-500/20">
                        {blueprint.thumbnailConcept}
                      </p>
                    </div>
                  )}

                  {blueprint.thumbnailPrompt ? (
                    <div className="space-y-1">
                      <span className="text-[11px] font-medium text-indigo-300 flex items-center justify-between">
                        <span>Prompt tạo ảnh AI (Tiếng Anh - chuẩn Midjourney / Flux / DALL-E 3):</span>
                      </span>
                      <div className="relative group">
                        <pre className="font-mono text-[11px] text-text leading-relaxed bg-[#060913] p-2.5 rounded-lg border border-border whitespace-pre-wrap break-words max-h-36 overflow-y-auto custom-scrollbar">
                          {blueprint.thumbnailPrompt}
                        </pre>
                      </div>
                    </div>
                  ) : (
                    <p className="text-[11px] text-text-muted italic">
                      Chưa có prompt ảnh tiếng Anh.
                    </p>
                  )}
                </div>

                {/* 3. Narrative, Format & Outline */}
                <div className="space-y-2.5 pt-1">
                  <div className="grid grid-cols-12 gap-3">
                    <span className="col-span-3 text-text-muted font-medium">Góc nhìn</span>
                    <span className="col-span-9 text-text leading-relaxed">
                      {blueprint.narrativeAngle || 'Chưa có thông tin'}
                    </span>
                  </div>

                  <div className="grid grid-cols-12 gap-3">
                    <span className="col-span-3 text-text-muted font-medium">Định dạng</span>
                    <span className="col-span-9 text-text font-mono">
                      {blueprint.aspectRatio === '9:16' ? 'Shorts (9:16)' : 'Video dài (16:9)'}
                    </span>
                  </div>

                  {blueprint.outline && blueprint.outline.length > 0 && (
                    <div className="grid grid-cols-12 gap-3">
                      <span className="col-span-3 text-text-muted font-medium">Dàn ý phân đoạn</span>
                      <div className="col-span-9 space-y-1 text-text">
                        {blueprint.outline.map((beat, bIdx) => (
                          <div key={bIdx} className="leading-relaxed">
                            &bull; {beat}
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  <div className="grid grid-cols-12 gap-3">
                    <span className="col-span-3 text-text-muted font-medium">Thời lượng ước tính</span>
                    <span className="col-span-9 text-text font-mono">
                      {blueprint.estimatedDurationSec || 600} giây ({Math.round((blueprint.estimatedDurationSec || 600) / 60)} phút)
                    </span>
                  </div>

                  {blueprint.targetAudience && (
                    <div className="grid grid-cols-12 gap-3">
                      <span className="col-span-3 text-text-muted font-medium">Khán giả mục tiêu</span>
                      <span className="col-span-9 text-text">
                        {blueprint.targetAudience}
                      </span>
                    </div>
                  )}
                </div>

              </div>
            )}
          </div>
        )}

      </div>

      {/* 5. Bottom Action Bar matching Revo Studio */}
      <div className="p-3.5 border-t border-border bg-[#080C14] flex flex-wrap items-center justify-between gap-3 shrink-0">
        <div className="flex flex-wrap items-center gap-2">
          {/* Nút Tiếp tục: Duyệt kịch bản & Lồng tiếng */}
          <button
            type="button"
            onClick={() => { if (canApproveScript) onProceedToVoice(); }}
              disabled={!canApproveScript}
            className="inline-flex items-center gap-2 rounded-md bg-gradient-to-r from-emerald-600 via-teal-600 to-cyan-600 hover:brightness-110 px-4 py-2 text-xs font-bold text-white active:scale-95 transition cursor-pointer disabled:opacity-50"
            title="Duyệt kịch bản hiện tại và tiếp tục sang bước Lồng tiếng"
          >
            <Mic className="h-3.5 w-3.5" />
            <span>Tiếp tục: Duyệt &amp; Lồng tiếng ▸</span>
          </button>

          {/* Nút Hủy tiến trình đang chạy (chỉ hiện khi đang chạy) */}
          {isRunning && onCancelProcess && (
            <button
              type="button"
              onClick={onCancelProcess}
              className="inline-flex items-center gap-1.5 rounded-md border border-rose-800/80 bg-rose-950/60 hover:bg-rose-900/80 px-3.5 py-2 text-xs font-bold text-rose-200 transition active:scale-95 cursor-pointer"
              title="Dừng / Hủy tiến trình đang chạy (giữ nguyên dữ liệu kịch bản)"
            >
              <Square className="h-3 w-3 fill-rose-400 text-rose-400" />
              <span>Hủy tiến trình đang chạy</span>
            </button>
          )}

          {/* Nút Tạo lại kịch bản */}
          <button
            type="button"
            onClick={onRegenerateScript}
              disabled={scriptBusy || session.manualMode}
            className="inline-flex items-center gap-1.5 rounded-md border border-border bg-surface hover:bg-surface-2 px-3.5 py-2 text-xs font-semibold text-text transition active:scale-95 cursor-pointer disabled:opacity-50"
          >
            <RotateCcw className="h-3.5 w-3.5 text-accent" />
            <span>Tạo lại kịch bản</span>
          </button>

          {/* Nút Quay lại Ý Tưởng */}
          <button
            type="button"
            onClick={onBackToIdeas}
            className="inline-flex items-center gap-1.5 rounded-md border border-border bg-surface hover:bg-surface-2 px-3.5 py-2 text-xs font-semibold text-text-muted hover:text-white transition active:scale-95 cursor-pointer"
          >
            <ArrowLeft className="h-3.5 w-3.5" />
            <span>Quay lại Ý Tưởng</span>
          </button>
        </div>

        <div className="flex items-center gap-3">
          {onDeleteVideo && (
            <button
              type="button"
              onClick={onDeleteVideo}
              className="inline-flex items-center gap-1 text-text-muted hover:text-rose-400 text-xs transition cursor-pointer px-2 py-1"
              title="Xoá video khỏi phiên làm việc"
            >
              <Trash2 className="h-3.5 w-3.5" />
              <span>Xoá video</span>
            </button>
          )}

          <span className="text-[11px] font-mono text-text-muted bg-surface px-2 py-1 rounded">
            video {session.sessionId ? session.sessionId.slice(0, 8) : '00000000'}
          </span>
        </div>
      </div>

      {/* Modal Yêu cầu của tôi (Custom Refinement Prompt) */}
      {customPromptModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4">
          <div className="w-full max-w-md rounded-lg border border-border bg-[#0B1120] p-5 space-y-4 animate-in zoom-in-95">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-bold text-white flex items-center gap-2">
                Yêu cầu chỉnh sửa kịch bản
              </h3>
              <button
                type="button"
                onClick={() => setCustomPromptModalOpen(false)}
                className="text-text-muted hover:text-white text-xs"
              >
                ✕
              </button>
            </div>

            <p className="text-xs text-text-muted leading-relaxed">
              Nhập chỉ dẫn cho AI (VD: &ldquo;Viết đoạn mở đầu giật gân hơn&rdquo;, &ldquo;Rút ngắn câu từ dưới 800 từ&rdquo;, &ldquo;Thêm số liệu khảo cổ&rdquo;):
            </p>

            <textarea
              value={customPromptText}
              onChange={(e) => setCustomPromptText(e.target.value)}
              placeholder="VD: Hãy làm cho câu Hook 6 giây đầu dồn dập hơn và bổ sung mốc thời gian cụ thể..."
              rows={4}
              autoFocus
              className="w-full rounded-md border border-border bg-surface px-3 py-2 text-xs text-white focus:border-accent/40 focus:outline-none"
            />

            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setCustomPromptModalOpen(false)}
                className="rounded-lg px-3 py-1.5 text-xs text-text-muted hover:text-white"
              >
                Hủy
              </button>
              <button
                type="button"
                onClick={handleCustomPromptSubmit}
                disabled={scriptBusy || !hasScript || !customPromptText.trim()}
                className="inline-flex items-center gap-1.5 rounded-lg bg-accent hover:bg-cyan-400 px-4 py-1.5 text-xs font-bold text-slate-950 transition disabled:opacity-50"
              >
                <Send className="h-3 w-3" />
                <span>Gửi yêu cầu</span>
              </button>
            </div>
          </div>
        </div>
      )}

    </div>
  );
}
