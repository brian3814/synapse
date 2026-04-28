# Electron Phase 5: Companion Extension

## Context

Phase 4 made LLM extraction and chat work in the Electron app, but agent extraction can't execute content-script tools (get_page_content, query_selector, etc.) — they return "not available in desktop mode." This phase adds a minimal companion Chrome extension that bridges the browser to the desktop app, enabling full agentic page extraction.

## Scope

MVP: agent tool dispatch only. The companion receives tool calls from the desktop app via SSE, executes them in the active tab's content script, and POSTs results back. Reading list sync and page capture are deferred.

## Architecture

```
Companion Extension                     Electron Desktop App
┌────────────────────┐                  ┌──────────────────────┐
│ Service Worker     │   SSE (events)   │ Companion Server     │
│  - GET /api/events │◄─────────────────│  (HTTP on 127.0.0.1) │
│                    │   POST (results) │                      │
│  - POST /api/      │────────────────►│  Port: 19876         │
│    tool-result     │                  │                      │
│                    │   Native Msg     │  Native Host         │
│  - Port discovery  │◄───────────────►│  (port config)       │
│                    │                  │                      │
│ Content Script     │                  │ LLM Backend          │
│  - tool-executor   │                  │  - Agent loop        │
└────────────────────┘                  └──────────────────────┘
```

## Companion Extension

Separate project in `packages/companion/` (~300 LOC).

### manifest.json
```json
{
  "manifest_version": 3,
  "name": "KG Desktop Companion",
  "version": "1.0.0",
  "permissions": ["activeTab", "scripting", "nativeMessaging"],
  "background": { "service_worker": "service-worker.js", "type": "module" },
  "content_scripts": [{
    "matches": ["<all_urls>"],
    "js": ["content-script.js"],
    "run_at": "document_idle"
  }]
}
```

### service-worker.ts (~150 lines)
- On install: discover port via native messaging (`chrome.runtime.sendNativeMessage("com.kg_desktop", {type: "get_port"})`)
- Cache port in `chrome.storage.local`
- Open SSE connection to `http://127.0.0.1:{port}/api/events`
- On SSE `tool_call` event: relay to content script via `chrome.tabs.sendMessage(tabId, {type: 'TOOL_EXECUTE', payload})`, POST result to `/api/tool-result`
- Auto-reconnect SSE on disconnect (exponential backoff)
- Heartbeat: server sends `ping` events every 30s

### content-script.ts (~100 lines)
- Copied from `src/content-script/tool-executor.ts` + page extraction functions
- Handles `TOOL_EXECUTE` messages identically to the main extension's content script
- Returns `{result, error?}`

### Build
- Separate Vite config: `vite.config.companion.ts`
- Outputs to `dist-companion/`
- IIFE format for content script, ES module for service worker

## Electron Side

### companion-server.ts (Create)
- HTTP server on `127.0.0.1:19876` using Node.js `http` module
- `GET /api/identify` — returns `{app: "kg-desktop", version}` for identity verification
- `GET /api/events` — SSE endpoint, keeps connection open, sends tool_call events + ping heartbeat
- `POST /api/tool-result` — receives tool execution results, resolves pending promises
- Tracks pending tool calls with timeout (30s)

### native-host.ts (Create)
- Simple script that reads the port from the desktop app's config file
- Responds via stdout in native messaging format
- Registered at OS-specific path on app startup

### main.ts (Modify)
- Start companion server on app ready
- Register native messaging host manifest

### llm-backend.ts (Modify)
- Agent loop: for content-script tools, dispatch via companion server instead of returning "not available"
- If companion not connected, fall back to "not available" error (graceful degradation)

## Port Discovery

1. Desktop writes port to config file: `{userData}/companion-port.json`
2. Native messaging host script reads this file, responds with `{port}`
3. Companion extension caches the port in `chrome.storage.local`
4. On each SSE connection attempt, validates with `GET /api/identify`

## Files

| File | Change |
|------|--------|
| `packages/companion/manifest.json` | **Create** — MV3 manifest |
| `packages/companion/service-worker.ts` | **Create** — SSE client, tool relay, port discovery |
| `packages/companion/content-script.ts` | **Create** — tool executor (copied from main extension) |
| `packages/companion/vite.config.ts` | **Create** — build config |
| `electron/companion-server.ts` | **Create** — HTTP server with SSE + tool dispatch |
| `electron/native-host.ts` | **Create** — native messaging host script |
| `electron/main.ts` | **Modify** — start companion server, register native host |
| `electron/llm-backend.ts` | **Modify** — dispatch tools via companion server |
| `package.json` | **Modify** — add companion build script |

## Verification

1. Build companion: `npm run build:companion` → outputs to `dist-companion/`
2. Load companion in Chrome (`chrome://extensions`, load unpacked `dist-companion/`)
3. Launch desktop app (`npm run dev:electron`)
4. Companion discovers port via native messaging
5. SSE connection established (companion SW logs "connected to desktop")
6. Trigger agent extraction with a URL → agent uses content-script tools via companion → entities extracted
7. If companion not connected, agent falls back to fetch_url gracefully
