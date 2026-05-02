import type { PlatformId } from '../types';
import { ElectronStorage } from './storage';
import { ElectronDB } from './db';

export const platformId: PlatformId = 'electron';
export const storage = new ElectronStorage();
export const db = new ElectronDB();
export async function initPlatform(): Promise<void> {
  await db.init();
}
