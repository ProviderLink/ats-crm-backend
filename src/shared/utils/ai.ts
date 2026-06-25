/**
 * @deprecated Use `getAiProvider()` from `./ai/index.ts` instead.
 * This file kept for backward compatibility.
 */

export {
  clearAiProviderCache,
  getAiProvider,
  parseJsonResponse,
  withRetry,
} from './ai/index';
export type { AiJobResult, AiProviderName, IAiProvider } from './ai/types';

import { ClaudeProvider } from './ai/claude.provider';

/**
 * @deprecated Use `getAiProvider().generate(prompt, maxTokens)` instead.
 */
export const callClaude = async (
  prompt: string,
  maxTokens = 1024
): Promise<string> => {
  const provider = new ClaudeProvider();
  return provider.generate(prompt, maxTokens);
};
