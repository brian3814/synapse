import { useState } from 'react';
import type { ReadingListResource } from '../../../shared/reading-list-types';
import { isFileSource, isUrlSource } from '../../../shared/reading-list-types';
import { useReadingListStore } from '../../../graph/store/reading-list-store';

interface Props {
  item: ReadingListResource;
  selectMode?: boolean;
  checked: boolean;
  onCheck: () => void;
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

export function PendingCard({ item, selectMode, checked, onCheck }: Props) {
  const retryResource = useReadingListStore((s) => s.retryResource);
  const [errorExpanded, setErrorExpanded] = useState(false);

  const hasError = Boolean(item.error);
  const sourceLabel = getSourceLabel(item);
  const isFile = isFileSource(item.source);
  const isHttp = isUrlSource(item.source) && item.source.url.startsWith('http://');

  const cardBorderClass = hasError
    ? 'border-l-[3px] border-l-red-500 border-t border-r border-b border-zinc-700/50'
    : 'border border-zinc-700/50';

  return (
    <div className={`flex items-start gap-2.5 px-3 py-2.5 rounded-lg bg-zinc-800 ${cardBorderClass}`}>
      {selectMode && !hasError && (
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
            {item.title}
          </h3>
          <div className="flex items-center gap-1.5 flex-shrink-0">
            {hasError && (
              <>
                <span className="px-1.5 py-0.5 text-[10px] bg-red-500/20 text-red-400 rounded">
                  Failed · {item.error!.attempts} {item.error!.attempts === 1 ? 'attempt' : 'attempts'}
                </span>
                <button
                  className="px-2 py-1 text-xs bg-zinc-700 hover:bg-zinc-600 text-zinc-200 rounded transition-colors"
                  onClick={(e) => { e.stopPropagation(); setErrorExpanded((v) => !v); }}
                >
                  Detail
                </button>
                <button
                  className="px-2.5 py-1 text-xs bg-zinc-700 hover:bg-zinc-600 text-zinc-200 rounded-md transition-colors"
                  onClick={(e) => { e.stopPropagation(); retryResource(item.id); }}
                >
                  Retry
                </button>
              </>
            )}
            {!hasError && !selectMode && (
              <button
                className="px-2.5 py-1 text-xs bg-indigo-600 hover:bg-indigo-500 text-white rounded-md transition-colors"
                onClick={(e) => { e.stopPropagation(); retryResource(item.id); }}
              >
                Extract
              </button>
            )}
          </div>
        </div>

        <div className="flex items-center gap-2 mt-1 flex-wrap">
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
          {isFile && (
            <>
              <span className="text-xs text-zinc-600">&middot;</span>
              {isFileSource(item.source) && item.source.vaultPath ? (
                <span className="px-1.5 py-0.5 text-[10px] bg-indigo-500/20 text-indigo-300 rounded">in vault</span>
              ) : (
                <span className="px-1.5 py-0.5 text-[10px] bg-zinc-700/50 text-zinc-400 rounded">external</span>
              )}
            </>
          )}
          <span className="text-xs text-zinc-600">&middot;</span>
          <span className="text-xs text-zinc-500">{timeAgo(item.addedAt)}</span>
        </div>

        {hasError && errorExpanded && (
          <div className="mt-2 p-2 bg-zinc-900/60 rounded border border-red-900/30">
            {item.error!.stage && (
              <div className="text-xs text-zinc-500 mb-1">
                Stage: <span className="text-zinc-400">{item.error!.stage}</span>
              </div>
            )}
            <div className="text-xs text-zinc-500 mb-1">
              Failed: <span className="text-zinc-400">{new Date(item.error!.failedAt).toLocaleString()}</span>
            </div>
            <pre className="text-xs text-red-300 font-mono whitespace-pre-wrap break-all mt-1">
              {item.error!.message}
            </pre>
          </div>
        )}
      </div>
    </div>
  );
}
