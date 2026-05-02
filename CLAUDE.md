# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Local-first knowledge graph with SQLite persistence, 2D graph visualization (custom Three.js renderer with InstancedMesh), and LLM-powered entity extraction. Runs as both a **Chrome Manifest V3 extension** (side panel or full tab) and an **Electron desktop app** from the same codebase via a platform abstraction layer.

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
```

No test framework or linter is configured. For Chrome, load `dist/` as an unpacked extension in `chrome://extensions` (developer mode). For Electron, run `npx electron .` after building.

## Architecture

### Platform Abstraction Layer

The app runs on two platforms from one codebase. UI code imports `@platform` (Vite build-time alias) and never touches `chrome.*` or `ipcRenderer` directly.

```
┌─────────────────────────────────────────────────┐
│  UI / React Layer (platform-agnostic)            │
│  All I/O via: import { storage, db, notes,       │
│               llm, browser } from '@platform'    │
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
│  External (Anthropic API, SQLite, Filesystem)    │
└─────────────────────────────────────────────────┘
```

**Five platform interfaces** in `src/platform/types.ts`:

| Interface | Chrome Implementation | Electron Implementation |
|---|---|---|
| `PlatformStorage` | `chrome.storage.local` | IPC → JSON config file |
| `PlatformDB` | SharedWorker/DedicatedWorker + wa-sqlite | IPC → better-sqlite3 in main process |
| `PlatformNotes` | OPFS async API | IPC → local filesystem |
| `PlatformLLM` | Message-based streaming via SW/offscreen | Dedicated IPC channels (`llm:stream-extraction`, `llm:run-agent`, `llm:stream-chat`) |
| `PlatformBrowser` | `chrome.tabs`, content scripts | Companion extension dispatch or no-op |

**Build-time resolution**: `vite.config.chrome.ts` maps `@platform` → `src/platform/chrome/`. `vite.config.electron.ts` maps `@platform` → `src/platform/electron/`. TypeScript `tsconfig.json` paths point at Chrome as IDE default.

**Platform-specific UI**: Use `import { platformId } from '@platform'` and conditional rendering. Chrome-only features (side panel toggle, OAuth, reading list, contextual relevance) are guarded with `platformId === 'chrome'`.

**Shared core** (`src/core/`): Agent loop, rate-limit retry, usage tracking, and system prompts — imported by both the Chrome offscreen document and Electron main process. Eliminates duplication.

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

**Review flow** (`ExtractionReview` replaces old `DiffView`):
- Converts diff items → `ReviewNode[]`/`ReviewEdge[]` with merge recommendations (fuzzy matching via entity resolution)
- Mini graph preview (Three.js ReviewGraphCanvas) or overlay on main graph
- Inline editing, add/remove nodes/edges, undo/redo
- Convert-to-property: async LLM call suggests inverse property keys, user confirms
- `applyReview()` commits to DB, resolving temp IDs → real IDs

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

- `src/db/worker/sqlite-engine.ts` — All SQLite ops serialized through a promise queue (prevents wa-sqlite Asyncify corruption). VFS fallback: OPFS → IDB → in-memory. **Critical:** `open_v2` must be inside each VFS try/catch (Pitfall #11).
- `src/db/worker/migrations/` — Versioned, FTS5 detected at runtime. Migration 002 (FTS) is optional; search falls back to LIKE.
- `src/db/client/db-client.ts` — Platform-agnostic typed API. Imports `db` from `@platform` and delegates via `db.request(action, params)`. All 30+ typed namespace methods (`nodes`, `edges`, `spatial`, `chat`, etc.) are shared code. Platform transport is in `ChromeDB` (SharedWorker/MessagePort) or `ElectronDB` (IPC to better-sqlite3).

## Note Content Storage

Note content is stored as `.md` files, NOT in SQLite. UI code accesses notes via `import { notes } from '@platform'` (`PlatformNotes` interface). See [`docs/adr-opfs-note-storage.md`](docs/adr-opfs-note-storage.md) for full ADR.

- **Chrome**: `src/platform/chrome/notes.ts` — OPFS async API (`notes/{node_id}.md`)
- **Electron**: `src/platform/electron/notes.ts` — IPC to main process → local filesystem at `~/Documents/KnowledgeGraph/notes/{node_id}.md`. Path resolved via `app.getPath('documents')` (macOS: `~/Documents/`, Windows: `C:\Users\<user>\Documents\`, Linux: `~/Documents/`). Chosen over `app.getPath('userData')` so notes are user-visible and editable in any text editor.
- **`src/notes/markdown-utils.ts`** — `stripMarkdownToPlainText()` for FTS tokenization, re-exports `parseMarkdown`/`generateNoteMarkdown`
- **`note_search` table** (in 001-initial-schema) — Backing table for FTS5 external content. Stores `node_id`, `title`, stripped plain-text `body`.
- **`notes_fts` virtual table** (in 002-fts-index) — External content FTS5 on `note_search`. Auto-synced via INSERT/DELETE/UPDATE triggers.
- **Write ordering**: OPFS first, then `note_search` upsert, then `nodes` metadata update. Orphaned OPFS files are harmless; dangling DB references are not.
- **`nodes.properties`** for notes contains only `{ wikiLinks }` — no content. Content is never stored in `source_content` for notes.
- **Cross-tab sync**: `BroadcastChannel(SYNC_CHANNEL)` with `note_content_updated` event type.
- **Accepted duplication**: Note body exists in OPFS (markdown) and `note_search.body` (plain text for FTS). Will be eliminated when wa-sqlite upgrades to SQLite 3.43+ (`contentless_delete=1`).

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

## Key References

- **Platform interfaces**: `src/platform/types.ts` — `PlatformStorage`, `PlatformDB`, `PlatformNotes`, `PlatformLLM`, `PlatformBrowser`, and LLM request/result types
- **Shared core**: `src/core/` — `agent-loop.ts` (injectable ToolExecutor), `retry.ts` (withRetry), `usage.ts`, `system-prompts.ts`
- **Types**: `src/shared/types.ts` — `DbNode`, `DbEdge`, `GraphNode`, `GraphEdge`, `LLMConfig`, `ToolCall`, `AgentTurn`, `AgentProgressEvent`
- **Messages**: `src/shared/messages.ts` — Chrome-internal message protocol (UI code should NOT import this — use `@platform` instead)
- **Constants**: `src/shared/constants.ts` — Color palette, timeouts, LLM model IDs, layout options
- **Path aliases**: `@/` maps to `src/`, `@platform` maps to `src/platform/chrome/` (Chrome build) or `src/platform/electron/` (Electron build)
- **Platform design spec**: [`docs/superpowers/specs/2026-05-02-platform-abstraction-layer-design.md`](docs/superpowers/specs/2026-05-02-platform-abstraction-layer-design.md)
- **Detailed docs**: `ARCHITECTURE.md` for full system design, SQLite schema, and 13 documented pitfalls
- **Search**: [`docs/search.md`](docs/search.md) — FTS5 sanitization, LIKE fallback, UI debounce/stale-cancellation
- **Pitfalls**: `docs/pitfalls/` — Detailed writeups of specific Chrome extension pitfalls
- **Note storage ADR**: [`docs/adr-opfs-note-storage.md`](docs/adr-opfs-note-storage.md) — OPFS note files, FTS5 strategy, duplication tradeoff
