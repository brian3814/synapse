import type { PlatformNotes } from '../types';

export class ElectronNotes implements PlatformNotes {
  private api = (window as any).electronNotes as {
    init: () => Promise<void>;
    read: (nodeId: string) => Promise<string | null>;
    write: (nodeId: string, markdown: string) => Promise<void>;
    remove: (nodeId: string) => Promise<void>;
    list: () => Promise<string[]>;
    exists: (nodeId: string) => Promise<boolean>;
  };

  async init(): Promise<void> {
    await this.api.init();
  }

  read(nodeId: string): Promise<string | null> {
    return this.api.read(nodeId);
  }

  write(nodeId: string, markdown: string): Promise<void> {
    return this.api.write(nodeId, markdown);
  }

  remove(nodeId: string): Promise<void> {
    return this.api.remove(nodeId);
  }

  list(): Promise<string[]> {
    return this.api.list();
  }

  exists(nodeId: string): Promise<boolean> {
    return this.api.exists(nodeId);
  }
}
