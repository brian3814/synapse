# Phase 4: MCP Server Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Expose the knowledge graph to external AI tools (Claude Desktop, Cursor, Windsurf, etc.) via the Model Context Protocol. Claude and other LLMs can create nodes, search the graph, read notes, and run extractions through a standard MCP interface -- no custom integrations needed.

**Architecture:** MCP is Electron-only (Chrome extensions cannot run servers). The MCP server wraps the same command layer from Phase 1 via a headless `CommandContext` that talks directly to `DataStore` (better-sqlite3) instead of going through IPC. Two transports: **stdio** for Claude Desktop / Cursor (spawned as a subprocess), and **Streamable HTTP** on the existing companion server port (19876) for network-local clients.

```
┌──────────────────────────────────────────────────────┐
│  Claude Desktop / Cursor / Windsurf                  │
│  (MCP client)                                        │
├──────────────────────────────────────────────────────┤
│  Transport: stdio  OR  Streamable HTTP (:19876/mcp)  │
├──────────────────────────────────────────────────────┤
│  src/mcp/server.ts                                   │
│  McpServer — 14 tools + 4 resource templates         │
├──────────────────────────────────────────────────────┤
│  src/commands/create-server-context.ts               │
│  CommandContext backed by DataStore directly          │
│  (DataStore passed directly, no adapter)              │
├──────────────────────────────────────────────────────┤
│  DataStore (better-sqlite3)  +  notes-backend (fs)   │
│  + storage-backend (JSON)    +  llm-backend           │
└──────────────────────────────────────────────────────┘
```

**Tech Stack:** `@modelcontextprotocol/server` (v2), `@modelcontextprotocol/node`, Zod v4, esbuild (existing Electron main build)

**No test framework configured.** Verification = `npm run build:electron-main` clean + manual test with Claude Desktop.

---

## File Structure

### New files

| File | Responsibility |
|------|---------------|
| `src/commands/create-server-context.ts` | Factory: `createServerCommandContext(dataStore, notes, storage)` — headless CommandContext without Zustand |
| `src/mcp/tools.ts` | 14 MCP tool definitions wrapping commands via CommandContext |
| `src/mcp/resources.ts` | 4 MCP resource definitions (graph stats, nodes, notes, sources) |
| `src/mcp/server.ts` | `createMCPServer(ctx)` — wires tools + resources into McpServer |
| `src/mcp/index.ts` | Barrel export |
| `electron/mcp-stdio.ts` | Standalone Node entry point for stdio transport (Claude Desktop subprocess) |

### Modified files

| File | Change |
|------|--------|
| `package.json` | Add `@modelcontextprotocol/server`, `@modelcontextprotocol/node` dependencies; add `build:mcp` script; update `build:electron` |
| `electron/companion-server.ts` | Add `/mcp` POST + GET + DELETE endpoints for Streamable HTTP transport |
| `electron/main.ts` | Import `dataStore` from db-backend; pass to companion server for MCP context |
| `electron/db-backend.ts` | Export `dataStore` so MCP stdio and companion server can access it |

---

### Task 1: Install MCP SDK dependency

**Files:**
- Modify: `package.json`

- [ ] **Step 1: Install packages**

```bash
npm install @modelcontextprotocol/server @modelcontextprotocol/node
```

- [ ] **Step 2: Verify the install added the right packages**

Read `package.json` and confirm `@modelcontextprotocol/server` and `@modelcontextprotocol/node` appear in `dependencies`.

- [ ] **Step 3: Verify build still works**

```bash
npm run build:electron-main 2>&1 | tail -5
```

- [ ] **Step 4: Commit**

```bash
git add package.json package-lock.json
git commit -m "feat(mcp): install @modelcontextprotocol/server and @modelcontextprotocol/node"
```

---

### Task 2: Export DataStore from db-backend

**Files:**
- Modify: `electron/db-backend.ts`

The MCP server (both stdio and HTTP transport) needs direct access to the `DataStore` instance. Currently `db-backend.ts` only exports `handleAction`. We need to also export the `dataStore` instance itself.

- [ ] **Step 1: Export dataStore**

```typescript
// electron/db-backend.ts
import { initBetterSQLite, resetBetterSQLite } from './better-sqlite3-engine';
import { createSqliteDataStore } from '../src/db/sqlite-data-store';
import { createActionHandler } from '../src/db/worker/action-handler';

const dataStore = createSqliteDataStore(initBetterSQLite, resetBetterSQLite);
const handleAction = createActionHandler(dataStore);

export { handleAction, dataStore };
```

- [ ] **Step 2: Verify build**

```bash
npm run build:electron-main 2>&1 | tail -5
```

- [ ] **Step 3: Commit**

```bash
git add electron/db-backend.ts
git commit -m "feat(mcp): export dataStore from db-backend for direct access"
```

---

### Task 3: Server CommandContext factory

**Files:**
- Create: `src/commands/create-server-context.ts`

Since Phase 1 changed `CommandContext.db` to `DataStore` (not `DbClient`), the MCP server context passes `DataStore` directly — **no adapter needed**. The factory provides headless `PlatformNotes`, `PlatformStorage`, `PlatformLLM`, and `PlatformBrowser` implementations plus an async `getGraphSnapshot()` that queries the DataStore.

- [ ] **Step 1: Create the factory**

```typescript
// src/commands/create-server-context.ts
import type { DataStore } from '../db/data-store';
import type { PlatformNotes, PlatformStorage, PlatformLLM, PlatformBrowser } from '../platform/types';
import type { CommandContext } from './types';

/** No-op browser implementation for headless server contexts. */
const noopBrowser: PlatformBrowser = {
  getActiveTab: async () => null,
  getPageContent: async () => '',
  executeTool: async () => '',
  onPageCapture: () => () => {},
};

/**
 * Build a CommandContext for server-side (MCP, CLI) use.
 * No Zustand, no React, no IPC — talks directly to DataStore.
 *
 * CommandContext.db IS DataStore (since Phase 1 fix), so we pass it through
 * with no adapter.
 */
export function createServerCommandContext(
  dataStore: DataStore,
  notes: PlatformNotes,
  storage: PlatformStorage,
  llm?: PlatformLLM,
): CommandContext {
  // Stub LLM that rejects if no implementation provided
  const llmStub: PlatformLLM = llm ?? {
    streamExtraction: () => Promise.reject(new Error('LLM not configured in server context')),
    runAgent: () => Promise.reject(new Error('LLM not configured in server context')),
    streamChat: () => Promise.reject(new Error('LLM not configured in server context')),
  };

  return {
    db: dataStore,
    storage,
    notes,
    llm: llmStub,
    browser: noopBrowser,
    getGraphSnapshot: async () => {
      const { nodes, edges } = await dataStore.loadGraph();
      return {
        nodes: nodes.map((n) => ({
          id: n.id,
          name: n.name,
          type: n.type,
          label: n.label ?? null,
          x: n.x ?? undefined,
          y: n.y ?? undefined,
        })) as any[],
        edges: edges.map((e) => ({
          id: e.id,
          sourceId: e.source_id,
          targetId: e.target_id,
          label: e.label,
          type: e.type,
        })) as any[],
      };
    },
  };
}
```

- [ ] **Step 2: Verify build**

```bash
npm run build:electron-main 2>&1 | tail -5
```

- [ ] **Step 3: Commit**

```bash
git add src/commands/create-server-context.ts
git commit -m "feat(mcp): add createServerCommandContext factory (DataStore direct, no adapter)"
```

---

### Task 4: MCP tools

**Files:**
- Create: `src/mcp/tools.ts`

14 tools that wrap CommandContext operations. Each tool definition includes a Zod input schema and a handler that calls the appropriate command/db method. Tools return MCP `content` arrays.

The tools cover the full CRUD surface of the knowledge graph:

| Tool | Description |
|------|-------------|
| `kg_create_node` | Create a new entity/resource/note node |
| `kg_update_node` | Update node name, type, label, summary, properties |
| `kg_delete_node` | Delete a node and its edges |
| `kg_create_edge` | Create a relationship between two nodes |
| `kg_search_nodes` | Full-text search across nodes |
| `kg_get_node` | Get a single node by ID with its edges |
| `kg_get_neighbors` | Get N-hop neighborhood of a node |
| `kg_search_sources` | Search ingested source content |
| `kg_get_source_content` | Get the full source content for a node |
| `kg_extract_text` | Run LLM entity extraction on raw text (**HTTP-only** — requires LLM backend; disabled in stdio context) |
| `kg_save_note` | Create or update a note (markdown file + DB) |
| `kg_read_note` | Read a note's markdown content |
| `kg_search_notes` | Full-text search across notes |
| `kg_query` | Execute a graph DSL query |

- [ ] **Step 1: Create the tools file**

```typescript
// src/mcp/tools.ts
//
// IMPORTANT: This file must NOT import Electron. It is used by both the
// companion HTTP server (Electron main process) and the standalone stdio
// binary (no Electron). Platform-specific behavior (event broadcasting)
// is injected via the EventBroadcaster callback.
import type { McpServer } from '@modelcontextprotocol/server';
import * as z from 'zod/v4';
import type { CommandContext, CommandEvent } from '../commands/types';
import * as graphCommands from '../commands/graph-commands';
import * as noteCommands from '../commands/note-commands';

/**
 * Optional callback to broadcast command events to renderer windows.
 * Injected by callers — Electron provides a real one, stdio uses no-op.
 */
export type EventBroadcaster = (events: CommandEvent[]) => void;

const noopBroadcaster: EventBroadcaster = () => {};

/**
 * Register all knowledge graph tools on an McpServer instance.
 * Mutating tools use command functions (not raw ctx.db) to get cleanup,
 * provenance, and sync events.
 */
export function registerTools(
  server: McpServer,
  ctx: CommandContext,
  broadcast: EventBroadcaster = noopBroadcaster,
  llmProvided = false,
): void {

  // ── Node CRUD ─────────────────────────────────────────────────────

  server.registerTool(
    'kg_create_node',
    {
      description: 'Create a new node in the knowledge graph. Types: "entity" (concepts, people, orgs), "resource" (web pages), "note" (prose notes). Returns the created node.',
      inputSchema: z.object({
        name: z.string().describe('Display name of the node'),
        type: z.enum(['entity', 'resource', 'note']).default('entity').describe('Structural type'),
        label: z.string().optional().describe('Semantic label for entities (e.g. "person", "concept", "technology")'),
        properties: z.record(z.unknown()).optional().describe('Arbitrary key-value properties as JSON'),
        sourceUrl: z.string().optional().describe('Source URL for resource nodes'),
      }),
    },
    async ({ name, type, label, properties, sourceUrl }) => {
      // Use graph-commands (not raw ctx.db) to get cleanup, provenance, and sync events
      const result = await graphCommands.createNode(ctx, {
        name,
        type: type ?? 'entity',
        label: label ?? undefined,
        properties: properties ?? undefined,
        sourceUrl,
      });
      // Broadcast events to renderer windows
      broadcast(result.events);
      return {
        content: [{ type: 'text' as const, text: JSON.stringify(result.data, null, 2) }],
      };
    },
  );

  server.registerTool(
    'kg_update_node',
    {
      description: 'Update an existing node. Only provided fields are changed.',
      inputSchema: z.object({
        id: z.string().describe('Node ID'),
        name: z.string().optional().describe('New display name'),
        type: z.string().optional().describe('New structural type'),
        label: z.string().optional().describe('New semantic label'),
        summary: z.string().optional().describe('Node summary text'),
        properties: z.record(z.unknown()).optional().describe('Replace properties (full overwrite)'),
      }),
    },
    async ({ id, name, type, label, summary, properties }) => {
      const result = await graphCommands.updateNode(ctx, {
        id,
        name,
        type,
        label,
        summary,
        properties: properties ?? undefined,
      });
      broadcast(result.events);
      if (!result.data) {
        return { content: [{ type: 'text' as const, text: `Node ${id} not found` }], isError: true };
      }
      return { content: [{ type: 'text' as const, text: JSON.stringify(result.data, null, 2) }] };
    },
  );

  server.registerTool(
    'kg_delete_node',
    {
      description: 'Delete a node and all its connected edges.',
      inputSchema: z.object({
        id: z.string().describe('Node ID to delete'),
      }),
    },
    async ({ id }) => {
      const result = await graphCommands.deleteNode(ctx, id);
      broadcast(result.events);
      return {
        content: [{ type: 'text' as const, text: result.data ? `Deleted node ${id}` : `Node ${id} not found` }],
      };
    },
  );

  // ── Edge CRUD ─────────────────────────────────────────────────────

  server.registerTool(
    'kg_create_edge',
    {
      description: 'Create a directed relationship between two nodes. The label describes the relationship (e.g. "authored", "depends_on", "related_to").',
      inputSchema: z.object({
        sourceId: z.string().describe('Source node ID'),
        targetId: z.string().describe('Target node ID'),
        label: z.string().describe('Relationship label'),
        type: z.string().optional().describe('Edge type category'),
        properties: z.record(z.unknown()).optional().describe('Arbitrary edge properties'),
        weight: z.number().optional().describe('Edge weight (default 1.0)'),
      }),
    },
    async ({ sourceId, targetId, label, type, properties, weight }) => {
      const result = await graphCommands.createEdge(ctx, {
        sourceId,
        targetId,
        label,
        type,
        properties: properties ?? undefined,
        weight,
        directed: true,
      });
      broadcast(result.events);
      const edge = result.data;
      return { content: [{ type: 'text' as const, text: JSON.stringify(edge, null, 2) }] };
    },
  );

  // ── Search & Query ────────────────────────────────────────────────

  server.registerTool(
    'kg_search_nodes',
    {
      description: 'Full-text search across all nodes in the knowledge graph. Returns matching nodes ranked by relevance.',
      inputSchema: z.object({
        query: z.string().describe('Search query text'),
        limit: z.number().optional().default(20).describe('Max results (default 20)'),
      }),
    },
    async ({ query, limit }) => {
      const results = await ctx.db.nodes.search(query, limit);
      return {
        content: [{
          type: 'text' as const,
          text: results.length === 0
            ? 'No nodes found matching query.'
            : JSON.stringify(results, null, 2),
        }],
      };
    },
  );

  server.registerTool(
    'kg_get_node',
    {
      description: 'Get a single node by ID, including all its connected edges.',
      inputSchema: z.object({
        id: z.string().describe('Node ID'),
      }),
    },
    async ({ id }) => {
      const [node, edges] = await Promise.all([
        ctx.db.nodes.getById(id),
        ctx.db.edges.getForNode(id),
      ]);
      if (!node) {
        return { content: [{ type: 'text' as const, text: `Node ${id} not found` }], isError: true };
      }
      return {
        content: [{ type: 'text' as const, text: JSON.stringify({ node, edges }, null, 2) }],
      };
    },
  );

  server.registerTool(
    'kg_get_neighbors',
    {
      description: 'Get the N-hop neighborhood of a node. Returns all node IDs within the specified number of hops.',
      inputSchema: z.object({
        nodeId: z.string().describe('Starting node ID'),
        hops: z.number().optional().default(1).describe('Number of hops (default 1)'),
      }),
    },
    async ({ nodeId, hops }) => {
      const { nodeIds } = await ctx.db.nodes.getNeighborhood(nodeId, hops);
      // Fetch full node data for the neighborhood
      const nodes = await Promise.all(nodeIds.map((id) => ctx.db.nodes.getById(id)));
      const validNodes = nodes.filter(Boolean);
      return {
        content: [{ type: 'text' as const, text: JSON.stringify(validNodes, null, 2) }],
      };
    },
  );

  // ── Source Content ────────────────────────────────────────────────

  server.registerTool(
    'kg_search_sources',
    {
      description: 'Search ingested web page source content. Returns matching source documents with titles and URLs.',
      inputSchema: z.object({
        query: z.string().describe('Search query text'),
        limit: z.number().optional().default(10).describe('Max results (default 10)'),
      }),
    },
    async ({ query, limit }) => {
      const results = await ctx.db.sourceContent.search(query, limit);
      // Return without full content to keep response size manageable
      const summaries = results.map((r: any) => ({
        nodeId: r.node_id,
        url: r.url,
        title: r.title,
        contentLength: r.content?.length ?? 0,
      }));
      return { content: [{ type: 'text' as const, text: JSON.stringify(summaries, null, 2) }] };
    },
  );

  server.registerTool(
    'kg_get_source_content',
    {
      description: 'Get the full ingested source content for a node (e.g. a web page that was captured).',
      inputSchema: z.object({
        nodeId: z.string().describe('Node ID of the resource node'),
      }),
    },
    async ({ nodeId }) => {
      const source = await ctx.db.sourceContent.getByNodeId(nodeId);
      if (!source) {
        return { content: [{ type: 'text' as const, text: `No source content for node ${nodeId}` }], isError: true };
      }
      return { content: [{ type: 'text' as const, text: JSON.stringify(source, null, 2) }] };
    },
  );

  // ── Extraction ────────────────────────────────────────────────────

  // Only register kg_extract_text if a real PlatformLLM was provided.
  // The stub LLM in createServerCommandContext rejects with 'LLM not configured'.
  // Stdio context and HTTP without LLM skip this tool rather than always erroring.
  const hasLLM = llmProvided !== false;

  if (hasLLM) {
    server.registerTool(
      'kg_extract_text',
      {
        description: 'Run LLM entity extraction on raw text. Extracts entities and relationships and returns them as structured data.',
        inputSchema: z.object({
          text: z.string().describe('Raw text to extract entities from'),
          model: z.string().optional().default('claude-sonnet-4-20250514').describe('Model to use for extraction'),
        }),
      },
      async ({ text, model }) => {
        try {
          const result = await ctx.llm.streamExtraction(
            { prompt: text, model },
            () => {},
          );
          return { content: [{ type: 'text' as const, text: result.content }] };
        } catch (e: any) {
          return { content: [{ type: 'text' as const, text: `Extraction failed: ${e.message}` }], isError: true };
        }
      },
    );
  );

  // ── Notes ─────────────────────────────────────────────────────────

  server.registerTool(
    'kg_save_note',
    {
      description: 'Create or update a note. Notes are markdown files associated with a node. If nodeId is not provided, a new note node is created.',
      inputSchema: z.object({
        nodeId: z.string().optional().describe('Existing node ID to attach note to. If omitted, creates a new note node.'),
        title: z.string().describe('Note title'),
        content: z.string().describe('Markdown content of the note'),
      }),
    },
    async ({ nodeId, title, content }) => {
      // Use noteCommands (not raw ctx.db) for proper node creation + FTS + wikilinks
      const result = await noteCommands.saveNote(ctx, {
        nodeId: nodeId ?? null,
        name: title,
        content,
        isNew: !nodeId,
      });
      return { content: [{ type: 'text' as const, text: JSON.stringify({ nodeId: result.nodeId, title, saved: true }, null, 2) }] };
    },
  );

  server.registerTool(
    'kg_read_note',
    {
      description: 'Read a note\'s markdown content by node ID.',
      inputSchema: z.object({
        nodeId: z.string().describe('Node ID of the note'),
      }),
    },
    async ({ nodeId }) => {
      const markdown = await ctx.notes.read(nodeId);
      if (markdown === null) {
        return { content: [{ type: 'text' as const, text: `No note found for node ${nodeId}` }], isError: true };
      }
      return { content: [{ type: 'text' as const, text: markdown }] };
    },
  );

  server.registerTool(
    'kg_search_notes',
    {
      description: 'Full-text search across all notes. Returns matching notes with snippets.',
      inputSchema: z.object({
        query: z.string().describe('Search query text'),
        limit: z.number().optional().default(10).describe('Max results (default 10)'),
      }),
    },
    async ({ query, limit }) => {
      const results = await ctx.db.noteSearch.search(query, limit);
      return {
        content: [{
          type: 'text' as const,
          text: results.length === 0
            ? 'No notes found matching query.'
            : JSON.stringify(results, null, 2),
        }],
      };
    },
  );

  // ── Graph DSL Query ───────────────────────────────────────────────

  server.registerTool(
    'kg_query',
    {
      description: 'Execute a graph DSL query. Supports node/edge filtering, path traversal, and aggregation. Returns structured query results.',
      inputSchema: z.object({
        query: z.record(z.unknown()).describe('Graph DSL query object'),
      }),
    },
    async ({ query }) => {
      try {
        const result = await ctx.db.graph.query(query);
        return { content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }] };
      } catch (e: any) {
        return { content: [{ type: 'text' as const, text: `Query failed: ${e.message}` }], isError: true };
      }
    },
  );
}
```

- [ ] **Step 2: Verify build**

```bash
npm run build:electron-main 2>&1 | tail -5
```

- [ ] **Step 3: Commit**

```bash
git add src/mcp/tools.ts
git commit -m "feat(mcp): add 14 MCP tool definitions wrapping knowledge graph commands"
```

---

### Task 5: MCP resources

**Files:**
- Create: `src/mcp/resources.ts`

Resources provide read-only data that MCP clients can fetch. Four resources:

| Resource | URI | Description |
|----------|-----|-------------|
| Graph Stats | `kg://graph/stats` | Node/edge counts, type distribution |
| Node | `kg://nodes/{nodeId}` | Full node data + edges |
| Note | `kg://notes/{nodeId}` | Markdown content of a note |
| Source | `kg://sources/{nodeId}` | Ingested source content |

- [ ] **Step 1: Create the resources file**

```typescript
// src/mcp/resources.ts
import { ResourceTemplate } from '@modelcontextprotocol/server';
import type { McpServer } from '@modelcontextprotocol/server';
import type { ReadResourceResult } from '@modelcontextprotocol/server';
import type { CommandContext } from '../commands/types';

/**
 * Register all knowledge graph resources on an McpServer instance.
 */
export function registerResources(server: McpServer, ctx: CommandContext): void {

  // ── Static: Graph Stats ───────────────────────────────────────────

  server.registerResource(
    'graph-stats',
    'kg://graph/stats',
    {
      title: 'Knowledge Graph Stats',
      description: 'Overall statistics: node count, edge count, type distribution',
      mimeType: 'application/json',
    },
    async (uri): Promise<ReadResourceResult> => {
      const [allNodes, allEdges, nodeTypes, edgeTypes] = await Promise.all([
        ctx.db.nodes.getAll(),
        ctx.db.edges.getAll(),
        ctx.db.nodes.getTypes(),
        ctx.db.edges.getTypes(),
      ]);

      // Count nodes by structural type
      const nodesByType: Record<string, number> = {};
      for (const n of allNodes) {
        nodesByType[n.type] = (nodesByType[n.type] || 0) + 1;
      }

      // Count nodes by label
      const nodesByLabel: Record<string, number> = {};
      for (const n of allNodes) {
        const label = (n as any).label ?? 'unlabeled';
        nodesByLabel[label] = (nodesByLabel[label] || 0) + 1;
      }

      const stats = {
        totalNodes: allNodes.length,
        totalEdges: allEdges.length,
        nodesByType,
        nodesByLabel,
        nodeTypes,
        edgeTypes,
      };

      return {
        contents: [{
          uri: uri.href,
          text: JSON.stringify(stats, null, 2),
        }],
      };
    },
  );

  // ── Dynamic: Node by ID ───────────────────────────────────────────

  server.registerResource(
    'node',
    new ResourceTemplate('kg://nodes/{nodeId}', {
      list: async () => {
        const nodes = await ctx.db.nodes.getAll();
        return {
          resources: nodes.slice(0, 100).map((n) => ({
            uri: `kg://nodes/${n.id}`,
            name: n.name,
          })),
        };
      },
    }),
    {
      title: 'Knowledge Graph Node',
      description: 'Full node data including connected edges',
      mimeType: 'application/json',
    },
    async (uri, { nodeId }): Promise<ReadResourceResult> => {
      const [node, edges] = await Promise.all([
        ctx.db.nodes.getById(nodeId as string),
        ctx.db.edges.getForNode(nodeId as string),
      ]);

      if (!node) {
        return { contents: [{ uri: uri.href, text: JSON.stringify({ error: 'Node not found' }) }] };
      }

      return {
        contents: [{
          uri: uri.href,
          text: JSON.stringify({ node, edges }, null, 2),
        }],
      };
    },
  );

  // ── Dynamic: Note content ─────────────────────────────────────────

  server.registerResource(
    'note',
    new ResourceTemplate('kg://notes/{nodeId}', {
      list: async () => {
        const notes = await ctx.db.noteSearch.getAll();
        return {
          resources: notes.map((n) => ({
            uri: `kg://notes/${n.node_id}`,
            name: n.title,
          })),
        };
      },
    }),
    {
      title: 'Note Content',
      description: 'Markdown content of a note',
      mimeType: 'text/markdown',
    },
    async (uri, { nodeId }): Promise<ReadResourceResult> => {
      const markdown = await ctx.notes.read(nodeId as string);
      return {
        contents: [{
          uri: uri.href,
          text: markdown ?? '(empty note)',
        }],
      };
    },
  );

  // ── Dynamic: Source content ───────────────────────────────────────

  server.registerResource(
    'source',
    new ResourceTemplate('kg://sources/{nodeId}', {
      list: async () => {
        const sources = await ctx.db.sourceContent.getAll();
        return {
          resources: sources.slice(0, 100).map((s: any) => ({
            uri: `kg://sources/${s.node_id}`,
            name: s.title ?? s.url,
          })),
        };
      },
    }),
    {
      title: 'Source Content',
      description: 'Ingested web page content for a resource node',
      mimeType: 'application/json',
    },
    async (uri, { nodeId }): Promise<ReadResourceResult> => {
      const source = await ctx.db.sourceContent.getByNodeId(nodeId as string);
      return {
        contents: [{
          uri: uri.href,
          text: source ? JSON.stringify(source, null, 2) : JSON.stringify({ error: 'No source content' }),
        }],
      };
    },
  );
}
```

- [ ] **Step 2: Verify build**

```bash
npm run build:electron-main 2>&1 | tail -5
```

- [ ] **Step 3: Commit**

```bash
git add src/mcp/resources.ts
git commit -m "feat(mcp): add 4 MCP resource definitions (stats, nodes, notes, sources)"
```

---

### Task 6: MCP server factory

**Files:**
- Create: `src/mcp/server.ts`
- Create: `src/mcp/index.ts`

Single factory function that creates and configures an `McpServer` with all tools and resources. Does NOT connect a transport -- callers choose stdio or HTTP.

- [ ] **Step 1: Create the server factory**

```typescript
// src/mcp/server.ts
import { McpServer } from '@modelcontextprotocol/server';
import type { CommandContext } from '../commands/types';
import { registerTools, type EventBroadcaster } from './tools';
import { registerResources } from './resources';

/**
 * Create a fully-configured MCP server backed by a CommandContext.
 * The caller is responsible for connecting a transport (stdio or HTTP).
 *
 * @param broadcast - Optional event broadcaster for sync. Electron callers
 *   inject one that sends to BrowserWindows. Stdio uses default no-op.
 */
export function createMCPServer(
  ctx: CommandContext,
  opts?: { broadcast?: EventBroadcaster; llmProvided?: boolean },
): McpServer {
  const server = new McpServer(
    {
      name: 'kg-desktop',
      version: '1.0.0',
    },
    {
      instructions: [
        'This server provides access to a local knowledge graph.',
        'The graph has three node types: "entity" (concepts, people, technologies), "resource" (ingested web pages), and "note" (markdown prose).',
        'Entities have semantic labels like "person", "concept", "technology".',
        'Use kg_search_nodes to find nodes, kg_get_node to inspect one, kg_get_neighbors to explore the graph.',
        'Use kg_search_notes and kg_read_note to access the user\'s notes.',
        'Use kg_create_node and kg_create_edge to add knowledge to the graph.',
        'kg_extract_text requires a running desktop app with LLM configured — it will error in stdio-only contexts.',
      ].join(' '),
    },
  );

  registerTools(server, ctx, opts?.broadcast, opts?.llmProvided);
  registerResources(server, ctx);

  return server;
}
```

- [ ] **Step 2: Create barrel export**

```typescript
// src/mcp/index.ts
export { createMCPServer } from './server';
```

- [ ] **Step 3: Verify build**

```bash
npm run build:electron-main 2>&1 | tail -5
```

- [ ] **Step 4: Commit**

```bash
git add src/mcp/server.ts src/mcp/index.ts
git commit -m "feat(mcp): add createMCPServer factory wiring tools and resources"
```

---

### Task 7: Stdio entry point for Claude Desktop / Cursor

**Files:**
- Create: `electron/mcp-stdio.ts`
- Modify: `package.json` (add build script)

This is a standalone Node.js entry point that Claude Desktop or Cursor spawns as a subprocess. It initializes the database, creates the MCP server, connects stdio transport, and blocks until the client disconnects.

Unlike `electron/main.ts`, this file does NOT import Electron. It uses better-sqlite3 directly and the filesystem notes backend (without Electron's `app.getPath()`).

- [ ] **Step 1: Create the stdio entry point**

```typescript
// electron/mcp-stdio.ts
import { StdioServerTransport } from '@modelcontextprotocol/server/stdio';
import { createMCPServer } from '../src/mcp/server';
import { createServerCommandContext } from '../src/commands/create-server-context';
import { createSqliteDataStore } from '../src/db/sqlite-data-store';
import { setEngine } from '../src/db/worker/query-executor';
import Database from 'better-sqlite3';
import { join } from 'path';
import { existsSync, mkdirSync, readFileSync, writeFileSync, unlinkSync, readdirSync } from 'fs';
import { homedir } from 'os';
import type { PlatformNotes, PlatformStorage } from '../src/platform/types';

// ── Resolve paths (no Electron app module) ──────────────────────────

// Prefer KG_USER_DATA env var (set by Electron app when generating MCP config).
// Fallback guesses the path from productName in package.json ("KG Desktop").
// Electron's app.getPath('userData') uses productName, which may contain spaces.
function getUserDataPath(): string {
  if (process.env.KG_USER_DATA) return process.env.KG_USER_DATA;
  const home = homedir();
  switch (process.platform) {
    case 'darwin':
      return join(home, 'Library', 'Application Support', 'KG Desktop');
    case 'win32':
      return join(process.env.APPDATA ?? join(home, 'AppData', 'Roaming'), 'KG Desktop');
    default:
      return join(home, '.config', 'KG Desktop');
  }
}

const USER_DATA = getUserDataPath();
const DB_PATH = join(USER_DATA, 'kg-desktop.db');
const STORAGE_FILE = join(USER_DATA, 'storage.json');

// Default notes directory — same as Electron app
function getDefaultNotesDir(): string {
  const home = homedir();
  return join(home, 'Documents', 'KnowledgeGraph', 'notes');
}

// ── Minimal storage backend (no encryption — no Electron safeStorage) ─

function createMinimalStorage(): PlatformStorage {
  let data: Record<string, any> = {};
  try {
    if (existsSync(STORAGE_FILE)) {
      data = JSON.parse(readFileSync(STORAGE_FILE, 'utf-8'));
    }
  } catch { /* ignore corrupt file */ }

  return {
    get: async <T = Record<string, unknown>>(keys?: string | string[]): Promise<T> => {
      if (!keys) return { ...data } as T;
      if (typeof keys === 'string') {
        const result: Record<string, any> = {};
        if (keys in data) result[keys] = data[keys];
        return result as T;
      }
      const result: Record<string, any> = {};
      for (const k of keys) {
        if (k in data) result[k] = data[k];
      }
      return result as T;
    },
    set: async (items) => {
      Object.assign(data, items);
      const dir = USER_DATA;
      if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
      writeFileSync(STORAGE_FILE, JSON.stringify(data, null, 2), 'utf-8');
    },
    remove: async (keys) => {
      const arr = typeof keys === 'string' ? [keys] : keys;
      for (const k of arr) delete data[k];
      writeFileSync(STORAGE_FILE, JSON.stringify(data, null, 2), 'utf-8');
    },
    onChange: () => () => {},
  };
}

// ── Minimal notes backend ───────────────────────────────────────────

function createMinimalNotes(storage: PlatformStorage): PlatformNotes {
  let notesDir = getDefaultNotesDir();

  return {
    init: async () => {
      // Check if user has configured a custom notes path
      const saved = await storage.get<{ notesPath?: string }>('notesPath');
      if (saved.notesPath && typeof saved.notesPath === 'string') {
        notesDir = saved.notesPath;
      }
      if (!existsSync(notesDir)) mkdirSync(notesDir, { recursive: true });
    },
    read: async (nodeId) => {
      const fp = join(notesDir, `${nodeId}.md`);
      return existsSync(fp) ? readFileSync(fp, 'utf-8') : null;
    },
    write: async (nodeId, markdown) => {
      if (!existsSync(notesDir)) mkdirSync(notesDir, { recursive: true });
      writeFileSync(join(notesDir, `${nodeId}.md`), markdown, 'utf-8');
    },
    remove: async (nodeId) => {
      const fp = join(notesDir, `${nodeId}.md`);
      if (existsSync(fp)) unlinkSync(fp);
    },
    list: async () => {
      if (!existsSync(notesDir)) return [];
      return readdirSync(notesDir)
        .filter((f) => f.endsWith('.md'))
        .map((f) => f.slice(0, -3));
    },
    exists: async (nodeId) => {
      return existsSync(join(notesDir, `${nodeId}.md`));
    },
  };
}

// ── SQLite engine (standalone, no Electron) ─────────────────────────

let db: Database.Database | null = null;

async function initSQLite(): Promise<void> {
  if (db) return;
  if (!existsSync(USER_DATA)) mkdirSync(USER_DATA, { recursive: true });
  db = new Database(DB_PATH);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');

  setEngine({
    exec: async (sql: string, params?: unknown[]): Promise<number> => {
      if (!db) throw new Error('DB not initialized');
      if (params && params.length > 0) {
        return db.prepare(sql).run(...params).changes;
      }
      db.exec(sql);
      return 0;
    },
    query: async <T = Record<string, unknown>>(sql: string, params?: unknown[]): Promise<T[]> => {
      if (!db) throw new Error('DB not initialized');
      if (params && params.length > 0) {
        return db.prepare(sql).all(...params) as T[];
      }
      return db.prepare(sql).all() as T[];
    },
    checkModuleAvailable: async (moduleName: string): Promise<boolean> => {
      if (!db) return false;
      try {
        const rows = db.prepare('SELECT name FROM pragma_module_list WHERE name = ?').all(moduleName) as { name: string }[];
        return rows.length > 0;
      } catch { return false; }
    },
  });
}

async function resetSQLite(): Promise<void> {
  if (db) { db.close(); db = null; }
  await initSQLite();
}

// ── Main ────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  // All logging goes to stderr (stdout is the MCP transport)
  console.error('[MCP stdio] Starting KG Desktop MCP server...');

  const storage = createMinimalStorage();
  const notes = createMinimalNotes(storage);
  await notes.init();

  const dataStore = createSqliteDataStore(initSQLite, resetSQLite);
  await dataStore.init();

  // No PlatformLLM in stdio context — kg_extract_text is not registered.
  const ctx = createServerCommandContext(dataStore, notes, storage);
  const server = createMCPServer(ctx);

  const transport = new StdioServerTransport();
  await server.connect(transport);

  console.error('[MCP stdio] Server connected on stdio. Waiting for client...');
}

main().catch((e) => {
  console.error('[MCP stdio] Fatal error:', e);
  process.exit(1);
});
```

- [ ] **Step 2: Add build script to package.json**

Add to `scripts` in `package.json`:

```json
"build:mcp": "esbuild electron/mcp-stdio.ts --bundle --platform=node --outfile=dist-electron/mcp-stdio.cjs --format=cjs --external:better-sqlite3"
```

**Important:** `better-sqlite3` is marked as `--external` because it contains native bindings that cannot be bundled. It will be resolved from `node_modules` at runtime.

- [ ] **Step 3: Build and verify**

```bash
npm run build:mcp 2>&1 | tail -5
```

Expected: esbuild produces `dist-electron/mcp-stdio.cjs` with no errors.

- [ ] **Step 4: Commit**

```bash
git add electron/mcp-stdio.ts package.json
git commit -m "feat(mcp): add stdio entry point for Claude Desktop / Cursor integration"
```

---

### Task 8: Streamable HTTP transport on companion server

**Files:**
- Modify: `electron/companion-server.ts`
- Modify: `electron/main.ts`

Add MCP Streamable HTTP transport to the existing companion server (port 19876). This lets network-local clients (e.g. a browser-based MCP client or another desktop tool) connect to the knowledge graph over HTTP.

The Streamable HTTP transport uses POST for requests and GET for server-sent events. We use `NodeStreamableHTTPServerTransport` from `@modelcontextprotocol/node`.

- [ ] **Step 1: Update main.ts to pass DataStore and storage to companion server**

The full change to `electron/main.ts`:

Add this import near the top (after the existing db-backend import line):

```typescript
import { handleAction as dbHandleAction, dataStore } from './db-backend';
```

This replaces the existing import:

```typescript
import { handleAction as dbHandleAction } from './db-backend';
```

Then change the `startCompanionServer()` call (around line 150) from:

```typescript
  startCompanionServer();
```

to:

```typescript
  // LLM wrapper for MCP is deferred — the Electron LLM backend (handleStreamExtraction
  // etc.) returns void and reports results via IPC callbacks, which doesn't map to
  // PlatformLLM's typed return values without substantial adapter work.
  // For v1, kg_extract_text returns an error when LLM is unavailable.
  // Future: build a main-process PlatformLLM that calls the Anthropic executor directly.
  startCompanionServer({ dataStore, storage });
```

- [ ] **Step 2: Replace companion-server.ts with MCP-enabled version**

```typescript
// electron/companion-server.ts
import { createServer, IncomingMessage, ServerResponse } from 'http';
import { BrowserWindow } from 'electron';
import { NodeStreamableHTTPServerTransport } from '@modelcontextprotocol/node';
import { isInitializeRequest } from '@modelcontextprotocol/server';
import { randomUUID } from 'crypto';
import { createMCPServer } from '../src/mcp/server';
import { createServerCommandContext } from '../src/commands/create-server-context';
import type { DataStore } from '../src/db/data-store';
import type { StorageBackend } from './storage-backend';
import * as notesBackend from './notes-backend';
import type { PlatformNotes, PlatformStorage, PlatformLLM } from '../src/platform/types';

const PORT = 19876;

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', (chunk) => { body += chunk; });
    req.on('end', () => resolve(body));
    req.on('error', reject);
  });
}

// Allowed origins: only the companion extension and local dev tools.
// Blocks arbitrary web pages from calling mutating MCP tools via CSRF.
const ALLOWED_ORIGINS = new Set([
  'chrome-extension://', // companion extension (any ID)
  'http://localhost',
  'http://127.0.0.1',
]);

// Auth token for the MCP endpoint. Generated on startup, printed to stdout
// so the user can add it to Claude Desktop config. This prevents local-web
// CSRF attacks on the /mcp endpoint (where Origin can be absent).
const MCP_AUTH_TOKEN = crypto.randomUUID();

function isOriginAllowed(origin: string | undefined): boolean {
  if (!origin) return true; // non-browser clients (curl, MCP stdio bridge)
  return [...ALLOWED_ORIGINS].some((prefix) => origin.startsWith(prefix));
}

function cors(req: IncomingMessage, res: ServerResponse): boolean {
  const origin = req.headers.origin;
  if (!isOriginAllowed(origin)) {
    res.writeHead(403);
    res.end('Forbidden');
    return false;
  }
  res.setHeader('Access-Control-Allow-Origin', origin ?? '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Mcp-Session-Id, Authorization');
  res.setHeader('Access-Control-Expose-Headers', 'Mcp-Session-Id');
  return true;
}

function json(res: ServerResponse, status: number, data: any): void {
  // CORS headers already set by caller or not needed for same-origin
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(data));
}

/** Wrap Electron notes-backend as PlatformNotes for the server context. */
function wrapNotes(): PlatformNotes {
  return {
    init: async () => notesBackend.initNotesDir(),
    read: async (nodeId) => notesBackend.readNote(nodeId),
    write: async (nodeId, md) => notesBackend.writeNote(nodeId, md),
    remove: async (nodeId) => notesBackend.removeNote(nodeId),
    list: async () => notesBackend.listNotes(),
    exists: async (nodeId) => notesBackend.noteExists(nodeId),
  };
}

/** Wrap StorageBackend as PlatformStorage for the server context. */
function wrapStorage(sb: StorageBackend): PlatformStorage {
  return {
    get: async (keys?) => sb.get(keys as any),
    set: async (items) => { sb.set(items); },
    remove: async (keys) => { sb.remove(keys); },
    onChange: () => () => {},
  };
}

export interface CompanionServerOptions {
  dataStore: DataStore;
  storage: StorageBackend;
  llm?: PlatformLLM;
}

export function startCompanionServer(opts: CompanionServerOptions): void {
  const { dataStore, storage, llm } = opts;

  // ── MCP transport sessions ──────────────────────────────────────
  const transports = new Map<string, NodeStreamableHTTPServerTransport>();

  // Electron-specific event broadcaster — sends sync events to renderer windows.
  // Injected into createMCPServer so src/mcp/* stays Electron-free.
  const electronBroadcast: import('../src/mcp/tools').EventBroadcaster = (events) => {
    for (const win of BrowserWindow.getAllWindows()) {
      for (const event of events) {
        win.webContents.send('db:sync', event);
      }
    }
  };

  // Build the MCP server context once (shared across sessions).
  const notes = wrapNotes();
  const storageAdapter = wrapStorage(storage);
  const ctx = createServerCommandContext(dataStore, notes, storageAdapter, llm);

  const server = createServer(async (req, res) => {
    if (req.method === 'OPTIONS') {
      if (!cors(req, res)) return;
      res.writeHead(204);
      res.end();
      return;
    }

    // ── Existing companion API routes ───────────────────────────────

    if (req.url === '/api/identify' && req.method === 'GET') {
      json(res, 200, { app: 'kg-desktop', version: '1.0.0', mcp: true });
      return;
    }

    if (req.url === '/api/capture' && req.method === 'POST') {
      try {
        const body = await readBody(req);
        const { title, url, content } = JSON.parse(body);

        if (!content) {
          json(res, 400, { error: 'No content provided' });
          return;
        }

        const windows = BrowserWindow.getAllWindows();
        console.log(`[Companion Server] Received capture: "${title}" (${url}), ${content.length} chars, broadcasting to ${windows.length} windows`);
        for (const win of windows) {
          win.webContents.send('companion:capture', { title, url, content });
        }

        json(res, 200, { success: true });
      } catch (e: any) {
        json(res, 400, { error: e.message });
      }
      return;
    }

    // ── MCP Streamable HTTP endpoint ────────────────────────────────

    if (req.url === '/mcp' && req.method === 'POST') {
      if (!cors(req, res)) return;
      // Require bearer token for MCP endpoint (prevents local-web CSRF)
      const authHeader = req.headers.authorization;
      if (!authHeader || authHeader !== `Bearer ${MCP_AUTH_TOKEN}`) {
        json(res, 401, { error: 'Unauthorized — pass Bearer token from startup output' });
        return;
      }
      const bodyText = await readBody(req);
      let body: any;
      try {
        body = JSON.parse(bodyText);
      } catch {
        json(res, 400, { error: 'Invalid JSON' });
        return;
      }

      const sessionId = req.headers['mcp-session-id'] as string | undefined;

      if (sessionId && transports.has(sessionId)) {
        // Existing session — route to its transport
        await transports.get(sessionId)!.handleRequest(req, res, body);
      } else if (!sessionId && isInitializeRequest(body)) {
        // New session — create transport and connect MCP server
        const mcpServer = createMCPServer(ctx, {
          broadcast: electronBroadcast,
          llmProvided: !!llm,
        });
        const transport = new NodeStreamableHTTPServerTransport({
          sessionIdGenerator: () => randomUUID(),
          onsessioninitialized: (sid) => {
            transports.set(sid, transport);
            console.log(`[MCP HTTP] Session created: ${sid}`);
          },
        });
        transport.onclose = () => {
          if (transport.sessionId) {
            transports.delete(transport.sessionId);
            console.log(`[MCP HTTP] Session closed: ${transport.sessionId}`);
          }
        };
        await mcpServer.connect(transport);
        await transport.handleRequest(req, res, body);
      } else {
        json(res, 400, { error: 'Invalid MCP request: missing session ID or not an initialize request' });
      }
      return;
    }

    // GET /mcp — SSE stream for server-to-client notifications
    if (req.url === '/mcp' && req.method === 'GET') {
      if (!cors(req, res)) return;
      const authHeader = req.headers.authorization;
      if (!authHeader || authHeader !== `Bearer ${MCP_AUTH_TOKEN}`) {
        json(res, 401, { error: 'Unauthorized' });
        return;
      }
      const sessionId = req.headers['mcp-session-id'] as string | undefined;
      if (!sessionId || !transports.has(sessionId)) {
        json(res, 400, { error: 'Invalid or missing session ID' });
        return;
      }
      await transports.get(sessionId)!.handleRequest(req, res);
      return;
    }

    // DELETE /mcp — close session
    if (req.url === '/mcp' && req.method === 'DELETE') {
      if (!cors(req, res)) return;
      const delAuth = req.headers.authorization;
      if (!delAuth || delAuth !== `Bearer ${MCP_AUTH_TOKEN}`) {
        json(res, 401, { error: 'Unauthorized' });
        return;
      }
      const sessionId = req.headers['mcp-session-id'] as string | undefined;
      if (sessionId && transports.has(sessionId)) {
        await transports.get(sessionId)!.handleRequest(req, res);
      } else {
        json(res, 404, { error: 'Session not found' });
      }
      return;
    }

    json(res, 404, { error: 'Not found' });
  });

  server.listen(PORT, '127.0.0.1', () => {
    console.log(`[Companion Server] Listening on http://127.0.0.1:${PORT}`);
    console.log(`[MCP] HTTP transport auth token: ${MCP_AUTH_TOKEN}`);
    console.log(`[Companion Server] MCP endpoint: http://127.0.0.1:${PORT}/mcp`);
  });

  server.on('error', (e: any) => {
    if (e.code === 'EADDRINUSE') {
      console.warn(`[Companion Server] Port ${PORT} in use, skipping`);
    } else {
      console.error('[Companion Server] Error:', e);
    }
  });
}
```

- [ ] **Step 3: Verify build**

```bash
npm run build:electron-main 2>&1 | tail -5
```

- [ ] **Step 4: Commit**

```bash
git add electron/companion-server.ts electron/main.ts
git commit -m "feat(mcp): add Streamable HTTP transport on companion server port 19876"
```

---

### Task 9: Build configuration and electron-builder packaging

**Files:**
- Modify: `package.json`

Ensure the MCP stdio binary is included in the Electron distribution and the build script chains correctly.

- [ ] **Step 1: Update build:electron script to include MCP**

The `dist-electron/**/*` glob in the `build.files` array already covers `dist-electron/mcp-stdio.cjs`, so no change needed there.

Update the `build:electron` script to also build the MCP entry point:

In `package.json`, change:

```json
"build:electron": "npm run build:electron-main && npm run build:electron-renderer"
```

to:

```json
"build:electron": "npm run build:electron-main && npm run build:electron-renderer && npm run build:mcp"
```

- [ ] **Step 2: Verify full build**

```bash
npm run build:electron 2>&1 | tail -10
```

Expected: All three builds succeed. `dist-electron/mcp-stdio.cjs` exists.

```bash
ls -la dist-electron/mcp-stdio.cjs
```

- [ ] **Step 3: Commit**

```bash
git add package.json
git commit -m "feat(mcp): include mcp-stdio in electron build chain"
```

---

### Task 10: Verification and Claude Desktop configuration

No files to create. This task verifies the full setup works end-to-end.

- [ ] **Step 1: Build everything**

```bash
npm run build:electron 2>&1 | tail -10
```

- [ ] **Step 2: Test stdio server starts without errors**

```bash
echo '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-03-26","capabilities":{},"clientInfo":{"name":"test","version":"0.1"}}}' | node dist-electron/mcp-stdio.cjs 2>mcp-test-stderr.log
```

Check `mcp-test-stderr.log` for `[MCP stdio] Server connected on stdio`. The stdout should contain a JSON-RPC response with the server's capabilities.

```bash
cat mcp-test-stderr.log
```

- [ ] **Step 3: Test companion server MCP endpoint**

Start the Electron app, then test:

```bash
# Copy the auth token from the Electron app's startup log: "[MCP] HTTP transport auth token: <token>"
curl -X POST http://127.0.0.1:19876/mcp \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer <token from startup log>" \
  -d '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-03-26","capabilities":{},"clientInfo":{"name":"test","version":"0.1"}}}'
```

Expected: JSON-RPC response with `result.serverInfo.name === "kg-desktop"` and a `Mcp-Session-Id` header. Without the Bearer token, you'll get 401.

- [ ] **Step 4: Document Claude Desktop configuration**

To connect Claude Desktop, add this to `~/Library/Application Support/Claude/claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "kg-desktop": {
      "command": "node",
      "args": ["/path/to/kg_extension/dist-electron/mcp-stdio.cjs"],
      "env": {
        "KG_USER_DATA": "/Users/<you>/Library/Application Support/KG Desktop"
      }
    }
  }
}
```

**Important:** Set `KG_USER_DATA` to the Electron app's actual userData path. On macOS it's `~/Library/Application Support/KG Desktop` (matching `productName` in package.json). Without this env var, the stdio process guesses the path — which works for default installs but may break if the user moved data.

For a packaged app (after `npm run dist:mac`):

```json
{
  "mcpServers": {
    "kg-desktop": {
      "command": "node",
      "args": ["/Applications/KG Desktop.app/Contents/Resources/app/dist-electron/mcp-stdio.cjs"],
      "env": {
        "KG_USER_DATA": "/Users/<you>/Library/Application Support/KG Desktop"
      }
    }
  }
}
```

For Cursor, the equivalent `~/.cursor/mcp.json`:

```json
{
  "mcpServers": {
    "kg-desktop": {
      "command": "node",
      "args": ["/path/to/kg_extension/dist-electron/mcp-stdio.cjs"],
      "env": {
        "KG_USER_DATA": "/Users/<you>/Library/Application Support/KG Desktop"
      }
    }
  }
}
```

- [ ] **Step 5: Clean up test artifacts**

```bash
rm -f mcp-test-stderr.log
```

- [ ] **Step 6: Final commit with CLAUDE.md documentation updates**

Add to the Architecture section of `CLAUDE.md` after the Electron Contexts paragraph:

```markdown
### MCP Server (Electron-only)

Exposes the knowledge graph to external AI tools via the Model Context Protocol. Two transports:
- **stdio** (`dist-electron/mcp-stdio.cjs`): Spawned as a subprocess by Claude Desktop, Cursor, etc.
- **Streamable HTTP** (`http://127.0.0.1:19876/mcp`): On the existing companion server port.

Both transports share the same `McpServer` instance configured in `src/mcp/server.ts` with 14 tools and 4 resources. The MCP server uses `createServerCommandContext()` to build a headless `CommandContext` backed by `DataStore` directly (no IPC, no Zustand).
```

Add to Key References:

```markdown
- **MCP server**: `src/mcp/server.ts` — `createMCPServer()`, `src/mcp/tools.ts` (14 tools), `src/mcp/resources.ts` (4 resources)
- **MCP stdio entry**: `electron/mcp-stdio.ts` — standalone Node entry point for Claude Desktop / Cursor
- **Server context**: `src/commands/create-server-context.ts` — headless CommandContext factory, passes DataStore directly (no adapter)
```

```bash
git add CLAUDE.md
git commit -m "docs: add MCP server to architecture documentation"
```
