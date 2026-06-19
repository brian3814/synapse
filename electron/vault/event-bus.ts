import type { DbNode, DbEdge } from '../../src/shared/types';

// ── Event Types ─────────────────────────────────────────────────────────

export type VaultEvent =
  | { type: 'node:created'; node: DbNode }
  | { type: 'node:updated'; node: DbNode; changes: string[] }
  | { type: 'node:deleted'; nodeId: string; filePath?: string }
  | { type: 'edge:created'; edge: DbEdge }
  | { type: 'edge:deleted'; edgeId: string; edge?: DbEdge }
  | { type: 'file:added'; relativePath: string }
  | { type: 'file:changed'; relativePath: string }
  | { type: 'file:removed'; relativePath: string }
  | { type: 'vault:opened' }
  | { type: 'vault:closing' };

export type VaultEventType = VaultEvent['type'];

export type VaultEventOf<T extends VaultEventType> = Extract<VaultEvent, { type: T }>;

export type VaultEventHandler<T extends VaultEventType> = (event: VaultEventOf<T>) => void;

// ── Event Bus ───────────────────────────────────────────────────────────

export class VaultEventBus {
  private handlers = new Map<string, Set<VaultEventHandler<any>>>();

  on<T extends VaultEventType>(type: T, handler: VaultEventHandler<T>): () => void {
    if (!this.handlers.has(type)) {
      this.handlers.set(type, new Set());
    }
    this.handlers.get(type)!.add(handler);

    return () => {
      this.handlers.get(type)?.delete(handler);
    };
  }

  emit(event: VaultEvent): void {
    const handlers = this.handlers.get(event.type);
    if (!handlers) return;

    for (const handler of handlers) {
      try {
        handler(event);
      } catch (err) {
        console.error(`[VaultEventBus] Handler failed for ${event.type}:`, err);
      }
    }
  }

  removeAll(): void {
    this.handlers.clear();
  }
}
