# Design: Zettelkasten & Infinite Canvas in Synapse

This document analyzes how Synapse can absorb the principles behind Zettelkasten note-taking and infinite canvas tools (Heptabase, Muse, Scrintal) — not by copying their UIs, but by delivering the same outcomes through Synapse's unique primitives: the knowledge graph and LLM extraction pipeline.

---

## What These Techniques Actually Solve

### Zettelkasten (Obsidian, Logseq)

| Use Case | What Users Actually Do |
|---|---|
| **Atomic capture** | Write one idea per note, force clarity of thought |
| **Emergent structure** | Let connections surface organically rather than pre-filing into folders |
| **Retrieval** | Find ideas by following link chains, not searching folders |
| **Idea development** | Build arguments by connecting fleeting thoughts into refined notes |
| **Serendipity** | Discover unexpected connections between ideas |

Underlying principles:

1. Notes are **atoms**, not documents
2. **Links replace hierarchy** — no rigid folder tree
3. Notes have a **lifecycle**: fleeting → literature → permanent
4. **Structure notes** (Maps of Content) are emergent indexes, not pre-planned categories

### Infinite Canvas (Heptabase, Muse, Scrintal)

| Use Case | What Users Actually Do |
|---|---|
| **Spatial thinking** | Arrange ideas in 2D space to see relationships |
| **Project scoping** | Lay out all pieces of a project, see gaps |
| **Research synthesis** | Cluster sources and extract themes visually |
| **Presentation prep** | Build narrative flow by spatial ordering |
| **Comparison** | Place alternatives side-by-side for evaluation |

Underlying principles:

1. **Spatial position encodes meaning** — proximity = relatedness
2. **Multiple views** of the same content for different contexts
3. **Freeform + structured** coexist on the same surface
4. Content is **visible at a glance**, not hidden behind click-to-open

---

## Current Architecture Assessment

### Zettelkasten Readiness

| Zettelkasten Need | Status | Details |
|---|---|---|
| Atomic notes | **Have it** | Notes are individual graph nodes, 1:1 with `.md` files |
| Inter-note linking | **Have it** | `[[wikilinks]]` create graph edges (`references`, `mention`) |
| Link-based discovery | **Have it** | Graph visualization IS the link-traversal UI |
| Entity resolution | **Better than Zettelkasten** | LLM fuzzy matching + aliases > manual linking |
| Auto-connection | **Unique advantage** | Extraction pipeline auto-discovers relationships |
| Note lifecycle | **Missing** | No fleeting/literature/permanent status |
| Backlinks panel | **Missing** | Edges exist in DB, no dedicated "referenced by" UI |
| Daily notes / quick capture | **Missing** | No inbox or temporal capture workflow |
| Structure notes / MOCs | **Missing** | No auto-generated index notes from graph clusters |

### Infinite Canvas Readiness

| Canvas Need | Status | Details |
|---|---|---|
| 2D spatial positioning | **Have it** | `x, y` persisted per node, OrthographicCamera |
| Pan/zoom | **Have it** | 0.001–1000x zoom, unconstrained pan |
| Efficient rendering | **Have it** | InstancedMesh, 2-3 draw calls, 5k+ nodes at 60fps |
| Node drag + persist | **Have it** | Pin/unpin in force layout, batch save to DB |
| Zoom-based detail levels | **Have it** | far/medium/close with cluster aggregation |
| Lasso multi-select | **Have it** | Shift+drag rectangle selection |
| Named views / workspaces | **Missing** | One global graph, no saved view subsets |
| Card content preview | **Missing** | Nodes are circles with labels, no inline content |
| Freeform placement mode | **Partial** | Force layout always runs; no "static canvas" toggle |
| Sections / visual groups | **Missing** | No container or region concept |
| Minimap | **Missing** | No overview navigator |

---

## The Synapse Advantage

The critical insight: **Synapse's extraction pipeline IS a Zettelkasten workflow, just not framed as one.**

**Obsidian** users manually build their Zettelkasten — write notes, manually add `[[links]]`, manually create MOCs. Most people abandon it within weeks because the overhead is enormous.

**Heptabase** users manually arrange cards on canvases — drag things around, manually group, manually create spatial meaning. Visual but still labor-intensive.

**Synapse automates the tedious parts.** The LLM extraction pipeline + knowledge graph already does entity resolution, relationship discovery, and structural analysis. The existing data flow maps directly to Zettelkasten concepts:

```
Content ingestion  →  Resource nodes   =  "literature notes" (source material)
LLM extraction     →  Entity + Edges   =  "permanent notes" (refined atomic ideas)
User notes         →  Note nodes       =  "fleeting notes" promoted to "permanent"
Graph clusters     →  (unsurfaced)     =  "structure notes" / MOCs (waiting to happen)
```

No other tool can do this. Obsidian users spend hours manually curating what Synapse's extraction pipeline produces automatically.

---

## Features to Absorb

### A. Backlinks Panel

**Problem it solves:** Zettelkasten discovery — "what references this idea?"

**Current state:** Edge data already exists (`SELECT * FROM edges WHERE target_id = ?`). No UI surfaces it.

**Implementation:**
- Sidebar section on the node detail panel showing "Referenced by" links
- Grouped by edge type (`references`, `mention`, `about`, `extracted_from`)
- Clickable — navigate to the referencing node
- Count badge on the panel tab

**Effort:** Small — query + UI component, no schema changes.

### B. Freeform Placement Toggle

**Problem it solves:** Spatial thinking — arrange ideas manually without force layout pulling them around.

**Current state:** Force layout always wants to run. Individual nodes can be pinned, but no global "static canvas" mode.

**Implementation:**
- Toggle in graph toolbar: "Force Layout" ↔ "Manual"
- Manual mode: `pin(allNodeIds)` — all nodes stay where placed
- New nodes placed at cursor or center, not random
- Per-view setting (once named views exist)

**Effort:** Small — UI toggle + batch pin logic. `pin`/`unpin` already implemented.

### C. Note Lifecycle (Status)

**Problem it solves:** Zettelkasten workflow — track note maturity from raw capture to refined thought.

**Current state:** Notes have no status/stage field. `properties` JSON supports arbitrary fields but no UI exposes this.

**Implementation:**
- Add `status` to note properties: `fleeting | literature | permanent`
- Visual indicator on graph: border style or subtle color tint per status
- Filter in notes panel: show only fleeting, only permanent, etc.
- LLM auto-suggestion: "This fleeting note has 5+ connections and was refined 3 times — promote to permanent?"
- Default new notes to `fleeting`

**Effort:** Small — property field + UI indicators + filter.

### D. Quick Capture → Extraction

**Problem it solves:** Frictionless entry point for new ideas — the Zettelkasten "slip box" inbox.

**Current state:** Creating a note requires opening the notes panel, clicking "New Note", filling in title and body.

**Implementation:**
- Global keyboard shortcut (e.g., `Cmd+N`) opens a minimal capture dialog
- Single text field — title optional, body required
- On save: creates fleeting note → triggers background extraction
- Extraction suggests entity connections → user reviews or auto-accepts
- Captured notes appear as a "fleeting" cluster on the graph

**Effort:** Small-Medium — modal UI + wiring to existing extraction pipeline.

### E. Named Views (Canvases)

**Problem it solves:** Multiple spatial arrangements of the same knowledge — "Research", "Project X", "Chapter 3 Outline" as separate thinking spaces.

**Current state:** One global graph with one set of positions. No way to create focused subsets.

**Implementation:**

New schema:
```sql
CREATE TABLE views (
  id          TEXT PRIMARY KEY,
  name        TEXT NOT NULL,
  description TEXT,
  camera_x    REAL DEFAULT 0,
  camera_y    REAL DEFAULT 0,
  camera_zoom REAL DEFAULT 1,
  layout_mode TEXT DEFAULT 'force',  -- 'force' | 'manual'
  created_at  TEXT NOT NULL,
  updated_at  TEXT NOT NULL
);

CREATE TABLE view_nodes (
  view_id  TEXT NOT NULL REFERENCES views(id) ON DELETE CASCADE,
  node_id  TEXT NOT NULL REFERENCES nodes(id) ON DELETE CASCADE,
  x        REAL,
  y        REAL,
  width    REAL,  -- for card preview sizing
  height   REAL,
  pinned   INTEGER DEFAULT 0,
  PRIMARY KEY (view_id, node_id)
);
```

Key design decisions:
- Nodes can appear on multiple views (many-to-many)
- Positions are per-view, independent of the global graph positions
- Each view has its own camera state and layout mode
- A "Global Graph" view always exists (uses the `nodes.x/y` columns)
- Views are vault-scoped — stored in the same `graph.db`

UI:
- View switcher in the graph toolbar (dropdown or tab bar)
- "Add to view" from node context menu or drag from global graph
- "Create view from selection" after lasso-selecting nodes

**Effort:** Medium — new tables, DataStore sub-interface, view-scoped renderer, view switcher UI.

### F. Card Content Preview

**Problem it solves:** Seeing content at a glance without click-to-open — the canvas advantage over graph views.

**Current state:** Nodes render as circles with text labels. No content visible on the graph surface.

**Implementation:**
- At `close` zoom level, render note/entity nodes as rectangular cards
- Card shows: title (bold), first 2-3 lines of content or summary, type badge
- Entity cards show: name, label, summary snippet
- Note cards show: title, first paragraph
- Resource cards show: title, source URL, extracted snippet
- At `medium` zoom: just title in a pill shape
- At `far` zoom: current circle behavior

Renderer approach:
- Canvas2D texture per card (similar to current label layer, but larger)
- Cache textures — regenerate only on content change
- `PlaneGeometry` per card with the texture, sized to content
- Hybrid: InstancedMesh for far/medium, individual planes for close (max ~50-100 visible at close zoom)

**Effort:** Medium — renderer changes, texture generation, zoom-level switching.

### G. Auto-Generated Structure Notes (MOCs)

**Problem it solves:** The "Map of Content" that Zettelkasten users spend hours curating — Synapse can generate them from graph structure.

**Current state:** Cluster aggregation exists in the renderer (type-based grouping at far zoom). No mechanism to turn clusters into navigable index notes.

**Implementation:**
- Detect dense clusters in the graph (connected components, community detection, or k-means on positions)
- LLM generates a structure note for each significant cluster:
  - Title: inferred from dominant entities/labels
  - Body: narrative summary of the cluster's theme
  - Links: `[[wikilinks]]` to each entity in the cluster
  - Metadata: auto-generated flag, cluster fingerprint for refresh detection
- Refresh on demand or when cluster composition changes significantly
- Displayed as a special node type or with a distinct visual treatment
- User can edit, pin, or dismiss auto-generated MOCs

**Effort:** Medium — cluster detection + LLM generation + note creation pipeline.

---

## What to Skip

These features don't align with Synapse's identity as an LLM-powered knowledge graph:

| Feature | Why Skip |
|---|---|
| Drawing / annotation tools | Excalidraw territory, not knowledge graph |
| Daily notes / journal templates | Overfitting to Obsidian ritual; quick capture covers the real need |
| Zettelkasten numbering (1a, 1a1) | Luhmann-era artifact, meaningless in a digital graph |
| Block-level linking (Logseq-style) | Note-level linking + entity extraction covers the use case |
| Slide / presentation mode | Feature creep; named views + export is sufficient |
| Kanban / table views | Project management, not knowledge management |

---

## Implementation Sequence

| Phase | Features | Rationale |
|---|---|---|
| **1** | Backlinks panel, Freeform placement toggle | Small effort, immediately unlocks Zettelkasten discovery and spatial thinking |
| **2** | Note lifecycle (status), Quick capture → extraction | Small effort, adds workflow structure and a frictionless entry point |
| **3** | Named views / canvases | Medium effort, biggest single feature for spatial thinkers — the "Heptabase moment" |
| **4** | Card content preview, Auto-generated MOCs | Medium effort, differentiates Synapse from everything else |

Phases 1–2 make Synapse competitive with Zettelkasten tools. Phase 3 transforms the product for spatial thinkers. Phase 4 is where Synapse becomes something neither Obsidian nor Heptabase can be: **a knowledge graph that does the Zettelkasten work for you**.

---

## Architectural Notes

None of these features require architectural changes to the existing system:

- **`@platform` abstraction** keeps all new features Electron-only without touching Chrome code
- **DataStore interface** is designed for adding new repository sub-interfaces (views, view_nodes)
- **`properties` JSON** on nodes already supports arbitrary fields (status, lifecycle metadata)
- **Graph renderer** zoom-level detection (`far/medium/close`) provides the hook for card previews
- **Extraction pipeline** already creates notes programmatically — auto-MOCs use the same path
- **Vault filesystem** handles note creation/update through existing `NoteFileHandler`
- **Force layout worker** already has `pin`/`unpin` — freeform mode is a batch pin operation
