import type { RenderNode, RenderEdge } from '../renderer/types';
import { FALLBACK_TYPE_COLOR } from '../../shared/constants';
import type { ClusterSummary, InterClusterEdge } from '../../db/worker/queries/spatial-queries';

const MIN_CLUSTER_SIZE = 3;
const CLUSTER_SCALE = 0.3;

export function clusterSummaryToRenderNodes(
  clusters: ClusterSummary[],
  typeColorMap: Map<string, string>
): RenderNode[] {
  return clusters.map((c) => ({
    id: `cluster-${c.type}`,
    label: `${c.type} (${c.count})`,
    x: c.avgX,
    y: c.avgY,
    z: 0,
    color: typeColorMap.get(c.type) ?? FALLBACK_TYPE_COLOR,
    size: Math.max(MIN_CLUSTER_SIZE, Math.sqrt(c.count) * CLUSTER_SCALE),
    data: { isCluster: true, type: c.type, count: c.count },
  }));
}

export function interClusterEdgesToRenderEdges(
  interEdges: InterClusterEdge[]
): RenderEdge[] {
  return interEdges.map((e) => ({
    id: `cluster-edge-${e.sourceType}-${e.targetType}`,
    sourceId: `cluster-${e.sourceType}`,
    targetId: `cluster-${e.targetType}`,
    label: String(e.count),
    directed: true,
    data: { isClusterEdge: true, count: e.count },
  }));
}
