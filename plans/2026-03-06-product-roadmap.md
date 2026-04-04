# Knowledge Graph Extension — Product Strategy & Roadmap

## Positioning

**For**: Curious readers who browse widely across topics but don't have the discipline to maintain a note-taking system.

**Problem**: Obsidian, Roam, and Logseq require active writing and organizing. 90% of users abandon them. The real competitor isn't another tool — it's doing nothing.

**Solution**: A Chrome extension that extracts and structures knowledge from pages you choose to read, with one click. No writing, no organizing, no context-switching. Your browser remembers what you learn, so you don't have to.

**Core differentiators**:
1. **One-click extraction** — eliminates writing/organizing effort, not the choice of what matters
2. **Local-first** — SQLite in OPFS, zero server, nothing leaves the browser except the LLM API call the user explicitly triggers
3. **Human-in-the-loop** — review before merge keeps quality high and user in control
4. **Visual knowledge graph** — custom Three.js renderer makes connections tangible
5. **Browser-native** — captures knowledge where you already are, no app switching

**The trust contract**: The user controls what gets extracted, what it costs, and what leaves their machine. Privacy and cost transparency aren't features — they're the foundation.

---

## What's Built (as of 2026-03-30)

| Feature | Status | Key Files |
|---------|--------|-----------|
| Three-class node system (Resource/Note/Concept) | Done | types.ts, migrations |
| Tags (junction table, tag store, UI chips) | Done | tag-queries.ts, tag-store.ts, NodeDetailPanel |
| Concept source tracking (concept_sources table) | Done | concept-source-queries.ts |
| Entity resolution (exact/alias/fuzzy) | Done | entity-resolution-queries.ts |
| Source content storage | Done | source-content-queries.ts, migration 003 |
| Extraction review with undo/redo | Done | extraction-review-store.ts |
| Agent page extraction (15-iteration tool loop) | Done | agent-loop.ts, agent-tools.ts |
| Reading list with batch extract | Done | ReadingListPanel.tsx |
| Graph visualization (Three.js InstancedMesh) | Done | renderer/ |
| RAG query pipeline | Done | rag-pipeline.ts, chat |
| Contextual relevance (browse-time suggestions) | Done | useContextualRelevance.ts |
| Graph algorithms (clustering, centrality) | Done | graph-algorithms.ts |
| Markdown folder sync | Done | indexed-file-queries.ts, settings |
| NL query + DSL query | Done | query-engine/, QueryBuilder |

---

## Next Up: Cost & Trust (Phase 0)

**Why first**: Without cost transparency and privacy controls, users won't trust the tool enough to use it regularly. This is the foundation for everything else.

### Feature 0.1: Cost Estimation & Display

Before extraction starts, show the user what it will cost.

- Token estimation: rough heuristic (chars / 4) with model-specific pricing
- UI: show "Estimated cost: ~$0.003 (2.1k tokens)" before extraction
- For agent extraction: show "up to $X" based on max iterations

### Feature 0.2: Usage Tracking & Budget Cap

Track cumulative usage and let users set a monthly budget.

- Service worker logs estimated tokens/cost on every LLM request
- Stored in `chrome.storage.local` under `usageTracker`
- Budget enforcement: disable extraction when budget reached
- Settings UI: monthly budget input, current usage display, reset

### Feature 0.3: Tiered Extraction

Not every page needs a 15-iteration agent loop:

- **Quick Extract** (default): single LLM call, ~2-5s, ~$0.002. Good for articles/blogs.
- **Deep Extract**: full agent loop with tools, ~15-30s, ~$0.02. For complex/structured pages.
- UI: toggle in LLMPanel with cost estimates per mode
- Auto-suggest based on page complexity

### Feature 0.4: Privacy Disclosure

- One-time modal before first extraction: explain what data leaves the browser
- Per-extraction indicator: "Sending to Anthropic" with lock icon
- `chrome.storage.local` flag for accepted disclosure

---

## Phase 1: Query Experience — Make "What do I know about X?" the Hero

**Why next**: This is the daily utility feature — the thing no other tool does. NotebookLM answers within a single notebook. Obsidian requires you to have written notes. Your graph is the only place where months of extracted knowledge is queryable as a connected structure. The RAG pipeline is built; now make it feel like a research assistant who has read everything you've read.

- Polish chat citations: every answer cites specific sources with clickable links
- Show the subgraph of entities involved in each answer (mini graph preview)
- Improve retrieval: graph-hop expansion to pull in connected context, not just FTS hits
- Query history: save past questions and answers for quick re-access
- Make the chat the default landing experience (not the graph)

### Feature 1.5: Pin to Graph (Close the Compounding Loop)

Chat answers are currently ephemeral — the user learns something, then it evaporates. "Pin to Graph" saves a chat answer as a Note node, auto-linked to every entity the answer referenced (IDs already collected via `collectIdsFromToolResult`). One click turns Q&A into permanent, queryable knowledge.

- "Pin" button on chat messages → creates Note node with answer content
- Auto-creates `references` edges to all entity IDs cited in the response
- Pinned answers become searchable via `search_knowledge` in future queries
- The user's research compounds: question → answer → pinned note → richer context for next question

### Feature 1.6: Research Sessions (Named, Queryable Q&A Trails)

Upgrade chat sessions from throwaway conversations to named research threads. A session on "quantum computing" becomes a persistent, searchable trail the user can revisit and extend.

- Name/rename sessions (auto-suggest from first query topic)
- Cross-session search: "What did I research about X?" queries past Q&A, not just extracted knowledge
- Session summary: auto-generate a brief of what was explored, key findings, open questions
- Research sessions surfaced in contextual relevance when browsing related pages

---

## Phase 2: Extraction Speed — Remove Friction from Capture

**Why**: For the "too lazy to take notes" user, each wait is an abandonment point. The Reading List → Extract → Review & Merge loop has 4-5 steps with waits. Make it feel instant.

- Pre-resolve entities during extraction so "Review & Merge" opens immediately
- Quick merge mode: auto-accept high-confidence matches, only surface ambiguous items for review
- Background batch extraction: extract all pending reading list items without user babysitting
- Reduce `proceedToReview` redundant entity resolution (currently runs twice)
- Progress indicators throughout (partially done — spinner on Review & Merge button)

---

## Phase 3: Contextual Relevance — The Engagement Loop

**Why**: This is the feature that makes the extension feel alive and that NotebookLM structurally cannot do — it doesn't live in your browser. No LLM call needed (just FTS matching), cheap to run, and creates the virtuous cycle: browse → see connections → extract more → richer connections next time.

- Polish the existing `useContextualRelevance.ts`
- Better keyword extraction from current page (headings, key phrases, named entities)
- Related concepts with relationship context, not just label matches
- "Extract this page" CTA when matches found
- Configurable: sensitivity threshold, excluded domains

### Feature 3.5: Contextual Synthesis Prompts

Go beyond showing matching labels — synthesize what the user already knows. When browsing a page that matches their graph, show: *"You've read about X from 3 sources. Your graph connects it to Y through Z."* One click to deep-dive via chat.

- Use graph-hop data (already fetched by relevance hook) to build a mini-narrative
- Lightweight LLM call (or template-based for zero cost) to phrase the synthesis
- "Ask about this" CTA pre-fills chat with a contextual question
- Makes the graph feel alive — the browser knows what you know

---

## Phase 4: Discovery & Growth Feedback

**Why**: After accumulating 50+ nodes, the graph should reward the user with insights they couldn't get otherwise. This drives retention for power users.

### Feature 4.1: Cross-Page Pattern Discovery
- Analyze concept co-occurrence across resources
- Surface connections: "You've been exploring X and Y — they connect through Z"

### Feature 4.2: Graph Growth Dashboard
- Stats: total nodes/edges, nodes this week, most connected concepts
- Mini sparkline of growth over time
- "Your graph grew by 12 concepts this week from 4 sources"

### Feature 4.3: LLM-Maintained Concept Summaries (Auto-Compile)

When a Concept node accumulates 3+ source connections, auto-generate a synthesis summary. As new sources are added, the summary updates. This is the "compiled wiki article" — but the user never writes it.

- Trigger: after extraction merges new edges to an existing concept with ≥3 sources
- LLM reads all source excerpts for the concept → generates a 2-3 paragraph summary
- Stored in `properties.summary` on the concept node
- Displayed in Node Detail Panel as readable content (not just a label + edges)
- `search_knowledge` returns summaries in RAG context → dramatically improves Q&A quality
- Cost-gated: only runs if user has budget remaining (ties into Phase 0 budget system)

### Feature 4.4: Graph Linting & Health Checks

"Audit my graph" — an LLM-powered quality pass that uses existing graph algorithms (clustering, centrality from `graph-algorithms.ts`) to surface issues and opportunities.

- Chat command or button triggers audit using existing agent tools
- Detects: orphan nodes, near-duplicate concepts (fuzzy matches entity resolution missed), inconsistent relationships, sparse clusters with potential bridge concepts
- Suggests: merges, new connections, missing data to extract
- Prioritized report: "3 likely duplicates, 5 orphan concepts, 2 clusters that may connect through X"
- User confirms each suggestion → applies as graph mutations via existing `update_node`/`create_edge` tools

---

## Phase 5: Wikilink Notes

**Why later**: Valuable for users who want to add their own thoughts, but the core user is "too lazy to take notes." Ship the query and engagement loop first so users accumulate enough data to make notes worthwhile.

- Note editor with `[[Concept Name]]` syntax
- Wikilink resolution against existing concepts (fuzzy match)
- Unresolved links: dashed underline, click to confirm → creates concept + edge
- Autocomplete dropdown while typing `[[`

---

## Phase 6: Polish & Distribution

### Feature 6.1: Onboarding Flow
- First-run experience with demo extraction
- Progressive disclosure (Quick Extract first, Deep after 5 extractions)

### Feature 6.2: Export & Bidirectional Markdown Sync
- JSON-LD, CSV, or Obsidian-compatible markdown vault
- "Take your data with you" builds trust
- **Bidirectional sync**: graph → `.md` folder, not just import. Auto-generate markdown files for concepts with summaries (Feature 4.3), linked sources, and `[[wikilinks]]` to related concepts. Users get the extension for capture + graph, Obsidian for reading + additional visualization (graph view, slides, etc.)
- Write-back triggers on concept summary generation or manual export

### Feature 6.3: Performance at Scale
- Viewport-based rendering (partially built)
- Lazy-load node details, prune suggestions

---

## Scope Boundaries

- **Not a collaboration tool** — personal, local-first, single-user
- **Not a full editor** — notes connect thoughts, not replace a writing app
- **Not auto-capture** — user explicitly triggers extraction (consent gesture)
- **Not cloud-synced** — local-first is a feature, not a limitation
- **Not a research IDE** — no CLI tools, custom output formats (slides, plots), or finetuning pipelines. Power-user researcher workflows belong in Obsidian/notebook environments; the extension feeds them via markdown sync (Feature 6.2)
