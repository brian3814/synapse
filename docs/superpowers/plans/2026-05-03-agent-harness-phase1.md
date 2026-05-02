# Agent Harness Phase 1: Custom Prompts + New Tool

> **⚠️ SEQUENCING:** Implement agentic-first Phase 1 (command layer) FIRST. This harness plan adds custom prompts and a new tool on top of the command layer. The `index_notes_folder` tool should use `CommandContext` and register into the unified `src/tools/registry.ts` once agentic-first Phase 2 is done.
>
> See: `docs/superpowers/specs/2026-05-03-agentic-first-architecture-design.md` § "Relationship to Agent Harness"

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add custom prompt support (global instructions + per-session presets), one new chat tool (`index_notes_folder`), and quick-action buttons. No tool registry refactor — that's deferred to the agentic-first unified registry (separate spec).

**Architecture:** Pure-function prompt assembler. New tool added directly to existing `CHAT_AGENT_TOOLS` array + `executeTool()` switch (no standalone registry). Config in chrome.storage. DB migration creates tables for Phase 2 memory.

**Tech Stack:** TypeScript, React 19, Zustand, Vite, chrome.storage API, SQLite

**Spec:** `docs/superpowers/specs/2026-05-03-agent-harness-design.md`

---

### Task 1: DB Migration — Create Memory Tables

**Files:**
- Create: `src/db/worker/migrations/008-agent-harness.ts`
- Modify: `src/db/worker/migrations/index.ts`

- [ ] **Step 1: Create migration file**

```ts
// src/db/worker/migrations/008-agent-harness.ts
export const version = 8;
export const description = 'Agent harness: memory tables and chat session preset column';

export const up = `
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
`;
```

Note: `ALTER TABLE chat_sessions ADD COLUMN preset_id TEXT` cannot go in a numbered migration because `chat_sessions` is created via `CREATE TABLE IF NOT EXISTS` in `migrations/index.ts:124-129` (not a numbered migration). We add the column in that same idempotent block instead.

- [ ] **Step 2: Register migration in index.ts**

In `src/db/worker/migrations/index.ts`, add the import and include in the array:

```ts
// Add after line 8:
import * as migration008 from './008-agent-harness';

// Change line 17 to include migration008:
const migrations: Migration[] = [migration001, migration002, migration003, migration004, migration005, migration006, migration007, migration008];
```

Add `preset_id` to the idempotent `chat_sessions` block. Change the `CREATE TABLE` at line 124:

```sql
CREATE TABLE IF NOT EXISTS chat_sessions (
    id TEXT PRIMARY KEY, title TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    last_active_at TEXT NOT NULL DEFAULT (datetime('now')),
    status TEXT NOT NULL DEFAULT 'active',
    preset_id TEXT
);
```

Since `IF NOT EXISTS` won't re-create existing tables, add an idempotent ALTER after line 137:

```ts
try {
  await executeExec(`ALTER TABLE chat_sessions ADD COLUMN preset_id TEXT;`);
} catch {
  // Column already exists
}
```

- [ ] **Step 3: Verify build**

Run: `npx tsc --noEmit`
Expected: no errors

- [ ] **Step 4: Commit**

```
git add src/db/worker/migrations/008-agent-harness.ts src/db/worker/migrations/index.ts
git commit -m "feat(db): add migration 008 for agent harness memory tables"
```

---

### Task 2: Prompt Assembler

**Files:**
- Create: `src/core/prompt-assembler.ts`

- [ ] **Step 1: Create prompt-assembler.ts**

Move the `CHAT_AGENT_SYSTEM_PROMPT` constant from `chat-agent-loop.ts:29-64` here as `BASE_CHAT_SYSTEM_PROMPT`, and add the assembly function.

```ts
// src/core/prompt-assembler.ts

export const BASE_CHAT_SYSTEM_PROMPT = `You are a helpful assistant integrated into a personal knowledge graph browser extension. You have access to tools that let you search, read, and modify the user's knowledge graph.

## Citation Rules (MANDATORY)
- When referencing information from the knowledge graph, you MUST cite the source URL using [Source: url] format.
- When mentioning ANY entity from the graph, ALWAYS use the clickable format: [Entity Name](node:entity-id). The entity-id comes from the id field in tool results.
- Every factual claim from the knowledge graph should be traceable to a source or entity.
- If a tool result includes source URLs, cite them in your answer.

## Tool Usage Strategy

**For knowledge questions ("What do I know about X?", "Tell me about X"):**
1. Start with search_knowledge — it finds entities, expands to connected neighbors, and retrieves source content in one call
2. If you need more detail on a specific entity, follow up with get_node_details or get_neighbors
3. If you need the full source text, use get_source_content

**For graph exploration ("How does X connect to Y?", "What's related to X?"):**
1. Use search_nodes to find starting entities
2. Use get_neighbors or get_edges_for_node to trace connections
3. Explain the paths you find

**For requests to modify the graph:**
1. First search to check if entities already exist (avoid duplicates)
2. Use create_node / create_edge to add new data
3. Use update_node to modify existing entities
4. Confirm what you created/updated

**When no tools are needed:**
- Answer general questions using your own knowledge
- If the question doesn't relate to the graph, just respond normally

## Response Format
- Use [Entity Name](node:entity-id) for EVERY entity you mention from the graph
- Use [Source: url] for EVERY source you reference
- Use markdown formatting (bold, lists, headers)
- Be concise but thorough
- If search returns no results, say so clearly`;

export interface PromptContext {
  globalInstructions: string | null;
  presetPrompt: string | null;
  presetName: string | null;
  semanticMemories: Array<{ category: string; content: string }>;
  recentSessionSummaries: Array<{ summary: string }>;
}

export function assembleSystemPrompt(ctx: PromptContext): string {
  const sections: string[] = [BASE_CHAT_SYSTEM_PROMPT];

  if (ctx.globalInstructions) {
    sections.push(`## Custom Instructions\n${ctx.globalInstructions}`);
  }

  if (ctx.presetPrompt) {
    sections.push(`## Session Mode: ${ctx.presetName ?? 'Custom'}\n${ctx.presetPrompt}`);
  }

  if (ctx.semanticMemories.length > 0) {
    const lines = ctx.semanticMemories.map((m) => `- [${m.category}] ${m.content}`);
    sections.push(`## What I Know About You\n${lines.join('\n')}`);
  }

  if (ctx.recentSessionSummaries.length > 0) {
    const lines = ctx.recentSessionSummaries.map((s) => `- ${s.summary}`);
    sections.push(`## Recent Context\n${lines.join('\n')}`);
  }

  return sections.join('\n\n');
}
```

- [ ] **Step 2: Verify build**

Run: `npx tsc --noEmit`
Expected: no errors

- [ ] **Step 3: Commit**

```
git add src/core/prompt-assembler.ts
git commit -m "feat(harness): add pure-function prompt assembler with layered context"
```

---

### Task 3: Add index_notes_folder Tool to Existing Arrays

**Files:**
- Modify: `src/shared/chat-agent-tools.ts`
- Modify: `src/ui/hooks/chat-agent-loop.ts`

No new registry — add directly to existing `CHAT_AGENT_TOOLS` and `executeTool()`.

- [ ] **Step 1: Add tool definition to CHAT_AGENT_TOOLS**

In `src/shared/chat-agent-tools.ts`, add to the end of the `CHAT_AGENT_TOOLS` array (before the closing `];` at line 220):

```ts
  {
    name: 'index_notes_folder',
    description:
      'Index or re-index the connected markdown notes folder into the knowledge graph. Creates resource nodes for each .md file and edges for wiki-links. Returns indexing statistics.',
    parameters: {
      type: 'object',
      properties: {},
      required: [],
    },
    executionContext: 'ui',
  },
```

- [ ] **Step 2: Add executor case to chat-agent-loop.ts**

In `src/ui/hooks/chat-agent-loop.ts`, add imports at the top:

```ts
import { getStoredFolder, requestPermission } from '../../filesystem/folder-access';
import { indexMarkdownFolder } from '../../filesystem/indexing-pipeline';
```

Add a new case in the `executeTool()` switch statement (before the `default:` case at line 383):

```ts
    case 'index_notes_folder': {
      const handle = await getStoredFolder();
      if (!handle) {
        return JSON.stringify({ error: 'No folder connected. Connect one in Settings > Markdown Folder.' });
      }
      const perm = await (handle as any).queryPermission({ mode: 'readwrite' });
      if (perm !== 'granted') {
        const granted = await requestPermission(handle);
        if (!granted) {
          return JSON.stringify({ error: 'Permission denied. Please grant folder access in Settings.' });
        }
      }
      const result = await indexMarkdownFolder(handle);
      await useGraphStore.getState().loadAll();
      return JSON.stringify({
        processed: result.processed,
        created: result.created,
        updated: result.updated,
        skipped: result.skipped,
      });
    }
```

- [ ] **Step 3: Verify build**

Run: `npx tsc --noEmit`
Expected: no errors

- [ ] **Step 4: Commit**

```
git add src/shared/chat-agent-tools.ts src/ui/hooks/chat-agent-loop.ts
git commit -m "feat(harness): add index_notes_folder chat tool"
```

---

### Task 4: Parameterize runChatAgent to Accept systemPrompt

**Files:**
- Modify: `src/ui/hooks/chat-agent-loop.ts`

- [ ] **Step 1: Add systemPrompt to RunChatAgentParams**

Change the `RunChatAgentParams` interface at line 72:

```ts
interface RunChatAgentParams {
  conversationHistory: Array<{ role: 'user' | 'assistant'; content: string }>;
  currentPrompt: string;
  provider: string;
  model: string;
  systemPrompt: string;
  onProgress: (event: ChatAgentProgress) => void;
}
```

- [ ] **Step 2: Destructure and use the param**

In `runChatAgent()`, add `systemPrompt` to destructuring:

```ts
export async function runChatAgent({
  conversationHistory,
  currentPrompt,
  provider,
  model,
  systemPrompt,
  onProgress,
}: RunChatAgentParams): Promise<string> {
```

In the `sendChatLLMRequest` call (line 108), replace `CHAT_AGENT_SYSTEM_PROMPT` with `systemPrompt`:

```ts
        systemPrompt,
```

- [ ] **Step 3: Remove the old constant export**

Delete line 66: `export { CHAT_AGENT_SYSTEM_PROMPT };`

The constant body (lines 29-64) can remain as a local fallback, or be removed since `prompt-assembler.ts` now owns `BASE_CHAT_SYSTEM_PROMPT`. Remove the constant and its declaration. The import of it (if any external consumer exists) should be redirected to `prompt-assembler.ts`.

- [ ] **Step 4: Verify build**

Run: `npx tsc --noEmit`
Expected: If there are external imports of `CHAT_AGENT_SYSTEM_PROMPT`, fix them to import `BASE_CHAT_SYSTEM_PROMPT` from `src/core/prompt-assembler.ts`. The only known consumer is `useChatSession.ts` which will be updated in the next task.

- [ ] **Step 5: Commit**

```
git add src/ui/hooks/chat-agent-loop.ts
git commit -m "refactor(chat): accept systemPrompt param instead of hardcoded constant"
```

---

### Task 5: Wire Prompt Assembly into useChatSession

**Files:**
- Modify: `src/ui/hooks/useChatSession.ts`

- [ ] **Step 1: Add imports**

```ts
import { storage } from '@platform';
import { assembleSystemPrompt } from '../../core/prompt-assembler';
```

- [ ] **Step 2: Gather context and assemble prompt before runChatAgent**

After `fetchLLMConfigAndTypes()` (line 111) and before `runChatAgent` (line 116), add:

```ts
      const { config } = await fetchLLMConfigAndTypes();

      // Assemble system prompt with harness context
      const storageData = await storage.get(['harnessGlobalInstructions', 'harnessPresets', 'harnessActivePresetId']);
      const globalInstructions = (storageData as any).harnessGlobalInstructions ?? null;
      const presets = (storageData as any).harnessPresets ?? [];
      const activePresetId = (storageData as any).harnessActivePresetId ?? null;
      const activePreset = activePresetId
        ? presets.find((p: any) => p.id === activePresetId)
        : null;

      const systemPrompt = assembleSystemPrompt({
        globalInstructions,
        presetPrompt: activePreset?.prompt ?? null,
        presetName: activePreset?.name ?? null,
        semanticMemories: [],
        recentSessionSummaries: [],
      });
```

Then add `systemPrompt` to the `runChatAgent` call:

```ts
      const finalText = await runChatAgent({
        conversationHistory: historyForLLM,
        currentPrompt: input,
        provider: config.provider,
        model: config.model,
        systemPrompt,
        onProgress: (event: ChatAgentProgress) => {
```

- [ ] **Step 3: Verify build**

Run: `npx tsc --noEmit`
Expected: no errors

- [ ] **Step 4: Commit**

```
git add src/ui/hooks/useChatSession.ts
git commit -m "feat(harness): wire prompt assembler into useChatSession"
```

---

### Task 6: Custom Instructions UI in Settings

**Files:**
- Create: `src/ui/components/settings/CustomInstructionsSection.tsx`
- Modify: `src/ui/components/settings/SettingsPanel.tsx`

- [ ] **Step 1: Create CustomInstructionsSection component**

```tsx
// src/ui/components/settings/CustomInstructionsSection.tsx
import { useState, useEffect } from 'react';
import { storage } from '@platform';

export function CustomInstructionsSection() {
  const [instructions, setInstructions] = useState('');
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    storage.get('harnessGlobalInstructions').then((result: Record<string, any>) => {
      if (result.harnessGlobalInstructions) {
        setInstructions(result.harnessGlobalInstructions);
      }
    }).catch(() => {});
  }, []);

  const handleSave = async () => {
    try {
      await storage.set({ harnessGlobalInstructions: instructions });
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    } catch (e) {
      console.error('Failed to save custom instructions:', e);
    }
  };

  return (
    <div className="border-t border-zinc-700 pt-4 mt-4">
      <h4 className="text-xs font-medium text-zinc-400 mb-2">Custom Instructions</h4>
      <p className="text-[10px] text-zinc-600 mb-2">
        These instructions apply to every chat session. Tell the agent about your preferences, role, or how you want responses formatted.
      </p>
      <textarea
        value={instructions}
        onChange={(e) => setInstructions(e.target.value)}
        placeholder="e.g., I'm a researcher in AI safety. Always cite sources. Respond in bullet points."
        rows={4}
        className="w-full bg-zinc-800 border border-zinc-600 rounded px-2 py-1.5 text-sm text-zinc-100 outline-none focus:border-indigo-500 placeholder-zinc-600 resize-y"
      />
      <button
        onClick={handleSave}
        className="mt-2 w-full bg-indigo-600 text-white text-sm py-1.5 rounded hover:bg-indigo-500 transition-colors"
      >
        {saved ? 'Saved!' : 'Save Instructions'}
      </button>
    </div>
  );
}
```

- [ ] **Step 2: Add to SettingsPanel**

In `src/ui/components/settings/SettingsPanel.tsx`, add import:

```ts
import { CustomInstructionsSection } from './CustomInstructionsSection';
```

Add `<CustomInstructionsSection />` after the save/clear buttons block (after line 118) and before `<UsageSection />` (line 120):

```tsx
      </div>

      <CustomInstructionsSection />

      <UsageSection />
```

- [ ] **Step 3: Verify build**

Run: `npx tsc --noEmit`
Expected: no errors

- [ ] **Step 4: Commit**

```
git add src/ui/components/settings/CustomInstructionsSection.tsx src/ui/components/settings/SettingsPanel.tsx
git commit -m "feat(harness): add Custom Instructions section to Settings"
```

---

### Task 7: Preset Picker UI + Quick-Action Chips

**Files:**
- Create: `src/ui/components/chat/PresetPicker.tsx`
- Modify: `src/ui/components/chat/ChatBot.tsx`

- [ ] **Step 1: Create PresetPicker component**

```tsx
// src/ui/components/chat/PresetPicker.tsx
import { useState, useEffect, useRef } from 'react';
import { storage } from '@platform';

interface Preset {
  id: string;
  name: string;
  prompt: string;
  createdAt: number;
}

export function PresetPicker() {
  const [presets, setPresets] = useState<Preset[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState('');
  const [newPrompt, setNewPrompt] = useState('');
  const dropdownRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    storage.get(['harnessPresets', 'harnessActivePresetId']).then((result: Record<string, any>) => {
      if (result.harnessPresets) setPresets(result.harnessPresets);
      if (result.harnessActivePresetId) setActiveId(result.harnessActivePresetId);
    }).catch(() => {});
  }, []);

  useEffect(() => {
    if (!open) return;
    const handleClick = (e: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setOpen(false);
        setCreating(false);
      }
    };
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, [open]);

  const activeName = activeId ? presets.find((p) => p.id === activeId)?.name : null;

  const selectPreset = async (id: string | null) => {
    setActiveId(id);
    setOpen(false);
    try {
      await storage.set({ harnessActivePresetId: id });
    } catch {}
  };

  const createPreset = async () => {
    if (!newName.trim() || !newPrompt.trim()) return;
    const preset: Preset = {
      id: crypto.randomUUID(),
      name: newName.trim(),
      prompt: newPrompt.trim(),
      createdAt: Date.now(),
    };
    const updated = [...presets, preset];
    setPresets(updated);
    setActiveId(preset.id);
    setCreating(false);
    setNewName('');
    setNewPrompt('');
    try {
      await storage.set({ harnessPresets: updated, harnessActivePresetId: preset.id });
    } catch {}
  };

  const deletePreset = async (id: string) => {
    const updated = presets.filter((p) => p.id !== id);
    setPresets(updated);
    if (activeId === id) {
      setActiveId(null);
      await storage.set({ harnessPresets: updated, harnessActivePresetId: null }).catch(() => {});
    } else {
      await storage.set({ harnessPresets: updated }).catch(() => {});
    }
  };

  return (
    <div className="relative" ref={dropdownRef}>
      <button
        onClick={() => setOpen(!open)}
        className="flex items-center gap-1 px-2 py-0.5 text-[10px] rounded border border-zinc-700 text-zinc-400 hover:text-zinc-200 hover:border-zinc-500 transition-colors"
        title="Select session preset"
      >
        <span>{activeName ?? 'Default'}</span>
        <svg width="8" height="8" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round">
          <path d="M6 9l6 6 6-6" />
        </svg>
      </button>

      {open && (
        <div className="absolute top-full left-0 mt-1 w-64 bg-zinc-800 border border-zinc-700 rounded-lg shadow-xl z-50 overflow-hidden">
          <button
            onClick={() => selectPreset(null)}
            className={`w-full text-left px-3 py-2 text-xs transition-colors ${
              !activeId ? 'bg-indigo-600/20 text-indigo-300' : 'text-zinc-300 hover:bg-zinc-700'
            }`}
          >
            Default
          </button>

          {presets.map((p) => (
            <div
              key={p.id}
              className={`flex items-center justify-between px-3 py-2 transition-colors ${
                activeId === p.id ? 'bg-indigo-600/20' : 'hover:bg-zinc-700'
              }`}
            >
              <button
                onClick={() => selectPreset(p.id)}
                className={`text-xs text-left flex-1 truncate ${
                  activeId === p.id ? 'text-indigo-300' : 'text-zinc-300'
                }`}
              >
                {p.name}
              </button>
              <button
                onClick={() => deletePreset(p.id)}
                className="text-zinc-500 hover:text-red-400 ml-2 p-0.5"
                title="Delete preset"
              >
                <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                  <path d="M18 6 6 18M6 6l12 12" />
                </svg>
              </button>
            </div>
          ))}

          {creating ? (
            <div className="p-3 border-t border-zinc-700 space-y-2">
              <input
                type="text"
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                placeholder="Preset name"
                className="w-full bg-zinc-900 border border-zinc-600 rounded px-2 py-1 text-xs text-zinc-100 outline-none focus:border-indigo-500"
                autoFocus
              />
              <textarea
                value={newPrompt}
                onChange={(e) => setNewPrompt(e.target.value)}
                placeholder="Instructions for this mode..."
                rows={3}
                className="w-full bg-zinc-900 border border-zinc-600 rounded px-2 py-1 text-xs text-zinc-100 outline-none focus:border-indigo-500 resize-none"
              />
              <div className="flex gap-2">
                <button
                  onClick={createPreset}
                  disabled={!newName.trim() || !newPrompt.trim()}
                  className="flex-1 bg-indigo-600 text-white text-xs py-1 rounded hover:bg-indigo-500 disabled:opacity-40"
                >
                  Save
                </button>
                <button
                  onClick={() => { setCreating(false); setNewName(''); setNewPrompt(''); }}
                  className="flex-1 bg-zinc-700 text-zinc-300 text-xs py-1 rounded hover:bg-zinc-600"
                >
                  Cancel
                </button>
              </div>
            </div>
          ) : (
            <button
              onClick={() => setCreating(true)}
              className="w-full text-left px-3 py-2 text-xs text-indigo-400 hover:bg-zinc-700 border-t border-zinc-700 transition-colors"
            >
              + New preset
            </button>
          )}
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Add PresetPicker and quick-action chips to ChatBot**

In `src/ui/components/chat/ChatBot.tsx`, add import:

```ts
import { PresetPicker } from './PresetPicker';
```

In the `ChatHeader` component, add `<PresetPicker />` inside the header's left `<div>` (around line 140), after the `SessionPicker` closing:

```tsx
        <PresetPicker />
```

Replace `SUGGESTION_CHIPS` (lines 178-182) with:

```ts
interface QuickAction {
  label: string;
  prompt: string;
  partial?: boolean;
}

const QUICK_ACTIONS: QuickAction[] = [
  { label: 'Index my notes', prompt: 'Please index my notes folder now.' },
  { label: 'Find duplicates', prompt: 'Find potential duplicate entities in my graph.' },
  { label: 'What do I know about...', prompt: 'What do I know about ', partial: true },
  { label: 'Summarize recent pages', prompt: 'Summarize the pages I\'ve recently extracted.' },
  { label: 'Find connections', prompt: 'Find connections between ', partial: true },
];
```

Update chip rendering (lines 205-213) to use `QUICK_ACTIONS`:

```tsx
          <div className="flex flex-wrap gap-2 justify-center">
            {QUICK_ACTIONS.map((action) => (
              <button
                key={action.label}
                onClick={() => onSuggestionClick(action.prompt)}
                className="px-3 py-1.5 text-xs bg-zinc-800 border border-zinc-700 text-zinc-400 rounded-full hover:border-indigo-500/50 hover:text-zinc-200 transition-colors"
              >
                {action.label}
              </button>
            ))}
          </div>
```

- [ ] **Step 3: Verify full build**

Run: `npm run build && npm run build:electron 2>&1 | tail -5`
Expected: both succeed

- [ ] **Step 4: Commit**

```
git add src/ui/components/chat/PresetPicker.tsx src/ui/components/chat/ChatBot.tsx
git commit -m "feat(harness): add PresetPicker and quick-action chips to chat UI"
```

---

### Task 8: Final Verification

- [ ] **Step 1: Full build**

Run: `npm run build && npm run build:electron`
Expected: both succeed with no errors

- [ ] **Step 2: Manual functional test (Electron)**

Run: `npx electron .`

1. Open Settings → verify "Custom Instructions" section with textarea
2. Type instructions, click Save, reopen settings → instructions persist
3. Open Chat → verify PresetPicker dropdown in header
4. Create a preset with name + prompt → appears in dropdown
5. Select preset, send message → agent response reflects preset instructions
6. Quick-action chips visible in empty chat state
7. Click "Index my notes" → pre-fills input
8. Send "Index my notes folder" → tool executes (requires connected folder)
9. All existing chat tools still work (search, create node, etc.)
