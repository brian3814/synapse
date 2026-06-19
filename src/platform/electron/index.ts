import type { PlatformId } from '../types';
import { ElectronStorage } from './storage';
import { ElectronDB } from './db';
import { ElectronNotes } from './notes';
import { ElectronVault } from './vault';
import { ElectronFiles } from './files';
import { ElectronLLM } from './llm';
import { ElectronBrowser } from './browser';
import { ElectronEmbedding } from './embedding';
import { ElectronArtifacts } from './artifacts';
export { vaultWorkspace } from './vault-workspace';

export const platformId: PlatformId = 'electron';
export const storage = new ElectronStorage();
export const db = new ElectronDB();
export const notes = new ElectronNotes();
export const vault = new ElectronVault();
export const files = new ElectronFiles();
export const llm = new ElectronLLM();
export const browser = new ElectronBrowser();
export const embedding = new ElectronEmbedding();
export const artifacts = new ElectronArtifacts();
declare const window: Window & {
  electronIPC: {
    invoke(channel: string, ...args: unknown[]): Promise<unknown>;
    on(channel: string, cb: (...args: unknown[]) => void): () => void;
  };
};

export const entityFiles: import('../types').PlatformEntityFiles = {
  async generateAll() { return window.electronIPC.invoke('entity-files:generate-all') as Promise<{ generated: number }>; },
  async listSyncIssues() { return window.electronIPC.invoke('entity-files:list-sync-issues') as Promise<any[]>; },
  async dismissSyncIssue(id) { return window.electronIPC.invoke('entity-files:dismiss-sync-issue', id) as Promise<void>; },
  async resolveNotification(id, action) { return window.electronIPC.invoke('entity-files:resolve-notification', id, action) as Promise<void>; },
  async read(nodeId) { return window.electronIPC.invoke('entity-files:read', nodeId) as Promise<any>; },
  async append(nodeId, text, expectedHash?) { return window.electronIPC.invoke('entity-files:append', nodeId, text, expectedHash) as Promise<{ contentHash: string }>; },
  async patch(nodeId, patch, expectedHash?) { return window.electronIPC.invoke('entity-files:patch', nodeId, patch, expectedHash) as Promise<{ contentHash: string }>; },
};

export async function initPlatform(): Promise<void> {
  await db.init();
  await notes.init();
  await vault.init();
}
