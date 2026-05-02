import { useState, useEffect } from 'react';
import { storage } from '@platform';

export function CustomInstructionsSection() {
  const [instructions, setInstructions] = useState('');
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    storage.get('harnessGlobalInstructions').then((result: Record<string, any>) => {
      if (result.harnessGlobalInstructions) {
        setInstructions(result.harnessGlobalInstructions);
      }
    }).catch(() => {});
  }, []);

  const handleSave = async () => {
    try {
      await storage.set({ harnessGlobalInstructions: instructions });
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    } catch (e) {
      console.error('Failed to save custom instructions:', e);
    }
  };

  return (
    <div className="border-t border-zinc-700 pt-4 mt-4">
      <h4 className="text-xs font-medium text-zinc-400 mb-2">Custom Instructions</h4>
      <p className="text-[10px] text-zinc-600 mb-2">
        These instructions apply to every chat session. Tell the agent about your preferences, role, or how you want responses formatted.
      </p>
      <textarea
        value={instructions}
        onChange={(e) => setInstructions(e.target.value)}
        placeholder="e.g., I'm a researcher in AI safety. Always cite sources. Respond in bullet points."
        rows={4}
        className="w-full bg-zinc-800 border border-zinc-600 rounded px-2 py-1.5 text-sm text-zinc-100 outline-none focus:border-indigo-500 placeholder-zinc-600 resize-y"
      />
      <button
        onClick={handleSave}
        className="mt-2 w-full bg-indigo-600 text-white text-sm py-1.5 rounded hover:bg-indigo-500 transition-colors"
      >
        {saved ? 'Saved!' : 'Save Instructions'}
      </button>
    </div>
  );
}
