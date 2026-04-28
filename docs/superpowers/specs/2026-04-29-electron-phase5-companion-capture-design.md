# Electron Phase 5: Companion Extension — Browser-Initiated Capture

## Context

Phase 4 made LLM extraction work in the Electron app, but `fetch_url` only gets raw HTML — client-side rendered pages (React SPAs, etc.) return empty shells. A companion Chrome extension reads the rendered DOM and sends it to the desktop app for extraction.

## Scope

Browser-initiated capture only. User clicks a toolbar button in Chrome → companion reads the rendered page → POSTs to the desktop app → extraction runs. No desktop-initiated tool dispatch, no SSE, no native messaging.

## Architecture

```
Chrome (Companion Extension)              Electron Desktop App
┌───────────────────────┐                 ┌──────────────────────┐
│ Toolbar button click  │                 │ Companion Server     │
│  ↓                    │   HTTP POST     │  (127.0.0.1:19876)   │
│ executeScript in tab  │────────────────►│                      │
│  ↓                    │  /api/capture   │ POST /api/capture    │
│ Read rendered DOM     │                 │  ↓                   │
│ Convert to markdown   │                 │ Broadcast to UI      │
│ POST {title,url,md}   │                 │  ↓                   │
└───────────────────────┘                 │ Trigger extraction   │
                                          └──────────────────────┘
```

## Companion Extension

Separate project in `packages/companion/` (~150 LOC). Completely independent from the existing Chrome extension.

### manifest.json
- MV3, permissions: `activeTab`, `scripting`
- `action` with toolbar icon
- Service worker background script
- No content scripts auto-injected (uses `chrome.scripting.executeScript` on demand)

### service-worker.ts (~60 lines)
- Listens for `chrome.action.onClicked`
- Injects content script via `chrome.scripting.executeScript` to read rendered DOM
- Content script returns `{title, url, content}` (markdown)
- POSTs to `http://127.0.0.1:19876/api/capture`
- Shows badge feedback ("✓" on success, "✗" on failure)
- Port 19876 hardcoded for MVP (native messaging discovery deferred)

### content-capture.ts (~80 lines)
- Injected into the active tab on toolbar click
- Reads `document.title`, `location.href`
- Clones `document.body`, removes non-content elements (script, style, nav, footer, etc.)
- Converts to markdown using Turndown (bundled inline — no shared deps with main extension)
- Returns `{title, url, content}`

### Build
- `packages/companion/vite.config.ts` — separate Vite config
- Outputs to `dist-companion/`
- `npm run build:companion` script in root `package.json`
- IIFE format for injected script, ES module for service worker

## Electron Side

### companion-server.ts (Create)
- HTTP server on `127.0.0.1:19876` using Node.js `http` module
- `GET /api/identify` — returns `{app: "kg-desktop"}` (companion can verify desktop is running)
- `POST /api/capture` — receives `{title, url, content}`, broadcasts to renderer via IPC
- CORS headers for `chrome-extension://` origin

### main.ts (Modify)
- Import and start companion server on app ready

### Renderer handling
- Renderer receives `companion:capture` IPC event
- Triggers extraction via existing `chrome.runtime.sendMessage({type: 'LLM_REQUEST', ...})` — same flow as manual text extraction
- No new UI code needed — the extraction pipeline already handles incoming text

## Files

| File | Change |
|------|--------|
| `packages/companion/manifest.json` | **Create** |
| `packages/companion/service-worker.ts` | **Create** |
| `packages/companion/content-capture.ts` | **Create** |
| `packages/companion/vite.config.ts` | **Create** |
| `electron/companion-server.ts` | **Create** |
| `electron/main.ts` | **Modify** — start companion server |
| `electron/preload.ts` | **Modify** — expose companion capture listener |
| `src/platform/install-chrome-stubs.ts` | **Modify** — wire companion capture to extraction trigger |
| `package.json` | **Modify** — add `build:companion` script |

## Verification

1. `npm run build:companion` → outputs to `dist-companion/`
2. Load companion in Chrome (`chrome://extensions`, load unpacked `dist-companion/`)
3. Launch desktop app (`npm run dev:electron`)
4. Browse to a React SPA page in Chrome
5. Click companion toolbar button
6. Desktop app receives content, extraction UI activates with the page text
7. `npm run build` (existing Chrome extension) still works — completely unaffected
