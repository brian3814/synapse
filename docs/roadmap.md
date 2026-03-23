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

## Roadmap

### Phase 1 — Reduce Friction, Surface Existing Value

**Goal:** Make the current feature set stickier and lower the barrier to building a useful graph.

#### 1.1 Auto-accept thresholds for extraction review
- High-confidence extractions (exact entity matches, unambiguous relationships) merge automatically
- Surface only ambiguous merges and new entity types for review
- Three configurable tiers: auto-merge / quick-approve / full-review

#### 1.2 Cross-page entity dossiers
- Entity profile view aggregating all properties and relationships across every page the entity appeared on
- Source attribution: which page contributed which properties
- Timeline of when each piece of information was encountered

#### 1.3 Export
- Obsidian vault export (markdown + `[[wikilinks]]`)
- JSON-LD / RDF for semantic web interoperability
- CSV and Neo4j-compatible formats for power users

---

### Phase 2 — Passive Growth & Querying

**Goal:** Transform the extension from an on-demand tool into a continuously growing knowledge base that users can interrogate.

#### 2.1 Passive background extraction
- Auto-extract entities when dwell time exceeds a configurable threshold (e.g., 30s)
- Queue extracted entities for lightweight batch review
- Daily digest in the side panel: "You browsed 12 pages today — 47 new entities to review"

#### 2.2 Graph querying
- Natural language queries over the local graph ("What do I know about Company X?", "How are these two people connected?")
- Basic queries via graph traversal over SQLite (no LLM needed)
- Complex queries via local GraphRAG over entity store

---

### Phase 3 — Complete the Privacy Story

**Goal:** Make a fully offline, zero-network-request workflow possible for privacy-conscious users.

#### 3.1 Local LLM support
- WebLLM (in-browser) or Ollama (local server) as alternatives to cloud LLM APIs
- Even partial support enables a credible "fully offline" claim
- Graceful degradation: smaller local models for extraction, cloud models for complex queries

---

## Strategic Thesis

The entity resolution engine is the moat. Every roadmap item — passive extraction, querying, dossiers — widens that moat. Competitors that appear similar on the surface (Recall, InfraNodus) cannot do cross-page entity merging because they lack the architecture for it. The priority is to make that advantage visible and valuable to users as quickly as possible.
