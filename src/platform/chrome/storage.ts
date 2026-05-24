import type { PlatformStorage, StorageChange } from '../types';

export class ChromeStorage implements PlatformStorage {
  get<T = Record<string, unknown>>(keys?: string | string[]): Promise<T> {
    // Cast through unknown to avoid Chrome's strict overloaded generic typings
    const getItems = chrome.storage.local.get as (k: unknown) => Promise<T>;
    return getItems(keys ?? null);
  }

  set(items: Record<string, unknown>): Promise<void> {
    return chrome.storage.local.set(items);
  }

  remove(keys: string | string[]): Promise<void> {
    return chrome.storage.local.remove(keys);
  }

  onChange(cb: (changes: Record<string, StorageChange>, area: string) => void): () => void {
    chrome.storage.onChanged.addListener(cb);
    return () => chrome.storage.onChanged.removeListener(cb);
  }
}
