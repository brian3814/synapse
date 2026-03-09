import type { GraphNode, GraphEdge } from '../../shared/types';
import type { RenderNode, RenderEdge } from '../renderer/types';
import { FALLBACK_TYPE_COLOR } from '../../shared/constants';

export function graphNodesToRender(
  nodes: GraphNode[],
  typeColorMap?: Map<string, string>
): RenderNode[] {
  return nodes.map((node) => ({
    id: node.id,
    label: node.label,
    x: node.x ?? 0,
    y: node.y ?? 0,
    color: node.color || typeColorMap?.get(node.type) || FALLBACK_TYPE_COLOR,
    size: node.size,
    data: {
      type: node.type,
      properties: node.properties,
      sourceUrl: node.sourceUrl,
      createdAt: node.createdAt,
    },
  }));
}

export function graphEdgesToRender(edges: GraphEdge[]): RenderEdge[] {
  return edges.map((edge) => ({
    id: edge.id,
    sourceId: edge.sourceId,
    targetId: edge.targetId,
    label: edge.label,
    directed: edge.directed,
    data: {
      type: edge.type,
      properties: edge.properties,
      weight: edge.weight,
      sourceUrl: edge.sourceUrl,
    },
  }));
}

export function graphDataToRender(
  nodes: GraphNode[],
  edges: GraphEdge[],
  typeColorMap?: Map<string, string>
): {
  nodes: RenderNode[];
  edges: RenderEdge[];
} {
  return {
    nodes: graphNodesToRender(nodes, typeColorMap),
    edges: graphEdgesToRender(edges),
  };
}
