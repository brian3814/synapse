import type { UsageBackend } from './usage-backend';
import { recordUsage, isBudgetExceeded, getCurrentMonthUsageCents, pruneOldRecords } from './usage-tracker';

export class ApiKeyBackend implements UsageBackend {
  readonly type = 'api-key' as const;
  readonly showsCost = true;
  recordUsage = recordUsage;
  isBudgetExceeded = isBudgetExceeded;
  getCurrentMonthUsageCents = getCurrentMonthUsageCents;
  pruneOldRecords = pruneOldRecords;
}

let instance: ApiKeyBackend | null = null;

export function getApiKeyBackend(): ApiKeyBackend {
  if (!instance) instance = new ApiKeyBackend();
  return instance;
}
