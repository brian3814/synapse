# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

**Synapse** — local-first knowledge graph with SQLite persistence, 2D graph visualization (custom Three.js renderer with InstancedMesh), and LLM-powered entity extraction. Primarily an **Electron desktop app** with a vault-based workspace. The **Chrome extension** is deprecated (maintenance mode only, no new features).

### Vault Architecture (Electron-only)

The app uses a **Vault** — a single user-chosen directory containing everything: graph DB, notes, user files, embeddings, and agent artifacts. The vault is required before the app can be used.

```
<vault-root>/
├── .kg/                    ← app internals (hidden)
│   ├── config.json         ← vault identity & schema version
│   ├── graph.db            ← SQLite database (source of truth)
│   ├── embeddings/vec.db   ← sqlite-vec vector store
│   └── agent/              ← agent memory & artifacts
├── notes/                  ← app-managed markdown (human-readable names)
└── (user files anywhere)   ← auto-detected as resources
```

**Key design decisions:**
- **Graph-as-registry**: Graph DB is the source of truth. Filesystem is a projection. Every file with a graph node has `vault_path` set on the node.
- **Event bus**: Graph mutations and file events flow through `VaultEventBus`. Handlers subscribe independently (NoteFileHandler, ResourceDetectionHandler, EmbeddingHandler, SyncBroadcastHandler).
- **File watcher**: Recursive `fs.watch` detects user files dropped anywhere in the vault (excluding `.kg/` and `notes/`). Creates resource nodes automatically.
- **Reconciliation on startup**: mtime-based diff catches offline changes (new/modified/missing files).
- **Human-readable note names**: Notes stored as `notes/Machine Learning.md`, not `{nodeId}.md`. `vault_path` column provides the mapping.
- **API keys stay in app settings** (`~/Library/Application Support/`), never in the vault.
- **Shared DB handle**: `VaultManager.open()` calls `resetBetterSQLite(dbPath)` then `runMigrations()` directly. The vault context receives the DB handle from `getDb()` — never opens its own connection. This ensures migrations run before reconciliation and all code shares one DB handle.
- **Multi-vault**: Single vault per process. Switching vaults launches a new Electron process via `app.relaunch({ args: ['--vault', path] })`, matching Obsidian's window model. The `VaultSwitcher` dropdown in the header shows recent vaults and create/open options.

**Key files:**
- `electron/vault/vault-manager.ts` — Lifecycle (create, open, close). Singleton in main process.
- `electron/vault/vault-context.ts` — VaultContext interface + scaffoldVault helper.
- `electron/vault/event-bus.ts` — Typed event bus with try/catch per handler.
- `electron/vault/file-watcher.ts` — Recursive watch with ignore/debounce.
- `electron/vault/reconciliation.ts` — Startup filesystem↔DB diff.
- `electron/vault/handlers/` — NoteFileHandler, ResourceDetectionHandler, SyncBroadcastHandler.
- `src/ui/components/VaultSetupScreen.tsx` — Gating screen (create/open/recent).
- `src/platform/electron/vault-workspace.ts` — Renderer-side IPC bridge for vault management.

## Build Commands

```bash
# Chrome extension
npm run build                    # Vite production build → dist/
npm run dev                      # Vite build in watch mode (load dist/ in chrome://extensions)

# Electron desktop
npm run build:electron-main      # esbuild main process → dist-electron/main/
npm run build:electron-renderer  # Vite renderer build → dist-electron/renderer/
npm run build:electron           # Both main + renderer
npm run dist:mac                 # Package macOS app via electron-builder

# Companion extension
npm run build:companion          # Vite build → dist-companion/

# MCP CLI (standalone stdio server)
npm run build:mcp                # esbuild → packages/synapse-mcp/dist/
```

No test framework or linter is configured. For Chrome, load `dist/` as an unpacked extension in `chrome://extensions` (developer mode). For Electron, run `npx electron .` after building.

## Architecture

### Platform Abstraction Layer

The app runs on two platforms from one codebase. UI code imports `@platform` (Vite build-time alias) and never touches `chrome.*` or `ipcRenderer` directly.

```
┌─────────────────────────────────────────────────┐
│  UI / React Layer (platform-agnostic)            │
│  All I/O via: import { storage, db, notes, llm,  │
│               browser, vault } from '@platform'  │
├─────────────────────────────────────────────────┤
│  @platform (build-time alias)                    │
│  Chrome: src/platform/chrome/  (chrome.* APIs)   │
│  Electron: src/platform/electron/ (IPC bridge)   │
├─────────────────────────────────────────────────┤
│  Background Service (platform-specific)          │
│  Chrome: Service Worker + Offscreen Document     │
│  Electron: Main Process (electron/main.ts)       │
│  Both import shared logic from src/core/         │
├─────────────────────────────────────────────────┤
│  External (LLM API, SQLite, Filesystem)          │
└─────────────────────────────────────────────────┘
```

**Seven platform interfaces** in `src/platform/types.ts`:

| Interface | Chrome Implementation (deprecated) | Electron Implementation |
|---|---|---|
| `PlatformStorage` | `chrome.storage.local` | IPC → JSON config file |
| `PlatformDB` | SharedWorker/DedicatedWorker + wa-sqlite | IPC → better-sqlite3 in vault `.kg/graph.db` |
| `PlatformNotes` | OPFS async API | IPC → vault `notes/` directory (human-readable filenames) |
| `PlatformLLM` | Message-based streaming via SW/offscreen | Dedicated IPC channels (`llm:stream-extraction`, `llm:run-agent`, `llm:stream-chat`) |
| `PlatformBrowser` | `chrome.tabs`, content scripts | Companion extension dispatch or no-op |
| `PlatformEmbedding` | No-op stub (returns empty arrays) | IPC → EmbeddingService in main process (sqlite-vec + ONNX/OpenAI) |
| `PlatformVault` | OPFS `vault/{nodeId}/{filename}` (legacy) | IPC → legacy binary storage (being migrated into vault) |

Additionally, `vaultWorkspace` is exported from both platforms (`src/platform/electron/vault-workspace.ts` / `src/platform/chrome/vault-workspace.ts`) for vault lifecycle management (create, open, close, status). Chrome stub returns no-op responses.

**Build-time resolution**: `vite.config.chrome.ts` maps `@platform` → `src/platform/chrome/`. `vite.config.electron.ts` maps `@platform` → `src/platform/electron/`. TypeScript `tsconfig.json` paths point at Chrome as IDE default.

**Platform-specific UI**: Use `import { platformId } from '@platform'` and conditional rendering. Chrome-only features (side panel toggle, OAuth, reading list, contextual relevance) are guarded with `platformId === 'chrome'`.

**Shared core** (`src/core/`): Agent loop, LLM protocol types, rate-limit retry, usage tracking, system prompts, and prompt assembly — imported by both the Chrome offscreen document and Electron main process. The core layer has zero imports from `@platform` or `src/offscreen/`; all dependencies are injected via `CommandContext` or function parameters.

**LLM provider abstraction**: Provider-neutral types live in `src/core/llm-protocol.ts` (`LLMMessage`, `ContentBlock`, `LLMStreamResult`, `StreamFn`). The Electron main process routes LLM calls through a provider factory in `electron/llm-backend.ts` — registries map provider names to stream functions. Adding a new provider (e.g., OpenAI) means implementing `StreamFn` and calling `registerStreamFn('openai', fn)`. The renderer never knows which provider is active; it goes through `PlatformLLM` (IPC).

### Chrome Extension Contexts

Six execution contexts (Chrome-only, not relevant for Electron):

| Context | Key Restriction |
|---|---|
| **Service Worker** (`src/service-worker/`) | No DOM, no long-running tasks. Must not use dynamic imports (Vite polyfill references `document`). Only context that should read `chrome.storage` for sensitive data (API keys). |
| **Side Panel / Tab** (`src/ui/`) | React 19 SPA. Same `index.html` serves both (`?mode=sidePanel` vs `?mode=tab`). |
| **Offscreen Document** (`src/offscreen/`) | Has DOM + fetch but **no `chrome.storage`**, no `chrome.tabs` (Pitfall #13). Receives API keys via message payload from SW. |
| **Content Script** (`src/content-script/`) | Per-page isolated world. Extracts page text, executes agent tools. Built as IIFE. |
| **DB SharedWorker** (`src/db/worker/db-shared-worker.ts`) | Pure coordinator/router. No `Worker` constructor (Pitfall #12), no `chrome.*` APIs. |
| **DB Dedicated Worker** (`src/db/worker/db-worker.ts`) | Runs wa-sqlite + OPFS. Created by UI thread, bridged to SharedWorker via `MessageChannel`. |

Chrome-context communication uses `chrome.runtime.sendMessage` with typed messages in `src/shared/messages.ts`. These messages are **internal to the Chrome platform layer** — UI code never sends them directly.

### Electron Contexts

Two contexts: **Renderer** (React app, same as Chrome UI) and **Main Process** (`electron/main.ts` — SQLite, LLM, IPC handlers, companion server). Preload (`electron/preload.ts`) exposes a generic `window.electronIPC` bridge with `invoke(channel, ...args)` and `on(channel, cb)`.

### API Key Security Pattern

On Chrome, UI messages never carry API keys. The service worker reads keys from `chrome.storage.local` and injects them before forwarding to the offscreen document. On Electron, the main process reads keys from storage before making LLM API calls.

## State Management

Five Zustand stores in `src/graph/store/`:

| Store | Purpose |
|---|---|
| `graph-store.ts` | Node/edge CRUD with DB sync. Broadcasts `SYNC_CHANNEL` events on mutations. |
| `ui-store.ts` | Active panel, layout type, display mode, chat mode (`float`/`sidebar`), clustering toggle. |
| `llm-store.ts` | Extraction pipeline state machine: `idle → extracting → extracted → reviewing → merging`. Also tracks agent runs (`AgentTurn[]`). |
| `node-type-store.ts` | Node type definitions + auto-assigned colors from `TYPE_COLOR_PALETTE` (10 colors, cycles on exhaustion). |
| `extraction-review-store.ts` | Ephemeral review session with undo/redo command pattern. Manages `ReviewNode[]`/`ReviewEdge[]` with temp IDs (`temp-${uuid}`). |

Stores are independent; hooks like `useLLMExtraction()` orchestrate multi-store updates.

## LLM Extraction Pipeline

Two extraction modes, both ending in the same review→apply flow:

**Simple text extraction** (`useLLMExtraction.startExtraction`): Raw text → `llm.streamExtraction()` → streaming JSON → parse via `extractionResultSchema` (Zod) → diff with existing graph → review.

**Agent page extraction** (`useLLMExtraction.startAgentExtraction`): `llm.runAgent()` → shared agent loop (`src/core/agent-loop.ts`, max 15 iterations) → platform-specific tool executor (Chrome: content script tools via SW relay; Electron: `fetch_url` directly, content-script tools unavailable) → terminal `save_entities` tool → review.

**File ingestion** (`useLLMExtraction.startIngestion`): File (drag-drop, paste, import button) → `ContentProcessor.preprocess()` → text/chunks → `llm.streamExtraction()` with optional entity carry-forward across chunks → Zod parse → diff → review. See Multi-Modal Ingestion Pipeline section below.

**Review flow** (`ExtractionReview` replaces old `DiffView`):
- Converts diff items → `ReviewNode[]`/`ReviewEdge[]` with merge recommendations (fuzzy matching via entity resolution)
- Mini graph preview (Three.js ReviewGraphCanvas) or overlay on main graph
- Inline editing, add/remove nodes/edges, undo/redo
- Convert-to-property: async LLM call suggests inverse property keys, user confirms
- `applyReview()` commits to DB, resolving temp IDs → real IDs

## Multi-Modal Ingestion Pipeline

Third extraction mode alongside text and agent extraction. Imports PDFs, images, and future file types into the knowledge graph.

**Architecture:** `ContentProcessor` interface + factory pattern. Each modality implements `canProcess()`, `shouldPromptMode()`, `preprocess()`. Factory resolves processor by MIME type. Evolves to dynamic registry via `registerProcessor()`.

**Pipeline flow:** Entry points (drag-drop, paste, import button) → normalize to `IngestionSource` → factory resolves processor → harness prompt if large doc → `preprocess()` → `ProcessedContent` convergence point → LLM extraction (chunked with entity carry-forward for long docs) → ExtractionReview → graph merge with SourceLocation provenance.

**Chunked extraction with entity carry-forward:** For long documents, each chunk receives entity names from prior chunks as LLM context, preventing cross-chunk duplicates.

**Source location provenance:** `SourceLocation` discriminated union tracks where entities were found:
- PDF: `{ type: 'page', page: 3, section: 'Methods' }`
- Image: `{ type: 'region', description: 'top-left org chart' }`
- Future video/audio: `{ type: 'time', timestamp: '14:32' }`

**Processing modes (harness):** PDFs >50 pages prompt user: Quick (overview only) / Full (all pages with carry-forward).

**Key files:**
- `src/ingestion/types.ts` — IngestionSource, SourceLocation, ContentProcessor interface
- `src/ingestion/processor-factory.ts` — Factory + registerProcessor()
- `src/ingestion/ingestion-pipeline.ts` — Pipeline orchestrator with chunked carry-forward
- `src/ingestion/processors/pdf-processor.ts` — pdfjs-dist, page-level chunking
- `src/ingestion/processors/image-processor.ts` — Canvas resize, base64 for vision API

## Vault Storage (Legacy Binary Attachments)

The old `PlatformVault` interface (`import { vault } from '@platform'`) handles binary file storage for the ingestion pipeline. This is separate from the new vault workspace architecture — it will be migrated into the vault directory in a future phase.

- **Chrome**: `src/platform/chrome/vault.ts` — OPFS at `vault/{nodeId}/{filename}`
- **Electron**: `src/platform/electron/vault.ts` — IPC to main process → `~/Documents/KnowledgeGraph/vault/{nodeId}/{filename}`

## Build System

Two Vite configs share the same source via the `@platform` alias:

**`vite.config.chrome.ts`** — produces 7 outputs (Chrome extension):

| Output | Plugin | Format |
|---|---|---|
| React SPA + service worker + offscreen | Main build (multi-entry) | ES modules |
| `db-worker.js` + `wa-sqlite-async.wasm` | `dbWorkerPlugin` | ES module (no content hash on WASM) |
| `db-shared-worker.js` | `dbSharedWorkerPlugin` | ES module |
| `layout-worker.js` | `layoutWorkerPlugin` | ES module |
| `content-script.js` | `contentScriptPlugin` | IIFE |

Key config: `base: ''` (chrome-extension:// relative paths), `modulePreload: false` (prevents DOM polyfill in SW). `@platform` → `src/platform/chrome/`.

**`vite.config.electron.ts`** — produces 4 outputs (Electron renderer):
- React SPA + db-worker + db-shared-worker + layout-worker. No service worker, offscreen, or content script.
- `base: './'` for Electron `file://` or `app://` protocol. `@platform` → `src/platform/electron/`.

**Electron main process** — built separately via `esbuild` (not Vite): `electron/main.ts` + `electron/preload.ts` → `dist-electron/main/`.

**Important:** The `@platform` alias must exist in EVERY `resolve.alias` block across both configs — main build AND all sub-build plugins (contentScript, layoutWorker, dbWorker, dbSharedWorker).

## Chrome Extension CSP Constraints

CSP `script-src 'self' 'wasm-unsafe-eval'` blocks all `blob:` URLs. This affects:

- **DB Worker** — Built as separate entry, loaded via `new URL('/db-worker.js', location.origin)`.
- **Layout Worker** — Built as separate entry, loaded via `new URL('/layout-worker.js', location.origin)`. Runs Barnes-Hut force-directed layout off the main thread.

## Database Layer

Three abstraction levels separate UI code from the storage engine:

```
db-client.ts (typed API, platform-agnostic)
  → PlatformDB (transport: Chrome SharedWorker or Electron IPC)
    → action-handler.ts (dispatches to DataStore)
      → DataStore interface (16 repository sub-interfaces)
        → SqliteDataStore (wraps existing query modules)
```

- **`src/db/data-store.ts`** — `DataStore` interface with 16 repository sub-interfaces (`NodeRepository`, `EdgeRepository`, `SpatialRepository`, `ChatRepository`, etc.) plus top-level `init()`, `reset()`, `loadGraph()`, `clearAll()`, `graphQuery()`, `graphMutate()`, and raw SQL escape hatches. All methods return `Promise` so implementations can be sync or async. No SQL types leak into the interface.
- **`src/db/sqlite-data-store.ts`** — `createSqliteDataStore(initEngine, resetEngine)` factory. Pure 1:1 delegation to the 16 query modules in `src/db/worker/queries/`. No logic — just wiring.
- **`src/db/worker/action-handler.ts`** — Accepts `DataStore`, maps action strings (`nodes.create`, `edges.getAll`, etc.) to repository methods + sync events for broadcasting. The switch stays (96 cases) but delegates through the interface, not concrete SQL modules.
- **`src/db/worker/sqlite-engine.ts`** — All SQLite ops serialized through a promise queue (prevents wa-sqlite Asyncify corruption). VFS fallback: OPFS → IDB → in-memory. **Critical:** `open_v2` must be inside each VFS try/catch (Pitfall #11).
- **`src/db/worker/migrations/`** — Versioned, FTS5 detected at runtime. Migration 002 (FTS) is optional; search falls back to LIKE. Migration 010 adds `location TEXT` to `entity_sources`/`edge_sources` (JSON-serialized SourceLocation for provenance), plus `vault_path TEXT` and `content_type TEXT` on `nodes`.
- **`src/db/client/db-client.ts`** — Platform-agnostic typed API. Imports `db` from `@platform` and delegates via `db.request(action, params)`. All 30+ typed namespace methods (`nodes`, `edges`, `spatial`, `chat`, etc.) are shared code. Platform transport is in `ChromeDB` (SharedWorker/MessagePort) or `ElectronDB` (IPC to better-sqlite3).

**Swapping the storage engine** (e.g., Postgres, Neo4j): implement `DataStore`, wire into `createActionHandler`. No changes to db-client, PlatformDB, action-handler dispatch logic, or UI code.

## Note Content Storage

Note content is stored as `.md` files, NOT in SQLite. UI code accesses notes via `import { notes } from '@platform'` (`PlatformNotes` interface). See [`docs/adr-opfs-note-storage.md`](docs/adr-opfs-note-storage.md) for full ADR.

- **Chrome** (deprecated): `src/platform/chrome/notes.ts` — OPFS async API (`notes/{node_id}.md`)
- **Electron (vault)**: Notes live in the vault at `<vault>/notes/{Human Readable Name}.md`. The `NoteFileHandler` event handler manages file creation, renames (when node name changes), and deletion. The `vault_path` column on `nodes` stores the vault-relative path (e.g., `notes/Machine Learning.md`). File naming uses minimal sanitization (replace `/\:`, trim dots/spaces) with collision handling via `(2)` suffix.
- **Legacy Electron** (pre-vault): `electron/notes-backend.ts` — `~/Documents/KnowledgeGraph/notes/{node_id}.md`
- **`src/notes/markdown-utils.ts`** — `stripMarkdownToPlainText()` for FTS tokenization, re-exports `parseMarkdown`/`generateNoteMarkdown`
- **`note_search` table** (in 001-initial-schema) — Backing table for FTS5 external content. Stores `node_id`, `title`, stripped plain-text `body`.
- **`notes_fts` virtual table** (in 002-fts-index) — External content FTS5 on `note_search`. Auto-synced via INSERT/DELETE/UPDATE triggers.
- **Write ordering**: File first, then `note_search` upsert, then `nodes` metadata update. Orphaned files are harmless; dangling DB references are not.
- **`nodes.properties`** for notes contains only `{ wikiLinks }` — no content. Content is never stored in `source_content` for notes.
- **Cross-tab sync**: `BroadcastChannel(SYNC_CHANNEL)` with `note_content_updated` event type.
- **Accepted duplication**: Note body exists on disk (markdown) and `note_search.body` (plain text for FTS). Will be eliminated when wa-sqlite upgrades to SQLite 3.43+ (`contentless_delete=1`).

## Graph Renderer (Three.js)

Custom renderer in `src/graph/renderer/` — zero React dependency. Uses InstancedMesh (1-2 draw calls) for nodes/edges instead of Reagraph's per-element meshes.

- **`graph-renderer.ts`** — Core class: Scene, Camera, WebGLRenderer, animation loop, event emitter
- **`node-mesh.ts`** — InstancedMesh with CircleGeometry for nodes, RingGeometry for selection ring
- **`edge-mesh.ts`** — LineSegments for edges + InstancedMesh ConeGeometry for directed arrows
- **`label-layer.ts`** — Canvas2D texture atlas + InstancedMesh quads with frustum culling
- **`camera-controller.ts`** — OrthographicCamera pan/zoom/fit with mouse/wheel handlers
- **`hit-test.ts`** — CPU distance-based node/edge picking (linear scan, sufficient for 10k+)
- **`types.ts`** — RenderNode, RenderEdge, RenderTheme, GraphCanvasHandle

Layout runs in a Web Worker (`src/graph/layout/`):
- **`force-layout.ts`** — Velocity Verlet + Barnes-Hut quadtree O(n log n) repulsion
- **`layout-worker.ts`** — Worker entry; sends Float32Array positions via Transferable
- **`layout-runner.ts`** — Main-thread API; creates worker and handles tick/done messages
- Pin/unpin support for node dragging during live simulation

React integration: `GraphCanvas.tsx` is a thin `forwardRef` wrapper. Zustand `.subscribe()` pushes data imperatively — no React re-renders during interactions. Graph container must use `absolute inset-0` positioning with `min-h-0` on flex parents.

## Graph Renderer Pitfalls

**Pitfall #14: InstancedMesh custom attributes require `onBeforeCompile`.** Three.js `MeshBasicMaterial` silently ignores custom geometry attributes (like `instanceOpacity`). Setting an attribute via `geometry.setAttribute()` does nothing unless you inject it into the shader via `material.onBeforeCompile`. The `node-mesh.ts` uses this to make per-instance opacity work. If you add new per-instance attributes, you must also patch the shader.

**Pitfall #15: InstancedMesh frustum culling uses geometry bounds, not instance bounds.** Three.js culls the entire InstancedMesh based on the geometry's bounding sphere (e.g., `CircleGeometry(1)` → radius 1 at origin). When the camera pans away, ALL instances vanish. Always set `frustumCulled = false` on InstancedMesh objects, and propagate this in `grow()` / capacity-rebuild methods.

**Pitfall #16: Spatial hash must be rebuilt after node position changes outside `updatePositions()`.** The `SpatialHash` is only rebuilt in `GraphRenderer.updatePositions()` (the public method). Direct position updates like `handleDragMove` bypass this, leaving the hash stale. Hit-testing then fails at the new position. Always call `spatialHash.rebuild()` after any position mutation.

**Pitfall #17: Selection color restoration.** `NodeMesh.setSelection()` dims inactive nodes via opacity but `applySelection()` also changes selected node colors to `nodeActiveColor` via `setHover()`. When selection is cleared, `setSelection()` must restore original colors from the node data — resetting opacity alone leaves nodes stuck at the active color.

**Pitfall #18: Drag vs click disambiguation.** Pointer-down on a node must NOT immediately start dragging — this swallows the click event. Use a `pendingDragNodeId` pattern: record the node on pointer-down, promote to active drag only after a movement threshold (3px) in pointer-move. If pointer-up fires without threshold crossing, treat as a click.

**Pitfall #19: Ring mesh position sync.** The selection ring (`ringMesh`) copies the node's matrix at selection time but doesn't auto-update. If node positions change (drag, force layout ticks), the ring stays at the old position. `updatePositions()` must also update ring matrices via a `ringNodeIds` mapping.

**Pitfall #20: Sequential DB round-trips in loops.** The DB client uses MessageChannel round-trips (UI → SharedWorker → DedicatedWorker → SQLite → back). Calling `await db.someQuery()` in a `for` loop serializes these, causing multi-second latency with 20+ items. Use `Promise.all()` to parallelize independent DB calls (e.g., `entityResolution.findMatches` in `buildDiffItems` and `proceedToReview`).

**Pitfall #21: Tailwind utility classes may not apply in extension contexts.** Some Tailwind classes (especially spacing like `py-3`, `pt-3`) were observed not applying in the Chrome extension side panel, with computed styles showing `0px` despite correct class names and the classes existing in the CSS bundle. Use inline `style={{}}` props as a reliable fallback for critical spacing.

**Pitfall #22: sqlite-vec requires `k=?` in WHERE clause, not `LIMIT ?`.** The `vec0` virtual table planner doesn't reliably receive `LIMIT` constraints passed through SQLite's query optimizer. Always use `WHERE embedding MATCH ? AND k = ?` syntax for KNN queries. When excluding a node from results, request `k+1` and filter in JS rather than adding `AND node_id != ?` to the query.

**Pitfall #23: Barnes-Hut quadtree stack overflow from null positions.** Nodes from the DB may have `x = null, y = null`. The check `nodes[i].x !== 0` evaluates to `true` for `null` (since `null !== 0` is `true` in JS), treating them as having valid positions. `Float32Array` then coerces `null` to `0`, placing all null-positioned nodes at exactly (0,0). The quadtree subdivides infinitely trying to separate coincident nodes. Fix: check `!= null` explicitly before using positions. Safety net: depth limit of 50 on `insertIntoTree` recursion.

## Vector Embeddings (Electron-only)

Opt-in vector embedding system for semantic search. Off by default — configured through Settings panel. Desktop (Electron) only; Chrome extension is completely unaffected.

### Architecture

```
Renderer → IPC (embedding:*) → EmbeddingService → sqlite-vec (KNN) + Provider (ONNX/OpenAI)
```

- **`src/embeddings/types.ts`** — Type-only module (no runtime imports). Defines `EmbeddingProvider`, `EmbeddingConfig`, `PlatformEmbedding`. Safe to import from both Chrome and Electron builds.
- **`electron/embeddings/`** — All runtime code. `EmbeddingService` (orchestrator), `OnnxProvider` (worker_threads), `OpenAIProvider` (API), `EmbeddingQueue` (background processing), `vec-store.ts` (sqlite-vec wrapper).
- **`sqlite-vec`** — npm package, loaded via `sqliteVec.getLoadablePath()`. `vec_nodes` virtual table created by EmbeddingService at runtime (not in migrations).
- **Migration 009** — Creates `embedding_metadata` and `embedding_dismissals` tables. Marked `optional: true`. Regular SQL tables that work on both platforms.

### Chrome Isolation Constraints

- `src/embeddings/types.ts` must contain ONLY TypeScript types. No runtime imports from `@huggingface/transformers`, `sqlite-vec`, or Node.js modules.
- Both platform `index.ts` files export `embedding`. Chrome export is a frozen no-op.
- The `semantic_search` chat tool is dynamically appended in `chat-agent-loop.ts` when `platformId === 'electron'`. Never added to the shared `CHAT_AGENT_TOOLS` constant.

### What Embeddings Are Good For (and Not)

Embeddings work well for **rich text content** — notes, resources, multi-word queries:
- RAG retrieval: RRF blending of FTS5 + vector search in `rag-commands.ts`
- Search bar: semantic fallback for 3+ word queries with few FTS hits
- `semantic_search` chat tool: agent self-serves semantic retrieval
- Context chip auto-suggest: related nodes when attaching context to chat

Embeddings are **not effective for entity deduplication** — short names ("LLM", "ChatGPT") produce weak/noisy similarity scores. Acronym resolution ("LLM" = "Large Language Model") requires world knowledge that embedding models don't have. Entity merge detection uses the **chat agent's LLM** instead (via `merge_nodes` tool), which has the world knowledge to identify duplicates.

### Embedding Text Construction

Per-node type strategy in `electron/embeddings/build-embedding-text.ts`:
- **entity** → `"{name}. {label}. {summary}"` — includes label and edge labels as context for short names
- **note** → frontmatter `description`/`labels` preferred, fallback to first 500 chars of body
- **resource** → `"{name}. {source title}. {first 500 chars of content}"`

### EmbeddingService Initialization

The service initializes lazily inside the `db:request` IPC handler after the first successful DB init (not during `app.whenReady()`). This avoids the race condition where `getDb()` throws before better-sqlite3 is ready.

## Agent Settings Panel

User-facing configuration for agent behavior, accessible via Settings → Agent tab. Three concerns, two persistence layers:

| Concern | Storage | Scope |
|---|---|---|
| Prompt customization | `PlatformStorage` (`agentPromptConfig` key) | Per-user |
| Tool toggles | `PlatformStorage` (`agentToolConfig` key) | Per-user |
| Vault sandboxing | `.kg/agent-config.json` | Per-vault |

**Prompt customization:** Append-only — default prompts are read-only, user adds custom instructions appended after. Separate instructions for extraction agent (`extractionInstructions`) and chat agent (`chatInstructions`).

**Tool toggles:** Each tool can be individually disabled. Extraction tools filtered in `agent-loop.ts` before passing to LLM; `save_entities` is never filterable. Chat tools filtered in `chat-agent-loop.ts`; `semantic_search` follows the same filter.

**Vault sandboxing:** Per-vault directory allowlist (`allowedDirs` — empty = full access) and extension blocklist (`blockedExtensions` — defaults: `.env`, `.key`, `.pem`, `.p12`, `.pfx`). Enforced in `VaultFileWatcher.shouldIgnore()` and `ResourceDetectionHandler.handleFileAdded()`. Config loaded by `createVaultContext()`, cached on `VaultContext.sandboxConfig`, exposed to renderer via `vault-workspace:get-sandbox-config` / `vault-workspace:set-sandbox-config` IPC.

**Key files:**
- `src/shared/agent-settings-types.ts` — `AgentPromptConfig`, `AgentToolConfig`, `VaultSandboxConfig` types
- `src/ui/components/settings/AgentSettingsTab.tsx` — Main Agent tab component
- `src/ui/components/settings/ToolToggleRow.tsx` — Compact tool row with toggle
- `src/ui/components/settings/VaultSandboxSection.tsx` — Directory + extension controls
- `src/memory/governance.ts` — Supersession and access stat helpers

## Memory Harness v2

Governed memory system with modular retrieval pipeline. Files in `.kg/agent/memory/` are the source of truth.

### Memory File Schema

Extended frontmatter on memory files (`{type}_{name}.md`):

```yaml
---
name: prefers-concise-answers
description: User wants short, direct responses
type: preference          # preference | fact | instruction | episodic
tags: [communication, response-style]
superseded_by:            # filename of replacement (null if current)
valid: true               # false = superseded
access_count: 7
last_accessed: 2026-05-13T09:15:00Z
created_at: 2026-05-10T14:30:00Z
updated_at: 2026-05-13T09:15:00Z
---
```

All new fields are optional with backward-compatible defaults. Existing files work without modification.

### Write Path

**Inline self-governance:** The agent's system prompt includes Memory Guidelines (appended by `assembleSystemPrompt`). Before calling `manage_memory`, the agent checks for contradictions/duplicates. The `manage_memory` tool accepts `tags` (retrieval keywords) and `supersedes` (filename to replace). When `supersedes` is provided, `governance.ts:markSuperseded()` sets `valid: false` and `superseded_by` on the old file.

**Episodic unification:** Session summaries now write to files (`episodic_{date}-{slug}.md`) instead of the `memory_episodic` DB table. `memory-extractor.ts` uses a richer LLM prompt that returns JSON with `summary`, `tags`, and `slug`.

### Read Path: Retrieval Pipeline

```
User query → loadValidMemories() → retrievers → RRF fuser → annotated formatter → prompt
```

**Pipeline runner** (`src/memory/pipeline.ts`): Pluggable architecture — runs enabled retrievers, fuses results, formats for prompt, updates access stats.

**Metadata retriever** (`src/memory/retrievers/metadata-retriever.ts`): Always enabled. Scores by tag match (×2.0), content word match (×1.0), recency bonus (+0.5 if updated within 7 days), frequency bonus (+0.3 if >5 accesses), instruction type bonus (+0.2). Falls back to top-3 by access count when no keyword matches.

**RRF fuser** (`src/memory/fusers/rrf-fuser.ts`): Reciprocal rank fusion with k=60. Passthrough when only one retriever ran.

**Annotated formatter** (`src/memory/formatters/annotated-formatter.ts`): Produces `- [type, ★★★] content` lines with 3-tier confidence stars. Respects char budget (default 2000).

**Graceful degradation:** No memories → empty section. Memories but no embeddings → metadata retriever only. Memories + embeddings → both retrievers fire with RRF fusion (Phase 2).

### Prompt Assembly

`assembleSystemPrompt()` in `src/core/prompt-assembler.ts` receives:
- `memoryContext: string` — pre-formatted pipeline output (replaces old flat array)
- `recentSessionSummaries` — last 3 episodic memories by date (separate from retrieval)
- Always appends `MEMORY_GUIDELINES` section for agent self-governance

**Key files:**
- `src/memory/types.ts` — `RankedMemory`, `MemoryRetriever`, `MemoryFuser`, `MemoryFormatter` interfaces
- `src/memory/pipeline.ts` — `retrieveMemories()` pipeline runner
- `src/commands/memory-commands.ts` — `MemoryEntry`, `writeMemory()`, `loadValidMemories()`
- `src/utils/text-search.ts` — Shared `extractSearchTerms()` (stop-word filtering + keyword extraction)

## MCP Integration & Tool Registry

Synapse is both an **MCP client** (consumes external MCP servers) and **MCP server** (exposes graph tools to external agents like Claude Desktop, Claude Code, Cursor). Built on a unified ToolRegistry in the main process.

**Architecture:** All tool execution (built-in + MCP) routes through `ToolRegistry` in the Electron main process. The renderer calls `tools:list` and `tools:execute` IPC channels. See `ARCHITECTURE.md` § "MCP & Tool Registry" for full details.

**Real-time graph sync:** External MCP writes trigger immediate UI updates:
- **HTTP bridge** (`/mcp`): `McpServerBridge.onGraphMutated()` broadcasts `db:sync { type: 'reset' }` to renderer windows after write tool execution.
- **stdio CLI**: `notifyApp()` POSTs to `http://127.0.0.1:19876/api/graph-changed`. Companion server broadcasts the same reset event.

**stdio CLI write tools:** Gated by `--allow-write` flag. Write tools: `create_node`, `update_node`, `delete_node`, `create_edge`, `delete_edge`, `create_note`, `merge_nodes`.

**Desktop Extension:** `packages/synapse-mcp/manifest.json` defines a Claude Desktop Extension (`.mcpb`). Build via `cd packages/synapse-mcp && npm run pack`.

**Key files:**
- `electron/mcp/types.ts` — `ToolProvider`, `IToolRegistry`, `ToolFilter`, config interfaces
- `electron/mcp/tool-registry.ts` — Singleton registry with namespace-based dispatch (`__` separator)
- `electron/mcp/builtin-tool-provider.ts` — Wraps `ALL_CHAT_AGENT_TOOLS` for main-process execution
- `electron/mcp/mcp-client-manager.ts` — Outbound MCP connections (stdio transport)
- `electron/mcp/mcp-server-bridge.ts` — HTTP MCP server with `onGraphMutated` callback
- `electron/mcp/mcp-config.ts` — Two-layer config merge (global + vault `.kg/mcp.json`)
- `packages/synapse-mcp/` — Standalone stdio CLI + Desktop Extension manifest
- `src/commands/tools/` — Extended tool modules (note, edge, graph, entity)

**Configuration:** Global at `~/Library/Application Support/kg-desktop/mcp-config.json`, vault-level at `.kg/mcp.json`. Vault overrides global. Secrets via `${secret:name}`. Access profiles via `.kg/mcp-server.json`.

**Design spec:** [`docs/superpowers/specs/2026-05-15-mcp-integration-design.md`](docs/superpowers/specs/2026-05-15-mcp-integration-design.md)

## Chat Agent Tools

Tools defined in two layers: core tools in `src/shared/chat-agent-tools.ts` and extended tools in `src/commands/tools/` (modular architecture — each group is an independent module). Combined via `ALL_CHAT_AGENT_TOOLS`. Executed via ToolRegistry (`electron/mcp/builtin-tool-provider.ts` → `src/commands/chat-tool-executor.ts`).

**Core tools:**

| Tool | Category | Purpose |
|---|---|---|
| `search_knowledge` | read | RAG search with 1-hop expansion and source retrieval |
| `search_nodes` | read | FTS5 node search |
| `get_node_details` | read | Fetch single node by ID |
| `get_neighbors` | read | N-hop graph traversal |
| `get_edges_for_node` | read | Fetch edges for a node |
| `search_sources` | read | Search stored source content |
| `get_source_content` | read | Full source text retrieval |
| `semantic_search` | read | Vector similarity search (requires embeddings enabled) |
| `create_node` | write | Add new node |
| `update_node` | write | Modify existing node |
| `create_edge` | write | Add relationship |
| `get_nodes_batch` | read | Fetch multiple nodes by ID array (max 50) |
| `delete_node` | write | Remove single node and all edges |
| `delete_nodes_batch` | write | Remove multiple nodes by ID array (max 50) |
| `merge_nodes` | write | Merge duplicates: transfer edges, add alias, delete secondary |
| `manage_memory` | execute | CRUD for agent memory with tags and supersession |

**Extended tools** (`src/commands/tools/`):

| Module | Tools | Category |
|---|---|---|
| `note-tools.ts` | `read_note`, `create_note`, `update_note`, `list_notes`, `search_notes` | read/write |
| `edge-tools.ts` | `update_edge`, `delete_edge`, `get_edges_between` | read/write |
| `graph-tools.ts` | `get_graph_overview`, `get_subgraph`, `get_nodes_by_type` | read |
| `entity-tools.ts` | `find_similar_entities`, `add_alias`, `get_aliases`, `tag_node`, `get_node_tags` | read/write |

**Tool module pattern:** Each module exports `definitions` (tool schemas) + `execute(ctx, name, input)` returning `null` for unhandled tools. Combined in `src/commands/tools/index.ts`. The main executor delegates to `executeExtendedTool()` as a fallback. Adding/removing a module is a one-line import change.

Tool execution flows: renderer → `tools:execute` IPC → ToolRegistry → BuiltinToolProvider → `executeTool()` in `chat-tool-executor.ts` → extended tools fallback. The executor uses `CommandContext` (with `ctx.embedding` for semantic search) and has no `@platform` imports — it runs in both renderer (Chrome fallback) and main process.

## Graph-to-Chat Context Selection

Users can attach graph nodes as context to chat messages — like Cursor's `@file` references but for knowledge graph entities.

**Entry points:**
- **Right-click graph canvas** → "Send to Chat" context menu (sends selection or right-clicked node)
- **@-autocomplete in chat input** → type `@` then node name, select from dropdown → inserts `[[NodeName]]` inline

**Inline references:** `[[NodeName]]` in user messages renders as a clickable green link (resolved via `preprocessWikilinks` in `MarkdownRenderer`). The MarkdownRenderer also handles `[Name](node:id)` links from assistant responses.

**Context serialization:** `src/ui/utils/chat-context-serializer.ts` produces ~1 line per node with name/type/id/connections + availability hints ("has note", "has source"). Progressive disclosure — agent uses existing tools to drill deeper.

**State:** `src/graph/store/chat-context-store.ts` (Zustand) bridges graph selection and chat input. `ContextChipBar` shows removable chips above input. `ContextSuggestions` shows semantically related nodes for one-click addition (Electron-only, embedding-powered).

## URL Fetching & Companion Extension Fallback

When the Electron app fetches a URL (for extraction or agent `fetch_url` tool), it sends a browser-like `User-Agent` header to avoid bot blocking. If the site still returns 403/401/429, the UI shows an actionable amber panel directing the user to open the URL in Chrome with the **Synapse companion extension** installed, then capture via the toolbar button. An "Open in Browser" button launches the URL via `shell.openExternal`.

The companion extension (`packages/companion/`) captures the **rendered DOM** (not raw HTML) and POSTs it to the desktop app at `http://127.0.0.1:19876/api/capture`. Communication is unidirectional (browser → desktop). The `useCompanionCapture` hook receives captures via IPC and feeds them into the extraction pipeline.

## Graph Canvas Toolbar

`src/ui/components/graph/GraphControls.tsx` — toolbar overlay on the graph canvas:
- Layer toggles (entities/notes/resources)
- Node/edge count stats
- Zoom in/out (magnifier SVG icons), fit-to-view, refresh (reloads graph from DB), screenshot
- Create node button, delete selected button

**Refresh button** calls `useGraphStore.getState().loadAll()` which reloads all nodes/edges from the DB. Useful after chat agent mutations.

## Graph Store Sync

The graph store's `startSyncListener` subscribes to BOTH `BroadcastChannel` (Chrome cross-tab sync) AND `db.onSync` (Electron IPC). This ensures node/edge mutations from any source (chat tools, other windows, direct DB operations) immediately update the canvas.

## Key References

- **Platform interfaces**: `src/platform/types.ts` — `PlatformStorage`, `PlatformDB`, `PlatformNotes`, `PlatformLLM`, `PlatformBrowser`, `PlatformEmbedding`, `PlatformVault`, and LLM request/result types
- **Ingestion pipeline**: `src/ingestion/` — ContentProcessor interface, factory, pipeline orchestrator, PDF/Image processors
- **Ingestion spec**: [`docs/superpowers/specs/2026-05-03-multi-modal-ingestion-design.md`](docs/superpowers/specs/2026-05-03-multi-modal-ingestion-design.md)
- **Shared UI**: `src/ui/components/shared/PanelHeader.tsx` — Reusable panel header with close button (used by all sidebar panels)
- **Embedding types**: `src/embeddings/types.ts` — Type-only module for embedding interfaces (safe for both platforms)
- **Embedding implementation**: `electron/embeddings/` — EmbeddingService, providers, queue, vec-store (Electron-only)
- **Chat tools**: `src/shared/chat-agent-tools.ts` — tool definitions; `src/commands/chat-tool-executor.ts` — execution handlers
- **MCP / Tool Registry**: `electron/mcp/` — ToolRegistry, BuiltinToolProvider, McpClientManager, McpServerBridge, config, IPC
- **MCP CLI**: `packages/synapse-mcp/` — standalone stdio server for Claude Code/Cursor
- **MCP design spec**: [`docs/superpowers/specs/2026-05-15-mcp-integration-design.md`](docs/superpowers/specs/2026-05-15-mcp-integration-design.md)
- **Chat context**: `src/graph/store/chat-context-store.ts` — Zustand store bridging graph selection and chat; `src/ui/utils/chat-context-serializer.ts` — minimal node serialization
- **Embedding spec**: [`docs/superpowers/specs/2026-05-04-vector-embeddings-design.md`](docs/superpowers/specs/2026-05-04-vector-embeddings-design.md)
- **DataStore interface**: `src/db/data-store.ts` — 16 repository sub-interfaces for engine-swappable persistence. `src/db/sqlite-data-store.ts` is the current implementation.
- **Agent settings types**: `src/shared/agent-settings-types.ts` — `AgentPromptConfig`, `AgentToolConfig`, `VaultSandboxConfig`
- **Memory pipeline**: `src/memory/` — types, pipeline runner, metadata retriever, RRF fuser, annotated formatter, governance
- **Memory commands**: `src/commands/memory-commands.ts` — `MemoryEntry`, file I/O, `loadValidMemories()`
- **Memory spec**: [`docs/superpowers/specs/2026-05-13-memory-harness-v2-design.md`](docs/superpowers/specs/2026-05-13-memory-harness-v2-design.md)
- **Agent settings spec**: [`docs/superpowers/specs/2026-05-14-agent-settings-panel-design.md`](docs/superpowers/specs/2026-05-14-agent-settings-panel-design.md)
- **Shared core**: `src/core/` — `llm-protocol.ts` (provider-neutral `LLMMessage`, `StreamFn`, `LLMStreamResult`), `agent-loop.ts` (injectable `StreamFn` + `ToolExecutor`), `memory-extractor.ts` (accepts `CommandContext` + model), `retry.ts`, `usage.ts`, `system-prompts.ts`, `prompt-assembler.ts`
- **LLM provider factory**: `electron/llm-backend.ts` — `streamFnRegistry`/`extractionFnRegistry` dispatch by provider name; `registerStreamFn()`/`registerExtractionFn()` for adding providers
- **Types**: `src/shared/types.ts` — `DbNode`, `DbEdge`, `GraphNode`, `GraphEdge`, `LLMConfig`, `ToolCall`, `AgentTurn`, `AgentProgressEvent`
- **Messages**: `src/shared/messages.ts` — Chrome-internal message protocol (UI code should NOT import this — use `@platform` instead)
- **Constants**: `src/shared/constants.ts` — Color palette, timeouts, LLM model IDs, layout options
- **Path aliases**: `@/` maps to `src/`, `@platform` maps to `src/platform/chrome/` (Chrome build) or `src/platform/electron/` (Electron build)
- **Platform design spec**: [`docs/superpowers/specs/2026-05-02-platform-abstraction-layer-design.md`](docs/superpowers/specs/2026-05-02-platform-abstraction-layer-design.md)
- **Detailed docs**: `ARCHITECTURE.md` for full system design, SQLite schema, and 13 documented pitfalls
- **Search**: [`docs/search.md`](docs/search.md) — FTS5 sanitization, LIKE fallback, UI debounce/stale-cancellation
- **Pitfalls**: `docs/pitfalls/` — Detailed writeups of specific Chrome extension pitfalls
- **Note storage ADR**: [`docs/adr-opfs-note-storage.md`](docs/adr-opfs-note-storage.md) — OPFS note files, FTS5 strategy, duplication tradeoff
