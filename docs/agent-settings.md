# Agent Management

Per-agent configuration with tool isolation, managed via the left sidebar Agents panel. Replaces the former Settings → Agent tab.

## Architecture

```
AgentDefinition (.md frontmatter)
  → agent-store.ts (Zustand, single source of truth)
    → toToolFilter() → ToolFilter
      → tools:list IPC (Layer 1: LLM never sees unauthorized tools)
      → tools:execute IPC (Layer 2: execution-time validation)
```

## Agent Definition Format

Markdown files with YAML frontmatter (Claude Code convention). Vault-scoped agents live in `.kg/agents/*.md`.

```markdown
---
name: web-researcher
description: Searches the web without modifying the graph
kind: chat
icon: "🌐"
tools:
  - search_knowledge
  - search_nodes
  - semantic_search
mcpServers:
  - brave-search
maxIterations: 30
---

You are a read-only research agent. Never create or modify entities.
```

### Frontmatter Fields

| Field | Required | Description |
|---|---|---|
| `name` | Yes | Unique kebab-case identifier |
| `description` | Yes | When/why to use this agent |
| `kind` | No | `chat` (default) or `extraction` |
| `icon` | No | Emoji |
| `enabled` | No | Default `true` |
| `tools` | No | Allowlist — only these tools visible |
| `disallowedTools` | No | Blocklist — removed from available set |
| `mcpServers` | No | Which MCP servers accessible (`[]` = none, omit = all) |
| `maxIterations` | No | Max LLM round-trips (default 100) |
| `conversationStarters` | No | Up to 4 suggested prompts |
| `guardrails` | No | Future: confirmation gates, batch limits |
| `graphScope` | No | Future: node type/tag filtering, read-only |
| `skills` | No | Future: SKILL.md references |
| `hooks` | No | Future: lifecycle callbacks |

## Tool Isolation

Each agent's `tools`/`disallowedTools`/`mcpServers` fields are converted to a `ToolFilter` via `toToolFilter()`. Enforcement happens at two layers:

1. **`tools:list` IPC** — `ToolRegistry.getAvailableTools(filter)` strips tools from the LLM's view
2. **`tools:execute` IPC** — validates tool name against the active filter before dispatching

`ToolFilter` supports: `allowedTools` (allowlist), `disabledTools` (blocklist), `providerIds` (MCP server scoping), `capabilities` (read/write/execute category filter).

## Persistence

| Source | Location | What |
|---|---|---|
| Built-in defaults | `DEFAULT_AGENTS` in code | Chat + Extraction agents |
| User overrides | `@platform` storage key `agentOverrides` | Customizations to built-in agents + user-created agents |
| Vault agents | `.kg/agents/*.md` files | Vault-scoped custom agents parsed via `agents:list-vault` IPC |

Load order: defaults → user overrides → vault agents. Migration from legacy `agentPromptConfig`/`agentToolConfig`/`harnessPresets` runs on first load.

## UI

- **Left sidebar**: ActivityBar icon rail (`w-8`) with folder + agents icons. Clicking agents icon opens the AgentsPanel.
- **AgentsPanel**: List view (grouped by scope) with enable toggles → detail view (instructions, tools, starters, max iterations).
- **AgentPicker**: Dropdown in chat header replacing PresetPicker. Shows enabled chat agents; "Manage Agents..." opens sidebar.

## Chat Integration

`useChatSession.ts` reads from `useAgentStore.getState()` instead of scattered `storage.get()` calls. The active agent's `customInstructions` become `globalInstructions` in `assembleSystemPrompt()`. The active agent's `ToolFilter` is passed to `chat-agent-loop.ts` `getToolDefs()`.

## Key Files

- `src/shared/agent-definition-types.ts` — `AgentDefinition`, `AgentToolFilter`, frontmatter parser, `toToolFilter()`
- `src/shared/tool-categories.ts` — Dynamic tool categorization from registry data
- `src/graph/store/agent-store.ts` — Zustand store, migration, persistence
- `src/ui/components/layout/ActivityBar.tsx` — Left icon rail
- `src/ui/components/layout/LeftSidebar.tsx` — ActivityBar + switchable panel
- `src/ui/components/panels/AgentsPanel.tsx` — List/detail routing
- `src/ui/components/panels/AgentDetailView.tsx` — Agent config form
- `src/ui/components/chat/AgentPicker.tsx` — Chat header agent selector
- `electron/mcp/types.ts` — `ToolFilter` with `allowedTools`
- `electron/mcp/mcp-ipc.ts` — Execution-time tool validation
- `docs/research/agent-harness-architecture-research.md` — Full research on guardrails, hooks, skills, sandboxing
