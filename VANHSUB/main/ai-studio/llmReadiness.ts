import type { AiStudioConfig } from './types';
import { selectLlmProvider } from './llmProviderConfig';
import { studioLlmReadiness } from '../../shared/studioLlmReadiness';

export function getStudioLlmReadiness(config: AiStudioConfig) {
  return studioLlmReadiness(selectLlmProvider(config.llm, config.channelProfile?.aiProvider));
}

export function assertStudioLlmReady(config: AiStudioConfig): void {
  const result = getStudioLlmReadiness(config);
  if (!result.ready) throw new Error(`AI Studio chưa sẵn sàng: ${result.reasons.join(' ')}`);
}
