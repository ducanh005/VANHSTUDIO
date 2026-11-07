import type { AiStudioLlmConfig, LlmProvider } from './types';

/** The single credential slot belongs to its provider, never to a new label. */
export function selectLlmProvider(config: AiStudioLlmConfig, provider?: LlmProvider | 'default'): AiStudioLlmConfig {
  if (provider !== undefined && !['default', 'deepseek', 'openai', 'custom', 'chatgpt_web', 'gemini_web'].includes(provider)) {
    throw new TypeError('Invalid LLM provider');
  }
  if (!provider || provider === 'default' || provider === config.provider) return config;
  return { ...config, provider, apiKey: '', model: '', baseUrl: undefined };
}
