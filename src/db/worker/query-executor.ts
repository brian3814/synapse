type ExecFn = (sql: string, params?: unknown[]) => Promise<number>;
type QueryFn = <T = Record<string, unknown>>(sql: string, params?: unknown[]) => Promise<T[]>;
type CheckModuleFn = (name: string) => Promise<boolean>;

let execFn: ExecFn = () => { throw new Error('DB engine not initialized — call setEngine() first'); };
let queryFn: QueryFn = () => { throw new Error('DB engine not initialized — call setEngine() first'); };
let checkModuleFn: CheckModuleFn = () => Promise.resolve(false);

export function setEngine(engine: {
  exec: ExecFn;
  query: QueryFn;
  checkModuleAvailable: CheckModuleFn;
}): void {
  execFn = engine.exec;
  queryFn = engine.query;
  checkModuleFn = engine.checkModuleAvailable;
}

export function checkModuleAvailable(name: string): Promise<boolean> {
  return checkModuleFn(name);
}

const MAX_RETRIES = 3;
const RETRY_DELAY_MS = 100;

async function withRetry<T>(fn: () => Promise<T>): Promise<T> {
  let lastError: Error | null = null;
  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    try {
      return await fn();
    } catch (e: any) {
      lastError = e;
      if (e.message?.includes('SQLITE_BUSY') || e.message?.includes('database is locked')) {
        await new Promise((r) => setTimeout(r, RETRY_DELAY_MS * (attempt + 1)));
        continue;
      }
      throw e;
    }
  }
  throw lastError;
}

export async function executeQuery<T = Record<string, unknown>>(
  sql: string,
  params?: unknown[]
): Promise<{ rows: T[]; changes: number }> {
  return withRetry(async () => {
    const rows = await queryFn<T>(sql, params);
    return { rows, changes: 0 };
  });
}

export async function executeExec(
  sql: string,
  params?: unknown[]
): Promise<{ changes: number }> {
  return withRetry(async () => {
    const changes = await execFn(sql, params);
    return { changes };
  });
}

export async function executeTransaction(
  statements: Array<{ sql: string; params?: unknown[] }>
): Promise<void> {
  await execFn('BEGIN TRANSACTION;');
  try {
    for (const stmt of statements) {
      if (stmt.params && stmt.params.length > 0) {
        await queryFn(stmt.sql, stmt.params);
      } else {
        await execFn(stmt.sql);
      }
    }
    await execFn('COMMIT;');
  } catch (e) {
    await execFn('ROLLBACK;');
    throw e;
  }
}
