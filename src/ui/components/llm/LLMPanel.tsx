import React from 'react';
import { useLLMStore } from '../../../graph/store/llm-store';
import type { RateLimitWait } from '../../../graph/store/llm-store';
import { useExtractionReviewStore } from '../../../graph/store/extraction-review-store';
import { useLLMExtraction } from '../../hooks/useLLMExtraction';
import { TextInput } from './TextInput';
import { PromptInput } from './PromptInput';
import { PrivacyDisclosure } from './PrivacyDisclosure';
import { AgentTimeline } from './AgentTimeline';
import { DiffView } from './DiffView';
import { ExtractionReview } from './ExtractionReview';
import { ExtractionSummary } from './ExtractionSummary';
import { StreamingOutput } from './StreamingOutput';
import { PanelHeader } from '../shared/PanelHeader';
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

function RateLimitCountdown({ wait }: { wait: RateLimitWait }) {
  const [remaining, setRemaining] = React.useState('');

  React.useEffect(() => {
    const update = () => {
      const elapsed = Date.now() - wait.startedAt;
      const left = Math.max(0, Math.ceil((wait.retryAfterMs - elapsed) / 1000));
      setRemaining(`${left}s`);
    };
    update();
    const interval = setInterval(update, 1000);
    return () => clearInterval(interval);
  }, [wait.startedAt, wait.retryAfterMs]);

  return (
    <span className="text-[10px] text-amber-400 flex items-center gap-1">
      <span className="w-1.5 h-1.5 bg-amber-400 rounded-full animate-pulse" />
      Rate limited. Retrying in {remaining} (attempt {wait.retryCount}/{wait.maxRetries})
    </span>
  );
}

function FetchError({ error }: { error: string }) {
  const blockedMatch = error.match(/^__BLOCKED__(.+?)__(.+)$/);
  if (!blockedMatch) {
    return (
      <div className="bg-red-900/30 border border-red-800 rounded p-3">
        <p className="text-xs text-red-400">{error}</p>
      </div>
    );
  }

  const url = blockedMatch[1];
  const reason = blockedMatch[2];

  const handleOpenInBrowser = () => {
    (window as any).electronIPC?.invoke('shell:open-external', url);
  };

  return (
    <div className="bg-amber-900/30 border border-amber-800/50 rounded p-3 space-y-2">
      <p className="text-xs text-amber-300 font-medium">Website blocked the request</p>
      <p className="text-[11px] text-zinc-400">{reason}</p>
      <p className="text-[11px] text-zinc-400">
        Open this page in Chrome with the Synapse companion extension, then click the capture button to extract its content.
      </p>
      <button
        onClick={handleOpenInBrowser}
        className="text-xs px-3 py-1.5 bg-zinc-700 text-zinc-200 rounded hover:bg-zinc-600 transition-colors"
      >
        Open in Browser
      </button>
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
  const showPrivacyModal = useLLMStore((s) => s.showPrivacyModal);
  const pendingAction = useLLMStore((s) => s.pendingAction);
  const pendingCapture = useLLMStore((s) => s.pendingCapture);
  const rateLimitWait = useLLMStore((s) => s.rateLimitWait);
  const resetLLM = useLLMStore((s) => s.reset);
  const resetReview = useExtractionReviewStore((s) => s.reset);
  const extractionMode = useLLMStore((s) => s.extractionMode);
  const reset = () => { resetLLM(); resetReview(); };
  const { startExtraction, startQuickExtraction, startAgentExtraction, applyDiff, applyReview, proceedToReview } = useLLMExtraction();

  React.useEffect(() => {
    if (pendingCapture && status === 'idle') {
      const { url, content } = pendingCapture;
      useLLMStore.getState().setPendingCapture(null);
      startExtraction(content, url);
    }
  }, [pendingCapture, status, startExtraction]);

  const isIdle = status === 'idle' || status === 'error';
  const isRunning = status === 'extracting' || status === 'agent-running';

  return (
    <div className="p-4 space-y-4">
      <PanelHeader title="LLM Extraction">
        {status !== 'idle' && (
          <button
            onClick={reset}
            className="text-xs px-2 py-1 bg-zinc-700 text-zinc-300 rounded hover:bg-zinc-600"
          >
            Reset
          </button>
        )}
      </PanelHeader>

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


      {error && <FetchError error={error} />}

      {isRunning && (
        rateLimitWait ? (
          <RateLimitCountdown wait={rateLimitWait} />
        ) : (
          <span className="text-[10px] text-zinc-500 flex items-center gap-1">
            <span className="w-1.5 h-1.5 bg-green-500 rounded-full animate-pulse" />
            Sending to Anthropic
          </span>
        )
      )}

      {showPrivacyModal ? (
        <PrivacyDisclosure
          onAccept={() => {
            useLLMStore.getState().setShowPrivacyModal(false);
            pendingAction?.();
          }}
          onCancel={() => {
            useLLMStore.getState().setShowPrivacyModal(false);
          }}
        />
      ) : isIdle && activeTab === 'page' ? (
        <PromptInput onSubmit={(prompt, sourceUrl) => {
          const fn = extractionMode === 'deep' ? startAgentExtraction : startQuickExtraction;
          fn(prompt, sourceUrl);
        }} />
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
