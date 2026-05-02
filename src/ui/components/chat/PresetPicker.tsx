import { useState, useEffect, useRef } from 'react';
import { storage } from '@platform';

interface Preset {
  id: string;
  name: string;
  prompt: string;
  createdAt: number;
}

export function PresetPicker() {
  const [presets, setPresets] = useState<Preset[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState('');
  const [newPrompt, setNewPrompt] = useState('');
  const dropdownRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    storage.get(['harnessPresets', 'harnessActivePresetId']).then((result: Record<string, any>) => {
      if (result.harnessPresets) setPresets(result.harnessPresets);
      if (result.harnessActivePresetId) setActiveId(result.harnessActivePresetId);
    }).catch(() => {});
  }, []);

  useEffect(() => {
    if (!open) return;
    const handleClick = (e: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setOpen(false);
        setCreating(false);
      }
    };
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, [open]);

  const activeName = activeId ? presets.find((p) => p.id === activeId)?.name : null;

  const selectPreset = async (id: string | null) => {
    setActiveId(id);
    setOpen(false);
    try {
      await storage.set({ harnessActivePresetId: id });
    } catch {}
  };

  const createPreset = async () => {
    if (!newName.trim() || !newPrompt.trim()) return;
    const preset: Preset = {
      id: crypto.randomUUID(),
      name: newName.trim(),
      prompt: newPrompt.trim(),
      createdAt: Date.now(),
    };
    const updated = [...presets, preset];
    setPresets(updated);
    setActiveId(preset.id);
    setCreating(false);
    setNewName('');
    setNewPrompt('');
    try {
      await storage.set({ harnessPresets: updated, harnessActivePresetId: preset.id });
    } catch {}
  };

  const deletePreset = async (id: string) => {
    const updated = presets.filter((p) => p.id !== id);
    setPresets(updated);
    if (activeId === id) {
      setActiveId(null);
      await storage.set({ harnessPresets: updated, harnessActivePresetId: null }).catch(() => {});
    } else {
      await storage.set({ harnessPresets: updated }).catch(() => {});
    }
  };

  return (
    <div className="relative" ref={dropdownRef}>
      <button
        onClick={() => setOpen(!open)}
        className="flex items-center gap-1 px-2 py-0.5 text-[10px] rounded border border-zinc-700 text-zinc-400 hover:text-zinc-200 hover:border-zinc-500 transition-colors"
        title="Select session preset"
      >
        <span>{activeName ?? 'Default'}</span>
        <svg width="8" height="8" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round">
          <path d="M6 9l6 6 6-6" />
        </svg>
      </button>

      {open && (
        <div className="absolute top-full left-0 mt-1 w-64 bg-zinc-800 border border-zinc-700 rounded-lg shadow-xl z-50 overflow-hidden">
          <button
            onClick={() => selectPreset(null)}
            className={`w-full text-left px-3 py-2 text-xs transition-colors ${
              !activeId ? 'bg-indigo-600/20 text-indigo-300' : 'text-zinc-300 hover:bg-zinc-700'
            }`}
          >
            Default
          </button>

          {presets.map((p) => (
            <div
              key={p.id}
              className={`flex items-center justify-between px-3 py-2 transition-colors ${
                activeId === p.id ? 'bg-indigo-600/20' : 'hover:bg-zinc-700'
              }`}
            >
              <button
                onClick={() => selectPreset(p.id)}
                className={`text-xs text-left flex-1 truncate ${
                  activeId === p.id ? 'text-indigo-300' : 'text-zinc-300'
                }`}
              >
                {p.name}
              </button>
              <button
                onClick={() => deletePreset(p.id)}
                className="text-zinc-500 hover:text-red-400 ml-2 p-0.5"
                title="Delete preset"
              >
                <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                  <path d="M18 6 6 18M6 6l12 12" />
                </svg>
              </button>
            </div>
          ))}

          {creating ? (
            <div className="p-3 border-t border-zinc-700 space-y-2">
              <input
                type="text"
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                placeholder="Preset name"
                className="w-full bg-zinc-900 border border-zinc-600 rounded px-2 py-1 text-xs text-zinc-100 outline-none focus:border-indigo-500"
                autoFocus
              />
              <textarea
                value={newPrompt}
                onChange={(e) => setNewPrompt(e.target.value)}
                placeholder="Instructions for this mode..."
                rows={3}
                className="w-full bg-zinc-900 border border-zinc-600 rounded px-2 py-1 text-xs text-zinc-100 outline-none focus:border-indigo-500 resize-none"
              />
              <div className="flex gap-2">
                <button
                  onClick={createPreset}
                  disabled={!newName.trim() || !newPrompt.trim()}
                  className="flex-1 bg-indigo-600 text-white text-xs py-1 rounded hover:bg-indigo-500 disabled:opacity-40"
                >
                  Save
                </button>
                <button
                  onClick={() => { setCreating(false); setNewName(''); setNewPrompt(''); }}
                  className="flex-1 bg-zinc-700 text-zinc-300 text-xs py-1 rounded hover:bg-zinc-600"
                >
                  Cancel
                </button>
              </div>
            </div>
          ) : (
            <button
              onClick={() => setCreating(true)}
              className="w-full text-left px-3 py-2 text-xs text-indigo-400 hover:bg-zinc-700 border-t border-zinc-700 transition-colors"
            >
              + New preset
            </button>
          )}
        </div>
      )}
    </div>
  );
}
