# ADR: OPFS Note Storage + Dedicated FTS5 Index

**Status:** Accepted  
**Date:** 2026-04-11  
**Context:** Notes are stored redundantly in SQLite (`nodes.properties` and `source_content`), with poor FTS quality and unnecessary DB round-trips for reads. The native host roadmap requires notes to be file-shaped artifacts.  
**Supersedes:** The implicit convention that all content lives in SQLite as the single source of truth. That principle remains true for entities and resources; notes are the exception, with files as the canonical store and SQLite retaining metadata + search index only.

> **Platform note:** This ADR was written for the Chrome extension, where note files are stored in OPFS (Origin Private File System). In the Electron desktop app — now the primary platform — notes are stored as real `.md` files on the local filesystem via `electron/notes-backend.ts`. The same principle holds: note content lives in files, metadata + FTS index in SQLite. The Chrome extension is now deprecated (maintenance mode only).

---

## Decision Summary

Store note content as `.md` files in OPFS (`notes/{node_id}.md`). Remove content from `nodes.properties` and stop writing to `source_content` for notes. Add a dedicated `note_search` table + `notes_fts` FTS5 index for full-text search on note prose. The UI thread reads/writes OPFS directly (async API), bypassing the SharedWorker/DedicatedWorker chain.

---

## Architecture

```
┌─ Chrome Extension ──────────────────────────────────────────────────┐
│                                                                     │
│  UI Thread (Side Panel / Tab)                                       │
│  ├── NoteEditor ─── read/write ──→ OPFS notes/{nodeId}.md          │
│  │                                  (async API, 0 hops)             │
│  ├── NotesPanel ─── preview ─────→ note_search.body[:60]            │
│  ├── HeaderSearch ── FTS5 ───────→ notes_fts MATCH query            │
│  └── RAG pipeline ── content ────→ OPFS notes/{nodeId}.md          │
│                                                                     │
│  DB Workers (existing, unchanged for note content)                  │
│  ├── SharedWorker ── routes ──→ DedicatedWorker                     │
│  └── DedicatedWorker                                                │
│       ├── wa-sqlite → OPFS kg_extension.db                          │
│       │    ├── nodes table (metadata only: id, name, type,          │
│       │    │    folder_path, x, y, properties:{wikiLinks})          │
│       │    ├── note_search table (node_id, title, plain text body)  │
│       │    └── notes_fts (external content FTS5 on note_search)     │
│       └── source_content (used for resources only, not notes)       │
│                                                                     │
│  OPFS Root/                                                         │
│  ├── kg_extension.db          ← wa-sqlite (existing, untouched)     │
│  ├── kg_extension.db-wal                                            │
│  ├── kg_extension.db-shm                                            │
│  └── notes/                   ← NEW: canonical note content         │
│       ├── {node_id_1}.md                                            │
│       ├── {node_id_2}.md                                            │
│       └── ...                                                       │
└─────────────────────────────────────────────────────────────────────┘
```

---

## Storage Authority Model

| Data Type | Authority | Location |
|-----------|-----------|----------|
| Entities | SQLite | `nodes` table |
| Resources | SQLite | `nodes` + `source_content` |
| **Notes (content)** | **OPFS file** | `notes/{node_id}.md` |
| **Notes (metadata)** | **SQLite** | `nodes` table (name, folder_path, wikiLinks) |
| **Notes (search index)** | **SQLite** | `note_search` + `notes_fts` |
| Edges | SQLite | `edges` table |
| Node types | SQLite | `node_types` table |

Notes are the only data type with a split authority model. The OPFS file is the single source of truth for content. SQLite is authoritative for metadata and the search index.

---

## Data Flows

### Write Path (Note Save)

```
NoteEditor.handleSave()
    │
    ├──1── OPFS write ─────→ notes/{nodeId}.md       [UI thread, direct]
    │       Full markdown: YAML frontmatter + title + body + links
    │
    ├──2── noteSearch.upsert ──→ note_search table    [UI → SW → DW → SQLite]
    │       Plain text body (markdown stripped) → triggers update notes_fts
    │
    ├──3── graphStore.updateNode ──→ nodes table      [UI → SW → DW → SQLite]
    │       properties: { wikiLinks } only — NO content
    │
    └──4── BroadcastChannel ──→ { type: 'note_content_updated', nodeId }
```

**Ordering invariant:** OPFS write (step 1) completes before DB writes (steps 2-3). An orphaned OPFS file is harmless; a DB reference to a missing file breaks search results.

### Read Path (Editor Open)

```
NoteEditor useEffect(nodeId)
    │
    ├── opfsNoteStore.read(nodeId) ──→ OPFS notes/{nodeId}.md  [UI thread, direct]
    │       Returns full markdown → parseMarkdown() → body content
    │
    └── graphStore.nodes.find(nodeId) ──→ Zustand state         [in-memory]
            Returns name, folderPath (already loaded via slim load)
```

Zero DB round-trips for note content. The 4-hop MessageChannel chain is bypassed entirely.

### Read Path (Search)

```
HeaderSearch / RAG pipeline
    │
    ├── noteSearch.search(query) ──→ notes_fts MATCH  [UI → SW → DW → SQLite]
    │       Returns { node_id, title, snippet(body, 200 chars) }
    │
    └── (on click/RAG) opfsNoteStore.read(nodeId)     [UI thread, direct]
            Full content loaded on demand
```

### Read Path (List Preview)

```
NotesPanel NoteTreeItem
    │
    └── noteSearch.getEntry(nodeId) ──→ note_search.body[:60]
            Lightweight single-row lookup by indexed node_id
            (Replaces broken node.properties.content which was empty after slim load)
```

---

## FTS5 Strategy

### Problem

wa-sqlite 1.0.0 ships SQLite 3.42.0. The ideal approach — a contentless FTS5 table with `contentless_delete=1` — requires SQLite 3.43.0+. Without `contentless_delete`, individual rows cannot be removed from a contentless table, making it unsuitable for mutable content.

### Chosen Approach: External Content FTS5

Use an **external content FTS5** table backed by `note_search`:

```sql
CREATE TABLE note_search (
    rowid INTEGER PRIMARY KEY AUTOINCREMENT,
    node_id TEXT UNIQUE NOT NULL,
    title TEXT NOT NULL,
    body TEXT NOT NULL        -- plain text, markdown stripped
);

CREATE VIRTUAL TABLE notes_fts USING fts5(
    title, body,
    content='note_search',   -- external content: reads from note_search
    content_rowid='rowid'
);

-- Triggers keep FTS in sync automatically on INSERT/DELETE/UPDATE
```

### Accepted Tradeoff: Content Duplication

Note body text exists in two places:

1. **OPFS file** — full markdown (canonical)
2. **`note_search.body`** — stripped plain text (for FTS backing)

This duplication is the minimum cost for reliable FTS5 with delete support on SQLite 3.42. The `note_search.body` is a derived, lossy copy (no markdown syntax, no frontmatter) — it cannot reconstruct the original note.

### Schema Placement

The `note_search` table is defined in `001-initial-schema.ts` (always exists). The `notes_fts` virtual table and auto-sync triggers are defined in `002-fts-index.ts` (gated behind FTS5 availability, same as `nodes_fts`). This means `note_search` can be queried via LIKE fallback even when FTS5 is unavailable.

### Migration Path (when wa-sqlite upgrades to SQLite 3.43+)

1. Create new `notes_fts` with `content='', contentless_delete=1`
2. Populate from OPFS files (read each, strip, insert)
3. Drop `note_search` table and all triggers
4. Manage FTS inserts/deletes directly in application code

This is a single migration. No other code changes needed — the `noteSearch.upsert`/`delete` functions wrap the difference.

### Why Not Pure Contentless FTS5 on 3.42

A contentless table without `contentless_delete=1` supports the `'delete'` command, but it requires supplying the **exact original column values**. If the values don't match what was indexed (e.g., `stripMarkdownToPlainText` logic changes between index time and delete time), the FTS index silently corrupts — phantom entries accumulate and `'rebuild'` is unavailable (no content source). The external content approach avoids this fragility entirely via trigger-based sync.

### Why Not the Existing `nodes_fts`

The existing `nodes_fts` indexes `name`, `type`, and `properties` columns from the `nodes` table. For notes, `properties` contains raw JSON (`{"content":"...","wikiLinks":[...]}`), so note prose gets tokenized with JSON syntax (`"`, `{`, `:`, key names). A dedicated `notes_fts` with properly stripped plain text produces dramatically better search results.

---

## OPFS Constraints and Pitfalls

### API Selection

| Context | API | Sync/Async | Notes |
|---------|-----|------------|-------|
| UI thread (side panel) | `getFile()`, `createWritable()` | Async | Used for note read/write |
| DedicatedWorker | `createSyncAccessHandle()` | Sync | Used by wa-sqlite only |
| SharedWorker | Async API only | Async | Not used for notes |
| Service Worker | Async API only | Async | Not used for notes |

The UI thread uses only async OPFS APIs. `createSyncAccessHandle()` is DedicatedWorker-only and already monopolized by wa-sqlite for database access.

### Coexistence with wa-sqlite

wa-sqlite's `OriginPrivateFileSystemVFS` stores files directly at the OPFS root (`kg_extension.db`, `-wal`, `-shm`). The `notes/` subdirectory is a separate path in the OPFS tree — completely independent, no lock contention, no interference.

### Crash Safety

`createWritable()` buffers writes until `close()` is called. If the browser crashes between `write()` and `close()`, the data is lost and the file retains its previous content. For notes, this means the most recent edit before a crash may be lost. Mitigations:

- The pre-crash content survives (the file is not corrupted, just stale)
- The `note_search` entry is only updated after OPFS write succeeds, so the search index stays consistent
- Future improvement: debounced auto-save to reduce the crash window

### Cross-Tab Consistency

OPFS has no file watching API (FileSystemObserver is not yet stable in Chrome). Cross-tab sync uses the existing `BroadcastChannel(SYNC_CHANNEL)` mechanism:

1. Tab A saves note → writes OPFS → updates DB → broadcasts `note_content_updated`
2. Tab B receives broadcast → re-reads OPFS file if the note is currently open
3. If Tab B has unsaved changes, shows a "modified externally" indicator

Last-write-wins at the OPFS level. No conflict resolution — same as the current SQLite behavior.

### Storage Limits

OPFS shares the same quota pool as IndexedDB and Cache API. The `unlimitedStorage` Chrome extension permission exempts from both quota restrictions and browser-initiated eviction. Third-party cleanup tools (CCleaner, BleachBit) can still delete OPFS data — same risk as the existing SQLite database.

### Directory Structure

Flat: `notes/{node_id}.md`. No nested folders in OPFS — the folder hierarchy is tracked in SQLite's `nodes.folder_path` column. This avoids OPFS directory management complexity and makes folder renames a single SQL UPDATE without touching any files.

---

## Decisions and Rationale

| Decision | Rationale |
|---|---|
| **OPFS files for note content** | Notes are file-shaped artifacts. OPFS files align with the native host roadmap (exposing notes to external tools). Eliminates dual-storage divergence between `nodes.properties` and `source_content`. |
| **UI thread reads OPFS directly** | Bypasses the 4-hop MessageChannel chain (UI → SharedWorker → DedicatedWorker → SQLite → back). Notes are small and reads are infrequent — async API latency is negligible. |
| **External content FTS5 over contentless** | SQLite 3.42 doesn't support `contentless_delete=1`. External content with triggers provides reliable delete/update without risk of index corruption. Accepted tradeoff: body text duplicated in `note_search`. |
| **`note_search` backing table** | Serves double duty: (1) FTS5 external content source, (2) lightweight preview provider for the notes list (replacing the broken `properties.content` read after slim load). |
| **Flat OPFS directory** | Folder hierarchy in SQLite only. Avoids OPFS directory rename/move operations. UUID-based filenames prevent collisions. |
| **Write ordering: OPFS first** | Orphaned OPFS files are harmless. Dangling DB references to missing files break search results. OPFS write is the first durable step. |
| **`source_content` unchanged for notes** | Old `note://` entries are harmless dead data. No cleanup migration needed. Resources continue using `source_content` as before. |
| **Content stripped for FTS** | `stripMarkdownToPlainText` removes frontmatter, headings, bold/italic, links, code blocks, wiki-link brackets. FTS tokenizes clean prose instead of markdown syntax or JSON artifacts. |

---

## What This Changes

| Concern | Before | After |
|---------|--------|-------|
| Note content authority | SQLite (`source_content` + `nodes.properties`) | OPFS file |
| Note read latency | 4-hop MessageChannel | Direct OPFS read on UI thread |
| Note search quality | `nodes_fts` on JSON-wrapped `properties` | Dedicated `notes_fts` on stripped prose |
| Note list preview | `node.properties.content` (broken after reload) | `note_search.body` (always available) |
| Content duplication | 2 copies in SQLite (properties + source_content) | OPFS file + `note_search.body` (plain text copy for FTS) |
| DB writes per save | 2 (nodes + source_content) | 1 (nodes metadata only) + 1 (note_search) |
| Native host readiness | Notes locked in SQLite | Notes are `.md` files in OPFS, ready for file exposure |

---

## Future Considerations

- **`contentless_delete=1` migration:** When wa-sqlite ships SQLite 3.43+, drop `note_search` table, switch to pure contentless FTS5. Eliminates the only remaining content duplication.
- **Native host file bridge:** The Go native host could expose OPFS note files on the real filesystem for external editor access (Obsidian, VS Code, Claude Code).
- **OPFS FileSystemObserver:** When Chrome ships the FileSystemObserver API (Intent to Ship posted, not yet stable), could replace BroadcastChannel for cross-tab sync.
- **Auto-save with crash recovery:** Debounced auto-save to OPFS on content change, reducing the crash window for `createWritable()` buffer loss.
- **Export folder sync:** The existing `writeMarkdownFile` to the user-selected export folder is preserved. Both OPFS and export folder receive the same markdown content — OPFS is authoritative, export folder is a one-way copy.
