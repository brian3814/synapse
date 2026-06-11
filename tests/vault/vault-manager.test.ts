import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdirSync, writeFileSync, rmSync, existsSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { randomUUID } from 'crypto';

vi.mock('electron', () => ({
  dialog: { showOpenDialog: vi.fn() },
  BrowserWindow: { getFocusedWindow: vi.fn() },
}));

const mockDb = { pragma: vi.fn(), exec: vi.fn(), prepare: vi.fn(() => ({ run: vi.fn(), get: vi.fn(), all: vi.fn() })) };
vi.mock('../../electron/better-sqlite3-engine', () => ({
  resetBetterSQLite: vi.fn(),
  getDb: () => mockDb,
}));

vi.mock('../../src/db/worker/migrations', () => ({
  runMigrations: vi.fn(),
}));

import { VaultManager } from '../../electron/vault/vault-manager';
import { scaffoldVault } from '../../electron/vault/vault-context';

// ── Minimal in-memory storage ──────────────────────────────────────────

function createMockStorage() {
  const data: Record<string, any> = {};
  return {
    get(keys?: string | string[] | Record<string, any> | null) {
      if (typeof keys === 'string') {
        const result: Record<string, any> = {};
        if (keys in data) result[keys] = data[keys];
        return result;
      }
      return { ...data };
    },
    set(items: Record<string, any>) {
      for (const [k, v] of Object.entries(items)) data[k] = v;
      return {};
    },
    remove(keys: string | string[]) {
      const arr = typeof keys === 'string' ? [keys] : keys;
      for (const k of arr) delete data[k];
      return {};
    },
  };
}

// ── Test setup ─────────────────────────────────────────────────────────

let tmpPath: string;
let manager: VaultManager;
let storage: ReturnType<typeof createMockStorage>;

beforeEach(() => {
  tmpPath = join(tmpdir(), `synapse-vm-test-${randomUUID()}`);
  mkdirSync(tmpPath, { recursive: true });
  storage = createMockStorage();
  manager = new VaultManager(storage as any);
});

afterEach(() => {
  rmSync(tmpPath, { recursive: true, force: true });
});

// ── Tests ──────────────────────────────────────────────────────────────

describe('VaultManager.open — error cases', () => {
  it('throws VAULT_DIR_MISSING when directory does not exist', async () => {
    const missingDir = join(tmpPath, 'nonexistent');

    await expect(manager.open(missingDir)).rejects.toThrow(`VAULT_DIR_MISSING:${missingDir}`);
  });

  it('throws VAULT_KG_MISSING when directory exists but .kg/config.json is absent', async () => {
    const vaultDir = join(tmpPath, 'empty-vault');
    mkdirSync(vaultDir);

    await expect(manager.open(vaultDir)).rejects.toThrow(`VAULT_KG_MISSING:${vaultDir}`);
  });

  it('throws VAULT_KG_MISSING when .kg dir exists but config.json is missing', async () => {
    const vaultDir = join(tmpPath, 'partial-vault');
    mkdirSync(join(vaultDir, '.kg'), { recursive: true });

    await expect(manager.open(vaultDir)).rejects.toThrow(`VAULT_KG_MISSING:${vaultDir}`);
  });

  it('succeeds when .kg/config.json exists', async () => {
    const vaultDir = join(tmpPath, 'good-vault');
    scaffoldVault(vaultDir, 'Good Vault');

    const ctx = await manager.open(vaultDir);

    expect(ctx.name).toBe('Good Vault');
    expect(ctx.path).toBe(vaultDir);
  });
});

describe('VaultManager.reinitialize', () => {
  it('re-scaffolds .kg and opens the vault', async () => {
    const vaultDir = join(tmpPath, 'broken-vault');
    mkdirSync(vaultDir);

    expect(existsSync(join(vaultDir, '.kg', 'config.json'))).toBe(false);

    const ctx = await manager.reinitialize(vaultDir);

    expect(existsSync(join(vaultDir, '.kg', 'config.json'))).toBe(true);
    expect(ctx.path).toBe(vaultDir);
    expect(ctx.name).toBe('broken-vault');
  });

  it('works even when .kg partially exists', async () => {
    const vaultDir = join(tmpPath, 'partial-kg');
    mkdirSync(join(vaultDir, '.kg'), { recursive: true });
    writeFileSync(join(vaultDir, '.kg', 'stale-file.txt'), 'leftover');

    const ctx = await manager.reinitialize(vaultDir);

    expect(ctx.path).toBe(vaultDir);
    expect(existsSync(join(vaultDir, '.kg', 'config.json'))).toBe(true);
    expect(existsSync(join(vaultDir, '.kg', 'stale-file.txt'))).toBe(true);
  });

  it('preserves existing user files in the vault directory', async () => {
    const vaultDir = join(tmpPath, 'has-files');
    mkdirSync(join(vaultDir, 'notes'), { recursive: true });
    writeFileSync(join(vaultDir, 'notes', 'my-note.md'), '# Hello');
    writeFileSync(join(vaultDir, 'data.csv'), 'a,b,c');

    await manager.reinitialize(vaultDir);

    expect(existsSync(join(vaultDir, 'notes', 'my-note.md'))).toBe(true);
    expect(existsSync(join(vaultDir, 'data.csv'))).toBe(true);
  });
});

describe('VaultManager.removeFromRecent', () => {
  it('removes a vault from the recent list', () => {
    storage.set({
      recentVaults: [
        { path: '/a', name: 'A', lastOpened: '2026-01-01' },
        { path: '/b', name: 'B', lastOpened: '2026-01-02' },
        { path: '/c', name: 'C', lastOpened: '2026-01-03' },
      ],
    });

    manager.removeFromRecent('/b');

    const recent = manager.getRecentVaults();
    expect(recent).toHaveLength(2);
    expect(recent.map((v) => v.path)).toEqual(['/a', '/c']);
  });

  it('is a no-op when vault is not in the list', () => {
    storage.set({
      recentVaults: [
        { path: '/a', name: 'A', lastOpened: '2026-01-01' },
      ],
    });

    manager.removeFromRecent('/nonexistent');

    expect(manager.getRecentVaults()).toHaveLength(1);
  });

  it('handles empty recent list', () => {
    manager.removeFromRecent('/anything');

    expect(manager.getRecentVaults()).toHaveLength(0);
  });
});

describe('error message parsing (UI contract)', () => {
  it('VAULT_DIR_MISSING error contains the path after the prefix', async () => {
    const missingDir = join(tmpPath, 'gone');
    try {
      await manager.open(missingDir);
    } catch (e: any) {
      const msg = e.message as string;
      expect(msg.startsWith('VAULT_DIR_MISSING:')).toBe(true);
      expect(msg.split('VAULT_DIR_MISSING:')[1]).toBe(missingDir);
    }
  });

  it('VAULT_KG_MISSING error contains the path after the prefix', async () => {
    const emptyDir = join(tmpPath, 'no-kg');
    mkdirSync(emptyDir);
    try {
      await manager.open(emptyDir);
    } catch (e: any) {
      const msg = e.message as string;
      expect(msg.startsWith('VAULT_KG_MISSING:')).toBe(true);
      expect(msg.split('VAULT_KG_MISSING:')[1]).toBe(emptyDir);
    }
  });
});
