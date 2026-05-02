# Platform Abstraction Layer Design

## Context

The knowledge graph extension runs on two platforms: Chrome extension and Electron desktop. Both share the same React UI, graph renderer, and state management, but differ in how they access storage, database, filesystem, LLM APIs, and browser tabs.

The current codebase uses three coexisting abstraction patterns:

| Pattern | Where Used | Problem |
|---|---|---|
| Chrome API stubs (`install-chrome-stubs.ts`) | Storage, messaging | Partial Chrome API reimplementation; implicit, fragile contract |
| Direct `window.electronX` detection | `db-client.ts`, `main.tsx` | Scattered, no unified interface |
| Clean interface + runtime swap (`NoteStore`) | Note storage | Good pattern, but only applied to one subsystem |

This design replaces all three with a single, consistent platform abstraction: typed interfaces resolved at build time via Vite aliases. The `NoteStore` pattern becomes the standard for every subsystem.

## Decisions

| Decision | Choice | Rationale |
|---|---|---|
| Abstraction style | Typed interfaces (not Chrome API stubs) | Clean contract both platforms fulfill equally; stubs are a leaky, partial reimplementation |
| Platform resolution | Build-time Vite alias (`@platform`) | Two fixed targets; no runtime detection needed; smaller bundles (dead platform code eliminated) |
| LLM interface | First-class streaming API | UI calls `platform.llm.streamExtraction()` directly; never touches message routing |
| UI platform branching | `platformId` constant + conditional rendering | Simple `if (platformId === 'chrome')` checks for platform-specific UI; tree-shakeable |
| Backend code sharing | Shared `src/core/` imported by both SW and main process | Eliminates duplication of agent loop, retry, usage tracking, system prompts |
| Number of targets | Two (Chrome extension, Electron desktop) | No third target foreseeable; no plugin registry or DI needed |

## Architecture

Four layers. UI code only touches the top two.

```
+------------------------------------------------------+
|                    UI / React Layer                    |
|  Stores, hooks, components -- fully platform-agnostic  |
|  All I/O goes through @platform imports               |
+------------------------------------------------------+
|              @platform  (Vite build-time alias)       |
|   +-------------------+   +--------------------+     |
|   | chrome/            |   | electron/           |     |
|   |  ChromeStorage     |   |  ElectronStorage    |     |
|   |  ChromeDB          |   |  ElectronDB         |     |
|   |  ChromeNotes       |   |  ElectronNotes      |     |
|   |  ChromeLLM         |   |  ElectronLLM        |     |
|   |  ChromeBrowser     |   |  ElectronBrowser    |     |
|   +---------+----------+   +---------+-----------+     |
|      chrome.runtime.*        ipcRenderer.invoke()      |
+------------------------------------------------------+
|            Background Service  (platform-specific)    |
|   +-------------------+   +--------------------+     |
|   | Service Worker     |   | Main Process        |     |
|   | + Offscreen Doc    |   | (electron/main.ts)  |     |
|   +---------+----------+   +---------+-----------+     |
|             +---- both import from ---+                |
|                       v                               |
|                  src/core/                             |
|   Shared: agent-loop, retry, usage, system-prompts    |
|   Shared: llm-executor.ts (already exists)            |
+------------------------------------------------------+
|              External (Anthropic API, FS, SQLite)     |
+------------------------------------------------------+
```

**Key principles:**
- UI code imports `@platform`, never `chrome.*` or `ipcRenderer` directly
- Platform implementations are the only place platform-specific APIs appear
- Background services (SW, main process) stay platform-specific but share logic via `src/core/`
- `llm-executor.ts` already follows the shared-core pattern (both offscreen and `electron/llm-backend.ts` import it); this design extends it to agent loops, retries, and usage tracking

## Platform Interfaces

All interfaces in `src/platform/types.ts`.

```typescript
export type PlatformId = 'chrome' | 'electron';

// --- Storage ---

export interface StorageChange {
  oldValue?: unknown;
  newValue?: unknown;
}

export interface PlatformStorage {
  get<T = Record<string, unknown>>(keys?: string | string[]): Promise<T>;
  set(items: Record<string, unknown>): Promise<void>;
  remove(keys: string | string[]): Promise<void>;
  onChange(cb: (changes: Record<string, StorageChange>, area: string) => void): () => void;
}

// --- Database ---

export interface PlatformDB {
  init(): Promise<void>;
  request(action: string, params?: unknown): Promise<unknown>;
  onSync(cb: (event: unknown) => void): () => void;
}

// --- Notes ---

export interface PlatformNotes {
  init(): Promise<void>;
  read(nodeId: string): Promise<string | null>;
  write(nodeId: string, markdown: string): Promise<void>;
  remove(nodeId: string): Promise<void>;
  list(): Promise<string[]>;
  exists(nodeId: string): Promise<boolean>;
}

// --- LLM ---

export interface RateLimitInfo {
  retryAfterMs: number;
  retryCount: number;
  maxRetries: number;
}

export interface PlatformLLM {
  streamExtraction(
    request: ExtractionRequest,
    onChunk: (text: string) => void,
    onRateLimitWait?: (info: RateLimitInfo) => void,
  ): Promise<LLMResult>;

  runAgent(
    request: AgentRequest,
    onProgress: (event: AgentProgressEvent) => void,
  ): Promise<void>;

  streamChat(
    request: ChatRequest,
    onChunk: (text: string) => void,
    onRateLimitWait?: (info: RateLimitInfo) => void,
  ): Promise<ChatResult>;
}

// --- Browser ---

export interface PlatformBrowser {
  getActiveTab(): Promise<{ id: number; url: string; title: string } | null>;
  getPageContent(tabId: number): Promise<string>;
  executeTool(tabId: number, tool: string, params: Record<string, unknown>): Promise<string>;
  onPageCapture(cb: (data: { title: string; url: string; content: string }) => void): () => void;
}

// --- Platform entry point ---

export interface Platform {
  id: PlatformId;
  storage: PlatformStorage;
  db: PlatformDB;
  notes: PlatformNotes;
  llm: PlatformLLM;
  browser: PlatformBrowser;
  init(): Promise<void>;
}
```

Request/result types (`ExtractionRequest`, `LLMResult`, `AgentRequest`, `ChatRequest`, `ChatResult`) are defined in `src/shared/types.ts` alongside existing types.

**Design notes:**
- `PlatformDB` is low-level (`request(action, params)`). The typed namespace API in `db-client.ts` (nodes, edges, spatial, etc.) is shared code that calls `platform.db.request()`. The 30+ typed methods are written once.
- `PlatformNotes` is identical to the existing `NoteStore` interface.
- `PlatformLLM` surfaces rate-limit state via optional callback but handles retries internally.
- `PlatformBrowser` covers the shared tab-interaction surface. Chrome-only features (context menus, side panel, badge) stay in service worker code and are toggled in UI via `platformId === 'chrome'` checks.

## Build-time Resolution

### Vite config

```typescript
// vite.config.chrome.ts
resolve: {
  alias: {
    '@': path.resolve(__dirname, 'src'),
    '@platform': path.resolve(__dirname, 'src/platform/chrome'),
  }
}

// vite.config.electron.ts
resolve: {
  alias: {
    '@': path.resolve(__dirname, 'src'),
    '@platform': path.resolve(__dirname, 'src/platform/electron'),
  }
}
```

### TypeScript

```jsonc
// tsconfig.json
"paths": {
  "@/*": ["./src/*"],
  "@platform": ["./src/platform/chrome"],
  "@platform/*": ["./src/platform/chrome/*"]
}
```

Chrome is the IDE default. Both platform index files export the same names and types, so type checking passes regardless of resolution target.

### Platform entry points

```typescript
// src/platform/chrome/index.ts
import type { PlatformId } from '../types';
export const platformId: PlatformId = 'chrome';
export const storage = new ChromeStorage();
export const db = new ChromeDB();
export const notes = new ChromeNotes();
export const llm = new ChromeLLM();
export const browser = new ChromeBrowser();

export async function initPlatform(): Promise<void> {
  await db.init();
  await notes.init();
}
```

```typescript
// src/platform/electron/index.ts
import type { PlatformId } from '../types';
export const platformId: PlatformId = 'electron';
export const storage = new ElectronStorage();
export const db = new ElectronDB();
export const notes = new ElectronNotes();
export const llm = new ElectronLLM();
export const browser = new ElectronBrowser();

export async function initPlatform(): Promise<void> {
  await db.init();
  await notes.init();
}
```

### Consumer code

```typescript
import { storage, platformId } from '@platform';

const config = await storage.get('llmConfig');

if (platformId === 'chrome') {
  // chrome-only UI, tree-shaken from electron build
}
```

## Shared Core Services

Logic currently duplicated between `src/offscreen/` (Chrome) and `electron/llm-backend.ts` (Electron) is extracted into `src/core/`. Both background services import from it.

### What is duplicated today

| Logic | Chrome location | Electron location | Gap |
|---|---|---|---|
| Agent loop (LLM -> tools -> loop) | `src/offscreen/agent-loop.ts` | `electron/llm-backend.ts:handleAgentRun` | Nearly identical |
| System prompts | `src/offscreen/agent-loop.ts` | `electron/llm-backend.ts:getAgentSystemPrompt` | Identical |
| Usage tracking | `src/service-worker/message-router.ts` | `electron/llm-backend.ts:recordUsage` | Same logic, different storage |
| Rate-limit retry | `src/service-worker/retry-handler.ts` | Missing | Bug: Electron has no retry on 429 |
| Cost calculation | `src/shared/constants.ts` | `electron/llm-backend.ts:computeCostCents` | Stale copy in Electron |

### Extracted modules

```
src/core/
  agent-loop.ts        # Generic iteration: LLM call -> check tools -> execute -> loop
  retry.ts             # Exponential backoff for 429/529 responses
  system-prompts.ts    # All LLM system prompts (extraction, agent, chat)
  usage.ts             # Token counting + cost recording (takes storage as parameter)
```

### Agent loop: injectable tool executor

```typescript
// src/core/agent-loop.ts

export interface ToolExecutor {
  execute(tool: ToolCall): Promise<{ result: string; error?: string }>;
}

export async function runAgentLoop(
  streamFn: (msgs: AnthropicMessage[], onChunk: (text: string) => void) => Promise<AnthropicToolsResult>,
  toolExecutor: ToolExecutor,
  config: { maxIterations: number; notesEnabled: boolean },
  onProgress: (event: AgentProgressEvent) => void,
): Promise<void> {
  // Shared loop logic (~80 lines, written once)
  // Chrome passes ContentScriptToolExecutor (dispatches via chrome.runtime.sendMessage)
  // Electron passes MainProcessToolExecutor (handles fetch_url directly, errors on content-script tools)
}
```

### Retry: currently Chrome-only, becomes shared

```typescript
// src/core/retry.ts

export async function withRetry<T>(
  fn: () => Promise<T>,
  opts: {
    maxRetries: number;
    onRetryWait?: (info: RateLimitInfo) => void;
  },
): Promise<T> {
  // Catches 429/529, exponential backoff, calls onRetryWait for UI feedback
  // Fixes missing retry logic on Electron
}
```

### Usage tracking: parameterized storage

```typescript
// src/core/usage.ts

export function recordUsage(
  store: { get(key: string): any; set(items: Record<string, any>): void },
  path: string, model: string, inputTokens: number, outputTokens: number,
): void {
  // Shared logic, uses injected storage interface
}
```

### What stays platform-specific (not extracted)

- Service worker message routing (inherently Chrome)
- Offscreen document lifecycle (Chrome-only concept)
- Electron IPC handlers (inherently Electron)
- Companion server (Electron-only)

These are thin wiring layers that call into `src/core/` for actual logic.

## Platform Implementations

### Chrome (`src/platform/chrome/`)

| Class | Wraps | Lines (est.) |
|---|---|---|
| `ChromeStorage` | `chrome.storage.local.get/set/remove`, `chrome.storage.onChanged` | ~30 |
| `ChromeDB` | SharedWorker/DedicatedWorker lifecycle + MessagePort request/response (from `db-client.ts`) | ~120 |
| `ChromeNotes` | OPFS APIs via `navigator.storage.getDirectory()` (from `opfs-note-store.ts`) | ~60 |
| `ChromeLLM` | Sends typed messages via `chrome.runtime.sendMessage`, listens for broadcast responses | ~100 |
| `ChromeBrowser` | `chrome.tabs.query/sendMessage`, `chrome.scripting.executeScript` | ~50 |

ChromeLLM example (streamExtraction):
```typescript
class ChromeLLM implements PlatformLLM {
  async streamExtraction(request, onChunk, onRateLimitWait?) {
    const requestId = crypto.randomUUID();
    return new Promise((resolve, reject) => {
      const listener = (msg: any) => {
        if (msg.type === 'RATE_LIMIT_WAIT' && msg.payload?.requestId === requestId) {
          onRateLimitWait?.(msg.payload);
          return;
        }
        if (msg.type !== 'LLM_STREAM_CHUNK' || msg.payload?.requestId !== requestId) return;
        if (msg.payload.chunk) onChunk(msg.payload.chunk);
        if (msg.payload.done) {
          chrome.runtime.onMessage.removeListener(listener);
          if (msg.payload.error) reject(new Error(msg.payload.error));
          else resolve({ content: msg.payload.content, ...msg.payload });
        }
      };
      chrome.runtime.onMessage.addListener(listener);
      chrome.runtime.sendMessage({ type: 'LLM_REQUEST', requestId, payload: request });
    });
  }
}
```

The service worker and offscreen document stay as-is. The only change is that SW's agent loop and retry logic import from `src/core/`.

### Electron (`src/platform/electron/`)

| Class | Wraps | Lines (est.) |
|---|---|---|
| `ElectronStorage` | `window.electronIPC.invoke('storage:*')` | ~30 |
| `ElectronDB` | `window.electronIPC.invoke('db:request', ...)` | ~30 |
| `ElectronNotes` | `window.electronIPC.invoke('notes:*')` | ~30 |
| `ElectronLLM` | Dedicated IPC channels (`llm:stream-extraction`, `llm:run-agent`, `llm:stream-chat`) | ~100 |
| `ElectronBrowser` | `window.electronIPC.invoke('browser:*')` -- dispatches to companion | ~40 |

ElectronLLM uses dedicated IPC channels (not the current `runtime:sendMessage` passthrough):
```typescript
class ElectronLLM implements PlatformLLM {
  async streamExtraction(request, onChunk, onRateLimitWait?) {
    const requestId = crypto.randomUUID();
    return new Promise((resolve, reject) => {
      const cleanup = window.electronIPC.on('llm:extraction-chunk', (data: any) => {
        if (data.requestId !== requestId) return;
        if (data.rateLimitWait) { onRateLimitWait?.(data.rateLimitWait); return; }
        if (data.chunk) onChunk(data.chunk);
        if (data.done) {
          cleanup();
          if (data.error) reject(new Error(data.error));
          else resolve({ content: data.content, ...data });
        }
      });
      window.electronIPC.invoke('llm:stream-extraction', { requestId, ...request }).catch(reject);
    });
  }
}
```

### Preload changes

The preload script becomes a single generic IPC bridge:

```typescript
// electron/preload.ts
contextBridge.exposeInMainWorld('electronIPC', {
  invoke: (channel: string, ...args: any[]) => ipcRenderer.invoke(channel, ...args),
  on: (channel: string, cb: (...args: any[]) => void) => {
    const handler = (_event: any, ...args: any[]) => cb(...args);
    ipcRenderer.on(channel, handler);
    return () => ipcRenderer.removeListener(channel, handler);
  },
});
```

Electron platform implementations call `window.electronIPC.invoke(channel, ...args)`. Type safety is enforced within each platform class, not at the IPC bridge level.

### Main process changes

`electron/main.ts` gains dedicated IPC handlers for LLM streaming (`llm:stream-extraction`, `llm:run-agent`, `llm:stream-chat`). These handlers import from `src/core/` for shared logic and from `src/offscreen/llm-executor.ts` for the Anthropic API streaming (already shared today). The catch-all `runtime:sendMessage` handler is removed.

## Migration Phases

Each phase produces working builds on both platforms. No phase breaks existing functionality.

### Phase 1: Foundation (no behavior change)
- Create `src/platform/types.ts` with all interfaces
- Create `src/platform/chrome/index.ts` and `src/platform/electron/index.ts`
- Add `@platform` alias to both Vite configs + tsconfig
- Verify both builds still work

### Phase 2: Storage (biggest surface area, simplest per-site change)
- Implement `ChromeStorage` (~30 lines wrapping `chrome.storage.local`)
- Implement `ElectronStorage` (~30 lines wrapping `ipcRenderer.invoke`)
- Refactor all 51+ `chrome.storage.local` call sites to `import { storage } from '@platform'`
- Mostly mechanical find-and-replace

### Phase 3: Database
- Move SharedWorker/DedicatedWorker lifecycle from `db-client.ts` to `ChromeDB`
- Move Electron IPC client from `db-client.ts` to `ElectronDB`
- `db-client.ts` becomes shared typed API calling `platform.db.request()`
- The 30+ typed namespace methods (nodes, edges, spatial, etc.) don't change

### Phase 4: Notes (smallest, files just move)
- `OpfsNoteStore` moves to `src/platform/chrome/notes.ts`
- `FsNoteStore` moves to `src/platform/electron/notes.ts`
- Delete `src/notes/note-store.ts`, `opfs-note-store.ts`, `fs-note-store.ts`
- Update consumer imports to `import { notes } from '@platform'`

### Phase 5: Shared Core + LLM (most complex, highest payoff)
- Extract `src/core/agent-loop.ts`, `retry.ts`, `usage.ts`, `system-prompts.ts`
- Implement `ChromeLLM` and `ElectronLLM`
- Add dedicated IPC handlers in `electron/main.ts`
- Refactor `useLLMExtraction.ts` to use `platform.llm.*`
- Update SW and main process to import from `src/core/`
- Electron gains rate-limit retry (currently missing)

### Phase 6: Browser + Cleanup
- Implement `ChromeBrowser` and `ElectronBrowser`
- Refactor hooks using `chrome.tabs` to `platform.browser`
- Update preload to generic IPC bridge
- Delete `install-chrome-stubs.ts`
- Remove all `window.electronX` runtime detection
- Remove stale `runtime:sendMessage` catch-all from main process

## Files to Create

| File | Purpose |
|---|---|
| `src/platform/types.ts` | All platform interfaces |
| `src/platform/chrome/index.ts` | Chrome platform entry point + exports |
| `src/platform/chrome/storage.ts` | `chrome.storage.local` wrapper |
| `src/platform/chrome/db.ts` | SharedWorker/DedicatedWorker lifecycle |
| `src/platform/chrome/notes.ts` | OPFS note storage (from `opfs-note-store.ts`) |
| `src/platform/chrome/llm.ts` | Message-based LLM streaming |
| `src/platform/chrome/browser.ts` | `chrome.tabs` + content script interaction |
| `src/platform/electron/index.ts` | Electron platform entry point + exports |
| `src/platform/electron/storage.ts` | IPC storage wrapper |
| `src/platform/electron/db.ts` | IPC database wrapper |
| `src/platform/electron/notes.ts` | IPC notes wrapper (from `fs-note-store.ts`) |
| `src/platform/electron/llm.ts` | IPC-based LLM streaming |
| `src/platform/electron/browser.ts` | Companion extension dispatch |
| `src/core/agent-loop.ts` | Shared agent iteration with injectable ToolExecutor |
| `src/core/retry.ts` | Shared rate-limit retry with exponential backoff |
| `src/core/usage.ts` | Shared usage tracking with injectable storage |
| `src/core/system-prompts.ts` | All LLM system prompts |

## Files to Modify

| File | Change |
|---|---|
| `vite.config.chrome.ts` | Add `@platform` alias |
| `vite.config.electron.ts` | Add `@platform` alias |
| `tsconfig.json` | Add `@platform` path mapping |
| `src/ui/main.tsx` | Replace `window.electronAPI` check with `import { initPlatform } from '@platform'` |
| `src/db/client/db-client.ts` | Remove platform detection; `sendRequest` calls `platform.db.request()` |
| 51+ UI-side `chrome.storage.local` call sites | Replace with `import { storage } from '@platform'` |
| UI-side `chrome.runtime.sendMessage` call sites (~20 in hooks/components/stores) | Replace with `platform.llm.*` or `platform.browser.*`. Background contexts (service worker, offscreen, content script) keep `chrome.*` — they ARE the Chrome platform. |
| `src/ui/hooks/useLLMExtraction.ts` | Replace `streamFromOffscreen()` with `platform.llm.streamExtraction()` |
| `src/service-worker/message-router.ts` | Import agent loop + retry from `src/core/` |
| `electron/main.ts` | Add dedicated LLM IPC handlers; remove `runtime:sendMessage` catch-all |
| `electron/preload.ts` | Replace specific bridges with generic `electronIPC` |
| `electron/llm-backend.ts` | Import from `src/core/` instead of duplicating logic |

## Files to Delete

| File | Reason |
|---|---|
| `src/platform/install-chrome-stubs.ts` | Replaced by proper interfaces |
| `src/notes/note-store.ts` | Replaced by `PlatformNotes` via `@platform` |
| `src/notes/opfs-note-store.ts` | Moved to `src/platform/chrome/notes.ts` |
| `src/notes/fs-note-store.ts` | Moved to `src/platform/electron/notes.ts` |

## Risks

| Risk | Severity | Mitigation |
|---|---|---|
| 51+ storage call sites is error-prone | Medium | Mechanical find-and-replace; TypeScript catches missing imports; test both builds after phase 2 |
| UI-side `chrome.runtime.sendMessage` calls used for non-LLM purposes | Medium | Audit UI call sites (~20); some are for display mode toggle, page analysis, etc. — route through appropriate platform interface or `platformId` guard |
| Electron preload change breaks existing IPC | Medium | Phase 6 (last); all IPC channels verified working via platform implementations before preload changes |
| Two Vite alias configs drift | Low | Both point at same interface; TypeScript catches shape mismatches; CI builds both targets |
| `src/core/` agent loop diverges from platform-specific needs | Low | Injectable `ToolExecutor` interface handles platform differences without forking the loop |

## Supersedes

This design supersedes the platform abstraction portions of the phase 1-4 specs:
- `2026-04-26-electron-phase1-storage-design.md`
- `2026-04-26-electron-phase2-database-design.md`
- `2026-04-26-electron-phase3-notes-filesystem-design.md`
- `2026-04-28-electron-phase4-llm-agent-design.md`

Those specs assumed the Chrome stubs approach. This design replaces stubs with proper typed interfaces and build-time resolution. The scope of work per phase is similar, but the target architecture is different.
