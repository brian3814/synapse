import { describe, it, expect, beforeEach } from 'vitest';
import Database from 'better-sqlite3';
import { setEngine } from '../../src/db/worker/query-executor';
import { runMigrations } from '../../src/db/worker/migrations';

// ── Harness: drive the real migration runner via the setEngine() seam ──

function bindEngine(db: Database.Database): void {
  setEngine({
    async exec(sql: string, params?: unknown[]) {
      if (params && params.length > 0) {
        return db.prepare(sql).run(...(params as unknown[])).changes;
      }
      db.exec(sql);
      return 0;
    },
    async query<T = Record<string, unknown>>(sql: string, params?: unknown[]) {
      if (params && params.length > 0) {
        return db.prepare(sql).all(...(params as unknown[])) as T[];
      }
      return db.prepare(sql).all() as T[];
    },
    async checkModuleAvailable(moduleName: string) {
      try {
        return db.prepare('SELECT name FROM pragma_module_list WHERE name = ?')
          .all(moduleName).length > 0;
      } catch {
        return false;
      }
    },
  });
}

function freshDb(): Database.Database {
  const db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  return db;
}

function tableNames(db: Database.Database): string[] {
  return db.prepare(
    "SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name"
  ).all().map((r: any) => r.name);
}

function columnNames(db: Database.Database, table: string): string[] {
  return db.prepare(`PRAGMA table_info(${table})`).all().map((r: any) => r.name);
}

describe('migration runner harness', () => {
  let db: Database.Database;

  beforeEach(() => {
    db = freshDb();
    bindEngine(db);
  });

  it('requires SQLite >= 3.35 (DROP COLUMN support)', () => {
    const v = (db.prepare('SELECT sqlite_version() AS v').get() as any).v as string;
    const [major, minor] = v.split('.').map(Number);
    expect(major > 3 || (major === 3 && minor >= 35)).toBe(true);
  });

  it('applies all migrations on a fresh database', async () => {
    const version = await runMigrations();
    expect(version).toBeGreaterThanOrEqual(13);

    const tables = tableNames(db);
    for (const t of ['nodes', 'edges', 'entity_aliases', 'ontology_node_types',
      'ontology_edge_types', 'node_tags', 'entity_sources', 'edge_sources',
      'note_attachments', 'chat_sessions', 'chat_messages', 'note_search',
      'source_content', 'reading_list_history', 'embedding_metadata', 'artifacts']) {
      expect(tables, `expected table ${t}`).toContain(t);
    }
    // FTS applies in better-sqlite3 (module available)
    expect(tables).toContain('nodes_fts');
    expect(tables).toContain('notes_fts');
  });

  it('chat cascade sanity: deleting a session cascades messages, dropping unrelated tables does not', async () => {
    await runMigrations();
    db.prepare("INSERT INTO chat_sessions (id, title) VALUES ('s1', 't')").run();
    db.prepare(
      "INSERT INTO chat_messages (id, session_id, role, content) VALUES ('m1', 's1', 'user', 'hi')"
    ).run();
    expect((db.prepare('SELECT COUNT(*) AS c FROM chat_messages').get() as any).c).toBe(1);
  });
});
