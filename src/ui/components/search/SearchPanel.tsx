import React, { useState, useCallback, useRef } from 'react';
import { useGraphStore } from '../../../graph/store/graph-store';
import { useUIStore } from '../../../graph/store/ui-store';
import { useNodeTypeStore } from '../../../graph/store/node-type-store';
import { nodes as dbNodes } from '../../../db/client/db-client';
import type { DbNode } from '../../../shared/types';

const MIN_QUERY_LENGTH = 2;

export function SearchPanel() {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<DbNode[]>([]);
  const [searching, setSearching] = useState(false);
  const selectNode = useGraphStore((s) => s.selectNode);
  const openContentTab = useUIStore((s) => s.openContentTab);
  const focusNodeCallback = useUIStore((s) => s.focusNodeCallback);
  const getColorForType = useNodeTypeStore((s) => s.getColorForType);

  const debounceTimerRef = useRef<ReturnType<typeof setTimeout>>(undefined);
  const searchIdRef = useRef(0);

  const handleInputChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const q = e.target.value;
    setQuery(q);

    clearTimeout(debounceTimerRef.current);

    if (q.length < MIN_QUERY_LENGTH) {
      setResults([]);
      setSearching(false);
      return;
    }

    setSearching(true);
    const id = ++searchIdRef.current;

    debounceTimerRef.current = setTimeout(async () => {
      try {
        const found = await dbNodes.search(q);
        if (searchIdRef.current === id) {
          setResults(found);
        }
      } catch (err) {
        console.error('Search failed:', err);
        if (searchIdRef.current === id) {
          setResults([]);
        }
      } finally {
        if (searchIdRef.current === id) {
          setSearching(false);
        }
      }
    }, 300);
  }, []);

  const handleSelect = (id: string) => {
    selectNode(id);
    openContentTab({ kind: 'graph' }, 'Graph');
    useUIStore.getState().setGraphOverlay('nodeDetail');
    if (focusNodeCallback) focusNodeCallback(id);
  };

  return (
    <div className="p-4 space-y-3">
      <div>
        <input
          value={query}
          onChange={handleInputChange}
          placeholder="Search nodes..."
          className="w-full bg-zinc-800 border border-zinc-600 rounded px-3 py-2 text-sm text-zinc-100 outline-none focus:border-indigo-500 placeholder-zinc-600"
          autoFocus
        />
      </div>

      {searching && (
        <p className="text-xs text-zinc-500">Searching...</p>
      )}

      {results.length > 0 && (
        <div className="space-y-1">
          {results.map((node) => {
            const color = getColorForType(node.type);
            return (
              <button
                key={node.id}
                onClick={() => handleSelect(node.id)}
                className="w-full text-left px-3 py-2 bg-zinc-800 rounded hover:bg-zinc-700 flex items-center gap-2"
              >
                <div
                  className="w-2 h-2 rounded-full shrink-0"
                  style={{ backgroundColor: color }}
                />
                <span className="text-sm text-zinc-200 truncate">{node.name}</span>
                <span className="text-xs text-zinc-500 ml-auto shrink-0">{node.type}</span>
              </button>
            );
          })}
        </div>
      )}

      {query.length >= MIN_QUERY_LENGTH && !searching && results.length === 0 && (
        <p className="text-xs text-zinc-500 text-center py-4">No results found</p>
      )}
    </div>
  );
}
