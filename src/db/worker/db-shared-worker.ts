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

/**
 * Health-check: send a lightweight ping to the dedicated worker and wait for a response.
 * Returns false if the worker doesn't respond within `timeoutMs`, which means the
 * dedicated worker was terminated (e.g., the tab/panel that spawned it was closed)
 * and the MessagePort is dead — messages sent to it silently disappear.
 */
function pingWorker(timeoutMs = 2000): Promise<boolean> {
  return new Promise((resolve) => {
    if (!workerPort) { resolve(false); return; }
    const pingId = `__ping__${Date.now()}`;
    const timer = setTimeout(() => resolve(false), timeoutMs);
    const onPong = (event: MessageEvent<WorkerResponse>) => {
      if (event.data.requestId === pingId) {
        clearTimeout(timer);
        workerPort!.removeEventListener('message', onPong);
        resolve(event.data.success);
      }
    };
    workerPort.addEventListener('message', onPong);
    workerPort.postMessage({ requestId: pingId, action: 'ping' } as WorkerRequest);
  });
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
        // Worker was previously initialized — verify it's still alive before
        // responding. A dedicated worker is owned by the document that created it;
        // when that side-panel/tab closes, Chrome terminates the worker but the
        // SharedWorker's MessagePort stays open (just dead). Without this ping,
        // we'd report "ready" and then every forwarded request would silently
        // vanish into the dead port, causing 10s timeouts on the UI side.
        pingWorker().then((alive) => {
          if (alive) {
            port.postMessage({
              requestId: request.requestId,
              success: true,
              data: { ready: true },
            } as WorkerResponse);
          } else {
            // Worker died — reset state and ask the new tab to spawn a replacement
            console.warn('[SharedWorker] Worker ping failed, requesting new worker');
            resetWorkerState();
            pendingInits.push({ port, requestId: request.requestId });
            port.postMessage({
              requestId: '__needs_worker__',
              success: true,
              data: { needsWorker: true },
            } as WorkerResponse);
          }
        });
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
