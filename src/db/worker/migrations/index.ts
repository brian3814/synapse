import { exec, query, checkModuleAvailable } from '../sqlite-engine';
import * as migration001 from './001-initial-schema';
import * as migration002 from './002-fts-index';
import * as migration003 from './003-source-content';
import * as migration004 from './004-indexed-files';
import * as migration005 from './005-note-node-type';
import * as migration006 from './006-spatial-index';
import * as migration007 from './007-reading-list-history';

interface Migration {
  version: number;
  description: string;
  up: string;
  optional?: boolean;
}

const migrations: Migration[] = [migration001, migration002, migration003, migration004, migration005, migration006, migration007];

// Track whether FTS5 is available for search queries
let fts5Available = false;

export function isFTS5Available(): boolean {
  return fts5Available;
}

export async function runMigrations(): Promise<number> {
  // Ensure schema_version table exists
  await exec(`
    CREATE TABLE IF NOT EXISTS schema_version (
      version INTEGER PRIMARY KEY,
      applied_at TEXT NOT NULL DEFAULT (datetime('now')),
      description TEXT
    );
  `);

  // Get current version
  const rows = await query<{ version: number }>(
    'SELECT MAX(version) as version FROM schema_version;'
  );
  const currentVersion = rows[0]?.version ?? 0;

  // Check if FTS5 module is available in this wa-sqlite build
  const hasFTS5Module = await checkModuleAvailable('fts5');
  console.log(`[DB] FTS5 module available: ${hasFTS5Module}`);

  // If FTS5 was previously set up, verify it still works
  if (currentVersion >= 2 && hasFTS5Module) {
    try {
      await query("SELECT * FROM nodes_fts LIMIT 0;");
      fts5Available = true;
    } catch {
      fts5Available = false;
    }
  }

  // Apply pending migrations
  let appliedVersion = currentVersion;
  for (const migration of migrations) {
    if (migration.version > currentVersion) {
      // Skip FTS5 migration entirely if the module isn't available
      if (migration.version === 2 && !hasFTS5Module) {
        console.log(`[DB] Skipping migration ${migration.version}: FTS5 module not available`);
        try {
          await exec(
            `INSERT OR IGNORE INTO schema_version (version, description) VALUES (?, ?);`,
            [migration.version, `${migration.description} (skipped - no fts5)`]
          );
        } catch {
          // Ignore
        }
        appliedVersion = migration.version;
        continue;
      }

      console.log(`[DB] Applying migration ${migration.version}: ${migration.description}`);
      try {
        const statements = migration.up
          .split(';')
          .map((s) => s.trim())
          .filter((s) => s.length > 0);

        for (const stmt of statements) {
          await exec(stmt + ';');
        }

        await exec(
          `INSERT INTO schema_version (version, description) VALUES (?, ?);`,
          [migration.version, migration.description]
        );
        appliedVersion = migration.version;

        if (migration.version === 2) {
          fts5Available = true;
        }

        console.log(`[DB] Migration ${migration.version} applied successfully`);
      } catch (e) {
        if (migration.optional) {
          console.warn(`[DB] Optional migration ${migration.version} failed (skipping):`, e);
          try {
            await exec(
              `INSERT OR IGNORE INTO schema_version (version, description) VALUES (?, ?);`,
              [migration.version, `${migration.description} (skipped)`]
            );
          } catch {
            // Ignore
          }
          appliedVersion = migration.version;
        } else {
          console.error(`[DB] Migration ${migration.version} failed:`, e);
          throw e;
        }
      }
    }
  }

  // Ensure chat tables exist (added after initial schema was already deployed,
  // so CREATE IF NOT EXISTS runs idempotently on every init)
  await exec(`CREATE TABLE IF NOT EXISTS chat_sessions (
    id TEXT PRIMARY KEY, title TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    last_active_at TEXT NOT NULL DEFAULT (datetime('now')),
    status TEXT NOT NULL DEFAULT 'active'
  );`);
  await exec(`CREATE TABLE IF NOT EXISTS chat_messages (
    id TEXT PRIMARY KEY,
    session_id TEXT NOT NULL REFERENCES chat_sessions(id) ON DELETE CASCADE,
    role TEXT NOT NULL, content TEXT NOT NULL, rag_context TEXT,
    status TEXT NOT NULL DEFAULT 'complete',
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );`);
  await exec(`CREATE INDEX IF NOT EXISTS idx_chat_messages_session ON chat_messages(session_id, created_at);`);

  return appliedVersion;
}
