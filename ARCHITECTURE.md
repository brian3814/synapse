# Synapse — Architecture Document

## Overview

**Synapse** — a local-first knowledge graph with persistent SQLite storage, 2D graph visualization (custom Three.js InstancedMesh renderer), full CRUD operations, and LLM-powered entity extraction. The primary platform is **Electron desktop** with a vault-based workspace. The Chrome extension is **deprecated** (maintenance mode).

---

## Vault Architecture (Electron Desktop)

The Electron app uses a **Vault** — a single user-chosen directory containing all data. Users must create or open a vault before the app is usable.

```
<vault-root>/
├── .kg/                        ← app internals (hidden)
│   ├── config.json             ← vault identity (name, id, schemaVersion)
│   ├── graph.db                ← SQLite database (source of truth)
│   ├── embeddings/vec.db       ← sqlite-vec vector store
│   └── agent/                  ← agent memory & artifacts
├── notes/                      ← app-managed markdown (human-readable names)
│   ├── Machine Learning.md
│   └── Neural Networks.md
└── (user files anywhere)       ← auto-detected as resources by file watcher
    ├── papers/transformer.pdf
    └── screenshots/diagram.png
```

### Design Decisions

- **Graph-as-registry**: Graph DB is the source of truth. Filesystem is a projection. Nodes with files have `vault_path` set (vault-relative path).
- **Event-driven**: `VaultEventBus` connects graph mutations and filesystem changes. Handlers subscribe independently — new features add handlers without touching existing code.
- **Reconciliation on startup**: Walks filesystem, compares mtime/size against DB. Creates nodes for new files, updates metadata for modified, marks orphaned for missing.
- **Chrome deprecated**: No new features target Chrome. The `@platform` abstraction stays, Chrome code is untouched, but vault is Electron-only.

### Event Bus

All graph mutations in the `db:request` IPC handler emit vault events. Filesystem changes from the file watcher also emit events. Handlers run synchronously in try/catch — one failure doesn't block others. Reconciliation acts as the safety net for eventual consistency.

| Handler | Listens to | Action |
|---|---|---|
| `NoteFileHandler` | `node:created/updated/deleted` (type=note) | Write/rename/delete `.md` files in `notes/` |
| `ResourceDetectionHandler` | `file:added/removed` (outside `.kg/`, `notes/`) | Create/orphan resource nodes |
| `SyncBroadcastHandler` | All `node:*` and `edge:*` events | IPC to renderer for Zustand store updates |
| `EmbeddingHandler` (future) | `node:created/updated` | Queue for embedding via EmbeddingQueue |

### Vault Lifecycle

```
App launch → VaultManager.init()
  → check recentVaults in app settings
  → none → show VaultSetupScreen (create new / open existing)
  → found → VaultManager.open(lastUsedPath)
    → validate .kg/config.json
    → open graph.db (better-sqlite3)
    → run migrations
    → reconciliation scan
    → start file watcher
    → register event handlers
    → emit 'vault:opened'
```

### Multi-Vault

Single vault per process. The `VaultSwitcher` dropdown (left of search bar in header) shows the current vault name, recent vaults, and create/open options. Switching vaults launches a new Electron process via `app.relaunch({ args: ['--vault', path] })` — same model as Obsidian. On launch, `--vault <path>` auto-opens that vault before the window loads.

### Shared DB Handle

`VaultManager.open()` calls `resetBetterSQLite(dbPath)` to point the shared DB engine at the vault's `graph.db`, then calls `runMigrations()` directly (not via `dbHandleAction`). The vault context receives the handle from `getDb()` — it never opens its own connection. This ensures migrations complete before reconciliation runs.

### Key Files

| File | Purpose |
|---|---|
| `electron/vault/vault-manager.ts` | Singleton lifecycle: create, open, close, recent vaults |
| `electron/vault/vault-context.ts` | VaultContext interface + scaffoldVault helper |
| `electron/vault/event-bus.ts` | Typed `VaultEventBus` with per-handler error isolation |
| `electron/vault/file-watcher.ts` | Recursive `fs.watch` with ignore rules and 500ms debounce |
| `electron/vault/reconciliation.ts` | Startup mtime-based filesystem↔DB diff |
| `electron/vault/handlers/` | NoteFileHandler, ResourceDetectionHandler, SyncBroadcastHandler |
| `src/ui/components/VaultSetupScreen.tsx` | Full-screen gating UI |
| `src/ui/components/VaultSwitcher.tsx` | Header dropdown for vault switching |

---

## Chrome Extension Architecture (Deprecated)

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
|  |  |Zustand| |React UI  | |Three.js      |  |  | - Agent loop   |  |
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
| Framework | React 19 + TypeScript (strict) | Rich ecosystem |
| State | Zustand 5 | Minimal boilerplate, works outside React (message handlers) |
| Database | wa-sqlite + OPFS VFS | Only mature WASM SQLite with true filesystem persistence |
| Graph Viz | Three.js (custom renderer) | InstancedMesh batches to 1-2 draw calls; viewport windowing for 100k+ nodes |
| Graph Layout | Custom Web Worker | Barnes-Hut force-directed layout off main thread via Transferable Float32Array |
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
│   │   │   ├── migrations/         # Versioned schema migrations (FTS5 detection, spatial index)
│   │   │   └── queries/            # Typed CRUD, neighborhood traversal, spatial viewport queries
│   │   └── client/
│   │       ├── db-client.ts        # Promisified postMessage wrapper with timeouts
│   │       └── db-hooks.ts         # React hooks: useDbInit
│   ├── graph/
│   │   ├── renderer/                    # Custom Three.js graph renderer
│   │   │   ├── graph-renderer.ts        # Core: Scene, Camera, WebGLRenderer, animation loop, events
│   │   │   ├── node-mesh.ts             # InstancedMesh CircleGeometry nodes + RingGeometry selection
│   │   │   ├── edge-mesh.ts             # LineSegments edges + InstancedMesh ConeGeometry arrows
│   │   │   ├── label-layer.ts           # Canvas2D overlay for labels with frustum culling
│   │   │   ├── camera-controller.ts     # OrthographicCamera pan/zoom/fit, frustum change events
│   │   │   ├── hit-test.ts              # CPU distance-based node/edge picking
│   │   │   ├── spatial-hash.ts          # Grid-based spatial index for O(1) hit-test candidates
│   │   │   └── types.ts                 # RenderNode, RenderEdge, RenderTheme, FrustumBounds
│   │   ├── layout/
│   │   │   ├── force-layout.ts          # Velocity Verlet + Barnes-Hut quadtree O(n log n)
│   │   │   ├── layout-worker.ts         # Worker entry: sends Float32Array via Transferable
│   │   │   └── layout-runner.ts         # Main-thread API: creates worker, handles tick/done
│   │   ├── store/
│   │   │   ├── graph-store.ts           # Zustand: nodes/edges CRUD, DB sync
│   │   │   ├── ui-store.ts              # Zustand: display mode, layout, panels, chat, focusNodeCallback
│   │   │   ├── llm-store.ts             # Zustand: extraction pipeline state machine
│   │   │   ├── node-type-store.ts       # Node type definitions + auto-assigned colors
│   │   │   ├── viewport-store.ts        # Viewport windowing: zoom level, visible/cluster data
│   │   │   ├── extraction-review-store.ts # Ephemeral review session with undo/redo
│   │   │   └── reading-list-store.ts    # Zustand: reading list items, addItem (auto vault), fetchTitles, batch extraction
│   │   └── transforms/
│   │       └── cluster-to-render.ts     # Cluster summaries → RenderNode/RenderEdge for far zoom
│   ├── core/
│   │   ├── llm-protocol.ts         # Provider-neutral types: LLMMessage, StreamFn, LLMStreamResult
│   │   ├── agent-loop.ts           # Shared agent loop (injectable StreamFn + ToolExecutor)
│   │   ├── memory-extractor.ts     # Session summarization (accepts CommandContext, no @platform imports)
│   │   ├── system-prompts.ts       # Agent system prompts
│   │   ├── prompt-assembler.ts     # Memory + prompt assembly
│   │   ├── retry.ts                # withRetry (rate-limit aware)
│   │   └── usage.ts                # Token usage tracking
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
│   │   ├── llm-executor.ts         # Anthropic HTTP streaming + tool-use (types aliased from core/llm-protocol)
│   │   └── agent-loop.ts           # Chrome-specific agent loop wrapper (injects streamAnthropicWithTools)
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
│       │   │   ├── KnowledgeGraph.tsx    # Graph wrapper: windowed mode, event wiring, focusNodeCallback registration
│       │   │   ├── GraphCanvas.tsx       # Thin forwardRef wrapper over GraphRenderer
│       │   │   └── GraphControls.tsx     # Zoom, fit-to-view controls
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
│       │   ├── reading-list/
│       │   │   ├── ReadingListPanel.tsx    # Tab view (pending/processing/ready), batch select, filter
│       │   │   ├── ReadingListItemCard.tsx # Item card with timeAgo, HTTP indicator, merge actions
│       │   │   ├── ReadingListHistory.tsx  # Merged items history view
│       │   │   └── AddUrlModal.tsx         # Multi-URL paste modal with live validation preview
│       │   ├── chat/
│       │   │   ├── ChatBot.tsx            # Chat container: float/sidebar, input history, node link click handler
│       │   │   └── ChatMessage.tsx        # Message bubble: markdown, copy button, node: link rendering
│       │   └── settings/SettingsPanel.tsx
│       └── hooks/
│           ├── useDisplayMode.ts    # Side panel vs tab detection + toggle
│           ├── useGraphData.ts      # Store -> RenderNode/RenderEdge transform
│           ├── useViewportSync.ts   # Camera frustum → DB query → incremental renderer updates
│           ├── useChatQuery.ts      # RAG-augmented chat: retrieve context → LLM stream → display
│           ├── useInputHistory.ts   # ArrowUp/Down input recall (max 50, ref-based, no re-renders)
│           ├── rag-pipeline.ts      # Search → expand subgraph → fetch sources → format prompt with node IDs
│           └── useLLMExtraction.ts
```

---

## Build System

The Vite config uses **six custom plugins** to handle Chrome extension requirements:

```
vite.config.ts
├── react()                  # @vitejs/plugin-react
├── tailwindcss()            # @tailwindcss/vite
├── fixHtmlPlugin()          # Moves HTML to dist root, fixes asset paths
├── dbWorkerPlugin()         # Separate ES module build for db-worker.js + wa-sqlite WASM
├── dbSharedWorkerPlugin()   # Separate ES module build for db-shared-worker.js
├── layoutWorkerPlugin()     # Separate ES module build for layout-worker.js
└── contentScriptPlugin()    # Separate IIFE build for content-script.js
```

**Multi-entry build:** The main Vite build produces three entries — the React SPA (`index.html`), the service worker (`service-worker.js`), and the offscreen document (`offscreen.js`). Four additional `closeBundle` plugins run separate Vite builds for the DB dedicated worker, DB shared worker, layout worker (all ES modules), and content script (IIFE).

**Key config decisions:**
- `base: ''` — relative asset paths (Chrome extension URLs are `chrome-extension://id/...`)
- `modulePreload: false` — prevents Vite from injecting a polyfill that references `document`, which crashes the service worker
- `minify: false` + `sourcemap: true` — currently enabled for debugging

**Resolve aliases:**
- `@` → `src/` for clean imports

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
│   (compact)          │             │   (full)          │ (400px)     │
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

## Graph Renderer (Three.js)

Custom renderer in `src/graph/renderer/` with zero React dependency. Replaces Reagraph, which used per-element Three.js meshes and troika-three-text (blocked by extension CSP — see Pitfall #1). The custom renderer uses InstancedMesh to batch all nodes into 1-2 draw calls.

### Rendering Architecture

```
GraphRenderer (graph-renderer.ts)
├── THREE.WebGLRenderer + Scene + OrthographicCamera
├── NodeMesh (node-mesh.ts)
│   ├── InstancedMesh<CircleGeometry>     # All nodes in 1 draw call
│   ├── InstancedMesh<RingGeometry>       # Selection ring (0-1 instances)
│   ├── Per-instance: color, opacity via InstancedBufferAttribute
│   └── Slot pool: freeSlots[] for incremental add/remove
├── EdgeMesh (edge-mesh.ts)
│   ├── LineSegments<BufferGeometry>      # All edges in 1 draw call
│   ├── InstancedMesh<ConeGeometry>       # Directed arrows
│   ├── Per-vertex color via BufferAttribute
│   └── Slot pool: same free-list pattern as NodeMesh
├── LabelLayer (label-layer.ts)
│   ├── Separate Canvas2D overlay (not a Three.js object)
│   ├── Projects world coords to screen via camera frustum
│   ├── Frustum culling + max 200 labels + zoom gating
│   └── Independent dirty tracking (world bounds + node count)
├── CameraController (camera-controller.ts)
│   ├── Symmetric OrthographicCamera frustum (position via view matrix only)
│   ├── Pan, zoom-to-cursor, fit-to-view, fit-to-region
│   └── onFrustumChange callback for viewport windowing
├── SpatialHash (spatial-hash.ts)
│   └── Grid-based O(1) candidate lookup for hit-testing
└── Animation loop
    ├── 3D render gated by needsRender dirty flag
    └── Labels called every frame (internal dirty tracking)
```

**React integration:** `GraphCanvas.tsx` is a thin `forwardRef` wrapper. Zustand `.subscribe()` pushes data imperatively — no React re-renders during interactions. Graph container uses `absolute inset-0` positioning with `min-h-0` on flex parents.

### Layout

Layout runs in a Web Worker (`src/graph/layout/`):
- **`force-layout.ts`** — Velocity Verlet integration + Barnes-Hut quadtree for O(n log n) repulsion
- **`layout-worker.ts`** — Worker entry; sends Float32Array positions via Transferable (zero-copy)
- **`layout-runner.ts`** — Main-thread API; creates worker, handles tick/done messages

Pin/unpin support for node dragging during live simulation. Positions are persisted to SQLite after layout completes and after each drag-end (fire-and-forget).

---

## Viewport-Windowed Rendering

For graphs with 10k+ nodes, the renderer uses viewport windowing — only nodes visible in the camera frustum are loaded from SQLite and rendered. Small graphs (<10k nodes) bypass windowing entirely.

### Semantic Zoom Levels

| Zoom Level | Threshold | What's Shown |
|---|---|---|
| `far` | zoom < 0.15 | Cluster summaries (one node per type, sized by count) |
| `medium` | 0.15 ≤ zoom < 1.5 | Individual nodes, no labels, no arrows |
| `close` | zoom ≥ 1.5 | Full detail: nodes + labels + directed arrows |

### Data Flow

```
Camera frustum change (debounced 100ms)
  → useViewportSync hook determines zoom level
  → far:    query cluster summaries from DB (cached)
  → medium/close: spatial viewport query (nodes in bounds + padding)
  → diff against current visible set
  → small diff: incremental addNodes/removeNodes/addEdges/removeEdges
  → large diff: full setGraphData swap
```

### Spatial Queries

`src/db/worker/queries/spatial-queries.ts` provides:

| Function | Purpose |
|---|---|
| `getNodesInBounds(minX,minY,maxX,maxY,limit)` | Viewport query with `idx_nodes_xy` index |
| `getEdgesForVisibleNodes(nodeIds[])` | Edges where both endpoints are visible |
| `getClusterSummary()` | `GROUP BY type` with centroid + count |
| `getInterClusterEdges()` | Edge counts between type pairs |
| `batchUpdatePositions(updates[])` | Persist layout positions (500/batch) |
| `getTotalNodeCount()` | Small-graph bypass check |

### Incremental InstancedMesh Updates

Both `NodeMesh` and `EdgeMesh` use a slot-pool pattern for O(1) add/remove without full rebuild:
- **Add:** pop from `freeSlots[]` stack or append to end
- **Remove:** zero-scale the transform matrix, push index to `freeSlots[]`
- **Compact:** trim trailing free slots to prevent unbounded GPU instance count
- **Grow:** double capacity when full, copy existing transforms/attributes to new InstancedMesh

### Viewport Store

`viewport-store.ts` (Zustand) tracks: `zoomLevel`, `frustumBounds`, `rawZoom`, `visibleNodes`, `visibleEdges`, `clusterNodes`, `clusterEdges`, `totalNodeCount`, `windowed`, `queryInFlight`.

The `windowed` flag gates the entire viewport pipeline. When false, all data is loaded at once via the existing `setGraphData` path.

---

## Agent Loop for Page Extraction

The extension supports an agentic LLM extraction mode that inspects the current page DOM via tool calls to extract knowledge graph entities. The LLM call path is provider-neutral: `src/core/llm-protocol.ts` defines `LLMMessage`, `ContentBlock`, `LLMStreamResult`, and `StreamFn`. The Electron main process (`electron/llm-backend.ts`) routes calls through a provider factory (`getStreamFn(provider)`) — currently Anthropic, with the interface ready for OpenAI/Gemini/local adapters via `registerStreamFn()`.

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

## Chat Interface (RAG Q&A)

A floating or sidebar chat for querying the knowledge graph via RAG-augmented LLM responses.

### Data Flow

```
User question
  → extractSearchTerms (stop-word filter + quoted phrases)
  → FTS5/LIKE search for matching nodes
  → expandSubgraph (1-hop connected edges + neighbors)
  → getSourceExcerpts (stored page content, 1000 char limit)
  → formatRAGPrompt (entities with node IDs, relationships, sources)
  → LLM streaming response
  → markdown rendering with clickable node links
```

### Node Links

The RAG prompt includes node IDs in entity listings (`(id:abc-123)`) and instructs the LLM to reference entities as `[Entity Name](node:entity-id)`. The markdown renderer detects `node:` URLs and renders them as emerald-colored buttons. Clicking triggers `focusNodeCallback` (registered by `KnowledgeGraph.tsx`) which calls `selectNode` + `fitToView([nodeId])` to navigate the graph canvas.

### Key Components

| Component | Purpose |
|---|---|
| `ChatBot.tsx` | Container: float/sidebar modes, input history (ArrowUp/Down), node link click handler |
| `ChatMessage.tsx` | Message bubbles: markdown renderer, hover-to-reveal copy button, `node:` link rendering |
| `useChatQuery.ts` | Hook: orchestrates RAG retrieval → LLM stream → message state |
| `useInputHistory.ts` | Ref-based input history (max 50), no re-renders |
| `rag-pipeline.ts` | Search → expand → fetch sources → format prompt |
| `ui-store.focusNodeCallback` | Bridge: chat node clicks → graph canvas select + zoom |

---

## Reading List

A URL-based ingestion pipeline for web content. Users add URLs → content is extracted → entities are reviewed and merged into the knowledge graph.

### Data Flow

```
Add URLs (modal)
  → items stored in PlatformStorage with status 'pending'
  → async title fetch: HTML <title> parse, LLM fallback for missing/bad titles
  → user triggers extraction (single or batch)
  → fetch page HTML via IPC → LLM extracts summary + entities + relationships
  → item moves to 'ready' status
  → user reviews extracted entities via DiffView
  → merge into graph DB
  → item marked 'complete', appears in history
```

### Add URL Modal

`AddUrlModal` supports multi-URL paste (one per line) with live validation:
- URL parsing: auto-prepend `https://`, validate via `new URL()`, detect `http://` (insecure)
- Duplicate detection: exact match against existing items in store + within-batch dedup
- Live preview: per-URL status indicators (valid, insecure, duplicate, invalid)
- Submit: adds items with domain as placeholder title, kicks off `fetchTitles()` in background

### Async Title Extraction

After adding URLs, `fetchTitles()` processes each URL sequentially (~500ms delay between):
1. Fetch HTML via `electronIPC.invoke('fetch-url-content', url)`
2. Parse `<title>` tag via `DOMParser`
3. Quality check: reject empty, domain-matching, or generic error titles ("404", "page not found", etc.)
4. LLM fallback: generate ~5-8 word title from first 2000 chars of page content
5. Store resolved title in `item.pageTitle`, persist to storage

### Vault Resolution

The store's `addItem(url, title)` resolves the vault internally via `vaultWorkspace.getStatus()`. No vault selection in the UI — the app is vault-gated (`App.tsx`), so a vault is always open when the reading list is reachable.

### Companion Extension Path

The Chrome companion extension adds URLs via HTTP POST to `127.0.0.1:19876/api/reading-queue`. The companion server broadcasts to renderer windows via IPC. `useCompanionCapture` hook writes items directly to storage (bypasses `addItem`). Title comes from `document.title` in Chrome — no async title extraction.

### Item States

| Status | Meaning |
|---|---|
| `pending` | Added, awaiting extraction |
| `processing` / `fetching` / `extracting` | Extraction in progress |
| `ready` / `extracted` | Extraction complete, awaiting review |
| `failed` | Extraction error (retryable) |
| `complete` | Merged into graph, shown in history |

### Key Files

| File | Purpose |
|---|---|
| `src/graph/store/reading-list-store.ts` | Zustand store: items, addItem (auto vault), fetchTitles, batch extraction |
| `src/ui/components/reading-list/AddUrlModal.tsx` | Multi-URL paste modal with live validation preview |
| `src/ui/components/reading-list/ReadingListPanel.tsx` | Tab view (pending/processing/ready), batch select, filter |
| `src/ui/components/reading-list/ReadingListItemCard.tsx` | Item card: timeAgo (weeks/months), HTTP indicator, merge actions |
| `src/ui/components/reading-list/ReadingListHistory.tsx` | Merged items history |
| `src/ui/hooks/useReadingListMerge.ts` | Merge extracted entities into graph DB |
| `src/ui/hooks/useCompanionCapture.ts` | IPC listener for companion extension URL adds |

---

## Agent Settings Panel

User-configurable agent behavior via Settings → Agent tab. Hybrid storage model:

- **App-level** (`PlatformStorage`): Prompt customization (`agentPromptConfig`) and tool toggles (`agentToolConfig`). Extraction and chat agents have independent custom instructions (append-only) and per-tool enable/disable toggles.
- **Vault-level** (`.kg/agent-config.json`): Sandbox rules — directory allowlist and extension blocklist. Enforced in `VaultFileWatcher` and `ResourceDetectionHandler`.

Tool filtering happens at call time: `AGENT_TOOLS` filtered in `agent-loop.ts`, `CHAT_AGENT_TOOLS` filtered in `chat-agent-loop.ts`. `save_entities` is never filterable.

---

## Agent Memory System

Governed memory with modular retrieval pipeline. Files in `.kg/agent/memory/` are the source of truth with extended YAML frontmatter (`tags`, `valid`, `superseded_by`, `access_count`, `last_accessed`).

### Write Path

The agent self-governs via system prompt rules (Memory Guidelines). The `manage_memory` tool accepts `tags` for retrieval keywords and `supersedes` to replace an old memory (marks it `valid: false`). Episodic summaries (session end) write to files (`episodic_{date}-{slug}.md`) with richer LLM output (JSON: summary + tags + slug).

### Read Path

```
User query → loadValidMemories() → metadata retriever → RRF fuser → annotated formatter → prompt
```

The metadata retriever scores memories by: tag match (×2.0), content word match (×1.0), recency (+0.5), access frequency (+0.3), instruction type (+0.2). Falls back to top-3 by access count when nothing matches. Output format: `- [type, ★★★] content` with 3-tier confidence stars.

The pipeline is pluggable — a vector retriever (Phase 2) can be added alongside metadata retrieval with RRF fusion combining both signal sources.

### Key Files

| File | Purpose |
|---|---|
| `src/memory/types.ts` | Pipeline interfaces: `MemoryRetriever`, `MemoryFuser`, `MemoryFormatter` |
| `src/memory/pipeline.ts` | `retrieveMemories()` runner |
| `src/memory/retrievers/metadata-retriever.ts` | Tag/keyword scoring |
| `src/memory/fusers/rrf-fuser.ts` | Reciprocal rank fusion (k=60) |
| `src/memory/formatters/annotated-formatter.ts` | Confidence-annotated output |
| `src/memory/governance.ts` | `markSuperseded()`, `updateAccessStats()` |
| `src/commands/memory-commands.ts` | `MemoryEntry` type, file I/O, `loadValidMemories()` |
| `src/core/prompt-assembler.ts` | `assembleSystemPrompt()` with `memoryContext` + Memory Guidelines |

---

## MCP & Tool Registry

Synapse integrates with the Model Context Protocol (MCP) ecosystem as both a client and server, built on a unified ToolRegistry that replaces direct tool execution with a provider-based architecture.

### Architecture

```
Renderer (React)
  │  tools:list / tools:execute IPC
  ▼
Main Process — ToolRegistry (singleton)
  ├── BuiltinToolProvider (existing chat tools, direct DB access)
  ├── McpToolProvider("github")  (JSON-RPC → stdio subprocess)
  ├── McpToolProvider("postgres") (JSON-RPC → HTTP)
  └── (future: PluginToolProvider → sandboxed child process)

McpClientManager             McpServerBridge
  manages outbound            exposes graph inbound
  MCP connections             via HTTP (:19876/mcp) + stdio CLI
```

### Tool Registry

Central registry for all tool providers. The renderer never calls `executeTool()` directly — it invokes `tools:execute` IPC which routes through the registry by namespace.

**Namespace convention:** Double underscore `__` separator. `"github__create_issue"` → provider `mcp:github`, tool `create_issue`. No separator → `builtin` provider.

**IPC channels** (registered once at startup with getter closures):
- `tools:list` — returns merged tool definitions (built-in + MCP, filtered by `ToolFilter`)
- `tools:execute` — dispatches to provider by namespace, returns `ToolResult`
- `tools:on-changed` — broadcast when tool list changes
- `mcp:list-servers` / `mcp:connect-server` / `mcp:disconnect-server` — MCP client management
- `mcp:server-status-changed` — broadcast on connection state change

**Lifecycle:** Registry initialized in `registerVaultHandlers()` after vault opens, disposed in `unregisterVaultHandlers()` on vault close/switch. IPC handlers are registered once at startup and use getters to access the current instance.

### MCP Client (Consuming External Servers)

`McpClientManager` spawns stdio child processes for configured MCP servers, runs the initialize handshake, discovers tools via `client.listTools()`, and registers `McpToolProvider` instances with the registry.

**Configuration (two-layer merge):**
- Global: `~/Library/Application Support/kg-desktop/mcp-config.json`
- Vault: `.kg/mcp.json` (overrides/extends global, can disable global servers)
- Secrets: `${secret:name}` placeholders resolved from `mcp-secrets.json` / `.kg/secrets.json`

```json
{
  "mcpServers": {
    "github": {
      "transport": "stdio",
      "command": "npx",
      "args": ["-y", "@modelcontextprotocol/server-github"],
      "env": { "GITHUB_TOKEN": "${secret:github-token}" }
    }
  }
}
```

### MCP Server (Exposing Graph to External Agents)

Two transports serve the same tool set (31 tools total: 16 core + 15 extended):

**HTTP (Streamable HTTP):** `McpServerBridge` adds an `/mcp` endpoint to the companion server (`127.0.0.1:19876`). Always active when a vault is open. Access profile in `.kg/mcp-server.json` controls read/write permissions (read-only by default).

**stdio CLI (`packages/synapse-mcp/`):** Standalone binary that opens vault DB directly via better-sqlite3. No Electron needed. Supports multi-vault (`--vault /a --vault /b`), auto-discovery from recent vaults, and `--allow-write` flag for write operations.

```bash
# Claude Desktop config (stdio)
{ "mcpServers": { "synapse": { "command": "node", "args": ["packages/synapse-mcp/dist/index.js", "--vault", "/path", "--allow-write"] } } }
```

**Desktop Extension packaging:** `packages/synapse-mcp/manifest.json` defines a Claude Desktop Extension. Users install via `.mcpb` file — no manual JSON config needed. Build: `cd packages/synapse-mcp && npm run pack`.

### Real-Time Graph Sync

External MCP writes must update the running app's graph canvas immediately:

```
HTTP bridge:  tool execution → onGraphMutated() → BrowserWindow.send('db:sync', {type:'reset'})
stdio CLI:    tool execution → notifyApp() → POST 127.0.0.1:19876/api/graph-changed → same broadcast
Both paths:   → graph-store.loadAll() → canvas re-renders
```

The companion server's `/api/graph-changed` endpoint receives fire-and-forget POSTs from the stdio CLI after successful write operations. This bridges the gap between the CLI (which opens its own SQLite connection) and the Electron renderer (which needs to know data changed).

### Extended Tool Modules

Tools are organized in two layers for high cohesion / loose coupling:

```
src/commands/tools/
├── types.ts          — ToolModule interface
├── note-tools.ts     — read_note, create_note, update_note, list_notes, search_notes
├── edge-tools.ts     — update_edge, delete_edge, get_edges_between
├── graph-tools.ts    — get_graph_overview, get_subgraph, get_nodes_by_type
├── entity-tools.ts   — find_similar_entities, add_alias, get_aliases, tag_node, get_node_tags
└── index.ts          — aggregator: EXTENDED_TOOL_DEFINITIONS + executeExtendedTool()
```

Each module exports `definitions` (schemas) + `execute(ctx, name, input)` returning `null` for unhandled tools. The main executor (`chat-tool-executor.ts`) delegates to `executeExtendedTool()` as a fallback after core tools. Adding a new module = create file + add one import in `index.ts`.

### Modularity Principle

Each component is independently removable:
- Remove in-app agent → registry + MCP server still expose tools
- Remove MCP client → built-in tools and MCP server unaffected
- Remove MCP server → in-app agent and MCP client unaffected
- Remove a tool module → one import change in `src/commands/tools/index.ts`

The in-app agent is just another consumer of the registry (calls `tools:execute` IPC). It can be replaced with an embedded MCP client without architectural changes.

### Key Files

| File | Purpose |
|---|---|
| `electron/mcp/types.ts` | `ToolProvider`, `IToolRegistry`, config interfaces |
| `electron/mcp/tool-registry.ts` | Registry singleton with namespace dispatch |
| `electron/mcp/builtin-tool-provider.ts` | Wraps `ALL_CHAT_AGENT_TOOLS` + `executeTool()` |
| `electron/mcp/main-process-context.ts` | Creates `CommandContext` with direct DataStore |
| `electron/mcp/mcp-client-manager.ts` | Manages outbound stdio connections |
| `electron/mcp/mcp-tool-provider.ts` | `ToolProvider` for a single MCP server |
| `electron/mcp/mcp-server-bridge.ts` | HTTP MCP server with `onGraphMutated` callback |
| `electron/mcp/mcp-config.ts` | Config loading, merging, secret resolution |
| `electron/mcp/mcp-ipc.ts` | IPC handler registration |
| `packages/synapse-mcp/` | Standalone stdio CLI + Desktop Extension manifest |
| `src/commands/tools/` | Extended tool modules (note, edge, graph, entity) |

---

## Pitfalls Encountered and Solutions

### Pitfall #1: Troika Blob URL Workers Blocked by Chrome Extension CSP

> **Historical:** This pitfall applied to Reagraph, which has been replaced by a custom Three.js renderer that does not depend on troika.

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

### Pitfalls #8–#10: Reagraph-Specific Issues (Historical)

> These pitfalls applied to Reagraph, which has been replaced by a custom Three.js renderer. Retained for reference.

- **#8: Clustering only works with force-directed layouts** — Reagraph threw if `clusterAttribute` was passed with non-force layouts. Fixed by conditionally passing the prop.
- **#9: WebGL canvas zero height in flexbox** — Reagraph's internal `position: absolute; inset: 0` needed explicit parent dimensions. Fixed with `min-h-0` + `absolute inset-0` wrapper. (The CSS pattern still applies to the custom renderer.)
- **#10: `sizingType="attribute"` without `sizingAttribute`** — Caused unexpected node sizes. Fixed by using `sizingType="default"`.

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
