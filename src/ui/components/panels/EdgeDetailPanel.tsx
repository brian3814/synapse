import React, { useState, useEffect } from 'react';
import { useGraphStore } from '../../../graph/store/graph-store';
import { useUIStore } from '../../../graph/store/ui-store';
import { PropertyEditor } from './PropertyEditor';

export function EdgeDetailPanel() {
  const selectedEdgeId = useGraphStore((s) => s.selectedEdgeId);
  const nodes = useGraphStore((s) => s.nodes);
  const edges = useGraphStore((s) => s.edges);
  const updateEdge = useGraphStore((s) => s.updateEdge);
  const deleteEdge = useGraphStore((s) => s.deleteEdge);
  const selectNode = useGraphStore((s) => s.selectNode);
  const setActivePanel = useUIStore((s) => s.setActivePanel);

  const edge = edges.find((e) => e.id === selectedEdgeId);
  const sourceNode = edge ? nodes.find((n) => n.id === edge.sourceId) : null;
  const targetNode = edge ? nodes.find((n) => n.id === edge.targetId) : null;

  const [editing, setEditing] = useState(false);
  const [label, setLabel] = useState('');
  const [type, setType] = useState('');
  const [weight, setWeight] = useState(1);
  const [properties, setProperties] = useState<Record<string, unknown>>({});

  useEffect(() => {
    if (edge) {
      setLabel(edge.label);
      setType(edge.type);
      setWeight(edge.weight);
      setProperties(edge.properties);
      setEditing(false);
    }
  }, [edge]);

  if (!edge) {
    return (
      <div className="p-4 text-zinc-500 text-sm">No edge selected</div>
    );
  }

  const handleSave = async () => {
    await updateEdge({ id: edge.id, label, type, weight, properties });
    setEditing(false);
  };

  const handleDelete = async () => {
    if (confirm(`Delete edge "${edge.label}"?`)) {
      await deleteEdge(edge.id);
      setActivePanel('none');
    }
  };

  const goToNode = (id: string) => {
    selectNode(id);
    setActivePanel('nodeDetail');
  };

  return (
    <div className="p-4 space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold text-zinc-100">Edge Detail</h3>
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
        <div className="flex items-center gap-2 bg-zinc-800 rounded p-2">
          <button onClick={() => goToNode(edge.sourceId)} className="text-indigo-400 hover:text-indigo-300 text-sm truncate">
            {sourceNode?.name ?? edge.sourceId}
          </button>
          <span className="text-zinc-500 text-xs shrink-0">→</span>
          <button onClick={() => goToNode(edge.targetId)} className="text-indigo-400 hover:text-indigo-300 text-sm truncate">
            {targetNode?.name ?? edge.targetId}
          </button>
        </div>

        <Field label="Label">
          {editing ? (
            <input
              value={label}
              onChange={(e) => setLabel(e.target.value)}
              className="w-full bg-zinc-800 border border-zinc-600 rounded px-2 py-1 text-sm text-zinc-100 outline-none focus:border-indigo-500"
            />
          ) : (
            <span className="text-sm text-zinc-200">{edge.label}</span>
          )}
        </Field>

        <Field label="Type">
          {editing ? (
            <input
              value={type}
              onChange={(e) => setType(e.target.value)}
              className="w-full bg-zinc-800 border border-zinc-600 rounded px-2 py-1 text-sm text-zinc-100 outline-none focus:border-indigo-500"
            />
          ) : (
            <span className="text-sm text-zinc-200">{edge.type}</span>
          )}
        </Field>

        <Field label="Weight">
          {editing ? (
            <input
              type="number"
              value={weight}
              onChange={(e) => setWeight(Number(e.target.value))}
              min="0.1"
              step="0.1"
              className="w-full bg-zinc-800 border border-zinc-600 rounded px-2 py-1 text-sm text-zinc-100 outline-none focus:border-indigo-500"
            />
          ) : (
            <span className="text-sm text-zinc-200">{edge.weight}</span>
          )}
        </Field>

        <Field label="Properties">
          {editing ? (
            <PropertyEditor value={properties} onChange={setProperties} />
          ) : (
            <pre className="text-xs text-zinc-400 bg-zinc-800 rounded p-2 overflow-x-auto">
              {JSON.stringify(edge.properties, null, 2)}
            </pre>
          )}
        </Field>

        <Field label="Directed">
          <span className="text-sm text-zinc-200">{edge.directed ? 'Yes' : 'No'}</span>
        </Field>

        <Field label="Created">
          <span className="text-xs text-zinc-500">{edge.createdAt}</span>
        </Field>
      </div>
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
