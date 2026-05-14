import { useState, useEffect } from 'react';
import { useLLMStore } from '../../../graph/store/llm-store';
import type { RateLimitWait } from '../../../graph/store/llm-store';
import { StreamingOutput } from './StreamingOutput';
import type { AgentStep } from '../../../shared/types';

function formatMs(ms: number): string {
  const seconds = Math.floor(ms / 1000);
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  const remaining = seconds % 60;
  return `${minutes}m ${remaining}s`;
}

export function StepIcon({ status }: { status: AgentStep['status'] }) {
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
  return <div className="w-4 h-4 rounded-full border-2 border-zinc-600 flex-shrink-0" />;
}

export function ElapsedTime({ step }: { step: AgentStep }) {
  const [elapsed, setElapsed] = useState('');

  useEffect(() => {
    if (!step.startedAt) return;
    if (step.completedAt) {
      setElapsed(formatMs(step.completedAt - step.startedAt));
      return;
    }
    const update = () => setElapsed(formatMs(Date.now() - step.startedAt!));
    update();
    const interval = setInterval(update, 1000);
    return () => clearInterval(interval);
  }, [step.startedAt, step.completedAt, step.status]);

  if (!elapsed) return null;
  return <span className="text-xs text-zinc-500 ml-auto">{elapsed}</span>;
}

export function StepTimeline() {
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

export function RateLimitCountdown({ wait }: { wait: RateLimitWait }) {
  const [remaining, setRemaining] = useState('');

  useEffect(() => {
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

export function FetchError({ error }: { error: string }) {
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
