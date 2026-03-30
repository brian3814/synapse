import { useState, useEffect } from 'react';
import { nodes } from '../../../db/client/db-client';
import { useNodeTypeStore } from '../../../graph/store/node-type-store';
import type { ChatSubgraphData } from '../../hooks/chat-agent-loop';

interface Props {
  subgraph: ChatSubgraphData;
  onNodeClick?: (nodeId: string) => void;
}

interface LoadedNode {
  id: string;
  name: string;
  type: string;
}

export function ChatReferencedEntities({ subgraph, onNodeClick }: Props) {
  const [loadedNodes, setLoadedNodes] = useState<LoadedNode[]>([]);
  const getColorForType = useNodeTypeStore((s) => s.getColorForType);

  useEffect(() => {
    if (subgraph.nodeIds.length === 0) return;

    let cancelled = false;
    Promise.all(
      subgraph.nodeIds.slice(0, 30).map((id) => nodes.getById(id).catch(() => null))
    ).then((results) => {
      if (cancelled) return;
      const loaded = results
        .filter((n): n is any => n != null)
        .map((n) => ({ id: n.id, name: n.name, type: n.type }));
      setLoadedNodes(loaded);
    });

    return () => { cancelled = true; };
  }, [subgraph.nodeIds]);

  if (loadedNodes.length === 0) return null;

  return (
    <details style={{ marginTop: '0.5rem' }}>
      <summary
        className="text-zinc-500 cursor-pointer select-none"
        style={{ fontSize: '10px' }}
      >
        {loadedNodes.length} {loadedNodes.length === 1 ? 'entity' : 'entities'} referenced
      </summary>
      <div className="flex flex-wrap gap-1" style={{ marginTop: '0.375rem' }}>
        {loadedNodes.map((node) => (
          <button
            key={node.id}
            onClick={() => onNodeClick?.(node.id)}
            className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-zinc-700/50 hover:bg-zinc-600/50 transition-colors cursor-pointer"
            style={{ fontSize: '10px' }}
            title={`${node.type}: ${node.name}`}
          >
            <span
              className="inline-block w-1.5 h-1.5 rounded-full flex-shrink-0"
              style={{ backgroundColor: getColorForType(node.type) }}
            />
            <span className="text-zinc-400 truncate" style={{ maxWidth: '120px' }}>
              {node.name}
            </span>
          </button>
        ))}
      </div>
    </details>
  );
}
