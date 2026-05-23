import { useMemo } from 'react';
import { useGraphStore } from '../../graph/store/graph-store';
import { useNodeTypeStore } from '../../graph/store/node-type-store';
import { useUIStore } from '../../graph/store/ui-store';
import { useExtractionReviewStore } from '../../graph/store/extraction-review-store';
import { graphDataToRender } from '../../graph/transforms/db-to-render';
import { reviewNodesToOverlayRender, reviewEdgesToOverlayRender } from '../../graph/transforms/review-to-render';

const GREYED_OUT_COLOR = '#3f3f46'; // zinc-700
const MERGE_TARGET_COLOR = '#71717a'; // zinc-500 — merge target stands out
const MERGE_NEIGHBOR_COLOR = '#52525b'; // zinc-600 — 1-hop context, slightly brighter than dimmed

export function useGraphData() {
  const nodes = useGraphStore((s) => s.nodes);
  const edges = useGraphStore((s) => s.edges);
  const types = useNodeTypeStore((s) => s.types);
  const visibleLayers = useUIStore((s) => s.visibleLayers);

  const reviewActive = useExtractionReviewStore((s) => s.active);
  const reviewViewMode = useExtractionReviewStore((s) => s.viewMode);
  const reviewNodes = useExtractionReviewStore((s) => s.nodes);
  const reviewEdges = useExtractionReviewStore((s) => s.edges);

  const typeColorMap = useMemo(() => {
    const map = new Map<string, string>();
    for (const t of types) {
      if (t.color) map.set(t.type, t.color);
    }
    return map;
  }, [types]);

  // Filter nodes by visible structural layers (Phase 6). Drop edges whose
  // endpoints are no longer in the visible set.
  const filtered = useMemo(() => {
    const filteredNodes = nodes.filter((n) =>
      visibleLayers[n.type as 'entity' | 'note' | 'resource'] === true
    );
    // Apply size hints by layer: notes are smaller, resources slightly smaller.
    const sized = filteredNodes.map((n) => {
      if (n.type === 'note') return { ...n, size: n.size * 0.6 };
      if (n.type === 'resource') return { ...n, size: n.size * 0.8 };
      return n;
    });
    const visibleIds = new Set(sized.map((n) => n.id));
    const filteredEdges = edges.filter(
      (e) => visibleIds.has(e.sourceId) && visibleIds.has(e.targetId)
    );
    return { nodes: sized, edges: filteredEdges };
  }, [nodes, edges, visibleLayers]);

  const renderData = useMemo(() => {
    const base = graphDataToRender(filtered.nodes, filtered.edges, typeColorMap);

    // Only merge review data in overlay mode
    if (!reviewActive || reviewViewMode !== 'overlay') {
      return base;
    }

    // Build merge context: targets + their 1-hop neighbors get brighter colors
    const mergeTargetIds = new Set<string>();
    for (const rn of reviewNodes) {
      if (!rn.removed && rn.mergeRecommendation?.status === 'accepted') {
        mergeTargetIds.add(rn.mergeRecommendation.existingNodeId);
      }
    }
    const mergeNeighborIds = new Set<string>(mergeTargetIds);
    if (mergeTargetIds.size > 0) {
      for (const e of filtered.edges) {
        if (mergeTargetIds.has(e.sourceId)) mergeNeighborIds.add(e.targetId);
        if (mergeTargetIds.has(e.targetId)) mergeNeighborIds.add(e.sourceId);
      }
    }

    const greyedNodes = base.nodes.map((n) => ({
      ...n,
      color: mergeTargetIds.has(n.id)
        ? MERGE_TARGET_COLOR
        : mergeNeighborIds.has(n.id)
          ? MERGE_NEIGHBOR_COLOR
          : GREYED_OUT_COLOR,
      data: { ...n.data, cluster: mergeTargetIds.has(n.id) ? 'merge-target' : mergeNeighborIds.has(n.id) ? 'merge-context' : 'existing' },
    }));

    const overlayNodes = reviewNodesToOverlayRender(reviewNodes, typeColorMap);
    const activeNodeIds = new Set(reviewNodes.filter((n) => !n.removed).map((n) => n.tempId));
    const overlayEdges = reviewEdgesToOverlayRender(reviewEdges, reviewNodes, activeNodeIds);

    return {
      nodes: [...greyedNodes, ...overlayNodes],
      edges: [...base.edges, ...overlayEdges],
    };
  }, [filtered, typeColorMap, reviewActive, reviewViewMode, reviewNodes, reviewEdges]);

  return renderData;
}
