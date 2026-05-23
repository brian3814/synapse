# Electron Desktop Migration Design

## Context

The Chrome extension knowledge graph app is hitting platform limitations that block features users need: service worker lifecycle kills long-running agent loops, OPFS is awkward for note interoperability, and there's no path to native integrations (local LLMs, OS-level keyboard shortcuts, desktop file access). The competitive landscape shows a clear gap — no tool combines LLM-powered entity extraction from web browsing with human-in-the-loop review in a local-first desktop app.

This design migrates the product to an Electron desktop app while keeping the Chrome extension running from the same codebase via a platform abstraction layer. A separate companion extension bridges the browser to the desktop app for page capture and agent tool dispatch.

## Decisions

| Decision | Choice | Rationale |
|---|---|---|
| Framework | Electron | 100% TypeScript stack compatibility, mature ecosystem, better-sqlite3 support |
| Migration strategy | Incremental (wrap existing app, evolve) | Lower risk, no user disruption, ship extension updates during migration |
| Code sharing | Platform abstraction layer | Same React UI in both modes, only platform backend differs |
| Storage | Hybrid: SQLite (graph) + .md files (notes) | Fast graph queries + interoperable notes editable in any editor |
| SQLite engine | better-sqlite3 in main process | Native FTS5, synchronous API, ~100x faster than wa-sqlite/OPFS |
| Extension companion IPC | HTTP/SSE for data, native messaging for port bootstrap | Robust port discovery via OS-level native messaging, efficient HTTP for data transfer |
| Local LLM | Future roadmap (not v1) | Cloud LLMs sufficient for launch; LLM provider abstraction already exists |

## Architecture

### Execution Contexts

Chrome extension has 6 contexts. Electron collapses to 2 + 1 companion:

| Chrome Extension | Electron | Notes |
|---|---|---|
| Service Worker | **Main Process** | Persistent, Node.js, full OS access |
| Side Panel / Tab UI | **Renderer Process** | Same React app, sandboxed via contextBridge |
| Offscreen Document | Eliminated | Main process has `fetch`, handles LLM calls directly |
| Content Script | Moves to companion extension | Agent tools execute in browser, results sent via HTTP |
| DB SharedWorker | Eliminated | better-sqlite3 is synchronous in main process |
| DB DedicatedWorker | Eliminated | No wa-sqlite/OPFS chain needed |

### Three Artifacts

1. **Desktop App** (Electron) — full product with `platform/electron/` backend
2. **Chrome Extension** (existing) — same full product with `platform/chrome/` backend, maintained during transition
3. **Companion Extension** (new, minimal) — browser bridge for page capture + agent tool dispatch to desktop app

### Platform Abstraction Layer

```
src/platform/
  types.ts              # PlatformStorage, PlatformDB, PlatformMessaging, PlatformNotes, PlatformBrowser
  index.ts              # detectPlatform() + lazy init
  chrome/
    chrome-platform.ts  # Aggregates Chrome implementations
    chrome-storage.ts   # chrome.storage.local
    chrome-db.ts        # wa-sqlite via SharedWorker/DedicatedWorker
    chrome-messaging.ts # chrome.runtime.sendMessage
    chrome-notes.ts     # OPFS async API
  electron/
    electron-platform.ts  # Aggregates Electron implementations
    electron-storage.ts   # safeStorage + JSON config file
    electron-db.ts        # better-sqlite3 via IPC
    electron-messaging.ts # ipcRenderer.invoke
    electron-notes.ts     # fs + chokidar for vault directory
```

**Key interfaces:**

- **`PlatformStorage`** — get/set/remove/onChange for settings and API keys
- **`PlatformDB`** — query/execute/transaction (async, regardless of engine)
- **`PlatformMessaging`** — sendToBackground/onMessage for cross-context communication
- **`PlatformNotes`** — read/write/remove/list/watch markdown files
- **`PlatformBrowser`** — openTab/getCurrentTab/executeInTab

Detection: `index.ts` checks `window.electronAPI` (preload-exposed) vs `chrome.runtime`.

### Electron Main Process

Responsibilities:
- SQLite database (better-sqlite3, WAL mode, synchronous)
- LLM API calls (direct `fetch`, streaming via IPC events)
- Agent execution loop (no timeout — runs as long as needed)
- API key storage (safeStorage → OS keychain)
- Note vault management (fs + chokidar on user-configurable directory)
- HTTP server for companion extension (127.0.0.1, ephemeral port)
- Native messaging host for port bootstrap
- Auto-updater (electron-updater)

**IPC channels** (typed, replacing `chrome.runtime.sendMessage`):
- `db:query`, `db:execute`, `db:transaction`
- `llm:request`, `llm:stream`
- `agent:start`, `agent:progress`, `agent:complete`
- `notes:read`, `notes:write`, `notes:remove`, `notes:list`
- `storage:get`, `storage:set`
- `companion:status`, `companion:dispatch`

### Companion Extension Communication

```
Companion Extension                          Desktop App
+--------------+    HTTP/SSE      +----------------------+
| Service      |<---------------->| HTTP Server          |
| Worker       |                  | (main process)       |
|              |    Nat. Msg.     |                      |
| Content      |<-----(port)----->| Native Msg Host      |
| Script       |                  |                      |
+--------------+                  +----------------------+
```

**Port discovery (native messaging bootstrap):**
1. Desktop registers native messaging host on install (writes JSON manifest to OS-specific path)
2. Extension calls `chrome.runtime.sendNativeMessage("com.kg_desktop", {type: "get_port"})`
3. Native host script reads desktop's config, responds with `{port: 52341}`
4. Extension caches port in `chrome.storage.local`, uses HTTP/SSE for all data transfer

**Native messaging host registration paths:**
- macOS: `~/Library/Application Support/Google/Chrome/NativeMessagingHosts/com.kg_desktop.json`
- Windows: Registry `HKEY_CURRENT_USER\Software\Google\Chrome\NativeMessagingHosts` + JSON file
- Linux: `~/.config/google-chrome/NativeMessagingHosts/com.kg_desktop.json`

**Agent tool dispatch flow:**
1. Desktop starts agent run, LLM returns tool call (e.g., `get_page_content`)
2. Main process sends `{type: "tool_call", tool: "get_page_content", params: {...}}` via SSE
3. Companion SW forwards to content script via `chrome.tabs.sendMessage`
4. Content script executes, returns result to SW
5. SW POSTs result to `http://127.0.0.1:<port>/api/tool-result`
6. Main process feeds result to LLM for next iteration

### Data Layer

**SQLite (graph data):**
- Engine: better-sqlite3 in Electron main process
- File: `<app-data>/kg-desktop.db` (default)
- Same schema, same migrations, same FTS5 — different engine
- WAL mode enabled by default

**Note vault (markdown files):**
- Location: user-configurable, default `~/Documents/KnowledgeGraph/notes/`
- Format: `{node_id}.md` — same as current OPFS structure
- External edits detected via `chokidar` file watcher → re-index FTS
- `note_search` FTS table in SQLite stays synced with vault files
- Write ordering: vault file first, then `note_search` upsert, then `nodes` metadata update (same as current)

**Data migration (Chrome extension → desktop):**
- Chrome extension gets an "Export to Desktop" feature: serializes SQLite DB + OPFS notes into `.zip`
- Desktop first-run wizard offers "Import from Chrome Extension"
- Alternative: companion extension handles initial data transfer via HTTP to desktop

### Build System

**Two Vite configs, shared source:**

```
vite.config.chrome.ts      # Current config, mostly unchanged
vite.config.electron.ts    # Builds renderer for Electron (simpler)
electron/
  main.ts                  # Main process entry
  preload.ts               # contextBridge API
  native-host.ts           # Native messaging host script
  tsconfig.json            # Main process TypeScript config
```

**`vite.config.electron.ts` vs Chrome:**
- No service worker, offscreen, content-script, db-worker, db-shared-worker builds (5 fewer outputs)
- Only `layoutWorkerPlugin` kept (force layout still runs in Web Worker)
- `base: './'` for Electron file:// protocol
- No `process.env.NODE_ENV` override (no CSP restriction)
- Main process compiled separately via `tsc` (Node.js target)

**Scripts:**
```
build:chrome    → vite build --config vite.config.chrome.ts
build:electron  → vite build --config vite.config.electron.ts && tsc -p electron/tsconfig.json
dev:chrome      → vite build --watch --config vite.config.chrome.ts
dev:electron    → concurrently "vite --config vite.config.electron.ts" "electron ."
```

**Distribution:**
- electron-builder for packaging
- electron-updater for auto-updates
- macOS: code signing + Apple notarization ($99/yr developer account)
- Windows: SmartScreen reputation building
- Expected app size: 200-250 MB

## Migration Phases

Each phase produces a working, shippable state. No phase breaks the existing Chrome extension.

### Phase 0: Foundation (Week 1-2)
- Set up Electron project structure (`electron/main.ts`, `preload.ts`)
- Configure `vite.config.electron.ts`
- Renderer loads existing React app as-is
- Chrome APIs stubbed — app window opens, UI renders, features don't work yet
- **Checkpoint:** Electron window opens showing the UI

### Phase 1: Platform Abstraction + Storage (Week 3-4)
- Create `src/platform/` with `PlatformStorage` interface
- `chrome/chrome-storage.ts` wraps existing `chrome.storage.local` calls
- `electron/electron-storage.ts` uses `safeStorage` + JSON config
- Refactor all 51 `chrome.storage.local` calls to `platform.storage`
- **Checkpoint:** API keys persist correctly in both Chrome and Electron

### Phase 2: Database Layer (Week 5-7)
- `electron/electron-db.ts` using better-sqlite3 in main process
- IPC channels: `db:query`, `db:execute`, `db:transaction`
- `chrome/chrome-db.ts` wraps existing SharedWorker/DedicatedWorker chain
- Refactor `db-client.ts` calls to `platform.db`
- Run same migrations on both engines
- **Checkpoint:** Graph CRUD and FTS search work in Electron

### Phase 3: Notes + Filesystem (Week 7-8)
- `electron/electron-notes.ts` using `fs` + `chokidar`
- User-configurable vault directory
- External edit detection → FTS re-index
- **Checkpoint:** Create/edit/search notes in Electron. Edit in VS Code, see update in app.

### Phase 4: LLM + Agent Layer (Week 8-10)
- `electron/electron-llm.ts` — direct `fetch` from main process
- Agent loop runs in main process (no SW timeout)
- Streaming via IPC events
- **Checkpoint:** Full extraction pipeline works. Agent runs 15+ iterations.

### Phase 5: Companion Extension (Week 10-12)
- New minimal Chrome extension (separate directory, ~500 LOC)
- Native messaging host registration in Electron installer
- HTTP server in main process + SSE for push
- Content script with agent tool implementations
- Reading list sync
- **Checkpoint:** Desktop app dispatches agent tools to browser, results flow back.

### Phase 6: Polish + Distribution (Week 12-14)
- Data migration tool (Chrome → Desktop export/import)
- Auto-updater via electron-updater
- macOS code signing + notarization
- Windows SmartScreen setup
- First-run wizard

## Competitive Positioning

### Market Gap

No tool combines:
- Auto-capture from web browsing without interrupting
- LLM entity/relationship extraction with human-in-the-loop refinement
- Unified local knowledge graph with desktop-native experience

Obsidian/Logseq: local-first but no AI extraction. Notion/Capacities: AI but cloud-only. Recall/Perplexity Lens: browser-only, no desktop graph workspace.

### Defensible Moats

1. **Human-in-the-loop extraction UX** — LLM extracts, humans refine in real-time. Moat is the refinement experience, not the API.
2. **Semantic deduplication + entity resolution** — graph grows without duplicates; most tools don't solve messy real-world data.
3. **Desktop + browser integration** — companion extension captures from browsing; desktop app is the persistent workspace.
4. **Domain-specific entity types** — users define custom types; extraction adapts. Defensible against generalist note apps.
5. **Graph-native query** — relationship exploration, not just full-text search.

## Verification Plan

1. **Phase 0:** `npm run dev:electron` → Electron window opens, React UI renders
2. **Phase 1:** Settings persist after app restart in both Chrome and Electron
3. **Phase 2:** Create nodes/edges, FTS search returns results, graph renders in Electron
4. **Phase 3:** Create note in app → `.md` file appears in vault. Edit `.md` externally → app updates.
5. **Phase 4:** Run text extraction and agent extraction end-to-end in Electron. Verify no timeout after 30s.
6. **Phase 5:** Install companion extension alongside desktop app. Click "Extract from page" → agent gathers data from browser → results appear in desktop graph.
7. **Phase 6:** Package with electron-builder. Install on clean machine. Auto-update works.

## Files to Create

| File | Purpose |
|---|---|
| `electron/main.ts` | Electron main process entry |
| `electron/preload.ts` | contextBridge typed API |
| `electron/native-host.ts` | Native messaging host script |
| `electron/tsconfig.json` | Main process TypeScript config |
| `vite.config.electron.ts` | Renderer build config |
| `src/platform/types.ts` | Platform interfaces |
| `src/platform/index.ts` | Runtime detection + init |
| `src/platform/chrome/*.ts` | Chrome implementations (wrapping existing code) |
| `src/platform/electron/*.ts` | Electron implementations |

## Files to Modify

| File | Change |
|---|---|
| `package.json` | Add Electron deps, build scripts |
| `vite.config.ts` → `vite.config.chrome.ts` | Rename, no logic changes |
| `src/db/client/db-client.ts` | Refactor to use `platform.db` |
| `src/graph/store/graph-store.ts` | Replace `chrome.storage` → `platform.storage` |
| `src/ui/main.tsx` | Platform detection at startup |
| All files using `chrome.storage.local` (51 occurrences) | Replace with `platform.storage` |
| All files using `chrome.runtime.sendMessage` (43 occurrences) | Replace with `platform.messaging` |
| `src/notes/opfs-note-store.ts` | Becomes `platform/chrome/chrome-notes.ts` |

## Risks

| Risk | Severity | Mitigation |
|---|---|---|
| better-sqlite3 native module build failures | High | electron-rebuild, CI testing per Electron version, pre-built binaries |
| Two Vite configs drift | Medium | Shared config factory, CI builds both targets |
| Native messaging host registration across OS | Medium | Test on all 3 platforms early, use electron-builder hooks |
| Extension SW lifecycle drops SSE connection | Medium | Auto-reconnect with exponential backoff in companion |
| Data migration data loss | High | Verify checksums, dry-run mode, keep Chrome extension working as fallback |
