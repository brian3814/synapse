import React from 'react';
import { useGraphStore } from '../../../graph/store/graph-store';
import { useUIStore } from '../../../graph/store/ui-store';
import { useNodeTypeStore } from '../../../graph/store/node-type-store';
import type { ResultNode } from '../../../db/worker/query-engine/types';

interface QueryResultsProps {
  results: {
    results: ResultNode[];
    metadata: { count: number; executionTimeMs: number };
  };
}

export function QueryResults({ results }: QueryResultsProps) {
  const selectNode = useGraphStore((s) => s.selectNode);
  const setActivePanel = useUIStore((s) => s.setActivePanel);
  const getColorForType = useNodeTypeStore((s) => s.getColorForType);

  const handleSelect = (id: string) => {
    selectNode(id);
    setActivePanel('nodeDetail');
  };

  if (results.results.length === 0) {
    return <p className="text-xs text-zinc-500 text-center py-4">No results found</p>;
  }

  return (
    <div className="space-y-1">
      <p className="text-xs text-zinc-500">
        {results.metadata.count} result{results.metadata.count !== 1 ? 's' : ''} &middot; {results.metadata.executionTimeMs}ms
      </p>
      <div className="space-y-1">
        {results.results.map((node, i) => (
          <ResultNodeItem key={`${node.data.id ?? i}`} node={node} onSelect={handleSelect} getColor={getColorForType} depth={0} />
        ))}
      </div>
    </div>
  );
}

function ResultNodeItem({
  node,
  onSelect,
  getColor,
  depth,
}: {
  node: ResultNode;
  onSelect: (id: string) => void;
  getColor: (type: string) => string;
  depth: number;
}) {
  const nodeId = node.data.id as string | undefined;
  const label = (node.data.name as string) || node.type;
  const color = getColor(node.type);
  const relEntries = Object.entries(node.relationship);

  return (
    <div style={{ marginLeft: depth * 16 }} className={depth > 0 ? 'border-l border-zinc-700 pl-2' : ''}>
      <button
        onClick={() => nodeId && onSelect(nodeId)}
        disabled={!nodeId}
        className="w-full text-left px-3 py-2 bg-zinc-800 rounded hover:bg-zinc-700 flex items-center gap-2 disabled:opacity-50 disabled:cursor-default"
      >
        <div
          className="w-2 h-2 rounded-full shrink-0"
          style={{ backgroundColor: color }}
        />
        <span className="text-sm text-zinc-200 truncate">{label}</span>
        <span className="text-xs text-zinc-500 ml-auto shrink-0">{node.type}</span>
      </button>
      {relEntries.map(([relKey, children]) =>
        children.map((child, j) => (
          <ResultNodeItem
            key={`${relKey}-${child.data.id ?? j}`}
            node={child}
            onSelect={onSelect}
            getColor={getColor}
            depth={depth + 1}
          />
        ))
      )}
    </div>
  );
}
