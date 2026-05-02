import type { PlatformId } from '../types';
import { ChromeStorage } from './storage';
import { ChromeDB } from './db';

export const platformId: PlatformId = 'chrome';
export const storage = new ChromeStorage();
export const db = new ChromeDB();
export async function initPlatform(): Promise<void> {
  await db.init();
}
