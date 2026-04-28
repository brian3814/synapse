# Electron Phase 4: LLM + Agent Layer

## Context

Phases 0-3 delivered an Electron app with persistent storage, better-sqlite3, and filesystem notes. But LLM calls don't work — `chrome.runtime.sendMessage` is still a no-op stub, so extraction and chat do nothing. This phase makes the runtime message stubs actually route to the Electron main process, which handles LLM requests directly (fetch + streaming) without needing a service worker or offscreen document.

## Approach: Upgrade Runtime Stubs

Same pattern as Phase 1 (storage stubs). Make `chrome.runtime.sendMessage` route messages to the main process via IPC. The main process reads API keys from Phase 1's `StorageBackend`, makes `fetch()` calls to the Anthropic API, and streams responses back. `chrome.runtime.onMessage` listeners in the UI receive broadcasts via IPC.

**Result:** Zero UI changes. `useLLMExtraction.ts`, `chat-agent-loop.ts`, and all existing message handlers work identically.

## Three LLM Paths

All follow the same upgrade pattern:

| Path | UI sends | Main process does |
|------|----------|------------------|
| Simple extraction | `LLM_REQUEST` | Read key, fetch Anthropic streaming, broadcast `LLM_STREAM_CHUNK` |
| Agent extraction | `AGENT_RUN_START` | Read key, run tool-use loop, broadcast `AGENT_PROGRESS` events |
| Chat | `CHAT_LLM_REQUEST` | Read key, fetch with tools, broadcast `CHAT_LLM_STREAM` |

## Architecture

```
Chrome Extension (unchanged):
  UI → chrome.runtime.sendMessage → SW (adds key) → Offscreen (fetch) → broadcast → UI

Electron:
  UI → chrome.runtime.sendMessage (stub) → IPC → main process (adds key + fetch) → IPC → stub dispatches to onMessage listeners → UI
```

### Main Process: LLM Backend

New file `electron/llm-backend.ts`:
- Receives message payloads from IPC
- Reads API key from `StorageBackend` (Phase 1)
- Routes by message type:
  - `LLM_REQUEST` → `streamAnthropic()` → sends `LLM_STREAM_CHUNK` broadcasts
  - `AGENT_RUN_START` → `runAgentLoop()` → sends `AGENT_PROGRESS` broadcasts
  - `CHAT_LLM_REQUEST` → `streamAnthropicWithTools()` → sends `CHAT_LLM_STREAM` broadcasts
- Streaming: sends IPC events per chunk, final event has `done: true` with token counts
- The Anthropic streaming fetch logic is ported from `src/offscreen/` (same SSE parsing)

### Main Process: Message Router

New IPC handler `runtime:sendMessage` in `electron/main.ts`:
- Receives all `chrome.runtime.sendMessage` calls from the renderer
- Routes LLM messages to the LLM backend
- Broadcasts response messages to all windows via `runtime:broadcast` IPC event
- Non-LLM messages return `null` (no-op, same as Phase 0 stub)

### Preload: Runtime API

Upgrade `electron/preload.ts`:
- `electronRuntime.sendMessage(message)` → `ipcRenderer.invoke('runtime:sendMessage', message)`
- `electronRuntime.onMessage(callback)` → `ipcRenderer.on('runtime:broadcast', callback)` + returns cleanup

### Stubs Upgrade

`src/platform/install-chrome-stubs.ts`:
- `chrome.runtime.sendMessage(msg)` → calls `window.electronRuntime.sendMessage(msg)`
- `chrome.runtime.onMessage.addListener(fn)` → registers via `window.electronRuntime.onMessage(fn)`

### Agent Tool Execution

The agent loop dispatches `TOOL_EXECUTE` messages for content script tools (`get_page_content`, `query_selector`, etc.). In Electron without a content script:
- Content script tools return a "not available" result — the agent adapts
- `fetch_url` tool works directly from the main process (has `fetch()`)
- This is acceptable for Phase 4. Phase 5 (Companion Extension) adds real browser tool dispatch

### Usage Tracking

The main process tracks usage after each LLM call completion. In the Chrome extension, the SW does this via `chrome.storage`. In Electron, the main process writes directly to `StorageBackend`.

## Files

| File | Change |
|------|--------|
| `electron/llm-backend.ts` | **Create** — Anthropic streaming fetch, agent loop, message routing |
| `electron/main.ts` | **Modify** — Register `runtime:sendMessage` IPC handler |
| `electron/preload.ts` | **Modify** — Expose `electronRuntime` API |
| `src/platform/install-chrome-stubs.ts` | **Modify** — Upgrade runtime stubs to use IPC |

## Verification

1. Launch Electron → open Settings → enter API key → save
2. Enter text in extraction input → click Extract → streaming tokens appear
3. Extracted entities show in review panel → approve → nodes appear in graph
4. Open chat → send message → streaming response with tool use works
5. Chrome extension builds and works identically
6. No API keys visible in renderer DevTools (keys stay in main process)
