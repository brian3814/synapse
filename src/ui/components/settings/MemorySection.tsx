import { useState, useEffect } from 'react';
import { memory } from '../../../db/client/db-client';

interface SemanticMemory {
  id: string;
  category: string;
  content: string;
  created_at: string;
  updated_at: string;
}

const CATEGORY_COLORS: Record<string, string> = {
  preference: 'bg-blue-900/40 text-blue-300 border-blue-800/50',
  fact: 'bg-emerald-900/40 text-emerald-300 border-emerald-800/50',
  instruction: 'bg-amber-900/40 text-amber-300 border-amber-800/50',
};

export function MemorySection() {
  const [memories, setMemories] = useState<SemanticMemory[]>([]);
  const [loading, setLoading] = useState(true);
  const [clearing, setClearing] = useState(false);

  const refresh = async () => {
    try {
      const all = await memory.getAllSemantic() as SemanticMemory[];
      setMemories(all);
    } catch {
      setMemories([]);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { refresh(); }, []);

  const handleDelete = async (id: string) => {
    await memory.deleteSemantic(id);
    setMemories((prev) => prev.filter((m) => m.id !== id));
  };

  const handleClearAll = async () => {
    await memory.clearAllSemantic();
    await memory.clearAllEpisodic();
    setMemories([]);
    setClearing(false);
  };

  const grouped = {
    preference: memories.filter((m) => m.category === 'preference'),
    fact: memories.filter((m) => m.category === 'fact'),
    instruction: memories.filter((m) => m.category === 'instruction'),
  };

  return (
    <div className="border-t border-zinc-700 pt-4 mt-4">
      <h4 className="text-xs font-medium text-zinc-400 mb-2">Agent Memory</h4>
      <p className="text-[10px] text-zinc-600 mb-3">
        Facts the agent has learned about you from conversations. These are included in every chat session.
      </p>

      {loading ? (
        <p className="text-xs text-zinc-500">Loading...</p>
      ) : memories.length === 0 ? (
        <p className="text-xs text-zinc-500">No memories yet. The agent will learn about you as you chat.</p>
      ) : (
        <div className="space-y-3">
          {(['preference', 'fact', 'instruction'] as const).map((category) => {
            const items = grouped[category];
            if (items.length === 0) return null;
            return (
              <div key={category}>
                <p className="text-[10px] font-medium text-zinc-500 uppercase tracking-wide mb-1">
                  {category}s ({items.length})
                </p>
                <div className="space-y-1">
                  {items.map((m) => (
                    <div
                      key={m.id}
                      className={`flex items-start justify-between gap-2 px-2 py-1.5 rounded border text-xs ${
                        CATEGORY_COLORS[m.category] ?? 'bg-zinc-800 text-zinc-300 border-zinc-700'
                      }`}
                    >
                      <span className="flex-1 min-w-0">{m.content}</span>
                      <button
                        onClick={() => handleDelete(m.id)}
                        className="shrink-0 p-0.5 opacity-50 hover:opacity-100 transition-opacity"
                        title="Delete memory"
                      >
                        <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                          <path d="M18 6 6 18M6 6l12 12" />
                        </svg>
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            );
          })}

          {!clearing ? (
            <button
              onClick={() => setClearing(true)}
              className="text-[10px] text-red-400/60 hover:text-red-400 transition-colors"
            >
              Clear all memories
            </button>
          ) : (
            <div className="flex gap-2 items-center">
              <span className="text-[10px] text-red-400">Delete all {memories.length} memories?</span>
              <button
                onClick={handleClearAll}
                className="text-[10px] px-2 py-0.5 bg-red-600 text-white rounded hover:bg-red-500"
              >
                Confirm
              </button>
              <button
                onClick={() => setClearing(false)}
                className="text-[10px] px-2 py-0.5 bg-zinc-700 text-zinc-300 rounded hover:bg-zinc-600"
              >
                Cancel
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
