import { useEffect, useCallback } from 'react';
import { useLLMStore } from '../../../graph/store/llm-store';
import { useUIStore } from '../../../graph/store/ui-store';
import { useExtractionReviewStore } from '../../../graph/store/extraction-review-store';
import { useReadingListStore } from '../../../graph/store/reading-list-store';
import { useLLMExtraction } from '../../hooks/useLLMExtraction';
import { ExtractionReview } from './ExtractionReview';
import { ExtractionSummary } from './ExtractionSummary';
import { AgentTimeline } from './AgentTimeline';
import { StepTimeline, RateLimitCountdown, FetchError } from './ExtractionProgress';
import { platformId, vaultWorkspace } from '@platform';

export function ExtractionReviewTab() {
  const { applyReview, proceedToReview } = useLLMExtraction();
  const status = useLLMStore((s) => s.status);
  const error = useLLMStore((s) => s.error);
  const rateLimitWait = useLLMStore((s) => s.rateLimitWait);

  // Auto-close tab when merge completes
  useEffect(() => {
    if (status === 'idle') {
      useUIStore.getState().closeContentTab('extraction-review');
    }
  }, [status]);

  // Cleanup when tab is removed (X button or discard) — NOT on column moves.
  // Watching the store instead of using unmount avoids false triggers from
  // split/reorder which unmount+remount the component.
  useEffect(() => {
    return useUIStore.subscribe((state, prev) => {
      const exists = state.contentColumns.some((col) =>
        col.tabs.some((t) => t.id === 'extraction-review')
      );
      const prevExists = prev.contentColumns.some((col) =>
        col.tabs.some((t) => t.id === 'extraction-review')
      );
      if (!exists && prevExists) {
        const llm = useLLMStore.getState();
        if (llm.status !== 'idle') {
          useExtractionReviewStore.getState().reset();
          useLLMStore.getState().reset();
        }
      }
    });
  }, []);

  const handleDiscard = useCallback(() => {
    useExtractionReviewStore.getState().reset();
    useLLMStore.getState().reset();
    useUIStore.getState().closeContentTab('extraction-review');
  }, []);

  const handleSendToReadingList = useCallback(async () => {
    const llm = useLLMStore.getState();
    const url = llm.sourceUrl;
    if (!url) {
      handleDiscard();
      return;
    }

    let vaultPath = '';
    let vaultName = '';
    if (platformId === 'electron') {
      const vault = await vaultWorkspace.getStatus();
      vaultPath = vault.path ?? '';
      vaultName = vault.name ?? '';
    }

    await useReadingListStore.getState().addItem(url, url, vaultPath, vaultName);
    handleDiscard();
  }, [handleDiscard]);

  if (status === 'extracting') {
    return (
      <div className="h-full overflow-y-auto bg-zinc-900 p-6">
        <div className="max-w-lg mx-auto space-y-3">
          <h3 className="text-sm font-medium text-zinc-200">Extracting entities...</h3>
          <StepTimeline />
          {rateLimitWait && <RateLimitCountdown wait={rateLimitWait} />}
          {error && <FetchError error={error} />}
          <ActionBar onDiscard={handleDiscard} onSendToReadingList={handleSendToReadingList} />
        </div>
      </div>
    );
  }

  if (status === 'agent-running') {
    return (
      <div className="h-full overflow-y-auto bg-zinc-900 p-6">
        <div className="max-w-2xl mx-auto space-y-3">
          <AgentTimeline />
          {rateLimitWait && <RateLimitCountdown wait={rateLimitWait} />}
          <ActionBar onDiscard={handleDiscard} onSendToReadingList={handleSendToReadingList} />
        </div>
      </div>
    );
  }

  if (status === 'extracted') {
    return (
      <div className="h-full flex items-center justify-center bg-zinc-900">
        <div className="w-full max-w-lg p-6">
          <ExtractionSummary onProceed={proceedToReview} />
          <div className="mt-3">
            <ActionBar onDiscard={handleDiscard} onSendToReadingList={handleSendToReadingList} />
          </div>
        </div>
      </div>
    );
  }

  if (status === 'reviewing') {
    return (
      <div className="h-full overflow-y-auto bg-zinc-900 p-4">
        <div className="flex gap-2 mb-3">
          <PreviewGraphButton />
          <ActionBar onDiscard={handleDiscard} onSendToReadingList={handleSendToReadingList} inline />
        </div>
        <ExtractionReview onApply={applyReview} />
      </div>
    );
  }

  if (status === 'merging') {
    return (
      <div className="h-full flex items-center justify-center bg-zinc-900">
        <div className="flex items-center gap-2">
          <div className="w-5 h-5 border-2 border-indigo-500 border-t-transparent rounded-full animate-spin" />
          <span className="text-sm text-zinc-400">Merging into graph...</span>
        </div>
      </div>
    );
  }

  return null;
}

function ActionBar({
  onDiscard,
  onSendToReadingList,
  inline,
}: {
  onDiscard: () => void;
  onSendToReadingList: () => void;
  inline?: boolean;
}) {
  const sourceUrl = useLLMStore((s) => s.sourceUrl);

  return (
    <div className={inline ? 'flex gap-1.5' : 'flex gap-2 justify-center mt-2'}>
      <button
        onClick={onDiscard}
        className="px-3 py-1.5 text-xs bg-zinc-800 border border-zinc-700 text-zinc-400 rounded hover:bg-zinc-700 hover:text-zinc-200 transition-colors"
      >
        Discard
      </button>
      {sourceUrl && (
        <button
          onClick={onSendToReadingList}
          className="px-3 py-1.5 text-xs bg-zinc-800 border border-zinc-700 text-zinc-400 rounded hover:bg-zinc-700 hover:text-zinc-200 transition-colors"
        >
          Save to Reading List
        </button>
      )}
    </div>
  );
}

function PreviewGraphButton() {
  const viewMode = useExtractionReviewStore((s) => s.viewMode);
  const setViewMode = useExtractionReviewStore((s) => s.setViewMode);
  const isOverlay = viewMode === 'overlay';

  const handleToggle = () => {
    if (isOverlay) {
      setViewMode('extracted');
    } else {
      setViewMode('overlay');
      useUIStore.getState().focusContentTab('graph');
    }
  };

  return (
    <button
      onClick={handleToggle}
      className={`flex-1 flex items-center justify-center gap-2 px-3 py-1.5 rounded text-xs font-medium transition-colors ${
        isOverlay
          ? 'bg-indigo-600/20 border border-indigo-500/40 text-indigo-300 hover:bg-indigo-600/30'
          : 'bg-zinc-800 border border-zinc-700 text-zinc-300 hover:bg-zinc-700'
      }`}
    >
      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
        <circle cx="6" cy="6" r="3" /><circle cx="18" cy="18" r="3" /><circle cx="18" cy="6" r="3" />
        <line x1="8.5" y1="7.5" x2="15.5" y2="16.5" /><line x1="15.5" y1="6" x2="8.5" y2="6" />
      </svg>
      {isOverlay ? 'Exit Preview' : 'Preview Merge'}
    </button>
  );
}
