# Hybrid Worker Architecture: SharedWorker Coordinator + Dedicated Worker SQLite

## Context

The DB layer currently uses a SharedWorker that holds SQLite directly. Because `createSyncAccessHandle()` is unavailable in SharedWorkers, OPFS VFS always fails and SQLite falls back to IndexedDB VFS (`IDBBatchAtomicVFS`). This is adequate today but insufficient for planned features:

- **Time travel snapshots** — write-heavy; IDB transaction overhead makes frequent snapshots slow
- **Markdown editing with auto-save** — steady stream of small writes; IDB adds ~50ms+ per write vs ~5ms for OPFS

The fix: make the SharedWorker a thin coordinator that spawns a single Dedicated Worker to hold SQLite. The Dedicated Worker has OPFS access, giving us fast synchronous file I/O. This is simpler than Notion's approach (no tab election, no multi-hop routing) because the SharedWorker owns the Dedicated Worker directly.

## Target Architecture

```
UI (side panel / tab)
  → db-client.ts          (UNCHANGED — SharedWorker port RPC)
  → db-shared-worker.ts   (COORDINATOR — spawns worker, routes messages, broadcasts sync)
      └→ db-worker.ts     (DEDICATED WORKER — SQLite + OPFS VFS, all query logic)
  → sqlite-engine.ts      (OPFS probe now succeeds in dedicated worker context)
```

**Zero API surface change** — all 17 files importing `db-client.ts` need no modifications.

## Implementation Steps

### Step 1: Update Dedicated Worker (`src/db/worker/db-worker.ts`)

Bring to full parity with current `db-shared-worker.ts`:

1. Add missing imports: `sourceContentQueries`, `entityResolutionQueries`, `indexedFileQueries`, `SyncEvent`
2. Add missing action handlers: `sourceContent.*` (6), `entityResolution.*` (4), `indexedFiles.*` (6), `clearAll`, `edges.getTypes`
3. Extract `handleAction()` returning `{ result, syncEvent? }` — same pattern as current SharedWorker
4. Include `syncEvent` in response: `{ requestId, success, data?, error?, syncEvent? }`
5. Keep `self.onmessage` pattern (dedicated worker)
6. Do NOT add BroadcastChannel — coordinator handles that

### Step 2: Rewrite SharedWorker as Coordinator (`src/db/worker/db-shared-worker.ts`)

Replace ~360 lines of SQLite-handling code with ~100 lines of message routing:

**Remove:** All imports of sqlite-engine, migrations, query modules, query-engine. Remove `handleAction()`, `MUTATION_ACTIONS`, `ensureInit()`, Web Locks.

**New logic:**
- `spawnDedicatedWorker()` — lazy-spawns via `new Worker('/db-worker.js', { type: 'module' })`, sends `init`, awaits ready response
- `pendingRequests: Map<requestId, MessagePort>` — tracks which port sent each request
- `dedicatedWorker.onmessage` — routes response to originating port, broadcasts `syncEvent` via BroadcastChannel
- `self.onconnect` — receives port, forwards requests to dedicated worker
- Intercepts `action: 'init'` — returns immediately if dedicated worker already initialized (no re-forwarding)
- `dedicatedWorker.onerror` — rejects all pending requests, nulls worker for respawn on next request

**Web Locks removed** — the single Dedicated Worker's `serialize()` queue is sufficient. Web Locks added latency without additional safety in this architecture.

### Step 3: IDB-to-OPFS Data Migration (`src/db/worker/idb-to-opfs-migration.ts` — new file)

One-time migration for existing users whose data lives in IndexedDB:

1. Called from `initSQLite()` after OPFS database is opened
2. Creates `_migration_meta` table in OPFS DB; checks for `idb_migrated` marker
3. If not migrated: opens a **second** wa-sqlite instance with `IDBBatchAtomicVFS`
4. Reads all rows from IDB tables into memory arrays (avoids Asyncify interleaving)
5. Bulk-inserts into OPFS DB using `INSERT OR IGNORE` (idempotent for crash recovery)
6. Sets `idb_migrated` marker; closes IDB instance

Tables to migrate: `nodes`, `edges`, `entity_aliases`, `extraction_log`, `ontology_node_types`, `ontology_edge_types`, `source_content`, `indexed_files`, `schema_version`

IDB data is **kept intact** as backup — can be cleaned up in a future release.

### Step 4: Minor Edit to sqlite-engine (`src/db/worker/sqlite-engine.ts`)

1. Track which VFS was used: add `let vfsName: string` variable, set in each branch
2. After OPFS VFS opens successfully, call `migrateFromIDB(sqlite3, db)`
3. Export `getVfsName()` for diagnostics

### Step 5: Verify Build System (`vite.config.ts`)

No config changes needed — both `dbWorkerPlugin()` and `dbSharedWorkerPlugin()` already exist in the plugins array. Verify:
- `dist/db-worker.js` now bundles SQLite + wa-sqlite (larger)
- `dist/db-shared-worker.js` is now much smaller (no wa-sqlite)
- `dist/wa-sqlite-async.wasm` emitted by `dbWorkerPlugin` build (no content hash)

## File Change Summary

| File | Change | Scope |
|------|--------|-------|
| `src/db/worker/db-worker.ts` | Major rewrite | Add 16 missing handlers, syncEvent support |
| `src/db/worker/db-shared-worker.ts` | Major rewrite | Strip SQLite, become coordinator |
| `src/db/worker/idb-to-opfs-migration.ts` | New file | One-time data migration |
| `src/db/worker/sqlite-engine.ts` | Minor edit | VFS tracking, migration hook |
| `src/db/client/db-client.ts` | No change | API contract preserved |
| `vite.config.ts` | No change | Already builds both workers |
| 17 consuming files | No change | API unchanged |

## Risks & Mitigations

| Risk | Mitigation |
|------|-----------|
| `new Worker()` inside SharedWorker in Chrome extensions | HTML spec allows this; Chrome supports it. Fallback: revert to current architecture if blocked |
| WASM loading path from spawned Dedicated Worker | Both `db-worker.js` and `wa-sqlite-async.wasm` at dist root; `SQLiteESMFactory()` accepts `locateFile` override if needed |
| Migration interrupted mid-way | `INSERT OR IGNORE` makes re-run idempotent; IDB data never deleted |
| 10s init timeout exceeded during large migration | Typical KG data (<10K nodes) migrates well under 10s; can increase timeout for init specifically if needed |
| Dual WASM instances during migration | Temporary ~2.2MB memory spike; freed after IDB instance closes |

## Verification

1. **Build**: `npm run build` succeeds, `dist/` contains `db-worker.js`, `db-shared-worker.js`, `wa-sqlite-async.wasm`
2. **Fresh install**: Load extension → console shows `[DB] SQLite initialized with OPFS VFS` → create/read nodes works → data persists across restart
3. **Migration**: Pre-populate with old build → load new build → console shows `[DB] IDB to OPFS migration complete` → all data present
4. **Multi-tab sync**: Open side panel + full tab → create node in one → appears in other via BroadcastChannel
5. **Worker crash**: Terminate dedicated worker in DevTools → next request triggers respawn → operations resume

## Future Optimization (not in scope)

Switch from async build (`wa-sqlite-async.mjs` + `OriginPrivateFileSystemVFS`) to sync build (`wa-sqlite.mjs` + `AccessHandlePoolVFS`). This would eliminate Asyncify overhead and the `serialize()` queue entirely, but requires refactoring sqlite-engine.ts from async to sync operations.
