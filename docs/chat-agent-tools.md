# Chat Agent Tools

Tools defined in two layers: core tools in `src/shared/chat-agent-tools.ts` and extended tools in `src/commands/tools/` (modular architecture — each group is an independent module). Combined via `ALL_CHAT_AGENT_TOOLS`. Executed via ToolRegistry (`electron/mcp/builtin-tool-provider.ts` → `src/commands/chat-tool-executor.ts`).

## Core Tools

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

## Extended Tools (`src/commands/tools/`)

| Module | Tools | Category |
|---|---|---|
| `note-tools.ts` | `read_note`, `create_note`, `update_note`, `list_notes`, `search_notes` | read/write |
| `edge-tools.ts` | `update_edge`, `delete_edge`, `get_edges_between` | read/write |
| `graph-tools.ts` | `get_graph_overview`, `get_subgraph`, `get_nodes_by_type` | read |
| `entity-tools.ts` | `find_similar_entities`, `add_alias`, `get_aliases`, `tag_node`, `get_node_tags` | read/write |

## Tool Module Pattern

Each module exports `definitions` (tool schemas) + `execute(ctx, name, input)` returning `null` for unhandled tools. Combined in `src/commands/tools/index.ts`. The main executor delegates to `executeExtendedTool()` as a fallback. Adding/removing a module is a one-line import change.

## Execution Flow

Renderer → `tools:execute` IPC → ToolRegistry → BuiltinToolProvider → `executeTool()` in `chat-tool-executor.ts` → extended tools fallback. The executor uses `CommandContext` (with `ctx.embedding` for semantic search) and has no `@platform` imports — it runs in both renderer (Chrome fallback) and main process.

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
