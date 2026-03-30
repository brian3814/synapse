import { useState, useEffect } from 'react';
import { useReadingListStore } from '../../../graph/store/reading-list-store';
import { useReadingListMerge } from '../../hooks/useReadingListMerge';
import { ReadingListItemCard } from './ReadingListItemCard';
import type { ReadingListItem } from '../../../shared/types';

type Tab = 'pending' | 'ready' | 'failed';
type SortBy = 'newest' | 'oldest' | 'domain';

function getDomain(url: string): string {
  try {
    return new URL(url).hostname.replace('www.', '');
  } catch {
    return url;
  }
}

export function ReadingListPanel() {
  const { items, loading, selectedUrl, selectItem } = useReadingListStore();
  const { startMerge } = useReadingListMerge();
  const [activeTab, setActiveTab] = useState<Tab>('pending');
  const [filterText, setFilterText] = useState('');
  const [sortBy, setSortBy] = useState<SortBy>('newest');
  const [mergingUrl, setMergingUrl] = useState<string | null>(null);

  useEffect(() => {
    setFilterText('');
    setSortBy('newest');
  }, [activeTab]);

  const itemList = Object.values(items);
  const extracted = itemList.filter(i => i.status === 'extracted');
  const pending = itemList.filter(i => i.status === 'pending' || i.status === 'fetching' || i.status === 'extracting');
  const failed = itemList.filter(i => i.status === 'failed');

  const handleMerge = async (item: ReadingListItem) => {
    setMergingUrl(item.url);
    try {
      await startMerge(item);
    } finally {
      setMergingUrl(null);
    }
  };

  if (loading) {
    return <div className="p-4 text-zinc-400">Loading reading list...</div>;
  }

  if (itemList.length === 0) {
    return (
      <div className="p-6 text-center">
        <div className="text-zinc-400 text-sm">
          <p className="mb-2 font-medium text-zinc-300">No reading list items</p>
          <p>Add pages to your Chrome Reading List and they'll appear here. Click Extract to summarize and extract entities.</p>
        </div>
      </div>
    );
  }

  const tabs: { key: Tab; label: string; count: number }[] = [
    { key: 'pending', label: 'Pending', count: pending.length },
    { key: 'ready', label: 'Ready', count: extracted.length },
    { key: 'failed', label: 'Failed', count: failed.length },
  ];

  const currentItems = activeTab === 'pending' ? pending : activeTab === 'ready' ? extracted : failed;

  const filtered = currentItems.filter(item => {
    if (!filterText) return true;
    const q = filterText.toLowerCase();
    const title = (item.pageTitle || item.title).toLowerCase();
    const domain = getDomain(item.url).toLowerCase();
    return title.includes(q) || domain.includes(q);
  });

  const sorted = [...filtered].sort((a, b) => {
    if (sortBy === 'newest') return b.addedAt - a.addedAt;
    if (sortBy === 'oldest') return a.addedAt - b.addedAt;
    return getDomain(a.url).localeCompare(getDomain(b.url));
  });

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* Header */}
      <div className="px-3 py-2 border-b border-zinc-700/50 flex-shrink-0">
        <h2 className="text-sm font-medium text-zinc-200">Reading List</h2>
      </div>

      {/* Tabs */}
      <div className="flex border-b border-zinc-700/50 flex-shrink-0">
        {tabs.map(tab => (
          <button
            key={tab.key}
            onClick={() => setActiveTab(tab.key)}
            className={`flex-1 px-2 py-1.5 text-xs font-medium transition-colors relative ${
              activeTab === tab.key
                ? 'text-zinc-100'
                : 'text-zinc-500 hover:text-zinc-300'
            }`}
          >
            {tab.label}
            {tab.count > 0 && (
              <span className={`ml-1 px-1 py-0.5 rounded text-[10px] ${
                activeTab === tab.key
                  ? tab.key === 'ready' ? 'bg-emerald-500/20 text-emerald-400'
                    : tab.key === 'failed' ? 'bg-red-500/20 text-red-400'
                    : 'bg-zinc-600/50 text-zinc-300'
                  : 'bg-zinc-700/50 text-zinc-500'
              }`}>
                {tab.count}
              </span>
            )}
            {activeTab === tab.key && (
              <div className="absolute bottom-0 left-1 right-1 h-0.5 bg-indigo-500 rounded-full" />
            )}
          </button>
        ))}
      </div>

      {/* Filter & Sort bar */}
      <div className="flex-shrink-0" style={{ padding: '10px 12px 12px' }}>
        <div className="flex items-center gap-2">
          <input
            type="text"
            placeholder="Filter..."
            value={filterText}
            onChange={(e) => setFilterText(e.target.value)}
            className="flex-1 bg-zinc-800 border border-zinc-700 rounded-md px-2 py-1 text-xs text-zinc-200 placeholder-zinc-500 outline-none focus:border-zinc-600"
          />
          <select
            value={sortBy}
            onChange={(e) => setSortBy(e.target.value as SortBy)}
            className="bg-zinc-800 border border-zinc-700 rounded-md px-2 py-1 text-xs text-zinc-300 outline-none"
          >
            <option value="newest">Newest</option>
            <option value="oldest">Oldest</option>
            <option value="domain">Domain A-Z</option>
          </select>
        </div>
      </div>
      <div className="flex-shrink-0" style={{ margin: '0 12px', borderTop: '1px solid #52525b' }} />

      {/* Item list */}
      <div className="flex-1 overflow-y-auto min-h-0 flex flex-col gap-2" style={{ padding: '12px' }}>
        {sorted.length === 0 ? (
          <div className="p-4 text-center text-xs text-zinc-500">
            {filterText ? 'No items match your filter.' :
              activeTab === 'pending' ? 'No pending items. Add pages to your Chrome Reading List.' :
              activeTab === 'ready' ? 'No extracted items yet. Extract pending items to see summaries.' :
              'No failed items.'}
          </div>
        ) : (
          sorted.map(item => (
            <ReadingListItemCard
              key={item.url}
              item={item}
              selected={selectedUrl === item.url}
              onSelect={() => selectItem(selectedUrl === item.url ? null : item.url)}
              onMerge={handleMerge}
              isMerging={mergingUrl === item.url}
            />
          ))
        )}
      </div>
    </div>
  );
}
