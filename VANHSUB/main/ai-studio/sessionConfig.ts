import { decryptSecret, encryptSecret } from '../store/aiStudioStore';
import type { AiStudioConfig, AiStudioSessionConfig, PartialAiStudioConfig, IdeaBlueprint } from './types';
import { selectLlmProvider } from './llmProviderConfig';

/** Resolve project defaults and explicit overrides once, before production starts. */
export function resolveProductionConfig(
  base: AiStudioConfig,
  options: PartialAiStudioConfig = {},
  blueprint?: IdeaBlueprint
): AiStudioConfig {
  const merged: AiStudioConfig = {
    ...base,
    llm: { ...selectLlmProvider(base.llm, options.llm?.provider), ...options.llm },
    voice: { ...base.voice, ...options.voice },
    flowEngine: { ...base.flowEngine, ...options.flowEngine },
    rendering: { ...base.rendering, ...options.rendering },
    subtitles: { ...base.subtitles, ...options.subtitles },
    channelProfile: { ...base.channelProfile, ...options.channelProfile } as AiStudioConfig['channelProfile'],
  };
  const channel = merged.channelProfile;
  if (channel) {
    if (options.llm?.provider && !options.channelProfile?.aiProvider) {
      channel.aiProvider = options.llm.provider === 'custom' ? 'default' : options.llm.provider;
    }
    merged.llm = selectLlmProvider(merged.llm, channel.aiProvider);
    // Explicit voice overrides must not be overridden again by the channel at Stage 3.
    const inferredVoiceProvider = options.voice?.voiceId?.endsWith('Neural') ? 'edge_tts'
      : options.voice?.voiceId && /^(BV0|en_)/.test(options.voice.voiceId) ? 'tiktok_tts' : undefined;
    const explicitVoiceProvider = options.voice?.provider || inferredVoiceProvider;
    if (explicitVoiceProvider) {
      merged.voice.provider = explicitVoiceProvider;
      if (explicitVoiceProvider === 'edge_tts' || explicitVoiceProvider === 'tiktok_tts') channel.ttsEngine = explicitVoiceProvider;
      if (explicitVoiceProvider === 'local_onnx') channel.ttsEngine = 'kokoro_tts';
      if (explicitVoiceProvider === 'piper_local') channel.ttsEngine = 'piper_local';
      if (!options.voice?.voiceId && !options.channelProfile?.specificVoice) {
        channel.specificVoice = explicitVoiceProvider === 'piper_local' ? 'vi_VN-vais1000-medium' : explicitVoiceProvider === 'local_onnx' ? 'af_heart' : explicitVoiceProvider === 'tiktok_tts' ? 'BV074_streaming' : 'vi-VN-HoaiMyNeural';
      }
    }
    if (options.voice?.voiceId && !options.channelProfile?.specificVoice) channel.specificVoice = options.voice.voiceId;
  }
  if (blueprint?.aspectRatio) merged.flowEngine.aspectRatio = blueprint.aspectRatio;
  return merged;
}

/** Only production settings are persisted, with credentials encrypted like the settings store. */
export function captureSessionConfig(config: AiStudioConfig): AiStudioSessionConfig {
  const snapshot: AiStudioSessionConfig = JSON.parse(JSON.stringify({
    llm: config.llm, voice: config.voice, flowEngine: config.flowEngine,
    rendering: config.rendering, subtitles: config.subtitles, channelProfile: config.channelProfile,
  }));
  snapshot.llm.apiKey = encryptSecret(snapshot.llm.apiKey);
  if (snapshot.flowEngine.apiKey) snapshot.flowEngine.apiKey = encryptSecret(snapshot.flowEngine.apiKey);
  return snapshot;
}

export function restoreSessionConfig(snapshot: AiStudioSessionConfig): AiStudioSessionConfig {
  const config: AiStudioSessionConfig = JSON.parse(JSON.stringify(snapshot));
  config.llm.apiKey = decryptSecret(config.llm.apiKey);
  if (config.flowEngine.apiKey) config.flowEngine.apiKey = decryptSecret(config.flowEngine.apiKey);
  return config;
}
