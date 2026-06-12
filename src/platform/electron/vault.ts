import type { PlatformVault } from '../types';

declare const window: Window & {
  electronIPC: {
    invoke(channel: string, ...args: unknown[]): Promise<unknown>;
    on(channel: string, cb: (...args: unknown[]) => void): () => void;
  };
};

export class ElectronVault implements PlatformVault {
  async init(): Promise<void> {
    await window.electronIPC.invoke('vault:init');
  }

  async store(data: ArrayBuffer, filename: string, nodeId: string): Promise<{ vaultPath: string }> {
    const arr = Array.from(new Uint8Array(data));
    return window.electronIPC.invoke('vault:store', arr, filename, nodeId) as Promise<{ vaultPath: string }>;
  }

  async read(vaultPath: string): Promise<ArrayBuffer> {
    const arr = await window.electronIPC.invoke('vault:read', vaultPath) as number[];
    return new Uint8Array(arr).buffer;
  }

  async remove(vaultPath: string): Promise<void> {
    await window.electronIPC.invoke('vault:remove', vaultPath);
  }

  async getStorageUsage(): Promise<{ bytes: number; fileCount: number }> {
    return window.electronIPC.invoke('vault:usage') as Promise<{ bytes: number; fileCount: number }>;
  }
}
