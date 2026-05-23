# Electron Phase 0: Shell Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Get the existing React app running inside an Electron window with stubbed Chrome APIs, proving the dual-build approach works.

**Architecture:** Electron main process serves renderer files via a custom `app://` protocol (gives workers a proper origin). Chrome APIs are replaced with no-op stubs so the UI boots without crashes. The DB layer (SharedWorker → DedicatedWorker → wa-sqlite/OPFS) runs unmodified since it uses standard web APIs.

**Tech Stack:** Electron 35, esbuild (main process bundling), Vite (renderer build)

---

### Task 1: Install Electron dependencies

**Files:**
- Modify: `package.json`
- Modify: `.gitignore`

- [ ] **Step 1: Install Electron and esbuild**

```bash
npm install --save-dev electron@latest esbuild
```

- [ ] **Step 2: Add `dist-electron/` to `.gitignore`**

Append to `.gitignore`:

```
# Electron build output
dist-electron/
```

- [ ] **Step 3: Add `main` field to `package.json`**

Add this field at the top level (after `"type": "module"`):

```json
"main": "dist-electron/main/main.cjs",
```

- [ ] **Step 4: Verify install**

Run: `npx electron --version`

Expected: version string like `v35.x.x`

- [ ] **Step 5: Commit**

```bash
git add package.json package-lock.json .gitignore
git commit -m "chore: add Electron and esbuild dev dependencies"
```

---

### Task 2: Create Electron main process

**Files:**
- Create: `electron/main.ts`

The main process registers a custom `app://` protocol so that `location.origin` resolves properly for SharedWorker/Worker URLs (they use `new URL('/worker.js', location.origin)`). It creates a BrowserWindow and loads the renderer.

- [ ] **Step 1: Create `electron/main.ts`**

```typescript
import { app, BrowserWindow, protocol, net, session } from 'electron';
import { fileURLToPath } from 'url';
import path from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const RENDERER_DIR = path.join(__dirname, '..', 'renderer');

// Register custom protocol before app is ready.
// "standard" gives it a proper origin for SharedWorker same-origin checks.
protocol.registerSchemesAsPrivileged([
  {
    scheme: 'app',
    privileges: {
      standard: true,
      secure: true,
      supportFetchAPI: true,
      corsEnabled: true,
      stream: true,
    },
  },
]);

function createWindow(): BrowserWindow {
  const win = new BrowserWindow({
    width: 1200,
    height: 800,
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false, // SharedWorker needs this off in Electron
    },
  });

  win.loadURL('app://kg/index.html');
  return win;
}

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

  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});
```

- [ ] **Step 2: Verify the file was created**

Run: `ls electron/main.ts`

Expected: file listed

---

### Task 3: Create preload script

**Files:**
- Create: `electron/preload.ts`

The preload script exposes a flag so the renderer can detect it's running in Electron and install Chrome API stubs before React mounts.

- [ ] **Step 1: Create `electron/preload.ts`**

```typescript
import { contextBridge } from 'electron';

contextBridge.exposeInMainWorld('electronAPI', {
  isElectron: true,
});
```

- [ ] **Step 2: Commit**

```bash
git add electron/main.ts electron/preload.ts
git commit -m "feat(electron): add main process and preload script"
```

---

### Task 4: Create Chrome API stubs

**Files:**
- Create: `src/platform/install-chrome-stubs.ts`

These stubs prevent the app from crashing when Chrome extension APIs are called. They return safe defaults: `get()` resolves with `{}`, `sendMessage()` resolves with `null`, `addListener()` is a no-op. This covers all Chrome APIs hit during the startup sequence in `App.tsx`:

- `chrome.storage.local.get/set` (reading-list-store, auth-store, useDisplayMode)
- `chrome.storage.onChanged.addListener` (reading-list-store, auth-store)
- `chrome.runtime.sendMessage` (auth-store, useDisplayMode)
- `chrome.runtime.onMessage.addListener/removeListener` (reading-list-store, auth-store, query-message-handler)

- [ ] **Step 1: Create `src/platform/install-chrome-stubs.ts`**

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

const storageStub = {
  local: {
    get: (_keys?: any) => Promise.resolve({}),
    set: (_items: any) => Promise.resolve(),
    remove: (_keys: any) => Promise.resolve(),
  },
  session: {
    get: (_keys?: any) => Promise.resolve({}),
    set: (_items: any) => Promise.resolve(),
  },
  onChanged: new EventStub(),
};

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
    return; // Already in a Chrome extension context
  }

  const stub = {
    storage: storageStub,
    runtime: runtimeStub,
    tabs: tabsStub,
  };

  (globalThis as any).chrome = {
    ...((globalThis as any).chrome ?? {}),
    ...stub,
  };
}
```

- [ ] **Step 2: Commit**

```bash
git add src/platform/install-chrome-stubs.ts
git commit -m "feat(platform): add Chrome API stubs for Electron compatibility"
```

---

### Task 5: Wire stubs into app entry

**Files:**
- Modify: `src/ui/main.tsx`

Add 3 lines before `createRoot()` to detect Electron and install stubs. This ensures Chrome API stubs are in place before any React hooks run.

- [ ] **Step 1: Modify `src/ui/main.tsx`**

Change the file from:

```typescript
import React from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import './styles.css';

const root = document.getElementById('root');
if (root) {
  createRoot(root).render(
    <React.StrictMode>
      <App />
    </React.StrictMode>
  );
}
```

To:

```typescript
import React from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import './styles.css';

if ((window as any).electronAPI) {
  const { installChromeStubs } = await import('../platform/install-chrome-stubs');
  installChromeStubs();
}

const root = document.getElementById('root');
if (root) {
  createRoot(root).render(
    <React.StrictMode>
      <App />
    </React.StrictMode>
  );
}
```

The top-level `await` works because the script is loaded as `type="module"` in `index.html`.

- [ ] **Step 2: Verify the Chrome extension still builds**

Run: `npm run build`

Expected: Build succeeds with no errors. The `if (window.electronAPI)` branch is dead code in the Chrome extension (no `electronAPI` on window), so no behavior change.

- [ ] **Step 3: Commit**

```bash
git add src/ui/main.tsx
git commit -m "feat(main): detect Electron and install Chrome API stubs at startup"
```

---

### Task 6: Create Electron Vite config

**Files:**
- Create: `vite.config.electron.ts`

This config builds the renderer for Electron. Compared to the Chrome extension config, it:
- Removes 5 plugin sub-builds (service-worker, offscreen, content-script, db-shared-worker, db-worker)
- Keeps only `layoutWorkerPlugin` (force layout still runs in a Web Worker)
- Copies worker files from the Chrome build (db-worker.js, db-shared-worker.js) since they use standard web APIs unchanged
- Uses `base: './'` instead of `''`
- Drops the `process.env.NODE_ENV` override (no CSP restriction in Electron)
- Outputs to `dist-electron/renderer/`

However, since Phase 0 reuses the same db-worker and db-shared-worker code unchanged, the simplest approach is to **build all workers in the Electron config too** — same code, just output to a different directory.

- [ ] **Step 1: Create `vite.config.electron.ts`**

```typescript
import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { resolve } from 'path';
import { build as viteBuild } from 'vite';
import { access, readFile, writeFile, unlink, rmdir } from 'fs/promises';

let isDev = false;
const outDir = resolve(__dirname, 'dist-electron/renderer');

function layoutWorkerPlugin(): Plugin {
  return {
    name: 'layout-worker-build',
    apply: 'build',
    closeBundle: async () => {
      await viteBuild({
        configFile: false,
        mode: isDev ? 'development' : 'production',
        base: './',
        resolve: { alias: { '@': resolve(__dirname, 'src') } },
        build: {
          outDir,
          emptyOutDir: false,
          sourcemap: isDev,
          rollupOptions: {
            input: { 'layout-worker': resolve(__dirname, 'src/graph/layout/layout-worker.ts') },
            output: {
              entryFileNames: 'layout-worker.js',
              assetFileNames: '[name][extname]',
              chunkFileNames: 'assets/[name].js',
              manualChunks: undefined,
            },
          },
        },
      });
    },
  };
}

function dbWorkerPlugin(): Plugin {
  return {
    name: 'db-worker-build',
    apply: 'build',
    closeBundle: async () => {
      await viteBuild({
        configFile: false,
        mode: isDev ? 'development' : 'production',
        base: './',
        resolve: { alias: { '@': resolve(__dirname, 'src') } },
        build: {
          outDir,
          emptyOutDir: false,
          sourcemap: isDev,
          rollupOptions: {
            input: { 'db-worker': resolve(__dirname, 'src/db/worker/db-worker.ts') },
            output: {
              entryFileNames: 'db-worker.js',
              assetFileNames: '[name][extname]',
              chunkFileNames: 'assets/[name].js',
              manualChunks: undefined,
            },
          },
        },
      });
    },
  };
}

function dbSharedWorkerPlugin(): Plugin {
  return {
    name: 'db-shared-worker-build',
    apply: 'build',
    closeBundle: async () => {
      await viteBuild({
        configFile: false,
        mode: isDev ? 'development' : 'production',
        base: './',
        resolve: { alias: { '@': resolve(__dirname, 'src') } },
        build: {
          outDir,
          emptyOutDir: false,
          sourcemap: isDev,
          rollupOptions: {
            input: {
              'db-shared-worker': resolve(__dirname, 'src/db/worker/db-shared-worker.ts'),
            },
            output: {
              entryFileNames: 'db-shared-worker.js',
              assetFileNames: '[name][extname]',
              chunkFileNames: 'assets/[name].js',
              manualChunks: undefined,
            },
          },
        },
      });
    },
  };
}

function fixHtmlPlugin(): Plugin {
  return {
    name: 'fix-html',
    apply: 'build',
    closeBundle: async () => {
      const nested = resolve(outDir, 'src/ui/index.html');
      const target = resolve(outDir, 'index.html');
      try {
        await access(nested);
        let html = await readFile(nested, 'utf-8');
        html = html.replace(/(?:\.\.\/)+assets\//g, 'assets/');
        await writeFile(target, html, 'utf-8');
        await unlink(nested).catch(() => {});
        await rmdir(resolve(outDir, 'src/ui')).catch(() => {});
        await rmdir(resolve(outDir, 'src')).catch(() => {});
      } catch {
        // Already in the right place
      }
    },
  };
}

export default defineConfig(({ mode }) => {
  isDev = mode === 'development';
  return {
    base: './',
    plugins: [
      react(),
      tailwindcss(),
      fixHtmlPlugin(),
      dbWorkerPlugin(),
      dbSharedWorkerPlugin(),
      layoutWorkerPlugin(),
    ],
    resolve: {
      alias: { '@': resolve(__dirname, 'src') },
    },
    build: {
      outDir,
      emptyOutDir: true,
      sourcemap: true,
      minify: false,
      modulePreload: false,
      rollupOptions: {
        input: {
          main: resolve(__dirname, 'src/ui/index.html'),
        },
        output: {
          entryFileNames: 'assets/[name]-[hash].js',
          chunkFileNames: 'assets/[name]-[hash].js',
          assetFileNames: 'assets/[name]-[hash].[ext]',
        },
      },
    },
  };
});
```

Key differences from the Chrome config:
- `base: './'` (not `''`)
- Output to `dist-electron/renderer/`
- Only 1 entry in main build: `main` (no `service-worker`, no `offscreen`)
- No `contentScriptPlugin`
- No `process.env.NODE_ENV` override
- Plugins: `fixHtmlPlugin`, `dbWorkerPlugin`, `dbSharedWorkerPlugin`, `layoutWorkerPlugin`

- [ ] **Step 2: Commit**

```bash
git add vite.config.electron.ts
git commit -m "feat(build): add Electron Vite config for renderer build"
```

---

### Task 7: Rename Chrome Vite config and update scripts

**Files:**
- Rename: `vite.config.ts` → `vite.config.chrome.ts`
- Modify: `package.json` (scripts)

- [ ] **Step 1: Rename vite.config.ts**

```bash
git mv vite.config.ts vite.config.chrome.ts
```

- [ ] **Step 2: Update `package.json` scripts**

Replace the `"scripts"` section with:

```json
"scripts": {
  "dev": "vite build --watch --mode development --config vite.config.chrome.ts",
  "build": "tsc && vite build --config vite.config.chrome.ts",
  "preview": "vite preview",
  "build:chrome": "tsc && vite build --config vite.config.chrome.ts",
  "build:electron-main": "esbuild electron/main.ts electron/preload.ts --bundle --platform=node --outdir=dist-electron/main --format=cjs --out-extension:.js=.cjs --external:electron --packages=external",
  "build:electron-renderer": "vite build --config vite.config.electron.ts",
  "build:electron": "npm run build:electron-main && npm run build:electron-renderer",
  "dev:electron": "npm run build:electron && electron ."
}
```

- `build` / `dev` are unchanged in behavior (same Chrome extension build, just with explicit config)
- `build:chrome` is an alias for the existing build
- `build:electron-main` uses esbuild to bundle `main.ts` and `preload.ts` into CJS files in `dist-electron/main/`
  - `--format=cjs` and `--out-extension:.js=.cjs` avoid ESM/CJS conflicts with root `"type": "module"`
  - `--external:electron` excludes the electron module (provided at runtime)
  - `--packages=external` excludes all node_modules (they're available at runtime)
- `build:electron-renderer` builds the renderer via the Electron Vite config
- `build:electron` chains main + renderer builds
- `dev:electron` builds everything then launches Electron

- [ ] **Step 3: Verify Chrome extension build still works**

Run: `npm run build`

Expected: Build succeeds. Output in `dist/` is identical to before.

- [ ] **Step 4: Commit**

```bash
git add vite.config.chrome.ts package.json
git commit -m "refactor(build): rename Vite config, add Electron build scripts"
```

---

### Task 8: Build and verify Electron app launches

**Files:** None (verification only)

- [ ] **Step 1: Build the Electron app**

Run: `npm run build:electron`

Expected: No errors. Output structure:
```
dist-electron/
  main/
    main.cjs         # Electron main process
    preload.cjs       # Preload script
  renderer/
    index.html        # React app entry
    assets/           # JS/CSS bundles
    db-worker.js      # Dedicated worker
    db-shared-worker.js  # SharedWorker
    layout-worker.js  # Layout worker
    wa-sqlite-async.wasm # SQLite WASM
```

Verify the output exists:
```bash
ls dist-electron/main/main.cjs dist-electron/main/preload.cjs dist-electron/renderer/index.html
```

- [ ] **Step 2: Launch Electron**

Run: `npm run dev:electron`

Expected: An Electron window opens showing the Knowledge Graph UI. The app should:
- Display the "Initializing database..." spinner briefly
- Then show the main graph interface (empty graph, no nodes)
- No crashes or blank white screen
- Console (View → Toggle Developer Tools) should NOT show `chrome.storage` or `chrome.runtime` errors

If the DB initialization fails (SharedWorker issue with custom protocol), you'll see the spinner indefinitely or a "Database Error" message. This is acceptable for Phase 0 — the critical success is that the window opens and React renders without crashing.

- [ ] **Step 3: Verify Chrome extension still works**

Run: `npm run build`

Then load `dist/` as an unpacked extension in `chrome://extensions`. Verify the side panel opens and works normally. The main.tsx change (`if (window.electronAPI)`) should be completely inert in the Chrome extension context.

- [ ] **Step 4: Commit (if any fixes were needed)**

```bash
git add -A
git commit -m "fix(electron): adjustments from Phase 0 verification"
```

---

## Troubleshooting

### SharedWorker fails with custom protocol

If SharedWorker can't be created on `app://` origin:

**Option A:** Set `sandbox: false` in `webPreferences` (already done in the plan).

**Option B:** Fall back to serving via a localhost HTTP server. Replace the `protocol.handle` approach in `electron/main.ts` with:

```typescript
import express from 'express';
const server = express();
server.use(express.static(RENDERER_DIR));
server.listen(0, '127.0.0.1', () => {
  const port = (server.address() as any).port;
  win.loadURL(`http://127.0.0.1:${port}/index.html`);
});
```

This gives `http://127.0.0.1:PORT` as origin, which supports all worker types.

### OPFS not available

If `navigator.storage.getDirectory()` fails (OPFS requires secure context):

The `app://` protocol with `secure: true` should provide a secure context. If it doesn't, use the localhost HTTP server fallback above (`http://127.0.0.1` is considered secure by Chromium).

### WASM loading fails

If `wa-sqlite-async.wasm` can't be fetched:

Check that the WASM file exists in `dist-electron/renderer/`. The `dbWorkerPlugin` copies it as part of the build with `assetFileNames: '[name][extname]'` (no content hash). The db-worker loads it relative to its own URL, which with the `app://` protocol resolves to `app://kg/wa-sqlite-async.wasm`.

---

## Phase 0 success criteria

1. `npm run build:electron` completes without errors
2. `npm run dev:electron` opens an Electron window
3. The React UI renders (not a blank white screen)
4. No `chrome.*` errors in the DevTools console
5. `npm run build` (Chrome extension) still works identically
6. The Chrome extension loads and functions normally in the browser
