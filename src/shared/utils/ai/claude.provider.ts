import { env } from '../../../config/env';
import { AppError } from '../AppError';
import type { IAiProvider, IAiProviderGenerateOptions } from './types';

export class ClaudeProvider implements IAiProvider {
  readonly name = 'claude';

  async generate(
    prompt: string,
    options: IAiProviderGenerateOptions = {}
  ): Promise<string> {
    const { maxTokens = 1024, prefillAssistant } = options;

    if (!env.ANTHROPIC_API_KEY) {
      throw new AppError(
        500,
        'AI_CONFIG_ERROR',
        'ANTHROPIC_API_KEY is not set. Add it to your .env file or switch AI provider to openai.'
      );
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 30_000);

    try {
      const messages: Array<{ role: string; content: string }> = [
        { role: 'user', content: prompt },
      ];

      // Prefill assistant response to force a specific output format (e.g., '{' for JSON)
      if (prefillAssistant) {
        messages.push({ role: 'assistant', content: prefillAssistant });
      }

      const response = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'x-api-key': env.ANTHROPIC_API_KEY,
          'anthropic-version': '2023-06-01',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model: 'claude-sonnet-4-20250514',
          max_tokens: maxTokens,
          messages,
        }),
        signal: controller.signal,
      });

      if (!response.ok) {
        const body = await response.text().catch(() => '');
        throw new AppError(
          500,
          'AI_API_ERROR',
          `Claude API error ${response.status}: ${body.slice(0, 200)}`
        );
      }

      const data = (await response.json()) as {
        content: Array<{ type: string; text: string }>;
      };

      // If we prefilled, prepend the prefill text back to get the complete response
      const responseText = data.content[0].text;
      return prefillAssistant ? prefillAssistant + responseText : responseText;
    } catch (error) {
      if (error instanceof AppError) throw error;
      if (error instanceof DOMException && error.name === 'AbortError') {
        throw new AppError(500, 'AI_TIMEOUT', 'Claude API request timed out');
      }
      throw new AppError(
        500,
        'AI_API_ERROR',
        `Claude API call failed: ${(error as Error).message}`
      );
    } finally {
      clearTimeout(timeout);
    }
  }
}
