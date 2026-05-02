import type { PlatformDB } from '../types';

export class ElectronDB implements PlatformDB {
  async init(): Promise<void> {
    const electronDB = (window as any).electronDB as {
      request: (action: string, params?: unknown) => Promise<{ success: boolean; data?: unknown; error?: string }>;
      onSync: (callback: (event: any) => void) => () => void;
    };
    const response = await electronDB.request('init', undefined);
    if (!response.success) throw new Error(response.error ?? 'DB init failed');
    console.log('[DB Client] Database initialized via Electron IPC (better-sqlite3)');
  }

  async request(action: string, params?: unknown): Promise<unknown> {
    const electronDB = (window as any).electronDB as {
      request: (action: string, params?: unknown) => Promise<{ success: boolean; data?: unknown; error?: string }>;
    };
    const response = await electronDB.request(action, params);
    if (!response.success) throw new Error(response.error ?? 'DB request failed');
    return response.data;
  }

  onSync(cb: (event: unknown) => void): () => void {
    const electronDB = (window as any).electronDB as {
      onSync: (callback: (event: any) => void) => () => void;
    };
    return electronDB.onSync(cb);
  }
}
