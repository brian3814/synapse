# Graph Intelligence Tools Design

**Date**: 2026-06-07
**Status**: Draft
**Motivation**: Article analysis ("Your Obsidian Vault Is a Knowledge Graph") revealed that Synapse has graph algorithms implemented but not exposed as tools. The gap: agents (chat and MCP) cannot query centrality, orphans, clusters, bridges, or vault health. This spec adds intelligence tools, cross-domain synthesis, auto-entity-linking, and a feature toggle system.

## Summary of Gaps

| Feature | Algorithm exists? | UI? | MCP tool? | Chat tool? |
|---------|:-:|:-:|:-:|:-:|
| Centrality ranking | Yes (`degreeCentrality`) | Yes (IntelligencePanel) | No | No |
| Orphan detection | Partial (`detectPatterns` isolated_cluster) | Partial | No | No |
| Cluster analysis | Yes (`labelPropagation`) | Yes | No | No |
| Bridge/gap identification | Yes (`findGaps`) | No | No | No |
| Connection suggestions | Yes (`findConnectionSuggestions`) | Yes | No | No |
| Cross-domain synthesis | No | No | No | No |
| Vault health metrics | Partial (counts in `get_graph_overview`) | No | No | No |
| Auto-entity-linking | Partial (`EntityResolutionRepository.findMatches`) | No | No | No |

**Primary work is exposure, not invention** — wiring existing algorithms into tools and adding a few missing pieces.

## Architecture

Follows existing codebase patterns. No new frameworks or abstraction layers.

```
Existing algorithms (src/graph/algorithms/graph-algorithms.ts)
    |
    | imported by
    v
New intelligence-tools.ts (ToolModule)     <-- chat agent tools
    |
    | mirrored in
    v
packages/synapse-mcp/                      <-- MCP tools
    |
    | gated by
    v
VaultIntelligenceConfig (storage.json)     <-- feature toggles
    |
    | displayed in
    v
IntelligencePanel.tsx (enhanced)           <-- UI
```

### Key design decisions

1. **ToolModule pattern**: New `intelligence-tools.ts` follows the same `ToolModule` interface as `graph-tools.ts`, `entity-tools.ts`, etc. Registered in `src/commands/tools/index.ts`.
2. **Algorithm reuse**: All analytics tools call existing functions from `graph-algorithms.ts`. New algorithms are added to that file, not elsewhere.
3. **MCP mirroring**: Every chat tool gets a corresponding MCP tool with identical name and parameter schema.
4. **Feature toggles**: Vault-level config in `storage.json`, checked at tool registration time.

## 1. Feature Toggle System

### Type definition

Add to `src/shared/types.ts` (or a new `src/shared/intelligence-types.ts`):

```typescript
export interface VaultIntelligenceConfig {
  analytics: {
    enabled: boolean;
  };
  synthesis: {
    enabled: boolean;
    defaultMode: 'graph-only' | 'augmented';
  };
  autoLinking: {
    enabled: boolean;
  };
}
```

### Storage

Stored in the vault's `storage.json` under key `intelligence`, alongside existing `embedding` config:

```json
{
  "embedding": { "enabled": true, "provider": "onnx" },
  "intelligence": {
    "analytics": { "enabled": true },
    "synthesis": { "enabled": true, "defaultMode": "graph-only" },
    "autoLinking": { "enabled": true }
  }
}
```

### Defaults

All features enabled by default. Analytics and auto-linking are lightweight (no LLM cost). Synthesis involves LLM calls so users may want to disable it, but it defaults on since it's user-initiated.

### Toggle enforcement points

- **Chat tools**: `intelligence-tools.ts` exports a `getDefinitions(config)` function instead of a static array. The `ToolModule` interface already supports this — `definitions` can be computed at module registration time based on the vault's current config. Analytics tools are omitted when `analytics.enabled` is false; synthesis tools when `synthesis.enabled` is false.
- **MCP server**: Check config when listing tools in `ListToolsRequestSchema` handler. Filter tool list based on loaded vault config.
- **IntelligencePanel**: Check config before rendering enhanced sections.
- **Extraction pipeline**: Check `autoLinking.enabled` before running entity-link suggestions in `useLLMExtraction.ts`.

## 2. Analytics Tools

Seven new tools in `src/commands/tools/intelligence-tools.ts`:

### 2.1 `get_centrality_ranking`

**Purpose**: Identify the most connected (hub) nodes in the graph.

**Parameters**:
- `limit` (number, optional, default 10): Max nodes to return
- `node_type` (string, optional): Filter by node type before ranking

**Implementation**: Calls `degreeCentrality(adjacencyMap, nodes)` from `graph-algorithms.ts`. Returns top N entries sorted by centrality score.

**Response**:
```json
{
  "rankings": [
    { "nodeId": "...", "name": "Feedback Loops", "type": "concept", "degree": 38, "centrality": 0.12 }
  ],
  "totalNodes": 312,
  "avgDegree": 4.2
}
```

### 2.2 `get_orphan_nodes`

**Purpose**: Find nodes with zero connections.

**Parameters**:
- `limit` (number, optional, default 50)
- `node_type` (string, optional): Filter by type

**Implementation**: Filter nodes where `adjacencyMap.get(id)` is empty or undefined. New utility function in `graph-algorithms.ts`:

```typescript
export function findOrphans(map: AdjacencyMap, nodes: GraphNode[]): GraphNode[] {
  return nodes.filter(n => (map.get(n.id)?.length ?? 0) === 0);
}
```

**Response**:
```json
{
  "orphans": [
    { "nodeId": "...", "name": "...", "type": "...", "createdAt": "..." }
  ],
  "orphanCount": 23,
  "orphanRate": 0.074,
  "totalNodes": 312
}
```

### 2.3 `get_clusters`

**Purpose**: Discover natural community groupings in the graph.

**Parameters**:
- `min_size` (number, optional, default 2): Minimum cluster size to return
- `include_members` (boolean, optional, default false): Include full member node list

**Implementation**: Calls `labelPropagation(adjacencyMap, nodes)`. Optionally filters by `min_size`.

**Response**:
```json
{
  "clusters": [
    { "id": 0, "label": "Machine Learning (concept)", "size": 45, "members": ["..."] }
  ],
  "clusterCount": 8,
  "nodesInClusters": 280,
  "singletonCount": 32
}
```

### 2.4 `get_bridge_nodes`

**Purpose**: Find nodes that connect otherwise separate clusters. These are structurally important — removing them would disconnect parts of the graph.

**Parameters**:
- `limit` (number, optional, default 10)

**Implementation**: Calls `labelPropagation()` then `findGaps()`. Extracts bridge nodes from gap analysis. Also adds a new algorithm:

```typescript
export function findBridgeNodes(
  map: AdjacencyMap,
  nodes: GraphNode[],
  clusters: Cluster[]
): Array<{ nodeId: string; clustersConnected: number[] }> {
  // For each node, check if its neighbors span multiple clusters
  const clusterOf = new Map<string, number>();
  for (const c of clusters) {
    for (const id of c.nodeIds) clusterOf.set(id, c.id);
  }

  const bridges: Array<{ nodeId: string; clustersConnected: number[] }> = [];
  for (const node of nodes) {
    const neighborClusters = new Set<number>();
    for (const entry of map.get(node.id) ?? []) {
      const c = clusterOf.get(entry.nodeId);
      if (c !== undefined) neighborClusters.add(c);
    }
    if (neighborClusters.size >= 2) {
      bridges.push({ nodeId: node.id, clustersConnected: [...neighborClusters] });
    }
  }

  return bridges.sort((a, b) => b.clustersConnected.length - a.clustersConnected.length);
}
```

**Response**:
```json
{
  "bridges": [
    { "nodeId": "...", "name": "Bayesian Reasoning", "type": "concept", "clustersConnected": [0, 2, 5] }
  ],
  "count": 7
}
```

### 2.5 `get_connection_suggestions`

**Purpose**: Find node pairs that share neighbors but aren't directly connected — candidates for new edges.

**Parameters**:
- `limit` (number, optional, default 10)
- `min_shared` (number, optional, default 2): Minimum shared neighbors

**Implementation**: Calls `findConnectionSuggestions(adjacencyMap, nodes, minShared, limit)`.

**Response**:
```json
{
  "suggestions": [
    { "nodeA": { "id": "...", "name": "..." }, "nodeB": { "id": "...", "name": "..." }, "sharedNeighbors": 4, "score": 4 }
  ],
  "count": 10
}
```

### 2.6 `get_graph_health`

**Purpose**: Composite health metrics for the vault's knowledge graph.

**Parameters**: None.

**Implementation**: New function in `graph-algorithms.ts`:

```typescript
export interface GraphHealthMetrics {
  nodeCount: number;
  edgeCount: number;
  orphanCount: number;
  orphanRate: number;
  density: number;
  avgDegree: number;
  maxDegree: number;
  clusterCount: number;
  componentCount: number;
  largestComponentSize: number;
  largestComponentRatio: number;
}

export function computeGraphHealth(
  nodes: GraphNode[],
  edges: GraphEdge[],
  map: AdjacencyMap,
  clusters: Cluster[],
  components: Set<string>[]
): GraphHealthMetrics {
  const n = nodes.length;
  const orphans = nodes.filter(nd => (map.get(nd.id)?.length ?? 0) === 0);
  const degrees = nodes.map(nd => map.get(nd.id)?.length ?? 0);
  const maxDeg = Math.max(0, ...degrees);
  const avgDeg = n > 0 ? degrees.reduce((a, b) => a + b, 0) / n : 0;
  const density = n > 1 ? (2 * edges.length) / (n * (n - 1)) : 0;
  const largest = components.reduce((max, c) => Math.max(max, c.size), 0);

  return {
    nodeCount: n,
    edgeCount: edges.length,
    orphanCount: orphans.length,
    orphanRate: n > 0 ? orphans.length / n : 0,
    density,
    avgDegree: avgDeg,
    maxDegree: maxDeg,
    clusterCount: clusters.length,
    componentCount: components.length,
    largestComponentSize: largest,
    largestComponentRatio: n > 0 ? largest / n : 0,
  };
}
```

**Response**: The `GraphHealthMetrics` object as JSON.

### 2.7 `find_shortest_path`

**Purpose**: Find the shortest path between two nodes.

**Parameters**:
- `source_id` (string, required)
- `target_id` (string, required)
- `max_hops` (number, optional, default 6)

**Implementation**: Calls `bfsPathWithEdges(adjacencyMap, sourceId, targetId, maxHops)`. Enriches result with node/edge details.

**Response**:
```json
{
  "found": true,
  "pathLength": 3,
  "nodes": [
    { "id": "...", "name": "...", "type": "..." }
  ],
  "edges": [
    { "id": "...", "label": "...", "sourceId": "...", "targetId": "..." }
  ]
}
```

## 3. Synthesis Tools

Two LLM-powered tools, also in `intelligence-tools.ts`. Gated by `config.synthesis.enabled`.

### 3.1 `synthesize_domains`

**Purpose**: Find structural parallels between two knowledge domains.

**Parameters**:
- `domain_a` (string, required): Node type, cluster ID, or search query for domain A
- `domain_b` (string, required): Same for domain B
- `mode` (string, optional): `graph-only` | `augmented`, defaults to vault config `defaultMode`
- `limit` (number, optional, default 20): Max nodes to load per domain

**Domain resolution**: The `domain_a` and `domain_b` params are resolved in order:
1. If it matches an existing node type exactly (e.g., "person", "concept") → filter by type
2. If it's a numeric string → treat as cluster ID from `get_clusters`
3. Otherwise → run as a search query via `db.nodes.search()`

**Implementation**:
1. Resolve each domain to a list of nodes using the resolution order above
2. For each domain, load node details + immediate edges
3. Construct prompt with both domain's data
4. In `graph-only` mode, system prompt says: "Analyze ONLY the provided graph data. Do not introduce external knowledge. Every claim must reference specific node IDs."
5. In `augmented` mode, system prompt says: "Start from the provided graph data. You may supplement with world knowledge, but clearly mark [GRAPH] vs [WORLD] for each insight."
6. Stream LLM response back as tool result

**Response**: LLM-generated synthesis text with node ID references.

### 3.2 `analyze_gaps`

**Purpose**: Identify what concepts are missing from a knowledge domain.

**Parameters**:
- `domain` (string, required): Node type, cluster ID, or search query
- `mode` (string, optional): `graph-only` | `augmented`, defaults to vault config
- `limit` (number, optional, default 30): Max nodes to load

**Domain resolution**: Same as `synthesize_domains` — type match → cluster ID → search query.

**Implementation**:
1. Resolve domain to node list using the resolution order
2. Load node details, types, and edge labels
3. Construct prompt asking: "Given these entities and relationships in the domain of [X], what concepts or connections would a practitioner expect to find but are absent?"
4. In `graph-only` mode: LLM can only identify structural gaps (e.g., "Node A and Node B share theme X but have no connection")
5. In `augmented` mode: LLM can suggest missing concepts from world knowledge

**Response**: LLM-generated gap analysis with references.

## 4. Auto-Entity-Linking Enhancement

Enhancement to the existing extraction review flow, not a standalone tool. Gated by `config.autoLinking.enabled`.

### Flow

During LLM extraction, after entities are extracted and before the review UI is shown:

1. For each extracted entity name, call `EntityResolutionRepository.findMatches(name)` with a similarity threshold (0.7)
2. If matches are found, annotate the extracted entity with `suggestedMatches: Array<{ nodeId, name, similarity }>`
3. In the extraction review UI, show matched entities with an option to:
   - **Link**: Create an edge to the existing node instead of creating a new node
   - **Create new**: Create a new node (current behavior)
   - **Merge**: Merge the extracted entity into the existing node

### Files modified

- `src/ui/hooks/useLLMExtraction.ts` — in `proceedToReview()`, add `findMatches()` lookup for each extracted entity and attach `suggestedMatches` to `ReviewNode`
- `src/ui/components/llm/ReviewNodeItem.tsx` — show match suggestions with Link/Create/Merge actions
- `src/graph/store/extraction-review-store.ts` — extend `ReviewNode` type with `suggestedMatches` field
- `src/shared/types.ts` — add `EntityMatch` type: `{ nodeId: string; name: string; similarity: number }`

## 5. IntelligencePanel Enhancements

Enhance the existing `src/ui/components/intelligence/IntelligencePanel.tsx`:

### New sections

1. **Vault Health card** (top of panel): Shows orphan rate, density, avg degree, cluster count as compact metrics. Uses `computeGraphHealth()`.

2. **Orphan Nodes section**: Lists unconnected nodes. Each entry has a "Find connections" action that triggers `get_connection_suggestions` for that node.

3. **Bridge Nodes section**: Shows bridge nodes with badge showing how many clusters they connect. Clicking highlights the bridged clusters in the graph.

### Enhanced sections

4. **Clusters section** (existing): Add member count and "explore" action that filters graph view to cluster members.

5. **Central Entities section** (existing): Add centrality score display.

### Gating

All new sections check `VaultIntelligenceConfig.analytics.enabled`. If disabled, the panel renders in its current form (no new sections).

## 6. MCP Server Mirroring

Every tool from sections 2 and 3 gets a corresponding handler in `packages/synapse-mcp/src/index.ts`:

- Same tool names and parameter schemas
- MCP server loads graph via `StandaloneGraphProvider`, builds adjacency map, calls same algorithm functions
- Synthesis tools require LLM access — the MCP server uses the vault's configured LLM provider via the standalone provider's LLM backend
- Feature toggles checked via vault's `storage.json`

### New MCP tools

```
get_centrality_ranking
get_orphan_nodes
get_clusters
get_bridge_nodes
get_connection_suggestions
get_graph_health
find_shortest_path
synthesize_domains
analyze_gaps
```

## 7. File Changes Summary

### New files

| File | Purpose |
|------|---------|
| `src/commands/tools/intelligence-tools.ts` | ToolModule with all 9 intelligence tools |
| `src/shared/intelligence-types.ts` | `VaultIntelligenceConfig`, `GraphHealthMetrics`, tool response types |

### Modified files

| File | Change |
|------|--------|
| `src/graph/algorithms/graph-algorithms.ts` | Add `findOrphans()`, `findBridgeNodes()`, `computeGraphHealth()` |
| `src/commands/tools/index.ts` | Register `intelligenceTools` in `ALL_MODULES` |
| `src/ui/components/intelligence/IntelligencePanel.tsx` | Add health card, orphan section, bridge section |
| `packages/synapse-mcp/src/index.ts` | Add 9 MCP tool handlers |
| `src/shared/types.ts` | Add `EntityMatch` type |
| `src/ui/hooks/useLLMExtraction.ts` | Add `findMatches()` lookup in `proceedToReview()` |
| `src/ui/components/llm/ReviewNodeItem.tsx` | Show match suggestions with Link/Create/Merge actions |
| `src/graph/store/extraction-review-store.ts` | Extend `ReviewNode` with `suggestedMatches` field |
| Vault `storage.json` schema | Add `intelligence` config key |

## 8. Implementation Phases

### Phase 1: Foundation + Analytics Tools
- `VaultIntelligenceConfig` type and storage
- New algorithms: `findOrphans`, `findBridgeNodes`, `computeGraphHealth`
- `intelligence-tools.ts` with 7 analytics tools
- Register in `ALL_MODULES`
- MCP server mirroring for analytics tools

### Phase 2: Synthesis Tools
- `synthesize_domains` and `analyze_gaps` tools
- LLM prompt construction with graph-only/augmented modes
- MCP server synthesis handlers (requires LLM backend access)

### Phase 3: Auto-Entity-Linking
- Extraction pipeline enhancement with fuzzy matching
- Review UI changes for match suggestions
- Link/Create/Merge actions

### Phase 4: UI Enhancements
- IntelligencePanel health card
- Orphan nodes section
- Bridge nodes section
- Enhanced cluster and centrality displays

## 9. Non-Goals

- **Betweenness/closeness centrality**: Expensive O(V*E) algorithms. Degree centrality is sufficient for most use cases. Can add later if needed.
- **PageRank**: Interesting but requires iterative computation. Not included in v1.
- **Cluster coloring in renderer**: Would require changes to the Three.js InstancedMesh renderer. Deferred to a separate spec.
- **Historical health tracking**: No time-series storage of health metrics. Users can run `get_graph_health` periodically. Trend tracking is a future feature.
- **Settings UI for intelligence config**: Use `storage.json` directly or existing settings panel patterns. Dedicated UI deferred.
