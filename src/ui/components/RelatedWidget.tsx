import React, { useState } from 'react';
import { useContextualRelevance, type RelatedMatch } from '../hooks/useContextualRelevance';
import { useGraphStore } from '../../graph/store/graph-store';
import { useUIStore } from '../../graph/store/ui-store';

export function RelatedWidget() {
  const { relatedNodes, loading, enabled } = useContextualRelevance();
  const [collapsed, setCollapsed] = useState(false);
  const selectNode = useGraphStore((s) => s.selectNode);
  const openContentTab = useUIStore((s) => s.openContentTab);
  const focusNodeCallback = useUIStore((s) => s.focusNodeCallback);

  if (!enabled || (relatedNodes.length === 0 && !loading)) return null;

  const handleNodeClick = (nodeId: string) => {
    selectNode(nodeId);
    openContentTab({ kind: 'graph' }, 'Graph');
    useUIStore.getState().setGraphOverlay('nodeDetail');
    if (focusNodeCallback) focusNodeCallback(nodeId);
  };

  return (
    <div className="border-b border-zinc-700 bg-zinc-800/50">
      <button
        onClick={() => setCollapsed(!collapsed)}
        className="w-full flex items-center justify-between px-3 py-1.5 text-xs text-zinc-400 hover:text-zinc-300"
      >
        <span className="flex items-center gap-1.5">
          <LinkIcon />
          Related in your graph
          {relatedNodes.length > 0 && (
            <span className="bg-indigo-600/30 text-indigo-300 px-1.5 py-0.5 rounded-full text-[10px]">
              {relatedNodes.length}
            </span>
          )}
        </span>
        <span className="text-[10px]">{collapsed ? '+' : '-'}</span>
      </button>

      {!collapsed && (
        <div className="px-3 pb-2 space-y-1">
          {loading && (
            <p className="text-[10px] text-zinc-500 animate-pulse">Scanning page...</p>
          )}
          {relatedNodes.map((match) => (
            <RelatedNodeItem
              key={match.node.id}
              match={match}
              onClick={() => handleNodeClick(match.node.id)}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function RelatedNodeItem({ match, onClick }: { match: RelatedMatch; onClick: () => void }) {
  const { node, matchedTerm } = match;
  return (
    <button
      onClick={onClick}
      className="w-full text-left flex items-center gap-2 px-2 py-1.5 rounded bg-zinc-800/80 hover:bg-zinc-700/80 transition-colors group"
    >
      <span
        className="w-2 h-2 rounded-full shrink-0"
        style={{ backgroundColor: node.color ?? '#6B7280' }}
      />
      <span className="text-xs text-zinc-300 truncate group-hover:text-zinc-100">
        {node.name}
      </span>
      <span className="text-[10px] text-zinc-600 ml-auto shrink-0">{node.type}</span>
    </button>
  );
}

const LinkIcon = () => (
  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
    <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" />
    <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" />
  </svg>
);
