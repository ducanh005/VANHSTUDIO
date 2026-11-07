import React, { useState, useEffect, useRef } from 'react';
import {
  Lightbulb,
  Play,
  Square,
  User,
  Image as ImageIcon,
  Copy,
  AlertTriangle,
  Trash2,
} from 'lucide-react';
import { useAiStudioStore } from '../../lib/store/aiStudioStore';
import type {
  PipelineSessionState,
  PipelineProgressEvent,
  IdeaBlueprint,
  StoryboardScene,
} from '../../types/aiStudio';
import IdeaGenerationModal from './IdeaGenerationModal';
import ChannelConfigModal from './ChannelConfigModal';
import ScriptWorkspaceView from './ScriptWorkspaceView';
import SelfTestDiagnosticsModal from './SelfTestDiagnosticsModal';
import ChromeBridgeModal from './ChromeBridgeModal';

// Modular Subcomponents from ./autopilot/
import {
  AutoPilotHeader,
  PipelineTrackerPanel,
  IdeaListPanel,
  CharacterStudioPanel,
  StoryboardGridPanel,
  MediaLightboxModal,
  AdvancedInfrastructureDrawer,
  STYLE_PRESETS,
  toMediaUrl,
} from './autopilot';

export { toMediaUrl, STYLE_PRESETS };

interface AutoPilotViewProps {
  onSwitchProject?: () => void;
}

export default function AutoPilotView({ onSwitchProject }: AutoPilotViewProps = {}) {
  const {
    config,
    updateChannelProfileConfig,
    getActiveProject,
    saveActiveProjectData,
    switchProject,
    isProjectSetupComplete,
  } = useAiStudioStore();

  const [topic, setTopic] = useState('');
  const [session, setSession] = useState<PipelineSessionState | null>(null);
  const [isRunning, setIsRunning] = useState(false);
  const startInFlight = useRef(false);
  const [isApproving, setIsApproving] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [readinessWarning, setReadinessWarning] = useState<string | null>(null);
  const [errorCode, setErrorCode] = useState<string | null>(null);
  const [isDiagnosticsModalOpen, setIsDiagnosticsModalOpen] = useState(false);
  const [isChromeBridgeModalOpen, setIsChromeBridgeModalOpen] = useState(false);
  const [isAdvancedDrawerOpen, setIsAdvancedDrawerOpen] = useState(false);
  const [countdownSeconds, setCountdownSeconds] = useState<number | null>(null);
  const [isGatedMode, setIsGatedMode] = useState(true);
  const [manualBusy, setManualBusy] = useState(false);
  const [manualSeo,setManualSeo]=useState({title:'',description:'',hashtags:''});
  const [mediaCheck,setMediaCheck]=useState('');
  const [mediaChecking,setMediaChecking]=useState(false);
  useEffect(()=>{
    if(session?.manualMode)setManualSeo({title:session.artifacts.metadata?.title||'',description:session.artifacts.metadata?.description||'',hashtags:session.artifacts.metadata?.hashtags?.join(' ')||''});
  },[session?.sessionId]);
  const handleSaveManualSeo=async()=>{
    if(!session?.manualMode||manualBusy||!window.vanhsub.aiStudio.saveManualSeo)return;
    const id=session.sessionId,projectId=getActiveProject()?.id;
    setManualBusy(true);setErrorMessage(null);
    try{
      const result=await window.vanhsub.aiStudio.saveManualSeo({sessionId:id,title:manualSeo.title,description:manualSeo.description,hashtags:manualSeo.hashtags.split(/[\s,]+/).filter(Boolean)});
      if(getActiveProject()?.id!==projectId)return;
      setSession(result.session);await saveActiveProjectData({lastSessionId:id,savedSession:result.session});
    }catch(error:any){setErrorMessage(error?.message||'Không lưu được SEO thủ công.');}
    finally{setManualBusy(false);}
  };
  const handleStartManual = async () => {
    const project = getActiveProject();
    if (!project || manualBusy || isRunning) return;
    setErrorMessage(null);
    setErrorCode(null); setReadinessWarning(null);
    setManualBusy(true);
    try {
      const srtPath = await window.vanhsub.dialog.openSrtFile();
      if (!srtPath) return;
      const audioPath = await window.vanhsub.dialog.openAudioFile();
      if (!audioPath) return;
      const result = await window.vanhsub.aiStudio.startManualMedia({ projectId: project.id, srtPath, audioPath });
      const state = await window.vanhsub.aiStudio.getPipelineState({ sessionId: result.sessionId });
      if (getActiveProject()?.id !== project.id) return;
      setSession(state); setActiveTab('video'); setCenterTab('visual');
      await saveActiveProjectData({ lastSessionId: result.sessionId, savedSession: state });
    } catch (error: any) { setErrorMessage(error?.message || 'Không nhập được SRT/audio.'); }
    finally { setManualBusy(false); }
  };
  const handleRenderManual = async () => {
    if (!session?.manualMode || manualBusy || isRunning) return;
    const projectId = getActiveProject()?.id, sessionId = session.sessionId;
    setErrorMessage(null);
    setErrorCode(null);
    setManualBusy(true); setIsRunning(true);
    try {
      await window.vanhsub.aiStudio.renderVideo({ sessionId });
      if (getActiveProject()?.id !== projectId) return;
      const state = await window.vanhsub.aiStudio.getPipelineState({ sessionId });
      setSession(state); await saveActiveProjectData({ lastSessionId: sessionId, savedSession: state });
    } catch (error: any) { setErrorMessage(error?.message || 'Xuất video thủ công thất bại.'); }
    finally { setManualBusy(false); setIsRunning(false); }
  };
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [isChannelModalOpen, setIsChannelModalOpen] = useState(false);
  const [isConfirmCancelOpen, setIsConfirmCancelOpen] = useState(false);
  const [conflictWarningModal, setConflictWarningModal] = useState<{
    pendingBlueprint: IdeaBlueprint;
  } | null>(null);
  const [setupWarningToast, setSetupWarningToast] = useState<string | null>(null);

  const activeProj = getActiveProject();
  const setupCheck = isProjectSetupComplete(activeProj);

  const handleOpenIdeaModal = () => {
    if (!setupCheck.isComplete) {
      const msg = `⚠️ Dự án chưa hoàn tất thiết lập cơ bản: Thiếu ${setupCheck.missing.join(', ')}. Vui lòng cập nhật thiết lập dự án trước khi sinh ý tưởng!`;
      setSetupWarningToast(msg);
      setTimeout(() => setSetupWarningToast(null), 6000);
      return;
    }
    setSetupWarningToast(null);
    setIsModalOpen(true);
  };

  // 3-Column Studio States
  const [activeTab, setActiveTab] = useState<'video' | 'facebook'>('video');
  const [selectedFormat, setSelectedFormat] = useState<'16:9' | '9:16'>('16:9');
  const [ideas, setIdeas] = useState<IdeaBlueprint[]>([]);
  const [selectedIdea, setSelectedIdea] = useState<IdeaBlueprint | null>(null);
  const [centerTab, setCenterTab] = useState<'script' | 'visual' | 'character'>('script');

  // Preview Media Modal State
  const [previewMedia, setPreviewMedia] = useState<{
    type: 'image' | 'video';
    url: string;
    shotId?: string;
    narration?: string;
    prompt?: string;
    durationMs?: number;
  } | null>(null);

  // Host & Character States
  const [newCharName, setNewCharName] = useState('');
  const [newCharDesc, setNewCharDesc] = useState('');
  const [hostToast, setHostToast] = useState<string | null>(null);
  const [copiedIdeaThumbPrompt, setCopiedIdeaThumbPrompt] = useState(false);
  const [isFlowWindowOpen, setIsFlowWindowOpen] = useState(false);
  const loadedProjectIdRef = useRef<string | null>(null);

  // Phím tắt ESC để đóng Lightbox Preview
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && previewMedia) {
        setPreviewMedia(null);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [previewMedia]);

  // Kiểm tra trạng thái hiển thị cửa sổ Google Flow live
  useEffect(() => {
    if (typeof window !== 'undefined' && window.vanhsub?.veo?.isLobbyDebug) {
      window.vanhsub.veo
        .isLobbyDebug()
        .then((open) => setIsFlowWindowOpen(!!open))
        .catch(() => {});
    }
  }, []);

  const handleToggleFlowLive = async () => {
    try {
      const activeProj = config?.savedProjects?.find((p: any) => p.id === config?.activeProjectId);
      let targetUrl = 'https://flow.google.com/';
      const rawUrl = activeProj?.flowProjectUrl?.trim();
      if (rawUrl) {
        if (rawUrl.startsWith('http://') || rawUrl.startsWith('https://')) {
          targetUrl = rawUrl;
        } else if (/^[a-zA-Z0-9_-]{8,}$/.test(rawUrl)) {
          targetUrl = `https://flow.google.com/project/${rawUrl}`;
        }
      }

      if (window.vanhsub?.veo?.openChrome) {
        const res = await window.vanhsub.veo.openChrome(targetUrl);
        if (res?.ok) return;
      }

      if (isFlowWindowOpen) {
        if (window.vanhsub?.veo?.hideLobbyOffscreen) {
          await window.vanhsub.veo.hideLobbyOffscreen();
          setIsFlowWindowOpen(false);
        }
      } else {
        if (window.vanhsub?.veo?.openLobby) {
          await window.vanhsub.veo.openLobby();
          setIsFlowWindowOpen(true);
        } else if (window.vanhsub?.veo?.showLobbyDebug) {
          await window.vanhsub.veo.showLobbyDebug();
          setIsFlowWindowOpen(true);
        }
      }
    } catch (err: any) {
      console.error('Lỗi khi bật/tắt cửa sổ Flow live:', err);
    }
  };

  const handleSelectCustomMediaDir = async () => {
    try {
      if (window.vanhsub?.dialog?.chooseDirectory) {
        const chosen = await window.vanhsub.dialog.chooseDirectory();
        if (chosen) {
          updateChannelProfileConfig({ customMediaDir: chosen });
        }
      }
    } catch (err) {
      console.error('Lỗi khi chọn thư mục lưu media:', err);
    }
  };

  const [regeneratingSceneId, setRegeneratingSceneId] = useState<string | null>(null);
  const [importingSceneId, setImportingSceneId] = useState<string | null>(null);
  const [sceneActionNotice, setSceneActionNotice] = useState<string | null>(null);
  const [selectedShotIds, setSelectedShotIds] = useState<string[]>([]);

  const toggleSelectShot = (shotId: string) => {
    setSelectedShotIds((prev) =>
      prev.includes(shotId) ? prev.filter((id) => id !== shotId) : [...prev, shotId]
    );
  };

  const handleSelectAllShots = (allIds: string[]) => {
    if (selectedShotIds.length === allIds.length) {
      setSelectedShotIds([]);
    } else {
      setSelectedShotIds(allIds);
    }
  };

  const showSceneNotice = (msg: string) => {
    setSceneActionNotice(msg);
    setTimeout(() => setSceneActionNotice(null), 4000);
  };

  const refreshSceneSession = async (sessionId: string, projectId: string | undefined) => {
    if (!window.vanhsub?.aiStudio?.getPipelineState) throw new Error('Không thể tải trạng thái phiên sau khi đổi media.');
    const updated = await window.vanhsub.aiStudio.getPipelineState({ sessionId });
    if (!updated) throw new Error('Không tìm thấy trạng thái phiên đã lưu.');
    if ((loadedProjectIdRef.current || undefined) === projectId) {
      setSession(current => current?.sessionId === sessionId ? updated : current);
    }
    await saveActiveProjectData({ savedSession: updated, lastSessionId: sessionId }, updated.ownerProjectId || projectId);
  };

  const handleRegenerateScene = async (
    scene: StoryboardScene,
    mode: 'image' | 'video' | 'both'
  ) => {
    if (!session?.sessionId || regeneratingSceneId) return;
    const targetSessionId = session.sessionId;
    const targetProjectId = loadedProjectIdRef.current || undefined;
    const targetId = scene.shotId || scene.id;
    setRegeneratingSceneId(targetId);
    const routeLabel=session.configSnapshot?.flowEngine.engine==='official_api'?'Official API':session.configSnapshot?.flowEngine.engine==='manual'?'Manual Import':'Legacy Flow';
    showSceneNotice(`Đang tạo lại ${mode === 'image' ? 'Ảnh AI' : mode === 'video' ? 'Video AI' : 'Media'} cho phân cảnh ${targetId} qua ${routeLabel}...`);

    try {
      if (window.vanhsub?.aiStudio?.regenerateSceneAsset) {
        const result = await window.vanhsub.aiStudio.regenerateSceneAsset({
          sessionId: targetSessionId,
          sceneId: targetId,
          visualPrompt: scene.visualPrompt,
          mode,
          flowConfig: {
            outputMode: mode === 'video' ? 'video' : 'image',
            aspectRatio: session.artifacts?.blueprint?.aspectRatio || '16:9',
          },
        });

        if (result && (result.assetPath || result.imagePath || result.videoPath)) {
          await refreshSceneSession(targetSessionId, targetProjectId);
          if ((loadedProjectIdRef.current || undefined) !== targetProjectId) return;
          showSceneNotice(`✓ Đã tạo lại thành công media cho ${targetId}!`);
          setErrorMessage(null);
          setErrorCode(null);
        } else if (result?.error) {
          showSceneNotice(`✗ Lỗi tạo lại: ${result.error}`);
          setErrorMessage(result.error);
          setErrorCode(result.errorCode || 'REGENERATE_FAILED');
        }
      }
    } catch (err: any) {
      if ((loadedProjectIdRef.current || undefined) !== targetProjectId) return;
      console.error('Lỗi khi tạo lại media phân cảnh:', err);
      const msg = err?.message || String(err);
      showSceneNotice(`✗ Lỗi: ${msg}`);
      setErrorMessage(msg);
      setErrorCode(err?.code || 'REGENERATE_FAILED');
    } finally {
      if ((loadedProjectIdRef.current || undefined) === targetProjectId) setRegeneratingSceneId(null);
    }
  };

  const handleImportManualMedia = async (
    scene: StoryboardScene,
    mediaType: 'image' | 'video'
  ) => {
    if (!session?.sessionId || importingSceneId) return;
    const targetSessionId = session.sessionId;
    const targetProjectId = loadedProjectIdRef.current || undefined;
    const targetId = scene.shotId || scene.id;
    setImportingSceneId(targetId);

    try {
      let chosenFilePath: string | null = null;
      if (mediaType === 'image' && window.vanhsub?.dialog?.openImageFile) {
        chosenFilePath = await window.vanhsub.dialog.openImageFile();
      } else if (mediaType === 'video' && window.vanhsub?.dialog?.openVideoFile) {
        chosenFilePath = await window.vanhsub.dialog.openVideoFile();
      }

      if (!chosenFilePath) {
        if ((loadedProjectIdRef.current || undefined) === targetProjectId) setImportingSceneId(null);
        return;
      }

      showSceneNotice(`Đang nạp tệp ${mediaType === 'image' ? 'ảnh' : 'video'} vào dự án...`);

      if (window.vanhsub?.aiStudio?.importSceneMedia) {
        const importRes = await window.vanhsub.aiStudio.importSceneMedia({
          sessionId: targetSessionId,
          sceneId: targetId,
          filePath: chosenFilePath,
          mediaType,
        });

        if (importRes && importRes.success) {
          await refreshSceneSession(targetSessionId, targetProjectId);
          if ((loadedProjectIdRef.current || undefined) !== targetProjectId) return;
          showSceneNotice(`✓ Đã nạp thành công tệp vào ${targetId}!`);
        } else {
          showSceneNotice(`✗ Lỗi nạp tệp: ${importRes?.error || 'Không rõ nguyên nhân'}`);
        }
      } else {
        throw new Error('Chức năng nhập media chưa sẵn sàng.');
      }
    } catch (err: any) {
      if ((loadedProjectIdRef.current || undefined) !== targetProjectId) return;
      console.error('Lỗi khi nạp tệp media thủ công:', err);
      showSceneNotice(`✗ Lỗi: ${err?.message || err}`);
    } finally {
      if ((loadedProjectIdRef.current || undefined) === targetProjectId) setImportingSceneId(null);
    }
  };

  const handleCopyIdeaThumbPrompt = (promptText: string) => {
    if (!promptText) return;
    navigator.clipboard.writeText(promptText);
    setCopiedIdeaThumbPrompt(true);
    setTimeout(() => setCopiedIdeaThumbPrompt(false), 2500);
  };

  // Nạp ý tưởng & kịch bản đã lưu của project khi mount hoặc khi chuyển project
  useEffect(() => {
    const activeProject = getActiveProject();
    if (!activeProject) return;

    if (loadedProjectIdRef.current !== activeProject.id) {
      loadedProjectIdRef.current = activeProject.id;

      setSession(null);
      setIsRunning(false);
      setErrorMessage(null);
      setRegeneratingSceneId(null);
      setImportingSceneId(null);
      setSceneActionNotice(null);
      setConflictWarningModal(null);

      const projIdeas = activeProject.ideas || [];
      setIdeas(projIdeas);

      const chosenIdea = activeProject.selectedIdea || projIdeas[0] || null;
      setSelectedIdea(chosenIdea);

      if (activeProject.flowConfig?.aspectRatio) {
        setSelectedFormat(activeProject.flowConfig.aspectRatio as '16:9' | '9:16');
      }

      const currentProjId = activeProject.id;
      if (activeProject.lastSessionId && window.vanhsub?.aiStudio?.getPipelineState) {
        window.vanhsub.aiStudio
          .getPipelineState({ sessionId: activeProject.lastSessionId })
          .then((persistedState) => {
            if (loadedProjectIdRef.current !== currentProjId) return;
            if (persistedState) {
              setSession(persistedState);
              setIsRunning(persistedState.jobActive === true);
              if (persistedState.error) setErrorMessage(persistedState.error);
              if (persistedState.artifacts?.blueprint) {
                setSelectedIdea(persistedState.artifacts.blueprint);
              }
              if (persistedState.artifacts?.scriptLines && persistedState.artifacts.scriptLines.length > 0) {
                setCenterTab(persistedState.manualMode ? 'visual' : 'script');
              }
            } else if (activeProject.savedSession) {
              setSession(activeProject.savedSession);
              if (activeProject.savedSession.artifacts?.scriptLines && activeProject.savedSession.artifacts.scriptLines.length > 0) {
                setCenterTab(activeProject.savedSession.manualMode ? 'visual' : 'script');
              }
            }
          })
          .catch(() => {
            if (loadedProjectIdRef.current !== currentProjId) return;
            if (activeProject.savedSession) {
              setSession(activeProject.savedSession);
              if (activeProject.savedSession.artifacts?.scriptLines && activeProject.savedSession.artifacts.scriptLines.length > 0) {
                setCenterTab(activeProject.savedSession.manualMode ? 'visual' : 'script');
              }
            }
          });
      } else if (activeProject.savedSession) {
        setSession(activeProject.savedSession);
        if (activeProject.savedSession.artifacts?.scriptLines && activeProject.savedSession.artifacts.scriptLines.length > 0) {
          setCenterTab(activeProject.savedSession.manualMode ? 'visual' : 'script');
        }
      } else {
        setSession(null);
      }
    }
  }, [config.activeProjectId, config.savedProjects, getActiveProject]);

  useEffect(() => {
    if (typeof window === 'undefined' || !window.vanhsub?.aiStudio) return;

    const unsubscribe = window.vanhsub.aiStudio.onPipelineProgress((event: PipelineProgressEvent) => {
      let sessionToSave: PipelineSessionState | null = null;
      setSession((prev) => {
        if (!prev) return prev;
        if (event.sessionId && prev.sessionId && event.sessionId !== prev.sessionId) {
          return prev;
        }

        const next = { ...prev };
        next.currentStage = event.stage as any;
        next.progress = event.progress;
        if (event.artifacts) {
          next.artifacts = { ...next.artifacts, ...event.artifacts };
        }
        if (!next.stages || Array.isArray(next.stages)) {
          next.stages = {};
        }
        const stageMap = next.stages as Record<number, any>;
        if (stageMap[event.stage]) {
          stageMap[event.stage].status = event.status === 'awaiting_approval' ? 'success' : event.status;
        }
        if (event.status === 'awaiting_approval') {
          next.status = 'awaiting_approval';
          setIsRunning(false);
        } else if (event.status === 'error') {
          next.status = event.sessionStatus === 'cancelled' ? 'cancelled' : 'failed';
          setErrorMessage(event.sessionStatus === 'cancelled' ? null : (event.error || 'Có lỗi xảy ra trong tiến trình'));
          setErrorCode((event as any).errorCode || (event as any).code || null);
          setIsRunning(false);
          setCountdownSeconds(null);
        } else if (event.status === 'running') {
          next.status = 'running';
          setIsRunning(true);
          if (event.message && event.message.includes('Còn ') && event.message.includes(' giây')) {
            const match = event.message.match(/Còn (\d+) giây/);
            if (match) {
              setCountdownSeconds(parseInt(match[1], 10));
            }
          } else {
            setCountdownSeconds(null);
          }
        }
        if (event.progress >= 100 && event.status === 'success' && event.stage === 8) {
          next.status = 'completed';
          setIsRunning(false);
        }

        if (
          event.status === 'awaiting_approval' ||
          event.status === 'success' ||
          event.status === 'error' ||
          event.stage >= 2
        ) {
          sessionToSave = next;
        }

        return next;
      });

      if (sessionToSave) {
        const toSave: PipelineSessionState = sessionToSave;
        queueMicrotask(() => {
          void saveActiveProjectData(
            {
              savedSession: toSave,
              lastSessionId: toSave.sessionId,
            },
            loadedProjectIdRef.current || undefined
          );
        });
      }
    });

    return () => {
      if (typeof unsubscribe === 'function') unsubscribe();
    };
  }, [saveActiveProjectData]);

  const isIdeaInActiveSession = (idea: IdeaBlueprint | null | undefined): boolean => {
    if (!session || !idea) return false;
    const sessionTopic = (session.topic || '').trim().toLowerCase();
    const ideaTitle = (idea.title || '').trim().toLowerCase();
    const ideaTopic = (idea.topic || '').trim().toLowerCase();
    const bpTitle = (session.artifacts?.blueprint?.title || '').trim().toLowerCase();
    const bpTopic = (session.artifacts?.blueprint?.topic || '').trim().toLowerCase();

    return (
      (ideaTitle !== '' && (ideaTitle === sessionTopic || ideaTitle === bpTitle)) ||
      (ideaTopic !== '' && (ideaTopic === sessionTopic || ideaTopic === bpTopic))
    );
  };

  const handleResumeSession = (idea?: IdeaBlueprint | null) => {
    const targetIdea = idea || session?.artifacts?.blueprint || selectedIdea;
    if (targetIdea) {
      setSelectedIdea(targetIdea);
      void saveActiveProjectData({ selectedIdea: targetIdea }, loadedProjectIdRef.current || undefined);
    }
    setCenterTab('script');
  };

  const handleCancelCurrentRun = async () => {
    if (!session?.sessionId) {
      setIsRunning(false);
      return;
    }
    const sessionId = session.sessionId;
    const projectId = loadedProjectIdRef.current;
    try {
      if (window.vanhsub?.aiStudio?.cancelPipeline) {
        await window.vanhsub.aiStudio.cancelPipeline({ sessionId });
      }
      const stopped = await window.vanhsub.aiStudio.getPipelineState({ sessionId });
      if (!stopped || loadedProjectIdRef.current !== projectId) return;
      setIsRunning(stopped.jobActive === true);
      setIsApproving(false);
      setIsConfirmCancelOpen(false);
      setSession((prev) => prev?.sessionId === sessionId ? stopped : prev);
      void saveActiveProjectData({ savedSession: stopped, lastSessionId: sessionId }, projectId || undefined);
    } catch (err: any) {
      if (loadedProjectIdRef.current === projectId) setErrorMessage(`Không thể hủy tiến trình: ${err?.message || err}`);
    }
  };

  const handleResumePipelineRun = async (
    ideaOrStage?: IdeaBlueprint | number | null,
    mode: 'resume_missing' | 'regenerate_selected' | 'regenerate_all' = 'resume_missing'
  ) => {
    let fromStageOverride: number | undefined;
    if (typeof ideaOrStage === 'number') {
      fromStageOverride = ideaOrStage;
    } else if (ideaOrStage) {
      setSelectedIdea(ideaOrStage);
      void saveActiveProjectData({ selectedIdea: ideaOrStage }, loadedProjectIdRef.current || undefined);
    } else {
      const targetIdea = session?.artifacts?.blueprint || selectedIdea;
      if (targetIdea) {
        setSelectedIdea(targetIdea);
        void saveActiveProjectData({ selectedIdea: targetIdea }, loadedProjectIdRef.current || undefined);
      }
    }
    setCenterTab('script');
    setErrorMessage(null);

    if (!session) return;

    if (session.status === 'awaiting_approval' && mode === 'resume_missing' && fromStageOverride === undefined) {
      await handleApproveStage();
      return;
    }

    setIsRunning(true);
    setSession((prev) => (prev ? { ...prev, status: 'running' } : null));

    try {
      const effectiveStage = mode !== 'resume_missing' ? 6 : fromStageOverride ?? (session.status === 'cancelled' && (session.stages as any)?.[session.currentStage]?.status === 'success'
        ? session.currentStage + 1 : session.currentStage);
      if (window.vanhsub?.aiStudio?.resumePipeline) {
        await window.vanhsub.aiStudio.resumePipeline({
          sessionId: session.sessionId,
          fromStage: effectiveStage,
          mode,
          selectedShotIds: mode === 'regenerate_selected' ? selectedShotIds : undefined,
        });
      } else if (window.vanhsub?.aiStudio?.approveStage) {
        await window.vanhsub.aiStudio.approveStage({
          sessionId: session.sessionId,
          currentStage: effectiveStage,
        });
      }
    } catch (err: any) {
      setIsRunning(false);
      setErrorMessage(`Không thể tiếp tục tiến trình: ${err?.message || err}`);
    }
  };

  const refreshSessionConfig = async (sessionId: string) => {
    try {
      const latest = await window.vanhsub?.aiStudio?.getPipelineState({ sessionId });
      if (latest?.configSnapshot) {
        setSession((prev) => prev?.sessionId === sessionId ? { ...prev, configSnapshot: latest.configSnapshot } : prev);
      }
    } catch (err) {
      console.warn('Không thể cập nhật cấu hình tập trên UI:', err);
    }
  };

  const handleRegenerateStoryboardOneToOne = async () => {
    if (!session?.sessionId || isRunning) return;
    showSceneNotice('Đang cập nhật chế độ 1:1 và tạo lại Storyboard từ Bước 5...');
    setIsRunning(true);
    try {
      if (window.vanhsub?.aiStudio?.resumePipeline) {
        await window.vanhsub.aiStudio.resumePipeline({
          sessionId: session.sessionId,
          fromStage: 5,
          storyboardOptions: { shotMode: 'single' },
        });
        await refreshSessionConfig(session.sessionId);
      }
    } catch (err: any) {
      setIsRunning(false);
      showSceneNotice(`✗ Lỗi tái tạo Storyboard: ${err?.message || err}`);
    }
  };

  const handleChangeGranularity = async (newGranularity: 'detailed' | 'balanced' | 'fast') => {
    if (!session?.sessionId || isRunning) return;
    const names = { detailed: 'Chi tiết', balanced: 'Cân bằng', fast: 'Nhanh' };
    showSceneNotice(`Đang cập nhật mức "${names[newGranularity]}" và tái tạo Storyboard từ Bước 5...`);
    setIsRunning(true);
    try {
      if (window.vanhsub?.aiStudio?.resumePipeline) {
        await window.vanhsub.aiStudio.resumePipeline({
          sessionId: session.sessionId,
          fromStage: 5,
          storyboardOptions: { granularity: newGranularity },
        });
        await refreshSessionConfig(session.sessionId);
      }
    } catch (err: any) {
      setIsRunning(false);
      showSceneNotice(`✗ Lỗi tái tạo Storyboard: ${err?.message || err}`);
    }
  };

  const handleClearSession = async () => {
    try {
      if (session?.sessionId && window.vanhsub?.aiStudio?.cancelPipeline) {
        await window.vanhsub.aiStudio.cancelPipeline({ sessionId: session.sessionId });
      }
    } catch (err: any) {
      console.warn('Lỗi khi xoá pipeline:', err);
    } finally {
      setSession(null);
      setIsRunning(false);
      setIsApproving(false);
      setErrorMessage(null);
      setIsConfirmCancelOpen(false);
      setConflictWarningModal(null);
      void saveActiveProjectData(
        {
          savedSession: null,
          lastSessionId: undefined,
        },
        loadedProjectIdRef.current || undefined
      );
    }
  };

  const handleRequestStartProduction = (blueprint: IdeaBlueprint) => {
    if (isIdeaInActiveSession(blueprint)) {
      handleResumeSession(blueprint);
      return;
    }

    const hasExistingWork =
      Boolean(session) &&
      (Boolean(session?.artifacts?.scriptLines && session.artifacts.scriptLines.length > 0) ||
        (session?.currentStage || 1) >= 2 ||
        isRunning);

    if (hasExistingWork) {
      setConflictWarningModal({ pendingBlueprint: blueprint });
      return;
    }

    void handleStartWithBlueprint(blueprint);
  };

  const handleStartWithBlueprint = async (blueprint: IdeaBlueprint) => {
    if (isRunning || startInFlight.current) return;
    setErrorMessage(null);
    setErrorCode(null); setReadinessWarning(null);

    const currentOutputDir = activeProj?.outputDir?.trim();
    if (!currentOutputDir) {
      setErrorMessage('⚠️ Dự án hiện tại chưa cấu hình Thư mục xuất (Output Directory). Vui lòng vào Cấu hình Dự án để chọn thư mục lưu trữ trước khi bắt đầu!');
      return;
    }

    const exists = ideas.some((i) => i.title === blueprint.title && i.aspectRatio === blueprint.aspectRatio);
    const nextIdeas = exists ? ideas : [blueprint, ...ideas];
    setIdeas(nextIdeas);

    try {
      startInFlight.current = true;
      if (!window.vanhsub.aiStudio.getReadiness) throw new Error('Cần bản app có kiểm tra cấu hình trước khi chạy.');
      const readiness = await window.vanhsub.aiStudio.getReadiness();
      if (!readiness.ready) throw new Error(readiness.reasons.join(' '));
      if (readiness.warnings.length) setReadinessWarning(readiness.warnings.join(' '));
      setIsRunning(true);
      setCenterTab('script');
      setTopic(blueprint.title || blueprint.topic);
      setSelectedIdea(blueprint);
      const result = await window.vanhsub.aiStudio.startPipeline({
        topic: (blueprint.title || blueprint.topic).trim(),
        projectId: activeProj?.id,
        blueprint,
        gatedMode: isGatedMode,
        outputDir: currentOutputDir,
        flowProjectUrl: activeProj?.flowProjectUrl?.trim() || undefined,
      });

      const initialSession: PipelineSessionState = {
        sessionId: result.sessionId,
        topic: (blueprint.title || blueprint.topic).trim(),
        currentStage: 1,
        stageName: 'source',
        status: 'running',
        progress: 5,
        gatedMode: isGatedMode,
        stages: {
          1: { status: 'running', stageName: 'Dữ kiện', stage: 1 },
          2: { status: 'pending', stageName: 'Kịch bản', stage: 2 },
          3: { status: 'pending', stageName: 'Lồng tiếng', stage: 3 },
          4: { status: 'pending', stageName: 'Trích xuất Time', stage: 4 },
          5: { status: 'pending', stageName: 'Storyboard', stage: 5 },
          6: { status: 'pending', stageName: 'Ảnh / Video', stage: 6 },
          7: { status: 'pending', stageName: 'Dựng phim', stage: 7 },
          8: { status: 'pending', stageName: 'SEO & Xuất bản', stage: 8 },
        },
        artifacts: {
          blueprint,
          ideaSummary: blueprint.rawSummary || blueprint.title,
        },
        createdAt: Date.now(),
        updatedAt: Date.now(),
      };
      setSession(initialSession);
      void refreshSessionConfig(result.sessionId);

      void saveActiveProjectData({
        ideas: nextIdeas,
        selectedIdea: blueprint,
        lastSessionId: result.sessionId,
        savedSession: initialSession,
      });
    } catch (err: any) {
      setIsRunning(false);
      setErrorMessage(err?.message || 'Không thể khởi động pipeline');
    } finally {
      startInFlight.current = false;
    }
  };

  const handleApproveStage = async () => {
    if (!session || !window.vanhsub?.aiStudio?.approveStage) return;
    setIsApproving(true);
    setErrorMessage(null);

    try {
      await window.vanhsub.aiStudio.approveStage({
        sessionId: session.sessionId,
        currentStage: session.currentStage,
      });
      setIsRunning(true);
      setSession((prev) => (prev ? { ...prev, status: 'running' } : null));
    } catch (err: any) {
      setErrorMessage(`Lỗi phê duyệt: ${err?.message || err}`);
    } finally {
      setIsApproving(false);
    }
  };

  const handleRetryCurrentStage = async () => {
    if (!session || !window.vanhsub?.aiStudio?.resumePipeline) return;
    setErrorMessage(null);
    setIsRunning(true);

    try {
      await window.vanhsub.aiStudio.resumePipeline({
        sessionId: session.sessionId,
        fromStage: session.currentStage,
      });
      setSession((prev) => (prev ? { ...prev, status: 'running' } : null));
    } catch (err: any) {
      setIsRunning(false);
      setErrorMessage(`Không thể chạy lại bước: ${err?.message || err}`);
    }
  };

  const handleApplyFreezeLastFrame = async () => {
    if (!session) return;
    setErrorMessage(null);
    setErrorCode(null);

    const currentScenes = session.artifacts?.scenes || [];
    const updatedScenes = currentScenes.map((sc) => ({
      ...sc,
      fillMode: 'freeze_last_frame' as const,
    }));

    setSession((prev) => {
      if (!prev) return null;
      return {
        ...prev,
        artifacts: {
          ...prev.artifacts,
          scenes: updatedScenes,
        },
      };
    });

    try {
      if (window.vanhsub?.aiStudio?.updateSceneFillMode) {
        await window.vanhsub.aiStudio.updateSceneFillMode({
          sessionId: session.sessionId,
          fillMode: 'freeze_last_frame',
        });
      }

      setIsRunning(true);
      if (window.vanhsub?.aiStudio?.resumePipeline) {
        await window.vanhsub.aiStudio.resumePipeline({
          sessionId: session.sessionId,
          fromStage: 7,
          mode: 'resume_missing',
          updatedArtifacts: { scenes: updatedScenes },
        });
      } else if (window.vanhsub?.aiStudio?.approveStage) {
        await window.vanhsub.aiStudio.approveStage({
          sessionId: session.sessionId,
          currentStage: 6,
          updatedArtifacts: { scenes: updatedScenes },
        });
      }
    } catch (err: any) {
      setIsRunning(false);
      setErrorMessage(`Không thể áp dụng giữ khung hình cuối: ${err?.message || err}`);
    }
  };

  const handleToggleSceneFillMode = async (sceneId: string, mode: 'freeze_last_frame' | 'none') => {
    if (!session) return;
    const currentScenes = session.artifacts?.scenes || [];
    const updatedScenes = currentScenes.map((sc) => {
      if (sc.id === sceneId || sc.shotId === sceneId) {
        return { ...sc, fillMode: mode };
      }
      return sc;
    });

    setSession((prev) => {
      if (!prev) return null;
      return {
        ...prev,
        artifacts: {
          ...prev.artifacts,
          scenes: updatedScenes,
        },
      };
    });

    try {
      if (window.vanhsub?.aiStudio?.updateSceneFillMode) {
        await window.vanhsub.aiStudio.updateSceneFillMode({
          sessionId: session.sessionId,
          sceneIds: [sceneId],
          fillMode: mode,
        });
      }
    } catch (err) {
      console.warn('Lỗi lưu chế độ bù thời lượng cho scene:', err);
    }
  };

  const handleOpenFolder = (pathStr?: string) => {
    if (pathStr && window.vanhsub?.dialog) {
      if (window.vanhsub.dialog.showInFolder) {
        window.vanhsub.dialog.showInFolder(pathStr);
      } else if (window.vanhsub.dialog.openFolder) {
        window.vanhsub.dialog.openFolder(pathStr);
      }
    }
  };

  const handleHostAvatarUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === 'string') {
        updateChannelProfileConfig({ hostAvatarUrl: reader.result });
        setHostToast('Đã tải ảnh đại diện host thành công!');
        setTimeout(() => setHostToast(null), 3000);
      }
    };
    reader.readAsDataURL(file);
  };

  const handleAiGenerateHost = () => {
    const desc = config.channelProfile?.hostDescription?.trim();
    if (!desc) {
      setHostToast('⚠️ Vui lòng nhập mô tả host để AI có căn cứ sinh hình ảnh.');
      setTimeout(() => setHostToast(null), 3500);
      return;
    }
    setHostToast(`✨ Đã nạp mô tả host vào bộ sinh Visual của kênh! Khi sản xuất, Flow sẽ tự động render ảnh host.`);
    setTimeout(() => setHostToast(null), 4000);
  };

  const handleAddCharacter = async () => {
    if (!newCharName.trim()) return;
    const currentChars = config.channelProfile?.channelCharacters || [];
    const updated = [
      ...currentChars,
      {
        id: `char_${Date.now()}`,
        name: newCharName.trim(),
        descriptionEn: newCharDesc.trim(),
      },
    ];
    await updateChannelProfileConfig({ channelCharacters: updated });
    setNewCharName('');
    setNewCharDesc('');
  };

  const handleRemoveCharacter = async (index: number) => {
    const currentChars = config.channelProfile?.channelCharacters || [];
    const updated = currentChars.filter((_, idx) => idx !== index);
    await updateChannelProfileConfig({ channelCharacters: updated });
  };

  const handleSelectStylePreset = async (preset: (typeof STYLE_PRESETS)[0]) => {
    const currentBg = config.channelProfile?.projectBackgroundPrompt;
    if (!currentBg || currentBg.trim() === '') {
      await updateChannelProfileConfig({
        visualArtStylePreset: preset.id,
        projectBackgroundPrompt: preset.sampleBg,
      });
    } else {
      await updateChannelProfileConfig({
        visualArtStylePreset: preset.id,
      });
    }
    setHostToast(`🎨 Đã áp dụng preset phong cách: ${preset.name}`);
    setTimeout(() => setHostToast(null), 3500);
  };

  const handleAiSuggestBackground = async () => {
    const niche = config.channelProfile?.channelNiche || '';
    const desc = config.channelProfile?.channelDescription || '';
    const topicText = session?.topic || selectedIdea?.title || '';
    const styleId = config.channelProfile?.videoStyleId || '';

    let suggested = '';
    const combined = `${niche} ${topicText} ${desc} ${styleId}`.toLowerCase();

    if (combined.includes('sinh tồn') || combined.includes('tiền sử') || combined.includes('rừng') || combined.includes('survival')) {
      suggested = 'Primeval prehistoric wilderness, towering ancient ferns, misty jungle canopy, giant mossy boulders, dramatic natural lighting, 8k';
    } else if (combined.includes('khoa học') || combined.includes('đại dương') || combined.includes('biển') || combined.includes('ocean')) {
      suggested = 'Deep sea scientific research chamber or bioluminescent underwater reef abyss, volumetric light beams penetrating crystal dark waters';
    } else if (combined.includes('tài chính') || combined.includes('tiền') || combined.includes('kinh tế') || combined.includes('finance')) {
      suggested = 'Modern high-end financial boardroom overlooking bustling metropolitan skyline, sleek glass and marble architecture, sophisticated ambient lighting';
    } else if (combined.includes('công nghệ') || combined.includes('ai') || combined.includes('cyber') || combined.includes('tech')) {
      suggested = 'Futuristic high-tech research lab with glowing holographic displays, sleek obsidian surfaces, subtle teal and violet accent LEDs';
    } else if (combined.includes('lịch sử') || combined.includes('chiến tranh') || combined.includes('cổ trang') || combined.includes('history')) {
      suggested = 'Authentic ancient imperial stone courtyard, weathered flagstones, ceremonial bronze braziers with flickering fire, misty mountain backdrop';
    } else {
      suggested = 'Atmospheric cinematic studio interior with rich architectural depth, soft dramatic directional lighting, warm bokeh background';
    }

    await updateChannelProfileConfig({ projectBackgroundPrompt: suggested });
    setHostToast('✨ Đã nạp gợi ý bối cảnh thị giác phù hợp vào dự án!');
    setTimeout(() => setHostToast(null), 3500);
  };

  const projectName = config.channelProfile?.projectName || 'Chưa đặt tên';
  const episodeProvider = session?.configSnapshot?.llm.provider || config.llm.provider;
  const aiProviderName =
    episodeProvider === 'chatgpt_web'
      ? 'ChatGPT Web'
      : episodeProvider === 'gemini_web'
      ? 'Gemini Web'
      : episodeProvider.toUpperCase();

  return (
    <div className="flex h-full flex-col overflow-hidden bg-[#070B13] text-text select-none">
      {/* Modal: Tạo & Sinh Ý Tưởng Video */}
      <IdeaGenerationModal
        isOpen={isModalOpen}
        initialTopic={selectedIdea?.title || topic}
        onClose={() => setIsModalOpen(false)}
        onSubmit={(blueprint) => {
          setIsModalOpen(false);
          handleRequestStartProduction(blueprint);
        }}
      />

      {/* Modal: Cấu hình Kênh · Bộ não AI, Giọng đọc & Model */}
      <ChannelConfigModal
        isOpen={isChannelModalOpen}
        onClose={() => setIsChannelModalOpen(false)}
      />

      {/* ==================================================================== */}
      {/* TOP HEADER BAR (AutoPilotHeader)                                      */}
      {/* ==================================================================== */}
      <AutoPilotHeader
        projectName={projectName}
        savedProjects={config.savedProjects || []}
        activeProjectId={config.activeProjectId}
        onSwitchProject={onSwitchProject}
        onSelectProject={async (id) => {
          if (config.activeProjectId !== id) {
            await switchProject(id);
          }
        }}
        activeTab={activeTab}
        onTabChange={setActiveTab}
        aiProviderName={aiProviderName}
        isFlowWindowOpen={isFlowWindowOpen}
        onToggleFlowLive={handleToggleFlowLive}
        onOpenChannelConfig={() => setIsChannelModalOpen(true)}
        onOpenAdvancedDrawer={() => setIsAdvancedDrawerOpen(true)}
        session={session}
        ideasCount={ideas.length}
        isRunning={isRunning}
        isGatedMode={isGatedMode}
        onToggleGatedMode={setIsGatedMode}
        onCancelRun={handleCancelCurrentRun}
        onResumeRun={() => handleResumeSession()}
      />

      {/* ==================================================================== */}
      {/* 3-COLUMN REVO WORKSPACE LAYOUT                                        */}
      {/* ==================================================================== */}
      <div className="flex items-center gap-3 border-b border-border px-4 py-2 text-xs">
        <button type="button" disabled={mediaChecking||isRunning} className="rounded border border-border px-2 py-1 disabled:opacity-50" onClick={async()=>{setMediaChecking(true);try{const result=await window.vanhsub.aiStudio.getMediaReadiness(session?{sessionId:session.sessionId}:undefined);setMediaCheck(`${result.status} · ${result.route} · chưa Live verified${result.reasons.length?' · '+result.reasons.join(' '):''}`);}catch{setMediaCheck('FAILED: không kiểm tra được cấu hình media.');}finally{setMediaChecking(false);}}}>{mediaChecking?'Đang kiểm tra…':'Kiểm tra media tập này'}</button>
        {mediaCheck&&<span role="status">{mediaCheck}</span>}
        {readinessWarning && <span role="status" className="text-amber-300">{readinessWarning}</span>}
        <button type="button" disabled={manualBusy || isRunning || !!session?.jobActive} onClick={handleStartManual} className="rounded border border-border px-3 py-1.5 disabled:opacity-50">Nhập SRT + audio thủ công</button>
        {session?.manualMode && <><span>Storyboard thủ công · media nhập từ máy</span><button type="button" disabled={manualBusy || isRunning || !!session.jobActive || !session.artifacts.scenes?.every(s => s.status === 'ready' && s.assetPath)} onClick={handleRenderManual} className="rounded bg-accent px-3 py-1.5 text-white disabled:opacity-50">{manualBusy ? 'Đang xử lý…' : 'Xuất video thủ công'}</button></>}
      </div>
      {session?.manualMode && <details className="border-b border-border px-4 py-2 text-xs">
        <summary className="cursor-pointer">SEO nhập thủ công — không gọi LLM hoặc đăng tải</summary>
        <div className="mt-2 grid gap-2 md:grid-cols-2">
          <label>Tiêu đề SEO<input aria-label="Tiêu đề SEO thủ công" maxLength={100} value={manualSeo.title} onChange={e=>setManualSeo({...manualSeo,title:e.target.value})} className="mt-1 w-full rounded border border-border bg-bg p-2"/></label>
          <label>Hashtags<input aria-label="Hashtags SEO thủ công" value={manualSeo.hashtags} onChange={e=>setManualSeo({...manualSeo,hashtags:e.target.value})} className="mt-1 w-full rounded border border-border bg-bg p-2"/></label>
          <label className="md:col-span-2">Mô tả<textarea aria-label="Mô tả SEO thủ công" maxLength={10000} value={manualSeo.description} onChange={e=>setManualSeo({...manualSeo,description:e.target.value})} className="mt-1 w-full rounded border border-border bg-bg p-2"/></label>
          <button type="button" onClick={handleSaveManualSeo} disabled={manualBusy||!manualSeo.title.trim()||!manualSeo.description.trim()} className="w-fit rounded border border-border px-3 py-2 disabled:opacity-50">Lưu SEO thủ công</button>
          {session.artifacts.metadata?.source==='manual_authored' && <span role="status">SEO đã lưu · người dùng biên soạn</span>}
        </div>
      </details>}
      <div className="flex-1 grid grid-cols-1 lg:grid-cols-12 overflow-hidden">
        {/* ------------------------------------------------------------------ */}
        {/* CỘT 1 (LEFT - 3 COLS): Ý TƯỞNG VIDEO (IdeaListPanel)                */}
        {/* ------------------------------------------------------------------ */}
        <div className="lg:col-span-3 flex flex-col h-full overflow-hidden">
          <IdeaListPanel
            ideas={ideas}
            selectedIdea={selectedIdea}
            onSelectIdea={(idea) => {
              setSelectedIdea(idea);
              void saveActiveProjectData({ selectedIdea: idea });
            }}
            selectedFormat={selectedFormat}
            onFormatChange={setSelectedFormat}
            setupComplete={setupCheck.isComplete}
            setupMissing={setupCheck.missing}
            setupWarningToast={setupWarningToast}
            onOpenIdeaModal={handleOpenIdeaModal}
            onOpenProjectSetup={onSwitchProject}
            isRunning={isRunning}
            session={session}
            onCancelRun={handleCancelCurrentRun}
            onResumeSession={handleResumeSession}
            onRequestStartProduction={handleRequestStartProduction}
          />
        </div>

        {/* ------------------------------------------------------------------ */}
        {/* CỘT 2 (CENTER - 5 COLS): KỊCH BẢN & GIỌNG / NHÂN VẬT / VISUAL       */}
        {/* ------------------------------------------------------------------ */}
        <div className="lg:col-span-5 flex flex-col h-full border-r border-border bg-[#080D17] overflow-hidden">
          {session && centerTab === 'script' ? (
            <ScriptWorkspaceView
              key={session.sessionId}
              session={session}
              blueprint={selectedIdea}
              isRunning={isRunning}
              activeCenterTab={centerTab}
              onSwitchTab={setCenterTab}
              onProceedToVoice={handleApproveStage}
              onRegenerateScript={handleRetryCurrentStage}
              onCancelProcess={handleCancelCurrentRun}
              onBackToIdeas={() => {
                setCenterTab('visual');
              }}
              onSessionUpdate={(updatedSession) => {
                if (loadedProjectIdRef.current !== config.activeProjectId) return;
                setSession((current) => current?.sessionId === updatedSession.sessionId ? updatedSession : current);
                void saveActiveProjectData({
                  savedSession: updatedSession,
                  lastSessionId: updatedSession.sessionId,
                }, updatedSession.ownerProjectId || config.activeProjectId || undefined);
              }}
              onDeleteVideo={handleClearSession}
            />
          ) : (
            <div className="flex flex-col h-full overflow-hidden">
              {/* Top Sub-Navigation Tabs */}
              <div className="flex items-center justify-between px-5 pt-3 pb-2 border-b border-border bg-[#090E1A] shrink-0">
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => setCenterTab('script')}
                    className={`rounded-md px-4 py-1.5 text-xs font-bold transition cursor-pointer ${
                      centerTab === 'script'
                        ? 'bg-[#1C263A] text-white border border-border'
                        : 'text-text-muted hover:text-white'
                    }`}
                  >
                    Kịch bản &amp; Giọng
                  </button>
                  <button
                    type="button"
                    onClick={() => setCenterTab('visual')}
                    className={`rounded-md px-4 py-1.5 text-xs font-semibold transition cursor-pointer ${
                      centerTab === 'visual'
                        ? 'bg-[#1C263A] text-white border border-border'
                        : 'text-text-muted hover:text-white'
                    }`}
                  >
                    Phân cảnh Visual
                  </button>
                  <button
                    type="button"
                    onClick={() => setCenterTab('character')}
                    className={`rounded-md px-4 py-1.5 text-xs font-semibold transition cursor-pointer ${
                      centerTab === 'character'
                        ? 'bg-[#1C263A] text-white border border-border'
                        : 'text-text-muted hover:text-white'
                    }`}
                  >
                    Nhân vật
                  </button>
                </div>

                <span className="rounded-full bg-surface-2 px-3 py-0.5 text-[11px] font-mono text-text-muted border border-border">
                  {session ? session.status : 'ready'}
                </span>
              </div>

              {/* Viewport for CenterTab */}
              <div className="flex-1 overflow-y-auto custom-scrollbar p-5 space-y-4">
                {centerTab === 'script' && (
                  <div className="space-y-4">
                    {selectedIdea ? (
                      <div className="rounded-lg border border-orange-500/30 bg-[#121826] p-5 space-y-3.5 animate-in fade-in duration-200">
                        <div className="flex items-center justify-between">
                          <span className="text-[11px] font-bold uppercase tracking-wider text-orange-400 flex items-center gap-1.5">
                            <Lightbulb className="h-3.5 w-3.5" />
                            Ý tưởng đang chọn:
                          </span>
                          <span className="text-[10px] font-mono text-text-muted bg-surface-2 px-2 py-0.5 rounded">
                            {selectedIdea.aspectRatio}
                          </span>
                        </div>
                        <h4 className="text-sm font-bold text-white leading-snug">
                          {selectedIdea.title}
                        </h4>
                        <p className="text-xs text-text">
                          <strong className="text-amber-400">Hook 3s:</strong> {selectedIdea.hookConcept}
                        </p>
                        <p className="text-xs text-text-muted">
                          <strong className="text-accent">Góc nhìn:</strong> {selectedIdea.narrativeAngle}
                        </p>

                        {/* Character consistency indicator */}
                        {(config.channelProfile?.hostName || config.channelProfile?.hostDescription) && (
                          <div className="rounded-md border border-pink-500/30 bg-pink-950/20 p-2.5 flex items-start gap-2.5 text-xs">
                            <User className="h-4 w-4 text-pink-400 shrink-0 mt-0.5" />
                            <div className="space-y-0.5 min-w-0 flex-1">
                              <div className="flex items-center gap-1.5">
                                <span className="font-bold text-pink-300">Nhân vật đại diện:</span>
                                <span className="text-white font-medium">{config.channelProfile?.hostName || 'Nhân vật chính'}</span>
                              </div>
                              {config.channelProfile?.hostDescription && (
                                <p className="text-[11px] text-text leading-relaxed">
                                  {config.channelProfile.hostDescription}
                                </p>
                              )}
                            </div>
                          </div>
                        )}

                        {/* Thumbnail details */}
                        {(selectedIdea.thumbnailConcept || selectedIdea.thumbnailPrompt) && (
                          <div className="rounded-md border border-indigo-500/30 bg-indigo-950/20 p-3 space-y-2 text-xs">
                            <div className="flex items-center justify-between">
                              <span className="font-bold text-indigo-300 flex items-center gap-1.5">
                                <ImageIcon className="h-3.5 w-3.5 text-indigo-400" />
                                Thumbnail &amp; Ảnh Bìa Video
                              </span>
                              {selectedIdea.thumbnailPrompt && (
                                <button
                                  type="button"
                                  onClick={() => handleCopyIdeaThumbPrompt(selectedIdea.thumbnailPrompt || '')}
                                  className="inline-flex items-center gap-1 rounded border border-indigo-500/40 bg-indigo-900/40 px-2 py-0.5 text-[10px] font-bold text-indigo-200 hover:bg-indigo-800 transition cursor-pointer"
                                >
                                  <Copy className="h-2.5 w-2.5" />
                                  <span>{copiedIdeaThumbPrompt ? '✓ Đã sao chép prompt' : 'Sao chép Prompt AI'}</span>
                                </button>
                              )}
                            </div>

                            {selectedIdea.thumbnailConcept && (
                              <p className="text-text text-[11px] leading-relaxed">
                                <strong className="text-indigo-200">Concept:</strong> {selectedIdea.thumbnailConcept}
                              </p>
                            )}

                            {selectedIdea.thumbnailPrompt && (
                              <pre className="font-mono text-[10px] text-text bg-black/40 p-2 rounded-lg border border-indigo-500/20 whitespace-pre-wrap break-words max-h-24 overflow-y-auto custom-scrollbar">
                                {selectedIdea.thumbnailPrompt}
                              </pre>
                            )}
                          </div>
                        )}

                        <div className="pt-2 flex items-center justify-end gap-2.5">
                          {selectedIdea && isIdeaInActiveSession(selectedIdea) ? (
                            isRunning ? (
                              <button
                                type="button"
                                onClick={handleCancelCurrentRun}
                                className="rounded-md border border-rose-800/80 bg-rose-950/60 hover:bg-rose-900/80 px-4 py-2.5 text-xs font-bold text-rose-200 transition active:scale-95 cursor-pointer flex items-center gap-1.5"
                                title="Hủy / Dừng tiến trình đang chạy (bảo lưu dữ liệu kịch bản)"
                              >
                                <Square className="h-3.5 w-3.5 fill-rose-400 text-rose-400" />
                                <span>Hủy tiến trình đang chạy</span>
                              </button>
                            ) : (
                              <button
                                type="button"
                                onClick={() => handleResumeSession(selectedIdea)}
                                className="rounded-md bg-gradient-to-r from-emerald-600 via-teal-600 to-cyan-600 hover:brightness-110 px-5 py-2.5 text-xs font-bold text-white transition active:scale-95 cursor-pointer flex items-center gap-2"
                              >
                                <Play className="h-3.5 w-3.5 fill-white" />
                                <span>Tiếp tục sản xuất (Xem Kịch Bản)</span>
                              </button>
                            )
                          ) : (
                            <button
                              type="button"
                              onClick={() => handleRequestStartProduction(selectedIdea)}
                              disabled={isRunning}
                              className="rounded-md bg-gradient-to-r from-[#FA5252] via-orange-500 to-amber-500 hover:brightness-110 px-5 py-2.5 text-xs font-bold text-white transition active:scale-95 disabled:opacity-50 cursor-pointer flex items-center gap-2"
                            >
                              <Play className="h-3.5 w-3.5 fill-white" />
                              <span>Sản xuất ý tưởng này (Tạo Kịch Bản)</span>
                            </button>
                          )}
                        </div>
                      </div>
                    ) : (
                      <div className="text-center text-xs text-text-muted py-12 space-y-2">
                        <Lightbulb className="h-8 w-8 mx-auto text-text-faint stroke-[1.5]" />
                        <p>Chọn một ý tưởng bên trái hoặc bấm &quot;✨ Sinh&quot; để bắt đầu kịch bản.</p>
                      </div>
                    )}
                  </div>
                )}

                {centerTab === 'character' && (
                  <CharacterStudioPanel
                    hostName={config.channelProfile?.hostName || ''}
                    hostDescription={config.channelProfile?.hostDescription || ''}
                    hostAvatarUrl={config.channelProfile?.hostAvatarUrl}
                    onUpdateHostName={(name) => updateChannelProfileConfig({ hostName: name })}
                    onUpdateHostDescription={(desc) => updateChannelProfileConfig({ hostDescription: desc })}
                    onUploadAvatar={handleHostAvatarUpload}
                    onRemoveAvatar={() => updateChannelProfileConfig({ hostAvatarUrl: '' })}
                    onAiGenerateHost={handleAiGenerateHost}
                    channelCharacters={config.channelProfile?.channelCharacters || []}
                    newCharName={newCharName}
                    newCharDesc={newCharDesc}
                    onNewCharNameChange={setNewCharName}
                    onNewCharDescChange={setNewCharDesc}
                    onAddCharacter={handleAddCharacter}
                    onRemoveCharacter={handleRemoveCharacter}
                    visualArtStylePreset={config.channelProfile?.visualArtStylePreset}
                    onSelectStylePreset={handleSelectStylePreset}
                    projectBackgroundPrompt={config.channelProfile?.projectBackgroundPrompt || ''}
                    onUpdateBackgroundPrompt={(p) => updateChannelProfileConfig({ projectBackgroundPrompt: p })}
                    onAiSuggestBackground={handleAiSuggestBackground}
                    hostToast={hostToast}
                  />
                )}

                {centerTab === 'visual' && (
                  <StoryboardGridPanel
                    session={session}
                    selectedShotIds={selectedShotIds}
                    onToggleSelectShot={toggleSelectShot}
                    onSelectAllShots={handleSelectAllShots}
                    granularity={session?.configSnapshot?.flowEngine.granularity || config.flowEngine.granularity || 'balanced'}
                    onChangeGranularity={handleChangeGranularity}
                    shotMode={session?.configSnapshot?.flowEngine.shotMode || config.flowEngine.shotMode || 'single'}
                    mediaDir={session?.artifacts?.mediaDir || config.channelProfile?.customMediaDir}
                    onSelectCustomMediaDir={handleSelectCustomMediaDir}
                    onOpenFolder={handleOpenFolder}
                    isFlowWindowOpen={isFlowWindowOpen}
                    onToggleFlowLive={handleToggleFlowLive}
                    sceneActionNotice={sceneActionNotice}
                    onDismissSceneNotice={() => setSceneActionNotice(null)}
                    regeneratingSceneId={regeneratingSceneId}
                    importingSceneId={importingSceneId}
                    onRegenerateScene={handleRegenerateScene}
                    onImportManualMedia={handleImportManualMedia}
                    onPreviewMedia={setPreviewMedia}
                    onRegenerateStoryboardOneToOne={handleRegenerateStoryboardOneToOne}
                    onResumePipelineRun={handleResumePipelineRun}
                    onToggleFillMode={handleToggleSceneFillMode}
                    isRunning={isRunning}
                  />
                )}
              </div>
            </div>
          )}
        </div>

        {/* ------------------------------------------------------------------ */}
        {/* CỘT 3 (RIGHT - 4 COLS): TIẾN ĐỘ SẢN XUẤT (PipelineTrackerPanel)    */}
        {/* ------------------------------------------------------------------ */}
        <div className="lg:col-span-4 flex flex-col h-full overflow-hidden">
          <PipelineTrackerPanel
            session={session}
            isRunning={isRunning}
            isApproving={isApproving}
            selectedShotIds={selectedShotIds}
            onApproveStage={handleApproveStage}
            onRetryStage={handleRetryCurrentStage}
            onCancelRun={handleCancelCurrentRun}
            onResumeRun={handleResumePipelineRun}
            onToggleFlowLive={handleToggleFlowLive}
            isFlowWindowOpen={isFlowWindowOpen}
            errorMessage={errorMessage}
            errorCode={errorCode}
            countdownSeconds={countdownSeconds}
            onDismissError={() => {
              setErrorMessage(null);
              setErrorCode(null);
            }}
            onOpenChromeBridge={() => setIsChromeBridgeModalOpen(true)}
            onOpenDiagnostics={() => setIsDiagnosticsModalOpen(true)}
            onApplyFreezeLastFrame={handleApplyFreezeLastFrame}
            onOpenFolder={handleOpenFolder}
          />
        </div>
      </div>

      {/* Modal Xác nhận Xoá Video / Đặt lại Phiên */}
      {isConfirmCancelOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 p-4 animate-in fade-in duration-150">
          <div className="w-full max-w-md rounded-lg border border-border bg-[#0B1120] p-5 space-y-4 animate-in zoom-in-95 duration-150">
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-md bg-rose-500/20 border border-rose-500/40 text-rose-400">
                <AlertTriangle className="h-5 w-5" />
              </div>
              <div>
                <h3 className="text-sm font-bold text-white">Xác nhận xoá video khỏi phiên</h3>
                <p className="text-xs text-text-muted">Thao tác này sẽ đặt lại tiến trình của tập này</p>
              </div>
            </div>

            <p className="text-xs text-text leading-relaxed bg-surface p-3 rounded-md border border-border">
              Bạn có chắc chắn muốn xoá video của ý tưởng{' '}
              <strong className="text-white">&ldquo;{session?.topic || 'này'}&rdquo;</strong> không?
              Kịch bản và các tài nguyên của video này sẽ được xóa để làm lại từ đầu.
            </p>

            <div className="flex items-center justify-end gap-2 pt-1">
              <button
                type="button"
                onClick={() => setIsConfirmCancelOpen(false)}
                className="rounded-md px-4 py-2 text-xs font-semibold text-text-muted hover:text-white hover:bg-surface-2 transition cursor-pointer"
              >
                Không, giữ lại
              </button>
              <button
                type="button"
                onClick={handleClearSession}
                className="inline-flex items-center gap-1.5 rounded-md bg-rose-600 hover:bg-rose-500 px-4 py-2 text-xs font-bold text-white transition active:scale-95 cursor-pointer"
              >
                <Trash2 className="h-3.5 w-3.5" />
                <span>Xác nhận Xoá</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Modal Cảnh báo Xung Đột Phiên Làm Việc */}
      {conflictWarningModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 p-4 animate-in fade-in duration-150">
          <div className="w-full max-w-lg rounded-lg border border-amber-500/40 bg-[#0B1120] p-5 space-y-4 animate-in zoom-in-95 duration-150">
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-md bg-amber-500/20 border border-amber-500/40 text-amber-400">
                <AlertTriangle className="h-5 w-5" />
              </div>
              <div>
                <h3 className="text-sm font-bold text-white">Đang có phiên làm việc dở dang</h3>
                <p className="text-xs text-amber-300/80">Kịch bản trước đó đã được tạo hoặc đang xử lý</p>
              </div>
            </div>

            <div className="text-xs text-text space-y-2 leading-relaxed bg-surface p-3.5 rounded-md border border-border">
              <p>
                Phiên làm việc hiện tại: <strong className="text-amber-300">&ldquo;{session?.topic}&rdquo;</strong>
                {session?.artifacts?.scriptLines && session.artifacts.scriptLines.length > 0 && (
                  <span className="block text-[11px] text-text-muted mt-0.5">
                    (Đã có {session.artifacts.scriptLines.length} phân cảnh kịch bản)
                  </span>
                )}
              </p>
              <p className="text-text-muted">
                Bạn vừa bấm sản xuất ý tưởng mới: <strong className="text-white">&ldquo;{conflictWarningModal.pendingBlueprint.title}&rdquo;</strong>.
                Nếu bắt đầu mới, toàn bộ kịch bản và tiến trình của phiên cũ sẽ bị thay thế.
              </p>
            </div>

            <div className="flex flex-wrap items-center justify-end gap-2 pt-1">
              <button
                type="button"
                onClick={() => setConflictWarningModal(null)}
                className="rounded-md px-3.5 py-2 text-xs font-semibold text-text-muted hover:text-white hover:bg-surface-2 transition cursor-pointer"
              >
                Đóng
              </button>

              <button
                type="button"
                onClick={async () => {
                  const pending = conflictWarningModal.pendingBlueprint;
                  await handleClearSession();
                  await handleStartWithBlueprint(pending);
                }}
                className="inline-flex items-center gap-1.5 rounded-md border border-rose-900/60 bg-rose-950/40 hover:bg-rose-900/60 px-3.5 py-2 text-xs font-bold text-rose-300 hover:text-rose-100 transition active:scale-95 cursor-pointer"
              >
                <Trash2 className="h-3.5 w-3.5" />
                <span>Xoá phiên cũ &amp; Bắt đầu mới</span>
              </button>

              <button
                type="button"
                onClick={() => {
                  setConflictWarningModal(null);
                  handleResumeSession();
                }}
                className="inline-flex items-center gap-1.5 rounded-md bg-gradient-to-r from-emerald-600 via-teal-600 to-cyan-600 hover:brightness-110 px-4 py-2 text-xs font-bold text-white active:scale-95 transition cursor-pointer"
              >
                <Play className="h-3.5 w-3.5 fill-white" />
                <span>Tiếp tục phiên hiện tại</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Modal Lightbox Xem Trước Media */}
      <MediaLightboxModal
        media={previewMedia}
        onClose={() => setPreviewMedia(null)}
        onOpenFolder={handleOpenFolder}
      />

      {/* Advanced Infrastructure Drawer (Slide-over) */}
      <AdvancedInfrastructureDrawer
        isOpen={isAdvancedDrawerOpen}
        onClose={() => setIsAdvancedDrawerOpen(false)}
        bridgePort={(config.flowEngine as any)?.bridgePort || 19890}
        isLobbyDebugVisible={isFlowWindowOpen}
        onToggleLobbyDebug={handleToggleFlowLive}
        onOpenChromeBridgeModal={() => setIsChromeBridgeModalOpen(true)}
        onOpenDiagnosticsModal={() => setIsDiagnosticsModalOpen(true)}
      />

      {/* Modal Tự Chẩn Đoán 1-Click */}
      <SelfTestDiagnosticsModal
        isOpen={isDiagnosticsModalOpen}
        onClose={() => setIsDiagnosticsModalOpen(false)}
        onOpenChromeBridge={() => setIsChromeBridgeModalOpen(true)}
      />

      {/* Modal Kết Nối Chrome Bridge */}
      <ChromeBridgeModal
        isOpen={isChromeBridgeModalOpen}
        onClose={() => setIsChromeBridgeModalOpen(false)}
        isConnected={false}
      />
    </div>
  );
}
