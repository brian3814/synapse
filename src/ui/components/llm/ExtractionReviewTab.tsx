import { useEffect, useCallback, useState } from 'react';
import { useLLMStore } from '../../../graph/store/llm-store';
import { useUIStore } from '../../../graph/store/ui-store';
import { useExtractionReviewStore } from '../../../graph/store/extraction-review-store';
import { useReadingListStore } from '../../../graph/store/reading-list-store';
import { applyReview, proceedToReview, regenerateExtraction } from '../../extractionActions';
import { ExtractionReview } from './ExtractionReview';
import { ExtractionSummary } from './ExtractionSummary';
import { AgentTimeline } from './AgentTimeline';
import { RateLimitCountdown, FetchError } from './ExtractionProgress';
import { ExtractionProgressPanel } from '../reading-list/ExtractionProgressPanel';

export function ExtractionReviewTab() {
  const status = useLLMStore((s) => s.status);
  const extractionResourceId = useLLMStore((s) => s.extractionResourceId);
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

    await useReadingListStore.getState().addItem(url, url);
    handleDiscard();
  }, [handleDiscard]);

  if (status === 'extracting' && extractionResourceId) {
    return (
      <div className="h-full flex flex-col bg-zinc-900">
        <ExtractionProgressPanel resourceId={extractionResourceId} />
        {rateLimitWait && (
          <div className="px-4 pb-2">
            <RateLimitCountdown wait={rateLimitWait} />
          </div>
        )}
        {error && (
          <div className="px-4 pb-2">
            <FetchError error={error} />
          </div>
        )}
        <div className="px-4 pb-4 shrink-0">
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
        <RegenerateFeedback onRegenerate={regenerateExtraction} />
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

function RegenerateFeedback({ onRegenerate }: { onRegenerate: (feedback: string) => void }) {
  const [expanded, setExpanded] = useState(false);
  const [feedback, setFeedback] = useState('');
  const inputText = useLLMStore((s) => s.inputText);

  if (!inputText) return null;

  const handleSubmit = () => {
    const trimmed = feedback.trim();
    if (!trimmed) return;
    setExpanded(false);
    setFeedback('');
    onRegenerate(trimmed);
  };

  if (!expanded) {
    return (
      <div className="mb-3">
        <button
          onClick={() => setExpanded(true)}
          className="w-full flex items-center justify-center gap-1.5 px-3 py-1.5 text-xs bg-zinc-800 border border-zinc-700 text-zinc-400 rounded-lg hover:bg-zinc-700 hover:text-zinc-200 transition-colors"
        >
          <svg className="w-3.5 h-3.5" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
            <path d="M1 4v-1a2 2 0 0 1 2-2h1" />
            <path d="M1 12v1a2 2 0 0 0 2 2h1" />
            <path d="M12 1h1a2 2 0 0 1 2 2v1" />
            <path d="M12 15h1a2 2 0 0 0 2-2v-1" />
            <path d="M8 4v8" />
            <path d="M5 7l3-3 3 3" />
          </svg>
          Regenerate with feedback
        </button>
      </div>
    );
  }

  return (
    <div className="mb-3 space-y-2 p-3 bg-zinc-800/50 border border-zinc-700 rounded-lg">
      <label className="text-xs font-medium text-zinc-400 block">
        How should the extraction be different?
      </label>
      <textarea
        value={feedback}
        onChange={(e) => setFeedback(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
            e.preventDefault();
            handleSubmit();
          }
        }}
        placeholder="e.g. Focus on people and their roles, extract more granular relationships..."
        className="w-full bg-zinc-900 border border-zinc-700 rounded text-sm text-zinc-200 p-2 resize-none placeholder:text-zinc-600 focus:outline-none focus:border-zinc-500"
        rows={3}
        autoFocus
      />
      <div className="flex gap-2 justify-end">
        <button
          onClick={() => { setExpanded(false); setFeedback(''); }}
          className="px-3 py-1.5 text-xs bg-zinc-700 text-zinc-300 rounded hover:bg-zinc-600 transition-colors"
        >
          Cancel
        </button>
        <button
          onClick={handleSubmit}
          disabled={!feedback.trim()}
          className="px-3 py-1.5 text-xs bg-indigo-600 text-white rounded hover:bg-indigo-500 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
        >
          Regenerate
        </button>
      </div>
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
