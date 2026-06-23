import { useState, useEffect } from 'react';
import { createUICommandContext } from '../../../commands/create-context';
import * as memoryCommands from '../../../commands/memory-commands';
import type { MemoryEntry } from '../../../commands/memory-commands';

const CATEGORY_COLORS: Record<string, string> = {
  preference: 'bg-blue-900/40 text-blue-300 border-blue-800/50',
  fact: 'bg-emerald-900/40 text-emerald-300 border-emerald-800/50',
  instruction: 'bg-amber-900/40 text-amber-300 border-amber-800/50',
  episodic: 'bg-purple-900/40 text-purple-300 border-purple-800/50',
};

export function MemorySection() {
  const [memories, setMemories] = useState<MemoryEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [expandedFile, setExpandedFile] = useState<string | null>(null);
  const [editingFile, setEditingFile] = useState<string | null>(null);
  const [editDraft, setEditDraft] = useState({ type: '', description: '', content: '' });
  const [editTagsInput, setEditTagsInput] = useState('');
  const [addingNew, setAddingNew] = useState(false);
  const [newDraft, setNewDraft] = useState({ type: 'fact', name: '', description: '', content: '' });
  const [tagsInput, setTagsInput] = useState('');
  const [clearing, setClearing] = useState(false);

  const refresh = async () => {
    try {
      const ctx = createUICommandContext();
      const all = await memoryCommands.listMemories(ctx);
      setMemories(all);
    } catch {
      setMemories([]);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { refresh(); }, []);

  const handleDelete = async (filename: string) => {
    const ctx = createUICommandContext();
    await memoryCommands.deleteMemory(ctx, filename);
    setMemories((prev) => prev.filter((m) => m.filename !== filename));
  };

  const handleClearAll = async () => {
    const ctx = createUICommandContext();
    for (const m of memories) {
      await memoryCommands.deleteMemory(ctx, m.filename);
    }
    setMemories([]);
    setClearing(false);
  };

  const handleStartEdit = (m: MemoryEntry) => {
    setEditingFile(m.filename);
    setEditDraft({ type: m.type, description: m.description, content: m.content });
    setEditTagsInput(m.tags.join(', '));
  };

  const handleSaveEdit = async () => {
    if (!editingFile) return;
    const ctx = createUICommandContext();
    await memoryCommands.writeMemory(ctx, {
      action: 'update',
      filename: editingFile,
      type: editDraft.type,
      description: editDraft.description,
      content: editDraft.content,
      tags: editTagsInput.split(',').map(t => t.trim()).filter(Boolean),
    });
    setEditingFile(null);
    setEditTagsInput('');
    await refresh();
  };

  const handleCreate = async () => {
    if (!newDraft.name.trim() || !newDraft.content.trim()) return;
    const ctx = createUICommandContext();
    await memoryCommands.writeMemory(ctx, {
      action: 'create',
      type: newDraft.type,
      name: newDraft.name.trim().toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, ''),
      description: newDraft.description.trim() || newDraft.content.trim().slice(0, 80),
      content: newDraft.content.trim(),
      tags: tagsInput.split(',').map(t => t.trim()).filter(Boolean),
    });
    setAddingNew(false);
    setNewDraft({ type: 'fact', name: '', description: '', content: '' });
    setTagsInput('');
    await refresh();
  };

  const grouped = {
    preference: memories.filter((m) => m.type === 'preference'),
    fact: memories.filter((m) => m.type === 'fact'),
    instruction: memories.filter((m) => m.type === 'instruction'),
    episodic: memories.filter((m) => m.type === 'episodic'),
  };

  return (
    <div className="border-t border-zinc-700 pt-4 mt-4">
      <div className="flex items-center justify-between mb-2">
        <h4 className="text-xs font-medium text-zinc-400">Agent Memory</h4>
        <button
          onClick={() => setAddingNew(true)}
          className="text-[10px] text-indigo-400 hover:text-indigo-300"
        >
          + Add
        </button>
      </div>
      <p className="text-[10px] text-zinc-600 mb-3">
        Facts the agent knows about you. Stored as markdown files — editable here or externally.
      </p>

      {addingNew && (
        <div className="mb-3 p-3 bg-zinc-800 rounded border border-zinc-700 space-y-2">
          <div className="flex gap-2">
            <select
              value={newDraft.type}
              onChange={(e) => setNewDraft({ ...newDraft, type: e.target.value })}
              className="bg-zinc-900 border border-zinc-600 rounded px-2 py-1 text-xs text-zinc-100"
            >
              <option value="fact">fact</option>
              <option value="preference">preference</option>
              <option value="instruction">instruction</option>
              <option value="episodic">episodic</option>
            </select>
            <input
              type="text"
              value={newDraft.name}
              onChange={(e) => setNewDraft({ ...newDraft, name: e.target.value })}
              placeholder="name (kebab-case)"
              className="flex-1 bg-zinc-900 border border-zinc-600 rounded px-2 py-1 text-xs text-zinc-100"
            />
          </div>
          <input
            type="text"
            value={newDraft.description}
            onChange={(e) => setNewDraft({ ...newDraft, description: e.target.value })}
            placeholder="One-line description"
            className="w-full bg-zinc-900 border border-zinc-600 rounded px-2 py-1 text-xs text-zinc-100"
          />
          <textarea
            value={newDraft.content}
            onChange={(e) => setNewDraft({ ...newDraft, content: e.target.value })}
            placeholder="Memory content..."
            rows={3}
            className="w-full bg-zinc-900 border border-zinc-600 rounded px-2 py-1 text-xs text-zinc-100 resize-none"
          />
          <div>
            <label className="text-[10px] text-zinc-500 block mb-0.5">Tags (comma-separated)</label>
            <input
              type="text"
              value={tagsInput}
              onChange={(e) => setTagsInput(e.target.value)}
              placeholder="e.g., communication, preferences"
              className="w-full bg-zinc-800 border border-zinc-600 rounded px-2 py-1 text-xs text-zinc-100 outline-none focus:border-indigo-500 placeholder-zinc-600"
            />
          </div>
          <div className="flex gap-2">
            <button onClick={handleCreate} className="flex-1 bg-indigo-600 text-white text-xs py-1 rounded hover:bg-indigo-500">Save</button>
            <button onClick={() => setAddingNew(false)} className="flex-1 bg-zinc-700 text-zinc-300 text-xs py-1 rounded hover:bg-zinc-600">Cancel</button>
          </div>
        </div>
      )}

      {loading ? (
        <p className="text-xs text-zinc-500">Loading...</p>
      ) : memories.length === 0 ? (
        <p className="text-xs text-zinc-500">No memories yet. The agent will learn about you as you chat.</p>
      ) : (
        <div className="space-y-3">
          {(['preference', 'fact', 'instruction', 'episodic'] as const).map((category) => {
            const items = grouped[category];
            if (items.length === 0) return null;
            return (
              <div key={category}>
                <p className="text-[10px] font-medium text-zinc-500 uppercase tracking-wide mb-1">
                  {category}s ({items.length})
                </p>
                <div className="space-y-1">
                  {items.map((m) => (
                    <div key={m.filename}>
                      <div
                        className={`flex items-start justify-between gap-2 px-2 py-1.5 rounded border text-xs ${
                          CATEGORY_COLORS[m.type] ?? 'bg-zinc-800 text-zinc-300 border-zinc-700'
                        }`}
                      >
                        <button
                          onClick={() => setExpandedFile(expandedFile === m.filename ? null : m.filename)}
                          className="flex-1 min-w-0 text-left"
                        >
                          {m.description || m.content.slice(0, 60)}
                          {!m.valid && (
                            <span className="text-[9px] text-zinc-600 italic ml-2">superseded</span>
                          )}
                        </button>
                        <div className="flex gap-1 shrink-0">
                          <button
                            onClick={() => handleStartEdit(m)}
                            className="p-0.5 opacity-50 hover:opacity-100"
                            title="Edit"
                          >
                            <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                              <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />
                              <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" />
                            </svg>
                          </button>
                          <button
                            onClick={() => handleDelete(m.filename)}
                            className="p-0.5 opacity-50 hover:opacity-100"
                            title="Delete"
                          >
                            <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                              <path d="M18 6 6 18M6 6l12 12" />
                            </svg>
                          </button>
                        </div>
                      </div>
                      {m.tags.length > 0 && (
                        <div className="flex flex-wrap gap-1 mt-1">
                          {m.tags.map((tag) => (
                            <span key={tag} className="text-[9px] bg-zinc-700 text-zinc-400 rounded px-1 py-0.5">{tag}</span>
                          ))}
                        </div>
                      )}

                      {expandedFile === m.filename && editingFile !== m.filename && (
                        <div className="mt-1 px-2 py-1.5 bg-zinc-900 rounded text-[10px] text-zinc-400 whitespace-pre-wrap">
                          {m.content}
                        </div>
                      )}

                      {editingFile === m.filename && (
                        <div className="mt-1 p-2 bg-zinc-800 rounded border border-zinc-600 space-y-2">
                          <select
                            value={editDraft.type}
                            onChange={(e) => setEditDraft({ ...editDraft, type: e.target.value })}
                            className="bg-zinc-900 border border-zinc-600 rounded px-2 py-1 text-xs text-zinc-100"
                          >
                            <option value="fact">fact</option>
                            <option value="preference">preference</option>
                            <option value="instruction">instruction</option>
                            <option value="episodic">episodic</option>
                          </select>
                          <input
                            type="text"
                            value={editDraft.description}
                            onChange={(e) => setEditDraft({ ...editDraft, description: e.target.value })}
                            className="w-full bg-zinc-900 border border-zinc-600 rounded px-2 py-1 text-xs text-zinc-100"
                          />
                          <textarea
                            value={editDraft.content}
                            onChange={(e) => setEditDraft({ ...editDraft, content: e.target.value })}
                            rows={3}
                            className="w-full bg-zinc-900 border border-zinc-600 rounded px-2 py-1 text-xs text-zinc-100 resize-none"
                          />
                          <div>
                            <label className="text-[10px] text-zinc-500 block mb-0.5">Tags (comma-separated)</label>
                            <input
                              type="text"
                              value={editTagsInput}
                              onChange={(e) => setEditTagsInput(e.target.value)}
                              placeholder="e.g., communication, preferences"
                              className="w-full bg-zinc-800 border border-zinc-600 rounded px-2 py-1 text-xs text-zinc-100 outline-none focus:border-indigo-500 placeholder-zinc-600"
                            />
                          </div>
                          <div className="flex gap-2">
                            <button onClick={handleSaveEdit} className="flex-1 bg-indigo-600 text-white text-xs py-1 rounded hover:bg-indigo-500">Save</button>
                            <button onClick={() => setEditingFile(null)} className="flex-1 bg-zinc-700 text-zinc-300 text-xs py-1 rounded hover:bg-zinc-600">Cancel</button>
                          </div>
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            );
          })}

          {!clearing ? (
            <button onClick={() => setClearing(true)} className="text-[10px] text-red-400/60 hover:text-red-400">
              Clear all memories
            </button>
          ) : (
            <div className="flex gap-2 items-center">
              <span className="text-[10px] text-red-400">Delete all {memories.length} memories?</span>
              <button onClick={handleClearAll} className="text-[10px] px-2 py-0.5 bg-red-600 text-white rounded hover:bg-red-500">Confirm</button>
              <button onClick={() => setClearing(false)} className="text-[10px] px-2 py-0.5 bg-zinc-700 text-zinc-300 rounded hover:bg-zinc-600">Cancel</button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
