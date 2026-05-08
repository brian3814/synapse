import { useState, useCallback } from 'react';
import { llm, storage } from '@platform';
import { useGraphStore } from '../../../graph/store/graph-store';
import { entityResolution } from '../../../db/client/db-client';

interface DuplicatePair {
  nameA: string;
  nameB: string;
  idA: string;
  idB: string;
  reason: string;
}

export function DuplicateDetector() {
  const nodes = useGraphStore((s) => s.nodes);
  const [pairs, setPairs] = useState<DuplicatePair[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [expandedIdx, setExpandedIdx] = useState<number | null>(null);

  const entityNodes = nodes.filter((n) => n.type === 'entity');

  const handleDetect = useCallback(async () => {
    if (entityNodes.length < 2) return;
    setLoading(true);
    setError(null);
    setPairs([]);

    try {
      const config = await storage.get('llmConfig') as Record<string, any>;
      const llmConfig = config.llmConfig;
      if (!llmConfig?.apiKey) {
        setError('No API key configured. Go to Settings to add one.');
        setLoading(false);
        return;
      }

      const nodeList = entityNodes
        .map((n) => `- ${n.name}${n.label ? ` (${n.label})` : ''}`)
        .join('\n');

      const systemPrompt = `You analyze knowledge graphs for duplicate entities. You identify pairs that refer to the same real-world thing: acronyms (LLM = Large Language Model), spelling variants (ChatGPT = Chat GPT), alternate names (JS = JavaScript), etc.

Return ONLY a JSON array. Each element: {"nameA": "exact name 1", "nameB": "exact name 2", "reason": "brief explanation"}
Return [] if no duplicates found. Only include pairs you are confident about. Names must exactly match the input list.`;

      const userMessage = `Find duplicate entities in this knowledge graph:\n\n${nodeList}`;

      const result = await llm.streamChat(
        {
          requestId: crypto.randomUUID(),
          model: llmConfig.model,
          systemPrompt,
          messages: [{ role: 'user', content: userMessage }],
        },
        () => {},
      );

      const text = result.textContent;
      const jsonMatch = text.match(/\[[\s\S]*\]/);
      if (!jsonMatch) {
        setPairs([]);
        setLoading(false);
        return;
      }

      const parsed = JSON.parse(jsonMatch[0]) as Array<{ nameA: string; nameB: string; reason: string }>;
      const nodeMap = new Map(entityNodes.map((n) => [n.name.toLowerCase(), n]));

      const resolved: DuplicatePair[] = [];
      for (const p of parsed) {
        const a = nodeMap.get(p.nameA.toLowerCase());
        const b = nodeMap.get(p.nameB.toLowerCase());
        if (a && b && a.id !== b.id) {
          resolved.push({ nameA: a.name, nameB: b.name, idA: a.id, idB: b.id, reason: p.reason });
        }
      }
      setPairs(resolved);
    } catch (e: any) {
      setError(e.message || 'Detection failed');
    }
    setLoading(false);
  }, [entityNodes]);

  const handleMerge = useCallback(async (pair: DuplicatePair) => {
    const store = useGraphStore.getState();
    const nodeA = store.nodes.find((n) => n.id === pair.idA);
    const nodeB = store.nodes.find((n) => n.id === pair.idB);
    if (!nodeA || !nodeB) return;

    const countA = store.edges.filter((e) => e.sourceId === pair.idA || e.targetId === pair.idA).length;
    const countB = store.edges.filter((e) => e.sourceId === pair.idB || e.targetId === pair.idB).length;
    const primary = countA >= countB ? pair.idA : pair.idB;
    const secondary = countA >= countB ? pair.idB : pair.idA;
    const secondaryName = countA >= countB ? pair.nameB : pair.nameA;

    const secondaryEdges = store.edges.filter(
      (e) => e.sourceId === secondary || e.targetId === secondary
    );
    for (const edge of secondaryEdges) {
      const newSource = edge.sourceId === secondary ? primary : edge.sourceId;
      const newTarget = edge.targetId === secondary ? primary : edge.targetId;
      if (newSource === newTarget) continue;
      const exists = store.edges.some(
        (e) => e.sourceId === newSource && e.targetId === newTarget && e.label === edge.label
      );
      if (!exists) {
        await store.createEdge({ sourceId: newSource, targetId: newTarget, label: edge.label, type: edge.type });
      }
    }

    await entityResolution.addAlias(primary, secondaryName);
    await store.deleteNode(secondary);
    setPairs((prev) => prev.filter((p) => p !== pair));
    setExpandedIdx(null);
  }, []);

  const handleDismiss = useCallback((pair: DuplicatePair) => {
    setPairs((prev) => prev.filter((p) => p !== pair));
  }, []);

  if (entityNodes.length < 2) return null;

  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between px-2">
        <h4 className="text-xs font-medium text-zinc-400">Duplicate Entities</h4>
        <button
          onClick={handleDetect}
          disabled={loading}
          className="text-[10px] px-2 py-0.5 rounded border border-zinc-600 text-zinc-400 hover:text-zinc-200 hover:border-zinc-500 transition-colors disabled:opacity-50"
        >
          {loading ? 'Analyzing...' : pairs.length > 0 ? 'Re-scan' : 'Find Duplicates'}
        </button>
      </div>

      {error && (
        <div className="mx-2 text-[10px] text-red-400 bg-red-900/20 rounded px-2 py-1">{error}</div>
      )}

      {loading && (
        <div className="mx-2 text-[10px] text-zinc-500 animate-pulse">Asking LLM to analyze {entityNodes.length} entities...</div>
      )}

      {!loading && pairs.length === 0 && pairs !== null && (
        <div className="mx-2 text-[10px] text-zinc-600">
          {error ? '' : 'Click "Find Duplicates" to scan for entities that may refer to the same thing.'}
        </div>
      )}

      {pairs.map((pair, idx) => (
        <DuplicatePairCard
          key={`${pair.idA}-${pair.idB}`}
          pair={pair}
          expanded={expandedIdx === idx}
          onToggle={() => setExpandedIdx(expandedIdx === idx ? null : idx)}
          onMerge={() => handleMerge(pair)}
          onDismiss={() => handleDismiss(pair)}
        />
      ))}
    </div>
  );
}

function DuplicatePairCard({
  pair, expanded, onToggle, onMerge, onDismiss,
}: {
  pair: DuplicatePair;
  expanded: boolean;
  onToggle: () => void;
  onMerge: () => void;
  onDismiss: () => void;
}) {
  return (
    <div className={`mx-2 rounded border transition-colors ${expanded ? 'border-indigo-600 bg-zinc-800/80' : 'border-zinc-700 bg-zinc-800/40 hover:border-zinc-600'}`}>
      <button onClick={onToggle} className="w-full flex items-center gap-2 px-2 py-1.5 text-left">
        <span className="text-zinc-500 text-[10px]">{expanded ? '▼' : '▶'}</span>
        <span className="text-xs text-zinc-200 truncate flex-1">{pair.nameA}</span>
        <span className="text-zinc-600 text-[10px]">↔</span>
        <span className="text-xs text-zinc-200 truncate flex-1">{pair.nameB}</span>
      </button>

      {expanded && (
        <div className="px-2 pb-2 space-y-2">
          <div className="text-[10px] text-zinc-500 bg-zinc-900/60 rounded px-2 py-1">{pair.reason}</div>
          <div className="flex gap-1 justify-end">
            <button onClick={onDismiss} className="text-[10px] px-2 py-0.5 rounded border border-zinc-600 text-zinc-500 hover:text-zinc-300">Dismiss</button>
            <button onClick={onMerge} className="text-[10px] px-2 py-0.5 rounded bg-indigo-600 text-white">Merge</button>
          </div>
        </div>
      )}
    </div>
  );
}
