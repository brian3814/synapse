# Chat Session Management

## Problem

Chat messages live in React `useState` — lost on every panel close/reload. Each LLM call sends a single prompt with no conversation history, so the model has no memory of prior turns. Users lose context constantly.

## Goals

- Sessions persist across side panel open/close cycles (as long as the browser is running)
- Idle timeout (2 hours) expires stale sessions automatically
- User can manually start a new session when context has rotted
- LLM receives recent conversation history for multi-turn coherence
- Max 10 sessions stored; oldest pruned on new session creation

## Non-Goals (Future)

- Conversation summarization for older turns (schema supports it, not implementing now)
- Custom PKM system prompts / user memory injected at session start
- Embedding-based retrieval over conversation history

## Data Model

New migration file: `src/db/worker/migrations/008-chat-sessions.ts`, registered in `migrations/index.ts`.

```sql
CREATE TABLE IF NOT EXISTS chat_sessions (
  id TEXT PRIMARY KEY,
  title TEXT,                    -- nullable, populated from first user message (useful for future session history UI)
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  last_active_at TEXT NOT NULL DEFAULT (datetime('now')),
  status TEXT NOT NULL DEFAULT 'active'  -- 'active' | 'expired'
);

CREATE TABLE IF NOT EXISTS chat_messages (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL REFERENCES chat_sessions(id) ON DELETE CASCADE,
  role TEXT NOT NULL,            -- 'user' | 'assistant'
  content TEXT NOT NULL,
  rag_context TEXT,              -- compact JSON: {nodeCount, edgeCount, nodeLabels: string[], sourceUrls: string[]}
  status TEXT NOT NULL,          -- 'complete' | 'error' (streaming/executing are UI-only, never persisted)
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_chat_messages_session
  ON chat_messages(session_id, created_at);
```

**Notes:**
- `rag_context` stores a compact summary for display (node count, labels, source URLs) — not the full `RAGContext` object with all node/edge properties and source excerpts. This keeps each row small (~1KB vs ~100KB).
- `title` is nullable, set to the first user message (truncated) on session creation. Useful for a future session picker UI.

## Session Lifecycle

### On Chat Load (component mount)

1. Query for most recent session where `status = 'active'`
2. Check staleness in SQL: `datetime(last_active_at, '+2 hours') > datetime('now')`
3. If found and fresh: **restore** — load its messages, display them
4. If found but stale (>2h): mark `expired`, show empty chat
5. If none found: show empty chat (session created on first message)

### On First Message (lazy creation)

1. Create new `chat_sessions` row (title = first message, truncated to 100 chars)
2. Prune excess sessions: `DELETE FROM chat_sessions WHERE id NOT IN (SELECT id FROM chat_sessions ORDER BY created_at DESC LIMIT 10)` — CASCADE deletes associated messages
3. Save user message, proceed with LLM call

**Race condition note:** The existing `isProcessing` guard in `useChatQuery` (`if (isProcessing) return`) prevents concurrent `sendMessage()` calls. React's batched state updates make double-fire extremely unlikely, but the guard is sufficient.

### On Each Message Completion

1. Save user message to `chat_messages` (role: 'user')
2. Save assistant response to `chat_messages` (role: 'assistant', with compact rag_context if present)
3. Update `last_active_at` on the session
4. Messages are saved only at terminal state (complete/error), not while streaming

### On "New Session" Button

1. Mark current session `expired` (status update, not delete — preserves history)
2. Clear chat view
3. Next message triggers lazy creation of a new session

### On Database Clear (`clearAll`)

The `clearAll` handler in `db-worker.ts` must also delete from `chat_messages` and `chat_sessions` so chat data doesn't persist as orphans after a graph reset.

### Idle Timeout Check

Performed on load only (not a background timer). Uses SQL-side comparison to avoid JS/SQLite timestamp format mismatches:

```sql
SELECT * FROM chat_sessions
WHERE status = 'active'
  AND datetime(last_active_at, '+2 hours') > datetime('now')
ORDER BY last_active_at DESC
LIMIT 1;
```

If this returns no rows, any remaining `active` sessions are expired in bulk.

## LLM Context Strategy

**Truncation-based**: Load the last 20 messages (10 user/assistant pairs) from the active session and send as conversation history. Older messages remain in the DB for display but are not sent to the LLM.

**Message loading query** (oldest-first for correct conversation order):

```sql
SELECT * FROM (
  SELECT * FROM chat_messages
  WHERE session_id = ? AND status = 'complete'
  ORDER BY created_at DESC LIMIT 20
) sub ORDER BY created_at ASC;
```

The per-turn RAG context (knowledge graph search results) is appended to the **current** user message only. It is not duplicated in historical messages sent to the LLM. The `rag_context` column stores a compact summary for UI display (the collapsible "Context: N entities" detail), not for re-injection.

### Message Protocol Change

`LLM_REQUEST` payload gains an optional `messages` array:

```typescript
payload: {
  provider: string;
  model: string;
  prompt: string;              // current user message
  systemPrompt?: string;
  messages?: Array<{           // prior turns from session (max 20)
    role: 'user' | 'assistant';
    content: string;
  }>;
}
```

The offscreen document prepends `messages` before the current prompt when building the API request. If `messages` is absent, behavior is unchanged (backwards compatible).

The same change propagates to `LLM_REQUEST_WITH_KEY` (SW -> offscreen).

**Implementation target:** `src/offscreen/llm-executor.ts`. The `streamAnthropic` function currently hardcodes `messages: [{ role: 'user', content }]`. It needs a new `messages` parameter. Reference pattern: `streamAnthropicWithTools` in the same file already accepts a `messages: AnthropicMessage[]` parameter.

## Architecture: Files Changed/Created

### New Files

| File | Purpose |
|---|---|
| `src/db/worker/migrations/008-chat-sessions.ts` | Migration creating `chat_sessions` and `chat_messages` tables + index |
| `src/db/worker/queries/chat-queries.ts` | All chat session/message CRUD: create session, save message, get active session, load messages (with 20-message window query), expire session, prune excess sessions, bulk expire stale |
| `src/ui/hooks/useChatSession.ts` | Session lifecycle hook. On mount: restore or expire. Wraps existing `useChatQuery` streaming logic. Exposes `sendMessage()`, `newSession()`, `messages`, `isProcessing`. |

### Modified Files

| File | Change |
|---|---|
| `src/db/worker/migrations/index.ts` | Register migration 008 |
| `src/db/worker/db-worker.ts` | Add action handlers for `chat.*` operations, import chat-queries. Add `chat_sessions`/`chat_messages` to `clearAll`. |
| `src/db/client/db-client.ts` | Add `chat` namespace with typed client methods |
| `src/shared/messages.ts` | Add optional `messages` array to `LLMRequestMessage` and `LLMRequestWithKeyMessage` payloads |
| `src/service-worker/index.ts` | Forward `messages` array in LLM_REQUEST -> LLM_REQUEST_WITH_KEY |
| `src/offscreen/llm-executor.ts` | Add `messages` parameter to `streamAnthropic`, build multi-turn messages array when present |
| `src/ui/components/chat/ChatBot.tsx` | Swap `useChatQuery` for `useChatSession`, replace trash icon handler with `newSession()` |

## UI Changes

Minimal:
- Trash icon in `ChatHeader` becomes "New Session" (same position, `+` icon or refresh icon)
- Tooltip changes from "Clear history" to "New session"
- On mount, restored messages render immediately (same `ChatMessage` component)
- Empty state text unchanged: "Ask a question about your graph"

## Edge Cases

- **Panel closed mid-stream**: The streaming message is not saved (only terminal states are persisted). On reload, the last complete exchange is shown. The partial response is lost — acceptable since the user closed the panel.
- **Multiple tabs/panels**: SharedWorker ensures DB consistency. Both see the same active session. If one expires it, the other will see the empty state on next interaction (checked on next `sendMessage()` call, not reactively).
- **DB not ready**: `useChatSession` waits for DB init before attempting to restore. Falls back to empty state if DB fails.
- **No messages in session**: A session with 0 messages (user clicked "New Session" but never typed) gets pruned naturally when the next session is created and the 10-session cap is enforced.
- **Graph reset**: `clearAll` also clears chat tables, so chat doesn't reference deleted nodes.
