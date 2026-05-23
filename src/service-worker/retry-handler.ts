import { ensureOffscreenDocument } from './offscreen-manager';
import type { LLMErrorType } from '../shared/llm-errors';

const MAX_RETRIES = 3;
const MAX_WAIT_MS = 60_000;

interface PendingRequest {
  messageWithKey: any;  // The *_WITH_KEY message to re-send to offscreen
  retriesLeft: number;
}

const pending = new Map<string, PendingRequest>();

export function shouldRetry(errorType?: string): boolean {
  return errorType === 'rate_limit' || errorType === 'overloaded';
}

export function registerRequest(id: string, messageWithKey: any): void {
  pending.set(id, { messageWithKey, retriesLeft: MAX_RETRIES });
}

export function clearRequest(id: string): void {
  pending.delete(id);
}

/**
 * Attempt a retry for a rate-limited request.
 * Returns true if a retry was initiated, false if retries exhausted.
 */
export async function attemptRetry(
  id: string,
  retryAfterMs: number | undefined,
  errorType: LLMErrorType,
): Promise<boolean> {
  const entry = pending.get(id);
  if (!entry || entry.retriesLeft <= 0) {
    pending.delete(id);
    return false;
  }

  entry.retriesLeft--;
  const retryCount = MAX_RETRIES - entry.retriesLeft;
  const waitMs = Math.min(retryAfterMs ?? 30_000, MAX_WAIT_MS);

  // Notify UI of the wait
  chrome.runtime.sendMessage({
    type: 'RATE_LIMIT_WAIT',
    payload: { requestId: id, retryAfterMs: waitMs, retryCount, maxRetries: MAX_RETRIES },
  }).catch(() => {});

  // Wait, then re-send the original request
  await new Promise(resolve => setTimeout(resolve, waitMs));
  await ensureOffscreenDocument();
  chrome.runtime.sendMessage(entry.messageWithKey).catch(() => {});

  return true;
}
