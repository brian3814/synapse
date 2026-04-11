import { useState, useEffect, useCallback } from 'react';
import { useGraphStore } from '../../../graph/store/graph-store';
import { useUIStore } from '../../../graph/store/ui-store';
import { useNodeTypeStore } from '../../../graph/store/node-type-store';
import { entityResolution } from '../../../db/client/db-client';
import type { GraphNode } from '../../../shared/types';

type Action = 'none' | 'merge' | 'relate';

interface RelationshipRow {
  sourceId: string;
  targetId: string;
  label: string;
}

const SEED_LABELS = [
  'related',
  'subfield_of',
  'part_of',
  'instance_of',
  'created_by',
  'affiliated_with',
  'used_in',
  'builds_on',
  'enables',
  'contradicts',
  'alternative_to',
  'preceded_by',
];

export function MultiSelectPanel() {
  const selectedNodeIds = useGraphStore((s) => s.selectedNodeIds);
  const nodes = useGraphStore((s) => s.nodes);
  const deleteNode = useGraphStore((s) => s.deleteNode);
  const updateNode = useGraphStore((s) => s.updateNode);
  const createEdge = useGraphStore((s) => s.createEdge);
  const selectNode = useGraphStore((s) => s.selectNode);
  const setActivePanel = useUIStore((s) => s.setActivePanel);
  const getColorForType = useNodeTypeStore((s) => s.getColorForType);

  const [action, setAction] = useState<Action>('none');
  const [masterId, setMasterId] = useState<string | null>(null);
  const [merging, setMerging] = useState(false);
  const [rows, setRows] = useState<RelationshipRow[]>([]);
  const [creating, setCreating] = useState(false);

  const selectedNodes = nodes.filter((n) => selectedNodeIds.has(n.id));

  // Reset action when selection changes
  useEffect(() => {
    setAction('none');
    setMasterId(null);
    setRows([]);
  }, [selectedNodeIds]);

  // --- Delete All ---
  const handleBulkDelete = async () => {
    if (!confirm(`Delete ${selectedNodes.length} selected nodes? Connected edges will also be removed.`))
      return;
    for (const n of selectedNodes) {
      await deleteNode(n.id);
    }
    setActivePanel('none');
  };

  // --- Merge ---
  const handleMerge = async () => {
    if (!masterId) return;
    const master = nodes.find((n) => n.id === masterId);
    if (!master) return;

    const others = selectedNodes.filter((n) => n.id !== masterId);
    if (others.length === 0) return;

    if (
      !confirm(
        `Merge ${others.length} node${others.length > 1 ? 's' : ''} into "${master.name}"? This will move all edges and add name aliases.`
      )
    )
      return;

    setMerging(true);
    try {
      const graphStore = useGraphStore.getState();

      for (const other of others) {
        // 1. Add alias for the merged node's name
        try {
          await entityResolution.addAlias(masterId, other.name);
        } catch {
          // Alias may already exist
        }

        // 2. Merge properties into master
        if (Object.keys(other.properties).length > 0) {
          const current = graphStore.nodes.find((n) => n.id === masterId);
          if (current) {
            await updateNode({
              id: masterId,
              properties: { ...current.properties, ...other.properties },
            });
          }
        }

        // 3. Repoint edges from other → master (delete + recreate since
        // UpdateEdgeInput doesn't support changing source/target)
        const edgesNow = useGraphStore.getState().edges;
        for (const edge of edgesNow) {
          let newSourceId: string | null = null;
          let newTargetId: string | null = null;
          if (edge.sourceId === other.id) {
            if (edge.targetId === masterId) continue; // would become self-loop
            newSourceId = masterId;
            newTargetId = edge.targetId;
          } else if (edge.targetId === other.id) {
            if (edge.sourceId === masterId) continue;
            newSourceId = edge.sourceId;
            newTargetId = masterId;
          }
          if (newSourceId && newTargetId) {
            await graphStore.createEdge({
              sourceId: newSourceId,
              targetId: newTargetId,
              label: edge.label,
              type: edge.type,
              properties: edge.properties,
            });
            await graphStore.deleteEdge(edge.id);
          }
        }

        // 4. Delete the merged node
        await deleteNode(other.id);
      }

      selectNode(masterId);
      setActivePanel('nodeDetail');
    } finally {
      setMerging(false);
    }
  };

  // --- Establish Relationships ---
  const addRow = useCallback(() => {
    const ids = [...selectedNodeIds];
    setRows((prev) => [
      ...prev,
      { sourceId: ids[0] ?? '', targetId: ids[1] ?? ids[0] ?? '', label: 'related' },
    ]);
  }, [selectedNodeIds]);

  const updateRow = (index: number, field: keyof RelationshipRow, value: string) => {
    setRows((prev) => prev.map((r, i) => (i === index ? { ...r, [field]: value } : r)));
  };

  const removeRow = (index: number) => {
    setRows((prev) => prev.filter((_, i) => i !== index));
  };

  const handleCreateRelationships = async () => {
    const valid = rows.filter((r) => r.sourceId && r.targetId && r.label.trim());
    if (valid.length === 0) return;

    setCreating(true);
    try {
      for (const row of valid) {
        await createEdge({
          sourceId: row.sourceId,
          targetId: row.targetId,
          label: row.label.trim(),
        });
      }
      setRows([]);
      setAction('none');
    } finally {
      setCreating(false);
    }
  };

  return (
    <div className="p-4 space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold text-zinc-100">
          {selectedNodes.length} nodes selected
        </h3>
      </div>

      {/* Selected nodes list */}
      <div className="space-y-1 max-h-40 overflow-y-auto">
        {selectedNodes.map((n) => (
          <div key={n.id} className="flex items-center gap-2 px-2 py-1 bg-zinc-800 rounded text-xs">
            <div
              className="w-2 h-2 rounded-full flex-shrink-0"
              style={{ backgroundColor: n.color || getColorForType(n.type) }}
            />
            <span className="text-zinc-200 truncate">{n.name}</span>
            <span className="text-zinc-500 capitalize ml-auto flex-shrink-0">{n.type}</span>
          </div>
        ))}
      </div>

      {/* Action buttons */}
      <div className="space-y-1">
        <label className="text-xs font-medium text-zinc-400 block">Actions</label>
        <div className="flex gap-1">
          <button
            onClick={handleBulkDelete}
            className="text-xs px-2 py-1.5 bg-red-900/50 text-red-400 rounded hover:bg-red-900"
          >
            Delete All
          </button>
          <button
            onClick={() => setAction(action === 'merge' ? 'none' : 'merge')}
            className={`text-xs px-2 py-1.5 rounded ${
              action === 'merge'
                ? 'bg-indigo-600 text-white'
                : 'bg-zinc-700 text-zinc-300 hover:bg-zinc-600'
            }`}
          >
            Merge Nodes
          </button>
          <button
            onClick={() => {
              if (action !== 'relate') {
                setAction('relate');
                if (rows.length === 0) {
                  const ids = [...selectedNodeIds];
                  setRows([{ sourceId: ids[0] ?? '', targetId: ids[1] ?? ids[0] ?? '', label: 'related' }]);
                }
              } else {
                setAction('none');
              }
            }}
            className={`text-xs px-2 py-1.5 rounded ${
              action === 'relate'
                ? 'bg-indigo-600 text-white'
                : 'bg-zinc-700 text-zinc-300 hover:bg-zinc-600'
            }`}
          >
            Add Relationships
          </button>
        </div>
      </div>

      {/* Merge UI */}
      {action === 'merge' && (
        <div className="space-y-2 border border-zinc-700 rounded p-3">
          <label className="text-xs font-medium text-zinc-400 block">
            Select master node (others merge into it)
          </label>
          <div className="space-y-1 max-h-40 overflow-y-auto">
            {selectedNodes.map((n) => (
              <button
                key={n.id}
                onClick={() => setMasterId(n.id)}
                className={`w-full text-left flex items-center gap-2 px-2 py-1.5 rounded text-xs transition-colors ${
                  masterId === n.id
                    ? 'bg-indigo-600/30 border border-indigo-500 text-zinc-100'
                    : 'bg-zinc-800 text-zinc-300 hover:bg-zinc-700'
                }`}
              >
                <div
                  className="w-2 h-2 rounded-full flex-shrink-0"
                  style={{ backgroundColor: n.color || getColorForType(n.type) }}
                />
                <span className="truncate">{n.name}</span>
                {masterId === n.id && (
                  <span className="text-[10px] text-indigo-400 ml-auto shrink-0">master</span>
                )}
              </button>
            ))}
          </div>
          <button
            onClick={handleMerge}
            disabled={!masterId || merging}
            className="w-full text-xs py-1.5 bg-indigo-600 text-white rounded hover:bg-indigo-500 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {merging ? 'Merging...' : `Merge ${selectedNodes.length - 1} into master`}
          </button>
        </div>
      )}

      {/* Relationship Builder UI */}
      {action === 'relate' && (
        <div className="space-y-2 border border-zinc-700 rounded p-3">
          <label className="text-xs font-medium text-zinc-400 block">
            Define relationships
          </label>

          <div className="space-y-2 max-h-60 overflow-y-auto">
            {rows.map((row, i) => (
              <RelationshipRowEditor
                key={i}
                row={row}
                index={i}
                selectedNodes={selectedNodes}
                onUpdate={updateRow}
                onRemove={removeRow}
              />
            ))}
          </div>

          <button
            onClick={addRow}
            className="text-xs px-2 py-1 bg-zinc-700 text-zinc-300 rounded hover:bg-zinc-600"
          >
            + Add relationship
          </button>

          <button
            onClick={handleCreateRelationships}
            disabled={rows.length === 0 || creating}
            className="w-full text-xs py-1.5 bg-indigo-600 text-white rounded hover:bg-indigo-500 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {creating ? 'Creating...' : `Create ${rows.length} relationship${rows.length !== 1 ? 's' : ''}`}
          </button>
        </div>
      )}
    </div>
  );
}

function RelationshipRowEditor({
  row,
  index,
  selectedNodes,
  onUpdate,
  onRemove,
}: {
  row: RelationshipRow;
  index: number;
  selectedNodes: GraphNode[];
  onUpdate: (index: number, field: keyof RelationshipRow, value: string) => void;
  onRemove: (index: number) => void;
}) {
  const [custom, setCustom] = useState(false);

  return (
    <div className="flex items-center gap-1 bg-zinc-800 rounded p-1.5">
      {/* Source */}
      <select
        value={row.sourceId}
        onChange={(e) => onUpdate(index, 'sourceId', e.target.value)}
        className="flex-1 min-w-0 bg-zinc-900 border border-zinc-700 rounded px-1.5 py-1 text-[11px] text-zinc-200 outline-none"
      >
        {selectedNodes.map((n) => (
          <option key={n.id} value={n.id}>
            {n.name}
          </option>
        ))}
      </select>

      {/* Arrow */}
      <span className="text-zinc-600 text-[10px] shrink-0">&rarr;</span>

      {/* Label */}
      {custom ? (
        <input
          value={row.label}
          onChange={(e) => onUpdate(index, 'label', e.target.value)}
          placeholder="label"
          className="w-24 bg-zinc-900 border border-zinc-700 rounded px-1.5 py-1 text-[11px] text-indigo-400 outline-none focus:border-indigo-500"
        />
      ) : (
        <select
          value={SEED_LABELS.includes(row.label) ? row.label : '__custom__'}
          onChange={(e) => {
            if (e.target.value === '__custom__') {
              setCustom(true);
              onUpdate(index, 'label', '');
            } else {
              onUpdate(index, 'label', e.target.value);
            }
          }}
          className="w-24 bg-zinc-900 border border-zinc-700 rounded px-1.5 py-1 text-[11px] text-indigo-400 outline-none"
        >
          {SEED_LABELS.map((l) => (
            <option key={l} value={l}>
              {l}
            </option>
          ))}
          <option value="__custom__">custom...</option>
        </select>
      )}

      {/* Arrow */}
      <span className="text-zinc-600 text-[10px] shrink-0">&rarr;</span>

      {/* Target */}
      <select
        value={row.targetId}
        onChange={(e) => onUpdate(index, 'targetId', e.target.value)}
        className="flex-1 min-w-0 bg-zinc-900 border border-zinc-700 rounded px-1.5 py-1 text-[11px] text-zinc-200 outline-none"
      >
        {selectedNodes.map((n) => (
          <option key={n.id} value={n.id}>
            {n.name}
          </option>
        ))}
      </select>

      {/* Remove */}
      <button
        onClick={() => onRemove(index)}
        className="text-zinc-600 hover:text-zinc-400 text-xs shrink-0 px-1"
        title="Remove"
      >
        x
      </button>
    </div>
  );
}
