import { env } from '../../../config/env';
import { AppError } from '../AppError';
import type { IAiProvider, IAiProviderGenerateOptions } from './types';

export class OpenAIProvider implements IAiProvider {
  readonly name = 'openai';

  async generate(
    prompt: string,
    options: IAiProviderGenerateOptions = {}
  ): Promise<string> {
    const { maxTokens = 1024 } = options;

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
            model: 'gpt-4o',
            max_tokens: maxTokens,
            messages: [{ role: 'user', content: prompt }],
            response_format: { type: 'json_object' },
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
        choices: Array<{ message: { content: string } }>;
      };

      return data.choices[0].message.content;
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
