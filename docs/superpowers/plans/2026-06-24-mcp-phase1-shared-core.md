# MCP Phase 1: Shared Core Implementation Plan (Revised)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the dual MCP server implementations (in-process + standalone CLI) with a shared core: one `DefaultKnowledgeService`, one set of 8 tools with strict parity, one shared MCP server factory, action-level authorization.

**Architecture:** `DefaultKnowledgeService` takes a `CommandContext` (the existing DI interface) and delegates ALL mutations to existing domain commands (`graphCommands.createNode()`, `noteCommands.saveNote()`, etc.) to preserve side effects (FTS, file sync, provenance, cleanup). For Electron, the existing `createMainProcessContext()` builds the context. For standalone, a new `createStandaloneContext()` builds one from direct SQLite + filesystem. One shared MCP server factory registers tools with validation → authorization → dispatch.

**Tech Stack:** TypeScript, better-sqlite3, MCP SDK (`@modelcontextprotocol/sdk`), vitest

## Global Constraints

- All tool parameters use **snake_case**
- External `label` field maps to `DbNode.label` internally; `DbNode.type` is always `'entity'` for MCP-created entities
- The built-in chat agent continues using existing `chat-agent-tools.ts` in Phase 1 — only the MCP-facing surface changes
- Domain commands must be used for all mutations — never call repository methods directly
- `tags.setForNode()` (not `setTags`)
- `SemanticSearchResult` has only `{ nodeId: string; score: number }` — no `name`/`type`
- Schema imports: `coreDDL`/`fts5DDL` from `src/db/worker/migrations/schema.ts`
- Only expose tools/analyses that work identically in both Electron and standalone modes
- Existing tests must continue passing

---

### Task 1: KnowledgeService Interface and Shared Types

**Files:**
- Create: `src/mcp/types.ts`
- Create: `src/mcp/knowledge-service.ts`

**Interfaces:**
- Consumes: `CommandContext` from `src/commands/types.ts`, `CommandResult`/`CommandEvent` types
- Produces: `KnowledgeService` interface, `MutationResult<T>`, all input/output types — used by every subsequent task

- [ ] **Step 1: Create shared types**

```typescript
// src/mcp/types.ts

// --- Mutation tracking ---

export interface MutationResult<T> {
  data: T;
  effects: {
    nodeIds: string[];
    edgeIds: string[];
  };
}

// --- Search ---

export interface SearchResult {
  id: string;
  name: string;
  type: string;
  label: string | null;
  score: number;
  snippet?: string;
  source: 'entity' | 'note' | 'source' | 'semantic';
}

// --- Entities ---

export interface EntityDetail {
  id: string;
  name: string;
  type: string;
  label: string | null;
  summary: string | null;
  properties: Record<string, unknown>;
  aliases: string[];
  tags: string[];
  edges: EntityEdge[];
  sources: EntitySource[];
  created_at: string;
  updated_at: string;
}

export interface EntityEdge {
  id: string;
  direction: 'outgoing' | 'incoming';
  label: string;
  type: string;
  neighbor_id: string;
  neighbor_name: string;
  neighbor_type: string;
}

export interface EntitySource {
  url: string;
  title: string | null;
}

export interface CreateEntityInput {
  name: string;
  label: string;
  properties?: Record<string, unknown>;
  aliases?: string[];
  tags?: string[];
}

export interface UpdateEntityInput {
  entity_id: string;
  name?: string;
  label?: string;
  properties?: Record<string, unknown>;
  aliases?: string[];
  tags?: string[];
}

export interface EntityResult {
  id: string;
  name: string;
  type: string;
  action: 'created' | 'updated' | 'deleted';
}

export interface MergeResult {
  primary_id: string;
  secondary_id: string;
  edges_transferred: number;
  alias_added: string;
}

// --- Relationships ---

export interface CreateRelationshipInput {
  source_id: string;
  target_id: string;
  label: string;
  type?: string;
}

export interface UpdateRelationshipInput {
  relationship_id: string;
  label?: string;
  type?: string;
}

export interface RelationshipResult {
  id: string;
  action: 'created' | 'updated' | 'deleted';
}

// --- Neighbors ---

export interface NeighborNode {
  id: string;
  name: string;
  type: string;
  label: string | null;
  edge_label: string;
  edge_direction: 'outgoing' | 'incoming';
  depth: number;
}

export interface NeighborResult {
  root_id: string;
  nodes: NeighborNode[];
  total: number;
}

// --- Notes ---

export interface NoteResult {
  id: string;
  title: string;
  action: 'read' | 'created' | 'updated';
  content?: string;
}

// --- Analysis ---

export type AnalysisType = 'overview' | 'health' | 'centrality' | 'orphans' | 'paths';

export interface AnalysisResult {
  analysis: AnalysisType;
  data: Record<string, unknown>;
}

// --- Events ---

export type GraphChangeEvent =
  | { type: 'entity_created'; id: string }
  | { type: 'entity_updated'; id: string }
  | { type: 'entity_deleted'; id: string }
  | { type: 'relationship_created'; id: string }
  | { type: 'relationship_deleted'; id: string }
  | { type: 'note_updated'; id: string }
  | { type: 'reset' };
```

- [ ] **Step 2: Create KnowledgeService interface**

```typescript
// src/mcp/knowledge-service.ts

import type {
  SearchResult, EntityDetail, CreateEntityInput, UpdateEntityInput,
  EntityResult, MergeResult, MutationResult, NeighborResult,
  CreateRelationshipInput, UpdateRelationshipInput, RelationshipResult,
  NoteResult, AnalysisType, AnalysisResult, GraphChangeEvent,
} from './types';

export interface KnowledgeService {
  search(params: { query: string; scope?: 'all' | 'entities' | 'notes' | 'semantic'; limit?: number }): Promise<SearchResult[]>;

  getEntity(id: string): Promise<EntityDetail | null>;
  createEntity(input: CreateEntityInput): Promise<MutationResult<EntityResult>>;
  updateEntity(input: UpdateEntityInput): Promise<MutationResult<EntityResult>>;
  deleteEntities(ids: string[]): Promise<MutationResult<{ deleted: number }>>;
  mergeEntities(primary_id: string, secondary_id: string): Promise<MutationResult<MergeResult>>;

  getNeighbors(params: { entity_id: string; depth?: number; limit?: number }): Promise<NeighborResult>;

  createRelationship(input: CreateRelationshipInput): Promise<MutationResult<RelationshipResult>>;
  updateRelationship(input: UpdateRelationshipInput): Promise<MutationResult<RelationshipResult>>;
  deleteRelationships(ids: string[]): Promise<MutationResult<{ deleted: number }>>;

  readNote(note_id: string): Promise<NoteResult>;
  createNote(title: string, content: string): Promise<MutationResult<NoteResult>>;
  updateNote(note_id: string, updates: { title?: string; content?: string }): Promise<MutationResult<NoteResult>>;

  analyzeGraph(analysis: AnalysisType, options?: Record<string, unknown>): Promise<AnalysisResult>;

  onGraphChanged(cb: (event: GraphChangeEvent) => void): () => void;
}
```

- [ ] **Step 3: Verify types compile**

Run: `npx tsc --noEmit --strict --moduleResolution bundler --module esnext --target esnext src/mcp/types.ts src/mcp/knowledge-service.ts`
Expected: No errors

- [ ] **Step 4: Commit**

```bash
git add src/mcp/types.ts src/mcp/knowledge-service.ts
git commit -m "feat(mcp): add KnowledgeService interface and shared types"
```

---

### Task 2: Shared Tool Definitions (8 Tools)

**Files:**
- Create: `src/mcp/tools/types.ts`
- Create: `src/mcp/tools/definitions.ts`

**Interfaces:**
- Consumes: Nothing (standalone definitions)
- Produces: `MCP_TOOL_DEFINITIONS` array, `McpToolName` type, `TOOL_CAPABILITY_MAP` — used by Tasks 3, 5, 6

- [ ] **Step 1: Create tool types with capability map**

```typescript
// src/mcp/tools/types.ts

export interface McpToolDefinition {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  annotations?: {
    readOnlyHint?: boolean;
    destructiveHint?: boolean;
  };
}

export type McpToolName =
  | 'search'
  | 'get_entity'
  | 'get_neighbors'
  | 'manage_entity'
  | 'manage_relationship'
  | 'merge_entities'
  | 'manage_note'
  | 'analyze_graph';

export type Capability = 'read' | 'write';

export const TOOL_CAPABILITY_MAP: Record<string, Capability> = {
  'search': 'read',
  'get_entity': 'read',
  'get_neighbors': 'read',
  'manage_entity:create': 'write',
  'manage_entity:update': 'write',
  'manage_entity:delete': 'write',
  'manage_relationship:create': 'write',
  'manage_relationship:update': 'write',
  'manage_relationship:delete': 'write',
  'merge_entities': 'write',
  'manage_note:read': 'read',
  'manage_note:create': 'write',
  'manage_note:update': 'write',
  'analyze_graph': 'read',
};

export function getRequiredCapability(tool: string, action?: string): Capability {
  const key = action ? `${tool}:${action}` : tool;
  return TOOL_CAPABILITY_MAP[key] ?? 'read';
}
```

- [ ] **Step 2: Create 8 tool definitions with discriminated oneOf schemas**

Create `src/mcp/tools/definitions.ts` containing `MCP_TOOL_DEFINITIONS` array. Use the exact schemas from the revised spec (Section 3) — discriminated `oneOf` for `manage_entity`, `manage_relationship`, `manage_note`. `analyze_graph` enum limited to `['overview', 'health', 'centrality', 'orphans', 'paths']`. `manage_entity` uses `label` (not `type`) for the semantic classification field.

Key: copy the 8 tool schemas from the spec verbatim. Each has `name`, `description`, `inputSchema`, and `annotations`.

- [ ] **Step 3: Commit**

```bash
git add src/mcp/tools/types.ts src/mcp/tools/definitions.ts
git commit -m "feat(mcp): add 8 tool definitions with action-level capability map"
```

---

### Task 3: Authorization Module

**Files:**
- Create: `src/mcp/authorization.ts`
- Create: `tests/mcp/authorization.test.ts`

**Interfaces:**
- Consumes: `TOOL_CAPABILITY_MAP`, `getRequiredCapability` (Task 2), `MCP_TOOL_DEFINITIONS` (Task 2)
- Produces: `ProfilePolicy` class with `canListTool(name)`, `canExecute(name, action?)`, `loadProfile(configPath, profileName)` — used by Task 6

- [ ] **Step 1: Write authorization tests**

```typescript
// tests/mcp/authorization.test.ts
import { describe, it, expect } from 'vitest';
import { ProfilePolicy } from '../../src/mcp/authorization';

describe('ProfilePolicy', () => {
  it('readonly profile allows read tools', () => {
    const policy = new ProfilePolicy({ capabilities: ['read'], blocked_tools: [], blocked_actions: [] });
    expect(policy.canExecute('search')).toBe(true);
    expect(policy.canExecute('get_entity')).toBe(true);
    expect(policy.canExecute('analyze_graph')).toBe(true);
  });

  it('readonly profile blocks write tools', () => {
    const policy = new ProfilePolicy({ capabilities: ['read'], blocked_tools: [], blocked_actions: [] });
    expect(policy.canExecute('manage_entity', 'create')).toBe(false);
    expect(policy.canExecute('merge_entities')).toBe(false);
  });

  it('readonly profile allows manage_note:read but blocks create/update', () => {
    const policy = new ProfilePolicy({ capabilities: ['read'], blocked_tools: [], blocked_actions: [] });
    expect(policy.canExecute('manage_note', 'read')).toBe(true);
    expect(policy.canExecute('manage_note', 'create')).toBe(false);
  });

  it('write profile allows all actions', () => {
    const policy = new ProfilePolicy({ capabilities: ['read', 'write'], blocked_tools: [], blocked_actions: [] });
    expect(policy.canExecute('manage_entity', 'delete')).toBe(true);
    expect(policy.canExecute('manage_note', 'create')).toBe(true);
  });

  it('blocked_actions overrides capability', () => {
    const policy = new ProfilePolicy({
      capabilities: ['read', 'write'],
      blocked_tools: [],
      blocked_actions: ['manage_entity:delete'],
    });
    expect(policy.canExecute('manage_entity', 'create')).toBe(true);
    expect(policy.canExecute('manage_entity', 'delete')).toBe(false);
  });

  it('blocked_tools blocks entire tool', () => {
    const policy = new ProfilePolicy({
      capabilities: ['read', 'write'],
      blocked_tools: ['merge_entities'],
      blocked_actions: [],
    });
    expect(policy.canExecute('merge_entities')).toBe(false);
  });

  it('canListTool returns true if ANY action is allowed', () => {
    const policy = new ProfilePolicy({ capabilities: ['read'], blocked_tools: [], blocked_actions: [] });
    expect(policy.canListTool('manage_note')).toBe(true);
    expect(policy.canListTool('manage_entity')).toBe(false);
    expect(policy.canListTool('search')).toBe(true);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/mcp/authorization.test.ts`
Expected: FAIL — module does not exist

- [ ] **Step 3: Implement ProfilePolicy**

```typescript
// src/mcp/authorization.ts
import { TOOL_CAPABILITY_MAP, getRequiredCapability } from './tools/types';
import type { Capability } from './tools/types';

export interface ProfileConfig {
  capabilities: Capability[];
  blocked_tools: string[];
  blocked_actions: string[];
}

const ACTION_TOOLS = new Map<string, string[]>([
  ['manage_entity', ['create', 'update', 'delete']],
  ['manage_relationship', ['create', 'update', 'delete']],
  ['manage_note', ['read', 'create', 'update']],
]);

export class ProfilePolicy {
  private caps: Set<Capability>;
  private blockedTools: Set<string>;
  private blockedActions: Set<string>;

  constructor(config: ProfileConfig) {
    this.caps = new Set(config.capabilities);
    this.blockedTools = new Set(config.blocked_tools);
    this.blockedActions = new Set(config.blocked_actions);
  }

  canExecute(tool: string, action?: string): boolean {
    if (this.blockedTools.has(tool)) return false;
    if (action && this.blockedActions.has(`${tool}:${action}`)) return false;
    const required = getRequiredCapability(tool, action);
    return this.caps.has(required);
  }

  canListTool(tool: string): boolean {
    if (this.blockedTools.has(tool)) return false;
    const actions = ACTION_TOOLS.get(tool);
    if (actions) {
      return actions.some((a) => this.canExecute(tool, a));
    }
    return this.canExecute(tool);
  }
}

export function loadProfileFromFile(configPath: string, profileName: string): ProfileConfig {
  try {
    const fs = require('fs');
    const raw = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
    const profile = raw.profiles?.[profileName];
    if (profile) {
      return {
        capabilities: profile.capabilities ?? ['read'],
        blocked_tools: profile.blocked_tools ?? [],
        blocked_actions: profile.blocked_actions ?? [],
      };
    }
  } catch {}
  return { capabilities: ['read'], blocked_tools: [], blocked_actions: [] };
}
```

- [ ] **Step 4: Run tests**

Run: `npx vitest run tests/mcp/authorization.test.ts`
Expected: All pass

- [ ] **Step 5: Commit**

```bash
git add src/mcp/authorization.ts tests/mcp/authorization.test.ts
git commit -m "feat(mcp): add action-level authorization with profile policy"
```

---

### Task 4: DefaultKnowledgeService

**Files:**
- Create: `src/mcp/knowledge-service-impl.ts`
- Create: `tests/mcp/knowledge-service-impl.test.ts`

**Interfaces:**
- Consumes: `KnowledgeService` (Task 1), `CommandContext` from `src/commands/types.ts`, `graphCommands` from `src/commands/graph-commands.ts`, `saveNote` from `src/commands/note-commands.ts`
- Produces: `DefaultKnowledgeService` class — used by Tasks 6 and 7

This is the ONE implementation. It delegates to domain commands via `CommandContext`, converts `CommandResult.events` to `MutationResult.effects`, and resolves neighbor names via JOINs.

Key delegations:
- `createEntity` → `graphCommands.createNode(ctx, { name, type: 'entity', label, properties })`
- `deleteEntities` → `graphCommands.deleteNode(ctx, id)` per ID (handles FTS, note files, provenance)
- `createNote` → `noteCommands.saveNote(ctx, { nodeId: null, name: title, content, isNew: true })`
- `updateNote` → `noteCommands.saveNote(ctx, { nodeId, name: title, content, isNew: false })`
- `mergeEntities` → custom implementation (no existing domain command): transfer edges, add alias, delete secondary — all within a transaction
- Tags → `ctx.db.tags.setForNode(nodeId, tags)` (not `setTags`)
- Aliases → `ctx.db.entityResolution.getAliases()`, `removeAlias()`, `addAlias()`
- Search → `ctx.db.nodes.search()`, `ctx.db.noteSearch.search()`, `ctx.embedding?.searchSimilar()`
- Analysis → `ctx.db.loadGraph()` + graph algorithm functions for centrality/orphans/paths; raw SQL for overview/health

`MutationResult.effects` are derived from `CommandResult.events`:
```typescript
function eventsToEffects(events: CommandEvent[]): { nodeIds: string[]; edgeIds: string[] } {
  const nodeIds: string[] = [];
  const edgeIds: string[] = [];
  for (const e of events) {
    if ('node' in e) nodeIds.push(e.node.id);
    if ('id' in e && e.type.startsWith('node_')) nodeIds.push(e.id);
    if ('edge' in e) edgeIds.push(e.edge.id);
    if ('id' in e && e.type.startsWith('edge_')) edgeIds.push(e.id);
  }
  return { nodeIds, edgeIds };
}
```

Semantic search handling: when `ctx.embedding` is undefined and `scope === 'semantic'`, return an error object `{ error: 'Semantic search requires embeddings to be enabled' }` — do NOT return empty results silently. When `ctx.embedding` is available, resolve `nodeId` from `SemanticSearchResult` to `name`/`type` via `ctx.db.nodes.getById()`.

- [ ] **Step 1: Write tests** — test search delegation, entity CRUD via domain commands, note creation via `saveNote`, merge logic, mutation effect extraction. Use a mock `CommandContext` that verifies domain command calls.

- [ ] **Step 2: Run tests to verify they fail**

- [ ] **Step 3: Implement `DefaultKnowledgeService`** — follow the delegation patterns above. Import and call `graphCommands.*` and `noteCommands.saveNote` directly. Convert `CommandResult.events` to `MutationResult.effects`.

- [ ] **Step 4: Run tests, verify they pass**

- [ ] **Step 5: Commit**

```bash
git add src/mcp/knowledge-service-impl.ts tests/mcp/knowledge-service-impl.test.ts
git commit -m "feat(mcp): implement DefaultKnowledgeService with domain command delegation"
```

---

### Task 5: Validation and Tool Handler Dispatch

**Files:**
- Create: `src/mcp/tools/validation.ts`
- Create: `src/mcp/tools/handlers.ts`
- Create: `tests/mcp/tool-handlers.test.ts`

**Interfaces:**
- Consumes: `KnowledgeService` (Task 1), `ProfilePolicy` (Task 3), `McpToolName` (Task 2)
- Produces: `validateToolInput(name, input)`, `executeToolHandler(service, policy, name, input): Promise<ToolHandlerResult>` — used by Task 6

The handler layer validates input, checks authorization, dispatches to `KnowledgeService`, and returns structured results with mutation effects.

```typescript
// Return type from handlers
interface ToolHandlerResult {
  result: string;          // JSON response
  isError: boolean;
  effects: { nodeIds: string[]; edgeIds: string[] };
}
```

**Validation:** `validateToolInput()` checks per-action required fields using the discriminated schemas. Returns `{ valid: true }` or `{ valid: false, error: string }`. Examples:
- `manage_entity:create` without `name` → error
- `manage_entity:delete` without `entity_ids` → error
- `get_neighbors` with `depth < 1` or `depth > 3` → clamp and warn
- `analyze_graph:paths` without `options.source_id` → error

**Authorization:** Before dispatching, check `policy.canExecute(tool, action)`. Return auth error if denied.

**Dispatch:** Map validated input to `KnowledgeService` calls. For write operations, return `MutationResult.effects` in the handler result. For read operations, return empty effects.

- [ ] **Step 1: Write tests** — validate required fields per action, auth rejection, dispatch to correct service methods, effect propagation from mutations.

- [ ] **Step 2: Run tests to verify they fail**

- [ ] **Step 3: Implement validation.ts** — per-tool, per-action required field checks with descriptive error messages.

- [ ] **Step 4: Implement handlers.ts** — switch on tool name, extract action for action-based tools, validate, authorize, dispatch, return `ToolHandlerResult`.

- [ ] **Step 5: Run tests, verify they pass**

- [ ] **Step 6: Commit**

```bash
git add src/mcp/tools/validation.ts src/mcp/tools/handlers.ts tests/mcp/tool-handlers.test.ts
git commit -m "feat(mcp): add tool validation, authorization, and handler dispatch"
```

---

### Task 6: Shared MCP Server Factory and Electron Wiring

**Files:**
- Create: `src/mcp/server.ts`
- Modify: `electron/mcp/mcp-server-bridge.ts` — use shared server
- Modify: `electron/main.ts:~686-780` — wire `DefaultKnowledgeService` + `KnowledgeToolProvider`

**Interfaces:**
- Consumes: `MCP_TOOL_DEFINITIONS` (Task 2), `ProfilePolicy` (Task 3), `executeToolHandler` (Task 5), `DefaultKnowledgeService` (Task 4)
- Produces: `createSynapseMcpServer(service, policy)` factory — used by Task 7 (CLI)

The shared server factory registers tools via MCP SDK `Server`, using `ProfilePolicy` to filter the tool list and authorize execution. It passes `ToolHandlerResult.effects` back to the bridge's `onGraphMutated` callback.

```typescript
// src/mcp/server.ts — key structure
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { ListToolsRequestSchema, CallToolRequestSchema } from '@modelcontextprotocol/sdk/types.js';

export function createSynapseMcpServer(
  service: KnowledgeService,
  policy: ProfilePolicy,
  onMutation?: (effects: { nodeIds: string[]; edgeIds: string[] }) => void,
): Server {
  const server = new Server(
    { name: 'synapse', version: '0.7.0' },
    { capabilities: { tools: {} } },
  );

  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: MCP_TOOL_DEFINITIONS
      .filter((t) => policy.canListTool(t.name))
      .map((t) => ({ name: t.name, description: t.description, inputSchema: t.inputSchema as any })),
  }));

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args } = request.params;
    const result = await executeToolHandler(service, policy, name, (args ?? {}) as Record<string, unknown>);
    if (!result.isError && (result.effects.nodeIds.length > 0 || result.effects.edgeIds.length > 0)) {
      onMutation?.(result.effects);
    }
    return {
      content: [{ type: 'text' as const, text: result.result }],
      isError: result.isError,
    };
  });

  return server;
}
```

**Electron wiring:** In `main.ts`, after creating `mainCtx`:
1. Create `DefaultKnowledgeService(mainCtx)`
2. Load profile config from `.synapse/mcp-server.json` (re-read per request for dynamic reload)
3. Pass to `McpServerBridge` via `createSynapseMcpServer()`
4. `onMutation` callback: broadcast `db:sync { type: 'reset' }` to windows + update embeddings with specific IDs

- [ ] **Step 1: Implement `createSynapseMcpServer`**

- [ ] **Step 2: Update `McpServerBridge.handleRequest()` to use the shared server**

- [ ] **Step 3: Wire into `main.ts`** — replace `BuiltinToolProvider` path with `DefaultKnowledgeService` + shared server

- [ ] **Step 4: Build both targets**

Run: `npm run build:electron-main && npm run build:electron-renderer`
Expected: Both succeed

- [ ] **Step 5: Smoke test** — launch app, open vault, curl `tools/list` on `:19876/mcp`, verify 8 tools returned

- [ ] **Step 6: Commit**

```bash
git add src/mcp/server.ts electron/mcp/mcp-server-bridge.ts electron/main.ts
git commit -m "feat(mcp): wire shared MCP server into Electron main process"
```

---

### Task 7: Standalone Context Factory and CLI Migration

**Files:**
- Create: `src/mcp/adapters/standalone.ts`
- Modify: `packages/synapse-mcp/src/index.ts` — replace inline tools with shared server
- Create: `tests/mcp/standalone-context.test.ts`

**Interfaces:**
- Consumes: `DefaultKnowledgeService` (Task 4), `createSynapseMcpServer` (Task 6), `ProfilePolicy` (Task 3), `CommandContext` from `src/commands/types.ts`
- Produces: `createStandaloneContext(db, vaultPath)` — builds a `CommandContext` for direct-SQLite mode

The standalone context factory creates a `CommandContext` where:
- `db` is a `DataStore` backed by direct `better-sqlite3` (reuse existing main-process DataStore implementation)
- `notes.read` reads `.md` files from `{vaultPath}/notes/`
- `notes.write` writes `.md` files to `{vaultPath}/notes/`
- `storage`, `llm`, `browser` are no-op stubs
- `embedding` is optional (configured from app settings)
- `getGraphSnapshot` queries the DB directly

The CLI's 900-line switch statement is replaced by:
1. Open database → `createStandaloneContext(db, vaultPath)`
2. `new DefaultKnowledgeService(ctx)`
3. Load profile from `--profile` flag or `--allow-write` mapping
4. `createSynapseMcpServer(service, policy, () => notifyApp())`
5. Connect to stdio transport

Vault management tools (`list_vaults`, `open_vault`, `close_vault`) remain CLI-specific — added as additional handlers on the server before connecting the transport. Each vault gets its own `DefaultKnowledgeService` instance.

- [ ] **Step 1: Write test** — create in-memory DB, build standalone context, create `DefaultKnowledgeService`, verify entity CRUD cycle works end-to-end.

- [ ] **Step 2: Implement `createStandaloneContext()`** — builds `CommandContext` with direct SQLite DataStore and filesystem note adapter.

- [ ] **Step 3: Update CLI `index.ts`** — replace inline tool definitions and switch statement with shared server. Keep vault management tools.

- [ ] **Step 4: Build CLI**

Run: `npm run build:mcp`
Expected: Builds successfully

- [ ] **Step 5: Smoke test CLI**

Run: `echo '{"jsonrpc":"2.0","method":"tools/list","id":1}' | node packages/synapse-mcp/dist/index.js --vault /path/to/vault 2>/dev/null`
Expected: 8 tools listed (+ vault management tools)

- [ ] **Step 6: Commit**

```bash
git add src/mcp/adapters/standalone.ts packages/synapse-mcp/src/index.ts tests/mcp/standalone-context.test.ts
git commit -m "feat(mcp): migrate standalone CLI to shared core"
```

---

### Task 8: Integration Tests

**Files:**
- Create: `tests/mcp/integration.test.ts`

**Interfaces:**
- Consumes: All previous tasks

Tests that verify strict parity, authorization, mutation effects, and correct domain command delegation across both contexts.

- [ ] **Step 1: Write integration tests**

Test cases:
1. **Tool count**: exactly 8 tools listed
2. **Snake_case**: all tool names match `/^[a-z][a-z0-9_]*$/`
3. **Full CRUD cycle**: create entity → search → get → update → delete → verify gone
4. **Relationship cycle**: create two entities → create relationship → get_neighbors → delete relationship
5. **Note via domain commands**: create note → verify `saveNote` side effects (node created with type 'note')
6. **Merge with effects**: create two entities with edges → merge → verify alias added, edges transferred, effects returned
7. **Authorization: readonly blocks writes**: create policy with `['read']` → `manage_entity:create` returns auth error
8. **Authorization: action-level block**: create policy with `['read', 'write']` + `blocked_actions: ['manage_entity:delete']` → delete blocked, create allowed
9. **Authorization: manage_note:read allowed in readonly**: readonly policy → `manage_note:read` succeeds
10. **Mutation effects populated**: create entity → verify `effects.nodeIds` contains the new ID
11. **Analyze graph overview**: create entities → `analyze_graph:overview` returns correct counts
12. **Analyze graph paths**: create A→B→C chain → `analyze_graph:paths` finds path from A to C
13. **Entity label mapping**: create entity with `label: 'person'` → get_entity returns `type: 'entity'`, `label: 'person'`
14. **Validation: missing required fields**: `manage_entity:create` without `name` → descriptive error
15. **Validation: paths without source_id**: `analyze_graph:paths` without `options.source_id` → descriptive error

Use the standalone context (in-memory SQLite) for integration tests — fast, no filesystem dependencies.

- [ ] **Step 2: Run integration tests**

Run: `npx vitest run tests/mcp/integration.test.ts`
Expected: All pass

- [ ] **Step 3: Run full test suite**

Run: `npm test`
Expected: All existing tests still pass

- [ ] **Step 4: Build both targets**

Run: `npm run build:electron && npm run build:mcp`
Expected: Both succeed

- [ ] **Step 5: Commit**

```bash
git add tests/mcp/integration.test.ts
git commit -m "test(mcp): add integration tests for shared core with strict parity"
```

---

## File Map Summary

| File | Status | Purpose |
|------|--------|---------|
| `src/mcp/types.ts` | New | Shared types: MutationResult, SearchResult, EntityDetail, etc. |
| `src/mcp/knowledge-service.ts` | New | KnowledgeService interface |
| `src/mcp/knowledge-service-impl.ts` | New | DefaultKnowledgeService — ONE implementation, domain command delegation |
| `src/mcp/tools/types.ts` | New | McpToolName, TOOL_CAPABILITY_MAP, getRequiredCapability |
| `src/mcp/tools/definitions.ts` | New | 8 tool schemas (single source of truth) |
| `src/mcp/tools/validation.ts` | New | Per-tool, per-action input validation |
| `src/mcp/tools/handlers.ts` | New | Validate → authorize → dispatch → return ToolHandlerResult |
| `src/mcp/authorization.ts` | New | ProfilePolicy, loadProfileFromFile |
| `src/mcp/server.ts` | New | createSynapseMcpServer() — shared MCP server factory |
| `src/mcp/adapters/standalone.ts` | New | createStandaloneContext() — CommandContext for direct-SQLite |
| `electron/mcp/mcp-server-bridge.ts` | Modify | Use shared server factory |
| `electron/main.ts` | Modify | Wire DefaultKnowledgeService |
| `packages/synapse-mcp/src/index.ts` | Modify | Replace inline tools with shared server |
| `tests/mcp/authorization.test.ts` | New | Profile policy unit tests |
| `tests/mcp/knowledge-service-impl.test.ts` | New | Service delegation tests |
| `tests/mcp/tool-handlers.test.ts` | New | Validation + dispatch tests |
| `tests/mcp/standalone-context.test.ts` | New | Standalone context factory tests |
| `tests/mcp/integration.test.ts` | New | End-to-end parity + auth tests |
