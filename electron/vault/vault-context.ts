import { join } from 'path';
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';
import type Database from 'better-sqlite3';
import { VaultEventBus } from './event-bus';

// ── Types ───────────────────────────────────────────────────────────────

export interface VaultConfig {
  name: string;
  id: string;
  schemaVersion: number;
  createdAt: string;
}

export interface VaultContext {
  readonly path: string;
  readonly kgPath: string;
  readonly name: string;
  readonly id: string;
  readonly db: Database.Database;
  readonly config: VaultConfig;
  readonly eventBus: VaultEventBus;

  resolve(relativePath: string): string;
  relative(absolutePath: string): string;
}

// ── Factory ─────────────────────────────────────────────────────────────

export function createVaultContext(vaultPath: string, db: Database.Database): VaultContext {
  const kgPath = join(vaultPath, '.kg');
  const configPath = join(kgPath, 'config.json');

  if (!existsSync(configPath)) {
    throw new Error(`Not a valid vault: ${configPath} not found`);
  }

  const config: VaultConfig = JSON.parse(readFileSync(configPath, 'utf-8'));
  const eventBus = new VaultEventBus();

  return {
    path: vaultPath,
    kgPath,
    name: config.name,
    id: config.id,
    db,
    config,
    eventBus,

    resolve(relativePath: string): string {
      return join(vaultPath, relativePath);
    },

    relative(absolutePath: string): string {
      if (!absolutePath.startsWith(vaultPath)) {
        throw new Error(`Path ${absolutePath} is not inside vault ${vaultPath}`);
      }
      return absolutePath.slice(vaultPath.length + 1);
    },
  };
}

// ── Scaffold ────────────────────────────────────────────────────────────

export function scaffoldVault(vaultPath: string, name: string): VaultConfig {
  const kgPath = join(vaultPath, '.kg');
  const notesPath = join(vaultPath, 'notes');
  const embeddingsPath = join(kgPath, 'embeddings');
  const agentPath = join(kgPath, 'agent');
  const artifactsPath = join(agentPath, 'artifacts');

  mkdirSync(kgPath, { recursive: true });
  mkdirSync(notesPath, { recursive: true });
  mkdirSync(embeddingsPath, { recursive: true });
  mkdirSync(artifactsPath, { recursive: true });

  const config: VaultConfig = {
    name,
    id: `vault_${generateId()}`,
    schemaVersion: 1,
    createdAt: new Date().toISOString(),
  };

  writeFileSync(join(kgPath, 'config.json'), JSON.stringify(config, null, 2), 'utf-8');

  // Create .gitignore at vault root to exclude .kg/
  const gitignorePath = join(vaultPath, '.gitignore');
  if (!existsSync(gitignorePath)) {
    writeFileSync(gitignorePath, '.kg/\n', 'utf-8');
  }

  return config;
}

function generateId(): string {
  const chars = 'abcdefghijklmnopqrstuvwxyz0123456789';
  let result = '';
  for (let i = 0; i < 12; i++) {
    result += chars[Math.floor(Math.random() * chars.length)];
  }
  return result;
}
