# Vault Explorer — Collapsible Directory Drawer

## Overview

A collapsible left-side drawer that displays the actual filesystem contents of the vault directory as an interactive tree. Supports file/folder CRUD, expand/collapse, drag-and-drop (internal reorder + external file import), and context-dependent file opening with modular handlers.

## Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Tree source | Actual filesystem | Users see real files on disk, not a virtual projection |
| Layout mode | Push/resize canvas | Consistent with IDE conventions; no hidden content |
| Drag & drop | Internal moves + external OS drops | Full file management without leaving the app |
| File open | Context-dependent, modular handlers | Extensible per file type without touching tree code |
| Hidden files | .kg/ visible but grayed out | Transparent but discourages accidental mutation |
| Tree library | react-arborist | Purpose-built, small, virtualized, all features native |
| Encapsulation | Single directory with one public export | Library is swappable without affecting consumers |
| Loading strategy | Lazy per-directory | Matches VS Code pattern; handles large vaults |
| Delete behavior | OS trash (shell.trashItem) | Recoverable, non-destructive |
| PDF handling | Embedded Chromium PDF viewer in tab | Zero dependencies, built-in zoom/search |

## Component Architecture

### File Structure

```
src/ui/components/vault-explorer/
├── index.ts                    # Re-exports VaultExplorer
├── VaultExplorer.tsx           # Shell: toolbar + tree + external drop zone
├── VaultTree.tsx               # react-arborist wrapper (the swappable layer)
├── VaultTreeNode.tsx           # Custom node renderer (icons, gray-out logic)
├── useVaultFileSystem.ts       # Hook: lazy FS reads, CRUD, watch subscription
├── file-open-registry.ts      # File type → open action mapping
├── file-type-utils.ts         # Extension → icon/type classification
└── types.ts                   # Internal types (VaultFileEntry, etc.)
```

### Public Interface

```typescript
interface VaultExplorerProps {
  rootPath: string;
  hiddenPatterns?: string[];        // Glob patterns to gray out (e.g., [".kg/**"])
  onOpenFile: (path: string, fileType: string) => void;
  onExternalDrop?: (files: File[], targetDir: string) => void;
  width?: number;
}
```

The parent (`TabLayout`) passes callbacks; the tree never reaches outside its boundary.

### Layout Integration

```
┌─────────────────────────────────────────────────┐
│  Header / Toolbar                        [≡]    │
├──────┬──────────────────────────────────────────┤
│      │                                          │
│ Vault│   Canvas / Tabs (existing TabLayout)     │
│ Tree │                                          │
│      │                                          │
│  ⟷   │                                          │
├──────┴──────────────────────────────────────────┤
│  (ChatBot sidebar, if docked)                   │
└─────────────────────────────────────────────────┘
```

- **VaultDrawer.tsx** (`src/ui/components/layout/VaultDrawer.tsx`) — owns collapse/resize chrome
- Rendered by `TabLayout` on the left, before existing content columns
- Resize handle on right edge (min 180px, default 240px, max 400px)
- Collapsed state shows a 32px rail with toggle icon

### UI Store Additions

```typescript
// Added to existing useUIStore
vaultDrawerOpen: boolean
vaultDrawerWidth: number
vaultDrawerExpandedPaths: Set<string>
toggleVaultDrawer(): void
setVaultDrawerWidth(w: number): void
```

All three values persist to localStorage and restore on vault reopen.

## Filesystem Access

### IPC Handlers (Main Process)

```typescript
'vault:readDir'      → { dirPath: string } → VaultFileEntry[]
'vault:createFile'   → { dirPath: string, name: string } → void
'vault:createFolder' → { dirPath: string, name: string } → void
'vault:rename'       → { oldPath: string, newPath: string } → void
'vault:delete'       → { path: string } → void        // shell.trashItem
'vault:move'         → { sourcePath: string, destPath: string } → void
'vault:importFiles'  → { filePaths: string[], destDir: string } → void
```

### Loading Strategy

- **Lazy per-directory:** `readDir` returns immediate children only. Subdirectories load on expand.
- **Partial refresh:** File watcher events are coalesced (100ms debounce window), then only the affected parent directory re-reads.
- **Expanded state persistence:** Set of expanded paths stored in UI store, restored on vault open.

### useVaultFileSystem Hook

```typescript
function useVaultFileSystem(rootPath: string, hiddenPatterns: string[]) {
  return {
    treeData: VaultFileEntry[],
    createFile(dir: string, name: string): void,
    createFolder(dir: string, name: string): void,
    rename(path: string, newName: string): void,
    delete(path: string): void,
    move(sourcePath: string, destDir: string): void,
    refresh(): void,
  };
}
```

Nodes matching `hiddenPatterns` are flagged `isInternal: true` — rendered at reduced opacity, mutations blocked.

## Drag & Drop

### Internal Moves

- react-arborist's native `onMove({ dragIds, parentId, index })` triggers `vault:move` IPC
- Drop targets highlight with indigo border (accent color)
- Hovering over a collapsed folder for 500ms auto-expands it
- `.kg/` contents are not draggable
- Circular moves (folder into own descendant) rejected
- Name collisions: append ` (1)`, ` (2)` suffix

### External Drops (OS → Tree)

- HTML5 `dragenter`/`dragover`/`drop` on the VaultExplorer wrapper
- Nearest folder highlights as drop target
- Files are copied (not moved) via `vault:importFiles`
- If dropped on root area, files go to vault root

## File Open Handlers

### Registry Pattern

The registry lives inside `file-open-registry.ts` and maps extensions to `fileType` strings. When a node is clicked, the registry resolves the type and calls `props.onOpenFile(path, fileType)`. The parent (`TabLayout`) owns routing logic — deciding whether to open a tab, preview inline, or delegate to the OS. This keeps the tree component unaware of the app's tab system.

```typescript
interface FileOpenHandler {
  match: (ext: string) => boolean;
  fileType: string;   // e.g., 'note', 'image', 'pdf', 'external'
}
```

### Default Handlers

| File type | Action |
|-----------|--------|
| `.md` | Open in NoteEditor tab |
| `.png`, `.jpg`, `.gif`, `.webp`, `.svg` | ViewerTab (image mode) |
| `.pdf` | ViewerTab (PDF mode — embedded Chromium viewer) |
| Everything else | Open externally via `shell.openPath()` |

The tab system uses a single `{ kind: 'viewer', filePath: string }` content tab type. The `ViewerTab` component extracts the extension from `filePath` to determine the rendering mode.

### Rename UX

- Triggered by F2, double-click, or context menu
- Inline text input replaces node label
- Filename selected (extension excluded)
- Enter commits via `vault:rename`, Escape reverts

### PDF Viewer

Rendered as a sandboxed `<iframe>` or `<webview>` loading the file via `file://` URL. Chromium's built-in PDF viewer provides zoom, page nav, and text search with zero extra dependencies. Lives in a `PdfViewerTab` component rendered by the tab system.

## Context Menu

Right-click on a node shows:

- **File:** Open, Rename, Delete, Copy Path
- **Folder:** New File, New Folder, Rename, Delete, Copy Path
- **Internal (.kg/):** Copy Path only (mutations blocked)

## Keyboard Shortcuts

| Key | Action |
|-----|--------|
| Enter | Open selected file |
| F2 | Rename selected item |
| Delete/Backspace | Delete selected item (to trash) |
| Arrow keys | Navigate tree |
| Right arrow | Expand folder / move into |
| Left arrow | Collapse folder / move to parent |

## Dependencies

- `react-arborist` — tree rendering, virtualization, DnD, rename-in-place
- `react-window` (peer dep of react-arborist) — virtual list
- `@dnd-kit/react` — already in project, not used here (react-arborist has its own DnD)
