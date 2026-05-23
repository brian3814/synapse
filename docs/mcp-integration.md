# MCP Integration & Tool Registry

Synapse is both an **MCP client** (consumes external MCP servers) and **MCP server** (exposes graph tools to external agents like Claude Desktop, Claude Code, Cursor). Built on a unified ToolRegistry in the main process.

## Architecture

All tool execution (built-in + MCP) routes through `ToolRegistry` in the Electron main process. The renderer calls `tools:list` and `tools:execute` IPC channels. See `ARCHITECTURE.md` § "MCP & Tool Registry" for full details.

## Real-Time Graph Sync

External MCP writes trigger immediate UI updates:
- **HTTP bridge** (`/mcp`): `McpServerBridge.onGraphMutated()` broadcasts `db:sync { type: 'reset' }` to renderer windows after write tool execution.
- **stdio CLI**: `notifyApp()` POSTs to `http://127.0.0.1:19876/api/graph-changed`. Companion server broadcasts the same reset event.

## stdio CLI Write Tools

Gated by `--allow-write` flag. Write tools: `create_node`, `update_node`, `delete_node`, `create_edge`, `delete_edge`, `create_note`, `merge_nodes`.

## Desktop Extension

`packages/synapse-mcp/manifest.json` defines a Claude Desktop Extension (`.mcpb`). Build via `cd packages/synapse-mcp && npm run pack`.

## Key Files

- `electron/mcp/types.ts` — `ToolProvider`, `IToolRegistry`, `ToolFilter`, config interfaces
- `electron/mcp/tool-registry.ts` — Singleton registry with namespace-based dispatch (`__` separator)
- `electron/mcp/builtin-tool-provider.ts` — Wraps `ALL_CHAT_AGENT_TOOLS` for main-process execution
- `electron/mcp/mcp-client-manager.ts` — Outbound MCP connections (stdio transport)
- `electron/mcp/mcp-server-bridge.ts` — HTTP MCP server with `onGraphMutated` callback
- `electron/mcp/mcp-config.ts` — Two-layer config merge (global + vault `.kg/mcp.json`)
- `packages/synapse-mcp/` — Standalone stdio CLI + Desktop Extension manifest
- `src/commands/tools/` — Extended tool modules (note, edge, graph, entity)

## Configuration

Global at `~/Library/Application Support/kg-desktop/mcp-config.json`, vault-level at `.kg/mcp.json`. Vault overrides global. Secrets via `${secret:name}`. Access profiles via `.kg/mcp-server.json`.

## Design Spec

[`docs/superpowers/specs/2026-05-15-mcp-integration-design.md`](superpowers/specs/2026-05-15-mcp-integration-design.md)
