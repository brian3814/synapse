import type { PlatformDB } from '../types';

declare const window: Window & {
  electronIPC: {
    invoke(channel: string, ...args: unknown[]): Promise<unknown>;
    on(channel: string, cb: (...args: unknown[]) => void): () => void;
  };
};

export class ElectronDB implements PlatformDB {
  async init(): Promise<void> {
    const response = await window.electronIPC.invoke('db:request', 'init', undefined) as {
      success: boolean;
      data?: unknown;
      error?: string;
    };
    if (!response.success) throw new Error(response.error ?? 'DB init failed');
    console.log('[DB Client] Database initialized via Electron IPC (better-sqlite3)');
  }

  async request(action: string, params?: unknown): Promise<unknown> {
    const response = await window.electronIPC.invoke('db:request', action, params) as {
      success: boolean;
      data?: unknown;
      error?: string;
    };
    if (!response.success) throw new Error(response.error ?? 'DB request failed');
    return response.data;
  }

  onSync(cb: (event: unknown) => void): () => void {
    return window.electronIPC.on('db:sync', (event: unknown) => cb(event));
  }
}
