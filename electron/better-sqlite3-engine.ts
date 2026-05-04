import Database from 'better-sqlite3';
import { app } from 'electron';
import { join } from 'path';
import { setEngine } from '../src/db/worker/query-executor';

const DB_PATH = join(app.getPath('userData'), 'kg-desktop.db');

let db: Database.Database | null = null;

export function getDb(): Database.Database {
  if (!db) throw new Error('DB not initialized');
  return db;
}

export async function initBetterSQLite(): Promise<void> {
  if (db) return;

  db = new Database(DB_PATH);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');

  setEngine({ exec, query, checkModuleAvailable });
  console.log('[DB] better-sqlite3 initialized at', DB_PATH);
}

export async function resetBetterSQLite(): Promise<void> {
  if (db) {
    db.close();
    db = null;
  }
  await initBetterSQLite();
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
