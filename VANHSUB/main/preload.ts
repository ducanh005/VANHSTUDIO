import { contextBridge, ipcRenderer, webUtils } from 'electron'

const vanhsub = {
  tasks: {
    getAll: () => ipcRenderer.invoke('tasks:getAll'),
    get: (id: string) => ipcRenderer.invoke('tasks:get', id),
    create: (input: any) => ipcRenderer.invoke('tasks:create', input),
    update: (id: string, updates: any) => ipcRenderer.invoke('tasks:update', id, updates),
    delete: (id: string) => ipcRenderer.invoke('tasks:delete', id),
    start: (id: string) => ipcRenderer.invoke('tasks:start', id),
    cancel: (id: string) => ipcRenderer.invoke('tasks:cancel', id),
    startHybrid: (id: string, options?: any) => ipcRenderer.invoke('tasks:startHybrid', id, options),
    cancelHybrid: (id: string) => ipcRenderer.invoke('tasks:cancelHybrid', id),
    readSrt: (srtPath: string) => ipcRenderer.invoke('tasks:readSrt', srtPath),
    writeSrt: (srtPath: string, content: string) => ipcRenderer.invoke('tasks:writeSrt', srtPath, content),
    runPipeline: (id: string, opts?: { replaceAudio?: boolean }) =>
      ipcRenderer.invoke('tasks:runPipeline', id, opts ?? null),
    runPipelineBatch: (ids: string[]) => ipcRenderer.invoke('tasks:runPipelineBatch', ids),
    importSrt: (id: string, sourceSrtPath: string) =>
      ipcRenderer.invoke('tasks:importSrt', id, sourceSrtPath),

    onUpdate: (callback: (tasks: any[]) => void) => {
      const subscription = (_event: any, tasks: any[]) => callback(tasks)
      ipcRenderer.on('tasks:updated', subscription)
      return () => {
        ipcRenderer.removeListener('tasks:updated', subscription)
      }
    },
  },
  settings: {
    get: (key: string) => ipcRenderer.invoke('settings:get', key),
    set: (key: string, value: any) => ipcRenderer.invoke('settings:set', key, value),
    onChange: (callback: (key: string) => void) => {
      const listener = (_event: Electron.IpcRendererEvent, key: string) => callback(key);
      ipcRenderer.on('settings:changed', listener);
      return () => { ipcRenderer.removeListener('settings:changed', listener); };
    },
  },
  ai: {
    polishLine: (payload: { text: string; prev?: string; next?: string }) =>
      ipcRenderer.invoke('ai:polishLine', payload),
    translateLine: (payload: { text: string; targetLanguage?: string; prev?: string; next?: string }) =>
      ipcRenderer.invoke('ai:translateLine', payload),
    cleanSubtitles: (items: Array<{ startMs: number; endMs: number; text: string }>) =>
      ipcRenderer.invoke('ai:cleanSubtitles', items),
    normalizeSubtitles: (input: string | any[], options?: any) =>
      ipcRenderer.invoke('subtitles:normalize', input, options),
  },
  translate: {
    start: (id: string, targetLanguage?: string) =>
      ipcRenderer.invoke('translate:start', id, targetLanguage),
    cancel: (id: string) => ipcRenderer.invoke('translate:cancel', id),
  },
  export: {
    start: (id: string, mode: 'hardsub' | 'softsub', mask?: unknown, style?: unknown, advancedOptions?: unknown) =>
      ipcRenderer.invoke('export:start', id, mode, mask ?? null, style ?? null, advancedOptions ?? null),
    // Tách nhạc nền / giọng ra 2 file mp3 bằng Demucs AI
    separateStems: (id: string) => ipcRenderer.invoke('export:separateStems', id),
  },
  asr: {
    checkFasterWhisper: () => ipcRenderer.invoke('asr:checkFasterWhisper'),
  },
  ocr: {
    // Quét phụ đề cứng trong video bằng OCR → tạo file .srt cho tác vụ
    start: (id: string, options?: any) => ipcRenderer.invoke('ocr:start', id, options),
    cancel: (id: string) => ipcRenderer.invoke('ocr:cancel', id),
  },
  tts: {
    start: (
      id: string,
      voice?: string,
      speed?: number,
      voiceOverrides?: Record<string, string>,
      engine?: 'viettts' | 'tiktok' | 'edge'
    ) => ipcRenderer.invoke('tts:start', id, voice, speed, voiceOverrides, engine),
    cancel: (id: string) => ipcRenderer.invoke('tts:cancel', id),
      regenerateLine: (id: string, lineIndex: number, options?: {
        voice?: string; speed?: number; engine?: 'edge' | 'tiktok' | 'viettts'; voiceOverrides?: Record<string, string>
      }) => ipcRenderer.invoke('tts:regenerateLine', id, lineIndex, options),
    exportMergedAudio: (id: string, targetPath?: string, mode?: 'strict' | 'flexible') =>
      ipcRenderer.invoke('tts:export-merged-audio', id, targetPath, mode),
    voices: () => ipcRenderer.invoke('tts:voices'),
    getEdgeVoices: () => ipcRenderer.invoke('tts:getEdgeVoices'),
    checkConnection: () => ipcRenderer.invoke('tts:check-connection'),
    preview: (text: string, voice?: string, speed?: number, engine?: 'viettts' | 'tiktok' | 'edge') =>
      ipcRenderer.invoke('tts:preview', text, voice, speed, engine),
    voiceSamples: () => ipcRenderer.invoke('tts:voice-samples'),
    addVoiceSample: (name: string) => ipcRenderer.invoke('tts:add-voice-sample', name),
    addVoiceSampleFromUrl: (name: string, url: string) =>
      ipcRenderer.invoke('tts:add-voice-sample-from-url', name, url),
    removeVoiceSample: (name: string) => ipcRenderer.invoke('tts:remove-voice-sample', name),
  },
  dubbing: {
    start: (
      id: string,
      replaceAudio: boolean = true,
      options?: { syncMode?: 'strict' | 'flexible' | 'video-stretch'; mixOriginalAudio?: boolean; vocalSeparation?: boolean }
    ) => ipcRenderer.invoke('dubbing:start', id, replaceAudio, options ?? null),
  },
  tiktokTts: {
    // TikTok TTS thử nghiệm — sessionid chỉ đi LÊN main process, không bao giờ
    // có method nào đọc lại giá trị session
    status: () => ipcRenderer.invoke('tiktok-tts:status'),
    saveSession: (sessionId: string) => ipcRenderer.invoke('tiktok-tts:save-session', sessionId),
    removeSession: () => ipcRenderer.invoke('tiktok-tts:remove-session'),
    validate: () => ipcRenderer.invoke('tiktok-tts:validate'),
    voices: () => ipcRenderer.invoke('tiktok-tts:voices'),
    synthesize: (text: string, voice: string) => ipcRenderer.invoke('tiktok-tts:synthesize', text, voice),
  },
  veo: {
    openLobby: () => ipcRenderer.invoke('veo:open-lobby'),
    status: () => ipcRenderer.invoke('veo:status'),
    validate: () => ipcRenderer.invoke('veo:validate'),
    saveSession: (rawInput: string) => ipcRenderer.invoke('veo:save-session', rawInput),
    clearSession: () => ipcRenderer.invoke('veo:clear-session'),
    getAntiSpamStatus: () => ipcRenderer.invoke('veo:get-anti-spam-status'),
    setMode: (mode: 'free_session' | 'api_key' | 'simulation') =>
      ipcRenderer.invoke('veo:set-mode', mode),
    getCredits: (maxAgeMs?: number) => ipcRenderer.invoke('veo:get-credits', maxAgeMs),
    showLobbyDebug: () => ipcRenderer.invoke('veo:show-lobby-debug'),
    hideLobbyOffscreen: () => ipcRenderer.invoke('veo:hide-lobby-offscreen'),
    isLobbyDebug: () => ipcRenderer.invoke('veo:is-lobby-debug'),
    bridgeStatus: () => ipcRenderer.invoke('bridge:status'),
    createPairingCode: () => ipcRenderer.invoke('bridge:create-pairing-code'),
    revokePairing: () => ipcRenderer.invoke('bridge:revoke-pairing'),
    openChrome: (url?: string) => ipcRenderer.invoke('bridge:open-chrome', url),
    openExtensionFolder: () => ipcRenderer.invoke('bridge:open-extension-folder'),
    openChromeExtensionsPage: () => ipcRenderer.invoke('bridge:open-chrome-extensions-page'),
  },
  models: {
    list: () => ipcRenderer.invoke('models:list'),
    delete: (modelName: string) => ipcRenderer.invoke('models:delete', modelName),
    // Thư mục lưu model Whisper trên đĩa — hiển thị vị trí ở trang Cài đặt
    directory: () => ipcRenderer.invoke('models:directory'),
    getSystemInfo: () => ipcRenderer.invoke('system:info'),
    probePythonEnv: () => ipcRenderer.invoke('system:probePythonEnv'),
  },
  dialog: {
    openMediaFile: () => ipcRenderer.invoke('dialog:openMediaFile'),
    openVideoFile: () => ipcRenderer.invoke('dialog:openVideoFile'),
    openSrtFile: () => ipcRenderer.invoke('dialog:openSrtFile'),
    openImageFile: () => ipcRenderer.invoke('dialog:openImageFile'),
    openAudioFile: () => ipcRenderer.invoke('dialog:openAudioFile'),
    showInFolder: (filePath: string) => ipcRenderer.invoke('dialog:showInFolder', filePath),
    openFolder: (folderPath: string) => ipcRenderer.invoke('dialog:openFolder', folderPath),
    chooseDirectory: () => ipcRenderer.invoke('dialog:chooseDirectory'),
  },
  downloader: {
    inspect: (url: string) => ipcRenderer.invoke('downloader:inspect', url),
    download: (options: { url: string; quality?: string; noWatermarkUrl?: string; outputDir?: string; customFileName?: string; downloadId?: string; cleanMetadata?: boolean }) =>
      ipcRenderer.invoke('downloader:download', options),
    cancel: (downloadId?: string) => ipcRenderer.invoke('downloader:cancel', downloadId),
    checkTask: (taskId: string, target: 'source' | 'output') => ipcRenderer.invoke('downloader:checkTask', taskId, target),
    cancelCheck: (taskId: string) => ipcRenderer.invoke('downloader:cancelCheck', taskId),
    getDefaultDir: () => ipcRenderer.invoke('downloader:getDefaultDir'),
    onProgress: (callback: (progress: any) => void) => {
      const handler = (_event: unknown, progress: any) => callback(progress);
      ipcRenderer.on('downloader:progress', handler);
      return () => ipcRenderer.removeListener('downloader:progress', handler);
    },
  },
  files: {
    // Electron >=32 đã bỏ File.path — phải lấy đường dẫn qua webUtils ở phía renderer
    getPath: (file: File) => webUtils.getPathForFile(file),
    readImageAsDataUrl: (filePath: string) => ipcRenderer.invoke('files:readImageAsDataUrl', filePath),
  },
  logs: {
    // Đăng ký nhận log từ main process; trả về hàm huỷ đăng ký
    onLog: (callback: (entry: { level: string; text: string; ts: number }) => void) => {
      const handler = (_event: unknown, entry: { level: string; text: string; ts: number }) =>
        callback(entry);
      ipcRenderer.on('app:log', handler);
      return () => ipcRenderer.removeListener('app:log', handler);
    },
  },
  workflow: {
    run: (graph: any) => ipcRenderer.invoke('workflow:run', graph),
    runNode: (graph: any, nodeId: string) => ipcRenderer.invoke('workflow:runNode', graph, nodeId),
    cancel: (workflowId: string) => ipcRenderer.invoke('workflow:cancel', workflowId),
    compareFrames: (frameA: string, frameB: string, config?: any) =>
      ipcRenderer.invoke('workflow:compareFrames', frameA, frameB, config),
    concatClips: (clipPaths: string[], outPath?: string) =>
      ipcRenderer.invoke('workflow:concatClips', clipPaths, outPath),
    getVideoDuration: (videoPath: string) =>
      ipcRenderer.invoke('workflow:getVideoDuration', videoPath),
    getTempStorageStats: () => ipcRenderer.invoke('workflow:getTempStorageStats'),
    cleanTempCache: (maxAgeHours?: number) => ipcRenderer.invoke('workflow:cleanTempCache', maxAgeHours),
    onNodeEvent: (callback: (event: any) => void) => {
      const sub = (_event: any, data: any) => callback(data);
      ipcRenderer.on('workflow:node-event', sub);
      return () => {
        ipcRenderer.removeListener('workflow:node-event', sub);
      };
    },
  },
  bible: {
    getCharacters: () => ipcRenderer.invoke('bible:getCharacters'),
    saveCharacter: (profile: any) => ipcRenderer.invoke('bible:saveCharacter', profile),
    deleteCharacter: (id: string) => ipcRenderer.invoke('bible:deleteCharacter', id),
    getScenes: () => ipcRenderer.invoke('bible:getScenes'),
    saveScene: (profile: any) => ipcRenderer.invoke('bible:saveScene', profile),
    deleteScene: (id: string) => ipcRenderer.invoke('bible:deleteScene', id),
  },
  aiStudio: {
    saveManualSeo: (input: any) => ipcRenderer.invoke('aiStudio:manualSeo:save', input),
    getPiperStatus: () => ipcRenderer.invoke('aiStudio:voices:piperStatus'),
    connectFlowReadOnly: () => ipcRenderer.invoke('aiStudio:flow:connectReadOnly'),
    getReadiness: () => ipcRenderer.invoke('aiStudio:readiness'),
    getMediaReadiness: (payload?:{sessionId?:string}) => ipcRenderer.invoke('aiStudio:media:readiness',payload),
    getKokoroVoices: () => ipcRenderer.invoke('aiStudio:voices:kokoro'),
    // Configuration (Milestone 1)
    getConfig: () => ipcRenderer.invoke('aiStudio:config:get'),
    updateConfig: (updates: any) => ipcRenderer.invoke('aiStudio:config:set', updates),
    resetConfig: () => ipcRenderer.invoke('aiStudio:config:reset'),

    // Configuration Aliases
    get: () => ipcRenderer.invoke('aiStudio:config:get'),
    set: (updates: any) => ipcRenderer.invoke('aiStudio:config:set', updates),
    reset: () => ipcRenderer.invoke('aiStudio:config:reset'),

    // Pipeline Execution (Milestone 2)
    startManualMedia: (payload: { projectId: string; srtPath: string; audioPath: string }) => ipcRenderer.invoke('aiStudio:pipeline:startManualMedia', payload),
    startPipeline: (payload: { topic: string; options?: any }) =>
      ipcRenderer.invoke('aiStudio:pipeline:start', payload),
    resumePipeline: (payload: {
      sessionId: string;
      fromStage?: number;
      mode?: 'resume_missing' | 'regenerate_selected' | 'regenerate_all';
      selectedShotIds?: string[];
      updatedArtifacts?: any;
    }) => ipcRenderer.invoke('aiStudio:pipeline:resume', payload),
    cancelPipeline: (payload: { sessionId: string }) =>
      ipcRenderer.invoke('aiStudio:pipeline:cancel', payload),
    getPipelineState: (payload: { sessionId: string }) =>
      ipcRenderer.invoke('aiStudio:pipeline:getState', payload),
    updateSceneFillMode: (payload: {
      sessionId: string;
      sceneIds?: string[];
      fillMode: 'freeze_last_frame' | 'none';
    }) => ipcRenderer.invoke('aiStudio:scene:updateFillMode', payload),

    // Granular Step Operations (Milestone 2)
    renderSingleLineVoice: (payload: { lineIndex: number; text: string; voiceConfig: any }) =>
      ipcRenderer.invoke('aiStudio:step:renderSingleLineVoice', payload),
    regenerateSceneAsset: (payload: { sceneId: string; visualPrompt: string; flowConfig?: any; sessionId?: string; mode?: 'image' | 'video' | 'both' }) =>
      ipcRenderer.invoke('aiStudio:step:regenerateSceneAsset', payload),
    importSceneMedia: (payload: { sessionId: string; sceneId: string; filePath: string; mediaType?: 'image' | 'video' }) =>
      ipcRenderer.invoke('aiStudio:step:importSceneMedia', payload),
    renderVideo: (payload: { sessionId: string; customSettings?: any }) =>
      ipcRenderer.invoke('aiStudio:step:renderVideo', payload),

    // Chế độ từng bước & Tự động điền ý tưởng
    autoFillIdea: (payload: { topic: string; aspectRatio?: '16:9' | '9:16'; channelProfile?: any }) =>
      ipcRenderer.invoke('aiStudio:idea:autoFill', payload),
    approveStage: (payload: { sessionId: string; currentStage: number; updatedArtifacts?: any }) =>
      ipcRenderer.invoke('aiStudio:pipeline:approveStage', payload),
    generateMasterPrompt: (payload: { channelProfile: any }) =>
      ipcRenderer.invoke('aiStudio:channel:generateMasterPrompt', payload),

    // Chấm điểm kịch bản & Chỉnh sửa kịch bản bằng AI
    evaluateScript: (payload: { sessionId?: string; lines: any[]; blueprint?: any; channelProfile?: any }) =>
      ipcRenderer.invoke('aiStudio:script:evaluate', payload),
    refineScript: (payload: { sessionId?: string; lines: any[]; instructions?: string; mode?: string; blueprint?: any; channelProfile?: any }) =>
      ipcRenderer.invoke('aiStudio:script:refine', payload),
    updateScriptLines: (payload: { sessionId: string; lines: any[] }) =>
      ipcRenderer.invoke('aiStudio:script:updateLines', payload),

    // ChatGPT Web Automation (Zero API Cost Mode)
    checkChatGptLogin: () => ipcRenderer.invoke('aiStudio:chatgpt:checkLogin'),
    openChatGptLogin: () => ipcRenderer.invoke('aiStudio:chatgpt:openLogin'),
    closeChatGptLogin: () => ipcRenderer.invoke('aiStudio:chatgpt:closeLogin'),
    logoutChatGptLogin: () => ipcRenderer.invoke('aiStudio:chatgpt:logout'),

    // Gemini Web Automation (Zero API Cost Mode)
    checkGeminiLogin: () => ipcRenderer.invoke('aiStudio:gemini:checkLogin'),
    openGeminiLogin: () => ipcRenderer.invoke('aiStudio:gemini:openLogin'),
    closeGeminiLogin: () => ipcRenderer.invoke('aiStudio:gemini:closeLogin'),
    logoutGeminiLogin: () => ipcRenderer.invoke('aiStudio:gemini:logout'),

    // 1-Click Self-Test Diagnostics (Milestone 3)
    selfTestDiagnostics: () => ipcRenderer.invoke('aiStudio:diagnostics:selfTest'),

    // 1-Click CapCut Desktop Draft Export (Milestone 5)
    exportCapcutDraft: (payload: any, targetDir?: string) =>
      ipcRenderer.invoke('aiStudio:export:capcutDraft', payload, targetDir),

    // Push Event Subscription (Returns unsubscribe function)
    onPipelineProgress: (callback: (event: any) => void) => {
      const subscription = (_event: any, data: any) => callback(data);
      ipcRenderer.on('aiStudio:pipeline:progress', subscription);
      return () => {
        ipcRenderer.removeListener('aiStudio:pipeline:progress', subscription);
      };
    },
    onProgress: (callback: (event: any) => void) => {
      const subscription = (_event: any, data: any) => callback(data);
      ipcRenderer.on('aiStudio:pipeline:progress', subscription);
      return () => {
        ipcRenderer.removeListener('aiStudio:pipeline:progress', subscription);
      };
    },
  },
}

const handler = {
  send(channel: string, value: string) {
    ipcRenderer.send(channel, value)
  },
  on(channel: string, callback: (...args: unknown[]) => void) {
    const subscription = (_event: any, ...args: unknown[]) => callback(...args)
    ipcRenderer.on(channel, subscription)

    return () => {
      ipcRenderer.removeListener(channel, subscription)
    }
  },
}

contextBridge.exposeInMainWorld('vanhsub', vanhsub)
contextBridge.exposeInMainWorld('ipc', handler)

// ── [DEBUG] Tạm thời — xóa sau khi Giai đoạn 1 xác nhận ──────────────────
if (process.env.NODE_ENV !== 'production') contextBridge.exposeInMainWorld('debug', {
  testRpcPhase1: (projectId: string) =>
    ipcRenderer.invoke('debug:test-rpc-phase1', projectId),
  testUploadImage: (filePath: string, projectId: string) =>
    ipcRenderer.invoke('debug:test-upload-image', filePath, projectId),
  testGenImage: (prompt: string, projectId: string, refMediaIds?: string[]) =>
    ipcRenderer.invoke('debug:test-gen-image', prompt, projectId, refMediaIds),
  testGenVideo: (prompt: string, projectId: string, sourceImagePath?: string) =>
    ipcRenderer.invoke('debug:test-gen-video', prompt, projectId, sourceImagePath),
  testFsmImage: (prompt: string, projectId: string) =>
    ipcRenderer.invoke('debug:test-fsm-image', prompt, projectId),
  testFsmVideo: (prompt?: string, projectId?: string, sourceImagePath?: string) =>
    ipcRenderer.invoke('debug:test-fsm-video', prompt, projectId, sourceImagePath),
  diagnoseLobby: () =>
    ipcRenderer.invoke('debug:diagnose-lobby'),
  prewarmLobby: (projectId: string) =>
    ipcRenderer.invoke('debug:prewarm-lobby', projectId),
  bridgeStatus: () =>
    ipcRenderer.invoke('bridge:status'),
  reloadBridge: () =>
    ipcRenderer.invoke('bridge:reload'),
  reloadTab: () =>
    ipcRenderer.invoke('bridge:reload-tab'),
  tabEval: (code: string) =>
    ipcRenderer.invoke('bridge:eval', code),
  inspectDom: () =>
    ipcRenderer.invoke('bridge:inspect-dom'),
  /** @deprecated DOM Native UI Trigger đã bị loại bỏ, ưu tiên Pure RPC */
  triggerUiGen: (prompt: string) =>
    ipcRenderer.invoke('bridge:trigger-ui-gen', prompt),
})
// ── [END DEBUG] ──────────────────────────────────────────────────────────────
