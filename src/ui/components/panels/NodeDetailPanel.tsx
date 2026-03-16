import React, { useState, useEffect, useMemo } from 'react';
import { useGraphStore } from '../../../graph/store/graph-store';
import { useUIStore } from '../../../graph/store/ui-store';
import { PropertyEditor } from './PropertyEditor';
import { useNodeTypeStore } from '../../../graph/store/node-type-store';

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
  const [label, setLabel] = useState('');
  const [type, setType] = useState('');
  const [properties, setProperties] = useState<Record<string, unknown>>({});

  useEffect(() => {
    if (node) {
      setLabel(node.label);
      setType(node.type);
      setProperties(node.properties);
      setEditing(false);
    }
  }, [node]);

  // Multi-select summary
  if (selectedNodeIds.size > 1) {
    const selectedNodes = nodes.filter((n) => selectedNodeIds.has(n.id));
    const handleBulkDelete = async () => {
      if (!confirm(`Delete ${selectedNodes.length} selected nodes? Connected edges will also be removed.`)) return;
      for (const n of selectedNodes) {
        await deleteNode(n.id);
      }
      setActivePanel('none');
    };
    return (
      <div className="p-4 space-y-3">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-semibold text-zinc-100">
            {selectedNodes.length} nodes selected
          </h3>
          <button
            onClick={handleBulkDelete}
            className="text-xs px-2 py-1 bg-red-900/50 text-red-400 rounded hover:bg-red-900"
          >
            Delete All
          </button>
        </div>
        <div className="space-y-1 max-h-60 overflow-y-auto">
          {selectedNodes.map((n) => (
            <div key={n.id} className="flex items-center gap-2 px-2 py-1 bg-zinc-800 rounded text-xs">
              <div
                className="w-2 h-2 rounded-full flex-shrink-0"
                style={{ backgroundColor: n.color || getColorForType(n.type) }}
              />
              <span className="text-zinc-200 truncate">{n.label}</span>
              <span className="text-zinc-500 capitalize ml-auto flex-shrink-0">{n.type}</span>
            </div>
          ))}
        </div>
      </div>
    );
  }

  if (!node) {
    return (
      <div className="p-4 text-zinc-500 text-sm">
        No node selected
      </div>
    );
  }

  const handleSave = async () => {
    await updateNode({ id: node.id, label, type, properties });
    setEditing(false);
  };

  const handleDelete = async () => {
    if (confirm(`Delete node "${node.label}"? Connected edges will also be removed.`)) {
      await deleteNode(node.id);
      setActivePanel('none');
    }
  };

  const color = node.color || getColorForType(node.type);

  return (
    <div className="p-4 space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <div className="w-3 h-3 rounded-full" style={{ backgroundColor: color }} />
          <h3 className="text-sm font-semibold text-zinc-100">Node Detail</h3>
        </div>
        <div className="flex gap-1">
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
        </div>
      </div>

      <div className="space-y-3">
        <Field label="Label">
          {editing ? (
            <input
              value={label}
              onChange={(e) => setLabel(e.target.value)}
              className="w-full bg-zinc-800 border border-zinc-600 rounded px-2 py-1 text-sm text-zinc-100 outline-none focus:border-indigo-500"
            />
          ) : (
            <span className="text-sm text-zinc-200">{node.label}</span>
          )}
        </Field>

        <Field label="Type">
          {editing ? (
            <select
              value={type}
              onChange={(e) => setType(e.target.value)}
              className="w-full bg-zinc-800 border border-zinc-600 rounded px-2 py-1 text-sm text-zinc-100 outline-none focus:border-indigo-500"
            >
              {nodeTypesList.map((t) => (
                <option key={t.type} value={t.type}>{t.type}</option>
              ))}
              {/* Keep current type selectable even if not in ontology */}
              {!nodeTypesList.some((t) => t.type === type) && (
                <option value={type}>{type}</option>
              )}
            </select>
          ) : (
            <span className="text-sm text-zinc-200 capitalize">{node.type}</span>
          )}
        </Field>

        <Field label="Properties">
          {editing ? (
            <PropertyEditor value={properties} onChange={setProperties} />
          ) : (
            <pre className="text-xs text-zinc-400 bg-zinc-800 rounded p-2 overflow-x-auto">
              {JSON.stringify(node.properties, null, 2)}
            </pre>
          )}
        </Field>

        {node.sourceUrl && (
          <Field label="Source">
            <span className="text-xs text-indigo-400 break-all">{node.sourceUrl}</span>
          </Field>
        )}

        <Field label="Created">
          <span className="text-xs text-zinc-500">{node.createdAt}</span>
        </Field>
      </div>

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
                    {edge.sourceId === node.id ? '→' : '←'}
                  </span>
                  <span className="text-indigo-400">{edge.label}</span>
                  <span className="text-zinc-500">
                    {otherNode?.label ?? '?'}
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

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="text-xs font-medium text-zinc-400 block mb-1">{label}</label>
      {children}
    </div>
  );
}
