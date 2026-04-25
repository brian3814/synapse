# KG Extension — Architecture Deep Dive

Chrome Manifest V3 knowledge graph extension: local-first SQLite (wa-sqlite + OPFS), Three.js graph rendering, LLM-powered entity extraction with agentic tool use.

---

**Table of Contents**

1. [Execution Contexts & Build Outputs](#1-execution-contexts--build-outputs)
2. [High-Level Architecture Diagram](#2-high-level-architecture-diagram)
3. [Message Passing System](#3-message-passing-system)
4. [Database Layer (SQLite + OPFS)](#4-database-layer-sqlite--opfs)
5. [Data Flow: UI → DB Round-Trip](#5-data-flow-ui--db-round-trip)
6. [Zustand Store Architecture](#6-zustand-store-architecture)
7. [LLM Extraction Pipeline](#7-llm-extraction-pipeline)
8. [Agent Loop & Tools](#8-agent-loop--tools)
9. [Data Flow: Extraction → Database (Full Trace)](#9-data-flow-extraction--database-full-trace)
10. [Cross-Tab Synchronization](#10-cross-tab-synchronization)
11. [Database Schema Reference](#11-database-schema-reference)

---

## 1. Execution Contexts & Build Outputs

The extension runs across **7 isolated execution contexts**, each with different capabilities and API access. Vite produces separate bundles for each via custom plugins.

| Context | Entry File | Build Output | Format | Key Capabilities | Key Restriction |
|---------|-----------|-------------|--------|-----------------|----------------|
| **Service Worker** | `src/service-worker/index.ts` | `dist/service-worker.js` | IIFE | chrome.storage, chrome.tabs, chrome.contextMenus, chrome.offscreen, chrome.identity | No DOM. No long-running tasks (5-min idle timeout). No dynamic imports. |
| **UI (Side Panel / Tab)** | `src/ui/main.tsx` | `dist/index.html` + `dist/assets/*.js` | ES modules | Full DOM, React 19, Zustand, Three.js, WebWorker creation | Cannot read chrome.storage for sensitive data (API keys). Uses `?mode=sidePanel\|tab` URL param. |
| **Offscreen Document** | `src/offscreen/index.ts` | `dist/offscreen.js` | IIFE | DOM + fetch (long-running). LLM API calls, agent loops. | No chrome.storage, no chrome.tabs. Receives API keys via message payload. |
| **Content Script** | `src/content-script/index.ts` | `dist/content-script.js` | IIFE | Per-page isolated world. Full DOM access to host page. | No chrome.storage. Runs on every page (`<all_urls>`). |
| **DB SharedWorker** | `src/db/worker/db-shared-worker.ts` | `dist/db-shared-worker.js` | ES module | Port coordinator across tabs. BroadcastChannel sync. | Pure router — no Worker constructor, no chrome.* APIs. |
| **DB Dedicated Worker** | `src/db/worker/db-worker.ts` | `dist/db-worker.js` | ES module | wa-sqlite + OPFS. Runs all SQL. Schema migrations. | No chrome.* APIs. Created by UI thread, bridged to SharedWorker via MessageChannel. |
| **Layout Worker** | `src/graph/layout/layout-worker.ts` | `dist/layout-worker.js` | ES module | Barnes-Hut force-directed layout. Sends Float32Array positions via Transferable. | No DOM, no chrome.* APIs. |

> **CSP constraint:** `script-src 'self' 'wasm-unsafe-eval'` blocks all `blob:` URLs. Workers are loaded as separate entry files via `new URL('/worker.js', location.origin)` instead of inline blobs.

---

## 2. High-Level Architecture Diagram

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                  Chrome Runtime (chrome.runtime.sendMessage)                 │
│                                                                             │
│  ┌──────────────────┐    ┌───────────────────┐    ┌──────────────────────┐ │
│  │  Service Worker   │    │ Offscreen Document │    │   Content Script     │ │
│  │  message-router.ts│    │ llm-executor.ts    │    │   tool-executor.ts   │ │
│  │                   │    │ agent-loop.ts      │    │   page-extractor.ts  │ │
│  │ • Routes messages │    │                    │    │                      │ │
│  │ • Injects API keys│    │ • Anthropic API    │    │ • Executes agent     │ │
│  │ • Usage tracking  │    │   streaming        │    │   tools on page      │ │
│  │ • Retry logic     │    │ • Agent tool-use   │    │ • DOM extraction     │ │
│  │ • Context menus   │    │   loop             │    │   (text/markdown)    │ │
│  │ • OAuth mgmt      │    │ • Reading list     │    │ • CSS selectors      │ │
│  │ • Offscreen       │    │   extraction       │    │ • Tables / JSON-LD   │ │
│  │   lifecycle       │    │ • Chat LLM w/tools │    │ • Page terms         │ │
│  │                   │    │ • ChunkBuffer      │    │ • Runs on every page │ │
│  │                   │    │ • No chrome.storage │    │                      │ │
│  └────────┬──────────┘    └─────────┬──────────┘    └──────────┬───────────┘ │
│           │  LLM_REQUEST_WITH_KEY→  │                          │             │
│           │  ←LLM_STREAM_CHUNK      │                          │             │
│           │         TOOL_EXECUTE (via chrome.tabs.sendMessage) →│             │
└───────────┼─────────────────────────┼──────────────────────────┼─────────────┘
            │ LLM_REQUEST (no key) ↑  │                          │
            │ AGENT_PROGRESS ↓        │                          │
┌───────────┼─────────────────────────┼──────────────────────────┼─────────────┐
│           ▼                         │                          │             │
│  ┌────────────────────────────────────────────┐  ┌───────────────────────┐  │
│  │  React UI (Zustand Stores)                  │  │  Zustand Stores       │  │
│  │  ┌─ Header ─── toolbar, search ──────────┐  │  │  • graph-store        │  │
│  │  │ KnowledgeGraph (Three.js InstancedMesh)│  │  │  • ui-store           │  │
│  │  │ ActivePanel (detail/LLM/notes/settings)│  │  │  • llm-store          │  │
│  │  │ ChatBot (float FAB or sidebar)         │  │  │  • extraction-review  │  │
│  │  │ ExtractionReview (diff/merge/undo-redo)│  │  │  • node-type-store    │  │
│  │  └────────────────────────────────────────┘  │  │  • viewport/auth/tag  │  │
│  └──────────────┬───────────────────────────────┘  └───────────────────────┘  │
│  UI Thread      │ sendRequest(action, params)                                 │
│  (Side Panel    │                         ┌──────────────────────┐            │
│   or Tab)       │                         │  OPFS Note Store     │            │
│                 │                         │  notes/{nodeId}.md   │            │
│                 │                         │  Direct UI thread R/W│            │
│                 │                         └──────────────────────┘            │
└─────────────────┼────────────────────────────────────────────────────────────┘
                  │
┌─────────────────┼────────────────────────────────────────────────────────────┐
│  Worker Threads │ (postMessage / MessageChannel)                             │
│                 ▼                                                             │
│  ┌─────────────────────────┐    ┌──────────────────────────┐                │
│  │  DB SharedWorker         │    │  DB Dedicated Worker      │                │
│  │  db-shared-worker.ts     │───→│  db-worker.ts             │                │
│  │                          │    │  sqlite-engine.ts          │                │
│  │  • Routes requests by    │    │                            │                │
│  │    requestId             │    │  • wa-sqlite WASM (OPFS)   │                │
│  │  • Manages worker        │    │  • Serial promise queue    │                │
│  │    lifecycle             │    │  • 60+ action handlers     │                │
│  │  • Broadcasts SyncEvents │    │                            │   ┌──────────┐│
│  │    via BroadcastChannel  │    │          │                 │   │  Layout  ││
│  └──────────────────────────┘    │          ▼                 │   │  Worker  ││
│                                  │  ┌──────────────────┐      │   │          ││
│  ┌────────────────────────────┐  │  │  SQLite (OPFS)   │      │   │  Barnes- ││
│  │ BroadcastChannel           │  │  │  kg_extension.db │      │   │  Hut     ││
│  │ ('kg_extension_sync')      │  │  │  WAL mode        │      │   │  O(nlogn)││
│  │                            │  │  │  VFS: OPFS→IDB   │      │   │  Float32 ││
│  │ node_created|node_updated  │  │  │       →memory    │      │   │  Array   ││
│  │ edge_*|reset               │  │  └──────────────────┘      │   └──────────┘│
│  │  ──→ syncs to all tabs     │  └────────────────────────────┘               │
│  └────────────────────────────┘                                               │
└──────────────────────────────────────────────────────────────────────────────┘
```

---

## 3. Message Passing System

Two independent communication channels:

- **Chrome Runtime** (`chrome.runtime.sendMessage`) — between Service Worker, Offscreen, Content Script, and UI. Broadcasts reach all extension contexts.
- **Worker Protocol** (`postMessage` / `MessageChannel`) — between UI thread, SharedWorker, and Dedicated Worker. Private point-to-point.

### 3.1 Chrome Runtime Message Types

| Message Type | Direction | Purpose |
|---|---|---|
| `LLM_REQUEST` | **UI** → **SW** | Request LLM extraction (no API key) |
| `LLM_REQUEST_WITH_KEY` | **SW** → **Offscreen** | Same request with API key injected by SW |
| `LLM_STREAM_CHUNK` | **Offscreen** → broadcast | Streaming text chunk (or final w/ `done=true`) |
| `AGENT_RUN_START` | **UI** → **SW** | Start agentic page extraction (no key) |
| `AGENT_RUN_START_WITH_KEY` | **SW** → **Offscreen** | Same with key injected |
| `AGENT_PROGRESS` | **Offscreen** → broadcast | Agent events: `llm_start`, `llm_chunk`, `tool_call`, `tool_result`, `extraction_complete`, `done`, `error` |
| `TOOL_EXECUTE` | **Offscreen** → **SW** → **CS** | Execute agent tool on page (via `chrome.tabs.sendMessage`) |
| `CHAT_LLM_REQUEST` | **UI** → **SW** | Chat request with tool-use |
| `CHAT_LLM_STREAM` | **Offscreen** → broadcast | Chat response chunks + tool calls |
| `PAGE_CONTENT` | **CS** → **SW** | Extracted page text (context menu trigger) |
| `EXTRACT_PAGE` | **SW** → **CS** | Tell content script to extract full page |
| `GET_PAGE_CONTENT_QUICK` | **SW** → **CS** | Quick content fetch for extraction |
| `TOGGLE_DISPLAY_MODE` | **UI** → **SW** | Switch between side panel / tab mode |
| `OAUTH_START/CHECK/REVOKE` | **UI** ↔ **SW** | OAuth flow management |
| `READING_LIST_EXTRACT` | **SW** → **Offscreen** | Extract reading list item |

### 3.2 API Key Security Pattern

```
                  LLM_REQUEST (no key)           + apiKey from storage
  ┌──────┐  ─────────────────────────→  ┌────────────────┐  ──────────────→  ┌───────────┐
  │  UI  │                              │ Service Worker  │                   │ Offscreen  │
  └──────┘                              └────────────────┘                   └───────────┘

  SW reads chrome.storage.local → injects apiKey → forwards
  Key NEVER appears in UI messages (prevents leakage via broadcast)
```

### 3.3 Worker Protocol (DB Layer)

```typescript
// Request envelope
interface WorkerRequest {
  requestId: string;   // "${Date.now()}-${random}"
  action: string;      // e.g. 'nodes.create', 'edges.update', 'loadGraph'
  params?: unknown;
}

// Response envelope
interface WorkerResponse {
  requestId: string;   // echoed back for matching
  success: boolean;
  data?: unknown;
  error?: string;
  syncEvent?: SyncEvent;  // broadcast to all tabs
}
```

---

## 4. Database Layer (SQLite + OPFS)

### 4.1 Worker Initialization Sequence

```
  UI Thread (Tab 1)           SharedWorker              DedicatedWorker
       │                           │                          │
       │  1. initDbClient()        │                          │
       │─────────────────────────→ │                          │
       │                           │                          │
       │  2. { needsWorker: true } │                          │
       │ ←─────────────────────────│                          │
       │                           │                          │
       │  3. spawn new Worker('/db-worker.js') + MessageChannel
       │──────────────────────────────────────────────────── →│
       │                           │                          │
       │  4. transfer port2 to DedicatedWorker                │
       │─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─→ │
       │                           │                          │
       │  5. transfer port1 to SharedWorker                   │
       │─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─→ │                          │
       │                           │                          │
       │                           │  6. init → run migrations│
       │                           │─────────────────────────→│
       │                           │                          │
       │                           │                    [SQLite init]
       │                           │                    OPFS VFS probe
       │                           │                    WAL + FK pragmas
       │                           │                          │
       │                           │          7. ready        │
       │                           │ ←────────────────────────│
       │                           │                          │
       │   8. ready (subsequent tabs reuse existing worker)   │
       │ ←─────────────────────────│                          │
       │                           │                          │

  If owning tab closes: SharedWorker pings, detects death,
  asks next surviving tab to spawn replacement.
```

### 4.2 SQLite Engine

`src/db/worker/sqlite-engine.ts`

**VFS Fallback Chain** (in probe order):

1. **OPFS** — Origin Private File System. Highest performance. Probed via `createSyncAccessHandle()`.
2. **IDB** — IndexedDB Batch Atomic VFS. Fallback for environments where OPFS sync API unavailable.
3. **In-Memory** — Last resort. No persistence.

**Serial Promise Queue:** All `exec()` and `query()` calls are serialized through a single promise chain to prevent wa-sqlite Asyncify state corruption from concurrent operations.

```typescript
queue: Promise = Promise.resolve()

serialize<T>(fn: () => Promise<T>): Promise<T> {
  this.queue = this.queue.then(fn);
  return this.queue;
}
// Every SQL operation passes through serialize() — never parallel
```

**Retry strategy:** SQLITE_BUSY errors (concurrent writes) retry with 100ms x (attempt + 1) backoff, max 3 retries. All other errors fail immediately.

---

## 5. Data Flow: UI → DB Round-Trip

Every database operation follows this path:

```
                    MessagePort      MessagePort      serialize()
  ┌────────────┐  ───────────→  ┌──────────────┐  ───────────→  ┌─────────────────┐  ──→  ┌────────┐
  │ graph-store │               │  SharedWorker │               │ DedicatedWorker  │      │ SQLite │
  │ createNode()│               │  route to     │               │ handleAction()   │      │INSERT/ │
  │             │               │  worker       │               │                  │      │SELECT  │
  └────────────┘               └──────────────┘               └─────────────────┘      └────────┘
       ▲                             │                                                      │
       │                    BC.postMessage(sync)                                            │
       │                             │                                                      │
       └─────────────────────────────┼──────────────────────────────────────────────────────┘
        response { data, syncEvent } → Zustand set() → React re-render
```

**Example for `createNode()`:**

1. `graph-store.createNode(input)` — serializes properties to JSON, calls `dbNodes.create()`
2. `db-client.sendRequest('nodes.create', params)` — generates requestId, sets 10s timeout, posts to SharedWorker
3. SharedWorker routes to Dedicated Worker via MessagePort
4. Dedicated Worker: `handleAction('nodes.create', params)` → `INSERT INTO nodes (...) RETURNING *`
5. Worker returns `{ result: DbNode, syncEvent: { type: 'node_created', node } }`
6. SharedWorker broadcasts `syncEvent` on `BroadcastChannel('kg_extension_sync')`
7. db-client resolves promise with `DbNode`
8. graph-store transforms `DbNode → GraphNode` (JSON.parse properties), calls `set({ nodes: [...state.nodes, node] })`
9. All subscribed React components re-render

---

## 6. Zustand Store Architecture

Five primary stores in `src/graph/store/`, plus viewport, auth, tag, and reading-list stores:

| Store | Key State | Key Actions |
|-------|-----------|-------------|
| **graph-store** | `nodes: GraphNode[]`, `edges: GraphEdge[]`, `adjacency: AdjacencyMap`, `selectedNodeIds: Set<string>` | `loadAll()`, `createNode()`, `updateNode()`, `deleteNode()`, `createEdge()`, `startSyncListener()` |
| **ui-store** | `activePanel`, `displayMode`, `chatOpen`, `chatDisplayMode`, `visibleLayers`, `clusteringEnabled` | `setActivePanel()`, `toggleChat()`, `toggleLayer()` |
| **llm-store** | `status` (state machine), `diff`, `agentRun`, `agentTurns`, `lastUsage`, `rateLimitWait` | `setStatus()`, `setDiff()`, `startAgentRun()`, `advanceStep()`, `addAgentTurn()`, `reset()` |
| **extraction-review-store** | `ReviewNode[]`, `ReviewEdge[]`, `ReviewNote[]`, `undoStack`, `redoStack`, `pendingConversion` | `initialize()`, `editNode()`, `removeEdge()`, `convertEdgeToProperty()`, `undo()/redo()` |
| **node-type-store** | `types: NodeType[]` (structural + entity labels) | `loadTypes()`, `createType()`, `getColorForNode()` |
| **viewport-store** | `zoomLevel`, `frustumBounds`, `visibleNodes/Edges`, `clusterNodes/Edges` | `setFrustumBounds()`, `invalidateClusterCache()` |

### LLM Store State Machine

```
                         agent
               ┌──────────────────────────┐
               │                          │
               ▼                          │ save_entities
        ┌─────────────┐                  │
        │agent-running │──────────────────┘
        └─────────────┘                  │
               ▲                          ▼
  start        │                 ┌────────────┐
┌──────┐  ───→ │   ┌──────────┐  │            │  ┌──────────┐  ┌────────┐  ┌──────┐
│ idle │──────→│──→│extracting│──→│ extracted  │──→│reviewing │──→│merging │──→│ idle │
└──────┘       │   └──────────┘  │            │  └──────────┘  └────────┘  └──────┘
               │        │        └────────────┘
               │        │ (any state)
               │        ▼
               │   ┌─────────┐
               │   │  error  │
               │   └─────────┘
               │
```

---

## 7. LLM Extraction Pipeline

Two extraction modes, both ending in the same review → apply flow.

### 7.1 Quick (Text) Extraction Flow

```
1. User clicks Extract
   useLLMExtraction.startExtraction()
        │
        ▼
2. Get page content
   CS: get_page_content → markdown (50KB max)
        │
        ▼
3. Send LLM_REQUEST
   SW injects key → Offscreen API call
        │
        ▼
4. Stream Anthropic API
   POST /v1/messages (streaming SSE)
        │
        ▼
5. LLM_STREAM_CHUNK broadcasts
   UI appends chunks → display streaming text
        │
        ▼
6. Parse JSON + Zod validate
   extractionResultSchema.parse() → nodes/edges/notes
        │
        ▼
7. buildDiffItems()
   In-memory match → DB fuzzy + alias → DiffItem[]
        │
        ▼
8. Review UI (ExtractionReview)
   ReviewNode[] / ReviewEdge[] with temp IDs
   Merge recommendations, inline edit, undo/redo
        │
        ▼
9. User clicks Apply
   applyReview() — 4 passes (see Section 9)
        │
        ▼
10. Database writes
    nodes, edges, entity_sources, edge_sources,
    source_content, note_search, OPFS notes
```

**`buildDiffItems()` detail:**

For each extracted node:
1. **Normalize:** filter out `type='resource'` (system-created), promote legacy types to labels
2. **Exact match:** check in-memory graph store nodes by name
3. **Fuzzy match:** call `entityResolution.findMatches(name)` → DB query on `entity_aliases` + fuzzy scoring
4. **Result:** `DiffItem { action: 'add' | 'merge', accepted: true, existingMatch? }`
5. All items default to `accepted=true`; user can toggle in review UI

### 7.2 Extraction Result Schema (Zod)

```typescript
extractionResultSchema = z.object({
  nodes: z.array(z.object({
    name: z.string().min(1),
    type: z.string().optional(),          // legacy, mapped to label
    label: z.string().optional(),          // concept|person|organization|technology|event|place|methodology
    properties: z.record(z.unknown()).optional(),
    tags: z.array(z.string()).optional(),
  })),
  edges: z.array(z.object({
    sourceName: z.string().min(1),
    targetName: z.string().min(1),
    label: z.string().min(1),
    type: z.string().optional(),
  })),
  notes: z.array(z.object({              // Phase 4: optional prose notes
    title: z.string(),
    content: z.string(),
    about: z.array(z.string()).optional(),     // key entity names
    mentions: z.array(z.string()).optional(),  // referenced entity names
  })).optional().default([]),
})
```

---

## 8. Agent Loop & Tools

### 8.1 Agent (Deep) Extraction Flow

```
  UI                    Service Worker          Offscreen (agent-loop)      Content Script
   │                         │                          │                        │
   │  AGENT_RUN_START        │                          │                        │
   │  (no key)               │                          │                        │
   │────────────────────────→│                          │                        │
   │                         │  AGENT_RUN_START_WITH_KEY│                        │
   │                         │  (+apiKey)               │                        │
   │                         │─────────────────────────→│                        │
   │                         │                          │                        │
   │                         │                   ┌──────┴──────────────────┐     │
   │                         │                   │  Loop (max 15 iters)   │     │
   │                         │                   │                        │     │
   │                         │                   │  Call Claude API       │     │
   │  AGENT_PROGRESS:        │                   │  (streaming)           │     │
   │  llm_start + llm_chunk  │                   │                        │     │
   │←─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─│← ─ ─ ─ ─ ─ ─ ─ ─│                        │     │
   │                         │                   │                        │     │
   │                         │                   │  LLM → tool_use:      │     │
   │                         │                   │  get_page_content      │     │
   │  AGENT_PROGRESS:        │                   │                        │     │
   │  tool_call              │                   │                        │     │
   │←─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─│← ─ ─ ─ ─ ─ ─ ─ ─│                        │     │
   │                         │                   │                        │     │
   │                         │                   │  TOOL_EXECUTE          │     │
   │                         │                   │─────────────────────→  │     │
   │                         │                   │                        │     │
   │                         │   chrome.tabs.sendMessage(tabId)           │     │
   │                         │──────────────────────────────────────────────────→│
   │                         │                   │                        │     │
   │                         │                   │                 executeTool() │
   │                         │                   │                 DOM→markdown  │
   │                         │                   │                        │     │
   │                         │              tool result                   │     │
   │                         │←──────────────────────────────────────────────────│
   │                         │─────────────────→ │                        │     │
   │                         │                   │                        │     │
   │  AGENT_PROGRESS:        │                   │                        │     │
   │  tool_result            │                   │                        │     │
   │←─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─│← ─ ─ ─ ─ ─ ─ ─ ─│                        │     │
   │                         │                   │                        │     │
   │                         │                   │  ... more tool calls   │     │
   │                         │                   │  (get_tables, etc.)    │     │
   │                         │                   │                        │     │
   │                         │                   │  ┌──────────────────┐  │     │
   │                         │                   │  │ LLM→save_entities│  │     │
   │                         │                   │  │   (TERMINAL)     │  │     │
   │                         │                   │  └──────────────────┘  │     │
   │  AGENT_PROGRESS:        │                   │                        │     │
   │  extraction_complete    │                   │                        │     │
   │  (nodes+edges+notes)    │                   │                        │     │
   │←─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─│← ─ ─ ─ ─ ─ ─ ─ ─│                        │     │
   │                         │                   │                        │     │
   │  Parse result           │                   │  AGENT_PROGRESS: done  │     │
   │  buildDiffItems()       │                   │                        │     │
   │  → Review UI            │                   └────────────────────────┘     │
   │                         │                                                  │
```

> If the agent finishes without calling `save_entities` → error ("Agent did not produce extraction results"). `save_entities` is the **ONLY** terminal tool. After `extraction_complete`, flow continues identically to Quick extraction: Review UI → `applyReview()` → DB writes (Section 9).

### 8.2 Agent Tools Reference

| Tool | Execution Context | Parameters | Returns | Limits |
|------|-------------------|------------|---------|--------|
| `get_page_content` | Content Script | `format?: 'markdown' \| 'text'` | `{title, url, content}` | 50KB max content |
| `get_page_metadata` | Content Script | (none) | `{title, url, metaDescription, ogTags, jsonLd, headings}` | h1-h3 outline only |
| `query_selector` | Content Script | `selector: string` (required) | `{text}` or `{text: null, error}` | First match only, 50KB text |
| `query_selector_all` | Content Script | `selector: string`, `limit?: number` | `{results[], count}` | Max 50 elements |
| `get_links` | Content Script | `scope?: string` (CSS selector) | `{links: [{text, href}]}` | Max 200 links, 200 char text |
| `get_tables` | Content Script | `selector?: string` | `{tables: [{headers, rows, rowCount}]}` | Max 5 tables, 100 rows each |
| `get_structured_data` | Content Script | (none) | `{jsonLd[], microdata[]}` | — |
| `fetch_url` | Offscreen | `url: string` (required) | `{result: markdown}` | 20KB max, blocked domains filtered |
| **`save_entities`** (terminal) | Offscreen | `nodes: [{name, type, ...}]`, `edges: [{sourceName, targetName, label, ...}]` | Triggers `extraction_complete` event | Must be called to end loop |

### 8.3 Tool Execution Relay

```
Offscreen (agent-loop.ts)
  │ executeRemoteTool(toolCallId, toolName, toolInput, tabId, runId)
  ▼
  chrome.runtime.sendMessage({ type: 'TOOL_EXECUTE', payload: { toolName, toolInput, tabId } })
  ▼
Service Worker (message-router.ts)
  │ Ensures content script is injected (chrome.scripting.executeScript if needed)
  ▼
  chrome.tabs.sendMessage(tabId, { type: 'TOOL_EXECUTE', payload: { toolName, toolInput } })
  ▼
Content Script (tool-executor.ts)
  │ executeTool(toolName, toolInput) → DOM operations → JSON string
  ▼
  sendResponse({ result: jsonString })
  ▼
  ← back through SW → Offscreen (30s timeout)
```

### 8.4 System Prompt (Agent Mode)

```
Role: Knowledge graph extraction agent with page inspection tools.

Workflow:
1. get_page_metadata — understand page structure
2. get_page_content — read main content (markdown)
3. Targeted tools (query_selector, get_tables, get_structured_data) as needed
4. fetch_url — for linked content if user requests
5. save_entities — REQUIRED terminal call with extracted nodes+edges

Node rules:
- Do NOT emit "resource" nodes (system-created from URL)
- Every node is an "entity" with semantic label
- Labels: concept, person, organization, technology, event, place, methodology
- Focus on 5-15 most important entities

Edge label vocabulary:
  subfield_of, part_of, instance_of, created_by, affiliated_with,
  used_in, builds_on, enables, contradicts, alternative_to, preceded_by

[If notesEnabled]
Note rules:
- Exactly ONE note: "Summary: {page title}"
- Structure: TL;DR, then 3-5 topic sections
- Use [[Entity Name]] wikilinks
- "about" = 1-3 key entities; "mentions" = others
```

---

## 9. Data Flow: Extraction → Database (Full Trace)

When the user clicks **Apply** in the review UI, `applyReview()` executes four sequential passes. Every database write goes through the SharedWorker → DedicatedWorker → SQLite pipeline.

### Pass 0: Ensure Resource Node

```
ensureResourceNode(sourceUrl, pageTitle)
  • Check in-memory: nodes.find(n => type==='resource' && sourceUrl===url)
  • If not found:
      INSERT INTO nodes (id, name, type='resource', identifier, source_url) VALUES (...)
  • identifier = generateIdentifier('resource', url) — deterministic slug for idempotent re-extraction
```

### Pass 1: Entity Nodes (create or merge)

For each `activeReviewNode` (where `removed=false`):

**If `mergeRecommendation.status === 'accepted'`:**
- Reuse `existingNodeId` (no INSERT)
- `INSERT INTO entity_aliases (node_id, alias, alias_lower)` if names differ
- `UPDATE nodes SET properties=merged WHERE id=?`

**Else (new entity):**
- `INSERT INTO nodes (id, name, type='entity', label, properties, source_url)`
- Map: `tempIdToRealId.set(temp-{uuid}, created.id)`
- SyncEvent: `node_created` → BroadcastChannel

### Pass 2: Edges + Extraction Provenance

For each `activeReviewEdge`:
- Resolve endpoints: `resolveEndpoint(sourceTempId)` → real node ID (via `tempIdToRealId` or name match)
- `INSERT INTO edges (id, source_id, target_id, label, source_url)` — with `skipProvenance=true`
- Collect `createdEdgeIds`

After all edges, for each `edgeId`:
- `INSERT INTO edge_sources (edge_id, source_type='extraction', resource_id=resourceNode.id)`

### Pass 3: Note Nodes + About/Mention Edges

For each `activeReviewNote`:

1. Resolve about/mentions temp IDs → real entity IDs via `tempIdToRealId`
2. `INSERT INTO nodes (id, name, type='note', properties={wikiLinks, resourceId}, source_url)`
   - Retry on name collision: append domain suffix → timestamp suffix
3. Write OPFS: `writeNote(noteNodeId, markdown)` → `/notes/{nodeId}.md`
4. FTS index: `INSERT INTO note_search (node_id, title, body)` — triggers auto-sync to `notes_fts`
5. Create about/mention edges:
   - `INSERT INTO edges (source_id=noteId, target_id=entityId, label='about'|'mention')`
6. Create extracted_from edge: `INSERT INTO edges (noteId → resourceNodeId, label='extracted_from')`
7. Write provenance: `INSERT INTO edge_sources (edge_id, source_type='note', source_id=noteNodeId)`
8. Write entity-source links: `INSERT INTO entity_sources (entity_id, resource_id, relation_type='about'|'mention')`

### Pass 4: Source Content + Entity-Source Links

- `INSERT INTO source_content (node_id=resourceId, url, content=inputText, content_hash)` — archives original page
- For each entity: `INSERT INTO entity_sources (entity_id, resource_id, 'about')` — idempotent via PK constraint
- Reset `extraction-review-store` + `llm-store` → `status='idle'`

### Summary of DB writes per extraction

```
nodes           (entities + notes + resource)
edges           (relationships + about/mention + extracted_from)
entity_aliases  (merge name variants)
edge_sources    (extraction/note provenance)
entity_sources  (entity ↔ resource links)
source_content  (archived page text)
note_search     (FTS plain text) + OPFS (markdown files)
```

### Type Conversions Along the Path

```
LLM output (JSON string)
  ▼ JSON.parse()
  ▼ extractionResultSchema.parse()    → ExtractionResult { nodes, edges, notes? }
  ▼ buildDiffItems()                  → DiffItem[] { action, accepted, existingMatch? }
  ▼ proceedToReview()                 → ReviewNode[] (temp-{uuid} IDs), ReviewEdge[], ReviewNote[]
  ▼ applyReview()
  ▼   createNode(CreateNodeInput)     → DbNode (from SQL RETURNING *)
  ▼   dbNodeToGraphNode(DbNode)       → GraphNode (JSON.parse properties, camelCase fields)
  ▼   set({ nodes: [..., graphNode] })→ Zustand store update → React re-render
```

### DbNode ↔ GraphNode Conversion

| DbNode (SQL row) | GraphNode (App) | Transform |
|---|---|---|
| `id TEXT` | `id: string` | pass through |
| `identifier TEXT` | `identifier: string \| null` | pass through |
| `name TEXT` | `name: string` | pass through |
| `type TEXT` | `type: string` | `'resource' \| 'entity' \| 'note'` |
| `label TEXT` | `label: string \| null` | pass through |
| `folder_path TEXT` | `folderPath: string` | snake → camel |
| `properties TEXT` | `properties: Record<string, unknown>` | `JSON.parse()` |
| `source_url TEXT` | `sourceUrl: string` | snake → camel |
| `created_at TEXT` | `createdAt: string` | snake → camel |

**Slim projection** (for `loadGraph()` bulk load): Omits `properties`, `summary`, `z`, timestamps. Sets `properties: {}` to skip JSON parse overhead.

---

## 10. Cross-Tab Synchronization

```
  Tab 1 (writer)                SharedWorker                   Tab 2 (listener)
  ────────────                  ────────────                   ────────────────
  graph-store.createNode()
    → dbNodes.create()
    → Zustand set()
         │
         │ request              broadcasts syncEvent
         │─────────────────────→│                              Side Panel (listener)
         │                      │ on response receipt           ────────────────────
         │                      │                               
         │                      │  BroadcastChannel             
         │                      │  ('kg_extension_sync')        
         │                      │──────────────────────────────→ startSyncListener()
         │                      │                                → receive node_created
         │                      │──────────────────────────────→ → Zustand set()
         │                      │
```

**Idempotency protection:**
Tab 1's own sync listener also receives the broadcast. It checks:
```typescript
if (state.nodes.some(n => n.id === node.id)) return;
```
Already applied from the direct Zustand `set()` — no double update.

### SyncEvent Types

```typescript
type SyncEvent =
  | { type: 'node_created'; node: DbNode }
  | { type: 'node_updated'; node: DbNode }
  | { type: 'node_deleted'; id: string }
  | { type: 'edge_created'; edge: DbEdge }
  | { type: 'edge_updated'; edge: DbEdge }
  | { type: 'edge_deleted'; id: string }
  | { type: 'node_type_created'; nodeType: NodeType }
  | { type: 'node_type_deleted'; nodeTypeId: string }
  | { type: 'note_content_updated'; nodeId: string }
  | { type: 'reset' }
```

---

## 11. Database Schema Reference

### Core Tables

| Table | Columns | Purpose |
|-------|---------|---------|
| **`nodes`** | `id` PK, `identifier` UNIQUE, `name`, `type` ('resource'\|'entity'\|'note'), `label`, `summary`, `folder_path`, `properties` JSON, `x`/`y`/`z`, `color`, `size`, `source_url`, timestamps | All graph nodes: entities, resources, notes |
| **`edges`** | `id` PK, `source_id`/`target_id` FK→nodes CASCADE, `label`, `type`, `properties` JSON, `weight`, `directed`, `source_url`, timestamps. UNIQUE(source_id, target_id, label) | All graph edges |
| **`entity_aliases`** | `id` PK, `node_id` FK→nodes, `alias`, `alias_lower` | Alternate names for fuzzy entity matching |
| **`entity_sources`** | `entity_id`/`resource_id`/`relation_type` (PK triplet). Type: 'about'\|'mention' | Entity ↔ Resource provenance |
| **`edge_sources`** | `id` PK, `edge_id` FK→edges, `source_type` ('note'\|'extraction'\|'user'), `source_id`, `resource_id` | Edge provenance tracking |
| **`source_content`** | `id` PK, `node_id` FK→nodes, `url`, `title`, `content`, `content_hash`, timestamps | Archived page HTML/text for RAG |
| **`note_search`** | `rowid`, `node_id` UNIQUE FK→nodes, `title`, `body` (plain text) | FTS5 backing table for note content search |
| **`ontology_node_types`** | `type` PK, `description`, `color`, `category` ('structural'\|'entity_label'), `parent_type` | Node type definitions + color palette |
| **`ontology_edge_types`** | `type` PK, `description`, `category`, `source_types`, `target_types` | Edge type ontology |
| **`extraction_log`** | `id` PK, `source_url`, `provider`, `model`, `raw_output`, `nodes_added`, `edges_added` | Audit trail of LLM extractions |
| **`node_tags`** | `node_id`/`tag` (PK pair) | Tag-based filtering |
| **`note_folders`** | `path` PK | S3-style folder markers for empty note directories |
| **`note_attachments`** | `id` PK, `note_id` FK→nodes, `filename`, `mime_type`, `data` BLOB | Inline note attachments |
| **`indexed_files`** | `id` PK, `file_path` UNIQUE, `content_hash`, `node_id` FK→nodes | Local markdown folder sync tracking |
| **`reading_list_history`** | `id` PK, `url` UNIQUE, `title`, `summary`, `key_topics` JSON, `node_ids` JSON | Tracking merged reading list items |
| **`chat_sessions`** | `id` PK, `title`, `status`, timestamps | Multi-turn chat conversations |
| **`chat_messages`** | `id` PK, `session_id` FK, `role`, `content`, `rag_context`, `status` | Individual chat messages |

### FTS5 Virtual Tables

| Virtual Table | Source Table | Indexed Columns | Auto-Sync |
|---|---|---|---|
| `nodes_fts` | `nodes` | `name`, `type`, `properties` | INSERT/UPDATE/DELETE triggers on `nodes` |
| `notes_fts` | `note_search` | `title`, `body` | INSERT/UPDATE/DELETE triggers on `note_search` |

> **Note content storage:** Note markdown lives in OPFS (`notes/{nodeId}.md`), NOT in SQLite. The `note_search` table stores stripped plain text for FTS only. Write ordering: OPFS first → `note_search` upsert → `nodes` metadata update. Orphaned OPFS files are harmless; dangling DB references are not.

### Spatial Index

```sql
CREATE INDEX idx_nodes_xy ON nodes(x, y);
-- Used by spatial.nodesInBounds(minX, minY, maxX, maxY) for viewport culling
```

### Three-Layer Node Model

```
  ┌────────────────┐         ┌────────────────┐         ┌────────────────┐
  │   Resource     │         │    Entity      │         │     Note       │
  │   type='resource'│         │   type='entity' │         │   type='note'  │
  │                │         │                │         │                │
  │  System-created│         │  LLM-extracted │         │  Prose         │
  │  from URL      │         │  concepts      │         │  summaries     │
  │  identifier    │         │  label: person,│         │  Content in    │
  │  from URL slug │         │  org, tech...  │         │  OPFS files    │
  └───────┬────────┘         └───────┬────────┘         └───────┬────────┘
          │  entity_sources          │  about/mention            │
          │  about / mention         │  edges                    │
          │←─────────────────────────│←─────────────────────────│
          │                                                      │
          │          extracted_from edge (note → resource)        │
          │←─────────────────────────────────────────────────────│

  Structural Layer: nodes.type ('resource' | 'entity' | 'note')
  Provenance Layer: entity_sources + edge_sources tables
```

---

*Generated 2026-04-21 — source: codebase analysis of kg_extension*
