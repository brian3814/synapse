import React, { useState } from 'react';
import { useChatContextStore, type AttachedNode } from '../../../graph/store/chat-context-store';
import { ContextSuggestions } from './ContextSuggestions';

const MAX_VISIBLE = 4;

export function ContextChipBar() {
  const attachedNodes = useChatContextStore((s) => s.attachedNodes);
  const removeNode = useChatContextStore((s) => s.removeNode);
  const [expanded, setExpanded] = useState(false);

  if (attachedNodes.length === 0) return null;

  const overflow = attachedNodes.length > MAX_VISIBLE + 1;
  const visible = overflow && !expanded
    ? attachedNodes.slice(0, MAX_VISIBLE)
    : attachedNodes;
  const hiddenCount = attachedNodes.length - MAX_VISIBLE;

  return (
    <>
      <div className="flex flex-wrap gap-1.5 px-3 py-2 border-t border-zinc-700">
        {visible.map((node) => (
          <Chip key={node.id} node={node} onRemove={() => removeNode(node.id)} />
        ))}
        {overflow && !expanded && (
          <button
            onClick={() => setExpanded(true)}
            className="inline-flex items-center px-2 py-0.5 rounded-full text-xs bg-zinc-700/50 text-zinc-400 hover:text-zinc-200 hover:bg-zinc-700 transition-colors"
          >
            +{hiddenCount} more
          </button>
        )}
        {overflow && expanded && (
          <button
            onClick={() => setExpanded(false)}
            className="inline-flex items-center px-2 py-0.5 rounded-full text-xs bg-zinc-700/50 text-zinc-400 hover:text-zinc-200 hover:bg-zinc-700 transition-colors"
          >
            show less
          </button>
        )}
      </div>
      <ContextSuggestions />
    </>
  );
}

function Chip({ node, onRemove }: { node: AttachedNode; onRemove: () => void }) {
  return (
    <span
      className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs border transition-colors"
      style={{
        backgroundColor: node.color + '20',
        borderColor: node.color + '44',
        color: node.color + 'cc',
      }}
    >
      <span
        className="w-1.5 h-1.5 rounded-full flex-shrink-0"
        style={{ backgroundColor: node.color }}
      />
      <span className="truncate" style={{ maxWidth: '100px' }}>{node.name}</span>
      <button
        onClick={(e) => { e.stopPropagation(); onRemove(); }}
        className="ml-0.5 opacity-60 hover:opacity-100"
      >
        ×
      </button>
    </span>
  );
}
