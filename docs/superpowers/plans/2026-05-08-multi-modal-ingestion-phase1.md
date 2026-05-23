# Multi-Modal Ingestion Phase 1: Foundation

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Establish the core type system, database schema, Zod validation, and processor factory that all subsequent phases build on.

**Architecture:** Define the `ContentProcessor` interface, `IngestionSource`, `SourceLocation`, and related types in a new `src/ingestion/` directory. Extend the database schema with a migration for provenance location columns and vault/content_type on nodes. Extend Zod extraction schemas with optional `sourceLocation`. Wire factory resolution.

**Tech Stack:** TypeScript, Zod, SQLite migrations

**Spec:** `docs/superpowers/specs/2026-05-03-multi-modal-ingestion-design.md`

**No test framework is configured.** Verify each task by running `npm run build` (Chrome) and checking for compile errors.

---

### Task 1: Create ingestion type definitions

**Files:**
- Create: `src/ingestion/types.ts`

- [ ] **Step 1: Create the types file**

Create `src/ingestion/types.ts` with all core types from the spec:

```ts
export interface IngestionSource {
  type: 'file' | 'url' | 'clipboard';
  mimeType: string;
  name: string;
  data: ArrayBuffer | string;
  size: number;
}

export type SourceLocation =
  | { type: 'page'; page: number; section?: string }
  | { type: 'region'; description: string }
  | { type: 'time'; timestamp: string; speaker?: string }
  | { type: 'selector'; selector: string };

export type ProcessingMode = 'quick' | 'full' | 'section';

export interface ContentChunk {
  text: string;
  location: SourceLocation;
  index: number;
}

export interface ProcessedContent {
  text: string;
  chunks?: ContentChunk[];
  metadata: {
    title?: string;
    author?: string;
    pageCount?: number;
    dimensions?: { w: number; h: number };
  };
}

export interface ModePromptResult {
  prompt: boolean;
  reason?: string;
  estimatedCost?: string;
}

export interface ContentProcessor {
  id: string;
  supportedMimeTypes: string[];
  supportedExtensions: string[];

  canProcess(source: IngestionSource): boolean;
  shouldPromptMode(source: IngestionSource): ModePromptResult;
  preprocess(
    source: IngestionSource,
    mode: ProcessingMode,
    onProgress?: (pct: number, msg: string) => void,
  ): Promise<ProcessedContent>;
  getExtractionContext?(): string;
  storeSource?(
    source: IngestionSource,
    nodeId: string,
  ): Promise<{ vaultPath: string }>;
}
```

- [ ] **Step 2: Verify it compiles**

Run: `npm run build 2>&1 | tail -5`
Expected: Build succeeds (the file is not imported anywhere yet, but TypeScript should parse it)

- [ ] **Step 3: Commit**

```bash
git add src/ingestion/types.ts
git commit -m "feat(ingestion): add core type definitions for multi-modal ingestion"
```

---

### Task 2: Create processor factory

**Files:**
- Create: `src/ingestion/processor-factory.ts`

- [ ] **Step 1: Create the factory file**

Create `src/ingestion/processor-factory.ts`:

```ts
import type { ContentProcessor, IngestionSource } from './types';

const processors: ContentProcessor[] = [];

export function registerProcessor(processor: ContentProcessor): void {
  processors.push(processor);
}

export function getProcessor(source: IngestionSource): ContentProcessor | null {
  return processors.find((p) => p.canProcess(source)) ?? null;
}

export function getSupportedExtensions(): string[] {
  return processors.flatMap((p) => p.supportedExtensions);
}

export function getSupportedMimeTypes(): string[] {
  return processors.flatMap((p) => p.supportedMimeTypes);
}
```

Note: `registerProcessor()` is included from the start so the factory already supports the evolution to a dynamic registry. Phase 2 processors call `registerProcessor()` at module load time.

- [ ] **Step 2: Verify it compiles**

Run: `npm run build 2>&1 | tail -5`
Expected: Build succeeds

- [ ] **Step 3: Commit**

```bash
git add src/ingestion/processor-factory.ts
git commit -m "feat(ingestion): add processor factory with registration"
```

---

### Task 3: Extend Zod schemas with sourceLocation

**Files:**
- Modify: `src/shared/schema.ts`

- [ ] **Step 1: Add sourceLocationSchema and extend extraction schemas**

At the top of `src/shared/schema.ts`, after the existing imports, add the `sourceLocationSchema`. Then add `sourceLocation` as optional field to `extractedNodeSchema` and `extractedEdgeSchema`.

Add the schema definition after the `import { z } from 'zod';` line:

```ts
export const sourceLocationSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('page'), page: z.number(), section: z.string().optional() }),
  z.object({ type: z.literal('region'), description: z.string() }),
  z.object({ type: z.literal('time'), timestamp: z.string(), speaker: z.string().optional() }),
  z.object({ type: z.literal('selector'), selector: z.string() }),
]);

export type SourceLocationZod = z.infer<typeof sourceLocationSchema>;
```

Modify `extractedNodeSchema` to add `sourceLocation`:

```ts
export const extractedNodeSchema = z.object({
  name: z.string().min(1),
  type: z.string().optional(),
  label: z.string().optional(),
  properties: z.record(z.string(), z.unknown()).optional(),
  tags: z.array(z.string()).optional(),
  sourceLocation: sourceLocationSchema.optional(),
});
```

Modify `extractedEdgeSchema` to add `sourceLocation`:

```ts
export const extractedEdgeSchema = z.object({
  sourceName: z.string().min(1),
  targetName: z.string().min(1),
  label: z.string().min(1),
  type: z.string().optional(),
  sourceLocation: sourceLocationSchema.optional(),
});
```

- [ ] **Step 2: Verify it compiles**

Run: `npm run build 2>&1 | tail -5`
Expected: Build succeeds. The `sourceLocation` field is optional so existing code that creates these objects won't break.

- [ ] **Step 3: Verify existing extraction still parses**

The Zod schemas are used in `useLLMExtraction.ts` at line ~249 to parse LLM output. Since `sourceLocation` is `.optional()`, existing LLM responses without it will still parse correctly.

- [ ] **Step 4: Commit**

```bash
git add src/shared/schema.ts
git commit -m "feat(schema): add sourceLocation to extraction schemas"
```

---

### Task 4: Add database migration for ingestion provenance

**Files:**
- Create: `src/db/worker/migrations/010-ingestion.ts`
- Modify: `src/db/worker/migrations/index.ts`

- [ ] **Step 1: Create migration file**

Create `src/db/worker/migrations/010-ingestion.ts`:

```ts
export const version = 10;
export const description = 'Ingestion provenance: location on sources, vault_path and content_type on nodes';

export const up = `
ALTER TABLE entity_sources ADD COLUMN location TEXT;
ALTER TABLE edge_sources ADD COLUMN location TEXT;
ALTER TABLE nodes ADD COLUMN vault_path TEXT;
ALTER TABLE nodes ADD COLUMN content_type TEXT;
`;
```

- [ ] **Step 2: Register the migration**

In `src/db/worker/migrations/index.ts`, add the import and include it in the migrations array.

Add after the `import * as migration009` line:

```ts
import * as migration010 from './010-ingestion';
```

Update the migrations array to include `migration010`:

```ts
const migrations: Migration[] = [migration001, migration002, migration003, migration004, migration005, migration006, migration007, migration008, migration009, migration010];
```

- [ ] **Step 3: Verify it compiles**

Run: `npm run build 2>&1 | tail -5`
Expected: Build succeeds

- [ ] **Step 4: Commit**

```bash
git add src/db/worker/migrations/010-ingestion.ts src/db/worker/migrations/index.ts
git commit -m "feat(db): add migration 010 for ingestion provenance columns"
```

---

### Task 5: Extend EntitySourceRepository with location support

**Files:**
- Modify: `src/db/data-store.ts` (EntitySourceRepository interface)
- Modify: `src/db/worker/queries/entity-source-queries.ts`
- Modify: `src/db/sqlite-data-store.ts`

- [ ] **Step 1: Update the EntitySourceRepository interface**

In `src/db/data-store.ts`, update the `add` method in `EntitySourceRepository` to accept an optional `location` parameter:

```ts
export interface EntitySourceRepository {
  getForEntity(entityId: string): Promise<Array<{ resourceId: string; relationType: string; createdAt: string; location?: string }>>;
  add(entityId: string, resourceId: string, relationType?: string, location?: string): Promise<void>;
  remove(entityId: string, resourceId: string, relationType?: string): Promise<boolean>;
  removeAllForResource(resourceId: string): Promise<number>;
  getEntitiesForResource(resourceId: string): Promise<Array<{ entityId: string; relationType: string }>>;
}
```

- [ ] **Step 2: Update entity-source-queries.ts**

In `src/db/worker/queries/entity-source-queries.ts`, update `addEntitySource` to accept and store the location:

```ts
export async function addEntitySource(
  entityId: string,
  resourceId: string,
  relationType: EntityRelationType = 'about',
  location?: string,
): Promise<void> {
  await executeExec(
    `INSERT OR IGNORE INTO entity_sources (entity_id, resource_id, relation_type, location)
     VALUES (?, ?, ?, ?);`,
    [entityId, resourceId, relationType, location ?? null]
  );
}
```

Update `getSourcesForEntity` to return the location:

```ts
export async function getSourcesForEntity(
  entityId: string
): Promise<{ resourceId: string; relationType: EntityRelationType; createdAt: string; location?: string }[]> {
  const { rows } = await executeQuery<DbEntitySource & { location?: string }>(
    'SELECT * FROM entity_sources WHERE entity_id = ? ORDER BY created_at;',
    [entityId]
  );
  return rows.map((r) => ({
    resourceId: r.resource_id,
    relationType: r.relation_type,
    createdAt: r.created_at,
    location: r.location ?? undefined,
  }));
}
```

- [ ] **Step 3: Update SqliteDataStore delegation**

In `src/db/sqlite-data-store.ts`, find the `entitySources` section and update the `add` delegation to pass through the `location` parameter. Find the line that calls `entitySourceQueries.addEntitySource` and add the fourth parameter:

```ts
add: (entityId, resourceId, relationType?, location?) =>
  entitySourceQueries.addEntitySource(entityId, resourceId, relationType, location),
```

Also update `getForEntity`:

```ts
getForEntity: (entityId) => entitySourceQueries.getSourcesForEntity(entityId),
```

- [ ] **Step 4: Update action-handler.ts**

In `src/db/worker/action-handler.ts`, find the `entitySources.add` case and update it to pass through location. Search for the case that handles `'entitySources.add'` and update:

```ts
case 'entitySources.add': {
  ensureInit();
  const p = params as { entityId: string; resourceId: string; relationType?: string; location?: string };
  await dataStore.entitySources.add(p.entityId, p.resourceId, p.relationType, p.location);
  return { result: { success: true } };
}
```

- [ ] **Step 5: Verify it compiles**

Run: `npm run build 2>&1 | tail -5`
Expected: Build succeeds. Existing callers of `entitySources.add(id, resourceId, 'about')` still work because `location` is optional.

- [ ] **Step 6: Commit**

```bash
git add src/db/data-store.ts src/db/worker/queries/entity-source-queries.ts src/db/sqlite-data-store.ts src/db/worker/action-handler.ts
git commit -m "feat(db): extend EntitySourceRepository with location support"
```

---

### Task 6: Extend EdgeSourceRepository with location support

**Files:**
- Modify: `src/db/data-store.ts` (EdgeSourceRepository interface)
- Modify: `src/db/worker/queries/edge-source-queries.ts`
- Modify: `src/db/sqlite-data-store.ts`

- [ ] **Step 1: Update the EdgeSourceRepository interface**

In `src/db/data-store.ts`, update the `add` method in `EdgeSourceRepository` to accept an optional `location` parameter:

```ts
export interface EdgeSourceRepository {
  add(input: {
    edgeId: string;
    sourceType: EdgeProvenanceType;
    sourceId?: string | null;
    resourceId?: string | null;
    location?: string | null;
  }): Promise<void>;
  getForEdge(edgeId: string): Promise<DbEdgeSource[]>;
  removeForNote(noteId: string): Promise<number>;
  getEdgesFromNote(noteId: string): Promise<string[]>;
}
```

- [ ] **Step 2: Update edge-source-queries.ts**

In `src/db/worker/queries/edge-source-queries.ts`, find the `addEdgeSource` function and update it to accept and insert the `location` field:

The existing INSERT statement needs the `location` column added. Find the INSERT statement and update it to:

```sql
INSERT INTO edge_sources (edge_id, source_type, source_id, resource_id, location) VALUES (?, ?, ?, ?, ?);
```

Pass `input.location ?? null` as the fifth parameter.

- [ ] **Step 3: Update SqliteDataStore delegation**

In `src/db/sqlite-data-store.ts`, find the `edgeSources.add` delegation. It should already pass through the full input object, so it should work if the query function accepts the new field. Verify the delegation passes the input object through unchanged.

- [ ] **Step 4: Verify it compiles**

Run: `npm run build 2>&1 | tail -5`
Expected: Build succeeds. Existing callers don't pass `location`, and it defaults to `null`.

- [ ] **Step 5: Commit**

```bash
git add src/db/data-store.ts src/db/worker/queries/edge-source-queries.ts src/db/sqlite-data-store.ts
git commit -m "feat(db): extend EdgeSourceRepository with location support"
```

---

### Task 7: Extend NodeRepository for vault_path and content_type

**Files:**
- Modify: `src/shared/types.ts` (DbNode type)
- Modify: `src/db/data-store.ts` (NodeRepository.create input)

- [ ] **Step 1: Add vault_path and content_type to DbNode**

In `src/shared/types.ts`, find the `DbNode` type definition and add:

```ts
vault_path?: string | null;
content_type?: string | null;
```

These are nullable columns added by migration 010.

- [ ] **Step 2: Update NodeRepository.create input**

In `src/db/data-store.ts`, update the `create` method input type in `NodeRepository` to accept:

```ts
create(input: {
  name: string;
  type?: string;
  label?: string;
  folderPath?: string;
  identifier?: string;
  properties?: string;
  color?: string;
  size?: number;
  sourceUrl?: string;
  vaultPath?: string;
  contentType?: string;
}): Promise<DbNode>;
```

- [ ] **Step 3: Update node-queries.ts createNode**

In `src/db/worker/queries/node-queries.ts`, find the `createNode` function and update the INSERT statement to include `vault_path` and `content_type`:

Add `vault_path` and `content_type` to the column list and values. Pass `input.vaultPath ?? null` and `input.contentType ?? null`.

- [ ] **Step 4: Update SqliteDataStore delegation**

In `src/db/sqlite-data-store.ts`, verify the `nodes.create` delegation passes through the full input object to `nodeQueries.createNode`. It should work if the query function accepts the new fields.

- [ ] **Step 5: Verify it compiles**

Run: `npm run build 2>&1 | tail -5`
Expected: Build succeeds. Existing callers of `nodes.create` don't pass the new fields, so they default to null.

- [ ] **Step 6: Commit**

```bash
git add src/shared/types.ts src/db/data-store.ts src/db/worker/queries/node-queries.ts src/db/sqlite-data-store.ts
git commit -m "feat(db): add vault_path and content_type to NodeRepository"
```

---

### Task 8: Create ingestion barrel export

**Files:**
- Create: `src/ingestion/index.ts`

- [ ] **Step 1: Create barrel export**

Create `src/ingestion/index.ts`:

```ts
export type {
  IngestionSource,
  SourceLocation,
  ProcessingMode,
  ProcessedContent,
  ContentChunk,
  ContentProcessor,
  ModePromptResult,
} from './types';

export { getProcessor, registerProcessor, getSupportedExtensions, getSupportedMimeTypes } from './processor-factory';
```

- [ ] **Step 2: Verify it compiles**

Run: `npm run build 2>&1 | tail -5`
Expected: Build succeeds

- [ ] **Step 3: Commit**

```bash
git add src/ingestion/index.ts
git commit -m "feat(ingestion): add barrel export for ingestion module"
```
