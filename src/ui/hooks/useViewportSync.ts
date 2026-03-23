import { useEffect, useRef, useCallback } from 'react';
import { useViewportStore } from '../../graph/store/viewport-store';
import { spatial } from '../../db/client/db-client';
import { clusterSummaryToRenderNodes, interClusterEdgesToRenderEdges } from '../../graph/transforms/cluster-to-render';
import type { FrustumBounds, ZoomLevel, RenderNode, RenderEdge } from '../../graph/renderer/types';
import type { GraphRenderer } from '../../graph/renderer/graph-renderer';
import type { DbNodeSlim, DbEdgeSlim } from '../../shared/types';
import {
  VIEWPORT_QUERY_DEBOUNCE_MS,
  VIEWPORT_PADDING,
  MAX_VIEWPORT_NODES,
} from '../../shared/constants';

function slimToRenderNode(row: DbNodeSlim, typeColorMap: Map<string, string>): RenderNode {
  return {
    id: row.id,
    name: row.name,
    x: row.x ?? 0,
    y: row.y ?? 0,
    z: 0,
    color: row.color ?? typeColorMap.get(row.type) ?? '#6B7280',
    size: row.size,
    data: { type: row.type, identifier: row.identifier },
  };
}

function slimToRenderEdge(row: DbEdgeSlim): RenderEdge {
  return {
    id: row.id,
    sourceId: row.source_id,
    targetId: row.target_id,
    label: row.label,
    directed: row.directed === 1,
    data: { type: row.type, weight: row.weight },
  };
}

export function useViewportSync(
  renderer: GraphRenderer | null,
  typeColorMap: Map<string, string>
) {
  const seqRef = useRef(0);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const clusterCacheRef = useRef<{ nodes: RenderNode[]; edges: RenderEdge[] } | null>(null);
  const lastZoomLevelRef = useRef<ZoomLevel>('medium');

  const store = useViewportStore;

  const queryViewport = useCallback(
    async (bounds: FrustumBounds, zoom: number, zoomLevel: ZoomLevel) => {
      if (!renderer) return;

      const seq = ++seqRef.current;
      store.getState()._setQueryInFlight(true);

      try {
        if (zoomLevel === 'far') {
          // Use cached cluster data if available
          if (clusterCacheRef.current) {
            if (seq !== seqRef.current) return;
            store.getState()._setClusterData(
              clusterCacheRef.current.nodes,
              clusterCacheRef.current.edges
            );
            renderer.setGraphData(
              clusterCacheRef.current.nodes,
              clusterCacheRef.current.edges
            );
            return;
          }

          const [clusters, interEdges] = await Promise.all([
            spatial.clusterSummary(),
            spatial.interClusterEdges(),
          ]);
          if (seq !== seqRef.current) return;

          const clusterNodes = clusterSummaryToRenderNodes(clusters, typeColorMap);
          const clusterEdges = interClusterEdgesToRenderEdges(interEdges);

          clusterCacheRef.current = { nodes: clusterNodes, edges: clusterEdges };
          store.getState()._setClusterData(clusterNodes, clusterEdges);
          renderer.setGraphData(clusterNodes, clusterEdges);
        } else {
          // medium or close: query individual nodes in viewport
          const padX = (bounds.maxX - bounds.minX) * VIEWPORT_PADDING;
          const padY = (bounds.maxY - bounds.minY) * VIEWPORT_PADDING;
          const paddedBounds = {
            minX: bounds.minX - padX,
            minY: bounds.minY - padY,
            maxX: bounds.maxX + padX,
            maxY: bounds.maxY + padY,
          };

          const nodeRows = await spatial.nodesInBounds(
            paddedBounds.minX,
            paddedBounds.minY,
            paddedBounds.maxX,
            paddedBounds.maxY,
            MAX_VIEWPORT_NODES
          );
          if (seq !== seqRef.current) return;

          const nodeIds = nodeRows.map((n: DbNodeSlim) => n.id);
          const edgeRows = nodeIds.length > 0
            ? await spatial.edgesForNodes(nodeIds)
            : [];
          if (seq !== seqRef.current) return;

          const nodes = nodeRows.map((r: DbNodeSlim) => slimToRenderNode(r, typeColorMap));
          const edges = edgeRows.map((r: DbEdgeSlim) => slimToRenderEdge(r));

          // Compute diff vs current visible set
          const currentNodeIds = new Set(renderer.getNodes().map((n) => n.id));
          const newNodeIds = new Set(nodeIds);

          const toAdd = nodes.filter((n: RenderNode) => !currentNodeIds.has(n.id));
          const toRemove = [...currentNodeIds].filter((id) => !newNodeIds.has(id));

          // Compute edge diff
          const currentEdgeSet = new Set(
            (store.getState().visibleEdges).map((e) => e.id)
          );
          const newEdgeSet = new Set(edges.map((e: RenderEdge) => e.id));
          const edgesToAdd = edges.filter((e: RenderEdge) => !currentEdgeSet.has(e.id));
          const edgesToRemove = [...currentEdgeSet].filter((id) => !newEdgeSet.has(id));

          // Use incremental updates if the diff is small relative to total
          const isSmallDiff = (toAdd.length + toRemove.length) < nodes.length * 0.5;
          if (isSmallDiff && currentNodeIds.size > 0) {
            if (toRemove.length > 0) renderer.removeEdges(edgesToRemove);
            if (toRemove.length > 0) renderer.removeNodes(toRemove);
            if (toAdd.length > 0) renderer.addNodes(toAdd);
            if (edgesToAdd.length > 0) renderer.addEdges(edgesToAdd);
          } else {
            renderer.setGraphData(nodes, edges);
          }

          renderer.setZoomLevel(zoomLevel);
          store.getState()._setVisibleData(nodes, edges);
        }
      } finally {
        if (seq === seqRef.current) {
          store.getState()._setQueryInFlight(false);
        }
      }
    },
    [renderer, typeColorMap]
  );

  // Handle frustum changes from camera controller
  const handleFrustumChange = useCallback(
    (bounds: FrustumBounds, zoom: number) => {
      store.getState().setFrustumBounds(bounds, zoom);
      // Re-read after mutation to get the updated zoomLevel
      const zoomLevel = store.getState().zoomLevel;

      // Detect zoom level transition that invalidates cluster cache
      if (lastZoomLevelRef.current === 'far' && zoomLevel !== 'far') {
        clusterCacheRef.current = null;
      }
      lastZoomLevelRef.current = zoomLevel;

      // Debounce viewport queries
      if (timerRef.current) clearTimeout(timerRef.current);
      timerRef.current = setTimeout(() => {
        queryViewport(bounds, zoom, zoomLevel);
      }, VIEWPORT_QUERY_DEBOUNCE_MS);
    },
    [queryViewport]
  );

  // Wire up to renderer's camera controller
  useEffect(() => {
    if (!renderer) return;
    const cc = renderer.getCameraController();
    if (!cc) return;

    cc.onFrustumChange = handleFrustumChange;

    // Fire initial viewport query
    const bounds = cc.getFrustumBounds();
    const zoom = cc.getZoom();
    handleFrustumChange(bounds, zoom);

    return () => {
      cc.onFrustumChange = undefined;
    };
  }, [renderer, handleFrustumChange]);

  // Cleanup timers
  useEffect(() => {
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, []);

  return {
    windowed: useViewportStore((s) => s.windowed),
    zoomLevel: useViewportStore((s) => s.zoomLevel),
  };
}
