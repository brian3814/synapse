# Design: Three-Layer Knowledge Model

**Status:** Proposed  
**Date:** 2026-04-06  
**Updated:** 2026-04-07  
**Context:** The extension's knowledge graph needs a model that blends Karpathy's LLM Wiki pattern (compounding prose artifacts) with our existing structured graph (typed entities, entity resolution, graph algorithms). This document defines the unified model.

**Scope:** URL-first, browser-native. Resources are webpages only. The database is the single source of truth. Markdown files are a one-direction export, never read back.

---

## Problem

Two approaches to personal knowledge management exist, each with a structural gap:

**Karpathy's LLM Wiki** treats resources as first-class citizens. The LLM reads sources and maintains a folder of interlinked markdown files. Relationships emerge from `[[wikilinks]]` in prose. This produces readable, compounding artifacts but has no formal structure: no typed relationships, no entity resolution, no graph algorithms, no deduplication layer. At scale, duplicate concepts accumulate, cross-referencing is brute-force (the LLM re-reads the entire wiki), and "what connects X to Y?" requires re-deriving the answer from prose every time.

**Our current graph** treats entities as first-class citizens. The LLM extracts typed nodes and edges into SQLite. Entity resolution (exact/alias/fuzzy) prevents duplicates. Graph algorithms compute centrality, clustering, and shortest paths. But the graph produces no human-readable output: knowledge is locked in database rows, not portable prose. There is no compounding prose artifact.

**The gap in both:** Karpathy has prose without structure. We have structure without prose. Neither alone delivers "queryable, visual, readable, compounding knowledge."

---

## Solution: Three-Layer Graph

One unified graph with three populations of nodes, each serving a distinct role. All nodes and edges live in the same `nodes` and `edges` SQLite tables. The "layers" are a conceptual organizing principle, not separate databases.

```
┌─────────────────────────────────────────────────────────┐
│  Entity Layer (ontological skeleton)                    │
│  Typed entities + typed relationships between them.     │
│  Entity resolution prevents duplicates.                 │
│  Graph algorithms operate here.                         │
│  DB-authoritative. .md is a rendered export.            │
└──────────────────────────┬──────────────────────────────┘
                           │ about / mention
┌──────────────────────────┼──────────────────────────────┐
│  Note Layer (prose content mesh)                        │
│  Granular content units attached to entities.           │
│  Notes link to each other forming their own graph.      │
│  User-organizable via folder hierarchy.                 │
│  DB-authoritative. .md is a rendered export.            │
└──────────────────────────┬──────────────────────────────┘
                           │ extracted_from
┌──────────────────────────┼──────────────────────────────┐
│  Resource Layer (immutable inputs)                      │
│  One node per ingested webpage.                         │
│  Immutable after creation. Has source_content record.   │
│  DB-authoritative. .md is a rendered digest.            │
└─────────────────────────────────────────────────────────┘
```

### Why three layers, not one flat graph

A flat graph (all nodes at one level) conflates three fundamentally different things:

1. **Resources** are immutable inputs with a fixed lifecycle. They represent "what I read" — a URL. They should never be modified by extraction or user edits.
2. **Entities** are evolving knowledge structures. They represent "what I know." They grow as sources accumulate. They need deduplication and typed relationships.
3. **Notes** are granular prose units. They represent "what was said about what I know." They are the user-editable surface. They carry data lineage back to sources.

Mixing these into one type creates confusion about mutability (can I edit a source?), authority (is the .md or the DB the truth?), and lifecycle (when does an entity get a page?). Three layers make each role explicit.

---

## Layer 1: Resource Nodes

**What they represent:** A webpage the user ingested.

**Scope restriction:** Resources are webpages only. No PDFs, no images. The browser is the resource acquisition engine — the content script captures page content directly. This narrows the problem space and plays to the extension's native strength.

**Lifecycle:** Created once during extraction. The resource node itself is never modified afterward. The `source_content` table stores versioned snapshots of the raw text — each extraction of the same URL creates a new snapshot, preserving history.

**Identity model:** One resource node per URL (stable identity via `resource/<url-slug>` identifier). Re-extracting a changed page reuses the same resource node but creates a new `source_content` snapshot keyed by `(url, extracted_at)`. Old snapshots are preserved for provenance.

**Creation:** Resource nodes are **system-owned, not LLM-dependent.** On every extraction merge, the system deterministically creates a resource node for the source URL if one doesn't exist. The LLM never outputs resource nodes — it only extracts entities and relationships. This guarantees the lineage chain is never broken.

**Properties:**

| Field | Value |
|---|---|
| `type` | `resource` |
| `name` | Page/article title |
| `source_url` | Original URL |
| `properties` | `{ domain, author, word_count, content_hash, ingested_at }` |

**Relationships:** Resource nodes do not have outbound edges to entities. The lineage chain flows Note → Resource (via `extracted_from`), not Resource → Entity. This keeps the resource layer passive — resources are referenced, not referencing.

**Export output:** `resources/<slug>.md` — a digest summarizing the resource content. Generated from DB on export.

---

## Layer 2: Entity Nodes

**What they represent:** A concept, person, organization, technology, event, place, or other domain object extracted from sources.

**Lifecycle:** Created during extraction. Updated when new sources add information (new edges, new properties). Subject to entity resolution — the system matches incoming entities against existing ones before creating new nodes.

### Node type vs label

The `type` field identifies the **structural layer** — three fixed values:

| `type` | Layer | Meaning |
|---|---|---|
| `resource` | Layer 1 | Immutable webpage input |
| `entity` | Layer 2 | Domain object (concept, person, technology, etc.) |
| `note` | Layer 3 | Prose content unit |

The `label` field provides **semantic categorization** for entities. Labels are user-extensible — the system seeds a default vocabulary, and users can add custom labels via settings.

Default labels seeded in `ontology_node_types`:

| Label | Description | Example |
|---|---|---|
| `concept` | Abstract idea, topic, field, theory | Machine Learning, Knowledge Compounding |
| `person` | Named individual | Andrej Karpathy, Geoffrey Hinton |
| `organization` | Company, institution, research group | Google Brain, OpenAI |
| `technology` | Tool, framework, language, protocol | Obsidian, GPT-4, wa-sqlite |
| `event` | Dated occurrence, release, discovery | ImageNet 2012, GPT-4 release |
| `place` | Geographic location | Silicon Valley, MIT |
| `methodology` | Process, workflow, design pattern | LLM Wiki, Agile, MapReduce |

The LLM assigns labels during extraction from this vocabulary. Unknown entities default to `concept`. Users can add custom labels (e.g., `paper`, `dataset`, `framework`) via the settings UI — each with a name, description, and color.

**Why separate `type` and `label`:**
- Layer checks are clean: `WHERE type = 'entity'` (3 values, fixed forever) instead of `WHERE type NOT IN ('resource', 'note')` (fragile, breaks when labels grow)
- Labels are a user-facing customization surface. Types are an architectural invariant.
- Graph visualization uses `label` for entity node color (from `ontology_node_types.color`) and `type` for layer toggling

**Entity resolution** applies to all entities regardless of label: exact name match → alias match → fuzzy bigram match (threshold 0.7). This prevents duplicate nodes across sources.

### Entity-to-entity relationships

Edges between entities, stored in the `edges` table. The `edges` table has two semantic fields with distinct roles:

- **`label`** — the canonical relationship name. Drives dedup (`UNIQUE(source_id, target_id, label)`), querying, lineage traversal, and display. The LLM outputs this field. Examples: `subfield_of`, `about`, `extracted_from`.
- **`type`** — a broad category for visualization grouping (edge color/style). Auto-derived during merge by looking up `label` in `ontology_edge_types`. Not used for dedup or querying. Defaults to `'related'` for unknown labels.

The LLM assigns relationship labels from a seeded vocabulary in `ontology_edge_types`:

| Label | Category | Example |
|---|---|---|
| `subfield_of` | `hierarchical` | Neural Networks → Machine Learning |
| `created_by` | `attribution` | Transformer → Vaswani et al. |
| `used_in` | `semantic` | Self-Attention → Transformer |
| `builds_on` | `semantic` | BERT → Transformer |
| `contradicts` | `contrast` | Claim A → Claim B |
| `alternative_to` | `contrast` | LLM Wiki → RAG |
| `part_of` | `hierarchical` | Ingest Operation → LLM Wiki |
| `instance_of` | `hierarchical` | Claude Code → LLM Agent |
| `affiliated_with` | `attribution` | Karpathy → OpenAI |
| `enables` | `semantic` | qmd → Query Operation |
| `preceded_by` | `temporal` | Transformer → RNN |
| `about` | `semantic` | Note → Entity (primary) |
| `mention` | `semantic` | Note → Entity (secondary) |
| `extracted_from` | `provenance` | Note → Resource |
| `references` | `semantic` | Note → Note, Note → Resource |

Unknown relationship labels stay as `related` with category `related` (existing default). The lint agent can propose re-labeling `related` edges to specific labels.

### Entity .md files

An entity's .md file is a **synthesis + index** generated from the database. It has three sections:

```markdown
---
type: entity
label: person
aliases: ["Karpathy"]
sources: 3
notes: 5
---

# Andrej Karpathy

## Summary
[[Andrej Karpathy]] is an AI researcher who proposed the [[LLM Wiki]]
pattern for building persistent knowledge bases maintained by LLMs.
Previously at [[OpenAI]] and [[Tesla]], he is known for...
[Wikilinks in prose express entity relationships. No separate
Connections section — the Summary IS the connections, with context.]

## Notes
- [[Karpathy's vision and the Memex lineage]] — historical context
- [[LLM Wiki as practical Memex]] — core proposal
- [[Karpathy on knowledge compounding]] — key insight

## Sources
- "LLM Wiki" (gist.github.com, 2025)
- "Deep Learning for Computer Vision" (Stanford CS231n)
```

**Three sections only.** Summary (synthesized prose with `[[wikilinks]]`), Notes (index of attached note nodes), Sources (provenance list). No Connections section — entity-to-entity relationships are woven into the Summary prose, which is richer than a flat list.

**Two-tier .md generation:** Entity .md files use a tiered approach to control LLM cost:

- **Tier 1 (template, always runs):** Deterministic rendering — frontmatter, Notes index (list of attached notes), Sources list. Zero LLM cost. Runs on export for every entity that qualifies.
- **Tier 2 (LLM synthesis, threshold-based):** The Summary section is LLM-generated prose that weaves relationships into natural language. Auto-generated when an entity reaches **≥ 3 notes** attached via `about` edges, or when the user explicitly requests it. Below the threshold, the Summary section is omitted (Notes + Sources sections are sufficient).

The LLM-generated Summary is cached in a `summary` column on the `nodes` table to avoid re-generation on every export. The Summary is regenerated when: (a) new `about` notes are added to the entity, (b) entity-to-entity edges change, or (c) the user explicitly requests regeneration.

**When an entity gets a .md file on export:**
- Resource nodes: always (digest)
- Entity nodes: when they have >= 2 `about` notes OR the user explicitly requests it (mentions don't count — prevents broad entities from generating low-value pages from incidental references alone)
- Note nodes: always (the .md IS the note content)

**Authority:** The database is authoritative for all entity layer structure and content. The .md file is a rendered export. Editing an entity .md externally has no effect on the graph.

---

## Layer 3: Note Nodes

**What they represent:** A granular prose unit about one or more entities. Each note is a focused piece of knowledge (3-10 sentences) that can be traced back to its source.

**Lifecycle:** Created during extraction (by the LLM) or by the user (filing a chat answer, writing directly in the extension). Editable at any time in the extension UI. The database is authoritative.

**Properties:**

| Field | Value |
|---|---|
| `type` | `note` |
| `name` | Note title (globally unique across all notes) |
| `folder_path` | User-defined folder prefix (S3-style, default `''`) |
| `properties` | `{ created_at, extracted_from_source_id }` |

### Note name uniqueness

Note names are globally unique regardless of folder path. This eliminates wikilink ambiguity — `[[Transformer Overview]]` always resolves to exactly one note. Enforced via partial unique index:

```sql
CREATE UNIQUE INDEX idx_unique_note_name ON nodes(name) WHERE type = 'note';
```

This mirrors Obsidian's behavior (filenames are globally unique in a vault) and keeps wikilink resolution simple and deterministic.

**Collision mitigation for LLM-generated notes:** Auto-generated note titles risk collisions (e.g., "Architecture Overview" from two different articles). Three defenses:
1. **Prompt design:** The system prompt instructs source-specific titles — "Notion's SharedWorker architecture for multi-tab SQLite" not "Architecture Overview."
2. **Auto-suffix on collision:** If a title collides, the system appends the source domain: `"Architecture Overview (notion.com)"`. Deterministic, no user interaction.
3. **Existing title context:** The LLM receives a sample of recent note titles (~20) to avoid collisions naturally. Marginal token cost.

### Note folder hierarchy (S3-style)

Notes are stored flat in the `nodes` table. Users organize notes into a virtual folder hierarchy via the `folder_path` column, using `/` as the delimiter — the same pattern as AWS S3 object keys.

**How it works:**

```
node.type = 'note'
node.name = 'Transformer Overview'
node.folder_path = ''                   → notes/transformer-overview.md

node.type = 'note'
node.name = 'Attention Deep Dive'
node.folder_path = 'projects/ml'        → notes/projects/ml/attention-deep-dive.md
```

**Folder queries (prefix-based):**

```sql
-- List notes in a specific folder
SELECT * FROM nodes WHERE type = 'note' AND folder_path = 'projects/ml';

-- List notes recursively under a prefix
SELECT * FROM nodes WHERE type = 'note' AND folder_path LIKE 'projects/ml/%';

-- List top-level folders
SELECT DISTINCT
  CASE WHEN INSTR(folder_path, '/') > 0
    THEN SUBSTR(folder_path, 1, INSTR(folder_path, '/') - 1)
    ELSE folder_path
  END AS top_folder
FROM nodes WHERE type = 'note' AND folder_path != ''
UNION
SELECT path FROM note_folders
WHERE INSTR(path, '/') = 0;
```

**Extraction default:** Notes created by LLM extraction default to `folder_path = ''` (root of the notes directory). Users organize notes into folders after extraction via the extension UI.

**Empty folder markers:** A separate `note_folders` table stores user-created folders that may not yet contain notes (zero-byte marker pattern from S3):

```sql
CREATE TABLE IF NOT EXISTS note_folders (
    path       TEXT PRIMARY KEY,   -- e.g., 'projects/ml'
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
```

When a note is moved into a folder, the folder implicitly exists (from the note's `folder_path` prefix). The `note_folders` table only stores folders that the user explicitly created and that have no notes yet. When a note is added to a previously empty folder, the marker row can optionally be kept (for consistency) or cleaned up.

**Folder operations:**

| Operation | Implementation |
|---|---|
| Create folder | `INSERT INTO note_folders` |
| Rename folder | `UPDATE nodes SET folder_path = ...` (prefix replacement) + `UPDATE note_folders SET path = ...` |
| Delete folder | Move contained notes to root (`folder_path = ''`) + `DELETE FROM note_folders` |
| Move note to folder | `UPDATE nodes SET folder_path = 'target/path' WHERE id = ?` |

**Folder rename cascading:** Renaming a folder requires updating all notes with that prefix:

```sql
UPDATE nodes
SET folder_path = :new_prefix || SUBSTR(folder_path, LENGTH(:old_prefix) + 1)
WHERE type = 'note'
AND (folder_path = :old_prefix OR folder_path LIKE :old_prefix || '/%');

UPDATE note_folders
SET path = :new_prefix || SUBSTR(path, LENGTH(:old_prefix) + 1)
WHERE path = :old_prefix OR path LIKE :old_prefix || '/%';
```

This is a single SQL transaction, fast in SQLite. If an export folder is connected, the export renderer re-exports affected files (write new paths, delete old paths via FSFH).

### Note-to-entity edges: `about` vs `mention`

Every note connects to entities via two edge types with different semantics:

| Edge label | Meaning | Assigned by | Semantics |
|---|---|---|---|
| `about` | This note is primarily about this entity | LLM during extraction | **High Relevance.** Listed prominently in entity index "Notes" section. Primary weight (1.0) in RAG ranking. |
| `mention` | This note references but is not primarily about this entity | LLM during extraction, or wikilink parser | **Low Relevance.** Listed in collapsed "Also referenced in" section. Lower weight (0.5) in RAG ranking. |

**Why this distinction matters (Search & Scaling):**
Without this split, common entities (e.g., "Machine Learning") would be linked to every note that briefly mentions the field, "polluting" the entity page and diluting RAG search results. By distinguishing primary subjects (`about`), the system can prioritize "Core Knowledge" in queries, significantly improving search precision while maintaining full provenance for "Incidental Mentions" (`mention`).

**Assignment rules:**
- During extraction: the LLM designates 1-3 entities as `about` and the rest as `mentions` per note.
- During user editing: new wikilinks added by the user in the extension editor default to `mention`. The user can upgrade to `about` in the extension UI.

> **UI design note (deferred):** The extraction review UI must surface `about`/`mention` bindings on notes so users can verify and override the LLM's assignment. Each note card should display `about` entities as primary chips and `mentions` as secondary. Drag-to-reassign or click-to-toggle between `about` and `mention`. This should be designed alongside the ReviewNote type when implementing the review UI.

### Note-to-note edges

Notes form their own graph via edges that describe how content relates:

| Edge label | Meaning |
|---|---|
| `references` | This note cites or links to that note |
| `builds_on` | This note extends the analysis in that note |
| `contradicts` | This note disagrees with that note |
| `supersedes` | This note is a newer/more complete version |

These edges are distinct from entity-to-entity edges. Entity relationships describe the domain ("ML is a subfield of CS"). Note relationships describe knowledge flow ("this analysis extends that observation").

### Note-to-resource edges

Every note tracks its provenance:

| Edge label | Meaning |
|---|---|
| `extracted_from` | This note was generated from this resource during extraction |

User-created notes (filed chat answers, manual writing) have no `extracted_from` edge — their provenance is the user.

### Note attachments (images)

Notes extracted from articles may reference images — diagrams, charts, screenshots. A note about a SharedWorker architecture is a weaker prose unit if the architecture diagram from the source article isn't visible alongside it.

**Storage:** Image binaries are stored in OPFS under an `attachments/` directory, separate from wa-sqlite's database file. The UI thread accesses this via the async OPFS API (`navigator.storage.getDirectory()` → `attachments/`), which coexists with the DB worker's synchronous OPFS access to the `.db` file without conflict.

**Metadata table:**

```sql
CREATE TABLE note_attachments (
    id          TEXT PRIMARY KEY,
    note_id     TEXT NOT NULL REFERENCES nodes(id) ON DELETE CASCADE,
    filename    TEXT NOT NULL,
    mime_type   TEXT NOT NULL,
    source_url  TEXT,           -- original URL of the image (for re-fetch)
    created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_note_attachments_note ON note_attachments(note_id);
```

**Acquisition:** The offscreen document fetches images by URL (extracted by the content script). No cross-context binary transport needed — the content script sends image URLs as strings, the offscreen fetches the binary directly.

**Note content references:** Standard markdown image syntax: `![Architecture diagram](attachments/notion-sharedworker-arch.png)`. Obsidian renders this natively.

**Export:** When export-connected, the export renderer copies image files from OPFS to `<export-folder>/attachments/` via `FileSystemFileHandle` — the same API used for `.md` file export, just with binary content (`writable.write(blob)`).

### Note .md files

```markdown
---
type: note
about:
  - Transformer Architecture
  - Self-Attention
mentions:
  - Neural Networks
  - RNN
  - Vaswani et al.
extracted_from: karpathy-llm-wiki
created: 2026-04-06
---

# Multi-head attention mechanism

The core innovation of the [[Transformer Architecture]] is [[Self-Attention]],
which allows the model to attend to all positions in the input sequence
simultaneously rather than processing sequentially as in [[RNN]]-based
approaches. [[Vaswani et al.]] introduced multi-head attention, which runs
multiple attention functions in parallel...
```

**Authority:** The database is authoritative for all note content. The .md file is a rendered export. Editing a note .md externally has no effect on the graph.

---

## Authority Model

The database is the single source of truth for all layers. Markdown files are rendered exports — one-direction only, never read back.

| Layer | Authority | .md file role |
|---|---|---|
| Entity | DB | Rendered export (synthesis + index) |
| Note | DB | Rendered export (note content with frontmatter) |
| Resource | DB | Rendered export (digest, write-once) |

```
Entity layer:   DB ──→ .md   (one-way export)
Note layer:     DB ──→ .md   (one-way export)
Resource layer: DB ──→ .md   (one-way export, write-once digest)
```

**Why DB-authoritative for everything:** The target user ("lazy curious reader") interacts with knowledge through the extension UI — the side panel, the graph, the chat. They don't need to edit .md files in Obsidian to use the product. Markdown export is a portability feature: "your knowledge is not locked in." It is not the primary editing surface.

This eliminates:
- Bidirectional sync complexity
- Conflict detection and reconciliation
- External edit detection (poll-on-focus, fsnotify)
- Proposals queue for entity edits
- The native host's file-watching responsibility

---

## Wikilink Parser (Content → Edges)

A deterministic parser that creates graph edges from `[[wikilinks]]` in note content. The parser runs on note content within the extension — it does not read external files.

**Triggers:**
- Note created by LLM extraction (after content is stored in DB)
- Note edited in the extension's built-in editor
- Note created by user (filed chat answer, manual writing)

**Algorithm:**

```
1. Parse all [[wikilinks]] from the note content
2. Resolve each wikilink to a node ID via entity resolution:
   - Exact name match on nodes.name        → RESOLVED
   - Alias match on entity_aliases.alias_lower → RESOLVED
   - NO fuzzy matching (see safety rule below)
3. Get current edges FROM this note node in the database
4. Diff resolved wikilinks against current edges:
   - Wikilink present, no edge    → CREATE edge
   - Edge present, no wikilink    → REMOVE edge
   - Both present                 → no-op
5. For new edges, assign label based on target node's type:
   - Target type is 'note'     → 'references'
   - Target type is 'entity'   → 'mention' (default; 'about' set during extraction)
   - Target type is 'resource' → 'references'
6. Unresolved wikilinks (no matching node) → PENDING QUEUE:
   - Suggest fuzzy matches ("Did you mean [[X]]?") for user confirmation
   - Offer to create a new entity node
   - Badge on note: "2 unresolved links" — user clicks to review
```

**Safety rule: no fuzzy auto-edges.** The parser only creates edges for exact and alias matches. Fuzzy matches (bigram similarity ≥ 0.7) are unreliable for auto-linking — "Transfer Learning" and "Transformer" score ~0.72, which would create a wrong edge silently. Fuzzy candidates are surfaced in a pending queue for user confirmation, preserving the entity layer's review guarantee.

---

## Data Lineage

The three-layer model provides full traceability from any claim back to its resource. Relationships are many-to-many at every layer boundary — the lineage is a DAG, not a linear chain.

```
Entity: Transformer Architecture
  ← (about) ── Note₁: "Multi-head attention mechanism"
  │               ← (extracted_from) ── Resource: "Attention Is All You Need"
  ← (about) ── Note₂: "Transformer vs RNN comparison"
  │               ← (extracted_from) ── Resource: "Karpathy LLM Wiki"
  ← (mention) ── Note₃: "BERT training process"
                    ← (extracted_from) ── Resource: "BERT Paper"

Note₂ ── (references) ──→ Note₁   (note-to-note edge)

Query: "Where did I learn about multi-head attention?"
Answer: Note₁ "Multi-head attention mechanism", extracted from "Attention Is All You Need"
```

**Many-to-many at every boundary:**
- An entity can have many notes (via multiple `about`/`mention` edges)
- A note can be `about` multiple entities (1-3 primary entities per note)
- Notes reference other notes (via `references`, `builds_on`, `contradicts`, `supersedes`)
- A resource can have many notes extracted from it
- A note has at most one `extracted_from` resource (none if user-created)

### Node provenance: `entity_sources`

The existing `concept_sources` table is renamed to `entity_sources` (matching the `type = 'entity'` model) and redesigned as a denormalized cache for fast RAG lookups and ranking:

```sql
entity_sources (
  entity_id       TEXT NOT NULL REFERENCES nodes(id) ON DELETE CASCADE,
  resource_id     TEXT NOT NULL REFERENCES nodes(id) ON DELETE CASCADE,
  relation_type   TEXT NOT NULL DEFAULT 'about',  -- 'about' | 'mention'
  PRIMARY KEY (entity_id, resource_id, relation_type)
)
```

The PK includes `relation_type` so the same entity-resource pair can have both an `about` and a `mention` row — one note may be *about* entity X from resource R while another *mentions* it. Both rows survive independently.

**Why keep the table:** While the two-hop JOIN is possible, a materialized view with `relation_type` allows the RAG pipeline to perform **weighted retrieval** in a single indexed query. The table is maintained automatically via SQLite triggers or the extraction merge logic:
- Note → Resource (`extracted_from`) + Note → Entity (`about`) => `entity_sources(entity, resource, 'about')`
- Note → Resource (`extracted_from`) + Note → Entity (`mention`) => `entity_sources(entity, resource, 'mention')`

Both relation types are tracked. The distinction drives ranking, not inclusion:

| Use case | `about` | `mention` |
|---|---|---|
| Entity index "Notes" section | Listed prominently | Listed in collapsed "Also referenced in" |
| RAG query relevance | Weight: 1.0 | Weight: 0.5 |
| Entity page generation threshold | Counted toward "≥ 2 `about` notes" | **Not counted** |
| Resource count display | Shown in primary count | Shown in secondary count or combined total |

This ensures provenance is never lossy. An entity frequently mentioned but rarely primary still accumulates lineage and surfaces in queries — just at lower priority than entities a note is directly about. However, only `about` notes count toward the page generation threshold, preventing broad entities from generating low-value pages from incidental references alone.

### Edge provenance: `edge_sources`

Entity-to-entity edges (e.g., `subfield_of`, `created_by`) need their own provenance tracking. The `UNIQUE(source_id, target_id, label)` constraint means only one edge exists per relationship — but multiple notes or extractions may confirm the same relationship. Without tracking, only the first extraction's provenance survives.

```sql
CREATE TABLE edge_sources (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    edge_id      TEXT NOT NULL REFERENCES edges(id) ON DELETE CASCADE,
    source_type  TEXT NOT NULL CHECK(source_type IN ('note', 'extraction', 'user')),
    source_id    TEXT,           -- node ID of the note (for 'note' type)
    resource_id  TEXT,           -- resource node ID (for 'extraction' type, notes OFF)
    created_at   TEXT NOT NULL DEFAULT (datetime('now')),
    UNIQUE(edge_id, source_type, source_id, resource_id)
);
CREATE INDEX idx_edge_sources_edge ON edge_sources(edge_id);
CREATE INDEX idx_edge_sources_note ON edge_sources(source_id) WHERE source_id IS NOT NULL;
```

**Three provenance paths for edges:**

| `source_type` | When | What's stored |
|---|---|---|
| `note` | Notes toggle ON; a note's prose expresses the relationship | `source_id` = note node ID. Resource reachable via note's `extracted_from` edge. |
| `extraction` | Notes toggle OFF; edge extracted directly from LLM JSON | `resource_id` = resource node ID. Direct provenance without note intermediary. |
| `user` | User manually creates an edge in the extension UI | Both `source_id` and `resource_id` NULL. Provenance is the user. |

**On extraction merge:**
- Edge is new + notes ON → create edge + `INSERT INTO edge_sources (edge_id, source_type, source_id) VALUES (?, 'note', ?)`
- Edge is new + notes OFF → create edge + `INSERT INTO edge_sources (edge_id, source_type, resource_id) VALUES (?, 'extraction', ?)`
- Edge already exists → `INSERT OR IGNORE INTO edge_sources` (adds the new source without duplicating)

**What this enables:**
- "Where did I learn that Transformer is a subfield of Neural Networks?" → query `edge_sources` → get notes → read the prose evidence → follow `extracted_from` to resources
- Edge confidence signal: an edge sourced from 5 notes across 3 resources is more trustworthy than one from a single extraction
- Clean provenance deletion: if a note is deleted, its `edge_sources` entry is removed but the edge survives if other sources remain

**Replaces `edges.source_url`:** The `source_url` string field on edges is superseded by `edge_sources`. The string field is lossy (single URL, no FK, no multi-source). Existing `source_url` values can be migrated to `edge_sources` entries during the migration.

---

## Extraction Pipeline

Two modes, both ending in the same review → merge → wikilink parsing flow.

### Quick Extract (single pass)

One LLM call produces entities and relationships. Note generation is **togglable** — when enabled, the same call also produces prose notes.

```
User submits extraction prompt (notes toggle: on/off)
  → Content script fetches page content
  → LLM receives: system prompt (variant based on toggle) + page content + user prompt
  → LLM produces JSON:
      {
        nodes: [{ name, label, properties, aliases }],
        edges: [{ sourceName, targetName, label }],
        notes: [{ title, content, about: [...], mentions: [...] }]  // only if toggle on
      }
  → Entity resolution matches against existing graph
  → User reviews extraction results (+ notes if present)
  → Merge into database (entities + edges + note nodes)
  → System creates resource node for source URL (if not exists)
  → Wikilink parser runs on each new note (content → edges)
  → Export renderer writes .md files (if export-connected)
```

**Notes toggle:** Stored in settings (`chrome.storage.local`). When off, the system prompt omits note instructions and the `notes` field is absent from the JSON output — same as the current extraction schema. When on, the system prompt instructs the LLM to produce focused prose units (3-10 sentences each) with explicit `about`/`mentions` entity bindings. The Zod schema accepts `notes` as optional (`z.array(...).optional().default([])`).

**Implementation scope note:** The notes toggle is cross-cutting — it requires coordinated changes to: Zod extraction schema (`schema.ts`), system prompts, `buildDiffItems` diff logic, `proceedToReview` conversion, extraction review store (new `ReviewNote` type), review UI components, `applyReview` merge logic, and graph transforms. This should be implemented as a single coordinated feature, not incrementally.

### Deep Extract (two pass)

The agent tool loop extracts entities and relationships. Notes are generated in a follow-up pass with richer graph context:

```
Pass 1 — Entity extraction (existing agent loop):
  → Agent uses tools (get_page_content, query_selector, etc.)
  → Produces entities + relationships via save_entities tool
  → Entity resolution + review + merge into database

Pass 2 — Note generation (export renderer):
  → Reads the merged graph state (new entities + neighborhoods)
  → Reads source content
  → Generates notes: focused prose units with about/mention bindings
  → Note nodes added to database
  → Wikilink parser runs on each new note (content → edges)
  → .md files written (if export-connected)
```

The two-pass approach for Deep Extract produces higher-quality notes because the note generation step has the full resolved graph context — it knows which entities were merged, what relationships were established, and what the entity neighborhood looks like.

---

## Export Renderer

A stateless function that generates .md files from database state. Replaces the "wiki maintenance agent" concept — no file-watching, no sync, no conflict resolution. Pure DB → .md rendering.

**Triggers:**
- After every extraction merge (incremental — only affected nodes)
- Manual "Re-export all" button (full — regenerates entire hierarchy)
- Folder rename (re-exports affected notes at new paths, deletes old paths)

### Tier 1: Template Rendering (always runs, no LLM)

Deterministic .md generation from database state. Zero token cost.

```
1. Identify affected nodes (new/modified from this extraction)
2. For each note node:
   → Render .md with frontmatter (about, mentions, extracted_from, folder_path)
   → Content comes from DB
3. For each affected entity with enough notes:
   → Template-render: frontmatter + Notes index + Sources list
   → Preserve existing Summary section if cached in DB
4. For each affected entity WITHOUT enough notes:
   → If >= 2 notes → generate new .md (template only)
5. Write resource digest .md (if new resource)
6. Generate index.md, append to log.md
7. Write all files to export folder via FSFH
```

### Tier 2: LLM Summary Synthesis (threshold-based)

An LLM pass that generates the Summary section for entity .md files.

**Triggers:** Runs when an entity reaches ≥ 3 `about` notes for the first time, or when the user explicitly requests summary regeneration.

**Process:**

```
1. Read graph neighborhood + all about notes for the entity
2. Generate Summary prose (wikilinks woven into natural language)
3. Cache Summary in nodes.summary column
4. Include Summary in next Tier 1 export
```

The LLM-generated Summary is cached in the `summary` column on the `nodes` table. It is regenerated when: (a) new `about` notes are added, (b) entity-to-entity edges change, or (c) the user explicitly requests it.

### Export path derivation

```ts
function nodeToExportPath(node: DbNode): string {
  if (node.type === 'resource') return `resources/${slugify(node.name)}.md`;
  if (node.type === 'note') {
    const prefix = node.folder_path ? `${node.folder_path}/` : '';
    return `notes/${prefix}${slugify(node.name)}.md`;
  }
  // Entities → label-named subdirectories
  return `entities/${pluralize(node.label)}/${slugify(node.name)}.md`;
}
```

### Exported folder structure

```
<user-selected-folder>/
├── resources/
│   ├── attention-is-all-you-need.md       ← resource digest
│   ├── bert-pre-training.md
│   └── karpathy-llm-wiki.md
├── entities/
│   ├── concepts/
│   │   ├── machine-learning.md            ← entity index
│   │   ├── knowledge-compounding.md
│   │   └── self-attention.md
│   ├── people/
│   │   ├── andrej-karpathy.md
│   │   └── geoffrey-hinton.md
│   ├── technologies/
│   │   ├── transformer.md
│   │   └── obsidian.md
│   └── organizations/
│       └── google-brain.md
├── notes/
│   ├── transformer-core-architecture.md   ← root-level note (default)
│   ├── multi-head-attention-mechanism.md
│   ├── inbox/                             ← user-created empty folder (marker)
│   └── projects/
│       └── ml/
│           ├── attention-deep-dive.md     ← user-organized note
│           └── rag-vs-llm-wiki.md
├── index.md                                ← auto-generated catalog
└── log.md                                  ← append-only history
```

Entity .md files are organized by label subdirectory. Note .md files follow the user-defined `folder_path` hierarchy. Resource digests are in their own directory.

---

## Note Folder UI

The extension provides a simple folder browser in the side panel for organizing notes into the hierarchy.

**Core interactions:**
- **Create folder:** User creates a named folder (stored as zero-byte marker in `note_folders`)
- **Move note:** Drag note to folder, or select folder from a dropdown. Updates `folder_path` on the node.
- **Rename folder:** Cascading prefix update on all contained notes + subfolders
- **Delete folder:** Moves contained notes to root (`folder_path = ''`), removes marker

**Display:** Tree view alongside the graph. Notes at root appear at the top level. Folders expand/collapse. The tree is a file-organization view — it does not represent graph relationships.

**Interaction with graph:** The graph and the folder tree are independent views of the same notes. The graph shows knowledge topology (about/mention/references edges). The folder tree shows user organization. A note's folder has no effect on its graph position, edges, or relationships.

---

## Storage Architecture

SQLite (wa-sqlite on OPFS) is the **single source of truth** for all graph structure, content, and organization. No OPFS file layer beyond wa-sqlite's own .db persistence.

### Two-state model

```
┌──────────────────────────────────────────────────────────┐
│  graph-only (default)                                    │
│  DB has all data. No .md files anywhere.                 │
│  Full graph, extraction, search, visualization.          │
└────────────┬─────────────────────────────────────────────┘
             │ User connects folder (showDirectoryPicker)
             ▼
┌──────────────────────────────────────────────────────────┐
│  export-connected                                        │
│  Extension writes .md via FSFH on extraction merge.      │
│  One-direction only. Never reads back.                   │
│  Manual "Re-export all" button available.                │
└──────────────────────────────────────────────────────────┘
```

Transitions are reversible: disconnect → back to `graph-only`. The export renderer only writes .md files when `export-connected`. In `graph-only` mode, everything works identically — graph, search, visualization, extraction.

### Why DB stores all content

Storing all content in SQLite:
- Enables **FTS5 search** across all content types from a single query
- Provides a **complete experience** without connecting a folder — the extension is fully functional in graph-only mode
- Avoids a separate content store (no OPFS file tree to manage alongside SQLite)
- SQLite handles personal-graph scale (~15 MB total) without issue

### Per-session reconnect

After a browser restart, the user must click "Reconnect" (triggers `requestPermission()` on the stored `FileSystemDirectoryHandle`). One click, one prompt, once per session. After that, `getFileHandle(name, { create: true })` and `createWritable()` require no additional prompts — bulk .md file generation is silent.

---

## Graph Visualization Implications

The three-layer model affects how the graph is rendered:

**Default view:** Entity layer only. Entities and their typed relationships. Clean, navigable. This is the "what do I know?" view.

**Expanded view:** Entity layer + note layer. Notes appear as smaller nodes attached to their `about` entities. Note-to-note edges visible. This is the "what have I read about what I know?" view.

**Resource view:** All three layers. Resources appear connected to notes via `extracted_from`. This is the "where did this knowledge come from?" view.

**Layer toggling:** The UI provides toggles to show/hide each layer. The default is entity-only for clarity. Users drill into notes and sources when they need detail or lineage.

**The graph visualization always reads from the database.** It works identically with or without an export folder connected.

---

## Reading List Integration

The existing reading list feature (reads items from the Chrome reading list, allows users to pick items for extraction) maps to the three-layer model:

**Each reading list merge produces:**
1. A `resource` node (immutable input — the webpage URL)
2. Entity nodes + edges (via extraction, same as today)
3. Note nodes (if notes toggle is on) with `extracted_from` edges to the resource
4. Source content saved to `source_content` table

The existing `ReadingListItem` fields map naturally:
- `summary` → becomes a note node with `about` edges to the top entities
- `keyTopics` → map to entity names for entity resolution
- `extractedNodes` / `extractedEdges` → entity + edge creation (unchanged)
- `pageContent` → saved to `source_content` (unchanged)

The `reading_list_history` table is preserved for tracking which URLs have been processed. It is not part of the three-layer graph — it is an operational log.

---

## Edge Deduplication

The current extraction review flow (`buildDiffItems`) deduplicates nodes via entity resolution but marks all edges as `action: 'add'` with no dedup. The `UNIQUE(source_id, target_id, label)` constraint catches exact duplicates at the DB level, but near-duplicates (same endpoints, different labels like `related` vs `related_to`) slip through.

**Dedup strategy for the review flow:**

```
For each extracted edge:
  1. Resolve source and target names to node IDs (via nameToTempId map or entity resolution)
  2. Check existing edges: does an edge with the same (source_id, target_id, label) exist?
     → Yes: mark as 'skip' (already exists)
  3. Check near-dupes: does an edge with the same (source_id, target_id) but different label exist?
     → Yes: mark as 'merge' with the existing edge shown for user review
     → User can keep existing label, use new label, or keep both
  4. Otherwise: mark as 'add'
```

This is applied during `proceedToReview()` so near-duplicate edges are visible in the review UI before merge.

---

## How This Blends Karpathy's Model with Ours

| Concern | Karpathy (prose-only) | Ours (structure-only) | Blended (this design) |
|---|---|---|---|
| **Knowledge storage** | .md files | SQLite (nodes/edges) | SQLite for everything. .md files are portable exports. |
| **Entity resolution** | LLM judgment (fragile) | Algorithmic (exact/alias/fuzzy) | Algorithmic |
| **Relationships** | `[[wikilinks]]` in prose (untyped) | Typed edges in DB | Typed edges in DB, expressed as prose in exported .md |
| **Compounding** | Every ingestion updates 10-15 pages | Graph grows, no prose output | Graph grows AND .md exports are regenerated |
| **Readability** | .md files readable in Obsidian | Knowledge locked in DB | Exported .md files readable in Obsidian |
| **Querying** | Search wiki text | RAG + graph traversal + FTS | RAG + graph traversal + FTS |
| **Graph algorithms** | Not possible (no formal graph) | Centrality, clustering, paths | Centrality, clustering, paths (on entity layer) |
| **User editing** | Edit .md directly | Edit through extension UI | Edit through extension UI. Export reflects edits. |
| **Data lineage** | Implicit (source pages exist) | entity_sources table | Full chain: Entity ← Note ← Resource (two-hop edge traversal) |
| **Portability** | .md files ARE the data | Export required | One-click export to Obsidian-compatible vault |
| **Note organization** | Flat or manual folders | N/A | S3-style folder hierarchy, user-controlled |

The graph is the ontological middle layer that Karpathy's model lacks. The notes are the prose surface that our current model lacks. Together they deliver what neither can alone: queryable, visual, readable, compounding knowledge — with one-click export to a portable .md vault.

---

## Schema Changes

This design is additive against the existing schema. Key changes:

| Change | Type | Details |
|---|---|---|
| Collapse `nodes.type` to 3 values | Migration | Migrate existing types: `concept` → `entity` (with `label = 'concept'`), `resource` stays, `note` stays. All other semantic types → `type = 'entity'` with corresponding `label`. |
| Add `label` column to `nodes` | Migration | `TEXT`, nullable. Semantic categorization for entities. References `ontology_node_types`. Resources and notes don't need a label. |
| Repurpose `ontology_node_types` | Migration | Now stores the entity label vocabulary (not structural types). Seed: `concept`, `person`, `organization`, `technology`, `event`, `place`, `methodology`. Each with description, color, `is_default` flag. Users add custom labels here. |
| Expanded `ontology_edge_types` | Migration | Seed labels with categories: `subfield_of` (hierarchical), `created_by` (attribution), `about` (semantic), `extracted_from` (provenance), etc. Add `category` column. |
| Add `summary` column to `nodes` | Migration | Cache LLM-generated entity summaries (`TEXT`, nullable) |
| Add `folder_path` column to `nodes` | Migration | `TEXT NOT NULL DEFAULT ''`. S3-style prefix for note hierarchy. |
| Add unique note name index | Migration | `CREATE UNIQUE INDEX idx_unique_note_name ON nodes(name) WHERE type = 'note'` |
| Add `note_folders` table | Migration | Zero-byte markers for empty user-created folders. `path TEXT PRIMARY KEY`. |
| Rename `concept_sources` → `entity_sources` | Migration | PK changed to `(entity_id, resource_id, relation_type)` to allow both `about` and `mention` rows per pair. Column `concept_id` → `entity_id`. |
| Add `edge_sources` table | Migration | Edge provenance tracking. Surrogate INTEGER PK + UNIQUE(edge_id, source_type, source_id, resource_id). Maps edges to notes, resources, or user actions. Replaces `edges.source_url`. |
| Version `source_content` snapshots | Migration | Change unique key from `url` to `(url, extracted_at)`. `INSERT` instead of `INSERT OR REPLACE`. |
| Add `note_attachments` table | Migration | Image attachment metadata. `id`, `note_id`, `filename`, `mime_type`, `source_url`. Binary data in OPFS `attachments/` directory (async API, separate from DB worker's sync OPFS). Exported to `<export-folder>/attachments/` via FSFH. |
| System-owned resource creation | Code | `applyReview()` deterministically creates resource node before entity/edge passes. LLM prompts must NOT output resource nodes. |
| Edge `label` vs `type` semantics | Convention | `label` = canonical relationship name (drives dedup/queries). `type` = auto-derived category for visualization (from `ontology_edge_types`). |
| `about` / `mention` edge labels | Convention | Used on note-to-entity edges, assigned during extraction |
| `extracted_from` edge label | Convention | Used on note-to-resource edges, assigned during extraction |
| Notes toggle setting | `chrome.storage.local` | `extractionNotesEnabled: boolean` (default: `false`) |
| FTS5 expansion | Migration | New FTS5 index (or expanded triggers) covering `source_content.content` for note/resource content search. |
| YAML frontmatter parser | Prerequisite | Replace flat `key: value` parser in `markdown-parser.ts` with real YAML parser (`yaml` or `gray-matter` npm package). Required for structured frontmatter round-trip (about/mentions arrays). |

---

## Architecture Decisions Log

| # | Decision | Resolution | Rationale |
|---|---|---|---|
| 1 | Entity Summary generation | Threshold-based: auto at ≥3 `about` notes, template-only below | Controls LLM cost. Quick Extract stays cheap. Summaries are cached in `nodes.summary`. |
| 2 | `entity_sources` table (was `concept_sources`) | Renamed. PK `(entity_id, resource_id, relation_type)` — allows both `about` and `mention` rows per entity-resource pair. | Prevents lossy collapse when the same entity is `about` in one note and `mention` in another from the same resource. Enables weighted RAG retrieval in a single indexed query. |
| 3 | Quick Extract notes | Togglable. Off = current schema. On = adds `notes[]` to LLM output. | Gives users immediate prose output without forcing token cost on every extraction. Cross-cutting: touches ~8 files. |
| 4 | Wikilink parser edge creation | Exact + alias matches only. Fuzzy → pending queue. | Fuzzy at 0.7 creates wrong edges silently (e.g., "Transfer Learning" ↔ "Transformer"). Preserves entity layer review guarantee. |
| 5 | `source` vs `resource` naming | Keep `resource`. | Zero migration. Already seeded in `ontology_node_types`. |
| 6 | Resource scope | Webpages only. No PDF, no image. | Browser-native focus. Content script captures pages directly. Narrows problem space, plays to extension's strength. |
| 7 | File authority model | DB-authoritative for everything. .md files are one-direction exports. | Target user interacts via extension UI, not external editors. Eliminates bidirectional sync, conflict detection, proposals queue. |
| 8 | Storage states | Two states: `graph-only` → `export-connected`. | Removed `synced` state (required native host fsnotify). Export-only means no file-watching needed. |
| 9 | Note organization | S3-style `folder_path` column with `/` delimiter. Globally unique note names. | Flat storage in DB, virtual hierarchy from prefix. No wikilink ambiguity (unique names). User organizes after extraction. |
| 10 | Empty folders | Zero-byte markers in `note_folders` table. | Better UX than emergent-only folders. Users can pre-create organizational structure. |
| 11 | `about`/`mention` review UX | Deferred to UI implementation phase. | Design doc notes the requirement. ReviewNote type + about/mention editing designed alongside review UI. |
| 12 | Resource identity model | One node per URL (stable). Versioned `source_content` snapshots. | Re-extracting a changed page preserves history. System-owned creation guarantees lineage chain. |
| 13 | Edge `label` vs `type` | `label` = canonical (dedup, queries). `type` = auto-derived category (visualization). | `label` is already in UNIQUE constraint. `type` repurposed as grouping for edge color/style. LLM only outputs `label`. |
| 14 | Reading list integration | Each merge creates resource + entities + optional notes. | Maps naturally to three-layer model. `summary` and `keyTopics` become note/entity candidates. |
| 15 | Wikilink parser scope | Content → edges only. Triggered by note creation/editing in extension. | No file → DB direction (export-only). Parser still creates the note graph from `[[wikilinks]]` in note content. |
| 16 | Note folder UI | Simple tree view in side panel. Create/rename/delete folders, drag-to-organize. | Independent from graph view. Folder hierarchy is organizational, not topological. |
| 17 | Node `type` vs `label` | `type` = structural layer (3 fixed values: `resource`, `entity`, `note`). `label` = semantic categorization (user-extensible). | Clean separation. Layer checks are `WHERE type = 'entity'` (stable). Labels are a customization surface. Graph viz uses `label` for color, `type` for layer toggling. |
| 18 | Edge provenance | `edge_sources` table with surrogate INTEGER PK + UNIQUE constraint. Tracks notes, extractions, and user actions per edge. Replaces `edges.source_url`. | Surrogate key avoids SQLite's no-expression-PK limitation. Many-to-many: multiple notes/extractions can confirm the same edge. Enables edge confidence signals and full provenance queries. |
| 19 | Image attachments | Metadata in `note_attachments` table, binary data in OPFS `attachments/` directory (async API, separate from DB worker's sync OPFS). | Notes referencing source article images are incomplete prose units without them. OPFS is the right store for binary assets (not SQLite BLOBs). Exported to `attachments/` folder via FSFH. |
| 20 | Entity page generation threshold | Only `about` notes count toward "≥ 2 notes" Tier 1 threshold. Mentions do not count. | Prevents broad entities (e.g., "Machine Learning") from generating low-value pages from incidental references alone. Preserves the `about`/`mention` distinction's noise-reduction purpose. |
| 21 | Note title collision mitigation | Unique constraint kept. LLM prompted for source-specific titles. Auto-suffix with domain on collision. | Uniqueness is load-bearing for wikilink resolution. Collision risk manageable with prompt design + deterministic fallback. |
