# Agent Harness for Chat Agent

## Context

The knowledge graph app has three LLM interaction points (extraction agent, chat agent, simple extraction), but none expose user-facing configuration. System prompts are hardcoded, tools are static, and the chat agent has no memory across sessions beyond raw message history. Users cannot customize agent behavior, and the agent cannot learn from prior interactions.

This design adds a harness layer to the **chat agent only** — the interaction point with multi-turn sessions, persistent history, and graph read/write tools. The harness introduces custom prompts, persistent memory, and an extensible tool registry.

**Approach**: DB-first ("Extended Session"), following every existing architectural convention. Inspired by Claude Code's harness (categorized file-based memory, agent presets with tool selection, rich tool registration), adapted for a browser extension / Electron app where SQLite replaces the filesystem.

## Scope

Three features, designed as a complete system but implemented in phases:

1. **Custom Prompts** — Global instructions + per-session named presets
2. **Memory System** — Semantic facts + episodic session summaries
3. **Tool Registry & Action Harness** — Extensible tool registration, new tools, quick-action buttons

Applies to chat agent only. Extraction agents are unaffected.

---

## 1. Data Architecture

### Chrome Storage (user-editable config)

```ts
'harnessGlobalInstructions': string

'harnessPresets': Array<{
  id: string
  name: string
  prompt: string
  allowedTools: string[] | null   // null = all tools
  model: string | null            // null = use global default
  createdAt: number
}>

'harnessActivePresetId': string | null
```

Rationale: config in chrome.storage matches `llmConfig`, `displayMode`, `usageBudget`.

### SQLite (new migration `008-agent-harness.ts`)

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

Memory categories: `preference` | `fact` | `instruction` (inspired by Claude Code's user/feedback/project/reference taxonomy, simplified for end-user context).

DB integration follows the DataStore → action-handler → db-client chain, identical to the `chat.*` namespace.

---

## 2. Prompt Assembly Pipeline

New file: `src/core/prompt-assembler.ts`

Pure function — caller gathers all context, passes it in. No side effects, no storage reads inside.

```ts
interface PromptContext {
  globalInstructions: string | null;
  presetPrompt: string | null;
  presetName: string | null;
  semanticMemories: Array<{ category: string; content: string }>;
  recentSessionSummaries: Array<{ summary: string }>;
}

function assembleSystemPrompt(ctx: PromptContext): string
```

Layering order:
1. `BASE_CHAT_SYSTEM_PROMPT` — existing hardcoded prompt, moved from `chat-agent-loop.ts`
2. Global custom instructions — `## Custom Instructions\n{text}`
3. Session preset — `## Session Mode: {name}\n{prompt}`
4. Semantic memory — `## What I Know About You\n- [category] content` (capped at ~500 tokens)
5. Recent session summaries — `## Recent Context\n- summary` (last 3)

### Changes to existing code

1. **`chat-agent-loop.ts`**: Add `systemPrompt: string` to `RunChatAgentParams`. Replace `CHAT_AGENT_SYSTEM_PROMPT` constant with the parameter. One-line change.
2. **`useChatSession.ts`**: Before calling `runChatAgent()`, gather context from storage + DB, call `assembleSystemPrompt()`, pass result as `systemPrompt`.

---

## 3. Memory System

### Semantic Memory (facts/preferences)

**Extraction**: After each completed assistant turn, a fire-and-forget LLM call extracts facts.
- Uses cheapest model (Haiku)
- Runs in `.then()` chain after `saveMessage()` — non-blocking to chat flow
- If extraction fails, it fails silently (memories are nice-to-have)

**Extraction prompt**: "Extract any user facts, preferences, or behavioral instructions from this exchange. Return JSON array of `{category: 'preference'|'fact'|'instruction', content: string}` or empty array if nothing worth remembering."

**Deduplication**: Before inserting, check for similar existing memories (substring match on content). Update `updated_at` if match found.

**Retrieval**: `SELECT * FROM memory_semantic ORDER BY updated_at DESC LIMIT 20`. Recency-based — no vector search needed at this scale.

**Token budget**: Cap memory section at ~500 tokens in system prompt. If memories exceed, truncate oldest.

### Episodic Memory (session summaries)

**Extraction**: When a session expires (2-hour inactivity or new session creation), summarize the full conversation. Fire-and-forget.

**Summarization prompt**: "Summarize this conversation in 2-3 sentences. Focus on what was discussed, decisions made, and any unresolved questions."

**Retrieval**: `SELECT * FROM memory_episodic ORDER BY created_at DESC LIMIT 3`

### New files

- `src/core/memory-extractor.ts` — extraction logic (semantic + episodic)
- `src/db/worker/queries/memory-queries.ts` — SQL CRUD
- Wire through: `data-store.ts` → `action-handler.ts` → `db-client.ts` (following `chat.*` pattern)

---

## 4. Tool Registry & Action Harness

### Tool Registration Interface

New file: `src/shared/chat-tool-registry.ts`

```ts
interface ChatToolRegistration {
  definition: ChatToolDefinition;  // existing type: name, description, parameters, executionContext
  executor: (input: Record<string, unknown>) => Promise<string>;
}

registerChatTool(tool: ChatToolRegistration): void
getChatToolDefinitions(): ChatToolDefinition[]
executeChatTool(name: string, input: Record<string, unknown>): Promise<string>
```

Module-level functions (not a class) — matches codebase convention.

### Refactoring existing tools

The `executeTool()` switch statement in `chat-agent-loop.ts` (~140 lines, 10 cases) is split:

1. Each case → standalone executor function in `src/core/chat-tool-executors.ts`
2. All 10 existing tools registered via `registerChatTool()` at init in `harness-init.ts`
3. Switch statement replaced by `executeChatTool(name, input)` — one-line call
4. `TOOL_DEFS` constant in `chat-agent-loop.ts` replaced by `getAnthropicChatTools()` from registry (called at start of each `runChatAgent()` invocation so newly registered tools are picked up)

### New initialization file

`src/core/harness-init.ts` — called from `App.tsx` on mount (alongside existing `loadAll()` / `loadTypes()`). Registers all built-in tools + harness tools. Must run before any chat session starts.

### Phase 1 new tool: `index_notes_folder`

New file: `src/core/harness-tools/index-notes-tool.ts`

Wraps existing `indexMarkdownFolder()` from `src/filesystem/indexing-pipeline.ts`:
1. Check if folder connected (`getStoredFolder()`)
2. If not → return error message
3. If connected → check permission, run indexing, return stats

### Quick-action buttons

Extend existing `SUGGESTION_CHIPS` in `ChatBot.tsx` to a configurable array:

```ts
const QUICK_ACTIONS = [
  { label: 'Index my notes', prompt: 'Please index my notes folder now.' },
  { label: 'Find duplicates', prompt: 'Find potential duplicate entities in my graph.' },
  { label: 'What do I know about...', prompt: 'What do I know about ', partial: true },
];
```

Chips with `partial: true` fill the input and place cursor at end.

### Future tool extension pattern

Adding a new tool = 2 steps:
1. Create file in `src/core/harness-tools/` returning `ChatToolRegistration`
2. Call `registerChatTool()` in `harness-init.ts`

No other files need to change.

---

## 5. UI Components

| Component | Location | Pattern |
|---|---|---|
| `CustomInstructionsSection` | Settings Modal (`SettingsPanel.tsx`) | Textarea + save button. Follows `RelevanceSection` pattern. |
| `PresetPicker` | Chat header (next to session title) | Dropdown. Create/edit/delete presets. Name + prompt + tool filter + model override. |
| `MemorySection` | Settings Modal | Semantic memories listed by category with delete. Episodic summaries collapsible (read-only). Clear-all in danger zone. |
| Quick-action chips | `ChatBot.tsx` | Extended SUGGESTION_CHIPS. Pre-fill chat input. |

---

## 6. Phasing

### Phase 1: Custom Prompts + Tool Registry

New files:
- `src/core/prompt-assembler.ts`
- `src/shared/chat-tool-registry.ts`
- `src/core/chat-tool-executors.ts`
- `src/core/harness-init.ts`
- `src/core/harness-tools/index-notes-tool.ts`
- `src/db/worker/migrations/008-agent-harness.ts`
- `src/ui/components/settings/CustomInstructionsSection.tsx`
- `src/ui/components/chat/PresetPicker.tsx`

Modified files:
- `src/ui/hooks/chat-agent-loop.ts` — accept `systemPrompt` param
- `src/ui/hooks/useChatSession.ts` — call assembler, track preset
- `src/ui/components/settings/SettingsPanel.tsx` — add CustomInstructionsSection
- `src/ui/components/chat/ChatBot.tsx` — quick-action chips, PresetPicker

### Phase 2: Memory System

New files:
- `src/core/memory-extractor.ts`
- `src/db/worker/queries/memory-queries.ts`
- `src/ui/components/settings/MemorySection.tsx`

Modified files:
- `src/db/data-store.ts` — add `MemoryRepository` interface
- `src/db/worker/action-handler.ts` — add `memory.*` cases
- `src/db/client/db-client.ts` — add `memory` namespace
- `src/ui/hooks/useChatSession.ts` — hook memory extraction post-turn
- `src/core/prompt-assembler.ts` — memory retrieval in assembly

### Phase 3: Continuity & Polish

- Episodic summarization on session expiry
- Session summaries in prompt assembly
- `search_memories` chat tool
- Memory deduplication/conflict resolution
- Token budget management

---

## 7. Verification

### Phase 1 verification
1. Build Chrome extension (`npm run build`) and Electron (`npm run build:electron`) — both succeed
2. Open settings → Custom Instructions section visible, save/load works
3. Start a chat session → PresetPicker visible, can create/select presets
4. Chat with preset active → system prompt includes preset content (verify via console log or LLM response reflecting the instructions)
5. Type "index my notes folder" → agent calls `index_notes_folder` tool, returns stats
6. Quick-action chips appear and pre-fill chat input

### Phase 2 verification
1. Have a conversation mentioning preferences ("I prefer concise answers")
2. Check Settings → Memory section shows extracted fact with category `preference`
3. Start a new session → LLM response reflects remembered preference
4. Delete a memory → subsequent sessions no longer reflect it

### Phase 3 verification
1. Complete a session → episodic summary auto-generated
2. New session → LLM references prior session context
3. Use `search_memories` tool → agent retrieves and cites specific memories
