import type { PlatformNotes } from '../types';

declare const window: Window & {
  electronIPC: {
    invoke(channel: string, ...args: unknown[]): Promise<unknown>;
    on(channel: string, cb: (...args: unknown[]) => void): () => void;
  };
};

export class ElectronNotes implements PlatformNotes {
  async init(): Promise<void> {
    await window.electronIPC.invoke('notes:init');
  }

  read(nodeId: string): Promise<string | null> {
    return window.electronIPC.invoke('notes:read', nodeId) as Promise<string | null>;
  }

  write(nodeId: string, markdown: string): Promise<void> {
    return window.electronIPC.invoke('notes:write', nodeId, markdown) as Promise<void>;
  }

  remove(nodeId: string): Promise<void> {
    return window.electronIPC.invoke('notes:remove', nodeId) as Promise<void>;
  }

  list(): Promise<string[]> {
    return window.electronIPC.invoke('notes:list') as Promise<string[]>;
  }

  exists(nodeId: string): Promise<boolean> {
    return window.electronIPC.invoke('notes:exists', nodeId) as Promise<boolean>;
  }
}
