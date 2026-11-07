import { create } from 'zustand';
import {
  AiStudioConfig,
  DEFAULT_AI_STUDIO_CONFIG,
  DEFAULT_CHANNEL_PROFILE_CONFIG,
  DeepPartial,
  AiStudioLlmConfig,
  AiStudioVoiceConfig,
  AiStudioFlowEngineConfig,
  AiStudioRenderingConfig,
  AiStudioSubtitleConfig,
  ChannelProfileConfig,
  SavedProjectProfile,
} from '../../types/aiStudio';

// ============================================================================
// PURE UTILITY FUNCTIONS (MERGE & CLONE)
// ============================================================================

/**
 * Tạo một bản sao độc lập (Deep Clone) của DEFAULT_AI_STUDIO_CONFIG
 * để không bao giờ làm đột biến hằng số gốc.
 */
export function cloneDefaultAiStudioConfig(): AiStudioConfig {
  return JSON.parse(JSON.stringify(DEFAULT_AI_STUDIO_CONFIG));
}

/**
 * Trích xuất Google Flow Project ID từ URL đầy đủ hoặc chuỗi UUID/ID thuần.
 */
export function extractFlowProjectId(flowProjectUrl?: string): string {
  const raw = (flowProjectUrl || '').trim();
  if (!raw || raw === '__PROJECT_ID_SLOT__') return '';
  const match = raw.match(/\/project\/([a-zA-Z0-9_-]+)/);
  if (match && match[1]) return match[1];
  if (!raw.includes('/') && !raw.includes(' ')) return raw;
  return '';
}

/**
 * Trộn một phần cấu hình (DeepPartial) vào cấu hình cơ sở một cách an toàn.
 * Bảo toàn tất cả các thuộc tính lồng nhau trong các phân hệ cấu hình.
 */
export function mergeAiStudioConfig(
  base: AiStudioConfig,
  patch: DeepPartial<AiStudioConfig>
): AiStudioConfig {
  const nextOutputDir =
    typeof patch.outputDir === 'string'
      ? patch.outputDir
      : typeof base.outputDir === 'string'
      ? base.outputDir
      : undefined;

  const nextFlowProjectUrl =
    typeof patch.flowProjectUrl === 'string'
      ? patch.flowProjectUrl
      : typeof base.flowProjectUrl === 'string'
      ? base.flowProjectUrl
      : undefined;

  return {
    llm: {
      ...base.llm,
      ...(patch.llm?.provider && patch.llm.provider !== base.llm.provider
        ? { apiKey: '', model: '', baseUrl: undefined }
        : {}),
      ...(patch.llm || {}),
    },
    voice: {
      ...base.voice,
      ...(patch.voice || {}),
    },
    flowEngine: {
      ...base.flowEngine,
      ...(patch.flowEngine || {}),
    },
    rendering: {
      ...base.rendering,
      ...(patch.rendering || {}),
    },
    subtitles: {
      ...base.subtitles,
      ...(patch.subtitles || {}),
    },
    channelProfile: {
      ...(base.channelProfile || DEFAULT_AI_STUDIO_CONFIG.channelProfile || ({} as any)),
      ...(patch.channelProfile || {}),
    },
    savedProjects: Array.isArray(patch.savedProjects)
      ? (patch.savedProjects as SavedProjectProfile[])
      : (base.savedProjects || []),
    activeProjectId: typeof patch.activeProjectId === 'string'
      ? patch.activeProjectId
      : (base.activeProjectId || ''),
    ...(nextOutputDir !== undefined ? { outputDir: nextOutputDir } : {}),
    ...(nextFlowProjectUrl !== undefined ? { flowProjectUrl: nextFlowProjectUrl } : {}),
  };
}

/**
 * Kiểm tra xem môi trường hiện tại có cầu nối Electron IPC (preload) khả dụng hay không.
 */
function isElectronAiStudioAvailable(): boolean {
  return (
    typeof window !== 'undefined' &&
    typeof window.vanhsub !== 'undefined' &&
    Boolean(window.vanhsub.aiStudio)
  );
}

// ============================================================================
// STORE INTERFACES
// ============================================================================

export interface AiStudioStoreState {
  /** Toàn bộ đối tượng cấu hình AI Studio hiện tại */
  config: AiStudioConfig;
  /** Trạng thái đang tải cấu hình từ Main process hoặc đang reset */
  isLoading: boolean;
  /** Trạng thái đang lưu cấu hình xuống đĩa qua Main process */
  isSaving: boolean;
  /** Thông điệp lỗi gần nhất (nếu có); null nếu hoạt động bình thường */
  error: string | null;
  /** Đánh dấu cấu hình đã được nạp thành công ít nhất một lần */
  hasLoaded: boolean;
  /** Đang ở bên trong không gian làm việc của Project hay màn hình thiết lập ngoài */
  isProjectEntered: boolean;
}

export interface AiStudioStoreActions {
  /** Nạp cấu hình từ Electron Main; fallback về mặc định nếu ở Browser */
  loadConfig: () => Promise<AiStudioConfig>;
  /** Cập nhật một phần cấu hình, đồng bộ 2 chiều với Main */
  updateConfig: (partial: DeepPartial<AiStudioConfig>) => Promise<boolean>;
  /** Đặt lại toàn bộ cấu hình về giá trị mặc định của hệ thống */
  resetConfig: () => Promise<boolean>;
  /** Ghi nhận hoặc xoá trạng thái lỗi */
  setError: (err: string | null) => void;
  /** Chuyển đổi trạng thái vào/ra project */
  setProjectEntered: (entered: boolean) => void;

  // Tiện ích cập nhật riêng lẻ từng phân hệ (Sub-configuration Helpers)
  updateLlmConfig: (partial: Partial<AiStudioLlmConfig>) => Promise<boolean>;
  updateVoiceConfig: (partial: Partial<AiStudioVoiceConfig>) => Promise<boolean>;
  updateFlowConfig: (partial: Partial<AiStudioFlowEngineConfig>) => Promise<boolean>;
  updateRenderingConfig: (partial: Partial<AiStudioRenderingConfig>) => Promise<boolean>;
  updateSubtitleConfig: (partial: Partial<AiStudioSubtitleConfig>) => Promise<boolean>;
  updateChannelProfileConfig: (partial: Partial<ChannelProfileConfig>) => Promise<boolean>;

  // Quản lý lưu trữ & Chuyển đổi nhiều Project
  saveProject: (project: SavedProjectProfile) => Promise<boolean>;
  deleteProject: (projectId: string) => Promise<boolean>;
  switchProject: (projectId: string) => Promise<boolean>;
  getActiveProject: () => SavedProjectProfile | null;
  isProjectSetupComplete: (proj?: SavedProjectProfile | null) => { isComplete: boolean; missing: string[] };
  saveActiveProjectData: (
    data: Partial<Pick<SavedProjectProfile, 'ideas' | 'selectedIdea' | 'lastSessionId' | 'savedSession'>>,
    targetProjectId?: string
  ) => Promise<boolean>;
}

export type AiStudioStore = AiStudioStoreState & AiStudioStoreActions;

// ============================================================================
// ZUSTAND STORE IMPLEMENTATION
// ============================================================================

export const useAiStudioStore = create<AiStudioStore>((set, get) => ({
  // Khởi tạo state ban đầu an toàn
  config: cloneDefaultAiStudioConfig(),
  isLoading: false,
  isSaving: false,
  error: null,
  hasLoaded: false,
  isProjectEntered: false,

  setProjectEntered: (entered: boolean) => set({ isProjectEntered: entered }),

  /**
   * Đọc cấu hình từ Main process qua IPC bridge `window.vanhsub.aiStudio.getConfig()`.
   * Nếu đang ở Browser dev mode, giữ nguyên giá trị mặc định mà không báo lỗi.
   */
  loadConfig: async (): Promise<AiStudioConfig> => {
    set({ isLoading: true, error: null });

    if (!isElectronAiStudioAvailable()) {
      if (process.env.NODE_ENV !== 'production') {
        console.debug(
          '[useAiStudioStore] window.vanhsub.aiStudio không tồn tại. Sử dụng cấu hình mặc định (Browser Dev Mode).'
        );
      }
      set({ isLoading: false, hasLoaded: true });
      return get().config;
    }

    try {
      const bridge = window.vanhsub.aiStudio;
      // Hỗ trợ cả method chuẩn getConfig và alias get
      const fetchFn = bridge.getConfig || bridge.get;
      if (typeof fetchFn !== 'function') {
        throw new Error('IPC method aiStudio.getConfig không khả dụng trên preload bridge.');
      }

      const remoteConfig = await fetchFn();
      if (remoteConfig && typeof remoteConfig === 'object') {
        // Hợp nhất với default config để phòng trường hợp dữ liệu cũ thiếu key
        const merged = mergeAiStudioConfig(cloneDefaultAiStudioConfig(), remoteConfig);
        set({
          config: merged,
          isLoading: false,
          hasLoaded: true,
          error: null,
        });
        return merged;
      }

      set({ isLoading: false, hasLoaded: true });
      return get().config;
    } catch (err: any) {
      const errorMsg = err?.message || 'Không thể tải cấu hình AI Studio từ Main process.';
      console.error('[useAiStudioStore.loadConfig] Lỗi:', err);
      set({
        isLoading: false,
        hasLoaded: true, // Vẫn đánh dấu hasLoaded để không gây block vòng lặp UI
        error: errorMsg,
      });
      return get().config;
    }
  },

  /**
   * Cập nhật cấu hình:
   * 1. Cập nhật lạc quan (Optimistic update) trên Zustand store ngay lập tức.
   * 2. Nếu có Electron Main, gửi payload partial xuống qua IPC để lưu vào electron-store.
   * 3. Nhận lại cấu hình chính thống từ Main để cập nhật lại store.
   */
  updateConfig: async (partial: DeepPartial<AiStudioConfig>): Promise<boolean> => {
    if (!partial || typeof partial !== 'object') {
      return false;
    }

    // 1. Optimistic Update cục bộ
    const currentConfig = get().config;
    const optimisticConfig = mergeAiStudioConfig(currentConfig, partial);
    set({
      config: optimisticConfig,
      isSaving: true,
      error: null,
    });

    // 2. Kiểm tra môi trường Browser Dev
    if (!isElectronAiStudioAvailable()) {
      set({ isSaving: false });
      return true;
    }

    // 3. Đồng bộ với Electron Main Process
    try {
      const bridge = window.vanhsub.aiStudio;
      const saveFn = bridge.updateConfig || bridge.set;
      if (typeof saveFn !== 'function') {
        throw new Error('IPC method aiStudio.updateConfig không khả dụng trên preload bridge.');
      }

      const savedConfig = await saveFn(partial);
      if (savedConfig && typeof savedConfig === 'object') {
        const validatedConfig = mergeAiStudioConfig(cloneDefaultAiStudioConfig(), savedConfig);
        set({
          config: validatedConfig,
          isSaving: false,
          error: null,
        });
      } else {
        set({ isSaving: false });
      }
      return true;
    } catch (err: any) {
      const errorMsg = err?.message || 'Lỗi khi lưu cấu hình AI Studio xuống đĩa.';
      console.error('[useAiStudioStore.updateConfig] Lỗi:', err);
      // Roll back optimistic update to pre-update state
      set({
        config: currentConfig,
        isSaving: false,
        error: errorMsg,
      });
      return false;
    }
  },

  /**
   * Đặt lại toàn bộ cấu hình về giá trị mặc định:
   * Gọi IPC `resetConfig()` nếu có Electron, hoặc khôi phục in-memory nếu ở Browser.
   */
  resetConfig: async (): Promise<boolean> => {
    const currentConfig = get().config;
    set({ isLoading: true, error: null });

    const defaultConfig = cloneDefaultAiStudioConfig();

    if (!isElectronAiStudioAvailable()) {
      set({
        config: defaultConfig,
        isLoading: false,
        error: null,
      });
      return true;
    }

    try {
      const bridge = window.vanhsub.aiStudio;
      const resetFn = bridge.resetConfig || bridge.reset;
      if (typeof resetFn !== 'function') {
        throw new Error('IPC method aiStudio.resetConfig không khả dụng trên preload bridge.');
      }

      const result = await resetFn();
      const finalConfig =
        result && typeof result === 'object'
          ? mergeAiStudioConfig(cloneDefaultAiStudioConfig(), result)
          : defaultConfig;

      set({
        config: finalConfig,
        isLoading: false,
        error: null,
      });
      return true;
    } catch (err: any) {
      const errorMsg = err?.message || 'Lỗi khi đặt lại cấu hình AI Studio mặc định.';
      console.error('[useAiStudioStore.resetConfig] Lỗi:', err);
      set({
        config: currentConfig,
        isLoading: false,
        error: errorMsg,
      });
      return false;
    }
  },

  /**
   * Đặt hoặc xóa thông điệp lỗi trên store.
   */
  setError: (err: string | null) => {
    set({ error: err });
  },

  // ==========================================================================
  // CONVENIENCE SECTION HELPERS
  // ==========================================================================

  updateLlmConfig: async (partial: Partial<AiStudioLlmConfig>): Promise<boolean> => {
    return get().updateConfig({ llm: partial });
  },

  updateVoiceConfig: async (partial: Partial<AiStudioVoiceConfig>): Promise<boolean> => {
    return get().updateConfig({ voice: partial });
  },

  updateFlowConfig: async (partial: Partial<AiStudioFlowEngineConfig>): Promise<boolean> => {
    return get().updateConfig({ flowEngine: partial });
  },

  updateRenderingConfig: async (partial: Partial<AiStudioRenderingConfig>): Promise<boolean> => {
    return get().updateConfig({ rendering: partial });
  },

  updateSubtitleConfig: async (partial: Partial<AiStudioSubtitleConfig>): Promise<boolean> => {
    return get().updateConfig({ subtitles: partial });
  },

  updateChannelProfileConfig: async (partial: Partial<ChannelProfileConfig>): Promise<boolean> => {
    return get().updateConfig({ channelProfile: partial });
  },

  // ==========================================================================
  // MULTI-PROJECT MANAGEMENT (LƯU TỪNG PROJECT & CHUYỂN ĐỔI)
  // ==========================================================================

  saveProject: async (project: SavedProjectProfile): Promise<boolean> => {
    const currentConfig = get().config;
    const existingList = currentConfig.savedProjects || [];
    const index = existingList.findIndex((p) => p.id === project.id);

    let updatedList: SavedProjectProfile[];
    if (index >= 0) {
      updatedList = [...existingList];
      // Merge with existing project data so ideas, selectedIdea, lastSessionId, savedSession are preserved!
      updatedList[index] = {
        ...existingList[index],
        ...project,
        updatedAt: Date.now(),
      };
    } else {
      updatedList = [{ ...project, updatedAt: Date.now() }, ...existingList];
    }

    const extractedFlowId = extractFlowProjectId(project.flowProjectUrl);
    const patch: DeepPartial<AiStudioConfig> = {
      savedProjects: updatedList,
      activeProjectId: project.id,
      channelProfile: project.channelProfile,
      outputDir: project.outputDir,
      flowProjectUrl: project.flowProjectUrl || '',
      flowEngine: {
        ...(project.flowConfig?.aspectRatio ? { aspectRatio: project.flowConfig.aspectRatio } : {}),
        projectId: extractedFlowId,
        projectName: project.name || '',
      },
    };

    if (project.channelProfile.aiProvider && project.channelProfile.aiProvider !== 'default') {
      patch.llm = { provider: project.channelProfile.aiProvider as any };
    }

    return get().updateConfig(patch);
  },

  deleteProject: async (projectId: string): Promise<boolean> => {
    const currentConfig = get().config;
    const existingList = currentConfig.savedProjects || [];
    const updatedList = existingList.filter((p) => p.id !== projectId);

    const patch: DeepPartial<AiStudioConfig> = {
      savedProjects: updatedList,
    };

    if (currentConfig.activeProjectId === projectId) {
      if (updatedList.length > 0) {
        const nextActive = updatedList[0];
        const nextFlowId = extractFlowProjectId(nextActive.flowProjectUrl);
        patch.activeProjectId = nextActive.id;
        patch.channelProfile = nextActive.channelProfile;
        patch.outputDir = nextActive.outputDir;
        patch.flowProjectUrl = nextActive.flowProjectUrl || '';
        patch.flowEngine = {
          ...(nextActive.flowConfig?.aspectRatio ? { aspectRatio: nextActive.flowConfig.aspectRatio } : {}),
          projectId: nextFlowId,
          projectName: nextActive.name || '',
        };
        if (nextActive.channelProfile.aiProvider && nextActive.channelProfile.aiProvider !== 'default') {
          patch.llm = { provider: nextActive.channelProfile.aiProvider as any };
        }
      } else {
        patch.activeProjectId = '';
        patch.channelProfile = { ...DEFAULT_CHANNEL_PROFILE_CONFIG };
        patch.outputDir = '';
        patch.flowProjectUrl = '';
        patch.flowEngine = {
          projectId: '',
          projectName: '',
        };
      }
    }

    return get().updateConfig(patch);
  },

  switchProject: async (projectId: string): Promise<boolean> => {
    if (!projectId) {
      return get().updateConfig({
        activeProjectId: '',
        outputDir: '',
        flowProjectUrl: '',
        flowEngine: {
          projectId: '',
          projectName: '',
        },
      });
    }
    const currentConfig = get().config;
    const existingList = currentConfig.savedProjects || [];
    const target = existingList.find((p) => p.id === projectId);
    if (!target) return false;

    const extractedFlowId = extractFlowProjectId(target.flowProjectUrl);
    const patch: DeepPartial<AiStudioConfig> = {
      activeProjectId: target.id,
      channelProfile: target.channelProfile,
      outputDir: target.outputDir,
      flowProjectUrl: target.flowProjectUrl || '',
      flowEngine: {
        ...(target.flowConfig?.aspectRatio ? { aspectRatio: target.flowConfig.aspectRatio } : {}),
        projectId: extractedFlowId,
        projectName: target.name || '',
      },
    };

    if (target.channelProfile.aiProvider && target.channelProfile.aiProvider !== 'default') {
      patch.llm = { provider: target.channelProfile.aiProvider as any };
    }

    return get().updateConfig(patch);
  },

  getActiveProject: (): SavedProjectProfile | null => {
    const currentConfig = get().config;
    const existingList = currentConfig.savedProjects || [];
    if (!currentConfig.activeProjectId) {
      return null;
    }
    return existingList.find((p) => p.id === currentConfig.activeProjectId) || null;
  },

  isProjectSetupComplete: (proj?: SavedProjectProfile | null): { isComplete: boolean; missing: string[] } => {
    const target = proj !== undefined ? proj : get().getActiveProject();
    if (!target) {
      return { isComplete: false, missing: ['Chưa tạo hoặc chọn dự án'] };
    }
    const missing: string[] = [];
    if (!target.name?.trim()) {
      missing.push('Tên đề tài / Tên kênh');
    }
    if (!target.outputDir?.trim()) {
      missing.push('Thư mục xuất file (Output Folder)');
    }
    if (!target.channelProfile?.channelNiche?.trim()) {
      missing.push('Chủ đề Kênh (Niche)');
    }
    return {
      isComplete: missing.length === 0,
      missing,
    };
  },

  saveActiveProjectData: async (
    data: Partial<Pick<SavedProjectProfile, 'ideas' | 'selectedIdea' | 'lastSessionId' | 'savedSession'>>,
    targetProjectId?: string
  ): Promise<boolean> => {
    const currentConfig = get().config;
    const existingList = currentConfig.savedProjects || [];
    const activeId = targetProjectId || currentConfig.activeProjectId || existingList[0]?.id;
    if (!activeId) return false;

    const index = existingList.findIndex((p) => p.id === activeId);
    if (index < 0) return false;

    const updatedList = [...existingList];
    updatedList[index] = {
      ...updatedList[index],
      ...data,
      updatedAt: Date.now(),
    };

    return get().updateConfig({
      savedProjects: updatedList,
      ...(activeId === currentConfig.activeProjectId ? { activeProjectId: activeId } : {}),
    });
  },
}));
