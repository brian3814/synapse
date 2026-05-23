import React, { useState, useMemo } from 'react';
import { useExtractionReviewStore, type ReviewNode } from '../../../graph/store/extraction-review-store';
import { useGraphStore } from '../../../graph/store/graph-store';

interface NodeOption {
  id: string;
  name: string;
  isExisting: boolean;
}

interface AddEdgeFormProps {
  activeNodes: ReviewNode[];
  onClose: () => void;
}

export function AddEdgeForm({ activeNodes, onClose }: AddEdgeFormProps) {
  const addEdge = useExtractionReviewStore((s) => s.addEdge);
  const graphNodes = useGraphStore((s) => s.nodes);

  const options: NodeOption[] = useMemo(() => {
    const reviewOptions: NodeOption[] = activeNodes.map((n) => ({
      id: n.tempId,
      name: n.name,
      isExisting: false,
    }));
    const existingOptions: NodeOption[] = graphNodes.map((n) => ({
      id: n.id,
      name: n.name,
      isExisting: true,
    }));
    return [...reviewOptions, ...existingOptions];
  }, [activeNodes, graphNodes]);

  const [sourceId, setSourceId] = useState(options[0]?.id ?? '');
  const [targetId, setTargetId] = useState(options[1]?.id ?? options[0]?.id ?? '');
  const [label, setLabel] = useState('');

  const handleAdd = () => {
    if (!sourceId || !targetId || !label.trim()) return;
    addEdge(sourceId, targetId, label.trim());
    onClose();
  };

  return (
    <div className="rounded border border-zinc-700 bg-zinc-800/50 p-3 space-y-2">
      <div className="flex gap-2">
        <select
          value={sourceId}
          onChange={(e) => setSourceId(e.target.value)}
          className="flex-1 bg-zinc-800 border border-zinc-700 rounded px-2 py-1 text-xs text-zinc-200 outline-none focus:border-indigo-500"
        >
          <optgroup label="New (extracted)">
            {options.filter((o) => !o.isExisting).map((o) => (
              <option key={o.id} value={o.id}>{o.name}</option>
            ))}
          </optgroup>
          <optgroup label="Existing">
            {options.filter((o) => o.isExisting).map((o) => (
              <option key={o.id} value={o.id}>{o.name}</option>
            ))}
          </optgroup>
        </select>
        <span className="text-zinc-500 text-xs self-center">&rarr;</span>
        <select
          value={targetId}
          onChange={(e) => setTargetId(e.target.value)}
          className="flex-1 bg-zinc-800 border border-zinc-700 rounded px-2 py-1 text-xs text-zinc-200 outline-none focus:border-indigo-500"
        >
          <optgroup label="New (extracted)">
            {options.filter((o) => !o.isExisting).map((o) => (
              <option key={o.id} value={o.id}>{o.name}</option>
            ))}
          </optgroup>
          <optgroup label="Existing">
            {options.filter((o) => o.isExisting).map((o) => (
              <option key={o.id} value={o.id}>{o.name}</option>
            ))}
          </optgroup>
        </select>
      </div>
      <input
        type="text"
        value={label}
        onChange={(e) => setLabel(e.target.value)}
        onKeyDown={(e) => e.key === 'Enter' && handleAdd()}
        placeholder="Relationship label"
        className="w-full bg-zinc-800 border border-zinc-700 rounded px-2 py-1 text-xs text-zinc-200 outline-none focus:border-indigo-500"
        autoFocus
      />
      <div className="flex gap-1 justify-end">
        <button
          onClick={onClose}
          className="text-xs px-2 py-1 bg-zinc-700 text-zinc-300 rounded hover:bg-zinc-600"
        >
          Cancel
        </button>
        <button
          onClick={handleAdd}
          disabled={!label.trim() || !sourceId || !targetId}
          className="text-xs px-2 py-1 bg-indigo-600 text-white rounded hover:bg-indigo-500 disabled:opacity-50 disabled:cursor-not-allowed"
        >
          Add
        </button>
      </div>
    </div>
  );
}
