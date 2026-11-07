import assert from 'node:assert/strict';
import { aiStudioLlmService } from '../main/ai-studio/services/AiStudioLlmService';
import { ChatGptWebSessionManager } from '../main/ai-studio/chatgpt/ChatGptWebSessionManager';
import type { AiStudioLlmConfig } from '../main/ai-studio/types';

async function main() {
  const config: AiStudioLlmConfig = { provider: 'deepseek', apiKey: 'fixture-only-key', baseUrl: 'https://example.invalid/v1', model: 'deepseek-chat', temperature: 0.6, systemPromptPreset: 'youtube_story' };
  const service = aiStudioLlmService as any;
  for (const provider of ['chatgpt_web', 'gemini_web']) {
    assert.equal(service.createClient({ ...config, provider }), null, 'Web provider must never construct an API client from a retained key');
  }
  const selected = service.resolveChannelLlmConfig(config, { aiProvider: 'openai' });
  assert.equal(selected.provider, 'openai');
  assert.equal(selected.apiKey, '');
  assert.equal(selected.model, '');
  assert.equal(selected.baseUrl, undefined);
  assert.equal(service.resolveChannelLlmConfig(config, { aiProvider: 'deepseek' }), config);
  assert.equal(service.resolveChannelLlmConfig(config, { aiProvider: 'default' }), config);
  assert.equal(config.apiKey, 'fixture-only-key', 'Never mutate the stored provider config');
  await assert.rejects(() => aiStudioLlmService.analyzeIdeaBlueprint('Biển', config, '16:9', undefined, { aiProvider: 'openai' }), /API Key.*openai/);
  await assert.rejects(() => aiStudioLlmService.generateScript('Biển', config, undefined, undefined, { aiProvider: 'openai' } as any), /API Key.*openai/);
  await assert.rejects(() => aiStudioLlmService.generateMasterPromptForChannel({ aiProvider: 'openai' }, config), /API Key.*openai/);
  const manager = ChatGptWebSessionManager.getInstance(), original = manager.executePromptTurn;
  try {
    manager.executePromptTurn = async () => { throw new Error('fixture transport failed'); };
    await assert.rejects(() => aiStudioLlmService.generateMasterPromptForChannel({ aiProvider: 'chatgpt_web' }, config), /fixture transport failed/);
    manager.executePromptTurn = async () => 'Sorry, I cannot complete that request. '.repeat(10);
    await assert.rejects(() => aiStudioLlmService.generateMasterPromptForChannel({ aiProvider: 'chatgpt_web' }, config), /cấu trúc/);
    const template = await aiStudioLlmService.generateMasterPromptForChannel({ projectName: 'Fixture channel' });
    manager.executePromptTurn = async () => template;
    assert.equal(await aiStudioLlmService.generateMasterPromptForChannel({ aiProvider: 'chatgpt_web' }, config),
      template.replace('DeepSeek (deepseek-chat)', 'ChatGPT Web (Zero-API Cost)'));
  } finally { manager.executePromptTurn = original; }
  console.log('PASS: channel provider isolation, missing-key failure and structured master prompt; offline transport fixture only');
}
main().catch(error => { console.error(error); process.exitCode = 1; });
