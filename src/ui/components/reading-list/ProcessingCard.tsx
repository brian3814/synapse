import type { ReadingListResource } from '../../../shared/reading-list-types';
import { isUrlSource, isFileSource } from '../../../shared/reading-list-types';
import { useUIStore } from '../../../graph/store/ui-store';

interface Props {
  item: ReadingListResource;
}

function getDomain(url: string): string {
  try {
    return new URL(url).hostname.replace('www.', '');
  } catch {
    return url;
  }
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

export function ProcessingCard({ item }: Props) {
  const sourceLabel = getSourceLabel(item);

  const handleDetail = (e: React.MouseEvent) => {
    e.stopPropagation();
    useUIStore.getState().openContentTab(
      { kind: 'extractionProgress', resourceId: item.id },
      'Extracting: ' + item.title,
    );
  };

  return (
    <div className="rounded-lg bg-zinc-800 border border-zinc-700/50 overflow-hidden">
      <div className="flex items-center gap-2 px-3 py-2.5">
        <h3 className="text-sm font-medium text-zinc-200 line-clamp-1 leading-tight flex-1 min-w-0">
          {item.title}
        </h3>
        <span className="text-xs text-blue-400 flex items-center gap-1 flex-shrink-0">
          <span className="w-1.5 h-1.5 bg-blue-400 rounded-full animate-pulse" />
          Extracting...
        </span>
        <button
          onClick={handleDetail}
          className="px-2 py-1 text-xs bg-zinc-700 hover:bg-zinc-600 text-zinc-200 rounded transition-colors flex-shrink-0"
        >
          Detail
        </button>
      </div>
      <div className="px-3 pb-2.5 flex items-center gap-2">
        <span className="text-xs text-zinc-500">{sourceLabel}</span>
      </div>
    </div>
  );
}
