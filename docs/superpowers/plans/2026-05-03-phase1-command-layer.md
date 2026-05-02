# Phase 1: Command Layer Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Extract all business logic orchestration from React hooks and Zustand stores into platform-agnostic command functions that any caller (UI, MCP server, plugin) can invoke.

**Architecture:** Commands are pure async functions in `src/commands/` that take a `CommandContext` dependency bag (DB repositories + platform services + graph snapshot) and return `CommandResult<T>` (data + events). React hooks become thin wrappers that create the context, call the command, then apply results to Zustand stores. The `CommandContext.db` field is the existing `DataStore` interface (`src/db/data-store.ts`), so commands are already compatible with any future DB backend.

**Tech Stack:** TypeScript, Zustand (stores stay for UI state), existing DataStore/Platform interfaces

**No test framework configured.** Verification = `npm run build` + `npm run build:electron` clean + manual smoke test.

---

## File Structure

### New files

| File | Responsibility |
|------|---------------|
| `src/commands/types.ts` | `CommandContext`, `CommandResult<T>`, `CommandEvent` types |
| `src/commands/create-context.ts` | Factory: `createUICommandContext()` wires db-client + Zustand + @platform |
| `src/commands/graph-commands.ts` | Node/edge CRUD with cleanup + provenance |
| `src/commands/extraction-commands.ts` | Entity extraction + diff + review + merge pipeline |
| `src/commands/note-commands.ts` | Note save + wikilink edge creation |
| `src/commands/rag-commands.ts` | RAG retrieval + prompt formatting |
| `src/commands/chat-tool-executor.ts` | Chat tool dispatch (extracted from switch statement) |
| `src/commands/chat-commands.ts` | Chat agent loop orchestration |
| `src/commands/nl-query-commands.ts` | Natural language → graph query pipeline |
| `src/commands/index.ts` | Barrel export |

### Modified files

| File | Change |
|------|--------|
| `src/graph/store/graph-store.ts` | CRUD methods become thin wrappers calling graph-commands |
| `src/ui/hooks/useLLMExtraction.ts` | 6 orchestration functions delegate to extraction-commands |
| `src/ui/hooks/chat-agent-loop.ts` | `executeTool` switch → `chatToolExecutor.execute()` |
| `src/ui/hooks/rag-pipeline.ts` | `retrieveRAGContext` + helpers → delegate to rag-commands |
| `src/ui/hooks/useChatSession.ts` | Session mgmt stays, `sendMessage` delegates to chat-commands |
| `src/ui/hooks/useNLQuery.ts` | `execute` delegates to nl-query-commands |
| `src/shared/wikilink-parser.ts` | `resolveWikilinks` + `createWikilinkEdgesForNote` accept ctx instead of using `useGraphStore.getState()` |

---

### Task 1: CommandContext and CommandResult types

**Files:**
- Create: `src/commands/types.ts`

- [ ] **Step 1: Create types file**

```typescript
// src/commands/types.ts
import type { DataStore } from '../db/data-store';
import type { PlatformStorage, PlatformNotes, PlatformLLM, PlatformBrowser } from '../platform/types';
import type { GraphNode, GraphEdge, DbNode, DbEdge, NodeType } from '../shared/types';

/**
 * CommandContext — dependency bag for all command functions.
 *
 * CRITICAL: `db` is the DataStore interface (src/db/data-store.ts), NOT the
 * renderer db-client. Commands call ctx.db.nodes.create(), ctx.db.entityResolution.findMatches(), etc.
 * This makes commands platform-agnostic — they work in UI context (via adapter over db-client),
 * MCP server context (via SqliteDataStore directly), or any future context.
 */
export interface CommandContext {
  db: DataStore;
  storage: PlatformStorage;
  notes: PlatformNotes;
  llm: PlatformLLM;
  browser: PlatformBrowser;
  /** Async to support both renderer (Promise.resolve of Zustand) and server (DB query). */
  getGraphSnapshot(): Promise<{ nodes: GraphNode[]; edges: GraphEdge[] }>;
}

export interface CommandResult<T> {
  data: T;
  events: CommandEvent[];
}

export type CommandEvent =
  | { type: 'node_created'; node: DbNode }
  | { type: 'node_updated'; node: DbNode }
  | { type: 'node_deleted'; id: string }
  | { type: 'edge_created'; edge: DbEdge }
  | { type: 'edge_updated'; edge: DbEdge }
  | { type: 'edge_deleted'; id: string }
  | { type: 'note_content_updated'; nodeId: string }
  | { type: 'node_type_created'; nodeType: NodeType }
  | { type: 'node_type_deleted'; nodeTypeId: string }
  | { type: 'reset' };
```

- [ ] **Step 2: Verify build**

```bash
npm run build 2>&1 | tail -5
```

Expected: Build succeeds (new file has no consumers yet).

- [ ] **Step 3: Commit**

```bash
git add src/commands/types.ts
git commit -m "feat(commands): add CommandContext, CommandResult, CommandEvent types"
```

---

### Task 2: CommandContext factory

**Files:**
- Create: `src/commands/create-context.ts`

- [ ] **Step 1: Create the factory**

```typescript
// src/commands/create-context.ts
import * as dbClient from '../db/client/db-client';
import { storage, notes, llm, browser } from '@platform';
import { useGraphStore } from '../graph/store/graph-store';
import type { CommandContext } from './types';
import type { DataStore } from '../db/data-store';

/**
 * Build a DataStore-shaped adapter from the renderer db-client namespaces.
 *
 * The db-client already has the same method names as DataStore repositories
 * (nodes.create, edges.getForNode, etc.) — the adapter just maps the few
 * signature differences and adds the top-level methods (init, reset, loadGraph, clearAll, etc.).
 *
 * This adapter is UI-only. Phase 4 (MCP server) uses SqliteDataStore directly.
 */
function dbClientAsDataStore(): DataStore {
  return {
    init: () => dbClient.initDbClient(),
    reset: () => Promise.resolve(),
    nodes: dbClient.nodes as any,
    edges: dbClient.edges as any,
    nodeTypes: dbClient.nodeTypes as any,
    sourceContent: {
      ...dbClient.sourceContent,
      deleteByNodeId: dbClient.sourceContent.delete,
    } as any,
    entityResolution: dbClient.entityResolution as any,
    tags: dbClient.tags as any,
    noteFolders: dbClient.noteFolders as any,
    edgeSources: dbClient.edgeSources as any,
    entitySources: dbClient.entitySources as any,
    indexedFiles: dbClient.indexedFiles as any,
    spatial: dbClient.spatial as any,
    readingList: dbClient.readingList as any,
    chat: dbClient.chat as any,
    noteAttachments: dbClient.noteAttachments as any,
    noteSearch: dbClient.noteSearch as any,
    stressTest: dbClient.stressTest as any,
    loadGraph: dbClient.loadGraph as any,
    clearAll: dbClient.clearAll as any,
    graphQuery: (input: unknown) => dbClient.graph.query(input) as any,
    graphMutate: (input: unknown) => dbClient.graph.mutate(input) as any,
    rawQuery: dbClient.dbQuery as any,
    rawExec: dbClient.dbExec as any,
  };
}

export function createUICommandContext(): CommandContext {
  return {
    db: dbClientAsDataStore(),
    storage,
    notes,
    llm,
    browser,
    getGraphSnapshot: () => {
      const state = useGraphStore.getState();
      return Promise.resolve({ nodes: state.nodes, edges: state.edges });
    },
  };
}
```

**Important:** `dbClientAsDataStore()` maps the renderer db-client (with its SharedWorker/IPC transport) to the `DataStore` interface shape. This means commands call `ctx.db.nodes.create()` using DataStore's typed signatures, and the adapter delegates to the db-client transport. Some method names differ slightly between db-client and DataStore (e.g., `sourceContent.delete` vs `sourceContent.deleteByNodeId`) — the adapter maps these.

**Phase 4 (MCP)** will use `SqliteDataStore` directly — no adapter needed since it already IS a DataStore.

- [ ] **Step 2: Verify db-client exports match**

Read `src/db/client/db-client.ts` and verify the namespace names used above exist. Check for any signature mismatches between db-client and DataStore. The most likely differences:
- `sourceContent.delete(nodeId)` in db-client vs `sourceContent.deleteByNodeId(nodeId)` in DataStore
- `graph.query()`/`graph.mutate()` in db-client vs `graphQuery()`/`graphMutate()` top-level in DataStore
- `clearAll` may be named differently

Fix any mismatches in the adapter.

- [ ] **Step 2: Check that db-client exports the namespaces used above**

Read `src/db/client/db-client.ts` and verify these named exports exist: `nodes`, `edges`, `entityResolution`, `sourceContent`, `entitySources`, `edgeSources`, `noteSearch`, `chat`, `readingList`, `graph`, `loadGraph`, `clearAll`. If any are missing (e.g., `clearAll` may be named `dbClearAll`), adjust the factory to use the actual export name.

- [ ] **Step 3: Verify build**

```bash
npm run build 2>&1 | tail -5
```

- [ ] **Step 4: Commit**

```bash
git add src/commands/create-context.ts
git commit -m "feat(commands): add createUICommandContext factory"
```

---

### Task 3: Graph commands

**Files:**
- Create: `src/commands/graph-commands.ts`

This extracts the CRUD logic from `src/graph/store/graph-store.ts` lines 132-316. The commands do DB operations and return results + events. They do NOT call Zustand `set()` — the calling code (store or hook) applies the result to Zustand.

- [ ] **Step 1: Create graph-commands.ts**

```typescript
// src/commands/graph-commands.ts
import type { CommandContext, CommandResult, CommandEvent } from './types';
import type { GraphNode, GraphEdge, CreateNodeInput, UpdateNodeInput, CreateEdgeInput, UpdateEdgeInput, DbNode, DbEdge } from '../shared/types';

function dbNodeToGraphNode(row: DbNode): GraphNode {
  return {
    id: row.id,
    identifier: row.identifier,
    name: row.name,
    type: row.type,
    label: row.label,
    summary: row.summary,
    folderPath: row.folder_path,
    properties: JSON.parse(row.properties || '{}'),
    x: row.x ?? undefined,
    y: row.y ?? undefined,
    z: row.z ?? undefined,
    color: row.color ?? undefined,
    size: row.size,
    sourceUrl: row.source_url ?? undefined,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function dbEdgeToGraphEdge(row: DbEdge): GraphEdge {
  return {
    id: row.id,
    sourceId: row.source_id,
    targetId: row.target_id,
    label: row.label,
    type: row.type,
    properties: JSON.parse(row.properties || '{}'),
    weight: row.weight,
    directed: row.directed === 1,
    sourceUrl: row.source_url ?? undefined,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export async function createNode(
  ctx: CommandContext,
  input: CreateNodeInput,
): Promise<CommandResult<GraphNode | null>> {
  const row = await ctx.db.nodes.create({
    name: input.name,
    type: input.type,
    label: input.label,
    folderPath: input.folderPath,
    properties: JSON.stringify(input.properties ?? {}),
    color: input.color,
    size: input.size,
    sourceUrl: input.sourceUrl,
  });
  if (!row) return { data: null, events: [] };
  const node = dbNodeToGraphNode(row);
  return { data: node, events: [{ type: 'node_created', node: row }] };
}

export async function updateNode(
  ctx: CommandContext,
  input: UpdateNodeInput,
): Promise<CommandResult<GraphNode | null>> {
  const row = await ctx.db.nodes.update({
    id: input.id,
    name: input.name,
    type: input.type,
    label: input.label,
    summary: input.summary,
    folderPath: input.folderPath,
    properties: input.properties ? JSON.stringify(input.properties) : undefined,
    x: input.x,
    y: input.y,
    z: input.z,
    color: input.color,
    size: input.size,
  });
  if (!row) return { data: null, events: [] };
  const node = dbNodeToGraphNode(row);
  return { data: node, events: [{ type: 'node_updated', node: row }] };
}

export async function deleteNode(
  ctx: CommandContext,
  id: string,
): Promise<CommandResult<boolean>> {
  const snapshot = await ctx.getGraphSnapshot();
  const node = snapshot.nodes.find((n) => n.id === id);

  const success = await ctx.db.nodes.delete(id);
  if (!success) return { data: false, events: [] };

  const events: CommandEvent[] = [{ type: 'node_deleted', id }];

  // Best-effort cleanup for resource nodes
  if (node?.type === 'resource') {
    ctx.db.entitySources.removeAllForResource(node.id).catch(() => {});
  }

  // Best-effort cleanup for note nodes
  if (node?.type === 'note') {
    ctx.db.noteSearch.delete(node.id).catch(() => {});
    ctx.notes.remove(node.id).catch(() => {});
  }

  return { data: true, events };
}

export async function createEdge(
  ctx: CommandContext,
  input: CreateEdgeInput,
): Promise<CommandResult<GraphEdge | null>> {
  const row = await ctx.db.edges.create({
    sourceId: input.sourceId,
    targetId: input.targetId,
    label: input.label,
    type: input.type,
    properties: JSON.stringify(input.properties ?? {}),
    weight: input.weight,
    directed: input.directed,
    sourceUrl: input.sourceUrl,
  });
  if (!row) return { data: null, events: [] };
  const edge = dbEdgeToGraphEdge(row);

  // Record user provenance unless caller opted out
  if (!input.skipProvenance) {
    ctx.db.edgeSources
      .add({ edgeId: edge.id, sourceType: 'user' })
      .catch(() => {});
  }

  return { data: edge, events: [{ type: 'edge_created', edge: row }] };
}

export async function updateEdge(
  ctx: CommandContext,
  input: UpdateEdgeInput,
): Promise<CommandResult<GraphEdge | null>> {
  const row = await ctx.db.edges.update({
    id: input.id,
    label: input.label,
    type: input.type,
    properties: input.properties ? JSON.stringify(input.properties) : undefined,
    weight: input.weight,
  });
  if (!row) return { data: null, events: [] };
  const edge = dbEdgeToGraphEdge(row);
  return { data: edge, events: [{ type: 'edge_updated', edge: row }] };
}

export async function deleteEdge(
  ctx: CommandContext,
  id: string,
): Promise<CommandResult<boolean>> {
  const success = await ctx.db.edges.delete(id);
  if (!success) return { data: false, events: [] };
  return { data: true, events: [{ type: 'edge_deleted', id }] };
}

export async function clearAll(
  ctx: CommandContext,
): Promise<CommandResult<boolean>> {
  await ctx.db.clearAll();
  return { data: true, events: [{ type: 'reset' }] };
}
```

- [ ] **Step 2: Verify build**

```bash
npm run build 2>&1 | tail -5
```

- [ ] **Step 3: Commit**

```bash
git add src/commands/graph-commands.ts
git commit -m "feat(commands): add graph CRUD commands with provenance + cleanup"
```

---

### Task 4: Migrate graph-store to use graph-commands

**Files:**
- Modify: `src/graph/store/graph-store.ts`

Replace the inline DB logic in each CRUD method with calls to graph-commands. The store methods now: create context → call command → apply result to Zustand state.

- [ ] **Step 1: Add imports at top of graph-store.ts**

Add after the existing imports:

```typescript
import { createUICommandContext } from '../../commands/create-context';
import * as graphCommands from '../../commands/graph-commands';
```

- [ ] **Step 2: Replace createNode method (lines ~132-152)**

Replace the `createNode` method body with:

```typescript
  createNode: async (input) => {
    try {
      const ctx = createUICommandContext();
      const result = await graphCommands.createNode(ctx, input);
      if (!result.data) return null;
      set((state) => ({ nodes: [...state.nodes, result.data!] }));
      return result.data;
    } catch (e: any) {
      set({ error: e.message });
      return null;
    }
  },
```

- [ ] **Step 3: Replace updateNode method (lines ~154-180)**

```typescript
  updateNode: async (input) => {
    try {
      const ctx = createUICommandContext();
      const result = await graphCommands.updateNode(ctx, input);
      if (!result.data) return null;
      set((state) => ({
        nodes: state.nodes.map((n) => (n.id === result.data!.id ? result.data! : n)),
      }));
      return result.data;
    } catch (e: any) {
      set({ error: e.message });
      return null;
    }
  },
```

- [ ] **Step 4: Replace deleteNode method (lines ~182-219)**

```typescript
  deleteNode: async (id) => {
    try {
      const ctx = createUICommandContext();
      const result = await graphCommands.deleteNode(ctx, id);
      if (result.data) {
        set((state) => {
          const edges = state.edges.filter(
            (e) => e.sourceId !== id && e.targetId !== id
          );
          const selectedNodeIds = new Set(state.selectedNodeIds);
          selectedNodeIds.delete(id);
          return {
            nodes: state.nodes.filter((n) => n.id !== id),
            edges,
            adjacency: buildAdjacencyMap(edges),
            selectedNodeIds,
          };
        });
      }
      return result.data;
    } catch (e: any) {
      set({ error: e.message });
      return false;
    }
  },
```

- [ ] **Step 5: Replace createEdge method (lines ~221-256)**

```typescript
  createEdge: async (input) => {
    try {
      const ctx = createUICommandContext();
      const result = await graphCommands.createEdge(ctx, input);
      if (!result.data) return null;
      set((state) => {
        const edges = [...state.edges, result.data!];
        return { edges, adjacency: buildAdjacencyMap(edges) };
      });
      return result.data;
    } catch (e: any) {
      set({ error: e.message });
      return null;
    }
  },
```

- [ ] **Step 6: Replace updateEdge method (lines ~258-278)**

```typescript
  updateEdge: async (input) => {
    try {
      const ctx = createUICommandContext();
      const result = await graphCommands.updateEdge(ctx, input);
      if (!result.data) return null;
      set((state) => {
        const edges = state.edges.map((e) => (e.id === result.data!.id ? result.data! : e));
        return { edges, adjacency: buildAdjacencyMap(edges) };
      });
      return result.data;
    } catch (e: any) {
      set({ error: e.message });
      return null;
    }
  },
```

- [ ] **Step 7: Replace deleteEdge method (lines ~280-299)**

```typescript
  deleteEdge: async (id) => {
    try {
      const ctx = createUICommandContext();
      const result = await graphCommands.deleteEdge(ctx, id);
      if (result.data) {
        set((state) => {
          const edges = state.edges.filter((e) => e.id !== id);
          return {
            edges,
            adjacency: buildAdjacencyMap(edges),
            selectedEdgeId:
              state.selectedEdgeId === id ? null : state.selectedEdgeId,
          };
        });
      }
      return result.data;
    } catch (e: any) {
      set({ error: e.message });
      return false;
    }
  },
```

- [ ] **Step 8: Replace clearAll method (lines ~301-316)**

```typescript
  clearAll: async () => {
    try {
      const ctx = createUICommandContext();
      await graphCommands.clearAll(ctx);
      set({
        nodes: [],
        edges: [],
        adjacency: new Map(),
        selectedNodeIds: new Set<string>(),
        selectedEdgeId: null,
      });
      return true;
    } catch (e: any) {
      set({ error: e.message });
      return false;
    }
  },
```

- [ ] **Step 9: Remove unused imports from graph-store.ts**

Remove these imports that are no longer needed (the CRUD functions now delegate to graph-commands which use ctx.db):

```typescript
// REMOVE these from the import line:
// nodes as dbNodes, edges as dbEdges, clearAll as dbClearAll, entitySources, edgeSources, noteSearch
// KEEP: loadGraph (still used by loadAll)
```

The updated import line should be:
```typescript
import { loadGraph } from '../../db/client/db-client';
```

Also remove the now-unused `notes` import from `@platform` (cleanup is handled by graph-commands).

**Note:** Keep the `dbNodeToGraphNode` and `dbEdgeToGraphEdge` functions in graph-store.ts — they're still used by the sync listener (lines 336-425).

- [ ] **Step 10: Verify both builds**

```bash
npm run build 2>&1 | tail -5 && npm run build:electron 2>&1 | tail -5
```

- [ ] **Step 11: Commit**

```bash
git add src/graph/store/graph-store.ts
git commit -m "refactor(graph-store): delegate CRUD to graph-commands"
```

---

### Task 5: RAG commands

**Files:**
- Create: `src/commands/rag-commands.ts`
- Modify: `src/ui/hooks/rag-pipeline.ts`

Extract the RAG pipeline logic. The `extractSearchTerms` and `formatRAGPrompt` functions are already pure — move them. The DB-calling functions (`findRelevantNodes`, `expandSubgraph`, `getSourceExcerpts`, `retrieveRAGContext`) now take `CommandContext`.

- [ ] **Step 1: Create rag-commands.ts**

Copy the entire content of `src/ui/hooks/rag-pipeline.ts` into `src/commands/rag-commands.ts` with these changes:

1. Replace the db-client imports with `CommandContext`:
   - `import { nodes as nodesApi, edges as edgesApi, sourceContent } from '../../db/client/db-client';` → remove
   - `import { useGraphStore } from '../../graph/store/graph-store';` → remove
   - `import { notes } from '@platform';` → remove
   - Add: `import type { CommandContext } from './types';`

2. Add `ctx: CommandContext` as first parameter to these functions:
   - `findRelevantNodes(ctx, terms, limit)` — replace `nodesApi.search(term, limit)` with `ctx.db.nodes.search(term, limit)`
   - `expandSubgraph(ctx, nodeIds, hops)` — replace `edgesApi.getForNode(id)` with `ctx.db.edges.getForNode(id)`
   - `getSourceExcerpts(ctx, nodeIds, nodeMap, maxExcerptLength)` — replace `notes.read(nodeId)` with `ctx.notes.read(nodeId)`, replace `sourceContent.getByNodeId(nodeId)` with `ctx.db.sourceContent.getByNodeId(nodeId)`
   - `retrieveRAGContext(ctx, question)` — replace `nodesApi.getAll()` with `ctx.db.nodes.getAll()`

3. Keep `extractSearchTerms`, `formatRAGPrompt`, `RAGContext` interface, and `RAG_SYSTEM_PROMPT` unchanged (they're already pure).

4. Export everything that `rag-pipeline.ts` currently exports.

- [ ] **Step 2: Update rag-pipeline.ts to delegate**

Replace the entire file content with:

```typescript
// src/ui/hooks/rag-pipeline.ts
// Thin re-export — all logic lives in src/commands/rag-commands.ts
import { createUICommandContext } from '../../commands/create-context';
import {
  retrieveRAGContext as ragRetrieve,
  formatRAGPrompt,
  RAG_SYSTEM_PROMPT,
  type RAGContext,
} from '../../commands/rag-commands';

export type { RAGContext };
export { formatRAGPrompt, RAG_SYSTEM_PROMPT };

export async function retrieveRAGContext(question: string): Promise<RAGContext> {
  const ctx = createUICommandContext();
  return ragRetrieve(ctx, question);
}
```

- [ ] **Step 3: Verify build**

```bash
npm run build 2>&1 | tail -5
```

- [ ] **Step 4: Commit**

```bash
git add src/commands/rag-commands.ts src/ui/hooks/rag-pipeline.ts
git commit -m "refactor(rag): extract RAG pipeline to commands layer"
```

---

### Task 6: Chat tool executor

**Files:**
- Create: `src/commands/chat-tool-executor.ts`

Extract the `executeTool` switch statement from `src/ui/hooks/chat-agent-loop.ts` (lines 249-386). Each case calls `ctx.db.*` or `ctx.notes.*` instead of importing singletons.

- [ ] **Step 1: Create chat-tool-executor.ts**

Copy the `executeTool` function from `chat-agent-loop.ts` lines 249-386 and `collectIdsFromToolResult` (lines 388-443). **Do NOT copy the `lastRAGNodeIds`/`lastRAGEdgeIds` module globals** — instead, `executeTool` returns tool metadata (collected IDs) alongside the result string, and the caller accumulates them per-run. This avoids stale-state bugs when multiple chat sessions, tabs, or MCP calls run concurrently.

```typescript
export interface ToolExecResult {
  result: string;
  collectedNodeIds?: string[];
  collectedEdgeIds?: string[];
}

export async function executeTool(ctx: CommandContext, name: string, input: Record<string, unknown>): Promise<ToolExecResult>
```

Make these changes:

1. Add `import type { CommandContext } from './types';`
2. Add `import { retrieveRAGContext, formatRAGPrompt } from './rag-commands';`
3. Add `import { parseMarkdown } from '../notes/markdown-utils';`
4. Each case returns `{ result: jsonString, collectedNodeIds, collectedEdgeIds }` instead of just a string. For `search_knowledge`, the RAG node/edge IDs come from the context return value (not globals).
5. In each case, replace:
   - `nodes.search(...)` → `ctx.db.nodes.search(...)`
   - `nodes.getById(...)` → `ctx.db.nodes.getById(...)`
   - `nodes.getNeighborhood(...)` → `ctx.db.nodes.getNeighborhood(...)`
   - `edges.getForNode(...)` → `ctx.db.edges.getForNode(...)`
   - `sourceContent.search(...)` → `ctx.db.sourceContent.search(...)`
   - `sourceContent.getByNodeId(...)` → `ctx.db.sourceContent.getByNodeId(...)`
   - `notes.read(nodeId)` → `ctx.notes.read(nodeId)`
   - `useGraphStore.getState()` → `ctx.getGraphSnapshot()` (for `get_source_content` case where it reads node type, and `create_node`/`update_node`/`create_edge` cases)
6. For the `create_node`, `update_node`, `create_edge` cases, import and use graph-commands:
   - `import * as graphCommands from './graph-commands';`
   - Replace `graph.createNode(...)` with `const result = await graphCommands.createNode(ctx, ...); const created = result.data;`
   - Same pattern for updateNode and createEdge
7. For `search_knowledge`, pass ctx to `retrieveRAGContext(ctx, ...)`
8. Export `executeTool` and `collectIdsFromToolResult` (keep the latter unchanged)

- [ ] **Step 2: Verify build**

```bash
npm run build 2>&1 | tail -5
```

- [ ] **Step 3: Commit**

```bash
git add src/commands/chat-tool-executor.ts
git commit -m "feat(commands): extract chat tool executor to commands layer"
```

---

### Task 7: Wire chat-agent-loop.ts to use chat-tool-executor

**Files:**
- Modify: `src/ui/hooks/chat-agent-loop.ts`

- [ ] **Step 1: Replace executeTool and collectIdsFromToolResult**

1. Add imports at top:
   ```typescript
   import { createUICommandContext } from '../../commands/create-context';
   import { executeTool as executeToolCmd, collectIdsFromToolResult } from '../../commands/chat-tool-executor';
   ```

2. Remove the local `executeTool` function (lines 249-386) and `collectIdsFromToolResult` function (lines 388-443), plus the `lastRAGNodeIds`/`lastRAGEdgeIds` variables (lines 246-247).

3. Remove now-unused imports: `nodes`, `edges`, `sourceContent` from db-client, `useGraphStore`, `notes` from `@platform`, `parseMarkdown`.

4. In the `runChatAgent` function, where `executeTool(tc.name, tc.input)` is called (around line 162), change to:
   ```typescript
   const ctx = createUICommandContext();
   ```
   (create once before the loop, not inside it)
   
   And change the call to:
   ```typescript
   resultStr = await executeToolCmd(ctx, tc.name, tc.input);
   ```

5. Keep the `retrieveRAGContext` and `formatRAGPrompt` imports from `./rag-pipeline` (these are the thin wrappers from Task 5 — but actually `chat-tool-executor.ts` handles RAG directly now, so these imports may become unused. Check and remove if so.)

- [ ] **Step 2: Verify both builds**

```bash
npm run build 2>&1 | tail -5 && npm run build:electron 2>&1 | tail -5
```

- [ ] **Step 3: Commit**

```bash
git add src/ui/hooks/chat-agent-loop.ts
git commit -m "refactor(chat): delegate tool execution to commands layer"
```

---

### Task 8: Wikilink parser — remove useGraphStore dependency

**Files:**
- Modify: `src/shared/wikilink-parser.ts`

The wikilink parser currently imports `useGraphStore` (line 17) and calls `useGraphStore.getState()` in `resolveWikilinks` (line 57) and `createWikilinkEdgesForNote` (line 123). Add `CommandContext` as parameter instead.

- [ ] **Step 1: Update resolveWikilinks and createWikilinkEdgesForNote**

1. Replace `import { useGraphStore } from '../graph/store/graph-store';` with `import type { CommandContext } from '../commands/types';`
2. Replace `import { entityResolution } from '../db/client/db-client';` → remove (use ctx.db)
3. Change `resolveWikilinks(wikilinks: string[])` to `resolveWikilinks(ctx: CommandContext, wikilinks: string[])`
4. Inside `resolveWikilinks`, replace `const graph = useGraphStore.getState();` with `const graph = ctx.getGraphSnapshot();`
5. Replace `entityResolution.findMatches(wikilink)` with `ctx.db.entityResolution.findMatches(wikilink)`
6. Change `createWikilinkEdgesForNote(noteNodeId, content)` to `createWikilinkEdgesForNote(ctx: CommandContext, noteNodeId: string, content: string)`
7. Inside `createWikilinkEdgesForNote`, replace `await resolveWikilinks(wikilinks)` with `await resolveWikilinks(ctx, wikilinks)`
8. Replace `const graph = useGraphStore.getState();` with importing and calling `createEdge` from graph-commands:
   ```typescript
   import * as graphCommands from '../commands/graph-commands';
   ```
   Replace the edge creation loop:
   ```typescript
   const result = await graphCommands.createEdge(ctx, {
     sourceId: noteNodeId,
     targetId: target.nodeId,
     label,
     skipProvenance: true,
   });
   if (result.data) created++;
   ```

- [ ] **Step 2: Update callers**

The only caller of `createWikilinkEdgesForNote` is in `useLLMExtraction.ts` (line 993). It uses a dynamic import:
```typescript
const { createWikilinkEdgesForNote } = await import('../../shared/wikilink-parser');
await createWikilinkEdgesForNote(noteNodeId, note.content);
```

This will be fixed in Task 10 (extraction commands) where the whole `applyReview` function is extracted. For now, temporarily update the call to pass a context:

```typescript
const ctx = createUICommandContext(); // already available in scope
const { createWikilinkEdgesForNote } = await import('../../shared/wikilink-parser');
await createWikilinkEdgesForNote(ctx, noteNodeId, note.content);
```

- [ ] **Step 3: Verify build**

```bash
npm run build 2>&1 | tail -5
```

- [ ] **Step 4: Commit**

```bash
git add src/shared/wikilink-parser.ts src/ui/hooks/useLLMExtraction.ts
git commit -m "refactor(wikilinks): accept CommandContext instead of useGraphStore"
```

---

### Task 9: Extraction commands — pure helpers

**Files:**
- Create: `src/commands/extraction-commands.ts`

Extract `normalizeExtractedNode`, `ensureResourceNode`, and `buildDiffItems` from `useLLMExtraction.ts` (lines 27-180). These are the building blocks used by the pipeline functions.

- [ ] **Step 1: Create extraction-commands.ts with helpers**

Copy lines 27-180 from `useLLMExtraction.ts` into `src/commands/extraction-commands.ts` with these changes:

1. Add imports:
   ```typescript
   import type { CommandContext } from './types';
   import type { GraphNode, DiffItem, ExtractedNoteCandidate, EntityMatch } from '../shared/types';
   import * as graphCommands from './graph-commands';
   ```

2. `normalizeExtractedNode` — move as-is (it's already pure, no dependencies).

3. `ensureResourceNode(ctx: CommandContext, sourceUrl, title?)` — replace:
   - `const graph = useGraphStore.getState();` → `const graph = ctx.getGraphSnapshot();`
   - `await graph.createNode(...)` → `const result = await graphCommands.createNode(ctx, ...); const created = result.data;`

4. `buildDiffItems(ctx: CommandContext, validated)` — replace:
   - `const graph = useGraphStore.getState();` → `const graph = ctx.getGraphSnapshot();`
   - `await entityResolution.findMatches(node.name)` → `await ctx.db.entityResolution.findMatches(node.name)`

5. Export all three functions and the `NormalizedExtractedNode` interface.

- [ ] **Step 2: Verify build**

```bash
npm run build 2>&1 | tail -5
```

- [ ] **Step 3: Commit**

```bash
git add src/commands/extraction-commands.ts
git commit -m "feat(commands): add extraction helpers (normalize, ensureResource, buildDiff)"
```

---

### Task 10: Extraction commands — applyDiff and applyReview

**Files:**
- Modify: `src/commands/extraction-commands.ts`

Add `applyDiff` and `applyReview` to the extraction commands file. These are the two merge functions from `useLLMExtraction.ts`.

- [ ] **Step 1: Add applyDiff**

Copy `applyDiff` (lines 372-495 of `useLLMExtraction.ts`) into `extraction-commands.ts`. Change signature to:

```typescript
export async function applyDiff(
  ctx: CommandContext,
  diff: { items: DiffItem[]; notes: ExtractedNoteCandidate[] },
  sourceUrl: string | null,
  inputText: string | null,
): Promise<void>
```

Replace throughout:
- `useGraphStore.getState()` → `ctx.getGraphSnapshot()` for node lookups
- `graph.createNode(...)` → `graphCommands.createNode(ctx, ...)`
- `graph.createEdge(...)` → `graphCommands.createEdge(ctx, ...)`
- `entityResolution.addAlias(...)` → `ctx.db.entityResolution.addAlias(...)`
- `sourceContent.save(...)` → `ctx.db.sourceContent.save(...)`
- `entitySources.add(...)` → `ctx.db.entitySources.add(...)`

**Critical:** The original code re-reads `useGraphStore.getState()` after creating nodes (line 413) to find newly-created nodes for edge resolution. With commands, newly-created nodes are tracked in the local `nodeIdMap`. The snapshot from `ctx.getGraphSnapshot()` returns pre-command state, but `nodeIdMap` tracks creations within this function — the same pattern the original code uses. No behavior change needed.

- [ ] **Step 2: Add applyReview**

Copy `applyReview` (lines 732-1040 of `useLLMExtraction.ts`) into `extraction-commands.ts`. This is the largest function (~290 lines). Change signature to:

```typescript
export async function applyReview(
  ctx: CommandContext,
  activeNodes: ReviewNode[],
  activeEdges: ReviewEdge[],
  activeReviewNotes: ReviewNote[],
  allReviewNodes: ReviewNode[],
  sourceUrl: string | null,
  inputText: string | null,
): Promise<void>
```

Add import for review types:
```typescript
import type { ReviewNode, ReviewEdge, ReviewNote } from '../graph/store/extraction-review-store';
```

Replace throughout (same substitutions as applyDiff, plus):
- `useLLMStore.getState().sourceUrl` → use the `sourceUrl` parameter
- `useLLMStore.getState().inputText` → use the `inputText` parameter
- `useExtractionReviewStore.getState()` → use the passed-in parameters
- `notes.write(...)` → `ctx.notes.write(...)`
- `noteSearch.upsert(...)` → `ctx.db.noteSearch.upsert(...)`
- `edgeSources.add(...)` → `ctx.db.edgeSources.add(...)`
- The dynamic `import('../../shared/wikilink-parser')` → static `import { createWikilinkEdgesForNote } from '../shared/wikilink-parser';` and call `createWikilinkEdgesForNote(ctx, noteNodeId, note.content)`

**Do NOT** call `useExtractionReviewStore.getState().reset()` or `useLLMStore.getState().reset()` — those are UI concerns handled by the calling hook.

- [ ] **Step 3: Add buildReviewData**

Copy the `proceedToReview` logic (lines 610-730 of `useLLMExtraction.ts`) as:

```typescript
export async function buildReviewData(
  ctx: CommandContext,
  diff: { items: DiffItem[]; notes: ExtractedNoteCandidate[] },
): Promise<{ reviewNodes: ReviewNode[]; reviewEdges: ReviewEdge[]; reviewNotes: ReviewNote[] }>
```

Replace `useGraphStore.getState()` → `ctx.getGraphSnapshot()` and `entityResolution.findMatches(...)` → `ctx.db.entityResolution.findMatches(...)`.

- [ ] **Step 4: Verify build**

```bash
npm run build 2>&1 | tail -5
```

- [ ] **Step 5: Commit**

```bash
git add src/commands/extraction-commands.ts
git commit -m "feat(commands): add applyDiff, applyReview, buildReviewData extraction commands"
```

---

### Task 11: Migrate useLLMExtraction to delegate to commands

**Files:**
- Modify: `src/ui/hooks/useLLMExtraction.ts`

Replace the inline orchestration with calls to extraction-commands. The hook keeps: privacy gate checks, LLM store updates, status transitions, error handling.

- [ ] **Step 1: Add imports**

```typescript
import { createUICommandContext } from '../../commands/create-context';
import * as extractionCmd from '../../commands/extraction-commands';
```

- [ ] **Step 2: Replace ensureResourceNode and buildDiffItems exports**

Remove the local `ensureResourceNode` and `buildDiffItems` function definitions (they now live in extraction-commands.ts). Replace with re-exports if other files import them from this location:

```typescript
export { ensureResourceNode, buildDiffItems } from '../../commands/extraction-commands';
```

Also remove `normalizeExtractedNode` and its interface (moved to extraction-commands).

- [ ] **Step 3: Update startExtraction to call command for buildDiffItems**

In `startExtraction` (around line 250), replace:
```typescript
const { items, notes: extractedNotes } = await buildDiffItems(validated);
```
with:
```typescript
const ctx = createUICommandContext();
const { items, notes: extractedNotes } = await extractionCmd.buildDiffItems(ctx, validated);
```

Same change in `startQuickExtraction` (around line 360) and `startAgentExtraction`'s `extraction_complete` handler (around line 584).

- [ ] **Step 4: Update applyDiff to delegate**

Replace the entire `applyDiff` useCallback body with:

```typescript
const applyDiff = useCallback(async () => {
  const llmStore = useLLMStore.getState();
  const diff = llmStore.diff;
  if (!diff) return;

  llmStore.setStatus('merging');

  try {
    const ctx = createUICommandContext();
    await extractionCmd.applyDiff(ctx, diff, llmStore.sourceUrl, llmStore.inputText);
    useLLMStore.getState().reset();
  } catch (e: any) {
    useLLMStore.getState().setError(e.message);
  }
}, []);
```

- [ ] **Step 5: Update proceedToReview to delegate**

Replace the `proceedToReview` useCallback body with:

```typescript
const proceedToReview = useCallback(async () => {
  const llmStore = useLLMStore.getState();
  const diff = llmStore.diff;
  if (!diff) return;

  const ctx = createUICommandContext();
  const { reviewNodes, reviewEdges, reviewNotes } = await extractionCmd.buildReviewData(ctx, diff);

  useExtractionReviewStore
    .getState()
    .initialize(reviewNodes, reviewEdges, reviewNotes, llmStore.sourceUrl);
  useLLMStore.getState().setStatus('reviewing');
}, []);
```

- [ ] **Step 6: Update applyReview to delegate**

Replace the `applyReview` useCallback body with:

```typescript
const applyReview = useCallback(async () => {
  const llmStore = useLLMStore.getState();
  const reviewStore = useExtractionReviewStore.getState();
  const activeNodes = reviewStore.activeNodes();
  const activeEdges = reviewStore.activeEdges();
  const activeReviewNotes = reviewStore.activeNotes();

  if (activeNodes.length === 0 && activeEdges.length === 0 && activeReviewNotes.length === 0) {
    return;
  }

  llmStore.setStatus('merging');

  try {
    const ctx = createUICommandContext();
    await extractionCmd.applyReview(
      ctx,
      activeNodes,
      activeEdges,
      activeReviewNotes,
      reviewStore.nodes,
      llmStore.sourceUrl,
      llmStore.inputText,
    );
    useExtractionReviewStore.getState().reset();
    useLLMStore.getState().reset();
  } catch (e: any) {
    useLLMStore.getState().setError(e.message);
  }
}, []);
```

- [ ] **Step 7: Remove unused imports**

Remove imports that are no longer needed:
- `entityResolution`, `sourceContent`, `entitySources`, `edgeSources`, `noteSearch` from db-client
- `generateNoteMarkdown`, `stripMarkdownToPlainText` from markdown-utils
- `parseMarkdown` from filesystem/markdown-parser

Keep: `storage`, `notes`, `llm`, `browser` from `@platform` (still used by startExtraction/startQuickExtraction/startAgentExtraction for LLM calls and privacy gates).

- [ ] **Step 8: Verify both builds**

```bash
npm run build 2>&1 | tail -5 && npm run build:electron 2>&1 | tail -5
```

- [ ] **Step 9: Commit**

```bash
git add src/ui/hooks/useLLMExtraction.ts
git commit -m "refactor(extraction): delegate pipeline to extraction-commands"
```

---

### Task 12: NL query commands

**Files:**
- Create: `src/commands/nl-query-commands.ts`
- Modify: `src/ui/hooks/useNLQuery.ts`

- [ ] **Step 1: Create nl-query-commands.ts**

```typescript
// src/commands/nl-query-commands.ts
import type { CommandContext } from './types';
import type { QueryResult } from '../db/worker/query-engine/types';

export interface NLQueryConfig {
  model: string;
  systemPrompt: string;
}

export async function executeNLQuery(
  ctx: CommandContext,
  input: string,
  config: NLQueryConfig,
): Promise<{
  content: string;
  rawJson: string;
  result: QueryResult;
}> {
  const streamResult = await ctx.llm.streamExtraction(
    {
      prompt: input,
      model: config.model,
      systemPrompt: config.systemPrompt,
    },
    () => {},
  );

  const content = streamResult.content ?? '';

  // Parse JSON from response — reuse existing utility
  const { parseJsonFromLLMResponse } = await import('../ui/hooks/nl-query-utils');
  const { rawJson, validated } = parseJsonFromLLMResponse(content);

  const result = await ctx.db.graph.query(validated) as QueryResult;

  return { content, rawJson, result };
}
```

- [ ] **Step 2: Update useNLQuery.ts**

Add import and delegate the `execute` callback:

```typescript
import { createUICommandContext } from '../../commands/create-context';
import { executeNLQuery as nlQueryCmd } from '../../commands/nl-query-commands';
```

Replace the `execute` callback body. The hook keeps the streaming UI updates (setStreamText) — pass the streaming callback through:

Actually, looking at the current code more carefully, `useNLQuery` uses `llm.streamExtraction` with a chunk callback for streaming UI updates. The command needs to accept this callback. Update `nl-query-commands.ts` to accept an `onChunk` parameter:

```typescript
export async function executeNLQuery(
  ctx: CommandContext,
  input: string,
  config: NLQueryConfig,
  onChunk?: (text: string) => void,
): Promise<{ content: string; rawJson: string; result: QueryResult }> {
  const streamResult = await ctx.llm.streamExtraction(
    { prompt: input, model: config.model, systemPrompt: config.systemPrompt },
    onChunk ?? (() => {}),
  );
  // ... rest same as above
```

- [ ] **Step 3: Verify build**

```bash
npm run build 2>&1 | tail -5
```

- [ ] **Step 4: Commit**

```bash
git add src/commands/nl-query-commands.ts src/ui/hooks/useNLQuery.ts
git commit -m "refactor(nl-query): extract NL query to commands layer"
```

---

### Task 13: Note commands

**Files:**
- Create: `src/commands/note-commands.ts`

Extract note save orchestration. This is used by `NoteEditor.tsx` and could be called by MCP/plugins.

- [ ] **Step 1: Create note-commands.ts**

```typescript
// src/commands/note-commands.ts
import type { CommandContext } from './types';
import { generateNoteMarkdown, stripMarkdownToPlainText } from '../notes/markdown-utils';
import { parseMarkdown } from '../filesystem/markdown-parser';
import { createWikilinkEdgesForNote } from '../shared/wikilink-parser';
import * as graphCommands from './graph-commands';

export async function saveNote(
  ctx: CommandContext,
  params: {
    nodeId: string | null;
    name: string;
    content: string;
    isNew: boolean;
    folderPath?: string;
    sourceUrl?: string;
  },
): Promise<{ nodeId: string }> {
  const wikiLinks = parseMarkdown(params.content).wikiLinks;
  const markdown = generateNoteMarkdown(params.name, params.content, wikiLinks);
  const plainText = stripMarkdownToPlainText(params.content);

  let nodeId = params.nodeId;

  if (params.isNew || !nodeId) {
    const result = await graphCommands.createNode(ctx, {
      name: params.name,
      type: 'note',
      folderPath: params.folderPath,
      properties: { wikiLinks },
      sourceUrl: params.sourceUrl,
    });
    if (!result.data) throw new Error('Failed to create note node');
    nodeId = result.data.id;
  } else {
    await graphCommands.updateNode(ctx, {
      id: nodeId,
      name: params.name,
      properties: { wikiLinks },
    });
  }

  await ctx.notes.write(nodeId, markdown);
  await ctx.db.noteSearch.upsert(nodeId, params.name, plainText);

  // Create edges for any [[wikilinks]] in the content
  await createWikilinkEdgesForNote(ctx, nodeId, params.content);

  return { nodeId };
}
```

- [ ] **Step 2: Verify build**

```bash
npm run build 2>&1 | tail -5
```

- [ ] **Step 3: Commit**

```bash
git add src/commands/note-commands.ts
git commit -m "feat(commands): add note save command with wikilink resolution"
```

---

### Task 14: Barrel export

**Files:**
- Create: `src/commands/index.ts`

- [ ] **Step 1: Create barrel file**

```typescript
// src/commands/index.ts
export type { CommandContext, CommandResult, CommandEvent } from './types';
export { createUICommandContext } from './create-context';
export * as graphCommands from './graph-commands';
export * as extractionCommands from './extraction-commands';
export * as noteCommands from './note-commands';
export * as ragCommands from './rag-commands';
export * as chatToolExecutor from './chat-tool-executor';
export * as nlQueryCommands from './nl-query-commands';
```

- [ ] **Step 2: Final verification — all 3 builds**

```bash
npm run build 2>&1 | tail -5
npm run build:electron-renderer 2>&1 | tail -5
npm run build:electron-main 2>&1 | tail -5
```

All three must succeed with no errors.

- [ ] **Step 3: Commit**

```bash
git add src/commands/index.ts
git commit -m "feat(commands): add barrel export for commands layer"
```

---

## Verification Checklist

After all tasks are complete, manually verify these workflows:

1. **Chrome extension** — load `dist/` in chrome://extensions:
   - Create a node via the Create panel → appears in graph
   - Run quick extraction on pasted text → review → apply → entities appear
   - Run agent extraction on a page → tool calls visible → review → apply
   - Open chat → ask about an entity → agent uses search_knowledge tool → response with citations
   - Create a note → save → wikilinks resolve to edges
   - Delete a node → connected edges removed

2. **Electron app** — `npm run dist:mac` then launch:
   - Same workflows as Chrome (except agent extraction uses fetch_url only)
   - Note saved to `~/Documents/KnowledgeGraph/notes/`

3. **Cross-tab sync** (Chrome only):
   - Open two side panel instances
   - Create node in one → appears in other
