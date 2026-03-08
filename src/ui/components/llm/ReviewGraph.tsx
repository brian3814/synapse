import React, { useRef, useMemo } from 'react';
import { GraphCanvas, GraphCanvasRef } from 'reagraph';
import { useExtractionReviewStore } from '../../../graph/store/extraction-review-store';
import { useGraphStore } from '../../../graph/store/graph-store';
import { useNodeTypeStore } from '../../../graph/store/node-type-store';
import { reviewNodesToReagraph, existingNodesToReagraph, reviewEdgesToReagraph } from '../../../graph/transforms/review-to-reagraph';

export function ReviewGraph() {
  const graphRef = useRef<GraphCanvasRef>(null);
  const reviewNodes = useExtractionReviewStore((s) => s.nodes);
  const reviewEdges = useExtractionReviewStore((s) => s.edges);
  const select = useExtractionReviewStore((s) => s.select);
  const types = useNodeTypeStore((s) => s.types);
  const graphNodes = useGraphStore((s) => s.nodes);

  const typeColorMap = useMemo(() => {
    const map = new Map<string, string>();
    for (const t of types) {
      if (t.color) map.set(t.type, t.color);
    }
    return map;
  }, [types]);

  // Review nodes (new/extracted)
  const newNodes = useMemo(
    () => reviewNodesToReagraph(reviewNodes, typeColorMap),
    [reviewNodes, typeColorMap]
  );

  // Find existing graph nodes referenced by review edges but not in review nodes
  const referencedExistingNodes = useMemo(() => {
    const reviewTempIds = new Set(reviewNodes.map((n) => n.tempId));
    const referencedIds = new Set<string>();
    for (const edge of reviewEdges) {
      if (edge.removed) continue;
      if (!reviewTempIds.has(edge.sourceTempId)) referencedIds.add(edge.sourceTempId);
      if (!reviewTempIds.has(edge.targetTempId)) referencedIds.add(edge.targetTempId);
    }
    const existing = graphNodes.filter((n) => referencedIds.has(n.id));
    return existingNodesToReagraph(existing);
  }, [reviewEdges, reviewNodes, graphNodes]);

  const allNodes = useMemo(
    () => [...newNodes, ...referencedExistingNodes],
    [newNodes, referencedExistingNodes]
  );

  const validNodeIds = useMemo(
    () => new Set(allNodes.map((n) => n.id)),
    [allNodes]
  );

  const edges = useMemo(
    () => reviewEdgesToReagraph(reviewEdges, validNodeIds),
    [reviewEdges, validNodeIds]
  );

  if (newNodes.length === 0) {
    return (
      <div className="h-40 flex items-center justify-center text-zinc-500 text-xs">
        No entities to preview
      </div>
    );
  }

  return (
    <div className="relative h-40 rounded border border-zinc-800 overflow-hidden">
      <div className="absolute inset-0">
        <GraphCanvas
          ref={graphRef}
          nodes={allNodes}
          edges={edges}
          layoutType="forceDirected2d"
          labelType="auto"
          sizingType="default"
          draggable
          edgeArrowPosition="end"
          clusterAttribute="cluster"
          onNodeClick={(node) => {
            // Only select review nodes, not existing ones
            if (node.data?.isReviewNode) {
              select(node.id, 'node');
            }
          }}
          onEdgeClick={(edge) => select(edge.id, 'edge')}
          theme={{
            canvas: { background: '#18181b' },
            node: {
              fill: '#059669',
              activeFill: '#34d399',
              opacity: 1,
              selectedOpacity: 1,
              inactiveOpacity: 0.2,
              label: { color: '#e4e4e7', activeColor: '#ffffff' },
            },
            ring: {
              fill: '#818cf8',
              activeFill: '#a5b4fc',
            },
            edge: {
              fill: '#059669',
              activeFill: '#34d399',
              opacity: 1,
              selectedOpacity: 1,
              inactiveOpacity: 0.1,
              label: { color: '#71717a', activeColor: '#a1a1aa' },
            },
            arrow: {
              fill: '#059669',
              activeFill: '#34d399',
            },
            lasso: {
              background: 'rgba(99, 102, 241, 0.1)',
              border: '#6366f1',
            },
            cluster: {
              stroke: '#3f3f46',
              label: { color: '#a1a1aa' },
            },
          }}
        />
      </div>
    </div>
  );
}
