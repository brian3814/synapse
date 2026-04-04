import { useLLMStore } from '../../../graph/store/llm-store';
import type { ExtractionResult } from '../../../shared/types';

function formatCost(cents: number): string {
  return `$${(cents / 100).toFixed(cents < 1 ? 4 : 3)}`;
}

interface ExtractionSummaryProps {
  onProceed: () => void;
}

export function ExtractionSummary({ onProceed }: ExtractionSummaryProps) {
  const diff = useLLMStore((s) => s.diff);
  const lastUsage = useLLMStore((s) => s.lastUsage);

  if (!diff) return null;

  const nodes = diff.items.filter((i) => i.type === 'node');
  const edges = diff.items.filter((i) => i.type === 'edge');

  // Group nodes by type
  const nodesByType = new Map<string, string[]>();
  for (const item of nodes) {
    const extracted = item.extracted as ExtractionResult['nodes'][0];
    const type = extracted.type || 'unknown';
    const list = nodesByType.get(type) ?? [];
    list.push(extracted.name);
    nodesByType.set(type, list);
  }

  return (
    <div className="space-y-4">
      <div className="bg-zinc-800 rounded-lg p-4 space-y-3">
        <h4 className="text-sm font-medium text-zinc-200">
          Found {nodes.length} {nodes.length === 1 ? 'entity' : 'entities'} and{' '}
          {edges.length} {edges.length === 1 ? 'relationship' : 'relationships'}
        </h4>

        {nodes.length > 0 && (
          <div className="space-y-1.5">
            <p className="text-xs font-medium text-zinc-400 uppercase tracking-wide">Entities</p>
            {[...nodesByType.entries()].map(([type, labels]) => (
              <div key={type} className="flex gap-2 text-sm">
                <span className="text-indigo-400 shrink-0">{type}:</span>
                <span className="text-zinc-300">{labels.join(', ')}</span>
              </div>
            ))}
          </div>
        )}

        {edges.length > 0 && (
          <div className="space-y-1.5">
            <p className="text-xs font-medium text-zinc-400 uppercase tracking-wide">Relationships</p>
            {edges.map((item, i) => {
              const e = item.extracted as ExtractionResult['edges'][0];
              return (
                <p key={i} className="text-sm text-zinc-300">
                  {e.sourceName} <span className="text-zinc-500">&rarr;</span>{' '}
                  <span className="text-indigo-400">{e.label}</span>{' '}
                  <span className="text-zinc-500">&rarr;</span> {e.targetName}
                </p>
              );
            })}
          </div>
        )}
      </div>

      {lastUsage && (
        <p className="text-[10px] text-zinc-500 text-right">
          {lastUsage.inputTokens.toLocaleString()} input + {lastUsage.outputTokens.toLocaleString()} output tokens · {formatCost(lastUsage.costCents)}
        </p>
      )}

      <button
        onClick={onProceed}
        className="w-full py-2 px-4 bg-indigo-600 text-white text-sm font-medium rounded-lg hover:bg-indigo-500 transition-colors"
      >
        Review &amp; Import &rarr;
      </button>
    </div>
  );
}
