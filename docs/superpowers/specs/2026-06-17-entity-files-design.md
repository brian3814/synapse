# Entity Files Design

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Entity files as a **core feature** — every entity node gets a markdown working-memory file from day one. Agents primarily read and write entity markdown while retrieving and filing back knowledge; users may also directly edit the files. The DB remains the structured identity, graph, and index layer; entity files are the rich prose layer. Git-versionable, human-editable, LLM-readable.

**Architecture:** `EntityFileService` in the Electron main process, following the EmbeddingService lifecycle pattern. Entity file reconciliation, not one-way sync: DB owns identity/path/frontmatter scaffolding and graph indexes; entity files own accumulated prose. Agents and users write the body. Synapse updates derived indexes (`content_hash`, embeddings) from file contents and surfaces reviewed metadata changes through the Sync panel. Relationship drift is corrected lazily via `resolveEntityLinks()` on read/review.

**Tech Stack:** Existing `VaultEventBus`, `FileWatcher` (with `markAsAppWritten`), `parseMarkdown`/`generateNoteMarkdown` patterns, new `EntitySyncReview` UI panel.

---

## 1. Vault Layout

```
<vault-root>/
├── .synapse/               ← app internals (unchanged)
├── notes/                  ← user-created notes (unchanged)
├── entities/               ← NEW — agent-maintained entity working memory
│   ├── machine_learning.md
│   ├── neural_networks.md
│   ├── alan_turing.md
│   └── postgresql.md
└── (user files)            ← auto-detected resources (unchanged)
```

Filenames are slugified: lowercase, spaces → `_`, strip non-alphanumeric except `_` and `-`. The human-readable name lives in frontmatter `title`, not the filename. Slugify function: `name.toLowerCase().replace(/\s+/g, '_').replace(/[^a-z0-9_-]/g, '')`. This avoids filesystem case-sensitivity issues across platforms and makes paths predictable for scripts/agents.

Flat directory — no label-based subfolders. This is future-proof for multi-label nodes (a node tagged both `concept` and `technology` can't live in one label folder). Categorization lives in the DB, not the filesystem hierarchy.

Resource nodes are excluded — they already have files (`vault_path` → the actual PDF/image/etc). This feature is for entity-type nodes that currently exist only in the DB.

---

## 2. Entity File Format

### Frontmatter: Minimal Binding

Each entity file is bound to its DB node by UUID. The frontmatter carries only two fields:

```yaml
---
id: 550e8400-e29b-41d4-a716-446655440000
title: Machine Learning
---
```

- **`id`** (required): The `nodes.id` UUID. This is the binding — Synapse uses it to look up all structured metadata (labels, tags, summary, source_url, timestamps) from the DB. Users and agents should not edit it. If it changes or points to an unknown node, Synapse raises a sync issue instead of guessing.
- **`title`** (required): Mirrors `nodes.name`. Present for human readability when browsing files in a file manager or text editor. Updated by the system when the node is renamed in the DB. If a user or agent edits the title in the file, Synapse treats it as a **proposed rename** and asks which title should win.

All other metadata (labels, tags, summary, source_url, created_at, updated_at) lives exclusively in the DB. `summary` is set during extraction and stays static — it is not re-derived from the entity file body.

### Body: User/Agent-Owned Content

The body is freeform markdown. On initial file creation, it is seeded from DB data:

```markdown
---
id: 550e8400-e29b-41d4-a716-446655440000
title: Machine Learning
---

# Machine Learning

A branch of AI focused on building systems that learn from data.

## Relationships

- [[Neural Networks]] — *foundational_architecture*
- [[Alan Turing]] — *historical_contributor*
- [[PostgreSQL]] — *commonly_used_for* feature stores

## Sources

- [Wikipedia: Machine Learning](https://en.wikipedia.org/wiki/Machine_learning)
- Extracted from [Research Paper on Deep Learning](../notes/Deep%20Learning%20Survey.md)
```

Initial body generation:

- **Heading**: `# {name}`
- **Description paragraph**: from `nodes.summary`, or empty if null
- **Relationships section**: query `edges` where `source_id = nodeId OR target_id = nodeId`, render as `[[Other Node Name]] — *edge_label*` wiki-links
- **Sources section**: from `entity_sources` table — links to resource nodes or notes that this entity was extracted from

After creation, the body is **agent-curated, user-adjustable**. The agent is the primary writer — it maintains entity files by appending new context, updating relationships, and synthesizing across sources. Users have full transparency and can review, edit, or reorganize the prose at any time. Synapse also performs deterministic structural updates (e.g. appending new edge wiki-links when graph relationships change — see §3.6). The body is never regenerated wholesale from DB state.

---

## 3. Reconciliation Model

Entity files are not disposable DB projections. They are durable working memory files. Reconciliation has three directions:

1. **DB → file scaffolding**: DB events create missing files, keep UUID/title frontmatter aligned, and update paths on reviewed renames.
2. **File → derived indexes**: file content updates `content_hash` and embeddings. These are derived data, not ownership of the prose.
3. **File → reviewed DB mutations**: title changes, new files, and unknown IDs become Sync panel issues. They can create/rename/rebind entities only after explicit user/agent action.

### 3.1 DB-Owned Scaffolding (Synapse writes)

Triggered by VaultEventBus events on entity nodes:

- **`node:created`** (entity): Generate file at `entities/{slugify(name)}.md` with `id` + `title` frontmatter and seeded body (see §2), only if the node does not already have an entity file. Set `vault_path`, `file_mtime`, `file_size`, `content_hash` on the DB row. Call `fileWatcher.markAsAppWritten(path)`.
- **`node:updated`** (entity, name changed): Rename file to new slug and update `title:` in frontmatter. Preserve body unchanged. `markAsAppWritten`.
- **`node:deleted`** (entity): Delete the entity file. Clear `vault_path`. If git backup is enabled, the content is recoverable from history.

Label/tag/summary changes in the DB do NOT touch the file — that metadata lives in the DB, not the file. Edge changes DO trigger file updates — see §3.7.

File writes are debounced per-node (500ms) for bulk operations.

### 3.2 Agent Tool Seam

Agents access entity files through three registered tools, wired into the standard `CommandContext` → `chat-tool-executor` → `BuiltinToolProvider` pipeline:

- **`read_entity_file`** (read tool): Takes `node_id`, returns file content + `content_hash`. Agent uses this before append/patch.
- **`append_entity_file`** (write tool): Takes `node_id`, `text`, optional `expected_hash`. Appends text to entity file body. Returns new `content_hash`.
- **`patch_entity_file`** (write tool): Takes `node_id`, `patch` (section replace), optional `expected_hash`. Returns new `content_hash`.

All three route through `CommandContext.entityFiles` → IPC → `EntityFileService` in main process. `content_hash` provides optimistic locking — if `expected_hash` doesn't match current, the call fails with a conflict error so the agent re-reads.

**RAG integration:** `getSourceExcerpts()` in `rag-commands.ts` must include entity file body for entity nodes. When `node.type === 'entity'` and `node.vault_path?.startsWith('entities/')`, read the file via `ctx.entityFiles.read()` and return body as excerpt. Without this, semantic search can rank an entity by its file content but return no content to the model.

### 3.3 External File Edits

Direct edits made outside Synapse (VS Code, Obsidian, terminal, etc.) are also supported:

- **Body edits**: Update `content_hash`, file metadata, and trigger an **embedding re-index**. The entity file body is the richest text for that entity, so `EmbeddingService` must include it (see §10). `text_hash` dedup skips re-embedding if the computed text has not changed. (Note: "search text" means embeddings only for MVP. FTS for entity file prose is future work.)
- **File renamed**: Reconciliation detects orphan + new file, content-hash matches them, updates `vault_path` automatically.
- **File deleted**: Silently clear `vault_path` on the node. Entity stays in DB. No notification — user can regenerate missing files via "Regenerate missing" in settings.
- **Title mismatch**: If the user or agent edits `title:` in frontmatter so it no longer matches `nodes.name`, raise a notification (see §4). The user can rename the DB entity to match the file, revert the file title to DB, or dismiss.

### 3.4 File Event Routing

The file watcher emits `file:added` for both new and existing files (it does not distinguish creation from modification). `EntityFileService` must guard `file:added` with a `vault_path` lookup: if a node already has this path bound, treat it as a content change (update `content_hash`, check title, trigger embedding). Only unbound paths are routed to the new-file import flow below.

### 3.5 New Files (Entity Import)

A new `.md` file appearing in `entities/` is the one case that needs user confirmation:

- **With `id` frontmatter** matching an existing node → re-bind silently (set `vault_path`).
- **With `id` that doesn't match any node** → notification: "Entity file references unknown ID, remove or fix."
- **Without `id` frontmatter** → notification: "New entity file detected — create entity from this file?" User confirms → create entity node, write `id` into frontmatter, set `vault_path`.

### 3.6 Relationship Drift

Relationships in the file body (`[[wiki links]]`) are user/agent-maintained, not auto-synced from DB edges. They drift naturally as nodes get renamed, edges change, entities get merged. Synapse **detects** drift but never silently rewrites — all fixes go through user review via the Sync panel (§4) or explicit agent patch action.

#### Detection

`resolveEntityLinks(filePath)` scans a file's wiki-links against the DB and produces a list of `LinkDriftItem`s. It runs:
- On entity rename/merge/delete (scan all entity files that might reference the changed node)
- On vault open reconciliation (batch scan)
- On editor open or agent context assembly (single file)

#### Drift kinds

1. **Broken link** (target renamed): `[[TensorFlow]]` but node is now named "TensorFlow 2.0". Suggested fix: `[[TensorFlow]]` → `[[TensorFlow 2.0]]`.
2. **Stale link** (target merged): `[[TensorFlow]]` was merged into "TensorFlow 2.0". Suggested fix: same as broken link — update to the surviving node's name.
3. **Dead link** (target deleted): `[[Some Entity]]` no longer exists in the graph. Suggested fix: remove the line, or keep as plain text.
4. **Missing relationship suggestion** (edge in DB but not in file): DB has an edge to "PyTorch" but the file's Relationships section doesn't mention it. Suggested fix: append `- [[PyTorch]] — *edge_label*`. These are lower-priority suggestions and should not badge by default unless the user enables relationship completeness checks.

#### User review

Drift items surface as notifications in the Sync panel (§4), grouped per file:

```
┌──────────────────────────────────────────┐
│ ⚠ 3 link issues in machine_learning.md   │
│                                          │
│  ● [[TensorFlow]] → [[TensorFlow 2.0]]  │
│    Entity was renamed                    │
│    [Fix] [Ignore]                        │
│                                          │
│  ● [[Deprecated Lib]] — dead link        │
│    Entity was deleted from graph         │
│    [Remove line] [Keep as text] [Ignore] │
│                                          │
│  ● Missing: [[PyTorch]] — *built_with*   │
│    Edge exists in DB but not in file     │
│    [Add to file] [Ignore]               │
│                                          │
│  [Fix all] [Dismiss]                     │
└──────────────────────────────────────────┘
```

- **Fix / Fix all**: Apply the suggested rewrite to the file. `markAsAppWritten()` to suppress echo.
- **Remove line**: Delete the wiki-link line from the file.
- **Keep as text**: Convert `[[Dead Entity]]` → `Dead Entity` (plain text, no link).
- **Add to file**: Append the missing relationship to the `## Relationships` section.
- **Ignore**: Dismiss this item. Don't re-prompt until the file or the referenced node changes again.
- **Dismiss**: Dismiss all items for this file.

### 3.7 Edge-Triggered File Updates

When a new edge is created or an existing edge is deleted, Synapse deterministically updates the `## Relationships` section of both endpoint entity files (if they have entity files):

- **`edge:created`**: Append `- [[Other Node Name]] — *edge_label*` to the `## Relationships` section. If the section doesn't exist, create it. `markAsAppWritten()` to suppress echo. Update `content_hash` and trigger embedding re-index.
- **`edge:deleted`**: Remove the line matching `- [[Other Node Name]] — *exact_edge_label*` from the `## Relationships` section. The match must include the exact label to avoid deleting unrelated relationship lines between the same pair (the schema allows multiple edges with different labels between the same endpoints). `markAsAppWritten()`. Update `content_hash`.

This is a deterministic structural update, not agent prose. It keeps entity files current with the graph without requiring LLM calls. The agent's richer enrichment (turning these bullet points into contextual prose, synthesizing across sources) layers on top through `appendEntityFile`/`patchEntityFile`.

Edge updates are debounced per-node (500ms) alongside other file writes to coalesce bulk operations.

---

## 4. Notifications

Notification state is owned by the Electron main process, not by renderer-only Zustand state. Zustand is only the renderer cache/view. Main either persists sync issues in app/vault storage or recomputes them through `listSyncIssues()` on panel open. Dismissals are keyed by file path + issue kind + content hash/node version so ignored issues do not reappear until the underlying file or node changes.

Three notification types surface in the Sync panel: title mismatches, new entity files, and link drift. Missing files are handled silently (clear `vault_path`) — user can regenerate via settings.

### 4.1 Title Mismatch

When the file watcher or reconciliation detects that an entity file's `title:` frontmatter doesn't match `nodes.name`:

```
┌──────────────────────────────────────────────────────────┐
│ ⚠ Title mismatch in machine_learning.md                  │
│                                                          │
│   DB name: "Machine Learning"                            │
│   File title: "ML & Deep Learning"                       │
│                                                          │
│   Choose which title should be canonical.                │
│                                                          │
│   [Rename entity]  [Revert file title]  [Dismiss]        │
└──────────────────────────────────────────────────────────┘
```

- **Rename entity**: Update `nodes.name` to the file title, rename the file path to the new slug if needed, preserve body unchanged.
- **Revert file title**: Synapse rewrites `title:` in the frontmatter to match `nodes.name`. Body unchanged.
- **Open file**: Opens the entity file in the vault explorer/editor.
- **Dismiss**: Ignore. Don't re-prompt until the file changes again (track dismissed hash).

### 4.2 New Entity File

When a new `.md` file without an `id` appears in `entities/`:

```
┌──────────────────────────────────────────────────────────┐
│ ⚠ New file in entities/                                  │
│                                                          │
│   quantum_computing.md                                   │
│   Title: "Quantum Computing"                             │
│                                                          │
│   [Create entity]  [Ignore file]  [Delete file]          │
└──────────────────────────────────────────────────────────┘
```

- **Create entity**: Create entity node from file, add frontmatter if missing, write `id`, set `vault_path`, and trigger embedding.
- **Ignore file**: Leave the file on disk but do not link it to any entity. Do not re-prompt until it changes.
- **Delete file**: Remove the file from disk. Destructive and should require confirmation.
- **Dismiss**: Same as Ignore file for this issue instance.

### 4.3 Link Drift

When `resolveEntityLinks()` detects broken, stale, dead, or missing links in an entity file, it surfaces them in the Sync panel grouped by file (see §3.6 for the full UX mockup and actions).

Broken/stale/dead links badge by default. Missing relationship suggestions are hidden from the badge unless relationship completeness checks are enabled.

### 4.4 Activity Bar Badge

The existing `ActivityBar` gains a "Sync" entry. When pending notifications exist (title mismatches + new files + link drift), a count badge overlays the icon.

```
┌────┐
│ ⟳  │  ← sync icon
│ 5  │  ← badge, only visible when count > 0
└────┘
```

Clicking opens the Sync panel in the left sidebar — a list of notification cards grouped by type. Each card shows the message and action buttons inline. The panel uses the same single-column sidebar as Explorer, Agents, and Artifacts.

---

## 5. Configuration

### Settings

Stored in app-level storage under key `entityFilesConfig`:

```typescript
interface EntityFilesConfig {
  seedRelationships: boolean; // default: true — include edges in initial body generation
  seedSources: boolean;       // default: true — include provenance links in initial body
  relationshipCompletenessChecks: boolean; // default: false — badge missing DB edges as file suggestions
}
```

No `enabled` toggle — entity files are a core feature, always active.

`scaffoldVault()` creates `entities/` alongside `notes/` as part of the vault's fundamental structure. New entities get files immediately on creation.

---

## 6. File Structure

### New Files

```
electron/entity-files/
  entity-file-service.ts        — Orchestrates sync, owns event subscriptions, lifecycle
  entity-markdown.ts            — Generate markdown from DB node + edges; parse frontmatter back
  entity-slug.ts                — slugify(name) → lowercase, spaces→_, strip special chars
  entity-file-tools.ts          — Agent-facing read/append/patch helpers with content_hash guards
  sync-issue-store.ts           — Main-process durable/recomputable sync issue source
  ipc-handlers.ts               — IPC registration

src/ui/components/entity-sync/
  EntitySyncPanel.tsx            — Left sidebar panel: notification card list
  EntitySyncCard.tsx             — Notification card (title mismatch, new file, etc.)

src/graph/store/entity-sync-store.ts  — Zustand cache for pending notifications from main
```

### Modified Files

```
electron/main.ts                — Create EntityFileService in registerVaultHandlers()
electron/vault/vault-context.ts — Add entities/ to scaffoldVault()
electron/vault/reconciliation.ts — Add entities/ handling in Phase 5 (bind by id only, no file:added emit)
electron/vault/file-watcher.ts  — route entities/*.md through EntityFileService, not generic resources
electron/vault/handlers/resource-detection-handler.ts — ignore entities/*.md
electron/embeddings/build-embedding-text.ts — include entity file body in entity embedding text
src/platform/types.ts           — Add PlatformEntityFiles interface
src/platform/electron/index.ts  — Export entity files instance
src/platform/chrome/index.ts    — Export stub
src/commands/types.ts           — Add entityFiles? to CommandContext
src/shared/chat-agent-tools.ts  — Add read_entity_file, append_entity_file, patch_entity_file tool defs
src/commands/chat-tool-executor.ts — Add executor cases for entity file tools
src/commands/rag-commands.ts    — Add entity file branch in getSourceExcerpts()
src/graph/store/ui-store.ts     — Add 'sync' to LeftPanel union
src/ui/components/layout/ActivityBar.tsx — Add Sync icon with count badge
src/ui/components/layout/LeftSidebar.tsx — Render EntitySyncPanel when leftPanel === 'sync'
```

---

## 7. EntityFileService Lifecycle

Always active — created in `registerVaultHandlers()` after reconciliation and existing handler registration, before `fileWatcher.start()`.

```
registerVaultHandlers(ctx):
  → reconcileVault(ctx)                       — existing, unchanged
  → register NoteFileHandler, SyncBroadcast,  — existing, unchanged
    ResourceDetectionHandler, ArtifactFileHandler
  → new EntityFileService(ctx)                — NEW: after handlers, before watcher
  → entityFileService.register(eventBus)
  → fileWatcher = new VaultFileWatcher(...)
  → fileWatcher.start()

EntityFileService.register():
  → ensureDirectories() — create entities/ if not present
  → subscribe to VaultEventBus:
      node:created, node:updated, node:deleted (where type = 'entity')
      edge:created, edge:deleted (update Relationships sections — §3.7)
      file:added, file:changed, file:removed (where path starts with entities/)
  → reconcileEntityFiles() — bind existing files, detect title mismatches, queue notifications
  → resolveEntityLinks() on entity files — detect link drift, queue notifications

unregisterVaultHandlers():
  → entityFileService.unregister()
  → flush pending debounced writes
  → destroy
```

Edge event subscriptions: on `edge:created` / `edge:deleted`, update the `## Relationships` section of affected entity files (see §3.7), then run `resolveEntityLinks()` to detect any remaining broken/stale/dead links (see §3.6). The `edge:deleted` event is extended to carry the full edge data (`source_id`, `target_id`, `label`) since the DB row is already gone by the time handlers run — the data is pre-fetched before deletion (existing pattern in `electron/main.ts:162-168`).

**Bulk operations:** `mutation.execute` (used by extraction review apply) does not emit individual `edge:created`/`edge:deleted` sync events. The `db:action` outcome handler must extract edge results from `mutation.execute` responses and emit edge events (or call `EntityFileService` directly) so bulk-created edges trigger relationship updates.

### Write Debouncing

Entity file writes are debounced per-node (500ms). During bulk operations (extraction applying 20 entities), this prevents thrashing.

---

## 8. Reconciliation Extension

`reconcileVault()` currently has `IGNORE_DIRS = ['.synapse', '.git', 'node_modules']` and special-cases `notes/` in Phase 5.

Changes:
- Phase 5 extended: files matching `entities/*.md` are reserved — they must NOT fall through to generic `file:added` / resource detection
- `reconcileVault()` only handles ID-based re-binding: file with `id` matching existing node → set `vault_path`, update `content_hash`/mtime/size
- All other entity file reconciliation (title mismatches, unknown IDs, new files without frontmatter, link drift) is owned by `EntityFileService.reconcileEntityFiles()`, which runs after the service is registered and subscribed (see §7). This avoids split-brain routing where reconciliation emits events before handlers exist.
- Missing file → silently clear `vault_path`
- Modified file → update `content_hash`, trigger embedding re-index

---

## 9. Edge Cases

**Name collisions**: Two entities that slugify to `python` — append a short hash suffix: `python.md` and `python_a3f2.md`.

**Entity merged**: `merge_nodes` tool combines two entities. Delete the merged-away entity's file (recoverable from git). The surviving entity's file gets edge updates from §3.7 as relationships transfer. Agent enrichment can later synthesize content from the merged entity if needed.

**Bulk extraction**: 50 new entities from a single extraction. Debounce coalesces into a batch write after the extraction review is applied. Progress shown in EntitySyncBanner if generating files takes >1s.

**File watcher race**: User saves a file in VS Code, watcher fires, Synapse reads the file. If the read happens before the editor finishes flushing, the content may be partial. The 200ms debounce on file→DB path mitigates this; the content hash check catches any remaining inconsistency on next reconciliation.

**Entities with very long names**: Filesystem path limits (255 chars per component). Truncate the slug at 200 chars, append a short hash suffix to disambiguate.

**User renames a file**: Reconciliation detects it as orphan + new file. Content-hash rename detection (already in reconciliation Phase 4) matches them and updates `vault_path`. DB `name` changes only through title-mismatch review.

---

## 10. Storage Architecture

Entity files are the **rich content layer**; the DB is the **structured index**. This follows the Binder/Palinode pattern from the LLM wiki research.

| What | Where | Why |
|---|---|---|
| Structured data (name, label, edges, properties) | DB | Fast queries, graph viz, search |
| Rich accumulated content (claims, citations, contradictions, open questions) | Entity files on disk | Human-editable, git-versionable, LLM-readable |
| Short summary | DB (from extraction, static) | Quick display without file read — not re-derived from file |
| Version history | Git (user-managed) | `entities/` and `notes/` tracked, `.synapse/` gitignored |

### Enrichment pathways

Entity files accumulate knowledge beyond the initial extraction:

1. **Multi-source accumulation** — each new source that mentions an existing entity UPDATES that entity's file with new claims, citations, and relationships. The DB summary stays short; the file body grows.
2. **Query file-back** — when the chat agent produces a valuable synthesis about an entity, that insight gets filed back into the entity file. Chat answers compound instead of evaporating into conversation history.
3. **Lint/audit annotations** — periodic health checks add contradiction flags, mark stale claims, suggest missing cross-references.
4. **User editing** — humans add annotations, corrections, open questions directly in the markdown (via Synapse, VS Code, Obsidian).

### Reconciliation

Graph mutations update identity/path/frontmatter scaffolding and queue reviewed suggestions. Agent file-back and user edits update entity file bodies, which then update derived indexes and embeddings. Title mismatches raise a notification prompting the user to choose whether DB name or file title should be canonical.

### Embedding

Entity files are indexed with embeddings for semantic search. Since they hold the richest accumulated text in the vault, they're the most valuable content to embed.

- Uses the existing embedding pipeline (`EmbeddingService`, `vec_nodes` table, `text_hash` dedup)
- **Graph-aware strategy** works especially well here — an entity file's embedding incorporates neighbor context, so searching for "attention mechanism in NLP" surfaces "Transformer" via relationship proximity even if those exact words aren't in the file
- **Churn management**: entity files change more frequently than notes (every ingest, query file-back, lint pass). The `text_hash` check in `embedding_metadata` skips re-embedding when content hasn't actually changed. Cascade re-embedding handles neighbor updates.
- **Build text**: for entity files, the embedding text is constructed from `"{title}. {labels}. {description}. {body first 500 chars}. [related] {neighbors}"` (graph-aware mode)

## 11. Progressive Disclosure

When the chat agent retrieves context about an entity's neighborhood, progressive disclosure keeps token usage manageable:

1. **Focused entity**: full file content loaded (frontmatter + body + relationships section) — the rich accumulated knowledge
2. **Related entities** (linked via edges): title frontmatter plus DB metadata (`label`, tags, summary) loaded without reading every file body — enough for the agent to decide which neighbors are relevant
3. **Deep load on demand**: agent determines which neighbors are relevant to the current query and loads their full content selectively

This maps to @bluewater8008's token budget levels:
- **L0** (~200 tokens): graph stats, recent activity — always loaded
- **L1** (~1-2K): entity title frontmatter plus DB metadata for the neighborhood
- **L2** (~2-5K): full body of the 3-5 relevant entity files — targeted load
- **L3** (5-20K): deep drill with source citations — on demand

Without this, a node with 30 relationships would require loading 30 full entity files into the agent's context. With it, the agent scans 30 titles plus DB metadata and deep-loads only the relevant files.

## 12. Out of Scope (Future Work)

- Resource node sidecar files (resources already have files; a summary `.meta.md` is a separate feature)
- FTS for entity file prose (full-text search via `note_search` or parallel table — MVP uses embeddings only)
- Agent-initiated prose enrichment (LLM-powered curation — turning edge bullet points into contextual prose, synthesizing across sources)
- Mutation journal system (SQLite log of all graph changes for audit/replay)
- Remote sync / collaborative editing
- Entity file templates (user-defined body schemas per label)
- In-app entity file editor (dedicated markdown editor tab within Synapse, beyond external editor support)
