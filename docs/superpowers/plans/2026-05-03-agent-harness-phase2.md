# Agent Harness Phase 2: Memory System

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add persistent semantic memory (user facts/preferences extracted from conversations) and a memory management UI. The agent learns from conversations and uses accumulated knowledge in future sessions.

**Architecture:** Post-turn LLM extraction (fire-and-forget, Haiku model) stores categorized facts in SQLite. Memory is injected into the system prompt via the prompt assembler built in Phase 1. Memory UI is a new section in the Settings modal. DB integration follows the existing DataStore → action-handler → db-client chain.

**Tech Stack:** TypeScript, React 19, Zustand, SQLite, Anthropic API (Haiku for extraction)

**Spec:** `docs/superpowers/specs/2026-05-03-agent-harness-design.md` — Section 3

**Depends on:** Phase 1 complete (prompt-assembler.ts, chat-tool-registry, migration 008)

---

### Task 1: Memory Query Module

**Files:**
- Create: `src/db/worker/queries/memory-queries.ts`

- [ ] **Step 1: Create memory queries**

```ts
// src/db/worker/queries/memory-queries.ts
import { executeQuery, executeExec } from '../query-executor';

export interface SemanticMemory {
  id: string;
  category: string;
  content: string;
  source_session_id: string | null;
  created_at: string;
  updated_at: string;
}

export interface EpisodicMemory {
  id: string;
  session_id: string;
  summary: string;
  key_topics: string | null;
  created_at: string;
}

function generateId(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return Array.from(bytes).map((b) => b.toString(16).padStart(2, '0')).join('');
}

export async function addSemantic(input: {
  category: string;
  content: string;
  sourceSessionId?: string;
}): Promise<SemanticMemory> {
  const id = generateId();
  const { rows } = await executeQuery<SemanticMemory>(
    `INSERT INTO memory_semantic (id, category, content, source_session_id)
     VALUES (?, ?, ?, ?)
     RETURNING *;`,
    [id, input.category, input.content, input.sourceSessionId ?? null],
  );
  return rows[0];
}

export async function getAllSemantic(): Promise<SemanticMemory[]> {
  const { rows } = await executeQuery<SemanticMemory>(
    'SELECT * FROM memory_semantic ORDER BY updated_at DESC;',
  );
  return rows;
}

export async function getRecentSemantic(limit = 20): Promise<SemanticMemory[]> {
  const { rows } = await executeQuery<SemanticMemory>(
    'SELECT * FROM memory_semantic ORDER BY updated_at DESC LIMIT ?;',
    [limit],
  );
  return rows;
}

export async function deleteSemantic(id: string): Promise<boolean> {
  const { changes } = await executeExec(
    'DELETE FROM memory_semantic WHERE id = ?;',
    [id],
  );
  return changes > 0;
}

export async function clearAllSemantic(): Promise<number> {
  const { changes } = await executeExec('DELETE FROM memory_semantic;');
  return changes;
}

export async function findDuplicateSemantic(content: string): Promise<SemanticMemory | null> {
  const normalised = content.toLowerCase().trim();
  const { rows } = await executeQuery<SemanticMemory>(
    'SELECT * FROM memory_semantic WHERE LOWER(TRIM(content)) = ? LIMIT 1;',
    [normalised],
  );
  return rows[0] ?? null;
}

export async function touchSemantic(id: string): Promise<void> {
  await executeExec(
    `UPDATE memory_semantic SET updated_at = datetime('now') WHERE id = ?;`,
    [id],
  );
}

export async function addEpisodic(input: {
  sessionId: string;
  summary: string;
  keyTopics?: string[];
}): Promise<EpisodicMemory> {
  const id = generateId();
  const { rows } = await executeQuery<EpisodicMemory>(
    `INSERT INTO memory_episodic (id, session_id, summary, key_topics)
     VALUES (?, ?, ?, ?)
     RETURNING *;`,
    [id, input.sessionId, input.summary, input.keyTopics ? JSON.stringify(input.keyTopics) : null],
  );
  return rows[0];
}

export async function getRecentEpisodic(limit = 3): Promise<EpisodicMemory[]> {
  const { rows } = await executeQuery<EpisodicMemory>(
    'SELECT * FROM memory_episodic ORDER BY created_at DESC LIMIT ?;',
    [limit],
  );
  return rows;
}

export async function clearAllEpisodic(): Promise<number> {
  const { changes } = await executeExec('DELETE FROM memory_episodic;');
  return changes;
}
```

- [ ] **Step 2: Verify build**

Run: `npx tsc --noEmit`
Expected: no errors

- [ ] **Step 3: Commit**

```
git add src/db/worker/queries/memory-queries.ts
git commit -m "feat(harness): add memory query module for semantic and episodic storage"
```

---

### Task 2: Wire Memory Queries into Action Handler + DB Client

**Files:**
- Modify: `src/db/worker/action-handler.ts`
- Modify: `src/db/client/db-client.ts`

This follows the exact pattern used by `chat.*` — add cases to the action handler, add a namespace to the DB client.

- [ ] **Step 1: Add memory actions to action-handler.ts**

Add import at top of `src/db/worker/action-handler.ts`:

```ts
import * as memoryQueries from './queries/memory-queries';
```

Add the following cases in the `handleAction` switch statement (alongside the existing `chat.*` cases):

```ts
    case 'memory.addSemantic':
      return memoryQueries.addSemantic(payload);
    case 'memory.getAllSemantic':
      return memoryQueries.getAllSemantic();
    case 'memory.getRecentSemantic':
      return memoryQueries.getRecentSemantic(payload?.limit);
    case 'memory.deleteSemantic':
      return memoryQueries.deleteSemantic(payload.id);
    case 'memory.clearAllSemantic':
      return memoryQueries.clearAllSemantic();
    case 'memory.findDuplicate':
      return memoryQueries.findDuplicateSemantic(payload.content);
    case 'memory.touchSemantic':
      return memoryQueries.touchSemantic(payload.id);
    case 'memory.addEpisodic':
      return memoryQueries.addEpisodic(payload);
    case 'memory.getRecentEpisodic':
      return memoryQueries.getRecentEpisodic(payload?.limit);
    case 'memory.clearAllEpisodic':
      return memoryQueries.clearAllEpisodic();
```

- [ ] **Step 2: Add memory namespace to db-client.ts**

In `src/db/client/db-client.ts`, add a `memory` namespace following the `chat` pattern:

```ts
export const memory = {
  addSemantic: (input: { category: string; content: string; sourceSessionId?: string }) =>
    dbRequest('memory.addSemantic', input),
  getAllSemantic: () =>
    dbRequest('memory.getAllSemantic'),
  getRecentSemantic: (limit?: number) =>
    dbRequest('memory.getRecentSemantic', { limit }),
  deleteSemantic: (id: string) =>
    dbRequest('memory.deleteSemantic', { id }),
  clearAllSemantic: () =>
    dbRequest('memory.clearAllSemantic'),
  findDuplicate: (content: string) =>
    dbRequest('memory.findDuplicate', { content }),
  touchSemantic: (id: string) =>
    dbRequest('memory.touchSemantic', { id }),
  addEpisodic: (input: { sessionId: string; summary: string; keyTopics?: string[] }) =>
    dbRequest('memory.addEpisodic', input),
  getRecentEpisodic: (limit?: number) =>
    dbRequest('memory.getRecentEpisodic', { limit }),
  clearAllEpisodic: () =>
    dbRequest('memory.clearAllEpisodic'),
};
```

- [ ] **Step 3: Verify build**

Run: `npx tsc --noEmit`
Expected: no errors

- [ ] **Step 4: Commit**

```
git add src/db/worker/action-handler.ts src/db/client/db-client.ts
git commit -m "feat(harness): wire memory queries into action handler and db client"
```

---

### Task 3: Memory Extractor

**Files:**
- Create: `src/core/memory-extractor.ts`

- [ ] **Step 1: Create memory extractor**

```ts
// src/core/memory-extractor.ts
import { llm } from '@platform';
import { memory } from '../db/client/db-client';

const MEMORY_EXTRACTION_PROMPT = `You extract facts about the user from a conversation exchange. Return a JSON array of objects with "category" and "content" fields. Categories:
- "preference": how the user likes things done (tone, format, depth, topics of interest)
- "fact": concrete facts about the user (role, expertise, projects, location, etc.)
- "instruction": explicit behavioral directives the user gave ("always do X", "never do Y")

Rules:
- Only extract information explicitly stated or strongly implied by the user's message
- Do NOT extract information from the assistant's response
- Each item should be a self-contained statement (e.g., "User is a data scientist" not "data scientist")
- If nothing is worth remembering, return an empty array []
- Maximum 3 items per exchange
- Return ONLY the JSON array, no other text`;

export async function extractSemanticMemories(
  userMessage: string,
  assistantResponse: string,
  sessionId: string,
): Promise<void> {
  try {
    const requestId = crypto.randomUUID();
    const result = await llm.streamChat(
      {
        requestId,
        model: 'claude-haiku-4-20250414',
        systemPrompt: MEMORY_EXTRACTION_PROMPT,
        messages: [
          {
            role: 'user',
            content: `User message:\n${userMessage}\n\nAssistant response:\n${assistantResponse.substring(0, 2000)}`,
          },
        ],
        tools: [],
      },
      () => {},
    );

    const text = result.textContent?.trim();
    if (!text) return;

    let items: Array<{ category: string; content: string }>;
    try {
      items = JSON.parse(text);
    } catch {
      return;
    }

    if (!Array.isArray(items) || items.length === 0) return;

    for (const item of items.slice(0, 3)) {
      if (!item.category || !item.content) continue;
      if (!['preference', 'fact', 'instruction'].includes(item.category)) continue;

      const existing = await memory.findDuplicate(item.content);
      if (existing) {
        await memory.touchSemantic((existing as any).id);
      } else {
        await memory.addSemantic({
          category: item.category,
          content: item.content,
          sourceSessionId: sessionId,
        });
      }
    }
  } catch (e) {
    console.warn('[MemoryExtractor] Extraction failed (non-blocking):', e);
  }
}
```

- [ ] **Step 2: Verify build**

Run: `npx tsc --noEmit`
Expected: no errors

- [ ] **Step 3: Commit**

```
git add src/core/memory-extractor.ts
git commit -m "feat(harness): add post-turn semantic memory extractor"
```

---

### Task 4: Hook Memory Extraction into useChatSession

**Files:**
- Modify: `src/ui/hooks/useChatSession.ts`

- [ ] **Step 1: Add memory extraction after assistant message save**

Add import at top:

```ts
import { extractSemanticMemories } from '../../core/memory-extractor';
```

After the `chat.saveMessage()` for the assistant response (around line 161-167), add a fire-and-forget extraction call:

```ts
      // Save assistant message to DB (final text only, no tool call details)
      await chat.saveMessage({
        id: assistantId,
        sessionId,
        role: 'assistant',
        content: finalText,
        status: 'complete',
      });

      // Fire-and-forget: extract semantic memories from this exchange
      extractSemanticMemories(input, finalText, sessionId).catch(() => {});
```

- [ ] **Step 2: Verify build**

Run: `npx tsc --noEmit`
Expected: no errors

- [ ] **Step 3: Commit**

```
git add src/ui/hooks/useChatSession.ts
git commit -m "feat(harness): hook memory extraction into post-turn flow"
```

---

### Task 5: Add Memory Retrieval to Prompt Assembly

**Files:**
- Modify: `src/ui/hooks/useChatSession.ts`

- [ ] **Step 1: Fetch memories when assembling prompt**

In `useChatSession.ts`, update the prompt assembly block (added in Phase 1, Task 8) to include memory retrieval. Add import:

```ts
import { memory as memoryDb } from '../../db/client/db-client';
```

Update the prompt assembly section in `sendMessage` to fetch memories:

```ts
      // Assemble system prompt with harness context
      const storageData = await storage.get(['harnessGlobalInstructions', 'harnessPresets', 'harnessActivePresetId']);
      const globalInstructions = (storageData as any).harnessGlobalInstructions ?? null;
      const presets = (storageData as any).harnessPresets ?? [];
      const activePresetId = (storageData as any).harnessActivePresetId ?? null;
      const activePreset = activePresetId
        ? presets.find((p: any) => p.id === activePresetId)
        : null;

      // Fetch memories from DB
      const semanticMemories = await memoryDb.getRecentSemantic(20) as Array<{ category: string; content: string }>;
      const episodicSummaries = await memoryDb.getRecentEpisodic(3) as Array<{ summary: string }>;

      const systemPrompt = assembleSystemPrompt({
        globalInstructions,
        presetPrompt: activePreset?.prompt ?? null,
        presetName: activePreset?.name ?? null,
        semanticMemories,
        recentSessionSummaries: episodicSummaries,
      });
```

- [ ] **Step 2: Verify build**

Run: `npx tsc --noEmit`
Expected: no errors

- [ ] **Step 3: Commit**

```
git add src/ui/hooks/useChatSession.ts
git commit -m "feat(harness): inject semantic memories into prompt assembly"
```

---

### Task 6: Memory Management UI

**Files:**
- Create: `src/ui/components/settings/MemorySection.tsx`
- Modify: `src/ui/components/settings/SettingsPanel.tsx`

- [ ] **Step 1: Create MemorySection component**

```tsx
// src/ui/components/settings/MemorySection.tsx
import { useState, useEffect } from 'react';
import { memory } from '../../../db/client/db-client';

interface SemanticMemory {
  id: string;
  category: string;
  content: string;
  created_at: string;
  updated_at: string;
}

const CATEGORY_COLORS: Record<string, string> = {
  preference: 'bg-blue-900/40 text-blue-300 border-blue-800/50',
  fact: 'bg-emerald-900/40 text-emerald-300 border-emerald-800/50',
  instruction: 'bg-amber-900/40 text-amber-300 border-amber-800/50',
};

export function MemorySection() {
  const [memories, setMemories] = useState<SemanticMemory[]>([]);
  const [loading, setLoading] = useState(true);
  const [clearing, setClearing] = useState(false);

  const refresh = async () => {
    try {
      const all = await memory.getAllSemantic() as SemanticMemory[];
      setMemories(all);
    } catch {
      setMemories([]);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { refresh(); }, []);

  const handleDelete = async (id: string) => {
    await memory.deleteSemantic(id);
    setMemories((prev) => prev.filter((m) => m.id !== id));
  };

  const handleClearAll = async () => {
    await memory.clearAllSemantic();
    await memory.clearAllEpisodic();
    setMemories([]);
    setClearing(false);
  };

  const grouped = {
    preference: memories.filter((m) => m.category === 'preference'),
    fact: memories.filter((m) => m.category === 'fact'),
    instruction: memories.filter((m) => m.category === 'instruction'),
  };

  return (
    <div className="border-t border-zinc-700 pt-4 mt-4">
      <h4 className="text-xs font-medium text-zinc-400 mb-2">Agent Memory</h4>
      <p className="text-[10px] text-zinc-600 mb-3">
        Facts the agent has learned about you from conversations. These are included in every chat session.
      </p>

      {loading ? (
        <p className="text-xs text-zinc-500">Loading...</p>
      ) : memories.length === 0 ? (
        <p className="text-xs text-zinc-500">No memories yet. The agent will learn about you as you chat.</p>
      ) : (
        <div className="space-y-3">
          {(['preference', 'fact', 'instruction'] as const).map((category) => {
            const items = grouped[category];
            if (items.length === 0) return null;
            return (
              <div key={category}>
                <p className="text-[10px] font-medium text-zinc-500 uppercase tracking-wide mb-1">
                  {category}s ({items.length})
                </p>
                <div className="space-y-1">
                  {items.map((m) => (
                    <div
                      key={m.id}
                      className={`flex items-start justify-between gap-2 px-2 py-1.5 rounded border text-xs ${
                        CATEGORY_COLORS[m.category] ?? 'bg-zinc-800 text-zinc-300 border-zinc-700'
                      }`}
                    >
                      <span className="flex-1 min-w-0">{m.content}</span>
                      <button
                        onClick={() => handleDelete(m.id)}
                        className="shrink-0 p-0.5 opacity-50 hover:opacity-100 transition-opacity"
                        title="Delete memory"
                      >
                        <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                          <path d="M18 6 6 18M6 6l12 12" />
                        </svg>
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            );
          })}

          {!clearing ? (
            <button
              onClick={() => setClearing(true)}
              className="text-[10px] text-red-400/60 hover:text-red-400 transition-colors"
            >
              Clear all memories
            </button>
          ) : (
            <div className="flex gap-2 items-center">
              <span className="text-[10px] text-red-400">Delete all {memories.length} memories?</span>
              <button
                onClick={handleClearAll}
                className="text-[10px] px-2 py-0.5 bg-red-600 text-white rounded hover:bg-red-500"
              >
                Confirm
              </button>
              <button
                onClick={() => setClearing(false)}
                className="text-[10px] px-2 py-0.5 bg-zinc-700 text-zinc-300 rounded hover:bg-zinc-600"
              >
                Cancel
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Add MemorySection to SettingsPanel**

In `src/ui/components/settings/SettingsPanel.tsx`, add import:

```ts
import { MemorySection } from './MemorySection';
```

Add `<MemorySection />` after `<CustomInstructionsSection />` and before `<UsageSection />`:

```tsx
      <CustomInstructionsSection />

      <MemorySection />

      <UsageSection />
```

- [ ] **Step 3: Verify full build**

Run: `npm run build && npm run build:electron 2>&1 | tail -5`
Expected: both builds succeed

- [ ] **Step 4: Commit**

```
git add src/ui/components/settings/MemorySection.tsx src/ui/components/settings/SettingsPanel.tsx
git commit -m "feat(harness): add Memory management section to Settings"
```

---

### Task 7: Final Verification

- [ ] **Step 1: Full build**

Run: `npm run build && npm run build:electron`
Expected: both succeed

- [ ] **Step 2: Manual functional test**

1. Open the app, start a chat session
2. Send a message like "I'm a machine learning researcher and I prefer concise bullet-point answers"
3. Open Settings → Agent Memory section
4. Verify that within a few seconds, extracted memories appear (e.g., `[fact] User is a machine learning researcher`, `[preference] Prefers concise bullet-point answers`)
5. Start a NEW chat session
6. Send "Tell me about yourself" or similar — verify the agent references your preferences
7. Delete a memory from Settings → verify it no longer appears in subsequent sessions
8. Click "Clear all memories" → confirm all memories are removed
