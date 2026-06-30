import { useState, useEffect, useMemo } from 'react';
import { useGraphStore } from '../../../graph/store/graph-store';
import { useUIStore } from '../../../graph/store/ui-store';
import { PropertyEditor } from './PropertyEditor';
import { useNodeTypeStore } from '../../../graph/store/node-type-store';
import { tags } from '../../../db/client/db-client';
import { MultiSelectPanel } from './MultiSelectPanel';
import { entityFiles, notes } from '@platform';
import { NoteMarkdownPreview } from '../shared/MarkdownRenderer';
import { parseMarkdown } from '../../../filesystem/markdown-parser';

export function NodeDetailPanel({ onClose }: { onClose?: () => void }) {
  const selectedNodeIds = useGraphStore((s) => s.selectedNodeIds);
  const nodes = useGraphStore((s) => s.nodes);
  const edges = useGraphStore((s) => s.edges);
  const updateNode = useGraphStore((s) => s.updateNode);
  const deleteNode = useGraphStore((s) => s.deleteNode);
  const selectNode = useGraphStore((s) => s.selectNode);
  const selectEdge = useGraphStore((s) => s.selectEdge);
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
      setEditing(false);
      setTagInput('');

      // Load tags
      tags.getForNode(node.id).then(setNodeTags).catch(() => setNodeTags([]));
    }
  }, [node]);

  const [fileContent, setFileContent] = useState<string | null>(null);
  const [fileLoading, setFileLoading] = useState(false);
  const [fileExpanded, setFileExpanded] = useState(false);
  const [entityFileGenerating, setEntityFileGenerating] = useState(false);

  useEffect(() => {
    if (!node || (node.type !== 'entity' && node.type !== 'note')) {
      setFileContent(null);
      return;
    }
    let cancelled = false;
    setFileLoading(true);
    setFileExpanded(false);

    const loadContent = node.type === 'entity'
      ? entityFiles.read(node.id).then((result: { path: string; content: string; contentHash: string | null } | null) => {
          if (cancelled) return;
          if (result) {
            const parsed = parseMarkdown(result.content);
            setFileContent(parsed.content);
          } else {
            setFileContent(null);
          }
        })
      : notes.read(node.id).then((md) => {
          if (cancelled) return;
          if (md) {
            const parsed = parseMarkdown(md);
            setFileContent(parsed.content);
          } else {
            setFileContent(null);
          }
        });

    loadContent
      .catch(() => { if (!cancelled) setFileContent(null); })
      .finally(() => { if (!cancelled) setFileLoading(false); });
    return () => { cancelled = true; };
  }, [node?.id, node?.type]);

  // For resource nodes: find linked notes to display in the panel
  // MUST be before early returns to satisfy React's rules of hooks.
  const linkedNotes = useMemo(() => {
    if (node?.type !== 'resource') return [];
    const noteIds = new Set<string>();
    for (const edge of edges) {
      if (edge.targetId === node.id && edge.label === 'extracted_from') {
        const srcNode = nodes.find((n) => n.id === edge.sourceId && n.type === 'note');
        if (srcNode) noteIds.add(srcNode.id);
      }
    }
    for (const n of nodes) {
      if (n.type === 'note' && n.properties?.resourceId === node.id) {
        noteIds.add(n.id);
      }
    }
    return [...noteIds].map((id) => nodes.find((n) => n.id === id)).filter(Boolean) as typeof nodes;
  }, [node, edges, nodes]);

  // Multi-select: delegate to dedicated panel
  if (selectedNodeIds.size > 1) {
    return <MultiSelectPanel />;
  }

  if (!node) {
    return (
      <div className="px-3 py-2 flex items-center justify-between">
        <span className="text-zinc-500 text-sm">No node/edge selected</span>
        <button
          onClick={() => { if (onClose) onClose(); else useUIStore.getState().setGraphOverlay('none'); }}
          className="p-1 text-zinc-400 hover:text-zinc-200 rounded hover:bg-zinc-700 transition-colors"
          title="Close panel"
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
            <path d="M18 6 6 18M6 6l12 12" />
          </svg>
        </button>
      </div>
    );
  }

  const handleOpenNote = (noteId: string) => {
    const noteNode = nodes.find(n => n.id === noteId);
    useUIStore.getState().openContentTab(
      { kind: 'noteEditor', noteId },
      noteNode?.name ?? 'Note'
    );
  };

  const handleNavigateToNode = (nodeId: string) => {
    const targetNode = nodes.find((n) => n.id === nodeId);
    if (targetNode) {
      const { visibleLayers, toggleLayer } = useUIStore.getState();
      const layer = targetNode.type as 'entity' | 'note' | 'resource';
      if (!visibleLayers[layer]) toggleLayer(layer);
    }
    selectNode(nodeId);
    const cb = useUIStore.getState().focusNodeCallback;
    if (cb) cb(nodeId);
  };

  const handleSave = async () => {
    await updateNode({
      id: node.id,
      name,
      type,
      label: type === 'entity' ? (label ?? undefined) : undefined,
    });
    await tags.setForNode(node.id, nodeTags);
    setEditing(false);
  };

  const handleDelete = async () => {
    if (confirm(`Delete node "${node.name}"? Connected edges will also be removed.`)) {
      await deleteNode(node.id);
      if (onClose) onClose(); else useUIStore.getState().setGraphOverlay('none');
    }
  };

  const handleSaveProperties = async (newProps: Record<string, unknown>) => {
    await updateNode({ id: node.id, properties: newProps });
  };

  const handleGenerateEntityFile = async () => {
    setEntityFileGenerating(true);
    try {
      await entityFiles.generateAll();
      const result = await entityFiles.read(node.id);
      if (result) {
        const parsed = parseMarkdown(result.content);
        setFileContent(parsed.content);
      }
    } finally {
      setEntityFileGenerating(false);
    }
  };

  const handleOpenInEditor = () => {
    useUIStore.getState().openContentTab(
      { kind: 'noteEditor', noteId: node.id },
      node.name
    );
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
    if (onClose) onClose(); else useUIStore.getState().setGraphOverlay('none');
  };

  const handleAddTag = () => {
    const tag = tagInput.trim().toLowerCase();
    if (tag && !nodeTags.includes(tag)) {
      setNodeTags([...nodeTags, tag]);
    }
    setTagInput('');
  };

  const color = node?.color || getColorForType(node?.type ?? '');

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
          {onClose && (
            <button
              onClick={onClose}
              className="p-1 text-zinc-400 hover:text-zinc-200 rounded hover:bg-zinc-700 transition-colors"
              title="Close panel"
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                <path d="M18 6 6 18M6 6l12 12" />
              </svg>
            </button>
          )}
        </div>
      </div>

      {/* Section 1: Type / Label / Tags */}
      <div className="space-y-3 pt-1">
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

      <div className="border-t border-zinc-700" />

      {/* Section 2: Properties */}
      <div>
        <label className="text-xs font-medium text-zinc-400 block mb-1">Properties</label>
        <PropertyEditor value={node.properties} onSave={handleSaveProperties} nodeId={node.id} />
      </div>

      <div className="border-t border-zinc-700" />

      {/* Section 3: Content, Sources, Notes, Edges */}

      {/* Markdown Content Preview — entity files and notes */}
      {(node.type === 'entity' || node.type === 'note') && (
        <div>
          <label className="text-xs font-medium text-zinc-400 flex items-center gap-1.5 mb-2">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M14.5 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7.5L14.5 2z"/>
              <polyline points="14 2 14 8 20 8"/>
            </svg>
            {node.type === 'entity' ? 'Entity File' : 'Note Content'}
          </label>

          {fileLoading ? (
            <div className="flex items-center gap-2 py-2">
              <span className="w-3 h-3 border-2 border-indigo-500 border-t-transparent rounded-full animate-spin" />
              <span className="text-xs text-zinc-500">Loading...</span>
            </div>
          ) : fileContent === null ? (
            <div className="flex items-center gap-2">
              <span className="text-xs text-zinc-600 italic">
                {node.type === 'entity' ? 'No entity file' : 'No content'}
              </span>
              {node.type === 'entity' && (
                <button
                  onClick={handleGenerateEntityFile}
                  disabled={entityFileGenerating}
                  className="text-xs px-2 py-0.5 bg-zinc-700 text-zinc-300 rounded hover:bg-zinc-600 disabled:opacity-50"
                >
                  {entityFileGenerating ? 'Generating...' : 'Generate'}
                </button>
              )}
            </div>
          ) : (
            <div>
              <div className={`relative ${fileExpanded ? '' : 'max-h-[200px] overflow-hidden'}`}>
                <div className="bg-zinc-800 rounded p-2">
                  <NoteMarkdownPreview
                    content={fileContent}
                    onNodeClick={(nodeId) => handleNavigateToNode(nodeId)}
                  />
                </div>
                {!fileExpanded && (
                  <div className="absolute bottom-0 left-0 right-0 h-12 bg-gradient-to-t from-zinc-900 to-transparent rounded-b pointer-events-none" />
                )}
              </div>
              <div className="flex items-center gap-2 mt-1.5">
                <button
                  onClick={() => setFileExpanded(!fileExpanded)}
                  className="text-xs text-zinc-500 hover:text-zinc-300"
                >
                  {fileExpanded ? 'Show less' : 'Show more'}
                </button>
                <button
                  onClick={handleOpenInEditor}
                  className="flex items-center gap-1.5 text-xs px-2 py-1 bg-sky-600/20 hover:bg-sky-600/30 border border-sky-700/40 rounded text-sky-300 font-medium"
                >
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M14.5 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7.5L14.5 2z"/>
                    <polyline points="14 2 14 8 20 8"/>
                    <line x1="16" y1="13" x2="8" y2="13"/>
                    <line x1="16" y1="17" x2="8" y2="17"/>
                  </svg>
                  Open in Editor
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Sources — derived via notes: entity → note → resource */}
      {(connectedResources.length > 0 || node.sourceUrl) && (
        <div>
          <label className="text-xs font-medium text-zinc-400 block mb-1">
            {connectedResources.length > 0 ? `Sources (${connectedResources.length})` : 'Source'}
          </label>
          <div className="space-y-1">
            {connectedResources.map((src) => (
              <button
                key={src.id}
                onClick={() => handleNavigateToNode(src.id)}
                className="w-full text-left text-xs bg-zinc-800 rounded px-2 py-1 hover:bg-zinc-700 flex justify-between gap-2 transition-colors"
              >
                <span className="text-indigo-400 truncate">{src.name}</span>
                <span className="text-zinc-500 shrink-0">
                  {src.noteCount} {src.noteCount === 1 ? 'note' : 'notes'}
                </span>
              </button>
            ))}
            {connectedResources.length === 0 && node.sourceUrl && (
              <span className="text-xs text-indigo-400 break-all">{node.sourceUrl}</span>
            )}
          </div>
        </div>
      )}

      {/* Linked Notes — for resource nodes */}
      {linkedNotes.length > 0 && (
        <div>
          <h4 className="text-xs font-medium text-zinc-400 mb-2">
            Notes ({linkedNotes.length})
          </h4>
          <div className="space-y-1">
            {linkedNotes.map((noteNode) => (
              <button
                key={noteNode.id}
                onClick={() => handleOpenNote(noteNode.id)}
                className="w-full text-left px-2 py-1.5 bg-zinc-800 rounded text-xs hover:bg-zinc-700 flex items-center gap-2"
              >
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-sky-400 flex-shrink-0">
                  <path d="M14.5 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7.5L14.5 2z"/><polyline points="14 2 14 8 20 8"/>
                </svg>
                <span className="text-zinc-200 truncate">{noteNode.name}</span>
              </button>
            ))}
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
                    useUIStore.getState().setGraphOverlay('edgeDetail');
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
