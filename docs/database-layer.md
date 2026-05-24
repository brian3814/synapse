# Database Layer

Three abstraction levels separate UI code from the storage engine:

```
db-client.ts (typed API, platform-agnostic)
  → PlatformDB (transport: Chrome SharedWorker or Electron IPC)
    → action-handler.ts (dispatches to DataStore)
      → DataStore interface (16 repository sub-interfaces)
        → SqliteDataStore (wraps existing query modules)
```

## Key Files

- **`src/db/data-store.ts`** — `DataStore` interface with 16 repository sub-interfaces (`NodeRepository`, `EdgeRepository`, `SpatialRepository`, `ChatRepository`, etc.) plus top-level `init()`, `reset()`, `loadGraph()`, `clearAll()`, `graphQuery()`, `graphMutate()`, and raw SQL escape hatches. All methods return `Promise` so implementations can be sync or async. No SQL types leak into the interface.
- **`src/db/sqlite-data-store.ts`** — `createSqliteDataStore(initEngine, resetEngine)` factory. Pure 1:1 delegation to the 16 query modules in `src/db/worker/queries/`. No logic — just wiring.
- **`src/db/worker/action-handler.ts`** — Accepts `DataStore`, maps action strings (`nodes.create`, `edges.getAll`, etc.) to repository methods + sync events for broadcasting. The switch stays (96 cases) but delegates through the interface, not concrete SQL modules.
- **`src/db/worker/sqlite-engine.ts`** — All SQLite ops serialized through a promise queue (prevents wa-sqlite Asyncify corruption). VFS fallback: OPFS → IDB → in-memory. **Critical:** `open_v2` must be inside each VFS try/catch (Pitfall #11).
- **`src/db/worker/migrations/`** — Versioned, FTS5 detected at runtime. Migration 002 (FTS) is optional; search falls back to LIKE. Migration 010 adds `location TEXT` to `entity_sources`/`edge_sources` (JSON-serialized SourceLocation for provenance), plus `vault_path TEXT` and `content_type TEXT` on `nodes`.
- **`src/db/client/db-client.ts`** — Platform-agnostic typed API. Imports `db` from `@platform` and delegates via `db.request(action, params)`. All 30+ typed namespace methods (`nodes`, `edges`, `spatial`, `chat`, etc.) are shared code. Platform transport is in `ChromeDB` (SharedWorker/MessagePort) or `ElectronDB` (IPC to better-sqlite3).

## Swapping the Storage Engine

Implement `DataStore`, wire into `createActionHandler`. No changes to db-client, PlatformDB, action-handler dispatch logic, or UI code.

## Note Content Storage

Note content is stored as `.md` files, NOT in SQLite. UI code accesses notes via `import { notes } from '@platform'` (`PlatformNotes` interface). See [`adr-opfs-note-storage.md`](adr-opfs-note-storage.md) for full ADR.

- **Chrome** (deprecated): `src/platform/chrome/notes.ts` — OPFS async API (`notes/{node_id}.md`)
- **Electron (vault)**: Notes live in the vault at `<vault>/notes/{Human Readable Name}.md`. The `NoteFileHandler` event handler manages file creation, renames (when node name changes), and deletion. The `vault_path` column on `nodes` stores the vault-relative path (e.g., `notes/Machine Learning.md`). File naming uses minimal sanitization (replace `/\:`, trim dots/spaces) with collision handling via `(2)` suffix.
- **Legacy Electron** (pre-vault): `electron/notes-backend.ts` — `~/Documents/KnowledgeGraph/notes/{node_id}.md`
- **`src/notes/markdown-utils.ts`** — `stripMarkdownToPlainText()` for FTS tokenization, re-exports `parseMarkdown`/`generateNoteMarkdown`
- **`note_search` table** (in 001-initial-schema) — Backing table for FTS5 external content. Stores `node_id`, `title`, stripped plain-text `body`.
- **`notes_fts` virtual table** (in 002-fts-index) — External content FTS5 on `note_search`. Auto-synced via INSERT/DELETE/UPDATE triggers.
- **Write ordering**: File first, then `note_search` upsert, then `nodes` metadata update. Orphaned files are harmless; dangling DB references are not.
- **`nodes.properties`** for notes contains only `{ wikiLinks }` — no content. Content is never stored in `source_content` for notes.
- **Cross-tab sync**: `BroadcastChannel(SYNC_CHANNEL)` with `note_content_updated` event type.

## State Management

Ten Zustand stores in `src/graph/store/`:

| Store | Purpose |
|---|---|
| `graph-store.ts` | Node/edge CRUD with DB sync. Broadcasts `SYNC_CHANNEL` events on mutations. |
| `ui-store.ts` | Active panel, layout type, display mode, chat mode (`float`/`sidebar`), clustering toggle. |
| `llm-store.ts` | Extraction pipeline state machine: `idle → extracting → extracted → reviewing → merging`. Also tracks agent runs (`AgentTurn[]`). |
| `node-type-store.ts` | Node type definitions + auto-assigned colors from `TYPE_COLOR_PALETTE` (10 colors, cycles on exhaustion). |
| `extraction-review-store.ts` | Ephemeral review session with undo/redo command pattern. Manages `ReviewNode[]`/`ReviewEdge[]` with temp IDs (`temp-${uuid}`). |
| `auth-store.ts` | Authentication state (user, session, provider). |
| `chat-context-store.ts` | Context nodes/notes passed to chat agent. |
| `reading-list-store.ts` | Reading list items and extraction queue. |
| `tag-store.ts` | Tag list and counts for filtering. |
| `viewport-store.ts` | Camera position, zoom level, viewport bounds. |

Stores are independent; hooks like `useLLMExtraction()` orchestrate multi-store updates.

## Graph Store Sync

The graph store's `startSyncListener` subscribes to BOTH `BroadcastChannel` (Chrome cross-tab sync) AND `db.onSync` (Electron IPC). This ensures node/edge mutations from any source (chat tools, other windows, direct DB operations) immediately update the canvas.
