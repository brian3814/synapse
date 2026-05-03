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

**`electron/embeddings/onnx-provider.ts`** — Loads `all-MiniLM-L6-v2` via `@huggingface/transformers`. Model files cached in `app.getPath('userData')/models/`. First run triggers download (~23MB quantized, ~90MB full). `embedBatch` processes in chunks of 32 for memory efficiency.

**`electron/embeddings/openai-provider.ts`** — Calls OpenAI embeddings API. `embedBatch` sends up to 100 texts per request (API limit). Handles rate limiting with exponential backoff (reuses `withRetry` from `src/core/retry.ts`).

**Provider switch constraint:** Vectors from different models are incompatible. Switching providers discards all embeddings and triggers a full re-batch. Settings UI warns before confirming.

## Vector Storage (sqlite-vec)

sqlite-vec integrates with the existing `better-sqlite3` instance in the Electron main process.

### Schema

```sql
-- Migration 009-embeddings.ts (runs on both platforms)
CREATE TABLE embedding_metadata (
  node_id TEXT PRIMARY KEY,
  provider_id TEXT NOT NULL,
  dimensions INTEGER NOT NULL,
  embedded_at TEXT NOT NULL,
  text_hash TEXT NOT NULL   -- detect name/summary changes for re-embedding
);

CREATE TABLE embedding_dismissals (
  node_id_a TEXT NOT NULL,
  node_id_b TEXT NOT NULL,
  dismissed_at TEXT NOT NULL,
  PRIMARY KEY (node_id_a, node_id_b)
);
```

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
- **Find duplicate pairs:** Query each node against top-K neighbors, filter by threshold, exclude dismissed pairs, sort by similarity descending
- **Dimension change:** `DROP TABLE vec_nodes` → recreate with new dimension → re-batch

### Extension Loading

```typescript
// electron/embeddings/vec-store.ts
db.loadExtension('vec0');
```

sqlite-vec ships prebuilt for macOS/Windows/Linux. Platform-appropriate `.dylib`/`.dll`/`.so` bundled via `electron-builder` `extraResources`.

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

**Performance:** The all-pairs scan is O(n) KNN queries. Results are cached in the EmbeddingService and invalidated by a generation counter that increments whenever the queue processes an item. The panel reads the cache; only the first open after embedding changes triggers recomputation.

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
4. Non-blocking — suggestions load async
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

Returns node IDs + names + similarity scores. Agent calls existing `get_node`/`read_note` to drill deeper. Registered in chat tool set alongside `search_nodes`.

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
| Modify | `src/ui/hooks/rag-pipeline.ts` | Add semantic search + RRF blending |
| Modify | `src/ui/components/search/HeaderSearch.tsx` | Add semantic fallback |
| Modify | `src/shared/chat-agent-tools.ts` | Register semantic_search tool |
| Modify | `src/ui/hooks/chat-agent-loop.ts` | Handle semantic_search tool execution |
| Modify | `src/ui/components/chat/ContextChipBar.tsx` | Add auto-suggest UI |
| Modify | `src/ui/components/chat/ChatBot.tsx` | Wire ContextSuggestions |
| Modify | `electron/db-backend.ts` | Notify EmbeddingService on node mutations |
