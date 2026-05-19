import { env } from '../../config/env';
import { AppError } from './AppError';

export const callClaude = async (
  prompt: string,
  maxTokens = 1024
): Promise<string> => {
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
      messages: [{ role: 'user', content: prompt }],
    }),
  });

  if (!response.ok) {
    throw new AppError(500, 'AI_API_ERROR', 'Claude API call failed');
  }

  const data = (await response.json()) as {
    content: Array<{ type: string; text: string }>;
  };

  return data.content[0].text;
};

export const parseJsonResponse = <T>(text: string): T | null => {
  try {
    const cleaned = text.replace(/`json|`/g, '').trim();
    return JSON.parse(cleaned) as T;
  } catch {
    return null;
  }
};
