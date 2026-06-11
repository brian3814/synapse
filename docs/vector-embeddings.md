# Vector Embeddings (Electron-only)

Opt-in vector embedding system for semantic search. Off by default — configured through Settings panel. Desktop (Electron) only; Chrome extension is completely unaffected.

## Architecture

```
Renderer → IPC (embedding:*) → EmbeddingService → sqlite-vec (KNN) + Provider (ONNX/OpenAI)
```

- **`src/embeddings/types.ts`** — Type-only module (no runtime imports). Defines `EmbeddingProvider`, `EmbeddingConfig`, `PlatformEmbedding`. Safe to import from both Chrome and Electron builds.
- **`electron/embeddings/`** — All runtime code. `EmbeddingService` (orchestrator), `OnnxProvider` (worker_threads), `OpenAIProvider` (API), `EmbeddingQueue` (background processing), `vec-store.ts` (sqlite-vec wrapper).
- **`sqlite-vec`** — npm package, loaded via `sqliteVec.getLoadablePath()`. `vec_nodes` virtual table created by EmbeddingService at runtime (not in migrations).
- **Migration 009** — Creates `embedding_metadata` table (`node_id`, `text_hash`). Marked `optional: true`. Regular SQL table that works on both platforms. (`embedding_dismissals` was also created here but was dropped in migration 014 — the dismissal feature was never built.)

## Chrome Isolation Constraints

- `src/embeddings/types.ts` must contain ONLY TypeScript types. No runtime imports from `@huggingface/transformers`, `sqlite-vec`, or Node.js modules.
- Both platform `index.ts` files export `embedding`. Chrome export is a no-op stub class.
- The `semantic_search` chat tool is defined in the shared `CHAT_AGENT_TOOLS` constant (`src/shared/chat-agent-tools.ts`). On Chrome, it is a no-op since `PlatformEmbedding` returns empty results.

## What Embeddings Are Good For (and Not)

Embeddings work well for **rich text content** — notes, resources, multi-word queries:
- RAG retrieval: RRF blending of FTS5 + vector search in `src/commands/rag-commands.ts`
- Search bar: semantic fallback for 3+ word queries with few FTS hits
- `semantic_search` chat tool: agent self-serves semantic retrieval
- Context chip auto-suggest: related nodes when attaching context to chat

Embeddings are **not effective for entity deduplication** — short names ("LLM", "ChatGPT") produce weak/noisy similarity scores. Acronym resolution ("LLM" = "Large Language Model") requires world knowledge that embedding models don't have. Entity merge detection uses the **chat agent's LLM** instead (via `merge_nodes` tool), which has the world knowledge to identify duplicates.

## Embedding Text Construction

Per-node type strategy in `electron/embeddings/build-embedding-text.ts`:
- **entity** → `"{name}. {label}. {summary}"` — includes label and edge labels as context for short names
- **note** → frontmatter `description`/`labels` preferred, fallback to first 500 chars of body
- **resource** → `"{name}. {source title}. {first 500 chars of content}"`

## EmbeddingService Initialization

The service initializes lazily inside the `db:request` IPC handler after the first successful DB init (not during `app.whenReady()`). This avoids the race condition where `getDb()` throws before better-sqlite3 is ready.
