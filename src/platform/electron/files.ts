import type { PlatformFiles } from '../types';

declare const window: Window & {
  electronIPC: {
    invoke(channel: string, ...args: unknown[]): Promise<unknown>;
    on(channel: string, cb: (...args: unknown[]) => void): () => void;
  };
};

export class ElectronFiles implements PlatformFiles {
  read(path: string): Promise<string | null> {
    return window.electronIPC.invoke('files:read', path) as Promise<string | null>;
  }

  write(path: string, content: string): Promise<void> {
    return window.electronIPC.invoke('files:write', path, content) as Promise<void>;
  }

  remove(path: string): Promise<void> {
    return window.electronIPC.invoke('files:remove', path) as Promise<void>;
  }

  list(prefix: string): Promise<string[]> {
    return window.electronIPC.invoke('files:list', prefix) as Promise<string[]>;
  }
}
