import type { AdjacencyMap } from './adjacency';
import type { GraphNode, GraphEdge } from '../../shared/types';

/**
 * BFS shortest path between two nodes. Returns the node ID path or null if unreachable.
 */
export function bfsPath(
  map: AdjacencyMap,
  sourceId: string,
  targetId: string,
  maxHops = 6
): string[] | null {
  if (sourceId === targetId) return [sourceId];

  const visited = new Set<string>([sourceId]);
  const parent = new Map<string, string>();
  const queue: Array<{ id: string; depth: number }> = [{ id: sourceId, depth: 0 }];

  while (queue.length > 0) {
    const { id, depth } = queue.shift()!;
    if (depth >= maxHops) continue;

    const neighbors = map.get(id);
    if (!neighbors) continue;

    for (const entry of neighbors) {
      if (visited.has(entry.nodeId)) continue;
      visited.add(entry.nodeId);
      parent.set(entry.nodeId, id);

      if (entry.nodeId === targetId) {
        // Reconstruct path
        const path: string[] = [targetId];
        let current = targetId;
        while (current !== sourceId) {
          current = parent.get(current)!;
          path.push(current);
        }
        return path.reverse();
      }

      queue.push({ id: entry.nodeId, depth: depth + 1 });
    }
  }

  return null;
}

export interface PathResult {
  nodeIds: string[];
  edgeIds: string[];
}

/**
 * BFS shortest path between two nodes, returning both node and edge IDs.
 */
export function bfsPathWithEdges(
  map: AdjacencyMap,
  sourceId: string,
  targetId: string,
  maxHops = 6
): PathResult | null {
  if (sourceId === targetId) return { nodeIds: [sourceId], edgeIds: [] };

  const visited = new Set<string>([sourceId]);
  const parent = new Map<string, { nodeId: string; edgeId: string }>();
  const queue: Array<{ id: string; depth: number }> = [{ id: sourceId, depth: 0 }];

  while (queue.length > 0) {
    const { id, depth } = queue.shift()!;
    if (depth >= maxHops) continue;

    const neighbors = map.get(id);
    if (!neighbors) continue;

    for (const entry of neighbors) {
      if (visited.has(entry.nodeId)) continue;
      visited.add(entry.nodeId);
      parent.set(entry.nodeId, { nodeId: id, edgeId: entry.edgeId });

      if (entry.nodeId === targetId) {
        const nodeIds: string[] = [targetId];
        const edgeIds: string[] = [];
        let current = targetId;
        while (current !== sourceId) {
          const p = parent.get(current)!;
          edgeIds.push(p.edgeId);
          current = p.nodeId;
          nodeIds.push(current);
        }
        return { nodeIds: nodeIds.reverse(), edgeIds: edgeIds.reverse() };
      }

      queue.push({ id: entry.nodeId, depth: depth + 1 });
    }
  }

  return null;
}

/**
 * All node IDs within N hops of startId.
 */
export function nHopNeighborhood(map: AdjacencyMap, startId: string, hops: number): Set<string> {
  const visited = new Set<string>([startId]);
  let frontier = [startId];

  for (let i = 0; i < hops && frontier.length > 0; i++) {
    const nextFrontier: string[] = [];
    for (const id of frontier) {
      const neighbors = map.get(id);
      if (!neighbors) continue;
      for (const entry of neighbors) {
        if (!visited.has(entry.nodeId)) {
          visited.add(entry.nodeId);
          nextFrontier.push(entry.nodeId);
        }
      }
    }
    frontier = nextFrontier;
  }

  return visited;
}

/**
 * Normalized degree centrality for all nodes.
 */
export function degreeCentrality(map: AdjacencyMap, nodes: GraphNode[]): Map<string, number> {
  const n = nodes.length;
  const denom = n > 1 ? n - 1 : 1;
  const result = new Map<string, number>();

  for (const node of nodes) {
    const degree = (map.get(node.id) ?? []).length;
    result.set(node.id, degree / denom);
  }

  return result;
}

/**
 * Connected components via BFS. Returns an array of sets, each containing node IDs.
 */
export function connectedComponents(map: AdjacencyMap, nodes: GraphNode[]): Set<string>[] {
  const visited = new Set<string>();
  const components: Set<string>[] = [];

  for (const node of nodes) {
    if (visited.has(node.id)) continue;

    const component = new Set<string>();
    const queue = [node.id];
    visited.add(node.id);

    while (queue.length > 0) {
      const id = queue.shift()!;
      component.add(id);

      const neighbors = map.get(id);
      if (!neighbors) continue;
      for (const entry of neighbors) {
        if (!visited.has(entry.nodeId)) {
          visited.add(entry.nodeId);
          queue.push(entry.nodeId);
        }
      }
    }

    components.push(component);
  }

  return components;
}

// ---- Phase 5: Graph Intelligence Algorithms ----

export interface Cluster {
  id: number;
  nodeIds: string[];
  label: string; // Most common type or most connected node label
  size: number;
}

/**
 * Label propagation community detection.
 * Each node starts with its own label, then iteratively adopts the most
 * frequent label among its neighbors. Converges to community structure.
 */
export function labelPropagation(
  map: AdjacencyMap,
  nodes: GraphNode[],
  maxIterations = 20
): Cluster[] {
  if (nodes.length === 0) return [];

  // Initialize: each node gets its own label
  const labels = new Map<string, number>();
  nodes.forEach((n, i) => labels.set(n.id, i));

  // Shuffle order for each iteration to avoid oscillation
  const nodeIds = nodes.map((n) => n.id);

  for (let iter = 0; iter < maxIterations; iter++) {
    let changed = false;
    // Fisher-Yates shuffle
    for (let i = nodeIds.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [nodeIds[i], nodeIds[j]] = [nodeIds[j], nodeIds[i]];
    }

    for (const nodeId of nodeIds) {
      const neighbors = map.get(nodeId);
      if (!neighbors || neighbors.length === 0) continue;

      // Count neighbor labels
      const labelCounts = new Map<number, number>();
      for (const entry of neighbors) {
        const neighborLabel = labels.get(entry.nodeId);
        if (neighborLabel !== undefined) {
          labelCounts.set(neighborLabel, (labelCounts.get(neighborLabel) ?? 0) + 1);
        }
      }

      // Pick most frequent label
      let maxCount = 0;
      let bestLabel = labels.get(nodeId)!;
      for (const [label, count] of labelCounts) {
        if (count > maxCount) {
          maxCount = count;
          bestLabel = label;
        }
      }

      if (bestLabel !== labels.get(nodeId)) {
        labels.set(nodeId, bestLabel);
        changed = true;
      }
    }

    if (!changed) break;
  }

  // Group by label
  const groups = new Map<number, string[]>();
  for (const [nodeId, label] of labels) {
    let group = groups.get(label);
    if (!group) {
      group = [];
      groups.set(label, group);
    }
    group.push(nodeId);
  }

  // Build cluster objects
  const nodeMap = new Map(nodes.map((n) => [n.id, n]));
  const clusters: Cluster[] = [];
  let clusterId = 0;

  for (const [, nodeIds] of groups) {
    if (nodeIds.length < 2) continue; // Skip singleton clusters

    // Find most common type in cluster for the label
    const typeCounts = new Map<string, number>();
    for (const id of nodeIds) {
      const node = nodeMap.get(id);
      if (node) {
        typeCounts.set(node.type, (typeCounts.get(node.type) ?? 0) + 1);
      }
    }

    let clusterLabel = 'Cluster';
    let maxTypeCount = 0;
    for (const [type, count] of typeCounts) {
      if (count > maxTypeCount) {
        maxTypeCount = count;
        clusterLabel = type;
      }
    }

    // Use the most connected node's label as the cluster name
    let maxDegree = 0;
    let centralLabel = clusterLabel;
    for (const id of nodeIds) {
      const degree = (map.get(id) ?? []).length;
      if (degree > maxDegree) {
        maxDegree = degree;
        centralLabel = nodeMap.get(id)?.label ?? clusterLabel;
      }
    }

    clusters.push({
      id: clusterId++,
      nodeIds,
      label: `${centralLabel} (${clusterLabel})`,
      size: nodeIds.length,
    });
  }

  return clusters.sort((a, b) => b.size - a.size);
}

export interface ConnectionSuggestion {
  nodeA: string;
  nodeB: string;
  sharedNeighbors: string[];
  score: number;
}

/**
 * Find pairs of nodes that share multiple neighbors but aren't directly connected.
 * These are candidates for creating new edges.
 */
export function findConnectionSuggestions(
  map: AdjacencyMap,
  nodes: GraphNode[],
  minShared = 2,
  limit = 20
): ConnectionSuggestion[] {
  const suggestions: ConnectionSuggestion[] = [];
  const directlyConnected = new Set<string>();

  // Build set of directly connected pairs
  for (const [nodeId, entries] of map) {
    for (const entry of entries) {
      const key = [nodeId, entry.nodeId].sort().join('::');
      directlyConnected.add(key);
    }
  }

  // For each pair of nodes, count shared neighbors
  const nodeIds = nodes.map((n) => n.id);
  const neighborSets = new Map<string, Set<string>>();

  for (const nodeId of nodeIds) {
    const neighbors = new Set<string>();
    for (const entry of map.get(nodeId) ?? []) {
      neighbors.add(entry.nodeId);
    }
    neighborSets.set(nodeId, neighbors);
  }

  // Compare pairs (only nodes with enough neighbors to matter)
  const candidateNodes = nodeIds.filter((id) => (neighborSets.get(id)?.size ?? 0) >= minShared);

  for (let i = 0; i < candidateNodes.length; i++) {
    for (let j = i + 1; j < candidateNodes.length; j++) {
      const a = candidateNodes[i];
      const b = candidateNodes[j];

      // Skip if already connected
      const pairKey = [a, b].sort().join('::');
      if (directlyConnected.has(pairKey)) continue;

      // Find shared neighbors
      const aNeighbors = neighborSets.get(a)!;
      const bNeighbors = neighborSets.get(b)!;
      const shared: string[] = [];
      for (const n of aNeighbors) {
        if (bNeighbors.has(n)) shared.push(n);
      }

      if (shared.length >= minShared) {
        suggestions.push({
          nodeA: a,
          nodeB: b,
          sharedNeighbors: shared,
          score: shared.length,
        });
      }
    }
  }

  return suggestions.sort((a, b) => b.score - a.score).slice(0, limit);
}

export interface GapAnalysis {
  clusterA: Cluster;
  clusterB: Cluster;
  bridgeNodes: string[]; // Nodes in between that could connect
}

/**
 * Find disconnected clusters that could potentially be bridged.
 */
export function findGaps(
  clusters: Cluster[],
  map: AdjacencyMap
): GapAnalysis[] {
  const gaps: GapAnalysis[] = [];

  for (let i = 0; i < clusters.length; i++) {
    for (let j = i + 1; j < clusters.length; j++) {
      const a = clusters[i];
      const b = clusters[j];

      // Check if there's any edge between the two clusters
      const bSet = new Set(b.nodeIds);
      let connected = false;
      const potentialBridges: string[] = [];

      for (const nodeId of a.nodeIds) {
        const neighbors = map.get(nodeId) ?? [];
        for (const entry of neighbors) {
          if (bSet.has(entry.nodeId)) {
            connected = true;
            break;
          }
        }
        if (connected) break;

        // Check if any neighbor of this node is close to cluster B
        for (const entry of neighbors) {
          const secondHop = map.get(entry.nodeId) ?? [];
          for (const e2 of secondHop) {
            if (bSet.has(e2.nodeId)) {
              potentialBridges.push(entry.nodeId);
              break;
            }
          }
        }
      }

      if (!connected && a.size >= 3 && b.size >= 3) {
        gaps.push({
          clusterA: a,
          clusterB: b,
          bridgeNodes: [...new Set(potentialBridges)].slice(0, 5),
        });
      }
    }
  }

  return gaps.slice(0, 10);
}

export interface PatternInsight {
  type: 'recent_topic' | 'hub_node' | 'isolated_cluster';
  title: string;
  description: string;
  nodeIds: string[];
}

/**
 * Detect notable patterns in the graph.
 */
export function detectPatterns(
  nodes: GraphNode[],
  edges: GraphEdge[],
  map: AdjacencyMap
): PatternInsight[] {
  const insights: PatternInsight[] = [];
  const nodeMap = new Map(nodes.map((n) => [n.id, n]));

  // 1. Hub nodes (high degree relative to graph size)
  const avgDegree = nodes.length > 0
    ? nodes.reduce((sum, n) => sum + (map.get(n.id)?.length ?? 0), 0) / nodes.length
    : 0;

  const hubThreshold = Math.max(avgDegree * 2.5, 4);
  const hubs = nodes
    .filter((n) => (map.get(n.id)?.length ?? 0) >= hubThreshold)
    .sort((a, b) => (map.get(b.id)?.length ?? 0) - (map.get(a.id)?.length ?? 0));

  if (hubs.length > 0) {
    insights.push({
      type: 'hub_node',
      title: 'Hub Entities',
      description: `${hubs.length} highly connected ${hubs.length === 1 ? 'entity' : 'entities'}: ${hubs.slice(0, 3).map((n) => n.label).join(', ')}`,
      nodeIds: hubs.map((n) => n.id),
    });
  }

  // 2. Recent topics (most recently updated node types)
  const recentNodes = [...nodes]
    .sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime())
    .slice(0, 20);

  const recentTypeCounts = new Map<string, number>();
  for (const n of recentNodes) {
    recentTypeCounts.set(n.type, (recentTypeCounts.get(n.type) ?? 0) + 1);
  }

  const dominantType = [...recentTypeCounts.entries()]
    .sort((a, b) => b[1] - a[1])[0];

  if (dominantType && dominantType[1] >= 3) {
    const recentOfType = recentNodes.filter((n) => n.type === dominantType[0]);
    insights.push({
      type: 'recent_topic',
      title: 'Recent Focus',
      description: `You've been adding "${dominantType[0]}" entities recently: ${recentOfType.slice(0, 4).map((n) => n.label).join(', ')}`,
      nodeIds: recentOfType.map((n) => n.id),
    });
  }

  // 3. Isolated nodes (no connections)
  const isolated = nodes.filter((n) => (map.get(n.id)?.length ?? 0) === 0);
  if (isolated.length > 0 && isolated.length < nodes.length) {
    insights.push({
      type: 'isolated_cluster',
      title: 'Unconnected Entities',
      description: `${isolated.length} ${isolated.length === 1 ? 'entity has' : 'entities have'} no connections. Consider linking them.`,
      nodeIds: isolated.map((n) => n.id),
    });
  }

  return insights;
}
