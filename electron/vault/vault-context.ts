import { join } from 'path';
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';
import type Database from 'better-sqlite3';
import { VaultEventBus } from './event-bus';
import type { VaultSandboxConfig } from '../../src/shared/agent-settings-types';
import { DEFAULT_SANDBOX_CONFIG } from '../../src/shared/agent-settings-types';

// ── Types ───────────────────────────────────────────────────────────────

export interface VaultConfig {
  name: string;
  id: string;
  schemaVersion: number;
  createdAt: string;
}

export interface VaultContext {
  readonly path: string;
  readonly synapsePath: string;
  readonly name: string;
  readonly id: string;
  readonly db: Database.Database;
  readonly config: VaultConfig;
  readonly eventBus: VaultEventBus;
  sandboxConfig: VaultSandboxConfig;

  resolve(relativePath: string): string;
  relative(absolutePath: string): string;
}

// ── Factory ─────────────────────────────────────────────────────────────

export function createVaultContext(vaultPath: string, db: Database.Database): VaultContext {
  const synapsePath = join(vaultPath, '.synapse');
  const configPath = join(synapsePath, 'config.json');

  if (!existsSync(configPath)) {
    throw new Error(`Not a valid vault: ${configPath} not found`);
  }

  const config: VaultConfig = JSON.parse(readFileSync(configPath, 'utf-8'));
  const eventBus = new VaultEventBus();

  // Load sandbox config
  const agentConfigPath = join(synapsePath, 'agent-config.json');
  let sandboxConfig: VaultSandboxConfig = { ...DEFAULT_SANDBOX_CONFIG };
  if (existsSync(agentConfigPath)) {
    try {
      sandboxConfig = JSON.parse(readFileSync(agentConfigPath, 'utf-8'));
    } catch {
      // Corrupt file — use defaults
    }
  }

  return {
    path: vaultPath,
    synapsePath,
    name: config.name,
    id: config.id,
    db,
    config,
    eventBus,
    sandboxConfig,

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
  const synapsePath = join(vaultPath, '.synapse');
  const notesPath = join(vaultPath, 'notes');
  const entitiesPath = join(vaultPath, 'entities');
  const embeddingsPath = join(synapsePath, 'embeddings');
  const agentPath = join(synapsePath, 'agent');
  const artifactsPath = join(agentPath, 'artifacts');

  mkdirSync(synapsePath, { recursive: true });
  mkdirSync(notesPath, { recursive: true });
  mkdirSync(entitiesPath, { recursive: true });
  mkdirSync(embeddingsPath, { recursive: true });
  mkdirSync(artifactsPath, { recursive: true });

  const config: VaultConfig = {
    name,
    id: `vault_${generateId()}`,
    schemaVersion: 1,
    createdAt: new Date().toISOString(),
  };

  writeFileSync(join(synapsePath, 'config.json'), JSON.stringify(config, null, 2), 'utf-8');

  // Create .gitignore at vault root to exclude .synapse/
  const gitignorePath = join(vaultPath, '.gitignore');
  if (!existsSync(gitignorePath)) {
    writeFileSync(gitignorePath, '.synapse/\n', 'utf-8');
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
