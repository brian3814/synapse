# Karpathy's LLM Wiki — Detailed Analysis & Synapse Implications

**Source**: [gist.github.com/karpathy/442a6bf555914893e9891c11519de94f](https://gist.github.com/karpathy/442a6bf555914893e9891c11519de94f)
**Published**: 2026-04-04 | **Stars**: 2,100+ in <12 hours | **X Views**: 12M+
**Analysis date**: 2026-05-24

---

## 1. Core Concept

Karpathy proposes replacing stateless RAG (re-derive knowledge per query) with a **persistent, compounding wiki** maintained by an LLM. The key quote:

> "The wiki is a persistent, compounding artifact. The cross-references are already there. The contradictions have already been flagged. The synthesis already reflects everything you've read."

The analogy: **Obsidian is the IDE; the LLM is the programmer; the wiki is the codebase.**

The human curates sources and asks questions. The LLM does summarizing, cross-referencing, filing, and bookkeeping. The wiki grows richer with every source added and every question asked.

### Why RAG Falls Short

RAG = "cooking a meal from scratch every time." It re-discovers knowledge on every query. There's no accumulation. Ask a subtle question requiring synthesis of five documents, and the LLM has to find and piece together fragments every time. Nothing is built up.

### Why This Works

> "The tedious part of maintaining a knowledge base is not the reading or the thinking — it's the bookkeeping."

Humans abandon wikis because maintenance burden grows faster than value. LLMs don't get bored, don't forget to update a cross-reference, and can touch 15 files in one pass.

---

## 2. Three-Layer Architecture


| Layer           | Role                                                                             | Mutability                                     |
| --------------- | -------------------------------------------------------------------------------- | ---------------------------------------------- |
| **Raw sources** | Curated source documents (articles, papers, images, data)                        | Immutable — LLM reads, never modifies          |
| **The wiki**    | LLM-generated markdown (summaries, entity pages, concept pages, comparisons)     | LLM-owned — creates, updates, cross-references |
| **The schema**  | Configuration (CLAUDE.md / AGENTS.md) defining structure, conventions, workflows | Co-evolved by human + LLM                      |


---

## 3. Three Core Operations

### Ingest

- Drop a new source into raw collection, tell LLM to process it
- LLM reads source, discusses key takeaways, writes summary page, updates index, updates relevant entity/concept pages, appends to log
- A single source might touch **10-15 wiki pages**
- Can be done one-at-a-time (supervised) or batch (less supervision)

### Query

- Ask questions against the wiki
- LLM searches relevant pages, reads them, synthesizes answer with citations
- Output forms: markdown page, comparison table, slide deck (Marp), chart (matplotlib), canvas
- **Critical insight**: "Good answers can be filed back into the wiki as new pages." This is the compounding loop — explorations add up instead of disappearing into chat history

### Lint

- Periodic health-check of the wiki
- Detects: contradictions between pages, stale claims superseded by newer sources, orphan pages (no inbound links), important concepts mentioned but lacking their own page, missing cross-references, data gaps fillable with web search
- LLM suggests new questions to investigate and new sources to look for

---

## 4. Navigation & Indexing

### index.md (content-oriented)

- Catalog of everything in the wiki
- Each page listed with link, one-line summary, optional metadata (date, source count)
- Organized by category (entities, concepts, sources)
- LLM reads index first when answering queries, then drills into relevant pages
- Works well at moderate scale (~100 sources, ~hundreds of pages)

### log.md (chronological)

- Append-only record of what happened and when — ingests, queries, lint passes
- Parseable with simple unix tools: `grep "^## \[" log.md | tail -5`
- Gives timeline of wiki evolution, helps LLM understand recent activity

---

## 5. Key Community Feedback & Insights

### 5.1 High-Value Technical Feedback

**@laphilosophia — Truth Maintenance is the Hard Problem**

> "The robust version of this pattern is not 'autonomous wiki' but 'source-grounded, citation-first, review-gated wiki.'"

Recommended constraints:

- Separate facts, inferences, and open questions explicitly
- Require source links for important claims (passage-level where possible)
- Make ingest idempotent (same source doesn't slowly distort the wiki)
- LLM proposes diffs instead of silently overwriting pages
- Run lint for stale claims, unsupported claims, contradiction tracking, and source loss

**@bluewater8008 — Production Lessons (6 Rules)**

1. **Classify before you extract** — classify by type first (report vs. letter vs. transcript), then run type-specific extraction. Saves tokens, produces better results.
2. **Give the index a token budget** — L0 (~~200 tokens, project context, every session), L1 (~~1-2K, index, session start), L2 (~2-5K, search results), L3 (5-20K, full articles).
3. **One template per entity type, not one generic template** — person page ≠ event page ≠ document summary. Seven types is the sweet spot.
4. **Every task produces two outputs** — output one is the deliverable; output two is updates to relevant wiki articles. Without this rule, knowledge evaporates into chat history.
5. **Design for cross-domain from day one** — add domain tags to frontmatter. Shared entities become the most valuable graph nodes. Retrofitting is painful.
6. **The human owns verification** — build source citation into schema rules, budget time to spot-check the wiki.

**@mpazik (Binder) — Files Eventually Become a Database**

> "Instead of files that slowly become a database, start from structured data that renders as markdown."

Key insight: once past a few hundred pages, you need queries ("What did I add last week about X?"), and you can't do that by reading files. The index helps early but doesn't scale. **Data goes into a transaction log, gets indexed in SQLite, and every entity shows up as a markdown file you can edit.** Edits go back in. Agent writes through an API. Both directions.

**@skpalan — Is This Just Structured Context?**

> "Isn't this just re-emphasizing the need of giving an LLM persistent, structured context? A well-organized AGENTS.md hierarchy + skills system already serves this purpose pretty well."

But acknowledged the lint concept is genuinely valuable — periodically having the LLM audit its own wiki.

**@peas — Voice-First Capture + No Content Invention**

- Voice memos via Telegram → Whisper transcription → LLM classification → wiki update
- **Two wiki layers**: KB (machine-managed reference) and Drafts (writing workspace)
- **No content invention**: LLM is an editor, not a writer — every sentence must trace to something the user actually said. Gaps get `[TODO: ...]` markers, not hallucinated filler. "The LLM is my stenographer, not my ghostwriter."
- **Cross-links are mechanical, not LLM-generated**: title mentions, slug matching, journal co-occurrence. Avoids hallucinated connections.

**@bendetro — The Missing Reflect Step**
Proposes expanding the loop:

```
ingest → compile → reflect → query → lint
```

Where `reflect` = synthesizing not just what changed, but WHY — what decision was made, what alternatives existed, what reasoning held. Filed back as first-class pages.

**@frosk1 — Honest Limitations**

1. Error accumulation & drift — errors compound over time
2. Partial context problem — updates use subset of documents
3. Loss of information — summarization is compression
4. False sense of "source of truth" — wiki is a derived artifact
5. Hallucinated merges — LLMs may smooth over contradictions
6. Operational complexity — ingestion pipelines, merge logic, validation, versioning
7. Cost tradeoff — shifts cost from query time to ingestion time
8. Staleness & maintenance — wiki drifts from reality without continuous reprocessing

**@pssah4 — Zettelkasten vs. LLM Wiki**

> "When an LLM writes my summaries and cross-references, I get a well-organized information store. What I don't get is the understanding that comes from doing that work."

The cognitive work happens in the writing itself. The note is a byproduct; the thinking is the product.

### 5.2 Workflow & Architecture Insights

**@samflipppy — .brain Folder Pattern**

- `.brain/` at project root with: `index.md`, `architecture.md`, `decisions.md`, `changelog.md`, `deployment.md`, `firestore-schema.md`, `pipeline.md`
- Rules: read `.brain` before making changes. Update after making changes. Never commit to git.
- Solves context loss across sessions

**@umbex — Domain-Separated Operating System**

```
operating-system/
  <domain>/
    state.md
    foundations/     (stable source-of-truth)
    data/
      current/       (active temporal inputs)
      archive/       (superseded datasets)
    inbox/           (intake for unprocessed material)
```

Separates intake, routing, consolidation, and summarization. Cron heartbeat monitors inbox folders.

**@xoai (sage-wiki) — Compiler Pipeline**
5 focused passes: diff → summarize → extract concepts → write articles → images. Each incremental. Same mental model as `make`. Built as a Go binary with SQLite foundation.

**@VictorVVedtion (Vibe Sensei) — Trading Implementation**

- JSONL event store + markdown wiki = "surprisingly robust combo"
- Dual compilation mode: Gemini Flash for rich analysis, pure template fallback (zero API dependency)
- ~400 chars is the sweet spot for context injection
- Counterfactual tracking: measure whether advice was heeded + outcome accuracy

---

## 6. Implementations with SQLite / Actual Databases

These are the most relevant for Synapse, as they converge on similar architectural decisions.

### 6.1 Binder (@mpazik) — SQLite Transaction Log

**GitHub**: github.com/mpazik/binder

- **Architecture**: Data goes into a transaction log → indexed in SQLite → every entity renders as a markdown file editable in any editor → edits go back in
- **Key insight**: "Instead of files that slowly become a database, start from structured data that renders as markdown"
- **Why it matters**: Solves the scaling problem — index.md breaks at hundreds of pages. Queries are always current because the index IS a query, not a hand-maintained file
- **Bidirectional**: Agent writes through API, human edits via markdown, both directions sync

### 6.2 LENS (@flyersworder) — SQLite + sqlite-vec

**GitHub**: github.com/flyersworder/lens

- **Architecture**: SQLite + sqlite-vec for hybrid FTS5 + vector search
- **Focus**: Distilling higher-order patterns across papers, not just summarizing individual sources
- **Key features**: Contradiction matrix (which techniques resolve which tradeoffs, inspired by TRIZ), architecture catalog, agentic pattern catalog
- **Entity normalization**: Canonical vocabulary at extraction time using guided extraction — no manual curation or post-hoc clustering needed
- **Operations**: `lens compile`, `lens lint` (6 checks + auto-fix), `lens log`

### 6.3 Freelance (@Jwcjwc12) — SQLite Provenance Engine

**GitHub**: github.com/duct-tape-and-markdown/freelance

- **Architecture**: SQLite, no embeddings. Agent reads files, writes atomic propositions, system tracks provenance + validates freshness
- **Provenance**: Every proposition records which source files produced it + their content hashes (SHA-256) at compilation time. Query checks if files on disk still match. Match = valid, mismatch = stale
- **Query-time compilation**: When you ask a question, system pulls known knowledge, reads provenance sources, identifies delta. Only the gap gets compiled. Each query makes the KB denser from a different angle
- **Git integration**: Switch branches → files change → different propositions light up as valid/stale. Merge → files converge → knowledge converges

### 6.4 ra-h_os (@bradwmorris) — SQLite After Filesystem Pain

**GitHub**: github.com/bradwmorris/ra-h_os

- **Key testimony**: "After using the filesystem approach for 6-12 months I found that a local SQLite database was the best abstraction for agents, especially when you increase the size of the knowledge base and number of agents contributing to it"
- **Core insight**: Filesystem works for small wikis, SQLite wins for agent-scale knowledge bases

### 6.5 Palinode (@Paul-Kyle) — SQLite-vec + Git Provenance

**GitHub**: github.com/Paul-Kyle/palinode

- **Architecture**: Git-versioned markdown as source of truth, 18 MCP tools, hybrid BM25 + vector search via SQLite-vec
- **Deterministic executor**: LLM proposes operations (KEEP, UPDATE, MERGE, SUPERSEDE, ARCHIVE) as JSON → executor validates and applies → `git commit`. Every fact gets provenance for free
- **Stats**: 227 files, 2,230 indexed chunks, 92 tests
- **Key quote**: "The compounding effect is real. Agents that remember prior sessions make fewer mistakes and ask better questions"

### 6.6 browzy (@VihariKanukollu) — FTS5 + BM25

**GitHub**: github.com/VihariKanukollu/browzy.ai

- CLI with FTS5 + BM25 search, incremental compilation, Obsidian-compatible wikilinks
- Multi-provider: Claude, GPT, OpenRouter, Ollama

### 6.7 @jurajskuska — SQLite as Speed Layer

- **Architecture**: MD files are shared language, Obsidian is human dashboard, **SQLite is the speed layer**
- `ctx_search` against indexed SQLite replaces manual file digging
- JSONL indexing of conversation transcripts for deep recall
- Key quote: "Deep recall that would have taken many Read calls and minutes of context loading now takes one query. Speed compounds."

### 6.8 @buremba (Owletto) — PostgreSQL Entity System

**GitHub**: github.com/lobu-ai/owletto

- Uses PostgreSQL instead of filesystem
- Entity types with strict schema + event log
- Agent has SQL access to strongly typed database
- Different from filesystem approach: structured from the start

---

## 7. Top Implementations Ranked (Community Consensus)


| Rank | Project                      | Stars  | Notable Feature                                                 |
| ---- | ---------------------------- | ------ | --------------------------------------------------------------- |
| 1    | SamurAIGPT/llm-wiki-agent    | ~1,965 | Contradiction detection at ingest time                          |
| 2    | AgriciDaniel/claude-obsidian | ~1,480 | Hot cache layer for session context carryover                   |
| 3    | nashsu/llm_wiki              | ~1,473 | Desktop app with Louvain community detection clustering         |
| 4    | ballred/obsidian-claude-pkm  | ~1,352 | Goal cascade PKM (3-year vision → daily tasks)                  |
| 5    | lucasastorian/llmwiki        | ~459   | MCP server for Claude.ai direct vault access                    |
| 6    | Astro-Han/karpathy-llm-wiki  | ~446   | Battle-tested starter kit from 94-article production vault      |
| 7    | Ar9av/obsidian-wiki          | ~411   | Multi-agent symlink deployment; delta-tracking manifest         |
| 8    | lewislulu/llm-wiki-skill     | ~298   | Obsidian audit plugin + browser review w/ severity levels       |
| 9    | skyllwt/OmegaWiki            | ~269   | Typed knowledge graph (9 entity + 9 edge types) for research    |
| 10   | nvk/llm-wiki                 | ~220   | Parallel multi-agent drilling; thesis mode for contested claims |


---

## 8. Seven Production Patterns (Cross-Implementation Consensus)

These patterns appeared independently across multiple implementations:

1. **Compile-once-query-many** — synthesis at ingest time reduces per-query cost/latency
2. **Compounding knowledge** — new sources actively update existing pages and revise summaries
3. **Provenance requirements** — raw sources stay immutable; all claims reference source material
4. **Human readability** — plain markdown + git survives vendor lock-in; opaque vector indices don't
5. **Free maintenance** — LLMs handle cross-reference updates without fatigue
6. **Consistency-checking as feature** — lint-style contradiction detection is "a class of work humans could not do at scale before"
7. **Output shape flexibility** — answers stored as pages that feed back into the knowledge base

---

## 9. What Synapse Can Take Advantage Of

Synapse already implements many components of this pattern. Here's a gap analysis and opportunity map:

### 9.1 What Synapse Already Has (Strong Position)


| LLM Wiki Concept               | Synapse Equivalent                                                     |
| ------------------------------ | ---------------------------------------------------------------------- |
| SQLite persistence             | SQLite with 16 repository sub-interfaces (DataStore)                   |
| Vector search                  | sqlite-vec + ONNX/OpenAI embeddings                                    |
| Entity extraction from sources | LLM extraction (text, agent, file ingestion modes)                     |
| Entity/concept pages           | Graph nodes with types, properties, descriptions                       |
| Cross-references               | Graph edges with typed relationships                                   |
| Review flow                    | Extraction review flow before graph merge                              |
| Graph visualization            | Custom Three.js InstancedMesh renderer                                 |
| Vault-based workspace          | User-chosen directory containing DB, notes, files, embeddings          |
| MCP integration                | Both MCP client and server via ToolRegistry                            |
| Agent memory                   | Memory harness with retrieval pipeline (metadata scoring → RRF fusion) |
| Note storage                   | Markdown files on disk                                                 |
| FTS search                     | FTS5 sanitization with LIKE fallback                                   |


### 9.2 High-Value Opportunities

#### A. Ingest Operation → Enhanced File Ingestion Pipeline

Synapse has file ingestion but the LLM Wiki pattern suggests a richer workflow:

- **Classify-then-extract**: Classify source type first (paper vs. article vs. transcript), then run type-specific extraction templates. Synapse's extraction currently uses a single approach.
- **Multi-page touch**: A single source ingest should update 10-15 existing nodes/edges, not just create new ones. Currently extraction creates new entities; it should also UPDATE existing entity descriptions, ADD new relationships to existing entities, and FLAG contradictions with existing claims.
- **Source provenance**: Track which source files produced each node's claims + content hashes. When sources change, mark derived knowledge as stale. This maps to adding `source_hash` and `ingested_at` fields to the node properties.

#### B. Query Filing → Compound Knowledge Loop

The most powerful insight: **good chat answers should file back into the graph**.

- When the chat agent produces a valuable synthesis, comparison, or analysis → offer to create new graph nodes/edges from it
- Currently chat answers disappear into conversation history. The compound loop is missing.
- Implementation: after agent produces a response, detect if it contains synthesized knowledge worth persisting → prompt user to "Add to graph?" → create nodes/edges from the answer

#### C. Lint Operation → Graph Health Checks

Synapse has no equivalent. High-value addition:

- Detect orphan nodes (no edges)
- Find contradictions between node descriptions
- Identify stale nodes (source changed since extraction)
- Suggest missing relationships between related nodes
- Surface concepts mentioned in descriptions but lacking their own node
- Could run as a scheduled/periodic operation or on-demand via chat

#### D. Progressive Disclosure for Agent Context

The token budget concept from @bluewater8008:

- L0 (~200 tokens): graph overview stats, recent activity — always loaded
- L1 (~1-2K): index of all node types and counts — session start
- L2 (~2-5K): search results from query — on-demand
- L3 (5-20K): full node details with all edges — drill-down

Synapse's memory harness already does metadata scoring → RRF fusion → annotated formatting. This maps to formalizing the retrieval into explicit levels.

#### E. Entity Templates by Type

One template per entity type, not one generic template:

- Person: role, affiliations, relationships, timeline
- Concept: definition, related concepts, supporting evidence
- Event: date, participants, outcomes, consequences
- Source: summary, key claims, reliability assessment
- Organization: purpose, members, activities

Synapse already has node types. This extends them with **type-specific required sections** in the extraction prompts.

#### F. Log/Changelog Operation

Append-only record of graph changes:

- What was added/modified and when
- Which source triggered the change
- Parseable for agent context ("what changed this week?")
- Could be stored as a special note or a new table

#### G. Idempotent Ingest + Diff-Based Updates

Instead of the LLM silently overwriting node descriptions:

- LLM proposes diffs (KEEP, UPDATE, MERGE, SUPERSEDE, ARCHIVE)
- User reviews before applying
- Synapse's extraction review flow is already close to this — extend it to handle UPDATES to existing entities, not just new entity creation

### 9.3 Competitive Advantages Synapse Already Has Over LLM Wiki Implementations

1. **Real graph database** — most implementations use flat markdown with wikilinks. Synapse has actual typed nodes/edges in SQLite with queryable relationships. This is strictly superior.
2. **Graph visualization** — most implementations rely on Obsidian's graph view. Synapse has a custom Three.js renderer with force layout, community detection, and interactive exploration. This is a major differentiator.
3. **Hybrid search** — Synapse has FTS5 + sqlite-vec. Most implementations have one or the other, or neither (just index.md scanning).
4. **Review flow** — Synapse has a human-in-the-loop review flow before extraction results merge into the graph. Most implementations let the LLM write directly, which is the exact failure mode @laphilosophia warned about.
5. **MCP server** — Synapse exposes the graph as MCP tools. This means any LLM agent (Claude Code, Codex, etc.) can read/write the knowledge base, matching the pattern @GeminiLight described as "the real unlock" (multi-agent writing to the same wiki).
6. **Vault isolation** — Synapse vaults are self-contained directories. Multi-vault support maps directly to the cross-domain pattern (@bluewater8008's rule 5).

### 9.4 Specific Implementation Priorities (Ranked by Value / Effort)


| Priority | Feature                                 | Value     | Effort | Rationale                                                                                                                       |
| -------- | --------------------------------------- | --------- | ------ | ------------------------------------------------------------------------------------------------------------------------------- |
| **1**    | Query file-back (chat → graph)          | Very High | Medium | The compounding loop is the single most powerful insight. Without it, chat answers evaporate.                                   |
| **2**    | Graph lint operation                    | High      | Medium | Orphan detection, contradiction flagging, missing link suggestions. No implementation has this well-integrated into a graph DB. |
| **3**    | Source provenance tracking              | High      | Medium | SHA-256 hashes on source files, stale-marking when sources change. Directly maps to node properties.                            |
| **4**    | Multi-entity update on ingest           | High      | Medium | Single source touching 10-15 existing nodes. Requires extraction prompts that know about existing entities.                     |
| **5**    | Classify-then-extract pipeline          | Medium    | Low    | Type-specific extraction templates. Synapse already has node types — extend extraction prompts.                                 |
| **6**    | Graph changelog                         | Medium    | Low    | Append-only change log. Could be a new SQLite table or special note.                                                            |
| **7**    | Progressive disclosure for chat context | Medium    | Medium | Formalize memory retrieval into explicit token budget levels.                                                                   |


---

## 10. Workflow Designs Worth Studying

### 10.1 @xoai's Compiler Pipeline (sage-wiki)

```
diff → summarize → extract concepts → write articles → handle images
```

Each pass is incremental. Same mental model as `make`. One new paper touches ~10-15 wiki pages but skips everything else. SQLite foundation.

### 10.2 @bluewater8008's Token Budget Levels

```
L0 (~200 tokens)  — project context — every session
L1 (~1-2K tokens) — the index — session start
L2 (~2-5K tokens) — search results — on demand
L3 (5-20K tokens) — full articles — drill down
```

### 10.3 @Jwcjwc12's Provenance Pipeline (Freelance)

```
Source files → SHA-256 hashing → Proposition extraction → SQLite storage
Query → Pull known knowledge → Read provenance sources → Identify delta → Compile gap only
```

Compilation happens at query time, not just at ingest. Each query makes the KB denser from a different angle.

### 10.4 @Paul-Kyle's Deterministic Executor (Palinode)

```
LLM proposes operations as JSON:
  KEEP — fact still valid
  UPDATE — fact needs revision
  MERGE — two nodes represent same entity
  SUPERSEDE — new fact replaces old
  ARCHIVE — fact no longer relevant
→ Executor validates and applies → git commit
```

Every fact gets provenance for free. 18 MCP tools, hybrid BM25 + vector via SQLite-vec.

### 10.5 @H179922's Cognition Graph (thinking-mcp)

```
Entity types: decision rule, framework, tension, preference, idea (last resort)
Edge types: supports, contradicts, evolved_into, depends_on
Decay model: values hold, ideas fade fast
8,000+ nodes, 16 MCP tools
```

Not just what you know — but HOW you think. The graph models what's live in your thinking right now.

### 10.6 @dkushnikov's Personalization Layer (Obsidian Seed + Mnemon)

```
Source → reader-context → template → extract
```

Same article, different reader → different summary, different key ideas, different domain tags. Seven source-type-specific templates (article, video, podcast, book, paper, idea, conversation).

---

## 11. Summary of Key Quotes

> "After using the filesystem approach for 6-12 months I found that a local SQLite database was the best abstraction for agents." — @bradwmorris

> "Instead of files that slowly become a database, start from structured data that renders as markdown." — @mpazik

> "The compounding effect is real. Agents that remember prior sessions make fewer mistakes and ask better questions." — @Paul-Kyle

> "Every task produces two outputs. Output one is the deliverable. Output two is updates to the relevant wiki articles." — @bluewater8008

> "Ontology is the hardest part. Concept deduplication — is 'attention mechanism' the same node as 'self-attention'? — is where the LLM struggles most." — @xoai

> "The robust version of this pattern is not 'autonomous wiki' but 'source-grounded, citation-first, review-gated wiki.'" — @laphilosophia

> "A curated wiki feels authoritative, but it is still a derived artifact. Treating it as ground truth is risky." — @frosk1

> "When an LLM writes my summaries and cross-references, I get a well-organized information store. What I don't get is the understanding that comes from doing that work." — @pssah4

> "Cross-links are mechanical, not LLM-generated. Title mentions, slug matching, journal co-occurrence. This avoids hallucinated connections." — @peas

> "Deep recall that would have taken many Read calls and minutes of context loading now takes one query. Speed compounds." — @jurajskuska

