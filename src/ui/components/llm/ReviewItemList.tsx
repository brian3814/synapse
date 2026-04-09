import React, { useState, useMemo } from 'react';
import { useExtractionReviewStore } from '../../../graph/store/extraction-review-store';
import { useGraphStore } from '../../../graph/store/graph-store';
import { ReviewNodeItem } from './ReviewNodeItem';
import { ReviewEdgeItem } from './ReviewEdgeItem';
import { ReviewNoteItem } from './ReviewNoteItem';
import { AddEdgeForm } from './AddEdgeForm';

export function ReviewItemList() {
  const nodes = useExtractionReviewStore((s) => s.nodes);
  const edges = useExtractionReviewStore((s) => s.edges);
  const notes = useExtractionReviewStore((s) => s.notes);
  const graphNodes = useGraphStore((s) => s.nodes);
  const [showAddEdge, setShowAddEdge] = useState(false);

  const activeNodes = nodes.filter((n) => !n.removed);
  const activeNotes = notes.filter((n) => !n.removed);

  // Build a combined label map: review nodes + existing graph nodes
  const labelMap = useMemo(() => {
    const map = new Map<string, string>();
    for (const n of nodes) map.set(n.tempId, n.name);
    for (const n of graphNodes) map.set(n.id, n.name);
    return map;
  }, [nodes, graphNodes]);

  // Active edges: allow endpoints that are either active review nodes OR existing graph nodes
  const activeEdges = useMemo(() => {
    const activeReviewIds = new Set(activeNodes.map((n) => n.tempId));
    const allReviewIds = new Set(nodes.map((n) => n.tempId));
    return edges.filter((e) => {
      if (e.removed) return false;
      const sourceOk = activeReviewIds.has(e.sourceTempId) || !allReviewIds.has(e.sourceTempId);
      const targetOk = activeReviewIds.has(e.targetTempId) || !allReviewIds.has(e.targetTempId);
      return sourceOk && targetOk;
    });
  }, [edges, activeNodes, nodes]);

  return (
    <div className="space-y-3">
      {/* Nodes section */}
      <div>
        <h4 className="text-xs font-medium text-zinc-400 mb-2">
          Entities ({activeNodes.length})
        </h4>
        {activeNodes.length === 0 ? (
          <p className="text-xs text-zinc-500 italic">No entities remaining</p>
        ) : (
          <div className="space-y-1">
            {activeNodes.map((node) => (
              <ReviewNodeItem key={node.tempId} node={node} />
            ))}
          </div>
        )}
      </div>

      {/* Edges section */}
      <div>
        <h4 className="text-xs font-medium text-zinc-400 mb-2">
          Relationships ({activeEdges.length})
        </h4>
        {activeEdges.length === 0 ? (
          <p className="text-xs text-zinc-500 italic">No relationships</p>
        ) : (
          <div className="space-y-1">
            {activeEdges.map((edge) => (
              <ReviewEdgeItem
                key={edge.tempId}
                edge={edge}
                sourceName={labelMap.get(edge.sourceTempId) ?? '?'}
                targetName={labelMap.get(edge.targetTempId) ?? '?'}
              />
            ))}
          </div>
        )}
      </div>

      {/* Notes section (three-layer model: Phase 4) — only present when the
          notes toggle was on during extraction */}
      {activeNotes.length > 0 && (
        <div>
          <h4 className="text-xs font-medium text-zinc-400 mb-2">
            Notes ({activeNotes.length})
          </h4>
          <div className="space-y-1">
            {activeNotes.map((note) => (
              <ReviewNoteItem key={note.tempId} note={note} />
            ))}
          </div>
        </div>
      )}

      {/* Add edge — always available as long as there's at least 1 review node (can connect to existing) */}
      {showAddEdge ? (
        <AddEdgeForm
          activeNodes={activeNodes}
          onClose={() => setShowAddEdge(false)}
        />
      ) : (
        activeNodes.length >= 1 && (
          <button
            onClick={() => setShowAddEdge(true)}
            className="w-full text-xs py-1.5 rounded border border-dashed border-zinc-700 text-zinc-400 hover:text-zinc-200 hover:border-zinc-500 transition-colors"
          >
            + Add Relationship
          </button>
        )
      )}
    </div>
  );
}
