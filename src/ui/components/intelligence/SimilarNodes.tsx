import { useState, useEffect, useCallback } from 'react';
import { embedding, platformId } from '@platform';
import type { SimilarPair } from '../../../embeddings/types';
import { useGraphStore } from '../../../graph/store/graph-store';
import { entityResolution } from '../../../db/client/db-client';

export function SimilarNodes() {
  const [pairs, setPairs] = useState<SimilarPair[]>([]);
  const [loading, setLoading] = useState(false);
  const [expandedIdx, setExpandedIdx] = useState<number | null>(null);

  useEffect(() => {
    if (platformId !== 'electron') return;
    setLoading(true);
    embedding.findDuplicatePairs().then(setPairs).catch(() => {}).finally(() => setLoading(false));
  }, []);

  const handleMerge = useCallback(async (pair: SimilarPair, swapped: boolean) => {
    const primary = swapped ? pair.nodeB : pair.nodeA;
    const secondary = swapped ? pair.nodeA : pair.nodeB;
    const store = useGraphStore.getState();

    const secondaryEdges = store.edges.filter(
      (e) => e.sourceId === secondary.id || e.targetId === secondary.id
    );
    for (const edge of secondaryEdges) {
      const newSource = edge.sourceId === secondary.id ? primary.id : edge.sourceId;
      const newTarget = edge.targetId === secondary.id ? primary.id : edge.targetId;
      if (newSource === newTarget) continue;
      const exists = store.edges.some(
        (e) => e.sourceId === newSource && e.targetId === newTarget && e.label === edge.label
      );
      if (!exists) {
        await store.createEdge({ sourceId: newSource, targetId: newTarget, label: edge.label, type: edge.type });
      }
    }

    await entityResolution.addAlias(primary.id, secondary.name);
    await store.deleteNode(secondary.id);
    setPairs((prev) => prev.filter((p) => p !== pair));
    setExpandedIdx(null);
  }, []);

  const handleDismiss = useCallback(async (pair: SimilarPair) => {
    await embedding.dismissPair(pair.nodeA.id, pair.nodeB.id);
    setPairs((prev) => prev.filter((p) => p !== pair));
  }, []);

  if (platformId !== 'electron') return null;
  if (loading) return <div className="text-xs text-zinc-500 px-2 py-1">Loading similar nodes...</div>;
  if (pairs.length === 0) return null;

  return (
    <div className="space-y-1">
      <h4 className="text-xs font-medium text-zinc-400 px-2">Similar Nodes ({pairs.length})</h4>
      {pairs.map((pair, idx) => (
        <SimilarPairCard
          key={`${pair.nodeA.id}-${pair.nodeB.id}`}
          pair={pair}
          expanded={expandedIdx === idx}
          onToggle={() => setExpandedIdx(expandedIdx === idx ? null : idx)}
          onMerge={(swapped) => handleMerge(pair, swapped)}
          onDismiss={() => handleDismiss(pair)}
        />
      ))}
    </div>
  );
}

function SimilarPairCard({
  pair, expanded, onToggle, onMerge, onDismiss,
}: {
  pair: SimilarPair;
  expanded: boolean;
  onToggle: () => void;
  onMerge: (swapped: boolean) => void;
  onDismiss: () => void;
}) {
  const [swapped, setSwapped] = useState(false);
  const pct = Math.round(pair.similarity * 100);

  return (
    <div className={`mx-2 rounded border transition-colors ${expanded ? 'border-indigo-600 bg-zinc-800/80' : 'border-zinc-700 bg-zinc-800/40 hover:border-zinc-600'}`}>
      <button onClick={onToggle} className="w-full flex items-center gap-2 px-2 py-1.5 text-left">
        <span className="text-zinc-500 text-[10px]">{expanded ? '▼' : '▶'}</span>
        <span className="text-xs text-zinc-200 truncate flex-1">{pair.nodeA.name}</span>
        <span className="text-zinc-600 text-[10px]">↔</span>
        <span className="text-xs text-zinc-200 truncate flex-1">{pair.nodeB.name}</span>
        <span className="text-[10px] text-zinc-500 flex-shrink-0">{pct}%</span>
      </button>

      {expanded && (
        <div className="px-2 pb-2 space-y-2">
          <div className="flex gap-2">
            <NodeDetail node={swapped ? pair.nodeB : pair.nodeA} role="Primary (keep)" roleColor="text-indigo-400" />
            <NodeDetail node={swapped ? pair.nodeA : pair.nodeB} role="Secondary (merge in)" roleColor="text-red-400" />
          </div>
          <div className="flex gap-1 justify-end">
            <button onClick={onDismiss} className="text-[10px] px-2 py-0.5 rounded border border-zinc-600 text-zinc-500 hover:text-zinc-300">Dismiss</button>
            <button onClick={() => setSwapped(!swapped)} className="text-[10px] px-2 py-0.5 rounded border border-zinc-600 text-zinc-500 hover:text-zinc-300">Swap</button>
            <button onClick={() => onMerge(swapped)} className="text-[10px] px-2 py-0.5 rounded bg-indigo-600 text-white">Merge</button>
          </div>
        </div>
      )}
    </div>
  );
}

function NodeDetail({ node, role, roleColor }: { node: SimilarPair['nodeA']; role: string; roleColor: string }) {
  return (
    <div className="flex-1 bg-zinc-900/60 rounded p-1.5">
      <div className={`text-[9px] uppercase ${roleColor} mb-0.5`}>{role}</div>
      <div className="text-xs text-zinc-200 truncate">{node.name}</div>
      <div className="text-[10px] text-zinc-500">{node.type}{node.label ? ` · ${node.label}` : ''} · {node.connectionCount} connections</div>
      {node.summary && <div className="text-[10px] text-zinc-600 mt-0.5 line-clamp-2">{node.summary}</div>}
    </div>
  );
}
