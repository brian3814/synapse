import type { PlatformArtifacts } from '../types';
import type { ArtifactRecord, ArtifactType } from '../../shared/artifact-types';

declare const window: Window & {
  electronIPC: {
    invoke(channel: string, ...args: unknown[]): Promise<unknown>;
    on(channel: string, cb: (...args: unknown[]) => void): () => void;
  };
};

export class ElectronArtifacts implements PlatformArtifacts {
  list(): Promise<ArtifactRecord[]> {
    return window.electronIPC.invoke('artifacts:list') as Promise<ArtifactRecord[]>;
  }

  get(id: string): Promise<ArtifactRecord | null> {
    return window.electronIPC.invoke('artifacts:get', id) as Promise<ArtifactRecord | null>;
  }

  getContent(id: string): Promise<string> {
    return window.electronIPC.invoke('artifacts:getContent', id) as Promise<string>;
  }

  create(params: {
    type: ArtifactType;
    title: string;
    content: string;
    sessionId: string;
    sessionTitle: string;
    sessionCreatedAt: string;
  }): Promise<ArtifactRecord> {
    return window.electronIPC.invoke('artifacts:create', params) as Promise<ArtifactRecord>;
  }

  update(id: string, content: string, title?: string): Promise<ArtifactRecord> {
    return window.electronIPC.invoke('artifacts:update', { id, content, title }) as Promise<ArtifactRecord>;
  }

  delete(id: string): Promise<void> {
    return window.electronIPC.invoke('artifacts:delete', id) as Promise<void>;
  }

  search(query: string): Promise<ArtifactRecord[]> {
    return window.electronIPC.invoke('artifacts:search', query) as Promise<ArtifactRecord[]>;
  }

  onChanged(cb: (artifact: ArtifactRecord) => void): () => void {
    return window.electronIPC.on('artifacts:changed', (data: unknown) => {
      cb(data as ArtifactRecord);
    });
  }
}
