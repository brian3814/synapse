import React, { useState, useEffect, useCallback } from 'react';
import { useGraphStore } from '../../../graph/store/graph-store';
import { NoteEditor } from './NoteEditor';
import type { GraphNode } from '../../../shared/types';

type View = 'list' | 'editor';

export function NotesPanel() {
  const nodes = useGraphStore((s) => s.nodes);
  const [view, setView] = useState<View>('list');
  const [editingNodeId, setEditingNodeId] = useState<string | null>(null);

  const noteNodes = nodes.filter((n) => n.type === 'note');

  const handleNew = useCallback(() => {
    setEditingNodeId(null);
    setView('editor');
  }, []);

  const handleEdit = useCallback((nodeId: string) => {
    setEditingNodeId(nodeId);
    setView('editor');
  }, []);

  const handleBack = useCallback(() => {
    setEditingNodeId(null);
    setView('list');
  }, []);

  if (view === 'editor') {
    return <NoteEditor nodeId={editingNodeId} onBack={handleBack} />;
  }

  return (
    <div className="p-4 space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold text-zinc-100">Notes</h3>
        <button
          onClick={handleNew}
          className="text-xs px-2.5 py-1 bg-indigo-600 text-white rounded hover:bg-indigo-500 transition-colors"
        >
          + New Note
        </button>
      </div>

      {noteNodes.length === 0 ? (
        <div className="text-center py-8">
          <p className="text-sm text-zinc-500">No notes yet</p>
          <p className="text-xs text-zinc-600 mt-1">
            Create a note to capture thoughts and connect them to your knowledge graph.
          </p>
        </div>
      ) : (
        <div className="space-y-1">
          {noteNodes.map((node) => (
            <NoteListItem key={node.id} node={node} onEdit={handleEdit} />
          ))}
        </div>
      )}
    </div>
  );
}

function NoteListItem({ node, onEdit }: { node: GraphNode; onEdit: (id: string) => void }) {
  const preview = typeof node.properties?.content === 'string'
    ? node.properties.content.slice(0, 100)
    : '';

  return (
    <button
      onClick={() => onEdit(node.id)}
      className="w-full text-left px-3 py-2.5 rounded bg-zinc-800/50 hover:bg-zinc-700/50 border border-zinc-700/50 transition-colors group"
    >
      <p className="text-sm text-zinc-200 font-medium truncate group-hover:text-zinc-100">
        {node.name}
      </p>
      {preview && (
        <p className="text-xs text-zinc-500 mt-0.5 truncate">{preview}</p>
      )}
      <p className="text-[10px] text-zinc-600 mt-1">
        {new Date(node.updatedAt).toLocaleDateString()}
      </p>
    </button>
  );
}
