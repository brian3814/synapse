# Knowledge Graph Extension — Roadmap

## Competitive Landscape

### Direct Competitors

| Product | Approach | Strengths | Weaknesses |
|---------|----------|-----------|------------|
| **Recall** | Cloud AI summarization + auto-categorized knowledge graph | Polished UX, augmented browsing resurfaces links in real-time, spaced repetition, broad content support (YouTube, PDFs, podcasts) | Cloud-dependent, summary-based (not entity-relationship), no agentic extraction, no local persistence, no merge/review flow |
| **InfraNodus** | NLP + GPT-4 text network analysis via browser extension | Mature product, gap/blind-spot detection, topic modeling via graph theory, works on YouTube/search/articles | SaaS (server-side processing), word co-occurrence graph (not true entity-relationship), no local persistence, no review flow, freemium with quotas |
| **Perplexity Lens** | AI-powered concept extraction from highlighted text | Clean UX, D3.js interactive graph, public sharing of knowledge graphs | Hackathon-stage project, cloud-dependent (Perplexity API), no local storage, no entity resolution |
| **MindCanvas** | Auto-builds knowledge graph from browsing history | Automatic clustering, chat with learning history, D3.js visualization | Early-stage/student project, URL-level only (no deep page extraction), server-side processing, no entity granularity |
| **WorldBrain Memex** | Full-text search, annotations, highlights for browsed pages | Mature and established, local-first with optional cloud sync, large user base, open source | No knowledge graph visualization, no entity extraction, bookmark/annotation focus |

### Adjacent Tools (not browser extensions)

| Tool | Overlap | Key Difference |
|------|---------|----------------|
| **Neo4j LLM KG Builder** | LLM entity extraction into knowledge graph | Server-side application, requires Neo4j infrastructure |
| **Obsidian / Logseq** | Local-first with graph view | Desktop note-taking apps, manual entry, no web extraction |
| **Roam Research** | Knowledge graph from notes | SaaS, manual entry, no automated web extraction |

### Our Differentiators Today

1. **Truly local-first** — wa-sqlite + OPFS, zero cloud dependency for storage
2. **Agentic page extraction** — content script tools that intelligently navigate page structure (tables, structured data, links, metadata)
3. **Entity resolution + review flow** — fuzzy matching, diff view, undo/redo, convert-to-property
4. **Custom Three.js renderer** — InstancedMesh for 10k+ node performance
5. **Chrome Side Panel native** — purpose-built for side panel UX
6. **API key security** — keys never leave the service worker context

---

## What's Shipped

| Feature | Key Files |
|---------|-----------|
| Three-class node system (Resource/Note/Concept) | types.ts, migrations |
| Tags (junction table, tag store, UI chips) | tag-queries.ts, tag-store.ts |
| Concept source tracking (concept_sources table) | concept-source-queries.ts |
| Entity resolution (exact/alias/fuzzy) | entity-resolution-queries.ts |
| Source content storage | source-content-queries.ts |
| Extraction review with undo/redo | extraction-review-store.ts |
| Agent page extraction (15-iteration tool loop) | agent-loop.ts, agent-tools.ts |
| Reading list with batch extract | ReadingListPanel.tsx |
| Graph visualization (Three.js InstancedMesh) | renderer/ |
| Chat agent with RAG query pipeline | rag-pipeline.ts, chat-agent-loop.ts |
| Contextual relevance (browse-time suggestions) | useContextualRelevance.ts |
| Graph algorithms (clustering, centrality) | graph-algorithms.ts |
| Markdown folder sync (import) | indexed-file-queries.ts |
| NL query + DSL query engine | query-engine/, QueryBuilder |

---

## Roadmap

### Phase 0 — Cost & Trust (parallel track, gates Phases 2+)

**Goal:** Without cost transparency and privacy controls, users won't trust the tool enough to use it regularly. Gates any feature that spends tokens without explicit user action.

- **Cost estimation**: show "Estimated cost: ~$0.003" before extraction, "up to $X" for agent mode
- **Usage tracking & budget cap**: service worker logs tokens/cost, monthly budget with enforcement
- **Tiered extraction**: Quick Extract (single call, ~$0.002) vs Deep Extract (agent loop, ~$0.02), auto-suggest based on page complexity
- **Privacy disclosure**: one-time modal before first extraction, per-extraction "Sending to [provider]" indicator

---

### Phase 1 — Close the Loop

**Goal:** Make Q&A and research compound into the knowledge graph instead of evaporating. The key insight: ingest → query → **file back** → richer queries next time.

#### 1.1 Pin to Graph

Chat answers are ephemeral — the user learns something, then it disappears. "Pin to Graph" saves a chat answer as a Note node, auto-linked to every entity the answer referenced.

- "Pin" button on chat messages → creates Note node with answer content
- Auto-creates `references` edges to all entity IDs cited in the response (already collected via `collectIdsFromToolResult`)
- Pinned answers become searchable via `search_knowledge` in future queries
- The user's research compounds: question → answer → pinned note → richer context next time

#### 1.2 Research Sessions

Upgrade chat sessions from throwaway conversations to named research threads that persist as searchable, revisitable trails.

- Name/rename sessions (auto-suggest from first query topic)
- Cross-session search: "What did I research about X?" queries past Q&A, not just extracted knowledge
- Session summary: auto-generate a brief of what was explored, key findings, open questions
- Research sessions surfaced in contextual relevance when browsing related pages

---

### Phase 2 — Compound Knowledge (requires Phase 0 budget system)

**Goal:** The LLM maintains and improves the knowledge base over time. The user's graph goes from a collection of extracted entities to a curated, readable knowledge base.

#### 2.1 Auto-Compile Concept Summaries

When a Concept node accumulates 3+ source connections, auto-generate a synthesis summary. As new sources are added, the summary updates. This is the "compiled wiki article" — but the user never writes it.

- Trigger: after extraction merges new edges to a concept with ≥3 sources
- LLM reads all source excerpts → generates 2-3 paragraph summary
- Stored in `properties.summary` on the concept node
- Displayed in Node Detail Panel as readable content (not just a label + edges)
- `search_knowledge` returns summaries in RAG context → dramatically improves Q&A quality
- Cost-gated: only runs if user has budget remaining

#### 2.2 Graph Linting & Health Checks

"Audit my graph" — an LLM-powered quality pass that uses existing graph algorithms (clustering, centrality) to surface issues and opportunities.

- Chat command or button triggers audit using existing agent tools
- Detects: orphan nodes, near-duplicate concepts (fuzzy matches entity resolution missed), inconsistent relationships, sparse clusters with potential bridge concepts
- Suggests: merges, new connections, missing data to extract
- Prioritized report: "3 likely duplicates, 5 orphan concepts, 2 clusters that may connect through X"
- User confirms each suggestion → applies via existing `update_node`/`create_edge` tools

---

### Phase 3 — Engagement

**Goal:** The extension feels alive. It rewards the user for accumulating knowledge and drives the virtuous cycle of browsing → extraction → richer connections.

#### 3.1 Contextual Synthesis Prompts

Go beyond showing matching labels when browsing — synthesize what the user already knows. *"You've read about X from 3 sources. Your graph connects it to Y through Z."*

- Use graph-hop data (already fetched by relevance hook) to build a mini-narrative
- Lightweight LLM call or template-based (zero cost) phrasing
- "Ask about this" CTA pre-fills chat with a contextual question
- Makes the graph feel alive — the browser knows what you know

#### 3.2 Growth Dashboard

After accumulating 50+ nodes, reward the user with visible progress.

- Stats: total nodes/edges, nodes this week, most connected concepts
- Mini sparkline of growth over time
- "Your graph grew by 12 concepts this week from 4 sources"
- Cross-page pattern discovery: concept co-occurrence analysis

---

### Phase 4 — Platform & Interop

**Goal:** Open the knowledge base to external tools and make a fully offline workflow possible.

#### 4.1 Export & Bidirectional Markdown Sync

- Obsidian vault export (markdown + `[[wikilinks]]`)
- JSON-LD / RDF for semantic web interoperability
- CSV and Neo4j-compatible formats for power users
- **Bidirectional sync**: graph → `.md` folder (not just import). Auto-generate markdown files for concepts with summaries, linked sources, and wikilinks. Extension for capture + graph, Obsidian for reading + visualization.

#### 4.2 Local LLM Support

- WebLLM (in-browser) or Ollama (local server) as alternatives to cloud APIs
- Enables a credible "fully offline" claim
- Graceful degradation: smaller local models for extraction, cloud for complex queries

---

### Future (opt-in, post-trust)

Features that add value but require strong cost/trust foundations and user opt-in.

- **Passive background extraction** — auto-extract when dwell time exceeds threshold, queue for batch review, daily digest. Opt-in only; conflicts with "not auto-capture" principle unless user explicitly enables.
- **Auto-accept thresholds** — high-confidence extractions merge automatically, surface only ambiguous items. Human-in-the-loop is a core differentiator; only offer as an opt-in for power users with large graphs.
- **Cross-page entity dossiers** — aggregated profile view per entity across all sources, with attribution and timeline.

---

## Strategic Thesis

The entity resolution engine and human-in-the-loop review are the moat. Competitors (Recall, InfraNodus) cannot do cross-page entity merging because they lack the architecture. But extraction alone isn't enough — the knowledge must **compound**. Pin to Graph closes the loop between querying and accumulating. Auto-compile summaries turn raw entities into readable knowledge. The priority is to make the graph feel like it gets smarter the more you use it.
