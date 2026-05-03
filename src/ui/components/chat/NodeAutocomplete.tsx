import React, { useState, useEffect, useRef, useCallback } from 'react';
import { useGraphStore } from '../../../graph/store/graph-store';
import { useNodeTypeStore } from '../../../graph/store/node-type-store';
import { useChatContextStore } from '../../../graph/store/chat-context-store';

interface NodeAutocompleteProps {
  query: string;
  onSelect: () => void;
  onDismiss: () => void;
  anchorRef: React.RefObject<HTMLElement | null>;
}

const MAX_RESULTS = 8;

export function NodeAutocomplete({ query, onSelect, onDismiss, anchorRef }: NodeAutocompleteProps) {
  const nodes = useGraphStore((s) => s.nodes);
  const getColorForType = useNodeTypeStore((s) => s.getColorForType);
  const addNodes = useChatContextStore((s) => s.addNodes);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const menuRef = useRef<HTMLDivElement>(null);

  const lowerQuery = query.toLowerCase();
  const results = nodes
    .filter((n) => n.name.toLowerCase().includes(lowerQuery))
    .slice(0, MAX_RESULTS);

  useEffect(() => {
    setSelectedIndex(0);
  }, [query]);

  const handleKeyDown = useCallback((e: KeyboardEvent) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setSelectedIndex((i) => Math.min(i + 1, results.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setSelectedIndex((i) => Math.max(i - 1, 0));
    } else if (e.key === 'Enter' && results.length > 0) {
      e.preventDefault();
      const node = results[selectedIndex];
      if (node) {
        addNodes([{
          id: node.id,
          name: node.name,
          type: node.type,
          color: node.color ?? getColorForType(node.type),
        }]);
        onSelect();
      }
    } else if (e.key === 'Escape') {
      e.preventDefault();
      onDismiss();
    }
  }, [results, selectedIndex, addNodes, getColorForType, onSelect, onDismiss]);

  useEffect(() => {
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [handleKeyDown]);

  useEffect(() => {
    const handleClick = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        onDismiss();
      }
    };
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, [onDismiss]);

  if (results.length === 0) return null;

  const handleItemClick = (node: typeof results[0]) => {
    addNodes([{
      id: node.id,
      name: node.name,
      type: node.type,
      color: node.color ?? getColorForType(node.type),
    }]);
    onSelect();
  };

  const highlight = (name: string) => {
    const idx = name.toLowerCase().indexOf(lowerQuery);
    if (idx === -1) return <span>{name}</span>;
    return (
      <>
        {name.slice(0, idx)}
        <strong className="text-zinc-100">{name.slice(idx, idx + query.length)}</strong>
        {name.slice(idx + query.length)}
      </>
    );
  };

  return (
    <div
      ref={menuRef}
      className="absolute bottom-full left-0 mb-1 w-full max-h-64 overflow-y-auto bg-zinc-800 border border-zinc-600 rounded-md shadow-xl z-50"
    >
      {results.map((node, i) => (
        <button
          key={node.id}
          onClick={() => handleItemClick(node)}
          className={`w-full text-left px-3 py-1.5 flex items-center gap-2 text-sm transition-colors ${
            i === selectedIndex ? 'bg-zinc-700 text-zinc-100' : 'text-zinc-400 hover:bg-zinc-700/50'
          }`}
        >
          <span
            className="w-2 h-2 rounded-full flex-shrink-0"
            style={{ backgroundColor: node.color ?? getColorForType(node.type) }}
          />
          <span className="truncate">{highlight(node.name)}</span>
          <span className="ml-auto text-zinc-600 text-xs flex-shrink-0">
            {node.label ?? node.type}
          </span>
        </button>
      ))}
    </div>
  );
}
