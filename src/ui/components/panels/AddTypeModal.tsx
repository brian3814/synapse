import React, { useState } from 'react';
import { useNodeTypeStore } from '../../../graph/store/node-type-store';

interface AddTypeModalProps {
  onClose: () => void;
  onCreated: (type: string) => void;
}

export function AddTypeModal({ onClose, onCreated }: AddTypeModalProps) {
  const types = useNodeTypeStore((s) => s.types);
  const createType = useNodeTypeStore((s) => s.createType);
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');

    const normalized = name.trim().toLowerCase();
    if (!normalized) {
      setError('Name is required');
      return;
    }
    if (!/^[a-z][a-z0-9_-]{0,49}$/.test(normalized)) {
      setError('Lowercase letters, numbers, hyphens, underscores only (max 50 chars)');
      return;
    }
    // Prevent collision with structural types — those are reserved.
    if (['resource', 'entity', 'note'].includes(normalized)) {
      setError('Reserved structural type — pick a different label');
      return;
    }
    if (types.some((t) => t.type === normalized)) {
      setError('Label already exists');
      return;
    }

    setSubmitting(true);
    const result = await createType({
      type: normalized,
      description: description.trim() || undefined,
      category: 'entity_label',
    });
    setSubmitting(false);

    if (result) {
      onCreated(result.type);
      onClose();
    } else {
      setError('Failed to create label');
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50" onClick={onClose}>
      <div
        className="bg-zinc-900 border border-zinc-700 rounded-lg p-4 w-72 shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <h3 className="text-sm font-semibold text-zinc-100 mb-3">Add Entity Label</h3>
        <p className="text-xs text-zinc-500 mb-3">
          Entity labels categorize nodes semantically (concept, person, technology, ...).
          Structural types (resource / entity / note) are fixed.
        </p>
        <form onSubmit={handleSubmit} className="space-y-3">
          <div>
            <label className="text-xs font-medium text-zinc-400 block mb-1">Label</label>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. paper, dataset, framework"
              className="w-full bg-zinc-800 border border-zinc-600 rounded px-2 py-1.5 text-sm text-zinc-100 outline-none focus:border-indigo-500 placeholder-zinc-600"
              autoFocus
            />
          </div>
          <div>
            <label className="text-xs font-medium text-zinc-400 block mb-1">Description (optional)</label>
            <input
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="A short description..."
              className="w-full bg-zinc-800 border border-zinc-600 rounded px-2 py-1.5 text-sm text-zinc-100 outline-none focus:border-indigo-500 placeholder-zinc-600"
            />
          </div>

          {error && <p className="text-xs text-red-400">{error}</p>}

          <div className="flex gap-2">
            <button
              type="button"
              onClick={onClose}
              className="flex-1 text-sm py-1.5 rounded bg-zinc-700 text-zinc-300 hover:bg-zinc-600"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={submitting}
              className="flex-1 text-sm py-1.5 rounded bg-indigo-600 text-white hover:bg-indigo-500 disabled:opacity-50"
            >
              Create
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
