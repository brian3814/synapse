import { computeCostCents } from '../shared/constants';

export interface UsageRecord {
  timestamp: number;
  path: 'simple' | 'agent' | 'chat' | 'reading-list';
  model: string;
  inputTokens: number;
  outputTokens: number;
  costCents: number;
}

const STORAGE_KEY = 'usageRecords';
const BUDGET_KEY = 'usageBudget';
const MAX_AGE_MS = 90 * 24 * 60 * 60 * 1000; // 90 days

export async function recordUsage(
  path: UsageRecord['path'],
  model: string,
  inputTokens: number,
  outputTokens: number
): Promise<void> {
  const costCents = computeCostCents(model, inputTokens, outputTokens);
  const record: UsageRecord = {
    timestamp: Date.now(),
    path,
    model,
    inputTokens,
    outputTokens,
    costCents,
  };

  const result = await chrome.storage.local.get(STORAGE_KEY) as Record<string, any>;
  const records: UsageRecord[] = result[STORAGE_KEY] ?? [];
  records.push(record);
  await chrome.storage.local.set({ [STORAGE_KEY]: records });
}

export async function getCurrentMonthUsageCents(): Promise<number> {
  const result = await chrome.storage.local.get(STORAGE_KEY) as Record<string, any>;
  const records: UsageRecord[] = result[STORAGE_KEY] ?? [];

  const now = new Date();
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1).getTime();

  return records
    .filter((r) => r.timestamp >= monthStart)
    .reduce((sum, r) => sum + r.costCents, 0);
}

export async function isBudgetExceeded(): Promise<boolean> {
  const budgetResult = await chrome.storage.local.get(BUDGET_KEY) as Record<string, any>;
  const budget = budgetResult[BUDGET_KEY];
  if (!budget?.monthlyLimitCents || budget.monthlyLimitCents <= 0) return false;

  const currentUsage = await getCurrentMonthUsageCents();
  return currentUsage >= budget.monthlyLimitCents;
}

export async function pruneOldRecords(): Promise<void> {
  const result = await chrome.storage.local.get(STORAGE_KEY) as Record<string, any>;
  const records: UsageRecord[] = result[STORAGE_KEY] ?? [];
  if (records.length === 0) return;

  const cutoff = Date.now() - MAX_AGE_MS;
  const pruned = records.filter((r) => r.timestamp >= cutoff);

  if (pruned.length < records.length) {
    await chrome.storage.local.set({ [STORAGE_KEY]: pruned });
  }
}
