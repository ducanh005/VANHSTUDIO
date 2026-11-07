import React, { useState, useEffect } from 'react';
import {
  X,
  Settings,
  Brain,
  Mic,
  Plus,
  Copy,
  Edit2,
  Trash2,
  AlertTriangle,
  Zap,
  ChevronRight,
  Sparkles,
  FolderOpen,
  Eye,
} from 'lucide-react';
import {
  ChannelProfileConfig,
  DEFAULT_CHANNEL_PROFILE_CONFIG,
  ChannelVideoStyle,
  ChannelImageSource,
  ChannelSeriesType,
  ChannelEvaluationLlm,
  ChannelLongDuration,
  ChannelShortDuration,
  ChannelCharacterSync,
  ChannelCharacterImageMode,
  ChannelVisualMode,
} from '../../types/aiStudio';
import { useAiStudioStore } from '../../lib/store/aiStudioStore';
import ChannelSkillModal from './ChannelSkillModal';
import PiperRuntimeStatus from './PiperRuntimeStatus';
import MediaRouteSettings from './MediaRouteSettings';
import type {AiStudioFlowEngineConfig} from '../../types/aiStudio';

interface ChannelConfigModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSaved?: (config: ChannelProfileConfig) => void;
}

export default function ChannelConfigModal({
  isOpen,
  onClose,
  onSaved,
}: ChannelConfigModalProps) {
  const { config, updateChannelProfileConfig } = useAiStudioStore();
  const [mediaFlow,setMediaFlow]=useState<AiStudioFlowEngineConfig>({...config.flowEngine});
  useEffect(()=>{if(isOpen)setMediaFlow({...config.flowEngine});},[isOpen,config.activeProjectId]);
  const profileVersion = JSON.stringify(config.channelProfile);

  // Local state for the modal
  const [profile, setProfile] = useState<ChannelProfileConfig>({
    ...DEFAULT_CHANNEL_PROFILE_CONFIG,
    ...(config.channelProfile || {}),
  });

  const [isGeneratingPrompt, setIsGeneratingPrompt] = useState(false);
  const [promptMessage, setPromptMessage] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [isSkillModalOpen, setIsSkillModalOpen] = useState(false);

  // Video Styles Management modal/state
  const [isStyleModalOpen, setIsStyleModalOpen] = useState(false);
  const [newStyleName, setNewStyleName] = useState('');
  const [newStyleDesc, setNewStyleDesc] = useState('');

  const [hasTikTokSession, setHasTikTokSession] = useState<boolean | null>(null);
  const [kokoroVoices, setKokoroVoices] = useState<Array<{ id: string; name: string }>>([]);
  const [kokoroStatus, setKokoroStatus] = useState<'idle' | 'loading' | 'success' | 'empty' | 'error'>('idle');
  const [kokoroError, setKokoroError] = useState('');
  const [kokoroRetry, setKokoroRetry] = useState(0);

  useEffect(() => {
    if (!isOpen || profile.ttsEngine !== 'kokoro_tts') return;
    let active = true;
    setKokoroStatus('loading'); setKokoroVoices([]); setKokoroError('');
    const timer = setTimeout(() => {
      if (active) { active = false; setKokoroStatus('error'); setKokoroError('Hết thời gian tải giọng Kokoro. Hãy thử lại.'); }
    }, 8000);
    void (async () => {
      try {
        if (!window.vanhsub?.aiStudio?.getKokoroVoices) throw new Error('Bản app này chưa hỗ trợ tải danh sách giọng Kokoro.');
        const voices = await window.vanhsub.aiStudio.getKokoroVoices();
        if (!active) return;
        setKokoroVoices(voices); setKokoroStatus(voices.length ? 'success' : 'empty');
      } catch (error) {
        if (active) {
          setKokoroStatus('error');
          const message = error instanceof Error ? error.message : 'Không tải được giọng Kokoro.';
          setKokoroError(message.replace(/^Error invoking remote method '[^']+': (?:Error: )?/, ''));
        }
      } finally { clearTimeout(timer); }
    })();
    return () => { active = false; clearTimeout(timer); };
  }, [isOpen, profile.ttsEngine, kokoroRetry]);

  // Sync state when modal opens or store config changes
  useEffect(() => {
    if (isOpen) {
      setProfile({
        ...DEFAULT_CHANNEL_PROFILE_CONFIG,
        ...(config.channelProfile || {}),
      });
      setPromptMessage(null);

      if (typeof window !== 'undefined' && window.vanhsub?.tiktokTts?.status) {
        window.vanhsub.tiktokTts
          .status()
          .then((res) => setHasTikTokSession(Boolean(res?.hasSession)))
          .catch(() => setHasTikTokSession(false));
      }
    }
  }, [isOpen, profileVersion]);

  if (!isOpen) return null;

  const handleChange = <K extends keyof ChannelProfileConfig>(
    field: K,
    value: ChannelProfileConfig[K]
  ) => {
    setProfile((prev) => ({ ...prev, [field]: value }));
  };

  // Nút tạo Master Prompt tự động bằng AI (bắt buộc dựa trên Tên Project và Model AI)
  const handleGenerateMasterPrompt = async () => {
    const projectName = (profile.projectName || profile.channelNiche || '').trim();
    if (!projectName) {
      alert('⚠️ Vui lòng nhập "Tên Project / Kênh" trước khi tạo Master Prompt.');
      return;
    }

    const aiProvider = profile.aiProvider !== 'default' ? profile.aiProvider : config.llm.provider;
    if (!aiProvider) {
      alert('⚠️ Vui lòng chọn "Model AI biên kịch" trước khi tạo Master Prompt.');
      return;
    }

    setIsGeneratingPrompt(true);
    setPromptMessage(`Đang kết nối Model AI (${aiProvider}) để tạo Master Prompt cho project "${projectName}"...`);

    try {
      const aiModelDisplayName =
        aiProvider === 'gemini_web'
          ? 'Gemini Web (Zero-API Cost)'
          : aiProvider === 'chatgpt_web'
          ? 'ChatGPT Web (Zero-API Cost)'
          : aiProvider === 'deepseek'
          ? 'DeepSeek'
          : aiProvider === 'openai'
          ? 'OpenAI'
          : aiProvider;

      if (window.vanhsub?.aiStudio?.generateMasterPrompt) {
        const result = await window.vanhsub.aiStudio.generateMasterPrompt({
          channelProfile: { ...profile, projectName, aiProvider },
        });
        if (result?.masterPrompt) {
          handleChange('masterPrompt', result.masterPrompt);
          if (result.chatgptConversationUrl) {
            handleChange('chatgptConversationUrl', result.chatgptConversationUrl);
          }
          setPromptMessage(`✨ Đã sinh Master Prompt cho project "${projectName}" bằng ${aiModelDisplayName}!`);
        }
      } else {
        // Fallback generator directly in renderer complying with the 10-section contract
        const niche = profile.channelNiche || projectName || 'Nội dung khám phá & kiến thức chuyên sâu';
        const desc = profile.channelDescription || 'Kênh chia sẻ những câu chuyện và góc nhìn độc đáo.';
        const orient = profile.channelOrientation || 'Kịch tính, lôi cuốn, tạo sự đồng cảm.';
        const hook = profile.channelHook || 'Hãy cùng chúng tôi khám phá ngay bây giờ.';
        const targetMinutes = profile.targetLongDuration.replace('_', '–').replace('min', 'phút');

        const generated = `1. SYSTEM ROLE
Bạn là nhà biên kịch lồng tiếng cao cấp chạy trên mô hình AI "${aiModelDisplayName}" cho project / kênh YouTube "${projectName}".
Khán giả của kênh là những người yêu thích tìm hiểu sâu, khao khát những góc nhìn chân thực, sắc sảo và kịch tính.
Lời hứa của kênh với người xem: mỗi câu chuyện đều được bóc tách đến tận cùng sự thật, cuốn hút từng giây và không bao giờ lãng phí thời gian của bạn.

2. INPUT

CHANNEL NAME:

{{CHANNEL_NAME}}

=== SOURCE START ===

{{SOURCE_MATERIAL}}

=== SOURCE END ===

Everything inside the markers is the universe of established fact. You may add general, verifiable context about how a system or process works, because that context is the transformation. You may never add facts about these specific people or events.

3. PRIMARY OBJECTIVE
- Độ dài mục tiêu: ${targetMinutes} (khoảng 600–1.200 từ lồng tiếng).
- Phải giống: một bộ phim tài liệu điều tra điện ảnh thu nhỏ, kể chuyện với nhịp điệu dồn dập, sắc bén và giàu sức gợi cảm giác thực tế.
- Tuyệt đối KHÔNG giống: một bài báo đọc to đều đều; một bài tóm tắt sách khô khan; một câu chuyện phiếm mạng xã hội nhạt nhòa; một bài giảng đạo đức.

4. CHANNEL DNA
- Ngách trọng tâm: ${niche}.
- Bản sắc kênh: ${desc}
- Định hướng góc nhìn: ${orient}
- Tôn chỉ văn phong: Trực diện, không vòng vo, cụ thể thắng trừu tượng, mỗi câu nói đều mang sức nặng thông tin.

4B. BRAND IDENTITY
- BRAND COMPASS: Kênh ${projectName} luôn đi thẳng vào bản chất vấn đề trước khi người khác kịp thanh minh.
- KHÔNG nhắc tên kênh trong 40 giây đầu của video.
- Giới thiệu thương hiệu trong khoảng 0:40–1:30 (8–12 giây). Câu mẫu:
  + "Chào mừng quý vị quay trở lại với {{CHANNEL_NAME}}, nơi chúng tôi cùng bạn bóc tách những bí ẩn chấn động nhất của câu chuyện hôm nay."
  + "Bạn đang theo dõi {{CHANNEL_NAME}}, và những gì sắp diễn ra sẽ làm thay đổi hoàn toàn cách bạn nhìn nhận sự việc này."
- Ký tên thương hiệu ở 30 giây cuối:
  + "Cảm ơn bạn đã đồng hành cùng {{CHANNEL_NAME}}. Câu trả lời cuối cùng nằm ở góc nhìn của bạn."
  + "{{CHANNEL_NAME}} xin chào và hẹn gặp lại trong hồ sơ tiếp theo."
- Tối đa hai lần nhắc tên trong cả tập. Cấm nhắc tên trong đoạn cao trào hoặc đoạn chứng cứ.

5. SIGNATURE BEAT
- Khoảng phút 2:30 hoặc trước bước ngoặt lớn: "Đoạn đóng băng sự việc" — người dẫn dừng nhịp 1.5 giây, đặt một câu hỏi cốt tử về động cơ của nhân vật trước khi lật mở bằng chứng quyết định.

6. NGUỒN & SỰ THẬT
- Nhóm A (Trong nguồn): Sự kiện, tên người, mốc thời gian, số liệu có trong nguồn là bất khả xâm phạm.
- Nhóm B (Bối cảnh chung): Được phép bổ sung kiến thức lịch sử, địa lý, cơ chế hoạt động để làm rõ câu chuyện.
- Nhóm C (Suy diễn - CẤM): Cấm bịa đặt lời thoại trực tiếp, cấm gán ghép động cơ cá nhân khi nguồn không khẳng định.

7. CẤU TRÚC TẬP
- 00:00 - 00:40: Hook búa bổ mở đầu bằng danh từ riêng hoặc con số chấn động. Đặt ngay mâu thuẫn lớn nhất.
- 00:40 - 01:30: Lời hứa tập này, giới thiệu kênh ngắn gọn và bắt đầu dòng thời gian.
- 01:30 - Cao trào: Diễn biến leo thang, các nỗ lực bất thành và sự đổ vỡ.
- Cao trào: Điểm bùng nổ, câu văn ngắn nhất, cảm xúc dồn nén.
- Kết thúc: Đúc kết sắc sảo, câu hỏi mở cho khán giả và chữ ký kênh.

8. NARRATION & DELIVERY
- Spell every number as spoken: "two hundred and eleven thousand dollars", "nine days", "nineteen eighty-three". Never emit raw digits.
- No symbols at all: no dollar sign, percent sign, ampersand, slash, or arrow.
- The SCRIPT section contains narration and nothing else: no headings, no timestamps, no stage directions, no speaker labels, no bracketed cues.
- Mở bằng danh từ riêng hoặc con số cụ thể. Cấm mở bằng câu hỏi tu từ hay "trong video này".
- Cấm nói trước cấu trúc. Đi thẳng vào sự việc.
- Tối đa 2 câu giải thích liên tiếp; câu thứ ba phải là cảnh, người, con số hoặc hành động.
- Xen kẽ câu dài với các câu cực ngắn (3–5 từ) để tạo nhịp thở hồi hộp.
- Cao trào cảm xúc phải là câu văn đơn giản nhất, không dùng từ ngữ sáo rỗng.

9. STRICT OUTPUT FORMAT

IF REJECTED:

STATUS: REJECTED
REASON: [one concise line]

IF ACCEPTED:

TITLE: [final title]

SCRIPT:

[complete narration script, plain text, no headings, no timestamps, no stage directions]

--- END OF SCRIPT ---

NARRATION DIRECTION:
[3 to 6 lines: register, target words per minute, the two places to slow down, phonetic notes for any name or place]

Output NOTHING else. No analysis, no planning, no alternative titles, no word counts, no visual or music instructions, no commentary.`;

        handleChange('masterPrompt', generated);
        setPromptMessage(`✨ Đã sinh Master Prompt cho project "${projectName}" bằng ${aiProvider}!`);
      }
    } catch (err: any) {
      console.error('[ChannelConfigModal] Error generating master prompt:', err);
      setPromptMessage(`Lỗi: ${err?.message || 'Không thể tạo master prompt'}`);
    } finally {
      setIsGeneratingPrompt(false);
    }
  };

  // Lưu cấu hình
  const handleSave = async () => {
    setIsSaving(true);
    try {
      const saved = await updateChannelProfileConfig(profile);
      if (!saved) {
        alert(useAiStudioStore.getState().error || 'Không thể lưu cấu hình kênh. Vui lòng thử lại.');
        return;
      }
        const mediaSaved=await useAiStudioStore.getState().updateConfig({flowEngine:mediaFlow});
        if(!mediaSaved){alert('Không lưu được cấu hình media; hãy thử lưu lại.');return;}
        onSaved?.(profile);
      onClose();
    } catch (err: any) {
      console.error('[ChannelConfigModal] Error saving config:', err);
      alert(`Lỗi lưu cấu hình: ${err?.message || err}`);
    } finally {
      setIsSaving(false);
    }
  };

  // Quản lý Kiểu video (Video Styles)
  const handleAddStyle = () => {
    if (!newStyleName.trim()) return;
    const newStyle: ChannelVideoStyle = {
      id: `style_${Date.now()}`,
      name: newStyleName.trim(),
      description: newStyleDesc.trim() || 'Phong cách video tùy chỉnh',
    };
    const updatedStyles = [...profile.videoStyles, newStyle];
    handleChange('videoStyles', updatedStyles);
    handleChange('videoStyleId', newStyle.id);
    setNewStyleName('');
    setNewStyleDesc('');
    setIsStyleModalOpen(false);
  };

  const handleDuplicateStyle = () => {
    const current = profile.videoStyles.find((s) => s.id === profile.videoStyleId);
    if (!current) return;
    const duplicated: ChannelVideoStyle = {
      id: `style_${Date.now()}`,
      name: `${current.name} (Bản sao)`,
      description: current.description,
      systemPrompt: current.systemPrompt,
    };
    const updated = [...profile.videoStyles, duplicated];
    handleChange('videoStyles', updated);
    handleChange('videoStyleId', duplicated.id);
  };

  const handleDeleteStyle = () => {
    if (!profile.videoStyleId) return;
    if (confirm('Bạn có chắc chắn muốn xoá kiểu video này?')) {
      const updated = profile.videoStyles.filter((s) => s.id !== profile.videoStyleId);
      handleChange('videoStyles', updated);
      handleChange('videoStyleId', updated[0]?.id || '');
    }
  };

  const isMissingDescOrOrient =
    !profile.channelDescription.trim() || !profile.channelOrientation.trim();

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-2 sm:p-4 animate-in fade-in duration-200">
      <div className="relative flex max-h-[94vh] w-full max-w-5xl flex-col rounded-lg border border-border bg-[#0B1120] text-text overflow-hidden">
        {/* MODAL HEADER */}
        <div className="flex h-14 shrink-0 items-center justify-between border-b border-border bg-[#0F172A]/90 px-6">
          <div className="flex items-center gap-2.5">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-surface-2 text-text">
              <Settings className="h-4 w-4" />
            </div>
            <div className="flex items-baseline gap-2">
              <h2 className="text-sm font-bold text-white tracking-wide">Cấu hình kênh</h2>
              <span className="text-xs text-text-muted">· bộ não AI, giọng, lịch tự đề xuất</span>
            </div>
          </div>

          <button
            type="button"
            onClick={onClose}
            className="flex h-8 w-8 items-center justify-center rounded-lg border border-border bg-surface-2 text-text-muted hover:bg-surface-3 hover:text-white transition cursor-pointer"
            title="Đóng"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* MODAL SCROLLABLE BODY */}
        <div className="flex-1 overflow-y-auto px-6 py-6 space-y-8 custom-scrollbar">
          {/* ========================================================================= */}
          {/* PHẦN 1: NỘI DUNG & BỘ NÃO */}
          {/* ========================================================================= */}
          <section className="space-y-5">
            <div className="flex items-center gap-2">
              <div className="flex h-6 w-6 items-center justify-center rounded-full bg-pink-500/20 text-pink-400">
                <Brain className="h-3.5 w-3.5" />
              </div>
              <h3 className="text-sm font-bold text-white flex items-center gap-1.5">
                <span>Nội dung &amp; Bộ não</span>
                <span className="text-xs font-normal text-text-muted">
                  — quyết định chủ đề &amp; chất riêng của kênh
                </span>
              </h3>
            </div>

            {/* Project Name & Script AI Model (Bắt buộc để tạo Master Prompt) */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 rounded-lg border border-accent/40 bg-gradient-to-r from-brand-cyan/10 via-brand-indigo/5 to-slate-950/60 p-4">
              <div className="space-y-1.5">
                <label className="text-xs font-semibold text-white flex items-center gap-1.5">
                  <Sparkles className="h-3.5 w-3.5 text-accent" />
                  <span>Tên Project / Kênh <span className="text-rose-400">*</span></span>
                </label>
                <input
                  type="text"
                  value={profile.projectName || ''}
                  onChange={(e) => handleChange('projectName', e.target.value)}
                  placeholder="vd: kênh test, Góc Nhìn Chiến Sự..."
                  className="w-full rounded-md border border-border bg-bg px-3.5 py-2.5 text-xs text-white placeholder:text-text-faint focus:border-accent/40 focus:outline-none"
                />
                <p className="text-[10.5px] text-text-muted">
                  Dùng làm định danh project và xuất hiện trực tiếp trong System Role của Master Prompt.
                </p>
              </div>

              <div className="space-y-1.5">
                <label className="text-xs font-semibold text-white flex items-center gap-1.5">
                  <Zap className="h-3.5 w-3.5 text-amber-400" />
                  <span>Model AI biên kịch <span className="text-rose-400">*</span></span>
                </label>
                <select
                  value={profile.aiProvider}
                  onChange={(e) => handleChange('aiProvider', e.target.value as any)}
                  className="w-full rounded-md border border-border bg-bg px-3.5 py-2.5 text-xs text-white focus:border-accent/40 focus:outline-none cursor-pointer"
                >
                  <option value="default">Mặc định theo Cài đặt ({config.llm.provider})</option>
                  <option value="chatgpt_web">ChatGPT Web (Zero-API Cost)</option>
                  <option value="gemini_web">Gemini Web (Zero-API Cost)</option>
                  <option value="deepseek">DeepSeek (API - deepseek-chat)</option>
                  <option value="openai">OpenAI (API - GPT-4o)</option>
                </select>
                <p className="text-[10.5px] text-text-muted">
                  Model AI được dùng để tự động tạo Master Prompt và sản xuất kịch bản cho project.
                </p>
              </div>
            </div>

            {/* Row 1: Nguồn hình | Kiểu video (bộ não AI) | Ngách của kênh */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              {/* 1. Nguồn hình */}
              <div className="space-y-1.5">
                <label className="text-xs font-semibold text-text">Nguồn hình</label>
                <div className="relative">
                  <select
                    value={profile.imageSource}
                    onChange={(e) => handleChange('imageSource', e.target.value as ChannelImageSource)}
                    className="w-full rounded-md border border-border bg-bg px-3.5 py-2.5 text-xs text-white focus:border-accent/40 focus:outline-none focus:ring-1 focus:ring-accent/30 cursor-pointer"
                  >
                    <option value="ai_flow_meta">🎨 AI tạo hình (Flow/Meta)</option>
                    <option value="ai_static">📸 Ảnh tĩnh AI chất lượng cao</option>
                    <option value="ai_video">🎬 Video AI (Chuyển động clip)</option>
                  </select>
                </div>
              </div>

              {/* 2. Kiểu video (bộ não AI) */}
              <div className="space-y-1.5">
                <label className="text-xs font-semibold text-text">
                  Kiểu video <span className="text-[10px] text-text-muted">(bộ não AI)</span>
                </label>
                <select
                  value={profile.videoStyleId}
                  onChange={(e) => handleChange('videoStyleId', e.target.value)}
                  className="w-full rounded-md border border-border bg-bg px-3.5 py-2.5 text-xs text-white focus:border-accent/40 focus:outline-none focus:ring-1 focus:ring-accent/30 cursor-pointer"
                >
                  <option value="">— Chọn kiểu —</option>
                  {profile.videoStyles.map((style) => (
                    <option key={style.id} value={style.id}>
                      {style.name}
                    </option>
                  ))}
                </select>

                {/* Sub-action buttons */}
                <div className="flex items-center gap-1.5 pt-1">
                  <button
                    type="button"
                    onClick={() => setIsStyleModalOpen(true)}
                    className="flex items-center gap-1 rounded-lg border border-border bg-surface px-2 py-1 text-[11px] font-medium text-text hover:bg-surface-2 hover:text-white transition cursor-pointer"
                  >
                    <Plus className="h-3 w-3" />
                    <span>Tạo</span>
                  </button>
                  <button
                    type="button"
                    onClick={handleDuplicateStyle}
                    disabled={!profile.videoStyleId}
                    className="flex items-center gap-1 rounded-lg border border-border bg-surface px-2 py-1 text-[11px] font-medium text-text hover:bg-surface-2 hover:text-white disabled:opacity-40 transition cursor-pointer"
                  >
                    <Copy className="h-3 w-3" />
                    <span>Nhân bản</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      const current = profile.videoStyles.find((s) => s.id === profile.videoStyleId);
                      if (current) {
                        const newName = prompt('Nhập tên mới cho kiểu video:', current.name);
                        if (newName && newName.trim()) {
                          const updated = profile.videoStyles.map((s) =>
                            s.id === current.id ? { ...s, name: newName.trim() } : s
                          );
                          handleChange('videoStyles', updated);
                        }
                      }
                    }}
                    disabled={!profile.videoStyleId}
                    className="flex items-center gap-1 rounded-lg border border-border bg-surface px-2 py-1 text-[11px] font-medium text-text hover:bg-surface-2 hover:text-white disabled:opacity-40 transition cursor-pointer"
                  >
                    <Edit2 className="h-3 w-3" />
                    <span>Sửa</span>
                  </button>
                  <button
                    type="button"
                    onClick={handleDeleteStyle}
                    disabled={!profile.videoStyleId}
                    className="flex items-center gap-1 rounded-lg border border-border bg-surface px-2 py-1 text-[11px] font-medium text-rose-400 hover:bg-rose-950/40 hover:text-rose-300 disabled:opacity-40 transition cursor-pointer"
                  >
                    <Trash2 className="h-3 w-3" />
                    <span>Xoá</span>
                  </button>
                </div>
              </div>

              {/* 3. Ngách của kênh */}
              <div className="space-y-1.5">
                <label className="text-xs font-semibold text-text">
                  Ngách của kênh <span className="text-[10px] text-text-muted">(gõ cụ thể để khác biệt)</span>
                </label>
                <input
                  type="text"
                  value={profile.channelNiche}
                  onChange={(e) => handleChange('channelNiche', e.target.value)}
                  placeholder="Vd: Sinh tồn của thợ săn voi ma mút vùng Siberia"
                  className="w-full rounded-md border border-border bg-bg px-3.5 py-2.5 text-xs text-white placeholder:text-text-faint focus:border-accent/40 focus:outline-none focus:ring-1 focus:ring-accent/30"
                />
              </div>
            </div>

            {/* Kiểu chuỗi tập (chống trùng chủ đề) */}
            <div className="space-y-1.5">
              <label className="text-xs font-semibold text-text">
                Kiểu chuỗi tập <span className="text-[10px] text-text-muted">(chống trùng chủ đề)</span>
              </label>
              <select
                value={profile.seriesType}
                onChange={(e) => handleChange('seriesType', e.target.value as ChannelSeriesType)}
                className="w-full rounded-md border border-border bg-bg px-3.5 py-2.5 text-xs text-white focus:border-accent/40 focus:outline-none focus:ring-1 focus:ring-accent/30 cursor-pointer"
              >
                <option value="anthology_new_topic">Tuyển tập — mỗi tập một chủ đề MỚI (khuyên dùng)</option>
                <option value="connected_series">Series nhiều tập liên kết theo mạch truyện dài</option>
                <option value="standalone">Video đơn lẻ độc lập theo từng yêu cầu</option>
              </select>
              <p className="text-[11px] text-text-muted italic">
                Mỗi video sẽ về một vụ án/câu chuyện/chủ đề KHÁC HẲN — chỉ giữ chung phong cách &amp; giọng kênh. Tránh 3 video cùng 1 vụ án.
              </p>
            </div>

            {/* Warning Banner khi chưa nhập Mô tả & Định hướng */}
            {isMissingDescOrOrient && (
              <div className="flex items-center gap-2.5 rounded-md border border-amber-500/30 bg-amber-500/10 px-4 py-2.5 text-xs text-amber-300">
                <AlertTriangle className="h-4 w-4 shrink-0 text-amber-400" />
                <span>
                  <strong className="font-semibold text-amber-200">Bạn chưa nhập Mô tả &amp; Định hướng</strong> — ý tưởng sẽ dễ chung chung và trùng với kênh khác. Nên điền 2 ô dưới.
                </span>
              </div>
            )}

            {/* Hai ô Mô tả chi tiết kênh & Định hướng kênh */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <label className="text-xs font-semibold text-text">
                  Mô tả chi tiết kênh <span className="text-[10px] text-text-muted">(nói cụ thể về gì)</span>
                </label>
                <textarea
                  rows={3}
                  value={profile.channelDescription}
                  onChange={(e) => handleChange('channelDescription', e.target.value)}
                  placeholder="Vd: Kênh kể chuyện sinh tồn của người tiền sử ở vùng băng giá — tập trung vào kỹ năng săn bắt, giữ lửa, và đời sống bộ lạc."
                  className="w-full rounded-md border border-border bg-bg px-3.5 py-2.5 text-xs text-white placeholder:text-text-faint focus:border-accent/40 focus:outline-none focus:ring-1 focus:ring-accent/30 resize-none"
                />
              </div>

              <div className="space-y-1.5">
                <label className="text-xs font-semibold text-text">
                  Định hướng kênh{' '}
                  <span className="text-[10px] text-text-muted">(quyết định góc nhìn &amp; giọng của khâu đề xuất ý tưởng)</span>
                </label>
                <textarea
                  rows={3}
                  value={profile.channelOrientation}
                  onChange={(e) => handleChange('channelOrientation', e.target.value)}
                  placeholder="Vd: Nghiêng về cảm xúc &amp; kịch tính sinh tồn hơn là số liệu khoa học; khán giả phổ thông yêu thích lịch sử."
                  className="w-full rounded-md border border-border bg-bg px-3.5 py-2.5 text-xs text-white placeholder:text-text-faint focus:border-accent/40 focus:outline-none focus:ring-1 focus:ring-accent/30 resize-none"
                />
              </div>
            </div>

            {/* Master prompt viết kịch bản */}
            <div className="rounded-lg border border-border bg-bg p-4 space-y-3">
              <div className="space-y-1">
                <label className="text-xs font-bold text-amber-400">
                  Master prompt viết kịch bản{' '}
                  <span className="font-normal text-text-muted">(quyết định toàn bộ giọng &amp; cấu trúc kịch bản)</span>
                </label>
                <p className="text-[11px] text-text-muted leading-relaxed">
                  Một prompt sản xuất hoàn chỉnh (300–600 dòng) gồm luật nguồn, kiến trúc beat và định dạng đầu ra. Khi có, nó THAY bộ não của kiểu video ở bước viết kịch bản — chỉ bước đó. Sinh ý tưởng, storyboard và SEO vẫn chạy bằng bộ não của kiểu video. Để trống thì kênh chạy hoàn toàn bằng bộ não đó.
                </p>
              </div>

              <textarea
                rows={6}
                value={profile.masterPrompt}
                onChange={(e) => handleChange('masterPrompt', e.target.value)}
                placeholder="Dán TRỌN một master prompt sản xuất vào đây — hoặc bấm “Tạo master prompt cho kênh này” bên dưới. Giữ nguyên {{CHANNEL_NAME}} và {{SOURCE_MATERIAL}}, hệ thống tự điền lúc chạy."
                className="w-full font-mono rounded-md border border-border bg-bg px-3.5 py-2.5 text-xs text-text placeholder:text-text-faint focus:border-accent/40 focus:outline-none focus:ring-1 focus:ring-accent/30 leading-relaxed"
              />

              {/* Action buttons under Master Prompt */}
              <div className="flex flex-wrap items-center justify-between gap-3 pt-1">
                <div className="flex items-center gap-3">
                  <button
                    type="button"
                    onClick={handleGenerateMasterPrompt}
                    disabled={isGeneratingPrompt}
                    className="inline-flex items-center gap-2 rounded-md bg-gradient-to-r from-rose-500 via-amber-500 to-orange-500 px-4 py-2 text-xs font-bold text-white hover:brightness-110 active:scale-95 disabled:opacity-50 transition cursor-pointer"
                  >
                    <Zap className={`h-3.5 w-3.5 ${isGeneratingPrompt ? 'animate-spin' : 'fill-current'}`} />
                    <span>{isGeneratingPrompt ? 'Đang tạo prompt...' : 'Tạo master prompt cho kênh này'}</span>
                  </button>

                  <button
                    type="button"
                    onClick={() => setIsSkillModalOpen(true)}
                    className="text-xs text-amber-400/90 hover:text-amber-300 font-semibold inline-flex items-center gap-1 cursor-pointer transition hover:underline"
                    title="Xem toàn bộ prompt skill và sao chép để chạy trên ChatGPT, Claude hoặc Gemini"
                  >
                    <span>Xem / sao chép skill để tự chạy</span>
                    <ChevronRight className="h-3.5 w-3.5" />
                  </button>
                </div>

                {promptMessage && (
                  <span className="text-xs text-emerald-400 font-medium animate-in fade-in">
                    {promptMessage}
                  </span>
                )}
              </div>
            </div>

            {/* Checkbox: Tra cứu dữ kiện trước khi viết */}
            <div className="rounded-md border border-border bg-bg p-3.5">
              <label className="flex items-start gap-3 cursor-pointer select-none">
                <input
                  type="checkbox"
                  checked={profile.researchFactBeforeWrite}
                  onChange={(e) => handleChange('researchFactBeforeWrite', e.target.checked)}
                  className="mt-0.5 rounded border-border bg-surface text-accent focus:ring-0 cursor-pointer"
                />
                <div className="space-y-0.5">
                  <span className="text-xs font-semibold text-text flex items-center gap-1.5">
                    <span>🔎 Tra cứu dữ kiện trước khi viết</span>
                  </span>
                  <p className="text-[11px] text-text-muted leading-relaxed">
                    AI đi tra dữ kiện thật cho từng chủ đề rồi mới viết. Master prompt nào cũng có mục kỷ luật dữ kiện ĐÒI tư liệu — không có tư liệu thì nó từ chối viết, và video dừng ở bước Kịch bản. Chỉ tắt với kênh truyện hư cấu.
                  </p>
                </div>
              </label>
            </div>

            {/* AI chấm điểm & cải thiện kịch bản */}
            <div className="space-y-2">
              <label className="text-xs font-semibold text-text">
                AI chấm điểm &amp; cải thiện kịch bản
              </label>
              <select
                value={profile.evaluationLlm}
                onChange={(e) => handleChange('evaluationLlm', e.target.value as ChannelEvaluationLlm)}
                className="w-full rounded-md border border-border bg-bg px-3.5 py-2.5 text-xs text-white focus:border-accent/40 focus:outline-none focus:ring-1 focus:ring-accent/30 cursor-pointer"
              >
                <option value="gemini_web">Gemini (web)</option>
                <option value="chatgpt_web">ChatGPT (web)</option>
                <option value="deepseek">DeepSeek (API)</option>
                <option value="openai">OpenAI GPT-4o (API)</option>
              </select>

              {profile.evaluationLlm.includes('web') && (
                <div className="flex items-start gap-2 rounded-md border border-amber-500/20 bg-amber-500/5 px-3.5 py-2 text-[11px] text-amber-300/90 leading-relaxed">
                  <AlertTriangle className="h-3.5 w-3.5 shrink-0 text-amber-400 mt-0.5" />
                  <span>
                    Bản web dùng phiên đăng nhập, một lượt chỉ nhận ~4.500 ký tự — không đủ cho cả bộ tiêu chí lẫn cả bài kịch bản, và cũng không trả nổi cả bài đã sửa. Chấm điểm và cải thiện sẽ báo lỗi. Chọn DeepSeek rồi nhập API key ở Cài đặt.
                  </span>
                </div>
              )}
            </div>

            {/* Hook của kênh */}
            <div className="space-y-1.5">
              <label className="text-xs font-semibold text-text">
                Hook của kênh{' '}
                <span className="text-[10px] text-text-muted">(câu chốt thương hiệu — AI lồng sau đoạn mở đầu)</span>
              </label>
              <input
                type="text"
                value={profile.channelHook}
                onChange={(e) => handleChange('channelHook', e.target.value)}
                placeholder="Vd: Và tôi là Anh 3 Tài Chính - Người giúp bạn biến mọi thứ thành tiền."
                className="w-full rounded-md border border-border bg-bg px-3.5 py-2.5 text-xs text-white placeholder:text-text-faint focus:border-accent/40 focus:outline-none focus:ring-1 focus:ring-accent/30"
              />
            </div>

            {/* Độ dài Video dài mục tiêu & Độ dài Shorts mục tiêu */}
            <div className="space-y-2">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="space-y-1.5">
                  <label className="text-xs font-semibold text-text">Độ dài Video dài mục tiêu</label>
                  <select
                    value={profile.targetLongDuration}
                    onChange={(e) => handleChange('targetLongDuration', e.target.value as ChannelLongDuration)}
                    className="w-full rounded-md border border-border bg-bg px-3.5 py-2.5 text-xs text-white focus:border-accent/40 focus:outline-none focus:ring-1 focus:ring-accent/30 cursor-pointer"
                  >
                    <option value="20_30_sec">20 - 30 giây (3 phân cảnh)</option>
                    <option value="1_3_min">1 - 3 phút</option>
                    <option value="3_5_min">3 - 5 phút (Mặc định)</option>
                    <option value="5_8_min">5 - 8 phút</option>
                    <option value="8_12_min">8 - 12 phút</option>
                    <option value="12_18_min">12 - 18 phút</option>
                    <option value="18_28_min">18 - 28 phút</option>
                  </select>
                </div>

                <div className="space-y-1.5">
                  <label className="text-xs font-semibold text-text">Độ dài Shorts mục tiêu</label>
                  <select
                    value={profile.targetShortDuration}
                    onChange={(e) => handleChange('targetShortDuration', e.target.value as ChannelShortDuration)}
                    className="w-full rounded-md border border-border bg-bg px-3.5 py-2.5 text-xs text-white focus:border-accent/40 focus:outline-none focus:ring-1 focus:ring-accent/30 cursor-pointer"
                  >
                    <option value="30_60_sec">30 - 60 giây</option>
                    <option value="60_90_sec">60 - 90 giây</option>
                    <option value="90_120_sec">90 - 120 giây (Mặc định)</option>
                    <option value="120_180_sec">120 - 180 giây</option>
                  </select>
                </div>
              </div>

              <p className="text-[11px] text-text-muted italic">
                Hai con số này là ĐỘ DÀI CHỐT của kênh — chúng đè cả độ dài mà ý tưởng ước lượng lẫn độ dài ghi trong Master prompt. Kênh dùng master prompt loại dài (18–28 phút) thì nhớ chọn mức tương ứng ở đây, nếu không kịch bản sẽ bị ép ngắn lại.
              </p>
            </div>
          </section>

          <hr className="border-border my-2" />

          {/* ========================================================================= */}
          {/* PHẦN 2: GIỌNG & HÌNH */}
          {/* ========================================================================= */}
          <section className="space-y-5">
            <div className="flex items-center gap-2">
              <div className="flex h-6 w-6 items-center justify-center rounded-full bg-accent/20 text-accent">
                <Mic className="h-3.5 w-3.5" />
              </div>
              <h3 className="text-sm font-bold text-white tracking-wide">Giọng &amp; Hình</h3>
            </div>

            <MediaRouteSettings value={mediaFlow} projectId={config.activeProjectId} onChange={setMediaFlow}/>
            {/* Row 1: AI provider (văn bản) | Giọng đọc (TTS) | Giọng cụ thể */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div className="space-y-1.5">
                <label className="text-xs font-semibold text-text">AI provider (văn bản)</label>
                <select
                  value={profile.aiProvider}
                  onChange={(e) => handleChange('aiProvider', e.target.value as any)}
                  className="w-full rounded-md border border-border bg-bg px-3.5 py-2.5 text-xs text-white focus:border-accent/40 focus:outline-none focus:ring-1 focus:ring-accent/30 cursor-pointer"
                >
                  <option value="default">Mặc định (theo Cài đặt chung)</option>
                  <option value="chatgpt_web">ChatGPT Web (Chế độ Tiết kiệm)</option>
                  <option value="gemini_web">Gemini Web (Chế độ Tiết kiệm)</option>
                  <option value="deepseek">DeepSeek (API)</option>
                  <option value="openai">OpenAI (API)</option>
                </select>
              </div>

              <div className="space-y-1.5">
                <div className="flex items-center justify-between">
                  <label className="text-xs font-semibold text-text">Giọng đọc (TTS)</label>
                  {profile.ttsEngine === 'tiktok_tts' && (
                    <span className={`text-[10px] font-medium ${hasTikTokSession ? 'text-emerald-400' : 'text-amber-400'}`}>
                      {hasTikTokSession ? '✓ Session OK' : '⚠ Chưa lưu session'}
                    </span>
                  )}
                </div>
                <select
                  value={profile.ttsEngine}
                  onChange={(e) => {
                    const nextEngine = e.target.value as any;
                    if (nextEngine === 'piper_local') {
                      setProfile(prev => ({...prev,ttsEngine:nextEngine,specificVoice:'vi_VN-vais1000-medium'}));
                    } else if (nextEngine === 'kokoro_tts' && profile.ttsEngine !== nextEngine) {
                      setProfile(prev => ({ ...prev, ttsEngine: nextEngine, specificVoice: 'af_heart' }));
                    } else if (nextEngine === 'tiktok_tts' && !profile.specificVoice?.startsWith('BV0')) {
                      setProfile((prev) => ({ ...prev, ttsEngine: nextEngine, specificVoice: 'BV074_streaming' }));
                    } else if (nextEngine === 'edge_tts' && profile.ttsEngine !== nextEngine) {
                      setProfile((prev) => ({ ...prev, ttsEngine: nextEngine, specificVoice: 'vi-VN-HoaiMyNeural' }));
                    } else {
                      handleChange('ttsEngine', nextEngine);
                    }
                  }}
                  className="w-full rounded-md border border-border bg-bg px-3.5 py-2.5 text-xs text-white focus:border-accent/40 focus:outline-none focus:ring-1 focus:ring-accent/30 cursor-pointer"
                >
                  <option value="edge_tts">Edge-TTS (Việt Nam / Đa ngôn ngữ, miễn phí)</option>
                  <option value="tiktok_tts">TikTok TTS (Giọng từ Session TikTok)</option>
                  <option value="kokoro_tts">Kokoro TTS (Anh/Mỹ/..., local)</option>
                  <option value="piper_local">Piper tiếng Việt (CPU, runtime đã cài)</option>
                </select>
              </div>

              <div className="space-y-1.5">
                <label className="text-xs font-semibold text-text">Giọng cụ thể</label>
                {profile.ttsEngine === 'piper_local' ? (
                  <div className="text-xs text-text-muted">vi_VN-vais1000-medium · tiếng Việt · không đổi engine khi lỗi<PiperRuntimeStatus/></div>
                ) : profile.ttsEngine === 'tiktok_tts' ? (
                  <select
                    value={profile.specificVoice || 'BV074_streaming'}
                    onChange={(e) => handleChange('specificVoice', e.target.value)}
                    className="w-full rounded-md border border-border bg-bg px-3.5 py-2.5 text-xs text-white focus:border-accent/40 focus:outline-none focus:ring-1 focus:ring-accent/30 cursor-pointer"
                  >
                    <option value="BV074_streaming">TikTok — Tiếng Việt Nữ (BV074)</option>
                    <option value="BV075_streaming">TikTok — Tiếng Việt Nam (BV075)</option>
                    <option value="en_male_narration">TikTok — Story Teller (Anh/Mỹ)</option>
                    <option value="en_us_001">TikTok — Jessie Nữ (Anh/Mỹ)</option>
                  </select>
                ) : profile.ttsEngine === 'kokoro_tts' ? (
                  <select aria-label="Giọng Kokoro" value={profile.specificVoice || ''}
                    disabled={kokoroStatus !== 'success'}
                    onChange={event => handleChange('specificVoice', event.target.value)}
                    className="w-full rounded-md border border-border bg-bg px-3.5 py-2.5 text-xs text-white">
                    <option value="">Chọn giọng Kokoro</option>
                    {profile.specificVoice && !kokoroVoices.some(voice => voice.id === profile.specificVoice) &&
                      <option value={profile.specificVoice} disabled>Giọng đã lưu chưa có trong danh sách Kokoro</option>}
                    {kokoroVoices.map(voice => <option key={voice.id} value={voice.id}>{voice.name}</option>)}
                  </select>
                ) : (
                  <select
                    value={profile.specificVoice || 'vi-VN-HoaiMyNeural'}
                    onChange={(e) => handleChange('specificVoice', e.target.value)}
                    className="w-full rounded-md border border-border bg-bg px-3.5 py-2.5 text-xs text-white focus:border-accent/40 focus:outline-none focus:ring-1 focus:ring-accent/30 cursor-pointer"
                  >
                    <option value="vi-VN-HoaiMyNeural">Hoài My (Nữ Hà Nội - Truyền cảm)</option>
                    <option value="vi-VN-NamMinhNeural">Nam Minh (Nam Hà Nội - Trầm ấm)</option>
                    <option value="default">Mặc định (Hoài My)</option>
                  </select>
                )}
              </div>
            </div>

            {/* Row 2: Đồng bộ nhân vật | Vai của nhân vật đại diện | Ảnh nhân vật */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div className="space-y-1.5">
                <label className="text-xs font-semibold text-text">Đồng bộ nhân vật</label>
                <select
                  value={profile.characterSync}
                  onChange={(e) => handleChange('characterSync', e.target.value as ChannelCharacterSync)}
                  className="w-full rounded-md border border-border bg-bg px-3.5 py-2.5 text-xs text-white focus:border-accent/40 focus:outline-none focus:ring-1 focus:ring-accent/30 cursor-pointer"
                >
                  <option value="per_video">Trong video (mỗi video một dàn)</option>
                  <option value="consistent_channel">Xuyên suốt các video của kênh</option>
                  <option value="none">Không sử dụng nhân vật đại diện</option>
                </select>
              </div>

              <div className="space-y-1.5">
                <label className="text-xs font-semibold text-text">Vai của nhân vật đại diện</label>
                <div className="rounded-md border border-border bg-bg px-3.5 py-2.5 text-xs text-text-muted italic">
                  {profile.characterRole || 'Kênh chưa có nhân vật đại diện — tạo ở tab Nhân vật trước.'}
                </div>
              </div>

              <div className="space-y-1.5">
                <label className="text-xs font-semibold text-text">Ảnh nhân vật</label>
                <select
                  value={profile.characterImageMode}
                  onChange={(e) => handleChange('characterImageMode', e.target.value as ChannelCharacterImageMode)}
                  className="w-full rounded-md border border-border bg-bg px-3.5 py-2.5 text-xs text-white focus:border-accent/40 focus:outline-none focus:ring-1 focus:ring-accent/30 cursor-pointer"
                >
                  <option value="ai_draw">AI tự vẽ (mặc định)</option>
                  <option value="upload_photo">Tải lên ảnh mẫu riêng</option>
                  <option value="studio_preset">Theo bộ preset của Studio</option>
                </select>
              </div>
            </div>

            {/* Row 3: Profile Chrome của kênh */}
            <div className="space-y-1.5">
              <label className="text-xs font-semibold text-text">Profile Chrome của kênh</label>
              <select
                value={profile.chromeProfile}
                onChange={(e) => handleChange('chromeProfile', e.target.value)}
                className="w-full rounded-md border border-border bg-bg px-3.5 py-2.5 text-xs text-white focus:border-accent/40 focus:outline-none focus:ring-1 focus:ring-accent/30 cursor-pointer"
              >
                <option value="auto">Tự chọn (profile trống bất kỳ)</option>
                <option value="profile_1">Profile 1 (Chính)</option>
                <option value="profile_2">Profile 2 (Dự phòng)</option>
              </select>
              <p className="text-[11px] text-text-muted italic">
                Video của kênh sẽ cố dùng đúng profile này (đang bận thì chờ). Nếu profile hết lượt/tắt mới tự chuyển sang profile khác.
              </p>
            </div>

            {/* Row 4: Tạo ảnh/video bằng | Chế độ hình */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <label className="text-xs font-semibold text-text">Tạo ảnh/video bằng</label>
                <select
                  value={profile.visualEngine}
                  onChange={(e) => handleChange('visualEngine', e.target.value as any)}
                  className="w-full rounded-md border border-border bg-bg px-3.5 py-2.5 text-xs text-white focus:border-accent/40 focus:outline-none focus:ring-1 focus:ring-accent/30 cursor-pointer"
                >
                  <option value="google_flow">Google Flow (Veo/Imagen)</option>
                  <option value="comfyui">ComfyUI / Stable Diffusion Local</option>
                  <option value="mock">Synthetic Studio Mock</option>
                </select>
              </div>

              <div className="space-y-1.5">
                <label className="text-xs font-semibold text-text">Chế độ hình</label>
                <select
                  value={profile.visualMode}
                  onChange={(e) => handleChange('visualMode', e.target.value as ChannelVisualMode)}
                  className="w-full rounded-md border border-border bg-bg px-3.5 py-2.5 text-xs text-white focus:border-accent/40 focus:outline-none focus:ring-1 focus:ring-accent/30 cursor-pointer"
                >
                  <option value="blend">Trộn ảnh + video</option>
                  <option value="image_only">Chỉ dùng ảnh tĩnh (Ken Burns)</option>
                  <option value="video_only">Toàn bộ là video clip</option>
                </select>
              </div>
            </div>

            {/* Row 4.1: Thư mục lưu trữ Ảnh & Video trên máy */}
            <div className="rounded-lg border border-border bg-[#070B14] p-3.5 space-y-2.5">
              <div className="flex items-center justify-between">
                <label className="text-xs font-semibold text-text flex items-center gap-1.5">
                  <FolderOpen className="h-3.5 w-3.5 text-accent" />
                  <span>Thư mục lưu trữ Ảnh &amp; Video trên máy</span>
                </label>
                {profile.customMediaDir && (
                  <button
                    type="button"
                    onClick={() => handleChange('customMediaDir', '')}
                    className="text-[11px] text-rose-400 hover:underline cursor-pointer"
                  >
                    Đặt lại mặc định
                  </button>
                )}
              </div>
              <div className="flex items-center gap-2">
                <input
                  type="text"
                  readOnly
                  value={profile.customMediaDir || ''}
                  placeholder="Mặc định: Tự động lưu theo thư mục session dự án (/05_media)"
                  className="flex-1 rounded-md border border-border bg-bg px-3.5 py-2 text-xs text-text placeholder:text-text-faint focus:outline-none"
                />
                <button
                  type="button"
                  onClick={async () => {
                    try {
                      const selected = await (window as any).vanhsub?.dialog?.chooseDirectory?.() || await (window as any).electronAPI?.dialog?.chooseDirectory?.();
                      if (selected) {
                        handleChange('customMediaDir', selected);
                      }
                    } catch (err) {
                      console.error('Lỗi chọn thư mục:', err);
                    }
                  }}
                  className="rounded-md border border-border bg-surface-2 hover:bg-surface-3 px-3 py-2 text-xs font-medium text-white transition cursor-pointer flex items-center gap-1 shrink-0"
                >
                  <FolderOpen className="h-3.5 w-3.5" />
                  <span>Chọn thư mục...</span>
                </button>
                {profile.customMediaDir && (
                  <button
                    type="button"
                    onClick={() => {
                      (window as any).vanhsub?.dialog?.openFolder?.(profile.customMediaDir) || (window as any).electronAPI?.dialog?.openFolder?.(profile.customMediaDir);
                    }}
                    className="rounded-md border border-cyan-800/60 bg-surface-2 hover:bg-cyan-900/60 px-3 py-2 text-xs font-medium text-accent transition cursor-pointer shrink-0"
                    title="Mở thư mục trên máy tính"
                  >
                    Mở
                  </button>
                )}
              </div>
              <p className="text-[11px] text-text-muted leading-relaxed">
                Toàn bộ ảnh (.png) và video (.mp4) sinh từ Google Flow sẽ được lưu trực tiếp vào thư mục này để tránh đầy ổ hệ thống và tiện sao chép, chỉnh sửa.
              </p>
            </div>

            {/* Row 4.2: Chế độ hiển thị cửa sổ Google Flow */}
            <div className="space-y-1.5">
              <label className="text-xs font-semibold text-text flex items-center gap-1.5">
                <Eye className="h-3.5 w-3.5 text-indigo-400" />
                <span>Cửa sổ hiển thị Google Flow (Automation UI Mode)</span>
              </label>
              <select
                value={profile.flowUiMode || 'offscreen'}
                onChange={(e) => handleChange('flowUiMode', e.target.value as any)}
                className="w-full rounded-md border border-border bg-bg px-3.5 py-2.5 text-xs text-white focus:border-accent/40 focus:outline-none focus:ring-1 focus:ring-accent/30 cursor-pointer"
              >
                <option value="live_window">🖥️ Mở cửa sổ trực tiếp (Live Window) — Khuyến nghị để theo dõi quá trình AI tạo ảnh &amp; video</option>
                <option value="offscreen">👻 Chạy ngầm (Offscreen) — Ẩn hoàn toàn cửa sổ dưới nền</option>
              </select>
              <p className="text-[11px] text-text-muted italic">
                Khi chọn Live Window, bạn có thể thu nhỏ (-) cửa sổ Flow xuống Taskbar bất kỳ lúc nào mà không làm gián đoạn tiến trình.
              </p>
            </div>

            {/* Row 5: Số cảnh video & Thời gian ảnh tĩnh */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {/* Số cảnh video */}
              <div className="space-y-1.5">
                <label className="text-xs font-semibold text-text">
                  Số cảnh video{' '}
                  <span className="text-[10px] text-text-muted">(Clip đắt và chậm hơn ảnh — nhập 0 cho phần nào thì phần đó toàn ảnh.)</span>
                </label>
                <div className="flex items-center gap-3">
                  <div className="flex items-center gap-2">
                    <span className="text-xs text-text-muted">Mở đầu</span>
                    <input
                      type="number"
                      min={0}
                      max={20}
                      value={profile.videoScenesIntro}
                      onChange={(e) => handleChange('videoScenesIntro', parseInt(e.target.value) || 0)}
                      className="w-16 rounded-md border border-border bg-bg px-3 py-2 text-xs text-center text-white focus:border-accent/40 focus:outline-none"
                    />
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="text-xs text-text-muted">Phần thân</span>
                    <input
                      type="number"
                      min={0}
                      max={50}
                      value={profile.videoScenesBody}
                      onChange={(e) => handleChange('videoScenesBody', parseInt(e.target.value) || 0)}
                      className="w-20 rounded-md border border-border bg-bg px-3 py-2 text-xs text-center text-white focus:border-accent/40 focus:outline-none"
                    />
                  </div>
                </div>
              </div>

              {/* Thời gian ảnh tĩnh */}
              <div className="space-y-1.5">
                <label className="text-xs font-semibold text-text">
                  Thời gian ảnh tĩnh{' '}
                  <span className="text-[10px] text-text-muted">(Khoảng thời gian mỗi cảnh ảnh tĩnh (giây). Tăng lên để video dài tiết kiệm số lần tạo ảnh.)</span>
                </label>
                <div className="flex items-center gap-2">
                  <input
                    type="number"
                    min={1}
                    max={30}
                    value={profile.staticImageDurationMin}
                    onChange={(e) => handleChange('staticImageDurationMin', parseInt(e.target.value) || 5)}
                    className="w-16 rounded-md border border-border bg-bg px-3 py-2 text-xs text-center text-white focus:border-accent/40 focus:outline-none"
                  />
                  <span className="text-xs text-text-muted">s —</span>
                  <input
                    type="number"
                    min={1}
                    max={60}
                    value={profile.staticImageDurationMax}
                    onChange={(e) => handleChange('staticImageDurationMax', parseInt(e.target.value) || 8)}
                    className="w-16 rounded-md border border-border bg-bg px-3 py-2 text-xs text-center text-white focus:border-accent/40 focus:outline-none"
                  />
                  <span className="text-xs text-text-muted">s</span>
                </div>
              </div>
            </div>

            {/* Row 6: Model video | Model ảnh */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <label className="text-xs font-semibold text-text">Model video</label>
                <select
                  value={profile.videoModel}
                  onChange={(e) => handleChange('videoModel', e.target.value)}
                  className="w-full rounded-md border border-border bg-bg px-3.5 py-2.5 text-xs text-white focus:border-accent/40 focus:outline-none focus:ring-1 focus:ring-accent/30 cursor-pointer"
                >
                  <optgroup label="🎬 Google Flow &amp; DeepMind (Khuyên dùng)">
                    <option value="Omni 1.1 Flash">Omni 1.1 Flash (Google Flow Video)</option>
                    <option value="Veo 2">Google Veo 2 (DeepMind / Flow)</option>
                    <option value="Veo 3.1">Google Veo 3.1 Cinema</option>
                    <option value="Veo Fast">Google Veo Fast 1080p</option>
                    <option value="Veo Flow Session">Google Veo (Sảnh Flow Session)</option>
                    <option value="Veo 9:16 Shorts">Google Veo Shorts (Dọc 9:16)</option>
                  </optgroup>
                  <optgroup label="🌐 Mô hình Video Đối tác">
                    <option value="Sora Turbo">OpenAI Sora Turbo</option>
                    <option value="Kling 1.5 Pro">Kling 1.5 Pro</option>
                    <option value="Minimax Hailuo 01">Minimax Hailuo Video</option>
                    <option value="Luma Ray 2">Luma Ray 2 (Dream Machine)</option>
                    <option value="Runway Gen-3 Alpha">Runway Gen-3 Alpha</option>
                  </optgroup>
                </select>
              </div>

              <div className="space-y-1.5">
                <label className="text-xs font-semibold text-text">Model ảnh</label>
                <select
                  value={profile.imageModel}
                  onChange={(e) => handleChange('imageModel', e.target.value)}
                  className="w-full rounded-md border border-border bg-bg px-3.5 py-2.5 text-xs text-white focus:border-accent/40 focus:outline-none focus:ring-1 focus:ring-accent/30 cursor-pointer"
                >
                  <optgroup label="🍌 Google Flow &amp; Banana Studio (Khuyên dùng)">
                    <option value="⭐ Nano Banana 2">⭐ Nano Banana 2 (Google Flow)</option>
                    <option value="🍌 Banana Pro (4K Studio)">🍌 Banana Pro (4K Studio)</option>
                    <option value="🍌 Nano Banana Pro Preview">🍌 Nano Banana Pro Preview</option>
                    <option value="Imagen 3 Fast">Google Imagen 3 (Fast)</option>
                    <option value="Imagen 3.1 Photorealistic">Google Imagen 3.1 (Photorealistic)</option>
                    <option value="Imagen 2 Studio">Google Imagen 2 (Studio)</option>
                    <option value="Flow Image Session">Google Flow Image (Sảnh Flow Session)</option>
                  </optgroup>
                  <optgroup label="🎨 Mô hình Ảnh Đối tác &amp; Nghệ thuật">
                    <option value="FLUX.1-schnell">FLUX.1-schnell (Black Forest Labs)</option>
                    <option value="FLUX.1-dev">FLUX.1-dev (Chất lượng cao)</option>
                    <option value="SDXL Turbo">SDXL Turbo (Stability AI)</option>
                    <option value="Midjourney v6.1">Midjourney v6.1 (Flow Bridge)</option>
                  </optgroup>
                </select>
              </div>
            </div>
          </section>
        </div>

        {/* MODAL FOOTER */}
        <div className="flex min-h-16 shrink-0 flex-wrap items-center justify-between gap-3 border-t border-border bg-[#0F172A]/95 px-6 py-3">
          <div className="flex min-w-0 flex-1 flex-col gap-1">
            <span className="text-xs text-text-muted">Thay đổi áp dụng cho ý tưởng / video mới.</span>
            {profile.ttsEngine === 'kokoro_tts' && (
              <div className="text-[11px] text-text-muted" role="status">
                {kokoroStatus === 'loading' && <span>Đang tải danh sách giọng Kokoro...</span>}
                {kokoroStatus === 'success' && <span>Đã tải {kokoroVoices.length} giọng Kokoro.</span>}
                {kokoroStatus === 'empty' && <span>Server Kokoro chưa có giọng khả dụng.</span>}
                {kokoroStatus === 'error' && <span>{kokoroError}</span>}
                <button type="button" aria-label="Tải lại giọng Kokoro" disabled={kokoroStatus === 'loading'}
                  onClick={() => setKokoroRetry(value => value + 1)} className="ml-2 underline disabled:opacity-50">Tải lại</button>
                <p>Kokoro cần server local đang chạy. Timing từng từ là ước lượng theo audio; chưa xác nhận hỗ trợ tiếng Việt.</p>
              </div>
            )}
            {profile.ttsEngine === 'tiktok_tts' && (
              <span className={`text-[11px] flex items-center gap-1 ${hasTikTokSession ? 'text-emerald-400' : 'text-amber-400'}`}>
                {hasTikTokSession ? '✓ TikTok TTS Session sẵn sàng' : '⚠ Chưa lưu Session TikTok (tự động Edge-TTS dự phòng)'}
              </span>
            )}
          </div>

          <div className="flex shrink-0 items-center gap-3 whitespace-nowrap">
            <button
              type="button"
              onClick={onClose}
              disabled={isSaving}
              className="rounded-md border border-border bg-surface-2 px-5 py-2.5 text-xs font-semibold text-text hover:bg-surface-3 hover:text-white transition cursor-pointer"
            >
              Đóng
            </button>
            <button
              type="button"
              onClick={handleSave}
              disabled={isSaving}
              className="rounded-md bg-[#F95738] hover:bg-[#E54324] px-6 py-2.5 text-xs font-bold text-white shadow-[#F95738]/25 hover:brightness-105 active:scale-95 transition cursor-pointer"
            >
              {isSaving ? 'Đang lưu...' : 'Lưu cấu hình'}
            </button>
          </div>
        </div>

        {/* POPUP MODAL: TẠO KIỂU VIDEO MỚI */}
        {isStyleModalOpen && (
          <div className="absolute inset-0 z-50 flex items-center justify-center bg-black/70 p-4">
            <div className="w-full max-w-md rounded-lg border border-border bg-surface p-5 space-y-4">
              <h4 className="text-sm font-bold text-white flex items-center gap-2">
                <Plus className="h-4 w-4 text-accent" />
                <span>Tạo kiểu video (Bộ não AI) mới</span>
              </h4>
              <div className="space-y-3">
                <div className="space-y-1">
                  <label className="text-xs text-text font-medium">Tên kiểu video</label>
                  <input
                    type="text"
                    value={newStyleName}
                    onChange={(e) => setNewStyleName(e.target.value)}
                    placeholder="Vd: Phóng sự điều tra kỳ án"
                    className="w-full rounded-md border border-border bg-bg px-3 py-2 text-xs text-white"
                  />
                </div>
                <div className="space-y-1">
                  <label className="text-xs text-text font-medium">Mô tả đặc trưng</label>
                  <input
                    type="text"
                    value={newStyleDesc}
                    onChange={(e) => setNewStyleDesc(e.target.value)}
                    placeholder="Vd: Dẫn dắt trinh thám hình sự, tiết tấu nghẹt thở..."
                    className="w-full rounded-md border border-border bg-bg px-3 py-2 text-xs text-white"
                  />
                </div>
              </div>
              <div className="flex justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setIsStyleModalOpen(false)}
                  className="rounded-md border border-border bg-surface-2 px-4 py-2 text-xs font-medium text-text hover:text-white"
                >
                  Hủy
                </button>
                <button
                  type="button"
                  onClick={handleAddStyle}
                  disabled={!newStyleName.trim()}
                  className="bg-accent text-white hover:bg-accent-hover rounded-md px-4 py-2 text-xs font-bold text-white disabled:opacity-40"
                >
                  Thêm kiểu
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Modal: Skill tạo Master Prompt (Xem & Sao Chép để tự chạy) */}
        <ChannelSkillModal
          isOpen={isSkillModalOpen}
          onClose={() => setIsSkillModalOpen(false)}
          channelProfile={profile}
        />
      </div>
    </div>
  );
}
