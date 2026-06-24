# Entity Files Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Entity files as a core feature — every entity node gets a markdown working-memory file in `entities/` with UUID frontmatter binding from day one. Agents primarily read/write these files during retrieval and file-back; users may also edit them directly. The DB remains the structured identity/graph/index layer, while entity files own rich prose. Sync panel handles reviewed reconciliation for title mismatches, new files, and link drift notifications. Missing files are silently unbound.

**Architecture:** `EntityFileService` in Electron main process (follows `NoteFileHandler` lifecycle shape, but with file event routing). DB-owned scaffolding creates missing files, updates `id`/`title` frontmatter, and renames paths; file bodies are agent/user-owned and are never regenerated from DB after initial creation. Main-process sync issue store owns notification detection/persistence; Zustand is a renderer cache. Agent-facing entity file tools expose read/append/patch with `content_hash` optimistic locking. New "Sync" entry in the left sidebar `ActivityBar` with count badge.

**Tech Stack:** vitest, better-sqlite3, existing VaultEventBus/FileWatcher, Zustand, React/Tailwind

**Spec:** `docs/superpowers/specs/2026-06-17-entity-files-design.md`

---

## Implementation Invariants

These invariants supersede any older "one-way DB→file" wording in snippets below:

- **Entity file body ownership:** agent-curated, user-adjustable. After initial creation, do not regenerate the body wholesale from DB state. The agent is the primary writer; the system performs deterministic structural updates (edge wiki-links). Users review and adjust.
- **Edge-triggered updates:** on `edge:created`/`edge:deleted`, deterministically append/remove `- [[Name]] — *label*` in the `## Relationships` section of both endpoint entity files.
- **DB ownership:** DB owns node identity, graph edges, labels/tags, `vault_path`, and frontmatter scaffolding (`id`, `title`). File title edits are proposed renames, not automatic DB writes.
- **File-derived indexes:** file body edits update `content_hash` and embeddings. These are derived from file content. DB `summary` is static (set at extraction), not re-derived from the file. FTS for entity file prose is future work — MVP uses embeddings only.
- **File event routing:** file watcher emits `file:added` for both new and existing files. Guard with `vault_path` lookup — if a node already has this path bound, treat as content change, not new-file import.
- **Bulk edge handling:** `mutation.execute` does not emit individual edge events. The `db:action` outcome handler must extract edge results and emit edge events so bulk-created edges trigger relationship updates.
- **Notification source:** sync issues live in Electron main (durable or recomputable). Renderer Zustand only mirrors the current issue list and badge count.
- **File routing:** `entities/*.md` must be reserved for `EntityFileService`; `ResourceDetectionHandler` must ignore them so entity markdown is never imported as a generic resource.
- **Deletion:** node deletion or merge deletes the entity file. Content is recoverable from git history.
- **Agent writes:** add `readEntityFile`, `appendEntityFile`, and `patchEntityFile` APIs with `content_hash` guards before exposing entity files as agent-writeable memory.

---

### Task 1: Entity Slug Utility

**Files:**
- Create: `electron/entity-files/entity-slug.ts`
- Test: `tests/entity-files/entity-slug.test.ts`

- [ ] **Step 1: Write the failing tests**

```ts
// tests/entity-files/entity-slug.test.ts
import { describe, it, expect } from 'vitest';
import { slugify } from '../../electron/entity-files/entity-slug';

describe('slugify', () => {
  it('lowercases and replaces spaces with underscores', () => {
    expect(slugify('Machine Learning')).toBe('machine_learning');
  });

  it('strips non-alphanumeric except underscore and hyphen', () => {
    expect(slugify('C++ Programming (Advanced)')).toBe('c_programming_advanced');
  });

  it('collapses multiple underscores', () => {
    expect(slugify('foo   bar')).toBe('foo_bar');
  });

  it('trims leading and trailing underscores', () => {
    expect(slugify('  hello  ')).toBe('hello');
  });

  it('handles empty string', () => {
    expect(slugify('')).toBe('untitled');
  });

  it('truncates at 200 chars and appends hash suffix for long names', () => {
    const longName = 'a'.repeat(250);
    const result = slugify(longName);
    expect(result.length).toBeLessThanOrEqual(205); // 200 + '_' + 4 hex chars
    expect(result).toMatch(/^a{200}_[a-f0-9]{4}$/);
  });

  it('handles unicode by stripping non-ascii', () => {
    expect(slugify('café résumé')).toBe('caf_rsum');
  });
});

describe('deriveEntityPath', () => {
  it('returns entities/{slug}.md', () => {
    const { deriveEntityPath } = require('../../electron/entity-files/entity-slug');
    expect(deriveEntityPath('Machine Learning')).toBe('entities/machine_learning.md');
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/entity-files/entity-slug.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: Implement**

```ts
// electron/entity-files/entity-slug.ts
import { createHash } from 'crypto';

const MAX_SLUG_LENGTH = 200;

export function slugify(name: string): string {
  let slug = name
    .toLowerCase()
    .replace(/\s+/g, '_')
    .replace(/[^a-z0-9_-]/g, '')
    .replace(/_+/g, '_')
    .replace(/^_|_$/g, '');

  if (!slug) return 'untitled';

  if (slug.length > MAX_SLUG_LENGTH) {
    const hash = createHash('sha256').update(name).digest('hex').slice(0, 4);
    slug = slug.slice(0, MAX_SLUG_LENGTH) + '_' + hash;
  }

  return slug;
}

export function deriveEntityPath(name: string): string {
  return `entities/${slugify(name)}.md`;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/entity-files/entity-slug.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add electron/entity-files/entity-slug.ts tests/entity-files/entity-slug.test.ts
git commit -m "feat(entity-files): add slugify utility for entity filenames"
```

---

### Task 2: Entity Markdown Generation & Parsing

**Files:**
- Create: `electron/entity-files/entity-markdown.ts`
- Test: `tests/entity-files/entity-markdown.test.ts`

- [ ] **Step 1: Write the failing tests**

```ts
// tests/entity-files/entity-markdown.test.ts
import { describe, it, expect } from 'vitest';
import { generateEntityMarkdown, parseEntityFrontmatter } from '../../electron/entity-files/entity-markdown';

describe('generateEntityMarkdown', () => {
  it('generates frontmatter with id and title', () => {
    const md = generateEntityMarkdown({
      id: 'abc-123',
      name: 'Machine Learning',
      summary: 'A branch of AI.',
      edges: [],
      sources: [],
    });
    expect(md).toContain('---\nid: abc-123\ntitle: Machine Learning\n---');
    expect(md).toContain('# Machine Learning');
    expect(md).toContain('A branch of AI.');
  });

  it('renders relationships section from edges', () => {
    const md = generateEntityMarkdown({
      id: 'abc-123',
      name: 'Machine Learning',
      summary: null,
      edges: [
        { targetName: 'Neural Networks', label: 'foundational_architecture', direction: 'outgoing' },
        { sourceName: 'Alan Turing', label: 'contributed_to', direction: 'incoming' },
      ],
      sources: [],
    });
    expect(md).toContain('## Relationships');
    expect(md).toContain('- [[Neural Networks]] — *foundational_architecture*');
    expect(md).toContain('- [[Alan Turing]] → *contributed_to*');
  });

  it('renders sources section', () => {
    const md = generateEntityMarkdown({
      id: 'abc-123',
      name: 'Machine Learning',
      summary: null,
      edges: [],
      sources: [{ name: 'Wikipedia', url: 'https://en.wikipedia.org/wiki/ML' }],
    });
    expect(md).toContain('## Sources');
    expect(md).toContain('- [Wikipedia](https://en.wikipedia.org/wiki/ML)');
  });

  it('omits empty sections', () => {
    const md = generateEntityMarkdown({
      id: 'abc-123',
      name: 'Test',
      summary: null,
      edges: [],
      sources: [],
    });
    expect(md).not.toContain('## Relationships');
    expect(md).not.toContain('## Sources');
  });
});

describe('parseEntityFrontmatter', () => {
  it('extracts id and title from frontmatter', () => {
    const result = parseEntityFrontmatter('---\nid: abc-123\ntitle: Machine Learning\n---\n\n# Body');
    expect(result).toEqual({ id: 'abc-123', title: 'Machine Learning' });
  });

  it('returns null id when no frontmatter', () => {
    const result = parseEntityFrontmatter('# Just a heading\n\nSome text');
    expect(result).toEqual({ id: null, title: null });
  });

  it('returns null id when frontmatter has no id field', () => {
    const result = parseEntityFrontmatter('---\ntitle: Something\n---\n\nBody');
    expect(result).toEqual({ id: null, title: 'Something' });
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/entity-files/entity-markdown.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: Implement**

```ts
// electron/entity-files/entity-markdown.ts

export interface EntityEdgeInfo {
  sourceName?: string;
  targetName?: string;
  label: string;
  direction: 'outgoing' | 'incoming';
}

export interface EntitySourceInfo {
  name: string;
  url: string | null;
}

export interface GenerateEntityInput {
  id: string;
  name: string;
  summary: string | null;
  edges: EntityEdgeInfo[];
  sources: EntitySourceInfo[];
}

export function generateEntityMarkdown(input: GenerateEntityInput): string {
  const lines: string[] = [];

  lines.push('---');
  lines.push(`id: ${input.id}`);
  lines.push(`title: ${input.name}`);
  lines.push('---');
  lines.push('');
  lines.push(`# ${input.name}`);
  lines.push('');

  if (input.summary) {
    lines.push(input.summary);
    lines.push('');
  }

  if (input.edges.length > 0) {
    lines.push('## Relationships');
    lines.push('');
    for (const edge of input.edges) {
      if (edge.direction === 'outgoing') {
        lines.push(`- [[${edge.targetName}]] — *${edge.label}*`);
      } else {
        lines.push(`- [[${edge.sourceName}]] → *${edge.label}*`);
      }
    }
    lines.push('');
  }

  if (input.sources.length > 0) {
    lines.push('## Sources');
    lines.push('');
    for (const src of input.sources) {
      if (src.url) {
        lines.push(`- [${src.name}](${src.url})`);
      } else {
        lines.push(`- ${src.name}`);
      }
    }
    lines.push('');
  }

  return lines.join('\n');
}

export interface ParsedEntityFrontmatter {
  id: string | null;
  title: string | null;
}

export function parseEntityFrontmatter(content: string): ParsedEntityFrontmatter {
  const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (!match) return { id: null, title: null };

  let id: string | null = null;
  let title: string | null = null;

  for (const line of match[1].split('\n')) {
    const idx = line.indexOf(':');
    if (idx <= 0) continue;
    const key = line.slice(0, idx).trim();
    const value = line.slice(idx + 1).trim();
    if (key === 'id') id = value;
    if (key === 'title') title = value;
  }

  return { id, title };
}

export function rewriteTitle(content: string, newTitle: string): string {
  return content.replace(
    /^(---\r?\n[\s\S]*?)title:.*(\r?\n[\s\S]*?---)/,
    `$1title: ${newTitle}$2`
  );
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/entity-files/entity-markdown.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add electron/entity-files/entity-markdown.ts tests/entity-files/entity-markdown.test.ts
git commit -m "feat(entity-files): add markdown generation and frontmatter parsing"
```

---

### Task 3: Sync Issue Types, Main Store & Zustand Cache

**Files:**
- Create: `src/shared/entity-sync-types.ts`
- Create: `electron/entity-files/sync-issue-store.ts`
- Create: `src/graph/store/entity-sync-store.ts`

- [ ] **Step 1: Define shared issue types**

Create one shared type surface for sync issues. The main process owns issue detection and dismissal state; the renderer imports equivalent types only for display.

```ts
export type SyncNotificationType =
  | 'title_mismatch'
  | 'new_file'
  | 'unknown_id'
  | 'link_broken'
  | 'link_dead'
  | 'link_missing';

export interface SyncNotification {
  id: string;
  type: SyncNotificationType;
  filePath: string;
  entityName: string | null;
  detectedAt: string;
  dismissed: boolean;
  detail: TitleMismatchDetail | NewFileDetail | UnknownIdDetail | LinkDriftDetail;
}

export interface TitleMismatchDetail {
  kind: 'title_mismatch';
  dbName: string;
  fileTitle: string;
}

export interface NewFileDetail {
  kind: 'new_file';
  parsedTitle: string | null;
}

export interface UnknownIdDetail {
  kind: 'unknown_id';
  fileId: string;
}

export interface LinkDriftDetail {
  kind: 'link_broken' | 'link_dead' | 'link_missing';
  linkText: string;
  suggestedFix: string | null;
  edgeLabel?: string;
}
```

- [ ] **Step 2: Create main-process sync issue store**

`electron/entity-files/sync-issue-store.ts` should:

- Store or recompute issues from `(kind, filePath, nodeId, content_hash/node updated_at)`.
- Persist dismissed issue keys so ignored issues do not reappear until the file or node changes.
- Broadcast `entity-sync:changed` to renderer windows when issue count/list changes.
- Expose `listIssues()`, `upsertIssues()`, `dismissIssue()`, `removeIssue()`, and `pendingCount()`.

- [ ] **Step 3: Create renderer Zustand cache**

```ts
// src/graph/store/entity-sync-store.ts
import { create } from 'zustand';
import type { SyncNotification } from '../../shared/entity-sync-types';

interface EntitySyncState {
  notifications: SyncNotification[];
  setNotifications: (ns: SyncNotification[]) => void;
  addNotification: (n: SyncNotification) => void;
  addNotifications: (ns: SyncNotification[]) => void;
  dismissNotification: (id: string) => void;
  dismissAllForFile: (filePath: string) => void;
  removeNotification: (id: string) => void;
  clearAll: () => void;
  pendingCount: () => number;
}

export const useEntitySyncStore = create<EntitySyncState>((set, get) => ({
  notifications: [],

  setNotifications: (ns) => set({ notifications: ns }),

  addNotification: (n) => set((s) => ({
    notifications: [...s.notifications, n],
  })),

  addNotifications: (ns) => set((s) => ({
    notifications: [...s.notifications, ...ns],
  })),

  dismissNotification: (id) => set((s) => ({
    notifications: s.notifications.map((n) =>
      n.id === id ? { ...n, dismissed: true } : n
    ),
  })),

  dismissAllForFile: (filePath) => set((s) => ({
    notifications: s.notifications.map((n) =>
      n.filePath === filePath ? { ...n, dismissed: true } : n
    ),
  })),

  removeNotification: (id) => set((s) => ({
    notifications: s.notifications.filter((n) => n.id !== id),
  })),

  clearAll: () => set({ notifications: [] }),

  pendingCount: () => get().notifications.filter((n) => !n.dismissed).length,
}));
```

- [ ] **Step 4: Commit**

```bash
git add src/shared/entity-sync-types.ts electron/entity-files/sync-issue-store.ts src/graph/store/entity-sync-store.ts
git commit -m "feat(entity-files): add entity sync issue store and renderer cache"
```

---

### Task 4: EntityFileService — Core Reconciliation & DB Scaffolding

**Files:**
- Create: `electron/entity-files/entity-file-service.ts`
- Test: `tests/entity-files/entity-file-service.test.ts`

**Required behavior:** this service creates initial files and maintains frontmatter/path metadata. It must not overwrite an existing body after creation, and it must not silently delete enriched files.

- [ ] **Step 0: Extend edge:deleted event to carry full edge data**

The current `edge:deleted` event only has `edgeId`. By the time handlers run, the DB row is already gone. Extend it to include the full edge, following the existing pre-fetch pattern at `electron/main.ts:162-168`.

In `electron/vault/event-bus.ts`, change line 10:

```ts
  | { type: 'edge:deleted'; edgeId: string; edge?: DbEdge }
```

In `electron/main.ts`, update the pre-fetch (around line 162) to capture the full edge:

```ts
    let deletedEdge: DbEdge | undefined;
    if (action === 'edges.delete') {
      try {
        deletedEdge = getDb().prepare(
          'SELECT * FROM edges WHERE id = ?'
        ).get(params as string) as DbEdge | undefined;
      } catch { /* DB may not be ready */ }
    }
```

Update the embedding handler (around line 216) to use `deletedEdge`:

```ts
      } else if (eventType === 'edge_deleted' && deletedEdge) {
        embeddingService.handleEdgeMutation(deletedEdge.source_id, deletedEdge.target_id).catch(() => {});
      }
```

Update the event emit (around line 251) to pass the full edge:

```ts
      } else if (syncType === 'edge_deleted') {
        ctx.eventBus.emit({ type: 'edge:deleted', edgeId: (outcome.syncEvent as any).id, edge: deletedEdge });
      }
```

- [ ] **Step 1: Write the failing test for file generation on node:created**

```ts
// tests/entity-files/entity-file-service.test.ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Database from 'better-sqlite3';
import { mkdirSync, readFileSync, existsSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { randomUUID } from 'crypto';
import { VaultEventBus } from '../../electron/vault/event-bus';
import { EntityFileService } from '../../electron/entity-files/entity-file-service';

function createTestEnv() {
  const vaultPath = join(tmpdir(), `synapse-test-${randomUUID()}`);
  mkdirSync(join(vaultPath, '.kg'), { recursive: true });
  mkdirSync(join(vaultPath, 'notes'), { recursive: true });

  const db = new Database(':memory:');
  db.exec(`
    CREATE TABLE nodes (
      id TEXT PRIMARY KEY, identifier TEXT, name TEXT NOT NULL,
      type TEXT NOT NULL DEFAULT 'entity', label TEXT, summary TEXT,
      properties TEXT NOT NULL DEFAULT '{}', x REAL, y REAL,
      color TEXT, size REAL DEFAULT 1.0, source_url TEXT,
      vault_path TEXT, file_mtime INTEGER, file_size INTEGER,
      content_hash TEXT, created_at TEXT, updated_at TEXT
    );
    CREATE TABLE edges (
      id TEXT PRIMARY KEY, source_id TEXT, target_id TEXT,
      label TEXT NOT NULL, type TEXT DEFAULT 'related',
      properties TEXT DEFAULT '{}', weight REAL DEFAULT 1.0,
      directed INTEGER DEFAULT 1, created_at TEXT, updated_at TEXT
    );
    CREATE TABLE entity_sources (
      entity_id TEXT, resource_id TEXT, relation_type TEXT,
      location TEXT, created_at TEXT
    );
  `);

  const eventBus = new VaultEventBus();
  const ctx = {
    path: vaultPath, kgPath: join(vaultPath, '.kg'), db, eventBus,
    resolve: (rel: string) => join(vaultPath, rel),
    relative: (abs: string) => abs.slice(vaultPath.length + 1),
  };

  return { vaultPath, db, eventBus, ctx, cleanup: () => rmSync(vaultPath, { recursive: true, force: true }) };
}

describe('EntityFileService', () => {
  let env: ReturnType<typeof createTestEnv>;
  let service: EntityFileService;

  beforeEach(() => {
    env = createTestEnv();
    service = new EntityFileService(env.ctx as any);
    service.register(env.eventBus);
  });

  afterEach(() => {
    service.unregister();
    env.cleanup();
  });

  it('generates entity file on node:created', async () => {
    const nodeId = randomUUID();
    env.db.prepare(`
      INSERT INTO nodes (id, identifier, name, type, label, summary, properties, created_at, updated_at)
      VALUES (?, ?, 'Machine Learning', 'entity', 'concept', 'A branch of AI.', '{}', datetime('now'), datetime('now'))
    `).run(nodeId, nodeId);

    env.eventBus.emit({
      type: 'node:created',
      node: env.db.prepare('SELECT * FROM nodes WHERE id = ?').get(nodeId) as any,
    });

    // Flush debounce
    await new Promise((r) => setTimeout(r, 600));

    const filePath = join(env.vaultPath, 'entities', 'machine_learning.md');
    expect(existsSync(filePath)).toBe(true);

    const content = readFileSync(filePath, 'utf-8');
    expect(content).toContain(`id: ${nodeId}`);
    expect(content).toContain('title: Machine Learning');
    expect(content).toContain('# Machine Learning');
    expect(content).toContain('A branch of AI.');

    // vault_path should be set on the DB row
    const row = env.db.prepare('SELECT vault_path FROM nodes WHERE id = ?').get(nodeId) as any;
    expect(row.vault_path).toBe('entities/machine_learning.md');
  });

  it('renames file on node:updated with name change', async () => {
    const nodeId = randomUUID();
    env.db.prepare(`
      INSERT INTO nodes (id, identifier, name, type, vault_path, created_at, updated_at)
      VALUES (?, ?, 'Old Name', 'entity', NULL, datetime('now'), datetime('now'))
    `).run(nodeId, nodeId);

    // Create initial file
    env.eventBus.emit({
      type: 'node:created',
      node: env.db.prepare('SELECT * FROM nodes WHERE id = ?').get(nodeId) as any,
    });
    await new Promise((r) => setTimeout(r, 600));

    // Rename
    env.db.prepare('UPDATE nodes SET name = ? WHERE id = ?').run('New Name', nodeId);
    env.eventBus.emit({
      type: 'node:updated',
      node: env.db.prepare('SELECT * FROM nodes WHERE id = ?').get(nodeId) as any,
      changes: ['name'],
    });
    await new Promise((r) => setTimeout(r, 600));

    expect(existsSync(join(env.vaultPath, 'entities', 'new_name.md'))).toBe(true);
    expect(existsSync(join(env.vaultPath, 'entities', 'old_name.md'))).toBe(false);
  });

  it('deletes file on node:deleted', async () => {
    const nodeId = randomUUID();
    env.db.prepare(`
      INSERT INTO nodes (id, identifier, name, type, vault_path, created_at, updated_at)
      VALUES (?, ?, 'Doomed', 'entity', 'entities/doomed.md', datetime('now'), datetime('now'))
    `).run(nodeId, nodeId);

    // Create initial file
    env.eventBus.emit({
      type: 'node:created',
      node: env.db.prepare('SELECT * FROM nodes WHERE id = ?').get(nodeId) as any,
    });
    await new Promise((r) => setTimeout(r, 600));

    const filePath = join(env.vaultPath, 'entities', 'doomed.md');
    expect(existsSync(filePath)).toBe(true);

    env.eventBus.emit({
      type: 'node:deleted',
      nodeId,
      filePath: 'entities/doomed.md',
    });

    expect(existsSync(filePath)).toBe(false);
  });

  it('ignores non-entity node events', async () => {
    const nodeId = randomUUID();
    env.db.prepare(`
      INSERT INTO nodes (id, identifier, name, type, created_at, updated_at)
      VALUES (?, ?, 'A Note', 'note', datetime('now'), datetime('now'))
    `).run(nodeId, nodeId);

    env.eventBus.emit({
      type: 'node:created',
      node: env.db.prepare('SELECT * FROM nodes WHERE id = ?').get(nodeId) as any,
    });
    await new Promise((r) => setTimeout(r, 600));

    expect(existsSync(join(env.vaultPath, 'entities', 'a_note.md'))).toBe(false);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/entity-files/entity-file-service.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: Implement EntityFileService**

```ts
// electron/entity-files/entity-file-service.ts
import { existsSync, mkdirSync, writeFileSync, readFileSync, renameSync, unlinkSync, statSync } from 'fs';
import { dirname } from 'path';
import type { VaultContext } from '../vault/vault-context';
import type { VaultEventBus } from '../vault/event-bus';
import type { DbNode, DbEdge } from '../../src/shared/types';
import { slugify, deriveEntityPath } from './entity-slug';
import { generateEntityMarkdown, parseEntityFrontmatter, rewriteTitle } from './entity-markdown';
import type { EntityEdgeInfo, EntitySourceInfo } from './entity-markdown';
import { computeFileHash } from '../vault/content-hash';

export class EntityFileService {
  private ctx: VaultContext;
  private unsubscribers: (() => void)[] = [];
  private debounceTimers = new Map<string, NodeJS.Timeout>();
  private markAsAppWritten?: (relativePath: string) => void;

  constructor(ctx: VaultContext) {
    this.ctx = ctx;
  }

  setFileWatcher(markFn: (relativePath: string) => void): void {
    this.markAsAppWritten = markFn;
  }

  register(eventBus: VaultEventBus): void {
    this.ensureDirectory();

    this.unsubscribers.push(
      eventBus.on('node:created', (event) => {
        if (event.node.type === 'entity') {
          this.debouncedGenerate(event.node);
        }
      }),
      eventBus.on('node:updated', (event) => {
        if (event.node.type === 'entity' && event.changes.includes('name')) {
          this.handleEntityRenamed(event.node);
        }
      }),
      eventBus.on('node:deleted', (event) => {
        if (event.filePath && event.filePath.startsWith('entities/')) {
          this.handleEntityDeleted(event.filePath);
        }
      }),
      eventBus.on('edge:created', (event) => {
        this.handleEdgeChanged(event.edge.source_id, event.edge.target_id, event.edge.label, 'add');
      }),
      eventBus.on('edge:deleted', (event) => {
        if (event.edge) {
          this.handleEdgeDeletedWithData(event.edge.source_id, event.edge.target_id, event.edge.label);
        }
      }),
      eventBus.on('file:added', (event) => {
        if (this.isEntityFilePath(event.relativePath)) this.handleEntityFileAdded(event.relativePath);
      }),
      eventBus.on('file:changed', (event) => {
        if (this.isEntityFilePath(event.relativePath)) this.handleEntityFileChanged(event.relativePath);
      }),
      eventBus.on('file:removed', (event) => {
        if (this.isEntityFilePath(event.relativePath)) this.handleEntityFileRemoved(event.relativePath);
      }),
    );
  }

  unregister(): void {
    for (const unsub of this.unsubscribers) unsub();
    this.unsubscribers = [];
    for (const timer of this.debounceTimers.values()) clearTimeout(timer);
    this.debounceTimers.clear();
  }

  ensureDirectory(): void {
    const entitiesDir = this.ctx.resolve('entities');
    if (!existsSync(entitiesDir)) {
      mkdirSync(entitiesDir, { recursive: true });
    }
  }

  generateFileForNode(node: DbNode): void {
    if (node.type !== 'entity') return;
    if (node.vault_path?.startsWith('entities/') && existsSync(this.ctx.resolve(node.vault_path))) {
      // Existing body is agent/user-owned. Only refresh metadata/frontmatter via explicit methods.
      return;
    }

    const relativePath = this.derivePathWithCollision(node.name, node.id);
    const absolutePath = this.ctx.resolve(relativePath);

    const edges = this.queryEdgesForNode(node.id, node.name);
    const sources = this.querySourcesForNode(node.id);

    const markdown = generateEntityMarkdown({
      id: node.id,
      name: node.name,
      summary: node.summary,
      edges,
      sources,
    });

    mkdirSync(dirname(absolutePath), { recursive: true });
    writeFileSync(absolutePath, markdown, 'utf-8');
    this.markAsAppWritten?.(relativePath);

    const stat = statSync(absolutePath);
    const hash = computeFileHash(absolutePath);
    this.ctx.db.prepare(
      'UPDATE nodes SET vault_path = ?, file_mtime = ?, file_size = ?, content_hash = ? WHERE id = ?'
    ).run(relativePath, Math.floor(stat.mtimeMs), stat.size, hash, node.id);
  }

  private debouncedGenerate(node: DbNode): void {
    const existing = this.debounceTimers.get(node.id);
    if (existing) clearTimeout(existing);

    this.debounceTimers.set(node.id, setTimeout(() => {
      this.debounceTimers.delete(node.id);
      this.generateFileForNode(node);
    }, 500));
  }

  private handleEntityRenamed(node: DbNode): void {
    const row = this.ctx.db.prepare(
      'SELECT vault_path FROM nodes WHERE id = ?'
    ).get(node.id) as { vault_path: string | null } | undefined;

    if (!row?.vault_path || !row.vault_path.startsWith('entities/')) return;

    const oldAbsolute = this.ctx.resolve(row.vault_path);
    const newRelativePath = this.derivePathWithCollision(node.name, node.id);
    const newAbsolute = this.ctx.resolve(newRelativePath);

    if (oldAbsolute === newAbsolute) {
      this.updateTitleInFile(oldAbsolute, newRelativePath, node);
      return;
    }

    if (existsSync(oldAbsolute)) {
      mkdirSync(dirname(newAbsolute), { recursive: true });
      renameSync(oldAbsolute, newAbsolute);
      const content = readFileSync(newAbsolute, 'utf-8');
      const updated = rewriteTitle(content, node.name);
      if (updated !== content) writeFileSync(newAbsolute, updated, 'utf-8');
      this.markAsAppWritten?.(newRelativePath);
      this.markAsAppWritten?.(row.vault_path);
    }

    const stat = existsSync(newAbsolute) ? statSync(newAbsolute) : null;
    const hash = stat ? computeFileHash(newAbsolute) : null;
    this.ctx.db.prepare(
      'UPDATE nodes SET vault_path = ?, file_mtime = ?, file_size = ?, content_hash = ? WHERE id = ?'
    ).run(newRelativePath, stat ? Math.floor(stat.mtimeMs) : null, stat?.size ?? null, hash, node.id);
  }

  private updateTitleInFile(absolutePath: string, relativePath: string, node: DbNode): void {
    if (!existsSync(absolutePath)) return;
    const content = readFileSync(absolutePath, 'utf-8');
    const updated = rewriteTitle(content, node.name);
    if (updated === content) return;
    writeFileSync(absolutePath, updated, 'utf-8');
    this.markAsAppWritten?.(relativePath);
    const stat = statSync(absolutePath);
    const hash = computeFileHash(absolutePath);
    this.ctx.db.prepare(
      'UPDATE nodes SET file_mtime = ?, file_size = ?, content_hash = ? WHERE id = ?'
    ).run(Math.floor(stat.mtimeMs), stat.size, hash, node.id);
  }

  private handleEntityDeleted(filePath: string): void {
    const absolutePath = this.ctx.resolve(filePath);
    if (existsSync(absolutePath)) {
      unlinkSync(absolutePath);
    }
  }

  private handleEdgeChanged(sourceId: string, targetId: string, label: string, action: 'add' | 'remove'): void {
    for (const nodeId of [sourceId, targetId]) {
      const node = this.ctx.db.prepare(
        "SELECT id, name, vault_path FROM nodes WHERE id = ? AND type = 'entity'"
      ).get(nodeId) as { id: string; name: string; vault_path: string | null } | undefined;
      if (!node?.vault_path?.startsWith('entities/')) continue;

      const otherNodeId = nodeId === sourceId ? targetId : sourceId;
      const other = this.ctx.db.prepare('SELECT name FROM nodes WHERE id = ?').get(otherNodeId) as { name: string } | undefined;
      if (!other) continue;

      const absolutePath = this.ctx.resolve(node.vault_path);
      if (!existsSync(absolutePath)) continue;

      let content = readFileSync(absolutePath, 'utf-8');
      const linkLine = `- [[${other.name}]] — *${label}*`;

      if (action === 'add') {
        if (content.includes(`[[${other.name}]]`)) continue;
        if (content.includes('## Relationships')) {
          const idx = content.indexOf('## Relationships');
          const nextSection = content.indexOf('\n## ', idx + 1);
          const insertAt = nextSection !== -1 ? nextSection : content.length;
          content = content.slice(0, insertAt).trimEnd() + '\n' + linkLine + '\n' + content.slice(insertAt);
        } else {
          content = content.trimEnd() + '\n\n## Relationships\n\n' + linkLine + '\n';
        }
      } else {
        // Match exact label to avoid deleting unrelated relationship lines between the same pair
        // (schema allows multiple edges with different labels between the same endpoints)
        const lineRegex = new RegExp(`^- \\[\\[${escapeRegex(other.name)}\\]\\] — \\*${escapeRegex(label)}\\*$\\n?`, 'gm');
        content = content.replace(lineRegex, '');
      }

      writeFileSync(absolutePath, content, 'utf-8');
      this.markAsAppWritten?.(node.vault_path);
      const stat = statSync(absolutePath);
      const hash = computeFileHash(absolutePath);
      this.ctx.db.prepare(
        'UPDATE nodes SET file_mtime = ?, file_size = ?, content_hash = ? WHERE id = ?'
      ).run(Math.floor(stat.mtimeMs), stat.size, hash, node.id);
    }
  }

  private handleEdgeDeletedWithData(sourceId: string, targetId: string, label: string): void {
    this.handleEdgeChanged(sourceId, targetId, label, 'remove');
  }

  private isEntityFilePath(relativePath: string): boolean {
    return relativePath.startsWith('entities/') && relativePath.endsWith('.md');
  }

  private handleEntityFileAdded(relativePath: string): void {
    // file:added fires for both new and existing files (watcher doesn't distinguish).
    // Guard: if a node already has this path bound, treat as content change.
    const bound = this.ctx.db.prepare(
      'SELECT id FROM nodes WHERE vault_path = ?'
    ).get(relativePath) as { id: string } | undefined;
    if (bound) {
      this.handleEntityFileChanged(relativePath);
      return;
    }
    // Unbound path — parse frontmatter and either bind by id or queue a new_file/unknown_id sync issue.
  }

  private handleEntityFileChanged(relativePath: string): void {
    // Update file metadata/content_hash, queue title mismatch issues, and trigger embedding re-index.
  }

  private handleEntityFileRemoved(relativePath: string): void {
    // Silently clear vault_path. Entity stays in DB. No notification.
    this.ctx.db.prepare(
      'UPDATE nodes SET vault_path = NULL, file_mtime = NULL, file_size = NULL, content_hash = NULL WHERE vault_path = ?'
    ).run(relativePath);
  }

  private derivePathWithCollision(name: string, nodeId: string): string {
    const base = deriveEntityPath(name);
    const absolutePath = this.ctx.resolve(base);

    if (!existsSync(absolutePath)) return base;

    const existing = this.ctx.db.prepare(
      'SELECT id FROM nodes WHERE vault_path = ?'
    ).get(base) as { id: string } | undefined;

    if (existing?.id === nodeId) return base;

    // Collision — append short hash from node ID
    const hash = nodeId.replace(/-/g, '').slice(0, 4);
    const slug = slugify(name);
    return `entities/${slug}_${hash}.md`;
  }

  private queryEdgesForNode(nodeId: string, nodeName: string): EntityEdgeInfo[] {
    const edges = this.ctx.db.prepare(
      'SELECT * FROM edges WHERE source_id = ? OR target_id = ?'
    ).all(nodeId, nodeId) as DbEdge[];

    return edges.map((e) => {
      if (e.source_id === nodeId) {
        const target = this.ctx.db.prepare('SELECT name FROM nodes WHERE id = ?').get(e.target_id) as { name: string } | undefined;
        return { targetName: target?.name ?? '?', label: e.label, direction: 'outgoing' as const };
      } else {
        const source = this.ctx.db.prepare('SELECT name FROM nodes WHERE id = ?').get(e.source_id) as { name: string } | undefined;
        return { sourceName: source?.name ?? '?', label: e.label, direction: 'incoming' as const };
      }
    });
  }

  private querySourcesForNode(nodeId: string): EntitySourceInfo[] {
    const rows = this.ctx.db.prepare(
      'SELECT es.resource_id, n.name, n.source_url FROM entity_sources es LEFT JOIN nodes n ON es.resource_id = n.id WHERE es.entity_id = ?'
    ).all(nodeId) as { resource_id: string; name: string | null; source_url: string | null }[];

    return rows.map((r) => ({
      name: r.name ?? 'Unknown source',
      url: r.source_url,
    }));
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/entity-files/entity-file-service.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add electron/entity-files/entity-file-service.ts tests/entity-files/entity-file-service.test.ts
git commit -m "feat(entity-files): EntityFileService with entity file reconciliation"
```

---

### Task 5: IPC Handlers for Sync Issues and Agent File Access

**Files:**
- Create: `electron/entity-files/ipc-handlers.ts`

- [ ] **Step 1: Implement IPC handlers**

Follow the pattern from existing IPC handlers in `electron/main.ts`. These handlers bridge the renderer and agent tools to the EntityFileService:

```ts
// electron/entity-files/ipc-handlers.ts
import { ipcMain } from 'electron';
import type { EntityFileService } from './entity-file-service';

export function registerEntityFileIpc(getService: () => EntityFileService | null): void {
  ipcMain.handle('entity-files:generate-all', async () => {
      const service = getService();
      if (!service) return { generated: 0 };
      return service.generateAll();
  });

  ipcMain.handle('entity-files:list-sync-issues', async () => {
    const service = getService();
    if (!service) return [];
    return service.listSyncIssues();
  });

  ipcMain.handle('entity-files:dismiss-sync-issue', async (_e, notificationId: string) => {
    const service = getService();
    if (!service) return;
    return service.dismissSyncIssue(notificationId);
  });

  ipcMain.handle('entity-files:resolve-notification', async (_e, notificationId: string, action: string) => {
    const service = getService();
    if (!service) return;
    return service.resolveNotification(notificationId, action);
  });

  ipcMain.handle('entity-files:read', async (_e, nodeId: string) => {
    const service = getService();
    if (!service) return null;
    return service.readEntityFile(nodeId);
  });

  ipcMain.handle('entity-files:append', async (_e, nodeId: string, text: string, expectedHash?: string) => {
    const service = getService();
    if (!service) throw new Error('EntityFileService not initialized');
    return service.appendEntityFile(nodeId, text, expectedHash);
  });

  ipcMain.handle('entity-files:patch', async (_e, nodeId: string, patch: unknown, expectedHash?: string) => {
    const service = getService();
    if (!service) throw new Error('EntityFileService not initialized');
    return service.patchEntityFile(nodeId, patch, expectedHash);
  });
}

export function unregisterEntityFileIpc(): void {
  ipcMain.removeHandler('entity-files:generate-all');
  ipcMain.removeHandler('entity-files:list-sync-issues');
  ipcMain.removeHandler('entity-files:dismiss-sync-issue');
  ipcMain.removeHandler('entity-files:resolve-notification');
  ipcMain.removeHandler('entity-files:read');
  ipcMain.removeHandler('entity-files:append');
  ipcMain.removeHandler('entity-files:patch');
}
```

- [ ] **Step 2: Add `generateAll`, sync issue, and agent file methods to EntityFileService**

Add to `electron/entity-files/entity-file-service.ts`:

```ts
  generateAll(): { generated: number } {
    const entities = this.ctx.db.prepare(
      "SELECT * FROM nodes WHERE type = 'entity' AND vault_path IS NULL"
    ).all() as DbNode[];

    let generated = 0;
    for (const node of entities) {
      this.generateFileForNode(node);
      generated++;
    }
    return { generated };
  }

  listSyncIssues(): SyncNotification[] {
    return this.syncIssueStore.listIssues();
  }

  dismissSyncIssue(notificationId: string): void {
    this.syncIssueStore.dismissIssue(notificationId);
  }

  readEntityFile(nodeId: string): { path: string; content: string; contentHash: string | null } | null {
    // Resolve node.vault_path, read file, return content + current content_hash.
    // Used by agents before append/patch.
  }

  appendEntityFile(nodeId: string, text: string, expectedHash?: string): { contentHash: string } {
    // Verify expectedHash if provided, append text, update file metadata,
    // markAsAppWritten, and trigger embedding re-index.
  }

  patchEntityFile(nodeId: string, patch: unknown, expectedHash?: string): { contentHash: string } {
    // Verify expectedHash if provided, apply a structured patch, update file metadata,
    // markAsAppWritten, and trigger embedding re-index.
  }

  resolveNotification(notificationId: string, action: string): void {
    // Actions are handled by IPC from renderer.
    // 'rename_entity' — update DB name from file title, then rename path if needed
    // 'revert_file_title' — rewrite title in file from DB
    // 'create_entity' — create entity node from file and insert frontmatter if missing
    // 'ignore_file' — persist dismissal for new file issue
    // 'delete_file' — destructive delete, requires UI confirmation
    // Implementation in Task 8 (link drift) and wired together in Task 10.
  }
```

- [ ] **Step 3: Commit**

```bash
git add electron/entity-files/ipc-handlers.ts electron/entity-files/entity-file-service.ts
git commit -m "feat(entity-files): add IPC for sync issues and agent file access"
```

---

### Task 6: External Edit Detection, Reindexing & Title Rename Review

**Files:**
- Modify: `electron/entity-files/entity-file-service.ts`
- Test: `tests/entity-files/entity-file-service.test.ts` (add cases)

- [ ] **Step 1: Write failing test for external edit detection**

Add to `tests/entity-files/entity-file-service.test.ts`:

```ts
import { writeFileSync } from 'fs';

describe('external edit detection', () => {
  it('detects title mismatch as a proposed rename issue', async () => {
    const nodeId = randomUUID();
    env.db.prepare(`
      INSERT INTO nodes (id, identifier, name, type, created_at, updated_at)
      VALUES (?, ?, 'Original Name', 'entity', datetime('now'), datetime('now'))
    `).run(nodeId, nodeId);

    // Generate file
    env.eventBus.emit({
      type: 'node:created',
      node: env.db.prepare('SELECT * FROM nodes WHERE id = ?').get(nodeId) as any,
    });
    await new Promise((r) => setTimeout(r, 600));

    // Simulate external edit: change the title in the file
    const filePath = join(env.vaultPath, 'entities', 'original_name.md');
    const content = readFileSync(filePath, 'utf-8');
    const modified = content.replace('title: Original Name', 'title: Changed Title');
    writeFileSync(filePath, modified, 'utf-8');

    const notifications = service.checkEntityFile('entities/original_name.md');
    expect(notifications).toHaveLength(1);
    expect(notifications[0].type).toBe('title_mismatch');
    expect(notifications[0].detail).toEqual({
      kind: 'title_mismatch',
      dbName: 'Original Name',
      fileTitle: 'Changed Title',
    });
  });

  it('returns empty for matching title', async () => {
    const nodeId = randomUUID();
    env.db.prepare(`
      INSERT INTO nodes (id, identifier, name, type, created_at, updated_at)
      VALUES (?, ?, 'Same Name', 'entity', datetime('now'), datetime('now'))
    `).run(nodeId, nodeId);

    env.eventBus.emit({
      type: 'node:created',
      node: env.db.prepare('SELECT * FROM nodes WHERE id = ?').get(nodeId) as any,
    });
    await new Promise((r) => setTimeout(r, 600));

    const notifications = service.checkEntityFile('entities/same_name.md');
    expect(notifications).toHaveLength(0);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/entity-files/entity-file-service.test.ts`
Expected: FAIL — `checkEntityFile` / metadata reindexing not defined

- [ ] **Step 3: Implement `checkEntityFile` and file metadata reindexing on EntityFileService**

Add to `electron/entity-files/entity-file-service.ts`:

```ts
  checkEntityFile(relativePath: string): SyncNotification[] {
    const absolutePath = this.ctx.resolve(relativePath);
    if (!existsSync(absolutePath)) return [];

    const content = readFileSync(absolutePath, 'utf-8');
    const { id, title } = parseEntityFrontmatter(content);
    const notifications: SyncNotification[] = [];

    if (!id) {
      notifications.push({
        id: `new_file:${relativePath}`,
        type: 'new_file',
        filePath: relativePath,
        entityName: title,
        detectedAt: new Date().toISOString(),
        dismissed: false,
        detail: { kind: 'new_file', parsedTitle: title },
      });
      return notifications;
    }

    const node = this.ctx.db.prepare(
      'SELECT id, name FROM nodes WHERE id = ?'
    ).get(id) as { id: string; name: string } | undefined;

    if (!node) {
      notifications.push({
        id: `unknown_id:${relativePath}`,
        type: 'unknown_id',
        filePath: relativePath,
        entityName: title,
        detectedAt: new Date().toISOString(),
        dismissed: false,
        detail: { kind: 'unknown_id', fileId: id },
      });
      return notifications;
    }

    if (title && title !== node.name) {
      notifications.push({
        id: `title_mismatch:${relativePath}`,
        type: 'title_mismatch',
        filePath: relativePath,
        entityName: node.name,
        detectedAt: new Date().toISOString(),
        dismissed: false,
        detail: { kind: 'title_mismatch', dbName: node.name, fileTitle: title },
      });
    }

    return notifications;
  }

  updateEntityFileMetadata(relativePath: string): { nodeId: string | null; contentHash: string | null } {
    const absolutePath = this.ctx.resolve(relativePath);
    if (!existsSync(absolutePath)) return { nodeId: null, contentHash: null };

    const content = readFileSync(absolutePath, 'utf-8');
    const { id } = parseEntityFrontmatter(content);
    const stat = statSync(absolutePath);
    const hash = computeFileHash(absolutePath);

    if (id) {
      this.ctx.db.prepare(
        'UPDATE nodes SET file_mtime = ?, file_size = ?, content_hash = ?, updated_at = ? WHERE id = ?'
      ).run(Math.floor(stat.mtimeMs), stat.size, hash, new Date().toISOString(), id);

      // Emit a node update so embedding/search indexing can pick up the file body.
      const node = this.ctx.db.prepare('SELECT * FROM nodes WHERE id = ?').get(id) as DbNode | undefined;
      if (node) this.ctx.eventBus.emit({ type: 'node:updated', node, changes: ['content_hash'] });
    }

    return { nodeId: id, contentHash: hash };
  }
```

Add the import at the top of the file:

```ts
import type { SyncNotification } from '../../src/shared/entity-sync-types';
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/entity-files/entity-file-service.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add electron/entity-files/entity-file-service.ts tests/entity-files/entity-file-service.test.ts
git commit -m "feat(entity-files): external edit detection with title mismatch"
```

---

### Task 7: Reconciliation Extension & Resource Detection Guard

**Files:**
- Modify: `electron/vault/reconciliation.ts`
- Modify: `electron/vault/handlers/resource-detection-handler.ts`
- Test: `tests/entity-files/reconciliation-entities.test.ts`

- [ ] **Step 1: Write failing test**

```ts
// tests/entity-files/reconciliation-entities.test.ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Database from 'better-sqlite3';
import { mkdirSync, writeFileSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { randomUUID } from 'crypto';
import { VaultEventBus, type VaultEvent } from '../../electron/vault/event-bus';
import { reconcileVault } from '../../electron/vault/reconciliation';
import type { VaultContext } from '../../electron/vault/vault-context';

function createTestVault() {
  const vaultPath = join(tmpdir(), `synapse-test-${randomUUID()}`);
  mkdirSync(join(vaultPath, '.kg'), { recursive: true });
  mkdirSync(join(vaultPath, 'notes'), { recursive: true });
  mkdirSync(join(vaultPath, 'entities'), { recursive: true });

  const db = new Database(':memory:');
  db.exec(`
    CREATE TABLE nodes (
      id TEXT PRIMARY KEY, identifier TEXT, name TEXT NOT NULL,
      type TEXT NOT NULL DEFAULT 'entity', label TEXT, summary TEXT,
      properties TEXT NOT NULL DEFAULT '{}', x REAL, y REAL,
      color TEXT, size REAL DEFAULT 1.0, source_url TEXT,
      vault_path TEXT, file_mtime INTEGER, file_size INTEGER,
      content_hash TEXT, created_at TEXT, updated_at TEXT
    );
    CREATE TABLE edges (id TEXT PRIMARY KEY, source_id TEXT, target_id TEXT,
      label TEXT NOT NULL, type TEXT DEFAULT 'related', properties TEXT DEFAULT '{}',
      weight REAL DEFAULT 1.0, directed INTEGER DEFAULT 1, created_at TEXT, updated_at TEXT);
    CREATE TABLE note_search (node_id TEXT PRIMARY KEY, title TEXT, body TEXT);
    CREATE TABLE entity_sources (entity_id TEXT, resource_id TEXT, relation_type TEXT,
      location TEXT, created_at TEXT);
  `);

  const events: VaultEvent[] = [];
  const eventBus = new VaultEventBus();
  eventBus.on('node:created', (e) => events.push(e));

  const ctx: VaultContext = {
    path: vaultPath, kgPath: join(vaultPath, '.kg'), name: 'test', id: 'test',
    db, config: { name: 'test', id: 'test', schemaVersion: 1, createdAt: '' },
    eventBus, sandboxConfig: {} as any,
    resolve: (rel: string) => join(vaultPath, rel),
    relative: (abs: string) => abs.slice(vaultPath.length + 1),
  };

  return { vaultPath, db, eventBus, ctx, events, cleanup: () => rmSync(vaultPath, { recursive: true, force: true }) };
}

describe('reconciliation — entities/', () => {
  let env: ReturnType<typeof createTestVault>;

  beforeEach(() => { env = createTestVault(); });
  afterEach(() => { env.cleanup(); });

  it('detects new entity file with id and re-binds existing node', () => {
    const nodeId = randomUUID();
    env.db.prepare(`
      INSERT INTO nodes (id, identifier, name, type, created_at, updated_at)
      VALUES (?, ?, 'Test Entity', 'entity', datetime('now'), datetime('now'))
    `).run(nodeId, nodeId);

    writeFileSync(
      join(env.vaultPath, 'entities', 'test_entity.md'),
      `---\nid: ${nodeId}\ntitle: Test Entity\n---\n\n# Test Entity\n`
    );

    const result = reconcileVault(env.ctx);
    expect(result.newFiles).toBe(0); // Not counted as generic new file

    const row = env.db.prepare('SELECT vault_path FROM nodes WHERE id = ?').get(nodeId) as any;
    expect(row.vault_path).toBe('entities/test_entity.md');
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/entity-files/reconciliation-entities.test.ts`
Expected: FAIL — entity files not handled in reconciliation

- [ ] **Step 3: Extend reconciliation Phase 5**

In `electron/vault/reconciliation.ts`, modify the Phase 5 loop (around line 157). Add an entity branch before the generic `file:added` emit. `entities/*.md` must not fall through to generic resource detection:

```ts
  // ── Phase 5: Handle remaining new files ───────────────────────────
  for (const file of newFiles) {
    if (file.relativePath.startsWith('notes/') && file.relativePath.endsWith('.md')) {
      createNoteFromFile(ctx, file);
      result.newNotes++;
    } else if (file.relativePath.startsWith('entities/') && file.relativePath.endsWith('.md')) {
      handleNewEntityFile(ctx, file);
      // Don't count as newFiles — entity handling is separate
    } else {
      ctx.eventBus.emit({ type: 'file:added', relativePath: file.relativePath });
      result.newFiles++;
    }
  }
```

Add the `handleNewEntityFile` function at the bottom of the file:

```ts
function handleNewEntityFile(ctx: VaultContext, file: ClassifiedFile): void {
  // Reconciliation only handles ID-based re-binding.
  // All other entity file logic (title mismatches, unknown IDs, new files without frontmatter,
  // link drift) is owned by EntityFileService.reconcileEntityFiles() which runs after the
  // service is registered. Do NOT emit file:added here — handlers don't exist yet.
  const content = readFileSync(file.absolutePath, 'utf-8');
  const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (!match) return; // No frontmatter — EntityFileService handles after registration

  let fileId: string | null = null;
  for (const line of match[1].split('\n')) {
    const idx = line.indexOf(':');
    if (idx > 0 && line.slice(0, idx).trim() === 'id') {
      fileId = line.slice(idx + 1).trim();
      break;
    }
  }

  if (fileId) {
    const node = ctx.db.prepare('SELECT id FROM nodes WHERE id = ?').get(fileId) as { id: string } | undefined;
    if (node) {
      const hash = computeFileHash(file.absolutePath);
      ctx.db.prepare(
        'UPDATE nodes SET vault_path = ?, file_mtime = ?, file_size = ?, content_hash = ? WHERE id = ?'
      ).run(file.relativePath, file.mtime, file.size, hash, fileId);
    }
  }
  // Unknown IDs and files without frontmatter: EntityFileService detects these
  // in its own reconcileEntityFiles() pass after registration.
}
```

Add the import for `readFileSync` if not already imported (it is — line 1).

Also update modified-file handling:

- For modified `entities/*.md`, update file metadata/content_hash, emit `node:updated` with `changes: ['content_hash']`, and queue title/link issues through `EntityFileService`.
- For missing entity files, silently clear `vault_path` on the DB node. No notification — user regenerates via settings.

In `ResourceDetectionHandler`, return early for `entities/*.md` in `handleFileAdded`, `handleFileRemoved`, and `handleFileChanged`.

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/entity-files/reconciliation-entities.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add electron/vault/reconciliation.ts electron/vault/handlers/resource-detection-handler.ts tests/entity-files/reconciliation-entities.test.ts
git commit -m "feat(entity-files): extend reconciliation for entities/ directory"
```

---

### Task 8: Link Drift Detection with Low-Noise Relationship Suggestions

**Files:**
- Create: `electron/entity-files/link-drift.ts`
- Test: `tests/entity-files/link-drift.test.ts`

- [ ] **Step 1: Write failing tests**

```ts
// tests/entity-files/link-drift.test.ts
import { describe, it, expect } from 'vitest';
import Database from 'better-sqlite3';
import { resolveEntityLinks } from '../../electron/entity-files/link-drift';

function createDb() {
  const db = new Database(':memory:');
  db.exec(`
    CREATE TABLE nodes (id TEXT PRIMARY KEY, name TEXT NOT NULL, type TEXT DEFAULT 'entity');
    CREATE TABLE entity_aliases (id TEXT, node_id TEXT, alias TEXT, alias_lower TEXT);
    CREATE TABLE edges (id TEXT PRIMARY KEY, source_id TEXT, target_id TEXT, label TEXT NOT NULL,
      type TEXT DEFAULT 'related', properties TEXT DEFAULT '{}', weight REAL DEFAULT 1.0,
      directed INTEGER DEFAULT 1, created_at TEXT, updated_at TEXT);
  `);
  return db;
}

describe('resolveEntityLinks', () => {
  it('detects broken link when target was renamed', () => {
    const db = createDb();
    db.prepare("INSERT INTO nodes VALUES ('n1', 'TensorFlow 2.0', 'entity')").run();
    db.prepare("INSERT INTO entity_aliases VALUES ('a1', 'n1', 'TensorFlow', 'tensorflow')").run();

    const content = '## Relationships\n\n- [[TensorFlow]] — *uses*\n';
    const items = resolveEntityLinks(db, 'node-0', content);

    expect(items).toHaveLength(1);
    expect(items[0].type).toBe('link_broken');
    expect(items[0].linkText).toBe('TensorFlow');
    expect(items[0].suggestedFix).toBe('TensorFlow 2.0');
  });

  it('detects dead link when target was deleted', () => {
    const db = createDb();
    const content = '## Relationships\n\n- [[Nonexistent]] — *uses*\n';
    const items = resolveEntityLinks(db, 'node-0', content);

    expect(items).toHaveLength(1);
    expect(items[0].type).toBe('link_dead');
    expect(items[0].linkText).toBe('Nonexistent');
  });

  it('detects missing relationship from DB edge only when completeness checks are enabled', () => {
    const db = createDb();
    db.prepare("INSERT INTO nodes VALUES ('n1', 'PyTorch', 'entity')").run();
    db.prepare("INSERT INTO nodes VALUES ('n0', 'ML', 'entity')").run();
    db.prepare("INSERT INTO edges VALUES ('e1', 'n0', 'n1', 'uses', 'related', '{}', 1, 1, '', '')").run();

    const content = '## Relationships\n\n';
    const items = resolveEntityLinks(db, 'n0', content, { includeMissingRelationships: true });

    expect(items).toHaveLength(1);
    expect(items[0].type).toBe('link_missing');
    expect(items[0].linkText).toBe('PyTorch');
    expect(items[0].edgeLabel).toBe('uses');
  });

  it('returns empty when all links are valid', () => {
    const db = createDb();
    db.prepare("INSERT INTO nodes VALUES ('n1', 'PyTorch', 'entity')").run();

    const content = '## Relationships\n\n- [[PyTorch]] — *uses*\n';
    const items = resolveEntityLinks(db, 'node-0', content);

    expect(items).toHaveLength(0);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/entity-files/link-drift.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: Implement**

```ts
// electron/entity-files/link-drift.ts
import type Database from 'better-sqlite3';

export interface LinkDriftItem {
  type: 'link_broken' | 'link_dead' | 'link_missing';
  linkText: string;
  suggestedFix: string | null;
  edgeLabel?: string;
}

export function resolveEntityLinks(
  db: Database.Database,
  nodeId: string,
  fileContent: string,
  options: { includeMissingRelationships?: boolean } = {}
): LinkDriftItem[] {
  const items: LinkDriftItem[] = [];
  const wikiLinkRegex = /\[\[([^\]]+)\]\]/g;

  // Extract all wiki-links from the content
  const fileLinks = new Set<string>();
  let match;
  while ((match = wikiLinkRegex.exec(fileContent)) !== null) {
    const label = match[1].split('|')[0].trim();
    if (label) fileLinks.add(label);
  }

  // Check each wiki-link
  for (const linkText of fileLinks) {
    const exactMatch = db.prepare(
      "SELECT id, name FROM nodes WHERE name = ? AND type = 'entity'"
    ).get(linkText) as { id: string; name: string } | undefined;

    if (exactMatch) continue; // Link is valid

    // Check aliases
    const aliasMatch = db.prepare(
      'SELECT n.id, n.name FROM entity_aliases ea JOIN nodes n ON ea.node_id = n.id WHERE ea.alias_lower = ?'
    ).get(linkText.toLowerCase()) as { id: string; name: string } | undefined;

    if (aliasMatch) {
      items.push({
        type: 'link_broken',
        linkText,
        suggestedFix: aliasMatch.name,
      });
    } else {
      items.push({
        type: 'link_dead',
        linkText,
        suggestedFix: null,
      });
    }
  }

  // Optional completeness check. Disabled by default to avoid badge noise:
  // entity files are working memory, not required mirrors of every DB edge.
  if (options.includeMissingRelationships) {
    const edges = db.prepare(
      'SELECT e.*, n.name as other_name FROM edges e JOIN nodes n ON (CASE WHEN e.source_id = ? THEN e.target_id ELSE e.source_id END) = n.id WHERE (e.source_id = ? OR e.target_id = ?) AND n.type = ?'
    ).all(nodeId, nodeId, nodeId, 'entity') as (any & { other_name: string })[];

    for (const edge of edges) {
      if (!fileLinks.has(edge.other_name)) {
        items.push({
          type: 'link_missing',
          linkText: edge.other_name,
          suggestedFix: `- [[${edge.other_name}]] — *${edge.label}*`,
          edgeLabel: edge.label,
        });
      }
    }
  }

  return items;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/entity-files/link-drift.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add electron/entity-files/link-drift.ts tests/entity-files/link-drift.test.ts
git commit -m "feat(entity-files): link drift detection for wiki-links"
```

---

### Task 9: UI — LeftPanel Extension & ActivityBar Sync Icon

**Files:**
- Modify: `src/graph/store/ui-store.ts:5`
- Modify: `src/ui/components/layout/ActivityBar.tsx`
- Modify: `src/ui/components/layout/LeftSidebar.tsx`

- [ ] **Step 1: Add 'sync' to LeftPanel type**

In `src/graph/store/ui-store.ts`, change line 5:

```ts
export type LeftPanel = 'none' | 'explorer' | 'agents' | 'artifacts' | 'sync';
```

- [ ] **Step 2: Add Sync icon with badge to ActivityBar**

In `src/ui/components/layout/ActivityBar.tsx`, add the icon component and ITEMS entry:

```tsx
import { useEntitySyncStore } from '../../../graph/store/entity-sync-store';

const SyncIcon = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M21.5 2v6h-6M2.5 22v-6h6"/>
    <path d="M2.5 11.5a10 10 0 0 1 18.8-4.3M21.5 12.5a10 10 0 0 1-18.8 4.2"/>
  </svg>
);
```

Update the ITEMS array to add the sync entry:

```tsx
const ITEMS: ActivityBarItem[] = [
  { panel: 'explorer', title: 'Explorer', icon: <FolderIcon /> },
  { panel: 'agents', title: 'Agents', icon: <AgentsIcon /> },
  { panel: 'artifacts' as const, title: 'Artifacts', icon: <ArtifactsIcon /> },
  { panel: 'sync', title: 'Sync', icon: <SyncIcon /> },
];
```

Add a badge in the render. Replace the button in the `.map()` with:

```tsx
{ITEMS.map((item) => {
  const isSyncWithBadge = item.panel === 'sync';
  return (
    <button
      key={item.panel}
      onClick={() => setLeftPanel(item.panel)}
      className={`relative p-1.5 rounded transition-colors ${
        leftPanel === item.panel
          ? 'bg-indigo-600 text-white'
          : 'text-zinc-400 hover:text-zinc-200 hover:bg-zinc-700'
      }`}
      title={leftPanel === item.panel ? `Close ${item.title}` : `Open ${item.title}`}
    >
      {item.icon}
      {isSyncWithBadge && <SyncBadge />}
    </button>
  );
})}
```

Add the SyncBadge component:

```tsx
function SyncBadge() {
  const count = useEntitySyncStore((s) => s.notifications.filter((n) => !n.dismissed).length);
  if (count === 0) return null;
  return (
    <span className="absolute -top-1 -right-1 min-w-[14px] h-[14px] flex items-center justify-center rounded-full bg-red-500 text-[9px] font-bold text-white px-0.5">
      {count > 99 ? '99+' : count}
    </span>
  );
}
```

- [ ] **Step 3: Add EntitySyncPanel to LeftSidebar**

In `src/ui/components/layout/LeftSidebar.tsx`, add the import and panel route:

```tsx
import { EntitySyncPanel } from '../entity-sync/EntitySyncPanel';
```

Add inside the panel content div, after the artifacts line:

```tsx
{leftPanel === 'sync' && <EntitySyncPanel />}
```

- [ ] **Step 4: Commit**

```bash
git add src/graph/store/ui-store.ts src/ui/components/layout/ActivityBar.tsx src/ui/components/layout/LeftSidebar.tsx
git commit -m "feat(entity-files): add Sync panel to activity bar with badge"
```

---

### Task 10: UI — EntitySyncPanel & Notification Cards

**Files:**
- Create: `src/ui/components/entity-sync/EntitySyncPanel.tsx`
- Create: `src/ui/components/entity-sync/EntitySyncCard.tsx`

- [ ] **Step 1: Create EntitySyncCard**

```tsx
// src/ui/components/entity-sync/EntitySyncCard.tsx
import type { SyncNotification } from '../../../shared/entity-sync-types';

const BADGE_STYLES = {
  title_mismatch: { bg: 'bg-amber-800 text-amber-200', label: 'Title mismatch' },
  new_file: { bg: 'bg-emerald-800 text-emerald-200', label: 'New file' },
  unknown_id: { bg: 'bg-red-800 text-red-200', label: 'Unknown ID' },
  link_broken: { bg: 'bg-amber-800 text-amber-200', label: 'Broken link' },
  link_dead: { bg: 'bg-red-800 text-red-200', label: 'Dead link' },
  link_missing: { bg: 'bg-blue-800 text-blue-200', label: 'Relationship suggestion' },
} as const;

interface Props {
  notification: SyncNotification;
  onAction: (id: string, action: string) => void;
}

export function EntitySyncCard({ notification, onAction }: Props) {
  const n = notification;
  const style = BADGE_STYLES[n.type];

  return (
    <div className="rounded border border-zinc-700 bg-zinc-800/50 p-3 space-y-2">
      <div className="flex items-center gap-2">
        <span className={`text-[10px] px-1.5 py-0.5 rounded font-medium uppercase tracking-wide ${style.bg}`}>
          {style.label}
        </span>
        <span className="text-xs text-zinc-400 truncate">{n.filePath.split('/').pop()}</span>
      </div>

      {n.detail.kind === 'title_mismatch' && (
        <div className="text-xs space-y-1">
          <p className="text-zinc-400">
            DB: <span className="text-zinc-200">"{n.detail.dbName}"</span>
          </p>
          <p className="text-zinc-400">
            File: <span className="text-zinc-200">"{n.detail.fileTitle}"</span>
          </p>
          <div className="flex gap-1 pt-1">
            <button onClick={() => onAction(n.id, 'rename_entity')} className="text-xs px-2 py-1 bg-indigo-600 text-white rounded hover:bg-indigo-500">Rename entity</button>
            <button onClick={() => onAction(n.id, 'revert_file_title')} className="text-xs px-2 py-1 bg-zinc-700 text-zinc-300 rounded hover:bg-zinc-600">Revert file title</button>
            <button onClick={() => onAction(n.id, 'open_file')} className="text-xs px-2 py-1 bg-zinc-700 text-zinc-300 rounded hover:bg-zinc-600">Open file</button>
            <button onClick={() => onAction(n.id, 'dismiss')} className="text-xs px-2 py-1 bg-zinc-700 text-zinc-400 rounded hover:bg-zinc-600">Dismiss</button>
          </div>
        </div>
      )}

      {n.detail.kind === 'new_file' && (
        <div className="text-xs space-y-1">
          <p className="text-zinc-400">
            Title: <span className="text-zinc-200">"{n.detail.parsedTitle ?? 'Untitled'}"</span>
          </p>
          <div className="flex gap-1 pt-1">
            <button onClick={() => onAction(n.id, 'create_entity')} className="text-xs px-2 py-1 bg-indigo-600 text-white rounded hover:bg-indigo-500">Create entity</button>
            <button onClick={() => onAction(n.id, 'ignore_file')} className="text-xs px-2 py-1 bg-zinc-700 text-zinc-300 rounded hover:bg-zinc-600">Ignore file</button>
            <button onClick={() => onAction(n.id, 'delete_file')} className="text-xs px-2 py-1 bg-zinc-700 text-zinc-300 rounded hover:bg-zinc-600">Delete file</button>
          </div>
        </div>
      )}

      {n.detail.kind === 'unknown_id' && (
        <div className="text-xs space-y-1">
          <p className="text-zinc-400">References unknown node ID</p>
          <div className="flex gap-1 pt-1">
            <button onClick={() => onAction(n.id, 'delete_file')} className="text-xs px-2 py-1 bg-zinc-700 text-zinc-300 rounded hover:bg-zinc-600">Delete file</button>
            <button onClick={() => onAction(n.id, 'dismiss')} className="text-xs px-2 py-1 bg-zinc-700 text-zinc-400 rounded hover:bg-zinc-600">Dismiss</button>
          </div>
        </div>
      )}

      {(n.detail.kind === 'link_broken' || n.detail.kind === 'link_dead' || n.detail.kind === 'link_missing') && (
        <div className="text-xs space-y-1">
          <p className="text-zinc-400">
            {n.detail.kind === 'link_broken' && <>[[{n.detail.linkText}]] → [[{n.detail.suggestedFix}]]</>}
            {n.detail.kind === 'link_dead' && <>[[{n.detail.linkText}]] — entity was deleted</>}
            {n.detail.kind === 'link_missing' && <>Missing: [[{n.detail.linkText}]] — *{n.detail.edgeLabel}*</>}
          </p>
          <div className="flex gap-1 pt-1">
            {n.detail.kind === 'link_broken' && (
              <button onClick={() => onAction(n.id, 'fix_link')} className="text-xs px-2 py-1 bg-indigo-600 text-white rounded hover:bg-indigo-500">Fix</button>
            )}
            {n.detail.kind === 'link_dead' && (
              <>
                <button onClick={() => onAction(n.id, 'remove_line')} className="text-xs px-2 py-1 bg-zinc-700 text-zinc-300 rounded hover:bg-zinc-600">Remove line</button>
                <button onClick={() => onAction(n.id, 'keep_as_text')} className="text-xs px-2 py-1 bg-zinc-700 text-zinc-300 rounded hover:bg-zinc-600">Keep as text</button>
              </>
            )}
            {n.detail.kind === 'link_missing' && (
              <button onClick={() => onAction(n.id, 'add_to_file')} className="text-xs px-2 py-1 bg-indigo-600 text-white rounded hover:bg-indigo-500">Add to file</button>
            )}
            <button onClick={() => onAction(n.id, 'dismiss')} className="text-xs px-2 py-1 bg-zinc-700 text-zinc-400 rounded hover:bg-zinc-600">Ignore</button>
          </div>
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Create EntitySyncPanel**

```tsx
// src/ui/components/entity-sync/EntitySyncPanel.tsx
import { useEffect } from 'react';
import { useEntitySyncStore } from '../../../graph/store/entity-sync-store';
import { EntitySyncCard } from './EntitySyncCard';
import { entityFiles } from '@platform';

export function EntitySyncPanel() {
  const notifications = useEntitySyncStore((s) => s.notifications.filter((n) => !n.dismissed));
  const setNotifications = useEntitySyncStore((s) => s.setNotifications);

  useEffect(() => {
    entityFiles.listSyncIssues().then(setNotifications).catch(() => {});
    return entityFiles.onSyncIssuesChanged((issues) => setNotifications(issues));
  }, [setNotifications]);

  const handleAction = async (notificationId: string, action: string) => {
    try {
      if (action === 'dismiss') {
        await entityFiles.dismissSyncIssue(notificationId);
      } else {
        await entityFiles.resolveNotification(notificationId, action);
      }
      setNotifications(await entityFiles.listSyncIssues());
      return;
    } catch (err) {
      console.error('[EntitySyncPanel] action failed:', err);
    }
  };

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center justify-between px-3 py-2 border-b border-zinc-700">
        <h3 className="text-xs font-medium text-zinc-300 uppercase tracking-wide">
          Entity Sync
        </h3>
        {notifications.length > 0 && (
          <span className="text-[10px] text-zinc-500">{notifications.length} pending</span>
        )}
      </div>

      <div className="flex-1 overflow-y-auto p-2 space-y-2">
        {notifications.length === 0 ? (
          <p className="text-xs text-zinc-500 text-center py-8">No sync issues</p>
        ) : (
          notifications.map((n) => (
            <EntitySyncCard key={n.id} notification={n} onAction={handleAction} />
          ))
        )}
      </div>
    </div>
  );
}
```

- [ ] **Step 3: Commit**

```bash
git add src/ui/components/entity-sync/EntitySyncPanel.tsx src/ui/components/entity-sync/EntitySyncCard.tsx
git commit -m "feat(entity-files): EntitySyncPanel and notification card UI"
```

---

### Task 11: Agent Tool Seam & RAG Integration

**Files:**
- Modify: `src/commands/types.ts` — add `entityFiles?` to CommandContext
- Modify: `src/shared/chat-agent-tools.ts` — add tool definitions
- Modify: `src/commands/chat-tool-executor.ts` — add executor cases
- Modify: `src/commands/rag-commands.ts` — add entity file excerpt branch

- [ ] **Step 1: Add entityFiles to CommandContext**

In `src/commands/types.ts`, add to the CommandContext interface:

```ts
  entityFiles?: PlatformEntityFiles;
```

Import `PlatformEntityFiles` from `../platform/types`.

- [ ] **Step 2: Add entity file tool definitions**

In `src/shared/chat-agent-tools.ts`, add:

```ts
export const READ_ENTITY_FILE_TOOL: ToolDefinition = {
  name: 'read_entity_file',
  description: 'Read the full content of an entity\'s working memory file. Returns markdown body and content_hash for optimistic locking.',
  inputSchema: {
    type: 'object',
    properties: {
      node_id: { type: 'string', description: 'The entity node ID' },
    },
    required: ['node_id'],
  },
};

export const APPEND_ENTITY_FILE_TOOL: ToolDefinition = {
  name: 'append_entity_file',
  description: 'Append text to an entity\'s working memory file. Use after read_entity_file. Pass expected_hash for conflict detection.',
  inputSchema: {
    type: 'object',
    properties: {
      node_id: { type: 'string', description: 'The entity node ID' },
      text: { type: 'string', description: 'Markdown text to append to the entity file body' },
      expected_hash: { type: 'string', description: 'content_hash from read_entity_file. Fails if file changed since read.' },
    },
    required: ['node_id', 'text'],
  },
};

export const PATCH_ENTITY_FILE_TOOL: ToolDefinition = {
  name: 'patch_entity_file',
  description: 'Replace a section in an entity\'s working memory file. Use after read_entity_file. Pass expected_hash for conflict detection.',
  inputSchema: {
    type: 'object',
    properties: {
      node_id: { type: 'string', description: 'The entity node ID' },
      old_text: { type: 'string', description: 'Exact text to find and replace' },
      new_text: { type: 'string', description: 'Replacement text' },
      expected_hash: { type: 'string', description: 'content_hash from read_entity_file' },
    },
    required: ['node_id', 'old_text', 'new_text'],
  },
};

export const EXTENDED_ENTITY_FILE_TOOLS: ToolDefinition[] = [
  READ_ENTITY_FILE_TOOL, APPEND_ENTITY_FILE_TOOL, PATCH_ENTITY_FILE_TOOL,
];
```

Add `...EXTENDED_ENTITY_FILE_TOOLS` to `ALL_CHAT_AGENT_TOOLS`.

Add to classification sets:

```ts
// In READ_TOOLS:
'read_entity_file',
// In WRITE_TOOLS:
'append_entity_file', 'patch_entity_file',
```

- [ ] **Step 3: Add executor cases**

In `src/commands/chat-tool-executor.ts`, add:

```ts
  } else if (name === 'read_entity_file') {
    if (!ctx.entityFiles) return { content: 'Entity files not available', isError: true };
    const result = await ctx.entityFiles.read(input.node_id as string);
    if (!result) return { content: 'Entity file not found', isError: true };
    return { content: `# ${result.path}\n\ncontent_hash: ${result.contentHash}\n\n${result.content}` };
  } else if (name === 'append_entity_file') {
    if (!ctx.entityFiles) return { content: 'Entity files not available', isError: true };
    const result = await ctx.entityFiles.append(
      input.node_id as string, input.text as string, input.expected_hash as string | undefined
    );
    return { content: `Appended. New content_hash: ${result.contentHash}` };
  } else if (name === 'patch_entity_file') {
    if (!ctx.entityFiles) return { content: 'Entity files not available', isError: true };
    const result = await ctx.entityFiles.patch(
      input.node_id as string,
      { oldText: input.old_text, newText: input.new_text },
      input.expected_hash as string | undefined
    );
    return { content: `Patched. New content_hash: ${result.contentHash}` };
  }
```

- [ ] **Step 4: Add entity file branch in RAG**

In `src/commands/rag-commands.ts`, in `getSourceExcerpts()`, add before the `sourceContent` fallback:

```ts
  if (node.type === 'entity' && node.vault_path?.startsWith('entities/') && ctx.entityFiles) {
    const ef = await ctx.entityFiles.read(nodeId);
    if (ef?.content) return ef.content.slice(0, 2000);
  }
```

Without this, semantic search can match an entity by its file content but return no content to the model.

- [ ] **Step 5: Commit**

```bash
git add src/commands/types.ts src/shared/chat-agent-tools.ts src/commands/chat-tool-executor.ts src/commands/rag-commands.ts
git commit -m "feat(entity-files): wire agent tools and RAG integration"
```

---

### Task 12: Wire Into main.ts, scaffoldVault & Platform Layer

**Files:**
- Modify: `electron/main.ts`
- Modify: `electron/vault/vault-context.ts` — add `entities/` to `scaffoldVault()`
- Modify: `electron/embeddings/build-embedding-text.ts`
- Modify: `electron/vault/handlers/resource-detection-handler.ts`
- Modify: `src/platform/types.ts`
- Modify: `src/platform/electron/index.ts`
- Modify: `src/platform/chrome/index.ts`

- [ ] **Step 1: Add `entities/` to scaffoldVault()**

In `electron/vault/vault-context.ts`, add the entities directory creation after the notes directory (around line 83):

```ts
  const entitiesPath = join(vaultPath, 'entities');
  mkdirSync(entitiesPath, { recursive: true });
```

This ensures new vaults have `entities/` from the start.

- [ ] **Step 2: Add PlatformEntityFiles interface**

In `src/platform/types.ts`, add near the other platform interfaces (around line 52):

```ts
export interface PlatformEntityFiles {
  generateAll(): Promise<{ generated: number }>;
  listSyncIssues(): Promise<SyncNotification[]>;
  dismissSyncIssue(id: string): Promise<void>;
  resolveNotification(id: string, action: string): Promise<void>;
  read(nodeId: string): Promise<{ path: string; content: string; contentHash: string | null } | null>;
  append(nodeId: string, text: string, expectedHash?: string): Promise<{ contentHash: string }>;
  patch(nodeId: string, patch: unknown, expectedHash?: string): Promise<{ contentHash: string }>;
  onSyncIssuesChanged(cb: (issues: SyncNotification[]) => void): () => void;
}
```

Import `SyncNotification` from `src/shared/entity-sync-types`.

- [ ] **Step 3: Add electron implementation**

In `src/platform/electron/index.ts`, add:

```ts
import type { PlatformEntityFiles } from '../types';

const entityFilesImpl: PlatformEntityFiles = {
  async generateAll() {
    return window.electronIPC.invoke('entity-files:generate-all');
  },
  async listSyncIssues() {
    return window.electronIPC.invoke('entity-files:list-sync-issues');
  },
  async dismissSyncIssue(id: string) {
    return window.electronIPC.invoke('entity-files:dismiss-sync-issue', id);
  },
  async resolveNotification(id: string, action: string) {
    return window.electronIPC.invoke('entity-files:resolve-notification', id, action);
  },
  async read(nodeId: string) {
    return window.electronIPC.invoke('entity-files:read', nodeId);
  },
  async append(nodeId: string, text: string, expectedHash?: string) {
    return window.electronIPC.invoke('entity-files:append', nodeId, text, expectedHash);
  },
  async patch(nodeId: string, patch: unknown, expectedHash?: string) {
    return window.electronIPC.invoke('entity-files:patch', nodeId, patch, expectedHash);
  },
  onSyncIssuesChanged(cb) {
    return window.electronIPC.on('entity-sync:changed', (issues) => cb(issues as SyncNotification[]));
  },
};

export const entityFiles = entityFilesImpl;
```

- [ ] **Step 4: Add chrome stub**

In `src/platform/chrome/index.ts`, add:

```ts
export const entityFiles = {
  async generateAll() { return { generated: 0 }; },
  async listSyncIssues() { return []; },
  async dismissSyncIssue() {},
  async resolveNotification() {},
  async read() { return null; },
  async append() { throw new Error('Entity files are only available in Electron'); },
  async patch() { throw new Error('Entity files are only available in Electron'); },
  onSyncIssuesChanged() { return () => {}; },
};
```

- [ ] **Step 5: Wire EntityFileService into main.ts**

EntityFileService must be created in `registerVaultHandlers()` (line ~599), NOT in the `db:action` IPC handler where EmbeddingService lives. It goes after existing handler registration and before `fileWatcher.start()`.

Add imports at the top of `electron/main.ts`:

```ts
import { EntityFileService } from './entity-files/entity-file-service';
import { registerEntityFileIpc, unregisterEntityFileIpc } from './entity-files/ipc-handlers';
```

Add state variable near the other handler declarations (around line 593):

```ts
let entityFileService: EntityFileService | null = null;
```

In `registerVaultHandlers()` (around line 599), add after existing handler registration (line ~626) and before `fileWatcher = new VaultFileWatcher(...)` (line ~628):

```ts
  // Entity files — core feature, always active
  entityFileService = new EntityFileService(ctx);
  entityFileService.setFileWatcher((path) => fileWatcher?.markAsAppWritten(path));
  entityFileService.register(ctx.eventBus);
```

Note: `fileWatcher` is created on the next line, so `setFileWatcher` stores the callback — it's called later when the watcher exists. Alternatively, call `setFileWatcher` after `fileWatcher` is created.

Also update `electron/embeddings/build-embedding-text.ts` so entity nodes with `vault_path` under `entities/` include the entity file body in embedding text:

```ts
"{title}. {label/tags}. {summary}. {body first 500 chars}. [related] {neighbors}"
```

Add bulk edge handling in the `db:action` outcome handler (after the existing batch node handling at line ~222):

```ts
  // Handle bulk edge mutations from mutation.execute
  // MutationOutcome stores edges in the `node` field (collision.ts:40 uses `node: edge as unknown`).
  // Identify edge results by checking if identifier contains '->'.
  if (action === 'mutation.execute' && entityFileService && outcome.result) {
    const mutResult = outcome.result as { results?: Array<{ action: string; identifier: string; node?: Record<string, unknown> }> };
    for (const r of mutResult.results ?? []) {
      if (r.action === 'created' && r.identifier?.includes('->') && r.node) {
        const edge = r.node as unknown as DbEdge;
        ctx.eventBus.emit({ type: 'edge:created', edge });
      }
    }
  }
```

Register IPC in the startup section:

```ts
registerEntityFileIpc(() => entityFileService);
```

In `unregisterVaultHandlers()` (around line 760):

```ts
entityFileService?.unregister();
entityFileService = null;
```

And in cleanup:

```ts
unregisterEntityFileIpc();
```

- [ ] **Step 6: Commit**

```bash
git add electron/main.ts electron/vault/vault-context.ts src/platform/types.ts src/platform/electron/index.ts src/platform/chrome/index.ts
git commit -m "feat(entity-files): wire EntityFileService into main process and platform layer"
```

---

### Task 13: Notification Action Resolution

**Files:**
- Modify: `electron/entity-files/entity-file-service.ts`

- [ ] **Step 1: Implement resolveNotification**

Replace the stub `resolveNotification` method in `EntityFileService` with an implementation that looks up the sync issue by ID from `syncIssueStore`. Do not parse `filePath` by splitting on `:`; file paths and link text can contain punctuation. The issue record is the source of truth for file path, node ID, link text, and suggested fix.

```ts
  resolveNotification(notificationId: string, action: string): void {
    const issue = this.syncIssueStore.getIssue(notificationId);
    if (!issue) return;

    if (action === 'rename_entity') {
      this.renameEntityFromFileTitle(issue);
    } else if (action === 'revert_file_title') {
      this.revertFileTitle(issue);
    } else if (action === 'create_entity') {
      this.createEntityFromFile(issue.filePath);
    } else if (action === 'ignore_file') {
      this.syncIssueStore.dismissIssue(notificationId);
    } else if (action === 'delete_file') {
      this.deleteEntityFileWithConfirmationAlreadyHandled(issue.filePath);
    } else if (action === 'fix_link') {
      this.fixBrokenLink(issue);
    } else if (action === 'remove_line') {
      this.removeLinkLine(issue);
    } else if (action === 'keep_as_text') {
      this.keepLinkAsText(issue);
    } else if (action === 'add_to_file') {
      this.addMissingLink(issue);
    }

    this.syncIssueStore.removeIssue(notificationId);
    this.broadcastSyncIssuesChanged();
  }
```

Implementation details:

- `createEntityFromFile()` must insert a full frontmatter block when the file has none, not only replace an existing `---` line.
- `renameEntityFromFileTitle()` updates `nodes.name`, then uses the existing rename path logic to update the filename/frontmatter while preserving the body.
- `deleteEntityFile()` removes the file from disk. Node deletion and merge both use this directly.
- Link actions must update file metadata/content_hash and trigger embedding re-index after writing.
- `addMissingLink()` is only shown when relationship completeness checks are enabled.

- [ ] **Step 2: Commit**

```bash
git add electron/entity-files/entity-file-service.ts
git commit -m "feat(entity-files): implement notification action resolution"
```

---

### Task 14: Build Verification & Cleanup

**Files:** None new — verification only

- [ ] **Step 1: Run all entity-files tests**

Run: `npx vitest run tests/entity-files/`
Expected: All tests PASS

- [ ] **Step 2: Run the full test suite**

Run: `npx vitest run`
Expected: No regressions

- [ ] **Step 3: Build electron**

Run: `npm run build:electron`
Expected: Build succeeds with no type errors

- [ ] **Step 4: Smoke test**

Run: `npx electron .`
- Create a new vault — verify `entities/` directory exists alongside `notes/`
- Check that the Sync icon appears in the activity bar (no badge when empty)
- Click the Sync icon — panel shows "No sync issues"
- Create a new entity via extraction — verify `.md` file appears in `entities/`
- Delete the entity — verify file is removed from `entities/`

- [ ] **Step 5: Final commit**

```bash
git add -A
git commit -m "feat(entity-files): core entity working-memory files

- Core feature: entities/ created with every vault, no opt-in toggle
- scaffoldVault() creates entities/ alongside notes/
- No migration: development-only, new vaults get entities/ from scaffoldVault()
- slugify utility for stable, cross-platform filenames
- EntityFileService: DB-owned scaffolding, agent/user-owned body
- Minimal frontmatter (id + title), body seeded at creation
- Edge-triggered relationship updates on edge create/delete
- Agent read/append/patch access with content_hash guards
- External edit detection with reindexing and reviewed title rename flow
- Reconciliation extension for entities/ directory
- Resource detection guard for entities/*.md
- Link drift detection: broken/dead links plus opt-in relationship suggestions
- Entity file body included in embeddings
- Sync panel in left sidebar with badge count
- Main-process sync issue store with renderer Zustand cache
- Platform interface with chrome stub"
```
