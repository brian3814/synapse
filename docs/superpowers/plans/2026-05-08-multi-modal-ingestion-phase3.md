# Multi-Modal Ingestion Phase 3: UI + Vault

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add the user-facing UI components (drop zone, import button, paste handler, progress bar, processing mode prompt), the PlatformVault interface with Chrome/Electron implementations, source location badges in the review UI, and the "keep original?" post-review prompt.

**Architecture:** Three entry points (drag-drop, paste, import button) all call `createIngestionSourceFromFile()` / `createIngestionSourceFromClipboard()` then invoke `startIngestion()` from the `useLLMExtraction` hook. PlatformVault is a new platform interface alongside PlatformNotes, registered in both Chrome and Electron platform indices. Review badges are a non-breaking addition to `ReviewNodeItem` and `ReviewEdgeItem`.

**Tech Stack:** React, TypeScript, OPFS (Chrome), Node.js filesystem (Electron)

**Spec:** `docs/superpowers/specs/2026-05-03-multi-modal-ingestion-design.md`

**Depends on:** Phase 1 (types, schema) + Phase 2 (processors, pipeline, startIngestion hook)

**No test framework is configured.** Verify each task by running `npm run build` (Chrome). For UI tasks, load the extension in Chrome or run Electron to visually verify.

---

### Task 1: Add PlatformVault interface

**Files:**
- Modify: `src/platform/types.ts`

- [ ] **Step 1: Add PlatformVault interface**

In `src/platform/types.ts`, add the `PlatformVault` interface after the existing `PlatformNotes` interface:

```ts
export interface PlatformVault {
  init(): Promise<void>;
  store(data: ArrayBuffer, filename: string, nodeId: string): Promise<{ vaultPath: string }>;
  read(vaultPath: string): Promise<ArrayBuffer>;
  remove(vaultPath: string): Promise<void>;
  getStorageUsage(): Promise<{ bytes: number; fileCount: number }>;
}
```

- [ ] **Step 2: Verify it compiles**

Run: `npm run build 2>&1 | tail -5`
Expected: Build succeeds (no consumers yet)

- [ ] **Step 3: Commit**

```bash
git add src/platform/types.ts
git commit -m "feat(platform): add PlatformVault interface"
```

---

### Task 2: Implement ChromeVault (OPFS)

**Files:**
- Create: `src/platform/chrome/vault.ts`
- Modify: `src/platform/chrome/index.ts`

- [ ] **Step 1: Create ChromeVault implementation**

Create `src/platform/chrome/vault.ts`:

```ts
import type { PlatformVault } from '../types';

export class ChromeVault implements PlatformVault {
  private vaultDir: FileSystemDirectoryHandle | null = null;

  async init(): Promise<void> {
    if (this.vaultDir) return;
    const root = await navigator.storage.getDirectory();
    this.vaultDir = await root.getDirectoryHandle('vault', { create: true });
  }

  private dir(): FileSystemDirectoryHandle {
    if (!this.vaultDir) throw new Error('[OPFS] Vault not initialised — call init() first');
    return this.vaultDir;
  }

  private async getNodeDir(nodeId: string): Promise<FileSystemDirectoryHandle> {
    return this.dir().getDirectoryHandle(nodeId, { create: true });
  }

  async store(data: ArrayBuffer, filename: string, nodeId: string): Promise<{ vaultPath: string }> {
    const nodeDir = await this.getNodeDir(nodeId);
    const handle = await nodeDir.getFileHandle(filename, { create: true });
    const writable = await handle.createWritable();
    await writable.write(data);
    await writable.close();
    return { vaultPath: `vault/${nodeId}/${filename}` };
  }

  async read(vaultPath: string): Promise<ArrayBuffer> {
    const parts = vaultPath.replace(/^vault\//, '').split('/');
    if (parts.length < 2) throw new Error(`Invalid vault path: ${vaultPath}`);
    const nodeId = parts[0];
    const filename = parts.slice(1).join('/');
    const nodeDir = await this.dir().getDirectoryHandle(nodeId);
    const handle = await nodeDir.getFileHandle(filename);
    const file = await handle.getFile();
    return file.arrayBuffer();
  }

  async remove(vaultPath: string): Promise<void> {
    const parts = vaultPath.replace(/^vault\//, '').split('/');
    if (parts.length < 2) return;
    const nodeId = parts[0];
    const filename = parts.slice(1).join('/');
    try {
      const nodeDir = await this.dir().getDirectoryHandle(nodeId);
      await nodeDir.removeEntry(filename);
      // Remove the node directory if it's now empty
      let hasEntries = false;
      for await (const _ of (nodeDir as any).entries()) {
        hasEntries = true;
        break;
      }
      if (!hasEntries) {
        await this.dir().removeEntry(nodeId);
      }
    } catch (e: unknown) {
      if (e instanceof DOMException && e.name === 'NotFoundError') return;
      throw e;
    }
  }

  async getStorageUsage(): Promise<{ bytes: number; fileCount: number }> {
    let bytes = 0;
    let fileCount = 0;
    try {
      for await (const [, nodeHandle] of (this.dir() as any).entries()) {
        if (nodeHandle.kind !== 'directory') continue;
        for await (const [, fileHandle] of (nodeHandle as any).entries()) {
          if (fileHandle.kind !== 'file') continue;
          const file = await (fileHandle as FileSystemFileHandle).getFile();
          bytes += file.size;
          fileCount++;
        }
      }
    } catch {
      // Empty vault
    }
    return { bytes, fileCount };
  }
}
```

- [ ] **Step 2: Register in Chrome platform index**

In `src/platform/chrome/index.ts`, add:

```ts
import { ChromeVault } from './vault';
```

Add after the existing exports:

```ts
export const vault = new ChromeVault();
```

Update `initPlatform` to initialize the vault:

```ts
export async function initPlatform(): Promise<void> {
  await db.init();
  await notes.init();
  await vault.init();
}
```

- [ ] **Step 3: Verify it compiles**

Run: `npm run build 2>&1 | tail -5`
Expected: Build succeeds

- [ ] **Step 4: Commit**

```bash
git add src/platform/chrome/vault.ts src/platform/chrome/index.ts
git commit -m "feat(platform): implement ChromeVault with OPFS storage"
```

---

### Task 3: Implement ElectronVault (filesystem via IPC)

**Files:**
- Create: `src/platform/electron/vault.ts`
- Modify: `src/platform/electron/index.ts`

- [ ] **Step 1: Create ElectronVault implementation**

Create `src/platform/electron/vault.ts`:

```ts
import type { PlatformVault } from '../types';

declare const window: Window & {
  electronIPC: {
    invoke(channel: string, ...args: unknown[]): Promise<unknown>;
    on(channel: string, cb: (...args: unknown[]) => void): () => void;
  };
};

export class ElectronVault implements PlatformVault {
  async init(): Promise<void> {
    await window.electronIPC.invoke('vault:init');
  }

  async store(data: ArrayBuffer, filename: string, nodeId: string): Promise<{ vaultPath: string }> {
    const result = await window.electronIPC.invoke(
      'vault:store',
      Array.from(new Uint8Array(data)),
      filename,
      nodeId,
    );
    return result as { vaultPath: string };
  }

  async read(vaultPath: string): Promise<ArrayBuffer> {
    const arr = await window.electronIPC.invoke('vault:read', vaultPath) as number[];
    return new Uint8Array(arr).buffer;
  }

  async remove(vaultPath: string): Promise<void> {
    await window.electronIPC.invoke('vault:remove', vaultPath);
  }

  async getStorageUsage(): Promise<{ bytes: number; fileCount: number }> {
    return window.electronIPC.invoke('vault:usage') as Promise<{ bytes: number; fileCount: number }>;
  }
}
```

- [ ] **Step 2: Register in Electron platform index**

In `src/platform/electron/index.ts`, add:

```ts
import { ElectronVault } from './vault';
```

Add after the existing exports:

```ts
export const vault = new ElectronVault();
```

Update `initPlatform`:

```ts
export async function initPlatform(): Promise<void> {
  await db.init();
  await notes.init();
  await vault.init();
}
```

- [ ] **Step 3: Verify it compiles**

Run: `npm run build 2>&1 | tail -5`
Expected: Build succeeds (Electron main process IPC handlers will need to be added separately — the renderer side compiles independently)

- [ ] **Step 4: Commit**

```bash
git add src/platform/electron/vault.ts src/platform/electron/index.ts
git commit -m "feat(platform): implement ElectronVault with IPC bridge"
```

---

### Task 4: Add Electron main process vault handlers

**Files:**
- Modify: `electron/main.ts` (or the relevant IPC handler file)

- [ ] **Step 1: Find the IPC handler setup**

Look in `electron/main.ts` for where IPC handlers are registered (search for `ipcMain.handle('notes:` to find the pattern). The vault handlers follow the same pattern.

- [ ] **Step 2: Add vault IPC handlers**

Add the following handlers alongside the existing notes handlers. The vault directory lives at `~/Documents/KnowledgeGraph/vault/`:

```ts
import * as fs from 'fs';
import * as path from 'path';
import { app } from 'electron';

function getVaultDir(): string {
  return path.join(app.getPath('documents'), 'KnowledgeGraph', 'vault');
}

ipcMain.handle('vault:init', () => {
  const dir = getVaultDir();
  fs.mkdirSync(dir, { recursive: true });
});

ipcMain.handle('vault:store', (_event, dataArr: number[], filename: string, nodeId: string) => {
  const nodeDir = path.join(getVaultDir(), nodeId);
  fs.mkdirSync(nodeDir, { recursive: true });
  const filePath = path.join(nodeDir, filename);
  fs.writeFileSync(filePath, Buffer.from(dataArr));
  return { vaultPath: `vault/${nodeId}/${filename}` };
});

ipcMain.handle('vault:read', (_event, vaultPath: string) => {
  const fullPath = path.join(getVaultDir(), vaultPath.replace(/^vault\//, ''));
  const data = fs.readFileSync(fullPath);
  return Array.from(new Uint8Array(data));
});

ipcMain.handle('vault:remove', (_event, vaultPath: string) => {
  const fullPath = path.join(getVaultDir(), vaultPath.replace(/^vault\//, ''));
  try {
    fs.unlinkSync(fullPath);
    const dir = path.dirname(fullPath);
    if (fs.readdirSync(dir).length === 0) {
      fs.rmdirSync(dir);
    }
  } catch {
    // File may not exist
  }
});

ipcMain.handle('vault:usage', () => {
  const dir = getVaultDir();
  let bytes = 0;
  let fileCount = 0;
  try {
    for (const nodeId of fs.readdirSync(dir)) {
      const nodeDir = path.join(dir, nodeId);
      if (!fs.statSync(nodeDir).isDirectory()) continue;
      for (const file of fs.readdirSync(nodeDir)) {
        const stat = fs.statSync(path.join(nodeDir, file));
        if (stat.isFile()) {
          bytes += stat.size;
          fileCount++;
        }
      }
    }
  } catch {
    // Vault dir may not exist yet
  }
  return { bytes, fileCount };
});
```

- [ ] **Step 3: Add vault channels to preload whitelist**

In `electron/preload.ts`, find where IPC channels are whitelisted and add the vault channels: `'vault:init'`, `'vault:store'`, `'vault:read'`, `'vault:remove'`, `'vault:usage'`.

- [ ] **Step 4: Verify Electron build**

Run: `npm run build:electron-main 2>&1 | tail -5`
Expected: Build succeeds

- [ ] **Step 5: Commit**

```bash
git add electron/main.ts electron/preload.ts
git commit -m "feat(electron): add vault IPC handlers for file storage"
```

---

### Task 5: Create DropZone component

**Files:**
- Create: `src/ui/components/ingestion/DropZone.tsx`

- [ ] **Step 1: Create the DropZone component**

Create `src/ui/components/ingestion/DropZone.tsx`:

```tsx
import { useState, useCallback, useRef, useEffect } from 'react';
import { createIngestionSourceFromFile } from '../../../ingestion/ingestion-pipeline';
import { getProcessor, getSupportedExtensions } from '../../../ingestion/processor-factory';
import type { IngestionSource, ProcessingMode } from '../../../ingestion/types';

interface DropZoneProps {
  onIngest: (source: IngestionSource, mode: ProcessingMode) => void;
}

export function DropZone({ onIngest }: DropZoneProps) {
  const [isDragging, setIsDragging] = useState(false);
  const dragCounterRef = useRef(0);

  const handleDragEnter = useCallback((e: DragEvent) => {
    e.preventDefault();
    dragCounterRef.current++;
    if (dragCounterRef.current === 1) {
      const hasFiles = e.dataTransfer?.types.includes('Files');
      if (hasFiles) setIsDragging(true);
    }
  }, []);

  const handleDragLeave = useCallback((e: DragEvent) => {
    e.preventDefault();
    dragCounterRef.current--;
    if (dragCounterRef.current === 0) {
      setIsDragging(false);
    }
  }, []);

  const handleDragOver = useCallback((e: DragEvent) => {
    e.preventDefault();
    if (e.dataTransfer) e.dataTransfer.dropEffect = 'copy';
  }, []);

  const handleDrop = useCallback(async (e: DragEvent) => {
    e.preventDefault();
    dragCounterRef.current = 0;
    setIsDragging(false);

    const files = e.dataTransfer?.files;
    if (!files || files.length === 0) return;

    const file = files[0];
    const source = await createIngestionSourceFromFile(file);
    const processor = getProcessor(source);

    if (!processor) {
      return;
    }

    const modeCheck = processor.shouldPromptMode(source);
    if (modeCheck.prompt) {
      // The parent component will show the ProcessingModePrompt
      onIngest(source, 'full');
    } else {
      onIngest(source, 'full');
    }
  }, [onIngest]);

  useEffect(() => {
    const root = document.getElementById('root');
    if (!root) return;

    root.addEventListener('dragenter', handleDragEnter);
    root.addEventListener('dragleave', handleDragLeave);
    root.addEventListener('dragover', handleDragOver);
    root.addEventListener('drop', handleDrop);

    return () => {
      root.removeEventListener('dragenter', handleDragEnter);
      root.removeEventListener('dragleave', handleDragLeave);
      root.removeEventListener('dragover', handleDragOver);
      root.removeEventListener('drop', handleDrop);
    };
  }, [handleDragEnter, handleDragLeave, handleDragOver, handleDrop]);

  if (!isDragging) return null;

  const extensions = getSupportedExtensions().join(', ');

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 40,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        background: 'rgba(0, 0, 0, 0.6)',
        backdropFilter: 'blur(4px)',
      }}
    >
      <div
        style={{
          border: '2px dashed #6366f1',
          borderRadius: '16px',
          padding: '2rem 3rem',
          textAlign: 'center',
          background: 'rgba(99, 102, 241, 0.06)',
        }}
      >
        <div style={{ fontSize: '28px', marginBottom: '0.5rem' }}>📄</div>
        <div style={{ color: '#a5b4fc', fontSize: '13px', fontWeight: 500 }}>
          Drop file to extract knowledge
        </div>
        <div style={{ color: '#6366f1', fontSize: '11px', marginTop: '0.25rem' }}>
          {extensions}
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Verify it compiles**

Run: `npm run build 2>&1 | tail -5`
Expected: Build succeeds

- [ ] **Step 3: Commit**

```bash
git add src/ui/components/ingestion/DropZone.tsx
git commit -m "feat(ui): add DropZone component for drag-and-drop file ingestion"
```

---

### Task 6: Create ImportButton component

**Files:**
- Create: `src/ui/components/ingestion/ImportButton.tsx`

- [ ] **Step 1: Create the ImportButton component**

Create `src/ui/components/ingestion/ImportButton.tsx`:

```tsx
import { useRef, useCallback } from 'react';
import { createIngestionSourceFromFile } from '../../../ingestion/ingestion-pipeline';
import { getSupportedMimeTypes, getSupportedExtensions } from '../../../ingestion/processor-factory';
import type { IngestionSource, ProcessingMode } from '../../../ingestion/types';

interface ImportButtonProps {
  onIngest: (source: IngestionSource, mode: ProcessingMode) => void;
}

export function ImportButton({ onIngest }: ImportButtonProps) {
  const inputRef = useRef<HTMLInputElement>(null);

  const handleClick = useCallback(() => {
    inputRef.current?.click();
  }, []);

  const handleFileChange = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const source = await createIngestionSourceFromFile(file);
    onIngest(source, 'full');

    // Reset input so the same file can be selected again
    if (inputRef.current) inputRef.current.value = '';
  }, [onIngest]);

  const accept = [
    ...getSupportedMimeTypes(),
    ...getSupportedExtensions(),
  ].join(',');

  return (
    <>
      <input
        ref={inputRef}
        type="file"
        accept={accept}
        onChange={handleFileChange}
        style={{ display: 'none' }}
      />
      <button
        onClick={handleClick}
        className="p-1.5 rounded text-zinc-400 hover:text-zinc-200 hover:bg-zinc-700 transition-colors"
        title="Import file (PDF, image)"
      >
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
          <polyline points="17 8 12 3 7 8" />
          <line x1="12" y1="3" x2="12" y2="15" />
        </svg>
      </button>
    </>
  );
}
```

- [ ] **Step 2: Verify it compiles**

Run: `npm run build 2>&1 | tail -5`
Expected: Build succeeds

- [ ] **Step 3: Commit**

```bash
git add src/ui/components/ingestion/ImportButton.tsx
git commit -m "feat(ui): add ImportButton component with file picker"
```

---

### Task 7: Create IngestionProgress component

**Files:**
- Create: `src/ui/components/ingestion/IngestionProgress.tsx`

- [ ] **Step 1: Create the progress component**

Create `src/ui/components/ingestion/IngestionProgress.tsx`:

```tsx
interface IngestionProgressProps {
  percent: number;
  message: string;
}

export function IngestionProgress({ percent, message }: IngestionProgressProps) {
  return (
    <div style={{ padding: '0.75rem' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '0.25rem' }}>
        <span style={{ fontSize: '11px', color: '#a1a1aa' }}>{message}</span>
        <span style={{ fontSize: '11px', color: '#a1a1aa' }}>{percent}%</span>
      </div>
      <div style={{
        height: '4px',
        background: '#27272a',
        borderRadius: '2px',
        overflow: 'hidden',
      }}>
        <div style={{
          height: '100%',
          width: `${percent}%`,
          background: '#6366f1',
          borderRadius: '2px',
          transition: 'width 0.3s ease',
        }} />
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Verify it compiles**

Run: `npm run build 2>&1 | tail -5`
Expected: Build succeeds

- [ ] **Step 3: Commit**

```bash
git add src/ui/components/ingestion/IngestionProgress.tsx
git commit -m "feat(ui): add IngestionProgress component"
```

---

### Task 8: Create ProcessingModePrompt component

**Files:**
- Create: `src/ui/components/ingestion/ProcessingModePrompt.tsx`

- [ ] **Step 1: Create the processing mode prompt**

Create `src/ui/components/ingestion/ProcessingModePrompt.tsx`:

```tsx
import type { ModePromptResult, ProcessingMode } from '../../../ingestion/types';

interface ProcessingModePromptProps {
  filename: string;
  modeInfo: ModePromptResult;
  onSelect: (mode: ProcessingMode) => void;
  onCancel: () => void;
}

export function ProcessingModePrompt({ filename, modeInfo, onSelect, onCancel }: ProcessingModePromptProps) {
  return (
    <div style={{
      position: 'fixed',
      inset: 0,
      zIndex: 50,
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      background: 'rgba(0, 0, 0, 0.6)',
    }}>
      <div style={{
        background: '#18181b',
        border: '1px solid #3f3f46',
        borderRadius: '12px',
        padding: '1.5rem',
        maxWidth: '400px',
        width: '90%',
      }}>
        <h3 style={{ color: '#fafafa', fontSize: '14px', fontWeight: 600, marginTop: 0, marginBottom: '0.25rem' }}>
          Large document detected
        </h3>
        <p style={{ color: '#a1a1aa', fontSize: '12px', margin: '0 0 0.5rem' }}>
          {modeInfo.reason}
          {modeInfo.estimatedCost && (
            <span style={{ color: '#6366f1' }}> (est. {modeInfo.estimatedCost})</span>
          )}
        </p>
        <p style={{ color: '#71717a', fontSize: '11px', margin: '0 0 1rem' }}>
          How would you like to process <strong style={{ color: '#d4d4d8' }}>{filename}</strong>?
        </p>

        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
          <button
            onClick={() => onSelect('quick')}
            style={{
              background: '#27272a',
              border: '1px solid #3f3f46',
              borderRadius: '8px',
              padding: '0.75rem',
              textAlign: 'left',
              cursor: 'pointer',
              color: '#fafafa',
            }}
          >
            <div style={{ fontSize: '13px', fontWeight: 500 }}>Quick overview</div>
            <div style={{ fontSize: '11px', color: '#a1a1aa', marginTop: '0.25rem' }}>
              Extract title, abstract, and table of contents only
            </div>
          </button>

          <button
            onClick={() => onSelect('full')}
            style={{
              background: '#1e1b4b',
              border: '1px solid #4338ca',
              borderRadius: '8px',
              padding: '0.75rem',
              textAlign: 'left',
              cursor: 'pointer',
              color: '#fafafa',
            }}
          >
            <div style={{ fontSize: '13px', fontWeight: 500 }}>Full extraction</div>
            <div style={{ fontSize: '11px', color: '#a5b4fc', marginTop: '0.25rem' }}>
              Process all pages — extract all entities and relationships
            </div>
          </button>

          <button
            onClick={onCancel}
            style={{
              background: 'transparent',
              border: 'none',
              padding: '0.5rem',
              cursor: 'pointer',
              color: '#71717a',
              fontSize: '12px',
              textAlign: 'center',
            }}
          >
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Verify it compiles**

Run: `npm run build 2>&1 | tail -5`
Expected: Build succeeds

- [ ] **Step 3: Commit**

```bash
git add src/ui/components/ingestion/ProcessingModePrompt.tsx
git commit -m "feat(ui): add ProcessingModePrompt harness component"
```

---

### Task 9: Add source location badges to ReviewNodeItem

**Files:**
- Modify: `src/graph/store/extraction-review-store.ts` (ReviewNode type)
- Modify: `src/ui/components/llm/ReviewNodeItem.tsx`

- [ ] **Step 1: Add sourceLocation to ReviewNode**

In `src/graph/store/extraction-review-store.ts`, add `sourceLocation` to the `ReviewNode` interface:

```ts
import type { SourceLocation } from '../../ingestion/types';
```

Add to `ReviewNode` interface after `tags`:

```ts
  sourceLocation?: SourceLocation;
```

Also add to `ReviewEdge` interface after `type`:

```ts
  sourceLocation?: SourceLocation;
```

- [ ] **Step 2: Create a SourceLocationBadge helper**

Create `src/ui/components/ingestion/SourceLocationBadge.tsx`:

```tsx
import type { SourceLocation } from '../../../ingestion/types';

export function SourceLocationBadge({ location }: { location: SourceLocation }) {
  let label: string;
  switch (location.type) {
    case 'page':
      label = location.section
        ? `p.${location.page} · ${location.section}`
        : `p.${location.page}`;
      break;
    case 'region':
      label = location.description;
      break;
    case 'time':
      label = location.speaker
        ? `${location.timestamp} · ${location.speaker}`
        : location.timestamp;
      break;
    case 'selector':
      label = location.selector.slice(0, 20);
      break;
  }

  return (
    <span style={{
      background: '#172554',
      color: '#93c5fd',
      fontSize: '9px',
      padding: '2px 6px',
      borderRadius: '4px',
      fontWeight: 500,
      whiteSpace: 'nowrap',
    }}>
      {label}
    </span>
  );
}
```

- [ ] **Step 3: Add badge to ReviewNodeItem**

In `src/ui/components/llm/ReviewNodeItem.tsx`, import `SourceLocationBadge` and render it when `node.sourceLocation` is present. Find the node's status indicator area (where merge/new badges are shown) and add:

```tsx
import { SourceLocationBadge } from '../ingestion/SourceLocationBadge';
```

Then in the JSX, alongside the existing status indicators, add:

```tsx
{node.sourceLocation && <SourceLocationBadge location={node.sourceLocation} />}
```

- [ ] **Step 4: Add badge to ReviewEdgeItem**

In `src/ui/components/llm/ReviewEdgeItem.tsx`, add the same import and badge rendering for `edge.sourceLocation`:

```tsx
import { SourceLocationBadge } from '../ingestion/SourceLocationBadge';
```

Then in the JSX:

```tsx
{edge.sourceLocation && <SourceLocationBadge location={edge.sourceLocation} />}
```

- [ ] **Step 5: Verify it compiles**

Run: `npm run build 2>&1 | tail -5`
Expected: Build succeeds

- [ ] **Step 6: Commit**

```bash
git add src/graph/store/extraction-review-store.ts src/ui/components/ingestion/SourceLocationBadge.tsx src/ui/components/llm/ReviewNodeItem.tsx src/ui/components/llm/ReviewEdgeItem.tsx
git commit -m "feat(ui): add source location badges to extraction review"
```

---

### Task 10: Wire DropZone and ImportButton into the app

**Files:**
- Modify: `src/ui/App.tsx` (or root layout component)
- Modify: `src/ui/components/Header.tsx`

- [ ] **Step 1: Add ImportButton to Header**

In `src/ui/components/Header.tsx`, import `ImportButton` and add it to the toolbar:

```tsx
import { ImportButton } from './ingestion/ImportButton';
import { createIngestionSourceFromFile } from '../../ingestion/ingestion-pipeline';
import { getProcessor } from '../../ingestion/processor-factory';
import type { IngestionSource, ProcessingMode } from '../../ingestion/types';
```

Add a handler in the `Header` component:

```tsx
const { startIngestion } = useLLMExtraction();

const handleIngest = useCallback((source: IngestionSource, mode: ProcessingMode) => {
  startIngestion(source, mode);
}, [startIngestion]);
```

Add the `ImportButton` in the toolbar area (the div with `className="flex items-center gap-1 shrink-0 ml-auto"`), before the settings button:

```tsx
<ImportButton onIngest={handleIngest} />
```

- [ ] **Step 2: Add DropZone to App**

In `src/ui/App.tsx` (or whichever component wraps the main layout), import and render the `DropZone`:

```tsx
import { DropZone } from './components/ingestion/DropZone';
```

Inside the root render, add:

```tsx
<DropZone onIngest={handleIngest} />
```

You'll need to bring `useLLMExtraction` into scope and create the `handleIngest` callback similar to what was done in Header.

- [ ] **Step 3: Verify it compiles**

Run: `npm run build 2>&1 | tail -5`
Expected: Build succeeds

- [ ] **Step 4: Manual test**

Load the extension in Chrome (`chrome://extensions`, load unpacked from `dist/`). Open the side panel or tab. Drag a PDF or image file onto the graph canvas. The drop zone overlay should appear, and after dropping, the extraction pipeline should start.

- [ ] **Step 5: Commit**

```bash
git add src/ui/App.tsx src/ui/components/Header.tsx
git commit -m "feat(ui): wire DropZone and ImportButton into app shell"
```

---

### Task 11: Add clipboard paste handler

**Files:**
- Modify: `src/ui/App.tsx` (or the component that manages the DropZone)

- [ ] **Step 1: Add paste event listener**

In the same component where `DropZone` is rendered, add a paste event listener. Add this inside the component:

```tsx
useEffect(() => {
  const handlePaste = async (e: ClipboardEvent) => {
    const items = e.clipboardData?.items;
    if (!items) return;

    for (const item of items) {
      if (item.type.startsWith('image/')) {
        e.preventDefault();
        const file = item.getAsFile();
        if (!file) continue;
        const source = await createIngestionSourceFromFile(file);
        handleIngest(source, 'full');
        return;
      }
    }
  };

  document.addEventListener('paste', handlePaste);
  return () => document.removeEventListener('paste', handlePaste);
}, [handleIngest]);
```

Import `createIngestionSourceFromFile` from `../../ingestion/ingestion-pipeline` if not already imported.

- [ ] **Step 2: Verify it compiles**

Run: `npm run build 2>&1 | tail -5`
Expected: Build succeeds

- [ ] **Step 3: Commit**

```bash
git add src/ui/App.tsx
git commit -m "feat(ui): add clipboard paste handler for image ingestion"
```

---

### Task 12: Wire ProcessingModePrompt into ingestion flow

**Files:**
- Modify: `src/ui/App.tsx` (or DropZone parent component)

- [ ] **Step 1: Add state for pending ingestion with mode prompt**

In the component that manages ingestion (where DropZone and paste handler live), add state to handle the mode prompt flow:

```tsx
import { ProcessingModePrompt } from './components/ingestion/ProcessingModePrompt';
import { getProcessor } from '../ingestion/processor-factory';
import type { IngestionSource, ProcessingMode, ModePromptResult } from '../ingestion/types';

const [pendingSource, setPendingSource] = useState<IngestionSource | null>(null);
const [modePromptInfo, setModePromptInfo] = useState<ModePromptResult | null>(null);
```

Update the `handleIngest` callback to check `shouldPromptMode`:

```tsx
const handleIngest = useCallback((source: IngestionSource, mode: ProcessingMode) => {
  const processor = getProcessor(source);
  if (!processor) return;

  const modeCheck = processor.shouldPromptMode(source);
  if (modeCheck.prompt) {
    setPendingSource(source);
    setModePromptInfo(modeCheck);
  } else {
    startIngestion(source, mode);
  }
}, [startIngestion]);

const handleModeSelect = useCallback((mode: ProcessingMode) => {
  if (pendingSource) {
    startIngestion(pendingSource, mode);
    setPendingSource(null);
    setModePromptInfo(null);
  }
}, [pendingSource, startIngestion]);

const handleModeCancel = useCallback(() => {
  setPendingSource(null);
  setModePromptInfo(null);
}, []);
```

- [ ] **Step 2: Render the prompt**

Add to the JSX:

```tsx
{pendingSource && modePromptInfo && (
  <ProcessingModePrompt
    filename={pendingSource.name}
    modeInfo={modePromptInfo}
    onSelect={handleModeSelect}
    onCancel={handleModeCancel}
  />
)}
```

- [ ] **Step 3: Verify it compiles**

Run: `npm run build 2>&1 | tail -5`
Expected: Build succeeds

- [ ] **Step 4: Commit**

```bash
git add src/ui/App.tsx
git commit -m "feat(ui): wire ProcessingModePrompt into ingestion flow"
```
