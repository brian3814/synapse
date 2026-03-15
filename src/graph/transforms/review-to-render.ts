import type { ReviewNode, ReviewEdge } from '../store/extraction-review-store';
import type { GraphNode } from '../../shared/types';
import type { RenderNode, RenderEdge } from '../renderer/types';

const REVIEW_NODE_COLOR = '#059669'; // emerald
const MERGE_PENDING_COLOR = '#D97706'; // amber
const MERGE_ACCEPTED_COLOR = '#059669'; // emerald (accepted merge)
const EXISTING_NODE_COLOR = '#3f3f46'; // zinc-700 (greyed out)

export function reviewNodesToRender(
  nodes: ReviewNode[],
  typeColorMap?: Map<string, string>
): RenderNode[] {
  return nodes
    .filter((n) => !n.removed)
    .map((node) => {
      let color = typeColorMap?.get(node.type) ?? REVIEW_NODE_COLOR;
      if (node.mergeRecommendation?.status === 'pending') {
        color = MERGE_PENDING_COLOR;
      } else if (node.mergeRecommendation?.status === 'accepted') {
        color = MERGE_ACCEPTED_COLOR;
      }

      return {
        id: node.tempId,
        label: node.label,
        x: 0,
        y: 0,
        color,
        size: 1,
        data: {
          type: node.type,
          properties: node.properties,
          isReviewNode: true,
          cluster: 'new',
          mergeStatus: node.mergeRecommendation?.status,
        },
      };
    });
}

export function existingNodesToRender(
  existingNodes: GraphNode[]
): RenderNode[] {
  return existingNodes.map((node) => ({
    id: node.id,
    label: node.label,
    x: node.x ?? 0,
    y: node.y ?? 0,
    color: EXISTING_NODE_COLOR,
    size: node.size,
    data: {
      type: node.type,
      isReviewNode: false,
      cluster: 'existing',
    },
  }));
}

export function reviewEdgesToRender(
  edges: ReviewEdge[],
  validNodeIds: Set<string>
): RenderEdge[] {
  return edges
    .filter(
      (e) =>
        !e.removed &&
        validNodeIds.has(e.sourceTempId) &&
        validNodeIds.has(e.targetTempId)
    )
    .map((edge) => ({
      id: edge.tempId,
      sourceId: edge.sourceTempId,
      targetId: edge.targetTempId,
      label: edge.label,
      directed: true,
      data: {
        type: edge.type,
        isReviewEdge: true,
      },
    }));
}

export function reviewNodesToOverlayRender(
  nodes: ReviewNode[],
  typeColorMap?: Map<string, string>
): RenderNode[] {
  return nodes
    .filter((n) => !n.removed && n.mergeRecommendation?.status !== 'accepted')
    .map((node) => {
      const color = node.mergeRecommendation?.status === 'pending'
        ? MERGE_PENDING_COLOR
        : typeColorMap?.get(node.type) ?? REVIEW_NODE_COLOR;

      return {
        id: node.tempId,
        label: node.label,
        x: 0,
        y: 0,
        color,
        size: 1,
        data: {
          type: node.type,
          properties: node.properties,
          isReviewNode: true,
          cluster: 'new',
          mergeStatus: node.mergeRecommendation?.status,
        },
      };
    });
}

export function reviewEdgesToOverlayRender(
  edges: ReviewEdge[],
  nodes: ReviewNode[],
  activeReviewIds: Set<string>
): RenderEdge[] {
  const resolvedIds = new Map<string, string>();
  const allReviewIds = new Set<string>();
  for (const node of nodes) {
    allReviewIds.add(node.tempId);
    if (node.removed) continue;
    if (node.mergeRecommendation?.status === 'accepted') {
      resolvedIds.set(node.tempId, node.mergeRecommendation.existingNodeId);
    } else {
      resolvedIds.set(node.tempId, node.tempId);
    }
  }

  return edges
    .filter((e) => {
      if (e.removed) return false;
      const sourceOk = activeReviewIds.has(e.sourceTempId) || !allReviewIds.has(e.sourceTempId);
      const targetOk = activeReviewIds.has(e.targetTempId) || !allReviewIds.has(e.targetTempId);
      return sourceOk && targetOk;
    })
    .map((edge) => ({
      id: edge.tempId,
      sourceId: resolvedIds.get(edge.sourceTempId) ?? edge.sourceTempId,
      targetId: resolvedIds.get(edge.targetTempId) ?? edge.targetTempId,
      label: edge.label,
      directed: true,
      data: {
        type: edge.type,
        isReviewEdge: true,
      },
    }));
}
