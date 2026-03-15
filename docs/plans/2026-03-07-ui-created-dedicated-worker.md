# UI-Created Dedicated Worker Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Fix "Worker is not defined" error by having the UI thread create the Dedicated Worker and pass a MessageChannel port to the SharedWorker coordinator, following Notion's WASM SQLite architecture.

**Architecture:** The UI thread (db-client.ts) creates both the SharedWorker and the Dedicated Worker. It bridges them via a MessageChannel — one port transferred to the SharedWorker, the other to the Dedicated Worker. The SharedWorker remains a pure coordinator/router: it receives queries from any tab's port, forwards them to the Dedicated Worker via the transferred port, and routes responses back. The Dedicated Worker switches from `self.onmessage`/`self.postMessage` to using the coordinator port once it receives one.

**Tech Stack:** TypeScript, Web Workers API, MessageChannel, SharedWorker, Chrome Extension MV3

---

### Task 1: Modify db-worker.ts to accept a coordinator port

**Files:**
- Modify: `src/db/worker/db-worker.ts:301-326`

The Dedicated Worker currently uses `self.onmessage` / `self.postMessage`. It needs to also support receiving a coordinator port via a special message, then switch all communication to that port.

**Step 1: Refactor db-worker.ts message handling**

Replace lines 301-326 with code that:
1. Extracts the message handler into a reusable function
2. Listens on `self.onmessage` by default
3. When it receives a `__attach_port__` message with a transferred port, switches to that port for all future communication

```typescript
let messageTarget: { postMessage: (msg: any) => void } = self;

async function handleMessage(event: MessageEvent<WorkerRequest>) {
  const { requestId, action, params } = event.data;

  try {
    const outcome = await handleAction(action, params);

    const response: WorkerResponse = {
      requestId,
      success: true,
      data: outcome.result,
      syncEvent: outcome.syncEvent,
    };
    messageTarget.postMessage(response);
  } catch (error: any) {
    console.error(`[DB Worker] Error handling ${action}:`, error);
    const response: WorkerResponse = {
      requestId,
      success: false,
      error: error.message ?? String(error),
    };
    messageTarget.postMessage(response);
  }
}

self.onmessage = (event: MessageEvent) => {
  // Check for coordinator port attachment
  if (event.data?.action === '__attach_port__' && event.ports?.length > 0) {
    const coordinatorPort = event.ports[0];
    messageTarget = coordinatorPort;
    coordinatorPort.onmessage = handleMessage;
    coordinatorPort.start();
    console.log('[DB Worker] Coordinator port attached');
    return;
  }

  // Default: handle as normal request (fallback for direct usage without SharedWorker)
  handleMessage(event);
};

// Signal that the worker script has loaded
self.postMessage({ requestId: '__init__', success: true, data: 'worker-loaded' });
```

Key details:
- `event.ports[0]` is how transferred `MessagePort`s arrive when using `postMessage(data, [port])` with the port in the transfer list (not in the data object)
- `messageTarget` switches from `self` to the coordinator port so all responses flow through the SharedWorker
- The `__init__` signal still goes via `self.postMessage` to the UI (harmless, UI ignores it)

**Step 2: Build and verify no TypeScript errors**

Run: `npm run build`
Expected: Build succeeds with no type errors in db-worker.ts

**Step 3: Commit**

```bash
git add src/db/worker/db-worker.ts
git commit -m "refactor: db-worker accepts coordinator port for SharedWorker bridge"
```

---

### Task 2: Rewrite db-shared-worker.ts as a pure coordinator

**Files:**
- Modify: `src/db/worker/db-shared-worker.ts` (full rewrite)

Remove all `new Worker()` code. The SharedWorker becomes a pure message router that:
1. Waits to receive a worker port from a UI tab via `__attach_worker__`
2. Routes requests from tab ports to the worker port
3. Routes responses back to the originating tab port
4. Broadcasts sync events

**Step 1: Rewrite db-shared-worker.ts**

Replace the entire file with:

```typescript
/// <reference lib="webworker" />

import { SYNC_CHANNEL, type SyncEvent } from '../../shared/sync-events';

/**
 * SharedWorker coordinator — pure message router.
 * Does NOT create any Workers (SharedWorkerGlobalScope lacks the Worker constructor
 * in Chrome extensions). Instead, the first UI tab creates the Dedicated Worker
 * and passes a MessageChannel port here via __attach_worker__.
 *
 * Flow:
 *   Tab sends init → SharedWorker responds { needsWorker: true } if no worker port
 *   Tab creates Worker + MessageChannel, transfers port here via __attach_worker__
 *   SharedWorker sends init through the port, waits for ready
 *   All subsequent requests are forwarded through the worker port
 */

type WorkerRequest = {
  requestId: string;
  action: string;
  params?: unknown;
};

type WorkerResponse = {
  requestId: string;
  success: boolean;
  data?: unknown;
  error?: string;
  syncEvent?: SyncEvent;
};

declare var self: SharedWorkerGlobalScope;

const syncChannel = new BroadcastChannel(SYNC_CHANNEL);

// Track which tab port sent each request so we can route responses back
const pendingRequests = new Map<string, MessagePort>();

// The MessagePort connected to the Dedicated Worker (received from UI)
let workerPort: MessagePort | null = null;
let workerReady = false;

// Queued init callbacks waiting for the worker to become ready
const pendingInits: Array<{ port: MessagePort; requestId: string }> = [];

// Queue requests that arrive before the worker port is ready
const earlyQueue: Array<{ port: MessagePort; request: WorkerRequest }> = [];

function onWorkerMessage(event: MessageEvent<WorkerResponse>): void {
  const { requestId, success, data, error, syncEvent } = event.data;

  // Route response back to the originating tab port
  const originPort = pendingRequests.get(requestId);
  if (originPort) {
    pendingRequests.delete(requestId);
    originPort.postMessage({ requestId, success, data, error } as WorkerResponse);
  }

  // Broadcast sync event to all tabs
  if (syncEvent) {
    syncChannel.postMessage(syncEvent);
  }
}

function forwardToWorker(port: MessagePort, request: WorkerRequest): void {
  if (!workerPort) return;
  pendingRequests.set(request.requestId, port);
  workerPort.postMessage(request);
}

function resetWorkerState(): void {
  workerPort = null;
  workerReady = false;

  // Reject all pending requests
  for (const [reqId, port] of pendingRequests) {
    port.postMessage({
      requestId: reqId,
      success: false,
      error: 'Dedicated DB worker disconnected',
    } as WorkerResponse);
  }
  pendingRequests.clear();
}

function attachWorkerPort(port: MessagePort): void {
  // If we already have a working worker port, ignore
  if (workerPort && workerReady) {
    return;
  }

  workerPort = port;
  workerPort.onmessage = onWorkerMessage;
  workerPort.start();

  // Send init to the dedicated worker through the port
  const initRequestId = `__coordinator_init__${Date.now()}`;

  const onInitResponse = (event: MessageEvent<WorkerResponse>) => {
    if (event.data.requestId === initRequestId) {
      workerPort!.removeEventListener('message', onInitResponse);
      workerPort!.onmessage = onWorkerMessage;

      if (event.data.success) {
        workerReady = true;

        // Resolve all pending init requests
        for (const { port: initPort, requestId } of pendingInits) {
          initPort.postMessage({
            requestId,
            success: true,
            data: { ready: true },
          } as WorkerResponse);
        }
        pendingInits.length = 0;

        // Flush any queued requests
        for (const { port: qPort, request } of earlyQueue) {
          forwardToWorker(qPort, request);
        }
        earlyQueue.length = 0;
      } else {
        // Init failed — reset and let next tab try
        resetWorkerState();
        for (const { port: initPort, requestId } of pendingInits) {
          initPort.postMessage({
            requestId,
            success: false,
            error: event.data.error ?? 'Dedicated worker init failed',
          } as WorkerResponse);
        }
        pendingInits.length = 0;
      }
    }
  };

  // Temporarily add init listener alongside the main handler
  workerPort.addEventListener('message', onInitResponse);
  workerPort.postMessage({ requestId: initRequestId, action: 'init' } as WorkerRequest);
}

self.onconnect = (connectEvent: MessageEvent) => {
  const port = connectEvent.ports[0];

  port.onmessage = (event: MessageEvent) => {
    const request = event.data as WorkerRequest;

    // Handle worker port attachment from UI
    if (request.action === '__attach_worker__' && event.ports?.length > 0) {
      attachWorkerPort(event.ports[0]);
      return;
    }

    // Handle init requests
    if (request.action === 'init') {
      if (workerReady) {
        // Worker already initialized — respond immediately
        port.postMessage({
          requestId: request.requestId,
          success: true,
          data: { ready: true },
        } as WorkerResponse);
      } else {
        // Queue this init and tell the tab we need a worker
        pendingInits.push({ port, requestId: request.requestId });
        port.postMessage({
          requestId: '__needs_worker__',
          success: true,
          data: { needsWorker: true },
        } as WorkerResponse);
      }
      return;
    }

    // For all other actions, forward to dedicated worker
    if (workerReady && workerPort) {
      forwardToWorker(port, request);
    } else {
      earlyQueue.push({ port, request });
    }
  };

  port.start();
};
```

Key changes from the old version:
- Removed `spawnDedicatedWorker()` and all `new Worker()` code
- Added `attachWorkerPort()` that receives a port from the UI
- Init response now includes `needsWorker: true` when no worker port exists
- `__attach_worker__` action receives the transferred port via `event.ports[0]`
- Removed the `__init__` / `worker-connected` signal on connect (unnecessary)

**Step 2: Build and verify no TypeScript errors**

Run: `npm run build`
Expected: Build succeeds with no type errors in db-shared-worker.ts

**Step 3: Commit**

```bash
git add src/db/worker/db-shared-worker.ts
git commit -m "refactor: SharedWorker as pure coordinator, receives worker port from UI"
```

---

### Task 3: Update db-client.ts to create the Dedicated Worker and bridge via MessageChannel

**Files:**
- Modify: `src/db/client/db-client.ts:29-79`

The client now:
1. Creates the SharedWorker and sends `init`
2. Listens for `__needs_worker__` response
3. Creates the Dedicated Worker + MessageChannel
4. Transfers one port to the Dedicated Worker, one to the SharedWorker
5. Waits for the SharedWorker to confirm init complete

**Step 1: Rewrite initDbClient()**

Replace the `initDbClient` function (lines 29-79) with:

```typescript
export function initDbClient(): Promise<void> {
  if (initPromise) return initPromise;

  initPromise = new Promise((resolve, reject) => {
    try {
      const workerUrl = new URL('/db-shared-worker.js', location.origin).href;
      sharedWorker = new SharedWorker(workerUrl, { type: 'module' });
      port = sharedWorker.port;

      // Track whether we've resolved init (to distinguish __needs_worker__ from init response)
      let initResolved = false;

      port.onmessage = (event: MessageEvent<WorkerResponse>) => {
        const { requestId, success, data, error } = event.data;

        // SharedWorker is asking us to create the Dedicated Worker
        if (requestId === '__needs_worker__') {
          spawnAndAttachWorker();
          return;
        }

        const pending = pendingRequests.get(requestId);
        if (!pending) return;

        clearTimeout(pending.timer);
        pendingRequests.delete(requestId);

        if (success) {
          pending.resolve(data);
        } else {
          pending.reject(new Error(error ?? 'Unknown DB error'));
        }
      };

      sharedWorker.onerror = (event) => {
        console.error('[DB Client] SharedWorker error:', event);
        reject(new Error('DB SharedWorker failed to load'));
      };

      port.start();

      // Send init — SharedWorker will either respond ready or ask us to create a worker
      sendRequest('init').then(() => {
        console.log('[DB Client] Database initialized via SharedWorker');
        resolve();
      }).catch(reject);
    } catch (e) {
      reject(e);
    }
  });

  return initPromise;
}

function spawnAndAttachWorker(): void {
  const dbWorkerUrl = new URL('/db-worker.js', location.origin).href;
  const dedicatedWorker = new Worker(dbWorkerUrl, { type: 'module' });

  dedicatedWorker.onerror = (event) => {
    console.error('[DB Client] Dedicated worker error:', event);
  };

  const channel = new MessageChannel();

  // Send one end to the Dedicated Worker (it will listen on this port)
  dedicatedWorker.postMessage({ action: '__attach_port__' }, [channel.port2]);

  // Send the other end to the SharedWorker (it will forward requests through this port)
  port!.postMessage(
    { requestId: '__attach_worker__', action: '__attach_worker__' },
    [channel.port1],
  );
}
```

Key details:
- `spawnAndAttachWorker()` is called when the SharedWorker sends `__needs_worker__`
- `MessageChannel` creates a pair: `port1` goes to SharedWorker, `port2` goes to Dedicated Worker
- Ports are transferred (not cloned) via the second argument to `postMessage`
- The Dedicated Worker receives `port2` via `event.ports[0]` in its `self.onmessage`
- The SharedWorker receives `port1` via `event.ports[0]` in its `__attach_worker__` handler
- The `sendRequest('init')` promise stays pending until the SharedWorker confirms ready (after the worker port round-trip)
- The unused `initResolved` variable should be removed (leftover from drafting)

**Step 2: Remove the unused `initResolved` variable**

The `let initResolved = false;` on line ~10 of the new code is unused. Remove it.

**Step 3: Build and verify**

Run: `npm run build`
Expected: Build succeeds, no type errors

**Step 4: Commit**

```bash
git add src/db/client/db-client.ts
git commit -m "feat: UI creates Dedicated Worker and bridges to SharedWorker via MessageChannel"
```

---

### Task 4: Update CLAUDE.md architecture description

**Files:**
- Modify: `CLAUDE.md` — Update the DB SharedWorker bullet point in the Architecture section

**Step 1: Update the architecture description**

Change the DB SharedWorker bullet (currently says "SharedWorker running wa-sqlite") to:

```markdown
- **DB SharedWorker** (`src/db/worker/`) — Pure coordinator/router. Does not run SQLite directly. The UI thread creates the Dedicated Worker (which holds SQLite with OPFS) and bridges it to the SharedWorker via a `MessageChannel`. The SharedWorker routes requests from all tab ports to the single Dedicated Worker port and broadcasts sync events. This pattern is necessary because `Worker` is not available in `SharedWorkerGlobalScope` in Chrome extensions.
```

**Step 2: Commit**

```bash
git add CLAUDE.md
git commit -m "docs: update architecture description for UI-created worker pattern"
```

---

### Task 5: Manual verification in Chrome

**Step 1: Build**

Run: `npm run build`

**Step 2: Load extension**

1. Open `chrome://extensions`
2. Enable developer mode
3. Load unpacked → select `dist/`
4. Open the side panel

**Step 3: Verify in DevTools**

1. Open DevTools for the side panel
2. Check console — should see `[DB Client] Database initialized via SharedWorker`
3. No "Worker is not defined" errors
4. Check `chrome://inspect/#workers` — should see both SharedWorker and Dedicated Worker listed
5. Create a node in the graph — should persist and appear after panel reload

**Step 4: Multi-tab test**

1. Open the extension in a second tab (full-tab mode)
2. Verify it connects to the same SharedWorker (no second Dedicated Worker created)
3. Create a node in one view, verify it appears in the other via sync events
