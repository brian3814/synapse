import type { ReviewNode, ReviewEdge } from '../store/extraction-review-store';
import type { GraphNode } from '../../shared/types';
import type { ReagraphNode, ReagraphEdge } from './db-to-reagraph';

const REVIEW_NODE_FILL = '#059669'; // emerald
const MERGE_PENDING_FILL = '#D97706'; // amber
const MERGE_ACCEPTED_FILL = '#059669'; // emerald (accepted merge)
const EXISTING_NODE_FILL = '#3f3f46'; // zinc-700 (greyed out)

export function reviewNodesToReagraph(
  nodes: ReviewNode[],
  typeColorMap?: Map<string, string>
): ReagraphNode[] {
  return nodes
    .filter((n) => !n.removed)
    .map((node) => {
      let fill = typeColorMap?.get(node.type) ?? REVIEW_NODE_FILL;
      if (node.mergeRecommendation?.status === 'pending') {
        fill = MERGE_PENDING_FILL;
      } else if (node.mergeRecommendation?.status === 'accepted') {
        fill = MERGE_ACCEPTED_FILL;
      }

      return {
        id: node.tempId,
        label: node.label,
        fill,
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

/**
 * Creates greyed-out reagraph nodes for existing graph nodes that are
 * referenced by review edges (so edges can render in the mini graph).
 */
export function existingNodesToReagraph(
  existingNodes: GraphNode[]
): ReagraphNode[] {
  return existingNodes.map((node) => ({
    id: node.id,
    label: node.label,
    fill: EXISTING_NODE_FILL,
    size: node.size,
    data: {
      type: node.type,
      isReviewNode: false,
      cluster: 'existing',
    },
  }));
}

export function reviewEdgesToReagraph(
  edges: ReviewEdge[],
  validNodeIds: Set<string>
): ReagraphEdge[] {
  return edges
    .filter(
      (e) =>
        !e.removed &&
        validNodeIds.has(e.sourceTempId) &&
        validNodeIds.has(e.targetTempId)
    )
    .map((edge) => ({
      id: edge.tempId,
      source: edge.sourceTempId,
      target: edge.targetTempId,
      label: edge.label,
      size: 1,
      data: {
        type: edge.type,
        isReviewEdge: true,
      },
    }));
}

/**
 * For overlay mode: builds reagraph data where merged nodes use existing node IDs
 * so edges connect to the real graph nodes.
 */
export function reviewNodesToOverlayReagraph(
  nodes: ReviewNode[],
  typeColorMap?: Map<string, string>
): ReagraphNode[] {
  return nodes
    .filter((n) => !n.removed && n.mergeRecommendation?.status !== 'accepted')
    .map((node) => {
      const fill = node.mergeRecommendation?.status === 'pending'
        ? MERGE_PENDING_FILL
        : typeColorMap?.get(node.type) ?? REVIEW_NODE_FILL;

      return {
        id: node.tempId,
        label: node.label,
        fill,
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

/**
 * For overlay mode: resolves edge endpoints — merged nodes point to existing graph node IDs.
 * Endpoints that are already real node IDs (existing graph nodes) pass through as-is.
 */
export function reviewEdgesToOverlayReagraph(
  edges: ReviewEdge[],
  nodes: ReviewNode[],
  activeReviewIds: Set<string>
): ReagraphEdge[] {
  // Build a mapping: tempId → resolved ID (existing node ID for accepted merges, else tempId)
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
      // Each endpoint is valid if it's an active review node, or not a review node (existing graph node)
      const sourceOk = activeReviewIds.has(e.sourceTempId) || !allReviewIds.has(e.sourceTempId);
      const targetOk = activeReviewIds.has(e.targetTempId) || !allReviewIds.has(e.targetTempId);
      return sourceOk && targetOk;
    })
    .map((edge) => ({
      id: edge.tempId,
      source: resolvedIds.get(edge.sourceTempId) ?? edge.sourceTempId,
      target: resolvedIds.get(edge.targetTempId) ?? edge.targetTempId,
      label: edge.label,
      size: 1,
      data: {
        type: edge.type,
        isReviewEdge: true,
      },
    }));
}
