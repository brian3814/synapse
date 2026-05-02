# Phase 3: Event Bus Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace scattered `BroadcastChannel` usage with a centralized `EventBus` that unifies local in-process event dispatch with cross-tab/cross-window sync. Commands, stores, and UI components emit and subscribe through one interface. The bus also introduces lifecycle event types (`extraction_started`, `extraction_complete`, etc.) that future phases (MCP server, plugins) will consume.

**Architecture:** The `EventBus` is a singleton in-process pub/sub with an optional `BroadcastChannel` bridge for cross-tab sync. It does NOT replace the DB-layer sync (the `db-shared-worker.ts` still posts CRUD events to `BroadcastChannel` after writes). Instead, the bus **receives** from that channel (via `enableBroadcast()`) so stores subscribe in one place rather than each opening their own channel. For events originating in the UI process (note saves, extraction lifecycle), the bus emits locally AND to the channel so other tabs pick them up.

**Tech Stack:** TypeScript, existing `SyncEvent` type (extended), `BroadcastChannel` API

**No test framework configured.** Verification = `npm run build` + `npm run build:electron` clean.

---

## Current State

| File | Current behavior |
|------|-----------------|
| `src/shared/sync-events.ts` | Defines `SYNC_CHANNEL` and `SyncEvent` (10 variants) |
| `src/db/worker/db-shared-worker.ts` | Posts `SyncEvent` to `BroadcastChannel` after every DB mutation |
| `src/graph/store/graph-store.ts` | `startSyncListener()` opens its own `BroadcastChannel`, handles 7 of 10 event types |
| `src/graph/store/node-type-store.ts` | Has no sync listener (comment in graph-store says "handled by node-type-store" but it is not) |
| `src/ui/components/notes/NoteEditor.tsx` | Opens two separate `BroadcastChannel` instances: one to listen for `note_content_updated`, one to emit it on save |
| `src/platform/chrome/db.ts` | `onSync()` opens yet another `BroadcastChannel` (used by nobody currently) |
| `src/platform/electron/db.ts` | `onSync()` uses IPC `db:sync` channel (no `BroadcastChannel` -- single-window) |

**Problem:** Five separate `BroadcastChannel` instances for the same channel name, scattered across files. No support for lifecycle events. No way for future MCP/plugin callers to subscribe to graph mutations.

---

## File Structure

### New files

| File | Responsibility |
|------|---------------|
| `src/events/types.ts` | `KGEvent` union type -- superset of `SyncEvent` plus lifecycle events |
| `src/events/event-bus.ts` | `EventBus` class + singleton `eventBus` export |
| `src/events/index.ts` | Barrel export |

### Modified files

| File | Change |
|------|--------|
| `src/shared/sync-events.ts` | Keep as-is (backward compat for DB layer). `KGEvent` imports `SyncEvent` from here. |
| `src/graph/store/graph-store.ts` | `startSyncListener()` subscribes via `eventBus.on(...)` instead of manual `BroadcastChannel` |
| `src/graph/store/node-type-store.ts` | Add `startSyncListener()` via `eventBus.on(...)` for `node_type_created`/`node_type_deleted` |
| `src/ui/components/notes/NoteEditor.tsx` | Replace both `BroadcastChannel` usages with `eventBus.on()`/`eventBus.emit()` |
| `src/ui/App.tsx` | Call `eventBus.enableBroadcast()` once at init, call `nodeTypeStore.startSyncListener()` |

---

### Task 1: KGEvent types

**Files:**
- Create: `src/events/types.ts`

- [ ] **Step 1: Create the event types file**

```typescript
// src/events/types.ts
import type { SyncEvent } from '../shared/sync-events';

/**
 * Lifecycle events emitted by extraction and chat pipelines.
 * These do NOT go through the DB layer -- they originate in the UI process.
 */
export type ExtractionStartedEvent = {
  type: 'extraction_started';
  sourceUrl: string | null;
  mode: 'simple' | 'agent';
};

export type ExtractionCompleteEvent = {
  type: 'extraction_complete';
  nodesAdded: number;
  edgesAdded: number;
};

export type ExtractionErrorEvent = {
  type: 'extraction_error';
  error: string;
};

export type ChatMessageEvent = {
  type: 'chat_message';
  sessionId: string;
  role: 'user' | 'assistant';
};

export type ToolRegisteredEvent = {
  type: 'tool_registered';
  toolName: string;
};

export type ToolUnregisteredEvent = {
  type: 'tool_unregistered';
  toolName: string;
};

/** Lifecycle events that originate in the UI process, not the DB layer. */
export type LifecycleEvent =
  | ExtractionStartedEvent
  | ExtractionCompleteEvent
  | ExtractionErrorEvent
  | ChatMessageEvent
  | ToolRegisteredEvent
  | ToolUnregisteredEvent;

/**
 * KGEvent is the full union of all events that flow through the event bus.
 * - SyncEvent variants come FROM the DB layer (via BroadcastChannel)
 * - LifecycleEvent variants originate in the UI process
 */
export type KGEvent = SyncEvent | LifecycleEvent;

/** Extract the `type` string literal from any KGEvent variant. */
export type KGEventType = KGEvent['type'];

/** Narrow KGEvent to the variant matching a given type string. */
export type KGEventOf<T extends KGEventType> = Extract<KGEvent, { type: T }>;
```

- [ ] **Step 2: Verify build**

```bash
npm run build 2>&1 | tail -5
```

Expected: Build succeeds (new file has no consumers yet).

- [ ] **Step 3: Commit**

```bash
git add src/events/types.ts
git commit -m "feat(events): add KGEvent union type with sync + lifecycle variants"
```

---

### Task 2: EventBus class

**Files:**
- Create: `src/events/event-bus.ts`

- [ ] **Step 1: Create the event bus**

```typescript
// src/events/event-bus.ts
import { SYNC_CHANNEL } from '../shared/sync-events';
import type { KGEvent, KGEventType, KGEventOf } from './types';

type Handler<T extends KGEvent = KGEvent> = (event: T) => void;

/**
 * In-process event bus with optional BroadcastChannel bridge for cross-tab sync.
 *
 * Usage:
 *   import { eventBus } from '../events';
 *   eventBus.enableBroadcast();                       // once at app init
 *   const unsub = eventBus.on('node_created', (e) => { ... });
 *   eventBus.emit({ type: 'note_content_updated', nodeId: '123' });
 *   unsub();
 */
export class EventBus {
  private listeners = new Map<KGEventType, Set<Handler<any>>>();
  private anyListeners = new Set<Handler<KGEvent>>();
  private channel: BroadcastChannel | null = null;

  /**
   * Bridge to BroadcastChannel for cross-tab sync.
   * Events received from the channel are dispatched to local listeners.
   * Events emitted locally are also posted to the channel.
   *
   * In Electron (single-window), this is still safe to call -- BroadcastChannel
   * exists in Chromium-based renderers and is a no-op when there are no other tabs.
   */
  enableBroadcast(channelName: string = SYNC_CHANNEL): void {
    if (this.channel) return; // already enabled (idempotent)
    this.channel = new BroadcastChannel(channelName);
    this.channel.onmessage = (event: MessageEvent<KGEvent>) => {
      // Dispatch to local listeners only (don't re-broadcast)
      this.dispatchLocal(event.data);
    };
  }

  /**
   * Subscribe to a specific event type. Returns an unsubscribe function.
   */
  on<T extends KGEventType>(type: T, handler: Handler<KGEventOf<T>>): () => void {
    // no disposed guard — singleton survives React StrictMode remounts
    let set = this.listeners.get(type);
    if (!set) {
      set = new Set();
      this.listeners.set(type, set);
    }
    set.add(handler);
    return () => { set!.delete(handler); };
  }

  /**
   * Subscribe to ALL events. Returns an unsubscribe function.
   */
  onAny(handler: Handler<KGEvent>): () => void {
    // no disposed guard — singleton survives React StrictMode remounts
    this.anyListeners.add(handler);
    return () => { this.anyListeners.delete(handler); };
  }

  /**
   * Emit a single event to local listeners AND the BroadcastChannel (if enabled).
   */
  emit(event: KGEvent): void {
    // no disposed guard
    this.dispatchLocal(event);
    this.channel?.postMessage(event);
  }

  /**
   * Batch-emit multiple events (e.g., from CommandResult.events).
   * Each event is dispatched individually -- no transactional grouping.
   */
  emitAll(events: KGEvent[]): void {
    for (const event of events) {
      this.emit(event);
    }
  }

  /**
   * Close the BroadcastChannel bridge. Listeners are NOT cleared —
   * local event dispatch still works. Call enableBroadcast() again to reconnect.
   *
   * React StrictMode safety: App.tsx cleanup calls this (not dispose()).
   * Dev double-mount re-calls enableBroadcast() on re-mount, which is safe
   * because enableBroadcast() is idempotent.
   */
  disableBroadcast(): void {
    if (this.channel) {
      this.channel.close();
      this.channel = null;
    }
  }

  /**
   * Full teardown: close BroadcastChannel AND clear all listeners.
   * Only use for permanent shutdown (e.g., app unload), NOT React effect cleanup.
   */
  dispose(): void {
    this.disableBroadcast();
    this.listeners.clear();
    this.anyListeners.clear();
  }

  /** Dispatch to local listeners without posting to BroadcastChannel. */
  private dispatchLocal(event: KGEvent): void {
    const handlers = this.listeners.get(event.type);
    if (handlers) {
      for (const handler of handlers) {
        try { handler(event); } catch (e) { console.error('[EventBus] handler error:', e); }
      }
    }
    for (const handler of this.anyListeners) {
      try { handler(event); } catch (e) { console.error('[EventBus] anyHandler error:', e); }
    }
  }
}

/** Singleton instance -- import this in UI code. */
export const eventBus = new EventBus();
```

- [ ] **Step 2: Verify build**

```bash
npm run build 2>&1 | tail -5
```

- [ ] **Step 3: Commit**

```bash
git add src/events/event-bus.ts
git commit -m "feat(events): add EventBus class with BroadcastChannel bridge"
```

---

### Task 3: Barrel export

**Files:**
- Create: `src/events/index.ts`

- [ ] **Step 1: Create barrel**

```typescript
// src/events/index.ts
export { EventBus, eventBus } from './event-bus';
export type {
  KGEvent,
  KGEventType,
  KGEventOf,
  LifecycleEvent,
  ExtractionStartedEvent,
  ExtractionCompleteEvent,
  ExtractionErrorEvent,
  ChatMessageEvent,
  ToolRegisteredEvent,
  ToolUnregisteredEvent,
} from './types';
```

- [ ] **Step 2: Verify build**

```bash
npm run build 2>&1 | tail -5
```

- [ ] **Step 3: Commit**

```bash
git add src/events/index.ts
git commit -m "feat(events): add barrel export for event bus module"
```

---

### Task 4: Integrate into graph-store

**Files:**
- Modify: `src/graph/store/graph-store.ts`

This is the most critical integration. The `startSyncListener()` method currently creates its own `BroadcastChannel` and handles events directly. We replace it with `eventBus.on(...)` subscriptions.

- [ ] **Step 1: Replace import**

In `src/graph/store/graph-store.ts`, replace the import line:

```typescript
// OLD
import { SYNC_CHANNEL, type SyncEvent } from '../../shared/sync-events';
```

with:

```typescript
// NEW
import { eventBus } from '../../events';
import type { KGEventOf } from '../../events';
```

- [ ] **Step 2: Rewrite `startSyncListener()`**

Replace the entire `startSyncListener` method body (lines 336-425 approximately). The new version subscribes to specific event types via the event bus instead of opening a raw `BroadcastChannel`:

```typescript
  startSyncListener: () => {
    const unsubs: Array<() => void> = [];

    unsubs.push(eventBus.on('node_created', (e: KGEventOf<'node_created'>) => {
      const node = dbNodeToGraphNode(e.node);
      set((state) => {
        if (state.nodes.some((n) => n.id === node.id)) return state;
        return { nodes: [...state.nodes, node] };
      });
    }));

    unsubs.push(eventBus.on('node_updated', (e: KGEventOf<'node_updated'>) => {
      const node = dbNodeToGraphNode(e.node);
      set((state) => ({
        nodes: state.nodes.map((n) => (n.id === node.id ? node : n)),
      }));
    }));

    unsubs.push(eventBus.on('node_deleted', (e: KGEventOf<'node_deleted'>) => {
      const { id } = e;
      set((state) => {
        const edges = state.edges.filter(
          (edge) => edge.sourceId !== id && edge.targetId !== id
        );
        const selectedNodeIds = new Set(state.selectedNodeIds);
        selectedNodeIds.delete(id);
        return {
          nodes: state.nodes.filter((n) => n.id !== id),
          edges,
          adjacency: buildAdjacencyMap(edges),
          selectedNodeIds,
        };
      });
    }));

    unsubs.push(eventBus.on('edge_created', (e: KGEventOf<'edge_created'>) => {
      const edge = dbEdgeToGraphEdge(e.edge);
      set((state) => {
        if (state.edges.some((existing) => existing.id === edge.id)) return state;
        const edges = [...state.edges, edge];
        return { edges, adjacency: buildAdjacencyMap(edges) };
      });
    }));

    unsubs.push(eventBus.on('edge_updated', (e: KGEventOf<'edge_updated'>) => {
      const edge = dbEdgeToGraphEdge(e.edge);
      set((state) => {
        const edges = state.edges.map((existing) => (existing.id === edge.id ? edge : existing));
        return { edges, adjacency: buildAdjacencyMap(edges) };
      });
    }));

    unsubs.push(eventBus.on('edge_deleted', (e: KGEventOf<'edge_deleted'>) => {
      const { id } = e;
      set((state) => {
        const edges = state.edges.filter((existing) => existing.id !== id);
        return {
          edges,
          adjacency: buildAdjacencyMap(edges),
          selectedEdgeId:
            state.selectedEdgeId === id ? null : state.selectedEdgeId,
        };
      });
    }));

    unsubs.push(eventBus.on('reset', () => {
      get().loadAll();
    }));

    return () => {
      for (const unsub of unsubs) unsub();
    };
  },
```

- [ ] **Step 3: Remove unused imports**

After the rewrite, `SYNC_CHANNEL` and `SyncEvent` are no longer imported. Verify no other code in the file references them. The `type SyncEvent` may still be referenced implicitly by the event bus types, but the direct import is no longer needed.

- [ ] **Step 4: Verify build**

```bash
npm run build 2>&1 | tail -5
npm run build:electron 2>&1 | tail -5
```

Both must succeed. The `eventBus` import resolves in both Chrome and Electron builds because `src/events/` is platform-agnostic (no `@platform` imports).

- [ ] **Step 5: Commit**

```bash
git add src/graph/store/graph-store.ts
git commit -m "refactor(graph-store): subscribe via eventBus instead of raw BroadcastChannel"
```

---

### Task 5: Add sync listener to node-type-store

**Files:**
- Modify: `src/graph/store/node-type-store.ts`

Currently, `node_type_created` and `node_type_deleted` events are posted to `BroadcastChannel` by the DB layer (see `action-handler.ts` lines 179, 187) but no store listens for them. The comment in `graph-store.ts` line 418 says "handled by node-type-store" but that is aspirational, not actual. This task fixes the gap.

- [ ] **Step 1: Add import and `startSyncListener` method**

Add import at the top of `src/graph/store/node-type-store.ts`:

```typescript
import { eventBus } from '../../events';
import type { KGEventOf } from '../../events';
```

Add `startSyncListener` to the interface:

```typescript
interface NodeTypeStore {
  types: NodeType[];
  loading: boolean;

  loadTypes: () => Promise<void>;
  createType: (input: {
    type: string;
    description?: string;
    color?: string;
    category?: 'structural' | 'entity_label';
  }) => Promise<NodeType | null>;
  startSyncListener: () => () => void;

  // ... existing methods unchanged
```

Add the implementation after `createType`:

```typescript
  startSyncListener: () => {
    const unsubs: Array<() => void> = [];

    unsubs.push(eventBus.on('node_type_created', (e: KGEventOf<'node_type_created'>) => {
      set((state) => {
        // Idempotent: skip if already present
        if (state.types.some((t) => t.type === e.nodeType.type)) return state;
        return { types: [...state.types, e.nodeType] };
      });
    }));

    unsubs.push(eventBus.on('node_type_deleted', (e: KGEventOf<'node_type_deleted'>) => {
      set((state) => ({
        types: state.types.filter((t) => t.id !== e.nodeTypeId),
      }));
    }));

    return () => {
      for (const unsub of unsubs) unsub();
    };
  },
```

- [ ] **Step 2: Verify build**

```bash
npm run build 2>&1 | tail -5
npm run build:electron 2>&1 | tail -5
```

- [ ] **Step 3: Commit**

```bash
git add src/graph/store/node-type-store.ts
git commit -m "feat(node-type-store): add startSyncListener via eventBus for cross-tab sync"
```

---

### Task 6: Integrate into NoteEditor

**Files:**
- Modify: `src/ui/components/notes/NoteEditor.tsx`

The NoteEditor has two `BroadcastChannel` usages:
1. **Listener** (line ~54): Opens a channel to receive `note_content_updated` events from other tabs
2. **Emitter** (line ~129): Opens a channel to post `note_content_updated` after saving

Both are replaced with the event bus.

- [ ] **Step 1: Replace import**

Replace:

```typescript
import { SYNC_CHANNEL, type SyncEvent } from '../../../shared/sync-events';
```

with:

```typescript
import { eventBus } from '../../../events';
```

- [ ] **Step 2: Replace listener useEffect (around line 52-66)**

Replace the `useEffect` that creates a `BroadcastChannel` listener:

```typescript
  // OLD (lines ~52-66)
  useEffect(() => {
    if (!nodeId) return;
    const channel = new BroadcastChannel(SYNC_CHANNEL);
    channel.onmessage = (e: MessageEvent<SyncEvent>) => {
      if (e.data.type === 'note_content_updated' && e.data.nodeId === nodeId) {
        notes.read(nodeId).then((md) => {
          if (md) {
            const parsed = parseMarkdown(md);
            setContent(parsed.content);
          }
        }).catch(() => {});
      }
    };
    return () => channel.close();
  }, [nodeId]);
```

with:

```typescript
  // NEW
  useEffect(() => {
    if (!nodeId) return;
    return eventBus.on('note_content_updated', (e) => {
      if (e.nodeId === nodeId) {
        notes.read(nodeId).then((md) => {
          if (md) {
            const parsed = parseMarkdown(md);
            setContent(parsed.content);
          }
        }).catch(() => {});
      }
    });
  }, [nodeId]);
```

- [ ] **Step 3: Replace emitter in handleSave (around line 127-132)**

Replace the block that creates a `BroadcastChannel` to post:

```typescript
      // OLD (lines ~127-132)
      const savedId = nodeId ?? graphStore.nodes.find((n) => n.name === title && n.type === 'note')?.id;
      if (savedId) {
        const channel = new BroadcastChannel(SYNC_CHANNEL);
        channel.postMessage({ type: 'note_content_updated', nodeId: savedId } satisfies SyncEvent);
        channel.close();
      }
```

with:

```typescript
      // NEW
      const savedId = nodeId ?? graphStore.nodes.find((n) => n.name === title && n.type === 'note')?.id;
      if (savedId) {
        eventBus.emit({ type: 'note_content_updated', nodeId: savedId });
      }
```

- [ ] **Step 4: Verify build**

```bash
npm run build 2>&1 | tail -5
npm run build:electron 2>&1 | tail -5
```

- [ ] **Step 5: Commit**

```bash
git add src/ui/components/notes/NoteEditor.tsx
git commit -m "refactor(NoteEditor): use eventBus instead of raw BroadcastChannel"
```

---

### Task 7: Wire up eventBus in App.tsx

**Files:**
- Modify: `src/ui/App.tsx`

The event bus must be initialized (broadcast enabled) once at app startup, before any store sync listeners run. Also wire up the new node-type-store sync listener.

- [ ] **Step 1: Add imports**

Add near the top of `src/ui/App.tsx`:

```typescript
import { eventBus } from '../events';
```

- [ ] **Step 2: Enable broadcast before DB-dependent effects**

Add a new `useEffect` that runs unconditionally (no deps on `ready`), placed BEFORE the existing DB-init effect. This ensures the `BroadcastChannel` is open before `startSyncListener()` tries to subscribe:

```typescript
  // Initialize event bus broadcast bridge (must run before sync listeners)
  useEffect(() => {
    eventBus.enableBroadcast();
    return () => eventBus.disableBroadcast(); // NOT dispose() — React StrictMode safe
  }, []);
```

- [ ] **Step 3: Add node-type-store sync listener**

In the existing `useEffect` that fires when `ready` is true (around line 53-64), add the node-type-store sync listener alongside the graph-store one:

```typescript
  useEffect(() => {
    if (ready) {
      loadAll();
      loadTypes();
      const cleanupSync = startSyncListener();
      const cleanupTypeSync = useNodeTypeStore.getState().startSyncListener();
      const cleanupQuery = registerQueryMessageHandler();
      return () => {
        cleanupSync();
        cleanupTypeSync();
        cleanupQuery();
      };
    }
  }, [ready, loadAll, loadTypes, startSyncListener]);
```

- [ ] **Step 4: Verify build**

```bash
npm run build 2>&1 | tail -5
npm run build:electron 2>&1 | tail -5
```

- [ ] **Step 5: Commit**

```bash
git add src/ui/App.tsx
git commit -m "feat(app): initialize eventBus broadcast bridge and node-type sync listener"
```

---

### Task 8: Final verification and cleanup

- [ ] **Step 1: Full build check**

```bash
npm run build 2>&1 | tail -10
npm run build:electron 2>&1 | tail -10
```

Both must succeed with no TypeScript errors.

- [ ] **Step 2: Verify no stale BroadcastChannel references in modified files**

Run this grep to confirm no raw `BroadcastChannel` remains in files that were migrated:

```bash
grep -n 'new BroadcastChannel' src/graph/store/graph-store.ts src/graph/store/node-type-store.ts src/ui/components/notes/NoteEditor.tsx src/ui/App.tsx
```

Expected: no output. The only files that should still have `new BroadcastChannel` are:
- `src/db/worker/db-shared-worker.ts` (DB layer, unchanged)
- `src/platform/chrome/db.ts` (`onSync()` method, unchanged)
- `src/events/event-bus.ts` (the bus itself)

- [ ] **Step 3: Verify remaining BroadcastChannel usages are expected**

```bash
grep -rn 'new BroadcastChannel' src/ --include='*.ts' --include='*.tsx'
```

Expected output (3 files only):
- `src/db/worker/db-shared-worker.ts` -- DB layer posts sync events after writes (unchanged, correct)
- `src/platform/chrome/db.ts` -- `onSync()` method (unused now, but harmless; can be removed in a future cleanup)
- `src/events/event-bus.ts` -- the bus `enableBroadcast()` method (correct)

- [ ] **Step 4: Commit (if any cleanup was needed)**

```bash
git add -A
git commit -m "chore(events): phase 3 event bus cleanup"
```

---

## Architecture Summary

After this phase, event flow works as follows:

```
DB Mutation (write/delete)
    |
    v
db-shared-worker.ts --BroadcastChannel--> eventBus.enableBroadcast() listener
                                              |
                                              v
                                         eventBus.dispatchLocal()
                                              |
                                     +--------+--------+
                                     v        v        v
                              graph-store  node-type  (future
                              .on(...)     -store     subscribers)
                                           .on(...)

UI-originated event (note save, extraction lifecycle)
    |
    v
eventBus.emit()
    |
    +--> dispatchLocal() --> local subscribers
    |
    +--> BroadcastChannel --> other tabs' eventBus --> their local subscribers
```

**Key invariants:**
- DB CRUD sync events still originate from `db-shared-worker.ts` posting to `BroadcastChannel`. The `eventBus` receives them via its channel listener. This avoids double-posting (the bus does NOT emit CRUD events -- those come from the DB layer).
- Lifecycle events (`extraction_started`, etc.) originate from `eventBus.emit()` in the UI process. They go to both local listeners and the `BroadcastChannel`.
- `NoteEditor` note saves use `eventBus.emit()` for `note_content_updated` -- this is a UI-originated event (the note content is in OPFS, not in the DB mutation path).
- Stores never open their own `BroadcastChannel`. They subscribe via `eventBus.on(type, handler)`.

**What is NOT changed:**
- `src/db/worker/db-shared-worker.ts` still posts to `BroadcastChannel` directly (it runs in a SharedWorker context where the event bus singleton does not exist)
- `src/platform/chrome/db.ts` `onSync()` method still exists (unused but harmless)
- `src/platform/electron/db.ts` `onSync()` via IPC still exists (not wired to the bus in this phase; Electron is single-window so cross-tab sync is moot)

**React StrictMode safety:**
- `enableBroadcast()` is idempotent (returns early if already enabled)
- App cleanup calls `disableBroadcast()` (closes channel, keeps listeners)
- Dev double-mount: mount1 enables → unmount1 disables → mount2 re-enables. No permanent damage to the singleton.
- `dispose()` exists for full teardown but is NOT used in React effect cleanup.

**Electron main-process event delivery (Phase 4 concern):**
- The renderer `eventBus` singleton lives in the renderer process only. It CANNOT be the event source for MCP (which runs in Electron's main process).
- In Electron, DB sync events already flow through the main process: `db-backend.ts` calls action-handler, which returns `syncEvent`, and `main.ts` broadcasts it to all windows via `win.webContents.send('db:sync', syncEvent)`.
- Phase 4 will add a `MainProcessEventBridge` that intercepts these same sync events in `main.ts` and forwards them to MCP clients. This is a main-process concern, NOT a renderer concern.

**Future phases will:**
- Phase 4 (MCP server): `MainProcessEventBridge` in `electron/main.ts` intercepts DB sync events and pushes to MCP clients (NOT via renderer eventBus)
- Commands (`src/commands/`): Call `eventBus.emitAll(result.events)` after command execution for lifecycle events

---

## Output file

This plan should be saved to: `/Users/brian/Desktop/code/sideproject/kg_extension/docs/superpowers/plans/2026-05-03-phase3-event-bus.md`
