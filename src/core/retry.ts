/**
 * Generic retry wrapper for LLM API calls.
 * Platform-agnostic — works in both Chrome offscreen and Electron main.
 */

import type { RateLimitInfo } from '../platform/types';
import { LLMApiError } from '../shared/llm-errors';

const MAX_RETRIES = 3;
const MAX_WAIT_MS = 60_000;

export function isRetryableError(error: unknown): error is LLMApiError {
  if (error instanceof LLMApiError) {
    return error.errorType === 'rate_limit' || error.errorType === 'overloaded';
  }
  return false;
}

export async function withRetry<T>(
  fn: () => Promise<T>,
  opts?: {
    maxRetries?: number;
    onRetryWait?: (info: RateLimitInfo) => void;
  },
): Promise<T> {
  const maxRetries = opts?.maxRetries ?? MAX_RETRIES;
  let lastError: unknown;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (e) {
      lastError = e;
      if (attempt >= maxRetries || !isRetryableError(e)) throw e;

      const waitMs = Math.min(e.retryAfterMs ?? 30_000, MAX_WAIT_MS);
      opts?.onRetryWait?.({
        retryAfterMs: waitMs,
        retryCount: attempt + 1,
        maxRetries,
      });
      await new Promise(resolve => setTimeout(resolve, waitMs));
    }
  }

  throw lastError;
}
