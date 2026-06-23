import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Database from 'better-sqlite3';
import { mkdirSync, writeFileSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { randomUUID } from 'crypto';
import { VaultEventBus, type VaultEvent } from '../../electron/vault/event-bus';
import { reconcileVault } from '../../electron/vault/reconciliation';
import type { VaultContext } from '../../electron/vault/vault-context';

function createTestVault() {
  const vaultPath = join(tmpdir(), `synapse-test-${randomUUID()}`);
  mkdirSync(join(vaultPath, '.kg'), { recursive: true });
  mkdirSync(join(vaultPath, 'notes'), { recursive: true });
  mkdirSync(join(vaultPath, 'entities'), { recursive: true });

  const db = new Database(':memory:');
  db.exec(`
    CREATE TABLE nodes (
      id TEXT PRIMARY KEY, identifier TEXT, name TEXT NOT NULL,
      type TEXT NOT NULL DEFAULT 'entity', label TEXT, summary TEXT,
      properties TEXT NOT NULL DEFAULT '{}', x REAL, y REAL,
      color TEXT, size REAL DEFAULT 1.0, source_url TEXT,
      vault_path TEXT, file_mtime INTEGER, file_size INTEGER,
      content_hash TEXT, created_at TEXT, updated_at TEXT
    );
    CREATE TABLE edges (id TEXT PRIMARY KEY, source_id TEXT, target_id TEXT,
      label TEXT NOT NULL, type TEXT DEFAULT 'related', properties TEXT DEFAULT '{}',
      weight REAL DEFAULT 1.0, directed INTEGER DEFAULT 1, created_at TEXT, updated_at TEXT);
    CREATE TABLE note_search (node_id TEXT PRIMARY KEY, title TEXT, body TEXT);
    CREATE TABLE entity_sources (entity_id TEXT, resource_id TEXT, relation_type TEXT,
      location TEXT, created_at TEXT);
  `);

  const events: VaultEvent[] = [];
  const eventBus = new VaultEventBus();
  eventBus.on('file:added', (e) => events.push(e));

  const ctx: VaultContext = {
    path: vaultPath, kgPath: join(vaultPath, '.kg'), name: 'test', id: 'test',
    db, config: { name: 'test', id: 'test', schemaVersion: 1, createdAt: '' },
    eventBus, sandboxConfig: {} as any,
    resolve: (rel: string) => join(vaultPath, rel),
    relative: (abs: string) => abs.slice(vaultPath.length + 1),
  };

  return { vaultPath, db, eventBus, ctx, events, cleanup: () => rmSync(vaultPath, { recursive: true, force: true }) };
}

describe('reconciliation — entities/', () => {
  let env: ReturnType<typeof createTestVault>;

  beforeEach(() => { env = createTestVault(); });
  afterEach(() => { env.cleanup(); });

  it('re-binds entity file with matching id to existing node', () => {
    const nodeId = randomUUID();
    env.db.prepare(`
      INSERT INTO nodes (id, identifier, name, type, created_at, updated_at)
      VALUES (?, ?, 'Test Entity', 'entity', datetime('now'), datetime('now'))
    `).run(nodeId, nodeId);

    writeFileSync(
      join(env.vaultPath, 'entities', 'test_entity.md'),
      `---\nid: ${nodeId}\ntitle: Test Entity\n---\n\n# Test Entity\n`
    );

    const result = reconcileVault(env.ctx);
    expect(result.newFiles).toBe(0);

    const row = env.db.prepare('SELECT vault_path FROM nodes WHERE id = ?').get(nodeId) as any;
    expect(row.vault_path).toBe('entities/test_entity.md');
  });

  it('does NOT emit file:added for entity files', () => {
    writeFileSync(
      join(env.vaultPath, 'entities', 'orphan.md'),
      '---\ntitle: Orphan\n---\n\n# Orphan\n'
    );

    reconcileVault(env.ctx);

    const entityEvents = env.events.filter((e) =>
      e.type === 'file:added' && (e as any).relativePath.startsWith('entities/')
    );
    expect(entityEvents).toHaveLength(0);
  });
});
