# Agent Memory Harness Design Research

Comparative analysis of how Mem0, Letta, ReMe, and MemU design their agent memory systems. Conducted May 2026 to inform Synapse's memory harness evolution.

## Systems Analyzed

| System | Origin | Architecture | Key Innovation |
|---|---|---|---|
| **Mem0** (v3) | mem0ai, ~48K GitHub stars | Hybrid vector + entity linking | Additive-only writes; conflict resolution deferred to retrieval-time ranking |
| **Letta** (formerly MemGPT) | UC Berkeley / Letta AI | OS-inspired three-tier paging | Agent actively controls its own memory via tool calls |
| **ReMe** | AgentScope / Alibaba | Procedural memory from execution history | Utility-based pruning removes frequently-retrieved-but-rarely-useful memories |
| **MemU** | NevaMind-AI, ~12K GitHub stars | File-system metaphor | Dual retrieval (fast RAG + deep LLM file reading) with proactive intent prediction |

Also covered: Zep/Graphiti (temporal knowledge graph), LangMem, A-MEM, broader research findings.

---

## Mem0 (v3)

### Write Path: Additive-Only Extraction

Mem0 v3 made a major architectural shift from v2. The old pipeline used two LLM calls (extract candidates, then classify each as ADD/UPDATE/DELETE/NOOP against existing memories). V3 replaced this with a **single-pass additive extraction**:

1. Retrieve last 10 messages for session context
2. Embed parsed messages, fetch top-10 similar existing memories (UUIDs mapped to sequential integers as anti-hallucination measure)
3. Single LLM call using `ADDITIVE_EXTRACTION_PROMPT` (~4,000 words) extracts all new facts
4. Batch embed all extracted texts
5. MD5 hash deduplication against existing memories
6. Batch persist to vector store
7. spaCy-based entity extraction → entity embedding → entity store with `linked_memory_ids`

Memories are never modified or deleted during extraction. Conflicts coexist in the store. This reduced LLM calls and improved accuracy: +20 points on LoCoMo (71.4 → 91.6), +26 points on LongMemEval (67.8 → 93.4).

Each memory stores: `data` (text), `hash` (MD5), `text_lemmatized` (for BM25), `created_at`, `updated_at`, `user_id`, `agent_id`, `run_id`, `actor_id`, `role`, `attributed_to`.

### Read Path: Three-Signal Hybrid Search

```
Query → [Semantic search (primary recall)] + [BM25 keyword (boost only)] + [Entity boost] → Score fusion → Threshold → Results
```

**Scoring formula:**
```python
max_possible = 1.0                          # semantic always active
max_possible += 1.0 if has_bm25 else 0      # +1 if BM25 available
max_possible += 0.5 if has_entity else 0    # +0.5 if entity store active

raw_combined = semantic_score + bm25_score + entity_boost
combined = min(raw_combined / max_possible, 1.0)
```

Key design: BM25 is a **boost signal only, not a recall expander**. Only semantic results above threshold (default 0.1) are candidates. BM25 and entity scores re-rank but never add new candidates. This prevents keyword-only matches from surfacing irrelevant content.

BM25 scores are normalized via logistic sigmoid with query-length-adaptive parameters (midpoint/steepness scale with term count).

Entity extraction uses spaCy NLP to identify four types: PROPER (capitalized phrases), QUOTED, COMPOUND (noun-noun compounds), NOUN (fallback). Entities are embedded and stored in a parallel vector collection. At search time, matched entities boost scores of memories they're linked to.

### Scoping Model

Four composable dimensions: `user_id`, `agent_id`, `run_id`, `app_id`. At least one required. Absent fields default to null, creating strict isolation boundaries. Supports wildcard `"*"` for "any non-null value."

### Graph Memory

Removed from OSS in v3. Replaced by entity linking within the vector store (simpler infrastructure, trades multi-hop graph queries for search-time boosting). Graph memory remains platform-only.

### Graceful Degradation

- Without spaCy: semantic-only search (no entity linking, no BM25 lemmatization)
- Without fastembed on Qdrant: BM25 disabled
- Minimum guarantee: semantic search always works

---

## Letta (formerly MemGPT)

### Core Concept: Memory as an Operating System

The MemGPT paper (Packer et al., UC Berkeley, 2023) treats the LLM as an OS:
- Context window = RAM (fast but limited)
- External storage = Disk (vast but requires explicit access)
- The LLM itself = CPU + memory controller

Unlike RAG (passive retrieval), Letta gives the agent **active control** over its own memory via tool calls. The agent decides what to store, evict, promote, and search for.

### Three-Tier Memory Hierarchy

**Tier 1 — Core Memory ("RAM")**

Labeled text blocks **pinned to the system prompt** at all times. No retrieval needed — they're in every inference call.

Default blocks:
- `persona`: agent's identity and behavior
- `human`: facts about the conversation partner

Schema per block:
```python
class BaseBlock:
    value: str           # content text
    limit: int           # char limit (default 100,000)
    label: str           # "human", "persona", "planning", etc.
    description: str     # tells agent what this block is for
    read_only: bool
    metadata: dict
    tags: List[str]
```

Rendered as XML in the system prompt with metadata showing `chars_current` and `chars_limit`. After any memory tool call modifies a block, the system prompt is **rebuilt** before the next inference step so the agent sees updated memory immediately.

**Tier 2 — Recall Memory ("Recent Disk")**

Complete conversation history. All messages persisted permanently. Only recent messages stay in-context; older ones are evicted but remain searchable via `conversation_search` (hybrid text + semantic search with role/date filtering).

**Tier 3 — Archival Memory ("Deep Disk")**

Vector database for long-term knowledge. Agent explicitly writes with `archival_memory_insert` and retrieves with `archival_memory_search`. For facts, summaries, knowledge — not conversation history. Supports tag filtering with `any`/`all` match modes and date ranges.

### Memory Tools

| Tool | Tier | Behavior |
|---|---|---|
| `memory_replace` | Core | Find-and-replace in a named block (validates uniqueness) |
| `memory_insert` | Core | Insert text at specific line in a block |
| `rethink_memory` | Core | Complete rewrite of a block (dangerous: last-writer-wins) |
| `conversation_search` | Recall | Hybrid search over full conversation history |
| `archival_memory_insert` | Archival | Embed and store text in vector DB |
| `archival_memory_search` | Archival | Semantic search with tag/date filters |
| `send_message` | N/A | Yields control to user |

### Context Window Compaction

When context overflows, Letta runs structured summarization:

| Mode | Behavior |
|---|---|
| `sliding_window` (default) | Evict oldest 30% of messages, summarize, keep newest 70%. Increases eviction in 10% increments if still too large |
| `all` | Summarize entire conversation in one pass |
| `self_compact_sliding_window` | Sliding window + include agent's system prompt in summarization request (better KV cache hits) |
| `self_compact_all` | Full summarization with agent context |

Summarization prompts require structured sections: high-level goals, what happened, important details (with verbatim identifiers), errors and fixes, lookup hints. Sliding window capped at 300 words; full summaries at 500.

Evicted messages remain in the database — `conversation_search` can always find them.

### Sleep-Time Agents (Background Consolidation)

A separate agent that **shares memory blocks** with the primary agent, runs in the background every N steps (default 5):

- Consolidates fragmented memories into coherent entries
- Identifies patterns across conversations
- Reorganizes and deduplicates memory blocks
- Archives and prunes outdated information
- Uses a different (often stronger) model since it's not latency-constrained
- Primary tool: `rethink_memory` (full block rewrites) for comprehensive restructuring

### Multi-Agent Shared Memory

Blocks can be attached to multiple agents via `block_ids`. Concurrency model:
- `memory_insert` — append-only, concurrent-safe
- `memory_replace` — targeted edits, mostly safe
- `rethink_memory` — full rewrite, last-writer-wins, unsafe for concurrent writes

Best practice: designate one agent (or the sleep-time agent) as the "owner" for heavy edits.

---

## ReMe (Remember Me, Refine Me)

### Core Concept: Procedural Memory from Execution History

ReMe (AgentScope/Alibaba, December 2025) addresses a specific gap: agents that perform tasks through trial and error but cannot learn from past executions. Each new task starts from scratch.

### Three-Phase Architecture

**Phase 1 — Experience Acquisition (Multi-Faceted Distillation)**

After each task execution, three complementary analyses extract knowledge:

1. **Success pattern recognition**: effective strategies from successful executions, extracting underlying principles (not just steps)
2. **Failure analysis**: preventive insights from unsuccessful attempts
3. **Comparative analysis**: successful vs. failed trajectories together, identifying critical decision points

An LLM-as-Judge validation step assesses each experience for actionability, accuracy, and value. Similarity-based deduplication removes redundant experiences.

Each experience stored as a structured tuple:
```
E = (omega, e, kappa, c, tau)
  omega = usage scenario (when to apply)
  e     = core experience content
  kappa = keywords
  c     = confidence score [0,1]
  tau   = tools utilized
```

**Phase 2 — Experience Reuse (Context-Adaptive Retrieval)**

Three mechanisms:
1. **Retrieval**: Top-K via cosine similarity between current task embedding and stored usage scenario embeddings
2. **Reranking**: Context-aware reranking evaluates relevance to current constraints
3. **Rewriting**: Reorganizes multiple retrieved experiences into cohesive, task-specific guidance

Key design: indexing by **usage scenario** (when to apply) outperforms indexing by raw query text or keywords — validated in ablation studies.

**Phase 3 — Experience Refinement (Utility-Based Pruning)**

The memory pool evolves through:
- **Selective addition**: Only successful trajectory insights are incorporated. Failure-aware reflection (max 3 iterations) explores alternatives before adding failure-derived experiences.
- **Utility-based deletion**:
  ```
  phi_remove(E) = 1[u(E)/f(E) <= beta]  if f(E) >= alpha, else 0
  ```
  where `u(E)` = successful retrievals, `f(E)` = total retrievals, `alpha` = retrieval threshold (default 5), `beta` = utility threshold (default 0.5).

  Memories that are frequently retrieved but rarely useful are pruned.

### Results

Qwen3-8B with ReMe (55.03% Pass@4) outperforms memoryless Qwen3-14B (54.65%), demonstrating that "self-evolving memory provides a computation-efficient pathway for lifelong learning."

### Software Framework (v0.3.1.9)

The paper's concepts expanded into a full framework with four memory types:

| Type | Purpose |
|---|---|
| Working Memory | Short-term context management with token-aware compaction (70-90% reduction) |
| Personal Memory | User habits/preferences via PersonalSummarizer with contradiction filtering |
| Procedural/Task Memory | Success/failure pattern extraction from completed tasks |
| Tool Memory | Records tool invocations, evaluates results, generates usage guidelines |

Two tiers: **ReMeLight** (Markdown files in `.reme/`) for single-user local development, and **ReMe** (vector DBs) for production.

---

## MemU

### Core Concept: Memory as a File System

MemU's thesis: memory should be human-readable Markdown files that the LLM can read directly as natural language, not opaque embeddings. Categories are folders, memory items are files, cross-references are symlinks.

### Three-Layer Hierarchy

| Layer | Analogy | Content |
|---|---|---|
| **Resource** | Mount points | Raw multimodal data (conversations, documents, images, audio, video) |
| **Memory Item** | Files | Extracted facts as structured Markdown with metadata |
| **Memory Category** | Folders | Auto-generated topic groupings that evolve organically |

### Write Path: Autonomous Memory Agent

1. **Ingest**: Raw data enters Resource Layer (multimodal: vision models for images, STT for audio)
2. **Extract**: `ConversationMonitor` performs semantic compression — verbose conversations → distilled facts
3. **Decide**: Memory Agent checks for conflicts/duplicates, chooses ADD, UPDATE, or natural decay
4. **Organize**: Auto-categorized into Category Layer without manual tagging
5. **Enrich**: Each MemoryItem stored as Markdown with tags, confidence scores, timestamps, source refs

### Read Path: Dual-Mode Retrieval

| Mode | Mechanism | Latency | Cost | When to Use |
|---|---|---|---|---|
| **RAG** (`method="rag"`) | Embedding similarity | Sub-second | No LLM inference | Continuous monitoring, real-time suggestions |
| **LLM** (`method="llm"`) | LLM reads memory files as natural language | Seconds | Full inference | Complex reasoning, multi-hop, intent prediction |

The dual modes are orchestrated: lightweight embedding mode runs as background daemon monitoring streams; when it detects relevant patterns, triggers expensive LLM-based deep reasoning.

### Conflict Resolution

When new information contradicts existing memory, the Memory Agent finds the existing entry, updates it to reflect the change, and preserves a historical note. Confidence scores are continuously updated as new evidence emerges.

### Proactive Features

- `ProactiveEngine` runs as background daemon analyzing patterns
- `IntentPredictor` forecasts user needs; when confidence exceeds threshold, pre-executes tasks
- `next_step_query` in retrieval results provides predicted follow-up context

### Benchmarks

92.09% average accuracy on LOCOMO. ~90% token cost reduction vs. raw conversation history approaches.

---

## Additional Systems

### Zep / Graphiti — Temporal Knowledge Graph

The most rigorous approach to conflict resolution. Dual-timeline architecture: every fact has `t_event` (when it happened) and `t_valid` (validity window). When contradictory facts arrive, the old fact's validity window is automatically expired with a timestamp — not deleted. Only current facts surface in queries.

Six-step write pipeline: episode capture (350-byte segments) → entity extraction → timeline tagging → graph storage → invalidity detection → indexing.

Read path: BM25 + semantic vectors + graph traversal executing in parallel, <200ms latency, no LLM inference at query time.

### A-MEM — Zettelkasten for Agents (NeurIPS 2025)

Each memory is a structured note with contextual descriptions, keywords, tags. The system analyzes historical memories to find connections and establish links. New memories trigger updates to existing related memories.

### Broader Research Findings

**Forgetting is a feature, not a bug:**
- ACT-R inspired decay: memory activation decreases with a power-law function. Optimal decay rate ~0.5. Achieved 97.2% retention precision with 58% storage reduction
- FadeMem: differential decay rates with adaptive exponential decay modulated by semantic relevance, access frequency, and temporal patterns. 45% storage reduction while maintaining reasoning quality

**Retrieval-stage optimizations matter more than ingestion-stage:**
- Retrieval depth tuning: +4.2%
- Context formatting: +2.0%
- Search prompt design: +1.8%
- Sentence chunking: +0.8%

**The most important finding across the literature:** "The gap between 'has memory' and 'does not have memory' is often larger than the gap between different LLM backbones."

---

## Cross-System Comparison

### Write Path

| System | Extraction Trigger | LLM Calls | Conflict Handling | Deduplication |
|---|---|---|---|---|
| **Mem0 v3** | Every `add()` call | 1 (additive extraction) | Deferred to retrieval | MD5 hash + semantic context |
| **Letta** | Agent tool calls (explicit) | Agent-driven | Agent decides | Agent responsibility |
| **ReMe** | After task execution | 1 (multi-faceted distillation) | Utility-based pruning | Similarity-based |
| **MemU** | Autonomous Memory Agent | 1 (semantic compression) | Update with history preservation | Category-level merging |
| **Synapse** (current) | Agent calls `manage_memory` | 1 (extraction) | `supersedes` chain (manual) | Agent self-governance via prompt |

### Read Path

| System | Primary Signal | Secondary Signals | Ranking | Budget Control |
|---|---|---|---|---|
| **Mem0 v3** | Semantic similarity | BM25 boost, entity boost | Normalized score fusion | `top_k` parameter |
| **Letta** | Agent-initiated search | Hybrid text+semantic | Per-tool results | Agent manages context window |
| **ReMe** | Usage scenario embedding | Context-aware reranking | Cosine similarity + rerank | Top-K |
| **MemU** | RAG embedding OR LLM reading | Dual-mode orchestration | Embedding score or LLM judgment | Token budget |
| **Synapse** (current) | Metadata scoring (tags, words) | Recency, frequency, type bonus | Weighted sum → RRF | Char budget (2000) |

### Memory Lifecycle

| System | Creation | Evolution | Pruning | Forgetting |
|---|---|---|---|---|
| **Mem0 v3** | Additive (never modify on write) | At retrieval via ranking | Manual delete | None |
| **Letta** | Agent tool calls | Agent rewrites blocks | Agent manages | Compaction summarization |
| **ReMe** | Post-task distillation | Confidence score updates | Utility ratio: u(E)/f(E) | Below utility threshold |
| **MemU** | Autonomous agent | Update with history | Confidence decay | Natural decay via non-use |
| **Synapse** (current) | Agent `manage_memory` | Supersession chain | `valid: false` | None |

### Memory Types

| System | Types |
|---|---|
| **Mem0 v3** | User memory, agent memory, procedural memory |
| **Letta** | Core (persona, human, custom blocks), recall (conversation), archival (knowledge) |
| **ReMe** | Working, personal, procedural/task, tool |
| **MemU** | Resource, memory item, memory category (+ planned intention layer) |
| **Synapse** (current) | Preference, fact, instruction, episodic |

---

## What Synapse Can Adopt

### 1. Hybrid Retrieval with Entity Boost (from Mem0 v3)

**Current state:** Synapse's metadata retriever scores by tag match (×2.0), content word match (×1.0), recency bonus, frequency bonus, and instruction type bonus. Phase 2 plans a vector retriever with RRF fusion.

**What to adopt:** Mem0's three-signal architecture — semantic + BM25 + entity boost — with the critical design decision that **BM25 is boost-only, not a recall expander**. Only semantic results above threshold are candidates.

**Synapse-specific advantage:** Synapse already has a knowledge graph with typed entities and relationships. When the agent queries memory, extract entities from the query, match them against graph nodes, and boost memories that reference those entities. This is a natural fit that Mem0 achieves through a separate entity store, but Synapse can do natively through the existing graph.

**Scoring formula to consider:**
```
score = semantic_score + (bm25_normalized * bm25_weight) + (entity_boost * entity_weight)
normalized = min(score / max_possible, 1.0)
```

Where `entity_boost` comes from matching query entities against the knowledge graph and finding memories linked to those nodes.

### 2. Additive-Only Writes with Retrieval-Time Ranking (from Mem0 v3)

**Current state:** Synapse uses agent self-governance via system prompt to check for contradictions before writing, plus a `supersedes` chain where new memories explicitly mark old ones as `valid: false`.

**What to adopt:** The additive-only model simplifies the write path. Instead of requiring the agent to detect contradictions and manage supersession chains (which is error-prone and requires extra LLM reasoning), just write new memories and let retrieval-time scoring surface the most relevant/recent ones.

**How it maps to Synapse:** Keep the existing file-based memory with frontmatter, but stop requiring `supersedes`. Instead:
- Always ADD new memories (still with dedup via content hash)
- Recency signals in the retrieval pipeline naturally surface newer information
- Old contradicting memories gradually rank lower (via access frequency decay + recency weighting)
- Explicit `supersedes` remains available as an optional manual override for clear contradictions

**Why this works:** Mem0 v3 validated that this approach scored +20 points on LoCoMo and +26 on LongMemEval versus the explicit conflict resolution approach. The insight: LLMs are poor at reliably detecting subtle contradictions during extraction, but retrieval ranking reliably surfaces recent/relevant information.

### 3. Utility-Based Memory Pruning (from ReMe)

**Current state:** Synapse tracks `access_count` and `last_accessed` but doesn't use them for pruning. Memories persist indefinitely unless manually superseded.

**What to adopt:** ReMe's utility ratio: `u(E)/f(E)` where `u` = successful retrievals (memory was useful) and `f` = total retrievals. When `f >= threshold` and `u/f <= 0.5`, the memory is a candidate for pruning.

**Implementation for Synapse:**
- Already tracking `access_count` — extend to track `useful_count` (memory was included in prompt AND the agent's response referenced it or the user confirmed a related fact)
- Periodic pruning pass: memories with `access_count >= 5` and `useful_count / access_count <= 0.5` are candidates for archival or deletion
- This naturally cleans up memories that seemed relevant by keyword but proved unhelpful in practice

### 4. Structured Compaction for Episodic Memories (from Letta)

**Current state:** Synapse writes episodic memories as individual `episodic_{date}-{slug}.md` files. Recent session summaries (last 3) are included in prompts separately from retrieval.

**What to adopt:** Letta's sliding-window compaction with structured summarization. As episodic memories accumulate, older ones get consolidated:

- When count exceeds threshold (e.g., 20 episodic files), run a consolidation pass
- Summarization prompt requires structured sections: goals, key events, important details (with verbatim identifiers), patterns observed
- Consolidated summary replaces the individual episodic files but originals are archived (not deleted)
- Only the consolidated summary + last N unconsolidated episodes are used for retrieval

This prevents episodic memory from growing unboundedly while preserving the most important patterns.

### 5. Background Memory Consolidation (from Letta's Sleep-Time Agents)

**Current state:** Memory management only happens during active agent conversations.

**What to adopt:** A lightweight consolidation pass that runs when the agent is idle (e.g., on vault open, or after N conversations):

- Scan all valid memories for semantic overlap
- Merge memories that say the same thing differently
- Identify memories whose content contradicts the current knowledge graph state
- Update confidence/staleness signals
- Could run as a simpler version of Letta's sleep-time agent — a single LLM call with all current memories, asking it to identify merges, contradictions, and stale entries

This doesn't require a separate agent infrastructure. It can be a periodic maintenance function triggered on vault open or after a configurable number of conversations.

### 6. Temporal Validity Windows (from Zep/Graphiti)

**Current state:** Synapse has binary validity (`valid: true/false`) with `superseded_by` pointing to the replacement.

**What to adopt:** Zep's dual-timestamp model where each memory has:
- `t_created`: when the memory was first recorded
- `t_valid_from`: when the fact became true (may differ from creation)
- `t_valid_until`: when the fact stopped being true (null = still valid)

When a contradicting memory arrives, the old memory's `t_valid_until` gets set rather than marking it `valid: false`. This preserves history ("user preferred X from January to March, then switched to Y") and enables temporal queries.

**Frontmatter extension:**
```yaml
---
valid_from: 2026-05-10T14:30:00Z
valid_until: null                    # null = currently valid
---
```

The retrieval pipeline would filter to `valid_until IS NULL` by default but could query historical validity when asked ("what did the user prefer last month?").

### 7. Memory-Indexed by Usage Scenario (from ReMe)

**Current state:** Synapse's metadata retriever matches memories by tags and content keywords.

**What to adopt:** ReMe's insight that indexing by **when to apply** outperforms indexing by content. Synapse's `description` field in memory frontmatter already serves a similar role, but it's used for relevance decisions in future conversations, not for embedding-based retrieval.

**Enhancement:** Make the `description` field the primary retrieval target (not the content body). The description answers "when is this memory useful?" while the content answers "what does it say?" This aligns with ReMe's finding that usage scenario embeddings outperform raw content embeddings for retrieval.

### 8. Dual Retrieval Modes (from MemU)

**Current state:** Single retrieval mode (metadata scoring).

**What to adopt:** MemU's insight that different queries need different retrieval depths:
- **Fast mode** (current metadata retriever): for routine prompting, sub-millisecond, no LLM cost
- **Deep mode** (LLM reads memory files directly): for complex queries where the agent needs to reason about memory content, not just retrieve by similarity

For Synapse, the deep mode could be a tool the agent calls explicitly: "search my memories about X" triggers the LLM to read the actual memory files and reason about them, rather than just injecting the top-3 matches into the prompt.

### Not Recommended for Synapse

**Graph memory store (Mem0 v2):** Synapse already has a knowledge graph. Adding a second graph database for memory relationships would create redundancy. Better to link memories to existing graph entities.

**Full Letta agent runtime:** Letta's three-tier model requires agents to manage their own context paging, which is a fundamentally different agent architecture. Synapse's agents don't need to page memory in/out — they operate in a different paradigm (knowledge graph extraction + conversation).

**MemU's proactive intent prediction:** The `ProactiveEngine` and `IntentPredictor` require an always-on background daemon analyzing patterns. This is overhead that doesn't match Synapse's usage pattern (on-demand agent conversations, not 24/7 monitoring).

**Mem0's platform-only features:** Graph memory, group chat attribution, webhooks, and analytics are paywalled. The OSS core (additive extraction + hybrid retrieval) has the most applicable patterns.

---

## Implementation Priority

Based on complexity, impact, and alignment with Synapse's existing architecture:

| Priority | Pattern | Source | Complexity | Impact |
|---|---|---|---|---|
| 1 | Entity boost in retrieval (via existing KG) | Mem0 | Medium | High — leverages Synapse's unique advantage |
| 2 | Additive-only writes | Mem0 | Low | Medium — simplifies write path, reduces agent errors |
| 3 | Utility-based pruning | ReMe | Low | Medium — self-cleaning memory, reduces noise |
| 4 | Episodic compaction | Letta | Medium | Medium — prevents unbounded growth |
| 5 | Temporal validity windows | Zep | Low | Medium — richer conflict model |
| 6 | Background consolidation | Letta | High | High — but can start simple |
| 7 | Usage-scenario indexing | ReMe | Low | Medium — better retrieval relevance |
| 8 | Dual retrieval modes | MemU | Medium | Medium — agent-driven deep memory search |

---

## Sources

### Mem0
- [mem0ai/mem0 GitHub](https://github.com/mem0ai/mem0)
- [Mem0 OSS Documentation](https://docs.mem0.ai/open-source/overview)
- [Mem0 V2→V3 Migration](https://docs.mem0.ai/migration/oss-v2-to-v3)
- [Mem0 Paper (arXiv 2504.19413)](https://arxiv.org/html/2504.19413v1)
- [State of AI Agent Memory 2026](https://mem0.ai/blog/state-of-ai-agent-memory-2026)

### Letta
- [MemGPT Paper (arXiv 2310.08560)](https://arxiv.org/abs/2310.08560)
- [letta-ai/letta GitHub](https://github.com/letta-ai/letta)
- [Agent Memory Blog](https://www.letta.com/blog/agent-memory)
- [Memory Management Docs](https://docs.letta.com/concepts/memory-management/)
- [Compaction Docs](https://docs.letta.com/guides/core-concepts/messages/compaction/)
- [Sleep-Time Agents](https://docs.letta.com/guides/agents/architectures/sleeptime/)

### ReMe
- [ReMe Paper (arXiv 2512.10696)](https://arxiv.org/html/2512.10696v1)
- [agentscope-ai/ReMe GitHub](https://github.com/agentscope-ai/ReMe)
- [Memory for Autonomous LLM Agents Survey (arXiv 2603.07670)](https://arxiv.org/html/2603.07670v1)

### MemU
- [NevaMind-AI/memU GitHub](https://github.com/NevaMind-AI/memU)
- [MemU Documentation](https://memu.pro/docs)

### Other
- [Zep: Temporal Knowledge Graph for Agent Memory](https://www.getzep.com/)
- [A-MEM (NeurIPS 2025, arXiv 2502.12110)](https://arxiv.org/abs/2502.12110)
- [ACT-R Inspired Memory (HAI 2025)](https://dl.acm.org/doi/10.1145/3765766.3765803)
- [FadeMem (arXiv 2601.18642)](https://arxiv.org/pdf/2601.18642)
- [AgeMem: RL-Learned Memory Policy (arXiv 2601.01885)](https://arxiv.org/html/2601.01885v1)
