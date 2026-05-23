import type { GraphEdge } from '../../shared/types';

export interface AdjacencyEntry {
  nodeId: string;
  edgeId: string;
  edgeLabel: string;
  edgeType: string;
  direction: 'out' | 'in';
}

export type AdjacencyMap = Map<string, AdjacencyEntry[]>;

export function buildAdjacencyMap(edges: GraphEdge[]): AdjacencyMap {
  const map: AdjacencyMap = new Map();

  for (const edge of edges) {
    // source → target (outgoing)
    let srcEntries = map.get(edge.sourceId);
    if (!srcEntries) {
      srcEntries = [];
      map.set(edge.sourceId, srcEntries);
    }
    srcEntries.push({
      nodeId: edge.targetId,
      edgeId: edge.id,
      edgeLabel: edge.label,
      edgeType: edge.type,
      direction: 'out',
    });

    // target → source (incoming)
    let tgtEntries = map.get(edge.targetId);
    if (!tgtEntries) {
      tgtEntries = [];
      map.set(edge.targetId, tgtEntries);
    }
    tgtEntries.push({
      nodeId: edge.sourceId,
      edgeId: edge.id,
      edgeLabel: edge.label,
      edgeType: edge.type,
      direction: 'in',
    });
  }

  return map;
}

export function getNeighbors(map: AdjacencyMap, nodeId: string): AdjacencyEntry[] {
  return map.get(nodeId) ?? [];
}

export function getDegree(map: AdjacencyMap, nodeId: string): number {
  return (map.get(nodeId) ?? []).length;
}
