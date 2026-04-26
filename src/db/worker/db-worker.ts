/// <reference lib="webworker" />

import { initSQLite, resetDatabase } from './sqlite-engine';
import { createActionHandler } from './action-handler';
import type { SyncEvent } from '../../shared/sync-events';

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

const handleAction = createActionHandler(
  async () => { await initSQLite(); },
  async () => { await resetDatabase(); },
);

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
  if (event.data?.action === '__attach_port__' && event.ports?.length > 0) {
    const coordinatorPort = event.ports[0];
    messageTarget = coordinatorPort;
    coordinatorPort.onmessage = handleMessage;
    coordinatorPort.start();
    console.log('[DB Worker] Coordinator port attached');
    return;
  }

  handleMessage(event);
};

self.postMessage({ requestId: '__init__', success: true, data: 'worker-loaded' });
