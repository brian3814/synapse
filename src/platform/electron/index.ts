import type { PlatformId } from '../types';
import { ElectronStorage } from './storage';
import { ElectronDB } from './db';
import { ElectronNotes } from './notes';
import { ElectronVault } from './vault';
import { ElectronFiles } from './files';
import { ElectronLLM } from './llm';
import { ElectronBrowser } from './browser';
import { ElectronEmbedding } from './embedding';
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
export async function initPlatform(): Promise<void> {
  await db.init();
  await notes.init();
  await vault.init();
}
