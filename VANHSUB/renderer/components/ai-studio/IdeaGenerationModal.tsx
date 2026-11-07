import React, { useState } from 'react';
import {
  Lightbulb,
  X,
  Sparkles,
  Bot,
  RotateCcw,
  Film,
  Smartphone,
  AlertCircle,
  CheckCircle2,
  Info,
  Tv,
  Clock,
  User,
  Image as ImageIcon,
  Palette,
  Compass,
  Cpu,
} from 'lucide-react';
import { useAiStudioStore } from '../../lib/store/aiStudioStore';
import type { IdeaBlueprint } from '../../types/aiStudio';

export interface IdeaGenerationModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSubmit: (blueprint: IdeaBlueprint) => void;
  initialTopic?: string;
}

export default function IdeaGenerationModal({
  isOpen,
  onClose,
  onSubmit,
  initialTopic = '',
}: IdeaGenerationModalProps) {
  const { config } = useAiStudioStore();

  const [aspectRatio, setAspectRatio] = useState<'16:9' | '9:16'>(
    config.flowEngine.aspectRatio === '9:16' ? '9:16' : '16:9'
  );
  const [topic, setTopic] = useState(initialTopic);
  const [hookConcept, setHookConcept] = useState('');
  const [narrativeAngle, setNarrativeAngle] = useState('');
  const [outline, setOutline] = useState('');
  const [existingScript, setExistingScript] = useState('');
  const [thumbnailConcept, setThumbnailConcept] = useState('');
  const [thumbnailPrompt, setThumbnailPrompt] = useState('');

  const [isGenerating, setIsGenerating] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);

  if (!isOpen) return null;

  const getTargetDurationText = () => {
    if (aspectRatio === '9:16') {
      const s = config.channelProfile?.targetShortDuration;
      if (s === '30_60_sec') return '30 - 60 giây';
      if (s === '60_90_sec') return '60 - 90 giây';
      if (s === '90_120_sec') return '90 - 120 giây';
      if (s === '120_180_sec') return '2 - 3 phút';
      return '30 - 60 giây';
    } else {
      const l = config.channelProfile?.targetLongDuration;
      if (l === '20_30_sec') return '20 - 30 giây';
      if (l === '1_3_min') return '1 - 3 phút';
      if (l === '3_5_min') return '3 - 5 phút';
      if (l === '5_8_min') return '5 - 8 phút';
      if (l === '8_12_min') return '8 - 12 phút';
      if (l === '12_18_min') return '12 - 18 phút';
      if (l === '18_28_min') return '18 - 28 phút';
      return '3 - 5 phút';
    }
  };

  const handleAutoFill = async () => {
    const effectiveTopic =
      topic.trim() ||
      config.channelProfile?.channelNiche ||
      config.channelProfile?.projectName ||
      '';

    if (!effectiveTopic) {
      setErrorMessage(
        'Vui lòng nhập Tiêu đề video / Ý tưởng ban đầu hoặc cấu hình Tên Project / Ngách kênh trong Cấu hình Kênh trước khi sinh mẫu.'
      );
      return;
    }

    setErrorMessage(null);
    setSuccessMessage(null);
    setIsGenerating(true);

    try {
      if (!window.vanhsub?.aiStudio?.autoFillIdea) {
        throw new Error('Tính năng autoFillIdea chưa sẵn sàng trên ứng dụng.');
      }

      const result = await window.vanhsub.aiStudio.autoFillIdea({
        topic: effectiveTopic,
        aspectRatio,
        channelProfile: config.channelProfile,
      });

      const hostName =
        config.channelProfile?.hostName?.trim() ||
        config.channelProfile?.channelCharacters?.[0]?.name?.trim();
      const hostDesc =
        config.channelProfile?.hostDescription?.trim() ||
        config.channelProfile?.channelCharacters?.[0]?.descriptionEn?.trim();

      if (result.title) setTopic(result.title);
      if (result.hookConcept) setHookConcept(result.hookConcept);
      if (result.narrativeAngle) setNarrativeAngle(result.narrativeAngle);
      if (Array.isArray(result.outline) && result.outline.length > 0) {
        setOutline(result.outline.join('\n'));
      }

      let finalThumbConcept = result.thumbnailConcept || '';
      let finalThumbPrompt = result.thumbnailPrompt || '';

      if (hostName && hostDesc) {
        if (!finalThumbPrompt.toLowerCase().includes(hostName.toLowerCase())) {
          finalThumbPrompt = `Cinematic YouTube thumbnail of ${result.title || topic}, featuring character ${hostName} (${hostDesc}), dramatic lighting, 8k resolution, photorealistic. ${finalThumbPrompt}`.trim();
        }
        if (!finalThumbConcept.toLowerCase().includes(hostName.toLowerCase())) {
          finalThumbConcept = `${finalThumbConcept} (Nhân vật đại diện ${hostName}: ${hostDesc})`.trim();
        }
      }

      setThumbnailConcept(finalThumbConcept);
      setThumbnailPrompt(finalThumbPrompt);

      const usedProvider = config.channelProfile?.aiProvider && config.channelProfile.aiProvider !== 'default'
        ? config.channelProfile.aiProvider : config.llm.provider;
      setSuccessMessage(
        `AI (${usedProvider === 'chatgpt_web' ? 'ChatGPT Web' : usedProvider === 'gemini_web' ? 'Gemini Web' : usedProvider.toUpperCase()}) đã sinh mẫu ý tưởng thành công theo Cấu hình Kênh [${config.channelProfile?.projectName || 'Mặc định'}]!`
      );
      setTimeout(() => setSuccessMessage(null), 4000);
    } catch (err: any) {
      console.error('[IdeaGenerationModal] AutoFill error:', err);
      setErrorMessage(
        err?.message ||
          'Không thể kết nối AI để sinh mẫu. Vui lòng kiểm tra trạng thái đăng nhập hoặc API Key trong Cài Đặt.'
      );
    } finally {
      setIsGenerating(false);
    }
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!topic.trim()) {
      setErrorMessage('Tiêu đề video / Ý tưởng là trường bắt buộc.');
      return;
    }

    const outlineArray = outline
      .split('\n')
      .map((l) => l.trim())
      .filter(Boolean);

    const targetDurationSec =
      aspectRatio === '9:16'
        ? config.channelProfile?.targetShortDuration === '60_90_sec'
          ? 75
          : config.channelProfile?.targetShortDuration === '90_120_sec'
          ? 105
          : config.channelProfile?.targetShortDuration === '120_180_sec'
          ? 150
          : 45
        : config.channelProfile?.targetLongDuration === '20_30_sec'
        ? 25
        : config.channelProfile?.targetLongDuration === '1_3_min'
        ? 120
        : config.channelProfile?.targetLongDuration === '5_8_min'
        ? 390
        : config.channelProfile?.targetLongDuration === '8_12_min'
        ? 600
        : config.channelProfile?.targetLongDuration === '12_18_min'
        ? 900
        : config.channelProfile?.targetLongDuration === '18_28_min'
        ? 1400
        : 240;

    const blueprint: IdeaBlueprint = {
      topic: topic.trim(),
      title: topic.trim(),
      aspectRatio,
      hookConcept: hookConcept.trim() || `Bạn có tin vào sự thật đằng sau ${topic.trim()}?`,
      narrativeAngle: narrativeAngle.trim() || 'Góc tiếp cận độc đáo, đột phá của kênh',
      outline: outlineArray.length > 0 ? outlineArray : [
        'Phân đoạn 1 [00:00 - 00:45]: Mở đầu sự cố / bối cảnh bất ngờ...',
        'Phân đoạn 2 [00:45 - 01:30]: Diễn biến kịch tính / xung đột cao trào...',
        'Phân đoạn 3 [01:30 - 02:15]: Bước ngoặt / giải mã sự thật...',
        'Phân đoạn 4 [02:15 - 03:00]: Bài học & Lối thoát...',
      ],
      existingScript: existingScript.trim() || undefined,
      thumbnailConcept: thumbnailConcept.trim() || undefined,
      thumbnailPrompt: thumbnailPrompt.trim() || undefined,
      pacing: aspectRatio === '9:16' ? 'fast' : 'moderate',
      estimatedDurationSec: targetDurationSec,
      rawSummary: `Video "${topic.trim()}" định dạng ${aspectRatio}. ${narrativeAngle.trim()}`,
    };

    onSubmit(blueprint);
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4 overflow-y-auto animate-in fade-in duration-200">
      <div className="relative flex max-h-[92vh] w-full max-w-4xl flex-col rounded-lg border border-border bg-[#0B101E] overflow-hidden">
        {/* Modal Header */}
        <div className="flex items-center justify-between border-b border-border px-6 py-4">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-amber-500/15 border border-amber-500/30 text-amber-400">
              <Lightbulb className="h-5 w-5" />
            </div>
            <div>
              <h2 className="text-base font-bold text-white tracking-wide">
                Tạo &amp; Sinh Ý Tưởng Video
              </h2>
              <p className="text-xs text-text-muted">
                Nhập thủ công hoặc bấm &quot;🤖 AI Tự Động Sinh Mẫu&quot; để AI gợi ý điền mẫu
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="flex h-8 w-8 items-center justify-center rounded-md text-text-muted hover:bg-surface-2 hover:text-white transition cursor-pointer"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Modal Scrollable Body */}
        <div className="flex-1 overflow-y-auto px-6 py-5 space-y-5 text-text custom-scrollbar">
          {/* Top Bar: Khung hình & Nút AI Sinh Mẫu */}
          <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 rounded-lg border border-border bg-bg p-3">
            {/* Aspect Ratio Switcher */}
            <div className="flex items-center gap-2">
              <span className="text-xs font-semibold text-text-muted">Khung hình:</span>
              <div className="flex items-center gap-1.5 rounded-md border border-border bg-surface p-1">
                <button
                  type="button"
                  onClick={() => setAspectRatio('16:9')}
                  className={`flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-bold transition cursor-pointer ${
                    aspectRatio === '16:9'
                      ? 'bg-gradient-to-r from-orange-500 to-pink-500 text-white '
                      : 'text-text-muted hover:text-white'
                  }`}
                >
                  <Film className="h-3.5 w-3.5" />
                  <span>🎬 Video Dài (16:9)</span>
                </button>
                <button
                  type="button"
                  onClick={() => setAspectRatio('9:16')}
                  className={`flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-bold transition cursor-pointer ${
                    aspectRatio === '9:16'
                      ? 'bg-gradient-to-r from-orange-500 to-pink-500 text-white '
                      : 'text-text-muted hover:text-white'
                  }`}
                >
                  <Smartphone className="h-3.5 w-3.5" />
                  <span>📱 Video Ngắn (9:16)</span>
                </button>
              </div>
            </div>

            {/* AI Auto-Fill Button */}
            <button
              type="button"
              onClick={handleAutoFill}
              disabled={isGenerating}
              className="flex items-center gap-2 rounded-md bg-gradient-to-r from-violet-600 to-indigo-600 px-4 py-2 text-xs font-bold text-white shadow-violet-600/30 hover:brightness-110 active:scale-95 disabled:opacity-50 transition cursor-pointer"
            >
              {isGenerating ? (
                <>
                  <RotateCcw className="h-3.5 w-3.5 animate-spin" />
                  <span>Đang nhờ AI sinh mẫu...</span>
                </>
              ) : (
                <>
                  <Bot className="h-4 w-4" />
                  <span>🤖 AI Tự Động Sinh Mẫu</span>
                </>
              )}
            </button>
          </div>

          {/* Active Channel Profile Grounding Card */}
          {config.channelProfile && (
            <div className="flex flex-col gap-2 rounded-lg border border-indigo-500/20 bg-gradient-to-r from-indigo-950/40 to-slate-950/60 p-3.5 text-xs text-indigo-200">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-1.5 font-bold text-indigo-300">
                  <Sparkles className="h-4 w-4 text-indigo-400" />
                  <span>Căn cứ cấu hình kênh đang áp dụng cho AI:</span>
                </div>
                {config.channelProfile.masterPrompt && (
                  <span className="inline-flex items-center gap-1 rounded-full bg-emerald-500/15 border border-emerald-500/30 px-2.5 py-0.5 text-[11px] font-semibold text-emerald-300">
                    ✨ Master Prompt: Đã kích hoạt
                  </span>
                )}
              </div>
              <div className="flex flex-wrap items-center gap-2 pt-0.5">
                {config.channelProfile.projectName && (
                  <span className="inline-flex items-center gap-1.5 rounded-md bg-surface border border-border px-2.5 py-1 text-[11px] text-text">
                    <Tv className="h-3.5 w-3.5 text-accent" />
                    <span>Dự án: <strong className="text-white">{config.channelProfile.projectName}</strong></span>
                  </span>
                )}
                {config.channelProfile.channelNiche && (
                  <span className="inline-flex items-center gap-1.5 rounded-md bg-surface border border-border px-2.5 py-1 text-[11px] text-text">
                    <span>Ngách: <strong className="text-white">{config.channelProfile.channelNiche}</strong></span>
                  </span>
                )}
                <span className="inline-flex items-center gap-1.5 rounded-md bg-surface border border-border px-2.5 py-1 text-[11px] text-text">
                  <Clock className="h-3.5 w-3.5 text-amber-400" />
                  <span>Thời lượng: <strong className="text-white">{getTargetDurationText()}</strong></span>
                </span>
                {(config.channelProfile.hostName || config.channelProfile.channelCharacters?.[0]?.name) && (
                  <span className="inline-flex items-center gap-1.5 rounded-md bg-surface border border-border px-2.5 py-1 text-[11px] text-text">
                    <User className="h-3.5 w-3.5 text-pink-400" />
                    <span>Nhân vật: <strong className="text-white">{config.channelProfile.hostName || config.channelProfile.channelCharacters?.[0]?.name}</strong></span>
                  </span>
                )}
                {(config.channelProfile.imageModel || config.channelProfile.videoModel) && (
                  <span className="inline-flex items-center gap-1.5 rounded-md bg-surface border border-border px-2.5 py-1 text-[11px] text-text">
                    <ImageIcon className="h-3.5 w-3.5 text-violet-400" />
                    <span>Model: <strong className="text-white">{config.channelProfile.imageModel || 'Nano Banana 2'} / {config.channelProfile.videoModel || 'Omni 1.1 Flash'}</strong></span>
                  </span>
                )}
                {config.channelProfile.visualArtStylePreset && (
                  <span className="inline-flex items-center gap-1.5 rounded-md bg-surface border border-border px-2.5 py-1 text-[11px] text-text">
                    <Palette className="h-3.5 w-3.5 text-emerald-400" />
                    <span>Phong cách: <strong className="text-white">{config.channelProfile.visualArtStylePreset}</strong></span>
                  </span>
                )}
                {config.channelProfile.channelOrientation && (
                  <span className="inline-flex items-center gap-1.5 rounded-md bg-surface border border-border px-2.5 py-1 text-[11px] text-text">
                    <Compass className="h-3.5 w-3.5 text-cyan-400" />
                    <span>Định hướng: <strong className="text-white truncate max-w-[200px] inline-block align-bottom">{config.channelProfile.channelOrientation}</strong></span>
                  </span>
                )}
                {config.channelProfile.aiProvider && config.channelProfile.aiProvider !== 'default' && (
                  <span className="inline-flex items-center gap-1.5 rounded-md bg-surface border border-border px-2.5 py-1 text-[11px] text-text">
                    <Cpu className="h-3.5 w-3.5 text-amber-400" />
                    <span>AI Provider: <strong className="text-white uppercase">{config.channelProfile.aiProvider.replace('_', ' ')}</strong></span>
                  </span>
                )}
              </div>
            </div>
          )}

          {/* Feedback & Error Banners */}
          {errorMessage && (
            <div className="flex items-start gap-2.5 rounded-lg border border-rose-500/40 bg-rose-500/10 p-3.5 text-xs text-rose-300">
              <AlertCircle className="h-4 w-4 shrink-0 text-rose-400 mt-0.5" />
              <div>
                <span className="font-bold">Lỗi: </span>
                <span>{errorMessage}</span>
              </div>
            </div>
          )}

          {successMessage && (
            <div className="flex items-center gap-2 rounded-lg border border-emerald-500/40 bg-emerald-500/10 p-3 text-xs text-emerald-300">
              <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-400" />
              <span>{successMessage}</span>
            </div>
          )}

          {/* Field 1: Tiêu đề video / Ý tưởng * */}
          <div className="space-y-1.5">
            <label className="text-xs font-bold text-text flex items-center gap-1.5">
              <span>📌 Tiêu đề video / Ý tưởng</span>
              <span className="text-rose-400">*</span>
            </label>
            <input
              type="text"
              value={topic}
              onChange={(e) => setTopic(e.target.value)}
              placeholder={
                config.channelProfile?.projectName
                  ? `Ví dụ: Chủ đề cho dự án "${config.channelProfile.projectName}" (hoặc để trống bấm 🤖 AI Tự Động Sinh Mẫu)`
                  : 'Ví dụ: Cú sốc tài chính toàn cầu 2026 - Sự thật chưa ai kể'
              }
              className="w-full rounded-lg border border-border bg-bg px-4 py-3 text-sm text-white placeholder:text-text-faint focus:border-accent/40 focus:ring-1 focus:ring-accent/30 focus:outline-none transition"
            />
          </div>

          {/* Field 2 & 3: 2 Columns (Hook 3s & Góc nhìn/Angle) */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <label className="text-xs font-bold text-text flex items-center gap-1.5">
                <span>⚡ Hook 3s mở đầu</span>
              </label>
              <input
                type="text"
                value={hookConcept}
                onChange={(e) => setHookConcept(e.target.value)}
                placeholder="Mở đầu gây tò mò / câu hỏi giữ chân"
                className="w-full rounded-lg border border-border bg-bg px-4 py-2.5 text-xs text-white placeholder:text-text-faint focus:border-accent/40 focus:ring-1 focus:ring-accent/30 focus:outline-none transition"
              />
            </div>

            <div className="space-y-1.5">
              <label className="text-xs font-bold text-text flex items-center gap-1.5">
                <span>🎯 Góc nhìn / Đột phá (Angle)</span>
              </label>
              <input
                type="text"
                value={narrativeAngle}
                onChange={(e) => setNarrativeAngle(e.target.value)}
                placeholder="Góc tiếp cận độc đáo của kênh"
                className="w-full rounded-lg border border-border bg-bg px-4 py-2.5 text-xs text-white placeholder:text-text-faint focus:border-accent/40 focus:ring-1 focus:ring-accent/30 focus:outline-none transition"
              />
            </div>
          </div>

          {/* Field 4: Dàn ý / Các phân đoạn (Outline - mỗi dòng 1 ý) */}
          <div className="space-y-1.5">
            <label className="text-xs font-bold text-text flex items-center gap-1.5">
              <span>📝 Dàn ý / Các phân đoạn (Outline - mỗi dòng 1 ý)</span>
            </label>
            <textarea
              rows={4}
              value={outline}
              onChange={(e) => setOutline(e.target.value)}
              placeholder={`Phân đoạn 1: Mở đầu sự cố...\nPhân đoạn 2: Diễn biến bất ngờ...\nPhân đoạn 3: Bài học & Lối thoát...`}
              className="w-full rounded-lg border border-border bg-bg px-4 py-3 text-xs font-mono text-white placeholder:text-text-faint focus:border-accent/40 focus:ring-1 focus:ring-accent/30 focus:outline-none transition leading-relaxed"
            />
          </div>

          {/* Field 5: Kịch bản có sẵn (tuỳ chọn) */}
          <div className="space-y-1.5">
            <label className="text-xs font-bold text-text flex items-center gap-1.5">
              <span>📜 Kịch bản có sẵn (tuỳ chọn)</span>
            </label>
            <textarea
              rows={4}
              value={existingScript}
              onChange={(e) => setExistingScript(e.target.value)}
              placeholder={`Dán kịch bản vào đây...\n\nMỗi câu nên nằm trên 1 dòng — hệ thống tự tách câu nếu bạn dán cả đoạn văn.\nKhông cần nhập thời gian: AI đọc giọng rồi tự trích timing.`}
              className="w-full rounded-lg border border-border bg-bg px-4 py-3 text-xs text-white placeholder:text-text-faint focus:border-accent/40 focus:ring-1 focus:ring-accent/30 focus:outline-none transition leading-relaxed"
            />
            <div className="flex items-start gap-1.5 text-[11px] text-text-muted mt-1">
              <Info className="h-3.5 w-3.5 shrink-0 text-accent mt-0.5" />
              <span>
                <span className="font-semibold text-text">ℹ Có kịch bản ở bước này:</span> AI rút nhân vật từ chính kịch bản (đúng tên, đúng vai) rồi mới vẽ chân dung — thay vì bịa nhân vật từ dàn ý. Bỏ trống = AI tự viết kịch bản sau khi bạn duyệt sản xuất.
              </span>
            </div>
          </div>

          {/* Field 6: Concept ảnh bìa (Thumbnail Concept) */}
          <div className="space-y-1.5">
            <div className="flex items-center justify-between">
              <label className="text-xs font-bold text-text flex items-center gap-1.5">
                <span>🎨 Concept ảnh bìa (Thumbnail Concept)</span>
              </label>
              {(config.channelProfile?.hostName || config.channelProfile?.channelCharacters?.[0]?.name) && (
                <span className="text-[11px] text-pink-400 bg-pink-500/10 border border-pink-500/30 px-2 py-0.5 rounded-full flex items-center gap-1">
                  <User className="h-3 w-3" />
                  <span>Gắn liền nhân vật: <strong>{config.channelProfile.hostName || config.channelProfile.channelCharacters?.[0]?.name}</strong></span>
                </span>
              )}
            </div>
            <input
              type="text"
              value={thumbnailConcept}
              onChange={(e) => setThumbnailConcept(e.target.value)}
              placeholder="Mô tả ý tưởng hình ảnh bìa (được đồng bộ cùng nhân vật của kênh)"
              className="w-full rounded-lg border border-border bg-bg px-4 py-2.5 text-xs text-white placeholder:text-text-faint focus:border-accent/40 focus:ring-1 focus:ring-accent/30 focus:outline-none transition"
            />
          </div>

          {/* Field 7: Prompt ảnh bìa cho AI (Thumbnail Prompt tiếng Anh) */}
          <div className="space-y-1.5">
            <div className="flex items-center justify-between">
              <label className="text-xs font-bold text-text flex items-center gap-1.5">
                <span>🖼️ Prompt ảnh bìa cho AI (Thumbnail Prompt tiếng Anh)</span>
              </label>
              {config.channelProfile?.imageModel && (
                <span className="text-[10px] text-violet-400 font-mono">
                  Model: {config.channelProfile.imageModel}
                </span>
              )}
            </div>
            <textarea
              rows={2}
              value={thumbnailPrompt}
              onChange={(e) => setThumbnailPrompt(e.target.value)}
              placeholder="Detailed English image prompt for thumbnail generation..."
              className="w-full rounded-lg border border-border bg-bg px-4 py-2.5 text-xs font-mono text-white placeholder:text-text-faint focus:border-accent/40 focus:ring-1 focus:ring-accent/30 focus:outline-none transition"
            />
            {(config.channelProfile?.hostDescription || config.channelProfile?.channelCharacters?.[0]?.descriptionEn) && (
              <p className="text-[11px] text-text-muted italic">
                ✨ Chi tiết nhân vật đại diện: <span className="text-pink-300">{config.channelProfile.hostDescription || config.channelProfile.channelCharacters?.[0]?.descriptionEn}</span>
              </p>
            )}
          </div>
        </div>

        {/* Modal Footer Actions */}
        <div className="flex items-center justify-between border-t border-border bg-bg px-6 py-4">
          <button
            type="button"
            onClick={onClose}
            className="rounded-md border border-border bg-surface px-5 py-2.5 text-xs font-semibold text-text hover:bg-surface-2 hover:text-white transition cursor-pointer"
          >
            Hủy
          </button>

          <button
            type="button"
            onClick={handleSubmit}
            disabled={!topic.trim() || isGenerating}
            className="flex items-center gap-2 rounded-md bg-gradient-to-r from-orange-500 to-pink-500 px-6 py-2.5 text-xs font-bold text-white hover:brightness-110 active:scale-95 disabled:opacity-50 transition cursor-pointer"
          >
            <Sparkles className="h-4 w-4" />
            <span>✨ Tạo Ý Tưởng Mới</span>
          </button>
        </div>
      </div>
    </div>
  );
}
