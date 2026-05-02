# Agent Harness Phase 1: Custom Prompts + Tool Registry

## Context

The chat agent has hardcoded system prompts, a static tool list, and no user-facing configuration. This plan implements Phase 1 of the agent harness design (`docs/superpowers/specs/2026-05-03-agent-harness-design.md`): custom prompts (global instructions + per-session presets), an extensible tool registry, the first new tool (`index_notes_folder`), and quick-action buttons.

Phase 2 (memory system) and Phase 3 (continuity) build on this foundation but are not in scope here.

---

## Step 1: DB Migration

**Create** `src/db/worker/migrations/008-agent-harness.ts`

```sql
CREATE TABLE IF NOT EXISTS memory_semantic (
  id TEXT PRIMARY KEY,
  category TEXT NOT NULL DEFAULT 'fact',
  content TEXT NOT NULL,
  source_session_id TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_memory_semantic_category ON memory_semantic(category);

CREATE TABLE IF NOT EXISTS memory_episodic (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL,
  summary TEXT NOT NULL,
  key_topics TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_memory_episodic_session ON memory_episodic(session_id);

ALTER TABLE chat_sessions ADD COLUMN preset_id TEXT;
```

**Modify** `src/db/worker/migrations/index.ts` — register migration 008.

Tables created now for Phase 2 use. The `preset_id` column is used immediately.

---

## Step 2: Tool Registry

### 2a. Create `src/shared/chat-tool-registry.ts`

Module-level tool registry (not a class — matches codebase convention):

```ts
interface ChatToolRegistration {
  definition: ChatToolDefinition;  // from src/shared/chat-agent-tools.ts
  executor: (input: Record<string, unknown>) => Promise<string>;
}

function registerChatTool(tool: ChatToolRegistration): void
function getChatToolDefinitions(): ChatToolDefinition[]
function executeChatTool(name: string, input: Record<string, unknown>): Promise<string>
function getAnthropicChatTools(): ReturnType<typeof toAnthropicChatTools>
```

### 2b. Create `src/core/chat-tool-executors.ts`

Extract each case from the `executeTool()` switch statement in `chat-agent-loop.ts` (~140 lines, 10 cases) into standalone exported functions. Each has signature `(input: Record<string, unknown>) => Promise<string>`.

Existing tools to extract:
- `search_knowledge` → `executeSearchKnowledge()`
- `search_nodes` → `executeSearchNodes()`
- `get_node_details` → `executeGetNodeDetails()`
- `get_neighbors` → `executeGetNeighbors()`
- `get_edges_for_node` → `executeGetEdgesForNode()`
- `search_sources` → `executeSearchSources()`
- `get_source_content` → `executeGetSourceContent()`
- `create_node` → `executeCreateNode()`
- `update_node` → `executeUpdateNode()`
- `create_edge` → `executeCreateEdge()`

### 2c. Create `src/core/harness-init.ts`

```ts
function initHarness(): void
```

Registers all 10 built-in tools from `CHAT_AGENT_TOOLS` with their extracted executors, plus new harness tools (index_notes_folder). Called from `App.tsx` on mount.

### 2d. Modify `src/ui/hooks/chat-agent-loop.ts`

- Add `systemPrompt: string` to `RunChatAgentParams` interface
- Replace hardcoded `CHAT_AGENT_SYSTEM_PROMPT` usage with `params.systemPrompt`
- Replace `TOOL_DEFS` constant with `getAnthropicChatTools()` call from registry
- Replace `executeTool()` switch body with `executeChatTool(name, input)` from registry
- Move `CHAT_AGENT_SYSTEM_PROMPT` to `prompt-assembler.ts` as `BASE_CHAT_SYSTEM_PROMPT`

---

## Step 3: Prompt Assembler

**Create** `src/core/prompt-assembler.ts`

```ts
// The existing CHAT_AGENT_SYSTEM_PROMPT, moved here
export const BASE_CHAT_SYSTEM_PROMPT = '...'

interface PromptContext {
  globalInstructions: string | null;
  presetPrompt: string | null;
  presetName: string | null;
  semanticMemories: Array<{ category: string; content: string }>;  // empty for Phase 1
  recentSessionSummaries: Array<{ summary: string }>;              // empty for Phase 1
}

export function assembleSystemPrompt(ctx: PromptContext): string
```

Pure function. Layering: base → global instructions → preset → memory (placeholder for Phase 2).

**Modify** `src/ui/hooks/useChatSession.ts`

Before calling `runChatAgent()`:
1. Read `harnessGlobalInstructions` + `harnessPresets` + `harnessActivePresetId` from storage
2. Find active preset (if any)
3. Call `assembleSystemPrompt()` with gathered context (memories empty for now)
4. Pass assembled prompt as `systemPrompt` to `runChatAgent()`
5. Add `presetIdRef` (React ref) to track active preset per session

---

## Step 4: Index Notes Tool

**Create** `src/core/harness-tools/index-notes-tool.ts`

Returns `ChatToolRegistration` wrapping existing `indexMarkdownFolder()`:

1. `getStoredFolder()` — check if folder connected
2. If not connected → return `{ error: 'No folder connected. Connect one in Settings > Markdown Folder.' }`
3. Check permission via `handle.queryPermission()`
4. Run `indexMarkdownFolder(handle)` 
5. Return `{ processed, created, updated, skipped }`

Registered in `harness-init.ts`.

**Key imports reused:**
- `getStoredFolder`, `requestPermission` from `src/filesystem/folder-access.ts`
- `indexMarkdownFolder` from `src/filesystem/indexing-pipeline.ts`

---

## Step 5: UI — Custom Instructions Section

**Create** `src/ui/components/settings/CustomInstructionsSection.tsx`

Follows `RelevanceSection` pattern (storage.get on mount, storage.set on save):
- Textarea for global instructions
- Save button with confirmation flash
- Helper text: "These instructions apply to every chat session."
- Storage key: `harnessGlobalInstructions`

**Modify** `src/ui/components/settings/SettingsPanel.tsx`

Add `<CustomInstructionsSection />` after the LLM provider/model/key section, before `<UsageSection />`.

---

## Step 6: UI — Preset Picker

**Create** `src/ui/components/chat/PresetPicker.tsx`

Dropdown component rendered in chat header:
- Shows active preset name (or "Default" if none)
- Dropdown lists all presets with select action
- "New preset" option opens inline form (name + prompt textarea)
- Edit/delete options on existing presets
- Storage key: `harnessPresets`, `harnessActivePresetId`
- On select, communicates preset ID to `useChatSession` via callback prop

**Modify** `src/ui/components/chat/ChatBot.tsx`

- Import and render `<PresetPicker />` in the chat header area
- Replace `SUGGESTION_CHIPS` constant with extended `QUICK_ACTIONS`:
  ```ts
  const QUICK_ACTIONS = [
    { label: 'Index my notes', prompt: 'Please index my notes folder now.' },
    { label: 'Find duplicates', prompt: 'Find potential duplicate entities in my graph.' },
    { label: 'What do I know about...', prompt: 'What do I know about ', partial: true },
  ];
  ```
- Chips with `partial: true` fill input and place cursor at end

---

## Step 7: App Integration

**Modify** `src/ui/App.tsx`

In the `ready` useEffect (alongside `loadAll()`, `loadTypes()`):
```ts
import { initHarness } from '../core/harness-init';
// ...
useEffect(() => {
  if (ready) {
    initHarness();
    loadAll();
    loadTypes();
    // ...
  }
}, [ready, ...]);
```

---

## Files Summary

### New files (10)
| File | Purpose |
|---|---|
| `src/db/worker/migrations/008-agent-harness.ts` | Migration: memory tables + preset_id column |
| `src/shared/chat-tool-registry.ts` | Tool registration/execution interface |
| `src/core/chat-tool-executors.ts` | Extracted executor functions for 10 existing tools |
| `src/core/harness-init.ts` | Startup registration of all tools |
| `src/core/prompt-assembler.ts` | Pure-function system prompt composition |
| `src/core/harness-tools/index-notes-tool.ts` | Index notes folder chat tool |
| `src/ui/components/settings/CustomInstructionsSection.tsx` | Global instructions textarea |
| `src/ui/components/chat/PresetPicker.tsx` | Session preset dropdown |

### Modified files (6)
| File | Change |
|---|---|
| `src/db/worker/migrations/index.ts` | Register migration 008 |
| `src/ui/hooks/chat-agent-loop.ts` | Accept systemPrompt param, delegate to registry |
| `src/ui/hooks/useChatSession.ts` | Call assembler, track preset |
| `src/ui/components/settings/SettingsPanel.tsx` | Add CustomInstructionsSection |
| `src/ui/components/chat/ChatBot.tsx` | Quick-action chips, PresetPicker |
| `src/ui/App.tsx` | Call initHarness() on startup |

---

## Verification

1. `npm run build` + `npm run build:electron` — both succeed
2. Open Settings → Custom Instructions textarea visible, save/load roundtrips
3. Open chat → PresetPicker dropdown visible, can create preset with name + prompt
4. Select a preset, send a message → LLM response reflects preset instructions (e.g., preset says "respond in bullet points" → agent uses bullet points)
5. Type "index my notes folder" in chat → `index_notes_folder` tool called, stats returned in chat
6. Quick-action chips visible, clicking "Index my notes" pre-fills input
7. Clicking "What do I know about..." fills input partially, cursor at end
8. All existing chat tools (search_knowledge, create_node, etc.) still work unchanged after registry refactor
9. Preset selection persists within a session (switching sessions resets to default or last-used)
