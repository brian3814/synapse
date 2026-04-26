# Electron Phase 1: Platform Storage Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make `chrome.storage.local` actually persist data in Electron by backing the existing stubs with real IPC-based storage, so API keys, settings, and cached data survive app restarts.

**Architecture:** The Electron main process hosts a `StorageBackend` that reads/writes a JSON file in the app's userData directory. Secrets (API keys, OAuth tokens) are encrypted via Electron's `safeStorage` (OS keychain). The renderer calls the backend through IPC, exposed via the preload script. The existing `chrome.storage.local` stubs are upgraded to route through this IPC — zero UI code changes.

**Tech Stack:** Electron IPC (ipcMain/ipcRenderer), Electron safeStorage, Node.js fs

---

### Task 1: Create StorageBackend

**Files:**
- Create: `electron/storage-backend.ts`

The StorageBackend class manages a `storage.json` file in Electron's userData directory (`~/Library/Application Support/kg-extension/` on macOS). It encrypts secret values via `safeStorage` and computes change diffs for `onChanged` listeners.

- [ ] **Step 1: Create `electron/storage-backend.ts`**

```typescript
import { app, safeStorage } from 'electron';
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';
import { join, dirname } from 'path';

const STORAGE_FILE = join(app.getPath('userData'), 'storage.json');

const FULLY_ENCRYPTED_KEYS = new Set(['anthropicOAuth']);

function shouldEncryptField(key: string, field: string): boolean {
  return key === 'llmConfig' && field === 'apiKey';
}

export class StorageBackend {
  private data: Record<string, any> = {};

  constructor() {
    this.load();
  }

  private load(): void {
    try {
      if (existsSync(STORAGE_FILE)) {
        this.data = JSON.parse(readFileSync(STORAGE_FILE, 'utf-8'));
      }
    } catch (e) {
      console.warn('[StorageBackend] Corrupted storage.json, starting fresh:', e);
      this.data = {};
    }
  }

  private save(): void {
    const dir = dirname(STORAGE_FILE);
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    writeFileSync(STORAGE_FILE, JSON.stringify(this.data, null, 2), 'utf-8');
  }

  private canEncrypt(): boolean {
    return safeStorage.isEncryptionAvailable();
  }

  private encrypt(plaintext: string): string {
    if (!this.canEncrypt()) {
      console.warn('[StorageBackend] OS keychain unavailable, storing secret in plaintext');
      return plaintext;
    }
    return safeStorage.encryptString(plaintext).toString('base64');
  }

  private decrypt(stored: string): string {
    if (!this.canEncrypt()) return stored;
    try {
      return safeStorage.decryptString(Buffer.from(stored, 'base64'));
    } catch {
      return stored;
    }
  }

  private encryptForStorage(key: string, value: any): any {
    if (FULLY_ENCRYPTED_KEYS.has(key)) {
      return { __encrypted: this.encrypt(JSON.stringify(value)) };
    }
    if (key === 'llmConfig' && value && typeof value === 'object' && 'apiKey' in value) {
      const { apiKey, ...rest } = value;
      return {
        ...rest,
        apiKey: apiKey ? this.encrypt(apiKey) : apiKey,
        __keyEncrypted: true,
      };
    }
    return value;
  }

  private decryptFromStorage(key: string, raw: any): any {
    if (raw && typeof raw === 'object' && '__encrypted' in raw) {
      try {
        return JSON.parse(this.decrypt(raw.__encrypted));
      } catch {
        return null;
      }
    }
    if (raw && typeof raw === 'object' && '__keyEncrypted' in raw) {
      const { __keyEncrypted, apiKey, ...rest } = raw;
      return { ...rest, apiKey: apiKey ? this.decrypt(apiKey) : apiKey };
    }
    return raw;
  }

  get(keys?: string | string[] | Record<string, any> | null): Record<string, any> {
    if (keys === undefined || keys === null) {
      const result: Record<string, any> = {};
      for (const [k, v] of Object.entries(this.data)) {
        result[k] = this.decryptFromStorage(k, v);
      }
      return result;
    }

    if (typeof keys === 'string') {
      const result: Record<string, any> = {};
      if (keys in this.data) {
        result[keys] = this.decryptFromStorage(keys, this.data[keys]);
      }
      return result;
    }

    if (Array.isArray(keys)) {
      const result: Record<string, any> = {};
      for (const k of keys) {
        if (k in this.data) {
          result[k] = this.decryptFromStorage(k, this.data[k]);
        }
      }
      return result;
    }

    const result: Record<string, any> = {};
    for (const [k, defaultVal] of Object.entries(keys)) {
      result[k] = k in this.data ? this.decryptFromStorage(k, this.data[k]) : defaultVal;
    }
    return result;
  }

  set(items: Record<string, any>): Record<string, { oldValue?: any; newValue: any }> {
    const changes: Record<string, { oldValue?: any; newValue: any }> = {};

    for (const [key, newValue] of Object.entries(items)) {
      const oldDecrypted = key in this.data
        ? this.decryptFromStorage(key, this.data[key])
        : undefined;

      changes[key] = { newValue };
      if (oldDecrypted !== undefined) {
        changes[key].oldValue = oldDecrypted;
      }

      this.data[key] = this.encryptForStorage(key, newValue);
    }

    this.save();
    return changes;
  }

  remove(keys: string | string[]): Record<string, { oldValue: any }> {
    if (typeof keys === 'string') keys = [keys];
    const changes: Record<string, { oldValue: any }> = {};

    for (const key of keys) {
      if (key in this.data) {
        changes[key] = { oldValue: this.decryptFromStorage(key, this.data[key]) };
        delete this.data[key];
      }
    }

    if (Object.keys(changes).length > 0) this.save();
    return changes;
  }
}
```

- [ ] **Step 2: Commit**

```bash
git add electron/storage-backend.ts
git commit -m "feat(electron): add StorageBackend with JSON persistence and safeStorage encryption"
```

---

### Task 2: Register IPC handlers in main process

**Files:**
- Modify: `electron/main.ts`

Add IPC handlers that bridge the renderer's `chrome.storage.local` calls to the `StorageBackend`. On `set` and `remove`, broadcast changes to all windows so `onChanged` listeners fire.

- [ ] **Step 1: Modify `electron/main.ts`**

Add imports at the top of the file (after the existing `import` line):

```typescript
import { ipcMain } from 'electron';
import { StorageBackend } from './storage-backend';
```

Update the existing import to include `ipcMain`:

The first line currently reads:
```typescript
import { app, BrowserWindow, protocol, net } from 'electron';
```

Change it to:
```typescript
import { app, BrowserWindow, protocol, net, ipcMain } from 'electron';
```

Add the StorageBackend import after it:
```typescript
import { StorageBackend } from './storage-backend';
```

Then, inside the `app.whenReady().then(() => {` block, **before** the `createWindow()` call, add:

```typescript
  const storage = new StorageBackend();

  ipcMain.handle('storage:get', (_event, keys) => {
    return storage.get(keys);
  });

  ipcMain.handle('storage:set', (_event, items) => {
    const changes = storage.set(items);
    if (Object.keys(changes).length > 0) {
      for (const win of BrowserWindow.getAllWindows()) {
        win.webContents.send('storage:changed', changes, 'local');
      }
    }
  });

  ipcMain.handle('storage:remove', (_event, keys) => {
    const changes = storage.remove(keys);
    if (Object.keys(changes).length > 0) {
      for (const win of BrowserWindow.getAllWindows()) {
        win.webContents.send('storage:changed', changes, 'local');
      }
    }
  });
```

The full `app.whenReady()` block should now look like:

```typescript
app.whenReady().then(() => {
  // Serve renderer files from dist-electron/renderer/ via app:// protocol
  protocol.handle('app', (request) => {
    const url = new URL(request.url);
    let filePath = path.join(RENDERER_DIR, url.pathname);

    // Default to index.html for root
    if (url.pathname === '/' || url.pathname === '') {
      filePath = path.join(RENDERER_DIR, 'index.html');
    }

    return net.fetch('file://' + filePath);
  });

  const storage = new StorageBackend();

  ipcMain.handle('storage:get', (_event, keys) => {
    return storage.get(keys);
  });

  ipcMain.handle('storage:set', (_event, items) => {
    const changes = storage.set(items);
    if (Object.keys(changes).length > 0) {
      for (const win of BrowserWindow.getAllWindows()) {
        win.webContents.send('storage:changed', changes, 'local');
      }
    }
  });

  ipcMain.handle('storage:remove', (_event, keys) => {
    const changes = storage.remove(keys);
    if (Object.keys(changes).length > 0) {
      for (const win of BrowserWindow.getAllWindows()) {
        win.webContents.send('storage:changed', changes, 'local');
      }
    }
  });

  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});
```

- [ ] **Step 2: Commit**

```bash
git add electron/main.ts
git commit -m "feat(electron): register storage IPC handlers in main process"
```

---

### Task 3: Expose electronStorage in preload

**Files:**
- Modify: `electron/preload.ts`

Expose `window.electronStorage` with `get`, `set`, `remove`, and `onChanged` methods that call through to the main process via IPC.

- [ ] **Step 1: Replace `electron/preload.ts` contents**

The file currently contains:
```typescript
import { contextBridge } from 'electron';

contextBridge.exposeInMainWorld('electronAPI', {
  isElectron: true,
});
```

Replace with:

```typescript
import { contextBridge, ipcRenderer } from 'electron';

contextBridge.exposeInMainWorld('electronAPI', {
  isElectron: true,
});

contextBridge.exposeInMainWorld('electronStorage', {
  get: (keys?: any) => ipcRenderer.invoke('storage:get', keys),
  set: (items: any) => ipcRenderer.invoke('storage:set', items),
  remove: (keys: any) => ipcRenderer.invoke('storage:remove', keys),
  onChanged: (callback: (changes: any, areaName: string) => void) => {
    const handler = (_event: any, changes: any, areaName: string) => {
      callback(changes, areaName);
    };
    ipcRenderer.on('storage:changed', handler);
    return () => {
      ipcRenderer.removeListener('storage:changed', handler);
    };
  },
});
```

- [ ] **Step 2: Commit**

```bash
git add electron/preload.ts
git commit -m "feat(electron): expose electronStorage API in preload script"
```

---

### Task 4: Upgrade Chrome stubs to use electronStorage

**Files:**
- Modify: `src/platform/install-chrome-stubs.ts`

Replace the no-op storage stubs with real implementations that call `window.electronStorage`. The `onChanged` listeners are wired to IPC events from the main process. Runtime and tabs stubs remain no-ops.

- [ ] **Step 1: Replace `src/platform/install-chrome-stubs.ts` contents**

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

const runtimeStub = {
  sendMessage: (_message: any) => Promise.resolve(null),
  onMessage: new EventStub(),
  onInstalled: new EventStub(),
  getURL: (path: string) => path,
  lastError: null as chrome.runtime.LastError | null,
  id: 'electron-stub',
};

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

  (globalThis as any).chrome = {
    ...((globalThis as any).chrome ?? {}),
    storage: storageStub,
    runtime: runtimeStub,
    tabs: tabsStub,
  };
}
```

Key changes from the Phase 0 version:
- Storage stubs call `electronStorage.get/set/remove` via IPC instead of returning empty values
- `onChanged` is now a plain object (not EventStub) with a `changeListeners` array wired to IPC events
- Falls back to no-op promises if `electronStorage` is not present (defensive)
- Runtime and tabs stubs unchanged (still no-ops)

- [ ] **Step 2: Verify Chrome extension build still works**

Run: `npm run build`

Expected: Build succeeds. The `eStorage` variable is only captured inside `installChromeStubs()` which is only called when `window.electronAPI` is present. In the Chrome extension, this function is never called, so the `window.electronStorage` reference is never reached.

- [ ] **Step 3: Commit**

```bash
git add src/platform/install-chrome-stubs.ts
git commit -m "feat(platform): upgrade Chrome stubs to use Electron IPC storage"
```

---

### Task 5: Build and verify

**Files:** None (verification only)

- [ ] **Step 1: Build the Electron app**

```bash
npm run build:electron
```

Expected: No errors. Both main process and renderer build successfully.

- [ ] **Step 2: Launch and test API key persistence**

```bash
npm run dev:electron
```

In the Electron app:
1. Open Settings (gear icon)
2. Select a provider (e.g., Anthropic)
3. Enter an API key
4. Save
5. Close the Electron app completely (Cmd+Q)
6. Relaunch: `npm run dev:electron`
7. Open Settings again — the API key should still be there

- [ ] **Step 3: Verify encryption in storage file**

```bash
cat ~/Library/Application\ Support/kg-extension/storage.json
```

Expected: The `llmConfig` entry should have `"__keyEncrypted": true` and the `apiKey` field should be a Base64 string (not the plaintext key). Other fields like `provider` and `model` should be readable plaintext.

- [ ] **Step 4: Verify Chrome extension still works**

```bash
npm run build
```

Expected: Build succeeds. Load `dist/` in `chrome://extensions` and verify the side panel works normally — settings save, API key persists, reading list functions.

- [ ] **Step 5: Check console for storage errors**

Launch Electron with logging:
```bash
ELECTRON_ENABLE_LOGGING=1 npx electron . --enable-logging 2>&1 | head -30
```

Expected: No `chrome.storage` errors. Should see normal DB init logs. If storage operations succeed, there should be no storage-related warnings.

- [ ] **Step 6: Commit (if any fixes were needed)**

```bash
git add -A
git commit -m "fix(electron): adjustments from Phase 1 verification"
```

---

## Phase 1 success criteria

1. `npm run build:electron` completes without errors
2. API key entered in Settings persists across app restarts
3. `storage.json` shows encrypted `apiKey` field, plaintext settings
4. `chrome.storage.onChanged` listeners fire (reading list store, auth store)
5. `npm run build` (Chrome extension) still works identically
6. No `chrome.storage` errors in DevTools console
