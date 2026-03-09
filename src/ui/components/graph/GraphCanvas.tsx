import React, { useRef, useEffect, useImperativeHandle, forwardRef } from 'react';
import { GraphRenderer } from '../../../graph/renderer/graph-renderer';
import type { GraphCanvasHandle, RenderNode, RenderEdge, RenderTheme } from '../../../graph/renderer/types';
import { LayoutRunner } from '../../../graph/layout/layout-runner';

interface GraphCanvasProps {
  nodes: RenderNode[];
  edges: RenderEdge[];
  selectedNodeId: string | null;
  selectedEdgeId: string | null;
  onNodeClick?: (nodeId: string) => void;
  onEdgeClick?: (edgeId: string) => void;
  onCanvasClick?: () => void;
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

      // Event handlers
      renderer.on('nodeClick', ({ nodeId }) => {
        propsRef.current.onNodeClick?.(nodeId);
      });
      renderer.on('edgeClick', ({ edgeId }) => {
        propsRef.current.onEdgeClick?.(edgeId);
      });
      renderer.on('canvasClick', () => {
        propsRef.current.onCanvasClick?.();
      });
      renderer.on('nodeDragEnd', ({ nodeId, x, y }) => {
        propsRef.current.onNodeDragEnd?.(nodeId, x, y);
      });

      // Layout runner
      const layout = new LayoutRunner();
      layoutRef.current = layout;

      return () => {
        layout.dispose();
        renderer.dispose();
        rendererRef.current = null;
        layoutRef.current = null;
      };
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    // Update graph data when nodes/edges change
    useEffect(() => {
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

      renderer.setGraphData(nodesWithPositions, props.edges);

      if (needsLayout && props.nodes.length > 0) {
        // Run force layout — use renderer's nodes (which have positions) for callbacks
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
              }
            },
          }
        );
      }

      nodeIdsRef.current = newNodeIds;
    }, [props.nodes, props.edges]);

    // Update selection
    useEffect(() => {
      rendererRef.current?.setSelection(
        props.selectedNodeId,
        props.selectedEdgeId
      );
    }, [props.selectedNodeId, props.selectedEdgeId]);

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
