# Cross-Device Sync Research

**Date:** 2026-05-16
**Status:** Research / Exploration
**Goal:** Free cross-device sync for Synapse vaults using common services (Google Drive, git, etc.)

## Problem

Synapse vaults contain two categories of data that need syncing:

1. **Files** — markdown notes (`notes/`), user resources, agent memory files
2. **Structured data** — SQLite graph database (`.kg/graph.db`) with nodes, edges, spatial positions, embeddings

Files are trivial to sync via any cloud folder service. SQLite databases **cannot be synced via cloud file sync** — partial writes, WAL journal races, and lack of file locking cause corruption when two devices access the DB through a synced folder.

## Recommended Approach: Append-Only Operation Log

Each device maintains its own local SQLite database (fast, offline-capable). Mutations are recorded as an append-only log of operations stored as files. File sync services transport the logs. Each device replays remote logs into its local DB.

### Architecture

```
Device A                          Cloud Storage                    Device B
┌──────────────┐                 (Google Drive /                  ┌──────────────┐
│ Local SQLite │                  Dropbox / git)                  │ Local SQLite │
│ (graph.db)   │                                                  │ (graph.db)   │
├──────────────┤    push logs    ┌──────────────┐   pull logs     ├──────────────┤
│ action-      │ ──────────────► │ .kg/sync/    │ ──────────────► │ action-      │
│ handler.ts   │                 │  deviceA.log │                 │ handler.ts   │
│ (intercept)  │ ◄────────────── │  deviceB.log │ ◄────────────── │ (intercept)  │
└──────────────┘    pull logs    │  cursor.json │   push logs     └──────────────┘
                                 └──────────────┘
```

### Log Format

NDJSON (one JSON object per line). Each device writes to its own file, avoiding write conflicts entirely.

```
.kg/sync/
├── {deviceA-id}.ndjson      ← Device A's mutations
├── {deviceB-id}.ndjson      ← Device B's mutations
├── cursors.json             ← Per-device read positions
└── snapshots/
    └── 2026-05-16.ndjson    ← Periodic full-state snapshot
```

Each log entry:

```json
{"clock": 42, "ts": 1747382400000, "op": "nodes.create", "data": {"id": "abc", "name": "Machine Learning", "type": "entity"}}
{"clock": 43, "ts": 1747382401000, "op": "nodes.update", "data": {"id": "abc", "properties": {"summary": "..."}}}
{"clock": 44, "ts": 1747382402000, "op": "edges.create", "data": {"id": "e1", "sourceId": "abc", "targetId": "def", "label": "relates_to"}}
```

### Ordering: Lamport Clocks

Wall clocks drift across devices. A Lamport counter provides causal ordering:

- Increment on every local operation
- On receiving remote ops, set local clock to `max(local, remote) + 1`
- Ties broken by device ID (deterministic total order)

### Conflict Resolution

For a single-user-multi-device scenario, conflicts are rare (user is on one device at a time). Strategy:

| Conflict Type | Resolution |
|---|---|
| Same node updated on two devices | Last-write-wins by Lamport clock |
| Node deleted on A, updated on B | Delete wins (tombstone) |
| Same edge created on both devices | Deduplicate by source+target+label |
| Create on both with same name | Keep both, flag for user review |

### Sync Triggers

Three layers, from most responsive to most reliable:

1. **On app open** — scan `.kg/sync/` for logs modified since last cursor (catches offline changes)
2. **File watcher** — if vault is in a Google Drive-synced folder, the desktop client pulls remote files to local disk; existing `FileWatcher` detects new `.ndjson` files appearing
3. **Periodic poll** — fallback timer every 2-5 minutes, check `mtime` on sync directory

### Compaction

Logs grow unbounded. Periodic compaction:

1. Write a full-state snapshot (`snapshots/{date}.ndjson`) — one line per row across all tables
2. All devices acknowledge the snapshot (update `cursors.json`)
3. Truncate logs prior to the snapshot
4. New devices bootstrap from latest snapshot + subsequent logs

### Interception Point in Synapse

`action-handler.ts` funnels all 96 DB operations through a single dispatch switch. The log append happens here — after successful SQLite write, before returning to caller. Minimal invasion to existing code.

```
db.request("nodes.create", data)
  → action-handler dispatch
    → SQLite write (existing)
    → append to sync log (new)
    → broadcast sync event (existing)
```

### Transport Options

The log-file approach is transport-agnostic. Any of these work:

| Transport | Cost | Setup | Real-time? |
|---|---|---|---|
| Google Drive (folder sync) | Free (15 GB) | Drop vault in Drive folder | Near-real-time via desktop app |
| Dropbox | Free (2 GB) | Drop vault in Dropbox folder | Near-real-time |
| iCloud Drive | Free (5 GB) | macOS only, flaky on Windows | Near-real-time |
| Git (GitHub/GitLab) | Free (private repos) | Auto-commit + push on interval | Minutes (commit interval) |
| Syncthing (P2P) | Free, no cloud | Install on both devices | Real-time when both online |
| Google Drive API | Free (15 GB) | OAuth setup in app | Polling (no push for desktop apps) |

## Comparison: Sync Approaches Considered

### 1. Raw SQLite File Sync (Google Drive / Dropbox)

Drop `graph.db` in a synced folder.

| Aspect | Assessment |
|---|---|
| Complexity | None |
| Conflict handling | Cloud service picks a version or creates duplicates |
| SQLite safety | **Will corrupt with concurrent access** |
| Offline support | Single-writer only |
| Verdict | **Not viable** unless enforcing single-device-at-a-time with lock files |

Used by: MoneyManagerEx (with known corruption issues)

### 2. Google Sheets as Database

Serialize graph data into spreadsheet rows. Use Sheets API for reads/writes.

| Aspect | Assessment |
|---|---|
| Complexity | Medium (API integration, OAuth, schema mapping) |
| Conflict handling | Cell-level last-write-wins (Google handles it) |
| Rate limits | 60 req/min reads, 60 req/min writes |
| Latency | 100-500ms per API call |
| Offline support | Limited (Sheets offline mode is unreliable) |
| Verdict | **Creative but impractical** — rate limits and latency make it unsuitable as a sync layer. No production system uses this pattern. |

### 3. Append-Only Operation Log (Recommended)

Event sourcing with file-based transport. Described in detail above.

| Aspect | Assessment |
|---|---|
| Complexity | Medium (log format, replay, compaction, conflict resolution) |
| Conflict handling | Lamport clocks + LWW, deterministic |
| Transport | Any file sync service (free) |
| Offline support | Full — each device is independent, syncs when connected |
| Proven by | Actual Budget, LiveStore, Linear (variants) |
| Verdict | **Best balance of simplicity, cost, and reliability** |

### 4. cr-sqlite (CRDT SQLite Extension)

Loadable SQLite extension that adds CRDT columns. Extract changesets via `crsql_changes` virtual table.

| Aspect | Assessment |
|---|---|
| Complexity | Low (extension does the heavy lifting) |
| Conflict handling | Automatic CRDT merge (column-level LWW) |
| Transport | BYO — same file-based options as oplog |
| Maturity | Experimental, indie-maintained |
| Compatibility | Requires custom SQLite build; may conflict with better-sqlite3 |
| Verdict | **Most elegant if it works with better-sqlite3**. Worth prototyping. Risk: dependency on a single maintainer. |

Repo: [github.com/vlcn-io/cr-sqlite](https://github.com/vlcn-io/cr-sqlite)

### 5. Git-Based Sync

Auto-commit vault changes and push to a remote repo on an interval.

| Aspect | Assessment |
|---|---|
| Complexity | Low (git is well-understood) |
| Conflict handling | Git merge (works for text files, useless for binary DB) |
| Transport | GitHub / GitLab (free private repos) |
| Offline support | Full |
| Limitation | Cannot merge SQLite binary files — only useful for the file layer |
| Verdict | **Good complement** for notes/files, not sufficient alone |

Used by: Obsidian Git (50k+ users), Logseq community

### 6. Full Sync Frameworks (PowerSync, ElectricSQL, Zero)

Purpose-built sync engines with server components.

| Aspect | Assessment |
|---|---|
| Complexity | Low (managed service) |
| Conflict handling | Framework-provided (CRDTs or server-authoritative) |
| Cost | Free tiers exist but limited; scales to paid |
| Independence | Vendor lock-in to their sync protocol and server |
| Verdict | **Overkill for personal multi-device sync**. Better suited for collaborative multi-user apps. |

## Reference: Production Systems Using Similar Patterns

### Append-Only Log / Event Sourcing

| System | Sync Mechanism | Transport | Conflict Resolution |
|---|---|---|---|
| **Actual Budget** | Append-only log in budget file, hybrid logical clocks | Self-hosted Express server | Hand-rolled CRDT over SQLite |
| **LiveStore** (2024) | Event log as sync unit, git-style push/pull/rebase | Backend-agnostic | Client-side rebasing |
| **Linear** | Transaction queue synced via GraphQL mutations | WebSocket | LWW per-property, server-authoritative ordering |
| **Joplin** | Item-level sync with `sync_time` cursor | Dropbox / S3 / WebDAV / Nextcloud | `updatedTime` heuristic |

### CRDT-Based

| System | Sync Mechanism | Transport | Notes |
|---|---|---|---|
| **cr-sqlite** | `crsql_changes` virtual table, causal ordering | BYO | SQLite extension, experimental |
| **SQLite Sync** (sqlite.ai, 2025) | CRDT extension, block-level LWW for text | SQLite Cloud / Postgres / Supabase | Free tier: 3 devices |
| **ElectricSQL** | Active-active Postgres ↔ SQLite replication | Managed service | From the inventors of CRDTs |
| **Obsidian LiveSync** | CouchDB replication protocol | CouchDB / S3 / MinIO / WebRTC | E2E encrypted |

### File-Based

| System | Sync Mechanism | Transport | Notes |
|---|---|---|---|
| **Obsidian Git** | Auto-commit + push on interval | GitHub / GitLab | 50k+ users, text files only |
| **RxDB Google Drive** (beta) | One JSON file per document in Drive | Google Drive API | Custom conflict handlers |
| **Syncthing** | P2P folder sync, block-level dedup | Direct device-to-device | `.sync-conflict` files for conflicts |

## Survey Resources

- [Offline-First Landscape (2025)](https://marcoapp.io/blog/offline-first-landscape) — comprehensive framework comparison
- [awesome-local-first](https://github.com/alexanderop/awesome-local-first) — curated link list, actively maintained
- [Reverse-engineering Linear's sync engine (2025)](https://github.com/wzhudev/reverse-linear-sync-engine) — endorsed by Linear's CTO
- [LiveStore docs](https://livestore.dev/) — event-sourced local-first data layer
- [Actual Budget sync docs](https://actualbudget.org/docs/getting-started/sync/) — append-only log over SQLite

## Implementation Estimate

| Phase | Scope | Effort |
|---|---|---|
| 1. Log format + writer | Define NDJSON schema, intercept in action-handler, write to device log file | 2-3 days |
| 2. Log reader + replay | Read remote logs, apply to local SQLite, cursor tracking | 3-4 days |
| 3. Sync triggers | File watcher integration, on-open scan, periodic poll | 1-2 days |
| 4. Compaction | Snapshot generation, log truncation, bootstrap from snapshot | 2-3 days |
| 5. UI | Sync status indicator, manual sync button, conflict notifications | 2-3 days |
| 6. Testing | Multi-device simulation, conflict scenarios, corruption recovery | 3-4 days |
| **Total** | | **~2-3 weeks** |

## Open Questions

1. **Embedding sync** — `vec.db` is large and device-specific (model may differ). Regenerate on each device rather than syncing?
2. **Agent memory** — Already file-based (`.kg/agent/memory/`). Syncs naturally with file transport. Conflicts possible if agent writes on two devices.
3. **Note file sync** — Notes are already files. If using Google Drive folder sync, they sync automatically. But `note_search` FTS index needs rebuilding on the receiving device.
4. **Device identity** — Generate a stable UUID on first sync setup. Store in `.kg/sync/device.json` (not synced).
5. **Encryption** — Log files contain graph data in plaintext. E2E encryption before writing to sync folder? Adds complexity but important if using cloud storage.
