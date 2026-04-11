import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { useGraphStore } from '../../../graph/store/graph-store';
import { useUIStore } from '../../../graph/store/ui-store';
import { NoteEditor } from './NoteEditor';
import { noteFolders } from '../../../db/client/db-client';
import type { GraphNode } from '../../../shared/types';

type View = 'list' | 'editor';

/**
 * Folder tree node built from the flat folder_path values on note nodes
 * plus the explicit note_folders marker rows (for empty user-created folders).
 */
interface FolderNode {
  path: string;           // full path ('' for root, 'projects/ml' for nested)
  name: string;           // segment name ('ml' for 'projects/ml'; '' for root)
  children: FolderNode[]; // sub-folders
  notes: GraphNode[];     // notes that live directly in this folder
}

export function NotesPanel() {
  const nodes = useGraphStore((s) => s.nodes);
  const [view, setView] = useState<View>('list');
  const [editingNodeId, setEditingNodeId] = useState<string | null>(null);
  const [emptyFolders, setEmptyFolders] = useState<string[]>([]);
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set(['']));
  const [pendingFolder, setPendingFolder] = useState<string | null>(null);
  const [newFolderName, setNewFolderName] = useState('');

  // Auto-open editor when another panel sets pendingEditNoteId
  const pendingEditNoteId = useUIStore((s) => s.pendingEditNoteId);
  useEffect(() => {
    if (pendingEditNoteId) {
      setEditingNodeId(pendingEditNoteId);
      setView('editor');
      useUIStore.getState().setPendingEditNoteId(null);
    }
  }, [pendingEditNoteId]);

  const noteNodes = useMemo(
    () => nodes.filter((n) => n.type === 'note'),
    [nodes]
  );

  // Load empty-folder markers from the DB
  const refreshFolders = useCallback(async () => {
    try {
      const folders = await noteFolders.getAll();
      setEmptyFolders(folders.map((f) => f.path));
    } catch {
      setEmptyFolders([]);
    }
  }, []);

  useEffect(() => {
    refreshFolders();
  }, [refreshFolders]);

  const tree = useMemo(() => buildFolderTree(noteNodes, emptyFolders), [noteNodes, emptyFolders]);

  const toggleExpanded = (path: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });
  };

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

  const handleCreateFolder = async (parentPath: string) => {
    const name = newFolderName.trim().replace(/\/+/g, '');
    if (!name) {
      setPendingFolder(null);
      return;
    }
    const fullPath = parentPath ? `${parentPath}/${name}` : name;
    await noteFolders.create(fullPath);
    setNewFolderName('');
    setPendingFolder(null);
    setExpanded((prev) => new Set(prev).add(fullPath));
    await refreshFolders();
  };

  const handleDeleteFolder = async (path: string) => {
    if (!confirm(`Delete folder "${path}"? Notes inside will move to the root.`)) return;
    await noteFolders.delete(path);
    await refreshFolders();
  };

  const handleRenameFolder = async (oldPath: string) => {
    const newName = prompt(`Rename folder "${oldPath}" to:`, oldPath.split('/').pop() ?? '');
    if (!newName || newName.trim() === '') return;
    const parent = oldPath.includes('/') ? oldPath.slice(0, oldPath.lastIndexOf('/')) : '';
    const newPath = parent ? `${parent}/${newName.trim()}` : newName.trim();
    if (newPath === oldPath) return;
    await noteFolders.rename(oldPath, newPath);
    await refreshFolders();
    // Refresh graph nodes so moved folder_path values show up
    await useGraphStore.getState().loadAll();
  };

  const handleMoveNote = async (nodeId: string, targetPath: string) => {
    await noteFolders.moveNote(nodeId, targetPath);
    await useGraphStore.getState().loadAll();
  };

  if (view === 'editor') {
    return <NoteEditor nodeId={editingNodeId} onBack={handleBack} />;
  }

  return (
    <div className="p-4 space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold text-zinc-100">Notes</h3>
        <div className="flex gap-1">
          <button
            onClick={() => setPendingFolder('')}
            className="text-xs px-2.5 py-1 bg-zinc-700 text-zinc-200 rounded hover:bg-zinc-600 transition-colors"
            title="Create a folder at the root"
          >
            + Folder
          </button>
          <button
            onClick={handleNew}
            className="text-xs px-2.5 py-1 bg-indigo-600 text-white rounded hover:bg-indigo-500 transition-colors"
          >
            + New Note
          </button>
        </div>
      </div>

      {noteNodes.length === 0 && emptyFolders.length === 0 ? (
        <div className="text-center py-8">
          <p className="text-sm text-zinc-500">No notes yet</p>
          <p className="text-xs text-zinc-600 mt-1">
            Create a note to capture thoughts and connect them to your knowledge graph.
          </p>
        </div>
      ) : (
        <FolderTreeView
          folder={tree}
          expanded={expanded}
          toggleExpanded={toggleExpanded}
          onEditNote={handleEdit}
          onRenameFolder={handleRenameFolder}
          onDeleteFolder={handleDeleteFolder}
          onRequestCreate={(p) => setPendingFolder(p)}
          onMoveNote={handleMoveNote}
          pendingFolder={pendingFolder}
          newFolderName={newFolderName}
          setNewFolderName={setNewFolderName}
          onConfirmCreate={handleCreateFolder}
          onCancelCreate={() => {
            setPendingFolder(null);
            setNewFolderName('');
          }}
        />
      )}
    </div>
  );
}

/** Build a recursive folder tree from flat folder_path values + empty markers. */
function buildFolderTree(notes: GraphNode[], emptyFolders: string[]): FolderNode {
  const root: FolderNode = { path: '', name: '', children: [], notes: [] };
  const byPath = new Map<string, FolderNode>([['', root]]);

  const ensurePath = (path: string): FolderNode => {
    if (byPath.has(path)) return byPath.get(path)!;
    const segments = path.split('/');
    const name = segments[segments.length - 1];
    const parentPath = segments.slice(0, -1).join('/');
    const parent = ensurePath(parentPath);
    const node: FolderNode = { path, name, children: [], notes: [] };
    parent.children.push(node);
    byPath.set(path, node);
    return node;
  };

  for (const note of notes) {
    const path = note.folderPath ?? '';
    ensurePath(path).notes.push(note);
  }
  for (const empty of emptyFolders) {
    ensurePath(empty);
  }

  // Sort: folders first (alpha), then notes (alpha)
  const sortRec = (f: FolderNode) => {
    f.children.sort((a, b) => a.name.localeCompare(b.name));
    f.notes.sort((a, b) => a.name.localeCompare(b.name));
    f.children.forEach(sortRec);
  };
  sortRec(root);
  return root;
}

interface TreeViewProps {
  folder: FolderNode;
  expanded: Set<string>;
  toggleExpanded: (path: string) => void;
  onEditNote: (id: string) => void;
  onRenameFolder: (path: string) => void;
  onDeleteFolder: (path: string) => void;
  onRequestCreate: (parent: string) => void;
  onMoveNote: (nodeId: string, targetPath: string) => void;
  pendingFolder: string | null;
  newFolderName: string;
  setNewFolderName: (v: string) => void;
  onConfirmCreate: (parent: string) => void;
  onCancelCreate: () => void;
}

function FolderTreeView(props: TreeViewProps) {
  return <FolderNodeView {...props} folder={props.folder} depth={0} />;
}

interface FolderNodeViewProps extends TreeViewProps {
  depth: number;
}

function FolderNodeView(props: FolderNodeViewProps) {
  const { folder, depth, expanded, toggleExpanded, onEditNote } = props;
  const isRoot = folder.path === '';
  const isOpen = isRoot || expanded.has(folder.path);
  const hasContent = folder.children.length > 0 || folder.notes.length > 0;

  return (
    <div className={isRoot ? 'space-y-1' : ''}>
      {!isRoot && (
        <div
          className="flex items-center gap-1.5 text-xs text-zinc-300 hover:text-zinc-100 cursor-pointer select-none py-0.5"
          style={{ paddingLeft: depth * 12 }}
        >
          <button
            onClick={() => toggleExpanded(folder.path)}
            className="w-3 text-zinc-500"
            aria-label={isOpen ? 'Collapse' : 'Expand'}
          >
            {isOpen ? '▾' : '▸'}
          </button>
          <span className="flex-1 truncate font-medium" onClick={() => toggleExpanded(folder.path)}>
            📁 {folder.name}
          </span>
          <button
            onClick={() => props.onRequestCreate(folder.path)}
            className="text-zinc-500 hover:text-zinc-300 text-[10px] px-1"
            title="New sub-folder"
          >
            +
          </button>
          <button
            onClick={() => props.onRenameFolder(folder.path)}
            className="text-zinc-500 hover:text-zinc-300 text-[10px] px-1"
            title="Rename"
          >
            ✎
          </button>
          <button
            onClick={() => props.onDeleteFolder(folder.path)}
            className="text-zinc-500 hover:text-red-400 text-[10px] px-1"
            title="Delete"
          >
            ✕
          </button>
        </div>
      )}

      {/* Pending new-folder input */}
      {props.pendingFolder === folder.path && (
        <div className="flex items-center gap-1" style={{ paddingLeft: (depth + (isRoot ? 0 : 1)) * 12 }}>
          <input
            value={props.newFolderName}
            onChange={(e) => props.setNewFolderName(e.target.value)}
            placeholder="folder name"
            autoFocus
            onKeyDown={(e) => {
              if (e.key === 'Enter') props.onConfirmCreate(folder.path);
              if (e.key === 'Escape') props.onCancelCreate();
            }}
            className="flex-1 bg-zinc-800 border border-zinc-600 rounded px-1.5 py-0.5 text-xs text-zinc-200 outline-none focus:border-indigo-500"
          />
          <button
            onClick={() => props.onConfirmCreate(folder.path)}
            className="text-[10px] text-indigo-400"
          >
            ✓
          </button>
          <button
            onClick={props.onCancelCreate}
            className="text-[10px] text-zinc-500"
          >
            ✕
          </button>
        </div>
      )}

      {isOpen && hasContent && (
        <div className={isRoot ? '' : 'space-y-0.5'}>
          {folder.children.map((child) => (
            <FolderNodeView {...props} key={child.path} folder={child} depth={depth + 1} />
          ))}
          {folder.notes.map((note) => (
            <NoteTreeItem
              key={note.id}
              node={note}
              depth={depth + (isRoot ? 0 : 1)}
              onEdit={onEditNote}
              onMoveToRoot={() => props.onMoveNote(note.id, '')}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function NoteTreeItem({
  node,
  depth,
  onEdit,
  onMoveToRoot,
}: {
  node: GraphNode;
  depth: number;
  onEdit: (id: string) => void;
  onMoveToRoot: () => void;
}) {
  const preview = typeof node.properties?.content === 'string'
    ? node.properties.content.slice(0, 60)
    : '';
  return (
    <div
      className="flex items-center gap-1.5 py-0.5 group"
      style={{ paddingLeft: depth * 12 + 16 }}
    >
      <button
        onClick={() => onEdit(node.id)}
        className="flex-1 text-left px-2 py-1 rounded hover:bg-zinc-800 min-w-0"
      >
        <span className="text-xs text-zinc-200 font-medium truncate block">📝 {node.name}</span>
        {preview && <span className="text-[10px] text-zinc-500 truncate block">{preview}</span>}
      </button>
      {node.folderPath && (
        <button
          onClick={onMoveToRoot}
          className="opacity-0 group-hover:opacity-100 text-zinc-500 hover:text-zinc-300 text-[10px] px-1"
          title="Move to root"
        >
          ↑
        </button>
      )}
    </div>
  );
}
