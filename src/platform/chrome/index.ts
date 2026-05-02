import type { PlatformId } from '../types';
import { ChromeStorage } from './storage';

export const platformId: PlatformId = 'chrome';
export const storage = new ChromeStorage();
export async function initPlatform(): Promise<void> {}
