/**
 * One-time migration from IndexedDB VFS to OPFS VFS.
 *
 * When existing users upgrade to the hybrid worker architecture, their data
 * lives in IndexedDB (IDBBatchAtomicVFS). This module opens a second wa-sqlite
 * instance using the IDB VFS, reads all rows, and bulk-inserts them into the
 * OPFS database. The migration is idempotent (INSERT OR IGNORE) so it can
 * safely be re-run after a crash.
 *
 * IDB data is kept intact as backup.
 */

import SQLiteESMFactory from 'wa-sqlite/dist/wa-sqlite-async.mjs';
import * as SQLite from 'wa-sqlite';
// @ts-expect-error - wa-sqlite VFS module
import { IDBBatchAtomicVFS } from 'wa-sqlite/src/examples/IDBBatchAtomicVFS.js';

const DB_NAME = 'kg_extension.db';

// Tables to migrate in dependency order (nodes before edges/aliases/etc.)
const TABLES_TO_MIGRATE = [
  'schema_version',
  'ontology_node_types',
  'ontology_edge_types',
  'nodes',
  'edges',
  'entity_aliases',
  'extraction_log',
  'source_content',
  'indexed_files',
];

/**
 * Check if IDB migration has already been completed.
 * Creates the _migration_meta table if it doesn't exist.
 */
async function isMigrated(sqlite3: any, db: number): Promise<boolean> {
  await sqlite3.exec(db, `
    CREATE TABLE IF NOT EXISTS _migration_meta (
      key   TEXT PRIMARY KEY,
      value TEXT,
      done_at TEXT DEFAULT (datetime('now'))
    );
  `);

  let found = false;
  await sqlite3.exec(
    db,
    `SELECT 1 FROM _migration_meta WHERE key = 'idb_migrated'`,
    () => { found = true; }
  );
  return found;
}

/**
 * Mark migration as complete.
 */
async function markMigrated(sqlite3: any, db: number): Promise<void> {
  await sqlite3.exec(db, `
    INSERT OR REPLACE INTO _migration_meta (key, value)
    VALUES ('idb_migrated', 'true');
  `);
}

/**
 * Read all rows from a table using the IDB sqlite instance.
 * Returns { columns, rows } where rows is an array of arrays.
 */
async function readTable(sqlite3: any, db: number, table: string): Promise<{ columns: string[]; rows: unknown[][] }> {
  const columns: string[] = [];
  const rows: unknown[][] = [];

  try {
    await sqlite3.exec(db, `SELECT * FROM ${table}`, (row: unknown[], cols: string[]) => {
      if (columns.length === 0) {
        columns.push(...cols);
      }
      rows.push([...row]);
    });
  } catch {
    // Table may not exist in old IDB database — that's fine
  }

  return { columns, rows };
}

/**
 * Bulk-insert rows into the OPFS database.
 * Uses INSERT OR IGNORE for idempotent crash recovery.
 */
async function insertRows(
  sqlite3: any,
  db: number,
  table: string,
  columns: string[],
  rows: unknown[][],
): Promise<number> {
  if (rows.length === 0) return 0;

  const placeholders = columns.map(() => '?').join(', ');
  const sql = `INSERT OR IGNORE INTO ${table} (${columns.join(', ')}) VALUES (${placeholders})`;

  let inserted = 0;
  for (const row of rows) {
    await sqlite3.run(db, sql, row);
    inserted += sqlite3.changes(db);
  }
  return inserted;
}

/**
 * Attempt to open a wa-sqlite instance using IDB VFS.
 * Returns null if IDB database doesn't exist or can't be opened.
 */
async function openIdbDatabase(): Promise<{ sqlite3: any; db: number } | null> {
  try {
    const module = await SQLiteESMFactory();
    const sqlite3 = SQLite.Factory(module);

    const vfs = new IDBBatchAtomicVFS();
    sqlite3.vfs_register(vfs, true);
    const db = await sqlite3.open_v2(DB_NAME);

    // Quick check: if schema_version table doesn't exist, there's no data
    let hasData = false;
    try {
      await sqlite3.exec(db, `SELECT 1 FROM schema_version LIMIT 1`, () => { hasData = true; });
    } catch {
      // No schema_version table — empty/nonexistent IDB database
    }

    if (!hasData) {
      try { await sqlite3.close(db); } catch { /* ignore */ }
      return null;
    }

    return { sqlite3, db };
  } catch {
    return null;
  }
}

/**
 * Migrate data from IDB VFS to the already-open OPFS database.
 * Called from initSQLite() after the OPFS database is opened.
 *
 * @param opfsSqlite3 - The OPFS wa-sqlite Factory instance
 * @param opfsDb - The OPFS database handle
 */
export async function migrateFromIDB(opfsSqlite3: any, opfsDb: number): Promise<void> {
  // Check if already migrated
  if (await isMigrated(opfsSqlite3, opfsDb)) {
    return;
  }

  console.log('[DB] Checking for IDB data to migrate...');

  // Try to open the IDB database
  const idb = await openIdbDatabase();
  if (!idb) {
    console.log('[DB] No IDB data found, skipping migration');
    await markMigrated(opfsSqlite3, opfsDb);
    return;
  }

  try {
    console.log('[DB] IDB database found, starting migration...');
    let totalRows = 0;

    // Read all data from IDB first (avoids Asyncify interleaving between instances)
    const tableData: Array<{ table: string; columns: string[]; rows: unknown[][] }> = [];
    for (const table of TABLES_TO_MIGRATE) {
      const { columns, rows } = await readTable(idb.sqlite3, idb.db, table);
      if (rows.length > 0) {
        tableData.push({ table, columns, rows });
      }
    }

    // Close IDB instance before writing to OPFS
    try { await idb.sqlite3.close(idb.db); } catch { /* ignore */ }

    // Bulk-insert into OPFS database
    await opfsSqlite3.exec(opfsDb, 'BEGIN TRANSACTION');
    try {
      for (const { table, columns, rows } of tableData) {
        const inserted = await insertRows(opfsSqlite3, opfsDb, table, columns, rows);
        console.log(`[DB] Migrated ${table}: ${inserted}/${rows.length} rows`);
        totalRows += inserted;
      }
      await opfsSqlite3.exec(opfsDb, 'COMMIT');
    } catch (e) {
      await opfsSqlite3.exec(opfsDb, 'ROLLBACK');
      throw e;
    }

    await markMigrated(opfsSqlite3, opfsDb);
    console.log(`[DB] IDB to OPFS migration complete (${totalRows} rows migrated)`);
  } catch (e) {
    console.error('[DB] IDB to OPFS migration failed:', e);
    // Don't mark as migrated — will retry on next init
    // Close IDB instance if still open
    try { await idb.sqlite3.close(idb.db); } catch { /* ignore */ }
    throw e;
  }
}
