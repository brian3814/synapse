import React, { useState, useEffect, useMemo } from 'react';
import { estimateExtractionCost } from '../../../shared/cost-estimator';

interface TextInputProps {
  onSubmit: (text: string, sourceUrl?: string) => void;
}

export function TextInput({ onSubmit }: TextInputProps) {
  const [text, setText] = useState('');
  const [sourceUrl, setSourceUrl] = useState('');
  const [model, setModel] = useState<string>('');
  const [budgetExceeded, setBudgetExceeded] = useState(false);

  useEffect(() => {
    chrome.storage.local.get('llmConfig').then((result: Record<string, any>) => {
      if (result.llmConfig?.model) setModel(result.llmConfig.model);
    }).catch(() => {});

    chrome.storage.local.get(['usageRecords', 'usageBudget']).then((result: Record<string, any>) => {
      const budget = result.usageBudget;
      if (!budget?.monthlyLimitCents || budget.monthlyLimitCents <= 0) return;
      const records = result.usageRecords ?? [];
      const now = new Date();
      const monthStart = new Date(now.getFullYear(), now.getMonth(), 1).getTime();
      const totalCents = records
        .filter((r: any) => r.timestamp >= monthStart)
        .reduce((sum: number, r: any) => sum + (r.costCents ?? 0), 0);
      if (totalCents >= budget.monthlyLimitCents) setBudgetExceeded(true);
    }).catch(() => {});
  }, []);

  const costEstimate = useMemo(() => {
    if (!model || text.length < 10) return null;
    return estimateExtractionCost({ mode: 'simple', inputChars: text.length, model });
  }, [model, text.length]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!text.trim()) return;
    onSubmit(text.trim(), sourceUrl.trim() || undefined);
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-3">
      <div>
        <label className="text-xs font-medium text-zinc-400 block mb-1">
          Text to extract from
        </label>
        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="Paste text here to extract entities and relationships..."
          className="w-full bg-zinc-800 border border-zinc-600 rounded px-3 py-2 text-sm text-zinc-100 outline-none focus:border-indigo-500 placeholder-zinc-600 min-h-[120px] resize-y"
          autoFocus
        />
      </div>

      <div>
        <label className="text-xs font-medium text-zinc-400 block mb-1">
          Source URL (optional)
        </label>
        <input
          value={sourceUrl}
          onChange={(e) => setSourceUrl(e.target.value)}
          placeholder="https://..."
          className="w-full bg-zinc-800 border border-zinc-600 rounded px-2 py-1.5 text-sm text-zinc-100 outline-none focus:border-indigo-500 placeholder-zinc-600"
        />
      </div>

      {budgetExceeded && (
        <p className="text-xs text-red-400">Monthly usage budget exceeded. Adjust in Settings.</p>
      )}

      <button
        type="submit"
        disabled={!text.trim() || budgetExceeded}
        className="w-full bg-indigo-600 text-white text-sm py-2 rounded hover:bg-indigo-500 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
      >
        Extract Entities
      </button>

      {costEstimate && (
        <p className="text-[10px] text-zinc-500 text-center">
          Estimated: {costEstimate.label} · Sending to Anthropic
        </p>
      )}
    </form>
  );
}
