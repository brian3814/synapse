# DB Schema Cleanup & MCP Schema-Drift Fix — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remove 6 dead tables and ~14 dead/write-only columns from the Synapse SQLite schema (migration 014), and fix the latent bug where `packages/synapse-mcp` initializes vaults from a forked, drifted schema copy by making it run the canonical migrations.

**Architecture:** Code-first, schema-last. Tasks 2–7 remove every read/write of doomed schema from app code — each commit stays compatible with the *current* schema (omitting nullable/defaulted columns is always legal). Task 8 then lands migration 014, which must succeed on three vault flavors: healthy app vaults (schema v13), drifted MCP-initialized vaults (stamped v11, missing 5 tables, wrong-shaped embedding tables), and fresh DBs. Task 9 deletes the forked schema in synapse-mcp and routes its `initVault` through the canonical migration runner via the existing `setEngine()` seam.

**Tech Stack:** TypeScript, SQLite (better-sqlite3 12.x in Electron/MCP, wa-sqlite 1.x in deprecated Chrome build), vitest 4, esbuild (MCP bundle).

**Plan home:** This file lives at `/tmp/synapse-plans/2026-06-10-db-schema-cleanup.md` because macOS revoked Desktop file access mid-session. Task 0 copies it to `docs/superpowers/plans/`.

---

## Audit findings being fixed (evidence)

**Dead tables (no feature reads or writes; verified by grep + call-chain tracing at `ea31fee`):**

| Table | Created in | Evidence |
|---|---|---|
| `extraction_log` | 001 | No query module, no repository, no INSERT anywhere |
| `note_folders` | 001 | Only reference is its own CREATE TABLE (`001-initial-schema.ts:144`) |
| `indexed_files` | 004 | Plumbing exists (queries/db-client/action-handler) but zero feature callers; superseded by `nodes.vault_path/file_mtime/file_size/content_hash` + `electron/vault/reconciliation.ts` |
| `memory_semantic` | 008 | 7 functions in `memory-queries.ts` with zero callers; memory lives in `.kg/agent/memory/` files (`docs/memory-harness.md`) |
| `memory_episodic` | 008 | Zero callers of `addEpisodic`/`getRecentEpisodic`/`clearAllEpisodic`; episodic summaries are file-based via `memory-extractor.ts` → `writeMemory()` |
| `embedding_dismissals` | 009 | Zero references outside its CREATE TABLE; dismissal feature never built |

**Dead/write-only columns:** `chat_sessions.preset_id` (never written/read; re-added every boot by ensure-block in `migrations/index.ts:135-138`), `chat_messages.rag_context` (no caller passes it, nothing reads it), `nodes.z` (layout persists only x,y — `spatial-queries.ts:27`), `nodes.content_type` (written, zero readers), `nodes.folder_path` (always `''`; note hierarchy derives from `vault_path`; readers are pass-through mappers only), `edges.source_url` (written by extraction; provenance display uses `edge_sources` instead), `ontology_node_types.{is_default,parent_type,properties_schema}`, `ontology_edge_types.{source_types,target_types,properties_schema}` (features never built), `note_attachments.source_url` (never inserted, SELECT omits it), `source_content.content_hash` (computed each save, never compared; upsert keys on url) and `source_content.created_at` (only `extracted_at` used), `reading_list_history.node_ids` (always `'[]'`, TODO at `useReadingListMerge.ts:66`) and `reading_list_history.created_at` (only `merged_at` used), `embedding_metadata.{provider_id,dimensions,embedded_at}` (never SELECTed; provider switch wipes table at `embedding-service.ts:113-115`; only `node_id`+`text_hash` read), `memory_episodic.key_topics` (dies with the table).

**Latent bug (synapse-mcp fork, `standalone-provider.ts:754-919`):** hand-copied INIT_SCHEMA creates `spatial_positions`/`reading_list`/`browsing_history` (exist nowhere in the app), wrong-shaped `embedding_metadata` (`model` vs `provider_id`) and `embedding_dismissals` (`node_id`+`reason` vs pair), a bogus `nodes.source_content` **column** (`EXTRA_COLUMNS`, line 745), and stamps `schema_version=11` without creating `source_content`, `indexed_files`, `reading_list_history`, `memory_semantic`, or the FTS tables. Consequences today: the app opening such a vault only runs migrations 12–13 and then hits missing tables (`get_source_content` tool, note FTS), and the shared `EmbeddingService` (bundled into the MCP CLI) crashes on INSERT into the wrong-shaped `embedding_metadata`.

## Deliberate keeps (NOT in scope — do not "clean" these)

- `nodes.color`, `nodes.size` — readable by renderer with fallbacks; settable via command layer; plausible near-term features; wide renderer blast radius for zero functional change.
- `nodes.summary`, `edges.weight`, `edges.properties`, `edges.directed`, `chat_sessions.status`, `chat_messages.status`, `note_search.title`, `nodes.identifier` — all actively used (summary: agent tools + embedding text; weight/properties: editable in EdgeDetailPanel; directed: arrow rendering; statuses: query filters; note_search.title: FTS5 external-content backing; identifier: dedup).
- `entity_sources.location`, `edge_sources.location` — write-only today but actively stamped with real provenance during ingestion; dropping is irreversible data loss for a plausible pending feature.
- `artifacts.session_id`, `artifacts.created_at` — conventional metadata, cheap.
- Drifted MCP vaults' bogus `nodes.source_content` column — harmless residue; not worth a `nodes` table rebuild (FK-cascade risk).
- Migration files 001–013 — historical migrations are never edited, only superseded.

## Invariants every task must respect

1. **Each commit builds green on all three targets** (`npm run build:electron`, `npm run build` (Chrome), `npm run build:mcp`) and passes `npm test`.
2. **Code lands before schema.** Tasks 2–7 leave the running schema untouched; only Task 8 changes DDL. Omitting a nullable/defaulted column from an INSERT is compatible with both pre- and post-014 schemas.
3. **Never rebuild `chat_sessions` or `nodes` via DROP TABLE.** `chat_messages.session_id REFERENCES chat_sessions(id) ON DELETE CASCADE` — with `foreign_keys=ON`, dropping `chat_sessions` cascades and **wipes all chat history** (and PRAGMA toggling inside the migration string can't be trusted across engines). `preset_id` is therefore dropped by runner code (try/catch), not by migration SQL; `nodes` columns use plain `DROP COLUMN` (legal: none of z/content_type/folder_path is referenced by any index — after `idx_nodes_folder_path` is dropped — trigger, CHECK, or FK).
4. **Migration 014 must succeed on drifted MCP vaults.** Every plain `ALTER TABLE ... DROP COLUMN` in 014 targets a column that exists in BOTH the canonical v13 schema and the MCP INIT_SCHEMA copy (verified column-by-column). Tables that may be entirely missing on drifted vaults (`source_content`, `reading_list_history`) are repair-created in old shape first, then rebuilt.
5. `SQLite ≥ 3.35` is required for `DROP COLUMN`. better-sqlite3 ^12 bundles ≥3.45; wa-sqlite ^1.0 bundles ≥3.44. Task 1's harness asserts `sqlite_version() >= 3.35` so a downgrade fails loudly.

## File structure (what changes where)

| Area | Files |
|---|---|
| New migration | Create `src/db/worker/migrations/014-schema-cleanup.ts`; modify `src/db/worker/migrations/index.ts` |
| Dead plumbing deletes | Delete `src/db/worker/queries/indexed-file-queries.ts`, `src/db/worker/queries/memory-queries.ts`; modify `src/db/data-store.ts`, `src/db/sqlite-data-store.ts`, `src/db/client/db-client.ts`, `src/db/worker/action-handler.ts`, `src/db/worker/idb-to-opfs-migration.ts` |
| Column writer/reader removal | `src/db/worker/queries/{node,edge,chat,source-content,reading-list,node-type}-queries.ts`, `src/shared/types.ts`, `src/shared/schema.ts`, `src/commands/graph-commands.ts`, `src/commands/tools/intelligence-tools.ts`, `src/graph/store/graph-store.ts`, `src/graph/transforms/db-to-render.ts`, `src/ui/hooks/{useLLMExtraction,useReadingListMerge}.ts`, `electron/vault/reconciliation.ts`, `electron/vault/handlers/resource-detection-handler.ts`, `electron/embeddings/embedding-queue.ts` |
| MCP fix | `packages/synapse-mcp/src/standalone-provider.ts`, `packages/synapse-mcp/src/index.ts` (initVault call site) |
| Tests | Create `tests/db/migrations.test.ts`; modify `tests/vault/*.test.ts` fixtures |
| Docs | `ARCHITECTURE.md`, `docs/database-layer.md`, `docs/vector-embeddings.md`, `docs/memory-harness.md`, `CLAUDE.md` |

---

### Task 0: Preflight — restore access, branch, baseline

**Files:** none (environment)

- [ ] **Step 1: Re-grant file access.** macOS revoked Desktop/Documents access for the terminal app mid-audit. In **System Settings → Privacy & Security → Files and Folders** (or **Full Disk Access**), re-enable the terminal app (Terminal/iTerm/Claude desktop), then restart it. Verify:

Run: `ls /Users/brian/Desktop/code/sideproject/kg_extension/src && git -C /Users/brian/Desktop/code/sideproject/kg_extension status --short --branch`
Expected: file listing; `## desktop` with clean tree at `ea31fee`. If the tree moved past `ea31fee`, re-verify the audit line numbers cited below before editing (they were taken from that commit).

- [ ] **Step 2: Copy this plan into the repo**

```bash
mkdir -p docs/superpowers/plans
cp /tmp/synapse-plans/2026-06-10-db-schema-cleanup.md docs/superpowers/plans/
```

- [ ] **Step 3: Create a working branch**

```bash
git checkout -b schema-cleanup
```

- [ ] **Step 4: Baseline test run**

Run: `npm test`
Expected: existing `tests/vault` suites PASS (2 files). If red, STOP — fix main first.

- [ ] **Step 5: Commit the plan**

```bash
git add docs/superpowers/plans/2026-06-10-db-schema-cleanup.md
git commit -m "docs: add db schema cleanup implementation plan"
```

---

### Task 1: Migration test harness + v13 characterization test

Drives the real production runner (`runMigrations()`) against an in-memory better-sqlite3 DB through the existing `setEngine()` seam — the exact path Electron uses.

**Files:**
- Create: `tests/db/migrations.test.ts`

- [ ] **Step 1: Write the harness + characterization test**

```typescript
import { describe, it, expect, beforeEach } from 'vitest';
import Database from 'better-sqlite3';
import { setEngine } from '../../src/db/worker/query-executor';
import { runMigrations } from '../../src/db/worker/migrations';

// ── Harness: drive the real migration runner via the setEngine() seam ──

function bindEngine(db: Database.Database): void {
  setEngine({
    async exec(sql: string, params?: unknown[]) {
      if (params && params.length > 0) {
        return db.prepare(sql).run(...(params as unknown[])).changes;
      }
      db.exec(sql);
      return 0;
    },
    async query<T = Record<string, unknown>>(sql: string, params?: unknown[]) {
      if (params && params.length > 0) {
        return db.prepare(sql).all(...(params as unknown[])) as T[];
      }
      return db.prepare(sql).all() as T[];
    },
    async checkModuleAvailable(moduleName: string) {
      try {
        return db.prepare('SELECT name FROM pragma_module_list WHERE name = ?')
          .all(moduleName).length > 0;
      } catch {
        return false;
      }
    },
  });
}

function freshDb(): Database.Database {
  const db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  return db;
}

function tableNames(db: Database.Database): string[] {
  return db.prepare(
    "SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name"
  ).all().map((r: any) => r.name);
}

function columnNames(db: Database.Database, table: string): string[] {
  return db.prepare(`PRAGMA table_info(${table})`).all().map((r: any) => r.name);
}

describe('migration runner harness', () => {
  let db: Database.Database;

  beforeEach(() => {
    db = freshDb();
    bindEngine(db);
  });

  it('requires SQLite >= 3.35 (DROP COLUMN support)', () => {
    const v = (db.prepare('SELECT sqlite_version() AS v').get() as any).v as string;
    const [major, minor] = v.split('.').map(Number);
    expect(major > 3 || (major === 3 && minor >= 35)).toBe(true);
  });

  it('applies all migrations on a fresh database', async () => {
    const version = await runMigrations();
    expect(version).toBeGreaterThanOrEqual(13);

    const tables = tableNames(db);
    for (const t of ['nodes', 'edges', 'entity_aliases', 'ontology_node_types',
      'ontology_edge_types', 'node_tags', 'entity_sources', 'edge_sources',
      'note_attachments', 'chat_sessions', 'chat_messages', 'note_search',
      'source_content', 'reading_list_history', 'embedding_metadata', 'artifacts']) {
      expect(tables, `expected table ${t}`).toContain(t);
    }
    // FTS applies in better-sqlite3 (module available)
    expect(tables).toContain('nodes_fts');
    expect(tables).toContain('notes_fts');
  });

  it('chat cascade sanity: deleting a session cascades messages, dropping unrelated tables does not', async () => {
    await runMigrations();
    db.prepare("INSERT INTO chat_sessions (id, title) VALUES ('s1', 't')").run();
    db.prepare(
      "INSERT INTO chat_messages (id, session_id, role, content) VALUES ('m1', 's1', 'user', 'hi')"
    ).run();
    expect((db.prepare('SELECT COUNT(*) AS c FROM chat_messages').get() as any).c).toBe(1);
  });
});
```

- [ ] **Step 2: Run the new test file**

Run: `npx vitest run tests/db/migrations.test.ts`
Expected: PASS (3 tests). Note: `runMigrations()` logs `[DB] ...` lines to console — normal.

- [ ] **Step 3: Run the whole suite**

Run: `npm test`
Expected: PASS (vault + db suites).

- [ ] **Step 4: Commit**

```bash
git add tests/db/migrations.test.ts
git commit -m "test: add migration runner harness with v13 characterization"
```

---

### Task 2: Delete dead `indexed_files` plumbing

The table is superseded by vault tracking on `nodes`. No feature calls any of this plumbing; deleting it is compile-checked by the builds.

**Files:**
- Delete: `src/db/worker/queries/indexed-file-queries.ts`
- Modify: `src/db/data-store.ts` (interface ~line 170, member ~line 265), `src/db/sqlite-data-store.ts` (import line 16, block lines 138-147), `src/db/worker/action-handler.ts` (cases at lines 340-368), `src/db/client/db-client.ts` (namespace lines 216-229), `src/db/worker/idb-to-opfs-migration.ts` (TABLES_TO_MIGRATE)

- [ ] **Step 1: Delete the query module**

```bash
git rm src/db/worker/queries/indexed-file-queries.ts
```

- [ ] **Step 2: Remove the repository wiring**

In `src/db/data-store.ts`: delete the entire `export interface IndexedFileRepository { ... }` block (starts line 170) and the `indexedFiles: IndexedFileRepository;` member (line 265).

In `src/db/sqlite-data-store.ts`: delete line 16 (`import * as indexedFileQueries ...`) and the `// ── Indexed File Repository` block (lines 138-147, the `indexedFiles: { ... },` object).

In `src/db/worker/action-handler.ts`: delete the six `case 'indexedFiles.*':` blocks (lines 340-368).

In `src/db/client/db-client.ts`: delete the `export const indexedFiles = { ... };` block (lines 216-229).

- [ ] **Step 3: Stop migrating dead tables from legacy Chrome IDB**

In `src/db/worker/idb-to-opfs-migration.ts`, edit `TABLES_TO_MIGRATE` (line ~21):

```typescript
const TABLES_TO_MIGRATE = [
  'schema_version',
  'ontology_node_types',
  'ontology_edge_types',
  'nodes',
  'edges',
  'entity_aliases',
  'source_content',
];
```

(removes `'extraction_log'` and `'indexed_files'` — dead data is not worth copying)

- [ ] **Step 4: Find any stragglers**

Run: `grep -rn "indexedFiles\|indexed_files\|indexed-file" src electron packages/synapse-mcp/src --include="*.ts" --include="*.tsx" | grep -v migrations/004`
Expected: no output (004 stays — historical migrations are immutable).

- [ ] **Step 5: Build + test**

Run: `npm run build:electron && npm run build && npm test`
Expected: all green.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "refactor: remove dead indexed_files plumbing (superseded by vault file tracking)"
```

---

### Task 3: Delete dead memory plumbing (semantic + episodic)

Memory is file-based (`.kg/agent/memory/` via `memory-commands.ts`); both DB tables are orphaned.

**Files:**
- Delete: `src/db/worker/queries/memory-queries.ts`
- Modify: `src/db/data-store.ts` (re-export line 30, `MemoryRepository` lines ~241-245, `memory` member line 272), `src/db/sqlite-data-store.ts` (import line 23, block lines 213-217), `src/db/worker/action-handler.ts` (cases lines 542-550), `src/db/client/db-client.ts` (namespace lines 306-312)

- [ ] **Step 1: Delete the query module**

```bash
git rm src/db/worker/queries/memory-queries.ts
```

- [ ] **Step 2: Remove the repository wiring**

In `src/db/data-store.ts`: delete line 30 (`export type { EpisodicMemory } from './worker/queries/memory-queries';`), the `export interface MemoryRepository { ... }` block (lines ~241-245), and the `memory: MemoryRepository;` member (line 272).

In `src/db/sqlite-data-store.ts`: delete line 23 (`import * as memoryQueries ...`) and the `memory: { addEpisodic..., getRecentEpisodic..., clearAllEpisodic... },` block (lines 213-217).

In `src/db/worker/action-handler.ts`: delete the three `case 'memory.*':` blocks (lines 542-550).

In `src/db/client/db-client.ts`: delete the `export const memory = { ... };` block (lines 306-312).

- [ ] **Step 3: Find stragglers**

Run: `grep -rn "addEpisodic\|getRecentEpisodic\|clearAllEpisodic\|memory_semantic\|memory_episodic\|EpisodicMemory\|SemanticMemory" src electron packages/synapse-mcp/src --include="*.ts" --include="*.tsx" | grep -v migrations/008`
Expected: no output. (UI strings like `'episodic'` in `MemorySection.tsx`/`memory-commands.ts` refer to file-based memory types and contain none of these identifiers.)

- [ ] **Step 4: Build + test**

Run: `npm run build:electron && npm run build && npm test`
Expected: all green.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "refactor: remove dead DB memory plumbing (memory is file-based in .kg/agent/memory)"
```

---

### Task 4: Stop touching dead chat columns (`rag_context`, `preset_id`)

**Files:**
- Modify: `src/db/worker/queries/chat-queries.ts` (saveMessage, lines 53-67), `src/db/data-store.ts` (saveMessage input ~line 209), `src/db/client/db-client.ts` (saveMessage ~line 275), `src/db/worker/migrations/index.ts` (ensure-block, lines ~130-149)

- [ ] **Step 1: Remove `ragContext` from the saveMessage chain**

`src/db/worker/queries/chat-queries.ts` — replace `saveMessage` (lines 53-67) with:

```typescript
export async function saveMessage(input: {
  id: string;
  sessionId: string;
  role: 'user' | 'assistant';
  content: string;
  status: 'complete' | 'error';
}): Promise<any> {
  const { rows } = await executeQuery<any>(
    `INSERT INTO chat_messages (id, session_id, role, content, status)
     VALUES (?, ?, ?, ?, ?) RETURNING *;`,
    [input.id, input.sessionId, input.role, input.content, input.status]
  );
  return rows[0];
}
```

In `src/db/data-store.ts` (ChatRepository.saveMessage input) and `src/db/client/db-client.ts` (saveMessage param type): delete the line `ragContext?: string | null;` from both input types. (No caller passes it — verified; `useChatSession.ts:144/249/268` pass only id/sessionId/role/content/status.)

- [ ] **Step 2: Align the ensure-block in the migration runner**

In `src/db/worker/migrations/index.ts`, the post-migration ensure-block currently re-adds `preset_id` on every boot. Replace the block (from `// Ensure chat tables exist` through the `idx_chat_messages_session` exec, lines ~130-149) with:

```typescript
  // Ensure chat tables exist (added after initial schema was already deployed,
  // so CREATE IF NOT EXISTS runs idempotently on every init)
  await executeExec(`CREATE TABLE IF NOT EXISTS chat_sessions (
    id TEXT PRIMARY KEY, title TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    last_active_at TEXT NOT NULL DEFAULT (datetime('now')),
    status TEXT NOT NULL DEFAULT 'active'
  );`);
  try {
    // Dead column (presets live in app storage, never in the DB). Dropped here
    // rather than in migration 014 because drifted MCP-initialized vaults may
    // not have the column, and a failed ALTER would abort the migration.
    await executeExec(`ALTER TABLE chat_sessions DROP COLUMN preset_id;`);
  } catch {
    // Column already gone (fresh DB or already dropped)
  }
  await executeExec(`CREATE TABLE IF NOT EXISTS chat_messages (
    id TEXT PRIMARY KEY,
    session_id TEXT NOT NULL REFERENCES chat_sessions(id) ON DELETE CASCADE,
    role TEXT NOT NULL, content TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'complete',
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );`);
  await executeExec(`CREATE INDEX IF NOT EXISTS idx_chat_messages_session ON chat_messages(session_id, created_at);`);
```

(`chat_sessions` is intentionally never rebuilt via DROP TABLE — see Invariant 3.)

- [ ] **Step 3: Extend the migration test**

Append to `tests/db/migrations.test.ts` inside the describe block:

```typescript
  it('drops chat_sessions.preset_id via the ensure-block without touching messages', async () => {
    await runMigrations();
    expect(columnNames(db, 'chat_sessions')).not.toContain('preset_id');
    // re-run: idempotent
    await runMigrations();
    expect(columnNames(db, 'chat_sessions')).not.toContain('preset_id');
  });
```

- [ ] **Step 4: Run tests, build**

Run: `npx vitest run tests/db/migrations.test.ts && npm run build:electron && npm run build`
Expected: PASS / green. (`rag_context` still exists in the DB until Task 8 — INSERTing without it is fine.)

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "refactor: stop writing chat rag_context, drop preset_id via runner ensure-block"
```

---

### Task 5: Stop touching dead node columns (`z`, `content_type`, `folder_path`)

**Files:**
- Modify: `src/db/worker/queries/node-queries.ts`, `src/shared/types.ts`, `src/shared/schema.ts`, `src/db/data-store.ts`, `src/commands/graph-commands.ts`, `src/commands/tools/intelligence-tools.ts`, `src/graph/store/graph-store.ts`, `src/graph/transforms/db-to-render.ts`, `electron/vault/reconciliation.ts`, `electron/vault/handlers/resource-detection-handler.ts`, `packages/synapse-mcp/src/standalone-provider.ts` (lines 287, 367, 737), `tests/vault/*.test.ts` (fixtures)

- [ ] **Step 1: Trim the query layer** (`src/db/worker/queries/node-queries.ts`)

Line 13 — slim select becomes:

```typescript
    'SELECT id, identifier, name, type, label, color, size, source_url, x, y FROM nodes;'
```

`createNode`: delete `folderPath?: string;` (line 27) and `contentType?: string;` (line 34) from the input type; delete line 39 (`const folderPath = input.folderPath ?? '';`); INSERT becomes:

```typescript
    `INSERT INTO nodes (id, identifier, name, type, label, properties, color, size, source_url, vault_path)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     RETURNING *;`,
    [
      id,
      identifier,
      input.name,
      type,
      label,
      input.properties ?? '{}',
      input.color ?? null,
      input.size ?? 1.0,
      input.sourceUrl ?? null,
      input.vaultPath ?? null,
    ]
```

`updateNode`: delete `folderPath?: string;` and `z?: number;` from the input type, and delete the two branches:

```typescript
  if (input.folderPath !== undefined) {
    sets.push('folder_path = ?');
    params.push(input.folderPath);
  }
```
```typescript
  if (input.z !== undefined) {
    sets.push('z = ?');
    params.push(input.z);
  }
```

- [ ] **Step 2: Trim shared types** (`src/shared/types.ts`)

- `DbNode` (lines 22-43): delete `folder_path: string;`, `z: number | null;`, `content_type: string | null;` lines.
- `DbNodeSlim` (lines 136-148): delete `folder_path: string;` (line 142).
- `GraphNode` (lines 161-179): delete `folderPath?: string;` (168) and `z?: number;` (173).
- `CreateNodeInput` (~line 205): delete `folderPath?: string;`.
- `UpdateNodeInput` (~line 220): delete `folderPath?: string;` and `z?: number;`.

In `src/shared/schema.ts`: delete `folderPath: z.string().optional(),` from `createNodeInputSchema` (line 67) and `updateNodeInputSchema` (line 80), and delete `z: z.number().optional(),` from `updateNodeInputSchema`.

In `src/db/data-store.ts` (NodeRepository): delete `folderPath?: string;` (line 49), `contentType?: string;` (line 56) from the create input, and `folderPath?: string;` (line 64) plus the `z?: number;` line (if present alongside x/y in the update input) from the update input.

- [ ] **Step 3: Trim mappers and transforms**

`src/commands/graph-commands.ts` — in `dbNodeToGraphNode` delete `folderPath: row.folder_path,` (line 12) and `z: row.z ?? undefined,` (line 16); in `createNode` delete `folderPath: input.folderPath,` (line 49); in `updateNode` delete `folderPath: input.folderPath,` (line 70) and `z: input.z,` (line 73).

`src/commands/tools/intelligence-tools.ts` — delete `folderPath: row.folder_path,` (line 23).

`src/graph/store/graph-store.ts` — delete `folderPath: row.folder_path,` (lines 18 and 55) and `z: row.z ?? undefined,` (line 21, inside `dbNodeToGraphNode`).

`src/graph/transforms/db-to-render.ts` — line 29: replace `z: node.z ?? 0,` with `z: 0,` (RenderNode keeps its runtime z; the DB never stored one).

- [ ] **Step 4: Trim Electron INSERTs**

`electron/vault/reconciliation.ts` (lines ~229-232):

```typescript
  ctx.db.prepare(`
    INSERT INTO nodes (id, identifier, name, type, label, summary, properties, x, y, color, size, source_url, vault_path, file_mtime, file_size, content_hash, created_at, updated_at)
    VALUES (?, ?, ?, 'note', NULL, NULL, '{}', NULL, NULL, NULL, 1, NULL, ?, ?, ?, ?, ?, ?)
  `).run(id, id, name, file.relativePath, file.mtime, file.size, hash, now, now);
```

`electron/vault/handlers/resource-detection-handler.ts` (lines ~92-107): delete line 87 (`const contentType = MIME_MAP[ext] ?? null;`; keep `MIME_MAP` itself only if referenced elsewhere in the file — check with grep before deleting the constant) and replace the INSERT:

```typescript
    this.ctx.db.prepare(`
      INSERT INTO nodes (id, identifier, name, type, label, summary, properties, x, y, color, size, source_url, vault_path, file_mtime, file_size, content_hash, created_at, updated_at)
      VALUES (?, ?, ?, 'resource', NULL, NULL, ?, NULL, NULL, NULL, 1, NULL, ?, ?, ?, ?, ?, ?)
    `).run(
      id,
      id,
      name,
      JSON.stringify({ fileType: ext.slice(1), addedAt: now }),
      relativePath,
      Math.floor(stat.mtimeMs),
      stat.size,
      hash,
      now,
      now,
    );
```

- [ ] **Step 5: Trim the MCP standalone provider (keep it compiling against new types)**

`packages/synapse-mcp/src/standalone-provider.ts`:
- Line 287 INSERT: remove `folder_path` from the column list and its `''` value.
- Line 367 INSERT: remove `folder_path` and `content_type` from the column list and their values.
- Line 737 `toGraphNode`: delete `folderPath: '',`.

(The INIT_SCHEMA copy still names these columns; it is deleted wholesale in Task 9 — don't half-edit it here.)

- [ ] **Step 6: Update test fixtures**

`tests/vault/reconciliation.test.ts` (and `note-path-resolution.test.ts` if it shares the fixture): the in-memory `CREATE TABLE nodes` fixture and any INSERT column lists must drop `folder_path`, `z`, `content_type` to mirror the post-014 schema the handlers now target. Update assertions that named those columns, if any.

- [ ] **Step 7: Sweep for stragglers**

Run: `grep -rn "folder_path\|folderPath" src electron packages/synapse-mcp/src tests --include="*.ts" --include="*.tsx" | grep -v "migrations/0\|standalone-provider.ts:7[5-9][0-9]\|standalone-provider.ts:76[0-9]"`
Expected: no output outside migration files 001–013 and the (doomed) INIT_SCHEMA block. Repeat for `content_type` (allow `migrations/010`, INIT_SCHEMA/EXTRA_COLUMNS) and for node `z` usages (`grep -n "\.z\b\|z: " src/commands src/graph/store src/db --include="*.ts"` — renderer/layout `z` is runtime-only and stays).

- [ ] **Step 8: Build + test**

Run: `npm run build:electron && npm run build && npm run build:mcp && npm test`
Expected: all green.

- [ ] **Step 9: Commit**

```bash
git add -A
git commit -m "refactor: stop reading/writing dead node columns (z, content_type, folder_path)"
```

---

### Task 6: Stop touching dead edge column (`source_url`)

Edge provenance lives in `edge_sources` (extraction writes a row there; EdgeDetailPanel resolves the resource node). The column on `edges` is write-only duplication.

**Files:**
- Modify: `src/db/worker/queries/edge-queries.ts` (createEdge, lines 44-83), `src/shared/types.ts` (DbEdge line ~54, GraphEdge `sourceUrl?` line ~190, CreateEdgeInput `sourceUrl?`), `src/shared/schema.ts` (createEdgeInputSchema `sourceUrl` line if present), `src/commands/graph-commands.ts` (dbEdgeToGraphEdge line 35, createEdge passthrough line ~120), `src/graph/store/graph-store.ts` (dbEdgeToGraphEdge line 41), `src/graph/transforms/db-to-render.ts` (edge `data.sourceUrl` line 53), `src/ui/hooks/useLLMExtraction.ts` (createEdge call, line ~893)

- [ ] **Step 1: Trim `createEdge`** (`src/db/worker/queries/edge-queries.ts`)

Delete `sourceUrl?: string;` from the input type; INSERT becomes:

```typescript
    `INSERT INTO edges (id, source_id, target_id, label, type, properties, weight, directed)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(source_id, target_id, label) DO UPDATE SET
       type = excluded.type,
       properties = excluded.properties,
       weight = excluded.weight,
       directed = excluded.directed,
       updated_at = datetime('now')
     RETURNING *;`,
    [
      id,
      input.sourceId,
      input.targetId,
      input.label,
      type,
      input.properties ?? '{}',
      input.weight ?? 1.0,
      input.directed !== false ? 1 : 0,
    ]
```

- [ ] **Step 2: Trim types and mappers**

- `src/shared/types.ts`: delete `source_url: string | null;` from `DbEdge`; delete `sourceUrl?: string;` from `GraphEdge` and from `CreateEdgeInput`.
- `src/shared/schema.ts`: in `createEdgeInputSchema`, delete the `sourceUrl` line if present.
- `src/commands/graph-commands.ts`: delete `sourceUrl: row.source_url ?? undefined,` (line 35) and `sourceUrl: input.sourceUrl,` in `createEdge` (~line 120).
- `src/graph/store/graph-store.ts`: delete `sourceUrl: row.source_url ?? undefined,` from `dbEdgeToGraphEdge` (line 41). (Lines 25 and 61 are NODE mappers — keep; `nodes.source_url` stays.)
- `src/graph/transforms/db-to-render.ts`: delete `sourceUrl: edge.sourceUrl,` (line 53). Keep node `sourceUrl` (line 36).
- `src/db/data-store.ts`: delete `sourceUrl?: string;` from the EdgeRepository create input if declared there.

- [ ] **Step 3: Trim the extraction call site** (`src/ui/hooks/useLLMExtraction.ts` ~line 889)

```typescript
          const created = await updatedGraph.createEdge({
            sourceId,
            targetId,
            label: edge.label,
            skipProvenance: true,
          });
```

(The `edgeSources.add({ edgeId, sourceType: 'extraction', resourceId })` block a few lines below is the real provenance — unchanged.)

- [ ] **Step 4: Sweep**

Run: `grep -rn "sourceUrl\|source_url" src/db/worker/queries/edge-queries.ts src/commands/graph-commands.ts src/graph --include="*.ts" | grep -iv "node"`
Expected: no edge-related matches remain (manual eyeball: hits should all be node mappers).

- [ ] **Step 5: Build + test, commit**

Run: `npm run build:electron && npm run build && npm run build:mcp && npm test`
Expected: green.

```bash
git add -A
git commit -m "refactor: drop write-only edges.source_url from code paths (edge_sources is provenance)"
```

---

### Task 7: Stop touching remaining dead aux columns

**Files:**
- Modify: `src/db/worker/queries/source-content-queries.ts` (lines 12-51), `src/shared/types.ts` (`DbSourceContent` lines ~80-89), `src/db/worker/queries/reading-list-queries.ts` (lines 11-41), `src/db/client/db-client.ts` (readingList.save input), `src/db/data-store.ts` (ReadingListRepository save input), `src/ui/hooks/useReadingListMerge.ts` (lines 61-67), `src/db/worker/queries/node-type-queries.ts` (lines 4-23), `src/shared/types.ts` (`NodeType.isDefault` line 332), `electron/embeddings/embedding-queue.ts` (storeEmbedding lines ~96-103)

- [ ] **Step 1: source_content — drop hash + dual timestamp**

`src/db/worker/queries/source-content-queries.ts`: delete the `hashContent` function (lines 12-19); `saveSourceContent` becomes:

```typescript
export async function saveSourceContent(input: {
  nodeId?: string;
  url: string;
  title?: string;
  content: string;
}): Promise<DbSourceContent> {
  const id = generateId();

  // Upsert: if same URL already exists, update content
  const existing = await getByUrl(input.url);
  if (existing) {
    const { rows } = await executeQuery<DbSourceContent>(
      `UPDATE source_content
       SET content = ?, title = COALESCE(?, title),
           node_id = COALESCE(?, node_id), extracted_at = datetime('now')
       WHERE id = ?
       RETURNING *;`,
      [input.content, input.title ?? null, input.nodeId ?? null, existing.id]
    );
    return rows[0];
  }

  const { rows } = await executeQuery<DbSourceContent>(
    `INSERT INTO source_content (id, node_id, url, title, content)
     VALUES (?, ?, ?, ?, ?)
     RETURNING *;`,
    [id, input.nodeId ?? null, input.url, input.title ?? null, input.content]
  );
  return rows[0];
}
```

`src/shared/types.ts` `DbSourceContent`: delete `content_hash: string | null;` and `created_at: string;` lines (keep `extracted_at`).

- [ ] **Step 2: reading_list_history — drop `node_ids`**

`src/db/worker/queries/reading-list-queries.ts` `saveHistory`: delete `nodeIds: string[];` from the input type and `const nodeIdsJson = ...`; UPDATE becomes `SET title = ?, summary = ?, key_topics = ?, merged_at = datetime('now')` with params `[input.title, input.summary, keyTopicsJson, existing.id]`; INSERT becomes `INSERT INTO reading_list_history (id, url, title, summary, key_topics) VALUES (?, ?, ?, ?, ?)` with params `[id, input.url, input.title, input.summary, keyTopicsJson]`.

`src/db/client/db-client.ts` (readingList.save input) and `src/db/data-store.ts` (ReadingListRepository save input): delete the `nodeIds` field from both signatures.

`src/ui/hooks/useReadingListMerge.ts` (lines ~61-67): delete the line `nodeIds: [], // TODO: collect node IDs from the merge`.

- [ ] **Step 3: ontology types — drop dead fields from code**

`src/db/worker/queries/node-type-queries.ts`: `DbNodeType` loses `is_default: number;`, `parent_type: string | null;`, `properties_schema: string | null;`; `toNodeType` loses `isDefault: row.is_default === 1,`.

`src/shared/types.ts` line 332: delete `isDefault: boolean;` from `NodeType`.

(`ontology_edge_types` dead columns have zero code references — nothing to edit; `getAllOntologyEdgeTypes`/`createOntologyEdgeType` already use explicit 3-column lists.)

- [ ] **Step 4: embedding metadata — two-column write**

`electron/embeddings/embedding-queue.ts` `storeEmbedding`:

```typescript
  private storeEmbedding(nodeId: string, text: string, vec: Float32Array): void {
    insertEmbedding(this.db, nodeId, vec);

    const hash = computeTextHash(text);
    this.db.prepare(
      'INSERT OR REPLACE INTO embedding_metadata(node_id, text_hash) VALUES (?, ?)'
    ).run(nodeId, hash);
  }
```

NOTE: this write targets the post-014 shape and is the ONLY edit in Tasks 2–7 that is **not** backward-compatible with the live schema (old table has NOT NULL provider_id etc.). That's acceptable: it ships in the same branch as Task 8, embeddings are opt-in derived data, and 014 rebuilds the table before any post-merge run. Do not cherry-pick this commit alone.

- [ ] **Step 5: Build + test, commit**

Run: `npm run build:electron && npm run build && npm run build:mcp && npm test`
Expected: green.

```bash
git add -A
git commit -m "refactor: stop writing dead aux columns (source_content hash, node_ids, ontology flags, embedding metadata)"
```

---

### Task 8: Migration 014 — drop dead tables/columns, repair drifted vaults (TDD)

**Files:**
- Create: `src/db/worker/migrations/014-schema-cleanup.ts`
- Modify: `src/db/worker/migrations/index.ts` (import + array)
- Test: `tests/db/migrations.test.ts`

- [ ] **Step 1: Write the failing tests** — append to `tests/db/migrations.test.ts`:

```typescript
// Frozen copy of the OLD synapse-mcp INIT_SCHEMA + EXTRA_COLUMNS (deleted from
// prod in this branch) — reproduces a drifted MCP-initialized vault stamped v11.
const DRIFTED_MCP_FIXTURE = `
CREATE TABLE IF NOT EXISTS nodes (
    id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
    identifier TEXT UNIQUE, name TEXT NOT NULL, type TEXT NOT NULL DEFAULT 'entity',
    label TEXT, summary TEXT, folder_path TEXT NOT NULL DEFAULT '',
    properties TEXT NOT NULL DEFAULT '{}', x REAL, y REAL, z REAL,
    color TEXT, size REAL DEFAULT 1.0, source_url TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_nodes_folder_path ON nodes(folder_path) WHERE type = 'note';
CREATE TABLE IF NOT EXISTS edges (
    id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
    source_id TEXT NOT NULL REFERENCES nodes(id) ON DELETE CASCADE,
    target_id TEXT NOT NULL REFERENCES nodes(id) ON DELETE CASCADE,
    label TEXT NOT NULL, type TEXT NOT NULL DEFAULT 'related',
    properties TEXT NOT NULL DEFAULT '{}', weight REAL DEFAULT 1.0,
    directed INTEGER NOT NULL DEFAULT 1, source_url TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now')),
    UNIQUE(source_id, target_id, label)
);
CREATE TABLE IF NOT EXISTS entity_aliases (
    id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
    node_id TEXT NOT NULL REFERENCES nodes(id) ON DELETE CASCADE,
    alias TEXT NOT NULL, alias_lower TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS extraction_log (
    id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
    source_url TEXT, source_text TEXT, provider TEXT NOT NULL, model TEXT NOT NULL,
    raw_output TEXT, nodes_added INTEGER DEFAULT 0, edges_added INTEGER DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS schema_version (
    version INTEGER PRIMARY KEY, applied_at TEXT NOT NULL DEFAULT (datetime('now')), description TEXT
);
CREATE TABLE IF NOT EXISTS ontology_node_types (
    type TEXT PRIMARY KEY, description TEXT, color TEXT,
    category TEXT NOT NULL DEFAULT 'entity_label', is_default INTEGER NOT NULL DEFAULT 0,
    parent_type TEXT REFERENCES ontology_node_types(type), properties_schema TEXT
);
INSERT OR IGNORE INTO ontology_node_types (type, description, color, category) VALUES
    ('resource', 'A webpage ingested into the knowledge graph', '#059669', 'structural'),
    ('entity', 'A domain object', '#7C3AED', 'structural'),
    ('note', 'A granular prose unit about entities', '#0EA5E9', 'structural');
CREATE TABLE IF NOT EXISTS ontology_edge_types (
    type TEXT PRIMARY KEY, description TEXT, category TEXT NOT NULL DEFAULT 'related',
    source_types TEXT, target_types TEXT, properties_schema TEXT
);
CREATE TABLE IF NOT EXISTS node_tags (
    node_id TEXT NOT NULL REFERENCES nodes(id) ON DELETE CASCADE,
    tag TEXT NOT NULL, PRIMARY KEY (node_id, tag)
);
CREATE TABLE IF NOT EXISTS entity_sources (
    entity_id TEXT NOT NULL REFERENCES nodes(id) ON DELETE CASCADE,
    resource_id TEXT NOT NULL, relation_type TEXT NOT NULL DEFAULT 'about',
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    PRIMARY KEY (entity_id, resource_id, relation_type)
);
CREATE TABLE IF NOT EXISTS edge_sources (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    edge_id TEXT NOT NULL REFERENCES edges(id) ON DELETE CASCADE,
    source_type TEXT NOT NULL CHECK(source_type IN ('note', 'extraction', 'user')),
    source_id TEXT, resource_id TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    UNIQUE(edge_id, source_type, source_id, resource_id)
);
CREATE TABLE IF NOT EXISTS note_folders (path TEXT PRIMARY KEY, created_at TEXT NOT NULL DEFAULT (datetime('now')));
CREATE TABLE IF NOT EXISTS note_attachments (
    id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
    note_id TEXT NOT NULL REFERENCES nodes(id) ON DELETE CASCADE,
    filename TEXT NOT NULL, mime_type TEXT NOT NULL, data BLOB, source_url TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS chat_sessions (
    id TEXT PRIMARY KEY, title TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    last_active_at TEXT NOT NULL DEFAULT (datetime('now')),
    status TEXT NOT NULL DEFAULT 'active'
);
CREATE TABLE IF NOT EXISTS chat_messages (
    id TEXT PRIMARY KEY, session_id TEXT NOT NULL REFERENCES chat_sessions(id) ON DELETE CASCADE,
    role TEXT NOT NULL, content TEXT NOT NULL, rag_context TEXT,
    status TEXT NOT NULL DEFAULT 'complete',
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS note_search (
    rowid INTEGER PRIMARY KEY AUTOINCREMENT, node_id TEXT UNIQUE NOT NULL,
    title TEXT NOT NULL, body TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS spatial_positions (
    node_id TEXT PRIMARY KEY REFERENCES nodes(id) ON DELETE CASCADE,
    x REAL NOT NULL DEFAULT 0, y REAL NOT NULL DEFAULT 0, layout TEXT NOT NULL DEFAULT 'force'
);
CREATE TABLE IF NOT EXISTS reading_list (
    id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))), url TEXT NOT NULL, title TEXT,
    status TEXT NOT NULL DEFAULT 'unread', created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS browsing_history (
    id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))), url TEXT NOT NULL, title TEXT,
    visited_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS memory_episodic (
    id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))), session_id TEXT,
    summary TEXT NOT NULL, created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS embedding_metadata (
    node_id TEXT PRIMARY KEY REFERENCES nodes(id) ON DELETE CASCADE,
    model TEXT NOT NULL, dimensions INTEGER NOT NULL, text_hash TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now')), updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS embedding_dismissals (
    node_id TEXT PRIMARY KEY REFERENCES nodes(id) ON DELETE CASCADE,
    reason TEXT, created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
ALTER TABLE nodes ADD COLUMN source_content TEXT;
ALTER TABLE nodes ADD COLUMN vault_path TEXT;
ALTER TABLE nodes ADD COLUMN content_type TEXT;
ALTER TABLE nodes ADD COLUMN file_mtime INTEGER;
ALTER TABLE nodes ADD COLUMN file_size INTEGER;
ALTER TABLE entity_sources ADD COLUMN location TEXT;
ALTER TABLE edge_sources ADD COLUMN location TEXT;
INSERT OR REPLACE INTO schema_version (version, description) VALUES (11, 'init');
`;

const DEAD_TABLES = ['extraction_log', 'note_folders', 'indexed_files',
  'memory_semantic', 'memory_episodic', 'embedding_dismissals',
  'spatial_positions', 'reading_list', 'browsing_history'];

describe('migration 014: schema cleanup', () => {
  let db: Database.Database;

  beforeEach(() => {
    db = freshDb();
    bindEngine(db);
  });

  it('drops dead tables and columns on a healthy vault, preserving data', async () => {
    // Seed a v13 vault: stop the runner at 13 by... running everything is fine,
    // since 014 is what we assert. Seed AFTER full migration of <=13 would race
    // 014, so instead: run all migrations, then verify end-state directly.
    await runMigrations();

    for (const t of DEAD_TABLES) {
      expect(tableNames(db), `${t} should be dropped`).not.toContain(t);
    }
    expect(columnNames(db, 'nodes')).not.toContain('z');
    expect(columnNames(db, 'nodes')).not.toContain('content_type');
    expect(columnNames(db, 'nodes')).not.toContain('folder_path');
    expect(columnNames(db, 'edges')).not.toContain('source_url');
    expect(columnNames(db, 'chat_messages')).not.toContain('rag_context');
    expect(columnNames(db, 'note_attachments')).not.toContain('source_url');
    expect(columnNames(db, 'ontology_node_types')).toEqual(['type', 'description', 'color', 'category']);
    expect(columnNames(db, 'ontology_edge_types')).toEqual(['type', 'description', 'category']);
    expect(columnNames(db, 'source_content')).toEqual(['id', 'node_id', 'url', 'title', 'content', 'extracted_at']);
    expect(columnNames(db, 'reading_list_history')).toEqual(['id', 'url', 'title', 'summary', 'key_topics', 'merged_at']);
    expect(columnNames(db, 'embedding_metadata')).toEqual(['node_id', 'text_hash']);
    // Ontology seed data survives the rebuild
    const ont = db.prepare("SELECT type FROM ontology_node_types ORDER BY type").all().map((r: any) => r.type);
    expect(ont).toEqual(['entity', 'note', 'resource']);
    expect(db.prepare('PRAGMA foreign_key_check').all()).toEqual([]);
  });

  it('preserves user data through the table rebuilds', async () => {
    // Apply migrations 1..13 only, seed, then apply the rest (incl. 014).
    // The runner applies versions > current, so stamp a fake max below 14
    // is not possible without hacks — instead seed via a drifted-style path:
    // create a full v13 DB by running the real runner BUT against a second
    // connection is overkill. Simplest honest approach: seed through the
    // PUBLIC pre-014 shape on a fixture DB.
    db.exec(DRIFTED_MCP_FIXTURE); // v11-shaped vault
    db.prepare("INSERT INTO nodes (id, name, type) VALUES ('n1', 'Node One', 'entity')").run();
    db.prepare("INSERT INTO chat_sessions (id, title) VALUES ('s1', 'chat')").run();
    db.prepare("INSERT INTO chat_messages (id, session_id, role, content, rag_context) VALUES ('m1', 's1', 'user', 'hello', 'legacy')").run();
    db.prepare("INSERT INTO memory_episodic (id, session_id, summary) VALUES ('e1', 's1', 'old summary')").run();

    const version = await runMigrations(); // applies 12, 13, 14 (+ skips 1-11)
    expect(version).toBeGreaterThanOrEqual(14);

    // chat history survived (no chat_sessions rebuild => no FK cascade wipe)
    expect((db.prepare('SELECT COUNT(*) AS c FROM chat_messages').get() as any).c).toBe(1);
    expect((db.prepare('SELECT COUNT(*) AS c FROM nodes').get() as any).c).toBe(1);
    // drifted-vault repairs: tables the old MCP init never created now exist
    const tables = tableNames(db);
    expect(tables).toContain('source_content');
    expect(tables).toContain('reading_list_history');
    expect(tables).toContain('artifacts');           // migration 13 applied
    expect(columnNames(db, 'nodes')).toContain('content_hash'); // migration 12 applied
    // drifted trio + dead tables gone
    for (const t of DEAD_TABLES) expect(tables).not.toContain(t);
    // wrong-shaped embedding tables replaced by canonical minimal shape
    expect(columnNames(db, 'embedding_metadata')).toEqual(['node_id', 'text_hash']);
    expect(db.prepare('PRAGMA foreign_key_check').all()).toEqual([]);
  });
});
```

- [ ] **Step 2: Run to verify RED**

Run: `npx vitest run tests/db/migrations.test.ts`
Expected: FAIL — dead tables still present, columns still exist, drifted fixture run fails on `embedding_metadata` shape assertions.

- [ ] **Step 3: Write the migration** — create `src/db/worker/migrations/014-schema-cleanup.ts`:

```typescript
export const version = 14;
export const description =
  'Schema cleanup: drop dead tables/columns; repair vaults initialized by the old synapse-mcp CLI';

// Three vault flavors must survive this migration:
//   1. healthy app vaults at v13,
//   2. vaults initialized by the old synapse-mcp INIT_SCHEMA (stamped v11:
//      missing source_content/reading_list_history/FTS, wrong-shaped
//      embedding tables, extra spatial_positions/reading_list/browsing_history),
//   3. fresh databases (001..013 just ran).
// Hence: DROP TABLE IF EXISTS for tables, repair-create-then-rebuild for
// tables that may be absent, and plain DROP COLUMN only for columns present
// in BOTH the v13 schema and the old MCP copy.
// chat_sessions is intentionally NOT rebuilt here (chat_messages cascades on
// it); its dead preset_id column is dropped by the runner's ensure-block.
export const up = `
DROP TABLE IF EXISTS extraction_log;
DROP TABLE IF EXISTS note_folders;
DROP TABLE IF EXISTS indexed_files;
DROP TABLE IF EXISTS memory_semantic;
DROP TABLE IF EXISTS memory_episodic;
DROP TABLE IF EXISTS embedding_dismissals;
DROP TABLE IF EXISTS spatial_positions;
DROP TABLE IF EXISTS reading_list;
DROP TABLE IF EXISTS browsing_history;

CREATE TABLE IF NOT EXISTS source_content (
    id          TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
    node_id     TEXT REFERENCES nodes(id) ON DELETE SET NULL,
    url         TEXT NOT NULL,
    title       TEXT,
    content     TEXT NOT NULL,
    content_hash TEXT,
    extracted_at TEXT NOT NULL DEFAULT (datetime('now')),
    created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE source_content_new (
    id          TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
    node_id     TEXT REFERENCES nodes(id) ON DELETE SET NULL,
    url         TEXT NOT NULL,
    title       TEXT,
    content     TEXT NOT NULL,
    extracted_at TEXT NOT NULL DEFAULT (datetime('now'))
);
INSERT INTO source_content_new (id, node_id, url, title, content, extracted_at)
    SELECT id, node_id, url, title, content, extracted_at FROM source_content;
DROP TABLE source_content;
ALTER TABLE source_content_new RENAME TO source_content;
CREATE INDEX IF NOT EXISTS idx_source_content_node ON source_content(node_id);
CREATE INDEX IF NOT EXISTS idx_source_content_url ON source_content(url);
CREATE UNIQUE INDEX IF NOT EXISTS idx_source_content_url_time ON source_content(url, extracted_at);

CREATE TABLE IF NOT EXISTS reading_list_history (
  id               TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  url              TEXT NOT NULL UNIQUE,
  title            TEXT NOT NULL,
  summary          TEXT NOT NULL DEFAULT '',
  key_topics       TEXT NOT NULL DEFAULT '[]',
  merged_at        TEXT NOT NULL DEFAULT (datetime('now')),
  node_ids         TEXT NOT NULL DEFAULT '[]',
  created_at       TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE reading_list_history_new (
  id               TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  url              TEXT NOT NULL UNIQUE,
  title            TEXT NOT NULL,
  summary          TEXT NOT NULL DEFAULT '',
  key_topics       TEXT NOT NULL DEFAULT '[]',
  merged_at        TEXT NOT NULL DEFAULT (datetime('now'))
);
INSERT INTO reading_list_history_new (id, url, title, summary, key_topics, merged_at)
    SELECT id, url, title, summary, key_topics, merged_at FROM reading_list_history;
DROP TABLE reading_list_history;
ALTER TABLE reading_list_history_new RENAME TO reading_list_history;
CREATE INDEX IF NOT EXISTS idx_rlh_merged ON reading_list_history(merged_at DESC);

CREATE TABLE ontology_node_types_new (
    type              TEXT PRIMARY KEY,
    description       TEXT,
    color             TEXT,
    category          TEXT NOT NULL DEFAULT 'entity_label'
);
INSERT INTO ontology_node_types_new (type, description, color, category)
    SELECT type, description, color, category FROM ontology_node_types;
DROP TABLE ontology_node_types;
ALTER TABLE ontology_node_types_new RENAME TO ontology_node_types;

ALTER TABLE ontology_edge_types DROP COLUMN source_types;
ALTER TABLE ontology_edge_types DROP COLUMN target_types;
ALTER TABLE ontology_edge_types DROP COLUMN properties_schema;

ALTER TABLE chat_messages DROP COLUMN rag_context;
ALTER TABLE note_attachments DROP COLUMN source_url;
ALTER TABLE edges DROP COLUMN source_url;
ALTER TABLE nodes DROP COLUMN z;
ALTER TABLE nodes DROP COLUMN content_type;
DROP INDEX IF EXISTS idx_nodes_folder_path;
ALTER TABLE nodes DROP COLUMN folder_path;

DROP TABLE IF EXISTS embedding_metadata;
CREATE TABLE embedding_metadata (
  node_id TEXT PRIMARY KEY REFERENCES nodes(id) ON DELETE CASCADE,
  text_hash TEXT NOT NULL
);
`;
```

- [ ] **Step 4: Register it** — in `src/db/worker/migrations/index.ts`:

```typescript
import * as migration014 from './014-schema-cleanup';
```

and append `migration014` to the `migrations` array.

- [ ] **Step 5: Run to verify GREEN**

Run: `npx vitest run tests/db/migrations.test.ts`
Expected: PASS, including the drifted-vault test (chat messages survive, FK check clean).

- [ ] **Step 6: Full suite + builds**

Run: `npm test && npm run build:electron && npm run build`
Expected: green. The vault tests exercise reconciliation against fixtures updated in Task 5.

- [ ] **Step 7: Smoke against a copy of a real vault DB** (manual but scripted)

```bash
cp "/path/to/your/vault/.kg/graph.db" /tmp/vault-backup-pre014.db   # adjust path; keep this backup
npm run build:electron && npx electron .
```
Expected: app boots, log shows `[DB] Applying migration 14: Schema cleanup...`, graph renders, chat history intact, note search works. Keep `/tmp/vault-backup-pre014.db` until satisfied.

- [ ] **Step 8: Commit**

```bash
git add -A
git commit -m "feat(db): migration 014 — drop dead tables/columns, repair MCP-drifted vaults"
```

---

### Task 9: synapse-mcp — single source of truth for schema

Deletes the forked INIT_SCHEMA/EXTRA_COLUMNS and routes `initVault` through the canonical runner. esbuild already bundles cross-package imports (`../../electron/embeddings/onnx-worker.ts` precedent in `packages/synapse-mcp/package.json`).

**Files:**
- Modify: `packages/synapse-mcp/src/standalone-provider.ts` (initVault lines 63-97, INIT_SCHEMA lines 754-919, EXTRA_COLUMNS lines 744-752), `packages/synapse-mcp/src/index.ts` (initVault call site — it becomes async)

- [ ] **Step 1: Replace `initVault`** — in `standalone-provider.ts`, add imports at top:

```typescript
import { setEngine } from '../../../src/db/worker/query-executor';
import { runMigrations } from '../../../src/db/worker/migrations';
```

Replace the whole `static initVault(vaultPath: string): void { ... }` (lines 63-97) with:

```typescript
  static async initVault(vaultPath: string): Promise<void> {
    const kgDir = path.join(vaultPath, '.kg');
    const notesDir = path.join(vaultPath, 'notes');
    const agentDir = path.join(kgDir, 'agent', 'artifacts');
    const embDir = path.join(kgDir, 'embeddings');

    fs.mkdirSync(kgDir, { recursive: true });
    fs.mkdirSync(notesDir, { recursive: true });
    fs.mkdirSync(agentDir, { recursive: true });
    fs.mkdirSync(embDir, { recursive: true });

    const dbPath = path.join(kgDir, 'graph.db');
    const db = new Database(dbPath);
    db.pragma('journal_mode = WAL');
    db.pragma('foreign_keys = ON');

    setEngine({
      async exec(sql: string, params?: unknown[]) {
        if (params && params.length > 0) {
          return db.prepare(sql).run(...(params as unknown[])).changes;
        }
        db.exec(sql);
        return 0;
      },
      async query<T = Record<string, unknown>>(sql: string, params?: unknown[]) {
        if (params && params.length > 0) {
          return db.prepare(sql).all(...(params as unknown[])) as T[];
        }
        return db.prepare(sql).all() as T[];
      },
      async checkModuleAvailable(moduleName: string) {
        try {
          return db.prepare('SELECT name FROM pragma_module_list WHERE name = ?')
            .all(moduleName).length > 0;
        } catch {
          return false;
        }
      },
    });

    // The runner logs via console.log; an MCP stdio server must keep stdout
    // protocol-clean, so route logs to stderr for the duration.
    const origLog = console.log;
    console.log = console.error;
    let version: number;
    try {
      version = await runMigrations();
    } finally {
      console.log = origLog;
    }

    const configPath = path.join(kgDir, 'config.json');
    if (!fs.existsSync(configPath)) {
      fs.writeFileSync(configPath, JSON.stringify({
        name: path.basename(vaultPath),
        id: `vault_${crypto.randomUUID().slice(0, 12)}`,
        schemaVersion: version,
        createdAt: new Date().toISOString(),
      }, null, 2));
    }
    db.close();
  }
```

- [ ] **Step 2: Delete the fork** — remove the entire `const EXTRA_COLUMNS: [string, string, string][] = [ ... ];` block (lines 744-752) and the entire `const INIT_SCHEMA = \`...\`;` template literal (lines 754-919).

- [ ] **Step 3: Update the call site** — in `packages/synapse-mcp/src/index.ts`, find the `StandaloneGraphProvider.initVault(` call (the CLI `init` command path) and `await` it; make the enclosing function `async` if it isn't.

- [ ] **Step 4: Build and verify end-to-end vault parity**

Run:
```bash
npm run build:mcp
node -e "
const { execSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'synapse-mcp-init-'));
execSync(\`node packages/synapse-mcp/dist/index.js init '\${dir}'\`, { stdio: 'inherit' });  // adjust to the CLI's actual init invocation
const Database = require('better-sqlite3');
const db = new Database(path.join(dir, '.kg', 'graph.db'), { readonly: true });
const tables = db.prepare(\"SELECT name FROM sqlite_master WHERE type='table' ORDER BY name\").all().map(r => r.name);
console.log(tables.join('\n'));
const v = db.prepare('SELECT MAX(version) AS v FROM schema_version').get().v;
if (v < 14) throw new Error('migrations did not run: ' + v);
for (const t of ['source_content','reading_list_history','artifacts','nodes_fts','notes_fts']) {
  if (!tables.includes(t)) throw new Error('missing ' + t);
}
for (const t of ['spatial_positions','reading_list','browsing_history','memory_semantic','memory_episodic']) {
  if (tables.includes(t)) throw new Error('drifted table present: ' + t);
}
console.log('OK: MCP-initialized vault matches canonical schema v' + v);
"
```
Expected: `OK: MCP-initialized vault matches canonical schema v14`. (Adjust the `init` invocation to the CLI's actual syntax — check `packages/synapse-mcp/src/index.ts` for the command name.)

- [ ] **Step 5: Full verification + commit**

Run: `npm test && npm run build:electron && npm run build && npm run build:mcp`
Expected: green.

```bash
git add -A
git commit -m "fix(mcp): initialize vaults via canonical migrations, delete forked INIT_SCHEMA"
```

---

### Task 10: Documentation + final verification

**Files:**
- Modify: `ARCHITECTURE.md` (SQLite schema section), `docs/database-layer.md`, `docs/vector-embeddings.md` (embedding_metadata shape), `docs/memory-harness.md` (note DB memory tables removed), `CLAUDE.md`

- [ ] **Step 1: Update docs**

- `ARCHITECTURE.md`: remove dropped tables/columns from the schema listing; add migration 014 to any migration inventory.
- `docs/database-layer.md`: remove `indexed_files`/memory-repository mentions; document the v14 cleanup and the drifted-vault repair behavior.
- `docs/vector-embeddings.md`: `embedding_metadata` is now `(node_id, text_hash)`; `embedding_dismissals` removed.
- `docs/memory-harness.md`: add a line that the legacy `memory_semantic`/`memory_episodic` tables were removed in v14; files in `.kg/agent/memory/` are the only memory store.
- `CLAUDE.md`: replace the stale "No test framework or linter is configured." with "Tests: vitest (`npm test`), suites in `tests/`. No linter is configured."

- [ ] **Step 2: Self-review the diff**

Run: `git diff main --stat && grep -rn "extraction_log\|note_folders\|memory_semantic\|memory_episodic\|embedding_dismissals\|indexed_files\|rag_context\|preset_id\|content_type\|folder_path\|node_ids" src electron packages/synapse-mcp/src --include="*.ts" --include="*.tsx" | grep -v "migrations/0\|014-schema-cleanup"`
Expected: remaining hits only in immutable migrations 001–013 and the 014 file/test fixture.

- [ ] **Step 3: Full gate**

Run: `npm test && npm run build:electron && npm run build && npm run build:mcp`
Expected: all green.

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "docs: update schema docs for migration 014 and MCP migration sharing"
```

- [ ] **Step 5: Merge decision** — use superpowers:finishing-a-development-branch (merge to `desktop` vs PR).

---

## Self-review notes (done while writing)

- **Spec coverage:** 6 dead tables → Task 8 drops (+3 drifted-only); dead columns → Tasks 4-7 (code) + 8 (DDL); MCP latent bug → Tasks 8 (repair) + 9 (root cause). Deliberate keeps documented above.
- **Cascade hazard:** chat history protected by never rebuilding `chat_sessions` (runner-level try/DROP for preset_id) and proven by the drifted-vault test asserting `chat_messages` count.
- **Both-shape check:** every plain DROP COLUMN in 014 exists in v13 AND the MCP copy (rag_context ✓, note_attachments.source_url ✓, edges.source_url ✓, nodes.z ✓, nodes.content_type ✓ via EXTRA_COLUMNS, nodes.folder_path ✓, ontology_edge_types ×3 ✓).
- **Known acceptable losses:** embedding metadata reset (embeddings regenerate; opt-in feature), `extraction_log`/`memory_*`/`indexed_files` row data discarded (dead), drifted vaults keep a harmless `nodes.source_content` column. Pre-existing drifted vaults also remain without `nodes_fts`/`notes_fts` (migration 2 is version-gated and FTS DDL can't go in 014 — it would abort on FTS-less wa-sqlite builds); the runner detects the missing virtual tables at boot and search degrades gracefully to the LIKE fallback (`docs/search.md`).
- **Line numbers** cited from commit `ea31fee`; re-verify if the branch has moved (Task 0 Step 1).
