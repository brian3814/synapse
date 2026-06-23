import type { PlatformStorage, StorageChange } from '../types';

declare const window: Window & {
  electronIPC: {
    invoke(channel: string, ...args: unknown[]): Promise<unknown>;
    on(channel: string, cb: (...args: unknown[]) => void): () => void;
  };
};

export class ElectronStorage implements PlatformStorage {
  get<T = Record<string, unknown>>(keys?: string | string[]): Promise<T> {
    return window.electronIPC.invoke('storage:get', keys) as Promise<T>;
  }

  set(items: Record<string, unknown>): Promise<void> {
    return window.electronIPC.invoke('storage:set', items) as Promise<void>;
  }

  remove(keys: string | string[]): Promise<void> {
    return window.electronIPC.invoke('storage:remove', keys) as Promise<void>;
  }

  onChange(cb: (changes: Record<string, StorageChange>, area: string) => void): () => void {
    return window.electronIPC.on('storage:changed', (changes: unknown, area: unknown) => {
      cb(changes as Record<string, StorageChange>, area as string);
    });
  }
}
