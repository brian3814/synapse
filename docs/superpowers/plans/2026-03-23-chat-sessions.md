# Chat Session Management Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Persist chat sessions in SQLite so conversations survive panel close/reopen, with 2-hour idle expiry, manual new-session button, and multi-turn LLM context.

**Architecture:** Two new DB tables (`chat_sessions`, `chat_messages`) in the existing initial schema. A new `useChatSession` hook manages the lifecycle (restore/expire/create/save) and wraps the existing streaming logic from `useChatQuery`. The LLM request message protocol gains an optional `messages` array so the offscreen document can build multi-turn API calls.

**Tech Stack:** SQLite (wa-sqlite), React 19, Zustand, Chrome Extension Manifest V3, Anthropic Messages API

**Spec:** `docs/superpowers/specs/2026-03-23-chat-sessions-design.md`

---

### Task 1: Add chat tables to initial schema

**Files:**
- Modify: `src/db/worker/migrations/001-initial-schema.ts`

- [ ] **Step 1: Add chat_sessions and chat_messages tables**

Append to the end of the `up` SQL string, before the closing backtick:

```sql
CREATE TABLE IF NOT EXISTS chat_sessions (
    id              TEXT PRIMARY KEY,
    title           TEXT,
    created_at      TEXT NOT NULL DEFAULT (datetime('now')),
    last_active_at  TEXT NOT NULL DEFAULT (datetime('now')),
    status          TEXT NOT NULL DEFAULT 'active'
);

CREATE TABLE IF NOT EXISTS chat_messages (
    id          TEXT PRIMARY KEY,
    session_id  TEXT NOT NULL REFERENCES chat_sessions(id) ON DELETE CASCADE,
    role        TEXT NOT NULL,
    content     TEXT NOT NULL,
    rag_context TEXT,
    status      TEXT NOT NULL DEFAULT 'complete',
    created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_chat_messages_session ON chat_messages(session_id, created_at);
```

- [ ] **Step 2: Build and verify**

Run: `npm run build`
Expected: Clean build, no errors.

- [ ] **Step 3: Commit**

```bash
git add src/db/worker/migrations/001-initial-schema.ts
git commit -m "schema: add chat_sessions and chat_messages tables"
```

---

### Task 2: Create chat query functions

**Files:**
- Create: `src/db/worker/queries/chat-queries.ts`

- [ ] **Step 1: Write chat-queries.ts**

```typescript
import { executeQuery, executeExec } from '../query-executor';

// --- Session CRUD ---

export async function getActiveSession(): Promise<any | null> {
  const { rows } = await executeQuery<any>(
    `SELECT * FROM chat_sessions
     WHERE status = 'active'
       AND datetime(last_active_at, '+2 hours') > datetime('now')
     ORDER BY last_active_at DESC
     LIMIT 1;`
  );
  return rows[0] ?? null;
}

export async function createSession(id: string, title: string): Promise<any> {
  const { rows } = await executeQuery<any>(
    `INSERT INTO chat_sessions (id, title) VALUES (?, ?) RETURNING *;`,
    [id, title]
  );
  return rows[0];
}

export async function expireSession(id: string): Promise<void> {
  await executeExec(
    `UPDATE chat_sessions SET status = 'expired' WHERE id = ?;`,
    [id]
  );
}

export async function expireAllStaleSessions(): Promise<void> {
  await executeExec(
    `UPDATE chat_sessions SET status = 'expired'
     WHERE status = 'active'
       AND datetime(last_active_at, '+2 hours') <= datetime('now');`
  );
}

export async function touchSession(id: string): Promise<void> {
  await executeExec(
    `UPDATE chat_sessions SET last_active_at = datetime('now') WHERE id = ?;`,
    [id]
  );
}

export async function pruneSessions(maxSessions: number = 10): Promise<void> {
  await executeExec(
    `DELETE FROM chat_sessions WHERE id NOT IN (
       SELECT id FROM chat_sessions ORDER BY created_at DESC LIMIT ?
     );`,
    [maxSessions]
  );
}

// --- Message CRUD ---

export async function saveMessage(input: {
  id: string;
  sessionId: string;
  role: 'user' | 'assistant';
  content: string;
  ragContext?: string | null;
  status: 'complete' | 'error';
}): Promise<any> {
  const { rows } = await executeQuery<any>(
    `INSERT INTO chat_messages (id, session_id, role, content, rag_context, status)
     VALUES (?, ?, ?, ?, ?, ?) RETURNING *;`,
    [input.id, input.sessionId, input.role, input.content, input.ragContext ?? null, input.status]
  );
  return rows[0];
}

export async function getSessionMessages(sessionId: string): Promise<any[]> {
  const { rows } = await executeQuery<any>(
    `SELECT * FROM chat_messages
     WHERE session_id = ?
     ORDER BY created_at ASC;`,
    [sessionId]
  );
  return rows;
}

export async function getRecentMessages(sessionId: string, limit: number = 20): Promise<any[]> {
  const { rows } = await executeQuery<any>(
    `SELECT * FROM (
       SELECT * FROM chat_messages
       WHERE session_id = ? AND status = 'complete'
       ORDER BY created_at DESC LIMIT ?
     ) sub ORDER BY created_at ASC;`,
    [sessionId, limit]
  );
  return rows;
}
```

- [ ] **Step 2: Build and verify**

Run: `npm run build`
Expected: Clean build.

- [ ] **Step 3: Commit**

```bash
git add src/db/worker/queries/chat-queries.ts
git commit -m "feat: add chat session/message query functions"
```

---

### Task 3: Wire chat queries into DB worker + client

**Files:**
- Modify: `src/db/worker/db-worker.ts`
- Modify: `src/db/client/db-client.ts`

- [ ] **Step 1: Add chat action handlers to db-worker.ts**

Add import at the top alongside other query imports:

```typescript
import * as chatQueries from './queries/chat-queries';
```

Add cases inside the `handleAction` switch, before the `default:` case:

```typescript
    // Chat session operations
    case 'chat.getActiveSession': {
      ensureInit();
      return { result: await chatQueries.getActiveSession() };
    }
    case 'chat.createSession': {
      ensureInit();
      const p = params as { id: string; title: string };
      return { result: await chatQueries.createSession(p.id, p.title) };
    }
    case 'chat.expireSession': {
      ensureInit();
      await chatQueries.expireSession(params as string);
      return { result: { success: true } };
    }
    case 'chat.expireStale': {
      ensureInit();
      await chatQueries.expireAllStaleSessions();
      return { result: { success: true } };
    }
    case 'chat.touchSession': {
      ensureInit();
      await chatQueries.touchSession(params as string);
      return { result: { success: true } };
    }
    case 'chat.pruneSessions': {
      ensureInit();
      await chatQueries.pruneSessions();
      return { result: { success: true } };
    }
    case 'chat.saveMessage': {
      ensureInit();
      return { result: await chatQueries.saveMessage(params as any) };
    }
    case 'chat.getMessages': {
      ensureInit();
      return { result: await chatQueries.getSessionMessages(params as string) };
    }
    case 'chat.getRecentMessages': {
      ensureInit();
      const p = params as { sessionId: string; limit?: number };
      return { result: await chatQueries.getRecentMessages(p.sessionId, p.limit) };
    }
```

Also add `chat_sessions` and `chat_messages` to the `clearAll` case:

```typescript
    case 'clearAll': {
      ensureInit();
      await executeExec('DELETE FROM edges');
      await executeExec('DELETE FROM nodes');
      await executeExec('DELETE FROM chat_messages');
      await executeExec('DELETE FROM chat_sessions');
      return { result: { success: true }, syncEvent: { type: 'reset' } };
    }
```

- [ ] **Step 2: Add chat client methods to db-client.ts**

Add after the existing `readingList` namespace:

```typescript
// Chat session operations
export const chat = {
  getActiveSession: () =>
    sendRequest('chat.getActiveSession') as Promise<any | null>,
  createSession: (id: string, title: string) =>
    sendRequest('chat.createSession', { id, title }) as Promise<any>,
  expireSession: (id: string) =>
    sendRequest('chat.expireSession', id) as Promise<{ success: boolean }>,
  expireStale: () =>
    sendRequest('chat.expireStale') as Promise<{ success: boolean }>,
  touchSession: (id: string) =>
    sendRequest('chat.touchSession', id) as Promise<{ success: boolean }>,
  pruneSessions: () =>
    sendRequest('chat.pruneSessions') as Promise<{ success: boolean }>,
  saveMessage: (input: {
    id: string;
    sessionId: string;
    role: 'user' | 'assistant';
    content: string;
    ragContext?: string | null;
    status: 'complete' | 'error';
  }) => sendRequest('chat.saveMessage', input) as Promise<any>,
  getMessages: (sessionId: string) =>
    sendRequest('chat.getMessages', sessionId) as Promise<any[]>,
  getRecentMessages: (sessionId: string, limit?: number) =>
    sendRequest('chat.getRecentMessages', { sessionId, limit }) as Promise<any[]>,
};
```

- [ ] **Step 3: Build and verify**

Run: `npm run build`
Expected: Clean build.

- [ ] **Step 4: Commit**

```bash
git add src/db/worker/db-worker.ts src/db/client/db-client.ts
git commit -m "feat: wire chat session DB operations through worker + client"
```

---

### Task 4: Add multi-turn messages to LLM request protocol

**Files:**
- Modify: `src/shared/messages.ts`
- Modify: `src/offscreen/llm-executor.ts`

The service worker's `message-router.ts` already spreads the full payload with `{ ...(message as any).payload, apiKey }`, so the `messages` array passes through automatically — no change needed there.

- [ ] **Step 1: Update message types in messages.ts**

Add `messages` to the `LLMRequestMessage` payload:

```typescript
// UI -> Service worker (no apiKey — key is injected by the SW before forwarding to offscreen)
export interface LLMRequestMessage extends ExtensionMessage {
  type: 'LLM_REQUEST';
  payload: {
    provider: string;
    model: string;
    prompt: string;
    systemPrompt?: string;
    messages?: Array<{ role: 'user' | 'assistant'; content: string }>;
  };
}
```

`LLMRequestWithKeyMessage` inherits via `LLMRequestMessage['payload'] & { apiKey: string }` so it picks up `messages` automatically.

- [ ] **Step 2: Update streamAnthropic in llm-executor.ts**

Modify the `executeLLMRequestStreaming` function to pass messages through:

```typescript
export async function executeLLMRequestStreaming(
  payload: LLMRequestWithKeyMessage['payload'],
  onChunk: (text: string, done: boolean) => void
): Promise<{ content: string }> {
  return await streamAnthropic(
    payload.apiKey, payload.model, payload.prompt, onChunk,
    payload.systemPrompt, payload.messages
  );
}
```

Modify `streamAnthropic` to accept and use the messages array:

```typescript
async function streamAnthropic(
  apiKey: string,
  model: string,
  userPrompt: string,
  onChunk: (text: string, done: boolean) => void,
  customSystemPrompt?: string,
  priorMessages?: Array<{ role: 'user' | 'assistant'; content: string }>
): Promise<{ content: string }> {
  const systemPrompt = customSystemPrompt ?? EXTRACTION_SYSTEM_PROMPT;
  const userContent = customSystemPrompt
    ? userPrompt
    : `Extract entities and relationships from the following text:\n\n${userPrompt}`;

  // Build messages array: prior conversation history + current prompt
  const messages: Array<{ role: string; content: string }> = [];
  if (priorMessages && priorMessages.length > 0) {
    messages.push(...priorMessages);
  }
  messages.push({ role: 'user', content: userContent });

  const response = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(apiKey.startsWith('sk-ant-')
        ? { 'x-api-key': apiKey, 'anthropic-dangerous-direct-browser-access': 'true' }
        : { 'Authorization': `Bearer ${apiKey}` }),
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model,
      max_tokens: 4096,
      system: systemPrompt,
      messages,
      stream: true,
    }),
  });
```

The rest of `streamAnthropic` (SSE parsing, accumulation) stays unchanged.

- [ ] **Step 3: Build and verify**

Run: `npm run build`
Expected: Clean build. Existing extraction calls still work (they don't pass `messages`, so `priorMessages` is `undefined` and the array has only the current prompt — same as before).

- [ ] **Step 4: Commit**

```bash
git add src/shared/messages.ts src/offscreen/llm-executor.ts
git commit -m "feat: add multi-turn messages support to LLM request protocol"
```

---

### Task 5: Create useChatSession hook

**Files:**
- Create: `src/ui/hooks/useChatSession.ts`

This hook orchestrates the full session lifecycle. It replaces `useChatQuery` as the interface consumed by `ChatBot.tsx`.

- [ ] **Step 1: Write useChatSession.ts**

```typescript
import { useState, useCallback, useEffect, useRef } from 'react';
import { chat } from '../../db/client/db-client';
import { streamFromOffscreen, fetchLLMConfigAndTypes } from './nl-query-utils';
import { retrieveRAGContext, formatRAGPrompt, RAG_SYSTEM_PROMPT, type RAGContext } from './rag-pipeline';

type MessageStatus = 'complete' | 'streaming' | 'executing' | 'error';

export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  ragContext?: RAGContext | null;
  error?: string;
  status: MessageStatus;
}

interface CompactRAGContext {
  nodeCount: number;
  edgeCount: number;
  nodeLabels: string[];
  sourceUrls: string[];
}

function compactifyRAG(ctx: RAGContext): string {
  const compact: CompactRAGContext = {
    nodeCount: ctx.relevantNodes.length,
    edgeCount: ctx.relevantEdges.length,
    nodeLabels: ctx.relevantNodes.slice(0, 10).map((n) => n.name),
    sourceUrls: ctx.sourceExcerpts.map((s) => s.url),
  };
  return JSON.stringify(compact);
}

const MAX_HISTORY_MESSAGES = 20;

export function useChatSession() {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [isProcessing, setIsProcessing] = useState(false);
  const [sessionReady, setSessionReady] = useState(false);
  const sessionIdRef = useRef<string | null>(null);

  // On mount: restore active session or start fresh
  useEffect(() => {
    let cancelled = false;

    async function init() {
      try {
        // Expire any stale sessions first
        await chat.expireStale();

        const session = await chat.getActiveSession();
        if (session && !cancelled) {
          sessionIdRef.current = session.id;
          const dbMessages = await chat.getMessages(session.id);
          const restored: ChatMessage[] = dbMessages.map((m: any) => ({
            id: m.id,
            role: m.role,
            content: m.content,
            ragContext: m.rag_context ? parseCompactRAG(m.rag_context) : null,
            status: m.status as MessageStatus,
          }));
          setMessages(restored);
        }
      } catch (e) {
        console.error('[useChatSession] Failed to restore session:', e);
      }
      if (!cancelled) setSessionReady(true);
    }

    init();
    return () => { cancelled = true; };
  }, []);

  const ensureSession = useCallback(async (firstMessage: string): Promise<string> => {
    if (sessionIdRef.current) return sessionIdRef.current;

    const id = crypto.randomUUID();
    const title = firstMessage.slice(0, 100);
    await chat.createSession(id, title);
    await chat.pruneSessions();
    sessionIdRef.current = id;
    return id;
  }, []);

  const updateMessage = (id: string, updates: Partial<ChatMessage>) => {
    setMessages((prev) => prev.map((m) => (m.id === id ? { ...m, ...updates } : m)));
  };

  const sendMessage = useCallback(async (input: string) => {
    if (isProcessing) return;
    setIsProcessing(true);

    const userMsgId = crypto.randomUUID();
    const userMsg: ChatMessage = {
      id: userMsgId,
      role: 'user',
      content: input,
      status: 'complete',
    };

    const assistantId = crypto.randomUUID();
    const assistantMsg: ChatMessage = {
      id: assistantId,
      role: 'assistant',
      content: '',
      status: 'streaming',
    };

    setMessages((prev) => [...prev, userMsg, assistantMsg]);

    try {
      const sessionId = await ensureSession(input);

      // Load conversation history BEFORE saving current message (avoids save + filter round-trip)
      const recentMessages = await chat.getRecentMessages(sessionId, MAX_HISTORY_MESSAGES);
      const historyForLLM = recentMessages
        .map((m: any) => ({ role: m.role as 'user' | 'assistant', content: m.content }));

      // Save user message to DB
      await chat.saveMessage({
        id: userMsgId,
        sessionId,
        role: 'user',
        content: input,
        status: 'complete',
      });

      // RAG retrieval
      updateMessage(assistantId, { content: 'Searching knowledge graph...', status: 'executing' });
      const ragContext = await retrieveRAGContext(input);
      const hasContext = ragContext.relevantNodes.length > 0;

      updateMessage(assistantId, {
        content: '',
        status: 'streaming',
        ragContext: hasContext ? ragContext : null,
      });

      // LLM request
      // Note: historyForLLM contains raw user text + assistant responses.
      // The current prompt may contain RAG context (entity/relationship data).
      // This asymmetry is intentional — RAG context is per-turn retrieval,
      // not replayed from history, to avoid stale/duplicated graph data.
      const { config } = await fetchLLMConfigAndTypes();
      const prompt = hasContext ? formatRAGPrompt(ragContext) : input;
      const requestId = crypto.randomUUID();

      chrome.runtime.sendMessage({
        type: 'LLM_REQUEST',
        requestId,
        payload: {
          provider: config.provider,
          model: config.model,
          prompt,
          systemPrompt: RAG_SYSTEM_PROMPT,
          messages: historyForLLM.length > 0 ? historyForLLM : undefined,
        },
      });

      const streamResult = await streamFromOffscreen(requestId, (chunk) => {
        setMessages((prev) =>
          prev.map((m) =>
            m.id === assistantId ? { ...m, content: m.content + chunk } : m
          )
        );
      });

      if (streamResult.error) {
        throw new Error(streamResult.error);
      }

      const finalContent = streamResult.content ?? '';
      updateMessage(assistantId, { content: finalContent, status: 'complete' });

      // Save assistant message to DB
      await chat.saveMessage({
        id: assistantId,
        sessionId,
        role: 'assistant',
        content: finalContent,
        ragContext: hasContext ? compactifyRAG(ragContext) : null,
        status: 'complete',
      });

      // Bump session activity
      await chat.touchSession(sessionId);

    } catch (e: any) {
      updateMessage(assistantId, {
        status: 'error',
        error: e.message || 'Query failed',
      });

      // Save error message to DB if we have a session
      if (sessionIdRef.current) {
        await chat.saveMessage({
          id: assistantId,
          sessionId: sessionIdRef.current,
          role: 'assistant',
          content: e.message || 'Query failed',
          status: 'error',
        }).catch(() => {});
      }
    } finally {
      setIsProcessing(false);
    }
  }, [isProcessing, ensureSession]);

  const newSession = useCallback(async () => {
    if (sessionIdRef.current) {
      await chat.expireSession(sessionIdRef.current).catch(() => {});
    }
    sessionIdRef.current = null;
    setMessages([]);
    setIsProcessing(false);
  }, []);

  return { messages, sendMessage, newSession, isProcessing, sessionReady };
}

/** Parse compact RAG JSON back into a minimal RAGContext-like shape for display */
function parseCompactRAG(json: string): RAGContext | null {
  try {
    const compact: CompactRAGContext = JSON.parse(json);
    return {
      relevantNodes: compact.nodeLabels.map((name, i) => ({
        id: `restored-${i}`,
        name,
        type: '',
        identifier: '',
        properties: '{}',
        created_at: '',
        updated_at: '',
      })) as any[],
      relevantEdges: new Array(compact.edgeCount).fill(null) as any[],
      sourceExcerpts: compact.sourceUrls.map((url) => ({
        nodeId: '',
        nodeLabel: '',
        url,
        title: null,
        excerpt: '',
      })),
      query: '',
    };
  } catch {
    return null;
  }
}
```

- [ ] **Step 2: Build and verify**

Run: `npm run build`
Expected: Clean build.

- [ ] **Step 3: Commit**

```bash
git add src/ui/hooks/useChatSession.ts
git commit -m "feat: add useChatSession hook with session lifecycle management"
```

---

### Task 6: Update ChatBot component to use sessions

**Files:**
- Modify: `src/ui/components/chat/ChatBot.tsx`
- Modify: `src/ui/components/chat/ChatMessage.tsx` (update type import)

- [ ] **Step 1: Swap useChatQuery for useChatSession**

Replace the import and hook usage:

```typescript
// Old:
import { useChatQuery } from '../../hooks/useChatQuery';
// New:
import { useChatSession } from '../../hooks/useChatSession';
```

Also update the `ChatMessage` type import in `ChatMessage.tsx` — it currently imports from `useChatQuery`:

```typescript
// Old (in ChatMessage.tsx):
import type { ChatMessage as ChatMessageType } from '../../hooks/useChatQuery';
// New:
import type { ChatMessage as ChatMessageType } from '../../hooks/useChatSession';
```

Replace the hook call in `ChatBot()`:

```typescript
// Old:
const { messages, sendMessage, clearHistory, isProcessing } = useChatQuery();
// New:
const { messages, sendMessage, newSession, isProcessing, sessionReady } = useChatSession();
```

- [ ] **Step 2: Update ChatHeader props**

Change `onClear` to `onNewSession` in `headerProps`:

```typescript
  const headerProps = {
    onClose: toggleChat,
    onNewSession: newSession,
    chatDisplayMode,
    onToggleMode: () => setChatDisplayMode(chatDisplayMode === 'float' ? 'sidebar' : 'float'),
  };
```

Update the `ChatHeader` function signature and the button:

```typescript
function ChatHeader({
  onClose,
  onNewSession,
  chatDisplayMode,
  onToggleMode,
}: {
  onClose: () => void;
  onNewSession: () => void;
  chatDisplayMode: 'float' | 'sidebar';
  onToggleMode: () => void;
}) {
```

Change the trash button to a new-session button:

```typescript
        <button
          onClick={onNewSession}
          title="New session"
          className="p-1 text-zinc-400 hover:text-zinc-200 rounded hover:bg-zinc-700 transition-colors"
        >
          <NewSessionIcon />
        </button>
```

- [ ] **Step 3: Add NewSessionIcon and optional loading state**

Add the icon (a `+` in a chat bubble):

```typescript
const NewSessionIcon = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
    <path d="M12 8v8" /><path d="M8 12h8" />
  </svg>
);
```

Optionally, show a loading state while session is restoring. In the `ChatMessages` component, if `messages.length === 0` and `sessionReady` is false, show "Restoring session..." instead of the empty state. Pass `sessionReady` through as a prop:

```typescript
if (messages.length === 0) {
  return (
    <div className="flex-1 flex items-center justify-center min-h-0">
      <p className="text-zinc-500 text-sm">
        {sessionReady ? 'Ask a question about your graph' : 'Restoring session...'}
      </p>
    </div>
  );
}
```

- [ ] **Step 4: Build and verify**

Run: `npm run build`
Expected: Clean build.

- [ ] **Step 5: Manual test**

1. Load extension in Chrome, open side panel
2. Send a chat message — should work as before
3. Close side panel, reopen — previous messages should be restored
4. Wait 2+ hours (or temporarily change the timeout to 10 seconds for testing) — session should expire, chat starts fresh
5. Click the `+` button — chat clears, next message starts a new session

- [ ] **Step 6: Commit**

```bash
git add src/ui/components/chat/ChatBot.tsx src/ui/components/chat/ChatMessage.tsx
git commit -m "feat: integrate chat sessions into ChatBot with new-session button"
```

---

### Task 7: Clean up

**Files:**
- Possibly remove or keep: `src/ui/hooks/useChatQuery.ts`

- [ ] **Step 1: Check if useChatQuery is used elsewhere**

Search for any remaining imports of `useChatQuery`. If only `ChatBot.tsx` used it (and it's now switched to `useChatSession`), the file can be removed.

If other components import `ChatMessage` type from `useChatQuery`, update them to import from `useChatSession` instead.

- [ ] **Step 2: Remove or keep useChatQuery.ts**

If unused, delete it. If partially used (e.g., the `ChatMessage` type), keep only what's needed.

- [ ] **Step 3: Final build + verify**

Run: `npm run build`
Expected: Clean build, no dead imports.

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "refactor: remove unused useChatQuery after session migration"
```
