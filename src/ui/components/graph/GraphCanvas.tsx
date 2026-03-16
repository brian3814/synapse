import React, { useRef, useEffect, useImperativeHandle, forwardRef, useState } from 'react';
import { GraphRenderer } from '../../../graph/renderer/graph-renderer';
import type { GraphCanvasHandle, RenderNode, RenderEdge, RenderTheme, Modifiers, ViewMode } from '../../../graph/renderer/types';
import { LayoutRunner } from '../../../graph/layout/layout-runner';
import { spatial } from '../../../db/client/db-client';
import { useViewportSync } from '../../hooks/useViewportSync';

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
  onNodeDragEnd?: (nodeId: string, x: number, y: number) => void;
  theme?: Partial<RenderTheme>;
  compact?: boolean;
  is3D?: boolean;
}

export const GraphCanvas = forwardRef<GraphCanvasHandle, GraphCanvasProps>(
  function GraphCanvas(props, ref) {
    const containerRef = useRef<HTMLDivElement>(null);
    const rendererRef = useRef<GraphRenderer | null>(null);
    const layoutRef = useRef<LayoutRunner | null>(null);
    const nodeIdsRef = useRef<string>('');
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
      renderer.on('nodeDragEnd', ({ nodeId, x, y }) => {
        propsRef.current.onNodeDragEnd?.(nodeId, x, y);
        // Persist dragged position to DB (fire-and-forget)
        spatial.batchUpdatePositions([{ id: nodeId, x, y }]).catch(() => {});
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

      renderer.setGraphData(nodesWithPositions, props.edges);

      if (needsLayout && props.nodes.length > 0) {
        // Check if nodes already have DB-persisted positions
        const hasPersistedPositions = nodesWithPositions.some(
          (n) => n.x !== 0 || n.y !== 0
        );
        if (hasPersistedPositions) {
          // Skip layout, just fit to view
          renderer.fitToView();
        } else {
          // Run force layout
          const dim = propsRef.current.is3D ? 3 : 2;
          layout.start(
            nodesWithPositions.map((n) => ({ id: n.id, x: n.x, y: n.y, z: n.z })),
            props.edges.map((e) => ({ source: e.sourceId, target: e.targetId })),
            {
              onTick: (positions, _alpha, dimensions) => {
                const r = rendererRef.current;
                if (r) applyPositions(r, r.getNodes(), positions, dimensions);
              },
              onDone: (positions, dimensions) => {
                const r = rendererRef.current;
                if (r) {
                  applyPositions(r, r.getNodes(), positions, dimensions);
                  r.fitToView();
                  // Persist layout positions to DB (fire-and-forget)
                  const nodes = r.getNodes();
                  const stride = dimensions;
                  const updates: Array<{ id: string; x: number; y: number }> = [];
                  for (let i = 0; i < nodes.length; i++) {
                    const x = positions[i * stride];
                    const y = positions[i * stride + 1];
                    if (!isNaN(x) && !isNaN(y)) {
                      updates.push({ id: nodes[i].id, x, y });
                    }
                  }
                  if (updates.length > 0) {
                    spatial.batchUpdatePositions(updates).catch(() => {});
                  }
                }
              },
            },
            { dimensions: dim as 2 | 3 }
          );
        }
      }

      nodeIdsRef.current = newNodeIds;
    }, [props.nodes, props.edges, props.windowed]);

    // Update view mode (2D/3D) and re-run layout
    useEffect(() => {
      const renderer = rendererRef.current;
      const layout = layoutRef.current;
      if (!renderer) return;
      const mode = props.is3D ? '3d' : '2d';
      renderer.setViewMode(mode);

      // Re-run layout with correct dimensions when toggling modes
      if (layout && renderer.getNodes().length > 0) {
        const nodes = renderer.getNodes();
        const dim = props.is3D ? 3 : 2;
        layout.start(
          nodes.map((n) => ({ id: n.id, x: n.x, y: n.y, z: n.z })),
          propsRef.current.edges.map((e) => ({ source: e.sourceId, target: e.targetId })),
          {
            onTick: (positions, _alpha, dimensions) => {
              const r = rendererRef.current;
              if (r) applyPositions(r, r.getNodes(), positions, dimensions);
            },
            onDone: (positions, dimensions) => {
              const r = rendererRef.current;
              if (r) {
                applyPositions(r, r.getNodes(), positions, dimensions);
                r.fitToView();
              }
            },
          },
          { dimensions: dim as 2 | 3 }
        );
      }
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [props.is3D]);

    // Update selection
    useEffect(() => {
      rendererRef.current?.setSelection(
        props.selectedNodeIds,
        props.selectedEdgeId
      );
    }, [props.selectedNodeIds, props.selectedEdgeId]);

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
    }));

    return <div ref={containerRef} className="absolute inset-0" />;
  }
);

function applyPositions(
  renderer: GraphRenderer,
  nodes: RenderNode[],
  positions: Float32Array,
  dimensions: number = 2
) {
  const stride = dimensions;
  const posMap = new Map<string, { x: number; y: number; z?: number }>();
  for (let i = 0; i < nodes.length; i++) {
    const x = positions[i * stride];
    const y = positions[i * stride + 1];
    const z = stride === 3 ? positions[i * stride + 2] : undefined;
    if (!isNaN(x) && !isNaN(y)) {
      posMap.set(nodes[i].id, { x, y, z });
    }
  }
  renderer.updatePositions(posMap);
}
