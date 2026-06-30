import { useRef, useCallback, useMemo, useEffect, useState, type PointerEvent as ReactPointerEvent } from 'react';
import type { Modifiers } from '../../../graph/renderer/types';
import { bfsPathWithEdges } from '../../../graph/algorithms/graph-algorithms';
import { GraphCanvas } from './GraphCanvas';
import type { GraphCanvasHandle } from '../../../graph/renderer/types';
import { useGraphData } from '../../hooks/useGraphData';
import { useUIStore } from '../../../graph/store/ui-store';
import { useGraphStore } from '../../../graph/store/graph-store';
import { useNodeTypeStore } from '../../../graph/store/node-type-store';
import { GraphControls } from './GraphControls';
import { GraphContextMenu } from './GraphContextMenu';
import { NodeDetailPanel } from '../panels/NodeDetailPanel';
import { EdgeDetailPanel } from '../panels/EdgeDetailPanel';
import { CreatePanel } from '../panels/CreatePanel';
import { MultiSelectPanel } from '../panels/MultiSelectPanel';
import { spatial } from '../../../db/client/db-client';
import { SMALL_GRAPH_THRESHOLD } from '../../../shared/constants';

interface KnowledgeGraphProps {
  compact?: boolean;
}

export function KnowledgeGraph({ compact = false }: KnowledgeGraphProps) {
  const graphRef = useRef<GraphCanvasHandle>(null);
  const { nodes, edges } = useGraphData();
  const selectedNodeIds = useGraphStore((s) => s.selectedNodeIds);
  const selectedEdgeId = useGraphStore((s) => s.selectedEdgeId);
  const selectNode = useGraphStore((s) => s.selectNode);
  const toggleNodeSelection = useGraphStore((s) => s.toggleNodeSelection);
  const selectNodes = useGraphStore((s) => s.selectNodes);
  const addNodesToSelection = useGraphStore((s) => s.addNodesToSelection);
  const selectEdge = useGraphStore((s) => s.selectEdge);
  const setGraphOverlay = useUIStore((s) => s.setGraphOverlay);
  const graphOverlay = useUIStore((s) => s.graphOverlay);
  const types = useNodeTypeStore((s) => s.types);

  const adjacency = useGraphStore((s) => s.adjacency);
  const setFocusNodeCallback = useUIStore((s) => s.setFocusNodeCallback);

  const [windowed, setWindowed] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const [panelWidth, setPanelWidth] = useState(320);
  const panelDragging = useRef(false);
  const panelLastX = useRef(0);

  const onPanelPointerDown = useCallback((e: ReactPointerEvent) => {
    e.preventDefault();
    panelDragging.current = true;
    panelLastX.current = e.clientX;
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
  }, []);
  const onPanelPointerMove = useCallback((e: ReactPointerEvent) => {
    if (!panelDragging.current) return;
    const delta = panelLastX.current - e.clientX;
    panelLastX.current = e.clientX;
    const maxW = containerRef.current ? containerRef.current.clientWidth * 0.3 : 400;
    setPanelWidth(w => Math.min(maxW, Math.max(240, w + delta)));
  }, []);
  const onPanelPointerUp = useCallback(() => { panelDragging.current = false; }, []);

  const [contextMenu, setContextMenu] = useState<{
    screenX: number;
    screenY: number;
    nodeId: string | null;
  } | null>(null);

  // Register focus-node callback for chat node links + header search clicks.
  // Accepts a single id (pan+zoom to that node, show detail) or an array
  // (fit viewport to enclose all — used for edge endpoints).
  useEffect(() => {
    setFocusNodeCallback((nodeIds: string | string[]) => {
      const ids = Array.isArray(nodeIds) ? nodeIds : [nodeIds];
      if (ids.length === 1) {
        selectNode(ids[0]);
        setGraphOverlay('nodeDetail');
      }
      graphRef.current?.fitToView(ids);
    });
    return () => setFocusNodeCallback(null);
  }, [selectNode, setGraphOverlay, setFocusNodeCallback]);

  // Check total node count to determine windowed mode
  useEffect(() => {
    spatial.totalNodeCount().then((count) => {
      setWindowed(count > SMALL_GRAPH_THRESHOLD);
    }).catch(() => {
      // DB not ready or timed out — default to non-windowed
    });
  }, [nodes.length]); // re-check when nodes change

  const typeColorMap = useMemo(() => {
    const map = new Map<string, string>();
    for (const t of types) {
      if (t.color) map.set(t.type, t.color);
    }
    return map;
  }, [types]);

  // Escape key clears selection
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        useGraphStore.getState().clearSelection();
        setGraphOverlay('none');
      }
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [setGraphOverlay]);

  const handleNodeClick = useCallback(
    (nodeId: string, modifiers: Modifiers) => {
      if (modifiers.ctrl) {
        toggleNodeSelection(nodeId);
      } else {
        selectNode(nodeId);
      }
      setGraphOverlay('nodeDetail');
    },
    [selectNode, toggleNodeSelection, setGraphOverlay]
  );

  const handleEdgeClick = useCallback(
    (edgeId: string) => {
      selectEdge(edgeId);
      setGraphOverlay('edgeDetail');
    },
    [selectEdge, setGraphOverlay]
  );

  const handleCanvasClick = useCallback((modifiers: Modifiers) => {
    if (!modifiers.ctrl) {
      useGraphStore.getState().clearSelection();
    }
    // Panel stays open — shows empty state instead of closing
  }, []);

  const handleLassoSelect = useCallback(
    (nodeIds: Set<string>, additive: boolean) => {
      if (additive) {
        addNodesToSelection(nodeIds);
      } else {
        selectNodes(nodeIds);
      }
      if (nodeIds.size > 0) setGraphOverlay('nodeDetail');
    },
    [addNodesToSelection, selectNodes, setGraphOverlay]
  );

  const handleContextMenu = useCallback(
    (screenX: number, screenY: number, nodeId: string | null) => {
      setContextMenu({ screenX, screenY, nodeId });
    },
    []
  );

  // Auto-compute shortest path when exactly 2 nodes selected
  useEffect(() => {
    const renderer = graphRef.current?.getRenderer();
    if (!renderer) return;
    if (selectedNodeIds.size === 2) {
      const [a, b] = [...selectedNodeIds];
      const result = bfsPathWithEdges(adjacency, a, b);
      if (result) {
        renderer.setPathHighlight(new Set(result.nodeIds), new Set(result.edgeIds));
      } else {
        renderer.clearPathHighlight();
      }
    } else {
      renderer.clearPathHighlight();
    }
  }, [selectedNodeIds, adjacency]);

  // Show empty state only when the store is truly empty — not when all
  // nodes are hidden by layer filters.
  const totalNodeCount = useGraphStore((s) => s.nodes.length);
  if (!windowed && totalNodeCount === 0) {
    return (
      <div className="absolute inset-0 flex items-center justify-center text-zinc-500 text-sm">
        <div className="text-center p-4">
          <p>No nodes yet</p>
          <p className="text-xs mt-1 text-zinc-600">
            Create nodes or extract from text to get started
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="absolute inset-0" ref={containerRef}>
      <GraphCanvas
        ref={graphRef}
        nodes={nodes}
        edges={edges}
        selectedNodeIds={selectedNodeIds}
        selectedEdgeId={selectedEdgeId}
        windowed={windowed}
        typeColorMap={typeColorMap}
        onNodeClick={handleNodeClick}
        onEdgeClick={handleEdgeClick}
        onCanvasClick={handleCanvasClick}
        onLassoSelect={handleLassoSelect}
        onContextMenu={handleContextMenu}
        compact={compact}
      />
      {!compact && <GraphControls graphRef={graphRef} />}
      {contextMenu && (
        <GraphContextMenu
          screenX={contextMenu.screenX}
          screenY={contextMenu.screenY}
          nodeId={contextMenu.nodeId}
          onClose={() => setContextMenu(null)}
        />
      )}
      {(selectedNodeIds.size > 1 || graphOverlay !== 'none') && (
        <div
          className="absolute top-3 right-3 max-h-[calc(100%-24px)] bg-zinc-800 border border-zinc-700 rounded-xl shadow-2xl overflow-hidden z-20 flex"
          style={{ width: panelWidth }}
        >
          <div
            onPointerDown={onPanelPointerDown}
            onPointerMove={onPanelPointerMove}
            onPointerUp={onPanelPointerUp}
            className="w-1.5 shrink-0 cursor-col-resize hover:bg-indigo-500 active:bg-indigo-400 transition-colors"
          />
          <div className="flex-1 flex flex-col min-w-0 overflow-hidden">
            {selectedNodeIds.size > 1 ? (
              <MultiSelectPanel onClose={() => setGraphOverlay('none')} />
            ) : graphOverlay === 'nodeDetail' ? (
              <NodeDetailPanel onClose={() => setGraphOverlay('none')} />
            ) : graphOverlay === 'edgeDetail' ? (
              <EdgeDetailPanel onClose={() => setGraphOverlay('none')} />
            ) : graphOverlay === 'create' ? (
              <CreatePanel onClose={() => setGraphOverlay('none')} />
            ) : null}
          </div>
        </div>
      )}
    </div>
  );
}
