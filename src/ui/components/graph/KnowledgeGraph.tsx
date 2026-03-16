import React, { useRef, useCallback, useMemo, useEffect, useState } from 'react';
import type { Modifiers } from '../../../graph/renderer/types';
import { bfsPathWithEdges } from '../../../graph/algorithms/graph-algorithms';
import { GraphCanvas } from './GraphCanvas';
import type { GraphCanvasHandle } from '../../../graph/renderer/types';
import { useGraphData } from '../../hooks/useGraphData';
import { useUIStore } from '../../../graph/store/ui-store';
import { useGraphStore } from '../../../graph/store/graph-store';
import { useNodeTypeStore } from '../../../graph/store/node-type-store';
import { GraphControls } from './GraphControls';
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
  const setActivePanel = useUIStore((s) => s.setActivePanel);
  const types = useNodeTypeStore((s) => s.types);

  const adjacency = useGraphStore((s) => s.adjacency);
  const setFocusNodeCallback = useUIStore((s) => s.setFocusNodeCallback);

  const [windowed, setWindowed] = useState(false);

  // Register focus-node callback for chat node links
  useEffect(() => {
    setFocusNodeCallback((nodeId: string) => {
      selectNode(nodeId);
      setActivePanel('nodeDetail');
      graphRef.current?.fitToView([nodeId]);
    });
    return () => setFocusNodeCallback(null);
  }, [selectNode, setActivePanel, setFocusNodeCallback]);

  // Check total node count to determine windowed mode
  useEffect(() => {
    spatial.totalNodeCount().then((count) => {
      setWindowed(count > SMALL_GRAPH_THRESHOLD);
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
        setActivePanel('none');
      }
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [setActivePanel]);

  const handleNodeClick = useCallback(
    (nodeId: string, modifiers: Modifiers) => {
      if (modifiers.ctrl) {
        toggleNodeSelection(nodeId);
      } else {
        selectNode(nodeId);
      }
      setActivePanel('nodeDetail');
    },
    [selectNode, toggleNodeSelection, setActivePanel]
  );

  const handleEdgeClick = useCallback(
    (edgeId: string) => {
      selectEdge(edgeId);
      setActivePanel('edgeDetail');
    },
    [selectEdge, setActivePanel]
  );

  const handleCanvasClick = useCallback((modifiers: Modifiers) => {
    if (!modifiers.ctrl) {
      useGraphStore.getState().clearSelection();
    }
  }, []);

  const handleLassoSelect = useCallback(
    (nodeIds: Set<string>, additive: boolean) => {
      if (additive) {
        addNodesToSelection(nodeIds);
      } else {
        selectNodes(nodeIds);
      }
      if (nodeIds.size > 0) setActivePanel('nodeDetail');
    },
    [addNodesToSelection, selectNodes, setActivePanel]
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

  if (!windowed && nodes.length === 0) {
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
    <div className="absolute inset-0">
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
        compact={compact}
      />
      {!compact && <GraphControls graphRef={graphRef} />}
    </div>
  );
}
