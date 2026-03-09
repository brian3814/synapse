# Plan: Add Agent Loop with Streaming LLM Display

## Context

Currently, LLM extraction sends a single non-streaming request and shows only a spinner while waiting. The user wants real-time visibility into the LLM process — streaming responses as they arrive, and a step-based model that can later support multi-step agent loops (tool use, re-prompting, context gathering, etc.).

Partially-built infrastructure exists (message types `LLM_STREAM_CHUNK`/`LLM_RESPONSE`, store method `appendStreamChunk`, `StreamingOutput` component) but was never wired up.

## Architecture: Streaming Flow

```
UI                          SW                       Offscreen
 |-- LLM_REQUEST (w/ id) -->|                           |
 |                          |-- forward to offscreen -->|
 |                          |<- sendResponse (ack) -----|  (immediate)
 |<-- ack ------------------|                           |
 |                          |                           |-- fetch(stream:true)
 |<---- LLM_STREAM_CHUNK ---- broadcast ------- chunk 1 |
 |<---- LLM_STREAM_CHUNK ---- broadcast ------- chunk N |
 |<---- LLM_STREAM_CHUNK ---- broadcast ------- done    |
```

Key design decisions:
- **Fire-and-forget request**: Offscreen calls `sendResponse({ acknowledged: true })` immediately, then streams. This prevents the SW from being held alive for the entire stream duration (avoids the 5-min SW timeout risk).
- **`done: true` is the completion signal**: UI relies on the final `LLM_STREAM_CHUNK` with `done: true` (plus accumulated content or error) to proceed to parsing — NOT `sendResponse`.
- **Chunk batching**: Offscreen buffers stream tokens and broadcasts every ~100 bytes or 50ms (whichever comes first), reducing IPC overhead from hundreds of tiny messages to ~20-30 batched chunks.
- **Keep `response_format`**: OpenAI supports `response_format: { type: 'json_object' }` with streaming. Keep it for reliability.

## Changes by File (8 files)

### 1. `src/shared/types.ts` — Add agent step types
```typescript
type AgentStepStatus = 'pending' | 'running' | 'completed' | 'error';

interface AgentStep {
  id: string;
  label: string;
  status: AgentStepStatus;
  startedAt?: number;
  completedAt?: number;
  error?: string;
  output?: string;        // Streaming output accumulates here
}

interface AgentRun {
  id: string;             // requestId
  steps: AgentStep[];
  currentStepIndex: number;
  status: 'running' | 'completed' | 'error';
  startedAt: number;
  completedAt?: number;
}
```

### 2. `src/shared/messages.ts` — Add `requestId` to LLM_REQUEST, update LLM_STREAM_CHUNK
- Add `requestId: string` to `LLMRequestMessage.payload`
- Update `LLMStreamChunkMessage.payload` to include optional `content` (full accumulated text) and `error` on the final `done: true` chunk

### 3. `src/offscreen/llm-executor.ts` — Enable streaming fetch
- Replace `executeLLMRequest` with `executeLLMRequestStreaming(payload, onChunk)`
- `callOpenAIStreaming`: `stream: true`, keep `response_format`, parse SSE via `response.body.getReader()`, buffer incomplete lines
- `callAnthropicStreaming`: `stream: true`, parse `content_block_delta` / `message_stop` events
- Both return `Promise<{ content: string }>` (accumulated full text)
- `onChunk(text: string, done: boolean)` callback fires for each batch

### 4. `src/offscreen/index.ts` — Fire-and-forget + chunk broadcasting
- On `LLM_REQUEST`: call `sendResponse({ acknowledged: true })` immediately (do NOT return `true` — channel closes after ack)
- Start streaming in background with a chunk buffer helper:
  ```typescript
  function createChunkBuffer(requestId: string) {
    let buffer = '';
    let timer: ReturnType<typeof setTimeout> | null = null;
    const flush = () => {
      if (timer) { clearTimeout(timer); timer = null; }
      if (buffer) {
        const chunk = buffer; buffer = '';
        chrome.runtime.sendMessage({
          type: 'LLM_STREAM_CHUNK',
          payload: { requestId, chunk, done: false }
        }).catch(() => {});
      }
    };
    return {
      add(text: string) { buffer += text; if (buffer.length >= 100) flush(); else if (!timer) timer = setTimeout(flush, 50); },
      done(content: string) { flush(); chrome.runtime.sendMessage({ type: 'LLM_STREAM_CHUNK', payload: { requestId, chunk: '', done: true, content } }).catch(() => {}); },
      error(msg: string) { flush(); chrome.runtime.sendMessage({ type: 'LLM_STREAM_CHUNK', payload: { requestId, chunk: '', done: true, error: msg } }).catch(() => {}); },
    };
  }
  ```
- Wrap `executeLLMRequestStreaming` in try/catch — errors broadcast as `{ done: true, error }` so the UI always gets a terminal signal

### 5. `src/service-worker/message-router.ts` — Add LLM_STREAM_CHUNK no-op
- Add `case 'LLM_STREAM_CHUNK': return;` to prevent the SW from logging "Unknown message type" warnings and attempting to sendResponse for chunk broadcasts

### 6. `src/graph/store/llm-store.ts` — Refactor with agentRun as source of truth
- Add `agentRun: AgentRun | null` to store
- **Remove `streamingOutput`** — streaming output lives solely in `agentRun.steps[current].output`
- **`status` remains a stored field** (not computed). It still drives the LLMPanel's top-level branching (`idle`/`extracting`/`reviewing`/`merging`/`error`). The hook sets it explicitly: `setStatus('extracting')` when starting, `setStatus('reviewing')` when parsing completes. `agentRun` provides the fine-grained step view within `extracting`.
- Change store creator from `(set) =>` to `(set, get) =>` for read access
- Step lifecycle methods (all synchronous, pure state mutations):
  - `startAgentRun(steps: Pick<AgentStep, 'id' | 'label'>[])` → creates `AgentRun` with `crypto.randomUUID()`, all steps `pending`, returns the `id`
  - `advanceStep()` → marks current step `completed` (with `completedAt`), increments `currentStepIndex`, marks next step `running` (with `startedAt`)
  - `completeCurrentStep()` → marks current step `completed` with `completedAt`
  - `failCurrentStep(error: string)` → marks current step `error`, sets `agentRun.status = 'error'`
  - `appendToCurrentStep(chunk: string)` → appends to `steps[currentStepIndex].output`
- `reset()` clears `agentRun: null` along with existing fields

### 7. `src/ui/hooks/useLLMExtraction.ts` — Orchestrate as step pipeline + stream listener
- **Stream listener lives here** (not in store — keeps store pure), following the same pattern as `registerQueryMessageHandler`
- Core streaming helper function (inside the hook):
  ```typescript
  function streamFromOffscreen(requestId: string, llm: LLMStore): Promise<{ content?: string; error?: string }> {
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => { cleanup(); reject(new Error('LLM stream timed out after 120s')); }, 120_000);
      const listener = (message: any) => {
        if (message.type !== 'LLM_STREAM_CHUNK' || message.payload?.requestId !== requestId) return;
        const { chunk, done, content, error } = message.payload;
        if (chunk) llm.appendToCurrentStep(chunk);
        if (done) { cleanup(); resolve({ content, error }); }
      };
      const cleanup = () => { clearTimeout(timeout); chrome.runtime.onMessage.removeListener(listener); };
      chrome.runtime.onMessage.addListener(listener);
    });
  }
  ```
- `startExtraction` flow:
  1. Generate `requestId` via `startAgentRun([...])` (returns the run id)
  2. `setStatus('extracting')`, advance step 0 to `running`
  3. Send `LLM_REQUEST` with `requestId` (fire-and-forget, ignore ack response)
  4. `await streamFromOffscreen(requestId, llm)` — resolves when `done: true` arrives (or rejects on 120s timeout)
  5. `completeCurrentStep()`, advance to step 1 (`"Parsing response"`)
  6. Parse JSON, validate with Zod, build diff (unchanged logic)
  7. `completeCurrentStep()`, `setStatus('reviewing')`
  8. On any error: `failCurrentStep(error)`, `setError(error)`
- `applyDiff` unchanged

### 8. `src/ui/components/llm/LLMPanel.tsx` — Step timeline + streaming display
- Replace the `extracting` spinner with an inline `AgentRunView`:
  - Step list: each step gets a status icon (empty circle=pending, spinner=running, green check=completed, red circle=error) + label + elapsed time
  - Below: `StreamingOutput` component showing `agentRun.steps[currentStepIndex].output`
- Keep `AgentRunView` inline in LLMPanel (small component, <60 lines, no reuse yet)
- `StreamingOutput.tsx`: add optional `done?: boolean` prop to hide cursor

## Edge Cases
- **No UI listener for chunks**: `.catch(() => {})` on every broadcast prevents errors
- **SSE line splitting**: Buffer incomplete lines between `reader.read()` calls
- **Reset during stream**: `reset()` clears agentRun state. The `streamFromOffscreen` promise remains pending but the listener was registered with a specific `requestId` — subsequent chunks are harmless (no matching agentRun to write to). The offscreen continues streaming but chunks are silently ignored.
- **Stale chunks**: `requestId` filtering ensures old streams can't contaminate new extractions
- **SW receives chunk broadcasts**: Handled as no-op in message-router (no warning, no sendResponse)
- **Empty/malformed LLM response**: Step 2 (parsing) catches JSON errors and calls `failCurrentStep(error)`
- **Stream timeout**: 120s timeout rejects the stream promise → `failCurrentStep('LLM stream timed out')`
- **API error mid-stream**: Offscreen catches the error and broadcasts `{ done: true, error: message }` → UI resolves the stream promise with the error, calls `failCurrentStep`
- **Buffer flush on completion**: Chunk buffer's `done()` and `error()` methods call `flush()` first to send any remaining buffered bytes before the terminal signal

## Verification
1. `npm run build` — must compile without errors
2. Load `dist/` in Chrome, open side panel
3. Configure an API key in Settings (OpenAI or Anthropic)
4. Paste text and trigger extraction
5. Verify: step timeline shows "Extracting entities via LLM" with spinner, text streams in real-time
6. Verify: when complete, step 1 shows green check, step 2 ("Parsing response") runs and completes
7. Verify: diff review works as before (accept/reject/apply)
8. Verify: clicking Reset during streaming stops cleanly (no orphan listeners)
9. Test with both OpenAI and Anthropic providers
