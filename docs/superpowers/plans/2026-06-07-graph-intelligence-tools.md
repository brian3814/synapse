# Graph Intelligence Tools Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Expose existing graph algorithms as chat agent + MCP tools, add synthesis tools, and enhance the IntelligencePanel with health metrics, orphans, and bridge nodes.

**Architecture:** New `intelligence-tools.ts` ToolModule following the existing pattern (`graph-tools.ts`, `entity-tools.ts`). New algorithms added to `graph-algorithms.ts`. MCP handlers added to `packages/synapse-mcp/src/index.ts`. Feature toggles via vault `storage.json`.

**Tech Stack:** TypeScript, Zustand, React, better-sqlite3 (MCP server)

**Note:** Phase 3 (Auto-Entity-Linking) from the spec is already implemented — `useLLMExtraction.ts` already calls `entityResolution.findMatches()` and `ReviewNodeItem.tsx` already renders merge accept/dismiss UI. It is omitted from this plan.

---

### Task 1: Add new algorithms to graph-algorithms.ts

**Files:**
- Modify: `src/graph/algorithms/graph-algorithms.ts`

- [ ] **Step 1: Add `findOrphans` function**

Append after the `detectPatterns` function at the end of the file:

```typescript
export function findOrphans(map: AdjacencyMap, nodes: GraphNode[]): GraphNode[] {
  return nodes.filter(n => (map.get(n.id)?.length ?? 0) === 0);
}
```

- [ ] **Step 2: Add `findBridgeNodes` function**

Append after `findOrphans`:

```typescript
export interface BridgeNode {
  nodeId: string;
  clustersConnected: number[];
}

export function findBridgeNodes(
  map: AdjacencyMap,
  nodes: GraphNode[],
  clusters: Cluster[]
): BridgeNode[] {
  const clusterOf = new Map<string, number>();
  for (const c of clusters) {
    for (const id of c.nodeIds) clusterOf.set(id, c.id);
  }

  const bridges: BridgeNode[] = [];
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

- [ ] **Step 3: Add `computeGraphHealth` function**

Append after `findBridgeNodes`:

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
  const orphanCount = nodes.filter(nd => (map.get(nd.id)?.length ?? 0) === 0).length;
  const degrees = nodes.map(nd => map.get(nd.id)?.length ?? 0);
  const maxDegree = degrees.length > 0 ? Math.max(...degrees) : 0;
  const avgDegree = n > 0 ? degrees.reduce((a, b) => a + b, 0) / n : 0;
  const density = n > 1 ? (2 * edges.length) / (n * (n - 1)) : 0;
  const largestComponentSize = components.reduce((max, c) => Math.max(max, c.size), 0);

  return {
    nodeCount: n,
    edgeCount: edges.length,
    orphanCount,
    orphanRate: n > 0 ? orphanCount / n : 0,
    density,
    avgDegree,
    maxDegree,
    clusterCount: clusters.length,
    componentCount: components.length,
    largestComponentSize,
    largestComponentRatio: n > 0 ? largestComponentSize / n : 0,
  };
}
```

- [ ] **Step 4: Verify the build compiles**

Run: `npx tsc --noEmit --pretty 2>&1 | head -20`
Expected: No errors in `graph-algorithms.ts`

- [ ] **Step 5: Commit**

```bash
git add src/graph/algorithms/graph-algorithms.ts
git commit -m "feat: add findOrphans, findBridgeNodes, computeGraphHealth algorithms"
```

---

### Task 2: Create intelligence-tools.ts ToolModule (analytics tools)

**Files:**
- Create: `src/commands/tools/intelligence-tools.ts`
- Modify: `src/commands/tools/index.ts`

- [ ] **Step 1: Create `intelligence-tools.ts` with 7 analytics tool definitions and implementations**

```typescript
import type { ToolModule, ToolExecResult, CommandContext } from './types';
import type { ChatToolDefinition } from '../../shared/chat-agent-tools';
import { buildAdjacencyMap } from '../../graph/algorithms/adjacency';
import {
  degreeCentrality,
  connectedComponents,
  labelPropagation,
  findConnectionSuggestions,
  findOrphans,
  findBridgeNodes,
  computeGraphHealth,
  bfsPathWithEdges,
} from '../../graph/algorithms/graph-algorithms';

const analyticsDefs: ChatToolDefinition[] = [
  {
    name: 'get_centrality_ranking',
    description:
      'Rank nodes by degree centrality (number of connections). Identifies hub nodes — the most connected entities in the knowledge graph.',
    parameters: {
      type: 'object',
      properties: {
        limit: { type: 'number', description: 'Max nodes to return (default 10)' },
        node_type: { type: 'string', description: 'Filter by node type before ranking (e.g. "entity", "note")' },
      },
      required: [],
    },
    executionContext: 'ui',
  },
  {
    name: 'get_orphan_nodes',
    description:
      'Find nodes with zero connections — entities that exist in the graph but are not linked to anything. Useful for vault health audits.',
    parameters: {
      type: 'object',
      properties: {
        limit: { type: 'number', description: 'Max nodes to return (default 50)' },
        node_type: { type: 'string', description: 'Filter by node type' },
      },
      required: [],
    },
    executionContext: 'ui',
  },
  {
    name: 'get_clusters',
    description:
      'Discover natural community groupings in the graph using label propagation. Returns clusters sorted by size.',
    parameters: {
      type: 'object',
      properties: {
        min_size: { type: 'number', description: 'Minimum cluster size to return (default 2)' },
        include_members: { type: 'boolean', description: 'Include full member node list (default false, keeps response compact)' },
      },
      required: [],
    },
    executionContext: 'ui',
  },
  {
    name: 'get_bridge_nodes',
    description:
      'Find nodes whose neighbors span multiple clusters — structurally important entities that connect otherwise separate parts of the graph.',
    parameters: {
      type: 'object',
      properties: {
        limit: { type: 'number', description: 'Max bridge nodes to return (default 10)' },
      },
      required: [],
    },
    executionContext: 'ui',
  },
  {
    name: 'get_connection_suggestions',
    description:
      'Find pairs of nodes that share multiple neighbors but are not directly connected. These are candidates for new relationships.',
    parameters: {
      type: 'object',
      properties: {
        limit: { type: 'number', description: 'Max suggestions to return (default 10)' },
        min_shared: { type: 'number', description: 'Minimum shared neighbors required (default 2)' },
      },
      required: [],
    },
    executionContext: 'ui',
  },
  {
    name: 'get_graph_health',
    description:
      'Get composite health metrics for the knowledge graph: orphan rate, density, average degree, cluster count, component count, and largest component ratio.',
    parameters: {
      type: 'object',
      properties: {},
      required: [],
    },
    executionContext: 'ui',
  },
  {
    name: 'find_shortest_path',
    description:
      'Find the shortest path between two nodes in the graph. Returns the chain of nodes and edges connecting them.',
    parameters: {
      type: 'object',
      properties: {
        source_id: { type: 'string', description: 'Starting node ID' },
        target_id: { type: 'string', description: 'Destination node ID' },
        max_hops: { type: 'number', description: 'Maximum path length (default 6)' },
      },
      required: ['source_id', 'target_id'],
    },
    executionContext: 'ui',
  },
];

export const definitions: ChatToolDefinition[] = [...analyticsDefs];

async function execute(ctx: CommandContext, name: string, input: Record<string, unknown>): Promise<ToolExecResult | null> {
  switch (name) {
    case 'get_centrality_ranking': {
      const limit = (input.limit as number) ?? 10;
      const nodeType = input.node_type as string | undefined;
      const { nodes, edges } = await ctx.db.loadGraph();
      const map = buildAdjacencyMap(edges);
      const filtered = nodeType ? nodes.filter(n => n.type === nodeType || n.label === nodeType) : nodes;
      const centrality = degreeCentrality(map, filtered);

      const rankings = [...centrality.entries()]
        .sort((a, b) => b[1] - a[1])
        .slice(0, limit)
        .map(([nodeId, score]) => {
          const node = filtered.find(n => n.id === nodeId);
          return {
            nodeId,
            name: node?.name ?? '?',
            type: node?.type ?? '?',
            label: node?.label ?? null,
            degree: map.get(nodeId)?.length ?? 0,
            centrality: Math.round(score * 1000) / 1000,
          };
        });

      const degrees = filtered.map(n => map.get(n.id)?.length ?? 0);
      const avgDegree = filtered.length > 0
        ? Math.round((degrees.reduce((a, b) => a + b, 0) / filtered.length) * 100) / 100
        : 0;

      return {
        result: JSON.stringify({ rankings, totalNodes: filtered.length, avgDegree }),
        collectedNodeIds: rankings.map(r => r.nodeId),
      };
    }

    case 'get_orphan_nodes': {
      const limit = (input.limit as number) ?? 50;
      const nodeType = input.node_type as string | undefined;
      const { nodes, edges } = await ctx.db.loadGraph();
      const map = buildAdjacencyMap(edges);
      let orphans = findOrphans(map, nodes);
      if (nodeType) orphans = orphans.filter(n => n.type === nodeType || n.label === nodeType);

      const result = orphans.slice(0, limit).map(n => ({
        nodeId: n.id,
        name: n.name,
        type: n.type,
        label: n.label ?? null,
        createdAt: n.createdAt,
      }));

      return {
        result: JSON.stringify({
          orphans: result,
          orphanCount: orphans.length,
          orphanRate: nodes.length > 0 ? Math.round((orphans.length / nodes.length) * 1000) / 1000 : 0,
          totalNodes: nodes.length,
        }),
        collectedNodeIds: result.map(r => r.nodeId),
      };
    }

    case 'get_clusters': {
      const minSize = (input.min_size as number) ?? 2;
      const includeMembers = (input.include_members as boolean) ?? false;
      const { nodes, edges } = await ctx.db.loadGraph();
      const map = buildAdjacencyMap(edges);
      const clusters = labelPropagation(map, nodes).filter(c => c.size >= minSize);

      const nodeMap = new Map(nodes.map(n => [n.id, n]));
      const nodesInClusters = clusters.reduce((sum, c) => sum + c.size, 0);
      const singletonCount = nodes.length - nodesInClusters;

      const clusterData = clusters.map(c => {
        const base: Record<string, unknown> = {
          id: c.id,
          label: c.label,
          size: c.size,
        };
        if (includeMembers) {
          base.members = c.nodeIds.map(id => {
            const n = nodeMap.get(id);
            return { id, name: n?.name ?? '?', type: n?.type ?? '?' };
          });
        }
        return base;
      });

      return {
        result: JSON.stringify({ clusters: clusterData, clusterCount: clusters.length, nodesInClusters, singletonCount }),
      };
    }

    case 'get_bridge_nodes': {
      const limit = (input.limit as number) ?? 10;
      const { nodes, edges } = await ctx.db.loadGraph();
      const map = buildAdjacencyMap(edges);
      const clusters = labelPropagation(map, nodes);
      const bridges = findBridgeNodes(map, nodes, clusters).slice(0, limit);

      const nodeMap = new Map(nodes.map(n => [n.id, n]));
      const result = bridges.map(b => {
        const node = nodeMap.get(b.nodeId);
        return {
          nodeId: b.nodeId,
          name: node?.name ?? '?',
          type: node?.type ?? '?',
          label: node?.label ?? null,
          clustersConnected: b.clustersConnected,
          clusterCount: b.clustersConnected.length,
        };
      });

      return {
        result: JSON.stringify({ bridges: result, count: result.length }),
        collectedNodeIds: result.map(r => r.nodeId),
      };
    }

    case 'get_connection_suggestions': {
      const limit = (input.limit as number) ?? 10;
      const minShared = (input.min_shared as number) ?? 2;
      const { nodes, edges } = await ctx.db.loadGraph();
      const map = buildAdjacencyMap(edges);
      const suggestions = findConnectionSuggestions(map, nodes, minShared, limit);

      const nodeMap = new Map(nodes.map(n => [n.id, n]));
      const result = suggestions.map(s => ({
        nodeA: { id: s.nodeA, name: nodeMap.get(s.nodeA)?.name ?? '?' },
        nodeB: { id: s.nodeB, name: nodeMap.get(s.nodeB)?.name ?? '?' },
        sharedNeighborCount: s.sharedNeighbors.length,
        score: s.score,
      }));

      return {
        result: JSON.stringify({ suggestions: result, count: result.length }),
      };
    }

    case 'get_graph_health': {
      const { nodes, edges } = await ctx.db.loadGraph();
      const map = buildAdjacencyMap(edges);
      const clusters = labelPropagation(map, nodes);
      const components = connectedComponents(map, nodes);
      const health = computeGraphHealth(nodes, edges, map, clusters, components);

      const rounded = {
        ...health,
        orphanRate: Math.round(health.orphanRate * 1000) / 1000,
        density: Math.round(health.density * 10000) / 10000,
        avgDegree: Math.round(health.avgDegree * 100) / 100,
        largestComponentRatio: Math.round(health.largestComponentRatio * 1000) / 1000,
      };

      return { result: JSON.stringify(rounded) };
    }

    case 'find_shortest_path': {
      const sourceId = input.source_id as string;
      const targetId = input.target_id as string;
      const maxHops = (input.max_hops as number) ?? 6;
      const { nodes, edges } = await ctx.db.loadGraph();
      const map = buildAdjacencyMap(edges);
      const pathResult = bfsPathWithEdges(map, sourceId, targetId, maxHops);

      if (!pathResult) {
        return { result: JSON.stringify({ found: false, sourceId, targetId }) };
      }

      const nodeMap = new Map(nodes.map(n => [n.id, n]));
      const edgeMap = new Map(edges.map(e => [e.id, e]));

      const pathNodes = pathResult.nodeIds.map(id => {
        const n = nodeMap.get(id);
        return { id, name: n?.name ?? '?', type: n?.type ?? '?' };
      });
      const pathEdges = pathResult.edgeIds.map(id => {
        const e = edgeMap.get(id);
        return { id, label: e?.label ?? '?', sourceId: e?.sourceId ?? '?', targetId: e?.targetId ?? '?' };
      });

      return {
        result: JSON.stringify({ found: true, pathLength: pathResult.nodeIds.length - 1, nodes: pathNodes, edges: pathEdges }),
        collectedNodeIds: pathResult.nodeIds,
        collectedEdgeIds: pathResult.edgeIds,
      };
    }

    default:
      return null;
  }
}

export const intelligenceTools: ToolModule = { definitions, execute };
```

- [ ] **Step 2: Register in `src/commands/tools/index.ts`**

Add the import and register in `ALL_MODULES`. The file currently looks like:

```typescript
import { noteTools } from './note-tools';
import { edgeTools } from './edge-tools';
import { graphTools } from './graph-tools';
import { entityTools } from './entity-tools';
```

Add after the `entityTools` import:

```typescript
import { intelligenceTools } from './intelligence-tools';
```

And change the `ALL_MODULES` array:

```typescript
const ALL_MODULES: ToolModule[] = [noteTools, edgeTools, graphTools, entityTools, intelligenceTools];
```

- [ ] **Step 3: Verify the build compiles**

Run: `npx tsc --noEmit --pretty 2>&1 | head -20`
Expected: No errors

- [ ] **Step 4: Commit**

```bash
git add src/commands/tools/intelligence-tools.ts src/commands/tools/index.ts
git commit -m "feat: add intelligence-tools ToolModule with 7 analytics tools"
```

---

### Task 3: Add MCP server intelligence tool handlers

**Files:**
- Modify: `packages/synapse-mcp/src/index.ts`
- Modify: `packages/synapse-mcp/src/standalone-provider.ts`

- [ ] **Step 1: Add graph analytics methods to `standalone-provider.ts`**

Add these methods to the `StandaloneGraphProvider` class. These methods query the SQLite database directly (the MCP server doesn't have access to the in-memory graph store). Place them after the existing `getGraphOverview()` method.

```typescript
  getCentralityRanking(limit = 10, nodeType?: string): StandaloneToolResult {
    try {
      const typeFilter = nodeType ? 'WHERE type = ? OR label = ?' : '';
      const params = nodeType ? [nodeType, nodeType] : [];
      const nodes = this.db.prepare(`SELECT id, name, type, label FROM nodes ${typeFilter}`).all(...params) as Array<{ id: string; name: string; type: string; label: string | null }>;

      const degreeCounts = new Map<string, number>();
      for (const node of nodes) {
        const count = (this.db.prepare('SELECT COUNT(*) as c FROM edges WHERE source_id = ? OR target_id = ?').get(node.id, node.id) as any).c;
        degreeCounts.set(node.id, count);
      }

      const n = nodes.length;
      const denom = n > 1 ? n - 1 : 1;
      const rankings = nodes
        .map(node => ({
          nodeId: node.id,
          name: node.name,
          type: node.type,
          label: node.label,
          degree: degreeCounts.get(node.id) ?? 0,
          centrality: Math.round(((degreeCounts.get(node.id) ?? 0) / denom) * 1000) / 1000,
        }))
        .sort((a, b) => b.degree - a.degree)
        .slice(0, limit);

      const totalDegree = [...degreeCounts.values()].reduce((a, b) => a + b, 0);
      const avgDegree = n > 0 ? Math.round((totalDegree / n) * 100) / 100 : 0;

      return { result: JSON.stringify({ rankings, totalNodes: n, avgDegree }) };
    } catch (e: unknown) {
      return { result: JSON.stringify({ error: e instanceof Error ? e.message : String(e) }), isError: true };
    }
  }

  getOrphanNodes(limit = 50, nodeType?: string): StandaloneToolResult {
    try {
      const sql = `
        SELECT n.id, n.name, n.type, n.label, n.created_at
        FROM nodes n
        WHERE NOT EXISTS (SELECT 1 FROM edges e WHERE e.source_id = n.id OR e.target_id = n.id)
        ${nodeType ? 'AND (n.type = ? OR n.label = ?)' : ''}
        LIMIT ?
      `;
      const params = nodeType ? [nodeType, nodeType, limit] : [limit];
      const orphans = this.db.prepare(sql).all(...params) as Array<{ id: string; name: string; type: string; label: string | null; created_at: string }>;

      const totalNodes = (this.db.prepare('SELECT COUNT(*) as c FROM nodes').get() as any).c;
      const orphanCountSql = `
        SELECT COUNT(*) as c FROM nodes n
        WHERE NOT EXISTS (SELECT 1 FROM edges e WHERE e.source_id = n.id OR e.target_id = n.id)
        ${nodeType ? 'AND (n.type = ? OR n.label = ?)' : ''}
      `;
      const orphanCount = (this.db.prepare(orphanCountSql).get(...(nodeType ? [nodeType, nodeType] : [])) as any).c;

      const result = orphans.map(n => ({
        nodeId: n.id, name: n.name, type: n.type, label: n.label, createdAt: n.created_at,
      }));

      return {
        result: JSON.stringify({
          orphans: result,
          orphanCount,
          orphanRate: totalNodes > 0 ? Math.round((orphanCount / totalNodes) * 1000) / 1000 : 0,
          totalNodes,
        }),
      };
    } catch (e: unknown) {
      return { result: JSON.stringify({ error: e instanceof Error ? e.message : String(e) }), isError: true };
    }
  }

  getClusters(minSize = 2, includeMembers = false): StandaloneToolResult {
    try {
      const nodes = this.db.prepare('SELECT id, name, type, label FROM nodes').all() as Array<{ id: string; name: string; type: string; label: string | null }>;
      const edges = this.db.prepare('SELECT id, source_id, target_id, label, type FROM edges').all() as Array<{ id: string; source_id: string; target_id: string; label: string; type: string }>;

      const { buildAdjacencyMap } = require('../../../src/graph/algorithms/adjacency');
      const { labelPropagation } = require('../../../src/graph/algorithms/graph-algorithms');

      const graphNodes = nodes.map(n => ({ ...n, identifier: null, properties: {}, size: 1, createdAt: '', updatedAt: '' }));
      const graphEdges = edges.map(e => ({ id: e.id, sourceId: e.source_id, targetId: e.target_id, label: e.label, type: e.type, properties: {}, weight: 1, directed: false, createdAt: '', updatedAt: '' }));

      const map = buildAdjacencyMap(graphEdges);
      const clusters = labelPropagation(map, graphNodes).filter((c: any) => c.size >= minSize);

      const nodeMap = new Map(nodes.map(n => [n.id, n]));
      const nodesInClusters = clusters.reduce((sum: number, c: any) => sum + c.size, 0);

      const clusterData = clusters.map((c: any) => {
        const base: Record<string, unknown> = { id: c.id, label: c.label, size: c.size };
        if (includeMembers) {
          base.members = c.nodeIds.map((id: string) => {
            const n = nodeMap.get(id);
            return { id, name: n?.name ?? '?', type: n?.type ?? '?' };
          });
        }
        return base;
      });

      return {
        result: JSON.stringify({ clusters: clusterData, clusterCount: clusters.length, nodesInClusters, singletonCount: nodes.length - nodesInClusters }),
      };
    } catch (e: unknown) {
      return { result: JSON.stringify({ error: e instanceof Error ? e.message : String(e) }), isError: true };
    }
  }

  getBridgeNodes(limit = 10): StandaloneToolResult {
    try {
      const nodes = this.db.prepare('SELECT id, name, type, label FROM nodes').all() as Array<{ id: string; name: string; type: string; label: string | null }>;
      const edges = this.db.prepare('SELECT id, source_id, target_id, label, type FROM edges').all() as Array<{ id: string; source_id: string; target_id: string; label: string; type: string }>;

      const { buildAdjacencyMap } = require('../../../src/graph/algorithms/adjacency');
      const { labelPropagation, findBridgeNodes } = require('../../../src/graph/algorithms/graph-algorithms');

      const graphNodes = nodes.map(n => ({ ...n, identifier: null, properties: {}, size: 1, createdAt: '', updatedAt: '' }));
      const graphEdges = edges.map(e => ({ id: e.id, sourceId: e.source_id, targetId: e.target_id, label: e.label, type: e.type, properties: {}, weight: 1, directed: false, createdAt: '', updatedAt: '' }));

      const map = buildAdjacencyMap(graphEdges);
      const clusters = labelPropagation(map, graphNodes);
      const bridges = findBridgeNodes(map, graphNodes, clusters).slice(0, limit);

      const nodeMap = new Map(nodes.map(n => [n.id, n]));
      const result = bridges.map((b: any) => {
        const node = nodeMap.get(b.nodeId);
        return { nodeId: b.nodeId, name: node?.name ?? '?', type: node?.type ?? '?', label: node?.label ?? null, clustersConnected: b.clustersConnected, clusterCount: b.clustersConnected.length };
      });

      return { result: JSON.stringify({ bridges: result, count: result.length }) };
    } catch (e: unknown) {
      return { result: JSON.stringify({ error: e instanceof Error ? e.message : String(e) }), isError: true };
    }
  }

  getConnectionSuggestions(limit = 10, minShared = 2): StandaloneToolResult {
    try {
      const nodes = this.db.prepare('SELECT id, name, type, label FROM nodes').all() as Array<{ id: string; name: string; type: string; label: string | null }>;
      const edges = this.db.prepare('SELECT id, source_id, target_id, label, type FROM edges').all() as Array<{ id: string; source_id: string; target_id: string; label: string; type: string }>;

      const { buildAdjacencyMap } = require('../../../src/graph/algorithms/adjacency');
      const { findConnectionSuggestions } = require('../../../src/graph/algorithms/graph-algorithms');

      const graphNodes = nodes.map(n => ({ ...n, identifier: null, properties: {}, size: 1, createdAt: '', updatedAt: '' }));
      const graphEdges = edges.map(e => ({ id: e.id, sourceId: e.source_id, targetId: e.target_id, label: e.label, type: e.type, properties: {}, weight: 1, directed: false, createdAt: '', updatedAt: '' }));

      const map = buildAdjacencyMap(graphEdges);
      const suggestions = findConnectionSuggestions(map, graphNodes, minShared, limit);

      const nodeMap = new Map(nodes.map(n => [n.id, n]));
      const result = suggestions.map((s: any) => ({
        nodeA: { id: s.nodeA, name: nodeMap.get(s.nodeA)?.name ?? '?' },
        nodeB: { id: s.nodeB, name: nodeMap.get(s.nodeB)?.name ?? '?' },
        sharedNeighborCount: s.sharedNeighbors.length,
        score: s.score,
      }));

      return { result: JSON.stringify({ suggestions: result, count: result.length }) };
    } catch (e: unknown) {
      return { result: JSON.stringify({ error: e instanceof Error ? e.message : String(e) }), isError: true };
    }
  }

  getGraphHealth(): StandaloneToolResult {
    try {
      const nodes = this.db.prepare('SELECT id, name, type, label FROM nodes').all() as Array<{ id: string; name: string; type: string; label: string | null }>;
      const edges = this.db.prepare('SELECT id, source_id, target_id, label, type FROM edges').all() as Array<{ id: string; source_id: string; target_id: string; label: string; type: string }>;

      const { buildAdjacencyMap } = require('../../../src/graph/algorithms/adjacency');
      const { labelPropagation, connectedComponents, computeGraphHealth } = require('../../../src/graph/algorithms/graph-algorithms');

      const graphNodes = nodes.map(n => ({ ...n, identifier: null, properties: {}, size: 1, createdAt: '', updatedAt: '' }));
      const graphEdges = edges.map(e => ({ id: e.id, sourceId: e.source_id, targetId: e.target_id, label: e.label, type: e.type, properties: {}, weight: 1, directed: false, createdAt: '', updatedAt: '' }));

      const map = buildAdjacencyMap(graphEdges);
      const clusters = labelPropagation(map, graphNodes);
      const components = connectedComponents(map, graphNodes);
      const health = computeGraphHealth(graphNodes, graphEdges, map, clusters, components);

      const rounded = {
        ...health,
        orphanRate: Math.round(health.orphanRate * 1000) / 1000,
        density: Math.round(health.density * 10000) / 10000,
        avgDegree: Math.round(health.avgDegree * 100) / 100,
        largestComponentRatio: Math.round(health.largestComponentRatio * 1000) / 1000,
      };

      return { result: JSON.stringify(rounded) };
    } catch (e: unknown) {
      return { result: JSON.stringify({ error: e instanceof Error ? e.message : String(e) }), isError: true };
    }
  }

  findShortestPath(sourceId: string, targetId: string, maxHops = 6): StandaloneToolResult {
    try {
      const edges = this.db.prepare('SELECT id, source_id, target_id, label, type FROM edges').all() as Array<{ id: string; source_id: string; target_id: string; label: string; type: string }>;

      const { buildAdjacencyMap } = require('../../../src/graph/algorithms/adjacency');
      const { bfsPathWithEdges } = require('../../../src/graph/algorithms/graph-algorithms');

      const graphEdges = edges.map(e => ({ id: e.id, sourceId: e.source_id, targetId: e.target_id, label: e.label, type: e.type, properties: {}, weight: 1, directed: false, createdAt: '', updatedAt: '' }));
      const map = buildAdjacencyMap(graphEdges);
      const pathResult = bfsPathWithEdges(map, sourceId, targetId, maxHops);

      if (!pathResult) {
        return { result: JSON.stringify({ found: false, sourceId, targetId }) };
      }

      const nodeIds = pathResult.nodeIds;
      const placeholders = nodeIds.map(() => '?').join(',');
      const pathNodes = this.db.prepare(`SELECT id, name, type FROM nodes WHERE id IN (${placeholders})`).all(...nodeIds) as Array<{ id: string; name: string; type: string }>;
      const nodeMap = new Map(pathNodes.map(n => [n.id, n]));
      const edgeMap = new Map(edges.map(e => [e.id, e]));

      const orderedNodes = nodeIds.map(id => ({ id, name: nodeMap.get(id)?.name ?? '?', type: nodeMap.get(id)?.type ?? '?' }));
      const orderedEdges = pathResult.edgeIds.map((id: string) => {
        const e = edgeMap.get(id);
        return { id, label: e?.label ?? '?', sourceId: e?.source_id ?? '?', targetId: e?.target_id ?? '?' };
      });

      return { result: JSON.stringify({ found: true, pathLength: nodeIds.length - 1, nodes: orderedNodes, edges: orderedEdges }) };
    } catch (e: unknown) {
      return { result: JSON.stringify({ error: e instanceof Error ? e.message : String(e) }), isError: true };
    }
  }
```

- [ ] **Step 2: Add MCP tool definitions and case handlers to `index.ts`**

Add tool definition constants after `TOOL_SEMANTIC_SEARCH` (around line 514):

```typescript
const TOOL_GET_CENTRALITY_RANKING = {
  name: 'get_centrality_ranking',
  description: 'Rank nodes by degree centrality. Identifies hub nodes.',
  inputSchema: {
    type: 'object' as const,
    properties: {
      limit: { type: 'number', description: 'Max nodes (default 10).' },
      node_type: { type: 'string', description: 'Filter by node type.' },
      vault: { type: 'string', description: 'Vault name.' },
    },
    required: [],
  },
};

const TOOL_GET_ORPHAN_NODES = {
  name: 'get_orphan_nodes',
  description: 'Find nodes with zero connections.',
  inputSchema: {
    type: 'object' as const,
    properties: {
      limit: { type: 'number', description: 'Max nodes (default 50).' },
      node_type: { type: 'string', description: 'Filter by node type.' },
      vault: { type: 'string', description: 'Vault name.' },
    },
    required: [],
  },
};

const TOOL_GET_CLUSTERS = {
  name: 'get_clusters',
  description: 'Discover natural community groupings via label propagation.',
  inputSchema: {
    type: 'object' as const,
    properties: {
      min_size: { type: 'number', description: 'Min cluster size (default 2).' },
      include_members: { type: 'boolean', description: 'Include member list (default false).' },
      vault: { type: 'string', description: 'Vault name.' },
    },
    required: [],
  },
};

const TOOL_GET_BRIDGE_NODES = {
  name: 'get_bridge_nodes',
  description: 'Find nodes connecting separate clusters.',
  inputSchema: {
    type: 'object' as const,
    properties: {
      limit: { type: 'number', description: 'Max results (default 10).' },
      vault: { type: 'string', description: 'Vault name.' },
    },
    required: [],
  },
};

const TOOL_GET_CONNECTION_SUGGESTIONS = {
  name: 'get_connection_suggestions',
  description: 'Find node pairs sharing neighbors but not directly connected.',
  inputSchema: {
    type: 'object' as const,
    properties: {
      limit: { type: 'number', description: 'Max suggestions (default 10).' },
      min_shared: { type: 'number', description: 'Min shared neighbors (default 2).' },
      vault: { type: 'string', description: 'Vault name.' },
    },
    required: [],
  },
};

const TOOL_GET_GRAPH_HEALTH = {
  name: 'get_graph_health',
  description: 'Composite health metrics: orphan rate, density, avg degree, clusters, components.',
  inputSchema: {
    type: 'object' as const,
    properties: {
      vault: { type: 'string', description: 'Vault name.' },
    },
    required: [],
  },
};

const TOOL_FIND_SHORTEST_PATH = {
  name: 'find_shortest_path',
  description: 'Find shortest path between two nodes.',
  inputSchema: {
    type: 'object' as const,
    properties: {
      source_id: { type: 'string', description: 'Starting node ID.' },
      target_id: { type: 'string', description: 'Destination node ID.' },
      max_hops: { type: 'number', description: 'Max hops (default 6).' },
      vault: { type: 'string', description: 'Vault name.' },
    },
    required: ['source_id', 'target_id'],
  },
};
```

Then add to the `readTools` array (around line 576):

```typescript
  const readTools = [
    TOOL_SEARCH_NODES, TOOL_GET_NODE_DETAILS, TOOL_GET_NEIGHBORS,
    TOOL_GET_GRAPH_OVERVIEW, TOOL_GET_SUBGRAPH, TOOL_GET_NODES_BY_TYPE,
    TOOL_READ_NOTE, TOOL_LIST_NOTES, TOOL_SEARCH_NOTES, TOOL_FIND_SIMILAR_ENTITIES,
    TOOL_SEMANTIC_SEARCH,
    TOOL_GET_CENTRALITY_RANKING, TOOL_GET_ORPHAN_NODES, TOOL_GET_CLUSTERS,
    TOOL_GET_BRIDGE_NODES, TOOL_GET_CONNECTION_SUGGESTIONS, TOOL_GET_GRAPH_HEALTH,
    TOOL_FIND_SHORTEST_PATH,
  ];
```

Then add case handlers inside `CallToolRequestSchema` handler, before the `default:` case (around line 877):

```typescript
      case 'get_centrality_ranking': {
        const vault = resolveVault(toolArgs);
        if ('error' in vault) return { content: [{ type: 'text', text: JSON.stringify(vault) }], isError: true };
        const { result, isError } = vault.provider.getCentralityRanking(getNumber(toolArgs, 'limit'), getString(toolArgs, 'node_type'));
        return { content: [{ type: 'text', text: result }], isError };
      }

      case 'get_orphan_nodes': {
        const vault = resolveVault(toolArgs);
        if ('error' in vault) return { content: [{ type: 'text', text: JSON.stringify(vault) }], isError: true };
        const { result, isError } = vault.provider.getOrphanNodes(getNumber(toolArgs, 'limit'), getString(toolArgs, 'node_type'));
        return { content: [{ type: 'text', text: result }], isError };
      }

      case 'get_clusters': {
        const vault = resolveVault(toolArgs);
        if ('error' in vault) return { content: [{ type: 'text', text: JSON.stringify(vault) }], isError: true };
        const { result, isError } = vault.provider.getClusters(getNumber(toolArgs, 'min_size'), toolArgs.include_members === true);
        return { content: [{ type: 'text', text: result }], isError };
      }

      case 'get_bridge_nodes': {
        const vault = resolveVault(toolArgs);
        if ('error' in vault) return { content: [{ type: 'text', text: JSON.stringify(vault) }], isError: true };
        const { result, isError } = vault.provider.getBridgeNodes(getNumber(toolArgs, 'limit'));
        return { content: [{ type: 'text', text: result }], isError };
      }

      case 'get_connection_suggestions': {
        const vault = resolveVault(toolArgs);
        if ('error' in vault) return { content: [{ type: 'text', text: JSON.stringify(vault) }], isError: true };
        const { result, isError } = vault.provider.getConnectionSuggestions(getNumber(toolArgs, 'limit'), getNumber(toolArgs, 'min_shared'));
        return { content: [{ type: 'text', text: result }], isError };
      }

      case 'get_graph_health': {
        const vault = resolveVault(toolArgs);
        if ('error' in vault) return { content: [{ type: 'text', text: JSON.stringify(vault) }], isError: true };
        const { result, isError } = vault.provider.getGraphHealth();
        return { content: [{ type: 'text', text: result }], isError };
      }

      case 'find_shortest_path': {
        const sourceId = getString(toolArgs, 'source_id');
        const targetId = getString(toolArgs, 'target_id');
        if (!sourceId || !targetId) return { content: [{ type: 'text', text: JSON.stringify({ error: 'source_id and target_id are required' }) }], isError: true };
        const vault = resolveVault(toolArgs);
        if ('error' in vault) return { content: [{ type: 'text', text: JSON.stringify(vault) }], isError: true };
        const { result, isError } = vault.provider.findShortestPath(sourceId, targetId, getNumber(toolArgs, 'max_hops'));
        return { content: [{ type: 'text', text: result }], isError };
      }
```

- [ ] **Step 3: Build the MCP package to verify**

Run: `npm run build:mcp 2>&1 | tail -5`
Expected: Build succeeds

- [ ] **Step 4: Commit**

```bash
git add packages/synapse-mcp/src/standalone-provider.ts packages/synapse-mcp/src/index.ts
git commit -m "feat: add 7 intelligence MCP tools (centrality, orphans, clusters, bridges, suggestions, health, paths)"
```

---

### Task 4: Add synthesis tools (Phase 2)

**Files:**
- Modify: `src/commands/tools/intelligence-tools.ts`

- [ ] **Step 1: Add synthesis tool definitions to `intelligence-tools.ts`**

Add after the `analyticsDefs` array, before the `export const definitions` line:

```typescript
const synthesisDefs: ChatToolDefinition[] = [
  {
    name: 'synthesize_domains',
    description:
      'Find structural parallels between two knowledge domains. Loads nodes from each domain and uses the LLM to identify connections, shared patterns, and bridging concepts. Supports graph-only mode (strict, cites node IDs) or augmented mode (supplements with world knowledge).',
    parameters: {
      type: 'object',
      properties: {
        domain_a: { type: 'string', description: 'First domain: a node type (e.g. "concept"), cluster ID number, or a search query' },
        domain_b: { type: 'string', description: 'Second domain: same format as domain_a' },
        mode: { type: 'string', description: '"graph-only" (default) or "augmented" — graph-only constrains analysis to graph data only' },
        limit: { type: 'number', description: 'Max nodes to load per domain (default 20)' },
      },
      required: ['domain_a', 'domain_b'],
    },
    executionContext: 'ui',
  },
  {
    name: 'analyze_gaps',
    description:
      'Identify what concepts or connections are missing from a knowledge domain. Loads nodes in the domain and asks the LLM what a practitioner would expect to find but is absent.',
    parameters: {
      type: 'object',
      properties: {
        domain: { type: 'string', description: 'Domain to analyze: a node type, cluster ID number, or search query' },
        mode: { type: 'string', description: '"graph-only" (default) or "augmented"' },
        limit: { type: 'number', description: 'Max nodes to load (default 30)' },
      },
      required: ['domain'],
    },
    executionContext: 'ui',
  },
];
```

Update the definitions export:

```typescript
export const definitions: ChatToolDefinition[] = [...analyticsDefs, ...synthesisDefs];
```

- [ ] **Step 2: Add domain resolution helper and synthesis execute handlers**

Add a helper function before the `execute` function:

```typescript
async function resolveDomain(
  ctx: CommandContext,
  domain: string,
  limit: number
): Promise<Array<{ id: string; name: string; type: string; label?: string | null }>> {
  const { nodes } = await ctx.db.loadGraph();

  const types = new Set(nodes.map(n => n.type));
  const labels = new Set(nodes.filter(n => n.label).map(n => n.label!));
  if (types.has(domain) || labels.has(domain)) {
    return nodes
      .filter(n => n.type === domain || n.label === domain)
      .slice(0, limit)
      .map(n => ({ id: n.id, name: n.name, type: n.type, label: n.label }));
  }

  if (/^\d+$/.test(domain)) {
    const edges = (await ctx.db.edges.getAll());
    const map = buildAdjacencyMap(edges);
    const clusters = labelPropagation(map, nodes);
    const cluster = clusters.find(c => c.id === parseInt(domain, 10));
    if (cluster) {
      return cluster.nodeIds.slice(0, limit).map(id => {
        const n = nodes.find(nd => nd.id === id);
        return { id, name: n?.name ?? '?', type: n?.type ?? '?', label: n?.label };
      });
    }
  }

  const searchResults = await ctx.db.nodes.search(domain, limit);
  return searchResults.map(n => ({ id: n.id, name: n.name, type: n.type, label: n.label }));
}
```

Then add the two synthesis cases inside the `switch (name)` block, before the `default:` case:

```typescript
    case 'synthesize_domains': {
      const domainA = input.domain_a as string;
      const domainB = input.domain_b as string;
      const mode = (input.mode as string) ?? 'graph-only';
      const limit = (input.limit as number) ?? 20;

      const [nodesA, nodesB] = await Promise.all([
        resolveDomain(ctx, domainA, limit),
        resolveDomain(ctx, domainB, limit),
      ]);

      if (nodesA.length === 0) return { result: JSON.stringify({ error: `No nodes found for domain "${domainA}"` }) };
      if (nodesB.length === 0) return { result: JSON.stringify({ error: `No nodes found for domain "${domainB}"` }) };

      const domainAText = nodesA.map(n => `- [${n.id}] ${n.name} (${n.label ?? n.type})`).join('\n');
      const domainBText = nodesB.map(n => `- [${n.id}] ${n.name} (${n.label ?? n.type})`).join('\n');

      const constraint = mode === 'graph-only'
        ? 'Analyze ONLY the provided graph data. Do not introduce external knowledge. Every claim must reference specific node IDs in brackets.'
        : 'Start from the provided graph data. You may supplement with world knowledge, but clearly prefix each insight with [GRAPH] or [WORLD] to indicate its source.';

      const prompt = `You are analyzing a knowledge graph to find structural parallels between two domains.

${constraint}

## Domain A: "${domainA}" (${nodesA.length} entities)
${domainAText}

## Domain B: "${domainB}" (${nodesB.length} entities)
${domainBText}

Find:
1. Concepts that appear in both domains or share structural similarities
2. Patterns or themes that bridge the two domains
3. Potential connections worth creating between specific entities

Be specific — reference node IDs and names.`;

      const result = await ctx.llm.complete(prompt);
      return {
        result: JSON.stringify({ synthesis: result, domainA: { query: domainA, nodeCount: nodesA.length }, domainB: { query: domainB, nodeCount: nodesB.length }, mode }),
        collectedNodeIds: [...nodesA.map(n => n.id), ...nodesB.map(n => n.id)],
      };
    }

    case 'analyze_gaps': {
      const domain = input.domain as string;
      const mode = (input.mode as string) ?? 'graph-only';
      const limit = (input.limit as number) ?? 30;

      const domainNodes = await resolveDomain(ctx, domain, limit);
      if (domainNodes.length === 0) return { result: JSON.stringify({ error: `No nodes found for domain "${domain}"` }) };

      const nodeText = domainNodes.map(n => `- [${n.id}] ${n.name} (${n.label ?? n.type})`).join('\n');

      const constraint = mode === 'graph-only'
        ? 'Based ONLY on the provided entities, identify structural gaps — entities that are referenced or implied but missing, and connections between existing entities that should exist but do not.'
        : 'Analyze the provided entities and supplement with domain knowledge. For each gap, prefix with [STRUCTURAL] if identified from graph structure alone, or [DOMAIN] if identified from world knowledge.';

      const prompt = `You are analyzing a knowledge graph domain for completeness.

${constraint}

## Domain: "${domain}" (${domainNodes.length} entities)
${nodeText}

Identify:
1. Concepts a practitioner in this domain would expect to find but are absent
2. Connections between existing entities that should exist but are missing
3. Areas where coverage is thin compared to what the domain warrants

Be specific — reference existing node IDs where relevant.`;

      const result = await ctx.llm.complete(prompt);
      return {
        result: JSON.stringify({ analysis: result, domain, nodeCount: domainNodes.length, mode }),
        collectedNodeIds: domainNodes.map(n => n.id),
      };
    }
```

- [ ] **Step 3: Verify the build compiles**

Run: `npx tsc --noEmit --pretty 2>&1 | head -20`
Expected: No errors. If `ctx.llm.complete` doesn't exist, check `PlatformLLM` interface in `src/platform/types.ts` for the correct method name and adjust accordingly.

- [ ] **Step 4: Commit**

```bash
git add src/commands/tools/intelligence-tools.ts
git commit -m "feat: add synthesize_domains and analyze_gaps LLM-powered tools"
```

---

### Task 5: Enhance IntelligencePanel (Phase 4)

**Files:**
- Modify: `src/ui/components/intelligence/IntelligencePanel.tsx`

- [ ] **Step 1: Add imports for new algorithms**

Update the import block at the top of the file. Replace the existing import:

```typescript
import {
  labelPropagation,
  findConnectionSuggestions,
  detectPatterns,
  degreeCentrality,
  type Cluster,
  type ConnectionSuggestion,
  type PatternInsight,
} from '../../../graph/algorithms/graph-algorithms';
```

With:

```typescript
import {
  labelPropagation,
  findConnectionSuggestions,
  detectPatterns,
  degreeCentrality,
  connectedComponents,
  findOrphans,
  findBridgeNodes,
  computeGraphHealth,
  type Cluster,
  type ConnectionSuggestion,
  type PatternInsight,
  type GraphHealthMetrics,
  type BridgeNode,
} from '../../../graph/algorithms/graph-algorithms';
```

- [ ] **Step 2: Extend the analysis useMemo to compute health, orphans, and bridges**

Replace the `analysis` useMemo block:

```typescript
  const analysis = useMemo(() => {
    if (nodes.length < 3) return null;

    const clusters = labelPropagation(adjacency, nodes);
    const suggestions = findConnectionSuggestions(adjacency, nodes);
    const patterns = detectPatterns(nodes, edges, adjacency);
    const centrality = degreeCentrality(adjacency, nodes);

    const centralNodes = [...centrality.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 8)
      .filter(([, score]) => score > 0);

    const components = connectedComponents(adjacency, nodes);
    const health = computeGraphHealth(nodes, edges, adjacency, clusters, components);
    const orphans = findOrphans(adjacency, nodes);
    const bridges = findBridgeNodes(adjacency, nodes, clusters);

    return { clusters, suggestions, patterns, centralNodes, health, orphans, bridges };
  }, [nodes, edges, adjacency]);
```

- [ ] **Step 3: Add HealthCard component**

Add after the `SuggestionCard` function, at the end of the file:

```typescript
function HealthCard({ health }: { health: GraphHealthMetrics }) {
  const metrics = [
    { label: 'Nodes', value: health.nodeCount },
    { label: 'Edges', value: health.edgeCount },
    { label: 'Orphan Rate', value: `${Math.round(health.orphanRate * 100)}%` },
    { label: 'Avg Degree', value: health.avgDegree.toFixed(1) },
    { label: 'Clusters', value: health.clusterCount },
    { label: 'Density', value: health.density.toFixed(4) },
  ];

  return (
    <div className="grid grid-cols-3 gap-2">
      {metrics.map(m => (
        <div key={m.label} className="px-2 py-1.5 bg-zinc-800/70 rounded border border-zinc-700/50 text-center">
          <p className="text-xs font-medium text-zinc-200">{m.value}</p>
          <p className="text-[10px] text-zinc-500">{m.label}</p>
        </div>
      ))}
    </div>
  );
}
```

- [ ] **Step 4: Add OrphanSection and BridgeSection components**

Add after `HealthCard`:

```typescript
function OrphanSection({ orphans, onNodeClick }: { orphans: ReturnType<typeof findOrphans>; onNodeClick: (id: string) => void }) {
  if (orphans.length === 0) return null;
  return (
    <Section title={`Orphan Nodes (${orphans.length})`}>
      <div className="space-y-1">
        {orphans.slice(0, 10).map(node => (
          <button
            key={node.id}
            onClick={() => onNodeClick(node.id)}
            className="w-full text-left flex items-center gap-2 px-2 py-1.5 rounded hover:bg-zinc-700/50 transition-colors"
          >
            <span className="w-2 h-2 rounded-full shrink-0 bg-amber-500/60" />
            <span className="text-xs text-zinc-300 truncate">{node.name}</span>
            <span className="text-[10px] text-zinc-600 ml-auto">{node.label ?? node.type}</span>
          </button>
        ))}
        {orphans.length > 10 && (
          <p className="text-[10px] text-zinc-600 px-2">+{orphans.length - 10} more</p>
        )}
      </div>
    </Section>
  );
}

function BridgeSection({
  bridges,
  nodes,
  onNodeClick,
}: {
  bridges: BridgeNode[];
  nodes: ReturnType<typeof useGraphStore.getState>['nodes'];
  onNodeClick: (id: string) => void;
}) {
  if (bridges.length === 0) return null;
  return (
    <Section title={`Bridge Nodes (${bridges.length})`}>
      <div className="space-y-1">
        {bridges.slice(0, 8).map(bridge => {
          const node = nodes.find(n => n.id === bridge.nodeId);
          if (!node) return null;
          return (
            <button
              key={bridge.nodeId}
              onClick={() => onNodeClick(bridge.nodeId)}
              className="w-full text-left flex items-center gap-2 px-2 py-1.5 rounded hover:bg-zinc-700/50 transition-colors"
            >
              <span className="w-2 h-2 rounded-full shrink-0 bg-purple-500/60" />
              <span className="text-xs text-zinc-300 truncate">{node.name}</span>
              <span className="text-[10px] text-zinc-600 ml-auto">
                bridges {bridge.clustersConnected.length} clusters
              </span>
            </button>
          );
        })}
      </div>
    </Section>
  );
}
```

- [ ] **Step 5: Update the render body to include new sections**

Replace the return block of `IntelligencePanel` (the one starting with `<div className="p-4 space-y-5 text-sm">`):

```typescript
  return (
    <div className="p-4 space-y-5 text-sm">
      <h3 className="text-sm font-semibold text-zinc-100">Intelligence</h3>

      {/* Vault Health */}
      <HealthCard health={analysis.health} />

      {/* Patterns / Insights */}
      {analysis.patterns.length > 0 && (
        <Section title="Insights">
          {analysis.patterns.map((pattern, i) => (
            <PatternCard key={i} pattern={pattern} onNodeClick={handleNodeClick} />
          ))}
        </Section>
      )}

      {/* Clusters */}
      {analysis.clusters.length > 0 && (
        <Section title={`Knowledge Clusters (${analysis.clusters.length})`}>
          {analysis.clusters.slice(0, 8).map((cluster) => (
            <ClusterCard key={cluster.id} cluster={cluster} onNodeClick={handleNodeClick} />
          ))}
        </Section>
      )}

      {/* Central entities */}
      {analysis.centralNodes.length > 0 && (
        <Section title="Central Entities">
          <div className="space-y-1">
            {analysis.centralNodes.map(([nodeId, score]) => {
              const node = nodes.find((n) => n.id === nodeId);
              if (!node) return null;
              const degree = adjacency.get(nodeId)?.length ?? 0;
              return (
                <button
                  key={nodeId}
                  onClick={() => handleNodeClick(nodeId)}
                  className="w-full text-left flex items-center gap-2 px-2 py-1.5 rounded hover:bg-zinc-700/50 transition-colors"
                >
                  <span
                    className="w-2 h-2 rounded-full shrink-0"
                    style={{ backgroundColor: node.color ?? '#6B7280' }}
                  />
                  <span className="text-xs text-zinc-300 truncate">{node.name}</span>
                  <span className="text-[10px] text-zinc-500 ml-1">{(score * 100).toFixed(0)}%</span>
                  <span className="text-[10px] text-zinc-600 ml-auto">{degree} connections</span>
                </button>
              );
            })}
          </div>
        </Section>
      )}

      {/* Bridge Nodes */}
      <BridgeSection bridges={analysis.bridges} nodes={nodes} onNodeClick={handleNodeClick} />

      {/* Orphan Nodes */}
      <OrphanSection orphans={analysis.orphans} onNodeClick={handleNodeClick} />

      {/* Connection suggestions */}
      {analysis.suggestions.length > 0 && (
        <Section title="Potential Connections">
          {analysis.suggestions.slice(0, 5).map((suggestion, i) => (
            <SuggestionCard
              key={i}
              suggestion={suggestion}
              nodes={nodes}
              onNodeClick={handleNodeClick}
            />
          ))}
        </Section>
      )}

      {analysis.clusters.length === 0 && analysis.suggestions.length === 0 && analysis.patterns.length === 0 && (
        <p className="text-xs text-zinc-500 text-center py-4">
          No notable patterns detected yet. Keep building your graph!
        </p>
      )}
    </div>
  );
```

- [ ] **Step 6: Verify the build compiles**

Run: `npx tsc --noEmit --pretty 2>&1 | head -20`
Expected: No errors

- [ ] **Step 7: Build the Electron renderer to verify**

Run: `npm run build:electron-renderer 2>&1 | tail -10`
Expected: Build succeeds

- [ ] **Step 8: Commit**

```bash
git add src/ui/components/intelligence/IntelligencePanel.tsx
git commit -m "feat: enhance IntelligencePanel with health card, orphan nodes, bridge nodes"
```

---

### Task 6: Verify end-to-end with Electron build

**Files:** None (verification only)

- [ ] **Step 1: Build entire Electron app**

Run: `npm run build:electron 2>&1 | tail -10`
Expected: Both main and renderer builds succeed

- [ ] **Step 2: Build MCP package**

Run: `npm run build:mcp 2>&1 | tail -10`
Expected: Build succeeds

- [ ] **Step 3: Launch and verify**

Run: `npx electron . &` — open the app, navigate to the Intelligence panel, confirm the health card and new sections render.

- [ ] **Step 4: Final commit if any fixes needed**

Only commit if Step 3 revealed issues that were fixed.
