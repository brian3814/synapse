import { useMemo } from 'react';
import { useGraphStore } from '../../graph/store/graph-store';
import { useNodeTypeStore } from '../../graph/store/node-type-store';
import { useExtractionReviewStore } from '../../graph/store/extraction-review-store';
import { graphDataToReagraph } from '../../graph/transforms/db-to-reagraph';
import { reviewNodesToOverlayReagraph, reviewEdgesToOverlayReagraph } from '../../graph/transforms/review-to-reagraph';

const GREYED_OUT_FILL = '#3f3f46'; // zinc-700

export function useGraphData() {
  const nodes = useGraphStore((s) => s.nodes);
  const edges = useGraphStore((s) => s.edges);
  const types = useNodeTypeStore((s) => s.types);

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

  const reagraphData = useMemo(() => {
    const base = graphDataToReagraph(nodes, edges, typeColorMap);

    // Only merge review data in overlay mode
    if (!reviewActive || reviewViewMode !== 'overlay') {
      return base;
    }

    // Grey out existing nodes and tag them as 'existing' cluster
    const greyedNodes = base.nodes.map((n) => ({
      ...n,
      fill: GREYED_OUT_FILL,
      data: { ...n.data, cluster: 'existing' },
    }));

    const overlayNodes = reviewNodesToOverlayReagraph(reviewNodes, typeColorMap);
    const activeNodeIds = new Set(reviewNodes.filter((n) => !n.removed).map((n) => n.tempId));
    const overlayEdges = reviewEdgesToOverlayReagraph(reviewEdges, reviewNodes, activeNodeIds);

    return {
      nodes: [...greyedNodes, ...overlayNodes],
      edges: [...base.edges, ...overlayEdges],
    };
  }, [nodes, edges, typeColorMap, reviewActive, reviewViewMode, reviewNodes, reviewEdges]);

  return reagraphData;
}
