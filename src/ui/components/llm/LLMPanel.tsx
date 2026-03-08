import React from 'react';
import { useLLMStore } from '../../../graph/store/llm-store';
import { useExtractionReviewStore } from '../../../graph/store/extraction-review-store';
import { useLLMExtraction } from '../../hooks/useLLMExtraction';
import { TextInput } from './TextInput';
import { PromptInput } from './PromptInput';
import { AgentTimeline } from './AgentTimeline';
import { DiffView } from './DiffView';
import { ExtractionReview } from './ExtractionReview';
import { ExtractionSummary } from './ExtractionSummary';
import { StreamingOutput } from './StreamingOutput';
import type { AgentStep } from '../../../shared/types';
import type { ExtractionTab } from '../../../graph/store/llm-store';

function StepIcon({ status }: { status: AgentStep['status'] }) {
  if (status === 'running') {
    return (
      <div className="w-4 h-4 border-2 border-indigo-500 border-t-transparent rounded-full animate-spin flex-shrink-0" />
    );
  }
  if (status === 'completed') {
    return (
      <svg className="w-4 h-4 text-green-400 flex-shrink-0" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2">
        <path d="M3 8.5l3.5 3.5 6.5-7" />
      </svg>
    );
  }
  if (status === 'error') {
    return (
      <svg className="w-4 h-4 text-red-400 flex-shrink-0" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2">
        <path d="M4 4l8 8M12 4l-8 8" />
      </svg>
    );
  }
  // pending
  return <div className="w-4 h-4 rounded-full border-2 border-zinc-600 flex-shrink-0" />;
}

function ElapsedTime({ step }: { step: AgentStep }) {
  const [elapsed, setElapsed] = React.useState('');

  React.useEffect(() => {
    if (!step.startedAt) return;
    if (step.completedAt) {
      setElapsed(formatMs(step.completedAt - step.startedAt));
      return;
    }
    // Running — update every second
    const update = () => setElapsed(formatMs(Date.now() - step.startedAt!));
    update();
    const interval = setInterval(update, 1000);
    return () => clearInterval(interval);
  }, [step.startedAt, step.completedAt, step.status]);

  if (!elapsed) return null;
  return <span className="text-xs text-zinc-500 ml-auto">{elapsed}</span>;
}

function formatMs(ms: number): string {
  const seconds = Math.floor(ms / 1000);
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  const remaining = seconds % 60;
  return `${minutes}m ${remaining}s`;
}

function StepTimeline() {
  const agentRun = useLLMStore((s) => s.agentRun);
  if (!agentRun) return null;

  const currentStep = agentRun.steps[agentRun.currentStepIndex];
  const showOutput = currentStep?.status === 'running' && (currentStep.output?.length ?? 0) > 0;

  return (
    <div className="space-y-2">
      {agentRun.steps.map((step) => (
        <div key={step.id} className="flex items-center gap-2">
          <StepIcon status={step.status} />
          <span className={`text-sm ${step.status === 'running' ? 'text-zinc-200' : step.status === 'completed' ? 'text-zinc-400' : step.status === 'error' ? 'text-red-400' : 'text-zinc-500'}`}>
            {step.label}
          </span>
          <ElapsedTime step={step} />
        </div>
      ))}
      {showOutput && (
        <StreamingOutput
          text={currentStep.output ?? ''}
          done={currentStep.status !== 'running'}
        />
      )}
    </div>
  );
}

const TABS: { key: ExtractionTab; label: string }[] = [
  { key: 'page', label: 'From Page' },
  { key: 'text', label: 'From Text' },
];

export function LLMPanel() {
  const status = useLLMStore((s) => s.status);
  const activeTab = useLLMStore((s) => s.activeTab);
  const setActiveTab = useLLMStore((s) => s.setActiveTab);
  const error = useLLMStore((s) => s.error);
  const resetLLM = useLLMStore((s) => s.reset);
  const resetReview = useExtractionReviewStore((s) => s.reset);
  const reset = () => { resetLLM(); resetReview(); };
  const { startExtraction, startAgentExtraction, applyDiff, applyReview, proceedToReview } = useLLMExtraction();

  const isIdle = status === 'idle' || status === 'error';

  return (
    <div className="p-4 space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold text-zinc-100">LLM Extraction</h3>
        {status !== 'idle' && (
          <button
            onClick={reset}
            className="text-xs px-2 py-1 bg-zinc-700 text-zinc-300 rounded hover:bg-zinc-600"
          >
            Reset
          </button>
        )}
      </div>

      {/* Tab toggle — only show when idle/error */}
      {isIdle && (
        <div className="flex gap-1 bg-zinc-800 rounded p-0.5">
          {TABS.map((tab) => (
            <button
              key={tab.key}
              onClick={() => setActiveTab(tab.key)}
              className={`flex-1 text-xs py-1.5 rounded transition-colors ${
                activeTab === tab.key
                  ? 'bg-zinc-600 text-zinc-100'
                  : 'text-zinc-400 hover:text-zinc-200'
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>
      )}

      {error && (
        <div className="bg-red-900/30 border border-red-800 rounded p-3">
          <p className="text-xs text-red-400">{error}</p>
        </div>
      )}

      {isIdle && activeTab === 'page' ? (
        <PromptInput onSubmit={startAgentExtraction} />
      ) : isIdle && activeTab === 'text' ? (
        <TextInput onSubmit={startExtraction} />
      ) : status === 'agent-running' ? (
        <AgentTimeline />
      ) : status === 'extracting' ? (
        <StepTimeline />
      ) : status === 'extracted' ? (
        <ExtractionSummary onProceed={proceedToReview} />
      ) : status === 'reviewing' ? (
        <ExtractionReview onApply={applyReview} />
      ) : status === 'merging' ? (
        <div className="flex items-center gap-2">
          <div className="w-4 h-4 border-2 border-indigo-500 border-t-transparent rounded-full animate-spin" />
          <span className="text-sm text-zinc-400">Merging into graph...</span>
        </div>
      ) : null}
    </div>
  );
}
