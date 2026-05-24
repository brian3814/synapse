# Vault Explorer Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a collapsible left-side drawer with a filesystem tree viewer that displays the vault directory contents, supporting file/folder CRUD, drag-and-drop, and context-dependent file opening.

**Architecture:** A self-contained `VaultExplorer` component communicates with the main process via new IPC handlers for lazy directory reads and mutations. The drawer integrates into `TabLayout` as a push-style left panel with a resize handle. react-arborist handles tree rendering with virtualization.

**Tech Stack:** React 19, react-arborist, Zustand (ui-store), Electron IPC, Tailwind CSS

**Commit Strategy:** Single commit after full implementation is complete and smoke-tested. No intermediate commits.

---

## File Map

| Action | Path | Responsibility |
|--------|------|----------------|
| Create | `src/ui/components/vault-explorer/types.ts` | Internal types (VaultFileEntry, etc.) |
| Create | `src/ui/components/vault-explorer/file-type-utils.ts` | Extension → icon/type classification |
| Create | `src/ui/components/vault-explorer/file-open-registry.ts` | File type → open action mapping |
| Create | `src/ui/components/vault-explorer/useVaultFileSystem.ts` | Hook: lazy FS reads, CRUD, watch |
| Create | `src/ui/components/vault-explorer/VaultTreeNode.tsx` | Custom node renderer |
| Create | `src/ui/components/vault-explorer/VaultTree.tsx` | react-arborist wrapper |
| Create | `src/ui/components/vault-explorer/VaultExplorer.tsx` | Shell: toolbar + tree + drop zone |
| Create | `src/ui/components/vault-explorer/index.ts` | Public re-export |
| Create | `src/ui/components/layout/VaultDrawer.tsx` | Collapse/resize chrome |
| Create | `src/ui/components/tabs/ViewerTab.tsx` | Unified file viewer (image/PDF/fallback) |
| Modify | `src/graph/store/ui-store.ts` | Add drawer state + new tab types |
| Modify | `src/ui/layouts/TabLayout.tsx` | Render VaultDrawer + new tab kinds |
| Modify | `src/ui/components/Header.tsx` | Add drawer toggle button |
| Modify | `electron/main.ts` | Register new vault-explorer IPC handlers |
| Modify | `electron/vault/file-watcher.ts` | Broadcast raw FS events to renderer |
| Modify | `package.json` | Add react-arborist + react-window deps |

---

### Task 1: Install Dependencies

**Files:**
- Modify: `package.json`

- [ ] **Step 1: Install react-arborist and react-window**

```bash
npm install react-arborist react-window
npm install -D @types/react-window
```

- [ ] **Step 2: Verify installation**

```bash
node -e "require('react-arborist'); console.log('react-arborist OK')"
```

Expected: `react-arborist OK`


---

### Task 2: Add IPC Handlers for Filesystem Operations (Main Process)

**Files:**
- Modify: `electron/main.ts:285-340` (add after existing vault handlers)
- Modify: `electron/vault/file-watcher.ts` (broadcast to renderer)

- [ ] **Step 1: Add vault-explorer IPC handlers to main.ts**

Add the following after the existing `vault:usage` handler (around line 340) in `electron/main.ts`:

```typescript
// ── Vault Explorer — filesystem operations ──────────────────────────────
ipcMain.handle('vault-explorer:read-dir', async (_event, dirPath: string) => {
  const entries = fs.readdirSync(dirPath, { withFileTypes: true });
  return entries
    .filter(e => e.name !== '.DS_Store' && e.name !== 'Thumbs.db')
    .map(e => ({
      id: path.join(dirPath, e.name),
      name: e.name,
      isFolder: e.isDirectory(),
    }))
    .sort((a, b) => {
      if (a.isFolder !== b.isFolder) return a.isFolder ? -1 : 1;
      return a.name.localeCompare(b.name);
    });
});

ipcMain.handle('vault-explorer:create-file', async (_event, dirPath: string, name: string) => {
  const fullPath = path.join(dirPath, name);
  fs.writeFileSync(fullPath, '', { flag: 'wx' });
});

ipcMain.handle('vault-explorer:create-folder', async (_event, dirPath: string, name: string) => {
  fs.mkdirSync(path.join(dirPath, name));
});

ipcMain.handle('vault-explorer:rename', async (_event, oldPath: string, newPath: string) => {
  fs.renameSync(oldPath, newPath);
});

ipcMain.handle('vault-explorer:delete', async (_event, targetPath: string) => {
  const { shell } = require('electron');
  await shell.trashItem(targetPath);
});

ipcMain.handle('vault-explorer:move', async (_event, sourcePath: string, destDir: string) => {
  const name = path.basename(sourcePath);
  let destPath = path.join(destDir, name);
  // Handle name collisions
  let counter = 1;
  while (fs.existsSync(destPath)) {
    const ext = path.extname(name);
    const base = name.slice(0, name.length - ext.length);
    destPath = path.join(destDir, `${base} (${counter})${ext}`);
    counter++;
  }
  fs.renameSync(sourcePath, destPath);
});

ipcMain.handle('vault-explorer:import-files', async (_event, filePaths: string[], destDir: string) => {
  for (const srcPath of filePaths) {
    const name = path.basename(srcPath);
    let destPath = path.join(destDir, name);
    let counter = 1;
    while (fs.existsSync(destPath)) {
      const ext = path.extname(name);
      const base = name.slice(0, name.length - ext.length);
      destPath = path.join(destDir, `${base} (${counter})${ext}`);
      counter++;
    }
    fs.copyFileSync(srcPath, destPath);
  }
});

ipcMain.handle('vault-explorer:open-external', async (_event, filePath: string) => {
  const { shell } = require('electron');
  await shell.openPath(filePath);
});
```

- [ ] **Step 2: Add file watcher broadcast to renderer**

In `electron/main.ts`, inside `registerVaultHandlers()` after the file watcher is started (around line 442), add a listener that forwards file events to all renderer windows:

```typescript
// Forward file-watcher events to renderer for vault explorer
ctx.eventBus.on('file:added', (event) => {
  for (const win of BrowserWindow.getAllWindows()) {
    win.webContents.send('vault-explorer:fs-changed', { type: 'added', relativePath: event.relativePath });
  }
});
ctx.eventBus.on('file:removed', (event) => {
  for (const win of BrowserWindow.getAllWindows()) {
    win.webContents.send('vault-explorer:fs-changed', { type: 'removed', relativePath: event.relativePath });
  }
});
```

- [ ] **Step 3: Update file-watcher to not ignore .kg for vault explorer display**

In `electron/vault/file-watcher.ts`, the `.kg` directory is already ignored by the watcher — this is correct because the vault explorer uses its own `readDir` calls (not watcher events) to display `.kg/`. The watcher only signals changes to user-content directories, which triggers a partial refresh in the tree for those directories. No changes needed to the watcher itself.

- [ ] **Step 4: Verify build compiles**

```bash
npm run build:electron-main
```

Expected: No errors.


---

### Task 3: UI Store — Drawer State and New Tab Types

**Files:**
- Modify: `src/graph/store/ui-store.ts:1-11` (ContentTabType), `54-102` (interface), `104-145` (init)

- [ ] **Step 1: Extend ContentTabType with image and PDF kinds**

In `src/graph/store/ui-store.ts`, update the `ContentTabType` union (lines 8-11):

```typescript
export type ContentTabType =
  | { kind: 'graph' }
  | { kind: 'noteEditor'; noteId: string }
  | { kind: 'extractionReview' }
  | { kind: 'viewer'; filePath: string };
```

- [ ] **Step 2: Update contentTabId to handle new types**

In `src/graph/store/ui-store.ts`, update the `contentTabId` function (line 26-30):

```typescript
function contentTabId(type: ContentTabType): string {
  if (type.kind === 'graph') return 'graph';
  if (type.kind === 'extractionReview') return 'extraction-review';
  if (type.kind === 'noteEditor') return `note-${type.noteId}`;
  if (type.kind === 'viewer') return `viewer-${type.filePath}`;
  return `unknown`;
}
```

- [ ] **Step 3: Add drawer state to UIStore interface**

In `src/graph/store/ui-store.ts`, add to the `UIStore` interface (after line 101):

```typescript
  vaultDrawerOpen: boolean;
  vaultDrawerWidth: number;
  vaultDrawerExpandedPaths: string[];
  toggleVaultDrawer: () => void;
  setVaultDrawerWidth: (width: number) => void;
  setVaultDrawerExpandedPaths: (paths: string[]) => void;
```

- [ ] **Step 4: Add drawer state initialization and actions**

In `src/graph/store/ui-store.ts`, add initial values and actions to the store (after `pendingEditNoteId: null,` around line 117):

```typescript
  vaultDrawerOpen: JSON.parse(localStorage.getItem('vault-drawer-open') ?? 'false'),
  vaultDrawerWidth: JSON.parse(localStorage.getItem('vault-drawer-width') ?? '240'),
  vaultDrawerExpandedPaths: JSON.parse(localStorage.getItem('vault-drawer-expanded') ?? '[]'),
```

And add the actions (after `setPendingEditNoteId`):

```typescript
  toggleVaultDrawer: () => set((state) => {
    const next = !state.vaultDrawerOpen;
    localStorage.setItem('vault-drawer-open', JSON.stringify(next));
    return { vaultDrawerOpen: next };
  }),
  setVaultDrawerWidth: (width) => set(() => {
    const clamped = Math.min(400, Math.max(180, width));
    localStorage.setItem('vault-drawer-width', JSON.stringify(clamped));
    return { vaultDrawerWidth: clamped };
  }),
  setVaultDrawerExpandedPaths: (paths) => set(() => {
    localStorage.setItem('vault-drawer-expanded', JSON.stringify(paths));
    return { vaultDrawerExpandedPaths: paths };
  }),
```

- [ ] **Step 5: Verify build compiles**

```bash
npm run build:electron-renderer
```

Expected: No errors.


---

### Task 4: Types and Utilities

**Files:**
- Create: `src/ui/components/vault-explorer/types.ts`
- Create: `src/ui/components/vault-explorer/file-type-utils.ts`
- Create: `src/ui/components/vault-explorer/file-open-registry.ts`

- [ ] **Step 1: Create types.ts**

```typescript
// src/ui/components/vault-explorer/types.ts

export interface VaultFileEntry {
  id: string;        // absolute path (used as unique key)
  name: string;
  isFolder: boolean;
  children?: VaultFileEntry[];
  isInternal?: boolean;  // true for .kg/ contents — grayed out, mutations blocked
}
```

- [ ] **Step 2: Create file-type-utils.ts**

```typescript
// src/ui/components/vault-explorer/file-type-utils.ts

const IMAGE_EXTS = new Set(['.png', '.jpg', '.jpeg', '.gif', '.webp', '.svg']);
const PDF_EXTS = new Set(['.pdf']);
const NOTE_EXTS = new Set(['.md']);

export type FileCategory = 'note' | 'image' | 'pdf' | 'external';

export function getFileCategory(filename: string): FileCategory {
  const ext = getExtension(filename);
  if (NOTE_EXTS.has(ext)) return 'note';
  if (IMAGE_EXTS.has(ext)) return 'image';
  if (PDF_EXTS.has(ext)) return 'pdf';
  return 'external';
}

export function getExtension(filename: string): string {
  const dot = filename.lastIndexOf('.');
  return dot === -1 ? '' : filename.slice(dot).toLowerCase();
}

export function getFileIcon(filename: string, isFolder: boolean): string {
  if (isFolder) return '📁';
  const cat = getFileCategory(filename);
  switch (cat) {
    case 'note': return '📝';
    case 'image': return '🖼️';
    case 'pdf': return '📄';
    default: return '📎';
  }
}
```

- [ ] **Step 3: Create file-open-registry.ts**

```typescript
// src/ui/components/vault-explorer/file-open-registry.ts

import { getFileCategory, type FileCategory } from './file-type-utils';

export function resolveFileType(filename: string): FileCategory {
  return getFileCategory(filename);
}
```


---

### Task 5: useVaultFileSystem Hook

**Files:**
- Create: `src/ui/components/vault-explorer/useVaultFileSystem.ts`

- [ ] **Step 1: Create the hook**

```typescript
// src/ui/components/vault-explorer/useVaultFileSystem.ts

import { useState, useEffect, useCallback, useRef } from 'react';
import type { VaultFileEntry } from './types';

declare const window: Window & {
  electronIPC: {
    invoke(channel: string, ...args: unknown[]): Promise<unknown>;
    on(channel: string, cb: (...args: unknown[]) => void): () => void;
  };
};

interface UseVaultFileSystemReturn {
  treeData: VaultFileEntry[];
  loadChildren: (parentId: string) => Promise<VaultFileEntry[]>;
  createFile: (dirPath: string, name: string) => Promise<void>;
  createFolder: (dirPath: string, name: string) => Promise<void>;
  rename: (oldPath: string, newName: string) => Promise<void>;
  deleteItem: (path: string) => Promise<void>;
  move: (sourcePath: string, destDir: string) => Promise<void>;
  importFiles: (filePaths: string[], destDir: string) => Promise<void>;
  refresh: () => void;
}

function markInternalEntries(entries: VaultFileEntry[], rootPath: string): VaultFileEntry[] {
  return entries.map(entry => {
    const relativePath = entry.id.slice(rootPath.length + 1);
    const isInternal = relativePath.startsWith('.kg');
    return { ...entry, isInternal };
  });
}

export function useVaultFileSystem(rootPath: string): UseVaultFileSystemReturn {
  const [treeData, setTreeData] = useState<VaultFileEntry[]>([]);
  const rootRef = useRef(rootPath);
  rootRef.current = rootPath;

  const readDir = useCallback(async (dirPath: string): Promise<VaultFileEntry[]> => {
    const entries = await window.electronIPC.invoke('vault-explorer:read-dir', dirPath) as Array<{ id: string; name: string; isFolder: boolean }>;
    return entries.map(e => ({
      ...e,
      children: e.isFolder ? [] : undefined,
    }));
  }, []);

  const loadRoot = useCallback(async () => {
    if (!rootPath) return;
    const entries = await readDir(rootPath);
    setTreeData(markInternalEntries(entries, rootPath));
  }, [rootPath, readDir]);

  const loadChildren = useCallback(async (parentId: string): Promise<VaultFileEntry[]> => {
    const entries = await readDir(parentId);
    return markInternalEntries(entries, rootRef.current);
  }, [readDir]);

  // Initial load
  useEffect(() => {
    loadRoot();
  }, [loadRoot]);

  // Subscribe to file system changes from main process
  useEffect(() => {
    if (!rootPath) return;
    let debounceTimer: ReturnType<typeof setTimeout> | null = null;

    const cleanup = window.electronIPC.on('vault-explorer:fs-changed', () => {
      if (debounceTimer) clearTimeout(debounceTimer);
      debounceTimer = setTimeout(() => {
        loadRoot();
      }, 100);
    });

    return () => {
      cleanup();
      if (debounceTimer) clearTimeout(debounceTimer);
    };
  }, [rootPath, loadRoot]);

  const createFile = useCallback(async (dirPath: string, name: string) => {
    await window.electronIPC.invoke('vault-explorer:create-file', dirPath, name);
    loadRoot();
  }, [loadRoot]);

  const createFolder = useCallback(async (dirPath: string, name: string) => {
    await window.electronIPC.invoke('vault-explorer:create-folder', dirPath, name);
    loadRoot();
  }, [loadRoot]);

  const rename = useCallback(async (oldPath: string, newName: string) => {
    const dir = oldPath.substring(0, oldPath.lastIndexOf('/'));
    const newPath = `${dir}/${newName}`;
    await window.electronIPC.invoke('vault-explorer:rename', oldPath, newPath);
    loadRoot();
  }, [loadRoot]);

  const deleteItem = useCallback(async (itemPath: string) => {
    await window.electronIPC.invoke('vault-explorer:delete', itemPath);
    loadRoot();
  }, [loadRoot]);

  const move = useCallback(async (sourcePath: string, destDir: string) => {
    await window.electronIPC.invoke('vault-explorer:move', sourcePath, destDir);
    loadRoot();
  }, [loadRoot]);

  const importFiles = useCallback(async (filePaths: string[], destDir: string) => {
    await window.electronIPC.invoke('vault-explorer:import-files', filePaths, destDir);
    loadRoot();
  }, [loadRoot]);

  const refresh = useCallback(() => {
    loadRoot();
  }, [loadRoot]);

  return { treeData, loadChildren, createFile, createFolder, rename, deleteItem, move, importFiles, refresh };
}
```


---

### Task 6: VaultTreeNode — Custom Node Renderer

**Files:**
- Create: `src/ui/components/vault-explorer/VaultTreeNode.tsx`

- [ ] **Step 1: Create the node renderer**

```typescript
// src/ui/components/vault-explorer/VaultTreeNode.tsx

import type { NodeRendererProps } from 'react-arborist';
import type { VaultFileEntry } from './types';
import { getFileIcon } from './file-type-utils';

export function VaultTreeNode({ node, style, dragHandle }: NodeRendererProps<VaultFileEntry>) {
  const data = node.data;
  const isInternal = data.isInternal;

  return (
    <div
      ref={dragHandle}
      style={style}
      className={`flex items-center gap-1.5 px-2 py-0.5 cursor-pointer select-none text-[12px] leading-5 rounded
        ${node.isSelected ? 'bg-indigo-600/30 text-zinc-100' : 'text-zinc-300 hover:bg-zinc-700/50'}
        ${isInternal ? 'opacity-40 pointer-events-auto' : ''}
      `}
      onClick={() => node.isInternal ? null : (node.isLeaf ? node.activate() : node.toggle())}
      onDoubleClick={() => {
        if (isInternal) return;
        if (node.isLeaf) node.activate();
        else node.toggle();
      }}
    >
      {/* Folder chevron */}
      <span className="w-3 flex-shrink-0 text-[10px] text-zinc-500">
        {data.isFolder ? (node.isOpen ? '▾' : '▸') : ''}
      </span>

      {/* Icon */}
      <span className="flex-shrink-0 text-[11px]">
        {data.isFolder ? (node.isOpen ? '📂' : '📁') : getFileIcon(data.name, false)}
      </span>

      {/* Name or edit input */}
      {node.isEditing ? (
        <input
          type="text"
          defaultValue={data.name}
          autoFocus
          className="flex-1 min-w-0 bg-zinc-800 border border-indigo-500 rounded px-1 text-[12px] text-zinc-100 outline-none"
          onFocus={(e) => {
            const dot = data.name.lastIndexOf('.');
            if (dot > 0 && !data.isFolder) {
              e.target.setSelectionRange(0, dot);
            } else {
              e.target.select();
            }
          }}
          onBlur={() => node.reset()}
          onKeyDown={(e) => {
            if (e.key === 'Escape') node.reset();
            if (e.key === 'Enter') node.submit(e.currentTarget.value);
          }}
        />
      ) : (
        <span className="truncate flex-1 min-w-0">{data.name}</span>
      )}
    </div>
  );
}
```


---

### Task 7: VaultTree — react-arborist Wrapper

**Files:**
- Create: `src/ui/components/vault-explorer/VaultTree.tsx`

- [ ] **Step 1: Create the tree wrapper**

```typescript
// src/ui/components/vault-explorer/VaultTree.tsx

import { useRef, useCallback } from 'react';
import { Tree, type TreeApi, type MoveHandler, type RenameHandler, type DeleteHandler } from 'react-arborist';
import { VaultTreeNode } from './VaultTreeNode';
import type { VaultFileEntry } from './types';

interface VaultTreeProps {
  data: VaultFileEntry[];
  height: number;
  onActivate: (node: VaultFileEntry) => void;
  onRename: (oldPath: string, newName: string) => Promise<void>;
  onMove: (sourcePath: string, destDir: string) => Promise<void>;
  onDelete: (path: string) => Promise<void>;
  expandedIds: string[];
  onToggle: (id: string, isOpen: boolean) => void;
}

export function VaultTree({
  data,
  height,
  onActivate,
  onRename,
  onMove,
  onDelete,
  expandedIds,
  onToggle,
}: VaultTreeProps) {
  const treeRef = useRef<TreeApi<VaultFileEntry>>(null);

  const handleRename: RenameHandler<VaultFileEntry> = useCallback(({ id, name }) => {
    onRename(id, name);
  }, [onRename]);

  const handleMove: MoveHandler<VaultFileEntry> = useCallback(({ dragIds, parentId }) => {
    if (!parentId) return;
    for (const id of dragIds) {
      onMove(id, parentId);
    }
  }, [onMove]);

  const handleDelete: DeleteHandler<VaultFileEntry> = useCallback(({ ids }) => {
    for (const id of ids) {
      onDelete(id);
    }
  }, [onDelete]);

  const handleActivate = useCallback((node: { data: VaultFileEntry }) => {
    onActivate(node.data);
  }, [onActivate]);

  const handleToggle = useCallback((id: string) => {
    const node = treeRef.current?.get(id);
    if (node) {
      onToggle(id, !node.isOpen);
    }
  }, [onToggle]);

  return (
    <Tree<VaultFileEntry>
      ref={treeRef}
      data={data}
      width="100%"
      height={height}
      rowHeight={26}
      indent={16}
      openByDefault={false}
      initialOpenState={Object.fromEntries(expandedIds.map(id => [id, true]))}
      onRename={handleRename}
      onMove={handleMove}
      onDelete={handleDelete}
      onActivate={handleActivate}
      onToggle={handleToggle}
      disableDrag={(node) => node.data.isInternal === true}
      disableDrop={(args) => {
        const target = args.parentNode;
        if (!target) return false;
        return target.data.isInternal === true;
      }}
    >
      {VaultTreeNode}
    </Tree>
  );
}

export type { TreeApi };
```


---

### Task 8: VaultExplorer — Main Shell Component

**Files:**
- Create: `src/ui/components/vault-explorer/VaultExplorer.tsx`
- Create: `src/ui/components/vault-explorer/index.ts`

- [ ] **Step 1: Create VaultExplorer.tsx**

```typescript
// src/ui/components/vault-explorer/VaultExplorer.tsx

import { useCallback, useRef, useState } from 'react';
import { VaultTree } from './VaultTree';
import { useVaultFileSystem } from './useVaultFileSystem';
import { resolveFileType } from './file-open-registry';
import { useUIStore } from '../../../graph/store/ui-store';
import type { VaultFileEntry } from './types';

interface VaultExplorerProps {
  rootPath: string;
  onOpenFile: (path: string, fileType: string) => void;
}

export function VaultExplorer({ rootPath, onOpenFile }: VaultExplorerProps) {
  const { treeData, createFile, createFolder, rename, deleteItem, move, importFiles, refresh } = useVaultFileSystem(rootPath);
  const expandedPaths = useUIStore((s) => s.vaultDrawerExpandedPaths);
  const setExpandedPaths = useUIStore((s) => s.setVaultDrawerExpandedPaths);
  const containerRef = useRef<HTMLDivElement>(null);
  const [containerHeight, setContainerHeight] = useState(400);
  const [dragOver, setDragOver] = useState(false);

  // Measure container height for virtualized tree
  const measuredRef = useCallback((node: HTMLDivElement | null) => {
    if (!node) return;
    containerRef.current = node;
    const observer = new ResizeObserver((entries) => {
      for (const entry of entries) {
        setContainerHeight(entry.contentRect.height);
      }
    });
    observer.observe(node);
    return () => observer.disconnect();
  }, []);

  const handleActivate = useCallback((entry: VaultFileEntry) => {
    if (entry.isFolder || entry.isInternal) return;
    const fileType = resolveFileType(entry.name);
    onOpenFile(entry.id, fileType);
  }, [onOpenFile]);

  const handleToggle = useCallback((id: string, isOpen: boolean) => {
    setExpandedPaths(
      isOpen
        ? [...expandedPaths, id]
        : expandedPaths.filter(p => p !== id)
    );
  }, [expandedPaths, setExpandedPaths]);

  // External file drop handling
  const handleDragOver = useCallback((e: React.DragEvent) => {
    if (e.dataTransfer.types.includes('Files')) {
      e.preventDefault();
      e.dataTransfer.dropEffect = 'copy';
      setDragOver(true);
    }
  }, []);

  const handleDragLeave = useCallback(() => {
    setDragOver(false);
  }, []);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    const files = e.dataTransfer.files;
    if (files.length === 0) return;
    const filePaths = Array.from(files).map(f => (f as any).path).filter(Boolean);
    if (filePaths.length > 0) {
      importFiles(filePaths, rootPath);
    }
  }, [importFiles, rootPath]);

  // Context menu
  const handleContextMenu = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    // Context menu will show: New File, New Folder at root level
    // For now, use the toolbar buttons for creation
  }, []);

  return (
    <div
      className={`flex flex-col h-full select-none ${dragOver ? 'ring-2 ring-inset ring-indigo-500' : ''}`}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
      onContextMenu={handleContextMenu}
    >
      {/* Toolbar */}
      <div className="flex items-center gap-1 px-2 py-1 border-b border-zinc-700 shrink-0">
        <span className="text-[11px] font-medium text-zinc-400 uppercase tracking-wide flex-1">Explorer</span>
        <button
          onClick={() => createFile(rootPath, 'untitled.md')}
          className="p-1 text-zinc-400 hover:text-zinc-200 hover:bg-zinc-700 rounded"
          title="New File"
        >
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
            <path d="M14.5 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7.5L14.5 2z"/>
            <polyline points="14 2 14 8 20 8"/>
            <line x1="12" y1="18" x2="12" y2="12"/><line x1="9" y1="15" x2="15" y2="15"/>
          </svg>
        </button>
        <button
          onClick={() => createFolder(rootPath, 'New Folder')}
          className="p-1 text-zinc-400 hover:text-zinc-200 hover:bg-zinc-700 rounded"
          title="New Folder"
        >
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
            <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/>
            <line x1="12" y1="11" x2="12" y2="17"/><line x1="9" y1="14" x2="15" y2="14"/>
          </svg>
        </button>
        <button
          onClick={refresh}
          className="p-1 text-zinc-400 hover:text-zinc-200 hover:bg-zinc-700 rounded"
          title="Refresh"
        >
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
            <polyline points="23 4 23 10 17 10"/><path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"/>
          </svg>
        </button>
      </div>

      {/* Tree */}
      <div ref={measuredRef} className="flex-1 min-h-0 overflow-hidden">
        <VaultTree
          data={treeData}
          height={containerHeight}
          onActivate={handleActivate}
          onRename={rename}
          onMove={move}
          onDelete={deleteItem}
          expandedIds={expandedPaths}
          onToggle={handleToggle}
        />
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Create index.ts**

```typescript
// src/ui/components/vault-explorer/index.ts

export { VaultExplorer } from './VaultExplorer';
```


---

### Task 9: VaultDrawer — Layout Wrapper with Collapse/Resize

**Files:**
- Create: `src/ui/components/layout/VaultDrawer.tsx`

- [ ] **Step 1: Create VaultDrawer.tsx**

```typescript
// src/ui/components/layout/VaultDrawer.tsx

import { useCallback, useRef } from 'react';
import { VaultExplorer } from '../vault-explorer';
import { useUIStore } from '../../../graph/store/ui-store';

interface VaultDrawerProps {
  rootPath: string;
  onOpenFile: (path: string, fileType: string) => void;
}

export function VaultDrawer({ rootPath, onOpenFile }: VaultDrawerProps) {
  const isOpen = useUIStore((s) => s.vaultDrawerOpen);
  const width = useUIStore((s) => s.vaultDrawerWidth);
  const toggleDrawer = useUIStore((s) => s.toggleVaultDrawer);
  const setWidth = useUIStore((s) => s.setVaultDrawerWidth);

  const dragging = useRef(false);
  const lastX = useRef(0);

  const onPointerDown = useCallback((e: React.PointerEvent) => {
    e.preventDefault();
    dragging.current = true;
    lastX.current = e.clientX;
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
  }, []);

  const onPointerMove = useCallback((e: React.PointerEvent) => {
    if (!dragging.current) return;
    const delta = e.clientX - lastX.current;
    lastX.current = e.clientX;
    setWidth(width + delta);
  }, [width, setWidth]);

  const onPointerUp = useCallback(() => {
    dragging.current = false;
  }, []);

  if (!isOpen) {
    return (
      <div className="w-8 shrink-0 flex flex-col items-center pt-2 bg-zinc-800 border-r border-zinc-700">
        <button
          onClick={toggleDrawer}
          className="p-1.5 text-zinc-400 hover:text-zinc-200 hover:bg-zinc-700 rounded"
          title="Open Explorer"
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
            <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/>
          </svg>
        </button>
      </div>
    );
  }

  return (
    <>
      <div
        style={{ width }}
        className="shrink-0 flex flex-col min-h-0 bg-zinc-850 border-r border-zinc-700"
      >
        <VaultExplorer rootPath={rootPath} onOpenFile={onOpenFile} />
      </div>
      {/* Resize handle */}
      <div
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        className="w-1 shrink-0 cursor-col-resize bg-zinc-700 hover:bg-indigo-500 active:bg-indigo-400 transition-colors"
      />
    </>
  );
}
```


---

### Task 10: ViewerTab — Unified File Viewer

**Files:**
- Create: `src/ui/components/tabs/ViewerTab.tsx`

- [ ] **Step 1: Create ViewerTab.tsx**

A single component that extracts the extension from `filePath` and renders the appropriate viewer.

```typescript
// src/ui/components/tabs/ViewerTab.tsx

import { getExtension } from '../vault-explorer/file-type-utils';

interface ViewerTabProps {
  filePath: string;
}

const IMAGE_EXTS = new Set(['.png', '.jpg', '.jpeg', '.gif', '.webp', '.svg']);

export function ViewerTab({ filePath }: ViewerTabProps) {
  const ext = getExtension(filePath);

  if (IMAGE_EXTS.has(ext)) {
    return (
      <div className="h-full flex items-center justify-center bg-zinc-900 overflow-auto p-4">
        <img
          src={`file://${filePath}`}
          alt={filePath.split('/').pop() ?? ''}
          className="max-w-full max-h-full object-contain rounded shadow-lg"
        />
      </div>
    );
  }

  if (ext === '.pdf') {
    return (
      <div className="h-full w-full bg-zinc-900">
        <iframe
          src={`file://${filePath}`}
          className="w-full h-full border-0"
          title={filePath.split('/').pop() ?? 'PDF'}
        />
      </div>
    );
  }

  // Fallback: unsupported type message
  return (
    <div className="h-full flex items-center justify-center bg-zinc-900 text-zinc-400 text-sm">
      <span>No preview available for {ext || 'this file type'}</span>
    </div>
  );
}
```


---

### Task 11: Integrate into TabLayout and Header

**Files:**
- Modify: `src/ui/layouts/TabLayout.tsx`
- Modify: `src/ui/components/Header.tsx`

- [ ] **Step 1: Update TabLayout imports**

In `src/ui/layouts/TabLayout.tsx`, add these imports at the top:

```typescript
import { VaultDrawer } from '../components/layout/VaultDrawer';
import { ViewerTab } from '../components/tabs/ViewerTab';
import { vaultWorkspace } from '@platform';
```

- [ ] **Step 2: Add vault path state and file open handler to TabLayout**

Inside the `TabLayout` function body, after the existing state subscriptions (around line 34), add:

```typescript
const [vaultPath, setVaultPath] = useState<string | null>(null);

useEffect(() => {
  vaultWorkspace.getStatus().then((status) => {
    if (status.open && status.path) setVaultPath(status.path);
  });
}, []);

const handleOpenFile = useCallback((filePath: string, fileType: string) => {
  const fileName = filePath.split('/').pop() ?? filePath;
  if (fileType === 'note') {
    // Extract nodeId from path: {vault}/notes/{nodeId}.md
    const match = filePath.match(/notes\/([^/]+)\.md$/);
    if (match) {
      useUIStore.getState().openContentTab({ kind: 'noteEditor', noteId: match[1] }, fileName);
    }
  } else if (fileType === 'image' || fileType === 'pdf') {
    useUIStore.getState().openContentTab({ kind: 'viewer', filePath }, fileName);
  } else {
    window.electronIPC.invoke('vault-explorer:open-external', filePath);
  }
}, []);
```

Add `useState` and `useEffect` to the existing imports from React at line 1.

- [ ] **Step 3: Render VaultDrawer in the layout**

In the JSX, inside the flex container (after line 90, before `{contentColumns.map(...)`), add:

```typescript
{vaultPath && (
  <VaultDrawer rootPath={vaultPath} onOpenFile={handleOpenFile} />
)}
```

- [ ] **Step 4: Add new tab types to the rendering switch**

In `ColumnWithDropZones`, update the tab content rendering (around lines 214-222) to handle the viewer tab:

```typescript
{tab.type.kind === 'graph' ? (
  <KnowledgeGraph />
) : tab.type.kind === 'extractionReview' ? (
  <ExtractionReviewTab />
) : tab.type.kind === 'viewer' ? (
  <ViewerTab filePath={tab.type.filePath} />
) : (
  <div className="h-full overflow-y-auto bg-zinc-900">
    <NoteEditor nodeId={tab.type.noteId} isTab />
  </div>
)}
```

**Note:** Viewer tabs are automatically draggable and can be split into columns — this is handled by the existing `DragDropProvider` + `ContentTabBar` + `ColumnDropZone` system. The `openContentTab` action adds the viewer to the column's tab array, making it a first-class draggable tab. The `DragOverlay` already shows a file icon for non-graph tabs. No additional DnD code needed.

- [ ] **Step 5: Add toggle button to Header**

In `src/ui/components/Header.tsx`, add the drawer toggle. Import `toggleVaultDrawer` from the store and add a button before the existing toolbar buttons (after line 40, before the Reading List button):

```typescript
<ToolbarButton
  active={useUIStore.getState().vaultDrawerOpen}
  onClick={() => useUIStore.getState().toggleVaultDrawer()}
  title="Explorer"
>
  <FolderIcon />
</ToolbarButton>

<div className="w-px h-4 bg-zinc-600 mx-1" />
```

Add the `FolderIcon` component at the bottom of Header.tsx alongside other icons:

```typescript
const FolderIcon = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
    <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/>
  </svg>
);
```

- [ ] **Step 6: Verify full build compiles**

```bash
npm run build:electron
```

Expected: No errors.


---

### Task 12: Add vaultWorkspace Export to Electron Platform

**Files:**
- Modify: `src/platform/electron/index.ts`

- [ ] **Step 1: Check if vaultWorkspace is already exported from @platform**

Read `src/platform/electron/index.ts` and verify `vaultWorkspace` is already re-exported. If not, add:

```typescript
export { vaultWorkspace } from './vault-workspace';
```

- [ ] **Step 2: Verify build**

```bash
npm run build:electron-renderer
```

Expected: No errors.


---

### Task 13: Manual Smoke Test

**Files:** None (testing only)

- [ ] **Step 1: Build and launch**

```bash
npm run build:electron && npx electron .
```

- [ ] **Step 2: Verify drawer toggle**

Click the folder icon in the header toolbar. The drawer should slide open from the left, pushing the canvas to the right.

- [ ] **Step 3: Verify tree displays vault contents**

The tree should show the vault directory contents with folders sorted first. The `.kg/` directory should appear grayed out.

- [ ] **Step 4: Verify expand/collapse**

Click folder arrows to expand/collapse. State should persist after closing and reopening the drawer.

- [ ] **Step 5: Verify resize**

Drag the resize handle to adjust drawer width between 180px and 400px.

- [ ] **Step 6: Verify file opening**

Click a `.md` file — should open in NoteEditor tab. Click an image — should open in ViewerTab (image mode). Click a `.pdf` — should render in ViewerTab (PDF iframe).

- [ ] **Step 6b: Verify viewer tab is draggable and can split into columns**

Open an image or PDF. Drag its tab in the tab bar to reorder. Drag it to a column gap to split into a new column. Verify the viewer renders correctly in the new column.

- [ ] **Step 7: Verify rename**

Press F2 on a file, type a new name, press Enter. File should be renamed on disk.

- [ ] **Step 8: Verify drag and drop (internal)**

Drag a file from one folder to another within the tree. It should move on disk.

- [ ] **Step 9: Verify external file drop**

Drag a file from Finder into the tree panel. It should be copied into the vault root (or target folder if dropped on one).

- [ ] **Step 10: Verify create/delete**

Use toolbar buttons to create a new file and folder. Right-click or select and press Delete to send an item to trash.

---

### Task 14: Keyboard Shortcuts

**Files:**
- Modify: `src/ui/components/vault-explorer/VaultTree.tsx`

- [ ] **Step 1: Verify react-arborist built-in keyboard support**

react-arborist provides these keyboard handlers out of the box:
- Arrow keys: navigate
- Enter: activate (open file)
- F2: trigger rename
- Delete: trigger delete

Verify these work in the smoke test. If any are missing, add a `onKeyDown` handler to the Tree component's container.


---

### Task 15: Final Commit

- [ ] **Step 1: Stage all vault-explorer files and modified files**

```bash
git add package.json package-lock.json \
  electron/main.ts \
  src/graph/store/ui-store.ts \
  src/ui/components/vault-explorer/ \
  src/ui/components/layout/VaultDrawer.tsx \
  src/ui/components/tabs/ViewerTab.tsx \
  src/ui/layouts/TabLayout.tsx \
  src/ui/components/Header.tsx \
  src/platform/electron/index.ts
```

- [ ] **Step 2: Commit**

```bash
git commit -m "feat: add vault explorer drawer with filesystem tree, file CRUD, drag-and-drop, and viewer tabs"
```

---

## Completion Checklist

After all tasks pass:
- [ ] Drawer opens/closes with toggle button
- [ ] Tree shows real filesystem with lazy loading
- [ ] .kg/ is grayed out, mutations blocked
- [ ] Rename-in-place works (F2 / double-click)
- [ ] Create file/folder via toolbar
- [ ] Delete sends to OS trash
- [ ] Internal drag-and-drop moves files
- [ ] External drops copy files into vault
- [ ] .md files open in NoteEditor tab
- [ ] Images open in ImageViewerTab
- [ ] PDFs render in embedded viewer
- [ ] Other files open externally
- [ ] Expanded state persists across sessions
- [ ] Drawer width persists across sessions
- [ ] Keyboard navigation works
