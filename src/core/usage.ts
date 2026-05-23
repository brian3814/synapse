/**
 * Shared usage-tracking logic.
 * Both Chrome SW and Electron main delegate to this via a thin UsageStore adapter.
 */

import { computeCostCents } from '../shared/constants';

export interface UsageStore {
  get(key: string): Record<string, unknown>;
  set(items: Record<string, unknown>): void;
}

export function recordUsage(
  store: UsageStore,
  path: string,
  model: string,
  inputTokens: number,
  outputTokens: number,
): void {
  const data = store.get('usageRecords');
  const records = (data.usageRecords as any[]) ?? [];
  records.push({
    timestamp: Date.now(),
    path,
    model,
    inputTokens,
    outputTokens,
    costCents: computeCostCents(model, inputTokens, outputTokens),
  });
  store.set({ usageRecords: records });
}
