import { useState, useEffect, useCallback, useMemo } from 'react';
import { useGraphStore } from '../../../graph/store/graph-store';
import { useUIStore } from '../../../graph/store/ui-store';
import { PanelHeader } from '../shared/PanelHeader';
import { noteSearch } from '../../../db/client/db-client';
import type { GraphNode } from '../../../shared/types';

export function NotesPanel() {
  const nodes = useGraphStore((s) => s.nodes);
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResultIds, setSearchResultIds] = useState<Set<string> | null>(null);

  // Auto-open note tab when another panel sets pendingEditNoteId
  const pendingEditNoteId = useUIStore((s) => s.pendingEditNoteId);
  useEffect(() => {
    if (pendingEditNoteId) {
      const node = nodes.find(n => n.id === pendingEditNoteId);
      useUIStore.getState().openContentTab(
        { kind: 'noteEditor', noteId: pendingEditNoteId },
        node?.name ?? 'Note'
      );
      useUIStore.getState().setPendingEditNoteId(null);
    }
  }, [pendingEditNoteId, nodes]);

  const noteNodes = useMemo(
    () => nodes.filter((n) => n.type === 'note'),
    [nodes]
  );

  // Debounced FTS search for note content
  useEffect(() => {
    if (!searchQuery.trim()) {
      setSearchResultIds(null);
      return;
    }
    const timeout = setTimeout(async () => {
      try {
        const results = await noteSearch.search(searchQuery, 50);
        setSearchResultIds(new Set(results.map((r) => r.node_id)));
      } catch {
        setSearchResultIds(new Set());
      }
    }, 200);
    return () => clearTimeout(timeout);
  }, [searchQuery]);

  const filteredNotes = useMemo(() => {
    if (!searchQuery.trim()) return noteNodes;
    const q = searchQuery.toLowerCase();
    return noteNodes.filter(
      (n) => n.name.toLowerCase().includes(q) || searchResultIds?.has(n.id)
    );
  }, [noteNodes, searchQuery, searchResultIds]);

  const sortedNotes = useMemo(
    () => [...filteredNotes].sort((a, b) => (b.updatedAt ?? '').localeCompare(a.updatedAt ?? '')),
    [filteredNotes]
  );

  const handleNew = useCallback(() => {
    const id = `new-${Date.now()}`;
    useUIStore.getState().openContentTab(
      { kind: 'noteEditor', noteId: id },
      'New Note'
    );
  }, []);

  const handleEdit = useCallback((nodeId: string) => {
    const node = nodes.find(n => n.id === nodeId);
    useUIStore.getState().openContentTab(
      { kind: 'noteEditor', noteId: nodeId },
      node?.name ?? 'Note'
    );
  }, [nodes]);

  return (
    <div className="p-4 space-y-3">
      <PanelHeader title="Notes">
        <button
          onClick={handleNew}
          className="text-xs px-2.5 py-1 bg-indigo-600 text-white rounded hover:bg-indigo-500 transition-colors"
        >
          + New Note
        </button>
      </PanelHeader>

      {/* Search */}
      <div className="relative">
        <svg
          className="absolute left-2 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-zinc-500 pointer-events-none"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
        >
          <circle cx="11" cy="11" r="8" />
          <path d="m21 21-4.35-4.35" />
        </svg>
        <input
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          placeholder="Search notes..."
          className="w-full bg-zinc-900 border border-zinc-700 rounded pl-7 pr-2 py-1.5 text-xs text-zinc-200 outline-none focus:border-indigo-500 placeholder-zinc-600"
        />
      </div>

      {/* Note list */}
      {sortedNotes.length === 0 ? (
        <div className="text-center py-8">
          {searchQuery ? (
            <p className="text-sm text-zinc-500">No notes matching &ldquo;{searchQuery}&rdquo;</p>
          ) : (
            <>
              <p className="text-sm text-zinc-500">No notes yet</p>
              <p className="text-xs text-zinc-600 mt-1">
                Create a note to capture thoughts and connect them to your knowledge graph.
              </p>
            </>
          )}
        </div>
      ) : (
        <div className="space-y-0.5">
          {sortedNotes.map((note) => (
            <NoteListItem key={note.id} node={note} onEdit={handleEdit} />
          ))}
        </div>
      )}
    </div>
  );
}

function NoteListItem({ node, onEdit }: { node: GraphNode; onEdit: (id: string) => void }) {
  const [preview, setPreview] = useState('');
  useEffect(() => {
    noteSearch.getEntry(node.id).then((entry) => {
      if (entry) setPreview(entry.body.slice(0, 60));
    }).catch(() => {});
  }, [node.id]);

  return (
    <button
      onClick={() => onEdit(node.id)}
      className="w-full text-left px-2 py-1.5 rounded hover:bg-zinc-800 min-w-0"
    >
      <span className="text-xs text-zinc-200 font-medium truncate block">{node.name}</span>
      {preview && <span className="text-[10px] text-zinc-500 truncate block">{preview}</span>}
    </button>
  );
}
