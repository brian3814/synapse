# Platform Abstraction Layer

The app runs on two platforms from one codebase. UI code imports `@platform` (Vite build-time alias) and never touches `chrome.*` or `ipcRenderer` directly.

```
┌─────────────────────────────────────────────────┐
│  UI / React Layer (platform-agnostic)            │
│  All I/O via: import { storage, db, notes, vault, │
│    files, llm, browser, embedding } from '@platform'│
├─────────────────────────────────────────────────┤
│  @platform (build-time alias)                    │
│  Chrome: src/platform/chrome/  (chrome.* APIs)   │
│  Electron: src/platform/electron/ (IPC bridge)   │
├─────────────────────────────────────────────────┤
│  Background Service (platform-specific)          │
│  Chrome: Service Worker + Offscreen Document     │
│  Electron: Main Process (electron/main.ts)       │
│  Both import shared logic from src/core/         │
├─────────────────────────────────────────────────┤
│  External (LLM API, SQLite, Filesystem)          │
└─────────────────────────────────────────────────┘
```

## Eight Platform Interfaces

Defined in `src/platform/types.ts`:

| Interface | Chrome Implementation (deprecated) | Electron Implementation |
|---|---|---|
| `PlatformStorage` | `chrome.storage.local` | IPC → JSON config file |
| `PlatformDB` | SharedWorker/DedicatedWorker + wa-sqlite | IPC → better-sqlite3 in vault `.kg/graph.db` |
| `PlatformNotes` | OPFS async API | IPC → vault `notes/` directory (human-readable filenames) |
| `PlatformFiles` | OPFS-based file storage | IPC → filesystem read/write in vault |
| `PlatformLLM` | Message-based streaming via SW/offscreen | Dedicated IPC channels (`llm:stream-extraction`, `llm:run-agent`, `llm:stream-chat`) |
| `PlatformBrowser` | `chrome.tabs`, content scripts | Companion extension dispatch or no-op |
| `PlatformEmbedding` | No-op stub (returns empty arrays) | IPC → EmbeddingService in main process (sqlite-vec + ONNX/OpenAI) |
| `PlatformVault` | OPFS `vault/{nodeId}/{filename}` (legacy) | IPC → legacy binary storage (being migrated into vault) |

Additionally, `vaultWorkspace` is exported from both platforms (`src/platform/electron/vault-workspace.ts` / `src/platform/chrome/vault-workspace.ts`) for vault lifecycle management (create, open, close, status). Chrome stub returns no-op responses.

## Build-Time Resolution

- `vite.config.chrome.ts` maps `@platform` → `src/platform/chrome/`
- `vite.config.electron.ts` maps `@platform` → `src/platform/electron/`
- TypeScript `tsconfig.json` paths point at Chrome as IDE default.

**Platform-specific UI**: Use `import { platformId } from '@platform'` and conditional rendering. Chrome-only features (side panel toggle, OAuth, reading list, contextual relevance) are guarded with `platformId === 'chrome'`.

## Shared Core (`src/core/`)

Agent loop, LLM protocol types, rate-limit retry, usage tracking, system prompts, and prompt assembly — imported by both the Chrome offscreen document and Electron main process. The core layer has zero imports from `@platform` or `src/offscreen/`; all dependencies are injected via `CommandContext` or function parameters.

## LLM Provider Abstraction

Provider-neutral types live in `src/core/llm-protocol.ts` (`LLMMessage`, `ContentBlock`, `LLMStreamResult`, `StreamFn`). The Electron main process routes LLM calls through a provider factory in `electron/llm-backend.ts` — registries map provider names to stream functions. Adding a new provider (e.g., OpenAI) means implementing `StreamFn` and calling `registerStreamFn('openai', fn)`. The renderer never knows which provider is active; it goes through `PlatformLLM` (IPC).

## Chrome Extension Contexts

Six execution contexts (Chrome-only, not relevant for Electron):

| Context | Key Restriction |
|---|---|
| **Service Worker** (`src/service-worker/`) | No DOM, no long-running tasks. Must not use dynamic imports (Vite polyfill references `document`). Only context that should read `chrome.storage` for sensitive data (API keys). |
| **Side Panel / Tab** (`src/ui/`) | React 19 SPA. Same `index.html` serves both (`?mode=sidePanel` vs `?mode=tab`). |
| **Offscreen Document** (`src/offscreen/`) | Has DOM + fetch but **no `chrome.storage`**, no `chrome.tabs` (Pitfall #13). Receives API keys via message payload from SW. |
| **Content Script** (`src/content-script/`) | Per-page isolated world. Extracts page text, executes agent tools. Built as IIFE. |
| **DB SharedWorker** (`src/db/worker/db-shared-worker.ts`) | Pure coordinator/router. No `Worker` constructor (Pitfall #12), no `chrome.*` APIs. |
| **DB Dedicated Worker** (`src/db/worker/db-worker.ts`) | Runs wa-sqlite + OPFS. Created by UI thread, bridged to SharedWorker via `MessageChannel`. |

Chrome-context communication uses `chrome.runtime.sendMessage` with typed messages in `src/shared/messages.ts`. These messages are **internal to the Chrome platform layer** — UI code never sends them directly.

## Electron Contexts

Two contexts: **Renderer** (React app, same as Chrome UI) and **Main Process** (`electron/main.ts` — SQLite, LLM, IPC handlers, companion server). Preload (`electron/preload.ts`) exposes a generic `window.electronIPC` bridge with `invoke(channel, ...args)` and `on(channel, cb)`.

## API Key Security Pattern

On Chrome, UI messages never carry API keys. The service worker reads keys from `chrome.storage.local` and injects them before forwarding to the offscreen document. On Electron, the main process reads keys from storage before making LLM API calls.
