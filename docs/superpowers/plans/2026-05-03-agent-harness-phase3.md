# Agent Harness Phase 3: Session Continuity & Polish

> **PARTIALLY SUPERSEDED (2026-05-03):** Task 3 (`search_memories` tool) is superseded by `manage_memory` with `action: 'list'`. See [`2026-05-03-file-based-memory-and-folder-index-design.md`](../specs/2026-05-03-file-based-memory-and-folder-index-design.md). Tasks 1-2 (episodic summarization) remain valid and were already implemented.

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add episodic memory (auto-generated session summaries for continuity across sessions) ~~and a `search_memories` chat tool so the agent can explicitly query its own memory~~ *(search_memories replaced by `manage_memory`)*.

**Architecture:** Episodic summaries are generated on session expiry via a fire-and-forget LLM call, stored in `memory_episodic` (created in Phase 1 migration). The prompt assembler already supports `recentSessionSummaries` — Phase 2 passed empty arrays, this phase fills them. ~~The `search_memories` tool uses the existing tool registry from Phase 1.~~ *Replaced by `manage_memory` tool in the file-based memory spec.*

**Tech Stack:** TypeScript, React 19, SQLite, Anthropic API (Haiku for summarization)

**Spec:** `docs/superpowers/specs/2026-05-03-agent-harness-design.md` — Section 3 (Episodic Memory) + Section 4 (search_memories tool)

**Depends on:** Phase 1 (tool registry, prompt assembler, migration 008) + Phase 2 (memory queries, memory extractor, db-client memory namespace)

---

### Task 1: Session Summarizer

**Files:**
- Modify: `src/core/memory-extractor.ts`

- [ ] **Step 1: Add session summarization function**

Add this function to the bottom of `src/core/memory-extractor.ts`:

```ts
export async function summarizeSession(sessionId: string): Promise<void> {
  try {
    const messages = await (await import('../db/client/db-client')).chat.getRecentMessages(sessionId, 20);
    if (!messages || (messages as any[]).length < 4) return;

    const transcript = (messages as any[])
      .map((m: any) => `${m.role === 'user' ? 'User' : 'Assistant'}: ${m.content.substring(0, 500)}`)
      .join('\n\n');

    const requestId = crypto.randomUUID();
    const result = await llm.streamChat(
      {
        requestId,
        model: 'claude-haiku-4-20250414',
        systemPrompt:
          'Summarize this conversation in 2-3 sentences. Focus on what was discussed, decisions made, and any unresolved questions. Return ONLY the summary text, no JSON.',
        messages: [{ role: 'user', content: transcript }],
        tools: [],
      },
      () => {},
    );

    const summary = result.textContent?.trim();
    if (!summary) return;

    await memory.addEpisodic({
      sessionId,
      summary,
    });
  } catch (e) {
    console.warn('[MemoryExtractor] Session summarization failed (non-blocking):', e);
  }
}
```

- [ ] **Step 2: Verify build**

Run: `npx tsc --noEmit`
Expected: no errors

- [ ] **Step 3: Commit**

```
git add src/core/memory-extractor.ts
git commit -m "feat(harness): add session summarization for episodic memory"
```

---

### Task 2: Hook Summarization into Session Expiry

**Files:**
- Modify: `src/ui/hooks/useChatSession.ts`

- [ ] **Step 1: Add summarization import**

Add to the existing imports from `memory-extractor.ts`:

```ts
import { extractSemanticMemories, summarizeSession } from '../../core/memory-extractor';
```

- [ ] **Step 2: Trigger summarization on session expiry**

In the `newSession` callback (around line 193-200), add summarization before expiring the session:

```ts
  const newSession = useCallback(async () => {
    if (sessionIdRef.current) {
      const expiredId = sessionIdRef.current;
      await chat.expireSession(expiredId).catch(() => {});
      summarizeSession(expiredId).catch(() => {});
    }
    sessionIdRef.current = null;
    setMessages([]);
    setIsProcessing(false);
  }, []);
```

- [ ] **Step 3: Verify build**

Run: `npx tsc --noEmit`
Expected: no errors

- [ ] **Step 4: Commit**

```
git add src/ui/hooks/useChatSession.ts
git commit -m "feat(harness): trigger session summarization on expiry"
```

---

### ~~Task 3: Search Memories Chat Tool~~ — DO NOT EXECUTE

> **SUPERSEDED:** This task is replaced by the `manage_memory` tool (file-based memory design). Do NOT create `search-memories-tool.ts` or `harness-init.ts`. See [`2026-05-03-file-based-memory-and-folder-index-design.md`](../specs/2026-05-03-file-based-memory-and-folder-index-design.md).

**Files:**
- ~~Create: `src/core/harness-tools/search-memories-tool.ts`~~
- ~~Modify: `src/core/harness-init.ts`~~

- [ ] **Step 1: Create search-memories tool**

```ts
// src/core/harness-tools/search-memories-tool.ts
import type { ChatToolRegistration } from '../../shared/chat-tool-registry';
import { memory } from '../../db/client/db-client';

export function createSearchMemoriesTool(): ChatToolRegistration {
  return {
    definition: {
      name: 'search_memories',
      description:
        'Search your memory of what you know about the user — their preferences, facts about them, and past session summaries. Use this when the user asks "what do you remember about me" or when you need to recall prior context.',
      parameters: {
        type: 'object',
        properties: {
          category: {
            type: 'string',
            description: 'Optional filter: "preference", "fact", "instruction", or "all" (default "all")',
          },
        },
        required: [],
      },
      executionContext: 'ui',
    },
    executor: async (input) => {
      const allSemantic = await memory.getAllSemantic() as Array<{
        id: string;
        category: string;
        content: string;
        updated_at: string;
      }>;

      const category = (input.category as string) ?? 'all';
      const filtered = category === 'all'
        ? allSemantic
        : allSemantic.filter((m) => m.category === category);

      const recentEpisodic = await memory.getRecentEpisodic(5) as Array<{
        summary: string;
        created_at: string;
      }>;

      return JSON.stringify({
        semanticMemories: filtered.map((m) => ({
          category: m.category,
          content: m.content,
          lastUsed: m.updated_at,
        })),
        recentSessionSummaries: recentEpisodic.map((e) => ({
          summary: e.summary,
          date: e.created_at,
        })),
        total: filtered.length,
      });
    },
  };
}
```

- [ ] **Step 2: Register in harness-init.ts**

In `src/core/harness-init.ts`, add import:

```ts
import { createSearchMemoriesTool } from './harness-tools/search-memories-tool';
```

Add registration after the `createIndexNotesTool()` call:

```ts
  registerChatTool(createIndexNotesTool());
  registerChatTool(createSearchMemoriesTool());
```

- [ ] **Step 3: Verify build**

Run: `npx tsc --noEmit`
Expected: no errors

- [ ] **Step 4: Commit**

```
git add src/core/harness-tools/search-memories-tool.ts src/core/harness-init.ts
git commit -m "feat(harness): add search_memories chat tool"
```

---

### Task 4: Episodic Summaries in Prompt Assembly

The prompt assembler already accepts `recentSessionSummaries` and formats them. Phase 2 Task 5 already fetches episodic summaries via `memoryDb.getRecentEpisodic(3)`. If that step was implemented correctly, this task is already done.

- [ ] **Step 1: Verify episodic data flows into prompt**

Check `src/ui/hooks/useChatSession.ts` — the prompt assembly section should already have:

```ts
      const episodicSummaries = await memoryDb.getRecentEpisodic(3) as Array<{ summary: string }>;
```

And pass it to `assembleSystemPrompt`:

```ts
        recentSessionSummaries: episodicSummaries,
```

If this is already in place from Phase 2, no code change needed.

- [ ] **Step 2: Verify prompt-assembler.ts handles summaries**

Check that `src/core/prompt-assembler.ts` has the `recentSessionSummaries` rendering:

```ts
  if (ctx.recentSessionSummaries.length > 0) {
    const lines = ctx.recentSessionSummaries.map((s) => `- ${s.summary}`);
    sections.push(`## Recent Context\n${lines.join('\n')}`);
  }
```

If already present from Phase 1, no change needed.

- [ ] **Step 3: Commit (only if changes were needed)**

```
git add src/ui/hooks/useChatSession.ts src/core/prompt-assembler.ts
git commit -m "feat(harness): ensure episodic summaries flow into prompt assembly"
```

---

### Task 5: Final Verification

- [ ] **Step 1: Full build**

Run: `npm run build && npm run build:electron`
Expected: both succeed

- [ ] **Step 2: Manual functional test — episodic memory**

1. Open the app, start a chat session
2. Have a multi-turn conversation (at least 4 messages total — 2 user, 2 assistant)
3. Click "New Session" in the chat header
4. Wait a moment (summarization runs fire-and-forget)
5. Open Settings → Agent Memory section — verify no errors (episodic summaries are not shown in the UI yet, but they're stored)
6. Start the new session and send a message — verify the agent has context about what you discussed previously (it should reference the session summary)

- [ ] **Step 3: Manual functional test — search_memories tool**

1. After having some conversations (so memories exist)
2. Ask the chat agent: "What do you remember about me?"
3. Verify the agent uses the `search_memories` tool
4. Verify it returns both semantic memories and session summaries
5. Ask: "What have we discussed before?" — verify it references episodic summaries

- [ ] **Step 4: End-to-end flow test**

1. Fresh start: clear all memories from Settings
2. Chat: "I'm a frontend developer working on React apps. I prefer TypeScript over JavaScript."
3. Wait for memory extraction → check Settings → verify memories appear
4. New session: "What frameworks should I use?" → verify agent references your preference for React/TypeScript
5. New session: "What do you remember about me?" → verify agent uses search_memories and cites all facts
