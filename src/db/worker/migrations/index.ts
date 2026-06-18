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
    throw new Error(
      `[DB] Vault schema is at v${currentVersion}, expected v${SCHEMA_VERSION}. ` +
      `Delete the vault database and reopen to recreate.`
    );
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

  return currentVersion;
}
