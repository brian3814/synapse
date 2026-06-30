import { useState, useCallback, useRef, useEffect, useMemo } from 'react';
import { useGraphStore } from '../../../graph/store/graph-store';
import { useUIStore } from '../../../graph/store/ui-store';
import { useNodeTypeStore } from '../../../graph/store/node-type-store';
import { nodes as dbNodes, edges as dbEdges, noteSearch } from '../../../db/client/db-client';
import { embedding, artifacts as platformArtifacts } from '@platform';
import type { DbNode } from '../../../shared/types';
import type { ArtifactRecord } from '../../../shared/artifact-types';
import { ARTIFACT_TYPE_LABELS, type ArtifactType } from '../../../shared/artifact-types';

const MIN_QUERY_LENGTH = 2;
const DEBOUNCE_MS = 300;

type TypeFilter = 'all' | 'entities' | 'notes' | 'resources' | 'relationships' | 'artifacts';
const FILTER_ORDER: TypeFilter[] = ['all', 'entities', 'notes', 'resources', 'relationships', 'artifacts'];

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
  artifacts: ArtifactRecord[];
}

const EMPTY: SearchResults = { entities: [], notes: [], resources: [], edges: [], artifacts: [] };

interface CommandPaletteProps {
  open: boolean;
  onClose: () => void;
}

export function CommandPalette({ open, onClose }: CommandPaletteProps) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<SearchResults>(EMPTY);
  const [semanticResults, setSemanticResults] = useState<DbNode[]>([]);
  const [searching, setSearching] = useState(false);
  const [activeFilter, setActiveFilter] = useState<TypeFilter>('all');
  const [selectedIndex, setSelectedIndex] = useState(0);

  const inputRef = useRef<HTMLInputElement>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout>>(undefined);
  const searchIdRef = useRef(0);

  const selectNode = useGraphStore((s) => s.selectNode);
  const selectEdge = useGraphStore((s) => s.selectEdge);
  const openContentTab = useUIStore((s) => s.openContentTab);
  const getColorForNode = useNodeTypeStore((s) => s.getColorForNode);

  // Reset and focus on open
  useEffect(() => {
    if (open) {
      setQuery('');
      setResults(EMPTY);
      setSemanticResults([]);
      setActiveFilter('all');
      setSelectedIndex(0);
      setSearching(false);
      setTimeout(() => inputRef.current?.focus(), 50);
    }
  }, [open]);

  // ─── Search logic (moved from HeaderSearch) ────────────────

  const runSearch = useCallback(async (q: string) => {
    const id = ++searchIdRef.current;
    setSearching(true);

    const [nodeSettled, edgeSettled, noteSettled, artifactSettled] = await Promise.allSettled([
      dbNodes.search(q, 30) as Promise<DbNode[]>,
      dbEdges.search(q, 15) as Promise<EdgeResult[]>,
      noteSearch.search(q, 10),
      platformArtifacts.search(q) as Promise<ArtifactRecord[]>,
    ]);

    if (searchIdRef.current !== id) return;

    if (nodeSettled.status === 'rejected') console.warn('[CommandPalette] nodes.search failed:', nodeSettled.reason);
    if (edgeSettled.status === 'rejected') console.warn('[CommandPalette] edges.search failed:', edgeSettled.reason);
    if (noteSettled.status === 'rejected') console.warn('[CommandPalette] noteSearch.search failed:', noteSettled.reason);
    if (artifactSettled.status === 'rejected') console.warn('[CommandPalette] artifacts.search failed:', artifactSettled.reason);

    const nodeResults = nodeSettled.status === 'fulfilled' ? nodeSettled.value : [];
    const edgeResults = edgeSettled.status === 'fulfilled' ? edgeSettled.value : [];
    const noteContentResults = noteSettled.status === 'fulfilled' ? noteSettled.value : [];
    const artifactResults = artifactSettled.status === 'fulfilled' ? artifactSettled.value : [];

    const entities: DbNode[] = [];
    const notes: DbNode[] = [];
    const resources: DbNode[] = [];
    const noteIdsSeen = new Set<string>();

    for (const node of nodeResults) {
      if (node.type === 'entity') entities.push(node);
      else if (node.type === 'note') { notes.push(node); noteIdsSeen.add(node.id); }
      else if (node.type === 'resource') resources.push(node);
      else entities.push(node);
    }

    for (const nr of noteContentResults) {
      if (!noteIdsSeen.has(nr.node_id)) {
        notes.push({ id: nr.node_id, name: nr.title, type: 'note' } as DbNode);
        noteIdsSeen.add(nr.node_id);
      }
    }

    setResults({ entities, notes, resources, edges: edgeResults, artifacts: artifactResults });
    setSelectedIndex(0);

    // Semantic fallback
    const ftsTotal = entities.length + notes.length + resources.length + edgeResults.length + artifactResults.length;
    const wordCount = q.trim().split(/\s+/).length;
    if (ftsTotal < 5 && wordCount >= 3) {
      const ftsIds = new Set<string>([
        ...entities.map((n) => n.id),
        ...notes.map((n) => n.id),
        ...resources.map((n) => n.id),
      ]);
      try {
        const semanticHits = await embedding.searchSimilar(q, 5);
        if (searchIdRef.current !== id) return;
        const graphNodes = useGraphStore.getState().nodes;
        const resolved = semanticHits
          .filter((hit) => !ftsIds.has(hit.nodeId))
          .map((hit) => {
            const gn = graphNodes.find((n) => n.id === hit.nodeId);
            if (!gn) return null;
            return { id: gn.id, name: gn.name, type: gn.type } as DbNode;
          })
          .filter((n): n is DbNode => n !== null);
        setSemanticResults(resolved);
      } catch {
        setSemanticResults([]);
      }
    } else {
      setSemanticResults([]);
    }

    setSearching(false);
  }, []);

  const handleQueryChange = useCallback((value: string) => {
    setQuery(value);
    clearTimeout(debounceRef.current);
    if (value.length < MIN_QUERY_LENGTH) {
      setResults(EMPTY);
      setSemanticResults([]);
      setSearching(false);
      return;
    }
    debounceRef.current = setTimeout(() => runSearch(value), DEBOUNCE_MS);
  }, [runSearch]);

  // ─── Result counts ─────────────────────────────────────────

  const counts = useMemo(() => ({
    all: results.entities.length + results.notes.length + results.resources.length + results.edges.length + results.artifacts.length + semanticResults.length,
    entities: results.entities.length,
    notes: results.notes.length,
    resources: results.resources.length,
    relationships: results.edges.length,
    artifacts: results.artifacts.length,
  }), [results, semanticResults]);

  // ─── Flat result list for keyboard nav ─────────────────────

  const flatResults = useMemo(() => {
    const items: Array<{ type: 'node' | 'edge' | 'artifact' | 'semantic'; data: any }> = [];
    const shouldShow = (f: TypeFilter) => activeFilter === 'all' || activeFilter === f;
    if (shouldShow('entities')) results.entities.forEach(n => items.push({ type: 'node', data: n }));
    if (shouldShow('notes')) results.notes.forEach(n => items.push({ type: 'node', data: n }));
    if (shouldShow('resources')) results.resources.forEach(n => items.push({ type: 'node', data: n }));
    if (shouldShow('relationships')) results.edges.forEach(e => items.push({ type: 'edge', data: e }));
    if (shouldShow('artifacts')) results.artifacts.forEach(a => items.push({ type: 'artifact', data: a }));
    if (shouldShow('entities') || activeFilter === 'all') semanticResults.forEach(n => items.push({ type: 'semantic', data: n }));
    return items;
  }, [results, semanticResults, activeFilter]);

  // ─── Selection handlers ────────────────────────────────────

  const handleSelectNode = useCallback((id: string) => {
    const node = useGraphStore.getState().nodes.find((n) => n.id === id);
    if (node) {
      const { visibleLayers, toggleLayer } = useUIStore.getState();
      const layer = node.type as 'entity' | 'note' | 'resource';
      if (visibleLayers[layer] === false) toggleLayer(layer);
    }
    const cb = useUIStore.getState().focusNodeCallback;
    if (cb) {
      cb(id);
    } else {
      selectNode(id);
      openContentTab({ kind: 'graph' }, 'Graph');
      useUIStore.getState().setGraphOverlay('nodeDetail');
    }
    onClose();
  }, [selectNode, openContentTab, onClose]);

  const handleSelectEdge = useCallback((id: string, sourceId?: string, targetId?: string) => {
    selectEdge(id);
    openContentTab({ kind: 'graph' }, 'Graph');
    useUIStore.getState().setGraphOverlay('edgeDetail');
    if (sourceId && targetId) {
      const cb = useUIStore.getState().focusNodeCallback;
      if (cb) cb([sourceId, targetId]);
    }
    onClose();
  }, [selectEdge, openContentTab, onClose]);

  const handleSelectArtifact = useCallback((artifact: ArtifactRecord) => {
    openContentTab({ kind: 'artifact', artifactId: artifact.id }, artifact.title);
    onClose();
  }, [openContentTab, onClose]);

  const handleSelectItem = useCallback((index: number) => {
    const item = flatResults[index];
    if (!item) return;
    if (item.type === 'node' || item.type === 'semantic') handleSelectNode(item.data.id);
    else if (item.type === 'edge') handleSelectEdge(item.data.id, item.data.source_id, item.data.target_id);
    else if (item.type === 'artifact') handleSelectArtifact(item.data);
  }, [flatResults, handleSelectNode, handleSelectEdge, handleSelectArtifact]);

  // ─── Quick actions ─────────────────────────────────────────

  const handleCreateEntity = useCallback(() => {
    openContentTab({ kind: 'graph' }, 'Graph');
    useUIStore.getState().setGraphOverlay('create');
    onClose();
  }, [openContentTab, onClose]);

  const handleAskAssistant = useCallback(() => {
    useUIStore.getState().setChatOpen(true);
    onClose();
  }, [onClose]);

  // ─── Keyboard ──────────────────────────────────────────────

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setSelectedIndex(i => Math.min(i + 1, flatResults.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setSelectedIndex(i => Math.max(i - 1, 0));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (flatResults.length > 0) handleSelectItem(selectedIndex);
    } else if (e.key === 'Tab') {
      e.preventDefault();
      const idx = FILTER_ORDER.indexOf(activeFilter);
      const next = e.shiftKey
        ? (idx - 1 + FILTER_ORDER.length) % FILTER_ORDER.length
        : (idx + 1) % FILTER_ORDER.length;
      setActiveFilter(FILTER_ORDER[next]);
      setSelectedIndex(0);
    }
  }, [flatResults, selectedIndex, activeFilter, handleSelectItem]);

  // ─── Render ────────────────────────────────────────────────

  if (!open) return null;

  const hasQuery = query.length >= MIN_QUERY_LENGTH;
  const hasResults = counts.all > 0;
  const hasSemantic = semanticResults.length > 0;
  const shouldShow = (f: TypeFilter) => activeFilter === 'all' || activeFilter === f;

  let runningIndex = 0;

  return (
    <div
      className="fixed inset-0 bg-black/55 z-50 flex items-start justify-center pt-[15vh]"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div
        className="w-[540px] bg-zinc-900 border border-zinc-700 rounded-xl shadow-2xl overflow-hidden"
        onKeyDown={handleKeyDown}
      >
        {/* Search input */}
        <div className="flex items-center gap-2.5 px-4 py-3.5 border-b border-zinc-700">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"
            className={hasQuery ? 'text-indigo-500 shrink-0' : 'text-zinc-500 shrink-0'}>
            <circle cx="11" cy="11" r="8" /><path d="m21 21-4.35-4.35" />
          </svg>
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => handleQueryChange(e.target.value)}
            placeholder="Search entities, notes, relationships…"
            className="flex-1 bg-transparent text-[15px] text-zinc-100 outline-none placeholder-zinc-500"
          />
          {hasQuery && hasResults && (
            <span className="text-[11px] text-zinc-500 shrink-0">{counts.all} results</span>
          )}
          <kbd className="text-[11px] px-1.5 py-0.5 border border-zinc-600 rounded text-zinc-500 bg-zinc-800 shrink-0">esc</kbd>
        </div>

        {/* Type filter tabs */}
        <div className="flex items-center gap-0.5 px-4 py-2 border-b border-zinc-700">
          {FILTER_ORDER.map((filter) => (
            <button
              key={filter}
              onClick={() => { setActiveFilter(filter); setSelectedIndex(0); }}
              className={`px-2.5 py-1 rounded-md text-xs transition-colors ${
                activeFilter === filter
                  ? 'bg-zinc-800 text-zinc-100 font-medium'
                  : 'text-zinc-500 hover:text-zinc-300'
              }`}
            >
              {filter.charAt(0).toUpperCase() + filter.slice(1)}
              {hasQuery && (
                <span className="ml-1 opacity-60">{counts[filter] ?? 0}</span>
              )}
            </button>
          ))}
        </div>

        {/* Results / Recent / Quick Actions */}
        <div className="max-h-[380px] overflow-y-auto">
          {!hasQuery ? (
            <>
              {/* Recent placeholder */}
              <SectionHeader label="Recent" />
              <div className="px-4 py-5 text-center text-xs text-zinc-600">
                Recent items appear here
              </div>

              {/* Quick actions */}
              <div className="border-t border-zinc-700">
                <SectionHeader label="Quick actions" />
                <QuickAction icon={<PlusIcon />} label="Create new entity" shortcut="⌘N" onClick={handleCreateEntity} />
                <QuickAction icon={<NoteIcon />} label="Create new note" onClick={() => { openContentTab({ kind: 'notesBrowser' }, 'Notes'); onClose(); }} />
                <QuickAction icon={<ChatIcon />} label="Ask the assistant" shortcut="⌘J" onClick={handleAskAssistant} />
              </div>
            </>
          ) : hasResults ? (
            <>
              {/* Entities */}
              {shouldShow('entities') && results.entities.length > 0 && (
                <>
                  <SectionHeader label="Entities" count={results.entities.length} />
                  {results.entities.map((node) => {
                    const idx = runningIndex++;
                    return (
                      <ResultRow
                        key={node.id}
                        name={node.name}
                        query={query}
                        color={getColorForNode(node.type, (node as any).label)}
                        subtitle={(node as any).label ?? node.type}
                        selected={idx === selectedIndex}
                        onClick={() => handleSelectNode(node.id)}
                      />
                    );
                  })}
                </>
              )}

              {/* Notes */}
              {shouldShow('notes') && results.notes.length > 0 && (
                <>
                  <SectionHeader label="Notes" count={results.notes.length} border />
                  {results.notes.map((node) => {
                    const idx = runningIndex++;
                    return (
                      <ResultRow
                        key={node.id}
                        name={node.name}
                        query={query}
                        color={getColorForNode(node.type, null)}
                        subtitle="note"
                        selected={idx === selectedIndex}
                        onClick={() => handleSelectNode(node.id)}
                      />
                    );
                  })}
                </>
              )}

              {/* Resources */}
              {shouldShow('resources') && results.resources.length > 0 && (
                <>
                  <SectionHeader label="Resources" count={results.resources.length} border />
                  {results.resources.map((node) => {
                    const idx = runningIndex++;
                    return (
                      <ResultRow
                        key={node.id}
                        name={node.name}
                        query={query}
                        color={getColorForNode(node.type, null)}
                        subtitle="resource"
                        selected={idx === selectedIndex}
                        onClick={() => handleSelectNode(node.id)}
                      />
                    );
                  })}
                </>
              )}

              {/* Relationships */}
              {shouldShow('relationships') && results.edges.length > 0 && (
                <>
                  <SectionHeader label="Relationships" count={results.edges.length} border />
                  {results.edges.map((edge) => {
                    const idx = runningIndex++;
                    return (
                      <button
                        key={edge.id}
                        onClick={() => handleSelectEdge(edge.id, edge.source_id, edge.target_id)}
                        className={`w-full text-left flex items-center gap-2 px-4 py-2 cursor-pointer transition-colors ${
                          idx === selectedIndex ? 'bg-zinc-800' : 'hover:bg-zinc-800/50'
                        }`}
                      >
                        <span className="w-2 h-2 rounded-full bg-indigo-500 shrink-0" />
                        <span className="text-[13px] text-zinc-300 truncate">{edge.source_name}</span>
                        <span className="text-zinc-600 text-xs shrink-0">&rarr;</span>
                        <span className="text-indigo-400 text-xs shrink-0">{edge.label}</span>
                        <span className="text-zinc-600 text-xs shrink-0">&rarr;</span>
                        <span className="text-[13px] text-zinc-300 truncate">{edge.target_name}</span>
                      </button>
                    );
                  })}
                </>
              )}

              {/* Artifacts */}
              {shouldShow('artifacts') && results.artifacts.length > 0 && (
                <>
                  <SectionHeader label="Artifacts" count={results.artifacts.length} border />
                  {results.artifacts.map((artifact) => {
                    const idx = runningIndex++;
                    return (
                      <button
                        key={artifact.id}
                        onClick={() => handleSelectArtifact(artifact)}
                        className={`w-full text-left flex items-center gap-2.5 px-4 py-2 cursor-pointer transition-colors ${
                          idx === selectedIndex ? 'bg-zinc-800' : 'hover:bg-zinc-800/50'
                        }`}
                      >
                        <span className="shrink-0">{ARTIFACT_ICONS[artifact.type]}</span>
                        <span className="text-[13px] text-zinc-200 truncate">{artifact.title}</span>
                        <span className="text-[11px] text-zinc-500 ml-auto shrink-0">{ARTIFACT_TYPE_LABELS[artifact.type]}</span>
                      </button>
                    );
                  })}
                </>
              )}

              {/* Semantic matches */}
              {hasSemantic && (shouldShow('entities') || activeFilter === 'all') && (
                <>
                  <div className="flex items-center justify-between px-4 pt-2.5 pb-1 border-t border-zinc-700">
                    <div className="flex items-center gap-1.5">
                      <span className="text-[10px] font-medium text-zinc-500 uppercase tracking-wider">Semantic matches</span>
                      <span className="flex items-center gap-1 px-1.5 py-0.5 rounded-full bg-indigo-500/12 text-indigo-400 text-[10px] font-medium">
                        <SparkleIcon />
                        vector
                      </span>
                    </div>
                    <span className="text-[10px] text-zinc-500">{semanticResults.length}</span>
                  </div>
                  {semanticResults.map((node) => {
                    const idx = runningIndex++;
                    return (
                      <ResultRow
                        key={node.id}
                        name={node.name}
                        query={query}
                        color={getColorForNode(node.type, (node as any).label ?? null)}
                        subtitle={(node as any).label ?? node.type}
                        selected={idx === selectedIndex}
                        onClick={() => handleSelectNode(node.id)}
                      />
                    );
                  })}
                </>
              )}
            </>
          ) : searching ? (
            <div className="px-4 py-8 text-center text-xs text-zinc-600">
              Searching…
            </div>
          ) : (
            <div className="px-4 py-8 text-center text-xs text-zinc-600">
              No results for &ldquo;{query}&rdquo;
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center gap-3 px-4 py-2 border-t border-zinc-700 bg-zinc-900/50">
          <KbdHint keys={['↑', '↓']} label="navigate" />
          <KbdHint keys={['↵']} label="open" />
          <KbdHint keys={['tab']} label="filter" />
          <div className="ml-auto flex items-center gap-1.5 text-[11px] text-zinc-500">
            <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
              <circle cx="11" cy="11" r="8" /><path d="m21 21-4.35-4.35" />
            </svg>
            <span>FTS5</span>
            {hasSemantic && (
              <>
                <span className="text-zinc-600">+</span>
                <span className="flex items-center gap-1 text-indigo-400">
                  <SparkleIcon />
                  Semantic
                </span>
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── Sub-components ──────────────────────────────────────────

function SectionHeader({ label, count, border }: { label: string; count?: number; border?: boolean }) {
  return (
    <div className={`flex items-center justify-between px-4 pt-1.5 pb-0.5 text-[10px] font-medium text-zinc-500 uppercase tracking-wider ${border ? 'border-t border-zinc-700' : ''}`}>
      <span>{label}</span>
      {count != null && <span className="normal-case tracking-normal">{count}</span>}
    </div>
  );
}

function ResultRow({
  name,
  query,
  color,
  subtitle,
  selected,
  onClick,
}: {
  name: string;
  query: string;
  color: string;
  subtitle: string;
  selected?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className={`w-full text-left flex items-center gap-2.5 px-4 py-2 cursor-pointer transition-colors ${
        selected ? 'bg-zinc-800' : 'hover:bg-zinc-800/50'
      }`}
    >
      <span className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: color }} />
      <div className="flex-1 min-w-0">
        <div className="text-[13px] font-medium text-zinc-100 truncate">
          <HighlightedText text={name} query={query} />
        </div>
      </div>
      <span className="text-[11px] text-zinc-500 shrink-0">{subtitle}</span>
      {selected && <kbd className="text-[10px] px-1 py-0.5 border border-zinc-600 rounded text-zinc-500 bg-zinc-800 shrink-0">&crarr;</kbd>}
    </button>
  );
}

function HighlightedText({ text, query }: { text: string; query: string }) {
  if (!query || query.length < MIN_QUERY_LENGTH) return <>{text}</>;
  const escaped = query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const regex = new RegExp(`(${escaped})`, 'gi');
  const parts = text.split(regex);
  return (
    <>
      {parts.map((part, i) =>
        regex.test(part)
          ? <span key={i} className="bg-indigo-500/20 px-0.5 rounded-sm">{part}</span>
          : <span key={i}>{part}</span>
      )}
    </>
  );
}

function QuickAction({ icon, label, shortcut, onClick }: { icon: React.ReactNode; label: string; shortcut?: string; onClick?: () => void }) {
  return (
    <button
      onClick={onClick}
      className="w-full flex items-center gap-2.5 px-4 py-2 cursor-pointer hover:bg-zinc-800/50 transition-colors text-left"
    >
      <span className="text-zinc-500">{icon}</span>
      <span className="text-[13px] text-zinc-300">{label}</span>
      {shortcut && (
        <kbd className="ml-auto text-[11px] px-1 py-0.5 border border-zinc-600 rounded text-zinc-500 bg-zinc-800">{shortcut}</kbd>
      )}
    </button>
  );
}

function KbdHint({ keys, label }: { keys: string[]; label: string }) {
  return (
    <div className="flex items-center gap-1 text-[11px] text-zinc-500">
      {keys.map((k) => (
        <kbd key={k} className="px-1 py-0.5 border border-zinc-600 rounded text-[10px] bg-zinc-800">{k}</kbd>
      ))}
      <span>{label}</span>
    </div>
  );
}

// ─── Icons ───────────────────────────────────────────────────

const ARTIFACT_ICONS: Record<ArtifactType, string> = {
  jsx: '⚛', markdown: '📄', html: '🌐', svg: '◈', mermaid: '◇',
};

const SparkleIcon = () => (
  <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
    <path d="m12 3-1.9 5.8a2 2 0 0 1-1.3 1.3L3 12l5.8 1.9a2 2 0 0 1 1.3 1.3L12 21l1.9-5.8a2 2 0 0 1 1.3-1.3L21 12l-5.8-1.9a2 2 0 0 1-1.3-1.3Z" />
  </svg>
);

const PlusIcon = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M12 5v14M5 12h14" /></svg>
);

const NoteIcon = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z" /><path d="M14 2v4a2 2 0 0 0 2 2h4" />
  </svg>
);

const ChatIcon = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="m3 21 1.9-5.7a8.5 8.5 0 1 1 3.8 3.8z" />
  </svg>
);
