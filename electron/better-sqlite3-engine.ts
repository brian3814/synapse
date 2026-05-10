import Database from 'better-sqlite3';
import { app } from 'electron';
import { join } from 'path';
import { setEngine } from '../src/db/worker/query-executor';

const DEFAULT_DB_PATH = join(app.getPath('userData'), 'kg-desktop.db');

let db: Database.Database | null = null;
let currentDbPath: string = DEFAULT_DB_PATH;

export function getDb(): Database.Database {
  if (!db) throw new Error('DB not initialized');
  return db;
}

export async function initBetterSQLite(dbPath?: string): Promise<void> {
  if (db) return;

  currentDbPath = dbPath ?? DEFAULT_DB_PATH;
  db = new Database(currentDbPath);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');

  setEngine({ exec, query, checkModuleAvailable });
  console.log('[DB] better-sqlite3 initialized at', currentDbPath);
}

export async function resetBetterSQLite(dbPath?: string): Promise<void> {
  if (db) {
    db.close();
    db = null;
  }
  await initBetterSQLite(dbPath ?? currentDbPath);
}

export async function exec(sql: string, params?: unknown[]): Promise<number> {
  if (!db) throw new Error('DB not initialized');
  if (params && params.length > 0) {
    const result = db.prepare(sql).run(...params);
    return result.changes;
  }
  db.exec(sql);
  return 0;
}

export async function query<T = Record<string, unknown>>(
  sql: string,
  params?: unknown[],
): Promise<T[]> {
  if (!db) throw new Error('DB not initialized');
  if (params && params.length > 0) {
    return db.prepare(sql).all(...params) as T[];
  }
  return db.prepare(sql).all() as T[];
}

export async function checkModuleAvailable(moduleName: string): Promise<boolean> {
  if (!db) return false;
  try {
    const rows = db.prepare(
      `SELECT name FROM pragma_module_list WHERE name = ?`
    ).all(moduleName) as { name: string }[];
    return rows.length > 0;
  } catch {
    return false;
  }
}
