import { useState, useEffect, useRef } from 'react';
import { embedding, platformId } from '@platform';
import { useChatContextStore } from '../../../graph/store/chat-context-store';
import { useGraphStore } from '../../../graph/store/graph-store';
import { useNodeTypeStore } from '../../../graph/store/node-type-store';
import type { SemanticSearchResult } from '../../../embeddings/types';

export function ContextSuggestions() {
  const attachedNodes = useChatContextStore((s) => s.attachedNodes);
  const addNodes = useChatContextStore((s) => s.addNodes);
  const graphNodes = useGraphStore((s) => s.nodes);
  const getColorForType = useNodeTypeStore((s) => s.getColorForType);
  const [suggestions, setSuggestions] = useState<Array<{ id: string; name: string; type: string; score: number }>>([]);
  const [expanded, setExpanded] = useState(false);
  const requestIdRef = useRef(0);

  useEffect(() => {
    if (platformId !== 'electron' || attachedNodes.length === 0) {
      setSuggestions([]);
      return;
    }

    const id = ++requestIdRef.current;
    const attachedIds = new Set(attachedNodes.map((n) => n.id));

    (async () => {
      const allResults: SemanticSearchResult[] = [];
      for (const node of attachedNodes) {
        try {
          const results = await embedding.searchSimilarByNodeId(node.id, 3);
          allResults.push(...results.filter((r) => !attachedIds.has(r.nodeId)));
        } catch {}
      }

      if (requestIdRef.current !== id) return;

      const seen = new Set<string>();
      const deduped: Array<{ id: string; name: string; type: string; score: number }> = [];
      for (const r of allResults.sort((a, b) => b.score - a.score)) {
        if (seen.has(r.nodeId) || attachedIds.has(r.nodeId)) continue;
        seen.add(r.nodeId);
        const node = graphNodes.find((n) => n.id === r.nodeId);
        if (node) deduped.push({ id: node.id, name: node.name, type: node.type, score: r.score });
        if (deduped.length >= 5) break;
      }
      setSuggestions(deduped);
      setExpanded(false);
    })();
  }, [attachedNodes, graphNodes]);

  if (suggestions.length === 0) return null;

  return (
    <div className="flex items-center gap-1 px-2">
      {!expanded ? (
        <button
          onClick={() => setExpanded(true)}
          className="text-[10px] text-indigo-400 hover:text-indigo-300 transition-colors"
        >
          + {suggestions.length} related
        </button>
      ) : (
        <>
          {suggestions.map((s) => (
            <button
              key={s.id}
              onClick={() => {
                addNodes([{ id: s.id, name: s.name, type: s.type, color: getColorForType(s.type) }]);
                setSuggestions((prev) => prev.filter((p) => p.id !== s.id));
              }}
              className="flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded border border-dashed border-zinc-600 text-zinc-400 hover:text-zinc-200 hover:border-zinc-500 transition-colors"
            >
              <span className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: getColorForType(s.type) }} />
              <span className="truncate max-w-[80px]">{s.name}</span>
              <span className="text-zinc-600">{Math.round(s.score * 100)}%</span>
            </button>
          ))}
          <button onClick={() => setExpanded(false)} className="text-[10px] text-zinc-600 hover:text-zinc-400">✕</button>
        </>
      )}
    </div>
  );
}
