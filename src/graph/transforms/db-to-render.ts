import type { GraphNode, GraphEdge } from '../../shared/types';
import type { RenderNode, RenderEdge } from '../renderer/types';
import { FALLBACK_TYPE_COLOR, NODE_RENDER_SCALE } from '../../shared/constants';

/**
 * Picks a color for a node in the three-layer model:
 * - For entities, prefer the label color (e.g., 'person', 'technology')
 *   so entities get distinct semantic colors even though they share type='entity'.
 * - For resource/note, use the structural type color.
 */
function colorForNode(node: GraphNode, typeColorMap?: Map<string, string>): string {
  if (node.color) return node.color;
  if (node.type === 'entity' && node.label) {
    const labelColor = typeColorMap?.get(node.label);
    if (labelColor) return labelColor;
  }
  return typeColorMap?.get(node.type) ?? FALLBACK_TYPE_COLOR;
}

export function graphNodesToRender(
  nodes: GraphNode[],
  typeColorMap?: Map<string, string>
): RenderNode[] {
  return nodes.map((node) => ({
    id: node.id,
    name: node.name,
    x: node.x ?? 0,
    y: node.y ?? 0,
    z: 0,
    color: colorForNode(node, typeColorMap),
    size: node.size * NODE_RENDER_SCALE,
    data: {
      type: node.type,
      label: node.label,
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
