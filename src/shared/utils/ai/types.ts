export interface IAiProvider {
  /** Name of the provider for display/logging */
  readonly name: string;
  /** Send a prompt and get a text response */
  generate(prompt: string, maxTokens?: number): Promise<string>;
}

export type AiProviderName = 'claude' | 'openai';

export interface AiJobResult<T> {
  success: boolean;
  data?: T;
  error?: string;
}
