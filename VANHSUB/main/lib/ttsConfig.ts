export type TtsEngine = 'edge' | 'tiktok' | 'viettts';

/** Recognize the installed Vietnamese Piper voice, Edge IDs and TikTok IDs. */
export function engineForVoice(voice: string): TtsEngine {
  if (voice.startsWith('vi_VN-')) return 'viettts';
  return voice.endsWith('Neural') ? 'edge' : 'tiktok';
}

export function resolveTtsEngine(voice: string, saved?: TtsEngine, explicit?: TtsEngine): TtsEngine {
  return explicit || (saved === 'viettts' ? saved : engineForVoice(voice));
}
