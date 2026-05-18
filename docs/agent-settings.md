# Agent Settings Panel

User-facing configuration for agent behavior, accessible via Settings → Agent tab. Three concerns, two persistence layers:

| Concern | Storage | Scope |
|---|---|---|
| Prompt customization | `PlatformStorage` (`agentPromptConfig` key) | Per-user |
| Tool toggles | `PlatformStorage` (`agentToolConfig` key) | Per-user |
| Vault sandboxing | `.kg/agent-config.json` | Per-vault |

## Prompt Customization

Append-only — default prompts are read-only, user adds custom instructions appended after. Separate instructions for extraction agent (`extractionInstructions`) and chat agent (`chatInstructions`).

## Tool Toggles

Each tool can be individually disabled. Extraction tools filtered in `agent-loop.ts` before passing to LLM; `save_entities` is never filterable. Chat tools filtered in `chat-agent-loop.ts`; `semantic_search` follows the same filter.

## Vault Sandboxing

Per-vault directory allowlist (`allowedDirs` — empty = full access) and extension blocklist (`blockedExtensions` — defaults: `.env`, `.key`, `.pem`, `.p12`, `.pfx`). Enforced in `VaultFileWatcher.shouldIgnore()` and `ResourceDetectionHandler.handleFileAdded()`. Config loaded by `createVaultContext()`, cached on `VaultContext.sandboxConfig`, exposed to renderer via `vault-workspace:get-sandbox-config` / `vault-workspace:set-sandbox-config` IPC.

## Key Files

- `src/shared/agent-settings-types.ts` — `AgentPromptConfig`, `AgentToolConfig`, `VaultSandboxConfig` types
- `src/ui/components/settings/AgentSettingsTab.tsx` — Main Agent tab component
- `src/ui/components/settings/ToolToggleRow.tsx` — Compact tool row with toggle
- `src/ui/components/settings/VaultSandboxSection.tsx` — Directory + extension controls
- `src/memory/governance.ts` — Supersession and access stat helpers
