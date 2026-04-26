# Electron Phase 2: Database Layer

## Context

Phase 0-1 delivered an Electron shell with working wa-sqlite (via OPFS/SharedWorker in the renderer). This phase replaces that chain with better-sqlite3 in the main process, giving native FTS5 support, better performance, and a simpler architecture (no SharedWorker/DedicatedWorker chain in Electron).

## Approach: IPC Bridge + Engine Rewrite

Modify `initDbClient()` to detect Electron and route `sendRequest()` calls through IPC instead of the SharedWorker MessagePort. The main process runs the same 96 action handlers and 16 query modules with better-sqlite3 underneath. Only the engine layer (`sqlite-engine.ts` equivalent) is rewritten.

**Result:** Chrome extension DB code is untouched. Electron gets native SQLite with FTS5. All query modules, migrations, and sync events are reused.

## Architecture

```
Chrome Extension (unchanged):
  db-client.ts → SharedWorker → DedicatedWorker → sqlite-engine (wa-sqlite/OPFS)

Electron:
  db-client.ts → IPC → main process → db-backend.ts → better-sqlite3 → .db file
```

## Components

### electron/db-backend.ts (Create)

Port of `db-worker.ts` + `sqlite-engine.ts` + `query-executor.ts` for better-sqlite3:

- **Engine**: Opens `app.getPath('userData')/kg-desktop.db` via `new Database(path)`. Enables WAL mode + foreign keys.
- **Executor**: `executeQuery<T>(sql, params)` calls `db.prepare(sql).all(...params)`. `executeExec(sql, params)` calls `db.prepare(sql).run(...params)`. No serialize queue needed (better-sqlite3 is synchronous).
- **Action dispatch**: Same 96-case switch from `db-worker.ts`, calling the same query module functions. Returns `{result, syncEvent?}`.
- **Migrations**: Same runner from `migrations/index.ts`, but FTS5 is always available (better-sqlite3 bundles it).
- **Query modules**: Imported directly — all 16 files work unchanged since they only call `executeQuery`/`executeExec`.

The key change: `executeQuery` and `executeExec` are redefined locally to use better-sqlite3's synchronous API wrapped in the same async signature, so all query modules work without modification.

### electron/main.ts (Modify)

Register IPC handler:
```
ipcMain.handle('db:request', (event, action, params) => {
  const { result, syncEvent } = dbBackend.handleAction(action, params);
  if (syncEvent) {
    for (const win of BrowserWindow.getAllWindows()) {
      win.webContents.send('db:sync', syncEvent);
    }
  }
  return result;
});
```

### electron/preload.ts (Modify)

Expose `electronDB` API:
```
electronDB: {
  request: (action, params) => ipcRenderer.invoke('db:request', action, params),
  onSync: (callback) => {
    ipcRenderer.on('db:sync', (_, event) => callback(event));
    return () => ipcRenderer.removeListener('db:sync', ...);
  }
}
```

### src/db/client/db-client.ts (Modify)

In `initDbClient()`, detect Electron and skip SharedWorker creation:
- If `window.electronDB` exists, set up IPC transport
- `sendRequest(action, params)` routes through `window.electronDB.request(action, params)` instead of MessagePort
- Subscribe to `window.electronDB.onSync()` and forward to `BroadcastChannel(SYNC_CHANNEL)` so graph-store listeners work unchanged
- The rest of the file (all typed operation exports) stays identical

### src/db/client/db-hooks.ts (Modify)

In `useDbInit()`, skip OPFS note store init in Electron (Phase 3 will add filesystem-based notes). For now, note store init is a no-op in Electron — notes will work via the DB but not OPFS.

## Migration Strategy

### Query module reuse

The 16 query modules in `src/db/worker/queries/` call `executeQuery` and `executeExec` from `query-executor.ts`. In the main process, we provide the same function signatures backed by better-sqlite3. The query modules are imported unchanged.

This works because:
- All SQL is standard SQLite (verified: zero wa-sqlite-specific syntax)
- Parameters use `?` placeholders (same in both engines)
- Return types match: `{ rows: T[] }` from query, `{ changes: number }` from exec

### Migration runner

Same migration files from `src/db/worker/migrations/`. Two changes:
1. FTS5 is always available — skip the `checkModuleAvailable` guard
2. `exec`/`query` calls use the better-sqlite3 backed executor

### DB file

Location: `app.getPath('userData')/kg-desktop.db` — e.g., `~/Library/Application Support/kg-extension/kg-desktop.db`

WAL mode enabled, foreign keys on. Same pragmas as wa-sqlite engine.

## Sync Events

Current flow (Chrome): `db-worker` returns `syncEvent` → `db-shared-worker` broadcasts on `BroadcastChannel`

New flow (Electron): `db-backend` returns `syncEvent` → main process sends `db:sync` IPC → preload receives → renderer posts to `BroadcastChannel(SYNC_CHANNEL)`

The graph-store listener on `BroadcastChannel` works identically in both modes.

## Files

| File | Change |
|------|--------|
| `electron/db-backend.ts` | **Create** — better-sqlite3 engine + action dispatch + migration runner |
| `electron/main.ts` | **Modify** — register `db:request` IPC handler, init db-backend |
| `electron/preload.ts` | **Modify** — expose `electronDB` API |
| `src/db/client/db-client.ts` | **Modify** — detect Electron, route via IPC |
| `src/db/client/db-hooks.ts` | **Modify** — skip OPFS init in Electron |
| `package.json` | **Modify** — add better-sqlite3 dependency |

## Verification

1. `npm run build:electron` completes (better-sqlite3 native module builds via electron-rebuild)
2. Launch Electron → DB initializes with better-sqlite3 (not wa-sqlite)
3. Create nodes/edges → persist across restart
4. FTS search works (search bar returns results)
5. Sync events fire (create node in one action, graph updates immediately)
6. Check `~/Library/Application Support/kg-extension/kg-desktop.db` exists and is valid SQLite
7. `npm run build` (Chrome extension) still works — no changes to Chrome code path
