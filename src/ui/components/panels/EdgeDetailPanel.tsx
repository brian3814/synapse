import React, { useState, useEffect } from 'react';
import { useGraphStore } from '../../../graph/store/graph-store';
import { useUIStore } from '../../../graph/store/ui-store';
import { PropertyEditor } from './PropertyEditor';
import { PanelHeader } from '../shared/PanelHeader';
import { edgeSources, type EdgeProvenanceType } from '../../../db/client/db-client';

interface EdgeProvenanceRow {
  id: number;
  edge_id: string;
  source_type: EdgeProvenanceType;
  source_id: string | null;
  resource_id: string | null;
  created_at: string;
}

export function EdgeDetailPanel({ onClose }: { onClose?: () => void }) {
  const selectedEdgeId = useGraphStore((s) => s.selectedEdgeId);
  const nodes = useGraphStore((s) => s.nodes);
  const edges = useGraphStore((s) => s.edges);
  const updateEdge = useGraphStore((s) => s.updateEdge);
  const deleteEdge = useGraphStore((s) => s.deleteEdge);
  const selectNode = useGraphStore((s) => s.selectNode);

  const edge = edges.find((e) => e.id === selectedEdgeId);
  const sourceNode = edge ? nodes.find((n) => n.id === edge.sourceId) : null;
  const targetNode = edge ? nodes.find((n) => n.id === edge.targetId) : null;

  const [editing, setEditing] = useState(false);
  const [label, setLabel] = useState('');
  const [type, setType] = useState('');
  const [weight, setWeight] = useState(1);
  const [properties, setProperties] = useState<Record<string, unknown>>({});
  const [provenance, setProvenance] = useState<EdgeProvenanceRow[]>([]);

  useEffect(() => {
    if (edge) {
      setLabel(edge.label);
      setType(edge.type);
      setWeight(edge.weight);
      setProperties(edge.properties);
      setEditing(false);

      edgeSources.getForEdge(edge.id).then(setProvenance).catch(() => setProvenance([]));
    }
  }, [edge]);

  if (!edge) {
    return (
      <div className="px-3 py-2 flex items-center justify-between">
        <span className="text-zinc-500 text-sm">No edge selected</span>
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
    );
  }

  const handleSave = async () => {
    await updateEdge({ id: edge.id, label, type, weight, properties });
    setEditing(false);
  };

  const handleDelete = async () => {
    if (confirm(`Delete edge "${edge.label}"?`)) {
      await deleteEdge(edge.id);
      if (onClose) onClose();
    }
  };

  const goToNode = (id: string) => {
    selectNode(id);
    useUIStore.getState().setGraphOverlay('nodeDetail');
  };

  return (
    <div className="p-4 space-y-4">
      <PanelHeader title="Edge Detail">
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
      </PanelHeader>

      {/* Section 1: Path + Label + Type */}
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

        <Field label="Directed">
          <span className="text-sm text-zinc-200">{edge.directed ? 'Yes' : 'No'}</span>
        </Field>

        <Field label="Created">
          <span className="text-xs text-zinc-500">{edge.createdAt}</span>
        </Field>
      </div>

      <div className="border-t border-zinc-700" />

      {/* Section 2: Properties */}
      <div className="space-y-3">
        <Field label="Properties">
          {editing ? (
            <PropertyEditor value={properties} onSave={setProperties} nodeId={edge.id} />
          ) : (
            <pre className="text-xs text-zinc-400 bg-zinc-800 rounded p-2 overflow-x-auto">
              {JSON.stringify(edge.properties, null, 2)}
            </pre>
          )}
        </Field>
      </div>

      {/* Section 3: Provenance */}
      {provenance.length > 0 && (
        <>
        <div className="border-t border-zinc-700" />
        <div className="space-y-3">
          <Field label={`Provenance (${provenance.length})`}>
            <div className="space-y-1">
              {provenance.map((p) => {
                let detail = '';
                if (p.source_type === 'note' && p.source_id) {
                  const note = nodes.find((n) => n.id === p.source_id);
                  detail = note?.name ?? p.source_id.slice(0, 8);
                } else if (p.source_type === 'extraction' && p.resource_id) {
                  const res = nodes.find((n) => n.id === p.resource_id);
                  detail = res?.name ?? res?.sourceUrl ?? p.resource_id.slice(0, 8);
                } else if (p.source_type === 'user') {
                  detail = 'manual edit';
                }
                return (
                  <div
                    key={p.id}
                    className="text-xs bg-zinc-800 rounded px-2 py-1 flex justify-between gap-2"
                  >
                    <span className="text-zinc-500 shrink-0">{p.source_type}</span>
                    <span className="text-zinc-300 truncate">{detail}</span>
                  </div>
                );
              })}
            </div>
          </Field>
        </div>
        </>
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
