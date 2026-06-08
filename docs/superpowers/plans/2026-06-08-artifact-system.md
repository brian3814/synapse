# Artifact System Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an artifact system to Synapse so LLM-generated content (React dashboards, markdown docs, HTML pages, SVG graphics, Mermaid diagrams) can be persisted, browsed, and rendered in dedicated tabs with a sandboxed JSX runtime.

**Architecture:** Tool-call-based generation (`create_artifact`/`update_artifact`) → files on disk (`.kg/artifacts/{sessionDir}/{slug}.ext` + sidecar `.meta.json`) → SQLite metadata + FTS5 for search → file watcher sync → Zustand store → UI (chat card, side panel, content tab with Preview/Source toggle). JSX rendering uses a sandboxed iframe with Sucrase + pre-bundled React/Recharts/D3/Tailwind via postMessage.

**Tech Stack:** TypeScript, React 19, Zustand, SQLite (wa-sqlite), FTS5, Sucrase, CodeMirror 6, Recharts, D3, Tailwind CSS, Electron IPC, postMessage iframe sandbox

**Spec:** `docs/superpowers/specs/2026-06-08-artifact-system-design.md`

**No test framework is configured** — verification is build checks (`npm run build:electron`) and manual testing (`npx electron .`).

---

## File Map

### New files

| File | Purpose |
|---|---|
| `src/shared/artifact-types.ts` | `ArtifactType`, `ArtifactMeta`, `ArtifactRecord` type definitions |
| `src/db/worker/migrations/007-artifacts.ts` | `artifacts` table + `artifacts_fts` FTS5 virtual table |
| `src/db/worker/queries/artifact-queries.ts` | SQL query functions for artifact CRUD + FTS search |
| `electron/main/artifact-handlers.ts` | IPC handlers for artifact file I/O + SQLite operations |
| `src/platform/electron/artifacts.ts` | `ElectronArtifacts` class implementing `PlatformArtifacts` |
| `src/graph/store/artifact-store.ts` | Zustand store: artifact list, CRUD, search, file watcher subscription |
| `src/commands/tools/artifact-tools.ts` | `ToolModule` with `create_artifact` + `update_artifact` |
| `src/ui/components/chat/ArtifactCard.tsx` | Compact card rendered in chat for artifact tool results |
| `src/ui/components/sidebar/ArtifactPanel.tsx` | Left sidebar: search, type filter chips, artifact list |
| `src/ui/components/tabs/ArtifactTab.tsx` | Content tab: toolbar, Preview/Source toggle, renderer routing |
| `src/ui/components/artifacts/JsxRenderer.tsx` | Sandboxed iframe + postMessage bridge for JSX |
| `src/ui/components/artifacts/HtmlRenderer.tsx` | Sandboxed iframe for raw HTML |
| `src/ui/components/artifacts/SvgRenderer.tsx` | Blob URL `<img>` renderer |
| `src/ui/components/artifacts/MermaidRenderer.tsx` | mermaid.js renderer |
| `src/ui/components/artifacts/ArtifactEditor.tsx` | CodeMirror 6 editor wrapper for Source mode |
| `electron/sandbox/artifact-renderer.html` | Static sandbox HTML with pre-bundled libs |

### Modified files

| File | Change |
|---|---|
| `src/platform/types.ts` | Add `PlatformArtifacts` interface |
| `src/platform/electron/index.ts` | Export `artifacts` instance, call `artifacts.init()` |
| `src/db/worker/migrations/index.ts` | Register migration 007 |
| `src/db/worker/queries/index.ts` | Export artifact query functions |
| `src/commands/tools/index.ts` | Register `artifactTools` in `ALL_MODULES` |
| `src/graph/store/ui-store.ts` | Add `'artifact'` ContentTabType, `'artifacts'` to LeftPanel |
| `src/ui/components/layout/ActivityBar.tsx` | Add artifacts icon |
| `src/ui/layouts/TabLayout.tsx` | Route `artifact` tab type to `ArtifactTab` |
| `src/ui/components/chat/ChatMessage.tsx` | Detect artifact tool results, render `ArtifactCard` |
| `electron/main.ts` | Register artifact IPC handlers |
| `electron/vault/file-watcher.ts` | Add artifact directory watching |
| `package.json` | Add `codemirror`, `@codemirror/lang-javascript`, `@codemirror/lang-html`, `@codemirror/lang-markdown`, `mermaid` deps |
| `vite.config.electron-renderer.ts` | Ensure sandbox assets are copied to dist |

---

## Phase 1: Foundation (Types, DB, IPC, Platform)

### Task 1: Type Definitions

**Files:**
- Create: `src/shared/artifact-types.ts`

- [ ] **Step 1: Create artifact type definitions**

```typescript
// src/shared/artifact-types.ts

export type ArtifactType = 'jsx' | 'markdown' | 'html' | 'svg' | 'mermaid';

export const ARTIFACT_EXTENSIONS: Record<ArtifactType, string> = {
  jsx: '.jsx',
  markdown: '.md',
  html: '.html',
  svg: '.svg',
  mermaid: '.mmd',
};

export const ARTIFACT_TYPE_LABELS: Record<ArtifactType, string> = {
  jsx: 'React Component',
  markdown: 'Markdown',
  html: 'HTML',
  svg: 'SVG',
  mermaid: 'Mermaid Diagram',
};

export interface ArtifactMeta {
  id: string;
  title: string;
  type: ArtifactType;
  sessionId: string;
  sessionDir: string;
  createdAt: string;
  updatedAt: string;
}

export interface ArtifactRecord extends ArtifactMeta {
  fileName: string;
}

export function slugify(text: string, maxLength = 50): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, maxLength)
    .replace(/-$/, '');
}
```

- [ ] **Step 2: Verify build**

Run: `npm run build:electron-renderer`
Expected: No type errors.

- [ ] **Step 3: Commit**

```bash
git add src/shared/artifact-types.ts
git commit -m "feat(artifacts): add type definitions"
```

---

### Task 2: Database Migration

**Files:**
- Create: `src/db/worker/migrations/007-artifacts.ts`
- Modify: `src/db/worker/migrations/index.ts`

Check the current migration count first — the latest migration file determines the version number. Use the next sequential number.

- [ ] **Step 1: Check current migration count**

Run: `ls src/db/worker/migrations/` and note the highest numbered file. Use `N+1` for the new migration. The plan uses `007` as a placeholder — adjust to the actual next number.

- [ ] **Step 2: Create artifacts migration**

```typescript
// src/db/worker/migrations/007-artifacts.ts

export const version = 7;  // Adjust to actual next version
export const description = 'Artifact storage metadata and FTS search';

export const up = `
CREATE TABLE IF NOT EXISTS artifacts (
    id          TEXT PRIMARY KEY,
    title       TEXT NOT NULL,
    type        TEXT NOT NULL,
    session_id  TEXT,
    session_dir TEXT NOT NULL,
    file_name   TEXT NOT NULL,
    created_at  TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at  TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_artifacts_session ON artifacts(session_id);
CREATE INDEX IF NOT EXISTS idx_artifacts_type ON artifacts(type);
CREATE INDEX IF NOT EXISTS idx_artifacts_updated ON artifacts(updated_at DESC);

CREATE VIRTUAL TABLE IF NOT EXISTS artifacts_fts USING fts5(
    id UNINDEXED,
    title,
    text_content,
    tokenize='unicode61'
);
`;
```

- [ ] **Step 3: Register migration**

In `src/db/worker/migrations/index.ts`, import and add to the migrations array following the existing pattern. Find the `migrations` array export and append the new migration.

- [ ] **Step 4: Verify build**

Run: `npm run build:electron`
Expected: No errors.

- [ ] **Step 5: Commit**

```bash
git add src/db/worker/migrations/007-artifacts.ts src/db/worker/migrations/index.ts
git commit -m "feat(artifacts): add database migration for artifacts table + FTS5"
```

---

### Task 3: Database Query Functions

**Files:**
- Create: `src/db/worker/queries/artifact-queries.ts`
- Modify: `src/db/worker/queries/index.ts` (or wherever queries are registered)

Study how existing query files (e.g., `chat-queries.ts`) are structured — they export functions that take a db handle and return results.

- [ ] **Step 1: Create artifact query functions**

```typescript
// src/db/worker/queries/artifact-queries.ts

import type { ArtifactRecord, ArtifactType } from '../../../shared/artifact-types';

export interface ArtifactRow {
  id: string;
  title: string;
  type: string;
  session_id: string | null;
  session_dir: string;
  file_name: string;
  created_at: string;
  updated_at: string;
}

function rowToRecord(row: ArtifactRow): ArtifactRecord {
  return {
    id: row.id,
    title: row.title,
    type: row.type as ArtifactType,
    sessionId: row.session_id ?? '',
    sessionDir: row.session_dir,
    fileName: row.file_name,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function listArtifacts(db: any): ArtifactRecord[] {
  const rows = db.exec('SELECT * FROM artifacts ORDER BY updated_at DESC') as ArtifactRow[];
  return rows.map(rowToRecord);
}

export function getArtifact(db: any, id: string): ArtifactRecord | null {
  const rows = db.exec('SELECT * FROM artifacts WHERE id = ?', [id]) as ArtifactRow[];
  return rows.length > 0 ? rowToRecord(rows[0]) : null;
}

export function insertArtifact(db: any, record: ArtifactRecord): void {
  db.exec(
    `INSERT INTO artifacts (id, title, type, session_id, session_dir, file_name, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [record.id, record.title, record.type, record.sessionId, record.sessionDir, record.fileName, record.createdAt, record.updatedAt],
  );
  db.exec(
    `INSERT INTO artifacts_fts (id, title, text_content) VALUES (?, ?, ?)`,
    [record.id, record.title, ''],
  );
}

export function updateArtifactMeta(db: any, id: string, title: string, updatedAt: string): void {
  db.exec('UPDATE artifacts SET title = ?, updated_at = ? WHERE id = ?', [title, updatedAt, id]);
  db.exec('UPDATE artifacts_fts SET title = ? WHERE id = ?', [title, id]);
}

export function updateArtifactFtsContent(db: any, id: string, textContent: string): void {
  db.exec('UPDATE artifacts_fts SET text_content = ? WHERE id = ?', [textContent, id]);
}

export function deleteArtifact(db: any, id: string): void {
  db.exec('DELETE FROM artifacts WHERE id = ?', [id]);
  db.exec('DELETE FROM artifacts_fts WHERE id = ?', [id]);
}

export function searchArtifacts(db: any, query: string): ArtifactRecord[] {
  if (!query.trim()) return listArtifacts(db);
  const sanitized = query.replace(/['"]/g, '').trim();
  if (!sanitized) return listArtifacts(db);
  const rows = db.exec(
    `SELECT a.* FROM artifacts a
     JOIN artifacts_fts f ON a.id = f.id
     WHERE artifacts_fts MATCH ?
     ORDER BY rank`,
    [sanitized + '*'],
  ) as ArtifactRow[];
  return rows.map(rowToRecord);
}
```

Note: The exact `db.exec` API depends on how the existing query files call SQLite. Study `chat-queries.ts` and match the pattern exactly (it may be `db.selectAll()`, `db.run()`, or a wrapper). Adapt the function calls above to match.

- [ ] **Step 2: Register queries**

Export the query functions from wherever the existing queries are aggregated (check `src/db/worker/queries/index.ts` or similar). Follow the existing export pattern.

- [ ] **Step 3: Verify build**

Run: `npm run build:electron`
Expected: No errors.

- [ ] **Step 4: Commit**

```bash
git add src/db/worker/queries/artifact-queries.ts src/db/worker/queries/index.ts
git commit -m "feat(artifacts): add database query functions"
```

---

### Task 4: IPC Handlers (Electron Main Process)

**Files:**
- Create: `electron/main/artifact-handlers.ts`
- Modify: `electron/main.ts`

This is the most critical file — it handles file I/O, SQLite writes, and slug resolution. Study `electron/main.ts` to see how the database handle is accessed and how other IPC handlers are structured.

- [ ] **Step 1: Create artifact IPC handlers**

```typescript
// electron/main/artifact-handlers.ts

import { ipcMain, BrowserWindow } from 'electron';
import { existsSync, mkdirSync, writeFileSync, readFileSync, unlinkSync, readdirSync, statSync } from 'fs';
import path from 'path';
import crypto from 'crypto';
import type { ArtifactType, ArtifactRecord, ArtifactMeta } from '../../src/shared/artifact-types';
import { slugify, ARTIFACT_EXTENSIONS } from '../../src/shared/artifact-types';

let vaultPath: string | null = null;
let dbHandle: any = null;

export function initArtifactHandlers(vault: string, db: any): void {
  vaultPath = vault;
  dbHandle = db;
}

function artifactsDir(): string {
  const dir = path.join(vaultPath!, '.kg', 'artifacts');
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  return dir;
}

function resolveSessionDir(sessionId: string, sessionTitle: string, sessionCreatedAt: string): string {
  const date = sessionCreatedAt.slice(0, 10);
  const titleSlug = slugify(sessionTitle || 'untitled');
  const base = `${date}-${titleSlug}`;
  const root = artifactsDir();

  let candidate = base;
  let i = 2;
  while (existsSync(path.join(root, candidate))) {
    const existingMetas = readdirSync(path.join(root, candidate)).filter(f => f.endsWith('.meta.json'));
    if (existingMetas.length > 0) {
      const firstMeta = JSON.parse(readFileSync(path.join(root, candidate, existingMetas[0]), 'utf-8')) as ArtifactMeta;
      if (firstMeta.sessionId === sessionId) return candidate;
    }
    candidate = `${base}-${i}`;
    i++;
  }
  return candidate;
}

function resolveFileName(dir: string, title: string, type: ArtifactType): string {
  const base = slugify(title);
  const ext = ARTIFACT_EXTENSIONS[type].slice(1);
  let candidate = `${base}.${ext}`;
  let i = 2;
  while (existsSync(path.join(dir, candidate))) {
    candidate = `${base}-${i}.${ext}`;
    i++;
  }
  return candidate;
}

function broadcastChange(artifact: ArtifactRecord): void {
  for (const win of BrowserWindow.getAllWindows()) {
    win.webContents.send('artifacts:changed', artifact);
  }
}

export function registerArtifactIPC(): void {
  ipcMain.handle('artifacts:list', async () => {
    // Query function — adapt to actual DB API
    const rows = dbHandle.exec('SELECT * FROM artifacts ORDER BY updated_at DESC');
    return rows.map(rowToRecord);
  });

  ipcMain.handle('artifacts:get', async (_event, id: string) => {
    const rows = dbHandle.exec('SELECT * FROM artifacts WHERE id = ?', [id]);
    return rows.length > 0 ? rowToRecord(rows[0]) : null;
  });

  ipcMain.handle('artifacts:getContent', async (_event, id: string) => {
    const rows = dbHandle.exec('SELECT * FROM artifacts WHERE id = ?', [id]);
    if (rows.length === 0) throw new Error(`Artifact not found: ${id}`);
    const record = rowToRecord(rows[0]);
    const filePath = path.join(artifactsDir(), record.sessionDir, record.fileName);
    return readFileSync(filePath, 'utf-8');
  });

  ipcMain.handle('artifacts:create', async (_event, params: {
    type: ArtifactType;
    title: string;
    content: string;
    sessionId: string;
    sessionTitle: string;
    sessionCreatedAt: string;
  }) => {
    const id = crypto.randomUUID();
    const now = new Date().toISOString();

    const sessionDir = resolveSessionDir(params.sessionId, params.sessionTitle, params.sessionCreatedAt);
    const fullSessionDir = path.join(artifactsDir(), sessionDir);
    if (!existsSync(fullSessionDir)) mkdirSync(fullSessionDir, { recursive: true });

    const fileName = resolveFileName(fullSessionDir, params.title, params.type);

    writeFileSync(path.join(fullSessionDir, fileName), params.content, 'utf-8');

    const meta: ArtifactMeta = {
      id,
      title: params.title,
      type: params.type,
      sessionId: params.sessionId,
      sessionDir,
      createdAt: now,
      updatedAt: now,
    };
    writeFileSync(
      path.join(fullSessionDir, fileName.replace(/\.[^.]+$/, '.meta.json')),
      JSON.stringify(meta, null, 2),
      'utf-8',
    );

    const record: ArtifactRecord = { ...meta, fileName };

    dbHandle.exec(
      `INSERT INTO artifacts (id, title, type, session_id, session_dir, file_name, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [id, params.title, params.type, params.sessionId, sessionDir, fileName, now, now],
    );
    dbHandle.exec(
      'INSERT INTO artifacts_fts (id, title, text_content) VALUES (?, ?, ?)',
      [id, params.title, extractTextContent(params.type, params.content)],
    );

    broadcastChange(record);
    return record;
  });

  ipcMain.handle('artifacts:update', async (_event, params: {
    id: string;
    content: string;
    title?: string;
  }) => {
    const rows = dbHandle.exec('SELECT * FROM artifacts WHERE id = ?', [params.id]);
    if (rows.length === 0) throw new Error(`Artifact not found: ${params.id}`);
    const existing = rowToRecord(rows[0]);

    const now = new Date().toISOString();
    const title = params.title ?? existing.title;
    const filePath = path.join(artifactsDir(), existing.sessionDir, existing.fileName);

    writeFileSync(filePath, params.content, 'utf-8');

    const metaPath = filePath.replace(/\.[^.]+$/, '.meta.json');
    const meta: ArtifactMeta = {
      id: existing.id,
      title,
      type: existing.type,
      sessionId: existing.sessionId,
      sessionDir: existing.sessionDir,
      createdAt: existing.createdAt,
      updatedAt: now,
    };
    writeFileSync(metaPath, JSON.stringify(meta, null, 2), 'utf-8');

    dbHandle.exec('UPDATE artifacts SET title = ?, updated_at = ? WHERE id = ?', [title, now, params.id]);
    dbHandle.exec('UPDATE artifacts_fts SET title = ?, text_content = ? WHERE id = ?', [title, extractTextContent(existing.type, params.content), params.id]);

    const record: ArtifactRecord = { ...meta, fileName: existing.fileName };
    broadcastChange(record);
    return record;
  });

  ipcMain.handle('artifacts:delete', async (_event, id: string) => {
    const rows = dbHandle.exec('SELECT * FROM artifacts WHERE id = ?', [id]);
    if (rows.length === 0) return;
    const record = rowToRecord(rows[0]);
    const dir = path.join(artifactsDir(), record.sessionDir);
    const contentPath = path.join(dir, record.fileName);
    const metaPath = contentPath.replace(/\.[^.]+$/, '.meta.json');

    if (existsSync(contentPath)) unlinkSync(contentPath);
    if (existsSync(metaPath)) unlinkSync(metaPath);

    dbHandle.exec('DELETE FROM artifacts WHERE id = ?', [id]);
    dbHandle.exec('DELETE FROM artifacts_fts WHERE id = ?', [id]);
  });

  ipcMain.handle('artifacts:search', async (_event, query: string) => {
    if (!query.trim()) {
      const rows = dbHandle.exec('SELECT * FROM artifacts ORDER BY updated_at DESC');
      return rows.map(rowToRecord);
    }
    const sanitized = query.replace(/['"]/g, '').trim();
    if (!sanitized) {
      const rows = dbHandle.exec('SELECT * FROM artifacts ORDER BY updated_at DESC');
      return rows.map(rowToRecord);
    }
    const rows = dbHandle.exec(
      `SELECT a.* FROM artifacts a
       JOIN artifacts_fts f ON a.id = f.id
       WHERE artifacts_fts MATCH ?
       ORDER BY rank`,
      [sanitized + '*'],
    );
    return rows.map(rowToRecord);
  });
}

function rowToRecord(row: any): ArtifactRecord {
  return {
    id: row.id,
    title: row.title,
    type: row.type as ArtifactType,
    sessionId: row.session_id ?? '',
    sessionDir: row.session_dir,
    fileName: row.file_name,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function extractTextContent(type: ArtifactType, content: string): string {
  switch (type) {
    case 'html':
      return content.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
    case 'svg':
      const textMatches = content.match(/<text[^>]*>([^<]*)<\/text>/g) || [];
      return textMatches.map(m => m.replace(/<[^>]*>/g, '')).join(' ');
    case 'jsx':
      return content
        .replace(/import\s+.*?from\s+['"].*?['"]/g, '')
        .replace(/<[^>]*>/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
    case 'markdown':
    case 'mermaid':
    default:
      return content;
  }
}
```

**Important:** The `dbHandle.exec()` calls above are placeholders. Study `electron/main.ts` to find the actual database API (it may be `db.all()`, `db.run()`, `db.prepare().all()`, or use the `dbHandleAction` pattern). Adapt every `dbHandle.exec()` call to match the real API.

- [ ] **Step 2: Register handlers in main.ts**

In `electron/main.ts`, import and call the registration function. Find where other IPC handlers are registered (look for `ipcMain.handle` blocks) and add nearby:

```typescript
import { initArtifactHandlers, registerArtifactIPC } from './main/artifact-handlers';

// After vault is opened and DB is ready:
initArtifactHandlers(vaultPath, dbHandle);
registerArtifactIPC();
```

Find the exact location by searching for where the vault path and DB handle are available (likely in the vault-open flow).

- [ ] **Step 3: Verify build**

Run: `npm run build:electron`
Expected: No errors.

- [ ] **Step 4: Commit**

```bash
git add electron/main/artifact-handlers.ts electron/main.ts
git commit -m "feat(artifacts): add IPC handlers for artifact CRUD"
```

---

### Task 5: Platform Interface + Electron Implementation

**Files:**
- Modify: `src/platform/types.ts`
- Create: `src/platform/electron/artifacts.ts`
- Modify: `src/platform/electron/index.ts`

- [ ] **Step 1: Add PlatformArtifacts interface to types.ts**

Find the end of the existing interfaces in `src/platform/types.ts` and add:

```typescript
export interface PlatformArtifacts {
  list(): Promise<ArtifactRecord[]>;
  get(id: string): Promise<ArtifactRecord | null>;
  getContent(id: string): Promise<string>;
  create(params: {
    type: ArtifactType;
    title: string;
    content: string;
    sessionId: string;
    sessionTitle: string;
    sessionCreatedAt: string;
  }): Promise<ArtifactRecord>;
  update(id: string, content: string, title?: string): Promise<ArtifactRecord>;
  delete(id: string): Promise<void>;
  search(query: string): Promise<ArtifactRecord[]>;
  onChanged(cb: (artifact: ArtifactRecord) => void): () => void;
}
```

Add the necessary import at the top: `import type { ArtifactRecord, ArtifactType } from '../shared/artifact-types';`

- [ ] **Step 2: Create Electron implementation**

```typescript
// src/platform/electron/artifacts.ts

import type { PlatformArtifacts } from '../types';
import type { ArtifactRecord, ArtifactType } from '../../shared/artifact-types';

declare const window: Window & {
  electronIPC: {
    invoke(channel: string, ...args: unknown[]): Promise<unknown>;
    on(channel: string, cb: (...args: unknown[]) => void): () => void;
  };
};

export class ElectronArtifacts implements PlatformArtifacts {
  list(): Promise<ArtifactRecord[]> {
    return window.electronIPC.invoke('artifacts:list') as Promise<ArtifactRecord[]>;
  }

  get(id: string): Promise<ArtifactRecord | null> {
    return window.electronIPC.invoke('artifacts:get', id) as Promise<ArtifactRecord | null>;
  }

  getContent(id: string): Promise<string> {
    return window.electronIPC.invoke('artifacts:getContent', id) as Promise<string>;
  }

  create(params: {
    type: ArtifactType;
    title: string;
    content: string;
    sessionId: string;
    sessionTitle: string;
    sessionCreatedAt: string;
  }): Promise<ArtifactRecord> {
    return window.electronIPC.invoke('artifacts:create', params) as Promise<ArtifactRecord>;
  }

  update(id: string, content: string, title?: string): Promise<ArtifactRecord> {
    return window.electronIPC.invoke('artifacts:update', { id, content, title }) as Promise<ArtifactRecord>;
  }

  delete(id: string): Promise<void> {
    return window.electronIPC.invoke('artifacts:delete', id) as Promise<void>;
  }

  search(query: string): Promise<ArtifactRecord[]> {
    return window.electronIPC.invoke('artifacts:search', query) as Promise<ArtifactRecord[]>;
  }

  onChanged(cb: (artifact: ArtifactRecord) => void): () => void {
    return window.electronIPC.on('artifacts:changed', (data: unknown) => {
      cb(data as ArtifactRecord);
    });
  }
}
```

- [ ] **Step 3: Export from platform index**

In `src/platform/electron/index.ts`, add:

```typescript
import { ElectronArtifacts } from './artifacts';

export const artifacts = new ElectronArtifacts();
```

- [ ] **Step 4: Verify build**

Run: `npm run build:electron`
Expected: No errors.

- [ ] **Step 5: Commit**

```bash
git add src/platform/types.ts src/platform/electron/artifacts.ts src/platform/electron/index.ts
git commit -m "feat(artifacts): add PlatformArtifacts interface and Electron implementation"
```

---

## Phase 2: Store + Tool Module

### Task 6: Zustand Store

**Files:**
- Create: `src/graph/store/artifact-store.ts`

- [ ] **Step 1: Create the artifact store**

```typescript
// src/graph/store/artifact-store.ts

import { create } from 'zustand';
import type { ArtifactRecord, ArtifactType } from '../../shared/artifact-types';

interface ArtifactStore {
  artifacts: ArtifactRecord[];
  loading: boolean;

  loadArtifacts: () => Promise<void>;
  searchArtifacts: (query: string) => Promise<ArtifactRecord[]>;
  getArtifactContent: (id: string) => Promise<string>;
  createArtifact: (params: {
    type: ArtifactType;
    title: string;
    content: string;
    sessionId: string;
    sessionTitle: string;
    sessionCreatedAt: string;
  }) => Promise<ArtifactRecord>;
  updateArtifact: (id: string, content: string, title?: string) => Promise<ArtifactRecord>;
  deleteArtifact: (id: string) => Promise<void>;
}

export const useArtifactStore = create<ArtifactStore>((set, get) => ({
  artifacts: [],
  loading: false,

  loadArtifacts: async () => {
    set({ loading: true });
    try {
      const { artifacts } = await import('@platform');
      const list = await artifacts.list();
      set({ artifacts: list, loading: false });
    } catch {
      set({ loading: false });
    }
  },

  searchArtifacts: async (query: string) => {
    const { artifacts } = await import('@platform');
    return artifacts.search(query);
  },

  getArtifactContent: async (id: string) => {
    const { artifacts } = await import('@platform');
    return artifacts.getContent(id);
  },

  createArtifact: async (params) => {
    const { artifacts } = await import('@platform');
    const record = await artifacts.create(params);
    set((state) => ({ artifacts: [record, ...state.artifacts] }));
    return record;
  },

  updateArtifact: async (id, content, title) => {
    const { artifacts } = await import('@platform');
    const record = await artifacts.update(id, content, title);
    set((state) => ({
      artifacts: state.artifacts.map((a) => (a.id === id ? record : a)),
    }));
    return record;
  },

  deleteArtifact: async (id) => {
    const { artifacts } = await import('@platform');
    await artifacts.delete(id);
    set((state) => ({
      artifacts: state.artifacts.filter((a) => a.id !== id),
    }));
  },
}));

export function initArtifactStoreListener(): () => void {
  let unsub: (() => void) | undefined;

  import('@platform').then(({ artifacts }) => {
    unsub = artifacts.onChanged((artifact) => {
      useArtifactStore.setState((state) => {
        const exists = state.artifacts.find((a) => a.id === artifact.id);
        if (exists) {
          return { artifacts: state.artifacts.map((a) => (a.id === artifact.id ? artifact : a)) };
        }
        return { artifacts: [artifact, ...state.artifacts] };
      });
    });
  });

  return () => unsub?.();
}
```

- [ ] **Step 2: Verify build**

Run: `npm run build:electron-renderer`
Expected: No errors.

- [ ] **Step 3: Commit**

```bash
git add src/graph/store/artifact-store.ts
git commit -m "feat(artifacts): add Zustand store with CRUD and search"
```

---

### Task 7: Tool Module

**Files:**
- Create: `src/commands/tools/artifact-tools.ts`
- Modify: `src/commands/tools/index.ts`

Study `src/commands/tools/graph-tools.ts` for the exact `ToolModule` pattern before implementing.

- [ ] **Step 1: Create artifact tool module**

```typescript
// src/commands/tools/artifact-tools.ts

import type { ChatToolDefinition } from '../../shared/chat-agent-tools';
import type { ToolModule, ToolExecResult } from './types';
import type { CommandContext } from '../command-context';

export const definitions: ChatToolDefinition[] = [
  {
    name: 'create_artifact',
    description:
      'Create a new artifact — an interactive component, document, diagram, or visualization that the user can open, view, and edit in a dedicated tab. Use for content that benefits from dedicated rendering (dashboards, reports, diagrams) rather than inline chat display.',
    parameters: {
      type: 'object',
      properties: {
        type: {
          type: 'string',
          enum: ['jsx', 'markdown', 'html', 'svg', 'mermaid'],
          description:
            'Artifact type. jsx: React component with Recharts/D3/Tailwind. markdown: formatted document. html: standalone page. svg: vector graphic. mermaid: diagram.',
        },
        title: {
          type: 'string',
          description: 'Human-readable title (displayed in tab bar and artifact list)',
        },
        content: {
          type: 'string',
          description:
            'The full artifact content. For jsx: export default function ComponentName() with React/Recharts/D3. For markdown: standard markdown. For html: complete HTML document. For svg: SVG markup. For mermaid: mermaid diagram syntax.',
        },
      },
      required: ['type', 'title', 'content'],
    },
    executionContext: 'ui',
  },
  {
    name: 'update_artifact',
    description:
      'Replace the content of an existing artifact. Always sends the complete new content (full replacement, not a patch).',
    parameters: {
      type: 'object',
      properties: {
        artifactId: {
          type: 'string',
          description: 'ID of the artifact to update',
        },
        content: {
          type: 'string',
          description: 'The complete new content (replaces existing content entirely)',
        },
        title: {
          type: 'string',
          description: 'New title (optional, keeps existing if omitted)',
        },
      },
      required: ['artifactId', 'content'],
    },
    executionContext: 'ui',
  },
];

async function execute(
  ctx: CommandContext,
  name: string,
  input: Record<string, unknown>,
): Promise<ToolExecResult | null> {
  switch (name) {
    case 'create_artifact': {
      const { artifacts } = await import('@platform');
      const record = await artifacts.create({
        type: input.type as any,
        title: input.title as string,
        content: input.content as string,
        sessionId: ctx.sessionId ?? '',
        sessionTitle: ctx.sessionTitle ?? '',
        sessionCreatedAt: ctx.sessionCreatedAt ?? new Date().toISOString(),
      });
      return {
        result: JSON.stringify({
          artifactId: record.id,
          title: record.title,
          type: record.type,
          _artifactCard: true,
        }),
      };
    }
    case 'update_artifact': {
      const { artifacts } = await import('@platform');
      const record = await artifacts.update(
        input.artifactId as string,
        input.content as string,
        input.title as string | undefined,
      );
      return {
        result: JSON.stringify({
          artifactId: record.id,
          title: record.title,
          type: record.type,
          _artifactCard: true,
        }),
      };
    }
    default:
      return null;
  }
}

const artifactTools: ToolModule = { definitions, execute };
export { artifactTools };
```

**Important:** The `ctx.sessionId`, `ctx.sessionTitle`, and `ctx.sessionCreatedAt` properties may not exist on `CommandContext` yet. Check `src/commands/command-context.ts` (or equivalent). If they don't exist, you'll need to add them and ensure the chat agent loop passes session info when constructing the context. This is a dependency — check the existing `CommandContext` type and add the fields if missing.

- [ ] **Step 2: Register in tool modules index**

In `src/commands/tools/index.ts`, add:

```typescript
import { artifactTools } from './artifact-tools';

// Add to ALL_MODULES array:
const ALL_MODULES: ToolModule[] = [noteTools, edgeTools, graphTools, entityTools, intelligenceTools, artifactTools];
```

- [ ] **Step 3: Verify build**

Run: `npm run build:electron-renderer`
Expected: No errors.

- [ ] **Step 4: Commit**

```bash
git add src/commands/tools/artifact-tools.ts src/commands/tools/index.ts
git commit -m "feat(artifacts): add create_artifact and update_artifact tool module"
```

---

## Phase 3: UI Store Extensions

### Task 8: UI Store — Tab Type + Left Panel

**Files:**
- Modify: `src/graph/store/ui-store.ts`

- [ ] **Step 1: Extend ContentTabType union**

Find the `ContentTabType` type definition and add the artifact variant:

```typescript
export type ContentTabType =
  | { kind: 'graph' }
  | { kind: 'noteEditor'; noteId: string }
  | { kind: 'extractionReview' }
  | { kind: 'viewer'; filePath: string }
  | { kind: 'artifact'; artifactId: string };
```

- [ ] **Step 2: Extend LeftPanel type**

Find the `LeftPanel` type definition and add `'artifacts'`:

```typescript
export type LeftPanel = 'none' | 'explorer' | 'agents' | 'artifacts';
```

- [ ] **Step 3: Verify build**

Run: `npm run build:electron-renderer`
Expected: No errors.

- [ ] **Step 4: Commit**

```bash
git add src/graph/store/ui-store.ts
git commit -m "feat(artifacts): extend UI store with artifact tab type and panel"
```

---

## Phase 4: UI Components

### Task 9: ArtifactCard (Chat)

**Files:**
- Create: `src/ui/components/chat/ArtifactCard.tsx`
- Modify: `src/ui/components/chat/ChatMessage.tsx`

- [ ] **Step 1: Create ArtifactCard component**

```typescript
// src/ui/components/chat/ArtifactCard.tsx

import { useUIStore } from '../../../graph/store/ui-store';
import { ARTIFACT_TYPE_LABELS, type ArtifactType } from '../../../shared/artifact-types';

const TYPE_ICONS: Record<ArtifactType, string> = {
  jsx: '⚛',
  markdown: '📄',
  html: '🌐',
  svg: '◈',
  mermaid: '◇',
};

const TYPE_COLORS: Record<ArtifactType, string> = {
  jsx: 'bg-purple-900/40 text-purple-400',
  markdown: 'bg-teal-900/40 text-teal-400',
  html: 'bg-amber-900/40 text-amber-400',
  svg: 'bg-rose-900/40 text-rose-400',
  mermaid: 'bg-blue-900/40 text-blue-400',
};

interface ArtifactCardProps {
  artifactId: string;
  title: string;
  type: ArtifactType;
}

export function ArtifactCard({ artifactId, title, type }: ArtifactCardProps) {
  const openContentTab = useUIStore((s) => s.openContentTab);

  const handleOpen = () => {
    openContentTab({ kind: 'artifact', artifactId }, title);
  };

  return (
    <div className="bg-zinc-900 border border-zinc-700 rounded-lg overflow-hidden my-2">
      <div className="px-3 py-2.5 flex items-center justify-between gap-3">
        <div className="flex items-center gap-2.5 min-w-0">
          <div className={`w-8 h-8 rounded-md flex items-center justify-center shrink-0 ${TYPE_COLORS[type]}`}>
            <span className="text-base">{TYPE_ICONS[type]}</span>
          </div>
          <div className="min-w-0">
            <div className="text-zinc-200 text-xs font-medium truncate">{title}</div>
            <div className="text-zinc-500 text-[10px]">{ARTIFACT_TYPE_LABELS[type]}</div>
          </div>
        </div>
        <button
          onClick={handleOpen}
          className="px-3 py-1 bg-indigo-600 hover:bg-indigo-500 text-white text-[11px] font-medium rounded-md shrink-0 transition-colors"
        >
          Open
        </button>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Integrate into ChatMessage**

In `src/ui/components/chat/ChatMessage.tsx`, find where `tool_result` turns are rendered. After the existing tool call rendering, add artifact card detection.

Find the section with `{message.agentTurns && ...}` and modify to detect artifact results. The artifact tool returns JSON with `_artifactCard: true`. Add a check in the rendering:

```typescript
import { ArtifactCard } from './ArtifactCard';

// Inside the agentTurns rendering, after the existing ChatToolCall map:
// Add a check for artifact tool results
{message.agentTurns?.filter(turn =>
  turn.type === 'tool_result' && !turn.isError && isArtifactResult(turn.content)
).map((turn, i) => {
  const data = JSON.parse(turn.content);
  return (
    <ArtifactCard
      key={`artifact-${i}`}
      artifactId={data.artifactId}
      title={data.title}
      type={data.type}
    />
  );
})}
```

Add the helper function:

```typescript
function isArtifactResult(content: string): boolean {
  try {
    const data = JSON.parse(content);
    return data._artifactCard === true;
  } catch {
    return false;
  }
}
```

The exact integration point depends on how `ChatMessage.tsx` structures its rendering. Study the file and place the artifact card between the tool calls section and the markdown content section.

- [ ] **Step 3: Verify build**

Run: `npm run build:electron-renderer`
Expected: No errors.

- [ ] **Step 4: Commit**

```bash
git add src/ui/components/chat/ArtifactCard.tsx src/ui/components/chat/ChatMessage.tsx
git commit -m "feat(artifacts): add ArtifactCard component and chat integration"
```

---

### Task 10: ActivityBar Icon

**Files:**
- Modify: `src/ui/components/layout/ActivityBar.tsx`

- [ ] **Step 1: Add artifacts icon and ITEMS entry**

Add after the existing icon components:

```typescript
const ArtifactsIcon = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
    <rect x="3" y="3" width="7" height="7" rx="1" />
    <rect x="14" y="3" width="7" height="7" rx="1" />
    <rect x="3" y="14" width="7" height="7" rx="1" />
    <rect x="14" y="14" width="7" height="7" rx="1" />
  </svg>
);
```

Add to the ITEMS array:

```typescript
const ITEMS: ActivityBarItem[] = [
  { panel: 'explorer', title: 'Explorer', icon: <FolderIcon /> },
  { panel: 'agents', title: 'Agents', icon: <AgentsIcon /> },
  { panel: 'artifacts', title: 'Artifacts', icon: <ArtifactsIcon /> },
];
```

- [ ] **Step 2: Verify build and test**

Run: `npm run build:electron && npx electron .`
Expected: Third icon appears in activity bar. Clicking it toggles (though the panel component doesn't exist yet — clicking should toggle the leftPanel state without error).

- [ ] **Step 3: Commit**

```bash
git add src/ui/components/layout/ActivityBar.tsx
git commit -m "feat(artifacts): add artifacts icon to activity bar"
```

---

### Task 11: Artifacts Panel (Left Sidebar)

**Files:**
- Create: `src/ui/components/sidebar/ArtifactPanel.tsx`
- Modify: `src/ui/layouts/TabLayout.tsx` (or wherever the left sidebar renders panels)

Find where the left sidebar conditionally renders `ExplorerPanel` / `AgentsPanel` based on `leftPanel` state, and add the `ArtifactPanel` case.

- [ ] **Step 1: Create ArtifactPanel component**

```typescript
// src/ui/components/sidebar/ArtifactPanel.tsx

import { useState, useEffect, useCallback, useMemo } from 'react';
import { useArtifactStore } from '../../../graph/store/artifact-store';
import { useUIStore } from '../../../graph/store/ui-store';
import { ARTIFACT_TYPE_LABELS, type ArtifactType } from '../../../shared/artifact-types';

const TYPE_ICONS: Record<ArtifactType, string> = {
  jsx: '⚛',
  markdown: '📄',
  html: '🌐',
  svg: '◈',
  mermaid: '◇',
};

const ALL_TYPES: ArtifactType[] = ['jsx', 'markdown', 'html', 'svg', 'mermaid'];

export function ArtifactPanel() {
  const artifacts = useArtifactStore((s) => s.artifacts);
  const loading = useArtifactStore((s) => s.loading);
  const loadArtifacts = useArtifactStore((s) => s.loadArtifacts);
  const searchArtifacts = useArtifactStore((s) => s.searchArtifacts);
  const openContentTab = useUIStore((s) => s.openContentTab);

  const [query, setQuery] = useState('');
  const [typeFilter, setTypeFilter] = useState<ArtifactType | null>(null);
  const [searchResults, setSearchResults] = useState<typeof artifacts | null>(null);

  useEffect(() => {
    loadArtifacts();
  }, [loadArtifacts]);

  useEffect(() => {
    if (!query.trim()) {
      setSearchResults(null);
      return;
    }
    const timer = setTimeout(async () => {
      const results = await searchArtifacts(query);
      setSearchResults(results);
    }, 200);
    return () => clearTimeout(timer);
  }, [query, searchArtifacts]);

  const displayedArtifacts = useMemo(() => {
    const base = searchResults ?? artifacts;
    if (!typeFilter) return base;
    return base.filter((a) => a.type === typeFilter);
  }, [artifacts, searchResults, typeFilter]);

  const handleOpen = useCallback(
    (artifact: typeof artifacts[0]) => {
      openContentTab({ kind: 'artifact', artifactId: artifact.id }, artifact.title);
    },
    [openContentTab],
  );

  const formatTime = (iso: string) => {
    const diff = Date.now() - new Date(iso).getTime();
    const mins = Math.floor(diff / 60000);
    if (mins < 1) return 'just now';
    if (mins < 60) return `${mins}m ago`;
    const hours = Math.floor(mins / 60);
    if (hours < 24) return `${hours}h ago`;
    const days = Math.floor(hours / 24);
    return `${days}d ago`;
  };

  return (
    <div className="h-full flex flex-col bg-zinc-800">
      {/* Search */}
      <div className="p-2">
        <input
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search artifacts..."
          className="w-full bg-zinc-900 border border-zinc-700 rounded-md px-2.5 py-1.5 text-xs text-zinc-200 placeholder-zinc-500 focus:outline-none focus:border-indigo-500"
        />
      </div>

      {/* Type filter chips */}
      <div className="px-2 pb-2 flex gap-1 flex-wrap">
        <button
          onClick={() => setTypeFilter(null)}
          className={`px-2 py-0.5 rounded-full text-[10px] transition-colors ${
            !typeFilter ? 'bg-indigo-600 text-white' : 'bg-zinc-700 text-zinc-400 hover:text-zinc-200'
          }`}
        >
          All
        </button>
        {ALL_TYPES.map((t) => (
          <button
            key={t}
            onClick={() => setTypeFilter(typeFilter === t ? null : t)}
            className={`px-2 py-0.5 rounded-full text-[10px] transition-colors ${
              typeFilter === t ? 'bg-indigo-600 text-white' : 'bg-zinc-700 text-zinc-400 hover:text-zinc-200'
            }`}
          >
            {ARTIFACT_TYPE_LABELS[t]}
          </button>
        ))}
      </div>

      {/* Artifact list */}
      <div className="flex-1 overflow-y-auto px-1.5">
        {loading ? (
          <p className="text-zinc-500 text-xs text-center mt-8">Loading...</p>
        ) : displayedArtifacts.length === 0 ? (
          <p className="text-zinc-500 text-xs text-center mt-8">No artifacts yet</p>
        ) : (
          displayedArtifacts.map((a) => (
            <button
              key={a.id}
              onClick={() => handleOpen(a)}
              className="w-full text-left rounded-md px-2.5 py-2 mb-0.5 hover:bg-zinc-700/50 transition-colors"
            >
              <div className="flex items-center gap-2">
                <span className="text-sm shrink-0">{TYPE_ICONS[a.type]}</span>
                <div className="min-w-0">
                  <div className="text-zinc-200 text-xs truncate">{a.title}</div>
                  <div className="text-zinc-500 text-[10px]">
                    {ARTIFACT_TYPE_LABELS[a.type]} · {formatTime(a.updatedAt)}
                  </div>
                </div>
              </div>
            </button>
          ))
        )}
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Wire into left sidebar rendering**

Find where `TabLayout.tsx` (or the sidebar container) conditionally renders panels based on `leftPanel` value. Add the artifact panel case:

```typescript
import { ArtifactPanel } from '../components/sidebar/ArtifactPanel';

// In the left sidebar conditional rendering:
{leftPanel === 'artifacts' && <ArtifactPanel />}
```

- [ ] **Step 3: Verify build and test**

Run: `npm run build:electron && npx electron .`
Expected: Clicking artifacts icon shows the panel with "No artifacts yet" message. Search bar and filter chips render.

- [ ] **Step 4: Commit**

```bash
git add src/ui/components/sidebar/ArtifactPanel.tsx src/ui/layouts/TabLayout.tsx
git commit -m "feat(artifacts): add artifacts panel with search and type filtering"
```

---

### Task 12: Artifact Tab + Renderers

**Files:**
- Create: `src/ui/components/tabs/ArtifactTab.tsx`
- Create: `src/ui/components/artifacts/SvgRenderer.tsx`
- Create: `src/ui/components/artifacts/MermaidRenderer.tsx`
- Create: `src/ui/components/artifacts/HtmlRenderer.tsx`
- Modify: `src/ui/layouts/TabLayout.tsx`

Install mermaid: `npm install mermaid`

- [ ] **Step 1: Install mermaid**

Run: `npm install mermaid`

- [ ] **Step 2: Create SvgRenderer**

```typescript
// src/ui/components/artifacts/SvgRenderer.tsx

import { useMemo } from 'react';

interface SvgRendererProps {
  content: string;
}

export function SvgRenderer({ content }: SvgRendererProps) {
  const blobUrl = useMemo(() => {
    const blob = new Blob([content], { type: 'image/svg+xml' });
    return URL.createObjectURL(blob);
  }, [content]);

  return (
    <div className="h-full flex items-center justify-center bg-zinc-900 overflow-auto p-4">
      <img src={blobUrl} alt="SVG artifact" className="max-w-full max-h-full object-contain" />
    </div>
  );
}
```

- [ ] **Step 3: Create MermaidRenderer**

```typescript
// src/ui/components/artifacts/MermaidRenderer.tsx

import { useEffect, useRef, useState } from 'react';
import mermaid from 'mermaid';

mermaid.initialize({ startOnLoad: false, theme: 'dark' });

interface MermaidRendererProps {
  content: string;
}

export function MermaidRenderer({ content }: MermaidRendererProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    const id = `mermaid-${Date.now()}`;

    mermaid
      .render(id, content)
      .then(({ svg }) => {
        if (!cancelled && containerRef.current) {
          containerRef.current.innerHTML = svg;
          setError(null);
        }
      })
      .catch((err) => {
        if (!cancelled) setError(String(err));
      });

    return () => {
      cancelled = true;
    };
  }, [content]);

  if (error) {
    return (
      <div className="h-full flex flex-col bg-zinc-900 p-4">
        <div className="bg-red-900/20 border border-red-800 rounded-md p-3 mb-4">
          <p className="text-red-400 text-xs font-mono">{error}</p>
        </div>
        <pre className="text-zinc-400 text-xs font-mono overflow-auto">{content}</pre>
      </div>
    );
  }

  return (
    <div className="h-full flex items-center justify-center bg-zinc-900 overflow-auto p-4">
      <div ref={containerRef} />
    </div>
  );
}
```

- [ ] **Step 4: Create HtmlRenderer**

```typescript
// src/ui/components/artifacts/HtmlRenderer.tsx

import { useRef, useEffect } from 'react';

interface HtmlRendererProps {
  content: string;
}

export function HtmlRenderer({ content }: HtmlRendererProps) {
  const iframeRef = useRef<HTMLIFrameElement>(null);

  useEffect(() => {
    const iframe = iframeRef.current;
    if (!iframe) return;

    const handleLoad = () => {
      iframe.contentWindow?.postMessage({ type: 'RENDER_HTML', html: content }, '*');
    };

    iframe.addEventListener('load', handleLoad);
    return () => iframe.removeEventListener('load', handleLoad);
  }, [content]);

  const srcdoc = `<!DOCTYPE html>
<html><head>
<meta charset="utf-8">
<style>body { margin: 0; background: #1e1e2e; color: #cdd6f4; font-family: system-ui; }</style>
</head><body>
<div id="root"></div>
<script>
window.addEventListener('message', (e) => {
  if (e.data?.type === 'RENDER_HTML') {
    document.getElementById('root').innerHTML = e.data.html;
  }
});
</script>
</body></html>`;

  return (
    <iframe
      ref={iframeRef}
      sandbox="allow-scripts"
      srcDoc={srcdoc}
      className="w-full h-full border-0 bg-zinc-900"
      title="HTML artifact"
    />
  );
}
```

- [ ] **Step 5: Create ArtifactTab**

```typescript
// src/ui/components/tabs/ArtifactTab.tsx

import { useState, useEffect, useCallback } from 'react';
import { useArtifactStore } from '../../../graph/store/artifact-store';
import { ARTIFACT_TYPE_LABELS, type ArtifactType, type ArtifactRecord } from '../../../shared/artifact-types';
import { MarkdownRenderer } from '../shared/MarkdownRenderer';
import { SvgRenderer } from '../artifacts/SvgRenderer';
import { MermaidRenderer } from '../artifacts/MermaidRenderer';
import { HtmlRenderer } from '../artifacts/HtmlRenderer';

interface ArtifactTabProps {
  artifactId: string;
}

type ViewMode = 'preview' | 'source';

export function ArtifactTab({ artifactId }: ArtifactTabProps) {
  const artifacts = useArtifactStore((s) => s.artifacts);
  const getContent = useArtifactStore((s) => s.getArtifactContent);

  const [content, setContent] = useState<string>('');
  const [loading, setLoading] = useState(true);
  const [mode, setMode] = useState<ViewMode>('preview');
  const [editContent, setEditContent] = useState('');
  const [modified, setModified] = useState(false);

  const artifact = artifacts.find((a) => a.id === artifactId);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    getContent(artifactId).then((c) => {
      if (!cancelled) {
        setContent(c);
        setEditContent(c);
        setLoading(false);
      }
    });
    return () => { cancelled = true; };
  }, [artifactId, getContent]);

  const handleSave = useCallback(async () => {
    const { updateArtifact } = useArtifactStore.getState();
    await updateArtifact(artifactId, editContent);
    setContent(editContent);
    setModified(false);
  }, [artifactId, editContent]);

  const handleCopy = useCallback(() => {
    navigator.clipboard.writeText(content);
  }, [content]);

  const handleEditChange = useCallback((value: string) => {
    setEditContent(value);
    setModified(value !== content);
  }, [content]);

  if (!artifact) {
    return (
      <div className="h-full flex items-center justify-center bg-zinc-900">
        <p className="text-zinc-500 text-xs">Artifact not found</p>
      </div>
    );
  }

  if (loading) {
    return (
      <div className="h-full flex items-center justify-center bg-zinc-900">
        <p className="text-zinc-500 text-xs">Loading...</p>
      </div>
    );
  }

  const formatTime = (iso: string) => {
    const diff = Date.now() - new Date(iso).getTime();
    const mins = Math.floor(diff / 60000);
    if (mins < 1) return 'just now';
    if (mins < 60) return `${mins}m ago`;
    const hours = Math.floor(mins / 60);
    if (hours < 24) return `${hours}h ago`;
    return `${Math.floor(hours / 24)}d ago`;
  };

  return (
    <div className="h-full flex flex-col bg-zinc-900">
      {/* Toolbar */}
      <div className="flex items-center justify-between px-3 py-1.5 border-b border-zinc-700 shrink-0">
        <div className="flex items-center gap-2">
          <span className="text-[10px] bg-purple-900/40 text-purple-400 px-1.5 py-0.5 rounded">
            {ARTIFACT_TYPE_LABELS[artifact.type]}
          </span>
          {modified ? (
            <span className="text-amber-400 text-[10px]">● Modified</span>
          ) : (
            <span className="text-zinc-500 text-[10px]">{formatTime(artifact.updatedAt)}</span>
          )}
        </div>
        <div className="flex items-center gap-1.5">
          {/* Preview/Source toggle */}
          <div className="flex bg-zinc-800 rounded-md p-0.5">
            <button
              onClick={() => setMode('preview')}
              className={`px-2 py-0.5 text-[10px] rounded transition-colors ${
                mode === 'preview' ? 'bg-indigo-600 text-white' : 'text-zinc-400 hover:text-zinc-200'
              }`}
            >
              Preview
            </button>
            <button
              onClick={() => setMode('source')}
              className={`px-2 py-0.5 text-[10px] rounded transition-colors ${
                mode === 'source' ? 'bg-indigo-600 text-white' : 'text-zinc-400 hover:text-zinc-200'
              }`}
            >
              Source
            </button>
          </div>
          <button onClick={handleCopy} className="px-2 py-0.5 bg-zinc-800 text-zinc-300 text-[10px] rounded hover:bg-zinc-700">
            Copy
          </button>
          {mode === 'source' && modified && (
            <button onClick={handleSave} className="px-2 py-0.5 bg-emerald-600 text-white text-[10px] rounded font-medium hover:bg-emerald-500">
              Save
            </button>
          )}
        </div>
      </div>

      {/* Content area */}
      <div className="flex-1 overflow-hidden">
        {mode === 'preview' ? (
          <ArtifactPreview type={artifact.type} content={content} />
        ) : (
          <ArtifactSource content={editContent} onChange={handleEditChange} type={artifact.type} />
        )}
      </div>
    </div>
  );
}

function ArtifactPreview({ type, content }: { type: ArtifactType; content: string }) {
  switch (type) {
    case 'markdown':
      return (
        <div className="h-full overflow-y-auto p-4">
          <MarkdownRenderer content={content} />
        </div>
      );
    case 'svg':
      return <SvgRenderer content={content} />;
    case 'mermaid':
      return <MermaidRenderer content={content} />;
    case 'html':
      return <HtmlRenderer content={content} />;
    case 'jsx':
      return (
        <div className="h-full flex items-center justify-center text-zinc-500 text-xs">
          JSX renderer will be added in the sandbox task
        </div>
      );
    default:
      return <pre className="p-4 text-zinc-400 text-xs font-mono overflow-auto h-full">{content}</pre>;
  }
}

function ArtifactSource({ content, onChange, type }: { content: string; onChange: (v: string) => void; type: ArtifactType }) {
  return (
    <textarea
      value={content}
      onChange={(e) => onChange(e.target.value)}
      className="w-full h-full bg-zinc-950 text-zinc-300 text-xs font-mono p-4 resize-none focus:outline-none"
      spellCheck={false}
    />
  );
}
```

Note: The Source mode uses a plain `<textarea>` as a placeholder. CodeMirror 6 integration is a separate task (Task 14). This gets the basic edit flow working first.

- [ ] **Step 6: Route artifact tab type in TabLayout**

In `src/ui/layouts/TabLayout.tsx`, find the tab type routing conditional and add the artifact case:

```typescript
import { ArtifactTab } from '../components/tabs/ArtifactTab';

// In the tab rendering switch:
{tab.type.kind === 'artifact' ? (
  <ArtifactTab artifactId={tab.type.artifactId} />
) : tab.type.kind === 'graph' ? (
  // ... existing cases
```

Add it as the first case (before `graph`) or in alphabetical order — whatever reads cleanly.

- [ ] **Step 7: Verify build and test**

Run: `npm run build:electron && npx electron .`
Expected: Opening an artifact from the panel or chat card renders the ArtifactTab with toolbar and Preview/Source toggle. Markdown, SVG, Mermaid, and HTML renderers work. Source mode shows editable textarea.

- [ ] **Step 8: Commit**

```bash
git add src/ui/components/tabs/ArtifactTab.tsx src/ui/components/artifacts/SvgRenderer.tsx src/ui/components/artifacts/MermaidRenderer.tsx src/ui/components/artifacts/HtmlRenderer.tsx src/ui/layouts/TabLayout.tsx package.json package-lock.json
git commit -m "feat(artifacts): add ArtifactTab with preview/source toggle and renderers"
```

---

## Phase 5: JSX Sandbox

### Task 13: Sandbox Renderer HTML + JsxRenderer

**Files:**
- Create: `electron/sandbox/artifact-renderer.html`
- Create: `src/ui/components/artifacts/JsxRenderer.tsx`
- Modify: `src/ui/components/tabs/ArtifactTab.tsx` (replace JSX placeholder)

The sandbox needs vendor libs. For V1, use CDN URLs in the HTML since the sandbox iframe has `allow-scripts`. For production, vendor libs should be bundled — but CDN gets us working first.

- [ ] **Step 1: Create the sandbox renderer HTML**

```html
<!-- electron/sandbox/artifact-renderer.html -->
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <script src="https://unpkg.com/react@19/umd/react.production.min.js" crossorigin></script>
  <script src="https://unpkg.com/react-dom@19/umd/react-dom.production.min.js" crossorigin></script>
  <script src="https://unpkg.com/sucrase@3/dist/sucrase.min.js"></script>
  <script src="https://unpkg.com/recharts@2/umd/Recharts.min.js"></script>
  <script src="https://unpkg.com/d3@7/dist/d3.min.js"></script>
  <link href="https://cdn.jsdelivr.net/npm/tailwindcss@3/dist/tailwind.min.css" rel="stylesheet">
  <style>
    body { margin: 0; background: #1e1e2e; color: #cdd6f4; font-family: system-ui, sans-serif; }
    #root { min-height: 100vh; }
    .error-panel { background: #2d1b1b; border: 1px solid #7f1d1d; border-radius: 8px; padding: 16px; margin: 16px; }
    .error-panel pre { color: #fca5a5; font-size: 12px; white-space: pre-wrap; word-break: break-word; }
  </style>
</head>
<body>
  <div id="root"></div>
  <script>
    const root = ReactDOM.createRoot(document.getElementById('root'));

    function showError(message) {
      document.getElementById('root').innerHTML =
        '<div class="error-panel"><pre>' + escapeHtml(message) + '</pre></div>';
      window.parent.postMessage({ type: 'ERROR', message }, '*');
    }

    function escapeHtml(str) {
      return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    }

    window.addEventListener('message', (event) => {
      if (event.data?.type !== 'RENDER') return;

      try {
        const code = event.data.code;

        const transformed = Sucrase.transform(code, {
          transforms: ['jsx', 'imports'],
        }).code;

        const module = { exports: {} };
        const moduleFunc = new Function(
          'module', 'exports', 'React', 'recharts', 'd3', 'require',
          transformed
        );

        const fakeRequire = (name) => {
          const libs = {
            'react': React,
            'recharts': Recharts,
            'd3': d3,
          };
          if (libs[name]) return libs[name];
          throw new Error('Module not available: ' + name);
        };

        moduleFunc(module, module.exports, React, Recharts, d3, fakeRequire);

        const Component = module.exports.default || module.exports;

        if (typeof Component !== 'function') {
          showError('Artifact must export a default function component.');
          return;
        }

        root.render(React.createElement(Component));
        window.parent.postMessage({ type: 'READY' }, '*');

        const observer = new ResizeObserver((entries) => {
          for (const entry of entries) {
            window.parent.postMessage({
              type: 'RESIZE',
              height: entry.contentRect.height,
            }, '*');
          }
        });
        observer.observe(document.getElementById('root'));

      } catch (err) {
        showError(String(err.message || err));
      }
    });

    window.parent.postMessage({ type: 'INIT' }, '*');
  </script>
</body>
</html>
```

Note: Using CDN URLs for V1. The iframe has `sandbox="allow-scripts"` which allows script loading. For production, bundle these as local files and serve via a custom protocol or file:// URL. This is a follow-up optimization.

- [ ] **Step 2: Create JsxRenderer**

```typescript
// src/ui/components/artifacts/JsxRenderer.tsx

import { useRef, useEffect, useState, useCallback } from 'react';

interface JsxRendererProps {
  content: string;
}

export function JsxRenderer({ content }: JsxRendererProps) {
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const [error, setError] = useState<string | null>(null);
  const [height, setHeight] = useState<number>(400);
  const contentRef = useRef(content);
  contentRef.current = content;

  const handleMessage = useCallback((event: MessageEvent) => {
    const iframe = iframeRef.current;
    if (!iframe || event.source !== iframe.contentWindow) return;

    switch (event.data?.type) {
      case 'INIT':
        iframe.contentWindow?.postMessage({ type: 'RENDER', code: contentRef.current }, '*');
        break;
      case 'READY':
        setError(null);
        break;
      case 'ERROR':
        setError(event.data.message);
        break;
      case 'RESIZE':
        if (event.data.height > 0) setHeight(Math.min(event.data.height + 20, 2000));
        break;
    }
  }, []);

  useEffect(() => {
    window.addEventListener('message', handleMessage);
    return () => window.removeEventListener('message', handleMessage);
  }, [handleMessage]);

  useEffect(() => {
    const iframe = iframeRef.current;
    if (iframe?.contentWindow) {
      iframe.contentWindow.postMessage({ type: 'RENDER', code: content }, '*');
    }
  }, [content]);

  const sandboxUrl = new URL('../../electron/sandbox/artifact-renderer.html', import.meta.url).href;

  return (
    <div className="h-full bg-zinc-900 overflow-auto">
      {error && (
        <div className="bg-red-900/20 border border-red-800 rounded-md p-3 m-3">
          <p className="text-red-400 text-xs font-mono">{error}</p>
        </div>
      )}
      <iframe
        ref={iframeRef}
        sandbox="allow-scripts"
        src={sandboxUrl}
        className="w-full border-0"
        style={{ height: `${height}px` }}
        title="JSX artifact sandbox"
      />
    </div>
  );
}
```

**Important:** The `sandboxUrl` resolution depends on how the Electron renderer serves static files. The `import.meta.url` approach may not work. You may need to:
- Use `file://` protocol pointing to the built asset
- Or configure Vite to copy `electron/sandbox/` to the renderer output and reference it relatively
- Or register a custom protocol in Electron's main process

Check how existing static assets (like the PDF viewer) resolve their paths and follow the same pattern. If needed, serve the sandbox HTML via a custom `sandbox://` protocol registered in `electron/main.ts`.

- [ ] **Step 3: Wire JsxRenderer into ArtifactTab**

In `src/ui/components/tabs/ArtifactTab.tsx`, replace the JSX placeholder in `ArtifactPreview`:

```typescript
import { JsxRenderer } from '../artifacts/JsxRenderer';

// In ArtifactPreview switch:
case 'jsx':
  return <JsxRenderer content={content} />;
```

- [ ] **Step 4: Verify build and test**

Run: `npm run build:electron && npx electron .`
Expected: Create a JSX artifact via chat (or manually place a `.jsx` file with matching `.meta.json` in `.kg/artifacts/`). The preview should render a React component with Recharts/Tailwind.

- [ ] **Step 5: Commit**

```bash
git add electron/sandbox/artifact-renderer.html src/ui/components/artifacts/JsxRenderer.tsx src/ui/components/tabs/ArtifactTab.tsx
git commit -m "feat(artifacts): add sandboxed JSX renderer with Sucrase + React + Recharts + D3"
```

---

## Phase 6: CodeMirror Editor

### Task 14: CodeMirror 6 Source Editor

**Files:**
- Create: `src/ui/components/artifacts/ArtifactEditor.tsx`
- Modify: `src/ui/components/tabs/ArtifactTab.tsx`

- [ ] **Step 1: Install CodeMirror packages**

Run: `npm install codemirror @codemirror/lang-javascript @codemirror/lang-html @codemirror/lang-markdown @codemirror/theme-one-dark @codemirror/view @codemirror/state`

- [ ] **Step 2: Create ArtifactEditor component**

```typescript
// src/ui/components/artifacts/ArtifactEditor.tsx

import { useEffect, useRef, useCallback } from 'react';
import { EditorState } from '@codemirror/state';
import { EditorView, keymap, lineNumbers, highlightActiveLine } from '@codemirror/view';
import { defaultKeymap } from '@codemirror/commands';
import { javascript } from '@codemirror/lang-javascript';
import { html } from '@codemirror/lang-html';
import { markdown } from '@codemirror/lang-markdown';
import { oneDark } from '@codemirror/theme-one-dark';
import type { ArtifactType } from '../../../shared/artifact-types';

interface ArtifactEditorProps {
  content: string;
  onChange: (value: string) => void;
  type: ArtifactType;
}

function getLanguageExtension(type: ArtifactType) {
  switch (type) {
    case 'jsx':
      return javascript({ jsx: true });
    case 'html':
    case 'svg':
      return html();
    case 'markdown':
    case 'mermaid':
      return markdown();
    default:
      return javascript();
  }
}

export function ArtifactEditor({ content, onChange, type }: ArtifactEditorProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const viewRef = useRef<EditorView | null>(null);
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;

  useEffect(() => {
    if (!containerRef.current) return;

    const state = EditorState.create({
      doc: content,
      extensions: [
        lineNumbers(),
        highlightActiveLine(),
        keymap.of(defaultKeymap),
        getLanguageExtension(type),
        oneDark,
        EditorView.updateListener.of((update) => {
          if (update.docChanged) {
            onChangeRef.current(update.state.doc.toString());
          }
        }),
        EditorView.theme({
          '&': { height: '100%', fontSize: '12px' },
          '.cm-scroller': { overflow: 'auto', fontFamily: 'ui-monospace, monospace' },
          '.cm-content': { padding: '8px 0' },
        }),
      ],
    });

    const view = new EditorView({ state, parent: containerRef.current });
    viewRef.current = view;

    return () => {
      view.destroy();
      viewRef.current = null;
    };
  }, [type]);

  useEffect(() => {
    const view = viewRef.current;
    if (!view) return;
    const currentContent = view.state.doc.toString();
    if (currentContent !== content) {
      view.dispatch({
        changes: { from: 0, to: currentContent.length, insert: content },
      });
    }
  }, [content]);

  return <div ref={containerRef} className="h-full" />;
}
```

- [ ] **Step 3: Replace textarea with ArtifactEditor in ArtifactTab**

In `src/ui/components/tabs/ArtifactTab.tsx`, replace the `ArtifactSource` function:

```typescript
import { ArtifactEditor } from '../artifacts/ArtifactEditor';

function ArtifactSource({ content, onChange, type }: { content: string; onChange: (v: string) => void; type: ArtifactType }) {
  return <ArtifactEditor content={content} onChange={onChange} type={type} />;
}
```

- [ ] **Step 4: Verify build and test**

Run: `npm run build:electron && npx electron .`
Expected: Source mode shows CodeMirror with syntax highlighting, line numbers, and the one-dark theme. Editing triggers the "Modified" indicator.

- [ ] **Step 5: Commit**

```bash
git add src/ui/components/artifacts/ArtifactEditor.tsx src/ui/components/tabs/ArtifactTab.tsx package.json package-lock.json
git commit -m "feat(artifacts): add CodeMirror 6 editor for Source mode"
```

---

## Phase 7: File Watcher + System Prompt

### Task 15: File Watcher Integration

**Files:**
- Modify: `electron/vault/file-watcher.ts`

- [ ] **Step 1: Add artifact file handling to the watcher**

In the file watcher's `handleEvent` method (or equivalent), add handling for files under `.kg/artifacts/`. When a `.meta.json` or content file changes, re-read and sync with SQLite.

Find where the watcher filters/dispatches events by path. Add a branch for artifact paths:

```typescript
if (relativePath.startsWith('.kg/artifacts/') && !relativePath.endsWith('.meta.json')) {
  this.eventBus.emit({ type: 'artifact:content-changed', relativePath });
}
if (relativePath.startsWith('.kg/artifacts/') && relativePath.endsWith('.meta.json')) {
  this.eventBus.emit({ type: 'artifact:meta-changed', relativePath });
}
```

The exact integration depends on the watcher's structure. The key behavior: when files in `.kg/artifacts/` change externally, the IPC handler should re-read the metadata and content, update SQLite, and broadcast to the renderer via `artifacts:changed`.

This is a wiring task — study `file-watcher.ts` and `note-file-handler.ts` to understand the event flow, then mirror it for artifacts.

- [ ] **Step 2: Verify build**

Run: `npm run build:electron`
Expected: No errors.

- [ ] **Step 3: Test manually**

1. Open the app with a vault
2. Create an artifact via chat
3. Open the artifact file in an external editor
4. Modify and save
5. The artifact panel and any open artifact tab should reflect the change

- [ ] **Step 4: Commit**

```bash
git add electron/vault/file-watcher.ts
git commit -m "feat(artifacts): add file watcher integration for external edits"
```

---

### Task 16: System Prompt Update

**Files:**
- Modify: The file where the chat agent system prompt is assembled

Find where the system prompt is constructed for the chat agent (likely in `src/core/` or `electron/` — search for "system" prompt assembly, the `StreamFn` setup, or where `CHAT_AGENT_TOOLS` are injected). Add the artifact instructions.

- [ ] **Step 1: Add artifact instructions to system prompt**

Append to the system prompt:

```
## Artifacts

You can create persistent, interactive artifacts that the user can open in a dedicated tab. Use artifacts for:
- Dashboards and data visualizations (type: jsx — React with Recharts, D3, Tailwind)
- Formatted documents, summaries, reports (type: markdown)
- Standalone web pages or interactive demos (type: html)
- Vector graphics and illustrations (type: svg)
- Diagrams: flowcharts, sequence diagrams, entity relationships (type: mermaid)

Use artifacts when content benefits from dedicated rendering — not for short code snippets or simple text answers that belong inline in chat.

For jsx artifacts:
- Use `export default function ComponentName()` as the entry point
- Available imports: react, recharts, d3 (pre-bundled in sandbox)
- Use Tailwind CSS classes for styling
- Hardcode data directly into the component (no external fetching)

When updating an existing artifact, always send the complete new content via update_artifact. Do not attempt partial patches.
```

- [ ] **Step 2: Verify build**

Run: `npm run build:electron`
Expected: No errors.

- [ ] **Step 3: Commit**

```bash
git add <system-prompt-file>
git commit -m "feat(artifacts): add artifact instructions to chat agent system prompt"
```

---

## Phase 8: Integration Testing

### Task 17: End-to-End Smoke Test

- [ ] **Step 1: Build and launch**

Run: `npm run build:electron && npx electron .`

- [ ] **Step 2: Test create_artifact via chat**

1. Open a vault
2. In chat, type: "Create a bar chart showing programming language popularity"
3. Verify: LLM calls `create_artifact` with type `jsx`
4. Verify: ArtifactCard appears in chat with title and "Open" button
5. Click "Open" — ArtifactTab opens with the rendered chart

- [ ] **Step 3: Test artifact panel**

1. Click the Artifacts icon in the activity bar
2. Verify: Panel shows the artifact with correct type icon and title
3. Click the artifact in the panel — tab opens (or focuses if already open)
4. Test search: type part of the title — artifact filters
5. Test type filter chips

- [ ] **Step 4: Test Source mode editing**

1. In the artifact tab, switch to Source mode
2. Verify: CodeMirror shows the JSX with syntax highlighting
3. Edit the code — verify "Modified" indicator appears
4. Click Save — verify preview updates

- [ ] **Step 5: Test other artifact types**

1. Ask the LLM: "Create a mermaid diagram showing a simple flowchart"
2. Verify mermaid renders in preview
3. Ask: "Write a markdown summary of our conversation"
4. Verify markdown renders
5. Ask: "Create an SVG of a simple icon"
6. Verify SVG renders

- [ ] **Step 6: Test update_artifact**

1. After creating an artifact, ask: "Update the chart to use a pie chart instead"
2. Verify: LLM calls `update_artifact`, card appears in chat, preview updates

- [ ] **Step 7: Verify file storage**

1. Check `.kg/artifacts/` in the vault directory
2. Verify: Session directory exists with readable name
3. Verify: Content file + `.meta.json` sidecar exist
4. Verify: `.meta.json` contains correct sessionId, title, type

- [ ] **Step 8: Commit final state**

```bash
git add -A
git commit -m "feat(artifacts): complete artifact system v1"
```
