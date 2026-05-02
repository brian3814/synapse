import type { PlatformId } from '../types';
import { ChromeStorage } from './storage';
import { ChromeDB } from './db';
import { ChromeNotes } from './notes';
import { ChromeLLM } from './llm';
import { ChromeBrowser } from './browser';

export const platformId: PlatformId = 'chrome';
export const storage = new ChromeStorage();
export const db = new ChromeDB();
export const notes = new ChromeNotes();
export const llm = new ChromeLLM();
export const browser = new ChromeBrowser();
export async function initPlatform(): Promise<void> {
  await db.init();
  await notes.init();
}
