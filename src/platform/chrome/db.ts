import type { PlatformDB } from '../types';

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
};

const DB_REQUEST_TIMEOUT_MS = 10_000;

export class ChromeDB implements PlatformDB {
  private sharedWorker: SharedWorker | null = null;
  private port: MessagePort | null = null;
  private pendingRequests = new Map<
    string,
    { resolve: (data: unknown) => void; reject: (error: Error) => void; timer: ReturnType<typeof setTimeout> }
  >();

  async init(): Promise<void> {
    return new Promise((resolve, reject) => {
      try {
        const workerUrl = new URL('/db-shared-worker.js', location.origin).href;
        this.sharedWorker = new SharedWorker(workerUrl, { type: 'module' });
        this.port = this.sharedWorker.port;

        this.port.onmessage = (event: MessageEvent<WorkerResponse>) => {
          const { requestId, success, data, error } = event.data;

          // SharedWorker is asking us to create the Dedicated Worker
          if (requestId === '__needs_worker__') {
            this.spawnAndAttachWorker();
            return;
          }

          const pending = this.pendingRequests.get(requestId);
          if (!pending) return;

          clearTimeout(pending.timer);
          this.pendingRequests.delete(requestId);

          if (success) {
            pending.resolve(data);
          } else {
            pending.reject(new Error(error ?? 'Unknown DB error'));
          }
        };

        this.sharedWorker.onerror = (event) => {
          console.error('[ChromeDB] SharedWorker error:', event);
          reject(new Error('DB SharedWorker failed to load'));
        };

        this.port.start();

        // Send init — SharedWorker will either respond ready or ask us to create a worker
        this.request('init').then(() => {
          console.log('[DB Client] Database initialized via SharedWorker');
          resolve();
        }).catch(reject);
      } catch (e) {
        reject(e);
      }
    });
  }

  private spawnAndAttachWorker(): void {
    const dbWorkerUrl = new URL('/db-worker.js', location.origin).href;
    const dedicatedWorker = new Worker(dbWorkerUrl, { type: 'module' });

    dedicatedWorker.onerror = (event) => {
      console.error('[ChromeDB] Dedicated worker error:', event);
    };

    const channel = new MessageChannel();

    // Send one end to the Dedicated Worker (it will listen on this port)
    dedicatedWorker.postMessage({ action: '__attach_port__' }, [channel.port2]);

    // Send the other end to the SharedWorker (it will forward requests through this port)
    this.port!.postMessage(
      { requestId: '__attach_worker__', action: '__attach_worker__' },
      [channel.port1],
    );
  }

  private generateRequestId(): string {
    return `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
  }

  request(action: string, params?: unknown, timeoutMs?: number): Promise<unknown> {
    return new Promise((resolve, reject) => {
      if (!this.port) {
        reject(new Error('DB SharedWorker not initialized'));
        return;
      }

      const requestId = this.generateRequestId();

      const timer = setTimeout(() => {
        this.pendingRequests.delete(requestId);
        reject(new Error(`DB request timed out: ${action}`));
      }, timeoutMs ?? DB_REQUEST_TIMEOUT_MS);

      this.pendingRequests.set(requestId, { resolve, reject, timer });

      const workerRequest: WorkerRequest = { requestId, action, params };
      this.port.postMessage(workerRequest);
    });
  }

  onSync(cb: (event: unknown) => void): () => void {
    const channel = new BroadcastChannel('kg_extension_sync');
    channel.onmessage = (event) => cb(event.data);
    return () => channel.close();
  }

  /**
   * Notify the SharedWorker that this tab/panel is about to close and will take
   * the DedicatedWorker with it. The SharedWorker resets its state and asks any
   * surviving tab to spawn a replacement. Call this before `window.close()`.
   */
  notifyWorkerDying(): void {
    if (!this.port) return;
    this.port.postMessage({ requestId: '__worker_dying__', action: '__worker_dying__' } as WorkerRequest);
  }
}
