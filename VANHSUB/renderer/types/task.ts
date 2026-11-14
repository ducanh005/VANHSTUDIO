export type TaskStatus = 'queued' | 'transcribing' | 'ocr' | 'translating' | 'exporting' | 'dubbing' | 'done' | 'error' | 'cancelled';

export type WorkflowType = 'full-dubbing' | 'bilingual-sub' | 'fast-transcribe' | 'custom';

import type { MediaInspection } from '../../shared/mediaInspection';

export interface Task {
  mediaInspection?: MediaInspection;
  outputInspection?: MediaInspection;
  cleanTechnicalMetadata?: boolean;
  originalFilePath?: string;
  id: string;
  fileName: string;
  filePath: string;
  fileSize?: string;
  duration?: string;
  workflow: WorkflowType;
  status: TaskStatus;
  progress: number;
  stageDescription?: string;
  sourceLanguage?: string;
  targetLanguage?: string;
  asrModel?: string;
  asrEngine?: 'faster-whisper' | 'whisper-cpp';
  enableDiarization?: boolean;
  speakerCount?: number;
  speakers?: string[];
  srtPath?: string;
  translatedSrtPath?: string;
  overlaySrtPath?: string;
  translatedOverlaySrtPath?: string;
  subtitleRevision?: number;
  ttsNeedsRegeneration?: boolean;
  dubbingPreferences?: import('../../main/lib/dubbingPreferences').DubbingPreferences;
  audioPath?: string;
  outputPath?: string;
  dubbedVideoPath?: string;
  dubbedVideoStretchFactor?: number;
  /** Thư mục dự án gom toàn bộ file liên quan đến video này */
  projectDir?: string;
  errorMessage?: string;
  // TTS / Dubbing fields
  ttsVoice?: string;
  ttsSpeed?: number;
  /** Engine tạo audio: 'viettts', 'tiktok', hoặc 'edge' */
  ttsEngine?: 'viettts' | 'tiktok' | 'edge';
  ttsAudioDir?: string;
  /** Đường dẫn file MP3 lồng tiếng tổng hợp chuẩn xác theo timeline dự án */
  ttsMergedAudioPath?: string;
  /** Gán giọng riêng theo dòng phụ đề: key = số dòng SRT (chuỗi), value = tên giọng */
  ttsVoiceOverrides?: Record<string, string>;
  /** Các câu TTS tràn thời lượng khung của nó (cập nhật sau mỗi lần dubbing) */
  ttsOverruns?: { index: number; tempo: number; truncated: boolean }[];
  /** Thống kê OCR (frames, detections, duplicates merged, confidence scoring) */
  ocrStats?: {
    framesScanned: number;
    detections: number;
    trackedGroups: number;
    duplicatesRemoved: number;
    finalEvents: number;
    highConfidence: number;
    needsReview: number;
    aiCorrected?: number;
  };
  createdAt: string;
  updatedAt: string;
}

export type CreateTaskInput = Partial<Omit<Task, 'id' | 'createdAt' | 'updatedAt'>> & {
  fileName: string;
  filePath: string;
};
