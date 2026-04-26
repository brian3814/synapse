# Electron Phase 2: Database Layer Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace wa-sqlite/SharedWorker/OPFS with better-sqlite3 in the Electron main process, giving native FTS5 and a simpler architecture, while keeping the Chrome extension unchanged.

**Architecture:** Refactor `query-executor.ts` for dependency injection so query modules work with either wa-sqlite or better-sqlite3. Extract `handleAction` from `db-worker.ts` into a shared module. Create a better-sqlite3 engine in the Electron main process, exposed via IPC. Modify `db-client.ts` to detect Electron and route through IPC.

**Tech Stack:** better-sqlite3, Electron IPC, esbuild

**Key insight:** All 16 query modules (1755 lines) and 7 migrations import from `query-executor.ts`, never from `sqlite-engine.ts` directly. By making `query-executor` accept an injected engine, we swap backends without touching any query module.

---

### Task 1: Install better-sqlite3

**Files:**
- Modify: `package.json`

- [ ] **Step 1: Install better-sqlite3 and its types**

```bash
npm install better-sqlite3
npm install --save-dev @types/better-sqlite3
```

- [ ] **Step 2: Rebuild native modules for Electron**

```bash
npx electron-rebuild
```

If this fails, try:
```bash
npx electron-rebuild -f -w better-sqlite3
```

- [ ] **Step 3: Verify the native module loads**

```bash
node -e "const Database = require('better-sqlite3'); const db = new Database(':memory:'); console.log(db.pragma('journal_mode', { simple: true })); db.close();"
```

Expected: prints `wal` or `memory` — the module loads without error.

- [ ] **Step 4: Commit**

```bash
git add package.json package-lock.json
git commit -m "chore: add better-sqlite3 dependency"
```

---

### Task 2: Refactor query-executor for dependency injection

**Files:**
- Modify: `src/db/worker/query-executor.ts`
- Modify: `src/db/worker/sqlite-engine.ts`
- Modify: `src/db/worker/migrations/index.ts`

The goal: break query-executor's direct import of sqlite-engine so query modules can work with either engine. Add a `setEngine()` function that registers the active engine's `exec`/`query`/`checkModuleAvailable` functions.

- [ ] **Step 1: Modify `src/db/worker/query-executor.ts`**

Read the file first. Replace its entire contents with:

```typescript
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
```

Key changes: removed `import { exec, query } from './sqlite-engine'`, added `setEngine()` and `checkModuleAvailable()` exports, internal functions use `execFn`/`queryFn` variables.

- [ ] **Step 2: Modify `src/db/worker/sqlite-engine.ts` to register with executor**

Read the file first. Add this import at the top (after the existing imports):

```typescript
import { setEngine } from './query-executor';
```

Then at the end of `initSQLite()`, after the pragmas and IDB migration (after line ~97, before the closing `}`), add:

```typescript
  setEngine({ exec, query, checkModuleAvailable });
```

- [ ] **Step 3: Modify `src/db/worker/migrations/index.ts` to use executor**

Read the file first. Replace the first line:

```typescript
import { exec, query, checkModuleAvailable } from '../sqlite-engine';
```

With:

```typescript
import { executeExec, executeQuery, checkModuleAvailable } from '../query-executor';
```

Then replace all calls to `exec(` with `executeExec(` and `query<` with `executeQuery<` in the file body. Specifically:

Replace `await exec(` with `await executeExec(` (there are ~8 occurrences).

For `query<` calls, update to use the `{ rows }` return shape. The two query calls in the file are:

1. Line ~42-44: `const rows = await query<{ version: number }>(...);` becomes:
```typescript
const { rows } = await executeQuery<{ version: number }>(
  'SELECT MAX(version) as version FROM schema_version;'
);
```

2. Line ~54: `await query("SELECT * FROM nodes_fts LIMIT 0;");` becomes:
```typescript
await executeQuery("SELECT * FROM nodes_fts LIMIT 0;");
```

3. Line ~60: `await query("SELECT * FROM notes_fts LIMIT 0;");` becomes:
```typescript
await executeQuery("SELECT * FROM notes_fts LIMIT 0;");
```

For `executeExec`, the return value is `{ changes: number }` but migrations only care about completion, not the count. So `await exec(sql)` becomes `await executeExec(sql)` directly — no destructuring needed since the return value is discarded.

- [ ] **Step 4: Verify Chrome extension still builds and works**

```bash
npm run build
```

Expected: Build succeeds. Then `npm run dev:electron` should also still work (the Electron app uses the stub path which doesn't init the wa-sqlite engine, so `setEngine` isn't called, but that's fine — the stubs don't hit the DB).

- [ ] **Step 5: Commit**

```bash
git add src/db/worker/query-executor.ts src/db/worker/sqlite-engine.ts src/db/worker/migrations/index.ts
git commit -m "refactor(db): dependency injection in query-executor for engine swapping"
```

---

### Task 3: Extract handleAction into shared module

**Files:**
- Create: `src/db/worker/action-handler.ts`
- Modify: `src/db/worker/db-worker.ts`

Extract the `handleAction` function and all its query module imports into a factory function that accepts `initEngine` and `resetEngine` callbacks. This lets both the web worker and Electron main process reuse the same 96-case dispatch.

- [ ] **Step 1: Create `src/db/worker/action-handler.ts`**

This file contains the extracted `handleAction` switch from `db-worker.ts`. It's a factory function that takes engine init/reset callbacks:

```typescript
import { executeQuery, executeExec } from './query-executor';
import { runMigrations } from './migrations';
import * as nodeQueries from './queries/node-queries';
import * as edgeQueries from './queries/edge-queries';
import * as nodeTypeQueries from './queries/node-type-queries';
import * as sourceContentQueries from './queries/source-content-queries';
import * as entityResolutionQueries from './queries/entity-resolution-queries';
import * as indexedFileQueries from './queries/indexed-file-queries';
import * as stressTestQueries from './queries/stress-test-queries';
import * as spatialQueries from './queries/spatial-queries';
import * as readingListQueries from './queries/reading-list-queries';
import * as tagQueries from './queries/tag-queries';
import * as entitySourceQueries from './queries/entity-source-queries';
import * as edgeSourceQueries from './queries/edge-source-queries';
import * as noteFolderQueries from './queries/note-folder-queries';
import * as chatQueries from './queries/chat-queries';
import * as noteAttachmentQueries from './queries/note-attachment-queries';
import * as noteSearchQueries from './queries/note-search-queries';
import { executeGraphQuery, executeGraphMutation } from './query-engine';
import type { SyncEvent } from '../../shared/sync-events';

export type ActionResult = { result: unknown; syncEvent?: SyncEvent };

export function createActionHandler(
  initEngine: () => Promise<void>,
  resetEngine: () => Promise<void>,
) {
  let isInitialized = false;

  function ensureInit(): void {
    if (!isInitialized) throw new Error('Database not initialized. Call init first.');
  }

  return async function handleAction(action: string, params: unknown): Promise<ActionResult> {
    // Paste the ENTIRE switch statement from db-worker.ts lines 48-597 here,
    // replacing `initSQLite()` with `initEngine()` and `resetDatabase()` with `resetEngine()`.
    // The switch is ~550 lines. It must be copied exactly.
    switch (action) {
      case 'init': {
        if (!isInitialized) {
          await initEngine();
          await runMigrations();
          isInitialized = true;
        }
        return { result: { ready: true } };
      }

      case 'ping':
        return { result: { alive: true } };

      case 'reset': {
        await resetEngine();
        await runMigrations();
        isInitialized = true;
        return { result: { ready: true }, syncEvent: { type: 'reset' } };
      }

      case 'clearAll': {
        ensureInit();
        await executeExec('DELETE FROM edges');
        await executeExec('DELETE FROM nodes');
        await executeExec('DELETE FROM chat_messages');
        await executeExec('DELETE FROM chat_sessions');
        return { result: { success: true }, syncEvent: { type: 'reset' } };
      }

      case 'exec': {
        ensureInit();
        const p = params as { sql: string; params?: unknown[] };
        const { changes } = await executeExec(p.sql, p.params);
        return { result: { changes } };
      }

      case 'query': {
        ensureInit();
        const p = params as { sql: string; params?: unknown[] };
        const { rows } = await executeQuery(p.sql, p.params);
        return { result: { rows } };
      }

      case 'loadGraph': {
        ensureInit();
        const [nodes, edges] = await Promise.all([
          nodeQueries.getAllNodesSlim(),
          edgeQueries.getAllEdgesSlim(),
        ]);
        return { result: { nodes, edges } };
      }

      // Copy ALL remaining cases from db-worker.ts (lines 103-597)
      // exactly as they are — every case from nodes.getAll through
      // noteSearch.getAll, plus the default case.
      // These cases only call query module functions + executeQuery/executeExec.
      // No sqlite-engine imports needed.

      default:
        throw new Error(`Unknown action: ${action}`);
    }
  };
}
```

**IMPORTANT:** The implementer MUST copy ALL switch cases from `db-worker.ts` (lines 48-597) into this file. Read `db-worker.ts` and copy every `case` statement. The cases between `loadGraph` and `default` are ~490 lines of mechanical dispatch — copy them verbatim. Only the `init` and `reset` cases change (using `initEngine`/`resetEngine` instead of `initSQLite`/`resetDatabase`).

- [ ] **Step 2: Simplify `src/db/worker/db-worker.ts`**

Read the current file. Replace its contents with:

```typescript
/// <reference lib="webworker" />

import { initSQLite, resetDatabase } from './sqlite-engine';
import { createActionHandler } from './action-handler';
import type { SyncEvent } from '../../shared/sync-events';

type WorkerRequest = {
  requestId: string;
  action: string;
  params?: unknown;
};

type WorkerResponse = {
  requestId: string;
  success: boolean;
  data?: unknown;
  error?: string;
  syncEvent?: SyncEvent;
};

const handleAction = createActionHandler(
  async () => { await initSQLite(); },
  async () => { await resetDatabase(); },
);

let messageTarget: { postMessage: (msg: any) => void } = self;

async function handleMessage(event: MessageEvent<WorkerRequest>) {
  const { requestId, action, params } = event.data;

  try {
    const outcome = await handleAction(action, params);

    const response: WorkerResponse = {
      requestId,
      success: true,
      data: outcome.result,
      syncEvent: outcome.syncEvent,
    };
    messageTarget.postMessage(response);
  } catch (error: any) {
    console.error(`[DB Worker] Error handling ${action}:`, error);
    const response: WorkerResponse = {
      requestId,
      success: false,
      error: error.message ?? String(error),
    };
    messageTarget.postMessage(response);
  }
}

self.onmessage = (event: MessageEvent) => {
  if (event.data?.action === '__attach_port__' && event.ports?.length > 0) {
    const coordinatorPort = event.ports[0];
    messageTarget = coordinatorPort;
    coordinatorPort.onmessage = handleMessage;
    coordinatorPort.start();
    console.log('[DB Worker] Coordinator port attached');
    return;
  }

  handleMessage(event);
};

self.postMessage({ requestId: '__init__', success: true, data: 'worker-loaded' });
```

- [ ] **Step 3: Verify Chrome extension builds and DB works**

```bash
npm run build
```

Expected: Build succeeds. Load the extension in Chrome, verify the graph loads normally — this confirms the extracted handleAction works identically.

- [ ] **Step 4: Commit**

```bash
git add src/db/worker/action-handler.ts src/db/worker/db-worker.ts
git commit -m "refactor(db): extract handleAction into shared action-handler module"
```

---

### Task 4: Create better-sqlite3 engine

**Files:**
- Create: `electron/better-sqlite3-engine.ts`

This file provides the same `exec`/`query`/`checkModuleAvailable` interface as `sqlite-engine.ts`, but using better-sqlite3's synchronous API. All functions are wrapped in `Promise.resolve()` to match the async signatures expected by query-executor.

- [ ] **Step 1: Create `electron/better-sqlite3-engine.ts`**

```typescript
import Database from 'better-sqlite3';
import { app } from 'electron';
import { join } from 'path';
import { setEngine } from '../src/db/worker/query-executor';

const DB_PATH = join(app.getPath('userData'), 'kg-desktop.db');

let db: Database.Database | null = null;

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
```

- [ ] **Step 2: Commit**

```bash
git add electron/better-sqlite3-engine.ts
git commit -m "feat(electron): add better-sqlite3 engine with same interface as wa-sqlite"
```

---

### Task 5: Create db-backend and wire IPC

**Files:**
- Create: `electron/db-backend.ts`
- Modify: `electron/main.ts`
- Modify: `electron/preload.ts`

- [ ] **Step 1: Create `electron/db-backend.ts`**

```typescript
import { initBetterSQLite, resetBetterSQLite } from './better-sqlite3-engine';
import { createActionHandler } from '../src/db/worker/action-handler';

const handleAction = createActionHandler(initBetterSQLite, resetBetterSQLite);

export { handleAction };
```

- [ ] **Step 2: Modify `electron/main.ts` to add DB IPC handler**

Read the file first. Add import at the top (after existing imports):

```typescript
import { handleAction as dbHandleAction } from './db-backend';
```

Inside the `app.whenReady().then(() => {` block, after the storage IPC handlers and before `createWindow()`, add:

```typescript
  ipcMain.handle('db:request', async (_event, action: string, params: unknown) => {
    const outcome = await dbHandleAction(action, params);
    if (outcome.syncEvent) {
      for (const win of BrowserWindow.getAllWindows()) {
        win.webContents.send('db:sync', outcome.syncEvent);
      }
    }
    return { success: true, data: outcome.result };
  });
```

- [ ] **Step 3: Modify `electron/preload.ts` to add electronDB API**

Read the file first. Add a new `contextBridge.exposeInMainWorld` block after the existing `electronStorage` block:

```typescript
contextBridge.exposeInMainWorld('electronDB', {
  request: (action: string, params?: unknown) =>
    ipcRenderer.invoke('db:request', action, params),
  onSync: (callback: (event: any) => void) => {
    const handler = (_ipcEvent: any, syncEvent: any) => callback(syncEvent);
    ipcRenderer.on('db:sync', handler);
    return () => {
      ipcRenderer.removeListener('db:sync', handler);
    };
  },
});
```

- [ ] **Step 4: Commit**

```bash
git add electron/db-backend.ts electron/main.ts electron/preload.ts
git commit -m "feat(electron): add DB IPC handler with better-sqlite3 backend"
```

---

### Task 6: Wire db-client for Electron

**Files:**
- Modify: `src/db/client/db-client.ts`
- Modify: `src/db/client/db-hooks.ts`

Modify `initDbClient()` to detect Electron and route through IPC instead of SharedWorker. All existing typed operation exports (nodes, edges, etc.) continue to call `sendRequest()` — the transport is swapped underneath.

- [ ] **Step 1: Modify `src/db/client/db-client.ts`**

Read the file first. The `initDbClient()` function (lines 29-78) currently creates a SharedWorker. We need to add an Electron path that uses IPC instead.

Add this new function before `initDbClient()`:

```typescript
function initElectronClient(): Promise<void> {
  const electronDB = (window as any).electronDB as {
    request: (action: string, params?: unknown) => Promise<{ success: boolean; data?: unknown; error?: string }>;
    onSync: (callback: (event: any) => void) => () => void;
  };

  // Route all sendRequest calls through IPC
  port = {
    postMessage: () => {},
    start: () => {},
    onmessage: null,
  } as any;

  // Override sendRequest to use IPC
  sendRequestImpl = async (action: string, params?: unknown): Promise<unknown> => {
    const response = await electronDB.request(action, params);
    if (!response.success) {
      throw new Error((response as any).error ?? 'DB request failed');
    }
    return response.data;
  };

  // Wire sync events to BroadcastChannel so graph-store listeners work
  const syncChannel = new BroadcastChannel('kg_extension_sync');
  electronDB.onSync((event) => {
    syncChannel.postMessage(event);
  });

  return sendRequestImpl('init', undefined) as Promise<void>;
}
```

Then modify the `sendRequest` function. Currently it uses `port.postMessage`. We need it to delegate to `sendRequestImpl` when available. Add a variable at the module level (near the top, after `let initPromise`):

```typescript
let sendRequestImpl: ((action: string, params?: unknown) => Promise<unknown>) | null = null;
```

Then modify the existing `sendRequest` function (lines 110-129). Add at the top of the function body:

```typescript
  if (sendRequestImpl) {
    return sendRequestImpl(action, params);
  }
```

Finally, modify `initDbClient()` (lines 29-78). Add an Electron detection at the start of the function:

```typescript
export function initDbClient(): Promise<void> {
  if (initPromise) return initPromise;

  // Electron path: route through IPC to main process
  if ((window as any).electronDB) {
    initPromise = initElectronClient().then(() => {
      console.log('[DB Client] Database initialized via Electron IPC (better-sqlite3)');
    });
    return initPromise;
  }

  // Chrome extension path: SharedWorker (existing code unchanged)
  initPromise = new Promise((resolve, reject) => {
    // ... rest of existing code unchanged
```

Make sure the rest of the existing SharedWorker code stays inside the else branch.

- [ ] **Step 2: Modify `src/db/client/db-hooks.ts`**

Read the file first. The `useDbInit` hook calls `initNoteStore()` after `initDbClient()`. In Electron, OPFS note store won't be needed (Phase 3 handles filesystem notes). Skip it:

Change the useEffect in `useDbInit()`:

```typescript
  useEffect(() => {
    initDbClient()
      .then(() => {
        // Skip OPFS note store in Electron — Phase 3 adds filesystem-based notes
        if ((window as any).electronAPI) return;
        return initNoteStore();
      })
      .then(() => setReady(true))
      .catch((e) => {
        console.error('[useDbInit] Failed:', e);
        setError(e.message);
      });
  }, []);
```

- [ ] **Step 3: Verify Chrome extension still builds**

```bash
npm run build
```

Expected: Build succeeds.

- [ ] **Step 4: Commit**

```bash
git add src/db/client/db-client.ts src/db/client/db-hooks.ts
git commit -m "feat(db-client): detect Electron and route through IPC to better-sqlite3"
```

---

### Task 7: Build and verify

**Files:** None (verification only)

- [ ] **Step 1: Build the Electron app**

```bash
npm run build:electron
```

Expected: No errors. esbuild bundles the main process including db-backend, better-sqlite3-engine, action-handler, and all query modules. better-sqlite3 is external (native module).

- [ ] **Step 2: Launch and verify DB initialization**

```bash
ELECTRON_ENABLE_LOGGING=1 npx electron . --enable-logging 2>&1 | head -20
```

Expected output should include:
- `[DB] better-sqlite3 initialized at .../kg-desktop.db` (NOT wa-sqlite/OPFS)
- `[DB] FTS5 module available: true` (NOT false — better-sqlite3 bundles FTS5)
- `[DB Client] Database initialized via Electron IPC (better-sqlite3)`

- [ ] **Step 3: Verify node creation persists**

Launch the app (`npm run dev:electron`). In the UI:
1. Create a node (use the extraction or manual creation)
2. Close the app (Cmd+Q)
3. Relaunch
4. Verify the node still exists

- [ ] **Step 4: Verify the SQLite file**

```bash
sqlite3 ~/Library/Application\ Support/kg-extension/kg-desktop.db ".tables"
```

Expected: prints table list including `nodes`, `edges`, `schema_version`, `nodes_fts`, etc.

```bash
sqlite3 ~/Library/Application\ Support/kg-extension/kg-desktop.db "SELECT count(*) FROM schema_version;"
```

Expected: prints 7 (all migrations applied).

- [ ] **Step 5: Verify FTS search works**

In the Electron app, use the search bar to search for a node by name. FTS5 should now return results (it was disabled in the wa-sqlite WASM build).

- [ ] **Step 6: Verify Chrome extension still works**

```bash
npm run build
```

Load `dist/` in `chrome://extensions`. Verify graph loads, nodes persist, search works — completely unaffected by the changes.

- [ ] **Step 7: Commit (if any fixes were needed)**

```bash
git add -A
git commit -m "fix(electron): adjustments from Phase 2 verification"
```

---

## Phase 2 success criteria

1. `npm run build:electron` completes without errors
2. Electron app uses better-sqlite3 (log shows "better-sqlite3 initialized", NOT "OPFS VFS")
3. FTS5 is available (log shows `FTS5 module available: true`)
4. Nodes/edges persist across app restarts
5. `~/Library/Application Support/kg-extension/kg-desktop.db` is a valid SQLite file
6. Search returns results via FTS5
7. Sync events fire (BroadcastChannel works)
8. Chrome extension build succeeds and works identically
