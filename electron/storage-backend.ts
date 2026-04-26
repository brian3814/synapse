import { app, safeStorage } from 'electron';
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';
import { join, dirname } from 'path';

const STORAGE_FILE = join(app.getPath('userData'), 'storage.json');

const FULLY_ENCRYPTED_KEYS = new Set(['anthropicOAuth']);

function shouldEncryptField(key: string, field: string): boolean {
  return key === 'llmConfig' && field === 'apiKey';
}

export class StorageBackend {
  private data: Record<string, any> = {};

  constructor() {
    this.load();
  }

  private load(): void {
    try {
      if (existsSync(STORAGE_FILE)) {
        this.data = JSON.parse(readFileSync(STORAGE_FILE, 'utf-8'));
      }
    } catch (e) {
      console.warn('[StorageBackend] Corrupted storage.json, starting fresh:', e);
      this.data = {};
    }
  }

  private save(): void {
    const dir = dirname(STORAGE_FILE);
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    writeFileSync(STORAGE_FILE, JSON.stringify(this.data, null, 2), 'utf-8');
  }

  private canEncrypt(): boolean {
    return safeStorage.isEncryptionAvailable();
  }

  private encrypt(plaintext: string): string {
    if (!this.canEncrypt()) {
      console.warn('[StorageBackend] OS keychain unavailable, storing secret in plaintext');
      return plaintext;
    }
    return safeStorage.encryptString(plaintext).toString('base64');
  }

  private decrypt(stored: string): string {
    if (!this.canEncrypt()) return stored;
    try {
      return safeStorage.decryptString(Buffer.from(stored, 'base64'));
    } catch {
      return stored;
    }
  }

  private encryptForStorage(key: string, value: any): any {
    if (FULLY_ENCRYPTED_KEYS.has(key)) {
      return { __encrypted: this.encrypt(JSON.stringify(value)) };
    }
    if (key === 'llmConfig' && value && typeof value === 'object' && 'apiKey' in value) {
      const { apiKey, ...rest } = value;
      return {
        ...rest,
        apiKey: apiKey ? this.encrypt(apiKey) : apiKey,
        __keyEncrypted: true,
      };
    }
    return value;
  }

  private decryptFromStorage(key: string, raw: any): any {
    if (raw && typeof raw === 'object' && '__encrypted' in raw) {
      try {
        return JSON.parse(this.decrypt(raw.__encrypted));
      } catch {
        return null;
      }
    }
    if (raw && typeof raw === 'object' && '__keyEncrypted' in raw) {
      const { __keyEncrypted, apiKey, ...rest } = raw;
      return { ...rest, apiKey: apiKey ? this.decrypt(apiKey) : apiKey };
    }
    return raw;
  }

  get(keys?: string | string[] | Record<string, any> | null): Record<string, any> {
    if (keys === undefined || keys === null) {
      const result: Record<string, any> = {};
      for (const [k, v] of Object.entries(this.data)) {
        result[k] = this.decryptFromStorage(k, v);
      }
      return result;
    }

    if (typeof keys === 'string') {
      const result: Record<string, any> = {};
      if (keys in this.data) {
        result[keys] = this.decryptFromStorage(keys, this.data[keys]);
      }
      return result;
    }

    if (Array.isArray(keys)) {
      const result: Record<string, any> = {};
      for (const k of keys) {
        if (k in this.data) {
          result[k] = this.decryptFromStorage(k, this.data[k]);
        }
      }
      return result;
    }

    const result: Record<string, any> = {};
    for (const [k, defaultVal] of Object.entries(keys)) {
      result[k] = k in this.data ? this.decryptFromStorage(k, this.data[k]) : defaultVal;
    }
    return result;
  }

  set(items: Record<string, any>): Record<string, { oldValue?: any; newValue: any }> {
    const changes: Record<string, { oldValue?: any; newValue: any }> = {};

    for (const [key, newValue] of Object.entries(items)) {
      const oldDecrypted = key in this.data
        ? this.decryptFromStorage(key, this.data[key])
        : undefined;

      changes[key] = { newValue };
      if (oldDecrypted !== undefined) {
        changes[key].oldValue = oldDecrypted;
      }

      this.data[key] = this.encryptForStorage(key, newValue);
    }

    this.save();
    return changes;
  }

  remove(keys: string | string[]): Record<string, { oldValue: any }> {
    if (typeof keys === 'string') keys = [keys];
    const changes: Record<string, { oldValue: any }> = {};

    for (const key of keys) {
      if (key in this.data) {
        changes[key] = { oldValue: this.decryptFromStorage(key, this.data[key]) };
        delete this.data[key];
      }
    }

    if (Object.keys(changes).length > 0) this.save();
    return changes;
  }
}
