import React, { useRef, useEffect, useImperativeHandle, forwardRef, useState } from 'react';
import { GraphRenderer } from '../../../graph/renderer/graph-renderer';
import type { GraphCanvasHandle, RenderNode, RenderEdge, RenderTheme, Modifiers } from '../../../graph/renderer/types';
import { LayoutRunner } from '../../../graph/layout/layout-runner';
import { spatial } from '../../../db/client/db-client';
import { useViewportSync } from '../../hooks/useViewportSync';
import { useTierStore } from '../../../graph/store/tier-store';

interface GraphCanvasProps {
  nodes: RenderNode[];
  edges: RenderEdge[];
  selectedNodeIds: Set<string>;
  selectedEdgeId: string | null;
  windowed?: boolean;
  typeColorMap?: Map<string, string>;
  onNodeClick?: (nodeId: string, modifiers: Modifiers) => void;
  onEdgeClick?: (edgeId: string) => void;
  onCanvasClick?: (modifiers: Modifiers) => void;
  onLassoSelect?: (nodeIds: Set<string>, additive: boolean) => void;
  onContextMenu?: (screenX: number, screenY: number, nodeId: string | null) => void;
  onNodeDragEnd?: (nodeId: string, x: number, y: number) => void;
  theme?: Partial<RenderTheme>;
  compact?: boolean;
}

export const GraphCanvas = forwardRef<GraphCanvasHandle, GraphCanvasProps>(
  function GraphCanvas(props, ref) {
    const containerRef = useRef<HTMLDivElement>(null);
    const rendererRef = useRef<GraphRenderer | null>(null);
    const layoutRef = useRef<LayoutRunner | null>(null);
    const nodeIdsRef = useRef<string>('');
    const forceRunningRef = useRef(false);
    const [rendererReady, setRendererReady] = useState<GraphRenderer | null>(null);

    // Store latest props in refs for event handlers
    const propsRef = useRef(props);
    propsRef.current = props;

    // Create renderer on mount
    useEffect(() => {
      if (!containerRef.current) return;
      // Dispose any previous renderer (React StrictMode double-mount)
      if (rendererRef.current) {
        rendererRef.current.dispose();
        rendererRef.current = null;
      }
      const renderer = new GraphRenderer(containerRef.current, {
        theme: props.theme,
        antialias: true,
      });
      rendererRef.current = renderer;
      setRendererReady(renderer);

      // Event handlers
      renderer.on('nodeClick', ({ nodeId, modifiers }) => {
        propsRef.current.onNodeClick?.(nodeId, modifiers);
      });
      renderer.on('edgeClick', ({ edgeId }) => {
        propsRef.current.onEdgeClick?.(edgeId);
      });
      renderer.on('canvasClick', ({ modifiers }) => {
        propsRef.current.onCanvasClick?.(modifiers);
      });
      renderer.on('lassoSelect', ({ nodeIds, additive }) => {
        propsRef.current.onLassoSelect?.(nodeIds, additive);
      });
      renderer.on('nodeDragStart', ({ nodeId }) => {
        const node = rendererRef.current?.getNodeMap().get(nodeId);
        if (node) layoutRef.current?.pin(nodeId, node.x, node.y);
      });
      renderer.on('nodeDragEnd', ({ nodeId, x, y }) => {
        propsRef.current.onNodeDragEnd?.(nodeId, x, y);
        spatial.batchUpdatePositions([{ id: nodeId, x, y }]).catch(() => {});
        layoutRef.current?.unpin(nodeId);
      });
      renderer.on('contextMenu', ({ screenX, screenY, nodeId }) => {
        propsRef.current.onContextMenu?.(screenX, screenY, nodeId);
      });

      // Layout runner (only used for non-windowed mode)
      const layout = new LayoutRunner();
      layoutRef.current = layout;

      return () => {
        layout.dispose();
        renderer.dispose();
        rendererRef.current = null;
        layoutRef.current = null;
        setRendererReady(null);
      };
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    // Viewport sync for windowed mode
    useViewportSync(
      props.windowed ? rendererReady : null,
      props.typeColorMap ?? new Map()
    );

    // Update graph data when nodes/edges change (non-windowed mode only)
    useEffect(() => {
      if (props.windowed) return; // viewport sync manages data in windowed mode
      const renderer = rendererRef.current;
      const layout = layoutRef.current;
      if (!renderer || !layout) return;

      // Check if node IDs changed (need re-layout)
      const newNodeIds = props.nodes.map((n) => n.id).sort().join(',');
      const needsLayout = newNodeIds !== nodeIdsRef.current;

      // Preserve layout-computed positions from the renderer's current nodes
      // so that re-renders (same nodes, new array refs) don't flash to 0,0
      const currentNodeMap = renderer.getNodeMap();
      const nodesWithPositions = props.nodes.map((n) => {
        const existing = currentNodeMap.get(n.id);
        if (existing && (existing.x !== 0 || existing.y !== 0)) {
          return { ...n, x: existing.x, y: existing.y };
        }
        return n;
      });

      const tierMap = useTierStore.getState().tierIndex?.tiers;
      const nodesWithTiers = nodesWithPositions.map(n => ({
        ...n,
        tier: tierMap?.get(n.id) ?? 1,
      }));
      renderer.setGraphData(nodesWithTiers, props.edges);

      if (needsLayout && props.nodes.length > 0) {
        // Always run force layout — persisted positions serve as warm-start seeds
        layout.start(
          nodesWithPositions.map((n) => ({ id: n.id, x: n.x, y: n.y })),
          props.edges.map((e) => ({ source: e.sourceId, target: e.targetId })),
          {
            onTick: (positions, _alpha) => {
              const r = rendererRef.current;
              if (r) applyPositions(r, r.getNodes(), positions);
            },
            onDone: (positions) => {
              const r = rendererRef.current;
              if (r) {
                applyPositions(r, r.getNodes(), positions);
                r.fitToView();
                const nodes = r.getNodes();
                const updates: Array<{ id: string; x: number; y: number }> = [];
                for (let i = 0; i < nodes.length; i++) {
                  const x = positions[i * 2];
                  const y = positions[i * 2 + 1];
                  if (!isNaN(x) && !isNaN(y)) {
                    updates.push({ id: nodes[i].id, x, y });
                  }
                }
                if (updates.length > 0) {
                  spatial.batchUpdatePositions(updates).catch(() => {});
                }
              }
            },
          }
        );
      }

      nodeIdsRef.current = newNodeIds;
    }, [props.nodes, props.edges, props.windowed]);

    // Update selection
    useEffect(() => {
      rendererRef.current?.setSelection(
        props.selectedNodeIds,
        props.selectedEdgeId
      );
    }, [props.selectedNodeIds, props.selectedEdgeId]);

    // Helper to start force layout with current data
    const runForceLayout = (fitOnDone = true) => {
      const renderer = rendererRef.current;
      const layout = layoutRef.current;
      if (!renderer || !layout || renderer.getNodes().length === 0) return;
      const nodes = renderer.getNodes();
      forceRunningRef.current = true;
      layout.start(
        nodes.map((n) => ({ id: n.id, x: n.x, y: n.y })),
        propsRef.current.edges.map((e) => ({ source: e.sourceId, target: e.targetId })),
        {
          onTick: (positions, _alpha) => {
            const r = rendererRef.current;
            if (r) applyPositions(r, r.getNodes(), positions);
          },
          onDone: (positions) => {
            forceRunningRef.current = false;
            const r = rendererRef.current;
            if (r) {
              applyPositions(r, r.getNodes(), positions);
              if (fitOnDone) r.fitToView();
            }
          },
        }
      );
    };

    // Imperative handle
    useImperativeHandle(ref, () => ({
      zoomIn() {
        rendererRef.current?.zoomIn();
      },
      zoomOut() {
        rendererRef.current?.zoomOut();
      },
      fitToView(nodeIds?: string[]) {
        rendererRef.current?.fitToView(nodeIds);
      },
      getRenderer() {
        return rendererRef.current;
      },
      async captureScreenshot() {
        return rendererRef.current?.captureScreenshot() ?? null;
      },
      startForceLayout() {
        runForceLayout(false);
      },
      stopForceLayout() {
        layoutRef.current?.stop();
        forceRunningRef.current = false;
      },
      isForceRunning() {
        return forceRunningRef.current;
      },
    }));

    return <div ref={containerRef} className="absolute inset-0" />;
  }
);

function applyPositions(
  renderer: GraphRenderer,
  nodes: RenderNode[],
  positions: Float32Array
) {
  const posMap = new Map<string, { x: number; y: number }>();
  for (let i = 0; i < nodes.length; i++) {
    const x = positions[i * 2];
    const y = positions[i * 2 + 1];
    if (!isNaN(x) && !isNaN(y)) {
      posMap.set(nodes[i].id, { x, y });
    }
  }
  renderer.updatePositions(posMap);
}
