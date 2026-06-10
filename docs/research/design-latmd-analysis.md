# Product Research: lat.md (Agent Lattice)

> **Repository**: [1st1/lat.md](https://github.com/1st1/lat.md)
> **Tagline**: "A knowledge graph for your codebase, written in markdown."
> **Stack**: TypeScript, Node.js 22+, pnpm, unified/remark, tree-sitter, sqlite-vec

## What It Is

lat.md is a CLI tool that organizes project knowledge as interconnected markdown files stored in a `lat.md/` directory at the project root. Instead of a monolithic CLAUDE.md or README, domain knowledge is distributed across a graph of markdown files linked by `[[wiki-link]]` syntax. Agents discover relevant documentation through semantic search and reference resolution rather than grepping the entire codebase.

The key pitch: as a codebase grows, a single flat documentation file becomes impractical. lat.md solves this by breaking documentation into a navigable, validated knowledge graph that both humans and AI agents can traverse.

## Core Architecture

### The Lattice Structure

```
project/
├── lat.md/               # Knowledge graph directory
│   ├── lat.md            # Root index (mandatory)
│   ├── cli.md            # Domain: CLI commands
│   ├── parser.md         # Domain: parser internals
│   ├── dev-process.md    # Domain: workflows
│   └── tests/
│       ├── tests.md      # Subdirectory index (mandatory)
│       └── check-md.md   # Test specifications
├── src/
│   └── parser.ts         # Source with @lat: annotations
└── .claude/              # Agent integration hooks
```

Every directory under `lat.md/` must have an index file matching its name (e.g., `tests/tests.md`) that lists all immediate children as wiki-link entries. This enforces structural completeness — `lat check` catches orphaned or missing index entries.

### Three Types of Links

| Direction | Syntax | Example |
|-----------|--------|---------|
| **MD → MD** | `[[file#Section#Subsection]]` | `[[parser#Reference Resolution]]` |
| **MD → Code** | `[[path/to/file.ts#symbol]]` | `[[src/auth.ts#validateToken]]` |
| **Code → MD** | `// @lat: [[section-id]]` | `// @lat: [[parser#Wiki Links]]` |

Short references work when filenames are unique within `lat.md/`. Source code references always require full paths. Ambiguous or broken links are treated as errors during validation.

### Section Structure Rules

Every section must have a **leading paragraph** (≤250 characters, excluding wiki-link markup) immediately after its heading, before any child sections. This paragraph powers search snippets, CLI output, and RAG context injection. Sections without a leading paragraph or with one exceeding 250 chars are flagged by `lat check`.

## How It Maintains MD-to-Code Sync

**This is the central question — and lat.md's answer is fundamentally different from a runtime file watcher.** lat.md does not do real-time syncing. Instead, it uses a **validation-and-enforcement** model across three layers:

### Layer 1: Static Validation (`lat check`)

`lat check` performs four independent validation passes:

1. **`check md`** — Resolves every `[[wiki-link]]` in markdown files. Uses tiered matching: exact ID → file stem → subsection name → path subsequence → fuzzy (Levenshtein). Broken or ambiguous links are errors.

2. **`check code-refs`** — Scans source files for `// @lat:` or `# @lat:` annotations using ripgrep (with TypeScript fallback). Validates each annotation's target resolves to an existing lattice section. Uses tree-sitter for multi-language symbol extraction (TS/JS, Python, Rust, Go, C).

3. **`check sections`** — Enforces the leading-paragraph rule (≤250 chars) on every section.

4. **`check index`** — Validates that every directory has a properly structured index file listing all children.

Additionally, sections with `require-code-mention: true` frontmatter enforce that every leaf section has a corresponding `@lat:` reference somewhere in source code — enabling test specification enforcement.

### Layer 2: Git Hook Enforcement (Agent Integration)

lat.md installs hooks into agent workflows (Claude Code, Cursor, Copilot, etc.) at two lifecycle events:

**UserPromptSubmit** — Before an agent processes a user prompt:
- Expands any `[[refs]]` in the prompt via `expandPrompt()`
- Runs `lat search` to find relevant documentation sections
- Injects full section content as context
- Reminds the agent: "lat.md/ must stay in sync with the codebase"

**Stop** — Before an agent marks work as complete:
- Parses `git diff HEAD --numstat` to measure code changes vs. `lat.md/` changes
- Applies a heuristic threshold: if code changes ≥5 lines AND lat.md changes / code changes < 0.05 ratio (with a 50-line upper bound), triggers a sync warning
- Runs `lat check` to catch structural errors
- **Blocks completion** on first violation with suggested fixes; warns without blocking on second pass

This is the "two-pass stopping mechanism" — the first block gives the agent a chance to fix issues, the second pass logs warnings without re-blocking to prevent infinite loops.

### Layer 3: CI Enforcement

A GitHub Actions workflow runs `lat check` on every push and pull request:

```yaml
on: [push, pull_request]
steps:
  - uses: actions/checkout@v4
  - uses: lars20070/lat-check-action@v1
```

This ensures no PR can merge with broken wiki-links, dangling code references, missing indexes, or oversized leading paragraphs.

### Summary: The Sync Model

```
                   ┌──────────────────────────────────┐
                   │    Markdown files = Source of     │
                   │    truth (no separate DB)         │
                   └──────────┬───────────────────────┘
                              │
              ┌───────────────┼───────────────┐
              │               │               │
        ┌─────┴─────┐  ┌─────┴─────┐  ┌──────┴──────┐
        │ lat check  │  │ Git hooks │  │ CI action   │
        │ (on-demand │  │ (agent    │  │ (push/PR    │
        │  CLI)      │  │  lifecycle│  │  gate)      │
        └────────────┘  │  events)  │  └─────────────┘
                        └───────────┘
```

**No file watcher. No database. No runtime sync.** The markdown files ARE the graph — relationships are encoded in wiki-links and `@lat:` annotations. Consistency is enforced through static analysis at well-defined checkpoints (manual check, agent hooks, CI).

## Semantic Search (Embedding Layer)

lat.md provides optional vector search using:

- **Providers**: OpenAI (`text-embedding-3-small`, 1536-dim) or Vercel AI Gateway
- **Storage**: SQLite database at `lat.md/.cache/vectors.db` using libsql with `libsql_vector_idx`
- **Indexing**: SHA-256 content hashing detects changed sections; only modified sections get re-embedded
- **Query**: `vector_top_k()` for approximate nearest-neighbor search

The reindexing pipeline:
1. Load all current sections and compute content hashes
2. Compare against stored hashes in the database
3. Classify: unchanged (skip), modified (re-embed), deleted (remove)
4. Batch embed changed sections (max 2048 per batch)
5. Upsert into SQLite

API key resolution priority: env var `LAT_LLM_KEY` → file path `LAT_LLM_KEY_FILE` → helper command `LAT_LLM_KEY_HELPER` → config file `~/.config/lat/config.json`.

## Reference Resolution (Multi-Strategy)

`resolveRef()` implements a tiered matching strategy:

1. **Exact full-ID match** — `parser#Wiki Links` → `lat.md/parser.md` section
2. **File stem expansion** — `setup` → `guides/setup` when stem is unique
3. **Subsection name match** — trailing segments of the ID path
4. **Path subsequence match** — non-contiguous path segment matching
5. **Fuzzy match** — Levenshtein distance fallback

In strict mode (`lat check`), ambiguous references are errors. In lenient mode (`lat locate`), best-effort matching with suggestions.

## MCP Server Integration

`lat mcp` exposes the knowledge graph via Model Context Protocol with six tools:

| Tool | Purpose |
|------|---------|
| `lat_locate` | Exact, fuzzy, and subsequence section matching |
| `lat_section` | Full section content + outgoing/incoming refs |
| `lat_search` | Semantic vector search across sections |
| `lat_expand` | Resolve `[[refs]]` in text with context |
| `lat_check` | Validate all links and references |
| `lat_refs` | Find sections referencing a target (MD, code, or both) |

Uses stdio transport. The context object carries directory paths, a plain-text styler, and `mode: 'mcp'`.

## Agent Scaffolding (`lat init`)

Interactive setup that configures integration for multiple agents:

- **Claude Code**: `.claude/settings.json` (hooks), `.claude/skills/lat-md/SKILL.md`, `.mcp.json`
- **Cursor**: `.cursor/rules/lat.md`, `.cursor/hooks.json`, `.cursor/mcp.json`
- **Copilot**: `.vscode/mcp.json`
- **OpenCode, Codex, Pi**: Respective config directories

Uses content hashing for template management: fresh files get created, unmodified templates get silently updated, user-edited files prompt before overwriting. Marker-based sections (`%% lat:begin %%` / `%% lat:end %%`) in shared files like AGENTS.md preserve user content outside lat-managed blocks.

## Source Code Symbol Extraction

tree-sitter parsers extract symbols from multiple languages:

| Language | Symbol Types |
|----------|-------------|
| TypeScript/JavaScript | functions, classes, methods, variables, types, interfaces |
| Python | functions, classes, methods, top-level assignments |
| Rust | structs, enums (→ class), impl methods, traits (→ interface) |
| Go | functions, methods (with receiver), type declarations, const/var |
| C/C++ | typedefs, structs, enums, functions, preprocessor-aware traversal |

Per-invocation caching prevents re-parsing the same file when multiple references exist. Symbols are converted to uniform Section objects for hierarchical representation (methods nest under parent classes).

## Comparison with Synapse

| Dimension | lat.md | Synapse |
|-----------|--------|---------|
| **Source of truth** | Markdown files (no DB) | SQLite graph DB (filesystem is a projection) |
| **Graph representation** | Implicit in wiki-links | Explicit nodes/edges in SQLite |
| **Sync mechanism** | Validation-based (check, hooks, CI) | Runtime file watcher + event bus + reconciliation |
| **Sync direction** | Human/agent manually updates both sides | DB → filesystem projection (bidirectional via watcher) |
| **Conflict resolution** | N/A — validation catches drift, humans fix | Reconciliation engine in vault architecture |
| **Embedding storage** | libsql + `libsql_vector_idx` in `.cache/vectors.db` | sqlite-vec + ONNX/OpenAI in vault |
| **Entity extraction** | Manual (human writes sections) | LLM-powered automatic extraction |
| **Multi-language support** | tree-sitter for 6 languages | N/A (not code-focused) |
| **Agent integration** | MCP server + editor hooks + CI | MCP server/client + ToolRegistry |
| **Target domain** | Codebase documentation | General knowledge management |
| **Editor support** | Claude Code, Cursor, Copilot, OpenCode, Codex, Pi | Electron desktop app |

### Key Takeaways for Synapse

1. **Validation > Runtime Sync for documentation**: lat.md's approach of validating consistency at checkpoints rather than maintaining real-time sync is pragmatic for human-written documentation where changes are discrete and intentional. Synapse's runtime watcher makes sense for its use case (graph DB as source of truth with filesystem projection) but not for documentation-style content.

2. **Content-hash-based incremental reindexing**: lat.md's SHA-256 hashing for embedding reindexing is the same pattern we should use (and may already use) in Synapse's vector embedding pipeline — only re-embed sections whose content actually changed.

3. **Agent hook lifecycle**: The UserPromptSubmit/Stop hook pattern with diff-ratio heuristics for detecting out-of-sync documentation is a clever enforcement mechanism. If Synapse ever adds documentation features, this pattern would be worth adopting.

4. **Structured section requirements**: The ≤250-char leading paragraph requirement ensures search snippets are always available and concise. Synapse's node descriptions serve a similar purpose but aren't enforced.

5. **Multi-strategy reference resolution**: The tiered matching (exact → stem → subsection → subsequence → fuzzy) is a well-designed degradation strategy. Synapse's search could benefit from a similar multi-tier approach for entity disambiguation.

6. **The "two-pass stop" pattern**: First violation blocks with fix suggestions; second pass warns without blocking to prevent infinite loops. A useful UX pattern for any validation that runs in agent workflows.

---

## Deep Dive: Applicability to Synapse

The following sections detail what Synapse already has, what's missing, and what's worth building — based on tracing the actual codebase against each lat.md mechanism.

### Mechanism 1: Content-Hash Incremental Re-Embedding

#### What Synapse Already Has

The event-driven embedding path (`handleNodeMutation` in `electron/embeddings/embedding-service.ts`) already implements content-hash-based skip logic:

1. `buildEmbeddingText()` constructs per-type text: entity → `"{name}. {label}. {summary}"` + edge labels; note → frontmatter or first 500 chars; resource → `"{name}. {source title}. {content excerpt}"`
2. `computeTextHash()` (`electron/embeddings/build-embedding-text.ts`) produces a DJB2 hash stored in `embedding_metadata.text_hash`
3. `handleNodeMutation()` compares the new hash against the stored hash and returns immediately if they match — no API call, no enqueue

The `embedding_metadata` table (migration `009-embeddings.ts`) stores `node_id`, `provider_id`, `dimensions`, `embedded_at`, and `text_hash`.

#### Gaps in Trigger Coverage

| Trigger path | Hash check? | Issue |
|---|---|---|
| Single node mutation (event-driven via `db:request` sync events) | **Yes** | Working correctly |
| `runBatchEmbed()` on provider re-enable (same provider) | **No** | Re-embeds all nodes; `embedding_metadata` still has valid hashes but they're ignored |
| Note content edits (`notes:write` IPC) | **No** | Embedding service is never notified; note embeddings go stale |
| Edge mutations (`edge_created`/`edge_deleted`) | **No** | Not forwarded to embedding service; entity embeddings that include edge labels go stale |
| Agent batch extraction (`mutation.execute`) | **No** | Returns `MutationResult` with no `syncEvent`; created nodes skip embedding entirely |

The existing plan doc (`docs/plans/graph-aware-embeddings-cascade.md`) already prescribes fixes for the note, edge, and batch gaps (Phases 3–4).

#### Quick Win

Add a hash pre-filter to `runBatchEmbed()` in `embedding-service.ts` (~5 lines):

```typescript
const existing = new Map(
  db.prepare('SELECT node_id, text_hash FROM embedding_metadata')
    .all().map((r: any) => [r.node_id, r.text_hash])
);
const items = allNodes
  .map(n => ({ id: n.id, text: buildEmbeddingText(n, ...) }))
  .filter(item => existing.get(item.id) !== computeTextHash(item.text));
```

This makes disable→re-enable (same provider) skip already-embedded-and-unchanged nodes. The hash algorithm (DJB2 vs SHA-256) is adequate for change detection — collision probability is ~1-in-4B per node.

---

### Mechanism 2: Diff-Ratio Agent Nudge

#### What Synapse Already Has

The chat agent accumulates `collectedNodeIds` and `collectedEdgeIds` across all tool calls during a turn (`chat-agent-loop.ts`). The `done` event carries a `subgraph` field with these IDs. Additionally:

- `BuiltinToolProvider` (`electron/mcp/builtin-tool-provider.ts`) already categorizes tools into `READ_TOOLS` and `WRITE_TOOLS` sets
- `nodes.vault_path` + `nodes.file_mtime` vs `nodes.updated_at` are queryable for note freshness
- `CommandEvent` types exist in `src/commands/types.ts` (including `note_content_updated`) but **the events array returned by `graphCommands.*` is dropped by `chat-tool-executor.ts`**

#### What's Missing

**No post-turn hook point.** After `runChatAgent()` resolves in `useChatSession.ts` (lines 250–261), the code only updates the message status and saves — no validation, no sync check.

**No write vs. read distinction in collected IDs.** `collectedNodeIds` includes nodes returned by `search_nodes` (read) alongside nodes modified by `update_node` (write). The heuristic needs to know which nodes were actually mutated.

**No entity→note association query.** When the agent updates entity node X, there's no ready-made query to find "is there a note node linked to X?" — would need `edges WHERE source_id = X AND target_type = 'note'` or `note_search WHERE title = node.name`.

#### Minimal Implementation Path

All changes are renderer-side — no main process or IPC modifications needed:

1. **`chat-tool-executor.ts`**: Add `mutatedNodeIds?: string[]` to `ToolExecResult`, populated only in write-tool branches (`create_node`, `update_node`, `delete_node`, `merge_nodes`, `create_note`, `update_note`)

2. **`chat-agent-loop.ts`**: Separate `collectedNodeIds` into `touchedNodeIds` (all) and `mutatedNodeIds` (writes only), both carried in the `done` event

3. **`useChatSession.ts`** (lines 250–261): After `runChatAgent()` resolves, run a sync check:
   - Query DB for note nodes linked to mutated entity nodes
   - Compare `nodes.updated_at` (entity) vs `nodes.file_mtime` (linked note)
   - If `mutatedEntityNodes.length >= threshold` and `mutatedNoteNodes.length / mutatedEntityNodes.length < ratio`, append a nudge message

4. **Alternative (simpler)**: Inject a reflection instruction into the system prompt's `MEMORY_GUIDELINES` section instructing the agent to call `update_note` after modifying entities that have linked notes — no code change, just prompt engineering

#### lat.md's Specific Thresholds (for reference)

- Code changes ≥ 5 lines triggers the check
- lat.md changes / code changes < 0.05 ratio triggers the warning
- Code changes > 50 lines upper bound (skip check for massive refactors)
- Two-pass: first violation blocks completion; second warns without blocking

---

### Mechanism 3: Multi-Tier Entity Resolution

#### What Synapse Already Has

`findMatches()` in `src/db/worker/queries/entity-resolution-queries.ts` implements a 3-tier cascade with early return:

| Tier | Implementation | Notes |
|---|---|---|
| **1. Exact name** (case-insensitive) | `WHERE LOWER(TRIM(name)) = ?` | Returns immediately on match |
| **2. Alias match** (indexed) | `WHERE ea.alias_lower = ?` on `entity_aliases` table | Aliases added on merge or via `add_alias` tool |
| **3. Fuzzy Dice bigrams** | In-memory O(N) scan of all nodes, Dice coefficient ≥ threshold | 0.7 for extraction, 0.3 for agent `find_similar_entities` |

Additional search paths exist but are **not integrated into the resolution cascade**:
- FTS5 (`nodes_fts` on `name`, `type`, `properties`) with BM25 ranking → LIKE fallback
- Vector KNN via sqlite-vec (`vec_nodes`)
- RRF fusion of FTS + vector in `rag-commands.ts` (for `search_knowledge` tool only)
- In-memory substring filter in `NodeAutocomplete.tsx` (UI only)

#### Missing Tiers

**Identifier/slug match** — Every node has an `identifier` column (e.g., `person/jane-doe`) but `findMatches()` never queries it. An extraction producing a URL variant or slug would miss.

**Substring containment** — Between exact and fuzzy, there's no tier for "the query is contained in the name" or vice versa. "TensorFlow 2.0" vs existing "TensorFlow" — exact fails, Dice scores ~0.73 (barely above 0.7 threshold).

**FTS5-narrowed fuzzy** — The Dice tier loads ALL nodes for scoring. Using FTS prefix match to get a candidate set first would be O(FTS hits) instead of O(N).

**Label/type-aware disambiguation** — `findMatches()` searches only `name`. If the graph has `{name: "Python", label: "programming-language"}` and extraction produces `{name: "Python", label: "snake"}`, exact match conflates them.

**Aliases in FTS** — Aliases are invisible to the UI search panel (`HeaderSearch`). Only `findMatches()` consults them. Adding aliases to `nodes_fts` (or a separate `aliases_fts`) would unify the two search paths.

#### Recommended Cascade (7 tiers)

```
findMatches(query):
  1. Exact name match (case-insensitive)          ← EXISTS
  2. Alias match (indexed alias_lower)            ← EXISTS
  3. Identifier stem match (LIKE on identifier)   ← NEW
  4. Containment match (name LIKE %query%)        ← NEW
  5. FTS5 prefix match (candidate narrowing)      ← NEW
  6. Dice bigrams on FTS candidates (not all N)   ← REPLACES current O(N) scan
  7. Vector KNN fallback (if embeddings enabled)  ← NEW (optional)
```

Each tier returns immediately on unambiguous match. Tiers 3–4 are pure SQL additions to `entity-resolution-queries.ts`. Tier 5–6 replaces the current O(N) scan with a two-phase approach. Tier 7 is optional and only fires when embeddings are enabled and all prior tiers produced no results.

#### Caller-Side Integration

Currently `findMatches()` is called from:
- `useLLMExtraction.ts` → `buildDiffItems()` and `proceedToReview()` (extraction dedup)
- `entity-tools.ts` → `find_similar_entities` (agent tool)
- `wikilink-parser.ts` → exact + alias only (intentional exclusion of fuzzy)

The enhanced cascade would improve extraction dedup quality and agent entity search without affecting wikilink resolution (which should stay strict).

#### Impact Estimate

The highest-ROI changes are tiers 3 (identifier) and 4 (containment) — both are single SQL queries added to the existing early-return cascade in `findMatches()`. The FTS-narrowed fuzzy (tiers 5–6) fixes the O(N) scaling issue that will worsen as graphs grow.

---

## Summary: Prioritized Adoption Roadmap

| Priority | Mechanism | Effort | Impact | Status |
|---|---|---|---|---|
| **1** | Content-hash pre-filter in `runBatchEmbed()` | ~30 min | Avoids redundant embedding API calls on re-enable | Quick win |
| **2** | Identifier + containment tiers in `findMatches()` | ~2 hours | Better extraction dedup, fewer false negatives | Focused change |
| **3** | FTS-narrowed Dice (replace O(N) scan) | ~2 hours | Scales entity resolution to large graphs | Performance |
| **4** | Note/edge trigger gaps for embedding service | ~3 hours | Closes stale embedding scenarios | Per cascade plan doc |
| **5** | Aliases in FTS index | ~1 hour | UI search finds nodes by alias | UX improvement |
| **6** | Diff-ratio agent nudge (prompt-based) | ~30 min | Agent self-checks note freshness after mutations | Prompt-only change |
| **7** | Diff-ratio agent nudge (code-based) | ~4 hours | Structural post-turn hook with write tracking | Architectural addition |
