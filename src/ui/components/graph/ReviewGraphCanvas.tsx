import { useRef, useMemo } from 'react';
import { useExtractionReviewStore } from '../../../graph/store/extraction-review-store';
import { useGraphStore } from '../../../graph/store/graph-store';
import { useNodeTypeStore } from '../../../graph/store/node-type-store';
import { reviewNodesToRender, existingNodesToRender, reviewEdgesToRender } from '../../../graph/transforms/review-to-render';
import { GraphCanvas } from './GraphCanvas';
import type { GraphCanvasHandle, RenderNode, RenderEdge } from '../../../graph/renderer/types';

const EMPTY_SET = new Set<string>();
const CONTEXT_EDGE_COLOR = '#52525b';

interface ReviewGraphCanvasProps {
  fullSize?: boolean;
}

export function ReviewGraphCanvas({ fullSize }: ReviewGraphCanvasProps) {
  const graphRef = useRef<GraphCanvasHandle>(null);
  const reviewNodes = useExtractionReviewStore((s) => s.nodes);
  const reviewEdges = useExtractionReviewStore((s) => s.edges);
  const select = useExtractionReviewStore((s) => s.select);
  const types = useNodeTypeStore((s) => s.types);
  const graphNodes = useGraphStore((s) => s.nodes);
  const graphEdges = useGraphStore((s) => s.edges);

  const typeColorMap = useMemo(() => {
    const map = new Map<string, string>();
    for (const t of types) {
      if (t.color) map.set(t.type, t.color);
    }
    return map;
  }, [types]);

  // Extracted nodes — the primary content of this canvas
  const extractedNodes = useMemo(
    () => reviewNodesToRender(reviewNodes, typeColorMap),
    [reviewNodes, typeColorMap]
  );

  // 1-hop merge context: only shown when a node has an accepted or pending merge.
  // Adds the merge target + its 1-hop neighbors as dimmed context nodes.
  const mergeContext = useMemo(() => {
    const mergeTargetIds = new Set<string>();
    for (const rNode of reviewNodes) {
      if (rNode.removed) continue;
      const merge = rNode.mergeRecommendation;
      if (!merge || merge.status === 'dismissed') continue;
      mergeTargetIds.add(merge.existingNodeId);
    }

    if (mergeTargetIds.size === 0) return { nodes: [] as RenderNode[], edges: [] as RenderEdge[] };

    const neighborIds = new Set<string>(mergeTargetIds);
    const contextEdges: RenderEdge[] = [];

    for (const edge of graphEdges) {
      const sourceIsTarget = mergeTargetIds.has(edge.sourceId);
      const targetIsTarget = mergeTargetIds.has(edge.targetId);
      if (!sourceIsTarget && !targetIsTarget) continue;

      neighborIds.add(edge.sourceId);
      neighborIds.add(edge.targetId);
      contextEdges.push({
        id: `ctx-${edge.id}`,
        sourceId: edge.sourceId,
        targetId: edge.targetId,
        label: edge.label,
        color: CONTEXT_EDGE_COLOR,
        directed: true,
      });
    }

    const extractedIds = new Set(extractedNodes.map((n) => n.id));
    const contextNodes = graphNodes
      .filter((n) => neighborIds.has(n.id) && !extractedIds.has(n.id))
      .map((n) => existingNodesToRender([n])[0]);

    return { nodes: contextNodes, edges: contextEdges };
  }, [reviewNodes, graphEdges, graphNodes, extractedNodes]);

  const allNodes = useMemo(
    () => [...extractedNodes, ...mergeContext.nodes],
    [extractedNodes, mergeContext.nodes]
  );

  const validNodeIds = useMemo(
    () => new Set(allNodes.map((n) => n.id)),
    [allNodes]
  );

  const allEdges = useMemo(() => {
    const reviewRenderEdges = reviewEdgesToRender(reviewEdges, validNodeIds);
    const contextEdgesFiltered = mergeContext.edges.filter(
      (e) => validNodeIds.has(e.sourceId) && validNodeIds.has(e.targetId)
    );
    return [...reviewRenderEdges, ...contextEdgesFiltered];
  }, [reviewEdges, validNodeIds, mergeContext.edges]);

  if (extractedNodes.length === 0) {
    return (
      <div className={`${fullSize ? 'w-full h-full' : 'h-40'} flex items-center justify-center text-zinc-500 text-xs`}>
        No entities to preview
      </div>
    );
  }

  return (
    <div className={fullSize ? 'w-full h-full relative' : 'relative h-40 rounded border border-zinc-800 overflow-hidden'}>
      <GraphCanvas
        ref={graphRef}
        nodes={allNodes}
        edges={allEdges}
        selectedNodeIds={EMPTY_SET}
        selectedEdgeId={null}
        onNodeClick={(nodeId) => {
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
      />
    </div>
  );
}
