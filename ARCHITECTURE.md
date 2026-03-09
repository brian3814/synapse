# Knowledge Graph Chrome Extension — Architecture Document

## Overview

A Chrome Manifest V3 extension that provides a local-first knowledge graph with persistent SQLite storage, 2D/3D graph visualization, full CRUD operations, and LLM-powered entity extraction. The UI renders in the Chrome Side Panel (default) or a full tab, with a toggle to switch between modes.

---

## System Architecture

```
+======================================================================+
|                    CHROME EXTENSION (Manifest V3)                     |
|                                                                      |
|  +------------------------+     +-------------------------------+    |
|  |   CONTENT SCRIPT       |     |     SERVICE WORKER            |    |
|  |   (per web page)       |     |     (ephemeral, thin router)  |    |
|  |                        |     |                               |    |
|  |  - Page text extract   |     |  - Message routing            |    |
|  |  - Selection capture   |     |  - Context menu registration  |    |
|  |  - Readability parse   |     |  - Side panel behavior mgmt   |    |
|  |  - Agent tool executor |     |  - Offscreen doc lifecycle     |    |
|  +-----------|------------+     |  - Content script injection    |    |
|              |                  +--------|------------|----------+    |
|              | chrome.runtime            |            |               |
|              | .sendMessage()            |            |               |
|  +===========|===========================|============|==========+   |
|  ||              TYPED MESSAGE BUS (chrome.runtime)              ||   |
|  ||    { type, payload, requestId, source, timestamp }          ||   |
|  +===================|===========================|==============+    |
|                      |                           |                   |
|                      v                           v                   |
|  +-------------------------------------------+  +----------------+  |
|  |  SIDE PANEL / TAB PAGE (React SPA)        |  | OFFSCREEN DOC  |  |
|  |  chrome-extension://id/index.html         |  |                |  |
|  |                                           |  | - LLM fetch    |  |
|  |  +------+ +----------+ +--------------+   |  |   w/ streaming |  |
|  |  |Zustand| |React UI  | |Reagraph      |  |  | - Agent loop   |  |
|  |  |Stores | |Panels    | |GraphCanvas   |  |  |   (tool-use)   |  |
|  |  +---|---+ +----------+ +--------------+   |  | - Keepalive    |  |
|  |      |                                     |  +----------------+  |
|  |  +---|-----------------------------------+ |                      |
|  |  | DB CLIENT                             | |                      |
|  |  |  Creates Worker + SharedWorker        | |                      |
|  |  |  Bridges via MessageChannel           | |                      |
|  |  +---|----------------------|------------+ |                      |
|  |      | postMessage          | port transfer|                      |
|  |      v                      v              |                      |
|  |  +------------------+ +------------------+ |                      |
|  |  | SHARED WORKER    | | DEDICATED WORKER | |                      |
|  |  | (coordinator)    | | (SQLite engine)  | |                      |
|  |  |                  | |                  | |                      |
|  |  | Routes queries   |<| wa-sqlite + OPFS | |                      |
|  |  | from all tabs    | | MessageChannel   | |                      |
|  |  | via MessagePort  |>| port for I/O     | |                      |
|  |  | Broadcasts sync  | |                  | |                      |
|  |  +------------------+ +------------------+ |                      |
|  +--------------------------------------------+                     |
+======================================================================+
```

### Execution Contexts

| Context | Lifecycle | Capabilities | Restrictions |
|---|---|---|---|
| **Service Worker** | Ephemeral (30s idle / 5min max) | `chrome.*` APIs, message routing, content script injection | No DOM, no long-running tasks |
| **Side Panel / Tab** | User-controlled | Full DOM, WebGL, Web Workers, OPFS | CSP: `script-src 'self' 'wasm-unsafe-eval'` |
| **Offscreen Document** | Managed by SW | DOM (hidden), fetch, long-lived; hosts agent loop + LLM streaming | No UI, no `chrome.tabs`, no `chrome.storage` (see Pitfall #13) |
| **Content Script** | Per-page, isolated world | Page DOM read access, agent tool execution | No extension storage, limited APIs |
| **DB SharedWorker** | Shared across tabs | Message routing, sync event broadcast | No DOM, no `chrome.*` APIs, no `Worker` constructor |
| **DB Dedicated Worker** | Spawned by UI, bridged to SharedWorker | WASM, OPFS, Asyncify | No DOM, no `chrome.*` APIs |

---

## Tech Stack

| Layer | Choice | Rationale |
|---|---|---|
| Bundler | Vite 7 | Multi-entry support, WASM handling, custom plugins for extension output |
| Framework | React 19 + TypeScript (strict) | Rich ecosystem, Reagraph bindings |
| State | Zustand 5 | Minimal boilerplate, works outside React (message handlers) |
| Database | wa-sqlite + OPFS VFS | Only mature WASM SQLite with true filesystem persistence |
| Graph Viz | Reagraph 4 | Unified 2D/3D via `GraphCanvas`, built-in clustering, 15+ layouts |
| CSS | Tailwind CSS 4 | Utility-first, small purged bundle |
| LLM | Direct HTTP fetch | No SDK — avoids 200KB+ bundles with Node.js deps |
| Validation | Zod 4 | Runtime validation of LLM responses and forms |
| Page parsing | @mozilla/readability | Battle-tested article extraction |

---

## Project Structure

```
kg_extension/
├── public/
│   ├── manifest.json          # MV3 manifest
│   ├── offscreen.html         # Hidden document for LLM streaming
│   └── icons/
├── src/
│   ├── shared/                # Cross-context types and constants
│   │   ├── types.ts           # GraphNode, GraphEdge, DbNode, DbEdge, LLMConfig, ToolCall, AgentTurn
│   │   ├── messages.ts        # Typed message protocol for chrome.runtime
│   │   ├── agent-tools.ts     # Agent tool definitions + toAnthropicTools() converter
│   │   ├── schema.ts          # Zod validation schemas
│   │   └── constants.ts       # Colors, layout options, storage keys
│   ├── db/
│   │   ├── worker/
│   │   │   ├── sqlite-engine.ts    # wa-sqlite init, OPFS/IDB VFS, serialized query execution
│   │   │   ├── db-worker.ts        # Dedicated Worker: SQLite engine, accepts coordinator port
│   │   │   ├── db-shared-worker.ts # SharedWorker: pure coordinator/router, receives worker port from UI
│   │   │   ├── query-executor.ts   # SQL execution with retry (SQLITE_BUSY)
│   │   │   ├── migrations/         # Versioned schema migrations with FTS5 detection
│   │   │   └── queries/            # Typed CRUD + neighborhood traversal (recursive CTEs)
│   │   └── client/
│   │       ├── db-client.ts        # Promisified postMessage wrapper with timeouts
│   │       └── db-hooks.ts         # React hooks: useDbInit
│   ├── graph/
│   │   ├── store/
│   │   │   ├── graph-store.ts      # Zustand: nodes/edges CRUD, DB sync
│   │   │   ├── ui-store.ts         # Zustand: display mode, layout, panels, clustering
│   │   │   └── llm-store.ts        # Zustand: extraction pipeline state machine
│   │   └── transforms/
│   │       ├── db-to-reagraph.ts   # DB rows -> Reagraph node/edge format
│   │       └── reagraph-to-db.ts   # Layout positions -> DB persistence
│   ├── lib/
│   │   └── troika-worker-utils-shim.ts  # Main-thread shim (see Pitfall #1)
│   ├── llm/                        # (planned) Provider abstraction
│   ├── content-script/
│   │   ├── index.ts                # Entry: listens for extraction + TOOL_EXECUTE requests
│   │   ├── page-extractor.ts       # Readability-based text extraction
│   │   └── tool-executor.ts        # Agent tool implementations (DOM inspection tools)
│   ├── service-worker/
│   │   ├── index.ts                # Entry: event listeners, panel behavior sync
│   │   ├── message-router.ts       # Dispatches chrome.runtime messages
│   │   ├── context-menu.ts         # Right-click "Extract to KG" menus
│   │   ├── offscreen-manager.ts    # Offscreen document lifecycle
│   │   ├── sidepanel-manager.ts    # Display mode preference
│   │   └── tab-manager.ts          # Extension tab open/close/focus
│   ├── offscreen/
│   │   ├── index.ts                # Entry: message listener (LLM_REQUEST + AGENT_RUN_START)
│   │   ├── llm-executor.ts         # Direct HTTP to OpenAI/Anthropic with streaming + tool-use
│   │   └── agent-loop.ts           # Agentic tool-use loop for page extraction
│   └── ui/
│       ├── index.html              # Single HTML entry for both side panel and tab
│       ├── main.tsx                # React root mount
│       ├── App.tsx                 # DB init, display mode detection, layout selection
│       ├── styles.css              # Tailwind + base styles (html/body/root 100% height)
│       ├── layouts/
│       │   ├── SidePanelLayout.tsx  # Compact single-column (~400px)
│       │   └── TabLayout.tsx        # Full-width with side-by-side panels
│       ├── components/
│       │   ├── graph/
│       │   │   ├── KnowledgeGraph.tsx    # Reagraph wrapper with theme, clustering, sizing
│       │   │   ├── GraphControls.tsx     # Layout selector, zoom, fit-to-view
│       │   │   └── NodeTooltip.tsx
│       │   ├── panels/                   # Node/edge detail, create, property editor
│       │   ├── search/SearchPanel.tsx    # FTS5 or LIKE fallback search
│       │   ├── llm/                      # Extraction UI, diff view, streaming output
│       │   │   ├── LLMPanel.tsx          # Tab toggle (From Page / From Text) + extraction states
│       │   │   ├── PromptInput.tsx       # User prompt for page extraction (agent mode)
│       │   │   ├── AgentTimeline.tsx     # Vertical timeline of agent thinking/tool calls
│       │   │   ├── TextInput.tsx         # Paste text input (non-agent mode)
│       │   │   ├── DiffView.tsx          # Entity diff review before merge
│       │   │   ├── ExtractionSummary.tsx # Summary of extracted entities
│       │   │   └── StreamingOutput.tsx   # Streaming LLM output display
│       │   └── settings/SettingsPanel.tsx
│       └── hooks/
│           ├── useDisplayMode.ts    # Side panel vs tab detection + toggle
│           ├── useGraphData.ts      # Store -> Reagraph data transform
│           └── useLLMExtraction.ts
```

---

## Build System

The Vite config uses **five custom plugins** to handle Chrome extension requirements:

```
vite.config.ts
├── react()                  # @vitejs/plugin-react
├── tailwindcss()            # @tailwindcss/vite
├── fixHtmlPlugin()          # Moves HTML to dist root, fixes asset paths
├── dbWorkerPlugin()         # Separate ES module build for db-worker.js
├── dbSharedWorkerPlugin()   # Separate ES module build for db-shared-worker.js
└── contentScriptPlugin()    # Separate IIFE build for content-script.js
```

**Multi-entry build:** The main Vite build produces three entries — the React SPA (`index.html`), the service worker (`service-worker.js`), and the offscreen document (`offscreen.js`). Three additional `closeBundle` plugins run separate Vite builds for the DB dedicated worker, DB shared worker (both ES modules), and content script (IIFE).

**Key config decisions:**
- `base: ''` — relative asset paths (Chrome extension URLs are `chrome-extension://id/...`)
- `modulePreload: false` — prevents Vite from injecting a polyfill that references `document`, which crashes the service worker
- `minify: false` + `sourcemap: true` — currently enabled for debugging

**Resolve aliases:**
- `@` → `src/` for clean imports
- `troika-worker-utils` → `src/lib/troika-worker-utils-shim.ts` (see Pitfall #1)

---

## SQLite Persistence Layer

### Architecture

Following [Notion's WASM SQLite architecture](https://www.notion.com/blog/how-we-sped-up-notion-in-the-browser-with-wasm-sqlite), the UI thread creates both workers and bridges them via `MessageChannel`:

```
UI Thread (db-client.ts)
┌────────────────────────────────────────────────────────────┐
│  1. Creates SharedWorker, sends init                       │
│  2. SharedWorker responds { needsWorker: true }            │
│  3. Creates Dedicated Worker + MessageChannel              │
│  4. Transfers port2 → Dedicated Worker                     │
│  5. Transfers port1 → SharedWorker                         │
└──────┬───────────────────────────┬─────────────────────────┘
       │ postMessage               │ port transfer
       v                           v
┌──────────────────┐       ┌─────────────────────────┐
│  SharedWorker    │       │  Dedicated Worker        │
│  (coordinator)   │       │  (SQLite engine)         │
│                  │ port  │                          │
│  Routes queries  │<─────>│  db-worker.ts            │
│  from tab ports  │       │    ├── action dispatch   │
│  to worker port  │       │    ├── node-queries.ts   │
│                  │       │    ├── edge-queries.ts   │
│  Broadcasts sync │       │    └── query-executor.ts │
│  events to tabs  │       │         └── sqlite-engine│
└──────────────────┘       │              ├── wa-sqlite│
                           │              ├── OPFS VFS│
                           │              └── serialize│
                           └─────────────────────────┘
```

**Why two workers?** SharedWorker ensures a single SQLite connection across all tabs (prevents OPFS corruption from concurrent access). Dedicated Worker is required because OPFS `createSyncAccessHandle()` is only available in dedicated workers. The SharedWorker cannot create workers itself (`Worker` is not defined in `SharedWorkerGlobalScope` in Chrome extensions — see Pitfall #12).

### Serial Execution Queue

All SQLite operations go through a promise-based serial queue in `sqlite-engine.ts`:

```typescript
let queue: Promise<any> = Promise.resolve();

function serialize<T>(fn: () => Promise<T>): Promise<T> {
  const result = queue.then(fn, fn);
  queue = result.then(() => {}, () => {});
  return result;
}
```

This prevents concurrent Asyncify operations from corrupting WASM state (see Pitfall #4).

### VFS Fallback Chain

```
OPFS (OriginPrivateFileSystemVFS) → IDB (IDBBatchAtomicVFS) → Default (in-memory)
```

### Schema Migrations

Migrations are versioned and tracked in a `schema_version` table. The runner detects available SQLite modules (e.g., FTS5) before executing optional migrations, recording skipped ones to avoid retries.

---

## Display Mode System

The extension supports two display modes with a toggle:

```
Side Panel (default, ~400px)          Tab (full viewport)
┌──────────────────────┐             ┌────────────────────────────────┐
│ [Header + toolbar]   │             │ [Header + toolbar + 3D toggle] │
├──────────────────────┤             ├──────────────────┬─────────────┤
│                      │             │                  │ Detail      │
│   Graph Canvas       │             │   Graph Canvas   │ Panel       │
│   (compact, 2D only) │             │   (full, 2D/3D)  │ (400px)     │
│                      │             │                  │             │
├──────────────────────┤             │                  │             │
│ Detail Panel         │             │                  │             │
│ (collapsible)        │             │                  │             │
└──────────────────────┘             └──────────────────┴─────────────┘
```

**Mode detection:** The manifest sets `"default_path": "index.html?mode=sidePanel"` for the side panel, and `tab-manager.ts` opens tabs with `?mode=tab`. The `useDisplayMode` hook reads this URL param to determine the current mode (no width heuristic).

**Toggle flow:**
- **Side panel → Tab:** Service worker calls `openExtensionTab()`, UI calls `window.close()` to close the side panel.
- **Tab → Side panel:** Service worker calls `sidePanel.open({ windowId })` using `sender.tab.windowId`, UI calls `window.close()` to close the tab.

The service worker uses `chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick })` to control what happens when the user clicks the extension icon. A `chrome.storage.onChanged` listener keeps this in sync with the stored preference (see Pitfall #5).

---

## Agent Loop for Page Extraction

The extension supports an agentic LLM extraction mode (Anthropic-only) that inspects the current page DOM via tool calls to extract knowledge graph entities.

### Architecture

```
UI (PromptInput)                    SW (relay)                  Offscreen (agent-loop.ts)
      |                                |                              |
      |--- AGENT_RUN_START ----------->|--- forward ----------------->|
      |                                |                              |
      |                                |                    ┌─────────┴─────────┐
      |                                |                    │ Agent Loop         │
      |                                |                    │ (max 15 iters)    │
      |                                |                    │                   │
      |                                |                    │ 1. LLM call       │
      |<-- AGENT_PROGRESS (llm_chunk)--|<-- broadcast ------|    w/ tools       │
      |                                |                    │                   │
      |                                |                    │ 2. Tool calls:    │
      |                                |<-- TOOL_EXECUTE ---|    content-script │
      |                                |--- tabs.sendMsg -->|    tools via SW   |
      |                                |                    |                   │
      |                                |    Content Script   │ 3. fetch_url:    │
      |                                |    executes tool    │    runs locally   │
      |                                |    sends response   │                   │
      |                                |--- response ------>|                   │
      |<-- AGENT_PROGRESS (tool_*)-----|<-- broadcast ------|                   │
      |                                |                    │ 4. save_entities: │
      |<-- AGENT_PROGRESS (complete)---|<-- broadcast ------|    terminal       │
      |                                |                    └───────────────────┘
```

### Available Tools

| Tool | Context | Description |
|---|---|---|
| `get_page_content` | content-script | Full cleaned page text (50KB limit) |
| `get_page_metadata` | content-script | Title, URL, meta/OG tags, JSON-LD, heading outline |
| `query_selector` | content-script | Text of first matching CSS selector |
| `query_selector_all` | content-script | Text of all matching elements (max 50) |
| `get_links` | content-script | All links with text+href, optional CSS scope |
| `get_tables` | content-script | HTML tables as row objects (max 5 tables, 100 rows) |
| `get_structured_data` | content-script | JSON-LD and microdata |
| `fetch_url` | offscreen | Fetch external URL, return cleaned text (20KB limit) |
| `save_entities` | offscreen | Terminal tool — saves `{ nodes, edges }` to graph |

### Content Script Injection

The service worker ensures the content script is present before relaying `TOOL_EXECUTE` messages. It pings the content script first; if no response, it injects `content-script.js` via `chrome.scripting.executeScript`. This handles tabs opened before the extension was installed/reloaded. Requires `scripting` permission and `host_permissions: ["<all_urls>"]`.

### Message Types

| Message | Direction | Purpose |
|---|---|---|
| `AGENT_RUN_START` | UI → SW → Offscreen | Start agent loop with user prompt + tab ID |
| `AGENT_PROGRESS` | Offscreen → broadcast | Progress events (llm_chunk, tool_call, tool_result, extraction_complete, error, done) |
| `TOOL_EXECUTE` | Offscreen → SW → Content Script | Execute a DOM tool in the content script |

### UI States

The LLM panel has two tabs:
- **From Page** — Prompt input for agentic extraction from the current tab (Anthropic-only)
- **From Text** — Paste text for non-agentic extraction (any provider)

Both flows share the same diff review → merge pipeline after extraction completes.

---

## Pitfalls Encountered and Solutions

### Pitfall #1: Troika Blob URL Workers Blocked by Chrome Extension CSP

**Problem:** Reagraph depends on `troika-three-text` for WebGL text rendering. Troika uses `troika-worker-utils` which creates inline web workers via `URL.createObjectURL(new Blob([code]))`. Chrome MV3 CSP restricts `script-src` and `worker-src` to `'self'` only — `blob:` URLs are not allowed.

The failure is **silent and deceptive**: troika's `supportsWorkers()` test creates an empty blob worker (`new Blob([''])`) which succeeds because the `Worker` constructor doesn't fail. But when real workers call `importScripts(blob:...)` to rehydrate serialized functions, CSP blocks it. The `rehydrate()` function catches the error and returns `undefined`, causing `init` to not return a callable function — crashing the entire Three.js scene.

**Solution:** Created `src/lib/troika-worker-utils-shim.ts` — a drop-in replacement that implements the same `defineWorkerModule` / `stringifyFunction` / `terminateWorker` API but always executes on the main thread. The shim uses the same dependency resolution logic as troika's own `defineMainThreadModule`: worker module dependencies are resolved via their `.onMainThread` fallback, and raw function dependencies are passed through as-is.

A Vite `resolve.alias` redirects all `troika-worker-utils` imports to the shim:

```typescript
// vite.config.ts
resolve: {
  alias: {
    'troika-worker-utils': resolve(__dirname, 'src/lib/troika-worker-utils-shim.ts'),
  },
}
```

**Key subtlety:** The original shim incorrectly wrapped raw function dependencies as worker modules, which called them during dependency resolution (executing the factory) instead of passing the factory function through. Troika's `init` functions expect to receive factory functions they can call themselves — e.g., `init(typrFactory) { const Typr = typrFactory(); ... }`. The fix was to not wrap raw function dependencies at all.

---

### Pitfall #2: DB Worker Blob URL Also Blocked by CSP

**Problem:** Vite's default worker handling wraps worker source code in a blob URL: `new Worker(URL.createObjectURL(new Blob([bundledCode])))`. This is blocked by the same CSP restriction as Pitfall #1.

The error: `NetworkError: Failed to execute 'importScripts' on 'WorkerGlobalScope': The script at 'blob:chrome-extension://...' failed to load.`

**Solution:** Built the DB worker as a **separate Vite entry point** via a custom `dbWorkerPlugin()` that runs a second Vite build in `closeBundle`. This produces `dist/db-worker.js` as a standalone ES module. The client loads it via a direct `chrome-extension://` URL instead of a blob:

```typescript
// db-client.ts
const workerUrl = new URL('/db-worker.js', location.origin).href;
worker = new Worker(workerUrl, { type: 'module' });

// vite.config.ts — dbWorkerPlugin output
output: {
  entryFileNames: 'db-worker.js',
  assetFileNames: '[name][extname]',  // WASM without hash
}
```

The WASM file (`wa-sqlite-async.wasm`) is also output without a content hash so the worker can load it from a predictable URL.

---

### Pitfall #3: FTS5 Module Not Available in wa-sqlite

**Problem:** The default wa-sqlite WASM binary does not include the FTS5 full-text search extension. Running `CREATE VIRTUAL TABLE ... USING fts5(...)` fails with: `no such module: fts5`.

Early attempts to detect FTS5 by creating a test FTS5 table and catching the error left the Asyncify WASM state corrupted, causing subsequent `sqlite3_malloc` calls to hit `RuntimeError: unreachable`.

**Solution:** Safe detection using `pragma_module_list` which queries compiled-in modules without side effects:

```typescript
export function checkModuleAvailable(moduleName: string): Promise<boolean> {
  return serialize(async () => {
    const results: string[] = [];
    await sqlite3.exec(
      db,
      `SELECT name FROM pragma_module_list WHERE name = '${moduleName}';`,
      (row: unknown[]) => { results.push(row[0] as string); }
    );
    return results.length > 0;
  });
}
```

Migration 002 (FTS index) is marked `optional: true`. The migration runner checks `checkModuleAvailable('fts5')` and skips the migration entirely if FTS5 is unavailable, recording the skip in `schema_version` to avoid retries. Search falls back to `LIKE`-based queries.

**FTS5 query sanitization:** User input is sanitized before being passed to FTS5 `MATCH`. Special characters (`"*()-+^:{}~|`) are stripped, empty tokens are discarded, and each surviving token is wrapped as `"token"*` (quoted literal + prefix wildcard). If sanitization yields no tokens, FTS5 is skipped entirely. FTS5 `MATCH` is also wrapped in try/catch — any failure falls through to the LIKE fallback. The LIKE fallback searches `label` and `type` only (not `properties` JSON blobs).

**UI debounce:** `SearchPanel` debounces DB queries by 300ms and uses a monotonic `searchIdRef` to discard stale responses. Single-character queries are skipped (`MIN_QUERY_LENGTH = 2`). The component does not subscribe to `graph-store.nodes`, avoiding callback recreation on graph mutations.

See [`docs/search.md`](docs/search.md) for full details.

---

### Pitfall #4: wa-sqlite Asyncify Corruption from Concurrent Operations

**Problem:** The wa-sqlite async build uses Emscripten's Asyncify to make synchronous SQLite C calls awaitable in JavaScript. Asyncify works by rewinding and replaying the WASM call stack — but it maintains global state that is **not reentrant**. If two async SQLite operations interleave (e.g., an INSERT is `await`-ed while a SELECT starts), the Asyncify stack unwind/rewind state gets corrupted.

Symptom: `RuntimeError: unreachable` at `sqlite3_malloc` — WASM memory is in an inconsistent state and the allocator hits a trap instruction.

**Solution:** All SQLite operations are funneled through a serial promise queue in `sqlite-engine.ts` (shown above). The queue ensures only one async WASM operation is in-flight at any time. Both `exec()` and `query()` wrap their logic in `serialize()`.

Additionally, we use wa-sqlite's built-in high-level APIs (`sqlite3.run()` for parameterized writes, `sqlite3.execWithParams()` for parameterized reads) instead of manually iterating the low-level `sqlite3.statements()` async generator, which reduces the surface area for Asyncify interleaving.

---

### Pitfall #5: `sidePanel.open()` Requires User Gesture

**Problem:** `chrome.sidePanel.open()` can only be called in direct response to a user gesture (e.g., `chrome.action.onClicked`). The original code read the display mode preference from `chrome.storage.local` before calling `open()`, which introduced an `await` that broke the user gesture chain:

```typescript
// BROKEN: await loses user gesture context
chrome.action.onClicked.addListener(async (tab) => {
  const mode = await getDisplayMode();  // <-- async gap
  await chrome.sidePanel.open({ windowId: tab.windowId });  // <-- fails
});
```

Error: `sidePanel.open() may only be called in response to a user gesture`

**Solution:** Instead of programmatically calling `sidePanel.open()`, use `setPanelBehavior({ openPanelOnActionClick: true })` which tells Chrome to handle the side panel opening automatically on icon click — no user gesture chain to break.

The service worker syncs this behavior with the stored preference:

```typescript
async function syncPanelBehavior(): Promise<void> {
  const mode = await getDisplayMode();
  await chrome.sidePanel.setPanelBehavior({
    openPanelOnActionClick: mode === 'sidePanel'
  });
}

// On startup
syncPanelBehavior();

// When preference changes
chrome.storage.onChanged.addListener((changes, areaName) => {
  if (areaName === 'local' && changes.displayMode) {
    syncPanelBehavior();
  }
});

// onClicked only fires when openPanelOnActionClick is false (tab mode)
chrome.action.onClicked.addListener(async () => {
  await openExtensionTab();
});
```

For the tab-to-side-panel toggle, the service worker calls `sidePanel.open({ windowId })` from the `TOGGLE_DISPLAY_MODE` message handler. While `sidePanel.open()` technically requires a user gesture, calling it with `windowId` from the service worker works in Chrome 116+. The UI then closes itself via `window.close()`.

---

### Pitfall #6: Vite `modulePreload` Polyfill in Service Worker

**Problem:** Vite injects a `modulePreload` polyfill that references `document.createElement('link')`. When the service worker entry is built as part of the same Vite build, this polyfill gets included — but service workers have no DOM. The service worker crashes on load with `document is not defined`.

**Solution:** Two changes:
1. `modulePreload: false` in the Vite build config to disable the polyfill entirely
2. Changed `message-router.ts` from dynamic imports (`await import('./context-menu')`) to static imports, since dynamic imports were triggering the polyfill injection

---

### Pitfall #7: Vite HTML Output Path Mismatch

**Problem:** With `src/ui/index.html` as an input entry, Vite preserves the directory structure in the output: `dist/src/ui/index.html`. But `manifest.json` expects `index.html` at the dist root, and asset paths in the HTML reference `../../assets/` which won't resolve correctly.

**Solution:** Custom `fixHtmlPlugin()` that runs in `closeBundle`:
1. Moves `dist/src/ui/index.html` → `dist/index.html`
2. Rewrites `../../assets/` → `assets/` in the HTML
3. Cleans up empty `dist/src/ui/` and `dist/src/` directories

---

### Pitfall #8: Reagraph Clustering Only Works with Force-Directed Layouts

**Problem:** Reagraph throws `Error: Clustering is only supported for the force directed layouts` when `clusterAttribute` is passed with non-force-directed layouts (tree, radial, hierarchical).

**Solution:** Conditionally pass `clusterAttribute` based on the active layout:

```tsx
clusterAttribute={
  clusteringEnabled && layoutType.startsWith('forceDirected')
    ? 'type'
    : undefined
}
```

---

### Pitfall #9: WebGL Canvas Gets Zero Height in Flexbox Layout

**Problem:** Reagraph's `GraphCanvas` uses `position: absolute; inset: 0` internally (via react-three-fiber). This requires the parent container to have explicit pixel dimensions. In a flexbox column layout, a child with `flex: 1` gets its height from flexbox, but a grandchild with `height: 100%` may not resolve correctly because CSS percentage heights require an explicit `height` property on the parent (not just flex-derived height).

Result: the WebGL canvas renders at 0x0 pixels — the graph exists in memory but nothing is visible.

**Solution:** Three CSS changes:
1. Added `min-h-0` to flex containers (overrides `min-height: auto` default which prevents shrinking)
2. Added `relative` to the graph container div (positioning context for absolute children)
3. Changed the `KnowledgeGraph` wrapper from `w-full h-full` to `absolute inset-0` (directly fills the positioned parent)

```tsx
{/* Layout */}
<div className="flex-1 min-h-0 relative">
  <KnowledgeGraph />
</div>

{/* KnowledgeGraph wrapper */}
<div className="absolute inset-0">
  <GraphCanvas ... />
</div>
```

---

### Pitfall #10: `sizingType="attribute"` Without `sizingAttribute`

**Problem:** Reagraph's `sizingType="attribute"` mode requires a `sizingAttribute` prop specifying which `node.data` field to read for sizing. Without it, Reagraph logs a warning and node sizes resolve to 0 or the default fallback, making nodes appear at unexpected sizes.

**Solution:** Changed to `sizingType="default"` which reads the `size` property directly from each node object — the value we set during the DB-to-Reagraph transform.

---

## CSP Reference

The extension's Content Security Policy is:

```
script-src 'self' 'wasm-unsafe-eval'; object-src 'self'
```

**What this allows:**
- Scripts from the extension's own origin (`'self'`)
- WASM compilation and execution (`'wasm-unsafe-eval'`)

**What this blocks:**
- `blob:` URLs for scripts/workers (Pitfalls #1, #2)
- `eval()`, `new Function()` from arbitrary strings
- Inline scripts
- Remote script sources

This CSP is the root cause of the most complex pitfalls in this project. Any library that creates inline workers via blob URLs will fail silently in this environment.

---

### Pitfall #11: OPFS `createSyncAccessHandle()` Fails in SharedWorker

**Problem:** After migrating the DB worker from a Dedicated Worker to a SharedWorker (for multi-tab safety), `sqlite3.open_v2()` fails with `Error: unable to open database file`. The OPFS VFS *registers* without error, but fails at open time when SQLite internally calls `xOpen`/`xLock`.

**Root cause:** `OriginPrivateFileSystemVFS` uses `FileSystemFileHandle.createSyncAccessHandle()` internally for WAL/journal files and exclusive locks. This API is restricted to dedicated workers in Chrome — calling it from a SharedWorker throws `InvalidStateError: createSyncAccessHandle is only supported in dedicated workers`. Since the VFS registered successfully, the original fallback logic (which only caught registration errors) never tried the IDB VFS.

Two bugs in the original `initSQLite()` made this worse:

1. **`await vfs.isReady` was a no-op** — Neither `OriginPrivateFileSystemVFS` nor `IDBBatchAtomicVFS` has an `isReady` property (only `AccessHandlePoolVFS` does). `await undefined` resolves silently, so the OPFS VFS appeared to register successfully in all contexts.

2. **`open_v2` was outside the VFS try/catch** — VFS registration succeeded (it just sets up the VFS object), but the actual filesystem calls happen during `open_v2`. Since `open_v2` was below the try/catch blocks, its `SQLITE_CANTOPEN` error was unrecoverable and the IDB fallback was never attempted.

**Solution:** Two changes in `sqlite-engine.ts`:

1. **Probe `createSyncAccessHandle()` before registering the OPFS VFS:**

```typescript
async function isOPFSAvailable(): Promise<boolean> {
  try {
    const root = await navigator.storage.getDirectory();
    const testFile = '.kg_opfs_probe';
    const handle = await root.getFileHandle(testFile, { create: true });
    const access = await handle.createSyncAccessHandle();
    access.close();
    await root.removeEntry(testFile);
    return true;
  } catch {
    return false;
  }
}
```

2. **Move `open_v2` inside each VFS try/catch** so open-time failures trigger the next fallback:

```typescript
// Try OPFS (only if probe passed)
if (await isOPFSAvailable()) {
  try {
    const vfs = new OriginPrivateFileSystemVFS();
    sqlite3.vfs_register(vfs, true);
    db = await sqlite3.open_v2(DB_NAME);          // <-- inside try/catch
  } catch (e) { db = null; }
}

// Fall back to IDB
if (db === null) {
  try {
    const vfs = new IDBBatchAtomicVFS();
    sqlite3.vfs_register(vfs, true);
    db = await sqlite3.open_v2(DB_NAME);          // <-- inside try/catch
  } catch (e) { db = null; }
}

// Last resort: in-memory
if (db === null) {
  db = await sqlite3.open_v2(DB_NAME);
}
```

**Key invariant:** The VFS fallback chain must always include `open_v2` inside each try/catch. Never separate VFS registration from database opening — registration can succeed even when the underlying filesystem API is unavailable in the current worker context.

---

### Pitfall #12: SharedWorker Cannot Spawn Dedicated Workers in Chrome Extensions

**Problem:** `SharedWorkerGlobalScope` in Chrome extensions does not expose the `Worker` constructor. Calling `new Worker(...)` inside a SharedWorker throws `ReferenceError: Worker is not defined`. This is a Chrome extension-specific limitation — the HTML spec exposes `Worker` in `SharedWorkerGlobalScope`, but Chrome's extension runtime does not. TypeScript compiles fine because `lib.webworker.d.ts` includes the type; the error only surfaces at runtime.

**Context:** The hybrid worker architecture requires both a SharedWorker (single SQLite connection across tabs) and a Dedicated Worker (OPFS `createSyncAccessHandle()` access). The original approach had the SharedWorker spawn the Dedicated Worker directly.

**Solution:** Following [Notion's WASM SQLite architecture](https://www.notion.com/blog/how-we-sped-up-notion-in-the-browser-with-wasm-sqlite), the **UI thread** creates the Dedicated Worker and bridges it to the SharedWorker via `MessageChannel` port transfer:

```
1. UI creates SharedWorker, sends { action: 'init' }
2. SharedWorker has no worker port → responds { needsWorker: true }
3. UI creates Dedicated Worker + MessageChannel
4. UI transfers channel.port2 to Dedicated Worker: worker.postMessage(data, [port])
5. UI transfers channel.port1 to SharedWorker: sharedPort.postMessage(data, [port])
6. SharedWorker receives port, sends init through it to Dedicated Worker
7. Dedicated Worker initializes SQLite, responds ready
8. SharedWorker confirms init to UI
9. All subsequent queries: UI → SharedWorker → (via port) → Dedicated Worker
```

**Port transfer syntax:** Ports go in the transfer list (2nd arg to `postMessage`), not in the message data. The receiver gets them via `event.ports[0]`.

**Second tab connects:** SharedWorker already has a working worker port, responds to `init` with `{ ready: true }` immediately. No second Dedicated Worker is created.

**Tab that created the Worker closes:** The Dedicated Worker dies. SharedWorker's port goes dead. Subsequent requests time out (10s). On next `initDbClient()` call, SharedWorker responds `needsWorker: true` again and a fresh Worker is created.

See `docs/pitfalls/shared-worker-cannot-spawn-workers.md` for full details.

---

### Pitfall #13: Offscreen Documents Cannot Access `chrome.storage`

**Problem:** Offscreen documents have a very limited subset of Chrome extension APIs. `chrome.storage` is **not** one of them. Attempting to call `chrome.storage.local.get(...)` from an offscreen document throws:

```
TypeError: Cannot read properties of undefined (reading 'local')
```

This is not obvious because:
1. TypeScript compiles fine — `chrome.storage` types are available via `@types/chrome`
2. The offscreen document has `chrome.runtime` (for messaging), so it *looks* like a full extension context
3. Chrome's documentation on offscreen API restrictions is sparse

**Context:** The offscreen document handles LLM streaming and the agent loop, both of which need the user's API key. The original approach was to read the key from `chrome.storage.local` directly in the offscreen document.

**Solution:** The **service worker** reads the API key from `chrome.storage.local` and injects it into the message payload before forwarding to the offscreen document. The UI sends messages *without* the API key (preventing key leakage via `chrome.runtime.sendMessage` broadcasts), and the service worker acts as a secure intermediary:

```
UI                          Service Worker                    Offscreen
│                           │                                 │
│─ LLM_REQUEST (no key) ──>│                                 │
│                           │─ chrome.storage.local.get() ──> │
│                           │<─ { apiKey: "sk-..." } ────────│
│                           │                                 │
│                           │─ LLM_REQUEST (with key) ──────>│
│                           │                                 │─ fetch(api.openai.com)
```

This pattern has a security benefit: API keys never appear in `chrome.runtime.sendMessage` broadcasts from the UI, which are visible to all extension contexts. Only the service worker (trusted) injects the key into the specific forwarded message.

**Available APIs in offscreen documents:** `chrome.runtime` (messaging only — `sendMessage`, `onMessage`, `id`, `getURL`). No `storage`, `tabs`, `scripting`, `sidePanel`, `action`, or other APIs.

**Key files:**
- `src/service-worker/message-router.ts` — `getApiKeyFromStorage()` reads key, `LLM_REQUEST` and `AGENT_RUN_START` handlers inject it
- `src/offscreen/index.ts` — receives key from `message.payload.apiKey`
- `src/shared/messages.ts` — `LLMRequestMessage` (no key, UI→SW) vs `LLMRequestWithKeyMessage` (with key, SW→offscreen)
