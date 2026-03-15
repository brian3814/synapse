# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Chrome Manifest V3 extension providing a local-first knowledge graph with SQLite persistence (wa-sqlite + OPFS), 2D graph visualization (custom Three.js renderer with InstancedMesh), and LLM-powered entity extraction. The UI runs in the Chrome Side Panel (default) or a full tab.

## Build Commands

```bash
npm run build     # TypeScript check (tsc) + Vite production build
npm run dev       # Vite build in watch mode (load dist/ in chrome://extensions)
```

No test framework or linter is configured. After building, load `dist/` as an unpacked extension in `chrome://extensions` (developer mode).

## Architecture

Six execution contexts with different capabilities and API access:

| Context | Key Restriction |
|---|---|
| **Service Worker** (`src/service-worker/`) | No DOM, no long-running tasks. Must not use dynamic imports (Vite polyfill references `document`). Only context that should read `chrome.storage` for sensitive data (API keys). |
| **Side Panel / Tab** (`src/ui/`) | React 19 SPA. Same `index.html` serves both (`?mode=sidePanel` vs `?mode=tab`). |
| **Offscreen Document** (`src/offscreen/`) | Has DOM + fetch but **no `chrome.storage`**, no `chrome.tabs` (Pitfall #13). Receives API keys via message payload from SW. |
| **Content Script** (`src/content-script/`) | Per-page isolated world. Extracts page text, executes agent tools. Built as IIFE. |
| **DB SharedWorker** (`src/db/worker/db-shared-worker.ts`) | Pure coordinator/router. No `Worker` constructor (Pitfall #12), no `chrome.*` APIs. |
| **DB Dedicated Worker** (`src/db/worker/db-worker.ts`) | Runs wa-sqlite + OPFS. Created by UI thread, bridged to SharedWorker via `MessageChannel`. |

Communication between contexts uses `chrome.runtime.sendMessage` with typed messages in `src/shared/messages.ts`.

### API Key Security Pattern

UI messages **never carry API keys**. The service worker reads keys from `chrome.storage.local` and injects them before forwarding to the offscreen document. This prevents key leakage via `chrome.runtime.sendMessage` broadcasts (which all extension contexts receive).

```
UI ─── LLM_REQUEST (no key) ──→ Service Worker ─── LLM_REQUEST (+ apiKey) ──→ Offscreen
```

Message types reflect this: `LLMRequestMessage` (UI→SW, no key) vs `LLMRequestWithKeyMessage` (SW→offscreen, with key). Same pattern for `AgentRunStartMessage` / `AgentRunStartWithKeyMessage`.

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

**Simple text extraction** (`useLLMExtraction.startExtraction`): Raw text → `LLM_REQUEST` → streaming JSON → parse via `extractionResultSchema` (Zod) → diff with existing graph → review.

**Agent page extraction** (`useLLMExtraction.startAgentExtraction`): `AGENT_RUN_START` → offscreen runs agentic tool-use loop (max 15 iterations) → content script tools (`get_page_content`, `get_page_metadata`, `query_selector`, `query_selector_all`, `get_links`, `get_tables`, `get_structured_data`, `fetch_url`) → terminal `save_entities` tool → review.

**Review flow** (`ExtractionReview` replaces old `DiffView`):
- Converts diff items → `ReviewNode[]`/`ReviewEdge[]` with merge recommendations (fuzzy matching via entity resolution)
- Mini graph preview (Three.js ReviewGraphCanvas) or overlay on main graph
- Inline editing, add/remove nodes/edges, undo/redo
- Convert-to-property: async LLM call suggests inverse property keys, user confirms
- `applyReview()` commits to DB, resolving temp IDs → real IDs

## Build System

Vite config (`vite.config.ts`) produces 7 outputs via custom plugins:

| Output | Plugin | Format |
|---|---|---|
| React SPA + service worker + offscreen | Main build (multi-entry) | ES modules |
| `db-worker.js` + `wa-sqlite-async.wasm` | `dbWorkerPlugin` | ES module (no content hash on WASM) |
| `db-shared-worker.js` | `dbSharedWorkerPlugin` | ES module |
| `layout-worker.js` | `layoutWorkerPlugin` | ES module |
| `content-script.js` | `contentScriptPlugin` | IIFE |

Key config: `base: ''` (chrome-extension:// relative paths), `modulePreload: false` (prevents DOM polyfill in SW).

## Chrome Extension CSP Constraints

CSP `script-src 'self' 'wasm-unsafe-eval'` blocks all `blob:` URLs. This affects:

- **DB Worker** — Built as separate entry, loaded via `new URL('/db-worker.js', location.origin)`.
- **Layout Worker** — Built as separate entry, loaded via `new URL('/layout-worker.js', location.origin)`. Runs Barnes-Hut force-directed layout off the main thread.

## Database Layer

- `src/db/worker/sqlite-engine.ts` — All SQLite ops serialized through a promise queue (prevents wa-sqlite Asyncify corruption). VFS fallback: OPFS → IDB → in-memory. **Critical:** `open_v2` must be inside each VFS try/catch (Pitfall #11).
- `src/db/worker/migrations/` — Versioned, FTS5 detected at runtime. Migration 002 (FTS) is optional; search falls back to LIKE.
- `src/db/client/db-client.ts` — UI-thread client with requestId-based response matching and 10s timeouts.

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

## Key References

- **Types**: `src/shared/types.ts` — `DbNode`, `DbEdge`, `GraphNode`, `GraphEdge`, `LLMConfig`, `ToolCall`, `AgentTurn`, `AgentProgressEvent`
- **Messages**: `src/shared/messages.ts` — Full typed message protocol, `RuntimeMessage` union
- **Constants**: `src/shared/constants.ts` — Color palette, timeouts, LLM model IDs, layout options
- **Path alias**: `@/` maps to `src/` in both TypeScript and Vite configs
- **Detailed docs**: `ARCHITECTURE.md` for full system design, SQLite schema, and 13 documented pitfalls
- **Search**: [`docs/search.md`](docs/search.md) — FTS5 sanitization, LIKE fallback, UI debounce/stale-cancellation
- **Pitfalls**: `docs/pitfalls/` — Detailed writeups of specific Chrome extension pitfalls
