# Agentic-First Architecture Design Spec

## Problem

The knowledge graph app has strong **bottom-half** abstractions (DataStore for persistence, PlatformNotes/Storage/LLM/Browser for I/O), but all business logic is trapped in React hooks and Zustand stores. An external agent, MCP client, or plugin cannot operate on the knowledge graph without puppeteering the React UI.

## Goal

Make the app controllable by any AI agent (built-in, Claude Desktop, Cursor, custom) and extensible via plugins (Obsidian-style), by extracting a command layer that any adapter can call.

## Architecture

```
┌───────────┐  ┌───────────┐  ┌──────────┐  ┌─────────┐
│  React UI │  │ MCP Server│  │ HTTP API │  │ Plugins │
│  (hooks)  │  │ (stdio/SSE)│ │ (future) │  │         │
└─────┬─────┘  └─────┬─────┘  └────┬─────┘  └────┬────┘
      │              │              │              │
      ▼              ▼              ▼              ▼
┌─────────────────────────────────────────────────────┐
│  Command Layer  +  Tool Registry  +  Event Bus      │
│  src/commands/     src/tools/        src/events/     │
└──────────────┬──────────────────────────────────────┘
               │
     ┌─────────┼──────────┐
     ▼         ▼          ▼
 DataStore  PlatformNotes  PlatformLLM  ...
```

## Phases

| Phase | Scope | Depends On |
|-------|-------|-----------|
| 1. Command Layer | Extract orchestration from hooks/stores into `src/commands/` | Nothing |
| 2. Tool Registry | Replace hardcoded tool arrays with dynamic registry in `src/tools/` | Phase 1 |
| 3. Event Bus | Formalize BroadcastChannel sync into typed pub/sub in `src/events/` | Phase 1 |
| 4. MCP Server | Expose commands to external agents via MCP in `src/mcp/` | Phases 1 + 3 |

---

## Phase 1: Command Layer

### What's Missing (the "top half")

Business logic is trapped in React hooks and Zustand stores:

| Current Location | Logic |
|---|---|
| `useLLMExtraction.ts` (~1044 lines) | Entity extraction, diff building, review, 3-phase merge |
| `chat-agent-loop.ts` (~443 lines) | Chat tool dispatch (10-tool switch), agent loop, subgraph tracking |
| `graph-store.ts` (~426 lines) | Node/edge CRUD with DB calls, provenance, cascade cleanup |
| `rag-pipeline.ts` (~257 lines) | RAG retrieval, subgraph expansion, source excerpts |
| `wikilink-parser.ts` (~141 lines) | Wikilink resolution + edge creation (uses useGraphStore) |
| `useChatSession.ts` (~218 lines) | Session lifecycle, message persistence |
| `useNLQuery.ts` (~63 lines) | NL → GraphQL pipeline |

### Design

Commands are pure async functions that take a `CommandContext` (dependency bag) and return `CommandResult<T>` (data + events). React hooks become thin wrappers.

```typescript
import type { DataStore } from '../db/data-store';

interface CommandContext {
  db: DataStore;            // the existing 16-repository interface (src/db/data-store.ts)
  storage: PlatformStorage;
  notes: PlatformNotes;
  llm: PlatformLLM;
  browser: PlatformBrowser;
  getGraphSnapshot(): Promise<{ nodes: GraphNode[]; edges: GraphEdge[] }>;
}

interface CommandResult<T> {
  data: T;
  events: CommandEvent[];   // node_created, edge_deleted, reset, etc.
}
```

**Critical design rule:** `CommandContext.db` is `DataStore` — the existing 16-repository interface at `src/db/data-store.ts`. Commands call `ctx.db.nodes.create()`, `ctx.db.entityResolution.findMatches()`, etc. Commands NEVER import from `src/db/client/db-client.ts` (that's a renderer-specific transport wrapper).

For UI context, `createUICommandContext()` builds a `DataStore`-shaped adapter that delegates to `db-client.ts` namespaces (since db-client already has the right methods, just with renderer transport). For MCP/server context, it uses `SqliteDataStore` directly. `getGraphSnapshot()` is async (`Promise<...>`) — UI wraps Zustand state with `Promise.resolve()`; server queries the DB.

### Command Modules

| Module | Extracts From | Operations |
|---|---|---|
| `graph-commands.ts` | `graph-store.ts` | createNode, updateNode, deleteNode, createEdge, updateEdge, deleteEdge, clearAll |
| `extraction-commands.ts` | `useLLMExtraction.ts` | normalizeExtractedNode, ensureResourceNode, buildDiffItems, applyDiff, buildReviewData, applyReview |
| `note-commands.ts` | `NoteEditor.tsx` + `wikilink-parser.ts` | saveNote, createWikilinkEdgesForNote |
| `rag-commands.ts` | `rag-pipeline.ts` | retrieveRAGContext, formatRAGPrompt |
| `chat-tool-executor.ts` | `chat-agent-loop.ts` | executeTool (all 10 chat tools) |
| `chat-commands.ts` | `useChatSession.ts` | ensureSession, sendChatMessage |
| `nl-query-commands.ts` | `useNLQuery.ts` | executeNLQuery |

### Migration Pattern

```typescript
// Before: hook does everything
const startExtraction = useCallback(async (text, sourceUrl) => {
  // 70 lines of orchestration with direct store/DB/platform calls
}, [...]);

// After: hook is thin wrapper
const startExtraction = useCallback(async (text, sourceUrl) => {
  const ctx = createUICommandContext();
  const result = await extractionCommands.startExtraction(ctx, text, sourceUrl, callbacks);
  llmStore.getState().setDiff(result.data.diff);
}, [...]);
```

### Risk: useGraphStore.getState() in extraction

`applyReview` (290-line merge) reads Zustand state mid-execution. After extraction to commands, it uses `ctx.getGraphSnapshot()` for the baseline, but newly-created nodes are tracked in a local map (`tempIdToRealId`) — the same pattern the original code uses. No behavior change needed.

---

## Phase 2: Tool Registry

**Supersedes** the agent harness chat-only registry (`src/shared/chat-tool-registry.ts` from `docs/superpowers/plans/2026-05-03-agent-harness-phase1.md`). The harness plan should NOT build its own registry — it should register its tools (e.g., `index_notes_folder`) into the unified registry built here.

### Current State

- `src/shared/agent-tools.ts` — 9 extraction tools in static `AGENT_TOOLS` array
- `src/shared/chat-agent-tools.ts` — 10 chat tools in static `CHAT_AGENT_TOOLS` array
- Tool dispatch via switch statements in 4 locations
- System prompts hardcode tool descriptions

### Design

```typescript
interface UnifiedToolDefinition {
  name: string;
  description: string;
  parameters: Record<string, unknown>;  // JSON Schema
  category: 'extraction' | 'chat' | 'graph' | 'custom';
  execute?: (input: Record<string, unknown>, ctx: CommandContext) => Promise<string>;
}
```

Tools with `execute` run anywhere. Content-script tools (DOM access) leave `execute` undefined — dispatched via `browser.executeTool()`.

### Components

| Component | Purpose |
|---|---|
| `ToolRegistry` class | `register()`, `unregister()`, `get()`, `list()`, `toAnthropicTools()` |
| `ToolDispatcher` class | Implements `ToolExecutor` interface, uses registry + ctx + content-script fallback |
| Built-in tools | extraction-tools (9), chat-tools (10), graph-tools (new: kg_create_node, etc.) |
| Prompt builder | Auto-generates system prompts from registered tools |

### Agent Loop Migration

`src/core/agent-loop.ts` accepts tools + system prompt as parameters instead of importing hardcoded arrays. Callers pass a `ToolDispatcher`.

---

## Phase 3: Event Bus

### Current State

- `src/shared/sync-events.ts` — 10 `SyncEvent` types over `BroadcastChannel`
- 5 separate `BroadcastChannel` instances across files for the same channel
- No lifecycle events (extraction_started, etc.)
- No subscription API for external consumers

### Design

```typescript
type KGEvent = SyncEvent | LifecycleEvent;

type LifecycleEvent =
  | { type: 'extraction_started'; mode: 'simple' | 'agent' }
  | { type: 'extraction_complete'; nodesAdded: number; edgesAdded: number }
  | { type: 'extraction_error'; error: string }
  | { type: 'chat_message'; sessionId: string; role: string }
  | { type: 'tool_registered'; toolName: string }
  | { type: 'tool_unregistered'; toolName: string };
```

`EventBus` class: `on(type, handler)`, `onAny(handler)`, `emit(event)`, `emitAll(events)`, `enableBroadcast()`, `disableBroadcast()`.

### Key Invariants

1. The DB layer (`db-shared-worker.ts`) continues posting to `BroadcastChannel` directly. The eventBus **receives** from it, not replaces it. Stores subscribe via `eventBus.on(...)` instead of opening their own channels.

2. **React StrictMode safety:** The EventBus singleton must NOT have a permanent `disposed` flag. App cleanup calls `disableBroadcast()` (closes the BroadcastChannel) instead of `dispose()`. `enableBroadcast()` is idempotent and can be called again after disable. This prevents dev double-mount from permanently killing the singleton.

3. **Electron main-process bridge (deferred):** The renderer EventBus only covers the renderer process. MCP (Phase 4) runs in Electron's main process and broadcasts command events to renderer windows via an injected `EventBroadcaster` callback. Forwarding events to MCP clients as notifications is deferred until the EventBus (Phase 3) provides a `MainProcessEventBridge` with proper subscription infrastructure. Phase 4 v1 does NOT deliver MCP client notifications — it only syncs the renderer UI.

---

## Phase 4: MCP Server

### Design

MCP server runs in Electron main process. Two transports:
- **stdio** — for Claude Desktop / Cursor integration
- **HTTP-SSE** — extends companion server on port 19876

**Event delivery:** The main process already receives DB sync events (it broadcasts them to renderer windows via `win.webContents.send('db:sync', ...)`). A `MainProcessEventBridge` intercepts these same sync events and forwards them to connected MCP clients as notifications. This is separate from the renderer `eventBus` singleton.

### MCP Tools (from commands)

| MCP Tool | Source |
|---|---|
| `kg_create_node`, `kg_update_node`, `kg_delete_node` | `graphCommands.*` |
| `kg_create_edge`, `kg_search_nodes`, `kg_get_node` | `graphCommands.*` + `ctx.db.*` |
| `kg_get_neighbors`, `kg_search_sources`, `kg_get_source_content` | `ctx.db.*` |
| `kg_extract_text`, `kg_extract_url` | `extractionCommands.*` |
| `kg_save_note`, `kg_read_note`, `kg_search_notes` | `noteCommands.*` + `ctx.db.*` |
| `kg_query`, `kg_nl_query` | `ctx.db.graphQuery()` + `nlQueryCommands.*` |

### MCP Resources

| URI Pattern | Data |
|---|---|
| `kg://graph/stats` | Node/edge counts, type distribution |
| `kg://nodes/{id}` | Full node with properties |
| `kg://notes/{nodeId}` | Note markdown content |
| `kg://sources/{nodeId}` | Stored page content |

### Server CommandContext

`createServerCommandContext()` builds a `CommandContext` without Zustand — uses `DataStore` directly for `getGraphSnapshot()`.

### Chrome Extension

Chrome extensions cannot run MCP servers. MCP is Electron-only. Chrome access requires the Electron app running as a bridge.

---

## Verification

| Phase | Verification |
|-------|-------------|
| 1 | `npm run build` + `npm run build:electron` clean. All extraction, review, chat, note, create panel workflows work on both platforms. |
| 2 | Register a test tool at runtime → appears in system prompt. All extraction + chat flows work. |
| 3 | Cross-tab sync works. Subscribe to events via console → events fire. |
| 4 | Claude Desktop sees KG tools. Create node via Claude → appears in Electron app. |

## Risk Matrix

| Risk | Phase | Mitigation |
|------|-------|-----------|
| `applyReview` regression (290 lines) | 1 | Track created nodes in local map, snapshot only needs pre-command state |
| System prompt quality regression | 2 | Diff auto-generated vs handcrafted prompts before switching |
| Cross-tab sync break | 3 | Keep BroadcastChannel as eventBus internal transport |
| EventBus killed by React StrictMode | 3 | `disableBroadcast()` not `dispose()` for cleanup; `enableBroadcast()` idempotent |
| MCP can't receive events from renderer | 4 | MainProcessEventBridge in Electron main, separate from renderer eventBus |
| MCP adds dependency with no Chrome benefit | 4 | Electron-only scope |
| RAG subgraph tracking is global state | 1 | Return subgraph IDs per tool invocation, not module-level globals |

## Relationship to Agent Harness

The agent harness spec (`docs/superpowers/specs/2026-05-03-agent-harness-design.md`) adds custom prompts, memory, and a chat-only tool registry. It was designed before this agentic-first architecture.

**Sequencing:** Implement the agentic-first command layer (Phase 1) and tool registry (Phase 2) FIRST. Then the harness builds on top:
- Harness custom prompts → still works (prompt assembly is orthogonal to commands)
- Harness tool registry (`chat-tool-registry.ts`) → **SUPERSEDED** by unified `src/tools/registry.ts`. Harness registers its tools (e.g., `index_notes_folder`) into the unified registry instead.
- Harness memory → should add `MemoryRepository` to `DataStore` (not import memoryQueries directly into action-handler)
- Harness preset `allowedTools`/`model` → enforced at `ToolDispatcher` level (filter registry by preset's allowedTools list)
