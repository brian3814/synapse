import React, { useState, useEffect, useMemo } from 'react';
import { useGraphStore } from '../../../graph/store/graph-store';
import { useUIStore } from '../../../graph/store/ui-store';
import { PropertyEditor } from './PropertyEditor';
import { useNodeTypeStore } from '../../../graph/store/node-type-store';
import { tags } from '../../../db/client/db-client';
import { MultiSelectPanel } from './MultiSelectPanel';

export function NodeDetailPanel() {
  const selectedNodeIds = useGraphStore((s) => s.selectedNodeIds);
  const nodes = useGraphStore((s) => s.nodes);
  const edges = useGraphStore((s) => s.edges);
  const updateNode = useGraphStore((s) => s.updateNode);
  const deleteNode = useGraphStore((s) => s.deleteNode);
  const selectEdge = useGraphStore((s) => s.selectEdge);
  const setActivePanel = useUIStore((s) => s.setActivePanel);
  const nodeTypesList = useNodeTypeStore((s) => s.types);
  const getColorForType = useNodeTypeStore((s) => s.getColorForType);

  const selectedNodeId = selectedNodeIds.size === 1 ? [...selectedNodeIds][0] : null;
  const node = nodes.find((n) => n.id === selectedNodeId);
  const connectedEdges = useMemo(
    () => edges.filter((e) => e.sourceId === selectedNodeId || e.targetId === selectedNodeId),
    [edges, selectedNodeId]
  );

  const [editing, setEditing] = useState(false);
  const [name, setName] = useState('');
  const [type, setType] = useState('');
  const [label, setLabel] = useState<string | null>(null);
  const [properties, setProperties] = useState<Record<string, unknown>>({});
  const [nodeTags, setNodeTags] = useState<string[]>([]);
  const [tagInput, setTagInput] = useState('');
  const allTypes = useNodeTypeStore((s) => s.types);
  const entityLabels = useMemo(
    () => allTypes.filter((t) => t.category === 'entity_label'),
    [allTypes]
  );
  // Derive sources via two-hop: entity → connected notes → note's resource.
  // Notes are the intermediary between entities and resources. Each note stores
  // resourceId in properties (or has an extracted_from edge to the resource).
  const connectedResources = useMemo(() => {
    if (!selectedNodeId) return [];

    // Step 1: find note nodes connected to this node via edges
    const connectedNoteIds: string[] = [];
    for (const edge of edges) {
      let otherId: string | null = null;
      if (edge.sourceId === selectedNodeId) otherId = edge.targetId;
      else if (edge.targetId === selectedNodeId) otherId = edge.sourceId;
      if (!otherId) continue;
      const otherNode = nodes.find((n) => n.id === otherId && n.type === 'note');
      if (otherNode) connectedNoteIds.push(otherNode.id);
    }

    // Step 2: for each note, resolve its source resource
    const resourceMap = new Map<string, { id: string; name: string; noteCount: number }>();
    for (const noteId of connectedNoteIds) {
      const noteNode = nodes.find((n) => n.id === noteId);
      if (!noteNode) continue;

      // Try resourceId from properties first, then follow extracted_from edges
      const resId = noteNode.properties?.resourceId as string | undefined;
      let resourceNode: typeof nodes[0] | undefined;

      if (resId) {
        resourceNode = nodes.find((n) => n.id === resId && n.type === 'resource');
      }
      if (!resourceNode) {
        // Fallback: follow extracted_from edge from note to resource
        for (const edge of edges) {
          if (edge.sourceId === noteId && edge.label === 'extracted_from') {
            resourceNode = nodes.find((n) => n.id === edge.targetId && n.type === 'resource');
            if (resourceNode) break;
          }
        }
      }
      if (!resourceNode && noteNode.sourceUrl) {
        // Last fallback: match by sourceUrl
        resourceNode = nodes.find((n) => n.type === 'resource' && n.sourceUrl === noteNode.sourceUrl);
      }

      if (resourceNode) {
        const existing = resourceMap.get(resourceNode.id);
        if (existing) {
          existing.noteCount++;
        } else {
          resourceMap.set(resourceNode.id, { id: resourceNode.id, name: resourceNode.name, noteCount: 1 });
        }
      }
    }

    return [...resourceMap.values()];
  }, [edges, nodes, selectedNodeId]);

  useEffect(() => {
    if (node) {
      setName(node.name);
      setType(node.type);
      setLabel(node.label ?? null);
      setProperties(node.properties);
      setEditing(false);
      setTagInput('');

      // Load tags
      tags.getForNode(node.id).then(setNodeTags).catch(() => setNodeTags([]));
    }
  }, [node]);

  // Multi-select: delegate to dedicated panel
  if (selectedNodeIds.size > 1) {
    return <MultiSelectPanel />;
  }

  if (!node) {
    return (
      <div className="p-4 text-zinc-500 text-sm">
        No node selected
      </div>
    );
  }

  const handleSave = async () => {
    await updateNode({
      id: node.id,
      name,
      type,
      label: type === 'entity' ? (label ?? undefined) : undefined,
      properties,
    });
    await tags.setForNode(node.id, nodeTags);
    setEditing(false);
  };

  const handleDelete = async () => {
    if (confirm(`Delete node "${node.name}"? Connected edges will also be removed.`)) {
      await deleteNode(node.id);
      setActivePanel('none');
    }
  };

  // For resource nodes: find associated notes (via extracted_from edges or resourceId property)
  // and offer to delete them together.
  const handleDeleteWithNotes = async () => {
    // Find notes linked to this resource via extracted_from edges
    const linkedNoteIds = new Set<string>();
    for (const edge of edges) {
      if (edge.targetId === node.id && edge.label === 'extracted_from') {
        const srcNode = nodes.find((n) => n.id === edge.sourceId && n.type === 'note');
        if (srcNode) linkedNoteIds.add(srcNode.id);
      }
    }
    // Also find notes that reference this resource via properties.resourceId
    for (const n of nodes) {
      if (n.type === 'note' && n.properties?.resourceId === node.id) {
        linkedNoteIds.add(n.id);
      }
    }

    const noteCount = linkedNoteIds.size;
    const msg = noteCount > 0
      ? `Delete resource "${node.name}" and ${noteCount} associated ${noteCount === 1 ? 'note' : 'notes'}? All connected edges will also be removed.`
      : `Delete resource "${node.name}"? No associated notes found.`;

    if (!confirm(msg)) return;

    // Delete notes first (cascade removes their edges), then the resource
    for (const noteId of linkedNoteIds) {
      await deleteNode(noteId);
    }
    await deleteNode(node.id);
    setActivePanel('none');
  };

  const handleAddTag = () => {
    const tag = tagInput.trim().toLowerCase();
    if (tag && !nodeTags.includes(tag)) {
      setNodeTags([...nodeTags, tag]);
    }
    setTagInput('');
  };

  const color = node.color || getColorForType(node.type);

  return (
    <div className="p-4 space-y-4">
      {/* Header: Node name + actions */}
      <div className="flex items-start justify-between gap-2">
        <div className="flex items-center gap-2 min-w-0">
          <div className="w-3 h-3 rounded-full flex-shrink-0" style={{ backgroundColor: color }} />
          <h3 className="text-base font-semibold text-zinc-100 truncate" title={node.name}>
            {editing ? (
              <input
                value={name}
                onChange={(e) => setName(e.target.value)}
                className="w-full bg-zinc-800 border border-zinc-600 rounded px-2 py-1 text-sm text-zinc-100 outline-none focus:border-indigo-500"
              />
            ) : (
              node.name
            )}
          </h3>
        </div>
        <div className="flex gap-1 flex-shrink-0">
          {!editing ? (
            <button
              onClick={() => setEditing(true)}
              className="text-xs px-2 py-1 bg-zinc-700 text-zinc-300 rounded hover:bg-zinc-600"
            >
              Edit
            </button>
          ) : (
            <button
              onClick={handleSave}
              className="text-xs px-2 py-1 bg-indigo-600 text-white rounded hover:bg-indigo-500"
            >
              Save
            </button>
          )}
          <button
            onClick={handleDelete}
            className="text-xs px-2 py-1 bg-red-900/50 text-red-400 rounded hover:bg-red-900"
          >
            Delete
          </button>
          {node.type === 'resource' && (
            <button
              onClick={handleDeleteWithNotes}
              className="text-xs px-2 py-1 bg-red-900/50 text-red-400 rounded hover:bg-red-900"
              title="Delete this resource and all notes extracted from it"
            >
              + Notes
            </button>
          )}
        </div>
      </div>

      {/* Metadata section */}
      <div className="space-y-3" style={{ paddingTop: 4 }}>
        {/* Type (structural layer) */}
        <div>
          <label className="text-xs font-medium text-zinc-400 block mb-1">Type</label>
          {editing ? (
            <select
              value={type}
              onChange={(e) => setType(e.target.value)}
              className="w-full bg-zinc-800 border border-zinc-600 rounded px-2 py-1 text-sm text-zinc-100 outline-none focus:border-indigo-500"
            >
              <option value="entity">entity</option>
              <option value="resource">resource</option>
              <option value="note">note</option>
            </select>
          ) : (
            <span
              className="inline-block text-xs px-2 py-0.5 rounded-full font-medium capitalize"
              style={{ backgroundColor: color + '33', color }}
            >
              {node.type}
            </span>
          )}
        </div>

        {/* Label (semantic categorization, entities only) */}
        {(type === 'entity' || node.type === 'entity') && (
          <div>
            <label className="text-xs font-medium text-zinc-400 block mb-1">Label</label>
            {editing ? (
              <select
                value={label ?? 'concept'}
                onChange={(e) => setLabel(e.target.value)}
                className="w-full bg-zinc-800 border border-zinc-600 rounded px-2 py-1 text-sm text-zinc-100 outline-none focus:border-indigo-500"
              >
                {entityLabels.map((t) => (
                  <option key={t.type} value={t.type}>{t.type}</option>
                ))}
                {label && !entityLabels.some((t) => t.type === label) && (
                  <option value={label}>{label}</option>
                )}
              </select>
            ) : (
              <span className="text-xs text-zinc-300">{node.label ?? '—'}</span>
            )}
          </div>
        )}

        {/* Folder path (notes only) */}
        {node.type === 'note' && node.folderPath !== undefined && (
          <div>
            <label className="text-xs font-medium text-zinc-400 block mb-1">Folder</label>
            <span className="text-xs text-zinc-300 font-mono">
              {node.folderPath || <em className="text-zinc-500">root</em>}
            </span>
          </div>
        )}

        {/* Tags */}
        <div>
          <label className="text-xs font-medium text-zinc-400 block mb-1">Tags</label>
          <div className="flex flex-wrap gap-1">
            {nodeTags.map((tag) => (
              <span key={tag} className="inline-flex items-center gap-1 px-2 py-0.5 bg-zinc-700 rounded-full text-xs text-zinc-300">
                {tag}
                {editing && (
                  <button onClick={() => setNodeTags(nodeTags.filter(t => t !== tag))} className="text-zinc-500 hover:text-zinc-300">
                    x
                  </button>
                )}
              </span>
            ))}
            {editing && (
              <div className="inline-flex items-center gap-1">
                <input
                  value={tagInput}
                  onChange={(e) => setTagInput(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && (e.preventDefault(), handleAddTag())}
                  placeholder="Add tag..."
                  className="bg-zinc-800 border border-zinc-700 rounded px-1.5 py-0.5 text-xs text-zinc-200 outline-none focus:border-indigo-500 w-20"
                />
                <button
                  onClick={handleAddTag}
                  className="text-xs text-indigo-400 hover:text-indigo-300"
                >
                  +
                </button>
              </div>
            )}
            {!editing && nodeTags.length === 0 && (
              <span className="text-xs text-zinc-600 italic">No tags</span>
            )}
          </div>
        </div>

        {/* ID + Timestamps */}
        <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-zinc-500">
          <span title={node.id}>ID: {node.id.slice(0, 8)}...</span>
          <span>Created: {node.createdAt}</span>
          <span>Updated: {node.updatedAt}</span>
        </div>
      </div>

      {/* Properties */}
      <div>
        <label className="text-xs font-medium text-zinc-400 block mb-1">Properties</label>
        {editing ? (
          <PropertyEditor value={properties} onChange={setProperties} />
        ) : (
          <pre className="text-xs text-zinc-400 bg-zinc-800 rounded p-2 overflow-x-auto">
            {JSON.stringify(node.properties, null, 2)}
          </pre>
        )}
      </div>

      {/* Sources — derived via notes: entity → note → resource */}
      {(connectedResources.length > 0 || node.sourceUrl) && (
        <div>
          <label className="text-xs font-medium text-zinc-400 block mb-1">
            {connectedResources.length > 0 ? `Sources (${connectedResources.length})` : 'Source'}
          </label>
          <div className="space-y-1">
            {connectedResources.map((src) => (
              <div
                key={src.id}
                className="text-xs text-indigo-400 break-all bg-zinc-800 rounded px-2 py-1 flex justify-between gap-2"
              >
                <span className="truncate">{src.name}</span>
                <span className="text-zinc-500 shrink-0">
                  {src.noteCount} {src.noteCount === 1 ? 'note' : 'notes'}
                </span>
              </div>
            ))}
            {connectedResources.length === 0 && node.sourceUrl && (
              <span className="text-xs text-indigo-400 break-all">{node.sourceUrl}</span>
            )}
          </div>
        </div>
      )}

      {/* Connected Edges */}
      {connectedEdges.length > 0 && (
        <div>
          <h4 className="text-xs font-medium text-zinc-400 mb-2">
            Connected Edges ({connectedEdges.length})
          </h4>
          <div className="space-y-1">
            {connectedEdges.map((edge) => {
              const otherNode = nodes.find(
                (n) => n.id === (edge.sourceId === node.id ? edge.targetId : edge.sourceId)
              );
              return (
                <button
                  key={edge.id}
                  onClick={() => {
                    selectEdge(edge.id);
                    setActivePanel('edgeDetail');
                  }}
                  className="w-full text-left px-2 py-1.5 bg-zinc-800 rounded text-xs hover:bg-zinc-700 flex items-center gap-2"
                >
                  <span className="text-zinc-400">
                    {edge.sourceId === node.id ? '\u2192' : '\u2190'}
                  </span>
                  <span className="text-indigo-400">{edge.label}</span>
                  <span className="text-zinc-500">
                    {otherNode?.name ?? '?'}
                  </span>
                </button>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
