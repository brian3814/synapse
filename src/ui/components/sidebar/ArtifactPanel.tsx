import { useState, useEffect, useCallback, useMemo } from 'react';
import { useArtifactStore } from '../../../graph/store/artifact-store';
import { useUIStore } from '../../../graph/store/ui-store';
import { ARTIFACT_TYPE_LABELS, type ArtifactType } from '../../../shared/artifact-types';

const TYPE_ICONS: Record<ArtifactType, string> = {
  jsx: '⚛', markdown: '📄', html: '🌐', svg: '◈', mermaid: '◇',
};

const ALL_TYPES: ArtifactType[] = ['jsx', 'markdown', 'html', 'svg', 'mermaid'];

export function ArtifactPanel() {
  const artifacts = useArtifactStore((s) => s.artifacts);
  const loading = useArtifactStore((s) => s.loading);
  const loadArtifacts = useArtifactStore((s) => s.loadArtifacts);
  const searchArtifacts = useArtifactStore((s) => s.searchArtifacts);
  const openContentTab = useUIStore((s) => s.openContentTab);

  const [query, setQuery] = useState('');
  const [typeFilter, setTypeFilter] = useState<ArtifactType | null>(null);
  const [searchResults, setSearchResults] = useState<typeof artifacts | null>(null);

  useEffect(() => { loadArtifacts(); }, [loadArtifacts]);

  useEffect(() => {
    if (!query.trim()) { setSearchResults(null); return; }
    const timer = setTimeout(async () => {
      const results = await searchArtifacts(query);
      setSearchResults(results);
    }, 200);
    return () => clearTimeout(timer);
  }, [query, searchArtifacts]);

  const displayedArtifacts = useMemo(() => {
    const base = searchResults ?? artifacts;
    if (!typeFilter) return base;
    return base.filter((a) => a.type === typeFilter);
  }, [artifacts, searchResults, typeFilter]);

  const handleOpen = useCallback(
    (artifact: typeof artifacts[0]) => {
      openContentTab({ kind: 'artifact', artifactId: artifact.id }, artifact.title);
    },
    [openContentTab],
  );

  const formatTime = (iso: string) => {
    const diff = Date.now() - new Date(iso).getTime();
    const mins = Math.floor(diff / 60000);
    if (mins < 1) return 'just now';
    if (mins < 60) return `${mins}m ago`;
    const hours = Math.floor(mins / 60);
    if (hours < 24) return `${hours}h ago`;
    return `${Math.floor(hours / 24)}d ago`;
  };

  return (
    <div className="h-full flex flex-col bg-zinc-800">
      <div className="p-2">
        <input
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search artifacts..."
          className="w-full bg-zinc-900 border border-zinc-700 rounded-md px-2.5 py-1.5 text-xs text-zinc-200 placeholder-zinc-500 focus:outline-none focus:border-indigo-500"
        />
      </div>
      <div className="px-2 pb-2 flex gap-1 flex-wrap">
        <button
          onClick={() => setTypeFilter(null)}
          className={`px-2 py-0.5 rounded-full text-[10px] transition-colors ${
            !typeFilter ? 'bg-indigo-600 text-white' : 'bg-zinc-700 text-zinc-400 hover:text-zinc-200'
          }`}
        >All</button>
        {ALL_TYPES.map((t) => (
          <button
            key={t}
            onClick={() => setTypeFilter(typeFilter === t ? null : t)}
            className={`px-2 py-0.5 rounded-full text-[10px] transition-colors ${
              typeFilter === t ? 'bg-indigo-600 text-white' : 'bg-zinc-700 text-zinc-400 hover:text-zinc-200'
            }`}
          >{ARTIFACT_TYPE_LABELS[t]}</button>
        ))}
      </div>
      <div className="flex-1 overflow-y-auto px-1.5">
        {loading ? (
          <p className="text-zinc-500 text-xs text-center mt-8">Loading...</p>
        ) : displayedArtifacts.length === 0 ? (
          <p className="text-zinc-500 text-xs text-center mt-8">No artifacts yet</p>
        ) : (
          displayedArtifacts.map((a) => (
            <button
              key={a.id}
              onClick={() => handleOpen(a)}
              className="w-full text-left rounded-md px-2.5 py-2 mb-0.5 hover:bg-zinc-700/50 transition-colors"
            >
              <div className="flex items-center gap-2">
                <span className="text-sm shrink-0">{TYPE_ICONS[a.type]}</span>
                <div className="min-w-0">
                  <div className="text-zinc-200 text-xs truncate">{a.title}</div>
                  <div className="text-zinc-500 text-[10px]">
                    {ARTIFACT_TYPE_LABELS[a.type]} · {formatTime(a.updatedAt)}
                  </div>
                </div>
              </div>
            </button>
          ))
        )}
      </div>
    </div>
  );
}
