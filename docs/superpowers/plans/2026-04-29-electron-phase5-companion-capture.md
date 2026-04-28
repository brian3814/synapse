# Electron Phase 5: Companion Extension Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a minimal companion Chrome extension that captures rendered page content and sends it to the Electron desktop app for LLM extraction.

**Architecture:** Companion toolbar button → injects script to read rendered DOM → converts to markdown → POSTs to `http://127.0.0.1:19876/api/capture` → Electron receives and triggers extraction. Separate build, no impact on existing extension.

**Tech Stack:** Chrome MV3 extension, Vite (IIFE build), Node.js http server

---

### Task 1: Create companion extension project

**Files:**
- Create: `packages/companion/manifest.json`
- Create: `packages/companion/content-capture.ts`
- Create: `packages/companion/service-worker.ts`

- [ ] **Step 1: Create `packages/companion/manifest.json`**

```bash
mkdir -p packages/companion
```

```json
{
  "manifest_version": 3,
  "name": "KG Desktop Companion",
  "version": "1.0.0",
  "description": "Captures rendered page content and sends to KG Desktop for extraction",
  "permissions": ["activeTab", "scripting"],
  "action": {
    "default_title": "Capture page for KG Desktop"
  },
  "background": {
    "service_worker": "service-worker.js",
    "type": "module"
  }
}
```

- [ ] **Step 2: Create `packages/companion/content-capture.ts`**

This script is injected into the active tab on toolbar click. It reads the rendered DOM, strips non-content elements, and converts to markdown using a minimal inline Turndown approach (no external deps — we inline the conversion logic to keep the injected script small).

```typescript
(() => {
  const title = document.title;
  const url = location.href;

  const clone = document.body.cloneNode(true) as HTMLElement;

  // Remove non-content elements
  const removeSelectors = [
    'script', 'style', 'nav', 'footer', 'header', 'aside', 'noscript',
    '[role="navigation"]', '[role="banner"]', '[role="contentinfo"]',
    'iframe', 'svg', '.ad', '.ads', '.advertisement',
  ];
  removeSelectors.forEach((sel) => {
    clone.querySelectorAll(sel).forEach((el) => el.remove());
  });

  // Extract text with basic structure preservation
  function extractMarkdown(el: HTMLElement): string {
    const blocks: string[] = [];

    for (const child of Array.from(el.children)) {
      const tag = child.tagName.toLowerCase();
      const text = (child as HTMLElement).innerText?.trim();
      if (!text) continue;

      if (tag.match(/^h[1-6]$/)) {
        const level = parseInt(tag[1]);
        blocks.push('#'.repeat(level) + ' ' + text);
      } else if (tag === 'pre' || tag === 'code') {
        blocks.push('```\n' + text + '\n```');
      } else if (tag === 'ul' || tag === 'ol') {
        const items = Array.from(child.querySelectorAll(':scope > li'));
        items.forEach((li, i) => {
          const prefix = tag === 'ol' ? `${i + 1}. ` : '- ';
          blocks.push(prefix + (li as HTMLElement).innerText.trim());
        });
      } else if (tag === 'table') {
        const rows = Array.from(child.querySelectorAll('tr'));
        const tableRows: string[] = [];
        rows.forEach((row, ri) => {
          const cells = Array.from(row.querySelectorAll('th, td'))
            .map((c) => (c as HTMLElement).innerText.trim());
          tableRows.push('| ' + cells.join(' | ') + ' |');
          if (ri === 0) {
            tableRows.push('| ' + cells.map(() => '---').join(' | ') + ' |');
          }
        });
        blocks.push(tableRows.join('\n'));
      } else if (tag === 'a') {
        const href = (child as HTMLAnchorElement).href;
        blocks.push(`[${text}](${href})`);
      } else if (tag === 'img') {
        const src = (child as HTMLImageElement).src;
        const alt = (child as HTMLImageElement).alt || 'image';
        blocks.push(`![${alt}](${src})`);
      } else if (tag === 'blockquote') {
        blocks.push('> ' + text.replace(/\n/g, '\n> '));
      } else {
        // Paragraphs, divs, sections, articles — recurse for nested structure
        if (child.children.length > 3) {
          blocks.push(extractMarkdown(child as HTMLElement));
        } else {
          blocks.push(text);
        }
      }
    }

    return blocks.join('\n\n');
  }

  let content = extractMarkdown(clone);
  content = content.replace(/\n{3,}/g, '\n\n');

  // Truncate to 50KB
  if (content.length > 50_000) {
    content = content.substring(0, 50_000) + '\n\n...[truncated]';
  }

  return { title, url, content };
})();
```

- [ ] **Step 3: Create `packages/companion/service-worker.ts`**

```typescript
const DESKTOP_PORT = 19876;
const DESKTOP_URL = `http://127.0.0.1:${DESKTOP_PORT}`;

chrome.action.onClicked.addListener(async (tab) => {
  if (!tab.id || !tab.url) return;

  // Skip chrome:// and extension pages
  if (tab.url.startsWith('chrome://') || tab.url.startsWith('chrome-extension://')) {
    chrome.action.setBadgeText({ text: '✗', tabId: tab.id });
    chrome.action.setBadgeBackgroundColor({ color: '#ef4444', tabId: tab.id });
    setTimeout(() => chrome.action.setBadgeText({ text: '', tabId: tab.id }), 2000);
    return;
  }

  try {
    // Inject content capture script and get result
    const results = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      files: ['content-capture.js'],
    });

    const captured = results?.[0]?.result;
    if (!captured?.content) {
      throw new Error('No content captured');
    }

    // POST to desktop app
    const response = await fetch(`${DESKTOP_URL}/api/capture`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(captured),
    });

    if (!response.ok) {
      throw new Error(`Desktop returned ${response.status}`);
    }

    // Success feedback
    chrome.action.setBadgeText({ text: '✓', tabId: tab.id });
    chrome.action.setBadgeBackgroundColor({ color: '#22c55e', tabId: tab.id });
    setTimeout(() => chrome.action.setBadgeText({ text: '', tabId: tab.id }), 2000);
  } catch (e: any) {
    console.error('[Companion] Capture failed:', e);
    chrome.action.setBadgeText({ text: '✗', tabId: tab.id });
    chrome.action.setBadgeBackgroundColor({ color: '#ef4444', tabId: tab.id });
    setTimeout(() => chrome.action.setBadgeText({ text: '', tabId: tab.id }), 3000);
  }
});
```

- [ ] **Step 4: Commit**

```bash
git add packages/companion/
git commit -m "feat(companion): create minimal companion extension for page capture"
```

---

### Task 2: Create companion Vite config and build script

**Files:**
- Create: `packages/companion/vite.config.ts`
- Modify: `package.json` (root)

- [ ] **Step 1: Create `packages/companion/vite.config.ts`**

```typescript
import { defineConfig } from 'vite';
import { resolve } from 'path';
import { build as viteBuild } from 'vite';
import { copyFileSync } from 'fs';

function contentCapturePlugin() {
  return {
    name: 'content-capture-build',
    apply: 'build' as const,
    closeBundle: async () => {
      await viteBuild({
        configFile: false,
        build: {
          outDir: resolve(__dirname, '../../dist-companion'),
          emptyOutDir: false,
          lib: {
            entry: resolve(__dirname, 'content-capture.ts'),
            name: 'contentCapture',
            formats: ['iife'],
            fileName: () => 'content-capture.js',
          },
          rollupOptions: {
            output: { extend: true },
          },
        },
      });
    },
  };
}

function copyManifestPlugin() {
  return {
    name: 'copy-manifest',
    apply: 'build' as const,
    closeBundle: () => {
      copyFileSync(
        resolve(__dirname, 'manifest.json'),
        resolve(__dirname, '../../dist-companion/manifest.json')
      );
    },
  };
}

export default defineConfig({
  build: {
    outDir: resolve(__dirname, '../../dist-companion'),
    emptyOutDir: true,
    rollupOptions: {
      input: {
        'service-worker': resolve(__dirname, 'service-worker.ts'),
      },
      output: {
        entryFileNames: '[name].js',
        format: 'es',
      },
    },
  },
  plugins: [contentCapturePlugin(), copyManifestPlugin()],
});
```

- [ ] **Step 2: Add build script to root `package.json`**

Read root `package.json` first. Add to the `"scripts"` section:

```
"build:companion": "vite build --config packages/companion/vite.config.ts"
```

Also add `dist-companion/` to `.gitignore`.

- [ ] **Step 3: Verify companion builds**

```bash
npm run build:companion
```

Expected: Outputs `dist-companion/manifest.json`, `dist-companion/service-worker.js`, `dist-companion/content-capture.js`.

- [ ] **Step 4: Commit**

```bash
git add packages/companion/vite.config.ts package.json .gitignore
git commit -m "feat(companion): add Vite build config and build script"
```

---

### Task 3: Create companion server in Electron

**Files:**
- Create: `electron/companion-server.ts`
- Modify: `electron/main.ts`
- Modify: `electron/preload.ts`

- [ ] **Step 1: Create `electron/companion-server.ts`**

```typescript
import { createServer, IncomingMessage, ServerResponse } from 'http';
import { BrowserWindow } from 'electron';

const PORT = 19876;

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', (chunk) => { body += chunk; });
    req.on('end', () => resolve(body));
    req.on('error', reject);
  });
}

function cors(res: ServerResponse): void {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
}

function json(res: ServerResponse, status: number, data: any): void {
  cors(res);
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(data));
}

export function startCompanionServer(): void {
  const server = createServer(async (req, res) => {
    // CORS preflight
    if (req.method === 'OPTIONS') {
      cors(res);
      res.writeHead(204);
      res.end();
      return;
    }

    if (req.url === '/api/identify' && req.method === 'GET') {
      json(res, 200, { app: 'kg-desktop', version: '1.0.0' });
      return;
    }

    if (req.url === '/api/capture' && req.method === 'POST') {
      try {
        const body = await readBody(req);
        const { title, url, content } = JSON.parse(body);

        if (!content) {
          json(res, 400, { error: 'No content provided' });
          return;
        }

        // Broadcast to all renderer windows
        for (const win of BrowserWindow.getAllWindows()) {
          win.webContents.send('companion:capture', { title, url, content });
        }

        json(res, 200, { success: true });
      } catch (e: any) {
        json(res, 400, { error: e.message });
      }
      return;
    }

    json(res, 404, { error: 'Not found' });
  });

  server.listen(PORT, '127.0.0.1', () => {
    console.log(`[Companion Server] Listening on http://127.0.0.1:${PORT}`);
  });

  server.on('error', (e: any) => {
    if (e.code === 'EADDRINUSE') {
      console.warn(`[Companion Server] Port ${PORT} in use, skipping`);
    } else {
      console.error('[Companion Server] Error:', e);
    }
  });
}
```

- [ ] **Step 2: Modify `electron/main.ts` — start companion server**

Read first. Add import at top:
```typescript
import { startCompanionServer } from './companion-server';
```

Inside `app.whenReady().then(() => {`, after all IPC handlers and BEFORE `createWindow()`, add:
```typescript
  startCompanionServer();
```

- [ ] **Step 3: Modify `electron/preload.ts` — expose companion capture listener**

Read first. Add a new `contextBridge.exposeInMainWorld` block AFTER the existing `electronRuntime` block:

```typescript
contextBridge.exposeInMainWorld('electronCompanion', {
  onCapture: (callback: (data: { title: string; url: string; content: string }) => void) => {
    const handler = (_event: any, data: any) => callback(data);
    ipcRenderer.on('companion:capture', handler);
    return () => {
      ipcRenderer.removeListener('companion:capture', handler);
    };
  },
});
```

- [ ] **Step 4: Commit**

```bash
git add electron/companion-server.ts electron/main.ts electron/preload.ts
git commit -m "feat(electron): add companion HTTP server for page capture"
```

---

### Task 4: Wire companion capture to extraction

**Files:**
- Modify: `src/platform/install-chrome-stubs.ts`

When the companion sends captured content, the renderer needs to trigger extraction. We wire the `companion:capture` IPC event to dispatch a synthetic extraction trigger that the existing UI hooks can pick up.

- [ ] **Step 1: Modify `src/platform/install-chrome-stubs.ts`**

Read first. At the end of `installChromeStubs()`, BEFORE the final `(globalThis as any).chrome = ...` assignment, add:

```typescript
  // Wire companion capture events to runtime message listeners
  const eCompanion = (window as any).electronCompanion as {
    onCapture: (cb: (data: { title: string; url: string; content: string }) => void) => () => void;
  } | undefined;

  if (eCompanion) {
    eCompanion.onCapture((data) => {
      // Dispatch as a runtime message so existing UI listeners can handle it
      for (const fn of messageListeners) {
        fn({ type: 'COMPANION_PAGE_CAPTURED', payload: data }, {}, () => {});
      }
    });
  }
```

Then in `src/ui/hooks/useLLMExtraction.ts`, add a listener for `COMPANION_PAGE_CAPTURED` that triggers extraction. Read the file first and find where runtime message listeners are set up.

Actually, a simpler approach: the companion capture just needs to populate the extraction input and trigger it. Let me check what the UI needs.

- [ ] **Step 2: Create a simple hook `src/ui/hooks/useCompanionCapture.ts`**

```typescript
import { useEffect } from 'react';
import { useLLMStore } from '../../graph/store/llm-store';

export function useCompanionCapture() {
  useEffect(() => {
    const listener = (message: any) => {
      if (message?.type === 'COMPANION_PAGE_CAPTURED') {
        const { title, url, content } = message.payload;
        const llm = useLLMStore.getState();
        llm.setInputText(content);
        llm.setSourceUrl(url);
      }
    };

    chrome.runtime.onMessage.addListener(listener);
    return () => chrome.runtime.onMessage.removeListener(listener);
  }, []);
}
```

- [ ] **Step 3: Wire the hook into App.tsx**

Read `src/ui/App.tsx` first. Add import and call:

```typescript
import { useCompanionCapture } from './hooks/useCompanionCapture';
```

Call it inside the `App` component (alongside the other hooks):
```typescript
  useCompanionCapture();
```

- [ ] **Step 4: Verify both builds**

```bash
npm run build && npm run build:electron
```

- [ ] **Step 5: Commit**

```bash
git add src/platform/install-chrome-stubs.ts src/ui/hooks/useCompanionCapture.ts src/ui/App.tsx
git commit -m "feat(companion): wire companion capture to extraction UI"
```

---

### Task 5: Build and verify

- [ ] **Step 1: Build everything**

```bash
npm run build:companion && npm run build:electron && npm run build
```

All three should pass.

- [ ] **Step 2: Load companion extension**

1. Open `chrome://extensions` in Chrome
2. Enable Developer Mode
3. Click "Load unpacked" → select `dist-companion/`
4. Companion extension appears with a toolbar icon

- [ ] **Step 3: Launch desktop app and test capture**

```bash
npm run dev:electron
```

1. Browse to any page in Chrome (e.g., a React SPA like `https://react.dev`)
2. Click the companion toolbar button
3. Badge shows "✓"
4. Desktop app receives content — extraction input populates with the page text

- [ ] **Step 4: Verify existing extension unaffected**

Load `dist/` as unpacked extension in Chrome. Verify side panel works normally. The companion and main extension coexist independently.

- [ ] **Step 5: Commit if fixes needed**

```bash
git add -A
git commit -m "fix(companion): adjustments from Phase 5 verification"
```

---

## Phase 5 success criteria

1. `npm run build:companion` produces `dist-companion/` with manifest + scripts
2. Companion loads in Chrome with toolbar icon
3. Click toolbar button on any page → badge shows "✓"
4. Desktop app receives captured content via HTTP
5. Extraction input populates with page text
6. `npm run build` (existing extension) unaffected
7. `npm run build:electron` unaffected
