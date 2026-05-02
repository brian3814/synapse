import type { PlatformId } from '../types';
import { ElectronStorage } from './storage';

export const platformId: PlatformId = 'electron';
export const storage = new ElectronStorage();
export async function initPlatform(): Promise<void> {}
