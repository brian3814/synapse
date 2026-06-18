import { useState, useEffect } from 'react';
import { useReadingListStore } from '../../../graph/store/reading-list-store';
import { useReadingListMerge } from '../../hooks/useReadingListMerge';
import { PendingCard } from './PendingCard';
import { ProcessingCard } from './ProcessingCard';
import { ReadyCard } from './ReadyCard';
import { PanelHeader } from '../shared/PanelHeader';
import { platformId, vaultWorkspace } from '@platform';
import type { ReadingListResource } from '../../../shared/reading-list-types';
import { SUPPORTED_FILE_EXTENSIONS } from '../../../shared/reading-list-types';
import type { VaultStatus } from '@platform/vault-workspace';
import { AddResourceModal } from './AddResourceModal';
import { FileImportDialog } from './FileImportDialog';
import { DropZoneOverlay } from './DropZoneOverlay';

type Tab = 'pending' | 'processing' | 'ready';

function getDomain(url: string): string {
  try {
    return new URL(url).hostname.replace('www.', '');
  } catch {
    return url;
  }
}

export function ReadingListPanel() {
  const { items, loading, selectedId, selectItem, selectedIds, toggleSelectId, selectAllPending, clearSelection, startBatchExtraction, addResource } = useReadingListStore();
  const { startMerge } = useReadingListMerge();
  const [activeTab, setActiveTab] = useState<Tab>('pending');
  const [filterText, setFilterText] = useState('');
  const [mergingId, setMergingId] = useState<string | null>(null);
  const [showAddModal, setShowAddModal] = useState(false);
  const [selectMode, setSelectMode] = useState(false);
  const [pendingFiles, setPendingFiles] = useState<Array<{ name: string; path: string }> | null>(null);
  const [isDragging, setIsDragging] = useState(false);

  const [vaultStatus, setVaultStatus] = useState<VaultStatus | null>(null);
  useEffect(() => {
    if (platformId !== 'electron') return;
    vaultWorkspace.getStatus().then(setVaultStatus);
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
  const processing = allItems.filter((i) => i.status === 'processing');
  const ready = allItems.filter((i) => i.status === 'ready');

  const handleMerge = async (item: ReadingListResource) => {
    setMergingId(item.id);
    try {
      await startMerge(item as any);
    } finally {
      setMergingId(null);
    }
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(true);
  };

  const handleDragLeave = (e: React.DragEvent) => {
    if (e.currentTarget.contains(e.relatedTarget as Node)) return;
    setIsDragging(false);
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    const files = Array.from(e.dataTransfer.files).filter((f) => {
      const ext = f.name.split('.').pop()?.toLowerCase() ?? '';
      return SUPPORTED_FILE_EXTENSIONS.has('.' + ext);
    });
    if (files.length > 0) {
      setPendingFiles(files.map((f) => ({ name: f.name, path: (f as any).path ?? f.name })));
    }
  };

  const handleFileImportConfirm = async (opts: { imported: boolean; keepOriginal: boolean }) => {
    if (!pendingFiles) return;
    const ipc = (window as any).electronIPC;

    for (const file of pendingFiles) {
      let source: any;
      if (opts.imported && currentVaultPath) {
        const { vaultRelativePath } = await ipc.invoke('file:copy-to-vault', file.path, currentVaultPath, 'raw');
        source = { kind: 'file', filePath: file.path, imported: true, vaultPath: vaultRelativePath, keepOriginal: opts.keepOriginal };
      } else {
        source = { kind: 'file', filePath: file.path, imported: false };
      }
      await addResource(source, file.name.replace(/\.[^.]+$/, ''));
    }
    setPendingFiles(null);
  };

  if (loading) {
    return <div className="p-4 text-zinc-400">Loading reading list...</div>;
  }

  const tabs: { key: Tab; label: string; count: number }[] = [
    { key: 'pending', label: 'Pending', count: pending.length },
    { key: 'processing', label: 'Processing', count: processing.length },
    { key: 'ready', label: 'Ready', count: ready.length },
  ];

  const currentItems = activeTab === 'pending'
    ? pending
    : activeTab === 'processing'
    ? processing
    : ready;

  const getItemLabel = (item: ReadingListResource): string => {
    if (item.source.kind === 'url') return getDomain(item.source.url);
    if (item.source.kind === 'file') {
      const path = item.source.filePath;
      return path.split('/').pop() ?? path;
    }
    return '';
  };

  const filtered = currentItems.filter((item) => {
    if (!filterText) return true;
    const q = filterText.toLowerCase();
    const title = item.title.toLowerCase();
    const label = getItemLabel(item).toLowerCase();
    return title.includes(q) || label.includes(q);
  });

  // Sort pending: errors first (most recent failure first), then by addedAt desc
  const sorted = activeTab === 'pending'
    ? [...filtered].sort((a, b) => {
        const aHasError = Boolean(a.error);
        const bHasError = Boolean(b.error);
        if (aHasError && !bHasError) return -1;
        if (!aHasError && bHasError) return 1;
        if (aHasError && bHasError) {
          return (b.error!.failedAt) - (a.error!.failedAt);
        }
        return b.addedAt - a.addedAt;
      })
    : [...filtered].sort((a, b) => b.addedAt - a.addedAt);

  const selectedPendingCount = selectedIds.filter(
    (id) => items[id]?.status === 'pending' && !items[id]?.error,
  ).length;

  return (
    <div
      className="flex flex-col h-full overflow-hidden relative"
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
    >
      <DropZoneOverlay visible={isDragging} />
      {pendingFiles && (
        <FileImportDialog
          files={pendingFiles}
          onConfirm={handleFileImportConfirm}
          onCancel={() => setPendingFiles(null)}
        />
      )}

      <div className="px-3 py-2 border-b border-zinc-700/50 flex-shrink-0">
        <PanelHeader title="Reading List">
          <button
            onClick={() => setShowAddModal(true)}
            className="text-xs px-2.5 py-1 bg-indigo-600 text-white rounded hover:bg-indigo-500 transition-colors"
          >
            + Add
          </button>
        </PanelHeader>
      </div>

      {/* Add resource modal */}
      {showAddModal && (
        <AddResourceModal
          onClose={() => setShowAddModal(false)}
          onFilesSelected={(files) => {
            setPendingFiles(files.map((f) => ({ name: f.name, path: (f as any).path ?? f.name })));
            setShowAddModal(false);
          }}
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
      {activeTab === 'pending' && pending.filter((i) => !i.error).length > 0 && (
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
                  const nonErrorPending = pending.filter((i) => !i.error);
                  if (selectedIds.length === nonErrorPending.length) clearSelection();
                  else selectAllPending();
                }}
                className="text-xs text-zinc-400 hover:text-zinc-200 transition-colors"
              >
                {selectedIds.length === pending.filter((i) => !i.error).length ? 'Deselect All' : 'Select All'}
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
              activeTab === 'pending' ? 'No pending items. Click "+ Add" to add a page.' :
              activeTab === 'processing' ? 'No items being processed.' :
              'No items ready for merge.'}
          </div>
        ) : (
          sorted.map((item) => {
            if (activeTab === 'pending') {
              return (
                <PendingCard
                  key={item.id}
                  item={item}
                  selectMode={selectMode}
                  checked={selectedIds.includes(item.id)}
                  onCheck={() => toggleSelectId(item.id)}
                />
              );
            }
            if (activeTab === 'processing') {
              return <ProcessingCard key={item.id} item={item} />;
            }
            // ready
            return (
              <ReadyCard
                key={item.id}
                item={item}
                selected={selectedId === item.id}
                onSelect={() => selectItem(selectedId === item.id ? null : item.id)}
                onMerge={handleMerge}
                isMerging={mergingId === item.id}
              />
            );
          })
        )}
      </div>
    </div>
  );
}
