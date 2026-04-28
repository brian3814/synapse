# Electron Phase 4: LLM + Agent Layer Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make LLM extraction and chat work in Electron by upgrading the `chrome.runtime.sendMessage/onMessage` stubs to route through IPC to the main process, which handles API calls directly.

**Architecture:** The `chrome.runtime.sendMessage` stub routes messages to the main process via IPC. The main process reads API keys from StorageBackend (Phase 1), makes streaming `fetch()` calls to the Anthropic API, and broadcasts response chunks back to the renderer via IPC. The renderer's `chrome.runtime.onMessage` listeners receive broadcasts identically to the Chrome extension. Zero UI code changes.

**Tech Stack:** Electron IPC, Node.js fetch, Anthropic streaming SSE

**Key insight:** `src/offscreen/llm-executor.ts` and `src/offscreen/url-utils.ts` are pure (no chrome APIs) — they can be imported directly into the main process bundle. Only the agent loop's `executeRemoteTool()` uses chrome APIs (content script tools — unavailable until Phase 5).

---

### Task 1: Expose electronRuntime in preload + upgrade stubs

**Files:**
- Modify: `electron/preload.ts`
- Modify: `src/platform/install-chrome-stubs.ts`

- [ ] **Step 1: Modify `electron/preload.ts`**

Read first. Add a new `contextBridge.exposeInMainWorld` block AFTER the existing `electronNotes` block:

```typescript
contextBridge.exposeInMainWorld('electronRuntime', {
  sendMessage: (message: any) => ipcRenderer.invoke('runtime:sendMessage', message),
  onMessage: (callback: (message: any) => void) => {
    const handler = (_event: any, message: any) => callback(message);
    ipcRenderer.on('runtime:broadcast', handler);
    return () => {
      ipcRenderer.removeListener('runtime:broadcast', handler);
    };
  },
});
```

- [ ] **Step 2: Modify `src/platform/install-chrome-stubs.ts`**

Read first. The runtime stub needs to be upgraded the same way storage was — move it inside `installChromeStubs()` and wire to IPC.

Replace the module-level `runtimeStub` definition and the way it's used inside `installChromeStubs()`. The full updated file should be:

```typescript
type Listener = (...args: any[]) => any;

class EventStub {
  private listeners: Listener[] = [];
  addListener(fn: Listener) { this.listeners.push(fn); }
  removeListener(fn: Listener) {
    this.listeners = this.listeners.filter((l) => l !== fn);
  }
  hasListener(fn: Listener) { return this.listeners.includes(fn); }
}

const tabsStub = {
  query: (_queryInfo: any) => Promise.resolve([]),
  sendMessage: (_tabId: number, _message: any) => Promise.resolve(null),
  create: (_props: any) => Promise.resolve({ id: 0 }),
};

export function installChromeStubs(): void {
  if (typeof globalThis.chrome?.runtime?.id === 'string') {
    return;
  }

  const eStorage = (window as any).electronStorage as {
    get: (keys?: any) => Promise<Record<string, any>>;
    set: (items: any) => Promise<void>;
    remove: (keys: any) => Promise<void>;
    onChanged: (cb: (changes: any, areaName: string) => void) => () => void;
  } | undefined;

  const eRuntime = (window as any).electronRuntime as {
    sendMessage: (message: any) => Promise<any>;
    onMessage: (cb: (message: any) => void) => () => void;
  } | undefined;

  // Storage stubs
  const changeListeners: Listener[] = [];

  if (eStorage) {
    eStorage.onChanged((changes, areaName) => {
      for (const fn of changeListeners) {
        fn(changes, areaName);
      }
    });
  }

  const storageStub = {
    local: {
      get: (keys?: any) => eStorage ? eStorage.get(keys) : Promise.resolve({}),
      set: (items: any) => eStorage ? eStorage.set(items) : Promise.resolve(),
      remove: (keys: any) => eStorage ? eStorage.remove(keys) : Promise.resolve(),
    },
    session: {
      get: (_keys?: any) => Promise.resolve({}),
      set: (_items: any) => Promise.resolve(),
    },
    onChanged: {
      addListener: (fn: Listener) => { changeListeners.push(fn); },
      removeListener: (fn: Listener) => {
        const idx = changeListeners.indexOf(fn);
        if (idx >= 0) changeListeners.splice(idx, 1);
      },
      hasListener: (fn: Listener) => changeListeners.includes(fn),
    },
  };

  // Runtime stubs
  const messageListeners: Listener[] = [];

  if (eRuntime) {
    eRuntime.onMessage((message) => {
      for (const fn of messageListeners) {
        fn(message, {}, () => {});
      }
    });
  }

  const runtimeStub = {
    sendMessage: (message: any, callback?: (response: any) => void) => {
      if (eRuntime) {
        const promise = eRuntime.sendMessage(message);
        if (callback) {
          promise.then(callback).catch(() => callback(undefined));
          return;
        }
        return promise;
      }
      if (callback) { callback(null); return; }
      return Promise.resolve(null);
    },
    onMessage: {
      addListener: (fn: Listener) => { messageListeners.push(fn); },
      removeListener: (fn: Listener) => {
        const idx = messageListeners.indexOf(fn);
        if (idx >= 0) messageListeners.splice(idx, 1);
      },
      hasListener: (fn: Listener) => messageListeners.includes(fn),
    },
    getURL: (path: string) => path,
    lastError: null as any,
    id: 'electron-stub',
  };

  (globalThis as any).chrome = {
    ...((globalThis as any).chrome ?? {}),
    storage: storageStub,
    runtime: runtimeStub,
    tabs: tabsStub,
  };
}
```

Key changes: `runtimeStub.sendMessage` now delegates to `eRuntime.sendMessage` (IPC). It also supports the callback form (used by agent loop's `executeRemoteTool`). `onMessage` listeners receive broadcasts from main process. `onInstalled` removed (unused in renderer).

- [ ] **Step 3: Verify Chrome extension build**

```bash
npm run build
```

- [ ] **Step 4: Commit**

```bash
git add electron/preload.ts src/platform/install-chrome-stubs.ts
git commit -m "feat(electron): upgrade runtime stubs to route through IPC"
```

---

### Task 2: Create LLM backend

**Files:**
- Create: `electron/llm-backend.ts`

This file handles all LLM-related messages in the main process. It imports streaming functions directly from the offscreen code (they're pure), reads API keys from StorageBackend, and provides a `handleRuntimeMessage` function that returns broadcasts.

- [ ] **Step 1: Create `electron/llm-backend.ts`**

```typescript
import { executeLLMRequestStreaming, streamAnthropicWithTools } from '../src/offscreen/llm-executor';
import { AGENT_TOOLS, toAnthropicTools } from '../src/shared/agent-tools';
import { fetchAndCleanContent, isBlockedUrl } from '../src/offscreen/url-utils';
import type { AgentProgressEvent, ExtractionResult } from '../src/shared/types';
import type { AnthropicMessage, AnthropicContentBlock } from '../src/offscreen/llm-executor';
import { StorageBackend } from './storage-backend';

const MAX_ITERATIONS = 15;
const FETCH_MAX_BYTES = 20_000;

let storage: StorageBackend | null = null;

export function setStorage(s: StorageBackend): void {
  storage = s;
}

async function getApiKey(): Promise<string> {
  if (!storage) throw new Error('Storage not initialized');
  const data = storage.get('llmConfig');
  const key = data.llmConfig?.apiKey;
  if (!key) throw new Error('No API key configured. Go to Settings to add one.');
  return key;
}

type BroadcastFn = (message: any) => void;

export async function handleRuntimeMessage(
  message: any,
  broadcast: BroadcastFn,
): Promise<any> {
  const type = message?.type;

  switch (type) {
    case 'LLM_REQUEST':
      handleLLMRequest(message.payload, broadcast);
      return null;

    case 'AGENT_RUN_START':
      handleAgentRun(message.payload, broadcast);
      return null;

    case 'CHAT_LLM_REQUEST':
      handleChatRequest(message.payload, broadcast);
      return null;

    default:
      return null;
  }
}

async function handleLLMRequest(payload: any, broadcast: BroadcastFn): Promise<void> {
  const requestId = payload.requestId ?? `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  try {
    const apiKey = await getApiKey();
    const fullPayload = { ...payload, apiKey };

    let buffer = '';
    const BUFFER_MAX_BYTES = 100;
    let flushTimer: ReturnType<typeof setTimeout> | null = null;

    const flush = () => {
      if (buffer) {
        broadcast({ type: 'LLM_STREAM_CHUNK', payload: { requestId, chunk: buffer, done: false } });
        buffer = '';
      }
      if (flushTimer) { clearTimeout(flushTimer); flushTimer = null; }
    };

    const result = await executeLLMRequestStreaming(fullPayload, (text, done) => {
      if (done) {
        flush();
        return;
      }
      buffer += text;
      if (Buffer.byteLength(buffer) >= BUFFER_MAX_BYTES) {
        flush();
      } else if (!flushTimer) {
        flushTimer = setTimeout(flush, 50);
      }
    });

    broadcast({
      type: 'LLM_STREAM_CHUNK',
      payload: {
        requestId,
        chunk: '',
        done: true,
        content: result.content,
        inputTokens: result.inputTokens,
        outputTokens: result.outputTokens,
        model: payload.model,
      },
    });

    recordUsage('simple', payload.model, result.inputTokens, result.outputTokens);
  } catch (e: any) {
    broadcast({
      type: 'LLM_STREAM_CHUNK',
      payload: { requestId, chunk: '', done: true, content: '', error: e.message },
    });
  }
}

async function handleChatRequest(payload: any, broadcast: BroadcastFn): Promise<void> {
  const requestId = payload.requestId;
  try {
    const apiKey = await getApiKey();

    const result = await streamAnthropicWithTools(
      apiKey,
      payload.model,
      payload.systemPrompt,
      payload.messages,
      payload.tools,
      (chunk) => {
        broadcast({ type: 'CHAT_LLM_STREAM', payload: { requestId, textChunk: chunk, done: false } });
      },
    );

    broadcast({
      type: 'CHAT_LLM_STREAM',
      payload: {
        requestId,
        done: true,
        textContent: result.textContent,
        toolCalls: result.toolCalls,
        stopReason: result.stopReason,
        inputTokens: result.inputTokens,
        outputTokens: result.outputTokens,
        model: payload.model,
      },
    });

    recordUsage('chat', payload.model, result.inputTokens, result.outputTokens);
  } catch (e: any) {
    broadcast({
      type: 'CHAT_LLM_STREAM',
      payload: { requestId, done: true, textContent: '', toolCalls: [], error: e.message },
    });
  }
}

async function handleAgentRun(payload: any, broadcast: BroadcastFn): Promise<void> {
  const { runId, userPrompt, model, notesEnabled } = payload;
  try {
    const apiKey = await getApiKey();

    const systemPrompt = getAgentSystemPrompt(notesEnabled ?? false);
    const anthropicTools = toAnthropicTools(AGENT_TOOLS);
    const messages: AnthropicMessage[] = [{ role: 'user', content: userPrompt }];

    let totalInputTokens = 0;
    let totalOutputTokens = 0;

    const emitProgress = (event: AgentProgressEvent) => {
      broadcast({ type: 'AGENT_PROGRESS', payload: { runId, event } });
    };

    for (let i = 0; i < MAX_ITERATIONS; i++) {
      emitProgress({ type: 'llm_start' });

      let result;
      try {
        result = await streamAnthropicWithTools(
          apiKey, model, systemPrompt, messages, anthropicTools,
          (chunk) => emitProgress({ type: 'llm_chunk', text: chunk }),
        );
      } catch (e: any) {
        emitProgress({ type: 'error', error: e.message });
        return;
      }

      totalInputTokens += result.inputTokens;
      totalOutputTokens += result.outputTokens;
      emitProgress({ type: 'llm_end', text: result.textContent });

      if (result.toolCalls.length === 0) {
        emitProgress({ type: 'done', inputTokens: totalInputTokens, outputTokens: totalOutputTokens, model });
        recordUsage('agent', model, totalInputTokens, totalOutputTokens);
        return;
      }

      const assistantContent: AnthropicContentBlock[] = [];
      if (result.textContent) {
        assistantContent.push({ type: 'text', text: result.textContent });
      }
      for (const tc of result.toolCalls) {
        assistantContent.push({ type: 'tool_use', id: tc.id, name: tc.name, input: tc.input });
      }
      messages.push({ role: 'assistant', content: assistantContent });

      const toolResultBlocks: AnthropicContentBlock[] = [];

      for (const tc of result.toolCalls) {
        emitProgress({ type: 'tool_call', toolCall: tc });

        if (tc.name === 'save_entities') {
          const extractionResult = tc.input as unknown as ExtractionResult;
          emitProgress({ type: 'extraction_complete', extractionResult, inputTokens: totalInputTokens, outputTokens: totalOutputTokens, model });
          emitProgress({ type: 'done', inputTokens: totalInputTokens, outputTokens: totalOutputTokens, model });
          recordUsage('agent', model, totalInputTokens, totalOutputTokens);
          return;
        }

        let toolResult: string;
        let toolError: string | undefined;

        const toolDef = AGENT_TOOLS.find((t) => t.name === tc.name);
        if (!toolDef) {
          toolResult = '';
          toolError = `Unknown tool: ${tc.name}`;
        } else if (toolDef.executionContext === 'content-script') {
          toolResult = '';
          toolError = 'Content script tools are not available in desktop mode. Use fetch_url to read web pages instead.';
        } else if (tc.name === 'fetch_url') {
          const url = tc.input.url as string;
          if (isBlockedUrl(url)) {
            toolResult = '';
            toolError = 'URL is blocked or invalid';
          } else {
            const res = await fetchAndCleanContent(url, FETCH_MAX_BYTES);
            toolResult = res.content;
            toolError = res.error;
          }
        } else {
          toolResult = '';
          toolError = `Tool ${tc.name} cannot be executed in this context`;
        }

        emitProgress({ type: 'tool_result', toolCall: tc, toolResult: toolError ? undefined : toolResult, toolError });

        toolResultBlocks.push({
          type: 'tool_result',
          tool_use_id: tc.id,
          content: toolError ? `Error: ${toolError}` : toolResult,
          is_error: !!toolError,
        });
      }

      messages.push({ role: 'user', content: toolResultBlocks });
    }

    emitProgress({ type: 'error', error: 'Max iterations reached without completing extraction' });
  } catch (e: any) {
    broadcast({ type: 'AGENT_PROGRESS', payload: { runId, event: { type: 'error', error: e.message } } });
  }
}

function recordUsage(path: string, model: string, inputTokens: number, outputTokens: number): void {
  if (!storage) return;
  const data = storage.get('usageRecords');
  const records = (data.usageRecords as any[]) ?? [];
  records.push({
    timestamp: Date.now(),
    path,
    model,
    inputTokens,
    outputTokens,
    costCents: computeCostCents(model, inputTokens, outputTokens),
  });
  storage.set({ usageRecords: records });
}

function computeCostCents(model: string, inputTokens: number, outputTokens: number): number {
  const rates: Record<string, { input: number; output: number }> = {
    'claude-sonnet-4-20250514': { input: 0.3, output: 1.5 },
    'claude-3-5-sonnet-20241022': { input: 0.3, output: 1.5 },
    'claude-3-5-haiku-20241022': { input: 0.08, output: 0.4 },
  };
  const rate = rates[model] ?? { input: 0.3, output: 1.5 };
  return (inputTokens / 100_000) * rate.input + (outputTokens / 100_000) * rate.output;
}

function getAgentSystemPrompt(notesEnabled: boolean): string {
  const notesRules = notesEnabled
    ? `\n\nRules for NOTES (enabled):\n- When calling save_entities, include exactly ONE note in the "notes" array — a structured summary of the resource.\n- Title: "Summary: <page title>"\n- The note content MUST be markdown with this structure:\n  1. **TL;DR** section first — 2-3 sentences capturing the core message.\n  2. Then 3-5 **sections** that break down the content by topic/theme.\n  3. Include **markdown tables** where the page contains structured/comparative data.\n  4. Include **images** from the page where relevant using ![description](image_url).\n- Use [[Entity Name]] wikilinks to reference entities from the nodes array.\n- "about" lists 1-3 key entities. "mentions" lists other referenced entities.`
    : '';

  return `You are a knowledge graph extraction agent. Your job is to inspect a web page using the provided tools, then extract entities (nodes) and typed relationships (edges) into a structured knowledge graph.

Workflow:
1. Start by using get_page_metadata to understand the page structure
2. Use get_page_content to read the main content
3. Use more targeted tools if needed
4. If the user asks about linked content, use fetch_url to read linked pages
5. When you have gathered enough information, call save_entities with the extracted nodes and edges

Rules for NODES:
- Do NOT output resource nodes. The system creates them automatically.
- Use the "label" field to categorize semantically. Allowed labels: concept, person, organization, technology, event, place, methodology.
- If no label fits, default to "concept".
- Include relevant properties as key-value pairs.
- Include a "tags" array for domain annotations.

Rules for EDGES:
- Prefer these labels when applicable: subfield_of, part_of, instance_of, created_by, affiliated_with, used_in, builds_on, enables, contradicts, alternative_to, preceded_by.
- Use consistent, lowercase snake_case labels.
- Ensure all edges reference entities in your nodes array by exact name.
- Call save_entities exactly once when done — it is the terminal tool.${notesRules}

Be efficient: don't call tools unnecessarily.`;
}
```

- [ ] **Step 2: Commit**

```bash
git add electron/llm-backend.ts
git commit -m "feat(electron): add LLM backend with streaming, agent loop, and usage tracking"
```

---

### Task 3: Wire IPC handler in main.ts

**Files:**
- Modify: `electron/main.ts`

- [ ] **Step 1: Modify `electron/main.ts`**

Read first. Add import at top (after existing imports):

```typescript
import { handleRuntimeMessage, setStorage as setLLMStorage } from './llm-backend';
```

Inside `app.whenReady().then(() => {`, after the StorageBackend instantiation (`const storage = new StorageBackend();`) and BEFORE the storage IPC handlers, add:

```typescript
  setLLMStorage(storage);
```

Then after all existing IPC handlers (after the notes handlers) and BEFORE `createWindow()`, add:

```typescript
  ipcMain.handle('runtime:sendMessage', async (_event, message) => {
    const result = await handleRuntimeMessage(message, (broadcastMsg) => {
      for (const win of BrowserWindow.getAllWindows()) {
        win.webContents.send('runtime:broadcast', broadcastMsg);
      }
    });
    return result;
  });
```

- [ ] **Step 2: Commit**

```bash
git add electron/main.ts
git commit -m "feat(electron): wire runtime message IPC handler for LLM routing"
```

---

### Task 4: Build and verify

**Files:** None (verification only)

- [ ] **Step 1: Build Electron**

```bash
npm run build:electron
```

Expected: No errors. esbuild bundles llm-backend.ts which imports from `src/offscreen/llm-executor.ts` and `src/offscreen/url-utils.ts` (both pure, no chrome APIs).

If build fails due to type imports, ensure `AnthropicMessage` and `AnthropicContentBlock` are exported from `llm-executor.ts`. If not, the implementer should add the exports.

- [ ] **Step 2: Verify Chrome extension build**

```bash
npm run build
```

Expected: Passes. The stubs only use `electronRuntime` when it exists.

- [ ] **Step 3: Launch and test extraction**

```bash
npm run dev:electron
```

1. Open Settings, enter an Anthropic API key, save
2. Enter text in the extraction input field (paste an article or paragraph)
3. Click "Extract" (or equivalent button)
4. Observe: streaming tokens should appear, then extracted entities in review panel

- [ ] **Step 4: Test chat**

In the Electron app:
1. Open the chat panel
2. Type a message (e.g., "What nodes do I have?")
3. Observe: streaming response with tool use (search_knowledge, etc.)

- [ ] **Step 5: Test agent extraction (limited)**

Agent extraction dispatches content script tools which will return "not available" errors. The LLM should adapt and try `fetch_url` instead. If a URL is available:
1. Trigger agent extraction on a URL
2. The agent should use `fetch_url` to read the page
3. Then call `save_entities` with extracted entities

- [ ] **Step 6: Commit (if fixes needed)**

```bash
git add -A
git commit -m "fix(electron): adjustments from Phase 4 verification"
```

---

## Phase 4 success criteria

1. `npm run build:electron` completes without errors
2. Simple text extraction streams tokens and produces entities
3. Chat messages get streaming responses with tool use
4. Agent extraction falls back to `fetch_url` when content script tools unavailable
5. API keys never appear in renderer DevTools (stay in main process)
6. Usage records are written to storage after LLM calls
7. `npm run build` (Chrome extension) still works identically
