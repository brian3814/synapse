import { describe, it, expect, beforeEach, afterEach } from 'vitest';
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

// Used by later migration tests in this branch (kept at module scope intentionally).
function columnNames(db: Database.Database, table: string): string[] {
  return db.prepare(`PRAGMA table_info(${table})`).all().map((r: any) => r.name);
}

describe('migration runner harness', () => {
  let db: Database.Database;

  beforeEach(() => {
    db = freshDb();
    bindEngine(db);
  });

  afterEach(() => {
    db.close();
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

  it('chat FK: deleting a session cascades its messages', async () => {
    await runMigrations();
    db.prepare("INSERT INTO chat_sessions (id, title) VALUES ('s1', 't')").run();
    db.prepare(
      "INSERT INTO chat_messages (id, session_id, role, content) VALUES ('m1', 's1', 'user', 'hi')"
    ).run();
    expect((db.prepare('SELECT COUNT(*) AS c FROM chat_messages').get() as any).c).toBe(1);

    db.prepare("DELETE FROM chat_sessions WHERE id = 's1'").run();
    expect((db.prepare('SELECT COUNT(*) AS c FROM chat_messages').get() as any).c).toBe(0);
  });

  it('drops chat_sessions.preset_id via the ensure-block without touching messages', async () => {
    await runMigrations();
    expect(columnNames(db, 'chat_sessions')).not.toContain('preset_id');
    // re-run: idempotent
    await runMigrations();
    expect(columnNames(db, 'chat_sessions')).not.toContain('preset_id');
  });
});

// Frozen copy of the OLD synapse-mcp INIT_SCHEMA + EXTRA_COLUMNS (deleted from
// prod in this branch) — reproduces a drifted MCP-initialized vault stamped v11.
const DRIFTED_MCP_FIXTURE = `
CREATE TABLE IF NOT EXISTS nodes (
    id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
    identifier TEXT UNIQUE, name TEXT NOT NULL, type TEXT NOT NULL DEFAULT 'entity',
    label TEXT, summary TEXT, folder_path TEXT NOT NULL DEFAULT '',
    properties TEXT NOT NULL DEFAULT '{}', x REAL, y REAL, z REAL,
    color TEXT, size REAL DEFAULT 1.0, source_url TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_nodes_folder_path ON nodes(folder_path) WHERE type = 'note';
CREATE TABLE IF NOT EXISTS edges (
    id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
    source_id TEXT NOT NULL REFERENCES nodes(id) ON DELETE CASCADE,
    target_id TEXT NOT NULL REFERENCES nodes(id) ON DELETE CASCADE,
    label TEXT NOT NULL, type TEXT NOT NULL DEFAULT 'related',
    properties TEXT NOT NULL DEFAULT '{}', weight REAL DEFAULT 1.0,
    directed INTEGER NOT NULL DEFAULT 1, source_url TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now')),
    UNIQUE(source_id, target_id, label)
);
CREATE TABLE IF NOT EXISTS entity_aliases (
    id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
    node_id TEXT NOT NULL REFERENCES nodes(id) ON DELETE CASCADE,
    alias TEXT NOT NULL, alias_lower TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS extraction_log (
    id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
    source_url TEXT, source_text TEXT, provider TEXT NOT NULL, model TEXT NOT NULL,
    raw_output TEXT, nodes_added INTEGER DEFAULT 0, edges_added INTEGER DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS schema_version (
    version INTEGER PRIMARY KEY, applied_at TEXT NOT NULL DEFAULT (datetime('now')), description TEXT
);
CREATE TABLE IF NOT EXISTS ontology_node_types (
    type TEXT PRIMARY KEY, description TEXT, color TEXT,
    category TEXT NOT NULL DEFAULT 'entity_label', is_default INTEGER NOT NULL DEFAULT 0,
    parent_type TEXT REFERENCES ontology_node_types(type), properties_schema TEXT
);
INSERT OR IGNORE INTO ontology_node_types (type, description, color, category) VALUES
    ('resource', 'A webpage ingested into the knowledge graph', '#059669', 'structural'),
    ('entity', 'A domain object', '#7C3AED', 'structural'),
    ('note', 'A granular prose unit about entities', '#0EA5E9', 'structural');
CREATE TABLE IF NOT EXISTS ontology_edge_types (
    type TEXT PRIMARY KEY, description TEXT, category TEXT NOT NULL DEFAULT 'related',
    source_types TEXT, target_types TEXT, properties_schema TEXT
);
CREATE TABLE IF NOT EXISTS node_tags (
    node_id TEXT NOT NULL REFERENCES nodes(id) ON DELETE CASCADE,
    tag TEXT NOT NULL, PRIMARY KEY (node_id, tag)
);
CREATE TABLE IF NOT EXISTS entity_sources (
    entity_id TEXT NOT NULL REFERENCES nodes(id) ON DELETE CASCADE,
    resource_id TEXT NOT NULL, relation_type TEXT NOT NULL DEFAULT 'about',
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    PRIMARY KEY (entity_id, resource_id, relation_type)
);
CREATE TABLE IF NOT EXISTS edge_sources (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    edge_id TEXT NOT NULL REFERENCES edges(id) ON DELETE CASCADE,
    source_type TEXT NOT NULL CHECK(source_type IN ('note', 'extraction', 'user')),
    source_id TEXT, resource_id TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    UNIQUE(edge_id, source_type, source_id, resource_id)
);
CREATE TABLE IF NOT EXISTS note_folders (path TEXT PRIMARY KEY, created_at TEXT NOT NULL DEFAULT (datetime('now')));
CREATE TABLE IF NOT EXISTS note_attachments (
    id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
    note_id TEXT NOT NULL REFERENCES nodes(id) ON DELETE CASCADE,
    filename TEXT NOT NULL, mime_type TEXT NOT NULL, data BLOB, source_url TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS chat_sessions (
    id TEXT PRIMARY KEY, title TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    last_active_at TEXT NOT NULL DEFAULT (datetime('now')),
    status TEXT NOT NULL DEFAULT 'active'
);
CREATE TABLE IF NOT EXISTS chat_messages (
    id TEXT PRIMARY KEY, session_id TEXT NOT NULL REFERENCES chat_sessions(id) ON DELETE CASCADE,
    role TEXT NOT NULL, content TEXT NOT NULL, rag_context TEXT,
    status TEXT NOT NULL DEFAULT 'complete',
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS note_search (
    rowid INTEGER PRIMARY KEY AUTOINCREMENT, node_id TEXT UNIQUE NOT NULL,
    title TEXT NOT NULL, body TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS spatial_positions (
    node_id TEXT PRIMARY KEY REFERENCES nodes(id) ON DELETE CASCADE,
    x REAL NOT NULL DEFAULT 0, y REAL NOT NULL DEFAULT 0, layout TEXT NOT NULL DEFAULT 'force'
);
CREATE TABLE IF NOT EXISTS reading_list (
    id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))), url TEXT NOT NULL, title TEXT,
    status TEXT NOT NULL DEFAULT 'unread', created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS browsing_history (
    id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))), url TEXT NOT NULL, title TEXT,
    visited_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS memory_episodic (
    id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))), session_id TEXT,
    summary TEXT NOT NULL, created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS embedding_metadata (
    node_id TEXT PRIMARY KEY REFERENCES nodes(id) ON DELETE CASCADE,
    model TEXT NOT NULL, dimensions INTEGER NOT NULL, text_hash TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now')), updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS embedding_dismissals (
    node_id TEXT PRIMARY KEY REFERENCES nodes(id) ON DELETE CASCADE,
    reason TEXT, created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
ALTER TABLE nodes ADD COLUMN source_content TEXT;
ALTER TABLE nodes ADD COLUMN vault_path TEXT;
ALTER TABLE nodes ADD COLUMN content_type TEXT;
ALTER TABLE nodes ADD COLUMN file_mtime INTEGER;
ALTER TABLE nodes ADD COLUMN file_size INTEGER;
ALTER TABLE entity_sources ADD COLUMN location TEXT;
ALTER TABLE edge_sources ADD COLUMN location TEXT;
INSERT OR REPLACE INTO schema_version (version, description) VALUES (11, 'init');
`;

const DEAD_TABLES = ['extraction_log', 'note_folders', 'indexed_files',
  'memory_semantic', 'memory_episodic', 'embedding_dismissals',
  'spatial_positions', 'reading_list', 'browsing_history'];

describe('migration 014: schema cleanup', () => {
  let db: Database.Database;

  beforeEach(() => {
    db = freshDb();
    bindEngine(db);
  });

  afterEach(() => {
    db.close();
  });

  it('drops dead tables and columns on a fresh/healthy vault', async () => {
    const version = await runMigrations();
    expect(version).toBeGreaterThanOrEqual(14);

    for (const t of DEAD_TABLES) {
      expect(tableNames(db), `${t} should be dropped`).not.toContain(t);
    }
    expect(columnNames(db, 'nodes')).not.toContain('z');
    expect(columnNames(db, 'nodes')).not.toContain('content_type');
    expect(columnNames(db, 'nodes')).not.toContain('folder_path');
    expect(columnNames(db, 'edges')).not.toContain('source_url');
    expect(columnNames(db, 'chat_messages')).not.toContain('rag_context');
    expect(columnNames(db, 'note_attachments')).not.toContain('source_url');
    expect(columnNames(db, 'ontology_node_types')).toEqual(['type', 'description', 'color', 'category']);
    expect(columnNames(db, 'ontology_edge_types')).toEqual(['type', 'description', 'category']);
    expect(columnNames(db, 'source_content')).toEqual(['id', 'node_id', 'url', 'title', 'content', 'extracted_at']);
    expect(columnNames(db, 'reading_list_history')).toEqual(['id', 'url', 'title', 'summary', 'key_topics', 'merged_at']);
    expect(columnNames(db, 'embedding_metadata')).toEqual(['node_id', 'text_hash']);
    // Ontology seed data survives the rebuild
    const ont = db.prepare("SELECT type FROM ontology_node_types ORDER BY type").all().map((r: any) => r.type);
    expect(ont).toEqual(['entity', 'note', 'resource']);
    expect(db.prepare('PRAGMA foreign_key_check').all()).toEqual([]);
  });

  it('repairs a drifted MCP-initialized vault (v11) and preserves user data', async () => {
    db.exec(DRIFTED_MCP_FIXTURE); // v11-shaped vault
    db.prepare("INSERT INTO nodes (id, name, type) VALUES ('n1', 'Node One', 'entity')").run();
    db.prepare("INSERT INTO chat_sessions (id, title) VALUES ('s1', 'chat')").run();
    db.prepare("INSERT INTO chat_messages (id, session_id, role, content, rag_context) VALUES ('m1', 's1', 'user', 'hello', 'legacy')").run();
    db.prepare("INSERT INTO memory_episodic (id, session_id, summary) VALUES ('e1', 's1', 'old summary')").run();

    const version = await runMigrations(); // applies 12, 13, 14 (skips 1-11)
    expect(version).toBeGreaterThanOrEqual(14);

    // chat history survived (no chat_sessions rebuild => no FK cascade wipe)
    expect((db.prepare('SELECT COUNT(*) AS c FROM chat_messages').get() as any).c).toBe(1);
    expect((db.prepare('SELECT COUNT(*) AS c FROM nodes').get() as any).c).toBe(1);
    // drifted-vault repairs: tables the old MCP init never created now exist
    const tables = tableNames(db);
    expect(tables).toContain('source_content');
    expect(tables).toContain('reading_list_history');
    expect(tables).toContain('artifacts');           // migration 13 applied
    expect(columnNames(db, 'nodes')).toContain('content_hash'); // migration 12 applied
    // drifted trio + dead tables gone
    for (const t of DEAD_TABLES) expect(tables).not.toContain(t);
    // wrong-shaped embedding tables replaced by canonical minimal shape
    expect(columnNames(db, 'embedding_metadata')).toEqual(['node_id', 'text_hash']);
    expect(db.prepare('PRAGMA foreign_key_check').all()).toEqual([]);
  });

  it('preserves source_content and reading_list_history rows through the rebuilds', async () => {
    db.exec(DRIFTED_MCP_FIXTURE);
    // Simulate a vault that DOES have the old-shape tables with data
    // (e.g. a healthy pre-014 vault) so the _new+INSERT SELECT+RENAME
    // rebuild path is exercised with real rows.
    db.exec(`
      CREATE TABLE source_content (
        id TEXT PRIMARY KEY, node_id TEXT REFERENCES nodes(id) ON DELETE SET NULL,
        url TEXT NOT NULL, title TEXT, content TEXT NOT NULL,
        content_hash TEXT, extracted_at TEXT NOT NULL DEFAULT (datetime('now')),
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
      INSERT INTO source_content (id, url, title, content, content_hash)
        VALUES ('sc1', 'https://x.test', 'Title', 'page body', 'deadbeef');
      CREATE TABLE reading_list_history (
        id TEXT PRIMARY KEY, url TEXT NOT NULL UNIQUE, title TEXT NOT NULL,
        summary TEXT NOT NULL DEFAULT '', key_topics TEXT NOT NULL DEFAULT '[]',
        merged_at TEXT NOT NULL DEFAULT (datetime('now')),
        node_ids TEXT NOT NULL DEFAULT '[]',
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
      INSERT INTO reading_list_history (id, url, title, summary, key_topics)
        VALUES ('r1', 'https://x.test', 'Article', 'sum', '["a","b"]');
    `);

    await runMigrations();

    const sc = db.prepare("SELECT * FROM source_content WHERE id = 'sc1'").get() as any;
    expect(sc.url).toBe('https://x.test');
    expect(sc.content).toBe('page body');
    expect(sc.content_hash).toBeUndefined(); // column gone
    const rl = db.prepare("SELECT * FROM reading_list_history WHERE id = 'r1'").get() as any;
    expect(rl.key_topics).toBe('["a","b"]');
    expect(rl.node_ids).toBeUndefined(); // column gone
  });

  it('a failing migration rolls back atomically and a later re-run succeeds', async () => {
    db.exec(DRIFTED_MCP_FIXTURE);
    db.prepare("INSERT INTO chat_sessions (id, title) VALUES ('s1', 'chat')").run();
    db.prepare("INSERT INTO chat_messages (id, session_id, role, content) VALUES ('m1', 's1', 'user', 'hi')").run();
    // Sabotage 014 mid-way: its rebuild creates source_content_new, which
    // collides with this pre-existing table and fails the migration partway.
    db.exec('CREATE TABLE source_content_new (dummy TEXT);');

    await expect(runMigrations()).rejects.toThrow();

    // Atomic rollback: nothing from 014 may have applied (12 and 13 committed
    // their own transactions before it — that's fine and expected).
    expect((db.prepare('SELECT MAX(version) AS v FROM schema_version').get() as any).v).toBe(13);
    expect(tableNames(db)).toContain('extraction_log');          // 014's drops rolled back
    expect(columnNames(db, 'nodes')).toContain('z');             // 014's column drops rolled back
    expect(columnNames(db, 'chat_messages')).toContain('rag_context');
    expect((db.prepare('SELECT COUNT(*) AS c FROM chat_messages').get() as any).c).toBe(1);

    // Operator clears the obstruction; the vault recovers on next boot.
    db.exec('DROP TABLE source_content_new;');
    const version = await runMigrations();
    expect(version).toBeGreaterThanOrEqual(14);
    expect(tableNames(db)).not.toContain('extraction_log');
    expect((db.prepare('SELECT COUNT(*) AS c FROM chat_messages').get() as any).c).toBe(1);
    expect(db.prepare('PRAGMA foreign_key_check').all()).toEqual([]);
  });
});
