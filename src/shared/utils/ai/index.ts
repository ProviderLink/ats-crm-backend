import { getSettings } from '../../../features/settings/settings.service';
import { ClaudeProvider } from './claude.provider';
import { OpenAIProvider } from './openai.provider';
import type { IAiProvider } from './types';

let cachedProvider: IAiProvider | null = null;
let cachedProviderName: string | null = null;

/**
 * Returns the configured AI provider.
 * The provider is selected based on `settings.ai.provider` (default: 'claude').
 * Result is cached until settings change.
 */
export async function getAiProvider(): Promise<IAiProvider> {
  const settings = await getSettings();
  const name = settings.ai.provider;

  if (cachedProvider && cachedProviderName === name) {
    return cachedProvider;
  }

  cachedProviderName = name;
  cachedProvider =
    name === 'openai' ? new OpenAIProvider() : new ClaudeProvider();

  return cachedProvider;
}

/** Clear the cached provider (call after settings update). */
export function clearAiProviderCache(): void {
  cachedProvider = null;
  cachedProviderName = null;
}

/** Retry wrapper for AI calls with exponential backoff */
export async function withRetry<T>(
  fn: () => Promise<T>,
  maxAttempts = 3,
  baseDelayMs = 1000
): Promise<T> {
  let lastError: Error | null = null;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error as Error;
      if (attempt === maxAttempts) break;
      const delay = baseDelayMs * Math.pow(2, attempt - 1);
      await new Promise(resolve => setTimeout(resolve, delay));
    }
  }

  throw lastError;
}

export { parseJsonResponse } from './parse-json';
export type {
  AiJobResult,
  AiProviderName,
  IAiProvider,
  IAiProviderGenerateOptions,
} from './types';

/**
 * Convenience: call Claude directly (bypasses the configured provider).
 * @deprecated Prefer `getAiProvider().generate(prompt, maxTokens)` for new code.
 */
export const callClaude = async (
  prompt: string,
  maxTokens = 1024
): Promise<string> => {
  const provider = new ClaudeProvider();
  return provider.generate(prompt, { maxTokens });
};
