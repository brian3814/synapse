# Platform Abstraction Layer Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the mixed Chrome stubs / runtime detection approach with typed platform interfaces resolved at build time via Vite aliases, plus a shared `src/core/` for backend logic deduplication.

**Architecture:** Build-time `@platform` alias resolves to `src/platform/chrome/` or `src/platform/electron/`. Five interfaces (Storage, DB, Notes, LLM, Browser) each have a Chrome and Electron implementation. Shared backend logic (agent loop, retry, usage, prompts) moves to `src/core/` imported by both the service worker and Electron main process.

**Tech Stack:** TypeScript, Vite (alias resolution), Electron IPC, Chrome extension APIs, wa-sqlite, better-sqlite3

**Spec:** `docs/superpowers/specs/2026-05-02-platform-abstraction-layer-design.md`

**No test framework is configured.** Verification is `npm run build` (Chrome) + `npm run build:electron-renderer` (Electron) + manual load in `chrome://extensions` / Electron.

---

## File Structure

### New files

```
src/platform/
  types.ts                    # All platform interfaces + LLM request/result types
  chrome/
    index.ts                  # Chrome entry: exports platformId, storage, db, notes, llm, browser, initPlatform()
    storage.ts                # ChromeStorage — wraps chrome.storage.local
    db.ts                     # ChromeDB — SharedWorker/DedicatedWorker lifecycle (from db-client.ts)
    notes.ts                  # ChromeNotes — OPFS (from opfs-note-store.ts)
    llm.ts                    # ChromeLLM — message-based streaming to SW/offscreen
    browser.ts                # ChromeBrowser — chrome.tabs, chrome.scripting, chrome.runtime
  electron/
    index.ts                  # Electron entry: exports platformId, storage, db, notes, llm, browser, initPlatform()
    storage.ts                # ElectronStorage — ipcRenderer.invoke('storage:*')
    db.ts                     # ElectronDB — ipcRenderer.invoke('db:request', ...)
    notes.ts                  # ElectronNotes — ipcRenderer.invoke('notes:*')
    llm.ts                    # ElectronLLM — dedicated IPC channels for streaming
    browser.ts                # ElectronBrowser — companion dispatch or no-op
src/core/
  system-prompts.ts           # Shared LLM system prompts (extraction, agent)
  agent-loop.ts               # Shared agent iteration with injectable ToolExecutor
  retry.ts                    # Shared rate-limit retry with exponential backoff
  usage.ts                    # Shared usage tracking with injectable storage
```

### Modified files

```
vite.config.chrome.ts         # Add @platform alias
vite.config.electron.ts       # Add @platform alias
tsconfig.json                 # Add @platform path mapping
src/ui/main.tsx               # Replace window.electronAPI check with initPlatform()
src/db/client/db-client.ts    # Remove platform detection; sendRequest calls db.request()
electron/preload.ts           # Generic IPC bridge
electron/main.ts              # Add dedicated LLM IPC handlers
electron/llm-backend.ts       # Import from src/core/ instead of duplicating
~34 UI files                  # chrome.storage.local → storage from @platform
~15 UI files                  # chrome.runtime.sendMessage → platform.llm/browser
```

### Deleted files

```
src/platform/install-chrome-stubs.ts   # Replaced by proper interfaces
src/notes/note-store.ts                # Replaced by PlatformNotes
src/notes/opfs-note-store.ts           # Moved to platform/chrome/notes.ts
src/notes/fs-note-store.ts             # Moved to platform/electron/notes.ts
```

---

## Task 1: Foundation — Platform Types + Build Config

Create the interface definitions and wire up the `@platform` Vite alias. No behavior change — both builds should still work identically.

**Files:**
- Create: `src/platform/types.ts`
- Modify: `vite.config.chrome.ts`
- Modify: `vite.config.electron.ts`
- Modify: `tsconfig.json`

- [ ] **Step 1: Create `src/platform/types.ts`**

```typescript
// src/platform/types.ts
import type { AgentProgressEvent, ToolCall } from '../shared/types';

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

export interface ExtractionRequest {
  prompt: string;
  model: string;
  systemPrompt?: string;
  messages?: Array<{ role: 'user' | 'assistant'; content: string }>;
}

export interface LLMResult {
  content: string;
  inputTokens: number;
  outputTokens: number;
}

export interface AgentRequest {
  runId: string;
  userPrompt: string;
  model: string;
  tabId?: number;
  notesEnabled: boolean;
}

export interface ChatRequest {
  requestId: string;
  model: string;
  systemPrompt: string;
  messages: Array<{ role: string; content: unknown }>;
  tools?: Array<{ name: string; description: string; input_schema: Record<string, unknown> }>;
}

export interface ChatResult {
  textContent: string;
  toolCalls: ToolCall[];
  stopReason: string;
  inputTokens: number;
  outputTokens: number;
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

export interface TabInfo {
  id: number;
  url: string;
  title: string;
}

export interface PlatformBrowser {
  getActiveTab(): Promise<TabInfo | null>;
  getPageContent(tabId: number): Promise<string>;
  executeTool(tabId: number, tool: string, params: Record<string, unknown>): Promise<string>;
  onPageCapture(cb: (data: { title: string; url: string; content: string }) => void): () => void;
}
```

- [ ] **Step 2: Add `@platform` alias to `vite.config.chrome.ts`**

In `vite.config.chrome.ts`, change the `resolve` block (around line 196-199):

```typescript
// Before
resolve: {
  alias: {
    '@': resolve(__dirname, 'src'),
  },
},

// After
resolve: {
  alias: {
    '@': resolve(__dirname, 'src'),
    '@platform': resolve(__dirname, 'src/platform/chrome'),
  },
},
```

Also add the same `@platform` alias to every sub-build plugin that has its own `resolve.alias` (contentScriptPlugin, layoutWorkerPlugin, dbWorkerPlugin, dbSharedWorkerPlugin). Each has a `resolve: { alias: { '@': resolve(__dirname, 'src') } }` block — add `'@platform': resolve(__dirname, 'src/platform/chrome')` to each.

- [ ] **Step 3: Add `@platform` alias to `vite.config.electron.ts`**

Same pattern. Change the main `resolve` block (around line 134-135):

```typescript
// Before
resolve: {
  alias: { '@': resolve(__dirname, 'src') },
},

// After
resolve: {
  alias: {
    '@': resolve(__dirname, 'src'),
    '@platform': resolve(__dirname, 'src/platform/electron'),
  },
},
```

Also update sub-build plugins (layoutWorkerPlugin, dbWorkerPlugin, dbSharedWorkerPlugin) — add `'@platform': resolve(__dirname, 'src/platform/electron')` to each.

- [ ] **Step 4: Add `@platform` to `tsconfig.json` paths**

```jsonc
// Before
"paths": {
  "@/*": ["./src/*"]
}

// After
"paths": {
  "@/*": ["./src/*"],
  "@platform": ["./src/platform/chrome"],
  "@platform/*": ["./src/platform/chrome/*"]
}
```

- [ ] **Step 5: Create stub Chrome and Electron entry points**

These are temporary stubs so the build works. They re-export nothing yet but will be populated in subsequent tasks.

```typescript
// src/platform/chrome/index.ts
import type { PlatformId } from '../types';
export const platformId: PlatformId = 'chrome';
export async function initPlatform(): Promise<void> {}
```

```typescript
// src/platform/electron/index.ts
import type { PlatformId } from '../types';
export const platformId: PlatformId = 'electron';
export async function initPlatform(): Promise<void> {}
```

- [ ] **Step 6: Verify both builds**

Run: `npm run build`
Expected: Clean build, no errors. `dist/` produced.

Run: `npm run build:electron-renderer`
Expected: Clean build, no errors. `dist-electron/renderer/` produced.

- [ ] **Step 7: Commit**

```bash
git add src/platform/types.ts src/platform/chrome/index.ts src/platform/electron/index.ts vite.config.chrome.ts vite.config.electron.ts tsconfig.json
git commit -m "feat(platform): add platform interfaces and @platform build alias"
```

---

## Task 2: PlatformStorage — Implementations + Refactor Call Sites

Implement `ChromeStorage` and `ElectronStorage`, then refactor all ~34 UI-side `chrome.storage.local` call sites to use `import { storage } from '@platform'`.

**Files:**
- Create: `src/platform/chrome/storage.ts`
- Create: `src/platform/electron/storage.ts`
- Modify: `src/platform/chrome/index.ts`
- Modify: `src/platform/electron/index.ts`
- Modify: ~34 files in `src/ui/` and `src/graph/store/`

- [ ] **Step 1: Create `src/platform/chrome/storage.ts`**

```typescript
// src/platform/chrome/storage.ts
import type { PlatformStorage, StorageChange } from '../types';

export class ChromeStorage implements PlatformStorage {
  get<T = Record<string, unknown>>(keys?: string | string[]): Promise<T> {
    return chrome.storage.local.get(keys) as Promise<T>;
  }

  set(items: Record<string, unknown>): Promise<void> {
    return chrome.storage.local.set(items);
  }

  remove(keys: string | string[]): Promise<void> {
    return chrome.storage.local.remove(keys);
  }

  onChange(cb: (changes: Record<string, StorageChange>, area: string) => void): () => void {
    chrome.storage.onChanged.addListener(cb);
    return () => chrome.storage.onChanged.removeListener(cb);
  }
}
```

- [ ] **Step 2: Create `src/platform/electron/storage.ts`**

```typescript
// src/platform/electron/storage.ts
import type { PlatformStorage, StorageChange } from '../types';

declare const window: Window & {
  electronIPC: {
    invoke(channel: string, ...args: unknown[]): Promise<unknown>;
    on(channel: string, cb: (...args: unknown[]) => void): () => void;
  };
};

export class ElectronStorage implements PlatformStorage {
  get<T = Record<string, unknown>>(keys?: string | string[]): Promise<T> {
    return window.electronIPC.invoke('storage:get', keys) as Promise<T>;
  }

  set(items: Record<string, unknown>): Promise<void> {
    return window.electronIPC.invoke('storage:set', items) as Promise<void>;
  }

  remove(keys: string | string[]): Promise<void> {
    return window.electronIPC.invoke('storage:remove', keys) as Promise<void>;
  }

  onChange(cb: (changes: Record<string, StorageChange>, area: string) => void): () => void {
    return window.electronIPC.on('storage:changed', (changes: unknown, area: unknown) => {
      cb(changes as Record<string, StorageChange>, area as string);
    });
  }
}
```

- [ ] **Step 3: Export storage from both platform entry points**

Update `src/platform/chrome/index.ts`:
```typescript
import type { PlatformId } from '../types';
import { ChromeStorage } from './storage';

export const platformId: PlatformId = 'chrome';
export const storage = new ChromeStorage();
export async function initPlatform(): Promise<void> {}
```

Update `src/platform/electron/index.ts`:
```typescript
import type { PlatformId } from '../types';
import { ElectronStorage } from './storage';

export const platformId: PlatformId = 'electron';
export const storage = new ElectronStorage();
export async function initPlatform(): Promise<void> {}
```

- [ ] **Step 4: Refactor all UI-side `chrome.storage.local` call sites**

For each file, add `import { storage } from '@platform';` and replace:
- `chrome.storage.local.get(...)` → `storage.get(...)`
- `chrome.storage.local.set(...)` → `storage.set(...)`
- `chrome.storage.local.remove(...)` → `storage.remove(...)`
- `chrome.storage.onChanged.addListener(cb)` → `storage.onChange(cb)` (note: returns cleanup function)
- `chrome.storage.onChanged.removeListener(cb)` → use the cleanup function returned by `onChange`

**Files to refactor** (complete list from grep):

| File | Call sites |
|---|---|
| `src/ui/components/llm/TextInput.tsx` | 2: `.get('llmConfig')`, `.get(['usageRecords', 'usageBudget'])` |
| `src/ui/components/llm/PrivacyDisclosure.tsx` | 1: `.set({ privacyDisclosureAccepted: true })` |
| `src/ui/components/settings/SettingsPanel.tsx` | 6: `.get`, `.set`, `.remove` for llmConfig, usage, contextualRelevance |
| `src/ui/components/llm/PromptInput.tsx` | 4: `.get('llmConfig')`, `.get(['usageRecords', 'usageBudget'])`, `.get/.set` extractionNotes |
| `src/ui/components/llm/ExtractionSummary.tsx` | 1: `.get('usageBackendType')` |
| `src/ui/components/panels/MultiSelectPanel.tsx` | 1: `.get('llmConfig')` |
| `src/ui/hooks/useContextualRelevance.ts` | 2: `.get`, `.set` for relevance |
| `src/ui/hooks/useLLMExtraction.ts` | 6: `.get` for privacyDisclosure, llmConfig, extractionNotes |
| `src/ui/hooks/nl-query-utils.ts` | 1: `.get('llmConfig')` |
| `src/ui/hooks/useDisplayMode.ts` | 1: `.set({ displayMode })` |
| `src/graph/store/auth-store.ts` | 1: `onChanged.addListener` / `removeListener` |
| `src/graph/store/reading-list-store.ts` | 2: `.get('readingListItems')`, `onChanged.addListener` / `removeListener` |
| `src/graph/store/extraction-review-store.ts` | 1: `.get('llmConfig')` |

**Example refactor** for `src/ui/components/llm/TextInput.tsx`:

```typescript
// Before
chrome.storage.local.get('llmConfig').then((result: Record<string, any>) => { ... });

// After
import { storage } from '@platform';
storage.get('llmConfig').then((result: Record<string, any>) => { ... });
```

**For `chrome.storage.onChanged` pattern** (in `auth-store.ts`, `reading-list-store.ts`):

```typescript
// Before
chrome.storage.onChanged.addListener(storageListener);
return () => chrome.storage.onChanged.removeListener(storageListener);

// After
import { storage } from '@platform';
const cleanup = storage.onChange(storageListener);
return cleanup;
```

- [ ] **Step 5: Verify both builds**

Run: `npm run build && npm run build:electron-renderer`
Expected: Both clean.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "feat(platform): implement PlatformStorage and migrate all chrome.storage call sites"
```

---

## Task 3: PlatformDB — Move Transport, Keep Typed API

Extract the platform-specific transport from `db-client.ts` into `ChromeDB` and `ElectronDB`. The typed namespace API (`nodes`, `edges`, `spatial`, etc.) stays in `db-client.ts` and calls `db.request()` from `@platform`.

**Files:**
- Create: `src/platform/chrome/db.ts`
- Create: `src/platform/electron/db.ts`
- Modify: `src/platform/chrome/index.ts`
- Modify: `src/platform/electron/index.ts`
- Modify: `src/db/client/db-client.ts`
- Modify: `src/ui/main.tsx`

- [ ] **Step 1: Create `src/platform/chrome/db.ts`**

Move the SharedWorker/DedicatedWorker lifecycle from `db-client.ts` lines 1-163 into this file:

```typescript
// src/platform/chrome/db.ts
import type { PlatformDB } from '../types';

type WorkerRequest = {
  requestId: string;
  action: string;
  params?: unknown;
};

type WorkerResponse = {
  requestId: string;
  success: boolean;
  data?: unknown;
  error?: string;
};

const DB_REQUEST_TIMEOUT_MS = 10_000;

export class ChromeDB implements PlatformDB {
  private sharedWorker: SharedWorker | null = null;
  private port: MessagePort | null = null;
  private pendingRequests = new Map<
    string,
    { resolve: (data: unknown) => void; reject: (error: Error) => void; timer: ReturnType<typeof setTimeout> }
  >();

  async init(): Promise<void> {
    return new Promise((resolve, reject) => {
      try {
        const workerUrl = new URL('/db-shared-worker.js', location.origin).href;
        this.sharedWorker = new SharedWorker(workerUrl, { type: 'module' });
        this.port = this.sharedWorker.port;

        this.port.onmessage = (event: MessageEvent<WorkerResponse>) => {
          const { requestId, success, data, error } = event.data;

          if (requestId === '__needs_worker__') {
            this.spawnAndAttachWorker();
            return;
          }

          const pending = this.pendingRequests.get(requestId);
          if (!pending) return;

          clearTimeout(pending.timer);
          this.pendingRequests.delete(requestId);

          if (success) {
            pending.resolve(data);
          } else {
            pending.reject(new Error(error ?? 'Unknown DB error'));
          }
        };

        this.sharedWorker.onerror = (event) => {
          console.error('[DB Client] SharedWorker error:', event);
          reject(new Error('DB SharedWorker failed to load'));
        };

        this.port.start();

        this.request('init').then(() => {
          console.log('[DB Client] Database initialized via SharedWorker');
          resolve();
        }).catch(reject);
      } catch (e) {
        reject(e);
      }
    });
  }

  request(action: string, params?: unknown, timeoutMs?: number): Promise<unknown> {
    return new Promise((resolve, reject) => {
      if (!this.port) {
        reject(new Error('DB SharedWorker not initialized'));
        return;
      }

      const requestId = `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;

      const timer = setTimeout(() => {
        this.pendingRequests.delete(requestId);
        reject(new Error(`DB request timed out: ${action}`));
      }, timeoutMs ?? DB_REQUEST_TIMEOUT_MS);

      this.pendingRequests.set(requestId, { resolve, reject, timer });
      this.port.postMessage({ requestId, action, params } as WorkerRequest);
    });
  }

  onSync(cb: (event: unknown) => void): () => void {
    const channel = new BroadcastChannel('kg_extension_sync');
    const handler = (event: MessageEvent) => cb(event.data);
    channel.addEventListener('message', handler);
    return () => {
      channel.removeEventListener('message', handler);
      channel.close();
    };
  }

  notifyWorkerDying(): void {
    if (!this.port) return;
    this.port.postMessage({ requestId: '__worker_dying__', action: '__worker_dying__' } as WorkerRequest);
  }

  private spawnAndAttachWorker(): void {
    const dbWorkerUrl = new URL('/db-worker.js', location.origin).href;
    const dedicatedWorker = new Worker(dbWorkerUrl, { type: 'module' });
    dedicatedWorker.onerror = (event) => {
      console.error('[DB Client] Dedicated worker error:', event);
    };
    const channel = new MessageChannel();
    dedicatedWorker.postMessage({ action: '__attach_port__' }, [channel.port2]);
    this.port!.postMessage(
      { requestId: '__attach_worker__', action: '__attach_worker__' },
      [channel.port1],
    );
  }
}
```

- [ ] **Step 2: Create `src/platform/electron/db.ts`**

```typescript
// src/platform/electron/db.ts
import type { PlatformDB } from '../types';

declare const window: Window & {
  electronIPC: {
    invoke(channel: string, ...args: unknown[]): Promise<unknown>;
    on(channel: string, cb: (...args: unknown[]) => void): () => void;
  };
};

export class ElectronDB implements PlatformDB {
  async init(): Promise<void> {
    const response = await window.electronIPC.invoke('db:request', 'init', undefined) as { success: boolean; error?: string };
    if (!response.success) throw new Error(response.error ?? 'DB init failed');
    console.log('[DB Client] Database initialized via Electron IPC (better-sqlite3)');
  }

  async request(action: string, params?: unknown): Promise<unknown> {
    const response = await window.electronIPC.invoke('db:request', action, params) as { success: boolean; data?: unknown; error?: string };
    if (!response.success) throw new Error(response.error ?? 'DB request failed');
    return response.data;
  }

  onSync(cb: (event: unknown) => void): () => void {
    return window.electronIPC.on('db:sync', cb);
  }
}
```

- [ ] **Step 3: Export db from both platform entry points**

Update `src/platform/chrome/index.ts` — add:
```typescript
import { ChromeDB } from './db';
export const db = new ChromeDB();
```

Update `initPlatform`:
```typescript
export async function initPlatform(): Promise<void> {
  await db.init();
}
```

Update `src/platform/electron/index.ts` — add:
```typescript
import { ElectronDB } from './db';
export const db = new ElectronDB();
```

Update `initPlatform`:
```typescript
export async function initPlatform(): Promise<void> {
  await db.init();
}
```

- [ ] **Step 4: Rewrite `src/db/client/db-client.ts` to use platform DB**

Remove all platform-specific transport code (lines 1-163). The file becomes a thin typed API:

```typescript
// src/db/client/db-client.ts
import { db } from '@platform';

let ready = false;

export async function initDbClient(): Promise<void> {
  if (ready) return;
  await db.init();
  ready = true;
}

export function isDbReady(): boolean {
  return ready;
}

function sendRequest(action: string, params?: unknown): Promise<unknown> {
  return db.request(action, params);
}

// Everything below this line stays exactly as-is:
// dbQuery, dbExec, loadGraph, nodes, edges, nodeTypes, sourceContent,
// noteAttachments, noteSearch, entityResolution, tags, noteFolders,
// edgeSources, entitySources, indexedFiles, spatial, readingList,
// chat, graph, clearAll, stressTest
```

Keep all the typed namespace exports (`nodes`, `edges`, `spatial`, etc.) unchanged — they all call `sendRequest()` which now delegates to `db.request()`.

Remove `notifyWorkerDying` export — move to a Chrome-only path or expose from `ChromeDB` directly if still needed.

- [ ] **Step 5: Update `src/ui/main.tsx`**

```typescript
// src/ui/main.tsx
import React from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import './styles.css';
import { initPlatform } from '@platform';

await initPlatform();

const root = document.getElementById('root');
if (root) {
  createRoot(root).render(
    <React.StrictMode>
      <App />
    </React.StrictMode>
  );
}
```

This replaces the `window.electronAPI` / `installChromeStubs()` check. The `initPlatform()` call initializes DB (and later, notes).

**Important:** Wherever `initDbClient()` is called in `App.tsx` or other startup code, it can now be removed since `initPlatform()` handles it. Check `App.tsx` for the call and remove it.

- [ ] **Step 6: Verify both builds**

Run: `npm run build && npm run build:electron-renderer`
Expected: Both clean.

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "feat(platform): implement PlatformDB and migrate db-client transport layer"
```

---

## Task 4: PlatformNotes — Move Existing Implementations

Move `OpfsNoteStore` and `FsNoteStore` into the platform directories. Update consumers to import `notes` from `@platform`.

**Files:**
- Create: `src/platform/chrome/notes.ts`
- Create: `src/platform/electron/notes.ts`
- Modify: `src/platform/chrome/index.ts`
- Modify: `src/platform/electron/index.ts`
- Delete: `src/notes/note-store.ts`
- Delete: `src/notes/opfs-note-store.ts`
- Delete: `src/notes/fs-note-store.ts`
- Modify: all files importing from `notes/note-store`

- [ ] **Step 1: Create `src/platform/chrome/notes.ts`**

Copy content from `src/notes/opfs-note-store.ts`, rename class to `ChromeNotes`, implement `PlatformNotes`:

```typescript
// src/platform/chrome/notes.ts
import type { PlatformNotes } from '../types';

export class ChromeNotes implements PlatformNotes {
  private dirHandle: FileSystemDirectoryHandle | null = null;

  async init(): Promise<void> {
    const root = await navigator.storage.getDirectory();
    this.dirHandle = await root.getDirectoryHandle('notes', { create: true });
  }

  async read(nodeId: string): Promise<string | null> {
    try {
      const file = await this.dirHandle!.getFileHandle(`${nodeId}.md`);
      const blob = await file.getFile();
      return await blob.text();
    } catch {
      return null;
    }
  }

  async write(nodeId: string, markdown: string): Promise<void> {
    const file = await this.dirHandle!.getFileHandle(`${nodeId}.md`, { create: true });
    const writable = await file.createWritable();
    await writable.write(markdown);
    await writable.close();
  }

  async remove(nodeId: string): Promise<void> {
    try {
      await this.dirHandle!.removeEntry(`${nodeId}.md`);
    } catch {
      // File doesn't exist — harmless
    }
  }

  async list(): Promise<string[]> {
    const ids: string[] = [];
    for await (const [name] of (this.dirHandle as any).entries()) {
      if (name.endsWith('.md')) {
        ids.push(name.slice(0, -3));
      }
    }
    return ids;
  }

  async exists(nodeId: string): Promise<boolean> {
    try {
      await this.dirHandle!.getFileHandle(`${nodeId}.md`);
      return true;
    } catch {
      return false;
    }
  }
}
```

- [ ] **Step 2: Create `src/platform/electron/notes.ts`**

```typescript
// src/platform/electron/notes.ts
import type { PlatformNotes } from '../types';

declare const window: Window & {
  electronIPC: {
    invoke(channel: string, ...args: unknown[]): Promise<unknown>;
    on(channel: string, cb: (...args: unknown[]) => void): () => void;
  };
};

export class ElectronNotes implements PlatformNotes {
  async init(): Promise<void> {
    await window.electronIPC.invoke('notes:init');
  }

  async read(nodeId: string): Promise<string | null> {
    return window.electronIPC.invoke('notes:read', nodeId) as Promise<string | null>;
  }

  async write(nodeId: string, markdown: string): Promise<void> {
    await window.electronIPC.invoke('notes:write', nodeId, markdown);
  }

  async remove(nodeId: string): Promise<void> {
    await window.electronIPC.invoke('notes:remove', nodeId);
  }

  async list(): Promise<string[]> {
    return window.electronIPC.invoke('notes:list') as Promise<string[]>;
  }

  async exists(nodeId: string): Promise<boolean> {
    return window.electronIPC.invoke('notes:exists', nodeId) as Promise<boolean>;
  }
}
```

- [ ] **Step 3: Export notes from both platform entry points and update `initPlatform`**

In `src/platform/chrome/index.ts`, add:
```typescript
import { ChromeNotes } from './notes';
export const notes = new ChromeNotes();

export async function initPlatform(): Promise<void> {
  await db.init();
  await notes.init();
}
```

Same pattern for `src/platform/electron/index.ts` with `ElectronNotes`.

- [ ] **Step 4: Update all consumers of `notes/note-store`**

Find all imports:
```bash
grep -rn "from.*notes/note-store\|from.*notes/markdown-utils" src/ui/ src/graph/ --include='*.ts' --include='*.tsx'
```

For each file that imports `read`, `write`, `remove`, `list`, `exists` from `../../notes/note-store` (or similar path), replace with:

```typescript
// Before
import { read, write, remove } from '../../notes/note-store';

// After
import { notes } from '@platform';
// Then: notes.read(...), notes.write(...), notes.remove(...)
```

**Note:** `markdown-utils.ts` and `markdown-parser.ts` stay in `src/notes/` — they are platform-independent utility functions, not storage implementations.

Also remove the `initNoteStore()` call from startup code — `initPlatform()` handles it.

- [ ] **Step 5: Delete old note-store files**

```bash
git rm src/notes/note-store.ts src/notes/opfs-note-store.ts src/notes/fs-note-store.ts
```

- [ ] **Step 6: Verify both builds**

Run: `npm run build && npm run build:electron-renderer`
Expected: Both clean.

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "feat(platform): implement PlatformNotes and migrate note storage"
```

---

## Task 5: Shared Core — Extract Agent Loop, Retry, Usage, Prompts

Extract duplicated backend logic into `src/core/` before building the LLM platform interfaces. Both the service worker (Chrome) and main process (Electron) will import from here.

**Files:**
- Create: `src/core/system-prompts.ts`
- Create: `src/core/retry.ts`
- Create: `src/core/usage.ts`
- Create: `src/core/agent-loop.ts`
- Modify: `src/offscreen/agent-loop.ts`
- Modify: `electron/llm-backend.ts`
- Modify: `src/service-worker/retry-handler.ts`

- [ ] **Step 1: Create `src/core/system-prompts.ts`**

Extract from `src/offscreen/agent-loop.ts` lines 10-52 (identical in `electron/llm-backend.ts`):

```typescript
// src/core/system-prompts.ts

export function getAgentSystemPrompt(notesEnabled: boolean): string {
  const notesRules = notesEnabled
    ? `

Rules for NOTES (enabled):
- When calling save_entities, include exactly ONE note in the "notes" array — a structured summary of the resource.
- Title: "Summary: <page title>"
- The note content MUST be markdown with this structure:
  1. **TL;DR** section first — 2-3 sentences capturing the core message.
  2. Then 3-5 **sections** that break down the content by topic/theme. Each section should have a ## heading and a descriptive paragraph.
  3. Include **markdown tables** where the page contains structured/comparative data (features, specs, comparisons, timelines, etc.). Reproduce key tables from the source.
  4. Include **images** from the page where relevant using ![description](image_url). Use the original image URLs from the page. Only include images that add value (diagrams, charts, screenshots), not decorative ones.
- Use [[Entity Name]] wikilinks to reference entities from the nodes array.
- "about" lists 1-3 key entities the note covers. "mentions" lists other referenced entities.
- Entity names in about/mentions must match the nodes array exactly.`
    : '';

  return `You are a knowledge graph extraction agent. Your job is to inspect a web page using the provided tools, then extract entities (nodes) and typed relationships (edges) into a structured knowledge graph.

Workflow:
1. Start by using get_page_metadata to understand the page structure
2. Use get_page_content to read the main content (returns markdown by default, preserving headings, links, tables, and lists). Use format: "text" only if you need plain text.
3. Use more targeted tools (query_selector, get_tables, get_structured_data) for specific content if needed
4. If the user asks about linked content, use fetch_url to read linked pages (also returns markdown)
5. When you have gathered enough information, call save_entities with the extracted nodes and edges

Rules for NODES:
- Do NOT output resource nodes. The system automatically creates a resource node for the source URL. Every node you emit is an entity.
- Use the "label" field on each node to categorize it semantically. Allowed labels:
  concept, person, organization, technology, event, place, methodology.
- If no label fits, default to "concept".
- Include relevant properties as key-value pairs on nodes.
- Include a "tags" array for domain annotations (e.g. ["technology", "ai"]).

Rules for EDGES:
- Leverage markdown structure (headings, tables, links) to identify relationships more accurately.
- Prefer these seed relationship labels when applicable: subfield_of, part_of, instance_of, created_by, affiliated_with, used_in, builds_on, enables, contradicts, alternative_to, preceded_by.
- Otherwise use consistent, lowercase snake_case labels (e.g., "works_at", "located_in").
- Ensure all edges reference entities that exist in your nodes array by their exact name.
- Call save_entities exactly once when done — it is the terminal tool.${notesRules}

Be efficient: don't call tools unnecessarily. If get_page_content gives you everything you need, proceed directly to save_entities.`;
}
```

- [ ] **Step 2: Create `src/core/retry.ts`**

Extract and generalize from `src/service-worker/retry-handler.ts`:

```typescript
// src/core/retry.ts
import type { RateLimitInfo } from '../platform/types';
import { LLMApiError } from '../shared/llm-errors';

const MAX_RETRIES = 3;
const MAX_WAIT_MS = 60_000;

export function isRetryableError(error: unknown): error is LLMApiError {
  if (error instanceof LLMApiError) {
    return error.errorType === 'rate_limit' || error.errorType === 'overloaded';
  }
  return false;
}

export async function withRetry<T>(
  fn: () => Promise<T>,
  opts?: {
    maxRetries?: number;
    onRetryWait?: (info: RateLimitInfo) => void;
  },
): Promise<T> {
  const maxRetries = opts?.maxRetries ?? MAX_RETRIES;
  let lastError: unknown;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (e) {
      lastError = e;
      if (attempt >= maxRetries || !isRetryableError(e)) throw e;

      const waitMs = Math.min(e.retryAfterMs ?? 30_000, MAX_WAIT_MS);
      opts?.onRetryWait?.({
        retryAfterMs: waitMs,
        retryCount: attempt + 1,
        maxRetries,
      });
      await new Promise(resolve => setTimeout(resolve, waitMs));
    }
  }

  throw lastError;
}
```

- [ ] **Step 3: Create `src/core/usage.ts`**

```typescript
// src/core/usage.ts
import { computeCostCents } from '../shared/constants';

export interface UsageStore {
  get(key: string): Record<string, unknown>;
  set(items: Record<string, unknown>): void;
}

export function recordUsage(
  store: UsageStore,
  path: string,
  model: string,
  inputTokens: number,
  outputTokens: number,
): void {
  const data = store.get('usageRecords');
  const records = (data.usageRecords as any[]) ?? [];
  records.push({
    timestamp: Date.now(),
    path,
    model,
    inputTokens,
    outputTokens,
    costCents: computeCostCents(model, inputTokens, outputTokens),
  });
  store.set({ usageRecords: records });
}
```

- [ ] **Step 4: Create `src/core/agent-loop.ts`**

Generalized version of `src/offscreen/agent-loop.ts` with injectable tool executor:

```typescript
// src/core/agent-loop.ts
import { AGENT_TOOLS, toAnthropicTools } from '../shared/agent-tools';
import type { AgentProgressEvent, ExtractionResult, ToolCall } from '../shared/types';
import type { AnthropicMessage, AnthropicContentBlock, AnthropicToolsResult } from '../offscreen/llm-executor';
import { getAgentSystemPrompt } from './system-prompts';

const MAX_ITERATIONS = 15;

export interface ToolExecutor {
  execute(tool: ToolCall): Promise<{ result: string; error?: string }>;
}

export type StreamFn = (
  apiKey: string,
  model: string,
  systemPrompt: string,
  messages: AnthropicMessage[],
  tools: Array<{ name: string; description: string; input_schema: Record<string, unknown> }>,
  onChunk: (text: string) => void,
) => Promise<AnthropicToolsResult>;

export interface AgentLoopConfig {
  runId: string;
  userPrompt: string;
  apiKey: string;
  model: string;
  maxIterations?: number;
  notesEnabled?: boolean;
}

export async function runAgentLoop(
  config: AgentLoopConfig,
  streamFn: StreamFn,
  toolExecutor: ToolExecutor,
  onProgress: (event: AgentProgressEvent) => void,
): Promise<void> {
  const maxIter = config.maxIterations ?? MAX_ITERATIONS;
  const systemPrompt = getAgentSystemPrompt(config.notesEnabled ?? false);
  const anthropicTools = toAnthropicTools(AGENT_TOOLS);
  const messages: AnthropicMessage[] = [{ role: 'user', content: config.userPrompt }];

  let totalInputTokens = 0;
  let totalOutputTokens = 0;

  for (let i = 0; i < maxIter; i++) {
    onProgress({ type: 'llm_start' });

    let result: AnthropicToolsResult;
    try {
      result = await streamFn(
        config.apiKey, config.model, systemPrompt,
        messages, anthropicTools,
        (chunk) => onProgress({ type: 'llm_chunk', text: chunk }),
      );
    } catch (e: any) {
      onProgress({ type: 'error', error: e.message });
      return;
    }

    totalInputTokens += result.inputTokens;
    totalOutputTokens += result.outputTokens;
    onProgress({ type: 'llm_end', text: result.textContent });

    if (result.toolCalls.length === 0) {
      onProgress({ type: 'done', inputTokens: totalInputTokens, outputTokens: totalOutputTokens, model: config.model });
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
      onProgress({ type: 'tool_call', toolCall: tc });

      if (tc.name === 'save_entities') {
        const extractionResult = tc.input as unknown as ExtractionResult;
        onProgress({ type: 'extraction_complete', extractionResult, inputTokens: totalInputTokens, outputTokens: totalOutputTokens, model: config.model });
        onProgress({ type: 'done', inputTokens: totalInputTokens, outputTokens: totalOutputTokens, model: config.model });
        return;
      }

      const { result: toolResult, error: toolError } = await toolExecutor.execute(tc);

      onProgress({
        type: 'tool_result',
        toolCall: tc,
        toolResult: toolError ? undefined : toolResult,
        toolError,
      });

      toolResultBlocks.push({
        type: 'tool_result',
        tool_use_id: tc.id,
        content: toolError ? `Error: ${toolError}` : toolResult,
        is_error: !!toolError,
      });
    }

    messages.push({ role: 'user', content: toolResultBlocks });
  }

  onProgress({ type: 'error', error: 'Max iterations reached without completing extraction' });
}
```

- [ ] **Step 5: Update `src/offscreen/agent-loop.ts` to use shared core**

Rewrite to import from `src/core/` and provide Chrome-specific tool executor:

```typescript
// src/offscreen/agent-loop.ts
import { runAgentLoop as coreRunAgentLoop, type ToolExecutor } from '../core/agent-loop';
import { streamAnthropicWithTools } from './llm-executor';
import { AGENT_TOOLS } from '../shared/agent-tools';
import { fetchAndCleanContent, isBlockedUrl } from './url-utils';
import type { AgentProgressEvent, ToolCall } from '../shared/types';

const TOOL_TIMEOUT_MS = 30_000;
const FETCH_MAX_BYTES = 20_000;

interface AgentLoopParams {
  runId: string;
  userPrompt: string;
  tabId: number;
  apiKey: string;
  model: string;
  maxIterations?: number;
  notesEnabled?: boolean;
  onProgress: (event: AgentProgressEvent) => void;
}

class ContentScriptToolExecutor implements ToolExecutor {
  constructor(private tabId: number, private runId: string) {}

  async execute(tc: ToolCall): Promise<{ result: string; error?: string }> {
    const toolDef = AGENT_TOOLS.find((t) => t.name === tc.name);
    if (!toolDef) return { result: '', error: `Unknown tool: ${tc.name}` };

    if (toolDef.executionContext === 'content-script') {
      return this.executeRemote(tc);
    } else if (tc.name === 'fetch_url') {
      const url = tc.input.url as string;
      if (isBlockedUrl(url)) return { result: '', error: 'URL is blocked or invalid' };
      const { content, error } = await fetchAndCleanContent(url, FETCH_MAX_BYTES);
      return { result: content, error };
    }
    return { result: '', error: `Tool ${tc.name} cannot be executed here` };
  }

  private executeRemote(tc: ToolCall): Promise<{ result: string; error?: string }> {
    return new Promise((resolve) => {
      const timeout = setTimeout(() => {
        resolve({ result: '', error: `Tool ${tc.name} timed out after ${TOOL_TIMEOUT_MS / 1000}s` });
      }, TOOL_TIMEOUT_MS);

      chrome.runtime.sendMessage(
        { type: 'TOOL_EXECUTE', payload: { runId: this.runId, toolCallId: tc.id, toolName: tc.name, toolInput: tc.input, tabId: this.tabId } },
        (response) => {
          clearTimeout(timeout);
          if (chrome.runtime.lastError) resolve({ result: '', error: chrome.runtime.lastError.message });
          else if (response?.error) resolve({ result: response.result ?? '', error: response.error });
          else resolve({ result: response?.result ?? '' });
        },
      );
    });
  }
}

export async function runAgentLoop(params: AgentLoopParams): Promise<void> {
  const toolExecutor = new ContentScriptToolExecutor(params.tabId, params.runId);
  await coreRunAgentLoop(
    {
      runId: params.runId,
      userPrompt: params.userPrompt,
      apiKey: params.apiKey,
      model: params.model,
      maxIterations: params.maxIterations,
      notesEnabled: params.notesEnabled,
    },
    streamAnthropicWithTools,
    toolExecutor,
    params.onProgress,
  );
}
```

- [ ] **Step 6: Update `electron/llm-backend.ts` to use shared core**

Replace the `handleAgentRun` function and system prompt with imports from `src/core/`:

```typescript
// At the top of electron/llm-backend.ts, replace local imports:
import { runAgentLoop as coreRunAgentLoop, type ToolExecutor } from '../src/core/agent-loop';
import { recordUsage } from '../src/core/usage';
import { withRetry } from '../src/core/retry';
// Keep: import { executeLLMRequestStreaming, streamAnthropicWithTools } from '../src/offscreen/llm-executor';
// Remove: local getAgentSystemPrompt, local recordUsage, local computeCostCents
```

Replace `handleAgentRun`:
```typescript
async function handleAgentRun(payload: any, broadcast: BroadcastFn): Promise<void> {
  const { runId, userPrompt, model, notesEnabled } = payload;
  try {
    const apiKey = await getApiKey();
    const toolExecutor: ToolExecutor = {
      async execute(tc) {
        const toolDef = AGENT_TOOLS.find((t) => t.name === tc.name);
        if (!toolDef) return { result: '', error: `Unknown tool: ${tc.name}` };
        if (toolDef.executionContext === 'content-script') {
          return { result: '', error: 'Content script tools are not available in desktop mode. Use fetch_url instead.' };
        }
        if (tc.name === 'fetch_url') {
          const url = tc.input.url as string;
          if (isBlockedUrl(url)) return { result: '', error: 'URL is blocked or invalid' };
          const res = await fetchAndCleanContent(url, FETCH_MAX_BYTES);
          return { result: res.content, error: res.error };
        }
        return { result: '', error: `Tool ${tc.name} cannot be executed in this context` };
      },
    };

    await coreRunAgentLoop(
      { runId, userPrompt, apiKey, model, notesEnabled: notesEnabled ?? false },
      streamAnthropicWithTools,
      toolExecutor,
      (event) => broadcast({ type: 'AGENT_PROGRESS', payload: { runId, event } }),
    );
  } catch (e: any) {
    broadcast({ type: 'AGENT_PROGRESS', payload: { runId, event: { type: 'error', error: e.message } } });
  }
}
```

Wrap LLM calls with `withRetry` in `handleLLMRequest` and `handleChatRequest` to fix the missing retry on Electron.

Replace `recordUsage` calls with the shared version:
```typescript
import { recordUsage } from '../src/core/usage';

// Adapt storage to UsageStore interface
const usageStore = {
  get: (key: string) => storage!.get(key),
  set: (items: Record<string, unknown>) => storage!.set(items),
};

// In handleLLMRequest, handleChatRequest:
recordUsage(usageStore, 'simple', payload.model, result.inputTokens, result.outputTokens);
```

- [ ] **Step 7: Verify both builds**

Run: `npm run build && npm run build:electron-renderer`
Expected: Both clean.

- [ ] **Step 8: Commit**

```bash
git add -A
git commit -m "feat(core): extract shared agent loop, retry, usage, and system prompts"
```

---

## Task 6: PlatformLLM — Chrome Implementation

Implement `ChromeLLM` which wraps the Chrome message-based streaming pattern behind the `PlatformLLM` interface. This extracts the streaming logic currently spread across `useLLMExtraction.ts` hooks.

**Files:**
- Create: `src/platform/chrome/llm.ts`
- Modify: `src/platform/chrome/index.ts`

- [ ] **Step 1: Create `src/platform/chrome/llm.ts`**

```typescript
// src/platform/chrome/llm.ts
import type { PlatformLLM, ExtractionRequest, LLMResult, AgentRequest, ChatRequest, ChatResult, RateLimitInfo } from '../types';
import type { AgentProgressEvent } from '../../shared/types';
import { computeCostCents } from '../../shared/constants';

function generateId(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

export class ChromeLLM implements PlatformLLM {
  async streamExtraction(
    request: ExtractionRequest,
    onChunk: (text: string) => void,
    onRateLimitWait?: (info: RateLimitInfo) => void,
  ): Promise<LLMResult> {
    const requestId = generateId();
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        cleanup();
        reject(new Error('LLM stream timed out after 120s'));
      }, 120_000);

      const listener = (message: any) => {
        if (message.type === 'RATE_LIMIT_WAIT' && message.payload?.requestId === requestId) {
          onRateLimitWait?.(message.payload);
          return;
        }
        if (message.type !== 'LLM_STREAM_CHUNK' || message.payload?.requestId !== requestId) return;
        const { chunk, done, content, error, errorType, inputTokens, outputTokens } = message.payload;
        if (chunk) onChunk(chunk);
        if (done) {
          if (error && (errorType === 'rate_limit' || errorType === 'overloaded')) return;
          cleanup();
          if (error) { reject(new Error(error)); return; }
          resolve({ content: content ?? '', inputTokens: inputTokens ?? 0, outputTokens: outputTokens ?? 0 });
        }
      };

      const cleanup = () => {
        clearTimeout(timeout);
        chrome.runtime.onMessage.removeListener(listener);
      };

      chrome.runtime.onMessage.addListener(listener);
      chrome.runtime.sendMessage({
        type: 'LLM_REQUEST',
        requestId,
        payload: {
          prompt: request.prompt,
          model: request.model,
          systemPrompt: request.systemPrompt,
          messages: request.messages,
        },
      });
    });
  }

  async runAgent(
    request: AgentRequest,
    onProgress: (event: AgentProgressEvent) => void,
  ): Promise<void> {
    const { runId } = request;
    return new Promise((resolve, reject) => {
      const listener = (message: any) => {
        if (message.type !== 'AGENT_PROGRESS' || message.payload?.runId !== runId) return;
        const event: AgentProgressEvent = message.payload.event;
        onProgress(event);
        if (event.type === 'done' || event.type === 'error') {
          chrome.runtime.onMessage.removeListener(listener);
          if (event.type === 'error') reject(new Error(event.error));
          else resolve();
        }
      };

      chrome.runtime.onMessage.addListener(listener);
      chrome.runtime.sendMessage({
        type: 'AGENT_RUN_START',
        payload: {
          runId: request.runId,
          userPrompt: request.userPrompt,
          model: request.model,
          tabId: request.tabId,
          notesEnabled: request.notesEnabled,
        },
      });
    });
  }

  async streamChat(
    request: ChatRequest,
    onChunk: (text: string) => void,
    onRateLimitWait?: (info: RateLimitInfo) => void,
  ): Promise<ChatResult> {
    const { requestId } = request;
    return new Promise((resolve, reject) => {
      const listener = (message: any) => {
        if (message.type === 'RATE_LIMIT_WAIT' && message.payload?.requestId === requestId) {
          onRateLimitWait?.(message.payload);
          return;
        }
        if (message.type !== 'CHAT_LLM_STREAM' || message.payload?.requestId !== requestId) return;
        const { textChunk, done, textContent, toolCalls, stopReason, error, errorType, inputTokens, outputTokens } = message.payload;
        if (textChunk) onChunk(textChunk);
        if (done) {
          if (error && (errorType === 'rate_limit' || errorType === 'overloaded')) return;
          chrome.runtime.onMessage.removeListener(listener);
          if (error) { reject(new Error(error)); return; }
          resolve({
            textContent: textContent ?? '',
            toolCalls: toolCalls ?? [],
            stopReason: stopReason ?? 'end_turn',
            inputTokens: inputTokens ?? 0,
            outputTokens: outputTokens ?? 0,
          });
        }
      };

      chrome.runtime.onMessage.addListener(listener);
      chrome.runtime.sendMessage({
        type: 'CHAT_LLM_REQUEST',
        payload: {
          requestId: request.requestId,
          model: request.model,
          systemPrompt: request.systemPrompt,
          messages: request.messages,
          tools: request.tools,
        },
      });
    });
  }
}
```

- [ ] **Step 2: Export llm from Chrome entry point**

In `src/platform/chrome/index.ts`, add:
```typescript
import { ChromeLLM } from './llm';
export const llm = new ChromeLLM();
```

- [ ] **Step 3: Verify Chrome build**

Run: `npm run build`
Expected: Clean build.

- [ ] **Step 4: Commit**

```bash
git add src/platform/chrome/llm.ts src/platform/chrome/index.ts
git commit -m "feat(platform): implement ChromeLLM with message-based streaming"
```

---

## Task 7: PlatformLLM — Electron Implementation + Preload + IPC

Implement `ElectronLLM` with dedicated IPC channels. Update preload to generic IPC bridge. Add new IPC handlers in main process.

**Files:**
- Create: `src/platform/electron/llm.ts`
- Modify: `src/platform/electron/index.ts`
- Modify: `electron/preload.ts`
- Modify: `electron/main.ts`

- [ ] **Step 1: Create `src/platform/electron/llm.ts`**

```typescript
// src/platform/electron/llm.ts
import type { PlatformLLM, ExtractionRequest, LLMResult, AgentRequest, ChatRequest, ChatResult, RateLimitInfo } from '../types';
import type { AgentProgressEvent } from '../../shared/types';

declare const window: Window & {
  electronIPC: {
    invoke(channel: string, ...args: unknown[]): Promise<unknown>;
    on(channel: string, cb: (...args: unknown[]) => void): () => void;
  };
};

function generateId(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

export class ElectronLLM implements PlatformLLM {
  async streamExtraction(
    request: ExtractionRequest,
    onChunk: (text: string) => void,
    onRateLimitWait?: (info: RateLimitInfo) => void,
  ): Promise<LLMResult> {
    const requestId = generateId();
    return new Promise((resolve, reject) => {
      const cleanup = window.electronIPC.on('llm:extraction-chunk', (data: unknown) => {
        const d = data as any;
        if (d.requestId !== requestId) return;
        if (d.rateLimitWait) { onRateLimitWait?.(d.rateLimitWait); return; }
        if (d.chunk) onChunk(d.chunk);
        if (d.done) {
          cleanup();
          if (d.error) { reject(new Error(d.error)); return; }
          resolve({ content: d.content ?? '', inputTokens: d.inputTokens ?? 0, outputTokens: d.outputTokens ?? 0 });
        }
      });
      window.electronIPC.invoke('llm:stream-extraction', { requestId, ...request }).catch((e) => {
        cleanup();
        reject(e);
      });
    });
  }

  async runAgent(
    request: AgentRequest,
    onProgress: (event: AgentProgressEvent) => void,
  ): Promise<void> {
    return new Promise((resolve, reject) => {
      const cleanup = window.electronIPC.on('llm:agent-progress', (data: unknown) => {
        const d = data as any;
        if (d.runId !== request.runId) return;
        onProgress(d.event);
        if (d.event.type === 'done' || d.event.type === 'error') {
          cleanup();
          if (d.event.type === 'error') reject(new Error(d.event.error));
          else resolve();
        }
      });
      window.electronIPC.invoke('llm:run-agent', request).catch((e) => {
        cleanup();
        reject(e);
      });
    });
  }

  async streamChat(
    request: ChatRequest,
    onChunk: (text: string) => void,
    onRateLimitWait?: (info: RateLimitInfo) => void,
  ): Promise<ChatResult> {
    return new Promise((resolve, reject) => {
      const cleanup = window.electronIPC.on('llm:chat-chunk', (data: unknown) => {
        const d = data as any;
        if (d.requestId !== request.requestId) return;
        if (d.rateLimitWait) { onRateLimitWait?.(d.rateLimitWait); return; }
        if (d.textChunk) onChunk(d.textChunk);
        if (d.done) {
          cleanup();
          if (d.error) { reject(new Error(d.error)); return; }
          resolve({
            textContent: d.textContent ?? '',
            toolCalls: d.toolCalls ?? [],
            stopReason: d.stopReason ?? 'end_turn',
            inputTokens: d.inputTokens ?? 0,
            outputTokens: d.outputTokens ?? 0,
          });
        }
      });
      window.electronIPC.invoke('llm:stream-chat', request).catch((e) => {
        cleanup();
        reject(e);
      });
    });
  }
}
```

- [ ] **Step 2: Export llm from Electron entry point**

In `src/platform/electron/index.ts`, add:
```typescript
import { ElectronLLM } from './llm';
export const llm = new ElectronLLM();
```

- [ ] **Step 3: Update `electron/preload.ts` to generic IPC bridge**

Replace the entire file content with:

```typescript
// electron/preload.ts
import { contextBridge, ipcRenderer } from 'electron';

contextBridge.exposeInMainWorld('electronIPC', {
  invoke: (channel: string, ...args: any[]) => ipcRenderer.invoke(channel, ...args),
  on: (channel: string, cb: (...args: any[]) => void) => {
    const handler = (_event: any, ...args: any[]) => cb(...args);
    ipcRenderer.on(channel, handler);
    return () => ipcRenderer.removeListener(channel, handler);
  },
});
```

**Important:** This removes the old `electronAPI`, `electronStorage`, `electronDB`, `electronNotes`, `electronRuntime`, `electronCompanion` globals. All Electron platform implementations now use `window.electronIPC.invoke(channel, ...)` and `window.electronIPC.on(channel, ...)` instead.

- [ ] **Step 4: Add dedicated LLM IPC handlers to `electron/main.ts`**

Add these handlers inside the `app.whenReady().then(...)` block, alongside the existing storage/db/notes handlers:

```typescript
  // --- LLM streaming ---
  ipcMain.handle('llm:stream-extraction', async (event, payload) => {
    const { requestId, prompt, model, systemPrompt, messages } = payload;
    const apiKey = await getApiKeyFromStorage(storage);
    const fullPayload = { apiKey, prompt, model, systemPrompt, messages };

    let buffer = '';
    const BUFFER_MAX_BYTES = 100;
    let flushTimer: ReturnType<typeof setTimeout> | null = null;

    const flush = () => {
      if (buffer) {
        event.sender.send('llm:extraction-chunk', { requestId, chunk: buffer, done: false });
        buffer = '';
      }
      if (flushTimer) { clearTimeout(flushTimer); flushTimer = null; }
    };

    try {
      const result = await withRetry(
        () => executeLLMRequestStreaming(fullPayload, (text, done) => {
          if (done) { flush(); return; }
          buffer += text;
          if (Buffer.byteLength(buffer) >= BUFFER_MAX_BYTES) flush();
          else if (!flushTimer) flushTimer = setTimeout(flush, 50);
        }),
        { onRetryWait: (info) => event.sender.send('llm:extraction-chunk', { requestId, rateLimitWait: info }) },
      );

      event.sender.send('llm:extraction-chunk', {
        requestId, chunk: '', done: true,
        content: result.content, inputTokens: result.inputTokens, outputTokens: result.outputTokens,
      });
      recordUsage(usageStore, 'simple', model, result.inputTokens, result.outputTokens);
    } catch (e: any) {
      event.sender.send('llm:extraction-chunk', { requestId, chunk: '', done: true, error: e.message });
    }
  });

  ipcMain.handle('llm:run-agent', async (event, payload) => {
    const { runId, userPrompt, model, notesEnabled } = payload;
    const apiKey = await getApiKeyFromStorage(storage);

    const toolExecutor: ToolExecutor = {
      async execute(tc) {
        const toolDef = AGENT_TOOLS.find((t: any) => t.name === tc.name);
        if (!toolDef) return { result: '', error: `Unknown tool: ${tc.name}` };
        if (toolDef.executionContext === 'content-script') {
          return { result: '', error: 'Content script tools are not available in desktop mode. Use fetch_url instead.' };
        }
        if (tc.name === 'fetch_url') {
          const url = tc.input.url as string;
          if (isBlockedUrl(url)) return { result: '', error: 'URL is blocked or invalid' };
          const res = await fetchAndCleanContent(url, 20_000);
          return { result: res.content, error: res.error };
        }
        return { result: '', error: `Tool ${tc.name} cannot be executed in this context` };
      },
    };

    try {
      await coreRunAgentLoop(
        { runId, userPrompt, apiKey, model, notesEnabled: notesEnabled ?? false },
        streamAnthropicWithTools,
        toolExecutor,
        (progressEvent) => event.sender.send('llm:agent-progress', { runId, event: progressEvent }),
      );
    } catch (e: any) {
      event.sender.send('llm:agent-progress', { runId, event: { type: 'error', error: e.message } });
    }
  });

  ipcMain.handle('llm:stream-chat', async (event, payload) => {
    const { requestId, model, systemPrompt, messages, tools } = payload;
    const apiKey = await getApiKeyFromStorage(storage);

    try {
      const result = await withRetry(
        () => streamAnthropicWithTools(apiKey, model, systemPrompt, messages, tools ?? [],
          (chunk) => event.sender.send('llm:chat-chunk', { requestId, textChunk: chunk, done: false }),
        ),
        { onRetryWait: (info) => event.sender.send('llm:chat-chunk', { requestId, rateLimitWait: info }) },
      );

      event.sender.send('llm:chat-chunk', {
        requestId, done: true,
        textContent: result.textContent, toolCalls: result.toolCalls,
        stopReason: result.stopReason, inputTokens: result.inputTokens, outputTokens: result.outputTokens,
      });
      recordUsage(usageStore, 'chat', model, result.inputTokens, result.outputTokens);
    } catch (e: any) {
      event.sender.send('llm:chat-chunk', { requestId, done: true, textContent: '', toolCalls: [], error: e.message });
    }
  });
```

Add needed imports at the top of `electron/main.ts`:
```typescript
import { withRetry } from '../src/core/retry';
import { recordUsage, type UsageStore } from '../src/core/usage';
import { executeLLMRequestStreaming } from '../src/offscreen/llm-executor';
import { runAgentLoop as coreRunAgentLoop } from '../src/core/agent-loop';
```

Remove the old `runtime:sendMessage` catch-all handler once all message types are covered by dedicated channels.

- [ ] **Step 5: Verify both builds**

Run: `npm run build && npm run build:electron-renderer`
Expected: Both clean.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "feat(platform): implement ElectronLLM with dedicated IPC channels"
```

---

## Task 8: Refactor UI Hooks to Use PlatformLLM

Replace `chrome.runtime.sendMessage` / `streamFromOffscreen` patterns in UI hooks with `platform.llm.*` calls.

**Files:**
- Modify: `src/ui/hooks/useLLMExtraction.ts`
- Modify: `src/ui/hooks/chat-agent-loop.ts`
- Modify: `src/ui/hooks/nl-query-utils.ts`
- Modify: `src/ui/hooks/useNLQuery.ts`
- Modify: `src/graph/store/extraction-review-store.ts`
- Modify: `src/ui/components/panels/MultiSelectPanel.tsx`

- [ ] **Step 1: Refactor `useLLMExtraction.ts`**

This is the biggest change. Replace `streamFromOffscreen()` (lines 27-72) with `llm.streamExtraction()`:

```typescript
// At the top
import { llm, storage } from '@platform';

// Remove the streamFromOffscreen function entirely.
// Replace its usage in startExtraction:

// Before (simplified):
// const requestId = ...;
// chrome.runtime.sendMessage({ type: 'LLM_REQUEST', requestId, payload: { prompt, model } });
// const { content, error } = await streamFromOffscreen(requestId, onChunk);

// After:
const result = await llm.streamExtraction(
  { prompt, model, systemPrompt },
  (chunk) => { /* update llmStore streaming text */ },
  (info) => { useLLMStore.getState().setRateLimitWait({ ...info, startedAt: Date.now() }); },
);
```

Replace `chrome.runtime.sendMessage({ type: 'AGENT_RUN_START', ... })` with:
```typescript
await llm.runAgent(
  { runId, userPrompt, model, tabId, notesEnabled },
  (event) => { /* handle AgentProgressEvent — same logic as current listener */ },
);
```

Replace all remaining `chrome.storage.local.get(...)` calls with `storage.get(...)` (some may have been missed in Task 2 — this file has 6 storage calls).

Remove all `chrome.runtime.onMessage.addListener` / `removeListener` patterns that were used for stream listening.

- [ ] **Step 2: Refactor `chat-agent-loop.ts`**

Replace the `chrome.runtime.sendMessage({ type: 'CHAT_LLM_REQUEST', ... })` + listener pattern with:

```typescript
import { llm } from '@platform';

const result = await llm.streamChat(
  { requestId, model, systemPrompt, messages, tools },
  (chunk) => { /* update chat streaming text */ },
  (info) => { /* rate limit callback */ },
);
```

- [ ] **Step 3: Refactor `nl-query-utils.ts` and `useNLQuery.ts`**

Replace LLM streaming via `chrome.runtime.sendMessage` + `chrome.runtime.onMessage` with `llm.streamExtraction()` or `llm.streamChat()` depending on usage.

- [ ] **Step 4: Refactor `extraction-review-store.ts`**

Replace `chrome.storage.local.get('llmConfig')` with `storage.get('llmConfig')` and `chrome.runtime.sendMessage({ type: 'LLM_REQUEST', ... })` with `llm.streamExtraction()`.

- [ ] **Step 5: Refactor `MultiSelectPanel.tsx`**

Replace `chrome.storage.local.get('llmConfig')` and `chrome.runtime.sendMessage / onMessage` pattern with `storage` and `llm` from `@platform`.

- [ ] **Step 6: Verify both builds**

Run: `npm run build && npm run build:electron-renderer`
Expected: Both clean.

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "feat(platform): migrate UI hooks from chrome.runtime messaging to platform.llm"
```

---

## Task 9: PlatformBrowser + Cleanup

Implement `ChromeBrowser` and `ElectronBrowser`. Refactor remaining `chrome.tabs` / `chrome.runtime` UI calls. Delete old stubs and bridge files.

**Files:**
- Create: `src/platform/chrome/browser.ts`
- Create: `src/platform/electron/browser.ts`
- Modify: `src/platform/chrome/index.ts`
- Modify: `src/platform/electron/index.ts`
- Modify: `src/ui/hooks/useContextualRelevance.ts`
- Modify: `src/ui/hooks/useCompanionCapture.ts`
- Modify: `src/ui/hooks/useDisplayMode.ts`
- Modify: `src/ui/hooks/useReadingListMerge.ts`
- Modify: `src/ui/components/llm/PromptInput.tsx`
- Modify: `src/graph/store/auth-store.ts`
- Modify: `src/graph/store/reading-list-store.ts`
- Delete: `src/platform/install-chrome-stubs.ts`

- [ ] **Step 1: Create `src/platform/chrome/browser.ts`**

```typescript
// src/platform/chrome/browser.ts
import type { PlatformBrowser, TabInfo } from '../types';

export class ChromeBrowser implements PlatformBrowser {
  async getActiveTab(): Promise<TabInfo | null> {
    const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
    const tab = tabs[0];
    if (!tab?.id || !tab.url) return null;
    return { id: tab.id, url: tab.url, title: tab.title ?? '' };
  }

  async getPageContent(tabId: number): Promise<string> {
    const response = await chrome.runtime.sendMessage({ type: 'GET_PAGE_CONTENT_QUICK', payload: { tabId } });
    return response?.content ?? '';
  }

  async executeTool(tabId: number, tool: string, params: Record<string, unknown>): Promise<string> {
    const response = await chrome.runtime.sendMessage({
      type: 'TOOL_EXECUTE',
      payload: { tabId, toolName: tool, toolInput: params },
    });
    if (response?.error) throw new Error(response.error);
    return response?.result ?? '';
  }

  onPageCapture(cb: (data: { title: string; url: string; content: string }) => void): () => void {
    const listener = (message: any) => {
      if (message.type === 'COMPANION_PAGE_CAPTURED') {
        cb(message.payload);
      }
    };
    chrome.runtime.onMessage.addListener(listener);
    return () => chrome.runtime.onMessage.removeListener(listener);
  }
}
```

- [ ] **Step 2: Create `src/platform/electron/browser.ts`**

```typescript
// src/platform/electron/browser.ts
import type { PlatformBrowser, TabInfo } from '../types';

declare const window: Window & {
  electronIPC: {
    invoke(channel: string, ...args: unknown[]): Promise<unknown>;
    on(channel: string, cb: (...args: unknown[]) => void): () => void;
  };
};

export class ElectronBrowser implements PlatformBrowser {
  async getActiveTab(): Promise<TabInfo | null> {
    return null;
  }

  async getPageContent(_tabId: number): Promise<string> {
    return '';
  }

  async executeTool(_tabId: number, _tool: string, _params: Record<string, unknown>): Promise<string> {
    throw new Error('Browser tool execution requires the companion extension');
  }

  onPageCapture(cb: (data: { title: string; url: string; content: string }) => void): () => void {
    return window.electronIPC.on('companion:capture', (data: unknown) => {
      cb(data as { title: string; url: string; content: string });
    });
  }
}
```

- [ ] **Step 3: Export browser from both platform entry points**

Add to `src/platform/chrome/index.ts`:
```typescript
import { ChromeBrowser } from './browser';
export const browser = new ChromeBrowser();
```

Add to `src/platform/electron/index.ts`:
```typescript
import { ElectronBrowser } from './browser';
export const browser = new ElectronBrowser();
```

- [ ] **Step 4: Refactor remaining UI-side `chrome.tabs` and `chrome.runtime` call sites**

**`src/ui/hooks/useContextualRelevance.ts`** — Replace `chrome.tabs.query`, `chrome.tabs.sendMessage`, `chrome.scripting.executeScript`, `chrome.tabs.onActivated` with `browser.getActiveTab()` etc. Wrap tab-specific features with `if (platformId === 'chrome')` guards since Electron has no tab context.

**`src/ui/hooks/useCompanionCapture.ts`** — Replace `chrome.runtime.onMessage.addListener` with `browser.onPageCapture(cb)`.

**`src/ui/hooks/useDisplayMode.ts`** — Replace `chrome.runtime.sendMessage({ type: 'TOGGLE_DISPLAY_MODE' })` with a platform-specific approach. On Chrome, still send the message via `chrome.runtime.sendMessage` inside the Chrome browser implementation or add a method. On Electron, this is a no-op or window management call.

**`src/ui/components/llm/PromptInput.tsx`** — Replace `chrome.tabs.query(...)` with `browser.getActiveTab()` and `chrome.runtime.sendMessage({ type: 'ANALYZE_PAGE' })` with a platform browser call.

**`src/graph/store/auth-store.ts`** — Replace `chrome.runtime.sendMessage` for OAuth calls. OAuth is Chrome-specific — guard with `platformId === 'chrome'`.

**`src/graph/store/reading-list-store.ts`** — Replace `chrome.storage` (already done in Task 2) and `chrome.runtime.sendMessage/onMessage` for reading list operations.

- [ ] **Step 5: Delete `src/platform/install-chrome-stubs.ts`**

```bash
git rm src/platform/install-chrome-stubs.ts
```

No code should reference it anymore after `main.tsx` was updated in Task 3.

- [ ] **Step 6: Verify both builds**

Run: `npm run build && npm run build:electron-renderer`
Expected: Both clean. No references to `chrome.*` in `src/ui/` or `src/graph/` except through platform implementations.

Verify:
```bash
grep -rn 'chrome\.\(storage\|runtime\|tabs\|scripting\)' src/ui/ src/graph/ --include='*.ts' --include='*.tsx' | grep -v node_modules
```
Expected: Zero results (all migrated to `@platform`).

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "feat(platform): implement PlatformBrowser, migrate remaining chrome.* calls, delete stubs"
```

---

## Task 10: Final Verification

Full end-to-end verification that both builds work.

- [ ] **Step 1: Clean build both targets**

```bash
rm -rf dist/ dist-electron/
npm run build
npm run build:electron-renderer
```

Expected: Both clean, no warnings about missing modules.

- [ ] **Step 2: Verify no lingering chrome.* in UI code**

```bash
grep -rn 'chrome\.\(storage\|runtime\|tabs\|scripting\|sidePanel\|action\|contextMenus\|offscreen\)' src/ui/ src/graph/ --include='*.ts' --include='*.tsx'
```

Expected: Zero results. All chrome.* calls are now inside `src/platform/chrome/` or background contexts (`src/service-worker/`, `src/offscreen/`, `src/content-script/`).

- [ ] **Step 3: Verify no lingering `window.electron*` in UI code**

```bash
grep -rn 'window.*electron\|electronAPI\|electronDB\|electronNotes\|electronRuntime\|electronStorage\|electronCompanion' src/ui/ src/graph/ src/db/ src/notes/ --include='*.ts' --include='*.tsx'
```

Expected: Zero results. All electron detection is now inside `src/platform/electron/`.

- [ ] **Step 4: Verify `install-chrome-stubs.ts` is deleted and unreferenced**

```bash
grep -rn 'install-chrome-stubs\|installChromeStubs' src/ --include='*.ts' --include='*.tsx'
```

Expected: Zero results.

- [ ] **Step 5: Load Chrome extension**

Load `dist/` as unpacked extension in `chrome://extensions`. Open side panel. Verify:
- Settings panel loads (storage works)
- Graph loads with existing nodes (DB works)
- Can create/edit a note (notes work)
- Can run text extraction (LLM works)

- [ ] **Step 6: Commit (if any final fixes needed)**

```bash
git add -A
git commit -m "chore(platform): final verification and cleanup"
```
