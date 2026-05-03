# Agent Harness for Chat Agent

## Context

The knowledge graph app has three LLM interaction points (extraction agent, chat agent, simple extraction), but none expose user-facing configuration. System prompts are hardcoded, tools are static, and the chat agent has no memory across sessions beyond raw message history. Users cannot customize agent behavior, and the agent cannot learn from prior interactions.

This design adds a harness layer to the **chat agent only** — the interaction point with multi-turn sessions, persistent history, and graph read/write tools. The harness introduces custom prompts, persistent memory, and an extensible tool registry.

**Approach**: DB-first ("Extended Session"), following every existing architectural convention. Inspired by Claude Code's harness (categorized file-based memory, agent presets with tool selection, rich tool registration), adapted for a browser extension / Electron app where SQLite replaces the filesystem.

> **Partial supersession notice (2026-05-03):** Section 3 (Semantic Memory), Phase 2 (Memory System), Phase 3's `search_memories` tool, and related verification steps are superseded by [`2026-05-03-file-based-memory-and-folder-index-design.md`](2026-05-03-file-based-memory-and-folder-index-design.md). Semantic memory is now file-based (Claude Code pattern) using a `manage_memory` tool. Episodic memory (session summaries) remains in SQLite as originally specified.
>
> **What remains canonical:** Section 1 data architecture for chrome.storage keys (`harnessGlobalInstructions`, `harnessPresets`, `harnessActivePresetId`), `memory_episodic` table, and `preset_id` column. The `memory_semantic` table definition is retained for migration compatibility only (table exists in DB but is not actively read/written by new code). Sections 2 (Prompt Assembly), 5 (UI except MemorySection), and Phase 1 remain canonical.

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
  createdAt: number
}>

'harnessActivePresetId': string | null
```

`allowedTools` and `model` overrides on presets are deferred until the unified tool registry (agentic-first Phase 2) provides the infrastructure to enforce them at runtime. Adding fields without enforcement creates a false contract.

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

DB integration follows the DataStore → action-handler → db-client chain, identical to the `chat.*` namespace. Specifically, a `MemoryRepository` interface is added to `DataStore` (`src/db/data-store.ts`), implemented in `SqliteDataStore` (`src/db/sqlite-data-store.ts`), and wired through the action handler and db-client.

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

> **SUPERSEDED:** Semantic memory below is replaced by file-based memory (Claude Code pattern). See [`2026-05-03-file-based-memory-and-folder-index-design.md`](2026-05-03-file-based-memory-and-folder-index-design.md). The `manage_memory` chat tool replaces both auto-extraction and `search_memories`. Only **Episodic Memory** (session summaries in SQLite) below remains active.

### ~~Semantic Memory (facts/preferences)~~ — SUPERSEDED

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

## 4. Tool Additions & Future Registry

### No standalone registry in this spec

The agentic-first architecture spec (`2026-05-03-agentic-first-architecture-design.md`) defines a unified tool registry in Phase 2 (`src/tools/`) with `UnifiedToolDefinition` that replaces all hardcoded tool arrays. Building a separate `chat-tool-registry.ts` here would create a throwaway abstraction.

Harness Phase 1 ships independently of the agentic-first command layer. New tools are added directly to the existing `CHAT_AGENT_TOOLS` array and `executeTool()` switch — the same pattern used for all existing chat tools. When the unified registry lands (agentic-first Phase 2), it dynamically iterates `CHAT_AGENT_TOOLS` at registration time and wraps each tool — so harness additions like `index_notes_folder` are picked up automatically with no manual migration step.

### Phase 1 new tool: `index_notes_folder`

Added directly to `CHAT_AGENT_TOOLS` (definition) and `executeTool()` (executor):
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

### Future tool extension

Until the unified registry lands (agentic-first Phase 2), new tools are added to `CHAT_AGENT_TOOLS` + `executeTool()`. After the registry lands, tools register as `UnifiedToolDefinition` objects and the old arrays are superseded.

---

## 5. UI Components

| Component | Location | Pattern |
|---|---|---|
| `CustomInstructionsSection` | Settings Modal (`SettingsPanel.tsx`) | Textarea + save button. Follows `RelevanceSection` pattern. |
| `PresetPicker` | Chat header (next to session title) | Dropdown. Create/edit/delete presets. Name + prompt text. |
| `MemorySection` | Settings Modal | Semantic memories listed by category with delete. Episodic summaries collapsible (read-only). Clear-all in danger zone. |
| Quick-action chips | `ChatBot.tsx` | Extended SUGGESTION_CHIPS. Pre-fill chat input. |

---

## 6. Phasing

### Phase 1: Custom Prompts + New Tool

New files:
- `src/core/prompt-assembler.ts`
- `src/db/worker/migrations/008-agent-harness.ts`
- `src/ui/components/settings/CustomInstructionsSection.tsx`
- `src/ui/components/chat/PresetPicker.tsx`

Modified files:
- `src/shared/chat-agent-tools.ts` — add `index_notes_folder` tool definition
- `src/ui/hooks/chat-agent-loop.ts` — accept `systemPrompt` param, add tool executor case
- `src/ui/hooks/useChatSession.ts` — call assembler, track preset
- `src/ui/components/settings/SettingsPanel.tsx` — add CustomInstructionsSection
- `src/ui/components/chat/ChatBot.tsx` — quick-action chips, PresetPicker

No standalone tool registry. New tools are added directly to existing arrays/switch until the agentic-first unified registry (Phase 2 of that spec) provides dynamic registration.

### ~~Phase 2: Memory System~~ — SUPERSEDED

> Replaced by file-based memory. See [`2026-05-03-file-based-memory-and-folder-index-design.md`](2026-05-03-file-based-memory-and-folder-index-design.md). Implementation uses `src/commands/memory-commands.ts` + `PlatformFiles` interface instead of SQLite `memory_semantic`.

### Phase 3: Continuity & Polish — PARTIALLY SUPERSEDED

- Episodic summarization on session expiry *(still active)*
- Session summaries in prompt assembly *(still active)*
- ~~`search_memories` chat tool~~ → replaced by `manage_memory` tool
- ~~Memory deduplication/conflict resolution~~ → handled by `manage_memory` file-level dedup
- Token budget management *(moved to file-based memory spec)*

---

## 7. Verification

### Phase 1 verification
1. Build Chrome extension (`npm run build`) and Electron (`npm run build:electron`) — both succeed
2. Open settings → Custom Instructions section visible, save/load works
3. Start a chat session → PresetPicker visible, can create/select presets
4. Chat with preset active → system prompt includes preset content (verify via console log or LLM response reflecting the instructions)
5. Type "index my notes folder" → agent calls `index_notes_folder` tool, returns stats
6. Quick-action chips appear and pre-fill chat input

### ~~Phase 2 verification~~ — SUPERSEDED

> See verification in [`2026-05-03-file-based-memory-and-folder-index-design.md`](2026-05-03-file-based-memory-and-folder-index-design.md).

### Phase 3 verification — UPDATED
1. Complete a session → episodic summary auto-generated *(unchanged)*
2. New session → LLM references prior session context via episodic summaries *(unchanged)*
3. ~~Use `search_memories` tool~~ → Use `manage_memory` with `action: 'list'` to retrieve memories
