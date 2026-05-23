# Knowledge Graph Extension — Product Strategy & Roadmap

## Positioning

**For**: Curious readers who browse widely across topics but don't have the discipline to maintain a note-taking system.

**Problem**: Obsidian, Roam, and Logseq require active writing and organizing. 90% of users abandon them. The real competitor isn't another tool — it's doing nothing. Even RAG systems (NotebookLM, ChatGPT file uploads) rediscover knowledge from scratch on every query — nothing compounds.

**Solution**: A Chrome extension that extracts knowledge from webpages you read and structures it into a visual knowledge graph backed by SQLite. The database is the single source of truth. Portable .md files can be exported to a local folder (Obsidian-compatible) on demand. You curate sources and ask questions. The browser captures, the LLM organizes, and the graph compounds.

**Inspiration**: [Karpathy's LLM Wiki pattern](https://gist.github.com/karpathy/442a6bf555914893e9891c11519de94f) — a persistent, compounding artifact where the LLM does the bookkeeping humans abandon. Our extension adds what that pattern lacks: browser-native capture (no manual file dropping), a visual knowledge graph, entity resolution, and a review-before-merge trust layer.

**Core differentiators**:
1. **One-click extraction** — eliminates writing/organizing effort, not the choice of what matters
2. **Visual knowledge graph** — custom Three.js renderer makes connections tangible. The graph is the structure; exported .md files are the portable prose.
3. **Local-first** — SQLite in OPFS is the single source of truth. Nothing leaves the browser except LLM calls the user triggers.
4. **Human-in-the-loop** — review before merge keeps quality high and user in control
5. **Browser-native** — captures knowledge where you already are, no app switching
6. **Portable export** — one-click export to Obsidian-compatible .md vault. Your knowledge is never locked in.

**The trust contract**: The user controls what gets extracted, what it costs, and what leaves their machine. Privacy and cost transparency aren't features — they're the foundation.

**Three-layer knowledge model** (see `docs/design-three-layer-knowledge-model.md`):
- **Resources** — immutable webpage snapshots stored in `source_content` table. The LLM reads from these but never modifies them.
- **Entities** — typed nodes/edges in SQLite (OPFS). Powers visualization, entity resolution, graph algorithms, and FTS. The ontological skeleton.
- **Notes** — granular prose units attached to entities with data lineage back to resources. User-organizable via S3-style folder hierarchy. The prose surface.

---

## What's Built (as of 2026-04-05)

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
| Markdown folder sync (one-way import) | Done | indexed-file-queries.ts, settings |
| NL query + DSL query | Done | query-engine/, QueryBuilder |
| Cost estimation (pre-extraction) | Done | cost-estimator.ts, PromptInput, TextInput |
| Usage tracking with actual API tokens | Done | usage-tracker.ts, usage-backend.ts, api-key-backend.ts |
| UsageBackend abstraction (API-key + future managed) | Done | usage-backend.ts, api-key-backend.ts, message-router.ts |
| Budget enforcement (monthly $ cap) | Done | message-router.ts, SettingsPanel UsageSection |
| Rate-limit detection + retry with countdown | Done | llm-errors.ts, retry-handler.ts, LLMPanel RateLimitCountdown |
| Tiered extraction (Quick / Deep mode toggle) | Done | quick-extract-prompt.ts, PromptInput, useLLMExtraction |
| Page complexity auto-suggestion | Done | page-extractor.ts analyzePageComplexity, PromptInput |
| Privacy disclosure (first-run modal + indicator) | Done | PrivacyDisclosure.tsx, LLMPanel |
| Display decoupling (tokens always, cost per backend) | Done | ExtractionSummary.tsx, SettingsPanel.tsx |

---

## Infrastructure: Native Messaging Host + Local File Export

**Status:** Architecture decided (see `docs/adr-native-host-local-files.md`).

A Go native messaging host (~5MB binary) provides **Claude Code bridge** — `claude -p --resume <id>` for LLM via Claude subscription. No API key cost. Conversation context preserved across messages.

**Local file export**: `showDirectoryPicker()` grants the extension write access to an export folder. One permission prompt per session. `FileSystemDirectoryHandle` persisted in IndexedDB. Export is one-direction only (DB → .md files), never reads back.

**The host is optional.** Extension works standalone for graph + extraction + query + export. Host adds subscription LLM.

---

## Done: Cost & Trust (Phase 0) ✓

**Completed 2026-04-05.** All features implemented across 6 commits.

- **0.1 Cost Estimation**: Pre-extraction estimates via chars/4 heuristic, per-mode cost display (Quick vs Deep)
- **0.2 Usage Tracking & Limits**: `UsageBackend` interface with `ApiKeyBackend` implementation. Actual tokens from API metadata. Monthly budget enforcement. Rate-limit detection (429/529) with retry handler + countdown UI. Display decoupled: tokens always shown, cost only for API-key backend.
- **0.3 Tiered Extraction**: Quick Extract (single LLM call, ~$0.002) vs Deep Extract (agent loop, ~$0.02). Page complexity auto-suggestion based on word count, tables, and structured data.
- **0.4 Privacy Disclosure**: First-run modal, per-extraction "Sending to Anthropic" indicator, acceptance persisted in storage.

---

## Next Up: Query Experience (Phase 1) — Make "What do I know about X?" the Hero

**Why next**: This is the daily utility feature — the thing no other tool does. NotebookLM answers within a single notebook. Obsidian requires you to have written notes. Your graph is the only place where months of extracted knowledge is queryable as a connected structure. The RAG pipeline is built; now make it feel like a research assistant who has read everything you've read.

- Polish chat citations: every answer cites specific sources with clickable links
- Show the subgraph of entities involved in each answer (mini graph preview)
- Improve retrieval: graph-hop expansion to pull in connected context, not just FTS hits
- Query history: save past questions and answers for quick re-access
- Make the chat the default landing experience (not the graph)

### Feature 1.5: Pin to Graph (Close the Compounding Loop)

Chat answers are currently ephemeral — the user learns something, then it evaporates. Karpathy's key insight: **good answers should be filed back as persistent knowledge.** This way explorations compound just like ingested sources.

- "Pin" button on chat messages → creates a Note node in the graph with answer content
- Auto-creates graph edges linking the note to all entities the answer referenced
- Pinned notes become searchable in future queries via `search_knowledge`
- The compounding loop: question → answer → pinned note → richer context for next question
- If export folder connected, note is auto-exported as .md file

### Feature 1.6: Research Sessions (Named, Queryable Q&A Trails)

Upgrade chat sessions from throwaway conversations to named research threads. A session on "quantum computing" becomes a persistent, searchable trail the user can revisit and extend.

- Name/rename sessions (auto-suggest from first query topic)
- Cross-session search: "What did I research about X?" queries past Q&A, not just extracted knowledge
- Session summary: auto-generate a brief of what was explored, key findings, open questions
- Research sessions surfaced in contextual relevance when browsing related pages

---

## Phase 2: The Note Layer — Prose Knowledge + Export

**Why now**: This is the central insight from Karpathy's LLM Wiki pattern. Currently, extraction produces graph nodes (structured) but no prose (readable). The note layer makes knowledge human-readable and exportable. Every extraction can produce two outputs: graph updates AND note content.

**See**: `docs/design-three-layer-knowledge-model.md` for the full three-layer model.

### Feature 2.1: Note Generation on Extraction

Notes toggle (off by default): when enabled, extraction produces both entities and prose notes.

- **Quick Extract with notes**: Single LLM call produces entities + focused prose units (3-10 sentences) with `about`/`mention` bindings
- **Deep Extract notes**: Second pass after entity merge, with full graph context for higher-quality prose
- Notes stored as `type = 'note'` nodes in DB with content in `source_content`
- Wikilink parser runs on note content → creates graph edges (note → entity, note → note)
- Notes are searchable via FTS5

### Feature 2.2: Export Folder + .md Rendering

One-click export to an Obsidian-compatible .md vault:

- Setup: `showDirectoryPicker()` grants write access → handle saved to IDB
- Per-session reconnect: one "Reconnect export folder" button, one prompt
- **Export renderer**: stateless DB → .md generation, writes Karpathy-style folder hierarchy:
  - `resources/<slug>.md` — source digest (write-once per resource)
  - `entities/<type>/<slug>.md` — entity index with notes list, sources, optional LLM summary
  - `notes/<folder_path>/<slug>.md` — note content with frontmatter (about, mentions, extracted_from)
  - `index.md` — auto-generated catalog
  - `log.md` — append-only history
- Incremental export: only re-renders nodes touched by extraction
- Manual "Re-export all" button for full regeneration

### Feature 2.3: Note Folder Hierarchy

S3-style user-controlled organization for notes:

- `folder_path` column on note nodes (flat keys, `/` delimiter)
- Simple folder browser in side panel: create, rename, delete folders; drag notes to organize
- Globally unique note names (no collisions across folders)
- Extraction-created notes default to root; user organizes later
- Zero-byte markers (`note_folders` table) for empty user-created folders

### Feature 2.4: Wikilink Resolution (In-Extension)

- `[[Entity Name]]` syntax in all note content and exported .md files
- Wikilink parser creates graph edges from note content (exact + alias match, no fuzzy)
- In the built-in editor: autocomplete dropdown while typing `[[`, clickable links
- Unresolved wikilinks: pending queue with fuzzy suggestions for user confirmation

---

## Phase 3: Extraction Speed — Remove Friction from Capture

**Why**: For the "too lazy to take notes" user, each wait is an abandonment point. The Reading List → Extract → Review & Merge → Wiki Update loop must feel fast.

- Pre-resolve entities during extraction so "Review & Merge" opens immediately
- Quick merge mode: auto-accept high-confidence matches, only surface ambiguous items for review
- Background batch extraction: extract all pending reading list items without user babysitting
- Reduce `proceedToReview` redundant entity resolution (currently runs twice)
- Wiki page generation runs in background after merge completes (non-blocking)
- Progress indicators throughout (partially done — spinner on Review & Merge button)

---

## Phase 4: Contextual Relevance — The Engagement Loop

**Why**: This is the feature that makes the extension feel alive and that NotebookLM structurally cannot do — it doesn't live in your browser. Cheap to run (FTS matching, no LLM), and creates the virtuous cycle: browse → see connections → extract more → richer wiki next time.

- Polish the existing `useContextualRelevance.ts`
- Better keyword extraction from current page (headings, key phrases, named entities)
- Related concepts with relationship context, not just label matches
- Surface relevant note content alongside graph matches — show the prose, not just labels
- "Extract this page" CTA when matches found
- Configurable: sensitivity threshold, excluded domains

### Feature 4.5: Contextual Synthesis Prompts

Go beyond showing matching labels — synthesize what the user already knows. When browsing a page that matches their graph, show: *"You've read about X from 3 sources. Your graph connects it to Y through Z."* One click to deep-dive via chat.

- Use graph-hop data (already fetched by relevance hook) to build a mini-narrative
- Pull from entity summaries (cached in DB) instead of re-synthesizing
- "Ask about this" CTA pre-fills chat with a contextual question
- Makes the graph feel alive — the browser knows what you know

---

## Phase 5: Discovery & Graph Health

**Why**: After accumulating 50+ nodes, the system should reward the user with insights and keep the graph healthy. Karpathy's "lint" operation as a first-class feature.

### Feature 5.1: Cross-Page Pattern Discovery
- Analyze concept co-occurrence across resources
- Surface connections: "You've been exploring X and Y — they connect through Z"

### Feature 5.2: Graph Growth Dashboard
- Stats: total nodes/edges/notes, nodes this week, most connected concepts
- Mini sparkline of growth over time
- "Your graph grew by 3 notes and 12 concepts this week from 4 sources"

### Feature 5.3: Graph Lint & Health Checks

"Audit my graph" — an LLM-powered quality pass. Karpathy's lint operation adapted for the three-layer graph.

- Chat command or button triggers audit using existing agent tools
- Detects:
  - Orphan graph nodes with no inbound edges
  - Near-duplicate concepts (fuzzy matches entity resolution missed)
  - Notes with unresolved `[[wikilinks]]`
  - Important concepts mentioned but lacking their own entity node
  - Knowledge gaps: "You have 5 sources on X but nothing on closely-related Y"
- Suggests: merges, new connections, new sources to look for
- User confirms each suggestion → applies as graph mutations

---

## Phase 6: Claude Code Integration

**Why**: Users with Claude subscriptions shouldn't pay API costs. The native host provides the Claude Code bridge.

### Feature 6.1: Claude Code as LLM Backend
- Extension settings: "Claude API" (API key) vs "Claude Code" (subscription)
- Claude Code path: queries routed through native host → `claude -p --resume`
- Session persistence via `--resume` — conversation context preserved
- Fallback: if host unavailable or Claude Code not installed, fall back to API key path

### Feature 6.2: Claude Code Rate-Limit Signals
- Host forwards subscription-specific rate-limit signals (messages/hour, cooldown duration) from Claude Code CLI
- Extension maps these into the `UsageBackend` interface built in Phase 0.2 — reuses existing retry countdown UI and extraction queuing
- Auto-fallback to API key if user has one configured and consents

---

## Phase 7: Polish & Distribution

### Feature 7.1: Onboarding Flow
- First-run experience with demo extraction
- Progressive disclosure (Quick Extract first, Deep after 5 extractions)
- If native host detected: offer notes folder setup. If not: standalone mode, prompt later.

### Feature 7.2: Export & Interop
- JSON-LD, CSV export for graph data
- The export folder IS the Obsidian-compatible vault — users open it in Obsidian for graph view, Dataview queries
- "Take your data with you" — graph exports + exported .md vault = full portability

### Feature 7.3: Performance at Scale
- Viewport-based rendering (partially built)
- Lazy-load node details, prune suggestions
- Wiki search: at small scale index.md suffices, at larger scale add local search (qmd or similar)

---

## Scope Boundaries

- **Not a collaboration tool** — personal, local-first, single-user
- **Not a full editor** — the built-in editor handles basic note editing; the extension is the primary editing surface
- **Not auto-capture** — user explicitly triggers extraction (consent gesture)
- **Not cloud-synced** — local-first is a feature, not a limitation. Export folder can be git-tracked; users sync however they want.
- **Not bidirectional sync** — .md export is one-direction (DB → files). Editing exported .md files externally does not sync back. This is a deliberate scope reduction. Bidirectional sync may be added later if demand emerges.
- **Webpages only** — resources are URLs captured by the content script. No PDF ingestion, no image ingestion. Browser-native focus.
