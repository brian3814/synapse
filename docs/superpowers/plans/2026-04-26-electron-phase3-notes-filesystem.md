# Electron Phase 3: Notes Filesystem Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Abstract the note filesystem behind a `NoteStore` strategy interface so Chrome uses OPFS and Electron uses Node.js `fs` via IPC, enabling note persistence in the desktop app.

**Architecture:** `NoteStore` interface with two implementations (`OpfsNoteStore`, `FsNoteStore`). A factory picks the implementation at init time. The `FsNoteStore` calls through Electron IPC to a main-process backend that reads/writes `.md` files in a vault directory. All 7 import sites switch from `opfs-note-store` to the new `note-store` module.

**Tech Stack:** Electron IPC, Node.js fs

---

### Task 1: Create NoteStore interface and factory

**Files:**
- Create: `src/notes/note-store.ts`

- [ ] **Step 1: Create `src/notes/note-store.ts`**

```typescript
export interface NoteStore {
  init(): Promise<void>;
  read(nodeId: string): Promise<string | null>;
  write(nodeId: string, markdown: string): Promise<void>;
  remove(nodeId: string): Promise<void>;
  list(): Promise<string[]>;
  exists(nodeId: string): Promise<boolean>;
}

let store: NoteStore | null = null;

export function getNoteStore(): NoteStore {
  if (!store) throw new Error('Note store not initialized — call initNoteStore() first');
  return store;
}

export async function initNoteStore(): Promise<void> {
  if (store) return;

  if ((window as any).electronNotes) {
    const { FsNoteStore } = await import('./fs-note-store');
    store = new FsNoteStore();
  } else {
    const { OpfsNoteStore } = await import('./opfs-note-store');
    store = new OpfsNoteStore();
  }

  await store.init();
}

export const read = (nodeId: string) => getNoteStore().read(nodeId);
export const write = (nodeId: string, markdown: string) => getNoteStore().write(nodeId, markdown);
export const remove = (nodeId: string) => getNoteStore().remove(nodeId);
export const list = () => getNoteStore().list();
export const exists = (nodeId: string) => getNoteStore().exists(nodeId);
```

The convenience re-exports (`read`, `write`, `remove`, `list`, `exists`) mean import sites only need to change their `from` path — the imported names stay the same.

- [ ] **Step 2: Commit**

```bash
git add src/notes/note-store.ts
git commit -m "feat(notes): add NoteStore interface with strategy pattern factory"
```

---

### Task 2: Refactor opfs-note-store to class

**Files:**
- Modify: `src/notes/opfs-note-store.ts`

Convert the existing standalone functions into an `OpfsNoteStore` class implementing `NoteStore`.

- [ ] **Step 1: Replace `src/notes/opfs-note-store.ts` contents**

Read the file first. Replace with:

```typescript
import type { NoteStore } from './note-store';

export class OpfsNoteStore implements NoteStore {
  private notesDir: FileSystemDirectoryHandle | null = null;

  async init(): Promise<void> {
    if (this.notesDir) return;
    const root = await navigator.storage.getDirectory();
    this.notesDir = await root.getDirectoryHandle('notes', { create: true });
  }

  private dir(): FileSystemDirectoryHandle {
    if (!this.notesDir) throw new Error('[OPFS] Note store not initialised — call init() first');
    return this.notesDir;
  }

  async write(nodeId: string, markdown: string): Promise<void> {
    const handle = await this.dir().getFileHandle(`${nodeId}.md`, { create: true });
    const writable = await handle.createWritable();
    await writable.write(markdown);
    await writable.close();
  }

  async read(nodeId: string): Promise<string | null> {
    try {
      const handle = await this.dir().getFileHandle(`${nodeId}.md`);
      const file = await handle.getFile();
      return await file.text();
    } catch (e: unknown) {
      if (e instanceof DOMException && e.name === 'NotFoundError') return null;
      throw e;
    }
  }

  async remove(nodeId: string): Promise<void> {
    try {
      await this.dir().removeEntry(`${nodeId}.md`);
    } catch (e: unknown) {
      if (e instanceof DOMException && e.name === 'NotFoundError') return;
      throw e;
    }
  }

  async list(): Promise<string[]> {
    const ids: string[] = [];
    for await (const [name] of (this.dir() as any).entries()) {
      if (typeof name === 'string' && name.endsWith('.md')) {
        ids.push(name.slice(0, -3));
      }
    }
    return ids;
  }

  async exists(nodeId: string): Promise<boolean> {
    try {
      await this.dir().getFileHandle(`${nodeId}.md`);
      return true;
    } catch {
      return false;
    }
  }
}
```

- [ ] **Step 2: Commit**

```bash
git add src/notes/opfs-note-store.ts
git commit -m "refactor(notes): convert opfs-note-store to class implementing NoteStore"
```

---

### Task 3: Create FsNoteStore + Electron backend + IPC

**Files:**
- Create: `src/notes/fs-note-store.ts`
- Create: `electron/notes-backend.ts`
- Modify: `electron/main.ts`
- Modify: `electron/preload.ts`

- [ ] **Step 1: Create `src/notes/fs-note-store.ts`**

```typescript
import type { NoteStore } from './note-store';

export class FsNoteStore implements NoteStore {
  private api = (window as any).electronNotes as {
    init: () => Promise<void>;
    read: (nodeId: string) => Promise<string | null>;
    write: (nodeId: string, markdown: string) => Promise<void>;
    remove: (nodeId: string) => Promise<void>;
    list: () => Promise<string[]>;
    exists: (nodeId: string) => Promise<boolean>;
  };

  async init(): Promise<void> {
    await this.api.init();
  }

  read(nodeId: string): Promise<string | null> {
    return this.api.read(nodeId);
  }

  write(nodeId: string, markdown: string): Promise<void> {
    return this.api.write(nodeId, markdown);
  }

  remove(nodeId: string): Promise<void> {
    return this.api.remove(nodeId);
  }

  list(): Promise<string[]> {
    return this.api.list();
  }

  exists(nodeId: string): Promise<boolean> {
    return this.api.exists(nodeId);
  }
}
```

- [ ] **Step 2: Create `electron/notes-backend.ts`**

```typescript
import { app } from 'electron';
import { join } from 'path';
import {
  readFileSync,
  writeFileSync,
  unlinkSync,
  readdirSync,
  existsSync,
  mkdirSync,
} from 'fs';

const NOTES_DIR = join(app.getPath('userData'), 'notes');

export function initNotesDir(): void {
  if (!existsSync(NOTES_DIR)) mkdirSync(NOTES_DIR, { recursive: true });
}

export function readNote(nodeId: string): string | null {
  const filePath = join(NOTES_DIR, `${nodeId}.md`);
  if (!existsSync(filePath)) return null;
  return readFileSync(filePath, 'utf-8');
}

export function writeNote(nodeId: string, markdown: string): void {
  initNotesDir();
  writeFileSync(join(NOTES_DIR, `${nodeId}.md`), markdown, 'utf-8');
}

export function removeNote(nodeId: string): void {
  const filePath = join(NOTES_DIR, `${nodeId}.md`);
  if (existsSync(filePath)) unlinkSync(filePath);
}

export function listNotes(): string[] {
  initNotesDir();
  return readdirSync(NOTES_DIR)
    .filter((f) => f.endsWith('.md'))
    .map((f) => f.slice(0, -3));
}

export function noteExists(nodeId: string): boolean {
  return existsSync(join(NOTES_DIR, `${nodeId}.md`));
}
```

- [ ] **Step 3: Modify `electron/main.ts` — add notes IPC handlers**

Read the file first. Add import at the top (after existing imports):

```typescript
import * as notesBackend from './notes-backend';
```

Inside `app.whenReady().then(() => {`, after the `db:request` IPC handler and before `createWindow()`, add:

```typescript
  ipcMain.handle('notes:init', () => {
    notesBackend.initNotesDir();
  });

  ipcMain.handle('notes:read', (_event, nodeId: string) => {
    return notesBackend.readNote(nodeId);
  });

  ipcMain.handle('notes:write', (_event, nodeId: string, markdown: string) => {
    notesBackend.writeNote(nodeId, markdown);
  });

  ipcMain.handle('notes:remove', (_event, nodeId: string) => {
    notesBackend.removeNote(nodeId);
  });

  ipcMain.handle('notes:list', () => {
    return notesBackend.listNotes();
  });

  ipcMain.handle('notes:exists', (_event, nodeId: string) => {
    return notesBackend.noteExists(nodeId);
  });
```

- [ ] **Step 4: Modify `electron/preload.ts` — expose electronNotes API**

Read the file first. Add a new `contextBridge.exposeInMainWorld` block after the existing `electronDB` block:

```typescript
contextBridge.exposeInMainWorld('electronNotes', {
  init: () => ipcRenderer.invoke('notes:init'),
  read: (nodeId: string) => ipcRenderer.invoke('notes:read', nodeId),
  write: (nodeId: string, markdown: string) => ipcRenderer.invoke('notes:write', nodeId, markdown),
  remove: (nodeId: string) => ipcRenderer.invoke('notes:remove', nodeId),
  list: () => ipcRenderer.invoke('notes:list'),
  exists: (nodeId: string) => ipcRenderer.invoke('notes:exists', nodeId),
});
```

- [ ] **Step 5: Commit**

```bash
git add src/notes/fs-note-store.ts electron/notes-backend.ts electron/main.ts electron/preload.ts
git commit -m "feat(notes): add FsNoteStore with Electron IPC backend for vault directory"
```

---

### Task 4: Update all import sites

**Files:**
- Modify: `src/db/client/db-hooks.ts`
- Modify: `src/ui/components/notes/NoteEditor.tsx`
- Modify: `src/ui/components/panels/MultiSelectPanel.tsx`
- Modify: `src/ui/hooks/useLLMExtraction.ts`
- Modify: `src/ui/hooks/rag-pipeline.ts`
- Modify: `src/ui/hooks/chat-agent-loop.ts`
- Modify: `src/graph/store/graph-store.ts`

Change every import from `opfs-note-store` to `note-store`. The imported function names stay the same (`read`, `write`, `remove`, `init`).

- [ ] **Step 1: Update `src/db/client/db-hooks.ts`**

Read first. Change:
```typescript
import { init as initNoteStore } from '../../notes/opfs-note-store';
```
To:
```typescript
import { initNoteStore } from '../../notes/note-store';
```

Also remove the Electron skip guard added in Phase 2. The `initNoteStore()` in `note-store.ts` already handles platform detection. Change the useEffect back to the simple chain:

```typescript
    initDbClient()
      .then(() => initNoteStore())
      .then(() => setReady(true))
```

- [ ] **Step 2: Update `src/ui/components/notes/NoteEditor.tsx`**

Change:
```typescript
import { read as readNote, write as writeNote } from '../../../notes/opfs-note-store';
```
To:
```typescript
import { read as readNote, write as writeNote } from '../../../notes/note-store';
```

- [ ] **Step 3: Update `src/ui/components/panels/MultiSelectPanel.tsx`**

Change:
```typescript
import { write as writeNote } from '../../../notes/opfs-note-store';
```
To:
```typescript
import { write as writeNote } from '../../../notes/note-store';
```

- [ ] **Step 4: Update `src/ui/hooks/useLLMExtraction.ts`**

Change:
```typescript
import { write as writeNote } from '../../notes/opfs-note-store';
```
To:
```typescript
import { write as writeNote } from '../../notes/note-store';
```

- [ ] **Step 5: Update `src/ui/hooks/rag-pipeline.ts`**

Change:
```typescript
import { read as readNote } from '../../notes/opfs-note-store';
```
To:
```typescript
import { read as readNote } from '../../notes/note-store';
```

- [ ] **Step 6: Update `src/ui/hooks/chat-agent-loop.ts`**

Change:
```typescript
import { read as readNote } from '../../notes/opfs-note-store';
```
To:
```typescript
import { read as readNote } from '../../notes/note-store';
```

- [ ] **Step 7: Update `src/graph/store/graph-store.ts`**

Change:
```typescript
import { remove as removeNoteFile } from '../../notes/opfs-note-store';
```
To:
```typescript
import { remove as removeNoteFile } from '../../notes/note-store';
```

- [ ] **Step 8: Verify Chrome extension builds**

```bash
npm run build
```

Expected: Build succeeds.

- [ ] **Step 9: Commit**

```bash
git add src/db/client/db-hooks.ts src/ui/components/notes/NoteEditor.tsx src/ui/components/panels/MultiSelectPanel.tsx src/ui/hooks/useLLMExtraction.ts src/ui/hooks/rag-pipeline.ts src/ui/hooks/chat-agent-loop.ts src/graph/store/graph-store.ts
git commit -m "refactor(notes): update all imports to use note-store strategy pattern"
```

---

### Task 5: Build and verify

**Files:** None (verification only)

- [ ] **Step 1: Build Electron**

```bash
npm run build:electron
```

Expected: No errors.

- [ ] **Step 2: Launch and verify note persistence**

```bash
ELECTRON_ENABLE_LOGGING=1 npx electron . --enable-logging 2>&1 | head -25
```

Expected: No note store errors. DB initializes with better-sqlite3, note store initializes via FsNoteStore.

Launch the app (`npm run dev:electron`), create a note, close, relaunch — note should persist.

- [ ] **Step 3: Verify vault files**

```bash
ls ~/Library/Application\ Support/kg-extension/notes/
```

Expected: `.md` files for any notes created.

- [ ] **Step 4: Verify Chrome extension**

```bash
npm run build
```

Expected: Build succeeds. Load in Chrome, create/edit notes — OPFS path works.

- [ ] **Step 5: Commit (if fixes needed)**

```bash
git add -A
git commit -m "fix(notes): adjustments from Phase 3 verification"
```

---

## Phase 3 success criteria

1. `npm run build:electron` completes without errors
2. Notes persist across Electron app restarts
3. `.md` files appear in `~/Library/Application Support/kg-extension/notes/`
4. Chrome extension notes still work via OPFS
5. `note_content_updated` BroadcastChannel sync events still fire
6. `npm run build` (Chrome extension) passes
