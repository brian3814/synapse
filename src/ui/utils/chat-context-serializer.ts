import type { GraphEdge } from '../../shared/types';

interface SerializableNode {
  id: string;
  name: string;
  type: string;
}

interface NodeMetadata {
  hasNote: boolean;
  hasSource: boolean;
}

export function serializeAttachedContext(
  nodeIds: string[],
  edges: GraphEdge[],
  metadata: Map<string, NodeMetadata>,
  nodeMap: Map<string, SerializableNode>,
): string {
  if (nodeIds.length === 0) return '';

  const lines: string[] = [`[Graph Context: ${nodeIds.length} nodes attached]`];

  for (const nodeId of nodeIds) {
    const node = nodeMap.get(nodeId);
    if (!node) continue;

    let connectionCount = 0;
    for (const edge of edges) {
      if (edge.sourceId === nodeId || edge.targetId === nodeId) connectionCount++;
    }

    const meta = metadata.get(nodeId);
    const hints: string[] = [];
    if (connectionCount > 0) hints.push(`${connectionCount} connections`);
    if (meta?.hasNote) hints.push('has note');
    if (meta?.hasSource) hints.push('has source');

    const hintsStr = hints.length > 0 ? ` — ${hints.join(', ')}` : '';
    lines.push(`- ${node.name} (${node.type}, id:${node.id})${hintsStr}`);
  }

  lines.push('');
  lines.push('Use get_node_details, get_neighbors, read_note, get_source_content to inspect these nodes.');

  return lines.join('\n');
}
