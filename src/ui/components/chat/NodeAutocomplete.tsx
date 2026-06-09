import { useState, useEffect, useRef, useCallback } from 'react';
import { useGraphStore } from '../../../graph/store/graph-store';
import { useNodeTypeStore } from '../../../graph/store/node-type-store';
import { useChatContextStore } from '../../../graph/store/chat-context-store';
import { useArtifactStore } from '../../../graph/store/artifact-store';
import { ARTIFACT_TYPE_LABELS, type ArtifactType } from '../../../shared/artifact-types';

interface NodeAutocompleteProps {
  query: string;
  onSelect: (name?: string) => void;
  onDismiss: () => void;
}

const MAX_PER_GROUP = 4;

const ARTIFACT_ICONS: Record<ArtifactType, string> = {
  jsx: '⚛', markdown: '📄', html: '🌐', svg: '◈', mermaid: '◇',
};

interface ResultItem {
  id: string;
  name: string;
  kind: 'entity' | 'note' | 'resource' | 'artifact';
  color: string;
  sublabel: string;
  icon?: string;
}

export function NodeAutocomplete({ query, onSelect, onDismiss }: NodeAutocompleteProps) {
  const nodes = useGraphStore((s) => s.nodes);
  const artifacts = useArtifactStore((s) => s.artifacts);
  const getColorForType = useNodeTypeStore((s) => s.getColorForType);
  const addNodes = useChatContextStore((s) => s.addNodes);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const menuRef = useRef<HTMLDivElement>(null);

  const lowerQuery = query.toLowerCase();

  const entityResults: ResultItem[] = [];
  const noteResults: ResultItem[] = [];
  const resourceResults: ResultItem[] = [];
  for (const n of nodes) {
    if (!n.name.toLowerCase().includes(lowerQuery)) continue;
    const item: ResultItem = {
      id: n.id,
      name: n.name,
      kind: n.type === 'note' ? 'note' : n.type === 'resource' ? 'resource' : 'entity',
      color: n.color ?? getColorForType(n.type),
      sublabel: (n as any).label ?? n.type,
    };
    if (item.kind === 'entity' && entityResults.length < MAX_PER_GROUP) entityResults.push(item);
    else if (item.kind === 'note' && noteResults.length < MAX_PER_GROUP) noteResults.push(item);
    else if (item.kind === 'resource' && resourceResults.length < MAX_PER_GROUP) resourceResults.push(item);
  }

  const artifactResults: ResultItem[] = artifacts
    .filter((a) => a.title.toLowerCase().includes(lowerQuery))
    .slice(0, MAX_PER_GROUP)
    .map((a) => ({
      id: a.id,
      name: a.title,
      kind: 'artifact' as const,
      color: '#a78bfa',
      sublabel: ARTIFACT_TYPE_LABELS[a.type],
      icon: ARTIFACT_ICONS[a.type],
    }));

  const groups: Array<{ title: string; items: ResultItem[] }> = [];
  if (entityResults.length > 0) groups.push({ title: 'Entities', items: entityResults });
  if (noteResults.length > 0) groups.push({ title: 'Notes', items: noteResults });
  if (resourceResults.length > 0) groups.push({ title: 'Resources', items: resourceResults });
  if (artifactResults.length > 0) groups.push({ title: 'Artifacts', items: artifactResults });

  const flatResults = groups.flatMap((g) => g.items);

  useEffect(() => {
    setSelectedIndex(0);
  }, [query]);

  const handleSelect = useCallback((item: ResultItem) => {
    if (item.kind === 'artifact') {
      onSelect(item.name);
    } else {
      const node = nodes.find((n) => n.id === item.id);
      if (node) {
        addNodes([{
          id: node.id,
          name: node.name,
          type: node.type,
          color: node.color ?? getColorForType(node.type),
        }]);
      }
      onSelect(item.name);
    }
  }, [nodes, addNodes, getColorForType, onSelect]);

  const handleKeyDown = useCallback((e: KeyboardEvent) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setSelectedIndex((i) => Math.min(i + 1, flatResults.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setSelectedIndex((i) => Math.max(i - 1, 0));
    } else if (e.key === 'Enter' && flatResults.length > 0) {
      e.preventDefault();
      const item = flatResults[selectedIndex];
      if (item) handleSelect(item);
    } else if (e.key === 'Escape') {
      e.preventDefault();
      onDismiss();
    }
  }, [flatResults, selectedIndex, handleSelect, onDismiss]);

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

  if (flatResults.length === 0) return null;

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

  let flatIndex = 0;

  return (
    <div
      ref={menuRef}
      className="absolute bottom-full left-0 mb-1 w-full max-h-72 overflow-y-auto bg-zinc-800 border border-zinc-600 rounded-md shadow-xl z-50"
    >
      {groups.map((group) => (
        <div key={group.title}>
          <div className="px-3 py-1 flex items-center justify-between" style={{ backgroundColor: '#1f1f23' }}>
            <span className="text-[10px] font-medium text-zinc-500 uppercase tracking-wider">{group.title}</span>
            <span className="text-[10px] text-zinc-600">{group.items.length}</span>
          </div>
          {group.items.map((item) => {
            const idx = flatIndex++;
            return (
              <button
                key={item.id}
                onClick={() => handleSelect(item)}
                className={`w-full text-left px-3 py-1.5 flex items-center gap-2 text-sm transition-colors ${
                  idx === selectedIndex ? 'bg-zinc-700 text-zinc-100' : 'text-zinc-400 hover:bg-zinc-700/50'
                }`}
              >
                {item.icon ? (
                  <span className="text-xs shrink-0">{item.icon}</span>
                ) : (
                  <span
                    className="w-2 h-2 rounded-full shrink-0"
                    style={{ backgroundColor: item.color }}
                  />
                )}
                <span className="truncate">{highlight(item.name)}</span>
                <span className="ml-auto text-zinc-600 text-xs shrink-0">{item.sublabel}</span>
              </button>
            );
          })}
        </div>
      ))}
    </div>
  );
}
