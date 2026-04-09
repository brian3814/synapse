import React, { useState, useEffect, useMemo } from 'react';
import { useLLMStore } from '../../../graph/store/llm-store';
import { estimateExtractionCost } from '../../../shared/cost-estimator';
import type { PageComplexity } from '../../../shared/types';

interface PromptInputProps {
  onSubmit: (prompt: string) => void;
}

const EXTRACTION_NOTES_KEY = 'extractionNotesEnabled';

export function PromptInput({ onSubmit }: PromptInputProps) {
  const [prompt, setPrompt] = useState('');
  const [tabUrl, setTabUrl] = useState<string | null>(null);
  const [configError, setConfigError] = useState<string | null>(null);
  const [model, setModel] = useState<string>('');
  const [budgetExceeded, setBudgetExceeded] = useState(false);
  const [complexity, setComplexity] = useState<PageComplexity | null>(null);
  const [notesEnabled, setNotesEnabled] = useState(false);

  const extractionMode = useLLMStore((s) => s.extractionMode);
  const setExtractionMode = useLLMStore((s) => s.setExtractionMode);

  const suggestedMode = useMemo(() => {
    if (!complexity) return null;
    if (complexity.tableCount > 2 || complexity.wordCount > 5000 || complexity.jsonLdCount > 0) {
      return 'deep' as const;
    }
    return 'quick' as const;
  }, [complexity]);

  const costEstimate = useMemo(() => {
    if (!model) return null;
    if (extractionMode === 'quick') {
      const inputChars = complexity ? complexity.wordCount * 5 : 10_000;
      return estimateExtractionCost({ mode: 'simple', inputChars, model });
    }
    return estimateExtractionCost({ mode: 'agent', inputChars: 10_000, model });
  }, [model, extractionMode, complexity]);

  useEffect(() => {
    chrome.tabs.query({ active: true, currentWindow: true }).then((tabs) => {
      setTabUrl(tabs[0]?.url ?? null);
    });

    chrome.storage.local.get('llmConfig').then((result: Record<string, any>) => {
      const config = result.llmConfig;
      if (!config?.apiKey) {
        setConfigError('No API key configured. Go to Settings to add one.');
      } else if (config.provider !== 'anthropic') {
        setConfigError('Page extraction requires an Anthropic API key.');
      }
      if (config?.model) setModel(config.model);
    });

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

    // Analyze page complexity for auto-suggestion
    chrome.runtime.sendMessage({ type: 'ANALYZE_PAGE' }).then((response: any) => {
      if (response?.complexity) setComplexity(response.complexity);
    }).catch(() => {});

    // Load the notes toggle setting (three-layer model: Phase 4)
    chrome.storage.local.get(EXTRACTION_NOTES_KEY).then((result: Record<string, any>) => {
      setNotesEnabled(Boolean(result[EXTRACTION_NOTES_KEY]));
    }).catch(() => {});
  }, []);

  const toggleNotes = async (next: boolean) => {
    setNotesEnabled(next);
    try {
      await chrome.storage.local.set({ [EXTRACTION_NOTES_KEY]: next });
    } catch {
      // Storage may be unavailable; revert optimistic state.
      setNotesEnabled(!next);
    }
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!prompt.trim() || configError) return;
    onSubmit(prompt.trim());
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-3">
      {tabUrl && (
        <div className="flex items-center gap-1.5 text-xs text-zinc-500 truncate">
          <svg className="w-3 h-3 flex-shrink-0" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M2 4h12v9H2z" />
            <path d="M5 4V2h6v2" />
          </svg>
          <span className="truncate">{tabUrl}</span>
        </div>
      )}

      {/* Quick / Deep mode toggle */}
      <div className="flex gap-1 bg-zinc-800 rounded p-0.5">
        <button
          type="button"
          onClick={() => setExtractionMode('quick')}
          className={`flex-1 text-xs py-1.5 rounded transition-colors ${
            extractionMode === 'quick'
              ? 'bg-zinc-600 text-zinc-100'
              : 'text-zinc-400 hover:text-zinc-200'
          }`}
        >
          Quick
        </button>
        <button
          type="button"
          onClick={() => setExtractionMode('deep')}
          className={`flex-1 text-xs py-1.5 rounded transition-colors ${
            extractionMode === 'deep'
              ? 'bg-zinc-600 text-zinc-100'
              : 'text-zinc-400 hover:text-zinc-200'
          }`}
        >
          Deep
        </button>
      </div>

      {suggestedMode && suggestedMode !== extractionMode && (
        <p className="text-[10px] text-amber-400">
          Suggested: {suggestedMode === 'deep' ? 'Deep Extract (complex page)' : 'Quick Extract (simple page)'}
        </p>
      )}

      {/* Notes toggle (three-layer model: Phase 4). When on, the LLM also
          produces short prose notes attached to entities via about/mention. */}
      <label className="flex items-center gap-2 text-xs text-zinc-400 cursor-pointer select-none">
        <input
          type="checkbox"
          checked={notesEnabled}
          onChange={(e) => toggleNotes(e.target.checked)}
          className="accent-indigo-500"
        />
        <span>Generate notes</span>
        <span className="text-[10px] text-zinc-600">
          {notesEnabled ? '(prose units with wikilinks)' : ''}
        </span>
      </label>

      <div>
        <textarea
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          placeholder="What would you like to extract from this page?"
          className="w-full bg-zinc-800 border border-zinc-600 rounded px-3 py-2 text-sm text-zinc-100 outline-none focus:border-indigo-500 placeholder-zinc-600 min-h-[80px] resize-y"
          autoFocus
        />
      </div>

      {configError && (
        <p className="text-xs text-amber-400">{configError}</p>
      )}

      {budgetExceeded && (
        <p className="text-xs text-red-400">Monthly usage budget exceeded. Adjust in Settings.</p>
      )}

      <button
        type="submit"
        disabled={!prompt.trim() || !!configError || budgetExceeded}
        className="w-full bg-indigo-600 text-white text-sm py-2 rounded hover:bg-indigo-500 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
      >
        {extractionMode === 'deep' ? 'Deep Extract' : 'Quick Extract'}
      </button>

      {costEstimate && !configError && (
        <p className="text-[10px] text-zinc-500 text-center">
          Estimated: {costEstimate.label} · Sending to Anthropic
        </p>
      )}
    </form>
  );
}
