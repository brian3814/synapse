# Plan: Graph-Aware Embeddings — Eval-First, Opt-In Strategy

## Context

Synapse embeds each node independently — just its own name/label/summary. The embedding doesn't encode the node's position in the graph. When a node is renamed or an edge is added/removed, neighboring nodes' embeddings become stale.

Before committing to graph-aware embeddings, we need to **measure** whether including neighbor context actually improves semantic search. The implementation is **opt-in**: users choose `basic` (current) or `graph-aware` via settings. Eval cases run first to establish a baseline, then again after implementation to compare.

This also fixes a pre-existing gap: edge mutations don't trigger any embedding updates, and `notes:write` doesn't re-embed the note node.

## Files to Modify

1. `evals/cases/semantic-*.md` (4 new) — eval cases for semantic search quality
2. `src/embeddings/types.ts` — add `embeddingStrategy` to config
3. `src/ui/components/settings/EmbeddingSettings.tsx` — strategy selector UI
4. `electron/embeddings/build-embedding-text.ts` — direction-aware neighbor context
5. `electron/embeddings/embedding-queue.ts` — queue deduplication
6. `electron/embeddings/embedding-service.ts` — cascade fan-out, edge/batch handlers
7. `electron/main.ts` — edge mutation forwarding, mutation.execute, notes:write re-embed
8. `electron/mcp/mcp-server-bridge.ts` — pass `collectedNodeIds`/`collectedEdgeIds` to callback

## Implementation Order

```
Phase 0: Eval cases (no code deps, write first)
Phase 1: Config type + UI toggle (embeddingStrategy field)
Phase 2: buildEmbeddingText strategy branching
Phase 3: Queue dedup + cascade re-embedding (gated on graph-aware)
Phase 4: main.ts wiring (edges, mutation.execute, notes:write)
Phase 5: Run eval comparison (basic vs graph-aware)
```

---

## Phase 0: Eval Cases

Four new files in `evals/cases/`. Each creates a known graph, queries with `semantic_search` and `find_similar_entities`, and grades results via LLM-as-judge. Follow existing case format (see `evals/cases/rag-search-quality.md` for structure).

All use prefix `SemEval-{A..D}-` for test data isolation and cleanup.

### Case A: `semantic-relational-discovery.md`
**Category:** `semantic-search` | **Requires:** `[synapse-mcp, allow-write, embeddings]`

Create 5 entities with sparse labels + 5 relationship edges. Query for relationships using natural language:
- "Who leads the research project?" → should find entity connected via `leads` edge
- "technology company developing a framework" → should find org connected to project/tech via edges
- "mentor and mentee relationship" → should find persons connected via `reports_to` edge

**What it measures:** Can semantic search surface nodes based on their relationships (edge labels + neighbor names) rather than just their own descriptions?

### Case B: `semantic-note-crossref.md`
**Category:** `semantic-search` | **Requires:** `[synapse-mcp, allow-write, embeddings]`

Create 3 concept entities + 1 note with `[[wikilinks]]` to them. Query for entity topics:
- "chloroplast research experiments" → note mentions chloroplast but never says "research experiments"
- "carbon fixation pathway studies" → note links to Calvin Cycle entity (which has "carbon fixation" in its label)
- "photosynthesis" → baseline, direct keyword match

**What it measures:** Do notes that `[[link to]]` entities become discoverable when querying about those entities' topics?

### Case C: `semantic-disambiguation.md`
**Category:** `semantic-search` | **Requires:** `[synapse-mcp, allow-write, embeddings]`

Create two "Mercury" entities with different graph neighborhoods (planet vs element). Query for context:
- "planets orbiting the sun" → should rank Mercury (Planet) higher (neighbors: Solar System, Venus)
- "heavy metals and chemical elements" → should rank Mercury (Element) higher (neighbors: Periodic Table, Gold)
- "mercury" → ambiguous baseline, both should appear

**What it measures:** Can graph context disambiguate nodes with similar names?

### Case D: `semantic-baseline-regression.md`
**Category:** `semantic-search` | **Requires:** `[synapse-mcp, allow-write, embeddings]`

Create 4 nodes with rich labels, NO edges. Query with paraphrased descriptions:
- "AI learning from data" → Machine Learning
- "container deployment automation" → Kubernetes
- "global warming and weather" → Climate Change
- "editing genes in organisms" → CRISPR

**What it measures:** Does graph-aware strategy degrade basic semantic search when nodes have no edges? (Should score equally for both strategies.)

---

## Phase 1: Config Type + UI Toggle

### `src/embeddings/types.ts`

Add `embeddingStrategy` to `EmbeddingConfig`:
```typescript
export interface EmbeddingConfig {
  // ... existing fields ...
  embeddingStrategy: 'basic' | 'graph-aware';
}

export const DEFAULT_EMBEDDING_CONFIG: EmbeddingConfig = {
  // ... existing defaults ...
  embeddingStrategy: 'basic',
};
```

### `src/ui/components/settings/EmbeddingSettings.tsx`

Add a strategy selector inside the `{config.enabled && (<>...</>)}` block, after the Provider section (line ~130, before the status indicator). Two radio buttons:

- **Standard** (`basic`): "Embeds each node using its name, label, and summary."
- **Graph-Aware** (`graph-aware`): "Includes neighbor names and edge labels. Better for relationship queries. Triggers full re-embed."

Switching strategy uses a confirmation dialog (reuse the existing `confirmSwitch` pattern — add a `confirmStrategySwitch` state). On confirm, calls `handleSave({ embeddingStrategy: newValue })`.

### `electron/embeddings/embedding-service.ts` — `configure()` method

Add strategy change as a re-embed trigger alongside `providerChanged`:
```typescript
const strategyChanged = oldConfig.embeddingStrategy !== this.config.embeddingStrategy;
if (!oldConfig.enabled || providerChanged || strategyChanged) {
  // existing: drop vec table, delete metadata, re-activate, batch re-embed
}
```

---

## Phase 2: `buildEmbeddingText` Strategy Branching

### `electron/embeddings/build-embedding-text.ts`

Add strategy parameter to function signature:
```typescript
export function buildEmbeddingText(
  node: { ... },
  db: Database.Database,
  readNote?: (nodeId: string) => string | null,
  strategy: 'basic' | 'graph-aware' = 'basic',
): string
```

Extract new helper with **direction-aware formatting**:
```typescript
function getNeighborContext(db: Database.Database, nodeId: string, limit = 8): string {
  const rows = db.prepare(`
    SELECT n.name AS neighbor_name, e.label AS edge_label,
           CASE WHEN e.source_id = ? THEN 'out' ELSE 'in' END AS direction
    FROM edges e
    JOIN nodes n ON n.id = CASE WHEN e.source_id = ? THEN e.target_id ELSE e.source_id END
    WHERE (e.source_id = ? OR e.target_id = ?)
    ORDER BY n.id
    LIMIT ?`
  ).all(nodeId, nodeId, nodeId, nodeId, limit) as Array<{
    neighbor_name: string; edge_label: string | null; direction: 'in' | 'out';
  }>;
  if (rows.length === 0) return '';
  return rows.map(r => {
    if (!r.edge_label) return r.neighbor_name;
    // Arrow prefix encodes direction: →manages Bob = "this node manages Bob"
    //                                  ←manages Alice = "Alice manages this node"
    const arrow = r.direction === 'out' ? '→' : '←';
    return `${r.neighbor_name} (${arrow}${r.edge_label})`;
  }).join(', ');
}
```

**Why direction matters:** Without it, `Alice → manages → Bob` produces `Bob (manages)` for Alice and `Alice (manages)` for Bob — same label, opposite meaning. With arrows, Alice gets `Bob (→manages)` and Bob gets `Alice (←manages)`, giving the embedding model correct semantic signal about each node's role in the relationship.

**Entity branch:** When `strategy === 'graph-aware'`, append `[related] {neighbors}` after name/label/summary. When `basic`, keep existing edge-label fallback for name-only nodes.

**Note branch:** When `graph-aware`, append `[mentions] {neighbors}` after base text.

**Resource branch:** When `graph-aware`, append `[entities] {neighbors}` after base text.

**Callers** (both in `embedding-service.ts`): pass `this.config.embeddingStrategy` as the 4th arg to `buildEmbeddingText`.

---

## Phase 3: Queue Dedup + Cascade Re-Embedding

### `electron/embeddings/embedding-queue.ts` — deduplication

Add `pendingIds: Set<string>`. In `enqueue()`: if nodeId already pending, find and replace its text in the queue array. In `drain()`: delete from `pendingIds` after shifting. In `handleNodeDeleted()`: also clean from `pendingIds` and queue array.

### `electron/embeddings/embedding-service.ts` — cascade

**`handleNodeMutation(nodeId, cascade = true)`**: After existing hash-check + enqueue, add cascade (gated on strategy):

```typescript
if (hashChanged && cascade && this.config.embeddingStrategy === 'graph-aware') {
  const neighborIds = this.db.prepare(
    `SELECT DISTINCT CASE WHEN source_id = ? THEN target_id ELSE source_id END AS nid
     FROM edges WHERE source_id = ? OR target_id = ?`
  ).all(nodeId, nodeId, nodeId).map((r: any) => r.nid);
  for (const nid of neighborIds) {
    await this.handleNodeMutation(nid, false); // cascade=false prevents recursion
  }
}
```

**`handleEdgeMutation(sourceId, targetId)`** — new method:
```typescript
async handleEdgeMutation(sourceId: string, targetId: string): Promise<void> {
  if (!this.config.enabled || !this.config.autoEmbed || !this.queue) return;
  if (this.config.embeddingStrategy !== 'graph-aware') return;
  await this.handleNodeMutation(sourceId, false); // cascade=false: edge IS the signal
  await this.handleNodeMutation(targetId, false);
}
```

**Critical:** `cascade=false` in `handleEdgeMutation` prevents infinite re-trigger loops during extraction merges (found by code review).

**`handleNodeMutationBatch(nodeIds)`** — new method for `mutation.execute`:
```typescript
async handleNodeMutationBatch(nodeIds: string[]): Promise<void> {
  if (!this.config.enabled || !this.config.autoEmbed || !this.queue) return;
  const seen = new Set<string>();
  for (const nodeId of nodeIds) {
    if (seen.has(nodeId)) continue;
    seen.add(nodeId);
    await this.handleNodeMutation(nodeId, false);
  }
}
```

---

## Phase 4: Main Process Wiring

### `electron/main.ts`

**4a: Pre-lookup edge endpoints before deletion** (~line 118, mirror `deletedFilePath` pattern):
```typescript
let deletedEdgeEndpoints: { source_id: string; target_id: string } | undefined;
if (action === 'edges.delete') {
  try {
    deletedEdgeEndpoints = getDb().prepare(
      'SELECT source_id, target_id FROM edges WHERE id = ?'
    ).get(params as string) as { source_id: string; target_id: string } | undefined;
  } catch {}
}
```

**4b: Edge mutation forwarding** (~line 170, after existing `node_deleted` handler):
```typescript
else if (eventType === 'edge_created' || eventType === 'edge_updated') {
  const edge = (outcome.syncEvent as any).edge;
  if (edge) embeddingService.handleEdgeMutation(edge.source_id, edge.target_id).catch(() => {});
} else if (eventType === 'edge_deleted' && deletedEdgeEndpoints) {
  embeddingService.handleEdgeMutation(
    deletedEdgeEndpoints.source_id, deletedEdgeEndpoints.target_id
  ).catch(() => {});
}
```

**4c: `mutation.execute` batch handling** (after embedding notification block):
```typescript
if (action === 'mutation.execute' && embeddingService && outcome.result) {
  const mutResult = outcome.result as { results?: Array<{ action: string; node?: { id?: string } }> };
  const nodeIds = (mutResult.results ?? [])
    .filter(r => (r.action === 'created' || r.action === 'merged') && r.node?.id)
    .map(r => r.node!.id as string);
  if (nodeIds.length > 0) embeddingService.handleNodeMutationBatch(nodeIds).catch(() => {});
}
```

**4d: Note content re-embedding** (~line 231, in `notes:write` handler, before `return`):
```typescript
if (embeddingService) embeddingService.handleNodeMutation(nodeId).catch(() => {});
```

**4e: MCP bridge embedding sync** — the chat agent is a primary mutation pathway. MCP tool calls (`create_node`, `create_edge`, etc.) use DataStore directly, bypassing `db:request` IPC, so embedding hooks never fire. Fix this by wiring `collectedNodeIds` (already computed by every tool but unused) through the `onGraphMutated` callback.

### `electron/mcp/mcp-server-bridge.ts`

Change the `onGraphMutated` callback signature in `McpBridgeOptions` to accept IDs:
```typescript
onGraphMutated?: (nodeIds?: string[], edgeIds?: string[]) => void;
```

In the `CallToolRequestSchema` handler, pass them through:
```typescript
if (!result.isError && WRITE_TOOL_NAMES.has(name)) {
  this.onGraphMutated?.(result.collectedNodeIds, result.collectedEdgeIds);
}
```

### `electron/main.ts` — update the `onGraphMutated` callback (~line 588)

```typescript
onGraphMutated: (nodeIds?: string[], edgeIds?: string[]) => {
  // Existing: broadcast reset to renderer windows
  const windows = BrowserWindow.getAllWindows();
  for (const win of windows) {
    win.webContents.send('db:sync', { type: 'reset' });
  }
  // NEW: trigger embedding updates for affected nodes
  if (embeddingService && nodeIds?.length) {
    embeddingService.handleNodeMutationBatch(nodeIds).catch(() => {});
  }
  // NEW: for edge mutations, look up endpoints and re-embed them
  if (embeddingService && edgeIds?.length) {
    for (const edgeId of edgeIds) {
      try {
        const edge = getDb().prepare('SELECT source_id, target_id FROM edges WHERE id = ?')
          .get(edgeId) as { source_id: string; target_id: string } | undefined;
        if (edge) embeddingService.handleEdgeMutation(edge.source_id, edge.target_id).catch(() => {});
      } catch {}
    }
  }
},
```

**Why this works:** `ToolResult.collectedNodeIds` and `collectedEdgeIds` are already populated by every write tool in `chat-tool-executor.ts` and passed through `BuiltinToolProvider`. The data is there — we're just wiring it to the embedding service.

---

## What We're NOT Doing

- **setImmediate deferral for hub nodes** — pre-optimization. Add only if profiling shows blocking.
- **CLIP embeddings** — separate feature, deferred.

---

## Verification

1. **Build**: `npm run build:electron` — no type errors
2. **Eval baseline**: Run `/eval-run semantic-search` with `embeddingStrategy: 'basic'`
3. **Manual test** (with `graph-aware` enabled):
   - Create Alice + Bob + edge → both should re-embed with neighbor context
   - Rename Bob → Robert → Alice should re-embed (neighbor context changed)
   - Delete edge → both re-embed
4. **Hash stability**: Node with 10+ neighbors. Add unrelated edge elsewhere → node should NOT re-embed
5. **No infinite cascade**: Extraction merge with 10+ entities → each node embeds at most twice
6. **Eval comparison**: Run `/eval-run semantic-search` with `graph-aware` → compare scores to baseline
7. **Regression check**: Case D scores should be equal or better with graph-aware
