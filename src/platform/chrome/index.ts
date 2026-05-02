import type { PlatformId } from '../types';
import { ChromeStorage } from './storage';
import { ChromeDB } from './db';
import { ChromeNotes } from './notes';

export const platformId: PlatformId = 'chrome';
export const storage = new ChromeStorage();
export const db = new ChromeDB();
export const notes = new ChromeNotes();
export async function initPlatform(): Promise<void> {
  await db.init();
  await notes.init();
}
