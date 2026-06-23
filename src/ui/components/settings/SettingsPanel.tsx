import { useState, useEffect, useCallback, useRef } from 'react';
import { FALLBACK_MODELS, LLM_CONFIG_STORAGE_KEY } from '../../../shared/constants';
import { storage, platformId, notes, vaultWorkspace, llm } from '@platform';
import type { LLMProvider } from '../../../shared/types';
import type { ModelInfo } from '../../../core/model-provider';
import type { UsageRecord } from '../../../service-worker/usage-tracker';
import { useGraphStore } from '../../../graph/store/graph-store';
import { stressTest } from '../../../db/client/db-client';
import { MemorySection } from './MemorySection';
import { EmbeddingSettings } from './EmbeddingSettings';
import { VaultSandboxSection } from './VaultSandboxSection';
import type { SettingsTab } from './SettingsModal';
import { AgentAssignmentsTab } from './AgentAssignmentsTab';

export function SettingsPanel({ activeTab }: { activeTab: SettingsTab }) {
  const [providers, setProviders] = useState<Array<{ id: string; label: string }>>([]);
  const [provider, setProvider] = useState<LLMProvider>('anthropic');
  const [model, setModel] = useState<string>('');
  const [apiKey, setApiKey] = useState('');
  const [saved, setSaved] = useState(false);
  const [showKey, setShowKey] = useState(false);
  const [models, setModels] = useState<ModelInfo[]>([]);
  const [modelsLoading, setModelsLoading] = useState(false);
  const fetchTimerRef = useRef<ReturnType<typeof setTimeout>>(undefined);

  useEffect(() => {
    llm.listProviders().then(setProviders).catch(() => {
      setProviders([{ id: 'anthropic', label: 'Anthropic' }]);
    });

    storage.get([LLM_CONFIG_STORAGE_KEY, 'llmApiKeys']).then((result: Record<string, any>) => {
      const config = result[LLM_CONFIG_STORAGE_KEY];
      const keys = result.llmApiKeys ?? {};
      if (config) {
        setProvider(config.provider ?? 'anthropic');
        setModel(config.model ?? '');
        setApiKey(keys[config.provider ?? 'anthropic'] ?? config.apiKey ?? '');
      }
    }).catch(() => {});
  }, []);

  const fetchModels = useCallback(async (prov: string, key: string) => {
    if (!key || key.length < 10) {
      const fallback = (FALLBACK_MODELS[prov] ?? []).map(m => ({
        ...m, provider: prov, supportsTools: true,
      }));
      setModels(fallback);
      return;
    }
    setModelsLoading(true);
    try {
      const fetched = await llm.listModels(prov, key);
      setModels(fetched);
    } catch {
      const fallback = (FALLBACK_MODELS[prov] ?? []).map(m => ({
        ...m, provider: prov, supportsTools: true,
      }));
      setModels(fallback);
    } finally {
      setModelsLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchModels(provider, apiKey);
  }, [provider]);

  const handleApiKeyChange = (value: string) => {
    setApiKey(value);
    if (fetchTimerRef.current) clearTimeout(fetchTimerRef.current);
    fetchTimerRef.current = setTimeout(() => fetchModels(provider, value), 800);
  };

  const handleSave = async () => {
    try {
      await storage.set({
        [LLM_CONFIG_STORAGE_KEY]: { provider, model, apiKey },
        llmApiKeys: { [provider]: apiKey },
      });
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    } catch (e) {
      console.error('Failed to save settings:', e);
    }
  };

  const handleClearKey = async () => {
    setApiKey('');
    try {
      await storage.set({ llmApiKeys: {} });
      await storage.remove(LLM_CONFIG_STORAGE_KEY);
    } catch {}
    fetchModels(provider, '');
  };

  if (activeTab === 'agents') {
    return <AgentAssignmentsTab />;
  }

  if (activeTab === 'model') {
    return (
      <div className="p-5 space-y-5">
        <div className="space-y-3">
          <h3 className="text-xs font-semibold text-zinc-300 uppercase tracking-wide">LLM Configuration</h3>
          <div>
            <label className="text-xs font-medium text-zinc-400 block mb-1">Provider</label>
            <select
              value={provider}
              onChange={(e) => {
                const p = e.target.value as LLMProvider;
                setProvider(p);
                setModel('');
              }}
              className="w-full bg-zinc-800 border border-zinc-600 rounded px-2 py-1.5 text-sm text-zinc-100 outline-none focus:border-indigo-500"
            >
              {providers.map((p) => (
                <option key={p.id} value={p.id}>{p.label}</option>
              ))}
            </select>
          </div>

          <div>
            <label className="text-xs font-medium text-zinc-400 block mb-1">API Key</label>
            <div className="flex gap-1">
              <input
                type={showKey ? 'text' : 'password'}
                value={apiKey}
                onChange={(e) => handleApiKeyChange(e.target.value)}
                placeholder="Enter API key..."
                className="flex-1 bg-zinc-800 border border-zinc-600 rounded px-2 py-1.5 text-sm text-zinc-100 outline-none focus:border-indigo-500 placeholder-zinc-600"
              />
              <button
                onClick={() => setShowKey(!showKey)}
                className="px-2 py-1 bg-zinc-700 text-zinc-400 rounded text-xs hover:bg-zinc-600"
              >
                {showKey ? 'Hide' : 'Show'}
              </button>
            </div>
          </div>

          <div>
            <label className="text-xs font-medium text-zinc-400 block mb-1">
              Model {modelsLoading && <span className="text-zinc-600 ml-1">loading...</span>}
            </label>
            <select
              value={model}
              onChange={(e) => setModel(e.target.value)}
              className="w-full bg-zinc-800 border border-zinc-600 rounded px-2 py-1.5 text-sm text-zinc-100 outline-none focus:border-indigo-500"
            >
              {models.length === 0 && <option value="">No models available</option>}
              {models.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.label}{m.pricing ? ` ($${m.pricing.inputPer1M}/$${m.pricing.outputPer1M} per 1M)` : ''}
                </option>
              ))}
            </select>
          </div>

          <div className="flex gap-2">
            <button
              onClick={handleSave}
              className="flex-1 bg-indigo-600 text-white text-sm py-1.5 rounded hover:bg-indigo-500 transition-colors"
            >
              {saved ? 'Saved!' : 'Save Settings'}
            </button>
            <button
              onClick={handleClearKey}
              className="px-3 bg-red-900/50 text-red-400 text-sm py-1.5 rounded hover:bg-red-900"
            >
              Clear Key
            </button>
          </div>
        </div>

        <MemorySection />
      </div>
    );
  }

  if (activeTab === 'billing') {
    return (
      <div className="p-5">
        <UsageSection />
      </div>
    );
  }

  if (activeTab === 'about') {
    return (
      <div className="p-5 space-y-4">
        <div>
          <h3 className="text-xs font-semibold text-zinc-300 uppercase tracking-wide mb-3">About</h3>
          <p className="text-sm text-zinc-200 font-medium">Synapse</p>
          <p className="text-xs text-zinc-500 mt-1">Version 0.1.0</p>
        </div>
        <div className="space-y-2">
          <p className="text-xs text-zinc-400">
            Local-first knowledge graph with LLM-powered entity extraction, 2D graph visualization, and markdown notes.
          </p>
          <p className="text-xs text-zinc-500">
            Runs as a Chrome extension and Electron desktop app from the same codebase.
          </p>
          <p className="text-xs text-zinc-600 mt-3">
            API keys are stored locally and never sent to third parties.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="p-5 space-y-0">
      <RelevanceSection />

      {platformId === 'electron' ? <VaultSection /> : <NotesStorageSection />}

      <EmbeddingSettings />

      <ReadingListSettings />

      <ImportBehaviorSection />

      <VaultSandboxSection />

      <StressTest />

      <DangerZone />
    </div>
  );
}

const PATH_LABELS: Record<string, string> = {
  simple: 'Text extractions',
  agent: 'Page extractions',
  chat: 'Chat',
  'reading-list': 'Reading list',
};

function UsageSection() {
  const [records, setRecords] = useState<UsageRecord[]>([]);
  const [budgetDollars, setBudgetDollars] = useState('5.00');
  const [savedBudget, setSavedBudget] = useState(false);
  const [backendShowsCost, setBackendShowsCost] = useState(true);

  useEffect(() => {
    storage.get(['usageRecords', 'usageBudget', 'usageBackendType']).then((result: Record<string, any>) => {
      if (result.usageRecords) setRecords(result.usageRecords);
      if (result.usageBudget?.monthlyLimitCents != null) {
        setBudgetDollars((result.usageBudget.monthlyLimitCents / 100).toFixed(2));
      }
      if (result.usageBackendType === 'managed') setBackendShowsCost(false);
    }).catch(() => {});
  }, []);

  const now = new Date();
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1).getTime();
  const monthRecords = records.filter((r) => r.timestamp >= monthStart);
  const totalCents = monthRecords.reduce((sum, r) => sum + r.costCents, 0);
  const budgetCents = parseFloat(budgetDollars) * 100 || 0;

  // Breakdown by path
  const breakdown = new Map<string, { calls: number; cents: number }>();
  for (const r of monthRecords) {
    const entry = breakdown.get(r.path) ?? { calls: 0, cents: 0 };
    entry.calls += 1;
    entry.cents += r.costCents;
    breakdown.set(r.path, entry);
  }

  const handleSaveBudget = async () => {
    const cents = Math.round(parseFloat(budgetDollars) * 100) || 0;
    try {
      await storage.set({ usageBudget: { monthlyLimitCents: cents } });
      setSavedBudget(true);
      setTimeout(() => setSavedBudget(false), 2000);
    } catch {}
  };

  const progressPct = budgetCents > 0 ? Math.min(100, (totalCents / budgetCents) * 100) : 0;
  const overBudget = budgetCents > 0 && totalCents >= budgetCents;

  return (
    <div>
      <h3 className="text-xs font-semibold text-zinc-300 uppercase tracking-wide mb-3">
        {backendShowsCost ? 'Usage This Month' : 'Token Usage This Month'}
      </h3>

      <div className="space-y-2">
        {backendShowsCost && (
          <div className="flex items-baseline justify-between">
            <span className={`text-sm font-medium ${overBudget ? 'text-red-400' : 'text-zinc-200'}`}>
              ${(totalCents / 100).toFixed(3)}
            </span>
            {budgetCents > 0 && (
              <span className="text-xs text-zinc-500">
                / ${(budgetCents / 100).toFixed(2)} budget
              </span>
            )}
          </div>
        )}

        {backendShowsCost && budgetCents > 0 && (
          <div className="w-full bg-zinc-700 rounded-full h-1.5">
            <div
              className={`h-1.5 rounded-full transition-all ${overBudget ? 'bg-red-500' : 'bg-indigo-500'}`}
              style={{ width: `${progressPct}%` }}
            />
          </div>
        )}

        {breakdown.size > 0 && (
          <div className="space-y-0.5">
            {[...breakdown.entries()].map(([path, { calls, cents }]) => (
              <div key={path} className="flex justify-between text-[10px] text-zinc-500">
                <span>{PATH_LABELS[path] ?? path}: {calls} {calls === 1 ? 'call' : 'calls'}</span>
                {backendShowsCost && <span>${(cents / 100).toFixed(3)}</span>}
              </div>
            ))}
          </div>
        )}

        {backendShowsCost && (
          <>
            <div className="flex gap-1 items-end mt-2">
              <div className="flex-1">
                <label className="text-[10px] text-zinc-500 block mb-0.5">Monthly budget ($)</label>
                <input
                  type="number"
                  step="0.50"
                  min="0"
                  value={budgetDollars}
                  onChange={(e) => setBudgetDollars(e.target.value)}
                  className="w-full bg-zinc-800 border border-zinc-600 rounded px-2 py-1 text-sm text-zinc-100 outline-none focus:border-indigo-500"
                />
              </div>
              <button
                onClick={handleSaveBudget}
                className="px-3 py-1 bg-zinc-700 text-zinc-200 text-xs rounded hover:bg-zinc-600"
              >
                {savedBudget ? 'Saved!' : 'Set'}
              </button>
            </div>
            <p className="text-[10px] text-zinc-600">Set to 0 for unlimited. Extractions are blocked when budget is reached.</p>
          </>
        )}
      </div>
    </div>
  );
}

function RelevanceSection() {
  const [enabled, setEnabled] = useState(true);

  useEffect(() => {
    storage.get('contextualRelevanceEnabled').then((result: Record<string, any>) => {
      if (result.contextualRelevanceEnabled !== undefined) {
        setEnabled(result.contextualRelevanceEnabled);
      }
    }).catch(() => {});
  }, []);

  const handleToggle = async () => {
    const newValue = !enabled;
    setEnabled(newValue);
    try {
      await storage.set({ contextualRelevanceEnabled: newValue });
    } catch {}
  };

  return (
    <div>
      <div className="flex items-center justify-between">
        <div>
          <h4 className="text-xs font-medium text-zinc-400">Contextual Relevance</h4>
          <p className="text-[10px] text-zinc-600 mt-0.5">
            Show related graph nodes while browsing
          </p>
        </div>
        <input
          type="checkbox"
          checked={enabled}
          onChange={handleToggle}
          className="toggle-switch"
        />
      </div>
    </div>
  );
}

function VaultSection() {
  const [status, setStatus] = useState<{ open: boolean; path?: string; name?: string } | null>(null);

  useEffect(() => {
    vaultWorkspace.getStatus().then(setStatus);
  }, []);

  if (!status?.open) return null;

  return (
    <div className="border-t border-zinc-700 pt-4 mt-4">
      <h4 className="text-xs font-medium text-zinc-400 mb-2">Vault</h4>
      <div className="space-y-2">
        <div>
          <p className="text-sm text-zinc-200 font-medium">{status.name}</p>
          <p className="text-xs text-zinc-500 font-mono break-all mt-1">{status.path}</p>
        </div>
      </div>
    </div>
  );
}

function NotesStorageSection() {
  const [currentPath, setCurrentPath] = useState<string>('');
  const [pendingPath, setPendingPath] = useState<string | null>(null);
  const [noteCount, setNoteCount] = useState(0);
  const [moving, setMoving] = useState(false);
  const [result, setResult] = useState<{ moved: number; errors: string[] } | null>(null);

  const electronNotes = notes as any;

  useEffect(() => {
    electronNotes.getStoragePath?.().then((p: string) => setCurrentPath(p));
    notes.list().then((ids: string[]) => setNoteCount(ids.length));
  }, []);

  const handlePickFolder = async () => {
    setResult(null);
    const picked = await electronNotes.pickNewFolder?.();
    if (picked && picked !== currentPath) {
      setPendingPath(picked);
    }
  };

  const handleConfirmMove = async () => {
    if (!pendingPath) return;
    setMoving(true);
    setResult(null);
    try {
      const res = await electronNotes.moveToFolder?.(pendingPath);
      setResult(res);
      setCurrentPath(pendingPath);
      setPendingPath(null);
      const ids = await notes.list();
      setNoteCount(ids.length);
    } catch (e: any) {
      setResult({ moved: 0, errors: [e.message] });
    } finally {
      setMoving(false);
    }
  };

  return (
    <div className="border-t border-zinc-700 pt-4 mt-4">
      <h4 className="text-xs font-medium text-zinc-400 mb-2">Notes Storage</h4>

      <div className="space-y-2">
        <div>
          <p className="text-xs text-zinc-500 mb-1">Location</p>
          <p className="text-xs text-zinc-200 bg-zinc-800 rounded px-2 py-1.5 font-mono break-all border border-zinc-700">
            {currentPath}
          </p>
          <p className="text-[10px] text-zinc-500 mt-1">
            {noteCount} {noteCount === 1 ? 'note' : 'notes'} stored as .md files
          </p>
        </div>

        {!pendingPath ? (
          <button
            onClick={handlePickFolder}
            className="w-full bg-zinc-700 text-zinc-200 text-sm py-1.5 rounded hover:bg-zinc-600 transition-colors"
          >
            Change Location
          </button>
        ) : (
          <div className="space-y-2 bg-amber-950/30 border border-amber-800/40 rounded p-3">
            <p className="text-xs text-amber-300">Move notes to:</p>
            <p className="text-xs text-zinc-200 font-mono break-all">{pendingPath}</p>
            <p className="text-xs text-zinc-400">
              This will move {noteCount} {noteCount === 1 ? 'note' : 'notes'} from the current location to the new folder.
            </p>
            <div className="flex gap-2">
              <button
                onClick={handleConfirmMove}
                disabled={moving}
                className="flex-1 bg-amber-600 text-white text-sm py-1.5 rounded hover:bg-amber-500 transition-colors disabled:opacity-50"
              >
                {moving ? 'Moving...' : 'Move Notes'}
              </button>
              <button
                onClick={() => setPendingPath(null)}
                disabled={moving}
                className="flex-1 bg-zinc-700 text-zinc-300 text-sm py-1.5 rounded hover:bg-zinc-600 transition-colors disabled:opacity-50"
              >
                Cancel
              </button>
            </div>
          </div>
        )}

        {result && (
          <div className={`text-xs ${result.errors.length > 0 ? 'text-amber-400' : 'text-green-400'}`}>
            {result.moved > 0 && <p>Moved {result.moved} {result.moved === 1 ? 'note' : 'notes'} successfully.</p>}
            {result.errors.length > 0 && (
              <div className="mt-1">
                <p className="text-red-400">{result.errors.length} {result.errors.length === 1 ? 'error' : 'errors'}:</p>
                {result.errors.map((e, i) => (
                  <p key={i} className="text-red-400/80 text-[10px] ml-2">{e}</p>
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

function ReadingListSettings() {
  const [cap, setCap] = useState(4);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    storage.get('maxParallelExtractions').then((result: Record<string, any>) => {
      if (result.maxParallelExtractions != null) setCap(result.maxParallelExtractions);
    }).catch(() => {});
  }, []);

  const handleSave = async () => {
    await storage.set({ maxParallelExtractions: cap });
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  };

  return (
    <div className="space-y-3 border-t border-zinc-800 pt-5 mt-5">
      <h3 className="text-xs font-semibold text-zinc-300 uppercase tracking-wide">Reading List</h3>
      <div>
        <label className="text-xs font-medium text-zinc-400 block mb-1">
          Max Parallel Extractions
        </label>
        <div className="flex items-center gap-2">
          <input
            type="number"
            min={1}
            max={10}
            value={cap}
            onChange={(e) => setCap(Math.max(1, Math.min(10, parseInt(e.target.value) || 1)))}
            className="w-20 bg-zinc-800 border border-zinc-600 rounded px-2 py-1.5 text-sm text-zinc-100 outline-none focus:border-indigo-500"
          />
          <button
            onClick={handleSave}
            className="px-3 py-1.5 bg-indigo-600 text-white text-xs rounded hover:bg-indigo-500 transition-colors"
          >
            {saved ? 'Saved!' : 'Save'}
          </button>
        </div>
        <p className="text-[10px] text-zinc-500 mt-1">
          Number of reading list items to extract simultaneously (1-10).
        </p>
      </div>
    </div>
  );
}

function ImportBehaviorSection() {
  const PREF_KEY = 'vault-import-delete-original';
  const [value, setValue] = useState<string>(localStorage.getItem(PREF_KEY) ?? 'ask');

  const handleChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const next = e.target.value;
    setValue(next);
    if (next === 'ask') {
      localStorage.removeItem(PREF_KEY);
    } else {
      localStorage.setItem(PREF_KEY, next);
    }
  };

  return (
    <div className="space-y-3 border-t border-zinc-800 pt-5 mt-5">
      <h3 className="text-xs font-semibold text-zinc-300 uppercase tracking-wide">File Import</h3>
      <div>
        <label className="text-xs font-medium text-zinc-400 block mb-1">
          After importing files
        </label>
        <select
          value={value}
          onChange={handleChange}
          className="bg-zinc-800 border border-zinc-600 rounded px-2 py-1.5 text-sm text-zinc-100 outline-none focus:border-indigo-500 w-48"
        >
          <option value="ask">Ask on import</option>
          <option value="keep">Keep original</option>
          <option value="delete">Delete original</option>
        </select>
        <p className="text-[10px] text-zinc-500 mt-1">
          Controls whether original files are kept or deleted after importing into the vault.
        </p>
      </div>
    </div>
  );
}

function StressTest() {
  const [generating, setGenerating] = useState(false);
  const [result, setResult] = useState<{ nodes: number; edges: number; ms: number } | null>(null);
  const loadAll = useGraphStore((s) => s.loadAll);

  const handleGenerate = async (count: number) => {
    setGenerating(true);
    setResult(null);
    const t0 = performance.now();
    try {
      const res = await stressTest.generate(count);
      const ms = Math.round(performance.now() - t0);
      setResult({ nodes: res.nodes, edges: res.edges, ms });
      await loadAll();
    } catch (e: any) {
      console.error('[StressTest] Failed:', e);
    } finally {
      setGenerating(false);
    }
  };

  return (
    <div className="border-t border-zinc-700 pt-4 mt-4">
      <h4 className="text-xs font-medium text-zinc-400 mb-1">Stress Test</h4>
      <p className="text-[10px] text-zinc-600 mb-2">
        Generate synthetic nodes with hubs, chains, and clusters.
      </p>
      <div className="flex gap-2">
        {[1000, 5000, 10000].map((n) => (
          <button
            key={n}
            onClick={() => handleGenerate(n)}
            disabled={generating}
            className="flex-1 bg-zinc-700 text-zinc-200 text-xs py-1.5 rounded hover:bg-zinc-600 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {generating ? '...' : `${(n / 1000).toFixed(0)}k`}
          </button>
        ))}
      </div>
      {result && (
        <p className="text-[10px] text-zinc-500 mt-2">
          {result.nodes.toLocaleString()} nodes + {result.edges.toLocaleString()} edges in {(result.ms / 1000).toFixed(1)}s
        </p>
      )}
    </div>
  );
}

function DangerZone() {
  const [confirming, setConfirming] = useState(false);
  const clearAll = useGraphStore((s) => s.clearAll);
  const nodeCount = useGraphStore((s) => s.nodes.length);
  const edgeCount = useGraphStore((s) => s.edges.length);

  const handleClearAll = async () => {
    await clearAll();
    setConfirming(false);
  };

  return (
    <div className="border-t border-zinc-700 pt-4 mt-4">
      <h4 className="text-xs font-medium text-red-400 mb-2">Danger Zone</h4>
      {!confirming ? (
        <button
          onClick={() => setConfirming(true)}
          disabled={nodeCount === 0 && edgeCount === 0}
          className="w-full bg-red-900/30 text-red-400 text-sm py-1.5 rounded border border-red-900/50 hover:bg-red-900/50 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
        >
          Clear All Nodes & Edges
        </button>
      ) : (
        <div className="space-y-2">
          <p className="text-xs text-red-400">
            Delete all {nodeCount} nodes and {edgeCount} edges? This cannot be undone.
          </p>
          <div className="flex gap-2">
            <button
              onClick={handleClearAll}
              className="flex-1 bg-red-600 text-white text-sm py-1.5 rounded hover:bg-red-500 transition-colors"
            >
              Confirm Delete
            </button>
            <button
              onClick={() => setConfirming(false)}
              className="flex-1 bg-zinc-700 text-zinc-300 text-sm py-1.5 rounded hover:bg-zinc-600 transition-colors"
            >
              Cancel
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
