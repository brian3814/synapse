# MCP Agentic-First Redesign

Redesign the MCP layer so Synapse is a knowledge graph platform that any agent can interact with. External agents (Claude Desktop, Claude Code, Codex, Cursor, custom) are first-class citizens. The built-in chat agent is just another MCP client — not special.

## Design Constraints

1. **Single implementation, injected adapters** — one `DefaultKnowledgeService`, environment differences handled by adapter injection
2. **Strict parity** — only expose tools that work fully in both Electron and standalone modes. No placeholders or stubs.
3. **Domain commands, not repositories** — all mutations go through existing domain commands (`graphCommands`, `noteCommands`) to preserve side effects (FTS, file sync, provenance, cleanup)
4. **Action-level authorization** — `{tool, action}` policy checks at both listing and execution time
5. **Resources + Prompts** — graph entities, notes, files as browsable MCP resources; skill templates as MCP prompts (Phase 2+)
6. **Dogfood** — built-in chat agent consumes the same MCP interface as external agents (Phase 3)
7. **Agent-as-MCP-client** — the built-in chat is one option, not privileged
8. **Swappable composition** — clean layer boundaries so components can be replaced

## 1. Layer Architecture

```
┌──────────────────────────────────────────────────────┐
│  Agent Layer (not our code — pluggable)               │
│  Claude Desktop · Claude Code · Codex · Custom        │
└──────────────┬───────────────────────────────────────┘
               │ MCP Protocol (stdio / HTTP Streamable)
┌──────────────┴───────────────────────────────────────┐
│  MCP Server (shared — one registration)               │
│  Validation → Authorization → Tool Handlers           │
│  8 Tools (Phase 1) · Resources · Prompts (Phase 2+)  │
└──────────────┬───────────────────────────────────────┘
               │
┌──────────────┴───────────────────────────────────────┐
│  DefaultKnowledgeService (one implementation)         │
│  Calls domain commands for all mutations              │
│  Returns structured mutation effects                  │
└──────────────┬───────────────────────────────────────┘
               │ KnowledgeDeps (injected adapters)
┌──────────────┴───────────────────────────────────────┐
│  Adapters (swapped per environment)                   │
│  ┌──────┐ ┌───────┐ ┌───────────┐ ┌──────────────┐  │
│  │  DB  │ │ Notes │ │ Embeddings│ │   Events     │  │
│  └──────┘ └───────┘ └───────────┘ └──────────────┘  │
│  Electron: IPC    Electron: IPC   Electron: svc     │
│  CLI: SQLite      CLI: fs         CLI: optional     │
└──────────────────────────────────────────────────────┘
```

**Key difference from prior version:** There is ONE `DefaultKnowledgeService` implementation, not two. Environment differences are handled by injecting different adapters for DB access, note I/O, embeddings, and event dispatch.

**Two runtime modes:**

| Mode | Transport | Adapters | When |
|------|-----------|----------|------|
| **Desktop** | HTTP Streamable on `:19876/mcp` | IPC DataStore, PlatformNotes, embedding service, db:sync broadcast | App running |
| **Headless** | stdio | direct-SQLite DataStore, filesystem notes, optional embeddings, HTTP notify | CLI, no app |

## 2. KnowledgeDeps and KnowledgeService Interface

### 2.1 Dependency Injection

```typescript
interface KnowledgeDeps {
  db: DataStore;
  notes: NoteAdapter;
  vault: VaultAdapter;
  embeddings?: EmbeddingAdapter;
  events: EventAdapter;
}

interface NoteAdapter {
  read(nodeId: string): Promise<string | null>;
  write(nodeId: string, content: string): Promise<void>;
}

interface VaultAdapter {
  path: string;
  synapsePath: string;
  readFile(relativePath: string): Promise<string | null>;
  listFiles(dir: string): Promise<string[]>;
}

interface EmbeddingAdapter {
  searchSimilar(query: string, topK?: number): Promise<SemanticSearchResult[]>;
}

interface EventAdapter {
  emitGraphChanged(event: GraphChangeEvent): void;
  onGraphChanged(cb: (event: GraphChangeEvent) => void): () => void;
}
```

### 2.2 KnowledgeService Interface

The contract between the MCP server layer and the business logic. ONE implementation (`DefaultKnowledgeService`) for both runtime modes.

```typescript
interface KnowledgeService {
  // --- Search ---
  search(params: {
    query: string;
    scope?: 'all' | 'entities' | 'notes' | 'semantic';
    limit?: number;
  }): Promise<SearchResult[]>;

  // --- Entities ---
  getEntity(id: string): Promise<EntityDetail | null>;
  createEntity(input: CreateEntityInput): Promise<MutationResult<EntityResult>>;
  updateEntity(input: UpdateEntityInput): Promise<MutationResult<EntityResult>>;
  deleteEntities(ids: string[]): Promise<MutationResult<{ deleted: number }>>;
  mergeEntities(primary_id: string, secondary_id: string): Promise<MutationResult<MergeResult>>;

  // --- Graph Traversal ---
  getNeighbors(params: {
    entity_id: string;
    depth?: number;
    limit?: number;
  }): Promise<NeighborResult>;

  // --- Relationships ---
  createRelationship(input: CreateRelationshipInput): Promise<MutationResult<RelationshipResult>>;
  updateRelationship(input: UpdateRelationshipInput): Promise<MutationResult<RelationshipResult>>;
  deleteRelationships(ids: string[]): Promise<MutationResult<{ deleted: number }>>;

  // --- Notes ---
  readNote(note_id: string): Promise<NoteResult>;
  createNote(title: string, content: string): Promise<MutationResult<NoteResult>>;
  updateNote(note_id: string, updates: { title?: string; content?: string }): Promise<MutationResult<NoteResult>>;

  // --- Analysis ---
  analyzeGraph(analysis: AnalysisType, options?: Record<string, unknown>): Promise<AnalysisResult>;

  // --- Skills (Phase 2) ---
  listSkills(): Promise<SkillSummary[]>;
  runSkill(name: string, args?: Record<string, unknown>): Promise<SkillResult>;

  // --- Events ---
  onGraphChanged(cb: (event: GraphChangeEvent) => void): () => void;
}
```

### 2.3 Mutation Effects

All write operations return structured mutation effects so the caller (MCP server, embedding service, UI sync) knows exactly what changed:

```typescript
interface MutationResult<T> {
  data: T;
  effects: {
    nodeIds: string[];
    edgeIds: string[];
  };
}
```

The MCP server passes `effects.nodeIds` and `effects.edgeIds` to `onGraphMutated()` for embedding updates and renderer sync.

### 2.4 Type Definitions

```typescript
// Entity "type" in the external MCP schema maps to "label" internally.
// Synapse's structural type is always 'entity' for entities created via MCP.

type CreateEntityInput = {
  name: string;
  label: string;          // External-facing. Maps to DbNode.label internally.
  properties?: Record<string, unknown>;
  aliases?: string[];
  tags?: string[];
};

type UpdateEntityInput = {
  entity_id: string;
  name?: string;
  label?: string;         // External-facing. Maps to DbNode.label internally.
  properties?: Record<string, unknown>;
  aliases?: string[];     // Replace semantics. Omit to leave unchanged.
  tags?: string[];        // Replace semantics. Omit to leave unchanged.
};

type CreateRelationshipInput = {
  source_id: string;
  target_id: string;
  label: string;
  type?: string;
};

type UpdateRelationshipInput = {
  relationship_id: string;
  label?: string;
  type?: string;
};

// Analyses available in Phase 1 (strict parity — fully implemented in both modes)
type AnalysisType = 'overview' | 'health' | 'centrality' | 'orphans' | 'paths';
// Deferred to Phase 2 (require complex algorithms or LLM): 'clusters' | 'bridges' | 'connections' | 'gaps'
```

### 2.5 Domain Command Delegation

`DefaultKnowledgeService` calls existing domain commands for mutations — never repositories directly:

| Service method | Delegates to | Why not direct repo |
|---|---|---|
| `createEntity` | `graphCommands.createNode()` | Generates ID, sets defaults, emits events |
| `deleteEntities` | `graphCommands.deleteNode()` | Cleans up edges, notes, provenance, FTS |
| `createNote` | `noteCommands.saveNote()` | Writes .md file, updates FTS, creates wikilink edges |
| `updateNote` | `noteCommands.saveNote()` | Same side effects |
| `mergeEntities` | `graphCommands.mergeNodes()` (or equivalent) | Transfers edges, adds alias, cleans up |

For the standalone CLI, the same domain commands execute — they receive a `CommandContext` built from the standalone adapters (direct SQLite DataStore, filesystem notes).

## 3. Tool Surface (8 Tools — Phase 1)

Phase 1 exposes 8 tools with strict parity across both runtime modes. Skills (`list_skills`, `run_skill`) are deferred to Phase 2.

All tools use snake_case. All write tools return structured mutation effects. Tool schemas use discriminated `oneOf` for action-based tools with per-action required fields.

### 3.1 `search`

```json
{
  "name": "search",
  "description": "Search the knowledge graph for entities, notes, or source content. Returns matching items with relevance scores.",
  "inputSchema": {
    "type": "object",
    "properties": {
      "query": { "type": "string", "description": "Search query. Use empty string to list all items in scope." },
      "scope": {
        "type": "string",
        "enum": ["all", "entities", "notes", "semantic"],
        "description": "Search scope. 'all' searches entities + notes + sources. 'semantic' uses vector embeddings (requires embeddings enabled). Default: 'all'."
      },
      "limit": { "type": "number", "description": "Max results. Default: 10." }
    },
    "required": ["query"]
  },
  "annotations": { "readOnlyHint": true }
}
```

**Authorization:** read capability required. No action variants.

**Semantic scope:** If embeddings are not available (standalone without config), `scope: "semantic"` returns an error message — not an empty result.

### 3.2 `get_entity`

```json
{
  "name": "get_entity",
  "description": "Get complete details for an entity: properties, relationships (with neighbor names), aliases, tags, and source references.",
  "inputSchema": {
    "type": "object",
    "properties": {
      "entity_id": { "type": "string", "description": "Entity ID." }
    },
    "required": ["entity_id"]
  },
  "annotations": { "readOnlyHint": true }
}
```

**Authorization:** read capability required.

Returns full `EntityDetail` including neighbor names resolved via JOIN (not empty strings).

### 3.3 `get_neighbors`

```json
{
  "name": "get_neighbors",
  "description": "Traverse the graph from a starting entity. Returns directly connected entities with relationship labels.",
  "inputSchema": {
    "type": "object",
    "properties": {
      "entity_id": { "type": "string", "description": "Starting entity ID." },
      "depth": { "type": "number", "description": "Traversal depth (1–3). Default: 1." },
      "limit": { "type": "number", "description": "Max nodes to return. Default: 50." }
    },
    "required": ["entity_id"]
  },
  "annotations": { "readOnlyHint": true }
}
```

**Authorization:** read capability required.

**Depth:** Must be implemented correctly for depth > 1 using BFS. Each returned node includes its actual depth from root.

**Validation:** depth clamped to [1, 3], limit clamped to [1, 200].

### 3.4 `manage_entity`

```json
{
  "name": "manage_entity",
  "description": "Create, update, or delete entities. For create: label is the semantic type (person, concept, technology). For update: only specified fields change. Aliases and tags use replace semantics.",
  "inputSchema": {
    "oneOf": [
      {
        "type": "object",
        "properties": {
          "action": { "const": "create" },
          "name": { "type": "string" },
          "label": { "type": "string", "description": "Semantic type (e.g. person, concept, technology)." },
          "properties": { "type": "object" },
          "aliases": { "type": "array", "items": { "type": "string" } },
          "tags": { "type": "array", "items": { "type": "string" } }
        },
        "required": ["action", "name", "label"]
      },
      {
        "type": "object",
        "properties": {
          "action": { "const": "update" },
          "entity_id": { "type": "string" },
          "name": { "type": "string" },
          "label": { "type": "string" },
          "properties": { "type": "object" },
          "aliases": { "type": "array", "items": { "type": "string" } },
          "tags": { "type": "array", "items": { "type": "string" } }
        },
        "required": ["action", "entity_id"]
      },
      {
        "type": "object",
        "properties": {
          "action": { "const": "delete" },
          "entity_ids": { "type": "array", "items": { "type": "string" }, "minItems": 1 }
        },
        "required": ["action", "entity_ids"]
      }
    ]
  },
  "annotations": { "destructiveHint": true }
}
```

**Authorization by action:**
- `create` → write capability
- `update` → write capability
- `delete` → write capability + not blocked by `manage_entity:delete`

**Domain model:** `label` in the external schema maps to `DbNode.label` internally. `DbNode.type` is always set to `'entity'` for MCP-created entities. The external schema does not expose `type` — agents work with entities, not structural node types.

### 3.5 `manage_relationship`

```json
{
  "name": "manage_relationship",
  "description": "Create, update, or delete relationships between entities.",
  "inputSchema": {
    "oneOf": [
      {
        "type": "object",
        "properties": {
          "action": { "const": "create" },
          "source_id": { "type": "string" },
          "target_id": { "type": "string" },
          "label": { "type": "string" },
          "type": { "type": "string" }
        },
        "required": ["action", "source_id", "target_id", "label"]
      },
      {
        "type": "object",
        "properties": {
          "action": { "const": "update" },
          "relationship_id": { "type": "string" },
          "label": { "type": "string" },
          "type": { "type": "string" }
        },
        "required": ["action", "relationship_id"]
      },
      {
        "type": "object",
        "properties": {
          "action": { "const": "delete" },
          "relationship_ids": { "type": "array", "items": { "type": "string" }, "minItems": 1 }
        },
        "required": ["action", "relationship_ids"]
      }
    ]
  },
  "annotations": { "destructiveHint": true }
}
```

**Authorization by action:** all actions require write capability.

### 3.6 `merge_entities`

```json
{
  "name": "merge_entities",
  "description": "Merge two duplicate entities. Keeps the primary, transfers all relationships from the secondary, adds the secondary's name as an alias, then deletes the secondary. Runs in a transaction.",
  "inputSchema": {
    "type": "object",
    "properties": {
      "primary_id": { "type": "string", "description": "Entity to KEEP." },
      "secondary_id": { "type": "string", "description": "Entity to merge into primary and DELETE." }
    },
    "required": ["primary_id", "secondary_id"]
  },
  "annotations": { "destructiveHint": true }
}
```

**Authorization:** write capability required.

**Atomicity:** Runs in a `BEGIN IMMEDIATE` transaction. On failure, all changes roll back.

### 3.7 `manage_note`

```json
{
  "name": "manage_note",
  "description": "Read, create, or update markdown notes.",
  "inputSchema": {
    "oneOf": [
      {
        "type": "object",
        "properties": {
          "action": { "const": "read" },
          "note_id": { "type": "string" }
        },
        "required": ["action", "note_id"]
      },
      {
        "type": "object",
        "properties": {
          "action": { "const": "create" },
          "title": { "type": "string" },
          "content": { "type": "string" }
        },
        "required": ["action", "title", "content"]
      },
      {
        "type": "object",
        "properties": {
          "action": { "const": "update" },
          "note_id": { "type": "string" },
          "title": { "type": "string" },
          "content": { "type": "string" }
        },
        "required": ["action", "note_id"]
      }
    ]
  }
}
```

**Authorization by action:**
- `read` → read capability
- `create`, `update` → write capability

**Domain commands:** create/update delegate to `noteCommands.saveNote()` which handles markdown file generation, FTS indexing, and wikilink edge creation.

### 3.8 `analyze_graph`

```json
{
  "name": "analyze_graph",
  "description": "Run graph intelligence analyses. Phase 1 supports: overview (counts + types), health (density, orphan rate), centrality (most-connected nodes), orphans (unconnected nodes), paths (shortest path between two entities).",
  "inputSchema": {
    "type": "object",
    "properties": {
      "analysis": {
        "type": "string",
        "enum": ["overview", "health", "centrality", "orphans", "paths"],
        "description": "Type of analysis."
      },
      "options": {
        "type": "object",
        "description": "Analysis-specific options. centrality: { limit, node_type }. orphans: { limit, node_type }. paths: { source_id, target_id, max_hops }."
      }
    },
    "required": ["analysis"]
  },
  "annotations": { "readOnlyHint": true }
}
```

**Authorization:** read capability required.

**Strict parity:** Only `overview`, `health`, `centrality`, `orphans`, `paths` are exposed in Phase 1 — these are fully implementable with SQL in both modes. `clusters`, `bridges`, `connections`, `gaps` require complex algorithms or LLM access and are deferred to Phase 2.

**Validation:** `paths` requires `options.source_id` and `options.target_id`. Runtime validation returns a descriptive error if missing. All SQL uses parameterized queries (no string interpolation).

## 4. Authorization and Profiles

### 4.1 Profile Schema

```json
{
  "profiles": {
    "readonly": {
      "capabilities": ["read"],
      "blocked_tools": [],
      "blocked_actions": []
    },
    "editor": {
      "capabilities": ["read", "write"],
      "blocked_tools": [],
      "blocked_actions": ["manage_entity:delete"]
    },
    "full": {
      "capabilities": ["read", "write"],
      "blocked_tools": [],
      "blocked_actions": []
    }
  },
  "connections": {
    "claude-code": "full",
    "codex": "editor",
    "default": "readonly"
  }
}
```

### 4.2 Action-Level Policy

Each tool+action combination has a required capability:

| Tool | Action | Required Capability |
|------|--------|-------------------|
| `search` | — | read |
| `get_entity` | — | read |
| `get_neighbors` | — | read |
| `manage_entity` | create | write |
| `manage_entity` | update | write |
| `manage_entity` | delete | write |
| `manage_relationship` | create | write |
| `manage_relationship` | update | write |
| `manage_relationship` | delete | write |
| `merge_entities` | — | write |
| `manage_note` | read | read |
| `manage_note` | create | write |
| `manage_note` | update | write |
| `analyze_graph` | — | read |

### 4.3 Policy Enforcement Points

1. **Tool listing** (`tools/list`): Filter tool list by profile capabilities. For action-based tools, include the tool if the profile allows ANY action on it (e.g., `manage_note` is listed for readonly profiles because `read` action is allowed).

2. **Tool execution** (`tools/call`): Before dispatching, check that the profile allows the specific `{tool, action}`. Also check `blocked_tools` and `blocked_actions`.

3. **Dynamic reload**: Config is re-read per request (stateless server model). Profile changes take effect on the next request.

### 4.4 Profile Selection

| Transport | Mechanism |
|-----------|-----------|
| HTTP | `X-Synapse-Profile` header. Falls back to `connections[client-name]` or `connections.default`. |
| stdio (CLI) | `--profile <name>` flag. `--allow-write` maps to `full`. Default: `readonly`. |

## 5. MCP Resources (Phase 2)

Resources provide browsable, navigable access to graph data. Clients that support resources (Claude Desktop, Claude.ai) get a richer experience. Clients that don't (Claude Code, Codex) use tools instead — no capability gap.

### 5.1 Resource URIs

| URI Pattern | Content | Type |
|---|---|---|
| `synapse://entities` | Paginated list of all entities | Entity summaries |
| `synapse://entities/{id}` | Full entity detail (properties, edges, aliases, tags, sources) | JSON |
| `synapse://notes` | Paginated list of all notes | Note summaries |
| `synapse://notes/{id}` | Note markdown content | text/markdown |
| `synapse://graph/overview` | Graph stats, type distribution, health metrics | JSON |
| `synapse://skills` | Available skills | Skill summaries |
| `synapse://skills/{name}` | Full skill definition | text/markdown |
| `synapse://files` | Vault file tree | Directory listing |
| `synapse://files/{path}` | File content | Depends on file type |

### 5.2 Resource Subscriptions

Clients can subscribe to resources and receive notifications when they change. Backed by `MutationResult.effects` from tool execution.

### 5.3 Resource Links in Tool Responses

Tool results include `resource_link` items so agents can navigate from search results to full entity details.

## 6. MCP Prompts / Skills (Phase 2)

Skills stored in `.synapse/skills/*.md` are exposed through all three MCP channels for maximum client compatibility: MCP Prompts, MCP Resources, and MCP Tools (`list_skills`, `run_skill`).

### 6.1 Skill File Format

```yaml
# .synapse/skills/research-analyst.md
---
name: research-analyst
description: Deep research across the knowledge graph with source synthesis
type: prompt
arguments:
  - name: topic
    description: What to research
    required: true
---

You are researching {{topic}} in a personal knowledge graph.
1. Search for entities related to {{topic}} using the search tool
2. For the top 5 results, explore neighbors
3. Identify gaps — what related concepts are missing?
4. Synthesize a report with entity citations
```

### 6.2 Skill Storage

| Location | Scope | Priority |
|---|---|---|
| `.synapse/skills/*.md` | Vault-scoped | Highest |
| `~/Library/Application Support/kg-extension/skills/*.md` | Global | Lower |
| Built-in defaults | System | Lowest |

## 7. Built-In Chat Agent Dogfooding (Phase 3)

The built-in chat agent is refactored to consume the same MCP interface as external agents via an in-process MCP client adapter.

## 8. Shared Implementation Structure

### 8.1 File Structure

```
src/
  mcp/
    types.ts                       # Shared types (SearchResult, EntityDetail, etc.)
    knowledge-service.ts           # KnowledgeService interface + KnowledgeDeps
    knowledge-service-impl.ts      # DefaultKnowledgeService (ONE implementation)
    tools/
      types.ts                     # McpToolDefinition, McpToolName, WRITE_TOOLS
      definitions.ts               # 8 tool schemas (single source of truth)
      handlers.ts                  # Tool dispatch: validate → authorize → service call
      validation.ts                # Runtime input validation per tool+action
    authorization.ts               # Profile loading, {tool,action} policy checks
    server.ts                      # Shared MCP server factory (registers tools)
    adapters/
      electron.ts                  # Electron-specific adapters (IPC DataStore, etc.)
      standalone.ts                # Standalone-specific adapters (SQLite, filesystem)
```

### 8.2 Parameter Naming Convention

All parameters use **snake_case** consistently. External `label` maps to internal `DbNode.label`. `DbNode.type` is always `'entity'` for MCP-created entities.

### 8.3 Standalone Multi-Vault

The standalone CLI supports multiple vaults. Vault management tools (`list_vaults`, `open_vault`, `close_vault`) remain CLI-specific, implemented as a thin layer that creates a per-vault `DefaultKnowledgeService`. Each vault's service receives its own adapters (its own SQLite connection, its own filesystem note adapter).

## 9. Migration Path

Each phase is a self-contained implementation cycle. Phase 1 is the foundation.

### Phase 1: Shared Core (8 tools, strict parity)

1. Define `KnowledgeDeps`, `KnowledgeService` interface, shared types
2. Implement `DefaultKnowledgeService` using domain commands
3. Create Electron adapters and standalone adapters
4. Create shared tool definitions (8 tools, snake_case, discriminated `oneOf` schemas)
5. Implement validation + authorization + tool handler dispatch
6. Create shared MCP server factory
7. Wire into Electron main process (replace `BuiltinToolProvider`)
8. Wire into standalone CLI (replace inline tool definitions)
9. Integration tests: full CRUD cycle, authorization, both adapter sets

### Phase 2: Resources + Prompts + Skills

1. Implement resource handlers (entities, notes, graph overview, files)
2. Implement resource templates and subscriptions
3. Implement skill loader (`.synapse/skills/*.md` parser)
4. Implement MCP prompts handler
5. Add `list_skills` + `run_skill` tools (now 10 tools)
6. Add resource links to tool responses
7. Add remaining analyses (clusters, bridges, connections, gaps)
8. Ship default skills

### Phase 3: Dogfood Chat Agent

1. Implement `InProcessMcpClient`
2. Refactor chat agent to use MCP interface
3. Migrate agent definitions to skills
4. Remove legacy tool executor

### Phase 4: Polish

1. Config hot-reload (file watch on `.synapse/mcp-server.json` and skills)
2. MCPB bundle for standalone CLI distribution
3. MCP Apps exploration (graph visualization widgets)
4. Settings UI for profile management

## 10. Client Compatibility Matrix

| Feature | Claude Desktop | Claude Code | Codex | Cursor |
|---|---|---|---|---|
| 8 tools (Phase 1) | Yes | Yes | Yes | Yes |
| Resources (Phase 2) | Yes | No | No | No |
| Prompts (Phase 2) | Yes | No | No | No |
| Skills via tools (Phase 2) | Yes | Yes | Yes | Yes |
| Resource links | Yes (navigable) | Ignored | Ignored | Ignored |
| Subscriptions (Phase 2) | Yes | No | No | No |
| Full capability | Yes | Yes (via tools) | Yes (via tools) | Yes (via tools) |

No client loses functionality. Claude Desktop gets the richest experience. All clients can discover and use skills through tools (Phase 2).
