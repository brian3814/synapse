# Agent Settings Panel Design

Expose agent configuration to the user via a new "Agent" tab in the Settings modal. Covers prompt customization, tool management, and vault sandboxing.

## Overview

Three concerns, two persistence layers:

| Concern | Storage | Scope |
|---|---|---|
| Prompt customization | App settings (`PlatformStorage`) | Per-user |
| Tool toggles | App settings (`PlatformStorage`) | Per-user |
| Vault sandboxing | `.kg/agent-config.json` | Per-vault |

## Data Model

### App Settings (PlatformStorage)

```typescript
// Storage key: 'agentPromptConfig'
interface AgentPromptConfig {
  extractionInstructions: string;  // appended to extraction system prompt
  chatInstructions: string;        // appended to chat system prompt
}

// Storage key: 'agentToolConfig'
interface AgentToolConfig {
  disabledExtractionTools: string[];  // tool names from AGENT_TOOLS to skip
  disabledChatTools: string[];        // tool names from CHAT_AGENT_TOOLS to skip
}
```

### Vault Config (`.kg/agent-config.json`)

```typescript
interface VaultSandboxConfig {
  allowedDirs: string[];       // vault-relative paths, e.g. ["notes/", "research/"]
                               // empty array = full vault access (default)
  blockedExtensions: string[]; // e.g. [".env", ".key", ".pem"]
}
```

Default when no config file exists: `allowedDirs: []` (full access), `blockedExtensions: [".env", ".key", ".pem", ".p12", ".pfx"]`.

Read/written by `VaultManager` in the main process, exposed to renderer via IPC channels `vault:get-sandbox-config` / `vault:set-sandbox-config`.

## UI Layout

New **Agent** tab in `SettingsModal`, positioned between Model and Billing (5th tab). Three collapsible sections:

### 1. Extraction Agent

- **Default prompt** — disclosure toggle "View default prompt" expands a read-only `<pre>` block showing the live output of `getAgentSystemPrompt()` / `getQuickExtractSystemPrompt()`.
- **Custom instructions** — textarea with helper text: "Appended after the default prompt when extracting from pages or text."
- **Tools** — compact row list of 9 extraction tools. Each row: tool name, one-line description, toggle switch on the right. `save_entities` is always-on (greyed out toggle, not filterable).

### 2. Chat Agent

Same pattern as Extraction Agent:
- **Default prompt** — read-only disclosure showing `BASE_CHAT_SYSTEM_PROMPT` from `prompt-assembler.ts` (the static base, not the assembled version with dynamic memories/presets).
- **Custom instructions** — textarea. The `CustomInstructionsSection` moves here from the Model tab; stored as `agentPromptConfig.chatInstructions`.
- **Tools** — compact row list of 14 chat tools, grouped by category:
  - **Read**: search_knowledge, search_nodes, get_node_details, get_neighbors, get_edges_for_node, search_sources, get_source_content, semantic_search
  - **Write**: create_node, update_node, create_edge, index_notes_folder, manage_memory
  - **Destructive**: delete_node, merge_nodes — rows use a subtle warning color

### 3. Vault Sandbox

- Header with note: "Stored in this vault — rules apply per-vault."
- **Allowed Directories** — path list with + button to add, × to remove. Placeholder: "Empty = full vault access."
- **Blocked File Extensions** — tag-input style chips. Default chips: `.env`, `.key`, `.pem`, `.p12`, `.pfx`. User can add/remove.
- When no vault is open, section is disabled with message: "Open a vault to configure sandbox rules."

## Runtime Integration

### Prompt Append

- **Extraction**: `getAgentSystemPrompt()` and `getQuickExtractSystemPrompt()` gain an optional `customInstructions?: string` parameter. The caller reads `agentPromptConfig.extractionInstructions` from storage and passes it in. Appended as a final `## Custom Instructions` block.
- **Chat**: `assembleSystemPrompt()` reads `agentPromptConfig.chatInstructions` instead of `harnessGlobalInstructions`. Same append position in the assembled prompt.
- **Empty string** is treated as no-op — default prompt runs unmodified.

### Tool Filtering

- **Extraction**: `AGENT_TOOLS` is filtered by `agentToolConfig.disabledExtractionTools` before being passed to `llm.runAgent()`. `save_entities` is never filterable (hardcoded safeguard).
- **Chat**: `CHAT_AGENT_TOOLS` is filtered by `agentToolConfig.disabledChatTools` before being passed to the chat agent loop. The dynamic `semantic_search` tool follows the same filter.

### Vault Sandboxing

Enforced in the Electron main process at two points:

1. **`file-watcher.ts`** — skip file events from paths outside `allowedDirs` or matching `blockedExtensions`.
2. **`ResourceDetectionHandler`** — refuse to create resource nodes for blocked files.

The sandbox config is loaded by `VaultManager.open()` alongside other vault init, cached in memory, and passed to handlers via `VaultContext`.

## Edge Cases

- **All tools disabled in a category**: show a warning "The agent won't be able to perform any [read/write/destructive] operations." Don't block — the user knows what they want.
- **Vault not open**: Vault Sandbox section shows disabled state. Prompt and tool sections remain usable (app-level).
- **Default prompt display**: rendered live from current function output, not a stored snapshot. Always reflects latest code.

## Files to Create/Modify

### New Files
- `src/ui/components/settings/AgentSettingsTab.tsx` — main Agent tab component
- `src/ui/components/settings/ToolToggleRow.tsx` — reusable compact tool row with toggle
- `src/ui/components/settings/VaultSandboxSection.tsx` — directory + extension controls
- `src/shared/agent-settings-types.ts` — `AgentPromptConfig`, `AgentToolConfig`, `VaultSandboxConfig` type definitions

### Modified Files
- `src/ui/components/settings/SettingsModal.tsx` — add Agent tab to tab list
- `src/ui/components/settings/SettingsPanel.tsx` — render `AgentSettingsTab` for new tab
- `src/core/system-prompts.ts` — add `customInstructions` param to `getAgentSystemPrompt()`
- `src/shared/quick-extract-prompt.ts` — add `customInstructions` param to `getQuickExtractSystemPrompt()`
- `src/core/prompt-assembler.ts` — read from `agentPromptConfig.chatInstructions` instead of `harnessGlobalInstructions`
- `src/shared/constants.ts` — add `AGENT_PROMPT_CONFIG_KEY`, `AGENT_TOOL_CONFIG_KEY` storage keys
- `electron/vault/vault-manager.ts` — load/save `.kg/agent-config.json`, expose via IPC
- `electron/vault/file-watcher.ts` — apply sandbox rules to file events
- `electron/vault/handlers/resource-detection-handler.ts` — check sandbox before creating resource nodes
- `src/platform/electron/index.ts` — add IPC bridge for sandbox config
- `src/platform/types.ts` — extend platform types if needed for sandbox IPC
