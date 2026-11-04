export type AiTier = 'fast' | 'smart';

export interface IAiProviderGenerateOptions {
  /** Max tokens for the response (default: 1024) */
  maxTokens?: number;
  /** JSON schema the reply must match (see `schema.ts`) */
  jsonSchema?: Record<string, unknown>;
  /**
   * `fast` (default) is the low-cost model, for extraction and simple checks.
   * `smart` is for judgements about people and writing a manager will rely on.
   */
  tier?: AiTier;
}

export interface IAiProvider {
  /** Name of the provider for display/logging */
  readonly name: string;
  /** Send a prompt and get a text response */
  generate(
    prompt: string,
    options?: IAiProviderGenerateOptions
  ): Promise<string>;
}

export type AiProviderName = 'claude' | 'openai';

export interface AiJobResult<T> {
  success: boolean;
  data?: T;
  error?: string;
}
