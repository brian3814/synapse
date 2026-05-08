import { useState, useEffect, useCallback } from 'react';
import { embedding, storage, platformId } from '@platform';
import type { EmbeddingConfig, EmbeddingStatus } from '../../../embeddings/types';
import { DEFAULT_EMBEDDING_CONFIG } from '../../../embeddings/types';

const STORAGE_KEY = 'embeddingConfig';

export function EmbeddingSettings() {
  const [config, setConfig] = useState<EmbeddingConfig>(DEFAULT_EMBEDDING_CONFIG);
  const [status, setStatus] = useState<EmbeddingStatus | null>(null);
  const [saving, setSaving] = useState(false);
  const [confirmSwitch, setConfirmSwitch] = useState(false);

  useEffect(() => {
    storage.get(STORAGE_KEY).then((result: any) => {
      if (result[STORAGE_KEY]) setConfig({ ...DEFAULT_EMBEDDING_CONFIG, ...result[STORAGE_KEY] });
    }).catch(() => {});
    embedding.getStatus().then(setStatus).catch(() => {});
    const unsub = embedding.onProgress((progress) => {
      setStatus((s) => s ? { ...s, processing: true, progress } : s);
    });
    return unsub;
  }, []);

  const handleSave = useCallback(async (updates: Partial<EmbeddingConfig>) => {
    setSaving(true);
    const newConfig = { ...config, ...updates };
    setConfig(newConfig);
    try {
      await storage.set({ [STORAGE_KEY]: newConfig });
      await embedding.configure(newConfig);
      const newStatus = await embedding.getStatus();
      setStatus(newStatus);
    } catch (e) {
      console.error('Failed to save embedding config:', e);
    }
    setSaving(false);
  }, [config]);

  if (platformId !== 'electron') return null;

  const isProcessing = status?.processing ?? false;

  return (
    <div className="space-y-4">
      <h3 className="text-sm font-semibold text-zinc-200">Embeddings</h3>

      <div className="flex items-center justify-between">
        <div>
          <div className="text-sm text-zinc-300">Enable Semantic Search</div>
          <div className="text-xs text-zinc-500 mt-0.5">
            Find similar nodes, improve search results, and give the chat agent better context — even without exact keyword matches.
          </div>
        </div>
        <button
          onClick={() => handleSave({ enabled: !config.enabled })}
          disabled={saving}
          className={`relative w-10 h-5 rounded-full transition-colors flex-shrink-0 ${config.enabled ? 'bg-indigo-600' : 'bg-zinc-600'}`}
        >
          <span className={`absolute top-0.5 left-0.5 w-4 h-4 rounded-full bg-white transition-transform ${config.enabled ? 'translate-x-5' : ''}`} />
        </button>
      </div>

      {config.enabled && (
        <>
          <div className="space-y-2">
            <div className="text-xs font-medium text-zinc-400 uppercase tracking-wider">Provider</div>

            <label className={`flex items-start gap-2 p-2 rounded border cursor-pointer hover:border-zinc-500 transition-colors ${config.providerId.startsWith('onnx') ? 'border-indigo-600' : 'border-zinc-700'}`}>
              <input type="radio" name="provider" checked={config.providerId.startsWith('onnx')}
                onChange={() => {
                  if (!config.providerId.startsWith('onnx')) setConfirmSwitch(true);
                  else handleSave({ providerId: 'onnx-minilm' });
                }}
                className="mt-1" />
              <div>
                <div className="text-sm text-zinc-200">Local (runs on your computer)</div>
                <div className="text-xs text-zinc-500">No internet needed. Free. Model downloaded on first use.</div>
              </div>
            </label>

            {config.providerId.startsWith('onnx') && (
              <div className="ml-6 space-y-1">
                <label className="flex items-center gap-2 text-xs text-zinc-400 cursor-pointer">
                  <input type="radio" name="quality" checked={config.onnxModelQuality === 'quantized'}
                    onChange={() => handleSave({ onnxModelQuality: 'quantized' })} />
                  <span>Standard (~23MB, ~60MB memory) — Recommended for most users.</span>
                </label>
                <label className="flex items-center gap-2 text-xs text-zinc-400 cursor-pointer">
                  <input type="radio" name="quality" checked={config.onnxModelQuality === 'full'}
                    onChange={() => handleSave({ onnxModelQuality: 'full' })} />
                  <span>Full (~90MB, ~150MB memory) — More accurate for similarly-named nodes.</span>
                </label>
              </div>
            )}

            <label className={`flex items-start gap-2 p-2 rounded border cursor-pointer hover:border-zinc-500 transition-colors ${config.providerId.startsWith('openai') ? 'border-indigo-600' : 'border-zinc-700'}`}>
              <input type="radio" name="provider" checked={config.providerId.startsWith('openai')}
                onChange={() => {
                  if (!config.providerId.startsWith('openai')) setConfirmSwitch(true);
                  else handleSave({ providerId: 'openai-small' });
                }}
                className="mt-1" />
              <div>
                <div className="text-sm text-zinc-200">OpenAI API</div>
                <div className="text-xs text-zinc-500">Higher quality. Requires API key and internet. ~$0.02 per 1M tokens.</div>
              </div>
            </label>

            {config.providerId.startsWith('openai') && (
              <div className="ml-6 space-y-2">
                <input
                  type="password"
                  placeholder="OpenAI API Key"
                  value={config.openaiApiKey ?? ''}
                  onChange={(e) => setConfig({ ...config, openaiApiKey: e.target.value })}
                  onBlur={() => handleSave({ openaiApiKey: config.openaiApiKey })}
                  className="w-full bg-zinc-800 border border-zinc-600 rounded px-2 py-1 text-xs text-zinc-200"
                />
                <select
                  value={config.openaiModel ?? 'text-embedding-3-small'}
                  onChange={(e) => handleSave({ openaiModel: e.target.value })}
                  className="bg-zinc-800 border border-zinc-600 rounded px-2 py-1 text-xs text-zinc-200"
                >
                  <option value="text-embedding-3-small">text-embedding-3-small — Faster, cheaper</option>
                  <option value="text-embedding-3-large">text-embedding-3-large — Best quality</option>
                </select>
              </div>
            )}
          </div>

          <div className="flex items-center gap-2 text-xs">
            <span className={`w-2 h-2 rounded-full ${isProcessing ? 'bg-amber-400 animate-pulse' : status?.embeddedNodes ? 'bg-emerald-400' : 'bg-zinc-500'}`} />
            <span className="text-zinc-400">
              {isProcessing && status?.progress
                ? `Processing... ${status.progress.done}/${status.progress.total} nodes`
                : status?.embeddedNodes
                ? `Ready — ${status.embeddedNodes} nodes embedded`
                : 'Not configured'}
            </span>
          </div>


          <button
            onClick={() => handleSave({ enabled: true })}
            disabled={saving || isProcessing}
            className="text-xs px-3 py-1.5 rounded border border-zinc-600 text-zinc-400 hover:text-zinc-200 hover:border-zinc-500 transition-colors disabled:opacity-50"
          >
            Re-embed all nodes
          </button>
          <div className="text-[10px] text-zinc-600">Recomputes all embeddings. Required after changing provider or model.</div>
        </>
      )}

      {confirmSwitch && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-zinc-800 border border-zinc-600 rounded-lg p-4 max-w-sm">
            <div className="text-sm text-zinc-200 mb-2">Switch embedding provider?</div>
            <div className="text-xs text-zinc-400 mb-4">All existing embeddings will be discarded and recomputed. This may take a few minutes.</div>
            <div className="flex gap-2 justify-end">
              <button onClick={() => setConfirmSwitch(false)} className="text-xs px-3 py-1 rounded border border-zinc-600 text-zinc-400">Cancel</button>
              <button onClick={() => {
                const newProvider = config.providerId.startsWith('onnx') ? 'openai-small' : 'onnx-minilm';
                handleSave({ providerId: newProvider });
                setConfirmSwitch(false);
              }} className="text-xs px-3 py-1 rounded bg-indigo-600 text-white">Switch</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
