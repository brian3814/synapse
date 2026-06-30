import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { useArtifactStore } from '../../../graph/store/artifact-store';
import { useUIStore } from '../../../graph/store/ui-store';
import { ARTIFACT_TYPE_LABELS, type ArtifactType, type ArtifactRecord } from '../../../shared/artifact-types';
import { MarkdownRenderer } from '../shared/MarkdownRenderer';
import { SvgRenderer } from '../artifacts/SvgRenderer';
import { MermaidRenderer } from '../artifacts/MermaidRenderer';
import { HtmlRenderer } from '../artifacts/HtmlRenderer';
import { JsxRenderer } from '../artifacts/JsxRenderer';

const ARTIFACT_ICONS: Record<ArtifactType, string> = {
  jsx: '⚛', markdown: '📄', html: '🌐', svg: '◈', mermaid: '◇',
};

const ALL_TYPES: ArtifactType[] = ['jsx', 'markdown', 'html', 'svg', 'mermaid'];

type ViewMode = 'preview' | 'source';

export function ArtifactBrowserTab() {
  const artifacts = useArtifactStore((s) => s.artifacts);
  const loadArtifacts = useArtifactStore((s) => s.loadArtifacts);
  const searchArtifacts = useArtifactStore((s) => s.searchArtifacts);
  const getArtifactContent = useArtifactStore((s) => s.getArtifactContent);
  const openContentTab = useUIStore((s) => s.openContentTab);

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [content, setContent] = useState('');
  const [contentLoading, setContentLoading] = useState(false);
  const [query, setQuery] = useState('');
  const [typeFilter, setTypeFilter] = useState<ArtifactType | null>(null);
  const [mode, setMode] = useState<ViewMode>('preview');
  const [searchResults, setSearchResults] = useState<ArtifactRecord[] | null>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout>>(undefined);

  useEffect(() => { loadArtifacts(); }, [loadArtifacts]);

  const filtered = useMemo(() => {
    const source = searchResults ?? artifacts;
    if (!typeFilter) return source;
    return source.filter((a) => a.type === typeFilter);
  }, [artifacts, searchResults, typeFilter]);

  const selected = useMemo(
    () => (selectedId ? artifacts.find((a) => a.id === selectedId) ?? null : null),
    [artifacts, selectedId],
  );

  useEffect(() => {
    if (!selectedId) return;
    let cancelled = false;
    setContentLoading(true);
    getArtifactContent(selectedId).then((c) => {
      if (!cancelled) { setContent(c); setContentLoading(false); }
    }).catch(() => { if (!cancelled) setContentLoading(false); });
    return () => { cancelled = true; };
  }, [selectedId, getArtifactContent]);

  const handleSearch = useCallback((value: string) => {
    setQuery(value);
    clearTimeout(debounceRef.current);
    if (!value.trim()) {
      setSearchResults(null);
      return;
    }
    debounceRef.current = setTimeout(async () => {
      const results = await searchArtifacts(value);
      setSearchResults(results);
    }, 200);
  }, [searchArtifacts]);

  const handleCopy = useCallback(() => {
    navigator.clipboard.writeText(content);
  }, [content]);

  const handleOpenInTab = useCallback(() => {
    if (!selected) return;
    openContentTab({ kind: 'artifact', artifactId: selected.id }, selected.title);
  }, [selected, openContentTab]);

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
    <div className="h-full flex flex-col bg-zinc-900">
      {/* Toolbar */}
      <div className="flex items-center gap-2.5 px-4 py-2.5 border-b border-zinc-700 shrink-0 flex-wrap">
        <span className="text-[15px] font-semibold text-zinc-100">Artifacts</span>
        <span className="text-xs text-zinc-500">{filtered.length}</span>
        <div className="flex-1" />
        <div className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-md border border-zinc-700 text-xs text-zinc-500 min-w-[140px]">
          <SearchIcon />
          <input
            value={query}
            onChange={(e) => handleSearch(e.target.value)}
            placeholder="Search..."
            className="flex-1 bg-transparent outline-none text-zinc-300 placeholder-zinc-600 text-xs"
          />
        </div>
        <div className="flex gap-1 flex-wrap">
          <FilterBtn active={typeFilter === null} onClick={() => setTypeFilter(null)}>All</FilterBtn>
          {ALL_TYPES.map((t) => (
            <FilterBtn key={t} active={typeFilter === t} onClick={() => setTypeFilter(typeFilter === t ? null : t)}>
              {ARTIFACT_ICONS[t]} {ARTIFACT_TYPE_LABELS[t]}
            </FilterBtn>
          ))}
        </div>
      </div>

      {/* Split: list + preview */}
      <div className="flex-1 flex min-h-0">
        {/* Artifact list */}
        <div className="w-[min(280px,35%)] shrink-0 border-r border-zinc-700 overflow-y-auto">
          {filtered.length === 0 ? (
            <div className="text-xs text-zinc-600 text-center py-8">No artifacts found</div>
          ) : (
            filtered.map((artifact) => (
              <button
                key={artifact.id}
                onClick={() => { setSelectedId(artifact.id); setMode('preview'); }}
                className={`w-full text-left px-3 py-2.5 border-l-2 transition-colors ${
                  artifact.id === selectedId
                    ? 'bg-zinc-800 border-l-indigo-500'
                    : 'border-l-transparent hover:bg-zinc-800/50'
                }`}
              >
                <div className="flex items-center gap-2">
                  <span className="text-sm shrink-0">{ARTIFACT_ICONS[artifact.type]}</span>
                  <span className="text-xs text-zinc-200 truncate flex-1">{artifact.title}</span>
                </div>
                <div className="text-[10px] text-zinc-600 mt-0.5 ml-6">
                  {ARTIFACT_TYPE_LABELS[artifact.type]} &middot; {formatTime(artifact.updatedAt)}
                </div>
              </button>
            ))
          )}
        </div>

        {/* Preview pane */}
        {selected ? (
          <div className="flex-1 flex flex-col min-w-0">
            {/* Preview toolbar */}
            <div className="flex items-center gap-2 px-3 py-2 border-b border-zinc-700 shrink-0 flex-wrap">
              <span className="text-[13px] font-medium text-zinc-100 truncate">{selected.title}</span>
              <span className="text-[10px] bg-purple-900/40 text-purple-400 px-1.5 py-0.5 rounded shrink-0">
                {ARTIFACT_TYPE_LABELS[selected.type]}
              </span>
              <div className="flex-1" />
              <div className="flex bg-zinc-800 rounded-md p-0.5">
                <button
                  onClick={() => setMode('preview')}
                  className={`px-2 py-0.5 text-[10px] rounded transition-colors ${mode === 'preview' ? 'bg-indigo-600 text-white' : 'text-zinc-400 hover:text-zinc-200'}`}
                >
                  Preview
                </button>
                <button
                  onClick={() => setMode('source')}
                  className={`px-2 py-0.5 text-[10px] rounded transition-colors ${mode === 'source' ? 'bg-indigo-600 text-white' : 'text-zinc-400 hover:text-zinc-200'}`}
                >
                  Source
                </button>
              </div>
              <button
                onClick={handleOpenInTab}
                className="flex items-center gap-1 px-2 py-0.5 text-[10px] border border-zinc-700 rounded text-zinc-400 hover:text-zinc-200 hover:border-zinc-600 transition-colors"
              >
                <ExternalIcon />
                Open in Tab
              </button>
              <button
                onClick={handleCopy}
                className="px-2 py-0.5 bg-zinc-800 text-zinc-300 text-[10px] rounded hover:bg-zinc-700"
              >
                Copy
              </button>
            </div>

            {/* Preview content */}
            <div className="flex-1 min-h-0 overflow-hidden">
              {contentLoading ? (
                <div className="h-full flex items-center justify-center">
                  <span className="text-xs text-zinc-500">Loading...</span>
                </div>
              ) : mode === 'preview' ? (
                <ArtifactPreview type={selected.type} content={content} />
              ) : (
                <pre className="p-4 text-zinc-400 text-xs font-mono overflow-auto h-full">{content}</pre>
              )}
            </div>

            {/* Timestamp footer */}
            <div className="flex items-center gap-4 px-3 py-1.5 border-t border-zinc-700 shrink-0">
              <span className="text-[10px] text-zinc-600">Created {formatTime(selected.createdAt)}</span>
              <span className="text-[10px] text-zinc-600">Modified {formatTime(selected.updatedAt)}</span>
            </div>
          </div>
        ) : (
          <div className="flex-1 flex items-center justify-center">
            <span className="text-xs text-zinc-600">Select an artifact to preview</span>
          </div>
        )}
      </div>
    </div>
  );
}

function ArtifactPreview({ type, content }: { type: ArtifactType; content: string }) {
  switch (type) {
    case 'markdown':
      return <div className="h-full overflow-y-auto p-4"><MarkdownRenderer content={content} /></div>;
    case 'svg':
      return <SvgRenderer content={content} />;
    case 'mermaid':
      return <MermaidRenderer content={content} />;
    case 'html':
      return <HtmlRenderer content={content} />;
    case 'jsx':
      return <JsxRenderer content={content} />;
    default:
      return <pre className="p-4 text-zinc-400 text-xs font-mono overflow-auto h-full">{content}</pre>;
  }
}

function FilterBtn({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      onClick={onClick}
      className={`px-2 py-0.5 rounded text-[10px] border transition-colors ${
        active
          ? 'bg-zinc-800 text-zinc-100 border-zinc-600'
          : 'text-zinc-500 border-zinc-700 hover:text-zinc-300'
      }`}
    >
      {children}
    </button>
  );
}

const SearchIcon = () => (
  <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
    <circle cx="11" cy="11" r="8" /><line x1="21" y1="21" x2="16.65" y2="16.65" />
  </svg>
);

const ExternalIcon = () => (
  <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
    <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/>
  </svg>
);
