import type { ReadingListItem } from '../../../shared/types';
import { useReadingListStore } from '../../../graph/store/reading-list-store';

interface Props {
  item: ReadingListItem;
  mode: 'pending' | 'processing' | 'ready';
  selectMode?: boolean;
  selected: boolean;
  checked: boolean;
  expanded: boolean;
  onSelect: () => void;
  onCheck: () => void;
  onToggleExpand: () => void;
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
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} ${hours === 1 ? 'hour' : 'hours'} ago`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days} ${days === 1 ? 'day' : 'days'} ago`;
  const weeks = Math.floor(days / 7);
  if (days < 30) return `${weeks} ${weeks === 1 ? 'week' : 'weeks'} ago`;
  const months = Math.floor(days / 30);
  if (days < 365) return `${months} ${months === 1 ? 'month' : 'months'} ago`;
  const years = Math.floor(days / 365);
  return `${years} ${years === 1 ? 'year' : 'years'} ago`;
}

function HttpWarningIcon() {
  return (
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
  );
}

export function ReadingListItemCard({ item, mode, selectMode, selected, checked, expanded, onSelect, onCheck, onToggleExpand, onMerge, isMerging }: Props) {
  const retryExtraction = useReadingListStore((s) => s.retryExtraction);
  const entityCount = item.extractedNodes?.length ?? 0;
  const edgeCount = item.extractedEdges?.length ?? 0;

  if (mode === 'pending') {
    return (
      <div className="flex items-start gap-2.5 px-3 py-2.5 rounded-lg bg-zinc-800 border border-zinc-700/50">
        {selectMode && item.status === 'pending' && (
          <input
            type="checkbox"
            checked={checked}
            onChange={onCheck}
            className="mt-0.5 accent-indigo-500 flex-shrink-0"
          />
        )}
        <div className="flex-1 min-w-0">
          <div className="flex items-start justify-between gap-2">
            <h3 className="text-sm font-medium text-zinc-200 line-clamp-1 leading-tight flex-1 min-w-0">
              {item.pageTitle || item.title}
            </h3>
            {!selectMode && item.status === 'pending' && (
              <button
                className="px-2.5 py-1 text-xs bg-indigo-600 hover:bg-indigo-500 text-white rounded-md transition-colors flex-shrink-0"
                onClick={(e) => { e.stopPropagation(); retryExtraction(item.url); }}
              >
                Extract
              </button>
            )}
          </div>
          <div className="flex items-center gap-2 mt-1">
            <span className="text-xs text-zinc-500">{getDomain(item.url)}</span>
            {item.url.startsWith('http://') && (
              <>
                <span className="text-xs text-zinc-600">&middot;</span>
                <HttpWarningIcon />
              </>
            )}
            <span className="text-xs text-zinc-600">&middot;</span>
            <span className="text-xs text-zinc-500">Added {timeAgo(item.addedAt)}</span>
          </div>
          {item.status === 'failed' && item.error && (
            <div className="flex items-center gap-2 mt-1.5">
              <span className="text-xs text-red-400 truncate">{item.error}</span>
              <button
                onClick={() => retryExtraction(item.url)}
                className="px-2 py-0.5 text-xs bg-zinc-700 hover:bg-zinc-600 text-zinc-200 rounded transition-colors flex-shrink-0"
              >
                Retry
              </button>
            </div>
          )}
        </div>
      </div>
    );
  }

  if (mode === 'processing') {
    return (
      <div className="rounded-lg bg-zinc-800 border border-zinc-700/50 overflow-hidden">
        <button
          onClick={onToggleExpand}
          className="w-full flex items-center gap-2 px-3 py-2.5 text-left hover:bg-zinc-750 transition-colors"
        >
          <svg
            width="10"
            height="10"
            viewBox="0 0 10 10"
            fill="currentColor"
            className={`text-zinc-500 flex-shrink-0 transition-transform ${expanded ? 'rotate-90' : ''}`}
          >
            <path d="M3 1l4 4-4 4z" />
          </svg>
          <h3 className="text-sm font-medium text-zinc-200 line-clamp-1 leading-tight flex-1 min-w-0">
            {item.pageTitle || item.title}
          </h3>
          <span className="text-xs text-blue-400 flex items-center gap-1 flex-shrink-0">
            <span className="w-1.5 h-1.5 bg-blue-400 rounded-full animate-pulse" />
            Extracting
          </span>
        </button>
        {expanded && (
          <div className="px-3 pb-3 border-t border-zinc-700/30">
            <div className="flex items-center gap-2 mt-2.5">
              <div className="w-3.5 h-3.5 border-2 border-indigo-500 border-t-transparent rounded-full animate-spin flex-shrink-0" />
              <span className="text-xs text-zinc-400">Fetching and analyzing content...</span>
            </div>
            <div className="mt-2 text-xs text-zinc-500">
              {getDomain(item.url)}
            </div>
          </div>
        )}
      </div>
    );
  }

  // mode === 'ready'
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
          {item.pageTitle || item.title}
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

      <div className="flex items-center gap-2 mt-1.5">
        <span className="text-xs text-zinc-500">{getDomain(item.url)}</span>
        {item.url.startsWith('http://') && (
          <>
            <span className="text-xs text-zinc-600">&middot;</span>
            <HttpWarningIcon />
          </>
        )}
        <span className="text-xs text-zinc-600">&middot;</span>
        <span className="text-xs text-zinc-500">Added {timeAgo(item.addedAt)}</span>
        {entityCount > 0 && !selected && (
          <>
            <span className="text-xs text-zinc-600">&middot;</span>
            <span className="text-xs text-zinc-400">{entityCount} entities</span>
          </>
        )}
      </div>

      {selected && (
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
