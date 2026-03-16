import type { ReadingListItem } from '../../../shared/types';
import { useReadingListStore } from '../../../graph/store/reading-list-store';

interface Props {
  item: ReadingListItem;
  selected: boolean;
  onSelect: () => void;
  onMerge: (item: ReadingListItem) => void;
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

export function ReadingListItemCard({ item, selected, onSelect, onMerge }: Props) {
  const retryExtraction = useReadingListStore(s => s.retryExtraction);

  const isExtracting = ['fetching', 'extracting'].includes(item.status);

  return (
    <div
      className={`px-3 py-2.5 border-b border-zinc-800 cursor-pointer hover:bg-zinc-800/50 transition-colors ${
        selected ? 'bg-zinc-800/80 border-l-2 border-l-indigo-500' : ''
      }`}
      onClick={onSelect}
    >
      {/* Title + domain */}
      <div className="flex items-start justify-between gap-2">
        <h3 className="text-sm font-medium text-zinc-200 line-clamp-2 leading-tight">
          {item.pageTitle || item.title}
        </h3>
      </div>
      <div className="flex items-center gap-2 mt-1">
        <span className="text-xs text-zinc-500">{getDomain(item.url)}</span>
        <span className="text-xs text-zinc-600">&middot;</span>
        <span className="text-xs text-zinc-500">{timeAgo(item.addedAt)}</span>
        {isExtracting && (
          <span className="text-xs text-blue-400 flex items-center gap-1">
            <span className="animate-pulse">&bull;</span> Extracting...
          </span>
        )}
        {item.status === 'pending' && (
          <span className="text-xs text-zinc-400">Awaiting extraction</span>
        )}
        {item.status === 'failed' && (
          <span className="text-xs text-red-400">Failed</span>
        )}
      </div>

      {/* Summary (when extracted) */}
      {item.status === 'extracted' && item.summary && (
        <p className="text-xs text-zinc-400 mt-2 line-clamp-3 leading-relaxed">
          {item.summary}
        </p>
      )}

      {/* Key topics */}
      {item.status === 'extracted' && item.keyTopics && item.keyTopics.length > 0 && selected && (
        <div className="flex flex-wrap gap-1 mt-2">
          {item.keyTopics.map((topic, i) => (
            <span key={i} className="px-1.5 py-0.5 text-xs bg-zinc-700/50 text-zinc-300 rounded">
              {topic}
            </span>
          ))}
        </div>
      )}

      {/* Entity count */}
      {item.status === 'extracted' && selected && (
        <div className="text-xs text-zinc-500 mt-2">
          {item.extractedNodes?.length ?? 0} entities &middot; {item.extractedEdges?.length ?? 0} relationships
        </div>
      )}

      {/* Actions (when selected) */}
      {selected && (
        <div className="flex gap-2 mt-2">
          {item.status === 'pending' && (
            <button
              className="px-2.5 py-1 text-xs bg-indigo-600 hover:bg-indigo-500 text-white rounded transition-colors"
              onClick={(e) => {
                e.stopPropagation();
                retryExtraction(item.url);
              }}
            >
              Extract
            </button>
          )}
          {item.status === 'extracted' && (
            <button
              className="px-2.5 py-1 text-xs bg-indigo-600 hover:bg-indigo-500 text-white rounded transition-colors"
              onClick={(e) => {
                e.stopPropagation();
                onMerge(item);
              }}
            >
              Review &amp; Merge
            </button>
          )}
          {item.status === 'failed' && (
            <button
              className="px-2.5 py-1 text-xs bg-zinc-700 hover:bg-zinc-600 text-zinc-200 rounded transition-colors"
              onClick={(e) => {
                e.stopPropagation();
                retryExtraction(item.url);
              }}
            >
              Retry
            </button>
          )}
          {item.error && (
            <span className="text-xs text-red-400/80 self-center">{item.error}</span>
          )}
        </div>
      )}
    </div>
  );
}
