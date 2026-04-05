export type UsageBackendType = 'api-key' | 'managed';

export interface UsageBackend {
  readonly type: UsageBackendType;
  /** Whether this backend has per-token dollar costs the user pays directly. */
  readonly showsCost: boolean;
  recordUsage(path: 'simple' | 'agent' | 'chat' | 'reading-list', model: string, inputTokens: number, outputTokens: number): Promise<void>;
  isBudgetExceeded(): Promise<boolean>;
  getCurrentMonthUsageCents(): Promise<number>;
  pruneOldRecords(): Promise<void>;
}
