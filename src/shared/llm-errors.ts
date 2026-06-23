export type LLMErrorType = 'rate_limit' | 'overloaded' | 'api_error';

export class LLMApiError extends Error {
  constructor(
    public readonly errorType: LLMErrorType,
    public readonly statusCode: number,
    public readonly body: string,
    public readonly retryAfterMs?: number,
  ) {
    super(`LLM API error (${statusCode}): ${body}`);
    this.name = 'LLMApiError';
  }
}
