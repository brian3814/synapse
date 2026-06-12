import SQLiteESMFactory from 'wa-sqlite/dist/wa-sqlite-async.mjs';
import * as SQLite from 'wa-sqlite';
// @ts-expect-error - wa-sqlite VFS module
import { OriginPrivateFileSystemVFS } from 'wa-sqlite/src/examples/OriginPrivateFileSystemVFS.js';
// @ts-expect-error - wa-sqlite VFS module
import { IDBBatchAtomicVFS } from 'wa-sqlite/src/examples/IDBBatchAtomicVFS.js';

import { migrateFromIDB } from './idb-to-opfs-migration';
import { setEngine } from './query-executor';

const DB_NAME = 'kg_extension.db';

let sqlite3: any = null;
let db: number | null = null;
let vfsName: string = 'unknown';

// Serial execution queue to prevent concurrent Asyncify operations.
// The wa-sqlite async build uses Asyncify which corrupts WASM state
// if multiple operations interleave on the same database handle.
let queue: Promise<any> = Promise.resolve();

function serialize<T>(fn: () => Promise<T>): Promise<T> {
  const result = queue.then(fn, fn);
  queue = result.then(() => {}, () => {});
  return result;
}

/**
 * Probe whether createSyncAccessHandle() works in this worker context.
 * OriginPrivateFileSystemVFS relies on it internally, but the API is
 * restricted to dedicated workers in many Chrome versions — SharedWorkers
 * and service workers will throw.
 */
async function isOPFSAvailable(): Promise<boolean> {
  try {
    const root = await navigator.storage.getDirectory();
    const testFile = '.kg_opfs_probe';
    const handle = await root.getFileHandle(testFile, { create: true });
    const access = await (handle as any).createSyncAccessHandle();
    access.close();
    await root.removeEntry(testFile);
    return true;
  } catch {
    return false;
  }
}

export async function initSQLite(): Promise<void> {
  if (sqlite3 && db !== null) return;

  const module = await SQLiteESMFactory();
  sqlite3 = SQLite.Factory(module);

  // Try OPFS VFS first (only if createSyncAccessHandle works)
  if (await isOPFSAvailable()) {
    try {
      const vfs = new OriginPrivateFileSystemVFS();
      sqlite3.vfs_register(vfs, true);
      db = await sqlite3.open_v2(DB_NAME);
      vfsName = 'opfs';
      console.log('[DB] SQLite initialized with OPFS VFS');
    } catch (e) {
      console.warn('[DB] OPFS VFS open failed, falling back:', e);
      db = null;
    }
  } else {
    console.log('[DB] OPFS not available in this worker context, skipping');
  }

  // Fall back to IDB VFS
  if (db === null) {
    try {
      const vfs = new IDBBatchAtomicVFS();
      sqlite3.vfs_register(vfs, true);
      db = await sqlite3.open_v2(DB_NAME);
      vfsName = 'idb';
      console.log('[DB] SQLite initialized with IDB (IndexedDB) VFS');
    } catch (e) {
      console.warn('[DB] IDB VFS open failed, falling back to in-memory:', e);
      db = null;
    }
  }

  // Last resort: default in-memory VFS
  if (db === null) {
    db = await sqlite3.open_v2(DB_NAME);
    vfsName = 'memory';
    console.warn('[DB] SQLite initialized with default (in-memory) VFS — data will not persist');
  }

  // Configure pragmas (not serialized — nothing else is running yet)
  await sqlite3.exec(db, 'PRAGMA journal_mode = WAL;');
  await sqlite3.exec(db, 'PRAGMA foreign_keys = ON;');

  // Migrate data from IDB to OPFS if this is an OPFS database
  if (vfsName === 'opfs') {
    await migrateFromIDB(sqlite3, db!);
  }

  setEngine({ exec, query, checkModuleAvailable });
}

/**
 * Close and reopen the database. Used to recover from corrupted state.
 */
export async function resetDatabase(): Promise<void> {
  if (sqlite3 && db !== null) {
    try {
      await sqlite3.close(db);
    } catch {
      // Ignore close errors
    }
  }
  db = null;
  sqlite3 = null;
  queue = Promise.resolve();
  await initSQLite();
}

/**
 * Execute SQL without returning rows. Supports parameterized queries.
 * All calls are serialized to prevent Asyncify corruption.
 */
export function exec(sql: string, params?: unknown[]): Promise<number> {
  return serialize(async () => {
    if (!sqlite3 || db === null) throw new Error('DB not initialized');

    if (params && params.length > 0) {
      await sqlite3.run(db, sql, params);
    } else {
      await sqlite3.exec(db, sql);
    }

    return sqlite3.changes(db);
  });
}

/**
 * Execute a query and return rows. Supports parameterized queries.
 * All calls are serialized to prevent Asyncify corruption.
 */
export function query<T = Record<string, unknown>>(
  sql: string,
  params?: unknown[]
): Promise<T[]> {
  return serialize(async () => {
    if (!sqlite3 || db === null) throw new Error('DB not initialized');

    if (params && params.length > 0) {
      const result = await sqlite3.execWithParams(db, sql, params);
      const { rows, columns } = result;

      return rows.map((row: unknown[]) => {
        const obj: Record<string, unknown> = {};
        columns.forEach((col: string, i: number) => {
          obj[col] = row[i];
        });
        return obj as T;
      });
    } else {
      const results: T[] = [];
      await sqlite3.exec(db, sql, (row: unknown[], columns: string[]) => {
        const obj: Record<string, unknown> = {};
        columns.forEach((col, i) => {
          obj[col] = row[i];
        });
        results.push(obj as T);
      });
      return results;
    }
  });
}

export function getChanges(): number {
  if (!sqlite3 || db === null) return 0;
  return sqlite3.changes(db);
}

/**
 * Check if a SQLite compile-time module (like fts5) is available
 * by querying the module list pragma.
 */
export function getVfsName(): string {
  return vfsName;
}

export async function checkModuleAvailable(moduleName: string): Promise<boolean> {
  try {
    const rows = await query<{ name: string }>(
      `SELECT name FROM pragma_module_list WHERE name = ?;`,
      [moduleName]
    );
    return rows.length > 0;
  } catch {
    // pragma_module_list might not be available either
    return false;
  }
}
