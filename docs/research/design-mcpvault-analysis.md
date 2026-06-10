# MCPVault Design Analysis

Research on [mcpvault](https://github.com/bitbonsai/mcpvault) (1.3k stars) — an MCP server for Obsidian vaults. Evaluated for patterns Synapse can adopt.

## Overview

MCPVault provides 14 MCP tools for safe read/write access to Obsidian vaults via stdio transport. Key differentiators: AST-aware frontmatter preservation, BM25 search ranking, token-optimized responses, confirmation-echo safety for destructive ops, and a skills system with lazy sub-resource loading.

## Architecture

### Server Design

- **Monolithic tool registration**: All 15 tools in a single `ListToolsRequestSchema` handler returning a static array. Simple and readable but not extensible.
- **Clean service injection**: Business logic separated into `FileSystemService`, `SearchService`, `FrontmatterHandler`, `PathFilter` — injected via `CreateServerOptions`. The MCP handler layer only dispatches.
- **Pre-processing normalization**: `trimPaths()` applied to all args before dispatch — a lightweight middleware pattern replacing per-handler sanitization.
- **Version auto-sync**: Read from `package.json` at runtime via `readFileSync`, not hardcoded.
- **Minimal deps**: `@modelcontextprotocol/sdk`, `gray-matter`, `yaml`, `trash`. No frameworks.

### Token Optimization (40-60% reduction)

The primary strategy is **abbreviated JSON keys** in all responses:

| Full key | Abbreviated |
|---|---|
| `frontmatter` | `fm` |
| `content` | `content` |
| `directories`, `files` | `dirs`, `files` |
| `path`, `title`, `excerpt`, `matchCount`, `lineNumber` | `p`, `t`, `ex`, `mc`, `ln` |

Additional strategies:
- `prettyPrint` parameter (default `false`) — compact JSON unless explicitly requested
- Metadata-only tools (`get_notes_info`, `get_frontmatter`) avoid returning full content
- Hard result caps: search default 5, max 20; batch read cap 10

**Synapse takeaway**: Our MCP server returns verbose keys (`nodeId`, `nodeType`, `edgeLabel`, `neighbors`). Adopting short keys (`id`, `t`, `el`, `nb`) in tool responses would reduce token cost per call significantly, especially for `get_subgraph` which can return large payloads.

### Destructive Operation Safety

Delete and move operations require a **confirmation echo** — the LLM must pass the path in both a `path` field and a matching `confirmPath` field:

```typescript
// delete_note requires path === confirmPath
if (path !== confirmPath) throw new Error("Path mismatch");
```

Move uses `flag: 'wx'` (write-exclusive) on destination to atomically prevent silent overwrites.

**Synapse takeaway**: Our `delete_node` and `merge_nodes` MCP tools have no confirmation gate. Adding `confirmId` fields would prevent hallucinated deletions — cheap to implement, high safety value.

## Frontmatter Handling

### Dual-Layer Parse/Write

The core innovation is a two-library approach to avoid the round-trip corruption problem:

1. **Parse** with `gray-matter` — extracts frontmatter data + raw YAML string (`matter` field)
2. **Write** with `yaml`'s `parseDocument()` AST — calls `doc.set(key, value)` only on changed keys

Unmodified keys are never re-serialized through JavaScript values, so:
- `date: 2026-03-16` stays as string (gray-matter would convert to `Date` object)
- `time_start: 10:00` stays as `10:00` (gray-matter converts to integer 600)
- `"[[Meetings]]"` quotes preserved (Obsidian wikilinks)

### patch_note vs write_note

| Operation | Strategy | Frontmatter safety |
|---|---|---|
| `write_note` | Full document replacement (overwrite/append/prepend) | Re-serializes via `preserveStringify` |
| `patch_note` | Surgical string replacement on raw bytes | Frontmatter completely untouched unless patch spans it |

`patch_note` requires unique match by default — fails if `>1` occurrence found (must set `replaceAll=true` to override).

### Content Validation

- `content === undefined` guard prevents writing literal `"undefined"` strings
- Frontmatter validated before every write — blocks functions, symbols, non-string keys
- Corrupt frontmatter silently degrades to `{}` with full file as body (no error surfaced)

**Synapse takeaway**: Our `parseFrontmatter()` in `agent-definition-types.ts` is a hand-rolled regex parser. For vault-scoped `.kg/agents/*.md` files that users may edit externally, adopting the gray-matter + yaml AST approach would prevent corruption on round-trip. Also: our agent file writes should use temp-file + `rename()` for atomicity — mcpvault doesn't do this and acknowledges the gap.

## Search

### BM25 Implementation

Pure filesystem scan — no index. Reads all `.md` files in parallel batches of 5, scores in-memory with standard BM25 parameters (`k1=1.2`, `b=0.75`). Corpus statistics (IDF, avgdl) computed per-query.

- Multi-word matching is OR-based: any term matches
- Full phrase added as extra scoring term (boosts exact matches)
- Excerpt window: ±21 characters around first match
- Frontmatter optionally excluded or exclusively searched

### Comparison with Synapse

| Dimension | mcpvault | Synapse |
|---|---|---|
| Index | None — O(n) I/O per query | FTS5 virtual table |
| Ranking | BM25 (inline computation) | FTS5 `rank` function |
| Multi-word | OR across terms | FTS5 phrase/proximity |
| Scale | Degrades linearly | Constant-time lookups |
| Update cost | Zero (no index) | Triggered on write |

**Synapse takeaway**: Our FTS5 approach is strictly superior for scale. However, mcpvault's BM25 parameter tuning and excerpt generation could improve our `search_nodes` MCP tool output — we currently return full node names but no excerpts or relevance scores.

## Path Filtering & Security

### Vault Boundary Model

- **Implicit containment**: Security relies on the filesystem walk starting at the resolved vault root — walked paths can never produce `..` segments
- **Glob denylist**: `.obsidian`, `.git`, `node_modules`, `.DS_Store`, `Thumbs.db` blocked by hand-rolled glob matcher
- **Extension allowlist**: `.md`, `.markdown`, `.txt`, `.base`, `.canvas` for content operations; directory listing is more permissive
- **Path traversal**: Lexical `..` check + `realpathSync` for symlinks. No URL-decode validation (`%2e%2e` would pass PathFilter but wouldn't reach FS due to walk containment)

**Synapse takeaway**: Our vault boundary is enforced at the DB level (paths stored relative, never absolute), which is inherently stronger. However, mcpvault's extension allowlist pattern could be useful for our file ingestion pipeline — currently we accept any file type, which can cause issues with binary files.

## Skills System

### SKILL.md Format

Located in `skills/obsidian/SKILL.md` with YAML frontmatter:

```yaml
name: obsidian-vault
description: Activate when the user mentions their Obsidian vault, notes, tags...
metadata:
  version: "1.0"
  author: bitbonsai
```

### Key Design Patterns

1. **Routing policy with priority tiers**: The skill tells agents which backend to use for which intent, not which tools exist:
   - Priority 1: MCP tools (always preferred)
   - Priority 2: Obsidian CLI
   - Priority 3: git CLI

2. **Gotchas as first-class content**: 10 numbered behavioral constraints embedded in the skill file, not in tool descriptions. Example: "patch_note rejects multi-match by default."

3. **Lazy sub-resource loading**: Three sub-documents listed with explicit instruction "Load these only when needed, not on every invocation":
   - `tool-patterns.md` — usage examples
   - `obsidian-conventions.md` — Obsidian-specific formatting rules
   - `git-sync.md` — sync workflow patterns

4. **Error recovery tables**: Maps error conditions to exact recovery steps — deterministic protocols the agent must follow.

5. **Single skill, universal agents**: No per-agent branching. The skill works for any MCP client by defining routing at the MCP level.

**Synapse takeaway for planned Skills system (Phase 8)**:

- **Routing tiers** are more expressive than binary allow/deny tool lists. A Synapse skill could define: "Use `search_nodes` first, fall back to `semantic_search` if no results, then try `search_notes`."
- **Lazy sub-resources** map directly to our planned L1/L2/L3 progressive disclosure: L1 (name+description) always loaded, L2 (full instructions) on agent start, L3 (reference docs) on demand.
- **Gotchas section** validates our planned guardrails approach — behavioral constraints belong in the skill/agent definition, close to where they're consumed.
- **Error recovery tables** could be added to Synapse agent definitions as a `recovery` frontmatter field or a dedicated markdown section.

## Testing Patterns

### Two-Tier Strategy

1. **Transport-level tests** (`createServer.test.ts`): Uses `InMemoryTransport.createLinkedPair()` from `@modelcontextprotocol/sdk` to wire a real MCP `Client` against the server in-process. Tests call `client.callTool(...)` end-to-end. One test asserts the exact tool name list to catch registration regressions.

2. **Service-layer integration tests** (`integration.test.ts`): Instantiates services directly (same wiring as `createServer()`) without MCP transport. Tests complex multi-step workflows: write → search → readMultiple → updateFrontmatter → verify.

### Fixture Strategy

- `mkdtemp(join(tmpdir(), ...))` in `beforeEach` + `rm({ recursive: true })` in `afterEach`
- All fixtures are inline template literals — no external fixture files
- Regression tests are issue-linked (e.g. "Issue #30: notes without a heading...")

### Notable Test Patterns

- **Corruption guards**: Write with `undefined`/`null` inputs, then read back and assert file NOT corrupted
- **Regex-safe content**: Tests with `$10.50`, `[a-z]+`, `backup.2024/**` in both filenames and body
- **Performance guard**: 100-line file with 100 replacements asserted to complete in < 1 second
- **Security tests**: Every destructive operation tested against `.obsidian/` paths expecting `Access denied`

**Synapse takeaway**: The `InMemoryTransport` pattern is directly portable to `packages/synapse-mcp/`. We could test `create_node`, `search_nodes`, etc. through real tool dispatch with a temp SQLite vault. The two-tier structure (service tests for workflows, transport tests for registration + smoke) is worth replicating.

## Actionable Recommendations for Synapse

### High Priority (low effort, high impact)

| # | What | Where | Effort |
|---|---|---|---|
| 1 | **Abbreviated response keys** in MCP tool output | `packages/synapse-mcp/` tool handlers | Small — rename keys in response objects |
| 2 | **Confirmation echo** for `delete_node`, `merge_nodes`, `delete_edge` | MCP tool input schemas + handlers | Small — add `confirmId` field + equality check |
| 3 | **`prettyPrint` parameter** on read/search tools | MCP tool schemas | Tiny — `JSON.stringify(result, null, prettyPrint ? 2 : 0)` |

### Medium Priority (moderate effort, good value)

| # | What | Where | Effort |
|---|---|---|---|
| 4 | **Gray-matter + yaml AST** for agent `.md` file writes | `agent-definition-types.ts`, `agents:list-vault` IPC | Medium — replace hand-rolled parser |
| 5 | **Atomic file writes** (temp + rename) for agent definitions | Agent file save path | Small — wrap existing `writeFile` |
| 6 | **InMemoryTransport tests** for Synapse MCP server | `packages/synapse-mcp/` test suite | Medium — new test file, temp vault setup |
| 7 | **Search excerpts + relevance scores** in MCP search results | `search_nodes`, `search_notes` tools | Medium — extract from FTS5 |

### Future Phases (aligns with planned work)

| # | What | Phase | Notes |
|---|---|---|---|
| 8 | **Routing policy tiers** in skill definitions | Phase 8 (Skills) | More expressive than allow/deny lists |
| 9 | **Lazy sub-resource loading** (L1/L2/L3) | Phase 8 (Skills) | mcpvault validates this approach |
| 10 | **Error recovery tables** in agent definitions | Phase 5 (Guardrails) | Deterministic recovery protocols |
| 11 | **Extension allowlist** for file ingestion | Ingestion pipeline | Prevent binary file issues |
