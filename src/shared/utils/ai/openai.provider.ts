import { env } from '../../../config/env';
import { AppError } from '../AppError';
import type { AiTier, IAiProvider, IAiProviderGenerateOptions } from './types';

// Change here to move every AI feature to another model.
const MODELS: Record<AiTier, string> = {
  fast: 'gpt-6-luna',
  smart: 'gpt-6.1-terra',
};
const EFFORT: Record<AiTier, 'low' | 'medium'> = {
  fast: 'low',
  smart: 'medium',
};

// Reasoning counts toward the limit, so callers' reply sizes are too small on
// their own. Only what is actually used is billed.
const MIN_MAX_TOKENS = 16_000;

export class OpenAIProvider implements IAiProvider {
  readonly name = 'openai';

  async generate(
    prompt: string,
    options: IAiProviderGenerateOptions = {}
  ): Promise<string> {
    const { maxTokens = 1024, jsonSchema, tier = 'fast' } = options;

    if (!env.OPENAI_API_KEY) {
      throw new AppError(
        500,
        'AI_CONFIG_ERROR',
        'OPENAI_API_KEY is not set. Add it to your .env file or switch AI provider to claude.'
      );
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 30_000);

    try {
      const response = await fetch(
        'https://api.openai.com/v1/chat/completions',
        {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${env.OPENAI_API_KEY}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            model: MODELS[tier],
            reasoning_effort: EFFORT[tier],
            max_completion_tokens: Math.max(maxTokens, MIN_MAX_TOKENS),
            messages: [{ role: 'user', content: prompt }],
            response_format: jsonSchema
              ? {
                  type: 'json_schema',
                  json_schema: {
                    name: 'response',
                    strict: true,
                    schema: jsonSchema,
                  },
                }
              : { type: 'json_object' },
          }),
          signal: controller.signal,
        }
      );

      if (!response.ok) {
        const body = await response.text().catch(() => '');
        throw new AppError(
          500,
          'AI_API_ERROR',
          `OpenAI API error ${response.status}: ${body.slice(0, 200)}`
        );
      }

      const data = (await response.json()) as {
        choices: Array<{
          finish_reason: string;
          message: { content: string | null; refusal?: string | null };
        }>;
      };

      const choice = data.choices[0];
      if (choice.message.refusal) {
        throw new AppError(500, 'AI_REFUSED', 'OpenAI declined the request');
      }
      if (choice.finish_reason === 'length') {
        throw new AppError(500, 'AI_TRUNCATED', 'OpenAI response was cut off');
      }
      return choice.message.content ?? '';
    } catch (error) {
      if (error instanceof AppError) throw error;
      if (error instanceof DOMException && error.name === 'AbortError') {
        throw new AppError(500, 'AI_TIMEOUT', 'OpenAI API request timed out');
      }
      throw new AppError(
        500,
        'AI_API_ERROR',
        `OpenAI API call failed: ${(error as Error).message}`
      );
    } finally {
      clearTimeout(timeout);
    }
  }
}
