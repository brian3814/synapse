import type { ReadingListResource } from '../../../shared/reading-list-types';
import { isUrlSource, isFileSource } from '../../../shared/reading-list-types';

interface Props {
  item: ReadingListResource;
  selected: boolean;
  onSelect: () => void;
  onMerge: (item: ReadingListResource) => void;
  isMerging?: boolean;
}

function getDomain(url: string): string {
  try {
    return new URL(url).hostname.replace('www.', '');
  } catch {
    return url;
  }
}

function timeAgo(timestamp: number): string {
  const seconds = Math.floor((Date.now() - timestamp) / 1000);
  if (seconds < 60) return 'just now';
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

function getSourceLabel(item: ReadingListResource): string {
  if (isUrlSource(item.source)) {
    return getDomain(item.source.url);
  }
  if (isFileSource(item.source)) {
    const path = item.source.filePath;
    return path.split('/').pop() ?? path;
  }
  return '';
}

export function ReadyCard({ item, selected, onSelect, onMerge, isMerging }: Props) {
  const entityCount = item.extraction?.nodes.length ?? 0;
  const edgeCount = item.extraction?.edges.length ?? 0;
  const matchCount = item.similarityMatches?.length ?? 0;
  const sourceLabel = getSourceLabel(item);
  const isHttp = isUrlSource(item.source) && item.source.url.startsWith('http://');

  return (
    <div
      className={`px-3.5 py-3 rounded-lg border cursor-pointer transition-colors ${
        selected
          ? 'bg-zinc-800 border-indigo-500'
          : 'bg-zinc-800 border-zinc-700/50 hover:border-zinc-600'
      }`}
      onClick={onSelect}
    >
      <div className="flex items-start justify-between gap-3">
        <h3 className="text-sm font-medium text-zinc-200 line-clamp-2 leading-tight flex-1 min-w-0">
          {item.title}
        </h3>
        <button
          className={`px-2.5 py-1 text-xs rounded-md transition-colors flex-shrink-0 flex items-center gap-1.5 ${
            isMerging
              ? 'bg-indigo-600/50 text-indigo-200 cursor-wait'
              : 'bg-indigo-600 hover:bg-indigo-500 text-white'
          }`}
          disabled={isMerging}
          onClick={(e) => {
            e.stopPropagation();
            onMerge(item);
          }}
        >
          {isMerging && (
            <svg className="animate-spin h-3 w-3" viewBox="0 0 24 24" fill="none">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
            </svg>
          )}
          {isMerging ? 'Preparing...' : 'Review & Merge'}
        </button>
      </div>

      <div className="flex items-center gap-2 mt-1.5 flex-wrap">
        <span className="text-xs text-zinc-500">{sourceLabel}</span>
        {isHttp && (
          <>
            <span className="text-xs text-zinc-600">&middot;</span>
            <svg
              width="12"
              height="12"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              className="text-amber-500 flex-shrink-0"
              aria-label="Insecure connection (HTTP)"
            >
              <title>Insecure connection (HTTP)</title>
              <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
              <line x1="12" y1="8" x2="12" y2="12" />
              <line x1="12" y1="16" x2="12.01" y2="16" />
            </svg>
          </>
        )}
        <span className="text-xs text-zinc-600">&middot;</span>
        <span className="text-xs text-zinc-500">{timeAgo(item.addedAt)}</span>
        {entityCount > 0 && !selected && (
          <>
            <span className="text-xs text-zinc-600">&middot;</span>
            <span className="text-xs text-zinc-400">{entityCount} entities</span>
          </>
        )}
        {matchCount > 0 && !selected && (
          <>
            <span className="text-xs text-zinc-600">&middot;</span>
            <span className="px-1.5 py-0.5 text-[10px] bg-amber-500/20 text-amber-400 rounded">
              {matchCount} {matchCount === 1 ? 'match' : 'matches'}
            </span>
          </>
        )}
      </div>

      {selected && (
        <>
          {item.extraction?.summary && (
            <p className="text-xs text-zinc-400 mt-2 line-clamp-3 leading-relaxed">
              {item.extraction.summary}
            </p>
          )}
          {item.extraction?.keyTopics && item.extraction.keyTopics.length > 0 && (
            <div className="flex flex-wrap gap-1 mt-2">
              {item.extraction.keyTopics.map((topic, i) => (
                <span key={i} className="px-1.5 py-0.5 text-xs bg-zinc-700/50 text-zinc-300 rounded">
                  {topic}
                </span>
              ))}
            </div>
          )}
          <div className="flex items-center gap-2 mt-2">
            <span className="text-xs text-zinc-500">
              {entityCount} entities &middot; {edgeCount} relationships
            </span>
            {matchCount > 0 && (
              <>
                <span className="text-xs text-zinc-600">&middot;</span>
                <span className="px-1.5 py-0.5 text-[10px] bg-amber-500/20 text-amber-400 rounded">
                  {matchCount} {matchCount === 1 ? 'match' : 'matches'} in graph
                </span>
              </>
            )}
          </div>
        </>
      )}
    </div>
  );
}
