import type { ReadingListItem } from '../../../shared/types';
import { useReadingListStore } from '../../../graph/store/reading-list-store';

interface Props {
  item: ReadingListItem;
  selected: boolean;
  onSelect: () => void;
  onMerge: (item: ReadingListItem) => void;
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
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

export function ReadingListItemCard({ item, selected, onSelect, onMerge, isMerging }: Props) {
  const retryExtraction = useReadingListStore(s => s.retryExtraction);

  const isExtracting = ['fetching', 'extracting'].includes(item.status);
  const entityCount = item.extractedNodes?.length ?? 0;
  const edgeCount = item.extractedEdges?.length ?? 0;

  return (
    <div
      className={`px-3.5 py-3 rounded-lg border cursor-pointer transition-colors ${
        selected
          ? 'bg-zinc-800 border-indigo-500'
          : 'bg-zinc-800 border-zinc-700/50 hover:border-zinc-600'
      }`}
      onClick={onSelect}
    >
      {/* Top row: title + action button */}
      <div className="flex items-start justify-between gap-3">
        <h3 className="text-sm font-medium text-zinc-200 line-clamp-2 leading-tight flex-1 min-w-0">
          {item.pageTitle || item.title}
        </h3>
        {/* Always-visible action button */}
        {item.status === 'pending' && !isExtracting && (
          <button
            className="px-2.5 py-1 text-xs bg-indigo-600 hover:bg-indigo-500 text-white rounded-md transition-colors flex-shrink-0"
            onClick={(e) => {
              e.stopPropagation();
              retryExtraction(item.url);
            }}
          >
            Extract
          </button>
        )}
        {isExtracting && (
          <span className="text-xs text-blue-400 flex items-center gap-1 flex-shrink-0 py-1">
            <span className="animate-pulse">&bull;</span> Extracting...
          </span>
        )}
        {item.status === 'extracted' && (
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
        )}
        {item.status === 'failed' && (
          <button
            className="px-2.5 py-1 text-xs bg-zinc-700 hover:bg-zinc-600 text-zinc-200 rounded-md transition-colors flex-shrink-0"
            onClick={(e) => {
              e.stopPropagation();
              retryExtraction(item.url);
            }}
          >
            Retry
          </button>
        )}
      </div>

      {/* Metadata row */}
      <div className="flex items-center gap-2 mt-1.5">
        <span className="text-xs text-zinc-500">{getDomain(item.url)}</span>
        <span className="text-xs text-zinc-600">&middot;</span>
        <span className="text-xs text-zinc-500">{timeAgo(item.addedAt)}</span>
        {item.status === 'extracted' && entityCount > 0 && !selected && (
          <>
            <span className="text-xs text-zinc-600">&middot;</span>
            <span className="text-xs text-zinc-400">{entityCount} entities</span>
          </>
        )}
        {item.status === 'failed' && item.error && (
          <>
            <span className="text-xs text-zinc-600">&middot;</span>
            <span className="text-xs text-red-400 truncate">{item.error}</span>
          </>
        )}
      </div>

      {/* Expanded details (when selected + extracted) */}
      {selected && item.status === 'extracted' && (
        <>
          {item.summary && (
            <p className="text-xs text-zinc-400 mt-2 line-clamp-3 leading-relaxed">
              {item.summary}
            </p>
          )}
          {item.keyTopics && item.keyTopics.length > 0 && (
            <div className="flex flex-wrap gap-1 mt-2">
              {item.keyTopics.map((topic, i) => (
                <span key={i} className="px-1.5 py-0.5 text-xs bg-zinc-700/50 text-zinc-300 rounded">
                  {topic}
                </span>
              ))}
            </div>
          )}
          <div className="text-xs text-zinc-500 mt-2">
            {entityCount} entities &middot; {edgeCount} relationships
          </div>
        </>
      )}
    </div>
  );
}
