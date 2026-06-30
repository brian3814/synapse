import { executeExec, executeQuery, checkModuleAvailable } from '../query-executor';
import { SCHEMA_VERSION, coreDDL, fts5DDL } from './schema';

let fts5Available = false;
let notesFts5Available = false;

export function isFTS5Available(): boolean {
  return fts5Available;
}

export function isNotesFTS5Available(): boolean {
  return notesFts5Available;
}

async function hasColumn(table: string, column: string): Promise<boolean> {
  const { rows } = await executeQuery<{ name: string }>(
    `PRAGMA table_info(${table});`
  );
  return rows.some((r: any) => r.name === column);
}

async function hasTable(name: string): Promise<boolean> {
  const { rows } = await executeQuery<{ name: string }>(
    `SELECT name FROM sqlite_master WHERE type='table' AND name=?;`,
    [name]
  );
  return rows.length > 0;
}

async function applyMigration(version: number, description: string, fn: () => Promise<void>) {
  console.log(`[DB] Applying migration v${version}: ${description}`);
  await executeExec('BEGIN IMMEDIATE;');
  try {
    await fn();
    await executeExec(
      'INSERT INTO schema_version (version, description) VALUES (?, ?);',
      [version, `v${version}: ${description}`]
    );
    await executeExec('COMMIT;');
    console.log(`[DB] Migration v${version} applied`);
  } catch (e) {
    try { await executeExec('ROLLBACK;'); } catch {}
    throw e;
  }
}

async function rebuildTable(
  tableName: string,
  createNewDDL: string,
  columns: string[]
): Promise<void> {
  const newName = `${tableName}_new`;
  await executeExec(createNewDDL);
  await executeExec(
    `INSERT OR IGNORE INTO ${newName} (${columns.join(', ')}) SELECT ${columns.join(', ')} FROM ${tableName};`
  );
  await executeExec(`DROP TABLE ${tableName};`);
  await executeExec(`ALTER TABLE ${newName} RENAME TO ${tableName};`);
}

export async function runMigrations(): Promise<number> {
  await executeExec(`
    CREATE TABLE IF NOT EXISTS schema_version (
      version INTEGER PRIMARY KEY,
      applied_at TEXT NOT NULL DEFAULT (datetime('now')),
      description TEXT
    );
  `);

  const { rows } = await executeQuery<{ version: number }>(
    'SELECT MAX(version) as version FROM schema_version;'
  );
  const currentVersion = rows[0]?.version ?? 0;

  const hasFTS5 = await checkModuleAvailable('fts5');
  console.log(`[DB] FTS5 module available: ${hasFTS5}`);

  if (currentVersion === 0) {
    console.log(`[DB] Fresh database — applying schema v${SCHEMA_VERSION}`);
    await executeExec('BEGIN IMMEDIATE;');
    try {
      await executeExec(coreDDL);
      if (hasFTS5) {
        await executeExec(fts5DDL);
        fts5Available = true;
        notesFts5Available = true;
      }
      await executeExec(
        'INSERT INTO schema_version (version, description) VALUES (?, ?);',
        [SCHEMA_VERSION, `Schema v${SCHEMA_VERSION} (merged)`]
      );
      await executeExec('COMMIT;');
    } catch (e) {
      try { await executeExec('ROLLBACK;'); } catch {}
      throw e;
    }
    console.log(`[DB] Schema v${SCHEMA_VERSION} applied successfully`);
    return SCHEMA_VERSION;
  }

  if (currentVersion < SCHEMA_VERSION) {
    if (currentVersion < 12) {
      await applyMigration(12, 'Add content_hash to nodes', async () => {
        await executeExec('ALTER TABLE nodes ADD COLUMN content_hash TEXT;');
      });
    }

    if (currentVersion < 13) {
      await applyMigration(13, 'Add artifacts table', async () => {
        await executeExec(`
          CREATE TABLE IF NOT EXISTS artifacts (
            id          TEXT PRIMARY KEY,
            title       TEXT NOT NULL,
            type        TEXT NOT NULL,
            session_id  TEXT,
            session_dir TEXT NOT NULL,
            file_name   TEXT NOT NULL,
            created_at  TEXT NOT NULL DEFAULT (datetime('now')),
            updated_at  TEXT NOT NULL DEFAULT (datetime('now'))
          );
          CREATE INDEX IF NOT EXISTS idx_artifacts_session ON artifacts(session_id);
          CREATE INDEX IF NOT EXISTS idx_artifacts_type ON artifacts(type);
          CREATE INDEX IF NOT EXISTS idx_artifacts_updated ON artifacts(updated_at DESC);
        `);
      });
    }

    if (currentVersion < 14) {
      await applyMigration(14, 'Schema cleanup', async () => {
        for (const table of [
          'extraction_log', 'note_folders', 'indexed_files',
          'memory_semantic', 'memory_episodic', 'embedding_dismissals',
          'spatial_positions', 'reading_list', 'browsing_history',
        ]) {
          await executeExec(`DROP TABLE IF EXISTS ${table};`);
        }

        const { rows: idxRows } = await executeQuery<{ name: string; tbl_name: string; sql: string }>(
          `SELECT name, tbl_name, sql FROM sqlite_master WHERE type='index' AND sql IS NOT NULL;`
        );
        const columnsToDrop: [string, string][] = [
          ['nodes', 'z'], ['nodes', 'content_type'], ['nodes', 'folder_path'],
          ['edges', 'source_url'],
          ['chat_messages', 'rag_context'],
          ['note_attachments', 'source_url'],
          ['chat_sessions', 'preset_id'],
        ];
        const dropSet = new Set(columnsToDrop.map(([t, c]) => `${t}.${c}`));
        for (const idx of idxRows) {
          const sql = (idx as any).sql as string;
          const tbl = (idx as any).tbl_name as string;
          for (const [t, c] of columnsToDrop) {
            if (tbl === t && sql.includes(c) && dropSet.has(`${t}.${c}`)) {
              await executeExec(`DROP INDEX IF EXISTS ${(idx as any).name};`);
              break;
            }
          }
        }
        for (const [table, col] of columnsToDrop) {
          if (await hasColumn(table, col)) {
            await executeExec(`ALTER TABLE ${table} DROP COLUMN ${col};`);
          }
        }

        await rebuildTable('ontology_node_types',
          `CREATE TABLE ontology_node_types_new (
            type TEXT PRIMARY KEY, description TEXT, color TEXT,
            category TEXT NOT NULL DEFAULT 'entity_label'
          )`,
          ['type', 'description', 'color', 'category']);

        await rebuildTable('ontology_edge_types',
          `CREATE TABLE ontology_edge_types_new (
            type TEXT PRIMARY KEY, description TEXT,
            category TEXT NOT NULL DEFAULT 'related'
          )`,
          ['type', 'description', 'category']);

        await executeExec(`
          CREATE TABLE source_content_new (
            id           TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
            node_id      TEXT REFERENCES nodes(id) ON DELETE SET NULL,
            url          TEXT NOT NULL,
            title        TEXT,
            content      TEXT NOT NULL,
            extracted_at TEXT NOT NULL DEFAULT (datetime('now'))
          );
        `);
        if (await hasTable('source_content')) {
          await executeExec(`
            INSERT INTO source_content_new (id, node_id, url, title, content, extracted_at)
            SELECT id, node_id, url, title, content, COALESCE(extracted_at, datetime('now'))
            FROM source_content;
          `);
          await executeExec('DROP TABLE source_content;');
        }
        await executeExec('ALTER TABLE source_content_new RENAME TO source_content;');
        await executeExec(`
          CREATE INDEX IF NOT EXISTS idx_source_content_node ON source_content(node_id);
          CREATE INDEX IF NOT EXISTS idx_source_content_url ON source_content(url);
          CREATE UNIQUE INDEX IF NOT EXISTS idx_source_content_url_time ON source_content(url, extracted_at);
        `);

        await executeExec(`
          CREATE TABLE reading_list_history_new (
            id         TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
            url        TEXT NOT NULL UNIQUE,
            title      TEXT NOT NULL,
            summary    TEXT NOT NULL DEFAULT '',
            key_topics TEXT NOT NULL DEFAULT '[]',
            merged_at  TEXT NOT NULL DEFAULT (datetime('now'))
          );
        `);
        if (await hasTable('reading_list_history')) {
          await executeExec(`
            INSERT INTO reading_list_history_new (id, url, title, summary, key_topics, merged_at)
            SELECT id, url, title, summary, key_topics, COALESCE(merged_at, datetime('now'))
            FROM reading_list_history;
          `);
          await executeExec('DROP TABLE reading_list_history;');
        }
        await executeExec('ALTER TABLE reading_list_history_new RENAME TO reading_list_history;');
        await executeExec('CREATE INDEX IF NOT EXISTS idx_rlh_merged ON reading_list_history(merged_at DESC);');

        await rebuildTable('embedding_metadata',
          `CREATE TABLE embedding_metadata_new (
            node_id   TEXT PRIMARY KEY REFERENCES nodes(id) ON DELETE CASCADE,
            text_hash TEXT NOT NULL
          )`,
          ['node_id', 'text_hash']);
      });
    }
  }

  if (hasFTS5) {
    try {
      await executeQuery('SELECT * FROM nodes_fts LIMIT 0;');
      fts5Available = true;
    } catch {}
    try {
      await executeQuery('SELECT * FROM notes_fts LIMIT 0;');
      notesFts5Available = true;
    } catch {}
  }

  const { rows: vRows } = await executeQuery<{ version: number }>(
    'SELECT MAX(version) as version FROM schema_version;'
  );
  return vRows[0]?.version ?? currentVersion;
}
