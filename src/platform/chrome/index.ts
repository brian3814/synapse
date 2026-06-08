import type { PlatformId } from '../types';
import { ChromeStorage } from './storage';
import { ChromeDB } from './db';
import { ChromeNotes } from './notes';
import { ChromeVault } from './vault';
import { ChromeFiles } from './files';
import { ChromeLLM } from './llm';
import { ChromeBrowser } from './browser';
import { ChromeEmbedding } from './embedding';
export { vaultWorkspace } from './vault-workspace';

export const platformId: PlatformId = 'chrome';
export const storage = new ChromeStorage();
export const db = new ChromeDB();
export const notes = new ChromeNotes();
export const vault = new ChromeVault();
export const files = new ChromeFiles();
export const llm = new ChromeLLM();
export const browser = new ChromeBrowser();
export const embedding = new ChromeEmbedding();
export const artifacts = {
  list: async () => [],
  get: async () => null,
  getContent: async () => '',
  create: async () => { throw new Error('Artifacts not supported in Chrome extension'); },
  update: async () => { throw new Error('Artifacts not supported in Chrome extension'); },
  delete: async () => {},
  search: async () => [],
  onChanged: () => () => {},
} as any;
export async function initPlatform(): Promise<void> {
  await db.init();
  await notes.init();
  await vault.init();
}
