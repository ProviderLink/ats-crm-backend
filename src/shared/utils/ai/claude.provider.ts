import Anthropic from '@anthropic-ai/sdk';
import { env } from '../../../config/env';
import { AppError } from '../AppError';
import type { AiTier, IAiProvider, IAiProviderGenerateOptions } from './types';

// Change here to move every AI feature to another model.
const MODELS: Record<AiTier, string> = {
  fast: 'claude-haiku-5-5',
  smart: 'claude-sonnet-5-5',
};
const EFFORT: Record<AiTier, 'low' | 'medium'> = {
  fast: 'low',
  smart: 'medium',
};

// Thinking counts toward max_tokens, so callers' reply sizes are too small on
// their own. Only what is actually used is billed.
const MIN_MAX_TOKENS = 16_000;

const TIMEOUT_MS = 30_000;

export class ClaudeProvider implements IAiProvider {
  readonly name = 'claude';

  async generate(
    prompt: string,
    options: IAiProviderGenerateOptions = {}
  ): Promise<string> {
    const { maxTokens = 1024, jsonSchema, tier = 'fast' } = options;

    if (!env.ANTHROPIC_API_KEY) {
      throw new AppError(
        500,
        'AI_CONFIG_ERROR',
        'ANTHROPIC_API_KEY is not set. Add it to your .env file or switch AI provider to openai.'
      );
    }

    // Callers that want retries wrap this in `withRetry`.
    const client = new Anthropic({
      apiKey: env.ANTHROPIC_API_KEY,
      timeout: TIMEOUT_MS,
      maxRetries: 0,
    });

    try {
      const request = (model: AiTier) => ({
        model: MODELS[model],
        max_tokens: Math.max(maxTokens, MIN_MAX_TOKENS),
        messages: [{ role: 'user', content: prompt }],
        output_config: {
          effort: EFFORT[model],
          ...(jsonSchema && {
            format: { type: 'json_schema', schema: jsonSchema },
          }),
        },
      });
      type Params = Anthropic.Beta.Messages.MessageCreateParamsNonStreaming;

      const askSmart = () =>
        client.beta.messages.create({
          ...request('smart'),
          // A declined request is retried server-side on another model.
          betas: ['server-side-fallback-2026-07-01'],
          fallbacks: 'default',
        } as unknown as Params);

      let response =
        tier === 'smart'
          ? await askSmart()
          : await client.beta.messages.create(
              request('fast') as unknown as Params
            );

      // The fast model has no server-side fallback.
      if (tier === 'fast' && response.stop_reason === 'refusal') {
        response = await askSmart();
      }

      if (response.stop_reason === 'refusal') {
        throw new AppError(500, 'AI_REFUSED', 'Claude declined the request');
      }
      if (response.stop_reason === 'max_tokens') {
        throw new AppError(500, 'AI_TRUNCATED', 'Claude response was cut off');
      }

      // The reply can start with thinking blocks, so read by type.
      return response.content
        .map(block => (block.type === 'text' ? block.text : ''))
        .join('');
    } catch (error) {
      if (error instanceof AppError) throw error;
      if (error instanceof Anthropic.APIConnectionTimeoutError) {
        throw new AppError(500, 'AI_TIMEOUT', 'Claude API request timed out');
      }
      if (error instanceof Anthropic.APIError) {
        throw new AppError(
          500,
          'AI_API_ERROR',
          `Claude API error ${error.status}: ${error.message.slice(0, 200)}`
        );
      }
      throw new AppError(
        500,
        'AI_API_ERROR',
        `Claude API call failed: ${(error as Error).message}`
      );
    }
  }
}
