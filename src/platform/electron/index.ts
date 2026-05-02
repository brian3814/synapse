import type { PlatformId } from '../types';
import { ElectronStorage } from './storage';
import { ElectronDB } from './db';
import { ElectronNotes } from './notes';
import { ElectronLLM } from './llm';
import { ElectronBrowser } from './browser';

export const platformId: PlatformId = 'electron';
export const storage = new ElectronStorage();
export const db = new ElectronDB();
export const notes = new ElectronNotes();
export const llm = new ElectronLLM();
export const browser = new ElectronBrowser();
export async function initPlatform(): Promise<void> {
  await db.init();
  await notes.init();
}
