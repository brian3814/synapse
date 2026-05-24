# Memory Harness v2

Governed memory system with modular retrieval pipeline. Files in `.kg/agent/memory/` are the source of truth.

## Memory File Schema

Extended frontmatter on memory files (`{type}_{name}.md`):

```yaml
---
name: prefers-concise-answers
description: User wants short, direct responses
type: preference          # preference | fact | instruction | episodic
                          # Note: the manage_memory tool schema exposes only
                          # preference | fact | instruction to the LLM.
                          # Episodic is supported by the backend but created
                          # programmatically by memory-extractor.ts.
tags: [communication, response-style]
superseded_by:            # filename of replacement (null if current)
valid: true               # false = superseded
access_count: 7
last_accessed: 2026-05-13T09:15:00Z
created_at: 2026-05-10T14:30:00Z
updated_at: 2026-05-13T09:15:00Z
---
```

All new fields are optional with backward-compatible defaults. Existing files work without modification.

## Write Path

**Inline self-governance:** The agent's system prompt includes Memory Guidelines (appended by `assembleSystemPrompt`). Before calling `manage_memory`, the agent checks for contradictions/duplicates. The `manage_memory` tool accepts `tags` (retrieval keywords) and `supersedes` (filename to replace). When `supersedes` is provided, `governance.ts:markSuperseded()` sets `valid: false` and `superseded_by` on the old file.

**Episodic unification:** Session summaries now write to files (`episodic_{date}-{slug}.md`) alongside the `memory_episodic` DB table (both paths coexist). `memory-extractor.ts` uses a richer LLM prompt that returns JSON with `summary`, `tags`, and `slug`.

## Read Path: Retrieval Pipeline

```
User query → loadValidMemories() → retrievers → RRF fuser → annotated formatter → prompt
```

**Pipeline runner** (`src/memory/pipeline.ts`): Pluggable architecture — runs enabled retrievers, fuses results, formats for prompt, updates access stats.

**Metadata retriever** (`src/memory/retrievers/metadata-retriever.ts`): Always enabled. Scores by tag match (x2.0), content word match (x1.0), recency bonus (+0.5 if updated within 7 days), frequency bonus (+0.3 if >5 accesses), instruction type bonus (+0.2). Falls back to top-3 by access count when no keyword matches.

**RRF fuser** (`src/memory/fusers/rrf-fuser.ts`): Reciprocal rank fusion with k=60. Passthrough when only one retriever ran.

**Annotated formatter** (`src/memory/formatters/annotated-formatter.ts`): Produces `- [type, ***] content` lines with 3-tier confidence stars. Respects char budget (default 2000).

**Graceful degradation:** No memories → empty section. Memories but no embeddings → metadata retriever only. Memories + embeddings → both retrievers fire with RRF fusion (Phase 2).

## Prompt Assembly

`assembleSystemPrompt()` in `src/core/prompt-assembler.ts` receives:
- `memoryContext: string` — pre-formatted pipeline output (replaces old flat array)
- `recentSessionSummaries` — last 3 episodic memories by date (separate from retrieval)
- Always appends `MEMORY_GUIDELINES` section for agent self-governance

## Key Files

- `src/memory/types.ts` — `RankedMemory`, `MemoryRetriever`, `MemoryFuser`, `MemoryFormatter` interfaces
- `src/memory/pipeline.ts` — `retrieveMemories()` pipeline runner
- `src/commands/memory-commands.ts` — `MemoryEntry`, `writeMemory()`, `loadValidMemories()`
- `src/utils/text-search.ts` — Shared `extractSearchTerms()` (stop-word filtering + keyword extraction)
- `src/memory/governance.ts` — Supersession and access stat helpers
