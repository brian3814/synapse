import React, { useState } from 'react';
import { useGraphStore } from '../../../graph/store/graph-store';
import { useNodeTypeStore } from '../../../graph/store/node-type-store';
import { DEFAULT_NODE_TYPE, STRUCTURAL_NODE_TYPES } from '../../../shared/constants';
import { AddTypeModal } from './AddTypeModal';
import { PanelHeader } from '../shared/PanelHeader';
import { tags } from '../../../db/client/db-client';

const STRUCTURAL_SET = new Set<string>(STRUCTURAL_NODE_TYPES);

type CreateTab = 'node' | 'edge';

export function CreatePanel({ onClose }: { onClose?: () => void }) {
  const [tab, setTab] = useState<CreateTab>('node');

  return (
    <div className="p-4">
      <PanelHeader title="Create" />
      <div className="flex gap-1 mb-4 mt-3">
        <button
          onClick={() => setTab('node')}
          className={`text-xs px-3 py-1.5 rounded ${
            tab === 'node'
              ? 'bg-indigo-600 text-white'
              : 'bg-zinc-800 text-zinc-400 hover:text-zinc-200'
          }`}
        >
          New Node
        </button>
        <button
          onClick={() => setTab('edge')}
          className={`text-xs px-3 py-1.5 rounded ${
            tab === 'edge'
              ? 'bg-indigo-600 text-white'
              : 'bg-zinc-800 text-zinc-400 hover:text-zinc-200'
          }`}
        >
          New Edge
        </button>
      </div>

      {tab === 'node' ? <CreateNodeForm /> : <CreateEdgeForm />}
    </div>
  );
}

function CreateNodeForm() {
  const createNode = useGraphStore((s) => s.createNode);
  const allTypes = useNodeTypeStore((s) => s.types);
  const structuralTypes = allTypes.filter((t) => t.category === 'structural');
  const entityLabels = allTypes.filter((t) => t.category === 'entity_label');
  const [name, setName] = useState('');
  const [type, setType] = useState(DEFAULT_NODE_TYPE);
  const [showAddType, setShowAddType] = useState(false);
  const [tagsInput, setTagsInput] = useState('');
  const [error, setError] = useState('');

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');

    if (!name.trim()) {
      setError('Name is required');
      return;
    }

    const isStructural = STRUCTURAL_SET.has(type);
    const input = isStructural
      ? { name: name.trim(), type }
      : { name: name.trim(), type: 'entity', label: type };
    const result = await createNode(input);
    if (result) {
      const tagList = tagsInput
        .split(',')
        .map((t) => t.trim().toLowerCase())
        .filter(Boolean);
      if (tagList.length > 0) {
        await tags.setForNode(result.id, tagList);
      }

      setName('');
      setType(DEFAULT_NODE_TYPE);
      setTagsInput('');
    } else {
      setError('Failed to create node');
    }
  };

  return (
    <>
      <form onSubmit={handleSubmit} className="space-y-3">
        <div>
          <label className="text-xs font-medium text-zinc-400 block mb-1">Name</label>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Enter node name..."
            className="w-full bg-zinc-800 border border-zinc-600 rounded px-2 py-1.5 text-sm text-zinc-100 outline-none focus:border-indigo-500 placeholder-zinc-600"
            autoFocus
          />
        </div>

        <div>
          <div className="flex items-center justify-between mb-1">
            <label className="text-xs font-medium text-zinc-400">Type</label>
            <button
              type="button"
              onClick={() => setShowAddType(true)}
              className="text-[10px] text-indigo-400 hover:text-indigo-300"
            >
              + New type
            </button>
          </div>
          <select
            value={type}
            onChange={(e) => setType(e.target.value)}
            className="w-full bg-zinc-800 border border-zinc-600 rounded px-2 py-1.5 text-sm text-zinc-100 outline-none focus:border-indigo-500"
          >
            {structuralTypes.map((t) => (
              <option key={t.type} value={t.type}>{t.type}</option>
            ))}
            {entityLabels.length > 0 && (
              <optgroup label="Entity Labels">
                {entityLabels.map((t) => (
                  <option key={t.type} value={t.type}>{t.type}</option>
                ))}
              </optgroup>
            )}
          </select>
        </div>

        <div>
          <label className="text-xs font-medium text-zinc-400 block mb-1">Tags</label>
          <input
            value={tagsInput}
            onChange={(e) => setTagsInput(e.target.value)}
            placeholder="Comma-separated tags..."
            className="w-full bg-zinc-800 border border-zinc-600 rounded px-2 py-1.5 text-sm text-zinc-100 outline-none focus:border-indigo-500 placeholder-zinc-600"
          />
          <p className="text-[10px] text-zinc-600 mt-0.5">e.g. important, research, topic-x</p>
        </div>

        {error && <p className="text-xs text-red-400">{error}</p>}

        <button
          type="submit"
          className="w-full bg-indigo-600 text-white text-sm py-1.5 rounded hover:bg-indigo-500 transition-colors"
        >
          Create Node
        </button>
      </form>

      {showAddType && (
        <AddTypeModal
          onClose={() => setShowAddType(false)}
          onCreated={(newType) => {
            setType(newType);
            setShowAddType(false);
          }}
        />
      )}
    </>
  );
}

function CreateEdgeForm() {
  const nodes = useGraphStore((s) => s.nodes);
  const createEdge = useGraphStore((s) => s.createEdge);
  const [sourceId, setSourceId] = useState('');
  const [targetId, setTargetId] = useState('');
  const [label, setLabel] = useState('');
  const [error, setError] = useState('');

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');

    if (!sourceId || !targetId) {
      setError('Source and target nodes are required');
      return;
    }
    if (!label.trim()) {
      setError('Label is required');
      return;
    }

    const result = await createEdge({
      sourceId,
      targetId,
      label: label.trim(),
    });
    if (result) {
      setLabel('');
      setSourceId('');
      setTargetId('');
    } else {
      setError('Failed to create edge');
    }
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-3">
      <div>
        <label className="text-xs font-medium text-zinc-400 block mb-1">Source Node</label>
        <select
          value={sourceId}
          onChange={(e) => setSourceId(e.target.value)}
          className="w-full bg-zinc-800 border border-zinc-600 rounded px-2 py-1.5 text-sm text-zinc-100 outline-none focus:border-indigo-500"
        >
          <option value="">Select source...</option>
          {nodes.map((n) => (
            <option key={n.id} value={n.id}>
              {n.name} ({n.type})
            </option>
          ))}
        </select>
      </div>

      <div>
        <label className="text-xs font-medium text-zinc-400 block mb-1">Target Node</label>
        <select
          value={targetId}
          onChange={(e) => setTargetId(e.target.value)}
          className="w-full bg-zinc-800 border border-zinc-600 rounded px-2 py-1.5 text-sm text-zinc-100 outline-none focus:border-indigo-500"
        >
          <option value="">Select target...</option>
          {nodes.map((n) => (
            <option key={n.id} value={n.id}>
              {n.name} ({n.type})
            </option>
          ))}
        </select>
      </div>

      <div>
        <label className="text-xs font-medium text-zinc-400 block mb-1">Label</label>
        <input
          value={label}
          onChange={(e) => setLabel(e.target.value)}
          placeholder="e.g., works_at, knows, located_in"
          className="w-full bg-zinc-800 border border-zinc-600 rounded px-2 py-1.5 text-sm text-zinc-100 outline-none focus:border-indigo-500 placeholder-zinc-600"
        />
      </div>

      {error && <p className="text-xs text-red-400">{error}</p>}

      <button
        type="submit"
        className="w-full bg-indigo-600 text-white text-sm py-1.5 rounded hover:bg-indigo-500 transition-colors"
      >
        Create Edge
      </button>
    </form>
  );
}
