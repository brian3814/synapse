import { useEffect } from 'react';
import { useLLMStore } from '../../../graph/store/llm-store';
import { useUIStore } from '../../../graph/store/ui-store';
import { useLLMExtraction } from '../../hooks/useLLMExtraction';
import { ExtractionReview } from './ExtractionReview';
import { ExtractionSummary } from './ExtractionSummary';
import { AgentTimeline } from './AgentTimeline';
import { StepTimeline, RateLimitCountdown, FetchError } from './ExtractionProgress';

export function ExtractionReviewTab() {
  const { applyReview, proceedToReview } = useLLMExtraction();
  const status = useLLMStore((s) => s.status);
  const error = useLLMStore((s) => s.error);
  const rateLimitWait = useLLMStore((s) => s.rateLimitWait);

  useEffect(() => {
    if (status === 'idle') {
      useUIStore.getState().closeContentTab('extraction-review');
    }
  }, [status]);

  if (status === 'extracting') {
    return (
      <div className="h-full overflow-y-auto bg-zinc-900 p-6">
        <div className="max-w-lg mx-auto space-y-3">
          <h3 className="text-sm font-medium text-zinc-200">Extracting entities...</h3>
          <StepTimeline />
          {rateLimitWait && <RateLimitCountdown wait={rateLimitWait} />}
          {error && <FetchError error={error} />}
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
        </div>
      </div>
    );
  }

  if (status === 'extracted') {
    return (
      <div className="h-full flex items-center justify-center bg-zinc-900">
        <div className="w-full max-w-lg p-6">
          <ExtractionSummary onProceed={proceedToReview} />
        </div>
      </div>
    );
  }

  if (status === 'reviewing') {
    return (
      <div className="h-full overflow-y-auto bg-zinc-900 p-4">
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
