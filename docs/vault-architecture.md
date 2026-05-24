# Vault Architecture (Electron-only)

The app uses a **Vault** — a single user-chosen directory containing everything: graph DB, notes, user files, embeddings, and agent artifacts. The vault is required before the app can be used.

```
<vault-root>/
├── .kg/                    ← app internals (hidden)
│   ├── config.json         ← vault identity & schema version
│   ├── graph.db            ← SQLite database (source of truth, includes sqlite-vec)
│   └── agent/              ← agent memory
│       └── artifacts/      ← agent-generated artifacts
├── notes/                  ← app-managed markdown (human-readable names)
└── (user files anywhere)   ← auto-detected as resources
```

## Key Design Decisions

- **Graph-as-registry**: Graph DB is the source of truth. Filesystem is a projection. Every file with a graph node has `vault_path` set on the node.
- **Event bus**: Graph mutations and file events flow through `VaultEventBus`. Handlers subscribe independently (NoteFileHandler, ResourceDetectionHandler, SyncBroadcastHandler).
- **File watcher**: Recursive `fs.watch` detects user files dropped anywhere in the vault (excluding `.kg/` and `notes/`). Creates resource nodes automatically.
- **Reconciliation on startup**: mtime-based diff catches offline changes (new/modified/missing files).
- **Human-readable note names**: Notes stored as `notes/Machine Learning.md`, not `{nodeId}.md`. `vault_path` column provides the mapping.
- **API keys stay in app settings** (`~/Library/Application Support/`), never in the vault.
- **Shared DB handle**: `VaultManager.open()` calls `resetBetterSQLite(dbPath)` then `runMigrations()` directly. The vault context receives the DB handle from `getDb()` — never opens its own connection. This ensures migrations run before reconciliation and all code shares one DB handle.
- **Multi-vault**: Single vault per process. Switching vaults spawns a new detached Electron process via `spawnVaultProcess()` using `child_process.spawn()`, matching Obsidian's window model. The `VaultSwitcher` dropdown in the header shows recent vaults and create/open options.

## Key Files

- `electron/vault/vault-manager.ts` — Lifecycle (create, open, close). Singleton in main process.
- `electron/vault/vault-context.ts` — VaultContext interface + scaffoldVault helper.
- `electron/vault/event-bus.ts` — Typed event bus with try/catch per handler.
- `electron/vault/file-watcher.ts` — Recursive watch with ignore/debounce.
- `electron/vault/reconciliation.ts` — Startup filesystem↔DB diff.
- `electron/vault/handlers/` — NoteFileHandler, ResourceDetectionHandler, SyncBroadcastHandler.
- `src/ui/components/VaultSetupScreen.tsx` — Gating screen (create/open/recent).
- `src/platform/electron/vault-workspace.ts` — Renderer-side IPC bridge for vault management.

## Vault Storage (Legacy Binary Attachments)

The old `PlatformVault` interface (`import { vault } from '@platform'`) handles binary file storage for the ingestion pipeline. This is separate from the new vault workspace architecture — it will be migrated into the vault directory in a future phase.

- **Chrome**: `src/platform/chrome/vault.ts` — OPFS at `vault/{nodeId}/{filename}`
- **Electron**: `src/platform/electron/vault.ts` — IPC to main process → `~/Documents/KnowledgeGraph/vault/{nodeId}/{filename}`
