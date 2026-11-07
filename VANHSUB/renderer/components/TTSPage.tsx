import React, { useEffect, useRef, useState } from 'react';
import {
  AlertTriangle,
  CheckCircle2,
  Pause,
  Download,
  FileAudio,
  FolderOpen,
  Headphones,
  Loader2,
  Mic,
  Play,
  RefreshCw,
  Volume2,
  XCircle,
  Users,
  X,
  Sparkles,
} from 'lucide-react';
import type { Task } from '../types/task';
import { SPEED_OPTIONS, speedLabel } from '../lib/ttsOptions';
import { fullPreviewPlayer, type FullPreviewState } from '../lib/fullPreviewPlayer';
import { setAudioPreviewSource, clearAudioPreviewSource } from '../lib/audioPreviewSource';
import { parseSrt, type SrtLine } from '../lib/srt';
import { resolveTtsEngine } from '../../main/lib/ttsConfig';
import { useDubbingPreferences } from '../lib/useDubbingPreferences';

type Props = {
  tasks: Task[];
  selectedTaskId?: string | null;
  onSelectTaskId?: (id: string | null) => void;
  isActive?: boolean;
};


function formatTimeAgo(isoString: string): string {
  try {
    const date = new Date(isoString);
    return date.toLocaleDateString('vi-VN');
  } catch {
    return '';
  }
}

function formatSeconds(sec: number): string {
  if (!sec || isNaN(sec)) return '00:00';
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

/** Câu nghe thử cố định — bấm nghe ngay, không cần đọc file SRT */
const SAMPLE_TEXT = 'Xin chào, bạn đang nghe thử giọng đọc tại Vanh sub.';

export default function TTSPage({ tasks, selectedTaskId: propSelectedTaskId, onSelectTaskId, isActive = true }: Props) {
  const [internalTaskId, setInternalTaskId] = useState<string | null>(null);
  const selectedTaskId = propSelectedTaskId !== undefined ? propSelectedTaskId : internalTaskId;
  const setSelectedTaskId = (id: string | null) => {
    if (onSelectTaskId) onSelectTaskId(id);
    else setInternalTaskId(id);
  };
  const [ttsEngine, setTtsEngine] = useState<'edge' | 'tiktok' | 'viettts'>('edge');
  const [localVoices, setLocalVoices] = useState<string[]>([]);
  const [localConnected, setLocalConnected] = useState(false);
  const [edgeVoices, setEdgeVoices] = useState<Array<{ id: string; name: string; gender?: string; locale?: string }>>([
    { id: 'vi-VN-HoaiMyNeural', name: 'Hoài My (Nữ - Truyền cảm, Tự nhiên)', gender: 'Female', locale: 'vi-VN' },
    { id: 'vi-VN-NamMinhNeural', name: 'Nam Minh (Nam - Trầm ấm, Phóng sự)', gender: 'Male', locale: 'vi-VN' },
  ]);
  const [voice, setVoice] = useState<string>('vi-VN-HoaiMyNeural');
  const [speed, setSpeed] = useState<number>(1.0);
  // Tab lồng tiếng hỗ trợ cả Edge TTS (miễn phí) và TikTok TTS
  const [tiktokVoices, setTiktokVoices] = useState<Array<{ id: string; label: string; language: string }>>([]);
  const [tiktokHasSession, setTiktokHasSession] = useState(false);
  const [voiceSearch, setVoiceSearch] = useState('');
  const [message, setMessage] = useState('');
  const [isError, setIsError] = useState(false);
  const [previewing, setPreviewing] = useState(false);
  // AI tách lời thoại gốc (demucs): giữ nhạc nền, loại giọng người gốc — thay mix 0.22
  const [startingDubbing, setStartingDubbing] = useState(false);
  const previewAudioRef = useRef<HTMLAudioElement | null>(null);

  // File MP3 tổng hợp của cả dự án
  const mergedAudioRef = useRef<HTMLAudioElement | null>(null);
  const [isMergedPlaying, setIsMergedPlaying] = useState(false);
  const [mergedCurrentTime, setMergedCurrentTime] = useState(0);
  const [mergedDuration, setMergedDuration] = useState(0);
  const [isExportingMp3, setIsExportingMp3] = useState(false);

  // Gán giọng riêng theo từng dòng phụ đề
  const [showVoicePanel, setShowVoicePanel] = useState(false);
  const [srtLines, setSrtLines] = useState<SrtLine[]>([]);
  const [voiceOverrides, setVoiceOverrides] = useState<Record<string, string>>({});
  const [linePreviewing, setLinePreviewing] = useState<number | null>(null);
  const [regeneratingLine, setRegeneratingLine] = useState<number | null>(null);
  // Video đối chiếu trong bảng gán giọng: bấm dòng → video nhảy tới câu đó
  const panelVideoRef = useRef<HTMLVideoElement | null>(null);
  const [panelActiveLine, setPanelActiveLine] = useState<number | null>(null);

  // Tiện ích gán giọng nhanh theo nhân vật (Speaker Diarization)
  const [showSpeakerMappingModal, setShowSpeakerMappingModal] = useState(false);
  const [speakerVoiceMap, setSpeakerVoiceMap] = useState<Record<string, string>>({});

  // Danh sách các nhân vật phát hiện được trong file SRT kèm số câu
  const detectedSpeakers = React.useMemo(() => {
    const counts: Record<string, number> = {};
    for (const l of srtLines) {
      if (l.speaker) {
        counts[l.speaker] = (counts[l.speaker] || 0) + 1;
      }
    }
    return Object.entries(counts).map(([name, count]) => ({ name, count }));
  }, [srtLines]);

  // Nghe thử toàn bộ phụ đề 1 mạch — playback sống trong fullPreviewPlayer
  // (singleton ngoài React) nên chuyển tab rồi quay lại vẫn thấy tiến trình chạy.
  // Tham số thứ 3 (getServerSnapshot) bắt buộc khi Next.js pre-render trang.
  const fullPreview: FullPreviewState = React.useSyncExternalStore(
    fullPreviewPlayer.subscribe,
    fullPreviewPlayer.getState,
    fullPreviewPlayer.getState
  );
  const fullPreviewing = fullPreview.playing;
  const fullPreviewLine = fullPreview.currentLine;

  const startFullPreview = (startLine: number = 1) => {
    if (srtLines.length === 0) return;
    // Dừng video đối chiếu khi nghe 1 mạch — tiếng video gốc không lấn tiếng
    // preview, highlight dòng theo audio preview thay vì theo đồng hồ video
    panelVideoRef.current?.pause();
    setMessage('');
    setIsError(false);
    // Chụp giọng/speed tại thời điểm bấm — đổi gán giọng trong lúc phát
    // không ảnh hưởng phiên đang chạy (bấm lại để nghe bản mới)
    const lines = srtLines.map((line, i) => ({
      lineNumber: i + 1,
      text: line.text,
      voice: voiceOverrides[String(i + 1)] || voice,
    }));
    fullPreviewPlayer.start(
      {
        lines,
        fetchAudio: (l) => window.vanhsub.tts.preview(l.text.slice(0, 300), l.voice, speed, ttsEngine),
      },
      startLine
    );
  };

  const stopFullPreview = () => fullPreviewPlayer.stop();

  const selectedTask = tasks.find((t) => t.id === selectedTaskId) || null;
  const { replaceAudio, setReplaceAudio, syncMode, setSyncMode, mixOriginalAudio, setMixOriginalAudio,
    vocalSeparation, setVocalSeparation } = useDubbingPreferences(selectedTask);
  const isTtsRunning = selectedTask?.status === 'dubbing';
  const isDubbingRunning = selectedTask?.status === 'exporting';
  const hasSrtFile = !!selectedTask?.srtPath;
  const hasTtsAudio = !!selectedTask?.ttsAudioDir && !isTtsRunning && !selectedTask?.ttsNeedsRegeneration;
  const dubbedOutput = selectedTask?.dubbedVideoPath || selectedTask?.outputPath;
  const customVoiceCount = Object.keys(voiceOverrides).length;

  // Reset trạng thái gán giọng & audio khi đổi tác vụ (playback 1 mạch vẫn chạy tiếp)
  useEffect(() => {
    previewAudioRef.current?.pause();
    if (mergedAudioRef.current) {
      mergedAudioRef.current.pause();
      mergedAudioRef.current.currentTime = 0;
    }
    setIsMergedPlaying(false);
    setMergedCurrentTime(0);
    setMergedDuration(0);
    setShowVoicePanel(false);
    setSrtLines([]);
    setVoiceOverrides(selectedTask?.ttsVoiceOverrides || {});
    setLinePreviewing(null);
    setRegeneratingLine(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedTaskId, selectedTask?.subtitleRevision]);

  useEffect(() => {
    if (!isActive || typeof window === 'undefined' || !window.vanhsub?.settings) return;
    let cancelled = false;
    Promise.all([window.vanhsub.settings.get('ttsVoice'), window.vanhsub.settings.get('ttsSpeed')])
      .then(([defaultVoice, defaultSpeed]) => {
        if (cancelled) return;
        const chosenVoice = selectedTask?.ttsVoice || defaultVoice || 'vi-VN-HoaiMyNeural';
        const chosenEngine = resolveTtsEngine(chosenVoice, selectedTask?.ttsEngine);
        setTtsEngine(chosenEngine);
        setVoice(chosenVoice);
        setSpeed(selectedTask?.ttsSpeed ?? (Number(defaultSpeed) || 1));
      }).catch(() => {});
    window.vanhsub.tiktokTts?.status().then((status) => {
      if (!cancelled) setTiktokHasSession(Boolean(status?.hasSession));
    }).catch(() => {});
    return () => { cancelled = true; };
  }, [selectedTaskId, isActive]);

  useEffect(() => {
    if (ttsEngine !== 'viettts' || !isActive) return;
    let disposed = false;
    setLocalConnected(false);
    Promise.all([window.vanhsub.tts.voices(), window.vanhsub.tts.checkConnection()]).then(([voices, connected]) => {
      if (disposed) return;
      setLocalVoices(voices); setLocalConnected(connected);
      if (voices.length) setVoice(current => voices.includes(current) ? current : voices[0]);
    }).catch(() => { if (!disposed) { setLocalVoices([]); setLocalConnected(false); } });
    return () => { disposed = true; };
  }, [ttsEngine, isActive]);

  // Nạp trạng thái session + catalog giọng Edge TTS & TikTok (1 lần)
  useEffect(() => {
    if (typeof window === 'undefined') return;

    if (window.vanhsub?.tts?.getEdgeVoices) {
      window.vanhsub.tts.getEdgeVoices().then((res: any) => {
        if (Array.isArray(res) && res.length > 0) {
          setEdgeVoices(res);
        }
      }).catch(() => {});
    }

    if (window.vanhsub?.tiktokTts) {
      window.vanhsub.tiktokTts
        .voices()
        .then((res) => {
          if (res?.ok) {
            // Giọng tiếng Việt lên đầu danh sách
            const sorted = [...res.voices].sort(
              (a, b) => (a.language === 'vi' ? 0 : 1) - (b.language === 'vi' ? 0 : 1),
            );
            setTiktokVoices(sorted);
          }
        })
        .catch(() => {});
    }
  }, []);

  // Dọn audio preview đơn lẻ khi rời trang (playback 1 mạch vẫn tiếp tục)
  useEffect(() => {
    return () => {
      if (previewAudioRef.current) clearAudioPreviewSource(previewAudioRef.current);
      if (mergedAudioRef.current) {
        mergedAudioRef.current.pause();
      }
    };
  }, []);

  // Reload edited subtitles on each open; a late read cannot populate another task.
  const toggleVoicePanel = () => setShowVoicePanel(open => !open);
  const voicePanelSrtPath = selectedTask?.translatedSrtPath || selectedTask?.srtPath;
  useEffect(() => {
    if (!showVoicePanel || !voicePanelSrtPath || !window.vanhsub?.tasks?.readSrt) return;
    let cancelled = false;
    setSrtLines([]);
    window.vanhsub.tasks.readSrt(voicePanelSrtPath).then(content => {
      if (!cancelled) setSrtLines(parseSrt(content));
    }).catch(() => {
      if (!cancelled) { setIsError(true); setMessage('Không đọc được phụ đề để gán giọng.'); }
    });
    return () => { cancelled = true; };
  }, [showVoicePanel, voicePanelSrtPath, selectedTaskId, selectedTask?.subtitleRevision]);

  // Quay lại trang khi đang nghe 1 mạch → mở lại bảng gán giọng để thấy tiến trình
  const restoredPanelForTask = useRef<number | null>(null);
  useEffect(() => {
    if (
      fullPreview.playing &&
      selectedTaskId &&
      restoredPanelForTask.current !== fullPreview.session
    ) {
      restoredPanelForTask.current = fullPreview.session;
      if (!showVoicePanel) void toggleVoicePanel();
    }
    // chỉ chạy khi phiên phát mới bắt đầu hoặc lần đầu mount
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fullPreview.playing, fullPreview.session]);

  // Đặt/xoá giọng của 1 dòng. Key là số dòng SRT (1-based) — trùng với
  // sub.index mà ttsEngine dùng khi tạo file audio.
  const setLineVoice = (lineNumber: number, voice: string) => {
    setVoiceOverrides((prev) => {
      const next = { ...prev };
      if (voice) {
        next[String(lineNumber)] = voice;
      } else {
        delete next[String(lineNumber)];
      }
      return next;
    });
  };

  // Nghe thử 1 dòng với giọng sẽ gán (hoặc giọng chung nếu để mặc định)
  const handlePreviewLine = async (lineNumber: number, text: string, lineVoice: string) => {
    if (fullPreviewing) stopFullPreview();
    setMessage('');
    setIsError(false);
    setLinePreviewing(lineNumber);
    try {
      const res = await window.vanhsub.tts.preview(
        text.slice(0, 300),
        lineVoice || voice,
        speed,
        ttsEngine
      );
      previewAudioRef.current?.pause();
      if (!previewAudioRef.current) previewAudioRef.current = new Audio();
      setAudioPreviewSource(previewAudioRef.current, res);
      await previewAudioRef.current.play();
    } catch (err: any) {
      setIsError(true);
      setMessage(err?.message || 'Không thể nghe thử dòng này. Vui lòng kiểm tra lại cấu hình TTS.');
    } finally {
      setLinePreviewing(null);
    }
  };

  // Cuộn tới dòng đang phát trong bảng gán giọng
  useEffect(() => {
    if (fullPreviewLine == null) return;
    document
      .getElementById(`voice-line-${fullPreviewLine}`)
      ?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }, [fullPreviewLine]);

  // Tạo lại audio cho 1 dòng đã có audio TTS (dùng khi sửa text ở Hiệu đính
  // hoặc muốn đổi giọng riêng dòng đó mà không chạy lại toàn bộ)
  const handleRegenerateLine = async (lineNumber: number) => {
    if (!selectedTaskId || regeneratingLine !== null) return;
    setMessage('');
    setIsError(false);
    setRegeneratingLine(lineNumber);
    try {
      const res = await window.vanhsub.tts.regenerateLine(selectedTaskId, lineNumber,
        { voice, speed, engine: ttsEngine, voiceOverrides });
      if (!res?.ok) {
        setIsError(true);
        setMessage(res?.error || 'Không thể tạo lại audio cho dòng này.');
        return;
      }
      setMessage(
        `Đã tạo lại nhóm câu chứa dòng ${lineNumber} và cập nhật MP3 — bấm "Ghép audio vào video" để áp dụng.`
      );
    } catch (err: any) {
      setIsError(true);
      setMessage(err?.message || 'Không thể tạo lại audio cho dòng này.');
    } finally {
      setRegeneratingLine(null);
    }
  };

  const handleCancelTTS = async () => {
    if (!selectedTaskId) return;
    try {
      await window.vanhsub.tts.cancel(selectedTaskId);
      setMessage('Đã gửi yêu cầu huỷ — dừng sau câu hiện tại.');
    } catch {
      // bỏ qua
    }
  };

  const handleTogglePlayMerged = () => {
    if (!mergedAudioRef.current || !selectedTask?.ttsMergedAudioPath) return;
    if (isMergedPlaying) {
      mergedAudioRef.current.pause();
      setIsMergedPlaying(false);
    } else {
      if (previewAudioRef.current) previewAudioRef.current.pause();
      if (fullPreviewing) stopFullPreview();
      mergedAudioRef.current
        .play()
        .then(() => setIsMergedPlaying(true))
        .catch((e) => {
          console.error('Lỗi phát file MP3 tổng hợp:', e);
          setIsError(true);
          setMessage('Không thể phát file MP3 tổng hợp. File có thể đang được tạo hoặc chưa sẵn sàng.');
        });
    }
  };

  const handleExportMergedMp3 = async () => {
    if (!selectedTaskId) return;
    setIsExportingMp3(true);
    setMessage('');
    setIsError(false);
    try {
      const res = await window.vanhsub.tts.exportMergedAudio(
        selectedTaskId,
        undefined,
        syncMode === 'strict' ? 'strict' : 'flexible'
      );
      if (res?.ok) {
        setMessage('Đã tổng hợp thành công file MP3 lồng tiếng chính xác theo timeline dự án!');
      } else {
        setIsError(true);
        setMessage(res?.error || 'Không thể tổng hợp file MP3.');
      }
    } catch (err: any) {
      setIsError(true);
      setMessage(err?.message || 'Lỗi khi tổng hợp file MP3.');
    } finally {
      setIsExportingMp3(false);
    }
  };

  const handleOpenMergedFolder = async () => {
    if (!selectedTask?.ttsMergedAudioPath) return;
    try {
      await window.vanhsub.dialog.showInFolder(selectedTask.ttsMergedAudioPath);
    } catch (err) {
      console.error('Lỗi mở thư mục chứa file MP3:', err);
    }
  };

  const handleSaveMergedMp3To = async () => {
    if (!selectedTaskId || !window.vanhsub?.dialog?.chooseDirectory) return;
    try {
      const targetDir = await window.vanhsub.dialog.chooseDirectory();
      if (!targetDir) return;
      setIsExportingMp3(true);
      const cleanBase = selectedTask?.fileName.replace(/\.[^/.]+$/, '') || 'voice';
      const outPath = `${targetDir.replace(/[\\/]$/, '')}\\${cleanBase}_voice.mp3`;
      const res = await window.vanhsub.tts.exportMergedAudio(
        selectedTaskId,
        outPath,
        syncMode === 'strict' ? 'strict' : 'flexible'
      );
      if (res?.ok) {
        setMessage(`Đã xuất và lưu file MP3 tổng hợp thành công vào: ${outPath}`);
      } else {
        setIsError(true);
        setMessage(res?.error || 'Không thể lưu file MP3 ra thư mục đã chọn.');
      }
    } catch (err: any) {
      setIsError(true);
      setMessage(err?.message || 'Lỗi khi lưu file MP3.');
    } finally {
      setIsExportingMp3(false);
    }
  };

  const handleStartTTS = async () => {
    if (!selectedTaskId) return;
    setMessage('');
    setIsError(false);

    try {
      const currentSession = ttsEngine === 'tiktok' ? await window.vanhsub.tiktokTts.status() : null;
      if (ttsEngine === 'tiktok') setTiktokHasSession(Boolean(currentSession?.hasSession));
      if (ttsEngine === 'tiktok' && !currentSession?.hasSession) {
        setIsError(true);
        setMessage('Chưa có session TikTok — vào Cài đặt → TikTok TTS để lưu sessionid trước.');
        return;
      }

      await window.vanhsub.tts.start(selectedTaskId, voice, speed, voiceOverrides, ttsEngine);
      setMessage(`Đã gửi yêu cầu tạo lồng tiếng (${ttsEngine === 'viettts' ? 'Local TTS' : ttsEngine === 'edge' ? 'Edge TTS' : 'TikTok TTS'}) — theo dõi tiến trình bên dưới.`);
    } catch (err: any) {
      setIsError(true);
      setMessage(err?.message || String(err));
    }
  };

  const handlePreview = async () => {
    setMessage('');
    setIsError(false);
    setPreviewing(true);
    try {
      const res = await window.vanhsub.tts.preview(SAMPLE_TEXT, voice, speed, ttsEngine);
      previewAudioRef.current?.pause();
      if (!previewAudioRef.current) previewAudioRef.current = new Audio();
      setAudioPreviewSource(previewAudioRef.current, res);
      await previewAudioRef.current.play();
      setMessage('Đang phát bản nghe thử...');
    } catch (err: any) {
      setIsError(true);
      setMessage(
        err?.message ||
          (ttsEngine === 'tiktok'
            ? 'Không thể tạo bản nghe thử. Nếu lỗi session, vào Cài đặt lưu lại sessionid TikTok.'
            : 'Không thể tạo bản nghe thử Edge TTS. Vui lòng kiểm tra lại kết nối mạng.')
      );
    } finally {
      setPreviewing(false);
    }
  };

  const handleStartDubbing = async () => {
    if (!selectedTaskId || !hasTtsAudio) return;
    setMessage('');
    setIsError(false);
    setStartingDubbing(true);
    try {
      await window.vanhsub.dubbing.start(selectedTaskId, replaceAudio, {
        syncMode,
        mixOriginalAudio: replaceAudio && mixOriginalAudio && !vocalSeparation,
        vocalSeparation: replaceAudio && vocalSeparation,
      });
      setMessage('Đã bắt đầu ghép audio lồng tiếng vào video.');
    } catch (err: any) {
      setIsError(true);
      setMessage(err?.message || String(err));
    } finally {
      setStartingDubbing(false);
    }
  };

  const handleOpenOutputFolder = async () => {
    if (!dubbedOutput) return;
    try {
      await window.vanhsub.dialog.showInFolder(dubbedOutput);
    } catch (err) {
      console.error('Không mở được thư mục:', err);
    }
  };

  // Hiển thị lỗi từ pipeline (task chuyển sang trạng thái error)
  useEffect(() => {
    if (selectedTask?.status === 'error' && selectedTask.errorMessage) {
      setIsError(true);
      setMessage(selectedTask.errorMessage);
    }
  }, [selectedTask?.status, selectedTask?.errorMessage]);

  const ttsEligibleTasks = tasks.filter((t) => t.srtPath);

  // Video đối chiếu trong bảng gán giọng (chỉ với file video, audio thì ẩn)
  const AUDIO_EXTENSIONS_TTS = ['mp3', 'wav', 'm4a', 'flac', 'aac', 'ogg', 'opus', 'wma'];
  const isVideoTask =
    !!selectedTask &&
    !AUDIO_EXTENSIONS_TTS.includes(selectedTask.filePath.split('.').pop()?.toLowerCase() || '');
  const panelVideoSrc =
    selectedTask && isVideoTask ? `vanhmedia://local/${encodeURIComponent(selectedTask.filePath)}` : null;

  /** Video nhảy tới thời điểm bắt đầu 1 dòng phụ đề */
  const seekVideoToLine = (line: SrtLine) => {
    const video = panelVideoRef.current;
    if (!video) return;
    video.currentTime = line.startMs / 1000 + 0.001;
    // Đang nghe 1 mạch: chỉ dời khung hình đối chiếu, không phát tiếng video gốc
    if (fullPreviewing) return;
    void video.play().catch(() => {});
  };

  /** Theo dõi thời điểm video → tô sáng dòng phụ đề đang được nói */
  const handlePanelVideoTime = () => {
    const video = panelVideoRef.current;
    if (!video) return;
    const tMs = video.currentTime * 1000;
    const active = srtLines.findIndex((l) => tMs >= l.startMs && tMs < l.endMs);
    setPanelActiveLine(active >= 0 ? active + 1 : null);
  };


  // Tìm kiếm giọng: lọc theo tên/mã không dấu, giọng đang chọn luôn được giữ
  const normalizedSearch = voiceSearch.trim().toLowerCase().replace(/[\s_]+/g, '');
  const activeVoiceList: Array<{ id: string; label: string }> =
    ttsEngine === 'edge'
      ? edgeVoices.map((v) => ({ id: v.id, label: v.name }))
      : ttsEngine === 'viettts' ? localVoices.map(id => ({ id, label: id })) : tiktokVoices;

  const voiceChoices: Array<{ value: string; label: string }> = activeVoiceList
    .filter((v) => {
      if (!normalizedSearch) return true;
      const hay = `${v.label} ${v.id}`.toLowerCase().replace(/[\s_]+/g, '');
      return hay.includes(normalizedSearch);
    })
    .map((v) => ({ value: v.id, label: `${v.label} · ${v.id}` }));
  if (voice && !voiceChoices.some((v) => v.value === voice)) {
    const current = activeVoiceList.find((v) => v.id === voice);
    if (current) {
      voiceChoices.unshift({ value: current.id, label: `${current.label} · ${current.id}` });
    }
  }
  const currentVoiceLabel = (v: string) => activeVoiceList.find((t) => t.id === v)?.label || v;

  // Xử lý mở modal phân vai & tự động gợi ý giọng
  const handleOpenSpeakerModal = () => {
    const initialMap: Record<string, string> = { ...speakerVoiceMap };
    detectedSpeakers.forEach((sp, idx) => {
      if (!initialMap[sp.name]) {
        if (idx === 0) {
          initialMap[sp.name] = voice || voiceChoices[0]?.value || '';
        } else {
          const altVoice =
            voiceChoices.find((vc) => vc.value !== voice)?.value ||
            voiceChoices[idx % voiceChoices.length]?.value ||
            '';
          initialMap[sp.name] = altVoice;
        }
      }
    });
    setSpeakerVoiceMap(initialMap);
    setShowSpeakerMappingModal(true);
  };

  // Áp dụng gán giọng theo nhân vật cho toàn bộ các dòng phụ đề tương ứng
  const handleApplySpeakerMapping = () => {
    setVoiceOverrides((prev) => {
      const next = { ...prev };
      let appliedCount = 0;
      srtLines.forEach((l, i) => {
        const lineNum = String(i + 1);
        if (l.speaker && speakerVoiceMap[l.speaker]) {
          next[lineNum] = speakerVoiceMap[l.speaker];
          appliedCount++;
        }
      });
      setMessage(`Đã tự động gán giọng cho ${appliedCount} câu thoại thuộc ${detectedSpeakers.length} nhân vật.`);
      return next;
    });
    setShowSpeakerMappingModal(false);
  };

  const activeProgress = isTtsRunning || isDubbingRunning ? selectedTask : null;
  const stageText =
    selectedTask?.stageDescription ||
    (isDubbingRunning ? 'Đang ghép audio vào video...' : 'Đang tạo lồng tiếng...');

  return (
    <div className="flex flex-1 flex-col gap-4 overflow-hidden p-6">
      {/* Thanh công cụ */}
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-border bg-surface p-4">
        <div className="flex flex-wrap items-center gap-3">
          <label className="text-xs font-semibold text-text">Tác vụ:</label>
          <select
            value={selectedTaskId || ''}
            onChange={(e) => setSelectedTaskId(e.target.value || null)}
            className="rounded-md border border-border bg-surface-2 px-3 py-1.5 text-xs text-text focus:outline-none"
          >
            <option value="">-- Chọn tác vụ đã có SRT --</option>
            {ttsEligibleTasks.map((t) => (
              <option key={t.id} value={t.id}>
                {t.fileName} ({formatTimeAgo(t.createdAt)})
              </option>
            ))}
          </select>

          {/* Bộ chọn Engine TTS */}
          <div className="flex items-center overflow-hidden rounded-md border border-border bg-bg p-0.5">
            <button type="button" disabled={isTtsRunning || isDubbingRunning}
              onClick={() => { if (ttsEngine !== 'viettts') setVoiceOverrides({}); setTtsEngine('viettts'); setVoice(localVoices[0] || ''); }}
              title="Dùng server TTS local có endpoint OpenAI-compatible (VietTTS/Piper)."
              className={`px-2.5 py-1 text-xs font-semibold rounded-lg cursor-pointer disabled:opacity-50 ${ttsEngine === 'viettts' ? 'bg-accent text-white' : 'text-text-muted'}`}>
              Local TTS
            </button>
            <button
              type="button"
              onClick={() => {
                if (ttsEngine !== 'edge') setVoiceOverrides({});
                setTtsEngine('edge');
                setVoice('vi-VN-HoaiMyNeural');
              }}
              disabled={isTtsRunning || isDubbingRunning}
              className={`px-2.5 py-1 text-xs font-semibold rounded-lg transition cursor-pointer ${
                ttsEngine === 'edge'
                  ? 'bg-accent-tint text-accent border border-accent/40'
                  : 'text-text-muted hover:text-white'
              }`}
              title="Edge TTS miễn phí. Đổi provider sẽ đặt lại gán giọng từng dòng để bạn chọn giọng tương ứng."
            >
              Edge TTS
            </button>
            <button
              type="button"
              onClick={() => {
                if (ttsEngine !== 'tiktok') setVoiceOverrides({});
                setTtsEngine('tiktok');
                setVoice('BV074_streaming');
              }}
              disabled={isTtsRunning || isDubbingRunning}
              className={`px-2.5 py-1 text-xs font-semibold rounded-lg transition cursor-pointer ${
                ttsEngine === 'tiktok'
                  ? 'bg-accent-tint text-accent border border-accent/40'
                  : 'text-text-muted hover:text-white'
              }`}
              title="TikTok TTS cần session. Đổi provider sẽ đặt lại gán giọng từng dòng để bạn chọn giọng tương ứng."
            >
              TikTok TTS
            </button>
          </div>

          <label className="text-xs font-semibold text-text">
            {ttsEngine === 'viettts' ? 'Giọng local:' : ttsEngine === 'edge' ? 'Giọng Edge:' : 'Giọng TikTok:'}
          </label>
          {ttsEngine === 'tiktok' && (
            <input
              type="text"
              value={voiceSearch}
              onChange={(e) => setVoiceSearch(e.target.value)}
              placeholder="Tìm giọng (vd: việt, nữ, en_us...)"
              className="w-40 rounded-md border border-border bg-surface-2 px-3 py-1.5 text-xs text-white placeholder:text-text-muted focus:border-accent/40 focus:outline-none"
            />
          )}
          <select
            value={voice}
            onChange={(e) => setVoice(e.target.value)}
            disabled={isTtsRunning || isDubbingRunning}
            className="rounded-md border border-border bg-surface-2 px-3 py-1.5 text-xs text-text focus:outline-none disabled:opacity-50 max-w-[260px]"
          >
            {voiceChoices.map((v) => (
              <option key={v.value} value={v.value}>
                {v.label}
              </option>
            ))}
          </select>
          <span className="text-[11px] text-text-muted">
            {voiceChoices.length}/{activeVoiceList.length} giọng
          </span>
          {ttsEngine === 'viettts' && !localConnected && <span className="text-xs text-amber-400">Chưa kết nối TTS local — kiểm tra endpoint trong Cài đặt.</span>}

          <label className="text-xs font-semibold text-text">Tốc độ:</label>
          <select
            value={speed}
            onChange={(e) => setSpeed(Number(e.target.value))}
            disabled={isTtsRunning || isDubbingRunning || ttsEngine === 'tiktok'}
            title={ttsEngine === 'tiktok' ? 'TikTok TTS chưa hỗ trợ chỉnh tốc độ' : 'Tốc độ đọc (0.5x - 2.0x)'}
            className="rounded-md border border-border bg-surface-2 px-3 py-1.5 text-xs text-text focus:outline-none disabled:opacity-50"
          >
            {SPEED_OPTIONS.map((s) => (
              <option key={s.value} value={s.value}>
                {s.label}
              </option>
            ))}
          </select>

          <button
            type="button"
            onClick={handlePreview}
            disabled={previewing || isTtsRunning || isDubbingRunning || fullPreviewing}
            title="Nghe thử giọng đang chọn"
            className="inline-flex items-center gap-1.5 rounded-md border border-accent/40 bg-accent-tint px-3 py-1.5 text-xs font-semibold text-accent transition hover:bg-accent-tint cursor-pointer disabled:cursor-not-allowed disabled:opacity-50"
          >
            {previewing ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <Play className="h-3.5 w-3.5" />
            )}
            <span>{previewing ? 'Đang tạo...' : 'Nghe thử'}</span>
          </button>

          <button
            type="button"
            onClick={toggleVoicePanel}
            disabled={!selectedTaskId || !hasSrtFile || isTtsRunning || isDubbingRunning}
            title="Gán giọng đọc riêng cho từng dòng phụ đề"
            className={[
              'inline-flex items-center gap-1.5 rounded-md border px-3 py-1.5 text-xs font-semibold transition cursor-pointer disabled:cursor-not-allowed disabled:opacity-50',
              showVoicePanel || customVoiceCount > 0
                ? 'border-brand-rose/50 bg-brand-rose/10 text-brand-rose hover:bg-brand-rose/20'
                : 'border-border bg-surface-2 text-text hover:bg-surface-3',
            ].join(' ')}
          >
            <Users className="h-3.5 w-3.5" />
            <span>
              Gán giọng theo câu{customVoiceCount > 0 ? ` (${customVoiceCount})` : ''}
            </span>
          </button>

          {message && (
            <span
              className={`max-w-[340px] truncate text-xs font-mono ${isError ? 'text-rose-400' : 'text-accent'}`}
              title={message}
            >
              {message}
            </span>
          )}
        </div>

        <div className="flex items-center gap-2">
          {isTtsRunning && (
            <button
              type="button"
              onClick={handleCancelTTS}
              title="Huỷ tạo lồng tiếng — dừng sau câu hiện tại"
              className="inline-flex items-center gap-2 rounded-md border border-rose-500/40 bg-rose-500/10 px-4 py-2 text-xs font-semibold text-rose-400 hover:bg-rose-500/20 cursor-pointer"
            >
              <XCircle className="h-4 w-4" />
              <span>Huỷ</span>
            </button>
          )}
          <button
            type="button"
            onClick={handleStartTTS}
            disabled={!selectedTaskId || !hasSrtFile || isTtsRunning || isDubbingRunning}
            className="bg-accent text-white hover:bg-accent-hover inline-flex items-center gap-2 rounded-md px-4 py-2 text-xs font-semibold cursor-pointer disabled:opacity-50"
          >
            {isTtsRunning ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Volume2 className="h-4 w-4" />
            )}
            <span>{isTtsRunning ? 'Đang tạo audio...' : 'Tạo audio lồng tiếng'}</span>
          </button>
        </div>
      </div>

      {selectedTask?.ttsNeedsRegeneration && (
        <p className="rounded-lg border border-amber-500/30 p-3 text-xs text-amber-400">
          Phụ đề hoặc audio đã thay đổi. Hãy tạo lại audio trước khi ghép lồng tiếng hoặc xuất MP3.
        </p>
      )}

      {/* Bảng gán giọng theo từng dòng phụ đề */}
      {showVoicePanel && selectedTaskId && (
        <div className="flex flex-col overflow-hidden rounded-lg border border-border bg-surface">
          <div className="flex items-center justify-between border-b border-border px-4 py-2.5">
            <div className="flex items-center gap-2 text-xs font-semibold text-text">
              <Users className="h-3.5 w-3.5 text-brand-rose" />
              <span>
                Gán giọng theo câu ({srtLines.length} dòng
                {customVoiceCount > 0 ? ` · ${customVoiceCount} dòng giọng riêng` : ''})
              </span>
            </div>
            <div className="flex items-center gap-2">
              {fullPreviewing ? (
                <>
                  <span className="font-mono text-[11px] text-accent">
                    Đang nghe: {fullPreviewLine}/{fullPreview.total || srtLines.length}
                  </span>
                  <button
                    type="button"
                    onClick={stopFullPreview}
                    title="Dừng nghe thử toàn bộ"
                    className="inline-flex items-center gap-1.5 rounded-lg border border-rose-500/50 bg-rose-500/10 px-2.5 py-1 text-[11px] font-semibold text-rose-400 hover:bg-rose-500/20 cursor-pointer"
                  >
                    <X className="h-3 w-3" />
                    <span>Dừng</span>
                  </button>
                </>
              ) : (
                <button
                  type="button"
                  onClick={() => startFullPreview(1)}
                  disabled={srtLines.length === 0 || linePreviewing !== null}
                  title="Phát liên tiếp toàn bộ phụ đề để nghe 1 mạch giọng đọc của video"
                  className="inline-flex items-center gap-1.5 rounded-lg border border-accent/40 bg-accent-tint px-2.5 py-1 text-[11px] font-semibold text-accent hover:bg-accent-tint cursor-pointer disabled:cursor-not-allowed disabled:opacity-40"
                >
                  <Headphones className="h-3 w-3" />
                  <span>Nghe toàn bộ (1 mạch)</span>
                </button>
              )}
              {detectedSpeakers.length > 0 && (
                <button
                  type="button"
                  onClick={handleOpenSpeakerModal}
                  title="Gán giọng hàng loạt cho tất cả câu của từng nhân vật"
                  className="inline-flex items-center gap-1.5 rounded-lg border border-accent/40 bg-accent-tint px-2.5 py-1 text-[11px] font-semibold text-accent hover:bg-accent/35 cursor-pointer transition-all"
                >
                  <Users className="h-3 w-3 text-accent" />
                  <span>Phân vai nhân vật ({detectedSpeakers.length})</span>
                </button>
              )}
              {customVoiceCount > 0 && (
                <button
                  type="button"
                  onClick={() => setVoiceOverrides({})}
                  className="rounded-lg border border-border bg-surface-2 px-2.5 py-1 text-[11px] font-medium text-text hover:bg-surface-3 cursor-pointer"
                >
                  Về giọng chung tất cả
                </button>
              )}
              <button
                type="button"
                onClick={() => setShowVoicePanel(false)}
                title="Đóng bảng gán giọng"
                className="flex h-6 w-6 items-center justify-center rounded-lg border border-border bg-surface-2 text-text-muted hover:bg-surface-3 hover:text-text cursor-pointer"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            </div>
          </div>

          {fullPreviewing && (
            <div className="h-1 w-full overflow-hidden bg-surface-2">
              <div
                className="h-full bg-accent transition-all duration-300"
                style={{ width: `${((fullPreviewLine || 0) / Math.max(fullPreview.total || srtLines.length, 1)) * 100}%` }}
              />
            </div>
          )}

          {/* Chiều cao cố định: video dọc (9:16) không đẩy tràn panel làm
              khuyết phần giao diện phía dưới; danh sách dòng tự cuộn trong khung */}
          <div className="flex h-[min(420px,50vh)] gap-3 overflow-hidden p-3">
            {panelVideoSrc && (
              <div className="flex w-[300px] shrink-0 flex-col gap-2 overflow-hidden">
                <video
                  ref={panelVideoRef}
                  src={panelVideoSrc}
                  controls
                  onTimeUpdate={handlePanelVideoTime}
                  className="h-[min(260px,35vh)] w-full shrink-0 rounded-md border border-border bg-black object-contain"
                />
                <p className="text-[10px] leading-relaxed text-text-muted">
                  Bấm vào một dòng bên phải để video nhảy tới đúng câu đó — đối chiếu xem
                  câu đang nói là của nhân vật nào rồi gán giọng.
                </p>
              </div>
            )}
            <div className="min-w-0 flex-1 space-y-1.5 overflow-y-auto">
            {srtLines.length === 0 ? (
              <div className="py-6 text-center text-xs text-text-muted">
                Đang tải danh sách dòng phụ đề...
              </div>
            ) : (
              srtLines.map((line, i) => {
                const lineNumber = i + 1; // trùng số dòng SRT mà ttsEngine dùng
                const lineVoice = voiceOverrides[String(lineNumber)] || '';
                // Đang nghe 1 mạch: highlight theo dòng audio preview — không trộn
                // với panelActiveLine (đồng hồ video) vì 2 đồng hồ chạy lệch nhau
                const isActive = fullPreviewing
                  ? fullPreviewLine === lineNumber
                  : panelActiveLine === lineNumber;
                return (
                  <div
                    key={line.id}
                    id={`voice-line-${lineNumber}`}
                    className={[
                      'flex items-center gap-2 rounded-md border p-2 text-xs',
                      isActive
                        ? 'border-accent/40 bg-accent-tint'
                        : lineVoice
                          ? 'border-brand-rose/40 bg-brand-rose/5'
                          : 'border-border bg-surface',
                    ].join(' ')}
                  >
                    <span className="w-8 shrink-0 rounded-md bg-surface-2 px-1.5 py-0.5 text-center font-mono text-[10px] font-bold text-accent">
                      {lineNumber}
                    </span>
                    {line.speaker && (
                      <span
                        className="shrink-0 rounded-md border border-accent/40 bg-accent-tint px-1.5 py-0.5 font-mono text-[9px] font-bold text-accent"
                        title={`Nhân vật: ${line.speaker}`}
                      >
                        {line.speaker}
                      </span>
                    )}
                    <p
                      className={[
                        'min-w-0 flex-1 truncate text-text',
                        panelVideoSrc ? 'cursor-pointer hover:text-white' : '',
                      ].join(' ')}
                      title={panelVideoSrc ? 'Bấm để video nhảy tới câu này' : line.text}
                      onClick={() => panelVideoSrc && seekVideoToLine(line)}
                    >
                      {line.text}
                    </p>
                    <select
                      value={lineVoice}
                      onChange={(e) => setLineVoice(lineNumber, e.target.value)}
                      disabled={isTtsRunning || isDubbingRunning}
                      className={[
                        'w-36 shrink-0 rounded-lg border px-2 py-1 text-[11px] focus:outline-none disabled:opacity-50',
                        lineVoice
                          ? 'border-brand-rose/50 bg-surface-2 text-brand-rose'
                          : 'border-border bg-surface-2 text-text',
                      ].join(' ')}
                    >
                      <option value="">Mặc định ({currentVoiceLabel(voice)})</option>
                      {voiceChoices.map((v) => (
                        <option key={v.value} value={v.value}>
                          {v.label}
                        </option>
                      ))}
                    </select>
                    <button
                      type="button"
                      onClick={() => handlePreviewLine(lineNumber, line.text, lineVoice)}
                      disabled={linePreviewing !== null || fullPreviewing}
                      title="Nghe thử dòng này với giọng đã chọn"
                      className="flex h-6 w-6 shrink-0 items-center justify-center rounded-lg border border-accent/40 bg-accent-tint text-accent hover:bg-accent/25 cursor-pointer disabled:cursor-not-allowed disabled:opacity-40"
                    >
                      {linePreviewing === lineNumber ? (
                        <Loader2 className="h-3 w-3 animate-spin" />
                      ) : (
                        <Play className="h-3 w-3" />
                      )}
                    </button>
                    {selectedTask?.ttsAudioDir && (
                      <button
                        type="button"
                        onClick={() => handleRegenerateLine(lineNumber)}
                        disabled={regeneratingLine !== null || isTtsRunning || isDubbingRunning}
                        title="Tạo lại audio dòng này với text hiện tại (sau khi sửa text ở Hiệu đính)"
                        className="flex h-6 w-6 shrink-0 items-center justify-center rounded-lg border border-border bg-surface-2 text-text hover:border-accent/40 hover:text-accent cursor-pointer disabled:cursor-not-allowed disabled:opacity-40"
                      >
                        {regeneratingLine === lineNumber ? (
                          <Loader2 className="h-3 w-3 animate-spin" />
                        ) : (
                          <RefreshCw className="h-3 w-3" />
                        )}
                      </button>
                    )}
                  </div>
                );
              })
            )}
            </div>
          </div>
          <p className="border-t border-border px-4 py-2 text-[11px] text-text-muted">
            Dòng để "Mặc định" sẽ dùng giọng chung đã chọn ở thanh công cụ. Bấm
            "Tạo audio lồng tiếng" để áp dụng.
          </p>
        </div>
      )}

      {/* Tiến trình khi đang xử lý */}
      {activeProgress && (
        <div className="rounded-lg border border-accent/40 bg-accent-tint p-4">
          <div className="mb-2 flex items-center justify-between text-xs">
            <span className="font-medium text-accent">{stageText}</span>
            <span className="font-mono text-text">{selectedTask?.progress}%</span>
          </div>
          <div className="h-1.5 overflow-hidden rounded-full bg-surface-2">
            <div
              className="h-full rounded-full bg-accent transition-all duration-300"
              style={{ width: `${selectedTask?.progress}%` }}
            />
          </div>
        </div>
      )}

      {/* Nội dung chính */}
      {!selectedTaskId ? (
        <div className="flex flex-1 flex-col items-center justify-center rounded-lg border border-dashed border-border bg-surface p-12 text-center text-text-muted text-xs">
          <Headphones className="h-10 w-10 text-text-faint mb-3 animate-pulse" />
          <span>Chọn một tác vụ đã có phụ đề .srt ở menu phía trên để tạo lồng tiếng bằng Local TTS, Edge TTS hoặc TikTok TTS.</span>
        </div>
      ) : !hasSrtFile ? (
        <div className="flex flex-1 flex-col items-center justify-center rounded-lg border border-dashed border-border bg-surface p-12 text-center text-text-muted text-xs">
          <Headphones className="h-10 w-10 text-text-faint mb-3" />
          <span>Tác vụ này chưa có file .srt — hãy chạy phiên âm ở Trang chủ trước.</span>
        </div>
      ) : (
        <div className="flex flex-1 flex-col gap-4 overflow-y-auto rounded-lg border border-border bg-surface p-6">
          <div>
            <h3 className="text-xs font-bold uppercase tracking-wider text-text mb-3">Thông tin lồng tiếng</h3>
            <div className="space-y-2 text-xs text-text-muted">
              <div className="flex justify-between">
                <span>Tác vụ:</span>
                <span className="text-text">{selectedTask?.fileName}</span>
              </div>
              <div className="flex justify-between">
                <span>Phụ đề dùng để đọc:</span>
                <span className="text-text">
                  {selectedTask?.translatedSrtPath ? 'Bản dịch' : 'Bản gốc'}
                </span>
              </div>
              <div className="flex justify-between">
                <span>Giọng nói:</span>
                <span className="text-text">{currentVoiceLabel(voice)}</span>
              </div>
              <div className="flex justify-between">
                <span>Tốc độ:</span>
                <span className="text-text">{speedLabel(speed)}</span>
              </div>
            </div>
          </div>

          {/* File MP3 lồng tiếng tổng hợp cho dự án đã chọn */}
          {(selectedTask?.ttsMergedAudioPath || hasTtsAudio) && (
            <div className="rounded-lg border border-accent/40 bg-surface-2 p-4">
              <div className="flex flex-wrap items-center justify-between gap-3 border-b border-accent/40 pb-3">
                <div className="flex items-center gap-2.5">
                  <div className="flex h-9 w-9 items-center justify-center rounded-md bg-accent/20 text-accent border border-accent/40">
                    <FileAudio className="h-5 w-5" />
                  </div>
                  <div>
                    <div className="flex items-center gap-2">
                      <span className="text-xs font-bold text-white">
                        File MP3 Lồng Tiếng Tổng Hợp Dự Án
                      </span>
                      <span className="rounded-full bg-accent/20 px-2 py-0.5 text-[10px] font-semibold text-accent border border-accent/40">
                        Chuẩn timeline 100%
                      </span>
                    </div>
                    <p className="mt-0.5 font-mono text-[11px] text-text-muted truncate max-w-[420px]">
                      {selectedTask?.ttsMergedAudioPath
                        ? selectedTask.ttsMergedAudioPath.split(/[/\\]/).pop()
                        : `${selectedTask?.fileName.replace(/\.[^/.]+$/, '')}_voice.mp3`}
                    </p>
                  </div>
                </div>

                <div className="flex items-center gap-2">
                  {selectedTask?.ttsMergedAudioPath && (
                    <button
                      type="button"
                      onClick={handleOpenMergedFolder}
                      className="inline-flex items-center gap-1.5 rounded-md border border-border bg-surface-2 px-3 py-1.5 text-xs font-medium text-text hover:bg-surface-3 hover:text-white cursor-pointer transition"
                      title="Mở thư mục chứa file MP3 tổng hợp"
                    >
                      <FolderOpen className="h-3.5 w-3.5 text-amber-400" />
                      <span>Mở thư mục</span>
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={handleExportMergedMp3}
                    disabled={isExportingMp3 || isTtsRunning}
                    className="inline-flex items-center gap-1.5 rounded-md border border-accent/40 bg-accent/10 px-3 py-1.5 text-xs font-semibold text-accent hover:bg-accent/20 cursor-pointer disabled:opacity-50 transition"
                    title="Tổng hợp lại toàn bộ các câu thành 1 file MP3 duy nhất theo timeline"
                  >
                    {isExportingMp3 ? (
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    ) : (
                      <RefreshCw className="h-3.5 w-3.5" />
                    )}
                    <span>{isExportingMp3 ? 'Đang tổng hợp...' : 'Tổng hợp lại MP3'}</span>
                  </button>
                  <button
                    type="button"
                    onClick={handleSaveMergedMp3To}
                    disabled={isExportingMp3 || !selectedTask?.ttsMergedAudioPath}
                    className="inline-flex items-center gap-1.5 rounded-md border border-border bg-surface-2 px-3 py-1.5 text-xs font-medium text-text hover:bg-surface-3 hover:text-white cursor-pointer disabled:opacity-50 transition"
                    title="Lưu file MP3 ra thư mục khác tuỳ chọn"
                  >
                    <Download className="h-3.5 w-3.5 text-accent" />
                    <span>Lưu ra thư mục khác...</span>
                  </button>
                </div>
              </div>

              {/* Trình phát Audio Player cho file MP3 tổng hợp */}
              {selectedTask?.ttsMergedAudioPath ? (
                <div className="mt-3 flex items-center gap-3 rounded-md bg-surface px-3.5 py-2.5 border border-border">
                  <audio
                    ref={mergedAudioRef}
                    src={`vanhmedia://local/${encodeURIComponent(selectedTask.ttsMergedAudioPath)}`}
                    onTimeUpdate={() => {
                      if (mergedAudioRef.current) {
                        setMergedCurrentTime(mergedAudioRef.current.currentTime);
                      }
                    }}
                    onLoadedMetadata={() => {
                      if (mergedAudioRef.current) {
                        setMergedDuration(mergedAudioRef.current.duration);
                      }
                    }}
                    onEnded={() => setIsMergedPlaying(false)}
                    onError={() => setIsMergedPlaying(false)}
                  />
                  <button
                    type="button"
                    onClick={handleTogglePlayMerged}
                    className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-accent text-slate-950 hover:bg-cyan-400 transition cursor-pointer"
                    title={isMergedPlaying ? 'Tạm dừng nghe' : 'Nghe thử file MP3 tổng hợp'}
                  >
                    {isMergedPlaying ? (
                      <Pause className="h-4 w-4" />
                    ) : (
                      <Play className="h-4 w-4 ml-0.5" />
                    )}
                  </button>

                  <div className="flex-1 space-y-1">
                    <div className="flex justify-between text-[11px] font-mono text-text-muted">
                      <span>{formatSeconds(mergedCurrentTime)}</span>
                      <span>{formatSeconds(mergedDuration)}</span>
                    </div>
                    <input
                      type="range"
                      min={0}
                      max={mergedDuration || 100}
                      step={0.1}
                      value={mergedCurrentTime}
                      onChange={(e) => {
                        const val = Number(e.target.value);
                        setMergedCurrentTime(val);
                        if (mergedAudioRef.current) {
                          mergedAudioRef.current.currentTime = val;
                        }
                      }}
                      className="h-1.5 w-full cursor-pointer appearance-none rounded-lg bg-surface-2 accent-accent"
                    />
                  </div>
                </div>
              ) : (
                <div className="mt-2.5 flex items-center justify-between text-xs text-text-muted">
                  <span>File MP3 tổng hợp chưa được tạo. Bấm "Tổng hợp lại MP3" để tạo ngay.</span>
                </div>
              )}
            </div>
          )}

          {/* Bước 2: sau khi TTS xong → ghép vào video */}
          {hasTtsAudio && (
            <div className="rounded-lg border border-emerald-500/30 bg-emerald-500/10 p-4">
              <div className="flex items-center gap-2 text-xs font-semibold text-emerald-300">
                <CheckCircle2 className="h-4 w-4 text-emerald-400" />
                <span>Đã tạo xong audio lồng tiếng cho từng dòng phụ đề.</span>
              </div>

              {!dubbedOutput && !isDubbingRunning && (
                <div className="mt-3 space-y-3">
                  <label className="flex items-center gap-2 text-xs text-text cursor-pointer">
                    <input
                      type="checkbox"
                      checked={replaceAudio}
                      onChange={(e) => setReplaceAudio(e.target.checked)}
                      className="h-4 w-4 rounded border-border bg-surface-2 text-accent focus:ring-0"
                    />
                    <span>
                      Thay thế toàn bộ âm thanh gốc (bỏ tick để giữ audio gốc thành track song ngữ)
                    </span>
                  </label>

                  {replaceAudio && (
                    <>
                    <label className="flex items-center gap-2 text-xs text-text cursor-pointer">
                      <input
                        type="checkbox"
                        checked={mixOriginalAudio}
                        onChange={(e) => setMixOriginalAudio(e.target.checked)}
                        className="h-4 w-4 rounded border-border bg-surface-2 text-accent focus:ring-0"
                      />
                      <span>
                        Giữ nhạc nền / hiệu ứng âm thanh gốc, mix nhỏ (22%) dưới lời thoại lồng tiếng
                      </span>
                    </label>

                    <label className="flex items-start gap-2 text-xs font-medium text-text cursor-pointer">
                      <input
                        type="checkbox"
                        checked={vocalSeparation}
                        onChange={(e) => setVocalSeparation(e.target.checked)}
                        disabled={isTtsRunning || isDubbingRunning}
                        className="mt-0.5 h-4 w-4 rounded border-border bg-surface-2 text-accent focus:ring-0"
                      />
                      <span>
                        <span className="font-semibold text-white">Tách lời thoại bằng AI (kiểu CapCut)</span>{' '}
                        — loại hẳn giọng người gốc, giữ nguyên nhạc nền/SFX ở mức bình thường.
                        <span className="block text-[11px] font-normal text-text-muted">
                          Demucs chạy trên CPU, thời gian xử lý xấp xỉ thời lượng video. Lần đầu cần{' '}
                          <code className="font-mono">python -m pip install demucs</code> + tải model ~80MB.
                        </span>
                      </span>
                    </label>
                    </>
                  )}

                  <div>
                    <label className="mb-1.5 block text-xs font-medium text-text">
                      Chế độ đồng bộ khi câu thoại dài hơn khung phụ đề:
                    </label>
                    <select
                      value={syncMode}
                      onChange={(e) =>
                        setSyncMode(
                          e.target.value === 'flexible'
                            ? 'flexible'
                            : e.target.value === 'video-stretch'
                              ? 'video-stretch'
                              : 'strict'
                        )
                      }
                      disabled={isTtsRunning || isDubbingRunning}
                      className="w-full rounded-md border border-border bg-surface-2 px-3 py-2 text-xs text-white focus:outline-none disabled:opacity-50"
                    >
                      <option value="strict">Chặt — nén audio theo timeline phụ đề (mặc định)</option>
                      <option value="video-stretch">Kéo giãn video — giãn video tối đa 1.25x để vừa audio</option>
                    </select>
                  </div>

                  <button
                    type="button"
                    onClick={handleStartDubbing}
                    disabled={startingDubbing || isDubbingRunning || isTtsRunning || !hasTtsAudio}
                    className="bg-accent text-white hover:bg-accent-hover inline-flex items-center gap-2 rounded-md px-4 py-2 text-xs font-semibold cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    {startingDubbing || isDubbingRunning ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      <Mic className="h-4 w-4" />
                    )}
                    <span>{isDubbingRunning ? 'Đang ghép video...' : 'Ghép audio vào video (Dubbing)'}</span>
                  </button>
                  <p className="text-[11px] text-text-muted">
                    Audio được ghép đúng theo timeline phụ đề: câu ngắn hơn sẽ được lấp im lặng,
                    câu tràn thời lượng xử lý theo chế độ đồng bộ đã chọn ở trên.
                  </p>
                </div>
              )}
            </div>
          )}

          {/* Kết quả dubbing */}
          {dubbedOutput && !isDubbingRunning && (
            <div className="rounded-lg border border-accent/40 bg-accent-tint p-4">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="text-xs">
                  <div className="flex items-center gap-2 font-semibold text-accent">
                    <CheckCircle2 className="h-4 w-4" />
                    <span>Video lồng tiếng đã sẵn sàng</span>
                  </div>
                  <div className="mt-1 font-mono text-[11px] text-text">
                    {dubbedOutput.split(/[/\\]/).pop()}
                  </div>
                </div>
                <button
                  type="button"
                  onClick={handleOpenOutputFolder}
                  className="inline-flex items-center gap-2 rounded-md border border-accent/40 bg-surface px-3 py-2 text-xs font-medium text-accent hover:bg-surface-2 cursor-pointer"
                >
                  <FolderOpen className="h-3.5 w-3.5" />
                  <span>Mở thư mục chứa file</span>
                </button>
              </div>
            </div>
          )}

          {/* Báo cáo câu tràn thời lượng (cập nhật sau mỗi lần dubbing) */}
          {(selectedTask?.ttsOverruns?.length ?? 0) > 0 && !isDubbingRunning && (
            <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 p-4">
              <div className="mb-2 flex items-center gap-2 text-xs font-semibold text-amber-300">
                <AlertTriangle className="h-4 w-4 text-amber-400" />
                <span>
                  {selectedTask!.ttsOverruns!.length} câu tràn thời lượng đã được tăng tốc để vừa khung
                </span>
              </div>
              <div className="max-h-28 space-y-1 overflow-y-auto">
                {selectedTask!.ttsOverruns!.map((o) => (
                  <div key={o.index} className="flex items-center gap-2 text-[11px] text-text">
                    <span className="w-8 shrink-0 rounded bg-surface-2 px-1.5 py-0.5 text-center font-mono text-accent">
                      {o.index}
                    </span>
                    <span>tăng tốc {o.tempo.toFixed(2)}x</span>
                    {o.truncated && (
                      <span className="font-medium text-rose-400">
                        — tràn quá 1.5x, phần cuối bị cắt: nên rút gọn text rồi tạo lại audio
                      </span>
                    )}
                  </div>
                ))}
              </div>
              <p className="mt-2 text-[11px] text-text-muted">
                Sửa text ở tab Hiệu đính, dùng nút "Tạo lại" trên dòng tương ứng ở bảng gán giọng,
                rồi ghép lại video.
              </p>
            </div>
          )}

          {/* Trạng thái lỗi của pipeline */}
          {selectedTask?.status === 'error' && selectedTask.errorMessage && (
            <div className="rounded-lg border border-rose-500/30 bg-rose-500/10 p-4">
              <div className="flex items-start gap-2 text-xs text-rose-300">
                <XCircle className="h-4 w-4 text-rose-400 mt-0.5 flex-shrink-0" />
                <span>{selectedTask.errorMessage}</span>
              </div>
            </div>
          )}

          {/* Gợi ý khi chưa làm gì */}
          {!hasTtsAudio && !isTtsRunning && (
            <div className="flex-1 rounded-lg border border-border bg-surface p-4 flex items-center justify-center text-text-muted text-xs">
              <p>
                Bấm <strong className="text-text">"Nghe thử"</strong> để chọn giọng ưng ý, rồi bấm{' '}
                <strong className="text-text">"Tạo audio lồng tiếng"</strong> để bắt đầu xử lý...
              </p>
            </div>
          )}
        </div>
      )}

      {/* Modal gán giọng nhanh theo nhân vật (Speaker Diarization) */}
      {showSpeakerMappingModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 p-4 animate-in fade-in duration-200">
          <div className="flex w-full max-w-lg flex-col overflow-hidden rounded-lg border border-border bg-surface /80">
            {/* Modal Header */}
            <div className="flex items-center justify-between border-b border-border px-5 py-4 bg-surface">
              <div className="flex items-center gap-2.5">
                <div className="flex h-8 w-8 items-center justify-center rounded-md bg-accent-tint text-accent border border-accent/40">
                  <Users className="h-4 w-4" />
                </div>
                <div>
                  <h3 className="text-sm font-bold text-white flex items-center gap-2">
                    Gán giọng theo nhân vật
                    <span className="rounded-full bg-accent-tint px-2 py-0.5 text-[10px] text-accent font-semibold">
                      Diarization
                    </span>
                  </h3>
                  <p className="text-[11px] text-text-muted">
                    Tự động gán giọng cho toàn bộ câu thoại của từng nhân vật trong phụ đề
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setShowSpeakerMappingModal(false)}
                className="rounded-lg p-1.5 text-text-muted hover:bg-surface-2 hover:text-white transition-colors cursor-pointer"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            {/* Modal Body */}
            <div className="max-h-[60vh] overflow-y-auto p-5 space-y-3.5">
              <div className="rounded-md border border-accent/40 bg-accent/5 p-3 text-[11px] text-text flex items-start gap-2">
                <Sparkles className="h-4 w-4 text-accent shrink-0 mt-0.5" />
                <span>
                  Phát hiện <b className="text-accent">{detectedSpeakers.length} nhân vật</b> trong video. Bạn chỉ cần chọn giọng đọc tương ứng dưới đây, hệ thống sẽ áp dụng đồng loạt cho tất cả các câu thoại tương ứng.
                </span>
              </div>

              <div className="space-y-2.5">
                {detectedSpeakers.map((sp) => {
                  const currentSelected = speakerVoiceMap[sp.name] || '';
                  return (
                    <div
                      key={sp.name}
                      className="flex items-center justify-between gap-3 rounded-md border border-border bg-bg p-3 hover:border-border transition-colors"
                    >
                      <div className="min-w-0">
                        <div className="flex items-center gap-2">
                          <span className="font-mono text-xs font-bold text-accent px-2 py-0.5 rounded bg-accent-tint border border-accent/40">
                            {sp.name}
                          </span>
                          <span className="text-[11px] text-text-muted">
                            ({sp.count} câu · {Math.round((sp.count / Math.max(1, srtLines.length)) * 100)}%)
                          </span>
                        </div>
                      </div>

                      <select
                        value={currentSelected}
                        onChange={(e) =>
                          setSpeakerVoiceMap((prev) => ({
                            ...prev,
                            [sp.name]: e.target.value,
                          }))
                        }
                        className="w-56 shrink-0 rounded-lg border border-border bg-surface-2 px-2.5 py-1.5 text-xs text-text focus:border-accent/40 focus:outline-none"
                      >
                        <option value="">Giọng mặc định ({currentVoiceLabel(voice)})</option>
                        {voiceChoices.map((v) => (
                          <option key={v.value} value={v.value}>
                            {v.label}
                          </option>
                        ))}
                      </select>
                    </div>
                  );
                })}
              </div>
            </div>

            {/* Modal Footer */}
            <div className="flex items-center justify-end gap-2.5 border-t border-border bg-bg px-5 py-3.5">
              <button
                type="button"
                onClick={() => setShowSpeakerMappingModal(false)}
                className="rounded-md border border-border bg-surface-2 px-3.5 py-1.5 text-xs font-medium text-text hover:bg-surface-3 hover:text-white transition-colors cursor-pointer"
              >
                Hủy
              </button>
              <button
                type="button"
                onClick={handleApplySpeakerMapping}
                className="bg-accent text-white hover:bg-accent-hover inline-flex items-center gap-2 rounded-md px-4 py-1.5 text-xs font-semibold text-white cursor-pointer"
              >
                <CheckCircle2 className="h-4 w-4" />
                <span>Áp dụng cho tất cả câu thoại</span>
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
