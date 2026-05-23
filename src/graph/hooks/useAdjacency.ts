import { useCallback, useMemo } from 'react';
import { useGraphStore } from '../store/graph-store';
import { getNeighbors, getDegree, type AdjacencyEntry } from '../algorithms/adjacency';
import { bfsPath, nHopNeighborhood, connectedComponents, degreeCentrality } from '../algorithms/graph-algorithms';

export function useAdjacency() {
  const adjacency = useGraphStore((s) => s.adjacency);
  const nodes = useGraphStore((s) => s.nodes);

  const neighbors = useCallback(
    (nodeId: string): AdjacencyEntry[] => getNeighbors(adjacency, nodeId),
    [adjacency]
  );

  const degree = useCallback(
    (nodeId: string): number => getDegree(adjacency, nodeId),
    [adjacency]
  );

  const findPath = useCallback(
    (sourceId: string, targetId: string, maxHops = 6): string[] | null =>
      bfsPath(adjacency, sourceId, targetId, maxHops),
    [adjacency]
  );

  const neighborhood = useCallback(
    (nodeId: string, hops: number): Set<string> =>
      nHopNeighborhood(adjacency, nodeId, hops),
    [adjacency]
  );

  const components = useCallback(
    (): Set<string>[] => connectedComponents(adjacency, nodes),
    [adjacency, nodes]
  );

  const centrality = useCallback(
    (): Map<string, number> => degreeCentrality(adjacency, nodes),
    [adjacency, nodes]
  );

  return useMemo(
    () => ({ neighbors, degree, findPath, neighborhood, components, centrality }),
    [neighbors, degree, findPath, neighborhood, components, centrality]
  );
}
