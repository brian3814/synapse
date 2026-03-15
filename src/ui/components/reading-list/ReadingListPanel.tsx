import { useReadingListStore } from '../../../graph/store/reading-list-store';
import { ReadingListItemCard } from './ReadingListItemCard';

export function ReadingListPanel() {
  const { items, loading, selectedUrl, selectItem } = useReadingListStore();

  const itemList = Object.values(items);
  const extracted = itemList.filter(i => i.status === 'extracted');
  const processing = itemList.filter(i => ['pending', 'fetching', 'extracting'].includes(i.status));
  const failed = itemList.filter(i => i.status === 'failed');

  if (loading) {
    return <div className="p-4 text-zinc-400">Loading reading list...</div>;
  }

  if (itemList.length === 0) {
    return (
      <div className="p-6 text-center">
        <div className="text-zinc-400 text-sm">
          <p className="mb-2 font-medium text-zinc-300">No reading list items</p>
          <p>Add pages to your Chrome Reading List and they'll appear here with auto-generated summaries.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full overflow-hidden">
      <div className="px-3 py-2 border-b border-zinc-700/50 flex-shrink-0">
        <h2 className="text-sm font-medium text-zinc-200">Reading List</h2>
        <p className="text-xs text-zinc-500 mt-0.5">
          {extracted.length} ready · {processing.length} processing · {failed.length} failed
        </p>
      </div>
      <div className="flex-1 overflow-y-auto min-h-0">
        {/* Ready to review */}
        {extracted.length > 0 && (
          <div>
            <div className="px-3 py-1.5 text-xs font-medium text-emerald-400 bg-emerald-500/5">
              Ready to review
            </div>
            {extracted.map(item => (
              <ReadingListItemCard
                key={item.url}
                item={item}
                selected={selectedUrl === item.url}
                onSelect={() => selectItem(selectedUrl === item.url ? null : item.url)}
              />
            ))}
          </div>
        )}
        {/* Processing */}
        {processing.length > 0 && (
          <div>
            <div className="px-3 py-1.5 text-xs font-medium text-blue-400 bg-blue-500/5">
              Processing
            </div>
            {processing.map(item => (
              <ReadingListItemCard
                key={item.url}
                item={item}
                selected={selectedUrl === item.url}
                onSelect={() => selectItem(selectedUrl === item.url ? null : item.url)}
              />
            ))}
          </div>
        )}
        {/* Failed */}
        {failed.length > 0 && (
          <div>
            <div className="px-3 py-1.5 text-xs font-medium text-red-400 bg-red-500/5">
              Failed
            </div>
            {failed.map(item => (
              <ReadingListItemCard
                key={item.url}
                item={item}
                selected={selectedUrl === item.url}
                onSelect={() => selectItem(selectedUrl === item.url ? null : item.url)}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
