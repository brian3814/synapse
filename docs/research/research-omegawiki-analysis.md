# OmegaWiki Competitive Analysis

Research analysis of [OmegaWiki](https://github.com/skyllwt/OmegaWiki) — a Claude Code-powered research wiki platform from DAIR Lab at Peking University. Evaluated for concepts and workflows that could strengthen Synapse.

**Date:** 2026-05-12
**Repo snapshot:** `main` branch, cloned 2026-05-11

---

## 1. What OmegaWiki Is

A filesystem-based research knowledge graph where markdown files are nodes (YAML frontmatter = data layer, body = free-form content) and two append-only JSONL files store edges. 9 typed entity kinds, 23 validated edge types, 24 Claude Code slash-command skills spanning the full research lifecycle: paper ingestion, knowledge graph construction, gap detection, idea generation, experiment design, paper writing, and peer review.

The platform runs entirely inside Claude Code — skills are markdown specification files that Claude executes deterministically, delegating I/O and validation to Python CLI tools. There is no standalone app; the wiki directory *is* the product.

### Architecture at a Glance

```
Claude Code (LLM runtime)
  ↓ executes
.claude/skills/*.md (24 workflow specifications)
  ↓ delegates I/O to
tools/*.py (deterministic Python CLI)
  ↓ reads/writes
wiki/ (markdown pages + JSONL graph)
  ↓ served by
tools/serve.py → app/ (vanilla JS SPA with Cytoscape.js)
```

### Tech Stack

| Layer | Technology |
|---|---|
| Runtime | Claude Code CLI |
| Entity storage | Markdown files with YAML frontmatter |
| Graph storage | Append-only JSONL (`edges.jsonl`, `citations.jsonl`) |
| Schema | YAML definitions in `runtime/schema/` |
| Tools | Python 3.9+ CLI scripts |
| External APIs | Semantic Scholar, arXiv RSS, DeepXiv, Wikipedia |
| Graph visualization | Cytoscape.js 3.28 (web), Obsidian Canvas (desktop) |
| Cross-model review | Custom MCP server wrapping any OpenAI-compatible API |
| Markdown rendering | marked.js 14.x |
| Frontend | Vanilla ES modules, no build step, CDN imports |

---

## 2. Entity Schema

9 entity types defined in `runtime/schema/entities.yaml`:

| Kind | Directory | Role |
|---|---|---|
| Paper | `wiki/papers/` | Structured paper summaries — primary ingestion surface |
| Concept | `wiki/concepts/` | Cross-paper technical ideas (e.g., "attention mechanism") |
| Topic | `wiki/topics/` | Research direction maps with SOTA trackers and open problems |
| Person | `wiki/people/` | Researcher profiles with areas and recent work |
| Idea | `wiki/ideas/` | Research hypotheses with lifecycle state machine |
| Method | `wiki/methods/` | Reusable techniques (architecture, training, evaluation, etc.) |
| Experiment | `wiki/experiments/` | Full records: hypothesis → setup → results → updates |
| Summary | `wiki/Summary/` | Domain-wide surveys across topics |
| Foundation | `wiki/foundations/` | Terminal background knowledge (receives links, emits none) |

### Key Design Patterns

**Lifecycle state machines** on ideas and experiments:
- Ideas: `proposed → in_progress → tested → validated | failed`
- Experiments: `planned → running → completed | abandoned`
- Transitions validated by CLI tool — can't skip states
- `failure_reason` conditionally required when `status == failed`

**Terminal foundation type**: `foundations/` pages absorb all incoming links but emit none and cannot be modified by ingestion. Models stable textbook knowledge that anchors the graph without fragmenting it.

**Contribution type taxonomy**: Closed enum on papers — `method | theory | benchmark | analysis | application | system | position | survey`. Drives filtering and context ranking.

**Aliases on concepts**: `aliases: list_str` powers dedup matching — the token-similarity tool checks both canonical name and aliases.

---

## 3. Edge/Relationship Schema

23 edge types across 6 workflows, stored in `runtime/schema/edges.yaml`:

### Paper-Paper Semantic Edges (8 types)
- Symmetric: `same_problem_as`, `similar_method_to`, `complementary_to`
- Directed: `builds_on`, `compares_against`, `improves_on`, `challenges`, `surveys`

### Paper-Concept Edges (4 types)
- `introduces_concept`, `uses_concept`, `extends_concept`, `critiques_concept`

### Evidence Edges (2 types)
- `supports`, `contradicts` — wildcard endpoints

### Experiment Edges (2 types)
- `tested_by`, `invalidates`

### Idea Edges (2 types)
- `addresses_gap`, `inspired_by`

### Provenance (1 type)
- `derived_from` — paper → foundation links

### Citation (1 type)
- `cites` — stored separately in `citations.jsonl`

All edges carry `confidence: high | medium | low` and `evidence: str` (free text). Symmetric edges are canonicalized by sorting `[from, to]` alphabetically before storage, ensuring `(A, B, type)` and `(B, A, type)` produce the same stored record.

### Bidirectional Link Rules (xref.yaml)

Whenever entity A links forward to entity B, a reverse update on B is required in the same editing turn:

| Forward | Reverse |
|---|---|
| Paper body → Concept | Concept `key_papers` append |
| Paper body → Person | Person `Recent work` append |
| Idea `origin_gaps` → Concept | Concept `linked_ideas` append |
| Experiment `linked_idea` → Idea | Idea `linked_experiments` append |
| Method `parent_methods` → Method | Method `child_methods` append (symmetric) |

Enforced by skill instructions during authoring, audited by `/check`, auto-fixed by `/check --fix`.

---

## 4. Knowledge Compounding Mechanism

This is OmegaWiki's central differentiator — each skill both consumes and contributes to the wiki, creating compounding value.

### Context Brief (`wiki/graph/context_brief.md`)

After every ingestion, `rebuild-context-brief` scans all entities and produces a graph-topology-ranked summary:
- Methods sorted by edge count (most connected = most reusable)
- Gap map snapshot from `open_questions.md`
- Failed ideas (anti-repetition memory)
- Papers sorted by edge count (most cited/referenced first)
- Experiments and recent edges
- Stale entities (date_updated > 30 days ago)

**Five budget profiles** allocate different character budgets per section:

| Profile | Methods | Gaps | Failed Ideas | Papers | Edges |
|---|---|---|---|---|---|
| ideation | 1500 | 2500 | 2000 | 1000 | 500 |
| experiment | 2500 | 1000 | 1000 | 1500 | 1500 |
| writing | 2000 | 500 | 500 | 3000 | 1000 |
| review | 1500 | 1500 | 1500 | 2000 | 1000 |
| general | 2000 | 1500 | 1500 | 2000 | 1000 |

This means the graph topology directly influences what the LLM "knows" in subsequent tasks — graph centrality serves as an information-relevance proxy.

### Gap Map (`wiki/graph/open_questions.md`)

A deterministic scanner walks:
- `papers/## Open questions`
- `topics/## Open problems`
- `concepts/## Open problems` (including H3 subsections like `### Known gaps`)

All bullet items are aggregated into a single document that feeds back into `context_brief.md` and is read by `/ideate`, `/ask`, and `/daily-arxiv`.

### The Compounding Loop

```
Identified gap (open_questions.md)
  → Idea created with addresses_gap edge (/ideate)
    → Experiment designed with tested_by edge (/exp-design)
      → Experiment evaluated (/exp-eval)
        → supports edge: gap is addressed
        → invalidates edge: gap is reinforced
        → idea status: validated or failed (with failure_reason)
          → Failed idea becomes banlist entry for future /ideate runs
```

---

## 5. Anti-Repetition Memory

When ideas are filtered out during `/ideate` Phase 3-4, they are **not discarded** — they are written to `wiki/ideas/{slug}.md` with:
- `status: failed`
- `failure_reason: "[filter] <specific reason>"` (e.g., `"[filter] highly similar published work exists: <paper-title>"`)

Future `/ideate` runs load all `status=failed` ideas in Phase 1 as a **banlist** and check for overlap before generating candidates. The `[filter]` prefix distinguishes ideation-stage failures from post-experiment failures recorded by `/exp-eval`.

This turns LLM evaluation failures into durable memory that prevents the system from rediscovering and proposing the same dead ends.

---

## 6. Dual-LLM Review System

### MCP Server Architecture

`mcp-servers/llm-review/server.py` (~385 lines Python) wraps any OpenAI-compatible API via JSON-RPC over stdin/stdout:

| Tool | Purpose |
|---|---|
| `chat` | Single-turn prompt, returns response + `threadId` for follow-up |
| `chat-reply` | Continue existing thread by `threadId` (in-memory history dict) |
| `web_search` | Provider-specific web search (when available) |

Configuration via `.env`: `LLM_API_KEY`, `LLM_BASE_URL`, `LLM_MODEL`, `LLM_FALLBACK_MODEL`. Retry: 3 attempts with exponential backoff, fallback model on third attempt.

### The Independence Principle

Defined in `.claude/skills/shared-references/cross-model-review.md`, referenced by 9 skills:

> Claude must NEVER send its own judgment, score, or conclusions to the Review LLM before it forms an independent assessment.

Rules:
- When scores diverge by 2+ points, both are reported with reasoning (not averaged)
- Fatal flaw findings from either model stand regardless of the other's score
- Conservative composition: take the lower of two independent scores

### Review Modes

| Mode | Rounds | Focus |
|---|---|---|
| Standard | 1 | General quality assessment |
| Hard | Up to 3 | Claude rebuts each weakness, Review LLM reassesses |
| Adversarial | Up to 3 | Explicit search for fatal flaws (incorrect proofs, data leakage, unfair comparisons) |

---

## 7. Ingestion Pipeline

### Data Flow

```
Source (arXiv URL | .tex | .pdf)
  → Step 1: Source resolution (PDF→TeX preferred, synthetic TeX fallback)
  → Step 2: Identity enrichment (S2 API → venue, citations, importance)
  → Step 3: LLM writes paper page (fixed frontmatter + body sections)
  → Step 4: Concept/method/people extraction with pre-creation dedup
  → Step 5: Citation graph (S2 references + citations → add-edge/add-citation)
  → Step 6: Topic + index updates
  → Step 7: Log + rebuild-context-brief + rebuild-open-questions
```

### Entity Deduplication Strategy

Before creating any concept, the LLM **must** call the deterministic dedup tool:
```bash
tools/research_wiki.py find-similar-concept wiki/ "<title>" --aliases "<a,b,c>"
```

The algorithm is purely token-based (no embeddings, no LLM):
1. Exact normalized match → score 1.00
2. Phrase containment (shorter fully inside longer, both ≥2 tokens) → score 0.85
3. Jaccard token similarity (content words, min length 3, stop words removed):
   - J ≥ 0.70 → score = J
   - 0.40 ≤ J < 0.70 → score = 0.4 + (J - 0.4) * 0.5
   - J < 0.40 → not returned

Decision rules:
- Score ≥ 0.80: merge unconditionally
- Score 0.40–0.80: LLM reads existing definition, defaults to merge unless a specific technical distinction exists
- Score < 0.40 or empty: creation allowed, subject to per-paper limits

**Per-paper creation limits** (prevents wiki bloat):
- importance < 4: max 1 concept + 1 method
- importance ≥ 4: max 3 concepts + 2 methods

### Parallel Init with Git Worktrees

`/init` ingests 8-10 papers in parallel using git worktrees. Each paper gets its own branch (`ingest-{slug}`), and `/ingest` runs as a subagent in each worktree. `.gitattributes` uses `merge=union` for shared append-only files (log, edges, citations, index). Fan-in merges branches sequentially, then runs `dedup-edges` + `dedup-citations` to collapse duplicates.

---

## 8. Discovery & Recommendation Pipeline

### Three-Channel Paper Discovery (`/discover`)

Given anchor paper(s), runs three Semantic Scholar channels per anchor:
- **Recommendations**: semantic neighbors (recency-biased)
- **References**: what the anchor cites → surfaces canonical older work
- **Citations**: what cites the anchor → surfaces high-impact follow-ups

This three-channel design prevents the recency-biased cluster that recommendation-only produces.

### Ranking Formula (Anchor Mode)

| Component | Weight | Signal |
|---|---|---|
| `influence_score` | 0.25 | `0.7 * log1p(influential_cites)/log1p(50) + 0.3 * log1p(total_cites)/log1p(1000)` |
| `anchor_influence_edge` | 0.20 | S2 `isInfluential` flag — this specific citation was substantively important |
| `anchor_overlap` | 0.15 | How many anchors surfaced this candidate |
| `channel_diversity` | 0.15 | Appears in recommend + references + citations = stronger signal |
| `freshness` | 0.15 | 1.0 for ≤1yr, 0.85 for ≤3yr, 0.60 for ≤6yr, 0.40 for ≤10yr |
| `h_index` | 0.10 | `min(1.0, max_author_h / 60)` — mild credibility bonus |

All deterministic — no LLM in the ranking loop.

### Daily arXiv Feed (`/daily-arxiv`)

Automated pipeline: arXiv RSS → wiki profile matching (top 40 keywords extracted from all wiki content) → S2/DeepXiv enrichment → deterministic scoring → optional LLM judgment → digest email. Can auto-ingest high-confidence picks when Claude Code is available.

---

## 9. Workflow Orchestration

### Research Orchestrator (`/research`)

End-to-end state machine with 2 human gates:

```
Stage 0: Bootstrap (auto-triggered when wiki < 3 papers)
Stage 1: Idea Discovery (→ /ideate)
  ┌── Gate 1: SELECT IDEA (human or auto) ──┐
Stage 2: Experiment Design (→ /exp-design)
Stage 3a: Deploy Experiments (→ /exp-run, non-blocking)
Stage 3b: End Session (experiments run asynchronously)
Stage 3c: Collect Results (→ /exp-run --collect)
Stage 4: Verdict & Iteration (→ /exp-eval, max 2 iterations)
  ┌── Gate 2: CONFIRM PAPER READY (human or auto) ──┐
Stage 5a: Paper Plan (→ /paper-plan)
Stage 5b: Paper Draft (→ /paper-draft --review)
Stage 5c: Paper Refine (→ /refine --max-rounds 3)
Stage 5d: Paper Compile (→ /paper-compile)
```

### Cross-Session Recovery

`wiki/outputs/pipeline-progress.md` stores YAML frontmatter with: slug, direction, status, current_stage, idea_slug, experiment_slugs, iteration_count. On restart, offers: resume / start fresh / check status. `--start-from <stage>` allows surgical re-entry.

### Writer Policy

`runtime/policy/writers.yaml` declares which skills may write which fields — a spec-level contract (not runtime-enforced):
- `papers.importance` — frozen after first write (set by `/ingest` only)
- `ideas.status` — writable only by `ideate`, `exp-eval`, `refine`
- `ideas.failure_reason` — only `/exp-eval`
- `experiments.outcome` — only `/exp-eval`
- Edge types are also producer-restricted (e.g., `tested_by` only from `/exp-design`)

### Maturity-Adaptive Behavior

`research_wiki.py maturity wiki/ --json` returns:
- `graph_density = edges / max(1, N*(N-1))`
- `coverage_score = papers/20*0.3 + ideas/15*0.3 + completed_experiments/5*0.2 + edges/50*0.2`
- Maturity level: `cold` (< 5 papers/ideas), `warm` (≥ 5), `hot` (≥ 20 papers, ≥ 15 ideas, has experiment→supports/invalidates edges)

Skills expand or contract their search radius based on maturity.

---

## 10. Web UI & Frontend

### Stack

Vanilla ES modules (no bundler) with CDN-loaded Cytoscape.js, marked.js, and js-yaml. Python `ThreadingHTTPServer` serves static files and proxies API calls to `research_wiki.py` CLI.

### Graph Visualization

**Pre-computed layout**: Custom O(n²) Verlet simulation (800 iterations, synchronous, main thread) runs to completion before Cytoscape mounts. Cytoscape uses `layout: { name: "preset" }` with pre-computed positions.

Layout parameters:
- `REPULSION = 12000` (strong, for label readability)
- `LINK_DISTANCE = 280` (loose springs)
- `GRAVITY = 0.012` (weak centering)
- Node radius: `min(4 + sqrt(degree) * 4, 20)` (degree-proportional)

Interactions:
- Click: BFS highlight (depth 1-5) via Cytoscape `neighborhood("node")`
- Double-click: navigate to reader view
- Checkboxes: filter by entity type and edge type
- Search: substring match on label, top 20 results, animated pan/zoom

### Dashboard Widgets

10 widgets, all pure HTML/CSS:
1. Headline strip (7 entity count cells)
2. Maturity gauge (CSS progress bar)
3. Methods by type (CSS bar chart)
4. Idea novelty histogram (CSS column chart)
5. Experiments table
6. Ideas kanban (5-column: proposed → validated/failed)
7. Top tags cloud (font-size scaled by frequency)
8. Open questions (rendered markdown with wikilinks)
9. Log timeline (last 50 entries)
10. Maintenance buttons (regenerate derived data)

### Intent System

Bridges read-only SPA with Claude Code sessions. The SPA cannot execute `/skill` commands (those require an LLM session). Instead, it generates the correct slash-command string and shows it in a copy-to-clipboard modal. Example: clicking "Design Experiment" on an idea page generates `/exp-design --linked-idea my-idea-slug`.

### SSE Live Reload

Background thread polls `wiki/` every 1.5s via `os.walk` mtime comparison. On change, broadcasts SSE events to connected `EventSource` clients. Self-write suppression: `state.lastWriteAt` + 2500ms grace window prevents double-reload after SPA writes.

---

## 11. Structural Integrity (`tools/lint.py`)

10 check categories:

| Check | What it validates |
|---|---|
| `missing_fields` | Required frontmatter per entity type |
| `broken_links` | `[[slug]]` wikilinks whose target doesn't exist |
| `orphan_pages` | Pages with zero incoming links |
| `field_values` | Enum validation, range checks (e.g., `novelty_score` must be 1-5) |
| `required_when` | Conditional requirements (e.g., `failure_reason` when `status: failed`) |
| `link_field_targets` | Frontmatter link fields reference existing pages |
| `xref_asymmetry` | Forward links have matching reverse links per xref.yaml |
| `graph_edges` | JSONL validity, required fields, valid types, endpoint matching |
| `graph_citations` | Citation JSONL validity, papers-only endpoints |
| `content_quality` | Soft checks (importance-5 papers referenced by concepts, etc.) |

Auto-fix (`--fix`): repairs xref asymmetry and missing fields with defaults. Idempotent, frontmatter-only.

---

## 12. Head-to-Head: OmegaWiki vs Synapse

| Dimension | OmegaWiki | Synapse | Assessment |
|---|---|---|---|
| **Storage engine** | JSONL files + Markdown | SQLite + better-sqlite3 | Synapse: indexed queries, ACID, FTS5 |
| **Graph rendering** | Cytoscape.js (~500 node ceiling) | Three.js InstancedMesh (10K+) | Synapse: order of magnitude scale |
| **Layout algorithm** | O(n²) Verlet, synchronous, main thread | Barnes-Hut O(n log n), Web Worker | Synapse: async, better complexity |
| **Entity schema** | 9 domain-specific types, YAML-validated | User-defined labels, open-ended | OmegaWiki: structured knowledge modeling |
| **Edge schema** | 23 named types + confidence + evidence | User-defined labels, no validation | OmegaWiki: semantic precision |
| **Semantic search** | Token-matching Jaccard (no vectors) | sqlite-vec + ONNX/OpenAI embeddings | Synapse: real semantic similarity |
| **Entity dedup** | Jaccard tokens + LLM judgment | LLM `merge_nodes` tool | Tie: same insight, different implementation |
| **Knowledge compounding** | context_brief + gap_map (topology-ranked) | RAG via RRF(FTS5, vector search) | OmegaWiki: purpose-tuned context |
| **Lifecycle tracking** | State machines on ideas/experiments | None | OmegaWiki |
| **Anti-repetition** | Failed ideas as banlist | `embedding_dismissals` (embeddings only) | OmegaWiki: broader scope |
| **Multi-LLM** | MCP server for independent review | Single LLM | OmegaWiki |
| **Platform** | Claude Code CLI only | Electron desktop app with GUI | Synapse: accessible to non-CLI users |
| **Ingestion UX** | CLI, no visual review | ExtractionReview with undo/redo | Synapse: user agency |
| **Multi-modal** | LaTeX/PDF only | PDF, images, arbitrary files | Synapse |
| **Browser integration** | None | Companion extension for DOM capture | Synapse |
| **Real-time sync** | SSE file watcher, 1.5s poll | BroadcastChannel + IPC, instant | Synapse |

---

## 13. Integration Opportunities for Synapse

### Tier 1 — High Impact, Fits Existing Architecture

#### A. Connectivity-Ranked RAG Context

**What**: When `search_knowledge` builds context for the chat agent, add edge count as a third ranking signal alongside FTS5 and vector scores. Entities with more connections are more central to the user's knowledge.

**Why**: OmegaWiki's context_brief sorts by edge count — most connected = most reusable. Graph centrality is a strong information-relevance proxy. Currently our RRF blends FTS5 + vector scores but ignores graph topology.

**How**: SQL query `SELECT node_id, COUNT(*) as edge_count FROM edges GROUP BY node_id` joined into `rag-commands.ts` RRF ranking. Different chat modes could weight connectivity differently.

**Effort**: Small — one query, one ranking adjustment.

#### B. Node Lifecycle States + Anti-Repetition Memory

**What**: Add `status` enum (`active | proposed | validated | failed | archived`) and `failure_reason` text to entity nodes. When the chat agent's `merge_nodes` is rejected, or extracted entities are dismissed in review, record the reason. The agent loads these before proposing the same operations again.

**Why**: OmegaWiki's banlist pattern prevents rediscovering dead ends. Our `embedding_dismissals` table already does this for embeddings — this generalizes to all entity operations.

**How**: Add columns `status TEXT DEFAULT 'active'` and `dismissed_reason TEXT` to `nodes`. Update `chat-tool-executor.ts` to check dismissed history before proposing merges. Surface in ExtractionReview as "previously dismissed" indicators.

**Effort**: Small — two columns, a query in the merge tool, UI indicator.

#### C. Graph Maturity Metrics

**What**: A `getGraphMaturity()` function computing density, coverage, and cold/warm/hot level. The chat agent adapts behavior based on maturity.

**Why**: OmegaWiki skills expand search when cold, weight internal connections when hot. Our chat agent treats a 5-node graph and a 5000-node graph the same.

**How**: `density = edges / max(1, N*(N-1))`, coverage as weighted entity-type counts. Return in system prompt context for chat agent. Display in graph toolbar.

**Effort**: Small — one function, one system prompt addition.

#### D. Pre-Creation Merge Bias in Extraction Review

**What**: During `buildDiffItems`, when fuzzy matching finds >0.4 similarity, default the review UI to "merge" rather than "create new." Add configurable cap on new entities per extraction.

**Why**: OmegaWiki caps at 1-3 concepts per paper and this prevents the "pile of near-duplicates" failure mode. Their merge-first philosophy: creation is the exception.

**How**: Adjust scoring thresholds in entity resolution. Add a settings option for max new entities. Default review actions to "merge" when similarity is moderate.

**Effort**: Small-medium — threshold tuning, UI default changes.

#### E. Knowledge Gap Tracking

**What**: A `gap` flag or dedicated node type for explicitly tracking what's missing in the knowledge graph. Ideas/entities link to gaps via `addresses_gap` edges.

**Why**: OmegaWiki's gap map makes the graph prescriptive ("what should I learn next?") not just descriptive ("what do I know?"). Gaps drive ideation and discovery.

**How**: Add `is_gap: boolean` to node properties or a dedicated "gap" node type. Chat agent's `create_node` tool gets a `--gap` flag. The `search_knowledge` tool surfaces gaps when relevant. ExtractionReview can mark items as gaps.

**Effort**: Medium — new concept, needs UI surface.

### Tier 2 — High Impact, Moderate Effort

#### F. Contribution Type Taxonomy

**What**: Closed enum for categorizing entities: `method | theory | benchmark | analysis | application | system | concept | person | event`. Assigned during extraction, drives filtering and visualization.

**Why**: OmegaWiki's 9 entity types with domain-specific schemas enable structured reasoning. Our open-ended labels are flexible but provide no semantic structure for the agent.

**How**: Suggest contribution types during extraction (LLM assigns from enum). Store as a property. Enable type-based filtering in graph controls and search.

**Effort**: Medium — schema extension, extraction prompt change, filter UI.

#### G. Three-Channel Paper Discovery

**What**: When a user ingests a paper with an arXiv ID or DOI, offer "Discover related" running references + citations + recommendations via Semantic Scholar API.

**Why**: Three-channel design prevents recency-biased clusters. References surface canonical work, citations surface impact, recommendations surface lateral connections.

**How**: Semantic Scholar API integration (free, 1 req/sec with key). New chat agent tool `discover_related` or a UI button on paper-type nodes. Results shown as suggested nodes in the graph.

**Effort**: Medium — API integration, new tool/UI surface.

#### H. Dashboard View

**What**: A panel showing entity counts by type, graph density gauge, node status kanban, tag cloud, knowledge gaps list, recent activity.

**Why**: OmegaWiki's dashboard provides at-a-glance graph health. Currently Synapse has no aggregate view — you see the graph or individual nodes, nothing in between.

**How**: New React panel in the sidebar. SQL queries for aggregate stats. CSS-only charts (no chart library needed).

**Effort**: Medium — new panel, several SQL queries, layout work.

#### I. Dual-LLM Verification for Extractions

**What**: Optionally send extracted entities to a second model endpoint for independent verification. The second model sees source text + proposed entities but NOT Claude's confidence scores.

**Why**: OmegaWiki's Independence Principle provides strong quality guarantees. When models disagree, users get two perspectives rather than one potentially overconfident assessment.

**How**: Add a second `PlatformLLM` channel in `electron/main.ts`. User configures a secondary endpoint in Settings (OpenAI, Ollama, etc.). During extraction review, entities flagged by the second model get a warning indicator.

**Effort**: Medium-high — second LLM channel, settings UI, review integration.

### Tier 3 — Interesting, Lower Priority

#### J. Bidirectional Link Enforcement

When creating edge A→B, auto-create or surface the option for B→A. Add `symmetric: boolean` flag to edges table.

#### K. Tool Capability Tiers

`search_knowledge` read-only, `merge_nodes` gets `--dry-run` preview mode, `create_node` gets per-extraction caps. Explicit read/propose/write distinction.

#### L. Session-Resumable Pipeline State

For multi-day workflows, save pipeline progress as a note. The agent reads it on next session start. Similar to OmegaWiki's `pipeline-progress.md`.

#### M. Automated Content Feed

Scheduled task checking arXiv/sources against graph interests, suggesting new content. Requires embedding system + scoring formula.

---

## 14. What Synapse Does Better

These are areas where our architecture is stronger and should not be compromised:

1. **Graph rendering scale** — Three.js InstancedMesh with 1-2 draw calls handles 10K+ nodes. Their Cytoscape.js caps around 500 before jank. Our Barnes-Hut O(n log n) layout in a Web Worker vs their O(n²) synchronous main-thread loop.

2. **Visual extraction review** — ExtractionReview with undo/redo, mini graph preview, inline editing, and convert-to-property. They have CLI-only ingestion with no visual diff or user agency.

3. **Semantic search** — sqlite-vec + ONNX/OpenAI embeddings find conceptual similarity. Their token-matching Jaccard finds only lexical overlap. "LLM" and "Large Language Model" are invisible to their dedup; our embeddings catch it.

4. **Platform accessibility** — Desktop app with vault-based workspace vs CLI-only Claude Code. Non-technical users can use Synapse.

5. **Multi-modal ingestion** — PDF, images, arbitrary files via ContentProcessor interface. They handle only LaTeX and PDF-to-LaTeX.

6. **Browser integration** — Companion extension captures rendered DOM. They have no browser-side capture.

7. **Real-time storage** — SQLite with ACID, FTS5, migrations. Their JSONL does full file scans on every query. At 10K edges, their linear scan is measurably slow; our indexed queries are constant-time.

8. **Real-time sync** — BroadcastChannel + IPC for instant cross-component updates vs their 1.5s polling.

---

## 15. Recommended Integration Priority

**First wave** (compound together):
1. **Connectivity-ranked RAG (A)** — minimal change, immediate chat agent quality improvement
2. **Node lifecycle + anti-repetition (B)** — two columns, teaches agent to learn from rejections
3. **Graph maturity metrics (C)** — small function, enables adaptive agent behavior

These three compound: maturity tells the agent where the graph is weak, connectivity ranks what matters most, and lifecycle prevents repeating mistakes.

**Second wave** (build on first):
4. **Pre-creation merge bias (D)** — reduces extraction noise
5. **Knowledge gap tracking (E)** — makes the graph prescriptive
6. **Contribution type taxonomy (F)** — adds structure to open-ended labels

**Third wave** (differentiation features):
7. **Three-channel discovery (G)** — new discovery surface
8. **Dashboard (H)** — aggregate health view
9. **Dual-LLM verification (I)** — quality gate for extractions

---

## Appendix: Key OmegaWiki Files Reference

| File | Purpose |
|---|---|
| `runtime/schema/entities.yaml` | All 9 entity type definitions |
| `runtime/schema/edges.yaml` | 23 edge types with constraints |
| `runtime/schema/xref.yaml` | Bidirectional link rules |
| `runtime/schema/conventions.yaml` | Slug rules, ownership, edge storage |
| `runtime/policy/writers.yaml` | Field/edge write permissions per skill |
| `tools/research_wiki.py` | Core graph engine (add-edge, dedup, BFS, context-brief, maturity) |
| `tools/discover.py` | Three-channel ranking pipeline |
| `tools/daily_arxiv.py` | Wiki profile builder, feed scoring |
| `tools/lint.py` | 10-category structural validator |
| `tools/prepare_paper_source.py` | PDF→TeX normalization |
| `tools/visualize.py` | Obsidian Canvas/config generation |
| `tools/serve.py` | Python HTTP server + SSE watcher |
| `mcp-servers/llm-review/server.py` | Cross-model review MCP (~385 lines) |
| `app/modules/graph.js` | Cytoscape.js graph view + custom layout |
| `app/modules/dashboard.js` | 10-widget dashboard |
| `app/modules/reader.js` | Three-pane entity reader |
| `.claude/skills/research/SKILL.md` | End-to-end pipeline orchestrator |
| `.claude/skills/ideate/SKILL.md` | 5-phase ideation with dual-model brainstorm |
| `.claude/skills/ingest/SKILL.md` | Paper ingestion workflow |
| `.claude/skills/novelty/SKILL.md` | Multi-source novelty verification |
| `.claude/skills/review/SKILL.md` | Adversarial review with multi-round dialogue |
| `.claude/skills/shared-references/cross-model-review.md` | Independence Principle |
