# Vector Embeddings for Semantic Search & Node Similarity

## Overview

Introduce vector embeddings into the Electron desktop app to enable semantic similarity across the knowledge graph. Two embedding providers (local ONNX model + OpenAI API) behind a provider abstraction, with sqlite-vec for vector storage and KNN search. Off by default — opt-in through a guided settings panel.

## Use Cases

1. **Intelligence Panel — merge recommendations**: Surface similar node pairs (e.g. "React.js" / "ReactJS") with expandable detail cards. Users merge with alias preservation or dismiss.
2. **RAG retrieval — semantic chat context**: Blend vector similarity with FTS5 keyword search via reciprocal rank fusion so chat finds relevant nodes even without keyword overlap.
3. **Search bar — semantic fallback**: When FTS5 returns few results for 3+ word queries, append semantic matches below a divider.
4. **Context chip auto-suggest**: When user attaches nodes to chat via right-click/@-mention, suggest semantically related nodes for one-click addition.
5. **`semantic_search` chat tool**: New agent tool so the chat agent can self-serve semantic retrieval mid-conversation.

## Architecture

```
Renderer (React UI)
  |
  |-- IPC: embedding:search-similar
  |-- IPC: embedding:find-duplicate-pairs
  |-- IPC: embedding:get-status
  |-- IPC: embedding:configure
  |
  v
Electron Main Process
  |-- EmbeddingService (orchestrator)
  |     |-- EmbeddingProvider (interface)
  |     |     |-- OnnxProvider (@huggingface/transformers)
  |     |     |-- OpenAIProvider (API calls)
  |     |-- EmbeddingQueue (background processing)
  |     |-- sqlite-vec (vector storage + KNN search)
  |     |     |-- better-sqlite3.loadExtension('vec0')
  |
  |-- DB Backend (existing - fires node mutation events)
  |-- LLM Backend (existing - unchanged)
```

**Key boundaries:**
- `src/embeddings/` — Provider interface, types, shared logic (importable by both platforms, only active in Electron)
- `electron/embeddings/` — ONNX provider, OpenAI provider, queue, sqlite-vec integration, IPC handlers
- `src/platform/types.ts` — New `PlatformEmbedding` interface; Electron implementation wraps IPC, Chrome implementation is a no-op stub
- No changes to Chrome extension — embeddings are desktop-only

**Chrome isolation constraints:**
- `src/embeddings/types.ts` must contain ONLY TypeScript type/interface declarations. No runtime imports from `@huggingface/transformers`, `sqlite-vec`, `better-sqlite3`, or any Node.js module. All runtime code stays in `electron/embeddings/`.
- Both `src/platform/chrome/index.ts` and `src/platform/electron/index.ts` must export an `embedding` symbol. The Chrome export is a frozen no-op object so that `import { embedding } from '@platform'` resolves on both platforms without runtime errors.
- The `semantic_search` tool must NOT be added to the shared `CHAT_AGENT_TOOLS` constant in `src/shared/chat-agent-tools.ts`. Instead, `chat-agent-loop.ts` assembles the tool list dynamically: on Electron with embeddings enabled, append `semantic_search` to the tool array sent to the LLM. On Chrome, the LLM never sees this tool.
- Migration 009 creates only regular tables (`embedding_metadata`, `embedding_dismissals`) — no sqlite-vec virtual tables. Must be marked `optional: true` matching the FTS5 migration pattern, so any unexpected SQL failure on Chrome skips gracefully.

## Embedding Provider Abstraction

### Interface

```typescript
// src/embeddings/types.ts
interface EmbeddingProvider {
  id: string;           // 'onnx-minilm' | 'openai-small' | 'openai-large'
  name: string;         // display name for settings
  dimensions: number;   // 384 for MiniLM, 1536 for OpenAI small
  maxTokens: number;    // input truncation limit

  initialize(): Promise<void>;
  embed(text: string): Promise<Float32Array>;
  embedBatch(texts: string[]): Promise<Float32Array[]>;
  isAvailable(): Promise<boolean>;
  dispose(): Promise<void>;
}

interface EmbeddingConfig {
  enabled: boolean;
  providerId: string;
  onnxModelQuality: 'quantized' | 'full';
  openaiApiKey?: string;
  openaiModel?: string;     // 'text-embedding-3-small' | 'text-embedding-3-large'
  similarityThreshold: number; // default 0.80
  autoEmbed: boolean;          // embed new nodes automatically
}
```

### Implementations

**`electron/embeddings/onnx-provider.ts`** — Loads `all-MiniLM-L6-v2` via `@huggingface/transformers`. Model files cached in `app.getPath('userData')/models/`. First run triggers download (~23MB quantized, ~90MB full). `embedBatch` processes in chunks of 32 (standard model) or 8-16 (full model to limit peak memory). ONNX inference runs in a `worker_threads` Worker to avoid blocking the Electron main thread — the worker receives text, returns Float32Array vectors, and the main thread handles sqlite-vec inserts.

**`electron/embeddings/openai-provider.ts`** — Calls OpenAI embeddings API. `embedBatch` sends up to 100 texts per request (API limit). Handles rate limiting with exponential backoff (reuses `withRetry` from `src/core/retry.ts`).

**Provider switch constraint:** Vectors from different models are incompatible. Switching providers discards all embeddings and triggers a full re-batch. Settings UI warns before confirming.

## Vector Storage (sqlite-vec)

sqlite-vec integrates with the existing `better-sqlite3` instance in the Electron main process.

### Schema

```sql
-- Migration 009-embeddings.ts (runs on both platforms, optional: true)
CREATE TABLE embedding_metadata (
  node_id TEXT PRIMARY KEY REFERENCES nodes(id) ON DELETE CASCADE,
  provider_id TEXT NOT NULL,
  dimensions INTEGER NOT NULL,
  embedded_at TEXT NOT NULL,
  text_hash TEXT NOT NULL   -- detect name/summary changes for re-embedding
);

CREATE TABLE embedding_dismissals (
  node_id_a TEXT NOT NULL REFERENCES nodes(id) ON DELETE CASCADE,
  node_id_b TEXT NOT NULL REFERENCES nodes(id) ON DELETE CASCADE,
  dismissed_at TEXT NOT NULL,
  PRIMARY KEY (node_id_a, node_id_b)
);
```

Both tables use `ON DELETE CASCADE` referencing `nodes(id)` so node deletion automatically cleans up embedding metadata and dismissals without application-level hooks.

The `similar_pairs` cache table is also created by `EmbeddingService.initialize()` (alongside `vec_nodes`), not in the migration:

```sql
-- Created by EmbeddingService (Electron-only, alongside vec_nodes)
CREATE TABLE IF NOT EXISTS similar_pairs (
  node_id_a TEXT NOT NULL,
  node_id_b TEXT NOT NULL,
  similarity REAL NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (node_id_a, node_id_b)
);
```

Updated incrementally by the embedding queue — each newly embedded node's top-3 neighbors are upserted. Cleared on provider switch or full re-embed.

The `vec_nodes` virtual table is NOT created in the migration — it requires the sqlite-vec extension which is only available in Electron. Instead, `EmbeddingService.initialize()` creates it on first enable:

```sql
-- Created by EmbeddingService after db.loadExtension('vec0')
CREATE VIRTUAL TABLE IF NOT EXISTS vec_nodes USING vec0(
  node_id TEXT PRIMARY KEY,
  embedding float[384]    -- dimension matches active provider
);
```

This matches the pattern of migration 002 (FTS5) which is also runtime-conditional.

### Key Operations

- **Insert/update:** `INSERT INTO vec_nodes(node_id, embedding) VALUES (?, ?)` — sqlite-vec accepts Float32Array as buffer
- **KNN search:** `SELECT node_id, distance FROM vec_nodes WHERE embedding MATCH ? ORDER BY distance LIMIT ?`
- **Find duplicate pairs:** Maintained incrementally — when the queue embeds a node, it queries that node's top-3 neighbors and upserts into a `similar_pairs` cache table. The Intelligence Panel reads from this cache (fast, no O(n²) scan). Cache is invalidated on provider switch or full re-embed.
- **Dimension change:** `DROP TABLE vec_nodes` → recreate with new dimension → re-batch. Recovery: if `vec_nodes` doesn't exist on startup (crash during switch), `EmbeddingService.initialize()` recreates it via `CREATE VIRTUAL TABLE IF NOT EXISTS` and uses `embedding_metadata` rows as the re-embed work queue.

### Extension Loading

`better-sqlite3` disables `loadExtension()` by default. The database must be opened with extensions enabled, or `db.unsafeMode(true)` called before loading. The `better-sqlite3-engine.ts` initialization must be updated to allow extension loading when embeddings are configured.

```typescript
// electron/embeddings/vec-store.ts
db.loadExtension('/path/to/vec0');  // path resolved from extraResources
```

sqlite-vec ships prebuilt for macOS/Windows/Linux. Platform-appropriate `.dylib`/`.dll`/`.so` bundled via `electron-builder` `extraResources`. The extension path is resolved at runtime via `app.getPath('exe')` + relative resource path.

## Background Embedding Queue

```typescript
// electron/embeddings/embedding-queue.ts
class EmbeddingQueue {
  private queue: Array<{nodeId: string, text: string}>;
  private processing: boolean;
  private idleDelay: number; // 50ms between items

  enqueue(nodeId: string, text: string): void;
  async batchProcess(
    nodes: Array<{id: string, text: string}>,
    onProgress: (done: number, total: number) => void
  ): Promise<void>;
  private async drain(): void;
}
```

### Lifecycle

1. **User enables embeddings** → Provider initializes → `batchProcess` runs over all existing nodes. Progress reported via IPC (`embedding:progress`).
2. **Ongoing mutations** → DB backend handles `nodes.create`/`nodes.update` → checks if embeddings enabled → enqueues node. Queue drains in background with 50ms idle gaps.
3. **Node deleted** → Corresponding rows removed from `vec_nodes` and `embedding_metadata`.
4. **Re-embedding trigger** → `text_hash` in `embedding_metadata` compared against current text. Changed nodes re-enqueued during drain loop.

### `buildEmbeddingText` Logic

```
entity   → "{name}. {summary}"
note     → "{name}. {frontmatter.description} {frontmatter.labels}"
             fallback: "{name}. {first 500 chars of note body}"
resource → "{name}. {source_content title}. {first 500 chars of content}"
```

For notes, YAML frontmatter `description` and `labels` fields are preferred over body content because they are intentional, concise summaries. Falls back to body content only when frontmatter is absent or empty.

Text truncated to provider's `maxTokens` before embedding.

## Intelligence Panel — Similar Nodes

New section in `IntelligencePanel.tsx` below "Potential Connections". Only visible when embeddings are enabled.

### Data Flow

1. Panel mounts or user refreshes → IPC `embedding:find-duplicate-pairs(threshold, limit)`
2. Main process: for each embedded node, query sqlite-vec top-3 neighbors → filter by `similarityThreshold` → exclude dismissed pairs → sort descending → return top 20 pairs
3. Each pair: `{ nodeA: {id, name, type, label, connectionCount, summary}, nodeB: {...}, similarity: number }`

**Performance:** Similar pairs are computed incrementally — the embedding queue updates a `similar_pairs` cache table as each node is embedded (O(1) KNN query per embed, amortized). The Intelligence Panel reads directly from this cache, so opening the panel is a fast table scan, not an O(n²) all-pairs computation.

### Expandable Detail Cards

**Collapsed:** `[dot] React.js  <->  ReactJS  94% [>]`

**Expanded:** Two side-by-side panes:
- Left (primary — more connections): type, label, connection count, summary snippet. Labeled "Primary (keep)".
- Right (secondary): same fields. Labeled "Secondary (merge into primary)".
- Actions:
  - **Merge** — Merges secondary into primary. Transfers all edges. Adds secondary's name as alias via `entityResolution.addAlias`. Deletes secondary node.
  - **Swap Primary** — Flips which node is kept vs merged.
  - **Dismiss** — Writes to `embedding_dismissals`. Pair removed from list.

**After merge:** Pair removed. Remaining pairs re-rendered (pairs referencing deleted node disappear).

**When embeddings disabled:** Section shows "Enable embeddings in Settings to discover similar nodes" with a link to settings.

## RAG + Search Integration

### Shared Retrieval Function

```typescript
// electron/embeddings/semantic-search.ts
async function semanticSearch(
  queryText: string,
  topK: number
): Promise<Array<{nodeId: string, score: number}>>
```

Embeds query via active provider, runs sqlite-vec KNN, returns ranked results.

### RAG Pipeline Enhancement

Current: FTS5 keyword search → expand subgraph → format context.

New:
1. FTS5 keyword search → ranked node IDs
2. `semanticSearch(question, 10)` → ranked node IDs
3. **Reciprocal Rank Fusion (RRF):** `score = 1/(k + rank_fts) + 1/(k + rank_vec)` where k=60. Deduplicates, re-ranks by combined score.
4. Top N from fused results → expand subgraph → format context

### Search Bar Enhancement

Current: FTS5/LIKE query → display results.

New:
1. FTS5/LIKE query as before
2. If fewer than 5 results AND query is 3+ words: run `semanticSearch(query, 5)`
3. Append semantic results below keyword results with a "Semantic matches" divider
4. No RRF — keyword results stay first, semantic results are supplementary

### Context Chip Auto-Suggest

When `useChatContextStore.addNodes()` fires with new nodes:
1. Run `semanticSearch` against each attached node's embedding for top-3 similar (excluding already-attached)
2. Show `+ N related` indicator on chip bar
3. Click expands dropdown of suggested nodes with similarity scores and one-click add
4. Non-blocking — suggestions load async with abort controller (new `addNodes` call cancels stale suggestion requests, matching `searchIdRef` pattern in `HeaderSearch.tsx`)
5. Disappears when user starts typing

### `semantic_search` Chat Tool

```typescript
{
  name: 'semantic_search',
  description: 'Find nodes semantically similar to a query, even without keyword overlap',
  parameters: {
    query: { type: 'string', description: 'Natural language search query' },
    limit: { type: 'number', description: 'Max results (default 5)' }
  }
}
```

Returns node IDs + names + similarity scores. Agent calls existing `get_node`/`read_note` to drill deeper.

**Registration:** The tool is NOT added to the shared `CHAT_AGENT_TOOLS` array (which is compiled into both Chrome and Electron builds). Instead, `chat-agent-loop.ts` dynamically appends it to the tool list when `platformId === 'electron'` and embeddings are enabled. This ensures Chrome never sees the tool.

### Graceful Degradation

All five consumers are no-ops when embeddings are disabled. Existing FTS5-only behavior preserved exactly.

## Settings Panel

New "Embeddings" section in settings with guided descriptions for every option.

### Toggle

- **Enable Semantic Search** `[toggle: off by default]`
- Description: "Find similar nodes, improve search results, and give the chat agent better context — even without exact keyword matches. Requires a one-time setup below."

### Provider Selection

**Local (runs on your computer)**
- Description: "No internet needed. Free. Model downloaded on first use. Good for most knowledge graphs."
- Model quality sub-option:
  - Standard (~23MB download, ~60MB memory): "Faster, lighter. Recommended for most users."
  - Full (~90MB download, ~150MB memory): "More accurate similarity. Choose this if you have many similarly-named nodes."

**OpenAI API**
- Description: "Higher quality embeddings from OpenAI's servers. Requires an API key and internet connection. Billed by OpenAI (~$0.02 per 1M tokens)."
- API Key input field
- Model dropdown:
  - text-embedding-3-small: "Faster, cheaper. Good for most use cases."
  - text-embedding-3-large: "Best quality. Choose for large graphs with nuanced distinctions."

### Status Indicator

- `Ready — 230 nodes embedded`
- `Processing... 145/230 nodes` (with progress)
- `Not configured`

### Re-embed Button

- "Recomputes all embeddings. Required after changing provider or model. Takes a few seconds to minutes depending on graph size."

### Similarity Threshold Slider

- Range slider, default 0.80
- "Lower = more suggestions (may include false matches). Higher = fewer, more confident suggestions."

### Provider Switch Warning

Confirmation dialog: "Switching providers requires re-embedding all nodes. Existing embeddings will be discarded. This may take a few minutes. Continue?"

**Provider switch sequence:** (1) User confirms in dialog → (2) new config written to `PlatformStorage` → (3) `EmbeddingService.switchProvider()`: dispose old provider → (4) `DROP TABLE vec_nodes` + `DELETE FROM similar_pairs` + `DELETE FROM embedding_metadata` → (5) create `vec_nodes` with new dimensions → (6) initialize new provider → (7) `batchProcess` all nodes with progress reporting. If interrupted at any step, startup recovery recreates missing tables and uses empty `embedding_metadata` as signal to re-batch.

### API Key Security

OpenAI API key stored via `PlatformStorage` (same pattern as Anthropic key — never exposed to renderer, read only in main process).

## Dependencies

| Package | Purpose | Size Impact |
|---------|---------|-------------|
| `@huggingface/transformers` | ONNX model loading + inference | ~5MB (code); model files downloaded separately |
| `sqlite-vec` | Vector storage + KNN search extension | ~2MB native binary per platform |

## File Map

| Action | File | Purpose |
|--------|------|---------|
| Create | `src/embeddings/types.ts` | Provider interface, EmbeddingConfig, shared types |
| Create | `electron/embeddings/onnx-provider.ts` | Local ONNX embedding provider |
| Create | `electron/embeddings/openai-provider.ts` | OpenAI API embedding provider |
| Create | `electron/embeddings/embedding-service.ts` | Orchestrator: provider lifecycle, config |
| Create | `electron/embeddings/embedding-queue.ts` | Background processing queue |
| Create | `electron/embeddings/vec-store.ts` | sqlite-vec wrapper: insert, KNN, pairs |
| Create | `electron/embeddings/semantic-search.ts` | Shared retrieval function |
| Create | `electron/embeddings/ipc-handlers.ts` | IPC handler registration |
| Create | `src/db/worker/migrations/009-embeddings.ts` | Schema: vec_nodes, embedding_metadata, embedding_dismissals |
| Create | `src/platform/electron/embedding.ts` | PlatformEmbedding IPC wrapper |
| Create | `src/platform/chrome/embedding.ts` | No-op stub |
| Create | `src/ui/components/settings/EmbeddingSettings.tsx` | Settings panel section |
| Create | `src/ui/components/intelligence/SimilarNodes.tsx` | Expandable detail cards |
| Create | `src/ui/components/chat/ContextSuggestions.tsx` | Auto-suggest related nodes |
| Modify | `src/platform/types.ts` | Add PlatformEmbedding interface |
| Modify | `electron/main.ts` | Register embedding IPC handlers |
| Modify | `src/ui/components/intelligence/IntelligencePanel.tsx` | Add SimilarNodes section |
| Modify | `src/commands/rag-commands.ts` | Add semantic search + RRF blending |
| Modify | `src/ui/components/search/HeaderSearch.tsx` | Add semantic fallback |
| Modify | `src/ui/hooks/chat-agent-loop.ts` | Dynamic semantic_search tool registration + execution |
| Modify | `electron/better-sqlite3-engine.ts` | Enable extension loading for sqlite-vec |
| Modify | `src/ui/components/chat/ContextChipBar.tsx` | Add auto-suggest UI |
| Modify | `src/ui/components/chat/ChatBot.tsx` | Wire ContextSuggestions |
| Modify | `electron/db-backend.ts` | Notify EmbeddingService on node mutations |
