# Vault Architecture Design

## Context

The current Electron desktop app splits storage across three unrelated locations: SQLite DB in `~/Library/Application Support/`, notes in `~/Documents/KnowledgeGraph/notes/`, and attachments in `~/Documents/KnowledgeGraph/vault/`. The Settings panel exposes "Notes Storage" and "Markdown Folder" as separate, confusing concepts. There is no unified workspace notion.

This design introduces the **Vault** — a single user-chosen directory that contains everything: the graph database, notes, user files, embeddings, and agent artifacts. Inspired by Obsidian's vault model (folder = workspace) and Karpathy's wiki concept (files in, knowledge out), but keeping the existing human-in-the-loop extract-review-merge workflow.

The Chrome extension is deprecated. This design targets Electron only.

## Design Decisions

| Decision | Choice | Rationale |
|---|---|---|
| DB location | Inside vault (`.kg/graph.db`) | Fully portable — copy the folder to move everything |
| Source of truth | Graph-as-registry | Graph DB is authoritative; filesystem is a projection. Extends existing `DbNode` model |
| Note filenames | Human-readable (`Machine Learning.md`) | Users browse the vault in Finder/VS Code. `vault_path` column maps nodeId to filepath |
| File-graph mapping | `vault_path` column on `nodes` table (already exists) | No separate manifest file. SQL index for reverse lookups |
| Multi-vault | Single vault now, design supports future switching | `VaultManager.close()` then `open(newPath)` lifecycle is ready |
| First launch | Vault setup required before anything works | Clear mental model — no hidden default locations |
| Raw file ingestion | File watcher detects new files anywhere in vault (outside `.kg/` and `notes/`) | No explicit `raw/` folder. User organizes files however they want |
| Chrome extension | Deprecated, maintenance mode | No new features target Chrome. Existing code untouched |

## Vault Directory Structure

When a user creates a vault, the app scaffolds:

```
<vault-root>/
├── .kg/                            ← app internals (dot-hidden)
│   ├── config.json                 ← vault identity & schema version
│   ├── graph.db                    ← main SQLite database
│   ├── embeddings/
│   │   └── vec.db                  ← sqlite-vec vector store
│   └── agent/
│       ├── memory.json             ← agent episodic/semantic memory
│       └── artifacts/              ← agent-generated files
├── notes/                          ← app-managed markdown notes
│   └── (Human Readable Name.md)
└── (user files anywhere)           ← detected as resources
```

**config.json:**
```json
{
  "name": "My Research",
  "id": "vault_<nanoid>",
  "schemaVersion": 1,
  "createdAt": "2026-05-09T..."
}
```

**Scaffolding rules:**
- `.kg/` and `notes/` created on vault init. No other folders pre-created.
- `.gitignore` at vault root with `.kg/` entry (so users can version-control vault content without the database).
- If `.kg/config.json` already exists, validate schema version before opening.

## VaultContext & Lifecycle

### VaultContext

Central object scoping all services to a single vault. Created on open, destroyed on close.

```typescript
interface VaultContext {
  readonly path: string;        // absolute path to vault root
  readonly kgPath: string;      // absolute path to .kg/
  readonly name: string;        // from config.json
  readonly id: string;          // stable vault ID (nanoid)

  readonly db: Database;        // better-sqlite3 handle to .kg/graph.db
  readonly config: VaultConfig; // read/write config.json
  readonly eventBus: VaultEventBus;

  resolve(relativePath: string): string;   // vault-relative to absolute
  relative(absolutePath: string): string;  // absolute to vault-relative
}
```

### VaultManager

Singleton in the Electron main process. Manages vault lifecycle.

```
App launches → VaultManager.init()
  → read recentVaults from app settings
  → none? → renderer shows VaultSetupScreen
  → found? → VaultManager.open(lastUsedPath)
    → validate .kg/config.json
    → open graph.db, run migrations
    → reconciliation scan (catch up on offline changes)
    → start file watcher
    → emit 'vault:opened'
    → renderer receives VaultContext info via IPC

User switches vault → VaultManager.close() → VaultManager.open(newPath)
  → emit 'vault:closing'
  → stop file watcher, close DB
  → open new vault (same flow)
```

**App settings** (`~/Library/Application Support/kg-extension/settings.json`) — NOT in the vault:
```json
{
  "recentVaults": [
    { "path": "/Users/brian/research", "name": "Research", "lastOpened": "..." }
  ]
}
```

API keys also stay in app settings (never in the vault — vaults may be shared or version-controlled).

## Event Bus

The event bus connects graph mutations, filesystem events, and feature handlers. Lives in the main process as part of VaultContext.

### Event Types

```typescript
type VaultEvent =
  // Graph mutations (emitted by action-handler after DB write)
  | { type: 'node:created'; node: DbNode }
  | { type: 'node:updated'; node: DbNode; changes: string[] }
  | { type: 'node:deleted'; nodeId: string; filePath?: string }
  | { type: 'edge:created'; edge: DbEdge }
  | { type: 'edge:deleted'; edgeId: string }

  // Filesystem events (emitted by file watcher)
  | { type: 'file:added'; relativePath: string }
  | { type: 'file:changed'; relativePath: string }
  | { type: 'file:removed'; relativePath: string }

  // Vault lifecycle
  | { type: 'vault:opened' }
  | { type: 'vault:closing' }
```

### Event Bus Interface

```typescript
interface VaultEventBus {
  emit(event: VaultEvent): void;
  on<T extends VaultEvent['type']>(
    type: T,
    handler: (event: Extract<VaultEvent, { type: T }>) => void
  ): () => void; // returns unsubscribe function
}
```

### Handlers

| Handler | Listens to | Action |
|---|---|---|
| `NoteFileHandler` | `node:created` (type=note), `node:updated` (name changed), `node:deleted` | Write/rename/delete `.md` files in `notes/` |
| `ResourceDetectionHandler` | `file:added` (outside `.kg/` and `notes/`) | Create resource node with `vault_path` set |
| `EmbeddingHandler` | `node:created`, `node:updated` | Queue node for embedding via existing `EmbeddingQueue` |
| `SyncBroadcastHandler` | All `node:*` and `edge:*` events | IPC to renderer so Zustand stores update the canvas |

**Loop prevention:** `NoteFileHandler` only acts on `type=note` nodes. `ResourceDetectionHandler` creates `type=resource` nodes. The file watcher ignores `notes/` since those files are app-managed. Graph-to-filesystem and filesystem-to-graph flows never trigger each other.

### Integration with Existing Code

The current `action-handler.ts` broadcasts sync events via `SYNC_CHANNEL`. The event bus generalizes this:

```
Before:  action-handler → BroadcastChannel(SYNC_CHANNEL) → renderer
After:   action-handler → eventBus.emit('node:created')
           → SyncBroadcastHandler → IPC to renderer
           → NoteFileHandler → write .md
           → EmbeddingHandler → queue embedding
```

New features add new handlers — zero changes to existing code.

### Reliability Model

The event bus is an in-process `EventEmitter` in a single Node.js process (Electron main). No network, no broker, no persistence layer — events are dispatched synchronously to all registered handlers. Messages cannot get "lost in transit."

**Failure modes and mitigations:**

| Scenario | Risk | Mitigation |
|---|---|---|
| Handler throws (e.g., `fs.writeFileSync` fails on permissions) | Graph updated but filesystem side-effect didn't happen | Handlers run in `try/catch` — one failure doesn't block others. Reconciliation on next startup detects the mismatch |
| App crashes between DB write and handler execution | Node committed to SQLite but file never written | Reconciliation self-heals: detects node with `vault_path` but no file on disk |
| Rapid events overwhelm slow handlers | Backpressure or dropped events | Critical handlers are synchronous (`better-sqlite3` + `fs.writeFileSync`). No async queue to overflow |

**Dispatch implementation:**

```typescript
emit(event: VaultEvent): void {
  for (const handler of this.handlers.get(event.type) ?? []) {
    try {
      handler(event);
    } catch (err) {
      logger.error(`Handler failed for ${event.type}`, err);
      // other handlers still run
    }
  }
}
```

**Reconciliation as safety net:** Even if every event handler fails during a session, the next app startup walks the filesystem and diffs against the DB, repairing any inconsistency. The event bus provides real-time responsiveness; reconciliation provides correctness. The system is eventually consistent by design.

## File-Graph Mapping

### Schema Changes

The `vault_path` column already exists on `DbNode`. Add `file_mtime` and `file_size` for reconciliation:

```sql
ALTER TABLE nodes ADD COLUMN file_mtime INTEGER;
ALTER TABLE nodes ADD COLUMN file_size INTEGER;

CREATE UNIQUE INDEX idx_nodes_vault_path ON nodes(vault_path) WHERE vault_path IS NOT NULL;
```

**Usage by node type:**
- **entity** — `vault_path = NULL` (no file on disk)
- **note** — `vault_path = 'notes/Machine Learning.md'`
- **resource** — `vault_path = 'papers/transformer-2017.pdf'` (user-determined path)

### Human-Readable Note Naming

When a note node is created, `NoteFileHandler` derives a filename from the node name.

**Sanitization (minimal — keep names readable):**
- Replace `/` and `\` with `-` (prevent subdirectory traversal)
- Replace `:` with `-` (Windows compatibility for future)
- Trim leading/trailing whitespace and dots
- Empty result after sanitization → `Untitled-<shortId>.md`

**Collision handling:** If `notes/Machine Learning.md` exists for a different node, append disambiguator: `notes/Machine Learning (2).md`

**Rename tracking:** When a node's name changes:
1. `NoteFileHandler` receives `node:updated` with `name` in `changes`
2. Derive new filename, `fs.rename(oldPath, newPath)`
3. Update `vault_path` on the node
4. No wikilink updates needed — internal references use node IDs, not filenames

## File Watcher

Monitors the vault for user-added files. Runs in the main process, starts on vault open, stops on close.

### Watch Configuration

```
Watch:    vault root (recursive, fs.watch with FSEvents on macOS)
Ignore:   .kg/**
          notes/**
          .git/**
          .DS_Store, .gitignore, thumbs.db
Debounce: 500ms (handles temp-file-then-rename editor patterns)
```

### Detection Flow

```
User drops paper.pdf into vault/papers/
  → fs.watch fires event
  → debounce 500ms
  → check: outside ignored dirs? → yes
  → check: node with this vault_path exists? → no
  → ResourceDetectionHandler creates node:
      type: 'resource'
      name: 'paper' (filename without extension)
      vault_path: 'papers/paper.pdf'
      file_mtime: <stat.mtimeMs>
      file_size: <stat.size>
      content_type: 'application/pdf'
      properties: { fileType: 'pdf', addedAt: '...' }
  → eventBus emits 'node:created'
  → renderer shows new resource node in graph
```

### File Deletion (External)

User deletes a file from Finder → watcher detects removal → node marked as orphaned (visual indicator in graph, "file missing" badge). Node is NOT auto-deleted — user confirms or re-links.

### File Move/Rename (External)

`fs.watch` fires `remove` + `add`. Within debounce window, match by filename + size. If matched → update `vault_path` on existing node. If not matched → orphan old node + create new resource node.

### Drag-and-Drop via UI

Renderer handles drop event → IPC `vault:import-file` → main process copies file into vault → creates node directly (skips watcher since path is already known).

## Reconciliation on Vault Open

Catches up on filesystem changes made while the app was closed. Inspired by Dendron's mtime-based approach — avoids Obsidian's full re-index performance problems where 10k+ file vaults take 20+ minutes.

### Algorithm

```
Walk vault filesystem (excluding .kg/, .git/)

For each file found:
  → SELECT vault_path, file_mtime, file_size FROM nodes WHERE vault_path = ?
  → No row?              → NEW: create resource node
  → mtime + size match?  → UNCHANGED: skip (fast path)
  → mtime or size differ → MODIFIED: update metadata, re-queue embedding

For each node with non-null vault_path NOT seen in walk:
  → MISSING: mark as orphaned

For notes/ specifically:
  → .md file mtime > node updated_at → externally edited
  → Re-read content, update note_search FTS, re-queue embedding
```

### Performance

SQLite mtime comparison is fast. Typical vaults (hundreds to low thousands of files) reconcile in under a second. The scan runs once at startup, then the live file watcher handles ongoing changes.

## Vault Picker (First Launch)

The app requires a vault before anything works. No sidebar, graph, or chat is accessible without one.

### VaultSetupScreen

Full-screen gating UI with two paths:

1. **Create New Vault** — user names a vault and picks a folder (or creates one). App scaffolds `.kg/` and `notes/`, initializes empty `graph.db`, opens the vault.

2. **Open Existing Vault** — user picks a folder containing `.kg/config.json`. App validates schema version, opens the vault, runs reconciliation.

### When It Appears

- First launch (no `recentVaults` in app settings)
- Last-used vault folder missing or invalid
- User clicks "Switch Vault" in settings (future)

### Settings Panel Changes

Remove the separate "Notes Storage" and "Markdown Folder" sections. Replace with:
- **Vault** section: name, path, node count, DB size
- "Reveal in Finder" button
- "Change Vault Location" (moves entire vault folder)

## Chrome Extension Deprecation

- No new features target Chrome. Vault is Electron-only.
- `@platform` abstraction layer stays — existing Chrome code continues to build and function.
- No active code removal in this phase. Chrome enters maintenance mode.
- `vite.config.chrome.ts`, `src/platform/chrome/`, service worker, offscreen doc — all untouched.

## Key Files to Create/Modify

| File | Action |
|---|---|
| `electron/vault/vault-manager.ts` | **Create** — VaultManager singleton, lifecycle management |
| `electron/vault/vault-context.ts` | **Create** — VaultContext interface and factory |
| `electron/vault/event-bus.ts` | **Create** — VaultEventBus implementation |
| `electron/vault/handlers/note-file-handler.ts` | **Create** — Note file sync |
| `electron/vault/handlers/resource-detection-handler.ts` | **Create** — Auto-detect user files |
| `electron/vault/handlers/embedding-handler.ts` | **Create** — Bridge to existing EmbeddingQueue |
| `electron/vault/handlers/sync-broadcast-handler.ts` | **Create** — IPC sync to renderer |
| `electron/vault/file-watcher.ts` | **Create** — fs.watch wrapper with ignore/debounce |
| `electron/vault/reconciliation.ts` | **Create** — Startup filesystem/DB diff |
| `electron/main.ts` | **Modify** — Wire VaultManager into app lifecycle |
| `electron/better-sqlite3-engine.ts` | **Modify** — Accept DB path from VaultContext instead of hardcoded userData |
| `electron/notes-backend.ts` | **Modify** — Derive paths from VaultContext |
| `electron/storage-backend.ts` | **Modify** — Add recentVaults to app settings |
| `src/db/worker/migrations/` | **Add migration** — `file_mtime`, `file_size` columns, `vault_path` index |
| `src/ui/components/VaultSetupScreen.tsx` | **Create** — Gating screen for vault create/open |
| `src/ui/components/settings/SettingsPanel.tsx` | **Modify** — Replace notes/index sections with vault section |
| `src/platform/electron/index.ts` | **Modify** — Expose vault IPC channels |
| `src/shared/types.ts` | **Modify** — Add `file_mtime`, `file_size` to `DbNode` |

## Verification

1. **Fresh launch** — app shows VaultSetupScreen, user creates vault, `.kg/` and `notes/` scaffolded, graph loads empty.
2. **Create note** — node appears in graph, `notes/Name.md` written to disk with correct content.
3. **Rename note node** — `.md` file renamed on disk, `vault_path` updated.
4. **Drop file in vault folder** — file watcher detects it, resource node appears in graph.
5. **Delete file externally** — node marked orphaned in graph (not deleted).
6. **Close app, add files, reopen** — reconciliation scan creates resource nodes for new files.
7. **Close app, edit note externally, reopen** — note content updated in DB, FTS re-indexed.
8. **Reopen existing vault** — app opens directly to graph, no VaultSetupScreen.
