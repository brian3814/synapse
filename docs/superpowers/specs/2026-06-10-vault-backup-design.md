# Vault Backup System Design

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add opt-in, local-only vault backup with two independent layers — git-based versioning for text files and binary DB snapshots — so users can recover vault state without remote sync infrastructure.

**Architecture:** Two layers running in the Electron main process. Layer 1 uses isomorphic-git (pure JS, no system git dependency) to auto-commit text files when changes are detected — triggered by VaultEventBus file events with a long debounce, not a polling timer. Layer 2 uses better-sqlite3's `.backup()` for periodic full DB snapshots stored locally. Both layers are opt-in, bounded in storage growth, and follow the existing EmbeddingService pattern for lifecycle and IPC.

**Tech Stack:** isomorphic-git, better-sqlite3 `.backup()`, Electron IPC, Zustand (settings UI)

---

## Layer 1: Git Versioning (Text Files)

### What Gets Tracked

**Committed to git:**

- `notes/**/*.md` — user-created note content
- `.kg/agent/**/*.md` — agent memory and definition files
- `.kg/artifacts/**` — text-based artifacts (JSX, HTML, SVG, Mermaid, Markdown)
- `.kg/config.json` — vault identity (name, id, schema version)
- `.kg/mcp.json` — MCP server configuration
- `.kg/agent-config.json` — agent sandbox configuration

**Ignored (auto-generated `.gitignore`):**

```
.kg/graph.db
.kg/graph.db-wal
.kg/graph.db-shm
.kg/embeddings/
.kg/secrets.json
.kg/backups/
```

**File size gate:** Files >2MB are skipped during `git add` to prevent binary bloat. This implicitly excludes large binary artifacts (images, PDFs) while allowing text artifacts (JSX, HTML, SVG, Mermaid, Markdown) through.

### Auto-Commit Cycle (Event-Driven, Debounced)

No polling timer. Commits are triggered by file-change events from the existing VaultEventBus / file watcher:

- File change event arrives → start (or reset) a debounce timer of `gitDebounceMinutes` (default: 30)
- Debounce expires after 30 quiet minutes → run `commitIfDirty()`
- **Max-wait guard:** if changes keep arriving so the debounce never expires, force a commit after `gitMaxWaitHours` (default: 6) from the first uncommitted change. This caps the worst-case window of unversioned edits.
- `commitIfDirty()` runs `statusMatrix` scoped to tracked directories (`notes/`, `.kg/agent/`, `.kg/artifacts/`, `.kg/*.json`) — NOT the full vault root. If nothing actually changed, it is a no-op; empty commits are never created.
- If changes found: `add` changed files, `commit` with message `"Auto-save: YYYY-MM-DD HH:mm"`
- A commit is also attempted on vault close, so a session's edits are never left dangling until the next launch
- All operations are fire-and-forget — failures are logged, never block the user

Rationale for the long debounce: this layer is backup history, not undo history. A 3–4 hour work session should produce a small handful of commits, not dozens. The note files themselves are always current on disk, and the DB snapshot layer independently covers recovery.

### History Cap

Git history is a rolling window, not unbounded:

- On vault open, check if oldest reachable commit exceeds `gitHistoryMaxDays` (default: 90)
- When triggered: create an orphan commit with current state, replace the branch — squashes all history older than the cap into a single root commit
- Run `git gc` on vault open for general object cleanup
- Since the repo is local-only (no remotes), truncation has no downstream consequences

### isomorphic-git

Pure JavaScript git implementation. No native dependency, no requirement for system git. Works directly with Node.js `fs` in the Electron main process.

Caveats:
- Slower than native git for large packfiles (not an issue for text-only vaults)
- Cache object can leak memory in long-running processes — periodically discard via `git.cache` API
- Stage files by directory rather than individually for performance

## Layer 2: DB Snapshots

### Mechanism

Uses `better-sqlite3`'s `.backup(destination)` method, which calls SQLite's online backup API. Produces a consistent, self-contained copy of the database even while the app is actively reading/writing. Takes <1 second for databases under 50MB.

### Storage

Snapshots stored in `.kg/backups/`:

```
.kg/backups/
  graph-2026-06-10-143022.db
  graph-2026-06-09-090000.db
  graph-2026-06-08-090000.db
  ...
```

### Schedule

- Daily timer (default: every 24 hours)
- Additional snapshot on vault close (final state preservation)
- Configurable interval via `dbSnapshotIntervalHours`

### Retention

- Keep last N snapshots (default: 7)
- After each new snapshot, sort existing by date, delete excess
- Configurable via `dbSnapshotKeepCount`

## Configuration

### Config Shape

Stored in app-level storage under key `backupConfig` (same storage as `embeddingConfig`, `llmConfig`):

```typescript
interface BackupConfig {
  gitEnabled: boolean;              // default: false
  dbSnapshotEnabled: boolean;       // default: false
  gitDebounceMinutes: number;       // default: 30 — quiet period before committing
  gitMaxWaitHours: number;          // default: 6 — force commit if edits never pause
  dbSnapshotIntervalHours: number;  // default: 24
  dbSnapshotKeepCount: number;      // default: 7
  gitHistoryMaxDays: number;        // default: 90
}
```

### Default State

Both layers disabled. User explicitly opts in via Settings UI toggle. Enabling one layer does not enable the other — they are independent.

## File Structure

### New Files

```
electron/backup/
  backup-service.ts       — Orchestrates both layers, owns timers, lifecycle
  git-versioning.ts       — isomorphic-git wrapper (init, add, commit, gc, truncate)
  db-snapshot.ts           — .backup() wrapper (snapshot, prune, list)
  ipc-handlers.ts          — IPC registration

src/platform/types.ts      — Add PlatformBackup interface
src/platform/electron/backup.ts   — ElectronBackup (IPC calls)
src/platform/chrome/backup.ts     — ChromeBackup stub ({ available: false })

src/ui/components/settings/BackupSettings.tsx  — Settings UI section
```

### Modified Files

```
electron/main.ts           — Create BackupService after vault open (follows EmbeddingService pattern)
src/platform/electron/index.ts  — Export backup instance
src/platform/chrome/index.ts    — Export backup stub
src/ui/components/settings/SettingsModal.tsx  — Add Backup section to General tab
package.json               — Add isomorphic-git dependency
```

## Component Design

### BackupService (`electron/backup/backup-service.ts`)

Single entry point. Created after vault open, destroyed on vault close.

- `initialize(config, vaultPath, db)` — read config, set up both layers if enabled
- `configure(newConfig)` — subscribe/unsubscribe event listeners and start/stop the snapshot timer based on enabled state changes
- `getStatus()` — returns `{ gitEnabled, dbSnapshotEnabled, lastGitCommit, lastSnapshot, snapshotCount }`
- `shutdown()` — commit pending git changes and take final DB snapshot if enabled, clear debounce/max-wait timers, unsubscribe from VaultEventBus

Owns the debounce state for the git layer: on each VaultEventBus file event under a tracked path, it resets the debounce timer (`gitDebounceMinutes`) and records the first-change timestamp for the max-wait guard (`gitMaxWaitHours`).

Lifecycle mirrors EmbeddingService: lazy creation after first DB init, destruction on vault switch.

### GitVersioning (`electron/backup/git-versioning.ts`)

Thin wrapper around isomorphic-git:

- `init(vaultPath)` — `git.init()` if no `.git/` exists, write `.gitignore`
- `commitIfDirty(vaultPath)` — `statusMatrix` scoped to tracked dirs → `add` → `commit`
- `truncateHistory(vaultPath, maxAgeDays)` — check oldest commit age, orphan-commit if exceeded
- `gc(vaultPath)` — loose object cleanup

Author for all commits: `Synapse Backup <backup@synapse.local>`

### DbSnapshot (`electron/backup/db-snapshot.ts`)

Stateless utility functions:

- `snapshot(db, backupDir)` — `db.backup(path)` with timestamped filename
- `prune(backupDir, keepCount)` — sort by date, `fs.unlinkSync` excess
- `list(backupDir)` — returns `Array<{ path, date, sizeBytes }>`

### IPC Handlers (`electron/backup/ipc-handlers.ts`)

Following the embedding IPC pattern:

- `backup:get-status` → `service.getStatus()`
- `backup:configure` → `service.configure(config)`
- `backup:trigger-now` → manual trigger (both layers)

### Platform Interface

```typescript
interface PlatformBackup {
  getStatus(): Promise<BackupStatus>;
  configure(config: Partial<BackupConfig>): Promise<void>;
  triggerNow(): Promise<void>;
}
```

Chrome stub: all methods return `{ available: false }` or no-op.

### Settings UI (`BackupSettings.tsx`)

New section in the General tab of SettingsModal, positioned after the Embeddings section. Two toggle switches:

- "Version history for notes" (gitEnabled) — with subtitle "Auto-commits notes, agent files, and configs after edits settle (~30 min)"
- "Database snapshots" (dbSnapshotEnabled) — with subtitle "Daily backup of graph database to .kg/backups/"

No advanced options in MVP. Defaults are sensible and don't need user tuning.

## Data Flow

### Initialization (Vault Open)

```
Vault opens
  → main.ts loads backupConfig from app storage
  → if either layer enabled:
      create BackupService(db, vaultPath, config)
  → if gitEnabled:
      GitVersioning.init() (idempotent)
      GitVersioning.gc()
      GitVersioning.truncateHistory() if oldest commit > maxDays
      commitIfDirty()  — catch up on offline edits made while app was closed
      subscribe to VaultEventBus file events (debounce 30 min, max-wait 6 h)
  → if dbSnapshotEnabled:
      ensure .kg/backups/ exists
      start snapshot timer (setInterval)
```

### Config Change (User Toggles in Settings)

```
UI toggle
  → storage.set({ backupConfig: newConfig })
  → IPC backup:configure
  → BackupService.configure(newConfig)
  → if git newly enabled: init repo, catch-up commit, subscribe to events
  → if snapshots newly enabled: ensure dir, start snapshot timer
  → if layer disabled: unsubscribe/stop timer, leave existing history/snapshots intact
```

### Vault Close / App Quit

```
vault-close event
  → if gitEnabled: commitIfDirty() — flush any pending debounced changes
  → if dbSnapshotEnabled: take final snapshot
  → clear timers, unsubscribe from VaultEventBus
  → destroy service
```

## Edge Cases

**Large existing vault (first enable):** Initial commit with hundreds of notes is done synchronously. Still fast for text-only content. Progress logged to console.

**Concurrent access:** Single Electron process per vault (existing constraint). No lock contention.

**Disk full:** `.backup()` and `git commit` throw on disk full. Caught and logged, no user disruption. The next trigger (file event or snapshot timer) retries naturally.

**Offline edits:** If the user edits notes while the app is closed, no file events fire. The catch-up `commitIfDirty()` on vault open picks these up.

**Vault switch:** BackupService destroyed on close (with final snapshot), recreated on next vault open. Config is app-level, repos and snapshots are per-vault.

**No restore UI in MVP:** DB restore: user copies snapshot from `.kg/backups/` to `.kg/graph.db` while app is closed. File restore: user runs `git log`/`git checkout` in terminal from vault directory. Future work adds in-app history browsing and restore.

## Out of Scope (Future Work)

- Restore UI (version history panel, per-file rollback, snapshot picker)
- Remote sync (push git to GitHub/remote, cloud snapshot storage)
- Selective restore (restore single table from DB snapshot)
- Conflict resolution (not needed — single-writer, local-only)
- Backup encryption
