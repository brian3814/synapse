import { useState, useEffect } from 'react';
import { useReadingListStore, isProcessing } from '../../../graph/store/reading-list-store';
import { useReadingListMerge } from '../../hooks/useReadingListMerge';
import { ReadingListItemCard } from './ReadingListItemCard';
import { PanelHeader } from '../shared/PanelHeader';
import { platformId, vaultWorkspace } from '@platform';
import type { ReadingListItem } from '../../../shared/types';
import type { RecentVault, VaultStatus } from '@platform/vault-workspace';

type Tab = 'pending' | 'processing' | 'ready';

function getDomain(url: string): string {
  try {
    return new URL(url).hostname.replace('www.', '');
  } catch {
    return url;
  }
}

export function ReadingListPanel() {
  const { items, loading, selectedUrl, selectItem, selectedUrls, toggleSelectUrl, selectAllPending, clearSelection, startBatchExtraction, addItem } = useReadingListStore();
  const { startMerge } = useReadingListMerge();
  const [activeTab, setActiveTab] = useState<Tab>('pending');
  const [filterText, setFilterText] = useState('');
  const [mergingUrl, setMergingUrl] = useState<string | null>(null);
  const [expandedUrls, setExpandedUrls] = useState<string[]>([]);
  const [showAddForm, setShowAddForm] = useState(false);
  const [selectMode, setSelectMode] = useState(false);

  // Vault info for filtering + add form
  const [vaultStatus, setVaultStatus] = useState<VaultStatus | null>(null);
  const [recentVaults, setRecentVaults] = useState<RecentVault[]>([]);
  useEffect(() => {
    if (platformId !== 'electron') return;
    vaultWorkspace.getStatus().then(setVaultStatus);
    vaultWorkspace.getRecent().then(setRecentVaults);
  }, []);

  useEffect(() => {
    setFilterText('');
  }, [activeTab]);

  // Filter items to current vault (items without targetVaultPath shown everywhere)
  const currentVaultPath = vaultStatus?.path;
  const allItems = Object.values(items).filter((i) => {
    if (i.status === 'complete') return false;
    if (!currentVaultPath) return true;
    if (!i.targetVaultPath) return true;
    return i.targetVaultPath === currentVaultPath;
  });

  const pending = allItems.filter((i) => i.status === 'pending');
  const processing = allItems.filter((i) => isProcessing(i.status));
  const ready = allItems.filter((i) => i.status === 'ready' || i.status === 'extracted');
  const failed = allItems.filter((i) => i.status === 'failed');

  const handleMerge = async (item: ReadingListItem) => {
    setMergingUrl(item.url);
    try {
      await startMerge(item);
    } finally {
      setMergingUrl(null);
    }
  };

  const toggleExpanded = (url: string) => {
    setExpandedUrls((prev) =>
      prev.includes(url) ? prev.filter((u) => u !== url) : [...prev, url]
    );
  };

  if (loading) {
    return <div className="p-4 text-zinc-400">Loading reading list...</div>;
  }

  const tabs: { key: Tab; label: string; count: number }[] = [
    { key: 'pending', label: 'Pending', count: pending.length + failed.length },
    { key: 'processing', label: 'Processing', count: processing.length },
    { key: 'ready', label: 'Ready', count: ready.length },
  ];

  const currentItems = activeTab === 'pending'
    ? [...pending, ...failed]
    : activeTab === 'processing'
    ? processing
    : ready;

  const filtered = currentItems.filter((item) => {
    if (!filterText) return true;
    const q = filterText.toLowerCase();
    const title = (item.pageTitle || item.title).toLowerCase();
    const domain = getDomain(item.url).toLowerCase();
    return title.includes(q) || domain.includes(q);
  });

  const sorted = [...filtered].sort((a, b) => b.addedAt - a.addedAt);
  const selectedPendingCount = selectedUrls.filter((url) => items[url]?.status === 'pending').length;

  return (
    <div className="flex flex-col h-full overflow-hidden">
      <div className="px-3 py-2 border-b border-zinc-700/50 flex-shrink-0">
        <PanelHeader title="Reading List">
          <button
            onClick={() => setShowAddForm(!showAddForm)}
            className="text-xs px-2.5 py-1 bg-indigo-600 text-white rounded hover:bg-indigo-500 transition-colors"
          >
            + Add URL
          </button>
        </PanelHeader>
      </div>

      {/* Add URL form */}
      {showAddForm && (
        <AddUrlForm
          currentVaultPath={currentVaultPath ?? ''}
          currentVaultName={vaultStatus?.name ?? ''}
          recentVaults={recentVaults}
          onAdd={(url, title, vaultPath, vaultName) => {
            addItem(url, title, vaultPath, vaultName);
            setShowAddForm(false);
          }}
          onCancel={() => setShowAddForm(false)}
        />
      )}

      {/* Tabs */}
      <div className="flex border-b border-zinc-700/50 flex-shrink-0">
        {tabs.map((tab) => (
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
                    : tab.key === 'processing' ? 'bg-blue-500/20 text-blue-400'
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

      {/* Pending tab: select mode bar */}
      {activeTab === 'pending' && pending.length > 0 && (
        <div className="flex items-center gap-2 px-3 py-2 border-b border-zinc-700/50 flex-shrink-0">
          {!selectMode ? (
            <button
              onClick={() => setSelectMode(true)}
              className="text-xs text-zinc-400 hover:text-zinc-200 transition-colors"
            >
              Select
            </button>
          ) : (
            <>
              <button
                onClick={() => {
                  if (selectedUrls.length === pending.length) clearSelection();
                  else selectAllPending();
                }}
                className="text-xs text-zinc-400 hover:text-zinc-200 transition-colors"
              >
                {selectedUrls.length === pending.length ? 'Deselect All' : 'Select All'}
              </button>
              <button
                onClick={() => { clearSelection(); setSelectMode(false); }}
                className="text-xs text-zinc-400 hover:text-zinc-200 transition-colors"
              >
                Clear
              </button>
              <div className="flex-1" />
              {selectedPendingCount > 0 && (
                <button
                  onClick={() => { startBatchExtraction(); setSelectMode(false); }}
                  className="px-3 py-1 text-xs bg-indigo-600 hover:bg-indigo-500 text-white rounded-md transition-colors"
                >
                  Extract ({selectedPendingCount})
                </button>
              )}
            </>
          )}
        </div>
      )}

      {/* Filter bar (non-pending tabs with many items) */}
      {activeTab !== 'pending' && currentItems.length > 3 && (
        <div className="flex-shrink-0" style={{ padding: '10px 12px 8px' }}>
          <input
            type="text"
            placeholder="Filter..."
            value={filterText}
            onChange={(e) => setFilterText(e.target.value)}
            className="w-full bg-zinc-800 border border-zinc-700 rounded-md px-2 py-1 text-xs text-zinc-200 placeholder-zinc-500 outline-none focus:border-zinc-600"
          />
        </div>
      )}

      {/* Item list */}
      <div className="flex-1 overflow-y-auto min-h-0 flex flex-col gap-1.5" style={{ padding: '8px 12px 12px' }}>
        {sorted.length === 0 ? (
          <div className="p-4 text-center text-xs text-zinc-500">
            {filterText ? 'No items match your filter.' :
              activeTab === 'pending' ? 'No pending items. Click "+ Add URL" to add a page.' :
              activeTab === 'processing' ? 'No items being processed.' :
              'No items ready for merge.'}
          </div>
        ) : (
          sorted.map((item) => (
            <ReadingListItemCard
              key={item.url}
              item={item}
              mode={activeTab}
              selectMode={selectMode}
              selected={selectedUrl === item.url}
              checked={selectedUrls.includes(item.url)}
              expanded={expandedUrls.includes(item.url)}
              onSelect={() => selectItem(selectedUrl === item.url ? null : item.url)}
              onCheck={() => toggleSelectUrl(item.url)}
              onToggleExpand={() => toggleExpanded(item.url)}
              onMerge={handleMerge}
              isMerging={mergingUrl === item.url}
            />
          ))
        )}
      </div>
    </div>
  );
}

function AddUrlForm({
  currentVaultPath,
  currentVaultName,
  recentVaults,
  onAdd,
  onCancel,
}: {
  currentVaultPath: string;
  currentVaultName: string;
  recentVaults: RecentVault[];
  onAdd: (url: string, title: string, vaultPath: string, vaultName: string) => void;
  onCancel: () => void;
}) {
  const [url, setUrl] = useState('');
  const [title, setTitle] = useState('');
  const [selectedVault, setSelectedVault] = useState(currentVaultPath);

  const vaultOptions = recentVaults.length > 0
    ? recentVaults
    : currentVaultPath
      ? [{ path: currentVaultPath, name: currentVaultName, lastOpened: '' }]
      : [];

  const selectedVaultName = vaultOptions.find((v) => v.path === selectedVault)?.name ?? currentVaultName;

  const handleSubmit = () => {
    if (!url.trim()) return;
    let normalized = url.trim();
    if (!/^https?:\/\//i.test(normalized)) normalized = `https://${normalized}`;
    onAdd(normalized, title || normalized, selectedVault, selectedVaultName);
  };

  return (
    <div className="px-3 py-3 border-b border-zinc-700/50 space-y-2 bg-zinc-850 flex-shrink-0" style={{ backgroundColor: '#1a1a1e' }}>
      <input
        type="text"
        placeholder="URL..."
        value={url}
        onChange={(e) => setUrl(e.target.value)}
        onKeyDown={(e) => e.key === 'Enter' && handleSubmit()}
        autoFocus
        className="w-full bg-zinc-800 border border-zinc-700 rounded px-2 py-1.5 text-xs text-zinc-200 placeholder-zinc-500 outline-none focus:border-indigo-500"
      />
      <input
        type="text"
        placeholder="Title (optional)"
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        onKeyDown={(e) => e.key === 'Enter' && handleSubmit()}
        className="w-full bg-zinc-800 border border-zinc-700 rounded px-2 py-1.5 text-xs text-zinc-200 placeholder-zinc-500 outline-none focus:border-indigo-500"
      />
      {vaultOptions.length > 1 && (
        <div className="flex items-center gap-2">
          <span className="text-xs text-zinc-500 shrink-0">Vault:</span>
          <select
            value={selectedVault}
            onChange={(e) => setSelectedVault(e.target.value)}
            className="flex-1 bg-zinc-800 border border-zinc-700 rounded px-2 py-1 text-xs text-zinc-200 outline-none focus:border-indigo-500"
          >
            {vaultOptions.map((v) => (
              <option key={v.path} value={v.path}>{v.name}</option>
            ))}
          </select>
        </div>
      )}
      {vaultOptions.length === 1 && (
        <div className="flex items-center gap-2 text-xs text-zinc-500">
          <span>Vault:</span>
          <span className="text-zinc-300">{selectedVaultName}</span>
        </div>
      )}
      <div className="flex justify-end gap-2">
        <button
          onClick={onCancel}
          className="px-3 py-1 text-xs text-zinc-400 hover:text-zinc-200 transition-colors"
        >
          Cancel
        </button>
        <button
          onClick={handleSubmit}
          disabled={!url.trim()}
          className="px-3 py-1 text-xs bg-indigo-600 hover:bg-indigo-500 text-white rounded transition-colors disabled:opacity-50"
        >
          Add
        </button>
      </div>
    </div>
  );
}
