import React, { useRef, useCallback } from 'react';
import { GraphCanvas } from './GraphCanvas';
import type { GraphCanvasHandle } from '../../../graph/renderer/types';
import { useGraphData } from '../../hooks/useGraphData';
import { useUIStore } from '../../../graph/store/ui-store';
import { useGraphStore } from '../../../graph/store/graph-store';
import { GraphControls } from './GraphControls';

interface KnowledgeGraphProps {
  compact?: boolean;
}

export function KnowledgeGraph({ compact = false }: KnowledgeGraphProps) {
  const graphRef = useRef<GraphCanvasHandle>(null);
  const { nodes, edges } = useGraphData();
  const selectedNodeId = useGraphStore((s) => s.selectedNodeId);
  const selectedEdgeId = useGraphStore((s) => s.selectedEdgeId);
  const selectNode = useGraphStore((s) => s.selectNode);
  const selectEdge = useGraphStore((s) => s.selectEdge);
  const setActivePanel = useUIStore((s) => s.setActivePanel);

  const handleNodeClick = useCallback(
    (nodeId: string) => {
      selectNode(nodeId);
      setActivePanel('nodeDetail');
    },
    [selectNode, setActivePanel]
  );

  const handleEdgeClick = useCallback(
    (edgeId: string) => {
      selectEdge(edgeId);
      setActivePanel('edgeDetail');
    },
    [selectEdge, setActivePanel]
  );

  const handleCanvasClick = useCallback(() => {
    useGraphStore.getState().clearSelection();
  }, []);

  if (nodes.length === 0) {
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
        selectedNodeId={selectedNodeId}
        selectedEdgeId={selectedEdgeId}
        onNodeClick={handleNodeClick}
        onEdgeClick={handleEdgeClick}
        onCanvasClick={handleCanvasClick}
        compact={compact}
      />
      {!compact && <GraphControls graphRef={graphRef} />}
    </div>
  );
}
