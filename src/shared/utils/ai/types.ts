export interface IAiProviderGenerateOptions {
  /** Max tokens for the response (default: 1024) */
  maxTokens?: number;
  /** Prefill the assistant response to force a specific output format (e.g., '{' for JSON) */
  prefillAssistant?: string;
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
