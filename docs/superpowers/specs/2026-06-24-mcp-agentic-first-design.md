# MCP Agentic-First Redesign

Redesign the MCP layer so Synapse is a knowledge graph platform that any agent can interact with. External agents (Claude Desktop, Claude Code, Codex, Cursor, custom) are first-class citizens. The built-in chat agent is just another MCP client — not special.

## Design Constraints

1. **Shared core, two transports** — one tool/resource/prompt implementation, stdio + HTTP Streamable
2. **Resources + Prompts** — graph entities, notes, files as browsable MCP resources; skill templates as MCP prompts
3. **Dogfood** — built-in chat agent consumes the same MCP interface as external agents
4. **Agent-as-MCP-client** — the built-in chat is one option, not privileged
5. **Swappable composition** — clean layer boundaries so components can be replaced
6. **10-tool surface** — consolidated from 30+ to stay within the 5–15 best-practice range

## 1. Layer Architecture

```
┌──────────────────────────────────────────────────────┐
│  Agent Layer (not our code — pluggable)               │
│  Claude Desktop · Claude Code · Codex · Custom        │
└──────────────┬───────────────────────────────────────┘
               │ MCP Protocol (stdio / HTTP Streamable)
┌──────────────┴───────────────────────────────────────┐
│  MCP Server Layer                                     │
│  10 Tools · Resources · Prompts · Subscriptions       │
│  Shared implementation, two transport adapters         │
└──────────────┬───────────────────────────────────────┘
               │ KnowledgeService interface
┌──────────────┴───────────────────────────────────────┐
│  Knowledge Core                                       │
│  Graph DB · Notes · Files · Embeddings · Skills       │
│  Two backends: Electron (IPC) / Standalone (SQLite)   │
└──────────────────────────────────────────────────────┘
```

**Three layers, clean boundaries:**

1. **Knowledge Core** — data operations with no MCP awareness. Exposes a `KnowledgeService` interface. Two implementations: `ElectronKnowledgeService` (delegates to main process via IPC, has embeddings, file watcher, event bus) and `StandaloneKnowledgeService` (direct SQLite, optional embeddings).

2. **MCP Server Layer** — adapts `KnowledgeService` to MCP protocol. Single server implementation shared by both transports. Registers tools, resources, prompts, and subscription handlers.

3. **Agent Layer** — any MCP client. Not our code. The built-in chat agent is just another MCP client that connects in-process.

**Two runtime modes:**

| Mode | Transport | Backend | When |
|------|-----------|---------|------|
| **Desktop** | HTTP Streamable on `:19876/mcp` | `ElectronKnowledgeService` (IPC) | App running |
| **Headless** | stdio | `StandaloneKnowledgeService` (SQLite) | CLI, no app |

## 2. KnowledgeService Interface

The contract between the MCP server and the data layer. Both backends implement it identically.

```typescript
interface KnowledgeService {
  // --- Search ---
  search(params: { query: string; scope?: 'all' | 'entities' | 'notes' | 'semantic'; limit?: number }): Promise<SearchResult[]>;

  // --- Entities ---
  getEntity(id: string): Promise<EntityDetail | null>;
  getNeighbors(params: { entity_id: string; depth?: number; limit?: number }): Promise<NeighborResult>;
  manageEntity(params: ManageEntityInput): Promise<EntityResult>;
  mergeEntities(params: { primary_id: string; secondary_id: string }): Promise<MergeResult>;

  // --- Relationships ---
  manageRelationship(params: ManageRelationshipInput): Promise<RelationshipResult>;

  // --- Notes ---
  manageNote(params: ManageNoteInput): Promise<NoteResult>;

  // --- Analysis ---
  analyzeGraph(params: { analysis: AnalysisType; options?: Record<string, unknown> }): Promise<AnalysisResult>;

  // --- Skills ---
  listSkills(): Promise<SkillSummary[]>;
  runSkill(params: { name: string; arguments?: Record<string, unknown> }): Promise<SkillResult>;

  // --- Resources (data access) ---
  listEntities(params?: { cursor?: string; limit?: number }): Promise<PaginatedList<EntitySummary>>;
  listNotes(params?: { cursor?: string; limit?: number }): Promise<PaginatedList<NoteSummary>>;
  listFiles(params?: { path?: string }): Promise<FileEntry[]>;
  getGraphOverview(): Promise<GraphOverview>;
  readNote(id: string): Promise<string>;

  // --- Subscriptions ---
  onGraphChanged(cb: (event: GraphChangeEvent) => void): () => void;
}
```

**Type definitions:**

```typescript
type ManageEntityInput =
  | { action: 'create'; name: string; type: string; label?: string; properties?: Record<string, unknown> }
  | { action: 'update'; entity_id: string; name?: string; type?: string; label?: string; properties?: Record<string, unknown>; aliases?: string[]; tags?: string[] }
  | { action: 'delete'; entity_ids: string[] };

type ManageRelationshipInput =
  | { action: 'create'; source_id: string; target_id: string; label: string; type?: string }
  | { action: 'update'; relationship_id: string; label?: string; type?: string }
  | { action: 'delete'; relationship_ids: string[] };

type ManageNoteInput =
  | { action: 'read'; note_id: string }
  | { action: 'create'; title: string; content: string }
  | { action: 'update'; note_id: string; title?: string; content?: string };

type AnalysisType = 'overview' | 'health' | 'clusters' | 'centrality' | 'orphans' | 'bridges' | 'paths' | 'connections' | 'gaps';
```

**Two implementations:**

| | `ElectronKnowledgeService` | `StandaloneKnowledgeService` |
|---|---|---|
| **DB access** | IPC to main process (`db:request`) | Direct `better-sqlite3` |
| **Embeddings** | Via main process embedding service | Optional (ONNX/OpenAI if configured) |
| **File access** | Via vault context + file watcher | Direct filesystem |
| **Skills** | Reads `.synapse/skills/` via vault context | Reads `.synapse/skills/` directly |
| **Subscriptions** | IPC `db:sync` events | Not supported (single-process) |
| **Notifications** | Broadcasts to renderer windows | Calls `notifyApp()` HTTP POST |

## 3. Tool Surface (10 Tools)

All tools use snake_case parameter naming. All return structured JSON with optional `resource_link` items for navigation.

### 3.1 `search`

Unified entry point to the graph.

```json
{
  "name": "search",
  "description": "Search the knowledge graph for entities, notes, or source content. Returns matching items with relevance scores and resource links for deeper exploration.",
  "inputSchema": {
    "type": "object",
    "properties": {
      "query": { "type": "string", "description": "Search query." },
      "scope": {
        "type": "string",
        "enum": ["all", "entities", "notes", "semantic"],
        "default": "all",
        "description": "Search scope. 'all' searches entities + notes + sources. 'semantic' uses vector embeddings for conceptual similarity."
      },
      "limit": { "type": "number", "default": 10, "description": "Max results." }
    },
    "required": ["query"]
  },
  "annotations": { "readOnlyHint": true }
}
```

Replaces: `search_knowledge`, `search_nodes`, `search_notes`, `search_sources`, `semantic_search`, `find_similar_entities`.

### 3.2 `get_entity`

Full entity detail in one call.

```json
{
  "name": "get_entity",
  "description": "Get complete details for an entity: properties, relationships, aliases, tags, and source references. Use the returned resource links to explore connected entities.",
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

Returns: name, type, label, properties, edges (with neighbor names), aliases, tags, source URLs. Includes `resource_link` items for each connected entity (`synapse://entities/{id}`).

Replaces: `get_node_details`, `get_aliases`, `get_node_tags`, `get_edges_for_node`, `get_nodes_batch`.

### 3.3 `get_neighbors`

Graph traversal.

```json
{
  "name": "get_neighbors",
  "description": "Traverse the graph from a starting entity. Returns connected entities up to the specified depth with relationship labels.",
  "inputSchema": {
    "type": "object",
    "properties": {
      "entity_id": { "type": "string", "description": "Starting entity ID." },
      "depth": { "type": "number", "default": 1, "description": "Traversal depth (max 3)." },
      "limit": { "type": "number", "default": 50, "description": "Max nodes to return." }
    },
    "required": ["entity_id"]
  },
  "annotations": { "readOnlyHint": true }
}
```

Replaces: `get_neighbors`, `get_subgraph`, `get_edges_between`.

### 3.4 `manage_entity`

All entity mutations.

```json
{
  "name": "manage_entity",
  "description": "Create, update, or delete entities in the knowledge graph. For updates, only specified fields are changed. Aliases and tags use replace semantics — send the full desired list, or omit to leave unchanged.",
  "inputSchema": {
    "type": "object",
    "properties": {
      "action": { "type": "string", "enum": ["create", "update", "delete"] },
      "entity_id": { "type": "string", "description": "Required for update/delete." },
      "entity_ids": { "type": "array", "items": { "type": "string" }, "description": "For batch delete." },
      "name": { "type": "string" },
      "type": { "type": "string", "description": "Entity type (e.g. person, concept, technology)." },
      "label": { "type": "string", "description": "Semantic label." },
      "properties": { "type": "object", "description": "Key-value properties to set." },
      "aliases": { "type": "array", "items": { "type": "string" }, "description": "Full replacement list of alternate names. Omit to leave unchanged." },
      "tags": { "type": "array", "items": { "type": "string" }, "description": "Full replacement list of tags. Omit to leave unchanged." }
    },
    "required": ["action"]
  },
  "annotations": { "readOnlyHint": false, "destructiveHint": true }
}
```

Replaces: `create_node`, `update_node`, `delete_node`, `delete_nodes_batch`, `add_alias`, `tag_node`.

### 3.5 `manage_relationship`

All relationship mutations.

```json
{
  "name": "manage_relationship",
  "description": "Create, update, or delete relationships between entities.",
  "inputSchema": {
    "type": "object",
    "properties": {
      "action": { "type": "string", "enum": ["create", "update", "delete"] },
      "relationship_id": { "type": "string", "description": "Required for update/delete." },
      "relationship_ids": { "type": "array", "items": { "type": "string" }, "description": "For batch delete." },
      "source_id": { "type": "string", "description": "Source entity ID (for create)." },
      "target_id": { "type": "string", "description": "Target entity ID (for create)." },
      "label": { "type": "string", "description": "Relationship label (e.g. works_at, related_to)." },
      "type": { "type": "string", "description": "Relationship category." }
    },
    "required": ["action"]
  },
  "annotations": { "readOnlyHint": false, "destructiveHint": true }
}
```

Replaces: `create_edge`, `update_edge`, `delete_edge`.

### 3.6 `merge_entities`

Deduplicate entities.

```json
{
  "name": "merge_entities",
  "description": "Merge two duplicate entities. Keeps the primary entity, transfers all relationships from the secondary, adds the secondary's name as an alias, then deletes the secondary.",
  "inputSchema": {
    "type": "object",
    "properties": {
      "primary_id": { "type": "string", "description": "Entity to KEEP." },
      "secondary_id": { "type": "string", "description": "Entity to merge into primary and DELETE." }
    },
    "required": ["primary_id", "secondary_id"]
  },
  "annotations": { "readOnlyHint": false, "destructiveHint": true }
}
```

### 3.7 `manage_note`

Note CRUD.

```json
{
  "name": "manage_note",
  "description": "Read, create, or update markdown notes in the knowledge graph.",
  "inputSchema": {
    "type": "object",
    "properties": {
      "action": { "type": "string", "enum": ["read", "create", "update"] },
      "note_id": { "type": "string", "description": "Required for read/update." },
      "title": { "type": "string", "description": "Note title (for create/update)." },
      "content": { "type": "string", "description": "Markdown content (for create/update)." }
    },
    "required": ["action"]
  },
  "annotations": { "readOnlyHint": false }
}
```

Replaces: `read_note`, `create_note`, `update_note`, `list_notes`, `search_notes`. Listing notes: use `search({ query: "", scope: "notes" })` which returns all notes when query is empty. Searching notes: use `search({ query: "...", scope: "notes" })`. Clients with resource support can also browse `synapse://notes`.

### 3.8 `analyze_graph`

All intelligence operations behind one tool with a type parameter.

```json
{
  "name": "analyze_graph",
  "description": "Run graph intelligence analyses. Returns structured results based on the analysis type.",
  "inputSchema": {
    "type": "object",
    "properties": {
      "analysis": {
        "type": "string",
        "enum": ["overview", "health", "clusters", "centrality", "orphans", "bridges", "paths", "connections", "gaps"],
        "description": "Type of analysis to run."
      },
      "options": {
        "type": "object",
        "description": "Analysis-specific options. paths: { source_id, target_id, max_hops }. clusters: { min_size }. centrality: { limit, node_type }. connections: { limit, min_shared }."
      }
    },
    "required": ["analysis"]
  },
  "annotations": { "readOnlyHint": true }
}
```

Replaces: `get_graph_overview`, `get_graph_health`, `get_clusters`, `get_centrality_ranking`, `get_orphan_nodes`, `get_bridge_nodes`, `get_connection_suggestions`, `find_shortest_path`, `get_nodes_by_type`.

### 3.9 `list_skills`

Skill discovery.

```json
{
  "name": "list_skills",
  "description": "List available knowledge workflow skills. Skills are reusable templates that guide multi-step graph operations.",
  "inputSchema": {
    "type": "object",
    "properties": {},
    "required": []
  },
  "annotations": { "readOnlyHint": true }
}
```

Returns: `[{ name, description, type, arguments }]` for each `.synapse/skills/*.md` file.

### 3.10 `run_skill`

Invoke a skill — loads instructions or executes a workflow.

```json
{
  "name": "run_skill",
  "description": "Invoke a knowledge workflow skill. For prompt-type skills, returns rendered instructions the agent should follow using available tools. For workflow-type skills, executes the steps server-side and returns the result.",
  "inputSchema": {
    "type": "object",
    "properties": {
      "name": { "type": "string", "description": "Skill name." },
      "arguments": { "type": "object", "description": "Skill arguments (key-value)." }
    },
    "required": ["name"]
  }
}
```

The verb `run` covers both behaviors: "run through these instructions" (prompt) and "run this workflow" (workflow).

## 4. MCP Resources

Resources provide browsable, navigable access to graph data. Clients that support resources (Claude Desktop, Claude.ai) get a richer experience. Clients that don't (Claude Code, Codex) use tools instead — no capability gap.

### 4.1 Resource URIs

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

### 4.2 Resource Templates

URI templates enable agents to construct URIs for specific resources:

```json
[
  { "uriTemplate": "synapse://entities/{id}", "name": "Entity by ID", "description": "Full entity details" },
  { "uriTemplate": "synapse://notes/{id}", "name": "Note by ID", "description": "Note markdown content" },
  { "uriTemplate": "synapse://skills/{name}", "name": "Skill by name", "description": "Skill definition" },
  { "uriTemplate": "synapse://files/{path}", "name": "File by path", "description": "Vault file content" }
]
```

### 4.3 Resource Subscriptions

Clients can subscribe to resources and receive notifications when they change:

- `synapse://entities/{id}` — notifies when entity is updated, merged, or deleted
- `synapse://graph/overview` — notifies when graph stats change (node/edge count)

Backed by the existing `onGraphChanged` event system in `KnowledgeService`.

### 4.4 Resource Links in Tool Responses

Tool results include `resource_link` items so agents can navigate from search results to full entity details:

```json
{
  "content": [
    { "type": "text", "text": "{\"results\": [{\"id\": \"abc\", \"name\": \"Quantum Computing\", \"type\": \"concept\"}]}" }
  ],
  "_meta": {
    "resource_links": [
      { "uri": "synapse://entities/abc", "name": "Quantum Computing" }
    ]
  }
}
```

## 5. MCP Prompts (Skills)

Skills stored in `.synapse/skills/*.md` are exposed through all three MCP channels for maximum client compatibility.

### 5.1 Skill File Format

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
  - name: depth
    description: How many hops to explore from initial matches
    default: 2
---

You are researching {{topic}} in a personal knowledge graph.

1. Search for entities related to {{topic}} using the search tool
2. For the top 5 results, explore neighbors up to {{depth}} hops deep
3. Look for patterns: what clusters together? what's isolated?
4. Identify gaps — what related concepts are missing from the graph?
5. Synthesize a report with entity citations
```

```yaml
# .synapse/skills/weekly-digest.md
---
name: weekly-digest
description: Generate a weekly knowledge graph activity digest
type: workflow
arguments:
  - name: period_days
    description: How many days to look back
    default: 7
steps:
  - analyze_graph: { analysis: "overview" }
  - search: { query: "", scope: "entities", sort: "recent", limit: 20 }
  - analyze_graph: { analysis: "clusters", options: { min_size: 3 } }
---

Summarize recent graph activity: new entities, new connections,
emerging clusters. Format as a concise digest.
```

### 5.2 Skill Storage Locations

| Location | Scope | Priority |
|---|---|---|
| `.synapse/skills/*.md` | Vault-scoped | Highest (overrides global) |
| `~/Library/Application Support/kg-extension/skills/*.md` | Global | Lower |
| Built-in defaults (bundled with app) | System | Lowest |

### 5.3 Multi-Channel Exposure

Each skill is exposed through all three MCP primitives simultaneously:

| Channel | Who sees it | How it works |
|---|---|---|
| **MCP Prompt** | Claude Desktop, Claude.ai, Goose | Appears as slash command (e.g. `/research-analyst`). `prompts/get` returns rendered instructions as `PromptMessage` array. |
| **MCP Resource** | Clients with resource support | Browsable at `synapse://skills/{name}`. Agent reads the definition. |
| **MCP Tool** | Every client (universal) | `list_skills()` discovers available skills. `run_skill({ name, arguments })` returns rendered instructions or executes workflow. |

### 5.4 Prompt-Type vs Workflow-Type

| | Prompt | Workflow |
|---|---|---|
| **Execution** | Agent-side. Instructions returned; agent follows them using available tools. | Server-side. Synapse runs the defined steps, returns the result. |
| **MCP Prompt** | Returns instructions as messages | Returns description + triggers via `run_skill` tool |
| **MCP Tool** | `run_skill` returns instructions | `run_skill` executes and returns result |
| **Best for** | Flexible exploration where agent judgment matters | Deterministic multi-step operations, works with any agent |

## 6. Built-In Chat Agent (Dogfooding)

The built-in chat agent is refactored to be an MCP client of Synapse's own server. It uses the same tools, resources, and prompts as any external agent.

### 6.1 In-Process MCP Client

The built-in chat agent connects to `KnowledgeService` through an in-process MCP client adapter — not over the network. This gives identical semantics to external MCP clients without serialization/transport overhead.

```
Built-in Chat Agent
  └─ InProcessMcpClient
       └─ calls KnowledgeService methods directly
            (same methods the MCP server adapter calls)
```

The `InProcessMcpClient` implements the same `tools/call`, `resources/read`, `prompts/get` interface that external clients see, but resolves them by calling `KnowledgeService` directly instead of going through JSON-RPC.

### 6.2 What Changes for the Chat Agent

| Before | After |
|---|---|
| Imports `CommandContext` directly | Uses `InProcessMcpClient` |
| 30+ tool definitions in `chat-agent-tools.ts` | Discovers tools via `tools/list` from MCP server |
| Direct DB queries for context | Reads resources (`synapse://entities/{id}`) |
| Agent definitions are chat-only | Skills are MCP prompts, accessible by all agents |
| Tool execution via `executeTool()` | Tool execution via `tools/call` |

### 6.3 System Prompt Assembly

The chat agent's system prompt is assembled from:

1. Base instructions (how to use tools, citation rules) — shipped with the app
2. Active skill/prompt instructions — loaded via `prompts/get` if a skill is active
3. Memory context — loaded via resources (`synapse://memory/`) or a dedicated retrieval path
4. Global user instructions — from app settings

The agent's personality, tool strategy, and behavior are all configurable through skills — the same skills external agents can access.

## 7. Shared Tool Definitions

Single source of truth for all tool schemas, used by both the MCP server and the standalone CLI.

### 7.1 File Structure

```
src/
  mcp/
    knowledge-service.ts       # KnowledgeService interface
    tools/
      definitions.ts           # All 10 tool schemas (single source of truth)
      search.ts                # search tool implementation
      entity.ts                # get_entity, manage_entity, merge_entities
      relationship.ts          # manage_relationship
      note.ts                  # manage_note
      analysis.ts              # analyze_graph
      skills.ts                # list_skills, run_skill
    resources/
      definitions.ts           # Resource URI schemas and templates
      entities.ts              # Entity resource handlers
      notes.ts                 # Note resource handlers
      graph.ts                 # Graph overview resource
      skills.ts                # Skill resource handlers
      files.ts                 # File resource handlers
    prompts/
      loader.ts                # Reads .synapse/skills/*.md, parses frontmatter
      handler.ts               # MCP prompts/list and prompts/get handlers
    server.ts                  # MCP server setup (registers tools, resources, prompts)
    transports/
      http.ts                  # HTTP Streamable transport adapter
      stdio.ts                 # stdio transport adapter
    backends/
      electron-backend.ts      # ElectronKnowledgeService (IPC)
      standalone-backend.ts    # StandaloneKnowledgeService (SQLite)
    client/
      in-process-client.ts     # InProcessMcpClient for built-in chat
```

### 7.2 Parameter Naming Convention

All parameters use **snake_case** consistently across all tools, resources, and both transports. No more camelCase/snake_case split.

### 7.3 Migration from Current Tools

The existing `chat-agent-tools.ts` and `chat-tool-executor.ts` are replaced by the new tool definitions and `KnowledgeService` implementations. The standalone CLI (`packages/synapse-mcp/`) is replaced by a thin wrapper that instantiates `StandaloneKnowledgeService` and starts a stdio MCP server using the shared server implementation.

## 8. Configuration

### 8.1 MCP Server Config

Location: `.synapse/mcp-server.json`

```json
{
  "enabled": true,
  "profiles": {
    "default": {
      "capabilities": ["read"],
      "blocked_tools": []
    },
    "editor": {
      "capabilities": ["read", "write"],
      "blocked_tools": ["manage_entity:delete"]
    },
    "full": {
      "capabilities": ["read", "write"],
      "blocked_tools": []
    }
  },
  "http": {
    "port": 19876,
    "path": "/mcp"
  }
}
```

**Changes from current:**
- Port and path are now respected (no longer hardcoded)
- Profile selection via `X-Synapse-Profile` request header (HTTP transport only). Default profile used when header is absent. Stdio transport always uses the profile mapped from `--allow-write` flag (`full` if set, `default` otherwise).
- Profiles can block specific tool actions (e.g. `manage_entity:delete`)

### 8.2 MCP Client Config (Unchanged)

The existing MCP client config for connecting to external servers remains the same. Global + vault-scoped config with secrets resolution.

### 8.3 Standalone CLI Config

```bash
synapse-mcp [--vault <path>]... [--allow-write] [--init]
```

No changes to CLI flags. The `--allow-write` flag maps to the `full` profile internally.

## 9. Subscriptions and Notifications

### 9.1 Resource Change Notifications

When the graph changes (via any tool call or external mutation), the MCP server sends `notifications/resources/updated` for affected resources:

- Entity created/updated/deleted → `synapse://entities/{id}` updated
- Edge created/deleted → affected entity resources updated
- Note created/updated → `synapse://notes/{id}` updated
- Any graph mutation → `synapse://graph/overview` updated

### 9.2 Tool List Change Notifications

When skills are added/removed/modified in `.synapse/skills/`, the server sends `notifications/tools/list_changed` and `notifications/prompts/list_changed` so connected agents re-discover the available surface.

### 9.3 Desktop App UI Sync

The existing `db:sync` mechanism continues to work for updating the renderer. The `onGraphChanged` callback in `KnowledgeService` fires for all mutations regardless of source (MCP tool, built-in chat, file watcher).

## 10. Migration Path

Each phase is a self-contained implementation cycle (plan → implement → ship). Do not start the next phase until the current one is complete and verified. Phase 1 is the foundation; phases 2–4 can be reordered based on priority.

### Phase 1: Shared Core

1. Define `KnowledgeService` interface
2. Implement `ElectronKnowledgeService` wrapping existing `CommandContext` + `DataStore`
3. Implement `StandaloneKnowledgeService` wrapping existing `StandaloneGraphProvider`
4. Create shared tool definitions (10 tools, snake_case)
5. Wire MCP server to use `KnowledgeService` instead of `BuiltinToolProvider`
6. Wire standalone CLI to use shared server implementation
7. Verify both transports work with same tool surface

### Phase 2: Resources + Prompts

1. Implement resource handlers (entities, notes, graph overview, files)
2. Implement resource templates and subscriptions
3. Implement skill loader (`.synapse/skills/*.md` parser)
4. Implement MCP prompts handler
5. Add resource links to tool responses
6. Ship default skills (research-analyst, weekly-digest, find-gaps)

### Phase 3: Dogfood Chat Agent

1. Implement `InProcessMcpClient`
2. Refactor chat agent to use `InProcessMcpClient` instead of `CommandContext`
3. Migrate agent definitions to skills format
4. Update system prompt assembly to use MCP prompts
5. Remove legacy `chat-agent-tools.ts` and `chat-tool-executor.ts`

### Phase 4: Polish

1. Config hot-reload (watch `.synapse/mcp-server.json` and skills directory)
2. Profile selection mechanism for HTTP transport
3. MCPB bundle for standalone CLI distribution
4. MCP Apps exploration (graph visualization widgets)

## 11. Client Compatibility Matrix

What each client experiences with the redesigned MCP server:

| Feature | Claude Desktop | Claude Code | Codex | Cursor |
|---|---|---|---|---|
| 10 tools | Yes | Yes | Yes | Yes |
| Resources (browse graph) | Yes | No | No | No |
| Prompts (skills as slash commands) | Yes | No | No | No |
| Skills via tools (`list_skills`/`run_skill`) | Yes | Yes | Yes | Yes |
| Resource links in tool results | Yes (navigable) | Ignored | Ignored | Ignored |
| Subscriptions | Yes | No | No | No |
| Full capability | Yes | Yes (via tools) | Yes (via tools) | Yes (via tools) |

No client loses functionality. Claude Desktop gets the richest experience. All clients can discover and use skills through tools.
