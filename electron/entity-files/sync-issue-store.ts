import { readFileSync, writeFileSync, existsSync } from 'fs';
import { join } from 'path';
import type { SyncNotification } from '../../src/shared/entity-sync-types';

export class SyncIssueStore {
  private issues = new Map<string, SyncNotification>();
  private dismissedKeys = new Set<string>();
  private dismissedPath: string;
  private broadcastFn?: (issues: SyncNotification[]) => void;

  constructor(kgPath: string) {
    this.dismissedPath = join(kgPath, 'entity-sync-dismissed.json');
    this.loadDismissed();
  }

  setBroadcast(fn: (issues: SyncNotification[]) => void): void {
    this.broadcastFn = fn;
  }

  listIssues(): SyncNotification[] {
    return Array.from(this.issues.values()).filter((n) => !n.dismissed);
  }

  getIssue(id: string): SyncNotification | undefined {
    return this.issues.get(id);
  }

  pendingCount(): number {
    return this.listIssues().length;
  }

  upsertIssue(notification: SyncNotification): void {
    if (this.dismissedKeys.has(notification.id)) {
      notification.dismissed = true;
    }
    this.issues.set(notification.id, notification);
  }

  upsertIssues(notifications: SyncNotification[]): void {
    for (const n of notifications) this.upsertIssue(n);
    this.broadcast();
  }

  dismissIssue(id: string): void {
    const issue = this.issues.get(id);
    if (issue) {
      issue.dismissed = true;
      this.dismissedKeys.add(id);
      this.saveDismissed();
      this.broadcast();
    }
  }

  removeIssue(id: string): void {
    this.issues.delete(id);
    this.broadcast();
  }

  clearAll(): void {
    this.issues.clear();
    this.broadcast();
  }

  private broadcast(): void {
    this.broadcastFn?.(this.listIssues());
  }

  private loadDismissed(): void {
    try {
      if (existsSync(this.dismissedPath)) {
        const data = JSON.parse(readFileSync(this.dismissedPath, 'utf-8'));
        if (Array.isArray(data)) {
          this.dismissedKeys = new Set(data);
        }
      }
    } catch { /* corrupt file, start fresh */ }
  }

  private saveDismissed(): void {
    try {
      writeFileSync(this.dismissedPath, JSON.stringify([...this.dismissedKeys]), 'utf-8');
    } catch { /* best effort */ }
  }
}
