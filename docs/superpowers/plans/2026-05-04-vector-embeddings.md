# Vector Embeddings Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add opt-in vector embeddings to the Electron desktop app for semantic node similarity, merge recommendations, and improved search/RAG context.

**Architecture:** Local ONNX model + OpenAI API behind a provider abstraction. sqlite-vec for KNN search in better-sqlite3. Background queue computes embeddings incrementally. Five consumers: Intelligence Panel merge recs, RAG, search bar, chat tool, context chip auto-suggest.

**Tech Stack:** `@huggingface/transformers` (ONNX inference in worker_threads), `sqlite-vec` (native SQLite extension), existing better-sqlite3 + Zustand + React stack.

**Verification:** No test framework configured. Each task verified via `npm run build && npm run build:electron` (both must pass clean). Manual smoke test in Electron for runtime behavior.

**Critical constraint:** Chrome extension must remain completely unaffected. `src/embeddings/types.ts` is type-only. Both platform index files export `embedding`. No Node.js imports leak into Vite-built code.

---

## Phase 1: Core Infrastructure

### Task 1: Shared Types + Migration

**Files:**
- Create: `src/embeddings/types.ts`
- Create: `src/db/worker/migrations/009-embeddings.ts`
- Modify: `src/db/worker/migrations/index.ts`

- [ ] **Step 1: Create `src/embeddings/types.ts`**

This file must contain ONLY TypeScript type/interface declarations. No runtime imports.

```typescript
export interface EmbeddingProvider {
  id: string;
  name: string;
  dimensions: number;
  maxTokens: number;

  initialize(): Promise<void>;
  embed(text: string): Promise<Float32Array>;
  embedBatch(texts: string[]): Promise<Float32Array[]>;
  isAvailable(): Promise<boolean>;
  dispose(): Promise<void>;
}

export interface EmbeddingConfig {
  enabled: boolean;
  providerId: string;
  onnxModelQuality: 'quantized' | 'full';
  openaiApiKey?: string;
  openaiModel?: string;
  similarityThreshold: number;
  autoEmbed: boolean;
}

export const DEFAULT_EMBEDDING_CONFIG: EmbeddingConfig = {
  enabled: false,
  providerId: 'onnx-minilm',
  onnxModelQuality: 'quantized',
  similarityThreshold: 0.80,
  autoEmbed: true,
};

export interface EmbeddingStatus {
  enabled: boolean;
  providerId: string | null;
  totalNodes: number;
  embeddedNodes: number;
  processing: boolean;
  progress?: { done: number; total: number };
}

export interface SimilarPair {
  nodeA: {
    id: string;
    name: string;
    type: string;
    label: string | null;
    connectionCount: number;
    summary: string | null;
  };
  nodeB: {
    id: string;
    name: string;
    type: string;
    label: string | null;
    connectionCount: number;
    summary: string | null;
  };
  similarity: number;
}

export interface SemanticSearchResult {
  nodeId: string;
  score: number;
}

export interface PlatformEmbedding {
  isAvailable(): Promise<boolean>;
  getStatus(): Promise<EmbeddingStatus>;
  configure(config: Partial<EmbeddingConfig>): Promise<void>;
  searchSimilar(query: string, topK?: number): Promise<SemanticSearchResult[]>;
  searchSimilarByNodeId(nodeId: string, topK?: number): Promise<SemanticSearchResult[]>;
  findDuplicatePairs(threshold?: number, limit?: number): Promise<SimilarPair[]>;
  dismissPair(nodeIdA: string, nodeIdB: string): Promise<void>;
  onProgress(cb: (progress: { done: number; total: number }) => void): () => void;
}
```

- [ ] **Step 2: Create `src/db/worker/migrations/009-embeddings.ts`**

```typescript
export const version = 9;
export const description = 'Embedding metadata and dismissals tables (optional)';
export const optional = true;

export const up = `
CREATE TABLE IF NOT EXISTS embedding_metadata (
  node_id TEXT PRIMARY KEY REFERENCES nodes(id) ON DELETE CASCADE,
  provider_id TEXT NOT NULL,
  dimensions INTEGER NOT NULL,
  embedded_at TEXT NOT NULL,
  text_hash TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS embedding_dismissals (
  node_id_a TEXT NOT NULL REFERENCES nodes(id) ON DELETE CASCADE,
  node_id_b TEXT NOT NULL REFERENCES nodes(id) ON DELETE CASCADE,
  dismissed_at TEXT NOT NULL,
  PRIMARY KEY (node_id_a, node_id_b)
);
`;
```

- [ ] **Step 3: Register migration in `src/db/worker/migrations/index.ts`**

Add import alongside existing migrations and append to the migrations array. The existing file imports `migration001` through `migration008` and lists them in an array. Add:

```typescript
import * as migration009 from './009-embeddings';
```

And append `migration009` to the end of the `migrations` array.

- [ ] **Step 4: Verify build**

Run: `npm run build && npm run build:electron`
Expected: Both pass clean. The migration runs on both platforms — only creates regular tables, marked optional.

- [ ] **Step 5: Commit**

```bash
git add src/embeddings/types.ts src/db/worker/migrations/009-embeddings.ts src/db/worker/migrations/index.ts
git commit -m "feat(embeddings): add shared types and migration 009"
```

---

### Task 2: Platform Abstraction Layer

**Files:**
- Create: `src/platform/chrome/embedding.ts`
- Create: `src/platform/electron/embedding.ts`
- Modify: `src/platform/types.ts`
- Modify: `src/platform/chrome/index.ts`
- Modify: `src/platform/electron/index.ts`

- [ ] **Step 1: Add `PlatformEmbedding` to `src/platform/types.ts`**

Import and re-export the interface. At the top of the file, add:

```typescript
export type { PlatformEmbedding } from '../embeddings/types';
```

This is a type-only re-export — no runtime code.

- [ ] **Step 2: Create `src/platform/chrome/embedding.ts`**

Chrome no-op stub. All methods return safe defaults.

```typescript
import type { PlatformEmbedding, EmbeddingStatus, SemanticSearchResult, SimilarPair, EmbeddingConfig } from '../../embeddings/types';

const NOOP_STATUS: EmbeddingStatus = {
  enabled: false,
  providerId: null,
  totalNodes: 0,
  embeddedNodes: 0,
  processing: false,
};

export class ChromeEmbedding implements PlatformEmbedding {
  async isAvailable(): Promise<boolean> { return false; }
  async getStatus(): Promise<EmbeddingStatus> { return NOOP_STATUS; }
  async configure(_config: Partial<EmbeddingConfig>): Promise<void> {}
  async searchSimilar(_query: string, _topK?: number): Promise<SemanticSearchResult[]> { return []; }
  async searchSimilarByNodeId(_nodeId: string, _topK?: number): Promise<SemanticSearchResult[]> { return []; }
  async findDuplicatePairs(_threshold?: number, _limit?: number): Promise<SimilarPair[]> { return []; }
  async dismissPair(_nodeIdA: string, _nodeIdB: string): Promise<void> {}
  onProgress(_cb: (progress: { done: number; total: number }) => void): () => void { return () => {}; }
}
```

- [ ] **Step 3: Create `src/platform/electron/embedding.ts`**

IPC wrapper that delegates to the Electron main process.

```typescript
import type { PlatformEmbedding, EmbeddingStatus, EmbeddingConfig, SemanticSearchResult, SimilarPair } from '../../embeddings/types';

declare const window: Window & {
  electronIPC: {
    invoke(channel: string, ...args: unknown[]): Promise<unknown>;
    on(channel: string, cb: (...args: unknown[]) => void): () => void;
  };
};

export class ElectronEmbedding implements PlatformEmbedding {
  async isAvailable(): Promise<boolean> {
    return window.electronIPC.invoke('embedding:is-available') as Promise<boolean>;
  }

  async getStatus(): Promise<EmbeddingStatus> {
    return window.electronIPC.invoke('embedding:get-status') as Promise<EmbeddingStatus>;
  }

  async configure(config: Partial<EmbeddingConfig>): Promise<void> {
    await window.electronIPC.invoke('embedding:configure', config);
  }

  async searchSimilar(query: string, topK = 5): Promise<SemanticSearchResult[]> {
    return window.electronIPC.invoke('embedding:search-similar', query, topK) as Promise<SemanticSearchResult[]>;
  }

  async searchSimilarByNodeId(nodeId: string, topK = 5): Promise<SemanticSearchResult[]> {
    return window.electronIPC.invoke('embedding:search-similar-by-node', nodeId, topK) as Promise<SemanticSearchResult[]>;
  }

  async findDuplicatePairs(threshold?: number, limit?: number): Promise<SimilarPair[]> {
    return window.electronIPC.invoke('embedding:find-duplicate-pairs', threshold, limit) as Promise<SimilarPair[]>;
  }

  async dismissPair(nodeIdA: string, nodeIdB: string): Promise<void> {
    await window.electronIPC.invoke('embedding:dismiss-pair', nodeIdA, nodeIdB);
  }

  onProgress(cb: (progress: { done: number; total: number }) => void): () => void {
    return window.electronIPC.on('embedding:progress', cb as (...args: unknown[]) => void);
  }
}
```

- [ ] **Step 4: Export `embedding` from `src/platform/chrome/index.ts`**

Add import and export alongside existing platform exports:

```typescript
import { ChromeEmbedding } from './embedding';

export const embedding = new ChromeEmbedding();
```

- [ ] **Step 5: Export `embedding` from `src/platform/electron/index.ts`**

Same pattern:

```typescript
import { ElectronEmbedding } from './embedding';

export const embedding = new ElectronEmbedding();
```

- [ ] **Step 6: Verify build**

Run: `npm run build && npm run build:electron`
Expected: Both pass clean. Chrome gets no-op stub, Electron gets IPC wrapper. No runtime Node.js imports in shared code.

- [ ] **Step 7: Commit**

```bash
git add src/platform/types.ts src/platform/chrome/embedding.ts src/platform/chrome/index.ts src/platform/electron/embedding.ts src/platform/electron/index.ts
git commit -m "feat(embeddings): add PlatformEmbedding abstraction with Chrome no-op and Electron IPC"
```

---

### Task 3: sqlite-vec Store

**Files:**
- Create: `electron/embeddings/vec-store.ts`
- Modify: `electron/better-sqlite3-engine.ts`

**Context:** `better-sqlite3-engine.ts` currently exports `initBetterSQLite()`, `exec()`, `query()`, and `checkModuleAvailable()`. The `db` instance is private. We need to either expose it or provide a `getDb()` accessor so `vec-store.ts` can call `db.loadExtension()` and `db.prepare()` directly (sqlite-vec requires prepared statements with buffer parameters that the generic `exec`/`query` wrappers don't support).

- [ ] **Step 1: Add `getDb()` export to `electron/better-sqlite3-engine.ts`**

After the existing `db` variable declaration, add a getter:

```typescript
export function getDb(): Database.Database {
  if (!db) throw new Error('DB not initialized');
  return db;
}
```

- [ ] **Step 2: Create `electron/embeddings/vec-store.ts`**

```typescript
import Database from 'better-sqlite3';
import { app } from 'electron';
import { join, dirname } from 'path';
import { existsSync } from 'fs';

let vecLoaded = false;

function resolveExtensionPath(): string {
  const exeDir = dirname(app.getPath('exe'));
  const candidates = [
    join(exeDir, '..', 'Resources', 'sqlite-vec', 'vec0'),
    join(exeDir, 'resources', 'sqlite-vec', 'vec0'),
    join(app.getAppPath(), 'resources', 'sqlite-vec', 'vec0'),
  ];
  if (app.isPackaged) {
    for (const p of candidates) {
      if (existsSync(p) || existsSync(p + '.dylib') || existsSync(p + '.so') || existsSync(p + '.dll')) {
        return p;
      }
    }
  }
  return join(app.getAppPath(), 'resources', 'sqlite-vec', 'vec0');
}

export function loadVecExtension(db: Database.Database): boolean {
  if (vecLoaded) return true;
  try {
    db.loadExtension(resolveExtensionPath());
    vecLoaded = true;
    return true;
  } catch (e) {
    console.error('[vec-store] Failed to load sqlite-vec:', e);
    return false;
  }
}

export function ensureVecTable(db: Database.Database, dimensions: number): void {
  db.exec(`
    CREATE VIRTUAL TABLE IF NOT EXISTS vec_nodes USING vec0(
      node_id TEXT PRIMARY KEY,
      embedding float[${dimensions}]
    )
  `);
  db.exec(`
    CREATE TABLE IF NOT EXISTS similar_pairs (
      node_id_a TEXT NOT NULL,
      node_id_b TEXT NOT NULL,
      similarity REAL NOT NULL,
      updated_at TEXT NOT NULL,
      PRIMARY KEY (node_id_a, node_id_b)
    )
  `);
}

export function dropVecTable(db: Database.Database): void {
  db.exec('DROP TABLE IF EXISTS vec_nodes');
  db.exec('DELETE FROM similar_pairs');
}

export function insertEmbedding(db: Database.Database, nodeId: string, embedding: Float32Array): void {
  const stmt = db.prepare('INSERT OR REPLACE INTO vec_nodes(node_id, embedding) VALUES (?, ?)');
  stmt.run(nodeId, Buffer.from(embedding.buffer));
}

export function deleteEmbedding(db: Database.Database, nodeId: string): void {
  db.prepare('DELETE FROM vec_nodes WHERE node_id = ?').run(nodeId);
}

export function knnSearch(
  db: Database.Database,
  queryVec: Float32Array,
  topK: number,
  excludeNodeId?: string,
): Array<{ nodeId: string; distance: number }> {
  const sql = excludeNodeId
    ? `SELECT node_id, distance FROM vec_nodes WHERE embedding MATCH ? AND node_id != ? ORDER BY distance LIMIT ?`
    : `SELECT node_id, distance FROM vec_nodes WHERE embedding MATCH ? ORDER BY distance LIMIT ?`;

  const params = excludeNodeId
    ? [Buffer.from(queryVec.buffer), excludeNodeId, topK]
    : [Buffer.from(queryVec.buffer), topK];

  const rows = db.prepare(sql).all(...params) as Array<{ node_id: string; distance: number }>;
  return rows.map((r) => ({ nodeId: r.node_id, distance: r.distance }));
}

export function upsertSimilarPair(
  db: Database.Database,
  nodeIdA: string,
  nodeIdB: string,
  similarity: number,
): void {
  const [a, b] = nodeIdA < nodeIdB ? [nodeIdA, nodeIdB] : [nodeIdB, nodeIdA];
  db.prepare(
    'INSERT OR REPLACE INTO similar_pairs(node_id_a, node_id_b, similarity, updated_at) VALUES (?, ?, ?, ?)'
  ).run(a, b, similarity, new Date().toISOString());
}

export function removeSimilarPairsFor(db: Database.Database, nodeId: string): void {
  db.prepare('DELETE FROM similar_pairs WHERE node_id_a = ? OR node_id_b = ?').run(nodeId, nodeId);
}

export function getSimilarPairs(
  db: Database.Database,
  threshold: number,
  limit: number,
): Array<{ nodeIdA: string; nodeIdB: string; similarity: number }> {
  const dismissed = db.prepare(
    'SELECT node_id_a, node_id_b FROM embedding_dismissals'
  ).all() as Array<{ node_id_a: string; node_id_b: string }>;
  const dismissedSet = new Set(dismissed.map((d) => `${d.node_id_a}:${d.node_id_b}`));

  const rows = db.prepare(
    'SELECT node_id_a, node_id_b, similarity FROM similar_pairs WHERE similarity >= ? ORDER BY similarity DESC LIMIT ?'
  ).all(threshold, limit * 2) as Array<{ node_id_a: string; node_id_b: string; similarity: number }>;

  const result: Array<{ nodeIdA: string; nodeIdB: string; similarity: number }> = [];
  for (const r of rows) {
    const key = `${r.node_id_a}:${r.node_id_b}`;
    if (!dismissedSet.has(key)) {
      result.push({ nodeIdA: r.node_id_a, nodeIdB: r.node_id_b, similarity: r.similarity });
      if (result.length >= limit) break;
    }
  }
  return result;
}

export function addDismissal(db: Database.Database, nodeIdA: string, nodeIdB: string): void {
  const [a, b] = nodeIdA < nodeIdB ? [nodeIdA, nodeIdB] : [nodeIdB, nodeIdA];
  db.prepare(
    'INSERT OR IGNORE INTO embedding_dismissals(node_id_a, node_id_b, dismissed_at) VALUES (?, ?, ?)'
  ).run(a, b, new Date().toISOString());
}
```

- [ ] **Step 3: Verify build**

Run: `npm run build:electron-main`
Expected: Passes clean. (Chrome build doesn't touch `electron/` files.)

- [ ] **Step 4: Commit**

```bash
git add electron/better-sqlite3-engine.ts electron/embeddings/vec-store.ts
git commit -m "feat(embeddings): add sqlite-vec store with KNN search and similar pairs cache"
```

---

### Task 4: ONNX Embedding Provider

**Files:**
- Create: `electron/embeddings/onnx-provider.ts`
- Create: `electron/embeddings/onnx-worker.ts`

**Dependencies:** Install `@huggingface/transformers` — `npm install @huggingface/transformers`

- [ ] **Step 1: Install dependency**

```bash
npm install @huggingface/transformers
```

- [ ] **Step 2: Create `electron/embeddings/onnx-worker.ts`**

This runs in a Node.js `worker_threads` Worker so ONNX inference doesn't block the main thread.

```typescript
import { parentPort, workerData } from 'worker_threads';

let pipeline: any = null;

async function loadModel(modelQuality: 'quantized' | 'full', cacheDir: string) {
  const { pipeline: createPipeline, env } = await import('@huggingface/transformers');
  env.cacheDir = cacheDir;
  env.allowLocalModels = true;

  const modelId = 'Xenova/all-MiniLM-L6-v2';
  const options: Record<string, unknown> = {};
  if (modelQuality === 'quantized') {
    options.quantized = true;
  }

  pipeline = await createPipeline('feature-extraction', modelId, options);
  parentPort?.postMessage({ type: 'ready' });
}

async function embed(texts: string[]): Promise<Float32Array[]> {
  if (!pipeline) throw new Error('Model not loaded');
  const output = await pipeline(texts, { pooling: 'mean', normalize: true });
  const results: Float32Array[] = [];
  for (let i = 0; i < texts.length; i++) {
    results.push(new Float32Array(output[i].data));
  }
  return results;
}

parentPort?.on('message', async (msg: { type: string; texts?: string[]; requestId?: string; modelQuality?: 'quantized' | 'full'; cacheDir?: string }) => {
  try {
    if (msg.type === 'load') {
      await loadModel(msg.modelQuality ?? 'quantized', msg.cacheDir ?? '');
    } else if (msg.type === 'embed' && msg.texts && msg.requestId) {
      const vectors = await embed(msg.texts);
      const transferable = vectors.map((v) => v.buffer);
      parentPort?.postMessage(
        { type: 'result', requestId: msg.requestId, vectors },
        transferable,
      );
    }
  } catch (e: any) {
    parentPort?.postMessage({ type: 'error', requestId: msg.requestId, error: e.message });
  }
});
```

- [ ] **Step 3: Create `electron/embeddings/onnx-provider.ts`**

```typescript
import { Worker } from 'worker_threads';
import { app } from 'electron';
import { join } from 'path';
import type { EmbeddingProvider } from '../../src/embeddings/types';

export class OnnxProvider implements EmbeddingProvider {
  readonly id: string;
  readonly name = 'Local (MiniLM)';
  readonly dimensions = 384;
  readonly maxTokens = 256;

  private worker: Worker | null = null;
  private pendingRequests = new Map<string, { resolve: (v: Float32Array[]) => void; reject: (e: Error) => void }>();
  private modelQuality: 'quantized' | 'full';

  constructor(modelQuality: 'quantized' | 'full' = 'quantized') {
    this.modelQuality = modelQuality;
    this.id = modelQuality === 'full' ? 'onnx-minilm-full' : 'onnx-minilm';
  }

  async initialize(): Promise<void> {
    const workerPath = join(__dirname, 'onnx-worker.js');
    this.worker = new Worker(workerPath);

    this.worker.on('message', (msg: { type: string; requestId?: string; vectors?: Float32Array[]; error?: string }) => {
      if (msg.type === 'result' && msg.requestId && msg.vectors) {
        this.pendingRequests.get(msg.requestId)?.resolve(msg.vectors);
        this.pendingRequests.delete(msg.requestId);
      } else if (msg.type === 'error' && msg.requestId) {
        this.pendingRequests.get(msg.requestId)?.reject(new Error(msg.error ?? 'ONNX worker error'));
        this.pendingRequests.delete(msg.requestId);
      }
    });

    const cacheDir = join(app.getPath('userData'), 'models');
    await new Promise<void>((resolve, reject) => {
      const onMsg = (msg: { type: string; error?: string }) => {
        if (msg.type === 'ready') {
          this.worker?.off('message', onMsg);
          resolve();
        } else if (msg.type === 'error') {
          this.worker?.off('message', onMsg);
          reject(new Error(msg.error ?? 'Model load failed'));
        }
      };
      this.worker!.on('message', onMsg);
      this.worker!.postMessage({ type: 'load', modelQuality: this.modelQuality, cacheDir });
    });
  }

  async embed(text: string): Promise<Float32Array> {
    const results = await this.embedBatch([text]);
    return results[0];
  }

  async embedBatch(texts: string[]): Promise<Float32Array[]> {
    if (!this.worker) throw new Error('ONNX provider not initialized');
    const chunkSize = this.modelQuality === 'full' ? 12 : 32;
    const allResults: Float32Array[] = [];

    for (let i = 0; i < texts.length; i += chunkSize) {
      const chunk = texts.slice(i, i + chunkSize);
      const requestId = crypto.randomUUID();
      const vectors = await new Promise<Float32Array[]>((resolve, reject) => {
        this.pendingRequests.set(requestId, { resolve, reject });
        this.worker!.postMessage({ type: 'embed', texts: chunk, requestId });
      });
      allResults.push(...vectors);
    }
    return allResults;
  }

  async isAvailable(): Promise<boolean> {
    return this.worker !== null;
  }

  async dispose(): Promise<void> {
    if (this.worker) {
      await this.worker.terminate();
      this.worker = null;
    }
    this.pendingRequests.clear();
  }
}
```

- [ ] **Step 4: Verify build**

Run: `npm run build:electron-main`
Expected: Passes clean.

- [ ] **Step 5: Commit**

```bash
git add electron/embeddings/onnx-provider.ts electron/embeddings/onnx-worker.ts package.json package-lock.json
git commit -m "feat(embeddings): add ONNX embedding provider with worker_threads inference"
```

---

### Task 5: OpenAI Embedding Provider

**Files:**
- Create: `electron/embeddings/openai-provider.ts`

- [ ] **Step 1: Create `electron/embeddings/openai-provider.ts`**

```typescript
import type { EmbeddingProvider } from '../../src/embeddings/types';
import { withRetry } from '../../src/core/retry';

interface OpenAIEmbeddingResponse {
  data: Array<{ embedding: number[]; index: number }>;
  usage: { prompt_tokens: number; total_tokens: number };
}

export class OpenAIProvider implements EmbeddingProvider {
  readonly id: string;
  readonly name: string;
  readonly dimensions: number;
  readonly maxTokens = 8191;

  private apiKey: string;
  private model: string;

  constructor(apiKey: string, model: string = 'text-embedding-3-small') {
    this.apiKey = apiKey;
    this.model = model;
    this.id = model === 'text-embedding-3-large' ? 'openai-large' : 'openai-small';
    this.name = `OpenAI (${model})`;
    this.dimensions = model === 'text-embedding-3-large' ? 3072 : 1536;
  }

  async initialize(): Promise<void> {
    const available = await this.isAvailable();
    if (!available) throw new Error('OpenAI API key is invalid or API is unreachable');
  }

  async embed(text: string): Promise<Float32Array> {
    const results = await this.embedBatch([text]);
    return results[0];
  }

  async embedBatch(texts: string[]): Promise<Float32Array[]> {
    const allResults: Float32Array[] = [];
    const batchSize = 100;

    for (let i = 0; i < texts.length; i += batchSize) {
      const chunk = texts.slice(i, i + batchSize);
      const response = await withRetry(() => this.callAPI(chunk), {
        maxRetries: 3,
        baseDelay: 1000,
      });
      const sorted = response.data.sort((a, b) => a.index - b.index);
      for (const item of sorted) {
        allResults.push(new Float32Array(item.embedding));
      }
    }
    return allResults;
  }

  async isAvailable(): Promise<boolean> {
    try {
      await this.callAPI(['test']);
      return true;
    } catch {
      return false;
    }
  }

  async dispose(): Promise<void> {}

  private async callAPI(input: string[]): Promise<OpenAIEmbeddingResponse> {
    const response = await fetch('https://api.openai.com/v1/embeddings', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify({ input, model: this.model }),
    });

    if (!response.ok) {
      const text = await response.text();
      throw new Error(`OpenAI API error ${response.status}: ${text}`);
    }

    return response.json();
  }
}
```

- [ ] **Step 2: Verify build**

Run: `npm run build:electron-main`
Expected: Passes clean.

- [ ] **Step 3: Commit**

```bash
git add electron/embeddings/openai-provider.ts
git commit -m "feat(embeddings): add OpenAI embedding provider"
```

---

### Task 6: Embedding Queue + buildEmbeddingText

**Files:**
- Create: `electron/embeddings/embedding-queue.ts`
- Create: `electron/embeddings/build-embedding-text.ts`

- [ ] **Step 1: Create `electron/embeddings/build-embedding-text.ts`**

```typescript
import type Database from 'better-sqlite3';

export function buildEmbeddingText(
  node: { id: string; name: string; type: string; summary?: string | null },
  db: Database.Database,
  readNote?: (nodeId: string) => string | null,
): string {
  if (node.type === 'entity') {
    return node.summary ? `${node.name}. ${node.summary}` : node.name;
  }

  if (node.type === 'note') {
    if (readNote) {
      const content = readNote(node.id);
      if (content) {
        const frontmatter = parseFrontmatter(content);
        if (frontmatter.description || frontmatter.labels) {
          const parts = [node.name];
          if (frontmatter.description) parts.push(frontmatter.description);
          if (frontmatter.labels) parts.push(frontmatter.labels);
          return parts.join('. ');
        }
        const body = stripFrontmatter(content).slice(0, 500);
        if (body.trim()) return `${node.name}. ${body.trim()}`;
      }
    }
    const noteRow = db.prepare('SELECT title, body FROM note_search WHERE node_id = ?').get(node.id) as { title: string; body: string } | undefined;
    if (noteRow?.body) return `${node.name}. ${noteRow.body.slice(0, 500)}`;
    return node.name;
  }

  if (node.type === 'resource') {
    const source = db.prepare('SELECT title, content FROM source_content WHERE node_id = ?').get(node.id) as { title: string | null; content: string } | undefined;
    if (source) {
      const parts = [node.name];
      if (source.title) parts.push(source.title);
      parts.push(source.content.slice(0, 500));
      return parts.join('. ');
    }
    return node.name;
  }

  return node.name;
}

function parseFrontmatter(content: string): { description?: string; labels?: string } {
  const match = content.match(/^---\n([\s\S]*?)\n---/);
  if (!match) return {};
  const yaml = match[1];
  const result: { description?: string; labels?: string } = {};
  const descMatch = yaml.match(/description:\s*(.+)/);
  if (descMatch) result.description = descMatch[1].trim().replace(/^["']|["']$/g, '');
  const labelMatch = yaml.match(/labels:\s*(.+)/);
  if (labelMatch) result.labels = labelMatch[1].trim().replace(/^["']|["']$/g, '');
  return result;
}

function stripFrontmatter(content: string): string {
  return content.replace(/^---\n[\s\S]*?\n---\n?/, '');
}

export function computeTextHash(text: string): string {
  let hash = 5381;
  for (let i = 0; i < text.length; i++) {
    hash = ((hash << 5) + hash + text.charCodeAt(i)) | 0;
  }
  return hash.toString(36);
}
```

- [ ] **Step 2: Create `electron/embeddings/embedding-queue.ts`**

```typescript
import type Database from 'better-sqlite3';
import type { EmbeddingProvider } from '../../src/embeddings/types';
import { insertEmbedding, deleteEmbedding, knnSearch, upsertSimilarPair, removeSimilarPairsFor } from './vec-store';
import { computeTextHash } from './build-embedding-text';

interface QueueItem {
  nodeId: string;
  text: string;
}

export class EmbeddingQueue {
  private queue: QueueItem[] = [];
  private processing = false;
  private idleDelay = 50;
  private db: Database.Database;
  private provider: EmbeddingProvider;
  private onProgressCb?: (done: number, total: number) => void;

  constructor(db: Database.Database, provider: EmbeddingProvider) {
    this.db = db;
    this.provider = provider;
  }

  setOnProgress(cb: (done: number, total: number) => void): void {
    this.onProgressCb = cb;
  }

  enqueue(nodeId: string, text: string): void {
    this.queue.push({ nodeId, text });
    if (!this.processing) {
      this.drain();
    }
  }

  async batchProcess(
    nodes: Array<{ id: string; text: string }>,
    onProgress: (done: number, total: number) => void,
  ): Promise<void> {
    const total = nodes.length;
    let done = 0;

    for (let i = 0; i < nodes.length; i += this.provider.maxTokens > 1000 ? 32 : 12) {
      const chunk = nodes.slice(i, i + (this.provider.maxTokens > 1000 ? 32 : 12));
      const texts = chunk.map((n) => n.text);

      try {
        const vectors = await this.provider.embedBatch(texts);
        for (let j = 0; j < chunk.length; j++) {
          this.storeEmbedding(chunk[j].id, chunk[j].text, vectors[j]);
        }
      } catch (e) {
        console.error('[EmbeddingQueue] Batch error, falling back to individual:', e);
        for (const item of chunk) {
          try {
            const vec = await this.provider.embed(item.text);
            this.storeEmbedding(item.id, item.text, vec);
          } catch (e2) {
            console.error(`[EmbeddingQueue] Failed to embed ${item.id}:`, e2);
          }
        }
      }

      done += chunk.length;
      onProgress(done, total);

      await new Promise((r) => setTimeout(r, this.idleDelay));
    }
  }

  private async drain(): Promise<void> {
    if (this.processing) return;
    this.processing = true;

    while (this.queue.length > 0) {
      const item = this.queue.shift()!;
      try {
        const vec = await this.provider.embed(item.text);
        this.storeEmbedding(item.nodeId, item.text, vec);
      } catch (e) {
        console.error(`[EmbeddingQueue] Failed to embed ${item.nodeId}:`, e);
      }
      if (this.queue.length > 0) {
        await new Promise((r) => setTimeout(r, this.idleDelay));
      }
    }

    this.processing = false;
  }

  private storeEmbedding(nodeId: string, text: string, vec: Float32Array): void {
    insertEmbedding(this.db, nodeId, vec);

    const hash = computeTextHash(text);
    this.db.prepare(
      'INSERT OR REPLACE INTO embedding_metadata(node_id, provider_id, dimensions, embedded_at, text_hash) VALUES (?, ?, ?, ?, ?)'
    ).run(nodeId, this.provider.id, this.provider.dimensions, new Date().toISOString(), hash);

    this.updateSimilarPairs(nodeId, vec);
  }

  private updateSimilarPairs(nodeId: string, vec: Float32Array): void {
    removeSimilarPairsFor(this.db, nodeId);
    const neighbors = knnSearch(this.db, vec, 3, nodeId);
    for (const n of neighbors) {
      const similarity = 1 - n.distance;
      if (similarity >= 0.5) {
        upsertSimilarPair(this.db, nodeId, n.nodeId, similarity);
      }
    }
  }

  handleNodeDeleted(nodeId: string): void {
    deleteEmbedding(this.db, nodeId);
    removeSimilarPairsFor(this.db, nodeId);
    this.db.prepare('DELETE FROM embedding_metadata WHERE node_id = ?').run(nodeId);
  }

  get pending(): number {
    return this.queue.length;
  }

  get isProcessing(): boolean {
    return this.processing;
  }
}
```

- [ ] **Step 3: Verify build**

Run: `npm run build:electron-main`
Expected: Passes clean.

- [ ] **Step 4: Commit**

```bash
git add electron/embeddings/build-embedding-text.ts electron/embeddings/embedding-queue.ts
git commit -m "feat(embeddings): add embedding queue with incremental similar pairs"
```

---

### Task 7: Embedding Service (Orchestrator)

**Files:**
- Create: `electron/embeddings/embedding-service.ts`

- [ ] **Step 1: Create `electron/embeddings/embedding-service.ts`**

```typescript
import type Database from 'better-sqlite3';
import type { EmbeddingConfig, EmbeddingProvider, EmbeddingStatus, SemanticSearchResult, SimilarPair } from '../../src/embeddings/types';
import { DEFAULT_EMBEDDING_CONFIG } from '../../src/embeddings/types';
import { OnnxProvider } from './onnx-provider';
import { OpenAIProvider } from './openai-provider';
import { EmbeddingQueue } from './embedding-queue';
import { loadVecExtension, ensureVecTable, dropVecTable, knnSearch, getSimilarPairs, addDismissal } from './vec-store';
import { buildEmbeddingText, computeTextHash } from './build-embedding-text';

export class EmbeddingService {
  private db: Database.Database;
  private provider: EmbeddingProvider | null = null;
  private queue: EmbeddingQueue | null = null;
  private config: EmbeddingConfig = { ...DEFAULT_EMBEDDING_CONFIG };
  private vecAvailable = false;
  private progressListeners = new Set<(progress: { done: number; total: number }) => void>();
  private readNote?: (nodeId: string) => string | null;

  constructor(db: Database.Database, readNote?: (nodeId: string) => string | null) {
    this.db = db;
    this.readNote = readNote;
  }

  async initialize(storedConfig?: Partial<EmbeddingConfig>): Promise<void> {
    if (storedConfig) {
      this.config = { ...DEFAULT_EMBEDDING_CONFIG, ...storedConfig };
    }

    this.vecAvailable = loadVecExtension(this.db);
    if (!this.vecAvailable) {
      console.warn('[EmbeddingService] sqlite-vec not available, embeddings disabled');
      this.config.enabled = false;
      return;
    }

    if (this.config.enabled) {
      await this.activateProvider();
    }
  }

  private async activateProvider(): Promise<void> {
    const provider = this.createProvider();
    if (!provider) return;

    try {
      await provider.initialize();
      this.provider = provider;
      ensureVecTable(this.db, provider.dimensions);
      this.queue = new EmbeddingQueue(this.db, provider);
      console.log(`[EmbeddingService] Provider ${provider.id} initialized (${provider.dimensions}d)`);
    } catch (e) {
      console.error('[EmbeddingService] Failed to initialize provider:', e);
      this.config.enabled = false;
    }
  }

  private createProvider(): EmbeddingProvider | null {
    const { providerId, onnxModelQuality, openaiApiKey, openaiModel } = this.config;

    if (providerId.startsWith('onnx')) {
      return new OnnxProvider(onnxModelQuality);
    }
    if (providerId.startsWith('openai') && openaiApiKey) {
      return new OpenAIProvider(openaiApiKey, openaiModel ?? 'text-embedding-3-small');
    }
    return null;
  }

  async configure(update: Partial<EmbeddingConfig>): Promise<void> {
    const oldConfig = { ...this.config };
    this.config = { ...this.config, ...update };

    const providerChanged = oldConfig.providerId !== this.config.providerId
      || oldConfig.onnxModelQuality !== this.config.onnxModelQuality
      || oldConfig.openaiApiKey !== this.config.openaiApiKey
      || oldConfig.openaiModel !== this.config.openaiModel;

    if (!this.config.enabled) {
      if (this.provider) {
        await this.provider.dispose();
        this.provider = null;
        this.queue = null;
      }
      return;
    }

    if (!oldConfig.enabled || providerChanged) {
      if (this.provider) {
        await this.provider.dispose();
        this.provider = null;
        this.queue = null;
      }
      if (providerChanged && this.vecAvailable) {
        dropVecTable(this.db);
        this.db.prepare('DELETE FROM embedding_metadata').run();
      }
      await this.activateProvider();
      if (this.provider && this.queue) {
        await this.runBatchEmbed();
      }
    }
  }

  private async runBatchEmbed(): Promise<void> {
    if (!this.queue || !this.provider) return;

    const nodes = this.db.prepare('SELECT id, name, type, summary FROM nodes').all() as Array<{
      id: string; name: string; type: string; summary: string | null;
    }>;

    const items = nodes.map((n) => ({
      id: n.id,
      text: buildEmbeddingText(n, this.db, this.readNote),
    }));

    await this.queue.batchProcess(items, (done, total) => {
      for (const listener of this.progressListeners) {
        listener({ done, total });
      }
    });
  }

  async handleNodeMutation(nodeId: string): Promise<void> {
    if (!this.config.enabled || !this.config.autoEmbed || !this.queue) return;

    const node = this.db.prepare('SELECT id, name, type, summary FROM nodes WHERE id = ?').get(nodeId) as {
      id: string; name: string; type: string; summary: string | null;
    } | undefined;

    if (!node) return;

    const text = buildEmbeddingText(node, this.db, this.readNote);
    const hash = computeTextHash(text);

    const existing = this.db.prepare('SELECT text_hash FROM embedding_metadata WHERE node_id = ?').get(nodeId) as { text_hash: string } | undefined;
    if (existing?.text_hash === hash) return;

    this.queue.enqueue(nodeId, text);
  }

  handleNodeDeleted(nodeId: string): void {
    this.queue?.handleNodeDeleted(nodeId);
  }

  async searchSimilar(queryText: string, topK = 5): Promise<SemanticSearchResult[]> {
    if (!this.provider || !this.config.enabled) return [];
    const vec = await this.provider.embed(queryText);
    const results = knnSearch(this.db, vec, topK);
    return results.map((r) => ({ nodeId: r.nodeId, score: 1 - r.distance }));
  }

  async searchSimilarByNodeId(nodeId: string, topK = 5): Promise<SemanticSearchResult[]> {
    if (!this.provider || !this.config.enabled) return [];
    const meta = this.db.prepare('SELECT node_id FROM embedding_metadata WHERE node_id = ?').get(nodeId);
    if (!meta) return [];
    const node = this.db.prepare('SELECT id, name, type, summary FROM nodes WHERE id = ?').get(nodeId) as any;
    if (!node) return [];
    const text = buildEmbeddingText(node, this.db, this.readNote);
    const vec = await this.provider.embed(text);
    const results = knnSearch(this.db, vec, topK + 1, nodeId);
    return results.slice(0, topK).map((r) => ({ nodeId: r.nodeId, score: 1 - r.distance }));
  }

  findDuplicatePairs(threshold?: number, limit?: number): SimilarPair[] {
    const t = threshold ?? this.config.similarityThreshold;
    const l = limit ?? 20;
    const rawPairs = getSimilarPairs(this.db, t, l);

    return rawPairs.map((p) => {
      const nodeA = this.db.prepare('SELECT id, name, type, label, summary FROM nodes WHERE id = ?').get(p.nodeIdA) as any;
      const nodeB = this.db.prepare('SELECT id, name, type, label, summary FROM nodes WHERE id = ?').get(p.nodeIdB) as any;
      if (!nodeA || !nodeB) return null;

      const countA = (this.db.prepare('SELECT COUNT(*) as c FROM edges WHERE source_id = ? OR target_id = ?').get(nodeA.id, nodeA.id) as any).c;
      const countB = (this.db.prepare('SELECT COUNT(*) as c FROM edges WHERE source_id = ? OR target_id = ?').get(nodeB.id, nodeB.id) as any).c;

      const primary = countA >= countB ? { ...nodeA, connectionCount: countA } : { ...nodeB, connectionCount: countB };
      const secondary = countA >= countB ? { ...nodeB, connectionCount: countB } : { ...nodeA, connectionCount: countA };

      return { nodeA: primary, nodeB: secondary, similarity: p.similarity };
    }).filter((p): p is SimilarPair => p !== null);
  }

  dismissPair(nodeIdA: string, nodeIdB: string): void {
    addDismissal(this.db, nodeIdA, nodeIdB);
  }

  getStatus(): EmbeddingStatus {
    const totalNodes = (this.db.prepare('SELECT COUNT(*) as c FROM nodes').get() as any).c;
    const embeddedNodes = (this.db.prepare('SELECT COUNT(*) as c FROM embedding_metadata').get() as any).c;

    return {
      enabled: this.config.enabled,
      providerId: this.provider?.id ?? null,
      totalNodes,
      embeddedNodes,
      processing: this.queue?.isProcessing ?? false,
    };
  }

  getConfig(): EmbeddingConfig {
    return { ...this.config };
  }

  isEnabled(): boolean {
    return this.config.enabled && this.provider !== null;
  }

  onProgress(cb: (progress: { done: number; total: number }) => void): () => void {
    this.progressListeners.add(cb);
    return () => this.progressListeners.delete(cb);
  }

  async dispose(): Promise<void> {
    if (this.provider) {
      await this.provider.dispose();
      this.provider = null;
    }
    this.queue = null;
    this.progressListeners.clear();
  }
}
```

- [ ] **Step 2: Verify build**

Run: `npm run build:electron-main`
Expected: Passes clean.

- [ ] **Step 3: Commit**

```bash
git add electron/embeddings/embedding-service.ts
git commit -m "feat(embeddings): add EmbeddingService orchestrator with provider lifecycle"
```

---

### Task 8: IPC Handlers + Main Process Wiring

**Files:**
- Create: `electron/embeddings/ipc-handlers.ts`
- Modify: `electron/main.ts`
- Modify: `electron/db-backend.ts`

- [ ] **Step 1: Create `electron/embeddings/ipc-handlers.ts`**

```typescript
import { ipcMain, BrowserWindow } from 'electron';
import type { EmbeddingService } from './embedding-service';
import type { EmbeddingConfig } from '../../src/embeddings/types';

export function registerEmbeddingHandlers(getService: () => EmbeddingService | null): void {
  ipcMain.handle('embedding:is-available', () => {
    return getService() !== null;
  });

  ipcMain.handle('embedding:get-status', () => {
    const service = getService();
    if (!service) return { enabled: false, providerId: null, totalNodes: 0, embeddedNodes: 0, processing: false };
    return service.getStatus();
  });

  ipcMain.handle('embedding:configure', async (_event, config: Partial<EmbeddingConfig>) => {
    const service = getService();
    if (!service) throw new Error('Embedding service not available');
    await service.configure(config);
  });

  ipcMain.handle('embedding:search-similar', async (_event, query: string, topK: number) => {
    const service = getService();
    if (!service) return [];
    return service.searchSimilar(query, topK);
  });

  ipcMain.handle('embedding:search-similar-by-node', async (_event, nodeId: string, topK: number) => {
    const service = getService();
    if (!service) return [];
    return service.searchSimilarByNodeId(nodeId, topK);
  });

  ipcMain.handle('embedding:find-duplicate-pairs', (_event, threshold?: number, limit?: number) => {
    const service = getService();
    if (!service) return [];
    return service.findDuplicatePairs(threshold, limit);
  });

  ipcMain.handle('embedding:dismiss-pair', (_event, nodeIdA: string, nodeIdB: string) => {
    const service = getService();
    if (!service) return;
    service.dismissPair(nodeIdA, nodeIdB);
  });
}

export function setupProgressBroadcast(service: EmbeddingService): () => void {
  return service.onProgress((progress) => {
    for (const win of BrowserWindow.getAllWindows()) {
      win.webContents.send('embedding:progress', progress);
    }
  });
}
```

- [ ] **Step 2: Wire embedding service into `electron/main.ts`**

After the existing `initBetterSQLite()` call and before the `createWindow()` call, add the embedding service initialization. At the top of the file, add imports:

```typescript
import { getDb } from './better-sqlite3-engine';
import { EmbeddingService } from './embeddings/embedding-service';
import { registerEmbeddingHandlers, setupProgressBroadcast } from './embeddings/ipc-handlers';
import * as notesBackend from './notes-backend';
```

After DB initialization, add:

```typescript
let embeddingService: EmbeddingService | null = null;

async function initEmbeddingService() {
  try {
    const db = getDb();
    const readNote = (nodeId: string) => notesBackend.readNoteSync(nodeId);
    embeddingService = new EmbeddingService(db, readNote);
    const storedConfig = storage.get('embeddingConfig');
    await embeddingService.initialize(storedConfig ?? undefined);
    setupProgressBroadcast(embeddingService);
  } catch (e) {
    console.error('[main] Failed to init embedding service:', e);
  }
}

registerEmbeddingHandlers(() => embeddingService);
```

Call `await initEmbeddingService()` after `initBetterSQLite()` completes.

- [ ] **Step 3: Add node mutation hooks to `electron/main.ts`**

In the existing `ipcMain.handle('db:request', ...)` handler, after the `dbHandleAction` call returns and after broadcasting `syncEvent`, add embedding hooks:

```typescript
if (outcome.syncEvent && embeddingService) {
  const eventType = (outcome.syncEvent as any).type;
  if (eventType === 'node_created' || eventType === 'node_updated') {
    const nodeId = (outcome.syncEvent as any).node?.id ?? (outcome.syncEvent as any).id;
    if (nodeId) embeddingService.handleNodeMutation(nodeId).catch(() => {});
  } else if (eventType === 'node_deleted') {
    const nodeId = (outcome.syncEvent as any).id;
    if (nodeId) embeddingService.handleNodeDeleted(nodeId);
  }
}
```

- [ ] **Step 4: Add `readNoteSync` to notes-backend if not present**

Check `electron/notes-backend.ts`. If `readNoteSync` doesn't exist, add a synchronous reader for the embedding text builder. Since notes are stored as files on Electron, this is a simple `fs.readFileSync`:

```typescript
export function readNoteSync(nodeId: string): string | null {
  const filePath = join(notesDir, `${nodeId}.md`);
  try {
    return readFileSync(filePath, 'utf-8');
  } catch {
    return null;
  }
}
```

- [ ] **Step 5: Verify build**

Run: `npm run build:electron-main && npm run build`
Expected: Both pass clean. Chrome build unaffected.

- [ ] **Step 6: Commit**

```bash
git add electron/embeddings/ipc-handlers.ts electron/main.ts electron/db-backend.ts electron/notes-backend.ts
git commit -m "feat(embeddings): wire IPC handlers and node mutation hooks in main process"
```

---

## Phase 2: Settings & Control

### Task 9: Settings Panel — EmbeddingSettings

**Files:**
- Create: `src/ui/components/settings/EmbeddingSettings.tsx`
- Modify: `src/ui/components/settings/SettingsPanel.tsx`

- [ ] **Step 1: Create `src/ui/components/settings/EmbeddingSettings.tsx`**

```typescript
import { useState, useEffect, useCallback } from 'react';
import { embedding } from '@platform';
import { storage } from '@platform';
import { platformId } from '@platform';
import type { EmbeddingConfig, EmbeddingStatus } from '../../../embeddings/types';
import { DEFAULT_EMBEDDING_CONFIG } from '../../../embeddings/types';

const STORAGE_KEY = 'embeddingConfig';

export function EmbeddingSettings() {
  const [config, setConfig] = useState<EmbeddingConfig>(DEFAULT_EMBEDDING_CONFIG);
  const [status, setStatus] = useState<EmbeddingStatus | null>(null);
  const [saving, setSaving] = useState(false);
  const [confirmSwitch, setConfirmSwitch] = useState(false);

  useEffect(() => {
    storage.get(STORAGE_KEY).then((result: any) => {
      if (result[STORAGE_KEY]) setConfig({ ...DEFAULT_EMBEDDING_CONFIG, ...result[STORAGE_KEY] });
    }).catch(() => {});
    embedding.getStatus().then(setStatus).catch(() => {});
    const unsub = embedding.onProgress((progress) => {
      setStatus((s) => s ? { ...s, processing: true, progress } : s);
    });
    return unsub;
  }, []);

  const handleSave = useCallback(async (updates: Partial<EmbeddingConfig>) => {
    setSaving(true);
    const newConfig = { ...config, ...updates };
    setConfig(newConfig);
    try {
      await storage.set({ [STORAGE_KEY]: newConfig });
      await embedding.configure(updates);
      const newStatus = await embedding.getStatus();
      setStatus(newStatus);
    } catch (e) {
      console.error('Failed to save embedding config:', e);
    }
    setSaving(false);
  }, [config]);

  if (platformId !== 'electron') return null;

  const isProcessing = status?.processing ?? false;

  return (
    <div className="space-y-4">
      <h3 className="text-sm font-semibold text-zinc-200">Embeddings</h3>

      {/* Enable toggle */}
      <div className="flex items-center justify-between">
        <div>
          <div className="text-sm text-zinc-300">Enable Semantic Search</div>
          <div className="text-xs text-zinc-500 mt-0.5">
            Find similar nodes, improve search results, and give the chat agent better context — even without exact keyword matches.
          </div>
        </div>
        <button
          onClick={() => handleSave({ enabled: !config.enabled })}
          disabled={saving}
          className={`relative w-10 h-5 rounded-full transition-colors ${config.enabled ? 'bg-indigo-600' : 'bg-zinc-600'}`}
        >
          <span className={`absolute top-0.5 left-0.5 w-4 h-4 rounded-full bg-white transition-transform ${config.enabled ? 'translate-x-5' : ''}`} />
        </button>
      </div>

      {config.enabled && (
        <>
          {/* Provider selection */}
          <div className="space-y-2">
            <div className="text-xs font-medium text-zinc-400 uppercase tracking-wider">Provider</div>

            <label className="flex items-start gap-2 p-2 rounded border cursor-pointer hover:border-zinc-500 transition-colors"
              style={{ borderColor: config.providerId.startsWith('onnx') ? '#6366f1' : '#3f3f46' }}>
              <input type="radio" name="provider" checked={config.providerId.startsWith('onnx')}
                onChange={() => {
                  if (!config.providerId.startsWith('onnx')) setConfirmSwitch(true);
                  else handleSave({ providerId: 'onnx-minilm' });
                }}
                className="mt-1" />
              <div>
                <div className="text-sm text-zinc-200">Local (runs on your computer)</div>
                <div className="text-xs text-zinc-500">No internet needed. Free. Model downloaded on first use. Good for most knowledge graphs.</div>
              </div>
            </label>

            {config.providerId.startsWith('onnx') && (
              <div className="ml-6 space-y-1">
                <label className="flex items-center gap-2 text-xs text-zinc-400 cursor-pointer">
                  <input type="radio" name="quality" checked={config.onnxModelQuality === 'quantized'}
                    onChange={() => handleSave({ onnxModelQuality: 'quantized' })} />
                  <span>Standard (~23MB download, ~60MB memory) — Faster, lighter. Recommended for most users.</span>
                </label>
                <label className="flex items-center gap-2 text-xs text-zinc-400 cursor-pointer">
                  <input type="radio" name="quality" checked={config.onnxModelQuality === 'full'}
                    onChange={() => handleSave({ onnxModelQuality: 'full' })} />
                  <span>Full (~90MB download, ~150MB memory) — More accurate similarity for many similarly-named nodes.</span>
                </label>
              </div>
            )}

            <label className="flex items-start gap-2 p-2 rounded border cursor-pointer hover:border-zinc-500 transition-colors"
              style={{ borderColor: config.providerId.startsWith('openai') ? '#6366f1' : '#3f3f46' }}>
              <input type="radio" name="provider" checked={config.providerId.startsWith('openai')}
                onChange={() => {
                  if (!config.providerId.startsWith('openai')) setConfirmSwitch(true);
                  else handleSave({ providerId: 'openai-small' });
                }}
                className="mt-1" />
              <div>
                <div className="text-sm text-zinc-200">OpenAI API</div>
                <div className="text-xs text-zinc-500">Higher quality embeddings. Requires an API key and internet. ~$0.02 per 1M tokens.</div>
              </div>
            </label>

            {config.providerId.startsWith('openai') && (
              <div className="ml-6 space-y-2">
                <input
                  type="password"
                  placeholder="OpenAI API Key"
                  value={config.openaiApiKey ?? ''}
                  onChange={(e) => setConfig({ ...config, openaiApiKey: e.target.value })}
                  onBlur={() => handleSave({ openaiApiKey: config.openaiApiKey })}
                  className="w-full bg-zinc-800 border border-zinc-600 rounded px-2 py-1 text-xs text-zinc-200"
                />
                <select
                  value={config.openaiModel ?? 'text-embedding-3-small'}
                  onChange={(e) => handleSave({ openaiModel: e.target.value })}
                  className="bg-zinc-800 border border-zinc-600 rounded px-2 py-1 text-xs text-zinc-200"
                >
                  <option value="text-embedding-3-small">text-embedding-3-small — Faster, cheaper</option>
                  <option value="text-embedding-3-large">text-embedding-3-large — Best quality</option>
                </select>
              </div>
            )}
          </div>

          {/* Status */}
          <div className="flex items-center gap-2 text-xs">
            <span className={`w-2 h-2 rounded-full ${isProcessing ? 'bg-amber-400 animate-pulse' : status?.embeddedNodes ? 'bg-emerald-400' : 'bg-zinc-500'}`} />
            <span className="text-zinc-400">
              {isProcessing && status?.progress
                ? `Processing... ${status.progress.done}/${status.progress.total} nodes`
                : status?.embeddedNodes
                ? `Ready — ${status.embeddedNodes} nodes embedded`
                : 'Not configured'}
            </span>
          </div>

          {/* Similarity threshold */}
          <div className="space-y-1">
            <div className="flex items-center justify-between">
              <span className="text-xs text-zinc-400">Merge recommendation threshold</span>
              <span className="text-xs text-zinc-500">{config.similarityThreshold.toFixed(2)}</span>
            </div>
            <input
              type="range" min="0.50" max="0.95" step="0.05"
              value={config.similarityThreshold}
              onChange={(e) => handleSave({ similarityThreshold: parseFloat(e.target.value) })}
              className="w-full accent-indigo-500"
            />
            <div className="flex justify-between text-[10px] text-zinc-600">
              <span>More suggestions</span>
              <span>Fewer, more confident</span>
            </div>
          </div>

          {/* Re-embed button */}
          <button
            onClick={() => handleSave({ enabled: true })}
            disabled={saving || isProcessing}
            className="text-xs px-3 py-1.5 rounded border border-zinc-600 text-zinc-400 hover:text-zinc-200 hover:border-zinc-500 transition-colors disabled:opacity-50"
          >
            Re-embed all nodes
          </button>
          <div className="text-[10px] text-zinc-600">Recomputes all embeddings. Required after changing provider or model.</div>
        </>
      )}

      {/* Provider switch confirmation */}
      {confirmSwitch && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-zinc-800 border border-zinc-600 rounded-lg p-4 max-w-sm">
            <div className="text-sm text-zinc-200 mb-2">Switch embedding provider?</div>
            <div className="text-xs text-zinc-400 mb-4">All existing embeddings will be discarded and recomputed. This may take a few minutes.</div>
            <div className="flex gap-2 justify-end">
              <button onClick={() => setConfirmSwitch(false)} className="text-xs px-3 py-1 rounded border border-zinc-600 text-zinc-400">Cancel</button>
              <button onClick={() => {
                const newProvider = config.providerId.startsWith('onnx') ? 'openai-small' : 'onnx-minilm';
                handleSave({ providerId: newProvider });
                setConfirmSwitch(false);
              }} className="text-xs px-3 py-1 rounded bg-indigo-600 text-white">Switch</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Add EmbeddingSettings to SettingsPanel**

In `src/ui/components/settings/SettingsPanel.tsx`, import and render the component. The settings panel routes tabs. Add `EmbeddingSettings` to the general tab section (or create a dedicated tab). In the general/default tab section, after the existing sections, add:

```typescript
import { EmbeddingSettings } from './EmbeddingSettings';
```

And in the render, add `<EmbeddingSettings />` after `RelevanceSection` (or wherever appropriate in the general tab).

- [ ] **Step 3: Verify build**

Run: `npm run build && npm run build:electron`
Expected: Both pass clean.

- [ ] **Step 4: Commit**

```bash
git add src/ui/components/settings/EmbeddingSettings.tsx src/ui/components/settings/SettingsPanel.tsx
git commit -m "feat(embeddings): add settings panel with provider config and status"
```

---

## Phase 3: Consumers

### Task 10: Intelligence Panel — SimilarNodes

**Files:**
- Create: `src/ui/components/intelligence/SimilarNodes.tsx`
- Modify: `src/ui/components/intelligence/IntelligencePanel.tsx`

- [ ] **Step 1: Create `src/ui/components/intelligence/SimilarNodes.tsx`**

```typescript
import { useState, useEffect, useCallback } from 'react';
import { embedding } from '@platform';
import { platformId } from '@platform';
import type { SimilarPair } from '../../../embeddings/types';
import { useGraphStore } from '../../../graph/store/graph-store';
import { entityResolution } from '../../../db/client/db-client';

interface SimilarNodesProps {
  onNodeClick: (nodeId: string) => void;
}

export function SimilarNodes({ onNodeClick }: SimilarNodesProps) {
  const [pairs, setPairs] = useState<SimilarPair[]>([]);
  const [loading, setLoading] = useState(false);
  const [expandedIdx, setExpandedIdx] = useState<number | null>(null);

  useEffect(() => {
    if (platformId !== 'electron') return;
    setLoading(true);
    embedding.findDuplicatePairs().then(setPairs).catch(() => {}).finally(() => setLoading(false));
  }, []);

  const handleMerge = useCallback(async (pair: SimilarPair, swapped: boolean) => {
    const primary = swapped ? pair.nodeB : pair.nodeA;
    const secondary = swapped ? pair.nodeA : pair.nodeB;
    const store = useGraphStore.getState();

    const secondaryEdges = store.edges.filter(
      (e) => e.sourceId === secondary.id || e.targetId === secondary.id
    );
    for (const edge of secondaryEdges) {
      const newSource = edge.sourceId === secondary.id ? primary.id : edge.sourceId;
      const newTarget = edge.targetId === secondary.id ? primary.id : edge.targetId;
      if (newSource === newTarget) continue;
      const exists = store.edges.some(
        (e) => e.sourceId === newSource && e.targetId === newTarget && e.label === edge.label
      );
      if (!exists) {
        await store.createEdge({ sourceId: newSource, targetId: newTarget, label: edge.label, type: edge.type });
      }
    }

    await entityResolution.addAlias(primary.id, secondary.name);

    await store.deleteNode(secondary.id);
    setPairs((prev) => prev.filter((p) => p !== pair));
    setExpandedIdx(null);
  }, []);

  const handleDismiss = useCallback(async (pair: SimilarPair) => {
    await embedding.dismissPair(pair.nodeA.id, pair.nodeB.id);
    setPairs((prev) => prev.filter((p) => p !== pair));
  }, []);

  if (platformId !== 'electron') return null;
  if (loading) return <div className="text-xs text-zinc-500 px-2">Loading similar nodes...</div>;
  if (pairs.length === 0) return null;

  return (
    <div className="space-y-1">
      <h4 className="text-xs font-medium text-zinc-400 px-2">Similar Nodes ({pairs.length})</h4>
      {pairs.map((pair, idx) => (
        <SimilarPairCard
          key={`${pair.nodeA.id}-${pair.nodeB.id}`}
          pair={pair}
          expanded={expandedIdx === idx}
          onToggle={() => setExpandedIdx(expandedIdx === idx ? null : idx)}
          onMerge={(swapped) => handleMerge(pair, swapped)}
          onDismiss={() => handleDismiss(pair)}
          onNodeClick={onNodeClick}
        />
      ))}
    </div>
  );
}

function SimilarPairCard({
  pair, expanded, onToggle, onMerge, onDismiss, onNodeClick,
}: {
  pair: SimilarPair;
  expanded: boolean;
  onToggle: () => void;
  onMerge: (swapped: boolean) => void;
  onDismiss: () => void;
  onNodeClick: (nodeId: string) => void;
}) {
  const [swapped, setSwapped] = useState(false);
  const pct = Math.round(pair.similarity * 100);

  return (
    <div className={`mx-2 rounded border transition-colors ${expanded ? 'border-indigo-600 bg-zinc-800/80' : 'border-zinc-700 bg-zinc-800/40 hover:border-zinc-600'}`}>
      <button onClick={onToggle} className="w-full flex items-center gap-2 px-2 py-1.5 text-left">
        <span className="text-zinc-500 text-[10px]">{expanded ? '▼' : '▶'}</span>
        <span className="text-xs text-zinc-200 truncate flex-1" onClick={(e) => { e.stopPropagation(); onNodeClick(pair.nodeA.id); }}>
          {pair.nodeA.name}
        </span>
        <span className="text-zinc-600 text-[10px]">↔</span>
        <span className="text-xs text-zinc-200 truncate flex-1" onClick={(e) => { e.stopPropagation(); onNodeClick(pair.nodeB.id); }}>
          {pair.nodeB.name}
        </span>
        <span className="text-[10px] text-zinc-500 flex-shrink-0">{pct}%</span>
      </button>

      {expanded && (
        <div className="px-2 pb-2 space-y-2">
          <div className="flex gap-2">
            <NodeDetail
              node={swapped ? pair.nodeB : pair.nodeA}
              role="Primary (keep)"
              roleColor="text-indigo-400"
            />
            <NodeDetail
              node={swapped ? pair.nodeA : pair.nodeB}
              role="Secondary (merge in)"
              roleColor="text-red-400"
            />
          </div>
          <div className="flex gap-1 justify-end">
            <button onClick={onDismiss} className="text-[10px] px-2 py-0.5 rounded border border-zinc-600 text-zinc-500 hover:text-zinc-300">Dismiss</button>
            <button onClick={() => setSwapped(!swapped)} className="text-[10px] px-2 py-0.5 rounded border border-zinc-600 text-zinc-500 hover:text-zinc-300">Swap</button>
            <button onClick={() => onMerge(swapped)} className="text-[10px] px-2 py-0.5 rounded bg-indigo-600 text-white">Merge</button>
          </div>
        </div>
      )}
    </div>
  );
}

function NodeDetail({ node, role, roleColor }: { node: SimilarPair['nodeA']; role: string; roleColor: string }) {
  return (
    <div className="flex-1 bg-zinc-900/60 rounded p-1.5">
      <div className={`text-[9px] uppercase ${roleColor} mb-0.5`}>{role}</div>
      <div className="text-xs text-zinc-200 truncate">{node.name}</div>
      <div className="text-[10px] text-zinc-500">{node.type} {node.label ? `· ${node.label}` : ''} · {node.connectionCount} connections</div>
      {node.summary && <div className="text-[10px] text-zinc-600 mt-0.5 line-clamp-2">{node.summary}</div>}
    </div>
  );
}
```

- [ ] **Step 2: Add SimilarNodes to IntelligencePanel**

In `src/ui/components/intelligence/IntelligencePanel.tsx`, import and render after the existing "Potential Connections" section:

```typescript
import { SimilarNodes } from './SimilarNodes';
```

In the render, after the suggestions section, add:

```typescript
<SimilarNodes onNodeClick={handleNodeClick} />
```

Where `handleNodeClick` is the existing click handler that selects/focuses a node.

- [ ] **Step 3: Verify build**

Run: `npm run build && npm run build:electron`
Expected: Both pass clean. Chrome renders no SimilarNodes (returns null when `platformId !== 'electron'`).

- [ ] **Step 4: Commit**

```bash
git add src/ui/components/intelligence/SimilarNodes.tsx src/ui/components/intelligence/IntelligencePanel.tsx
git commit -m "feat(embeddings): add SimilarNodes merge recommendations to Intelligence Panel"
```

---

### Task 11: RAG Pipeline + RRF Blending

**Files:**
- Modify: `src/commands/rag-commands.ts`

- [ ] **Step 1: Add semantic search + RRF to `src/commands/rag-commands.ts`**

At the top of the file, add imports:

```typescript
import { embedding } from '@platform';
```

Add the RRF helper function:

```typescript
function reciprocalRankFusion(
  ftsIds: string[],
  vecResults: Array<{ nodeId: string; score: number }>,
  k = 60,
): string[] {
  const scores = new Map<string, number>();
  ftsIds.forEach((id, rank) => {
    scores.set(id, (scores.get(id) ?? 0) + 1 / (k + rank));
  });
  vecResults.forEach(({ nodeId }, rank) => {
    scores.set(nodeId, (scores.get(nodeId) ?? 0) + 1 / (k + rank));
  });
  return [...scores.entries()].sort((a, b) => b[1] - a[1]).map(([id]) => id);
}
```

In the `retrieveRAGContext` function, after the existing `findRelevantNodes` call (which does FTS5 search), add semantic search and fusion:

```typescript
const ftsNodeIds = matchedNodes.map((n) => n.id);

let fusedNodeIds = ftsNodeIds;
try {
  const vecResults = await embedding.searchSimilar(question, 10);
  if (vecResults.length > 0) {
    fusedNodeIds = reciprocalRankFusion(ftsNodeIds, vecResults);
  }
} catch {
  // Embeddings not available — use FTS results only
}

const { expandedNodeIds, subgraphEdges } = await expandSubgraph(ctx, fusedNodeIds.slice(0, 20), 1);
```

Replace `matchedNodeIds` with `fusedNodeIds.slice(0, 20)` in the `expandSubgraph` call.

- [ ] **Step 2: Verify build**

Run: `npm run build && npm run build:electron`
Expected: Both pass clean. On Chrome, `embedding.searchSimilar()` returns empty array (no-op stub), so the catch block or empty check handles it gracefully.

- [ ] **Step 3: Commit**

```bash
git add src/commands/rag-commands.ts
git commit -m "feat(embeddings): add RRF blending of FTS5 + vector search to RAG pipeline"
```

---

### Task 12: Search Bar Semantic Fallback

**Files:**
- Modify: `src/ui/components/search/HeaderSearch.tsx`

- [ ] **Step 1: Add semantic fallback to `HeaderSearch.tsx`**

Import embedding:

```typescript
import { embedding } from '@platform';
```

In the `runSearch` callback, after the existing `Promise.allSettled` for FTS results and after results are categorized, add a semantic fallback block. After the results are set:

```typescript
const totalResults = nodeResults.length + noteResults.length + edgeResults.length;
if (totalResults < 5 && query.split(/\s+/).length >= 3) {
  try {
    const vecResults = await embedding.searchSimilar(query, 5);
    if (searchIdRef.current !== id) return;
    if (vecResults.length > 0) {
      const existingIds = new Set(nodeResults.map((n: any) => n.id));
      const semanticNodes = vecResults
        .filter((r) => !existingIds.has(r.nodeId))
        .map((r) => {
          const node = allNodes.find((n: any) => n.id === r.nodeId);
          return node ? { ...node, _semantic: true, _score: r.score } : null;
        })
        .filter(Boolean);
      if (semanticNodes.length > 0) {
        setSemanticResults(semanticNodes);
      }
    }
  } catch {}
}
```

Add `semanticResults` state:

```typescript
const [semanticResults, setSemanticResults] = useState<any[]>([]);
```

Clear `semanticResults` in `handleChange` when query changes.

In the dropdown render, after existing result sections, add:

```typescript
{semanticResults.length > 0 && (
  <>
    <div className="px-3 py-1 text-[10px] text-zinc-500 uppercase tracking-wider border-t border-zinc-700">Semantic matches</div>
    {semanticResults.map((node) => (
      <button key={node.id} onClick={() => handleSelectNode(node)} className="...existing result button classes...">
        {node.name}
      </button>
    ))}
  </>
)}
```

- [ ] **Step 2: Verify build**

Run: `npm run build && npm run build:electron`
Expected: Both pass clean. On Chrome, `embedding.searchSimilar` returns empty — no semantic section rendered.

- [ ] **Step 3: Commit**

```bash
git add src/ui/components/search/HeaderSearch.tsx
git commit -m "feat(embeddings): add semantic fallback to search bar for 3+ word queries"
```

---

### Task 13: `semantic_search` Chat Tool (Dynamic Registration)

**Files:**
- Modify: `src/ui/hooks/chat-agent-loop.ts`
- Modify: `src/commands/chat-tool-executor.ts`

- [ ] **Step 1: Add `semantic_search` tool definition in `chat-agent-loop.ts`**

At the top, import platform:

```typescript
import { platformId, embedding } from '@platform';
```

Replace the static `TOOL_DEFS` constant with a function that dynamically builds the tool list:

```typescript
const BASE_TOOL_DEFS = toAnthropicChatTools(CHAT_AGENT_TOOLS);

function getToolDefs(): typeof BASE_TOOL_DEFS {
  if (platformId !== 'electron') return BASE_TOOL_DEFS;
  return [
    ...BASE_TOOL_DEFS,
    {
      name: 'semantic_search',
      description: 'Find nodes semantically similar to a query, even without keyword overlap. Use when keyword search returns few results or you need conceptually related nodes.',
      input_schema: {
        type: 'object',
        properties: {
          query: { type: 'string', description: 'Natural language search query' },
          limit: { type: 'number', description: 'Max results to return (default 5)' },
        },
        required: ['query'],
      },
    },
  ];
}
```

In the `sendChatLLMRequest` call inside `runChatAgent`, replace `tools: TOOL_DEFS` with `tools: getToolDefs()`.

- [ ] **Step 2: Handle `semantic_search` in `src/commands/chat-tool-executor.ts`**

Add a case in the `executeTool` switch statement:

```typescript
case 'semantic_search': {
  const { embedding } = await import('@platform');
  const query = input.query as string;
  const limit = (input.limit as number) ?? 5;
  const results = await embedding.searchSimilar(query, limit);
  if (results.length === 0) {
    return { result: JSON.stringify({ message: 'No semantic matches found. Embeddings may not be enabled.' }) };
  }
  const nodeDetails = [];
  for (const r of results) {
    const node = await ctx.db.nodes.getById(r.nodeId);
    if (node) {
      nodeDetails.push({ id: node.id, name: (node as any).name, type: (node as any).type, similarity: r.score.toFixed(2) });
    }
  }
  return { result: JSON.stringify(nodeDetails), collectedNodeIds: nodeDetails.map((n) => n.id) };
}
```

- [ ] **Step 3: Verify build**

Run: `npm run build && npm run build:electron`
Expected: Both pass clean. Chrome never reaches the `semantic_search` case because `getToolDefs()` excludes it.

- [ ] **Step 4: Commit**

```bash
git add src/ui/hooks/chat-agent-loop.ts src/commands/chat-tool-executor.ts
git commit -m "feat(embeddings): add semantic_search chat tool with dynamic Electron-only registration"
```

---

### Task 14: Context Chip Auto-Suggest

**Files:**
- Create: `src/ui/components/chat/ContextSuggestions.tsx`
- Modify: `src/ui/components/chat/ContextChipBar.tsx`

- [ ] **Step 1: Create `src/ui/components/chat/ContextSuggestions.tsx`**

```typescript
import { useState, useEffect, useRef } from 'react';
import { embedding } from '@platform';
import { platformId } from '@platform';
import { useChatContextStore } from '../../../graph/store/chat-context-store';
import { useGraphStore } from '../../../graph/store/graph-store';
import { useNodeTypeStore } from '../../../graph/store/node-type-store';
import type { SemanticSearchResult } from '../../../embeddings/types';

export function ContextSuggestions() {
  const attachedNodes = useChatContextStore((s) => s.attachedNodes);
  const addNodes = useChatContextStore((s) => s.addNodes);
  const graphNodes = useGraphStore((s) => s.nodes);
  const getColorForType = useNodeTypeStore((s) => s.getColorForType);
  const [suggestions, setSuggestions] = useState<Array<{ id: string; name: string; type: string; score: number }>>([]);
  const [expanded, setExpanded] = useState(false);
  const requestIdRef = useRef(0);

  useEffect(() => {
    if (platformId !== 'electron' || attachedNodes.length === 0) {
      setSuggestions([]);
      return;
    }

    const id = ++requestIdRef.current;
    const attachedIds = new Set(attachedNodes.map((n) => n.id));

    (async () => {
      const allResults: SemanticSearchResult[] = [];
      for (const node of attachedNodes) {
        try {
          const results = await embedding.searchSimilarByNodeId(node.id, 3);
          allResults.push(...results.filter((r) => !attachedIds.has(r.nodeId)));
        } catch {}
      }

      if (requestIdRef.current !== id) return;

      const seen = new Set<string>();
      const deduped: Array<{ id: string; name: string; type: string; score: number }> = [];
      for (const r of allResults.sort((a, b) => b.score - a.score)) {
        if (seen.has(r.nodeId) || attachedIds.has(r.nodeId)) continue;
        seen.add(r.nodeId);
        const node = graphNodes.find((n) => n.id === r.nodeId);
        if (node) deduped.push({ id: node.id, name: node.name, type: node.type, score: r.score });
        if (deduped.length >= 5) break;
      }
      setSuggestions(deduped);
      setExpanded(false);
    })();
  }, [attachedNodes, graphNodes]);

  if (suggestions.length === 0) return null;

  return (
    <div className="flex items-center gap-1 px-2">
      {!expanded ? (
        <button
          onClick={() => setExpanded(true)}
          className="text-[10px] text-indigo-400 hover:text-indigo-300 transition-colors"
        >
          + {suggestions.length} related
        </button>
      ) : (
        <>
          {suggestions.map((s) => (
            <button
              key={s.id}
              onClick={() => {
                addNodes([{ id: s.id, name: s.name, type: s.type, color: getColorForType(s.type) }]);
                setSuggestions((prev) => prev.filter((p) => p.id !== s.id));
              }}
              className="flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded border border-dashed border-zinc-600 text-zinc-400 hover:text-zinc-200 hover:border-zinc-500 transition-colors"
            >
              <span className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: getColorForType(s.type) }} />
              <span className="truncate max-w-[80px]">{s.name}</span>
              <span className="text-zinc-600">{Math.round(s.score * 100)}%</span>
            </button>
          ))}
          <button onClick={() => setExpanded(false)} className="text-[10px] text-zinc-600 hover:text-zinc-400">✕</button>
        </>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Add ContextSuggestions to ContextChipBar**

In `src/ui/components/chat/ContextChipBar.tsx`, import and render after the existing chip flex wrapper:

```typescript
import { ContextSuggestions } from './ContextSuggestions';
```

After the closing `</div>` of the chip wrapper (the `flex flex-wrap` container), add:

```typescript
<ContextSuggestions />
```

- [ ] **Step 3: Verify build**

Run: `npm run build && npm run build:electron`
Expected: Both pass clean. On Chrome, `ContextSuggestions` returns null immediately.

- [ ] **Step 4: Commit**

```bash
git add src/ui/components/chat/ContextSuggestions.tsx src/ui/components/chat/ContextChipBar.tsx
git commit -m "feat(embeddings): add context chip auto-suggest for semantically related nodes"
```

---

## Post-Implementation

### Verification Checklist

1. `npm run build` — Chrome extension builds clean
2. `npm run build:electron` ��� Electron renderer builds clean
3. `npm run build:electron-main` — Electron main process builds clean
4. Load Chrome extension → all existing features work (extraction, chat, notes, search) — NO embedding UI visible
5. Run Electron app → Settings → Enable embeddings → progress indicator shows batch processing
6. Intelligence Panel → Similar Nodes section appears with merge recommendations
7. Search bar → type 3+ word query with few FTS hits → "Semantic matches" divider appears
8. Chat → type question → RAG context includes semantically relevant nodes
9. Chat → agent uses `semantic_search` tool when appropriate
10. Chat → attach nodes via @-mention → "+ N related" suggestion appears

### sqlite-vec Distribution Note

The `sqlite-vec` native extension must be bundled with the Electron app. Add to `electron-builder` config in `package.json`:

```json
{
  "build": {
    "extraResources": [
      {
        "from": "resources/sqlite-vec/${os}",
        "to": "sqlite-vec"
      }
    ]
  }
}
```

Download prebuilt binaries from the sqlite-vec releases page and place in `resources/sqlite-vec/mac/`, `resources/sqlite-vec/linux/`, `resources/sqlite-vec/win/`. The `resolveExtensionPath()` in `vec-store.ts` handles platform resolution.
