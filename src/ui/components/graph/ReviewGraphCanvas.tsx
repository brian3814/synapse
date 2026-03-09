import React, { useRef, useMemo } from 'react';
import { useExtractionReviewStore } from '../../../graph/store/extraction-review-store';
import { useGraphStore } from '../../../graph/store/graph-store';
import { useNodeTypeStore } from '../../../graph/store/node-type-store';
import { reviewNodesToRender, existingNodesToRender, reviewEdgesToRender } from '../../../graph/transforms/review-to-render';
import { GraphCanvas } from './GraphCanvas';
import type { GraphCanvasHandle } from '../../../graph/renderer/types';

export function ReviewGraphCanvas() {
  const graphRef = useRef<GraphCanvasHandle>(null);
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

  const newNodes = useMemo(
    () => reviewNodesToRender(reviewNodes, typeColorMap),
    [reviewNodes, typeColorMap]
  );

  const referencedExistingNodes = useMemo(() => {
    const reviewTempIds = new Set(reviewNodes.map((n) => n.tempId));
    const referencedIds = new Set<string>();
    for (const edge of reviewEdges) {
      if (edge.removed) continue;
      if (!reviewTempIds.has(edge.sourceTempId)) referencedIds.add(edge.sourceTempId);
      if (!reviewTempIds.has(edge.targetTempId)) referencedIds.add(edge.targetTempId);
    }
    const existing = graphNodes.filter((n) => referencedIds.has(n.id));
    return existingNodesToRender(existing);
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
    () => reviewEdgesToRender(reviewEdges, validNodeIds),
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
      <GraphCanvas
        ref={graphRef}
        nodes={allNodes}
        edges={edges}
        selectedNodeId={null}
        selectedEdgeId={null}
        onNodeClick={(nodeId) => {
          // Only select review nodes, not existing ones
          const node = allNodes.find((n) => n.id === nodeId);
          if (node?.data?.isReviewNode) {
            select(nodeId, 'node');
          }
        }}
        onEdgeClick={(edgeId) => select(edgeId, 'edge')}
        theme={{
          canvasBackground: '#18181b',
          nodeColor: '#059669',
          nodeActiveColor: '#34d399',
          edgeColor: '#059669',
          edgeActiveColor: '#34d399',
        }}
        compact
      />
    </div>
  );
}
