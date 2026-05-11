import { dialog, BrowserWindow } from 'electron';
import { existsSync, mkdirSync } from 'fs';
import { join } from 'path';
import type { StorageBackend } from '../storage-backend';
import { resetBetterSQLite, getDb } from '../better-sqlite3-engine';
import { runMigrations } from '../../src/db/worker/migrations';
import {
  createVaultContext,
  scaffoldVault,
  type VaultContext,
} from './vault-context';

// ── Types ───────────────────────────────────────────────────────────────

export interface RecentVault {
  path: string;
  name: string;
  lastOpened: string;
}

// ── VaultManager ────────────────────────────────────────────────────────

export class VaultManager {
  private context: VaultContext | null = null;
  private storage: StorageBackend;

  constructor(storage: StorageBackend) {
    this.storage = storage;
  }

  getContext(): VaultContext | null {
    return this.context;
  }

  getRecentVaults(): RecentVault[] {
    const data = this.storage.get('recentVaults');
    return (data.recentVaults as RecentVault[]) ?? [];
  }

  getLastOpenedPath(): string | null {
    const vaults = this.getRecentVaults();
    if (vaults.length === 0) return null;
    const sorted = [...vaults].sort(
      (a, b) => new Date(b.lastOpened).getTime() - new Date(a.lastOpened).getTime()
    );
    return sorted[0].path;
  }

  async create(vaultPath: string, name: string): Promise<VaultContext> {
    if (!existsSync(vaultPath)) {
      mkdirSync(vaultPath, { recursive: true });
    }

    scaffoldVault(vaultPath, name);
    return this.open(vaultPath);
  }

  async open(vaultPath: string): Promise<VaultContext> {
    if (this.context) {
      await this.close();
    }

    const configPath = join(vaultPath, '.kg', 'config.json');
    if (!existsSync(configPath)) {
      throw new Error(`No vault found at ${vaultPath}`);
    }

    // Point the shared DB engine at the vault's graph.db and run migrations
    const dbPath = join(vaultPath, '.kg', 'graph.db');
    await resetBetterSQLite(dbPath);
    await runMigrations();

    this.context = createVaultContext(vaultPath, getDb());
    this.updateRecentVaults(vaultPath, this.context.name);
    this.context.eventBus.emit({ type: 'vault:opened' });

    console.log(`[Vault] Opened: ${this.context.name} at ${vaultPath}`);
    return this.context;
  }

  async close(): Promise<void> {
    if (!this.context) return;

    this.context.eventBus.emit({ type: 'vault:closing' });
    this.context.eventBus.removeAll();
    this.context = null;

    console.log('[Vault] Closed');
  }

  async pickAndCreate(parentWindow?: BrowserWindow): Promise<VaultContext | null> {
    const result = await dialog.showOpenDialog(parentWindow ?? BrowserWindow.getFocusedWindow()!, {
      title: 'Choose vault location',
      properties: ['openDirectory', 'createDirectory'],
    });

    if (result.canceled || result.filePaths.length === 0) return null;

    const vaultPath = result.filePaths[0];
    const name = vaultPath.split('/').pop() ?? 'My Vault';
    return this.create(vaultPath, name);
  }

  async pickAndOpen(parentWindow?: BrowserWindow): Promise<VaultContext | null> {
    const result = await dialog.showOpenDialog(parentWindow ?? BrowserWindow.getFocusedWindow()!, {
      title: 'Open vault',
      properties: ['openDirectory'],
    });

    if (result.canceled || result.filePaths.length === 0) return null;

    const vaultPath = result.filePaths[0];
    return this.open(vaultPath);
  }

  private updateRecentVaults(path: string, name: string): void {
    const vaults = this.getRecentVaults().filter((v) => v.path !== path);
    vaults.unshift({ path, name, lastOpened: new Date().toISOString() });
    // Keep last 10 vaults
    this.storage.set({ recentVaults: vaults.slice(0, 10) });
  }
}
