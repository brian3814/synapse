import { useState, useCallback, useRef, useEffect } from 'react';
import { useGraphStore } from '../../../graph/store/graph-store';
import { useUIStore } from '../../../graph/store/ui-store';
import { useNodeTypeStore } from '../../../graph/store/node-type-store';
import { nodes as dbNodes, edges as dbEdges, noteSearch } from '../../../db/client/db-client';
import type { DbNode } from '../../../shared/types';

const MIN_QUERY_LENGTH = 2;
const DEBOUNCE_MS = 300;

interface EdgeResult {
  id: string;
  label: string;
  source_id: string;
  target_id: string;
  source_name: string;
  target_name: string;
}

interface SearchResults {
  entities: DbNode[];
  notes: DbNode[];
  resources: DbNode[];
  edges: EdgeResult[];
}

const EMPTY: SearchResults = { entities: [], notes: [], resources: [], edges: [] };

export function HeaderSearch() {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<SearchResults>(EMPTY);
  const [searching, setSearching] = useState(false);
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout>>(undefined);
  const searchIdRef = useRef(0);

  const selectNode = useGraphStore((s) => s.selectNode);
  const selectEdge = useGraphStore((s) => s.selectEdge);
  const setActivePanel = useUIStore((s) => s.setActivePanel);
  const getColorForNode = useNodeTypeStore((s) => s.getColorForNode);

  // Close dropdown on outside click
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  // Keyboard shortcut: Cmd+K / Ctrl+K to focus search
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault();
        inputRef.current?.focus();
        setOpen(true);
      }
      if (e.key === 'Escape') {
        setOpen(false);
        inputRef.current?.blur();
      }
    };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, []);

  const runSearch = useCallback(async (q: string) => {
    const id = ++searchIdRef.current;
    setSearching(true);

    // Use allSettled so a single slow/failed sub-query (e.g. edges.search on
    // large datasets) doesn't wipe out successful node results.
    const [nodeSettled, edgeSettled, noteSettled] = await Promise.allSettled([
      dbNodes.search(q, 30) as Promise<DbNode[]>,
      dbEdges.search(q, 15) as Promise<EdgeResult[]>,
      noteSearch.search(q, 10),
    ]);

    if (searchIdRef.current !== id) return;

    if (nodeSettled.status === 'rejected') {
      console.warn('[HeaderSearch] nodes.search failed:', nodeSettled.reason);
    }
    if (edgeSettled.status === 'rejected') {
      console.warn('[HeaderSearch] edges.search failed:', edgeSettled.reason);
    }
    if (noteSettled.status === 'rejected') {
      console.warn('[HeaderSearch] noteSearch.search failed:', noteSettled.reason);
    }

    const nodeResults = nodeSettled.status === 'fulfilled' ? nodeSettled.value : [];
    const edgeResults = edgeSettled.status === 'fulfilled' ? edgeSettled.value : [];
    const noteContentResults = noteSettled.status === 'fulfilled' ? noteSettled.value : [];

    const entities: DbNode[] = [];
    const notes: DbNode[] = [];
    const resources: DbNode[] = [];
    const noteIdsSeen = new Set<string>();

    for (const node of nodeResults) {
      if (node.type === 'entity') entities.push(node);
      else if (node.type === 'note') { notes.push(node); noteIdsSeen.add(node.id); }
      else if (node.type === 'resource') resources.push(node);
      else entities.push(node); // fallback
    }

    for (const nr of noteContentResults) {
      if (!noteIdsSeen.has(nr.node_id)) {
        notes.push({ id: nr.node_id, name: nr.title, type: 'note' } as DbNode);
        noteIdsSeen.add(nr.node_id);
      }
    }

    setResults({ entities, notes, resources, edges: edgeResults });
    setOpen(true);
    setSearching(false);
  }, []);

  const handleChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const q = e.target.value;
      setQuery(q);

      clearTimeout(debounceRef.current);

      if (q.length < MIN_QUERY_LENGTH) {
        setResults(EMPTY);
        setSearching(false);
        return;
      }

      debounceRef.current = setTimeout(() => runSearch(q), DEBOUNCE_MS);
    },
    [runSearch]
  );

  const handleFocus = () => {
    if (query.length >= MIN_QUERY_LENGTH) setOpen(true);
  };

  const handleSelectNode = (id: string) => {
    // If the matched node is in a hidden layer, reveal it so the canvas
    // has something to fit to.
    const node = useGraphStore.getState().nodes.find((n) => n.id === id);
    let layerToggled = false;
    if (node) {
      const { visibleLayers, toggleLayer } = useUIStore.getState();
      const layer = node.type as 'entity' | 'note' | 'resource';
      if (visibleLayers[layer] === false) {
        toggleLayer(layer);
        layerToggled = true;
      }
    }
    const invoke = () => {
      const cb = useUIStore.getState().focusNodeCallback;
      if (cb) {
        cb(id);
      } else {
        selectNode(id);
        setActivePanel('nodeDetail');
      }
    };
    if (layerToggled) {
      // Wait two frames: React commit → GraphCanvas.updateData → fitToView
      requestAnimationFrame(() => requestAnimationFrame(invoke));
    } else {
      invoke();
    }
    setOpen(false);
    setQuery('');
    setResults(EMPTY);
  };

  const handleSelectEdge = (id: string, sourceId?: string, targetId?: string) => {
    selectEdge(id);
    setActivePanel('edgeDetail');
    // Fit viewport to both endpoints so the edge is visible
    if (sourceId && targetId) {
      const cb = useUIStore.getState().focusNodeCallback;
      if (cb) cb([sourceId, targetId]);
    }
    setOpen(false);
    setQuery('');
    setResults(EMPTY);
  };

  const totalCount =
    results.entities.length + results.notes.length + results.resources.length + results.edges.length;
  const hasResults = totalCount > 0;
  const showDropdown = open && query.length >= MIN_QUERY_LENGTH;

  return (
    <div ref={containerRef} className="relative" style={{ width: '15%', minWidth: 120 }}>
      <div className="relative">
        <svg
          className="absolute left-2 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-zinc-500 pointer-events-none"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
        >
          <circle cx="11" cy="11" r="8" />
          <path d="m21 21-4.35-4.35" />
        </svg>
        <input
          ref={inputRef}
          value={query}
          onChange={handleChange}
          onFocus={handleFocus}
          placeholder="Search... (⌘K)"
          className="w-full bg-zinc-900 border border-zinc-700 rounded pl-7 pr-2 py-1 text-xs text-zinc-200 outline-none focus:border-indigo-500 placeholder-zinc-600"
        />
      </div>

      {showDropdown && (
        <div className="absolute top-full left-0 right-0 mt-1 bg-zinc-800 border border-zinc-700 rounded-lg shadow-xl overflow-hidden z-50 max-h-[420px] overflow-y-auto">
          {searching && !hasResults && (
            <p className="text-xs text-zinc-500 px-3 py-2">Searching...</p>
          )}

          {!searching && !hasResults && (
            <p className="text-xs text-zinc-500 px-3 py-4 text-center">No results found</p>
          )}

          {/* Entities section */}
          {results.entities.length > 0 && (
            <ResultSection title="Entities" count={results.entities.length}>
              {results.entities.map((node) => (
                <NodeResultItem
                  key={node.id}
                  node={node}
                  color={getColorForNode(node.type, (node as any).label)}
                  sublabel={(node as any).label}
                  onClick={() => handleSelectNode(node.id)}
                />
              ))}
            </ResultSection>
          )}

          {/* Notes section */}
          {results.notes.length > 0 && (
            <ResultSection title="Notes" count={results.notes.length}>
              {results.notes.map((node) => (
                <NodeResultItem
                  key={node.id}
                  node={node}
                  color={getColorForNode(node.type, null)}
                  onClick={() => handleSelectNode(node.id)}
                />
              ))}
            </ResultSection>
          )}

          {/* Resources section */}
          {results.resources.length > 0 && (
            <ResultSection title="Resources" count={results.resources.length}>
              {results.resources.map((node) => (
                <NodeResultItem
                  key={node.id}
                  node={node}
                  color={getColorForNode(node.type, null)}
                  onClick={() => handleSelectNode(node.id)}
                />
              ))}
            </ResultSection>
          )}

          {/* Relationships section */}
          {results.edges.length > 0 && (
            <ResultSection title="Relationships" count={results.edges.length}>
              {results.edges.map((edge) => (
                <button
                  key={edge.id}
                  onClick={() => handleSelectEdge(edge.id, edge.source_id, edge.target_id)}
                  className="w-full text-left px-3 py-1.5 hover:bg-zinc-700 flex items-center gap-1.5 text-xs"
                >
                  <span className="text-zinc-300 truncate">{edge.source_name}</span>
                  <span className="text-zinc-600">&rarr;</span>
                  <span className="text-indigo-400 shrink-0">{edge.label}</span>
                  <span className="text-zinc-600">&rarr;</span>
                  <span className="text-zinc-300 truncate">{edge.target_name}</span>
                </button>
              ))}
            </ResultSection>
          )}
        </div>
      )}
    </div>
  );
}

function ResultSection({
  title,
  count,
  children,
}: {
  title: string;
  count: number;
  children: React.ReactNode;
}) {
  return (
    <div className="border-b border-zinc-700 last:border-b-0">
      <div className="px-3 py-1.5 bg-zinc-850 flex items-center justify-between" style={{ backgroundColor: '#1f1f23' }}>
        <span className="text-[10px] font-medium text-zinc-500 uppercase tracking-wider">{title}</span>
        <span className="text-[10px] text-zinc-600">{count}</span>
      </div>
      <div>{children}</div>
    </div>
  );
}

function NodeResultItem({
  node,
  color,
  sublabel,
  onClick,
}: {
  node: DbNode;
  color: string;
  sublabel?: string | null;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className="w-full text-left px-3 py-1.5 hover:bg-zinc-700 flex items-center gap-2 text-xs"
    >
      <div
        className="w-2 h-2 rounded-full shrink-0"
        style={{ backgroundColor: color }}
      />
      <span className="text-zinc-200 truncate">{node.name}</span>
      {sublabel && (
        <span className="text-zinc-600 ml-auto shrink-0">{sublabel}</span>
      )}
    </button>
  );
}
