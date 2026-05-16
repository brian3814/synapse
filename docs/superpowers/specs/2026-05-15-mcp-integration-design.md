# MCP Integration Design

Synapse as both an MCP client (consuming external MCP servers) and MCP server (exposing the knowledge graph to external agents like Claude Code, Cursor, etc.). Built on a unified ToolRegistry that replaces the current static tool array with a provider-based architecture.

## Goals

- **MCP Client**: Connect to external MCP servers, bring their tools into the chat agent via namespaced flat merge
- **MCP Server**: Expose Synapse's knowledge graph tools so external agents can query and (optionally) write to the graph
- **Unified Tool Registry**: Single source of truth for all tools (built-in + MCP), extensible to future plugin system
- **Two transports**: Streamable HTTP (when desktop app is running) + stdio CLI (headless, app not required)
- **Configurable access**: Per-client permission profiles on the server side, per-server tool filtering on the client side

## Non-Goals

- MCP resources and prompts (tools only for this phase, resources planned for follow-up)
- Extraction agent MCP integration (chat agent only)
- Third-party plugin system (architecture supports it, but plugin host process is future work)
- Tool management UI (next phase — the registry creates the foundation for it)
- Re-exposing MCP client tools through the MCP server (no MCP-from-MCP forwarding)

## Research Summary

Patterns observed across the ecosystem:

| Product | Tool Routing | Config Format | Transport |
|---|---|---|---|
| Claude Desktop | Flat merge (no namespace) | `mcpServers` JSON | stdio |
| VS Code Copilot | Flat merge | `mcpServers` in settings/`.vscode/mcp.json` | stdio + HTTP |
| Cursor | Flat merge | `mcpServers` JSON | stdio |
| FastMCP | Namespaced flat merge via `mount()` | Python API / `mcpServers` JSON via `create_proxy()` | stdio + HTTP + in-memory |
| LiteLLM | Namespaced flat merge (`server-tool`) | YAML config | stdio + HTTP + SSE |
| Obsidian (community) | N/A (server only) | Claude Desktop config | stdio + HTTP |
| Heptabase (official) | N/A (server only) | OAuth remote MCP | HTTP |

Key findings:
- Every product uses flat merge for tool routing; FastMCP and LiteLLM add namespace prefixes
- All converge on the same `mcpServers` JSON config schema
- Tools-only is the universal starting point (no product launches with resources/prompts)
- Server-side: Obsidian's `obsidian-mcp-server` (cyanheads) is the closest reference — 14 tools, 3 resources, path-based permission filtering

## Architecture Overview

```
┌──────────────────────────────────────────────────────────────────┐
│  Renderer (React)                                                │
│  chat-agent-loop.ts calls tools:list + tools:execute via IPC     │
├──────────────────────────────────────────────────────────────────┤
│  Electron IPC                                                    │
├──────────────────────────────────────────────────────────────────┤
│  Main Process                                                    │
│                                                                  │
│  ToolRegistry (singleton)                                        │
│    ├── BuiltinToolProvider     (14 chat tools, direct fn call)   │
│    ├── McpToolProvider("github")  (JSON-RPC → stdio subprocess)  │
│    ├── McpToolProvider("postgres") (JSON-RPC → HTTP)             │
│    └── (future: PluginToolProvider → sandboxed child process)    │
│                                                                  │
│  McpClientManager              McpServerBridge                   │
│    manages outbound             exposes graph inbound            │
│    MCP connections              via HTTP + stdio                 │
│                                                                  │
├──────────────────────────────────────────────────────────────────┤
│  External MCP Servers          External MCP Clients              │
│  (GitHub, filesystem, DB)      (Claude Code, Cursor, etc.)       │
└──────────────────────────────────────────────────────────────────┘
```

## Component Design

### 1. ToolRegistry & ToolProvider Interface

Central registry for all tool providers. Singleton in the main process.

```typescript
interface ToolProvider {
  readonly id: string;                    // e.g., "builtin", "mcp:github"
  readonly namespace: string | null;      // null for builtin, "github" for MCP
  listTools(): ToolDefinition[];
  executeTool(name: string, input: Record<string, unknown>): Promise<ToolResult>;
  dispose(): void;
}

interface ToolRegistry {
  registerProvider(provider: ToolProvider): void;
  removeProvider(id: string): void;
  getAvailableTools(filter?: ToolFilter): ToolDefinition[];
  getProviders(): ToolProvider[];
  executeTool(namespacedName: string, input: Record<string, unknown>): Promise<ToolResult>;
  onToolsChanged(cb: () => void): () => void;
}

interface ToolFilter {
  disabledTools?: string[];
  providerIds?: string[];
  capabilities?: ('read' | 'write' | 'execute')[];
}
```

**Namespace separator**: Double underscore (`__`). `"github__create_issue"` → provider `"mcp:github"`, tool `"create_issue"`. Single underscore is too common in tool names; double underscore avoids ambiguity (matches Python dunder convention for special separators).

**Dispatch logic**: Parse namespace from tool name at the first `__`. No `__` → route to `"builtin"` provider.

**BuiltinToolProvider**: Wraps existing `CHAT_AGENT_TOOLS` array and `executeTool()` switch from `chat-tool-executor.ts`. No logic changes — just adapted to the `ToolProvider` interface.

**Future-proofing for plugins**: The `ToolProvider` interface is transport-agnostic. A future `PluginToolProvider` would implement the same interface but bridge to a sandboxed child process via `MessagePort`. The registry routes by namespace regardless of where execution happens — direct function call, MCP JSON-RPC, or plugin RPC.

### 2. MCP Client (McpClientManager)

Manages all outbound MCP connections. Singleton in main process.

**Responsibilities:**
- Read merged config (global + vault) on vault open
- For each enabled server: spawn transport, run MCP `initialize` handshake, discover tools via `client.listTools()`
- Create `McpToolProvider` per server, register with `ToolRegistry`
- Handle server lifecycle: connect, reconnect on crash (with backoff), disconnect, dispose
- Watch config files for changes — hot-reload without app restart
- Listen for `notifications/tools/list_changed` from servers to re-discover tools

**McpToolProvider**: One per connected MCP server. Wraps the MCP SDK `Client`. Tool names are stored without namespace internally; the registry handles prefixing. `executeTool()` forwards to `client.callTool()` over JSON-RPC.

**Connection states**: `connecting → connected → disconnected | error`. Error state triggers reconnect with exponential backoff. UI is notified via `mcp:server-status-changed` broadcast.

**Error handling:**
- Subprocess crash → mark `error`, emit status event, attempt reconnect
- Tool call timeout → return error `ToolResult` to agent (does not crash the loop)
- Server unreachable at startup → skip provider registration, tools from that server absent

### 3. MCP Server (McpServerBridge)

Exposes Synapse's built-in tools as an MCP server for external agents.

**Two transports:**
- **Streamable HTTP**: Added to existing companion HTTP server at `127.0.0.1:19876/mcp`. Available when the desktop app is running.
- **stdio CLI**: Separate `synapse-mcp` binary. Opens vault DB directly via better-sqlite3. Does not require the Electron app.

**McpServerBridge**: Creates an `McpServer` instance (from `@modelcontextprotocol/sdk`), registers a curated subset of built-in tools filtered by the connecting client's access profile.

**Exposed tools (12 of 14 built-in):**

| Category | Tools |
|---|---|
| Read (always) | `search_knowledge`, `search_nodes`, `get_node_details`, `get_neighbors`, `get_edges_for_node`, `search_sources`, `get_source_content` |
| Write (gated) | `create_node`, `update_node`, `create_edge`, `delete_node`, `merge_nodes` |
| Excluded | `manage_memory` (internal agent memory), `index_notes_folder` (admin operation) |

**No MCP-from-MCP forwarding**: The server only exposes built-in tools (`providerIds: ['builtin']`). Tools from external MCP servers that Synapse is connected to as a client are not re-exposed.

**Access Profiles:**

```typescript
interface AccessProfile {
  name: string;
  capabilities: ('read' | 'write')[];
  allowedTools?: string[];    // explicit allowlist
  blockedTools?: string[];    // explicit blocklist
}
```

Configured per-vault in `.kg/mcp-server.json`:

```json
{
  "enabled": true,
  "profiles": {
    "default": {
      "capabilities": ["read"],
      "blockedTools": ["delete_node"]
    },
    "trusted": {
      "capabilities": ["read", "write"]
    }
  },
  "httpTransport": {
    "port": 19876,
    "path": "/mcp"
  }
}
```

**Stdio CLI (`synapse-mcp` package):**

```bash
# External agent config (e.g., claude_desktop_config.json)
{
  "mcpServers": {
    "synapse": {
      "command": "synapse-mcp",
      "args": ["--vault", "/path/to/my-vault"],
      "env": {}
    }
  }
}
```

Opens vault DB in read-only mode by default. Write access requires explicit `--allow-write` flag. No access to app settings (API keys, global config). Uses the same `BuiltinToolProvider` logic with a direct DB handle.

### 4. Configuration

Two-layer merge: global app settings + per-vault `.kg/mcp.json`.

**Global config** (in app settings, `~/Library/Application Support/Synapse/`):

```json
{
  "mcpServers": {
    "github": {
      "transport": "stdio",
      "command": "npx",
      "args": ["-y", "@modelcontextprotocol/server-github"],
      "env": { "GITHUB_TOKEN": "${secret:github-token}" },
      "enabled": true,
      "disabledTools": []
    },
    "remote-api": {
      "transport": "http",
      "url": "https://example.com/mcp",
      "headers": { "Authorization": "Bearer ${secret:remote-api-key}" }
    }
  }
}
```

**Vault config** (`.kg/mcp.json`):

```json
{
  "mcpServers": {
    "project-db": {
      "transport": "stdio",
      "command": "npx",
      "args": ["-y", "@modelcontextprotocol/server-postgres"],
      "env": { "DATABASE_URL": "${secret:project-db-url}" }
    },
    "github": {
      "enabled": false
    }
  }
}
```

**Merge rules:**
1. Start with global `mcpServers`
2. Vault entries with same key override global (deep merge per-server)
3. Vault can add new servers not in global
4. Vault can disable a global server with `"enabled": false`
5. Vault cannot read or override global secrets

**Config types:**

```typescript
interface McpServerConfig {
  transport: 'stdio' | 'http';
  enabled?: boolean;                  // default true
  disabledTools?: string[];           // per-server tool filtering

  // stdio
  command?: string;
  args?: string[];
  env?: Record<string, string>;       // supports ${secret:name} refs

  // http
  url?: string;
  headers?: Record<string, string>;   // supports ${secret:name} refs
}

interface McpClientConfig {
  mcpServers: Record<string, McpServerConfig>;
}
```

The server name (object key) becomes the namespace prefix: `"github"` → tools prefixed `"github__"`.

**Secret references**: `${secret:key-name}` placeholders resolved at spawn time. Global secrets stored in app settings (OS-level protection). Vault secrets stored in `.kg/secrets.json` (gitignored). Resolved values never logged.

**Hot-reload**: `McpClientManager` watches both config files. On change: disconnect modified servers → reconnect with new config → re-register providers → emit `onToolsChanged`.

### 5. Security

**Secrets management:**
- API keys and tokens use `${secret:name}` references, never plain text in config
- Global secrets in app settings (same location as Anthropic API key)
- Vault secrets in `.kg/secrets.json` — auto-added to `.gitignore`
- Secrets resolved in-memory at spawn time, never logged

**MCP client sandboxing:**
- External MCP servers run as child processes. Synapse does not sandbox them (matches Claude Desktop, VS Code, Cursor). Trust is implicit — user explicitly adds servers.
- Tool results flowing into LLM context are a prompt injection surface. Mitigated by: `tool_result` role separation in Anthropic API, max iteration limits on agent loop, no automatic code execution from results.

**MCP server security:**

| Concern | Mitigation |
|---|---|
| Unauthorized access | HTTP: configurable auth (none for local, bearer token, API key). Stdio: inherently local. |
| Write operations | Access profiles gate read vs write. Default profile is read-only. |
| Destructive tools | `delete_node` and `merge_nodes` individually blockable even in write profiles. |
| Network exposure | HTTP binds `127.0.0.1` only. Not network-exposed. Remote access requires user-configured reverse proxy. |
| Vault path traversal | Existing vault sandbox config (`allowedDirs`, `blockedExtensions`) applies — MCP tools go through same `executeTool()` path. |

**Stdio CLI security:**
- Read-only DB by default (`better-sqlite3` `readonly: true`)
- Write requires explicit `--allow-write` flag
- No access to app settings (API keys, global config)

### 6. IPC Channels

New channels following existing patterns (`llm:*`, `embedding:*`, `vault-workspace:*`).

**Tool Registry:**

| Channel | Direction | Purpose |
|---|---|---|
| `tools:list` | invoke | Get available tools (merged, namespaced, filtered by `ToolFilter`) |
| `tools:execute` | invoke | Execute tool by namespaced name, returns `ToolResult` |
| `tools:on-changed` | broadcast | Tool list changed (MCP connect/disconnect, enable/disable) |

**MCP Client:**

| Channel | Direction | Purpose |
|---|---|---|
| `mcp:list-servers` | invoke | All configured servers with connection status |
| `mcp:connect-server` | invoke | Manually connect/reconnect a server |
| `mcp:disconnect-server` | invoke | Disconnect a server |
| `mcp:get-server-tools` | invoke | List tools from a specific server |
| `mcp:server-status-changed` | broadcast | Connection state changes |

**MCP Server:**

| Channel | Direction | Purpose |
|---|---|---|
| `mcp-server:get-config` | invoke | Read server config (profiles, enabled state) |
| `mcp-server:set-config` | invoke | Update server config |
| `mcp-server:get-status` | invoke | Server running state, connected client count |

### 7. Agent Loop Integration

Two changes to `chat-agent-loop.ts`:

```typescript
// 1. Tool listing — before first LLM call
// Before:
const tools = getToolDefs(disabledTools);
// After:
const toolDefs = await ipc.invoke('tools:list', { disabledTools });
const tools = toolDefs.map(toAnthropicTool);

// 2. Tool execution — in the iteration loop
// Before:
const result = await executeTool(ctx, toolCall.name, toolCall.input);
// After:
const result = await ipc.invoke('tools:execute', {
  name: toolCall.name,
  input: toolCall.input
});
```

Tool execution moves from the renderer to the main process. The main process already has the DB handle, filesystem access, and MCP client connections. The renderer becomes a thin orchestrator (messages, streaming), delegating all tool execution over IPC.

### 8. Startup Sequence

```
app.whenReady()
  → VaultManager.open(path)
    → resetBetterSQLite(dbPath) + runMigrations()
    → ToolRegistry.init()
      → BuiltinToolProvider.register()
    → McpClientManager.init(mergedConfig)
      → for each enabled server:
          spawn transport → initialize → listTools()
          → McpToolProvider.register()
    → McpServerBridge.init()
    → EmbeddingService.init()
```

Registry init after DB ready (same pattern as `EmbeddingService`), before renderer is interactive.

## File Structure

```
electron/
  mcp/
    tool-registry.ts            — ToolRegistry singleton + ToolProvider interface
    builtin-tool-provider.ts    — wraps existing 14 chat tools
    mcp-client-manager.ts       — manages outbound MCP connections
    mcp-tool-provider.ts        — ToolProvider for a single MCP server
    mcp-server-bridge.ts        — exposes graph as MCP server (HTTP + stdio)
    mcp-config.ts               — config loading, merging, secret resolution
    mcp-ipc.ts                  — IPC handler registration

packages/
  synapse-mcp/                  — stdio CLI binary (separate package)
    index.ts                    — entry point, parses --vault/--allow-write flags
    standalone-provider.ts      — opens DB directly, no Electron dependency
```

## Modularity Principle

The architecture has four independent components connected only through the ToolRegistry:

```
        ┌─────────────────┐
        │  ToolRegistry    │  ← stable core, always exists
        └────┬───┬───┬────┘
             │   │   │
   ┌─────────┘   │   └──────────┐
   ▼             ▼               ▼
Providers     Consumers       Consumers
(add tools)   (use tools)     (use tools)
   │             │               │
   ▼             ▼               ▼
McpClient    In-app Agent    McpServer
(optional)   (optional)      (optional)
```

Each component can be removed without affecting the others:

| Component | Remove it and... | Nothing else changes because... |
|---|---|---|
| In-app agent (`chat-agent-loop.ts`) | No chat panel, external agents only | Registry + MCP server still expose all tools |
| MCP Client (`McpClientManager`) | No external tool consumption | Built-in tools and MCP server unaffected |
| MCP Server (`McpServerBridge`) | No external agent access | In-app agent and MCP client unaffected |
| BuiltinToolProvider | No graph tools at all | Registry still works with only MCP providers |

**Design rule**: No component imports from or depends on another component. They only depend on the registry interface. The in-app agent does NOT call `executeTool()` directly — it goes through `tools:execute` IPC → registry, same as any other consumer. This means swapping the in-app agent for an embedded MCP client (Option 3 from design discussion) is a UI-only change.

## Multi-Vault Support (stdio CLI)

The `synapse-mcp` CLI supports multiple vaults without requiring separate MCP server entries.

**Invocation:**

```bash
synapse-mcp                                    # auto-discover from app's recent vaults
synapse-mcp --vault /work --vault /personal    # explicit multi-vault
synapse-mcp --vault /work                      # single vault (no confirmation needed)
```

**Auto-discovery:** Reads `recentVaults` from `~/Library/Application Support/kg-desktop/storage.json`. Opens all known vaults.

**Vault confirmation pattern (Approach 1+2):**

- `list_vaults` tool always available — returns open vaults with names and paths
- **Read tools** search across all open vaults. Results tagged with vault name: `{ vault: "Work", node: {...} }`
- **Write tools** have a required `vault` parameter when multiple vaults are open. If omitted, returns error: "Multiple vaults open. Call list_vaults and specify which vault to write to."
- Tool descriptions instruct the agent: "Before any write operation on a multi-vault server, confirm the target vault with the user by calling list_vaults first."

**Single-vault shortcut:** When only one vault is open (or `--vault` specifies one path), write tools don't require the `vault` parameter. No confirmation friction for single-vault users.

**Future (Phase 3): MCP Elicitation.** When MCP clients widely support the `elicitation` protocol primitive, write tools will use `requestElicitation()` to prompt the user with a vault picker UI mid-tool-call — replacing the current two-step pattern with inline confirmation.

**HTTP transport:** Always serves the currently-open vault from the desktop app. Multi-vault is not applicable (single vault per Electron process). Switching vaults in the app switches what `/mcp` serves.

## Dependencies

- `@modelcontextprotocol/sdk` — MCP client and server SDK (TypeScript)
- No other new dependencies. `better-sqlite3` (existing) used by stdio CLI.

## Phasing

**This spec (Phase 1):**
- ToolRegistry + BuiltinToolProvider
- McpClientManager + McpToolProvider (client)
- McpServerBridge (server, HTTP + stdio)
- Configuration (two-layer merge, secrets)
- Agent loop integration
- Multi-vault stdio CLI with vault confirmation (Approach 1+2)

**Phase 2 (follow-up):**
- Tool management UI (settings panel for servers, tools, profiles)
- MCP resources (`synapse://node/{id}`, `synapse://types`, `synapse://status`)

**Phase 3 (future):**
- Plugin system with `PluginToolProvider` + sandboxed process isolation
- MCP prompts
- MCP Elicitation for vault confirmation (replaces Approach 1+2)
