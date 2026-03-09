# Pitfall: SharedWorker Cannot Spawn Dedicated Workers in Chrome Extensions

## Problem

`SharedWorkerGlobalScope` in Chrome extensions does **not** expose the `Worker` constructor. Calling `new Worker(...)` inside a SharedWorker throws:

```
ReferenceError: Worker is not defined
```

This is a Chrome extension-specific limitation. The HTML spec exposes `Worker` in `SharedWorkerGlobalScope`, but Chrome's extension runtime does not implement it. The error surfaces at runtime — TypeScript compiles fine because `lib.webworker.d.ts` includes the type.

## Context

We use a hybrid worker architecture for SQLite:

- **SharedWorker** ensures a single SQLite connection across all tabs/panels (prevents OPFS corruption from concurrent access)
- **Dedicated Worker** runs wa-sqlite with OPFS `createSyncAccessHandle`, which is only available in Dedicated Workers (not SharedWorkers)

The original (broken) approach had the SharedWorker spawn the Dedicated Worker directly via `new Worker()`.

## Solution

Follow [Notion's WASM SQLite architecture](https://www.notion.com/blog/how-we-sped-up-notion-in-the-browser-with-wasm-sqlite): the **UI thread** creates the Dedicated Worker and bridges it to the SharedWorker via `MessageChannel` port transfer.

### Flow

```
1. UI creates SharedWorker, sends { action: 'init' }
2. SharedWorker has no worker port → responds { needsWorker: true }
3. UI creates Dedicated Worker + MessageChannel
4. UI transfers channel.port2 to Dedicated Worker via postMessage(data, [port])
5. UI transfers channel.port1 to SharedWorker via postMessage(data, [port])
6. SharedWorker receives port, sends init through it to Dedicated Worker
7. Dedicated Worker initializes SQLite, responds ready
8. SharedWorker confirms init to UI
9. All subsequent queries: UI → SharedWorker → (via port) → Dedicated Worker
```

### Files involved

- `src/db/client/db-client.ts` — Creates both workers, establishes MessageChannel bridge
- `src/db/worker/db-shared-worker.ts` — Pure coordinator/router, receives worker port from UI
- `src/db/worker/db-worker.ts` — Accepts coordinator port via `__attach_port__` action, switches `postMessage` target

### Key implementation details

**Port transfer syntax** — Ports go in the transfer list (2nd arg), not the message data:
```typescript
// Sender
worker.postMessage({ action: '__attach_port__' }, [channel.port2]);
// Receiver — port arrives as event.ports[0]
self.onmessage = (event) => {
  const port = event.ports[0];
};
```

**Second tab connects** — SharedWorker already has a working worker port, responds to `init` immediately with `{ ready: true }`. No second Dedicated Worker is created.

**Tab that created the Worker closes** — The Dedicated Worker dies. SharedWorker's port goes dead. Subsequent requests time out (10s). On next `initDbClient()` call (panel reopen), SharedWorker responds `needsWorker: true` again and a fresh Worker is created.
