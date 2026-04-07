# ADR: Native Messaging Host + Local File Export

**Status:** Accepted  
**Date:** 2026-04-04  
**Updated:** 2026-04-07  
**Context:** The extension needs to export .md files to a local folder and offer Claude Code subscription as an LLM backend.  
**Canonical architecture:** See [`docs/design-three-layer-knowledge-model.md`](design-three-layer-knowledge-model.md) for the unified storage architecture and authority rules. This ADR defines the native host component; the design doc defines how it fits into the system.

---

## Decision Summary

Introduce a Go native messaging host as a thin companion process for Claude Code LLM access. Use the File System Access API (`showDirectoryPicker`) for browser-side file export. Keep wa-sqlite (persisted via OPFS) as the sole database and single source of truth.

---

## Architecture

```
┌─ Chrome Extension (UI) ──────────────────────────────────┐
│                                                          │
│  FileSystemDirectoryHandle ──→ local export folder       │
│       ↑ write-only (export .md files)                    │
│  IDB (persisted directory handle across sessions)        │
│                                                          │
│  wa-sqlite → OPFS (kg_extension.db)                      │
│       ↑ graph DB: nodes, edges, types, chat, FTS, etc.   │
│       │ Single source of truth for all content           │
│                                                          │
│  Native Messaging Port                                   │
│       └── sends/receives: Claude Code chat streams       │
│                                                          │
└──────────────────────────────────────────────────────────┘
        ↕ chrome.runtime.connectNative() / stdio JSON
┌─ Go Native Host (~5MB binary) ──────────────────────────┐
│                                                          │
│  1. claude -p --resume <id> — LLM via subscription      │
│  2. kg-host install — writes Chrome NM manifest          │
│                                                          │
└──────────────────────────────────────────────────────────┘
```

---

## Storage Layers

See the design doc for the full storage architecture and authority model. Summary:

- **SQLite (wa-sqlite on OPFS):** Single source of truth for all graph structure and content. Entity, note, and resource content is DB-authoritative.
- **IDB:** Persists the `FileSystemDirectoryHandle` across sessions.
- **Local filesystem:** Export-only .md files written via FSFH. One-direction (DB → files), never read back. The extension never reads external edits.

---

## Component Responsibilities

### File System Access API (browser-side)

**Purpose:** Write-only export of .md files to a user-selected folder.

- `showDirectoryPicker({ mode: 'readwrite' })` grants access to the export folder.
- `FileSystemDirectoryHandle` stored in IndexedDB for cross-session persistence.
- On new session: single `requestPermission()` call re-grants access (one prompt, one click).
- The extension writes .md files on extraction merge and on manual "Re-export all".
- The extension never reads files back from the export folder.

```typescript
// One-time setup
const dirHandle = await window.showDirectoryPicker({ mode: 'readwrite' });
await idb.put('handles', dirHandle, 'notes-dir');

// Export a note (create directories on-the-fly)
const subDir = await dirHandle.getDirectoryHandle('notes', { create: true });
const fileHandle = await subDir.getFileHandle('note.md', { create: true });
const writable = await fileHandle.createWritable();
await writable.write(content);
await writable.close();

// Session reconnect (one prompt for entire folder)
const stored = await idb.get('handles', 'notes-dir');
await stored.requestPermission({ mode: 'readwrite' }); // requires user gesture
```

### IndexedDB

**Purpose:** Persist the `FileSystemDirectoryHandle` across sessions. No other role.

### Native Messaging Host (Go binary)

**Purpose:** Claude Code bridge. Never touches files or the database.

**Role 1 — Claude Code bridge:**
- Spawns `claude -p --resume <session-id>` per message.
- Streams JSON output back to extension over native messaging.
- `--resume` preserves conversation context across messages (Claude Code persists conversations to `~/.claude/`).
- Uses the user's Claude subscription — no API key, no per-token billing.
- ~150ms overhead per message for process spawn + conversation reload from disk. Negligible vs multi-second LLM response time.

**Role 2 — Self-installer:**
- `kg-host install` writes the Chrome native messaging manifest to the platform-specific location.
- macOS: `~/Library/Application Support/Google/Chrome/NativeMessagingHosts/com.kg_extension.host.json`
- Linux: `~/.config/google-chrome/NativeMessagingHosts/com.kg_extension.host.json`
- Windows: Registry key pointing to manifest JSON.

### wa-sqlite / OPFS

**Purpose:** Knowledge graph database. Single source of truth for all graph structure and content.

- Schema changes are defined in the design doc (expanded ontology, versioned `source_content`, note `folder_path`, etc.)
- The DB stores all content — entities, notes, resources, source content
- .md files in the export folder are rendered views, never read back

---

## Native Messaging Protocol

### Extension → Host

```jsonc
// Start a new Claude Code chat session
{ "action": "chat", "session": "tab-1", "prompt": "Summarize this note: ..." }

// Continue an existing session (host tracks claude --resume IDs)
{ "action": "chat", "session": "tab-1", "prompt": "What about the relationships?" }
```

### Host → Extension

```jsonc
// Claude Code streaming response
{ "type": "llm_chunk", "session": "tab-1", "text": "The note discusses..." }
{ "type": "llm_done", "session": "tab-1" }
{ "type": "llm_error", "session": "tab-1", "error": "rate_limited", "retryAfter": 60 }

// Host status
{ "type": "ready", "version": "0.1.0" }
```

---

## Host Structure (Go)

```
kg-host/
  main.go           ← native messaging protocol (stdin/stdout JSON, length-prefixed)
  claude.go         ← spawn claude -p --resume, stream stdout
  sessions.go       ← map session keys to claude conversation IDs
  install.go        ← write Chrome native messaging manifest
  go.mod
```

Dependencies: stdlib only.

---

## User Flows

The extension has two states (see design doc): `graph-only` (no folder) and `export-connected` (folder selected for one-way .md export). The host is an **independent optional add-on** for Claude Code LLM access — it does not affect file export.

### First-time setup (without host)

```
1. Install extension from Chrome Web Store
2. Extension works immediately in graph-only mode (extraction, search, visualization)
3. User optionally connects an export folder:
   - Button: "Connect folder" → showDirectoryPicker() → handle saved to IDB
   - Extension exports .md files from DB state → writes to folder
   - State: export-connected. New extractions auto-export.
```

### First-time setup (with host)

```
1. Same as above, plus:
2. User installs host:
   - Download from GitHub Releases (or brew install kg-host)
   - Run: kg-host install
3. Extension detects host → Claude Code available as LLM backend
4. Settings: choose "Claude Code" (subscription) vs "API key" (pay-per-token)
```

### Every subsequent session

```
1. Extension opens (sidepanel or tab)
2. Loads directory handle from IDB
3. Shows "Reconnect export folder" button
4. User clicks → one permission prompt for entire folder → granted
5. If native host available: auto-connects → Claude Code ready
```

### Claude Code chat (subscription)

```
1. User sends message in extension chat
2. Extension sends: { "action": "chat", "session": "tab-1", "prompt": "..." }
3. Host spawns: claude -p --resume <id> "..." --output-format stream-json
4. Host streams chunks back: { "type": "llm_chunk", ... }
5. Extension renders streaming response
6. Conversation context preserved for follow-up messages via --resume
```

---

## Failure Modes

| Scenario | Impact | Recovery |
|---|---|---|
| Host not installed | No Claude Code. Extension works fully with API keys. File export works via FSFH (host not involved). | Extension suggests host install for subscription LLM. |
| Host crashes | Claude Code stops. File export unaffected (browser-side). | Auto-reconnect after 3s. |
| Host crashes mid-Claude stream | Partial response shown. | Extension detects disconnect, shows retry option. |
| Permission denied on session start | Export folder inaccessible until user clicks reconnect. Graph-only mode works. | "Reconnect export folder" button always available. |
| User moves/renames export folder | FileSystemDirectoryHandle becomes invalid. | Extension detects invalid handle, prompts re-setup. |
| Claude Code not installed | Host can't spawn `claude` CLI. | Host sends error; extension falls back to API key path. |
| Claude Code rate limited | LLM requests fail temporarily. | Host forwards rate limit info; extension shows wait message or falls back to API key. |

---

## Decisions and Rationale

| Decision | Rationale |
|---|---|
| **Go for the native host** | Single static binary ~5MB, no runtime dependency. Host logic is simple (process spawn), Go stdlib covers it. |
| **`claude -p --resume` over SDK** | SDK (`@anthropic-ai/claude-code`) is Node.js-only. Would require Bun compile (~60MB binary). `--resume` reload overhead (~150ms) is negligible vs LLM response time. Can swap to Bun+SDK later if needed. |
| **Not direct API with Claude Code OAuth token** | Unknown billing behavior — risk of API-rate charges instead of subscription. Only CLI and SDK guarantee subscription routing. |
| **FileSystemFileHandle for file export, not the host** | Browser-side file access preserves standalone functionality. Host never touches files — stays stateless and simple. |
| **`showDirectoryPicker` over per-file pickers** | One permission prompt per session for entire folder vs per-file prompts. Users designate one export folder. |
| **IDB only for handle persistence** | Minimal IDB surface — stores one directory handle. No other browser storage needed for file access. |
| **Keep wa-sqlite/OPFS for graph DB** | Graph is derived app data, fast in-browser access needed for rendering and search. OPFS is just the persistence filesystem for the `.db` file. |
| **Host is optional** | Extension works fully without the host. Host adds Claude Code subscription LLM. File export is browser-side via FSFH. |
| **DB is single source of truth** | All content (entities, notes, resources) is DB-authoritative. .md files are rendered exports, never read back. No bidirectional sync. |
| **No file watching (fsnotify removed)** | Export-only model means no external edits to detect. Eliminates the host's file-watching role, simplifying it to a pure Claude Code bridge. |

---

## Future Considerations

- **Bun compile + SDK**: If `--resume` overhead becomes noticeable or Claude Code adds a daemon/server mode, swap to Bun-compiled host with SDK for true in-memory sessions. Native messaging protocol stays identical.
- **Directory handle persistent permissions**: Chrome may grant longer-lived permissions for extensions. Would eliminate the per-session reconnect prompt.
- **Host as SQLite bridge**: If cross-app access to the graph DB is ever needed, the host could also serve the SQLite file on the real filesystem. Not planned currently.
- **Bidirectional sync (deferred)**: If user demand emerges for editing .md files in Obsidian and syncing back, the host could re-add fsnotify file watching. The export-only model is a deliberate scope reduction, not a permanent constraint.
