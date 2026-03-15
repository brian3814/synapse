# Knowledge Graph Extension — Product Direction & Roadmap

## Context

This Chrome extension is a local-first knowledge graph with SQLite persistence, graph visualization, and LLM-powered entity extraction. It's feature-rich (agentic extraction, NL query, CRUD, 2D/3D viz) but needs strategic focus to become a tool people use daily.

**Target user**: Curious learners / autodidacts who browse widely and want to remember and connect what they read.

**Core positioning**: A personal knowledge graph that lives in your browser — extracts knowledge from what you read, lets you write your own notes, query everything you've learned, and surfaces connections as you browse. A structured thinking tool powered by graph intelligence.

**Key differentiator vs Obsidian/Heptabase**: Those require intentional note-taking. This tool reads for you and makes your accumulated knowledge queryable and interconnected. The Chrome extension form factor means zero context-switching — knowledge capture happens where you already are.

---

## Value Hierarchy (user-ranked)

1. **Queryable memory** — "What do I know about X?" across everything ever read
2. **Instant understanding** — Real-time extraction turns articles into structured knowledge
3. **Surprising connections** — Cross-source relationship discovery
4. **Effortless capture** — Knowledge graph grows with minimal effort

## Design Decisions

- **Human-in-the-loop merging** — Review before entities merge into graph (keeps signal high)
- **Graph-first, not RAG-first** — The graph structure IS the product, not just a retrieval index
- **No vector embeddings needed initially** — FTS + graph traversal provides structured retrieval that's better than flat semantic search for this use case

---

## Phased Roadmap

### Phase 1: Foundation — Source Content Storage & Entity Resolution
**Why first**: Everything else depends on clean, linked data with retrievable source material.

**Features:**
- **Source content table** — Store cleaned page text/markdown alongside extracted entities. Currently raw content is discarded after extraction. Needed for smart query context.
- **Entity resolution / deduplication** — When "Elon Musk" is extracted from two different articles, merge into one node. Fuzzy label matching + alias table (already exists: `entity_aliases`). LLM-assisted disambiguation for ambiguous cases.
- **Improved extraction review** — Streamline the diff review UX. Show which entities already exist, which are new, which would merge. Keyboard shortcuts for approve/reject.

**Key files to modify:**
- `src/db/worker/migrations/` — New migration for source_content table
- `src/db/worker/sqlite-engine.ts` — New queries for source content CRUD
- `src/db/client/db-client.ts` — Client methods for source content
- `src/graph/store/` — Store updates for entity resolution logic
- `src/ui/` — Extraction review UX improvements

---

### Phase 2: Markdown Folder Integration
**Why second**: More knowledge sources early = more value from query and intelligence later. Also serves as fallback for sites that block AI extraction.

**Features:**
- **Folder picker** — User selects a local folder via File System Access API (`showDirectoryPicker()`). Persist access with `navigator.storage.getDirectory()` or re-prompt.
- **Markdown indexing** — Read .md files, extract entities (LLM or lightweight parsing), store with source path as `source_url`.
- **Change detection** — On extension open, check for new/modified files. Index incrementally.
- **In-extension markdown editor** — User can write/edit markdown notes directly in the side panel or tab. Each note creates a `Note` type node in the graph that can be connected to resource nodes (extracted pages), other notes, or any entity. Supports linking to existing nodes via `[[node label]]` syntax or similar.
- **Markdown file sync** — Notes are also persisted as .md files in the local folder, enabling editing in external editors (VS Code, Obsidian) and syncing back.

**Technical notes:**
- File System Access API works in Chrome extensions (side panel / tab context)
- Need to handle permission re-grants across browser restarts
- Consider watching for changes vs checking on open (watching is complex in extensions)

**Key files to modify:**
- New: `src/filesystem/` — File System Access API wrapper, markdown parser
- `src/ui/` — Settings panel for folder selection, file browser, markdown editor
- `src/db/worker/migrations/` — Track indexed files + last-modified timestamps

---

### Phase 3: Smart Query — Graph-Aware Question Answering
**Why third**: Daily utility feature. "What did I read about X?" is the most frequent user need. Requires source content (Phase 1) and benefits from more data (Phase 2).

**Features:**
- **RAG over knowledge graph** — Query pipeline:
  1. User asks natural language question
  2. Extract search terms + intent (lightweight LLM call or keyword extraction)
  3. FTS query finds relevant nodes
  4. Graph traversal expands to connected subgraph (1-2 hops)
  5. Retrieve stored source content for matching nodes
  6. Feed structured context (entities + relationships + source excerpts) to LLM
  7. Return synthesized answer with inline `[Source: url]` citations
- **Answer UI** — Rendered markdown answer with clickable source links. Expandable "context used" section showing which nodes/edges informed the answer.
- **Keep existing DSL query** — As "advanced mode" for power users
- **Query history** — Save past queries and answers for quick re-access

**Key files to modify:**
- `src/ui/components/` — New "Ask" query mode UI
- `src/offscreen/` — RAG pipeline execution (long-running LLM calls)
- `src/db/worker/sqlite-engine.ts` — Retrieval queries (FTS + graph traversal)
- `src/shared/messages.ts` — New message types for RAG queries

---

### Phase 4: Contextual Relevance — Browse-Time Suggestions
**Why fourth**: The "Chrome extension killer feature." Passive, zero-effort, creates the engagement loop. Needs rich graph data to be valuable (Phases 1-3).

**Features:**
- **Page analysis** — Content script extracts key terms from current page (title, headings, key phrases — lightweight, no LLM needed)
- **Graph matching** — Match extracted terms against node labels/properties via FTS
- **Side panel widget** — "Related in your graph" section showing matching nodes with relationship context. Clicking navigates to the node in the graph.
- **Engagement loop** — Browse → see connections → extract more → richer connections next time
- **Configurable** — Toggle on/off, sensitivity threshold, excluded domains

**Key files to modify:**
- `src/content-script/` — Lightweight keyword/entity extraction
- `src/service-worker/` — Route page analysis results to side panel
- `src/ui/` — "Related" widget component
- `src/db/worker/sqlite-engine.ts` — Fast term matching queries

---

### Phase 5: Graph Intelligence — Patterns, Suggestions, Discovery
**Why last**: Hardest to build, needs the most data to be meaningful. Builds on all prior phases.

**Features:**
- **Connection suggestions** — "Node A and B share 3 neighbors but aren't connected — should they be?" Based on structural patterns (common neighbors, shared types, co-occurrence in sources).
- **Cluster detection** — Automatic topic clustering via graph community detection algorithms. Show "Your knowledge clusters: [AI Safety (23 nodes), Browser APIs (15 nodes), ...]"
- **Gap analysis** — "These two clusters are disconnected — explore the bridge?" Identify structural holes in the knowledge graph.
- **Pattern discovery** — "You've been reading a lot about X recently" / "These 5 entities from different sources all connect through Y"

**Technical approach:**
- Graph algorithms (community detection, centrality, common neighbors) can run in the DB worker or UI thread
- LLM-assisted for natural language explanations of discovered patterns
- Incremental computation — recompute on graph changes, not on every view

---

## Scope Boundaries

- **Not a collaboration tool** — Personal, local-first, single-user
- **Lightweight note-taking, not a full editor** — Supports markdown notes as graph nodes (type: `Note`), but not aiming to replace Obsidian's full editing experience. Notes are a way to capture thoughts and connect them to extracted knowledge.
- **Not auto-capture** — Human-in-the-loop for quality; no background extraction without user action
- **Not cloud-synced** — Local-first is a feature (privacy), not a limitation to fix later

---

## Verification / Success Criteria

Each phase should be usable independently:
- **Phase 1**: Extract from two articles about the same topic → entities correctly deduplicate → source content retrievable
- **Phase 2**: Point at a folder of .md files → entities extracted and merged into graph → write a note in the editor → it appears as a connected node + syncs to folder
- **Phase 3**: Ask "what do I know about [topic]?" → get synthesized answer citing specific sources → answer is accurate and useful
- **Phase 4**: Browse a related article → side panel shows "Related in your graph" with relevant nodes → clicking navigates to node
- **Phase 5**: After 50+ nodes from diverse sources → see meaningful cluster suggestions and connection recommendations
