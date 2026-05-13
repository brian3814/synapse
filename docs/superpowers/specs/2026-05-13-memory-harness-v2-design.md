# Memory Harness v2: Governed Retrieval Pipeline

**Date:** 2026-05-13
**Status:** Draft
**Scope:** Agent memory harness improvements (Phase 1: agent memory; Phase 2: graph integration — deferred)

## Problem

The current agent memory system degrades with scale. `loadAllForPrompt()` dumps all memories sorted by recency up to a 2000-char cap. Adding a 50th memory pushes older ones out regardless of relevance. There is no deduplication, contradiction detection, or temporal governance — memory quality erodes over time.

The system has two disconnected stores (file-based semantic + DB episodic) that don't interact, and retrieval has no notion of relevance to the current query.

## Design Constraints

Established during brainstorming:

- **Scope:** Agent memory harness first. Graph-walk retriever deferred to Phase 2.
- **Read + write paths:** Designed together — write-path schema determines what the read path can filter on.
- **Need detection:** Moderate — the metadata retriever's scores serve as implicit need detection (no separate classifier step). Fallback injects top-3 most-accessed memories when nothing matches.
- **Governance:** Hybrid — agent self-governs via system prompt rules on the hot path; background consolidation job catches what slips through on session end.
- **Storage:** Files as source of truth (`.kg/agent/memory/*.md`). DB tables and embeddings are derived indices, rebuildable from files.
- **Memory types:** Episodic + semantic only. Procedural memory deferred to a future version.

## Architecture Overview

```
┌──────────────────────────────────────────────────────────────┐
│  Chat Session (useChatSession.ts)                            │
│                                                              │
│  user query ──► retrieveMemories() ──► assembleSystemPrompt()│
│                      │                                       │
│              ┌───────┴────────┐                              │
│              │ Pipeline Runner│                              │
│              │  (pipeline.ts) │                              │
│              └───────┬────────┘                              │
│           ┌──────────┼──────────┐                            │
│           ▼          ▼          ▼                            │
│     ┌──────────┐ ┌────────┐ ┌────────────┐                  │
│     │ Metadata │ │ Vector │ │ Graph-Walk │ ◄── Phase 2      │
│     │ Retriever│ │Retriever│ │ Retriever  │                  │
│     └────┬─────┘ └───┬────┘ └────────────┘                  │
│          └─────┬─────┘                                       │
│                ▼                                             │
│          ┌──────────┐                                        │
│          │ RRF Fuser│                                        │
│          └────┬─────┘                                        │
│               ▼                                              │
│        ┌────────────┐                                        │
│        │ Formatter  │ ──► system prompt injection            │
│        └────────────┘                                        │
└──────────────────────────────────────────────────────────────┘

┌──────────────────────────────────────────────────────────────┐
│  Write Path                                                  │
│                                                              │
│  Agent self-governs ──► manage_memory tool ──► write file    │
│  (system prompt rules)   (tags, supersedes)    (frontmatter) │
│                                                              │
│  Session end ──► summarizeSession() ──► episodic file        │
│              ──► consolidation job    ──► dedup, tag enrich  │
└──────────────────────────────────────────────────────────────┘
```

## 1. Memory File Schema

Files live in `.kg/agent/memory/` with the naming convention `{type}_{name}.md`. Episodic memories use `episodic_{date}_{slug}.md`.

### Extended Frontmatter

```yaml
---
name: prefers-concise-answers
description: User wants short, direct responses without preamble
type: preference                    # preference | fact | instruction | episodic
tags: [communication, response-style, brevity]
superseded_by:                      # filename of memory that replaced this (null if current)
valid: true                         # false = superseded, kept for temporal history
created_at: 2026-05-10T14:30:00Z
updated_at: 2026-05-13T09:15:00Z
access_count: 7                     # incremented on retrieval
last_accessed: 2026-05-13T09:15:00Z
---

User prefers concise, direct answers. No preamble, no "Great question!" openers.
Confirmed across multiple sessions.
```

### New fields (all optional, backward-compatible)

| Field | Type | Default | Purpose |
|---|---|---|---|
| `tags` | string[] | `[]` | Agent-generated keywords for metadata retrieval |
| `superseded_by` | string \| null | `null` | Filename of the memory that replaced this one |
| `valid` | boolean | `true` | `false` = superseded, still kept for history |
| `access_count` | number | `0` | Incremented each time memory is retrieved into prompt |
| `last_accessed` | string \| null | `null` | ISO timestamp of last retrieval |

### Existing fields (unchanged)

`name`, `description`, `type`, `created_at`, `updated_at` — same as current.

### Type expansion

The `type` field gains `episodic` alongside the existing `preference`, `fact`, `instruction`. Episodic memories are session summaries that participate in the same retrieval pipeline.

## 2. Write Path: Governed Memory Creation

### Layer 1: Inline Self-Governance (Hot Path)

No extra LLM calls. The agent's system prompt includes governance rules:

1. Before calling `manage_memory`, the agent checks:
   - Is this worth remembering long-term? (skip ephemeral info)
   - Does it contradict a memory already in context? (supersede, don't duplicate)
   - Is it already covered by an existing memory? (update or skip)
   - Does it contain sensitive data? (strip PII patterns)
2. Agent calls `manage_memory` with the decision.

### Updated `manage_memory` Tool Schema

Two new optional parameters:

```typescript
{
  action: "create" | "update" | "delete" | "list",
  filename?: string,
  type?: "preference" | "fact" | "instruction",
  name?: string,
  description?: string,
  content?: string,
  tags?: string[],          // NEW — keywords for retrieval
  supersedes?: string,      // NEW — filename this memory replaces
}
```

### Write handler changes (`memory-commands.ts`)

When `action: create` with `supersedes` provided:
1. Write the new memory file with full frontmatter.
2. Read the superseded file, set `valid: false` and `superseded_by: <new_filename>`.
3. Regenerate `MEMORY.md` index.
4. If EmbeddingService is active, queue the new memory for embedding via `EmbeddingQueue.enqueue()`.

When `action: create` without `supersedes`:
1. Write the new memory file (same as current, plus `tags` in frontmatter).
2. Regenerate index.
3. Queue embedding if active.

### Layer 2: Background Consolidation (Safety Net)

Runs on session end, after episodic summarization. Non-blocking (fire-and-forget with try/catch).

**Job 1: Duplicate detection**
- Load all valid memories.
- Compute pairwise tag overlap (Jaccard similarity).
- Pairs above 0.7 overlap are candidates.
- Single Haiku-class LLM call per batch: "These memories seem related. Merge into one or keep separate?"
- If merged: one gets superseded, the other receives combined content.

**Job 2: Tag enrichment**
- Find memories with fewer than 2 tags.
- Single Haiku batch call: "Suggest 3-5 retrieval tags for each memory."
- Update frontmatter with new tags.

**Job 3: Re-embed stale memories**
- If EmbeddingService is active, check content hash vs last embedded hash.
- Re-embed any that changed via `EmbeddingQueue.enqueue()`.

**Cost budget:** ~1-2 Haiku calls per session end. Only fires if there are memories to consolidate. Empty memory store = no-op.

## 3. Read Path: Modular Retrieval Pipeline

### Interfaces

```typescript
interface RankedMemory {
  entry: MemoryEntry;
  score: number;
  source: string;   // which retriever produced this
}

interface MemoryRetriever {
  name: string;
  enabled: () => boolean;
  retrieve: (query: string, memories: MemoryEntry[]) => RankedMemory[];
}

interface MemoryFuser {
  fuse: (results: Map<string, RankedMemory[]>) => RankedMemory[];
}

interface MemoryFormatter {
  format: (memories: RankedMemory[], budget: number) => string;
}
```

### Pipeline Runner (`pipeline.ts`)

```typescript
async function retrieveMemories(
  query: string,
  memories: MemoryEntry[],
  retrievers: MemoryRetriever[],
  fuser: MemoryFuser,
  formatter: MemoryFormatter,
  options: { topK: number; charBudget: number }
): Promise<{ formatted: string; retrieved: RankedMemory[] }>
```

Steps:
1. Filter retrievers to those where `enabled()` returns true.
2. Run each retriever in parallel: `Promise.all(active.map(r => r.retrieve(query, memories)))`.
3. Collect results into `Map<retrieverName, RankedMemory[]>`.
4. If only 1 retriever ran, use its ranking directly. If multiple, pass to `fuser.fuse()`.
5. Take top-k from fused results.
6. Pass to `formatter.format(topK, charBudget)`.
7. Update `access_count` and `last_accessed` on retrieved memories.
8. Return formatted string + raw ranked list (for potential downstream use).

### Metadata Retriever

Always enabled. Extracts keywords using the same stop-word + tokenization logic as `extractSearchTerms()` in `rag-commands.ts`. Extract this function to a shared utility (e.g., `src/utils/text-search.ts`) so both the RAG pipeline and memory retriever import from one place.

**Scoring:**

| Signal | Weight |
|---|---|
| Tag match | ×2.0 |
| Content word match | ×1.0 |
| Recency bonus (updated in last 7 days) | +0.5 |
| High access frequency (>5 retrievals) | +0.3 |
| Type = instruction | +0.2 |

Filters out memories with `valid: false`.

**Fallback:** When no memory has any keyword match (score = 0 from tag/content matching), return the top-3 by `access_count` (most-accessed). Ensures core preferences are always available even for off-topic queries.

### Vector Retriever

Enabled when `EmbeddingService` is active and `vec_memories` table exists.

- Embed query via the configured provider (ONNX or OpenAI).
- KNN search over `vec_memories` table (k=10).
- Filter: valid memories only.
- Return results ranked by distance (converted to similarity score).

**`vec_memories` table** — separate from `vec_nodes`, created by EmbeddingService when first memory is embedded:

```sql
CREATE VIRTUAL TABLE IF NOT EXISTS vec_memories USING vec0(
  memory_id TEXT PRIMARY KEY,
  embedding float[{dimensions}]
)
```

**Embedding text construction** — simpler than nodes: `"{type}: {name}. {content}"`. The full content is the embedding text since memories are short.

### RRF Fuser

Reuses the existing `reciprocalRankFusion()` logic from `rag-commands.ts`:

```typescript
function fuse(results: Map<string, RankedMemory[]>): RankedMemory[] {
  // Same RRF algorithm with k=60
  // When only metadata results exist, pass through directly
}
```

### Annotated Formatter

Produces prompt-ready text with confidence indicators:

```
## What I Know About You
- [preference, ★★★] User prefers concise answers without preamble
- [fact, ★★☆] User works at a startup in Berlin
- [instruction, ★★★] Always cite source URLs when referencing graph data
```

Stars derived from normalized score (★★★ = top third, ★★☆ = middle, ★☆☆ = bottom third).

### Graceful Degradation

| Scenario | Behavior |
|---|---|
| No memories yet | Skip retrieval. Empty "What I Know" section. |
| Memories exist, no embeddings | Metadata retriever only. Tag + keyword matching. |
| Memories exist + embeddings active | Both retrievers fire. RRF fusion. Best quality. |

## 4. Prompt Assembly

### Updated `assembleSystemPrompt()`

The `PromptContext` interface changes:

```typescript
interface PromptContext {
  globalInstructions: string | null;
  presetPrompt: string | null;
  presetName: string | null;
  memoryContext: string;              // CHANGED: pipeline output replaces flat array
  recentSessionSummaries: Array<{ summary: string; created_at: string }>;  // CHANGED: add date
}
```

Output sections:

```
## What I Know About You
- [preference, ★★★] User prefers concise answers without preamble
- [fact, ★★☆] User works at a startup in Berlin

## Recent Sessions
- (May 12) Discussed vault switching and memory system design
- (May 10) Extracted entities from three ML papers

## Memory Guidelines
When you learn something worth remembering:
1. Check if it contradicts or duplicates a memory shown above
2. If contradicting: use manage_memory with supersedes to replace the old one
3. If new: use manage_memory with descriptive tags for future retrieval
4. Skip ephemeral information — only save durable preferences, facts, or instructions
```

The "Memory Guidelines" section is the self-governance prompt for Layer 1 of the write path.

## 5. Episodic Memory Unification

### Current state

Episodic summaries are stored in `memory_episodic` DB table, retrieved separately via `getRecentEpisodic(3)`, and injected as a fixed block.

### New state

Episodic summaries become files in `.kg/agent/memory/` with `type: episodic`:

```yaml
---
name: 2026-05-12-vault-and-memory
description: Discussed vault switching bug fix and memory harness design
type: episodic
tags: [vault, memory, architecture, design-session]
valid: true
created_at: 2026-05-12T22:30:00Z
updated_at: 2026-05-12T22:30:00Z
access_count: 0
last_accessed:
---

Discussed vault switching (fixed spawn vs relaunch issue) and designed
the v2 memory harness with governed write path and modular retrieval pipeline.
Key decisions: files as source of truth, hybrid retrieval, no procedural memory for v1.
```

### Richer summarization

The `summarizeSession()` prompt changes from "summarize in 2-3 sentences" to:

```
Summarize this conversation. Return JSON:
{
  "summary": "2-3 sentence summary focusing on decisions and outcomes",
  "tags": ["3-5 retrieval keywords"],
  "slug": "short-kebab-case-identifier"
}
```

The handler parses the JSON response, constructs the filename as `episodic_{date}_{slug}.md`, and writes it as a standard memory file.

### Retrieval impact

Episodic memories participate in the same retrieval pipeline as semantic ones. No fixed limit of 3. A relevant session from two weeks ago surfaces when the query matches its tags, even if there have been 10 sessions since.

The "Recent Sessions" section in the prompt assembly remains as a separate block showing the last 3 episodic files by `created_at` date (for temporal grounding). These are fetched directly from the memory directory by filtering `type: episodic` and sorting by date — separate from the retrieval pipeline. Any episodic memory can also appear in "What I Know About You" if the retriever scores it highly for a given query.

## 6. Migration

### Backward compatibility

All new frontmatter fields are optional with sensible defaults:

| Field | Default when missing |
|---|---|
| `tags` | `[]` (empty — metadata retriever falls back to content word matching) |
| `superseded_by` | `null` (memory is current) |
| `valid` | `true` (memory is active) |
| `access_count` | `0` |
| `last_accessed` | `null` |

Existing memory files work without modification. They participate in retrieval via content word matching and gain tags through background consolidation's tag enrichment job.

### One-time episodic migration

On first run of new code, if `memory_episodic` DB table has rows:
1. Read all rows.
2. Convert each to an episodic file: `episodic_{date}_{slug}.md`.
3. Idempotent — checks for existing files before writing.
4. DB table is not dropped (legacy compat), just not read by new code.

### `memory_semantic` DB table

Already mostly unused (data was previously migrated to files). No action needed. Not read by new code.

## 7. File Layout

### New files

```
src/memory/                           # New module
├── types.ts                          # MemoryRetriever, MemoryFuser, MemoryFormatter, RankedMemory
├── pipeline.ts                       # retrieveMemories() pipeline runner
├── retrievers/
│   ├── metadata-retriever.ts         # Tag/keyword matching with scoring
│   └── vector-retriever.ts           # sqlite-vec KNN (wraps EmbeddingService)
├── fusers/
│   └── rrf-fuser.ts                  # Reuses reciprocalRankFusion logic
├── formatters/
│   └── annotated-formatter.ts        # "[type, ★★★] content" format
├── consolidation.ts                  # Background dedup, tag enrichment, re-embed
└── governance.ts                     # Supersession logic, frontmatter update helpers
```

### Modified files

| File | Changes |
|---|---|
| `src/commands/memory-commands.ts` | Extend `writeMemory()` for `tags`, `supersedes`; extend frontmatter parsing for new fields; update `MemoryEntry` type |
| `src/shared/chat-agent-tools.ts` | Add `tags` (string[]) and `supersedes` (string) to `manage_memory` schema |
| `src/core/prompt-assembler.ts` | Accept `memoryContext: string` (pipeline output) instead of flat array; add "Memory Guidelines" section |
| `src/core/memory-extractor.ts` | Richer summarization prompt (JSON output with tags/slug); write episodic file instead of DB insert; trigger consolidation |
| `src/ui/hooks/useChatSession.ts` | Wire retrieval pipeline into pre-LLM-call flow; replace `loadAllForPrompt()` + `getRecentEpisodic()` with `retrieveMemories()` |
| `electron/embeddings/vec-store.ts` | Add `ensureVecMemoriesTable()`, `insertMemoryEmbedding()`, `knnSearchMemories()` alongside existing node functions |
| `electron/embeddings/embedding-service.ts` | Add `embedMemory()` and `searchMemories()` public methods |

### Not modified

| File | Reason |
|---|---|
| `src/db/worker/queries/memory-queries.ts` | DB queries stay for legacy compat, not called by new code |
| `src/db/worker/migrations/008-agent-harness.ts` | Tables stay, no new migration needed |
| Existing memory files in `.kg/agent/memory/` | Backward compatible — gain new features automatically |

## 8. Compound Effect Summary

The design creates three reinforcing loops:

**Loop 1 — Retrieval quality compounds with memory count:**
More memories → richer keyword/tag space → better matches for diverse queries → agent surfaces relevant context more often → better responses → user trusts agent more → more interactions → more memories.

**Loop 2 — Memory quality compounds with consolidation:**
Background jobs enrich tags → metadata retriever gets better matches → higher-value memories surface → agent builds on quality context → new memories are higher quality (better-informed agent) → consolidation has better material to work with.

**Loop 3 — Access tracking creates natural curation:**
Useful memories get high `access_count` → they rank higher in retrieval → they become the fallback when nothing matches → core preferences always available → agent behavior stays consistent → user stops needing to repeat themselves.

## References

- [Memory for AI Agents](https://memory.cobanov.dev/) — Cobanov's interactive essay (taxonomy, retrieval pipeline, governance, production architecture)
- [HyDE paper](https://arxiv.org/abs/2212.10496) — Hypothetical Document Embeddings (deferred to Phase 2)
- [RRF paper](https://plg.uwaterloo.ca/~gvcormac/cormacksigir09-rrf.pdf) — Reciprocal Rank Fusion
- `docs/superpowers/specs/2026-05-04-vector-embeddings-design.md` — existing embedding infrastructure
- `docs/superpowers/specs/2026-05-03-agent-harness-design.md` — original agent harness design
- `docs/superpowers/specs/2026-05-03-file-based-memory-and-folder-index-design.md` — current file-based memory design
