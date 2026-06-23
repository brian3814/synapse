import { useEffect, useRef, useState } from 'react';
import { extractionProgress } from '../../../core/extraction-progress-service';
import type { ExtractionProgressEvent, ExtractionStage } from '../../../shared/reading-list-types';

interface StageInfo {
  stage: ExtractionStage;
  label: string;
  status: 'pending' | 'active' | 'complete' | 'error';
  meta?: Record<string, unknown>;
  statusText?: string;
  errorMessage?: string;
}

const STAGE_LABELS: Record<ExtractionStage, string> = {
  fetch: 'Fetch content',
  parse: 'Parse text',
  extract: 'Extract entities',
  validate: 'Validate schema',
  similarity: 'Check for similar nodes',
};

const STAGE_ORDER: ExtractionStage[] = ['fetch', 'parse', 'extract', 'validate', 'similarity'];

function buildInitialStages(): StageInfo[] {
  return STAGE_ORDER.map((stage) => ({
    stage,
    label: STAGE_LABELS[stage],
    status: 'pending' as const,
  }));
}

interface Props {
  resourceId: string;
}

export function ExtractionProgressPanel({ resourceId }: Props) {
  const [view, setView] = useState<'steps' | 'stream'>('steps');
  const [stages, setStages] = useState<StageInfo[]>(buildInitialStages);
  const [streamText, setStreamText] = useState('');
  const [strategy, setStrategy] = useState<string | null>(null);
  const [chunkProgress, setChunkProgress] = useState<{
    current: number;
    total: number;
    label?: string;
  } | null>(null);

  const streamRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const cleanup = extractionProgress.on(resourceId, (event: ExtractionProgressEvent) => {
      if (event.type === 'stage-start') {
        setStages((prev) =>
          prev.map((s) =>
            s.stage === event.stage ? { ...s, status: 'active', statusText: event.statusText } : s
          )
        );
      } else if (event.type === 'stage-complete') {
        setStages((prev) =>
          prev.map((s) =>
            s.stage === event.stage
              ? { ...s, status: 'complete', meta: event.meta as Record<string, unknown> | undefined, statusText: event.statusText ?? s.statusText }
              : s
          )
        );
        // Reset chunk progress when extract stage completes
        if (event.stage === 'extract') {
          setChunkProgress(null);
        }
      } else if (event.type === 'llm-chunk') {
        setStreamText((prev) => prev + event.text);
      } else if (event.type === 'strategy-selected') {
        setStrategy(event.reason);
      } else if (event.type === 'chunk-progress') {
        setChunkProgress({ current: event.current, total: event.total, label: event.label });
      } else if (event.type === 'error') {
        setStages((prev) =>
          prev.map((s) =>
            s.stage === event.stage
              ? { ...s, status: 'error', errorMessage: event.message }
              : s
          )
        );
      }
    });
    return cleanup;
  }, [resourceId]);

  // Auto-scroll stream view to bottom
  useEffect(() => {
    if (view === 'stream' && streamRef.current) {
      streamRef.current.scrollTop = streamRef.current.scrollHeight;
    }
  }, [streamText, view]);

  return (
    <div className="flex flex-col h-full bg-zinc-900">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-zinc-700 shrink-0">
        <h2 className="text-sm font-semibold text-zinc-200">Extraction Progress</h2>
        <div className="flex gap-1">
          <button
            onClick={() => setView('steps')}
            className={`px-3 py-1 text-xs rounded font-medium transition-colors ${
              view === 'steps'
                ? 'bg-indigo-600 text-white'
                : 'bg-zinc-700 text-zinc-400 hover:bg-zinc-600 hover:text-zinc-200'
            }`}
          >
            Steps
          </button>
          <button
            onClick={() => setView('stream')}
            className={`px-3 py-1 text-xs rounded font-medium transition-colors ${
              view === 'stream'
                ? 'bg-indigo-600 text-white'
                : 'bg-zinc-700 text-zinc-400 hover:bg-zinc-600 hover:text-zinc-200'
            }`}
          >
            Stream
          </button>
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 min-h-0 overflow-y-auto">
        {view === 'steps' ? (
          <StepsView
            stages={stages}
            strategy={strategy}
            chunkProgress={chunkProgress}
          />
        ) : (
          <StreamView streamText={streamText} containerRef={streamRef} />
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Steps view
// ---------------------------------------------------------------------------

interface StepsViewProps {
  stages: StageInfo[];
  strategy: string | null;
  chunkProgress: { current: number; total: number; label?: string } | null;
}

function StepsView({ stages, strategy, chunkProgress }: StepsViewProps) {
  return (
    <div className="p-4 space-y-3">
      {strategy && (
        <div className="text-xs text-zinc-400 bg-zinc-800 rounded px-3 py-2 mb-4">
          <span className="text-zinc-500 font-medium">Strategy: </span>
          {strategy}
        </div>
      )}
      {stages.map((stage) => (
        <StageRow
          key={stage.stage}
          stage={stage}
          chunkProgress={stage.stage === 'extract' && stage.status === 'active' ? chunkProgress : null}
        />
      ))}
    </div>
  );
}

interface StageRowProps {
  stage: StageInfo;
  chunkProgress: { current: number; total: number; label?: string } | null;
}

function StageRow({ stage, chunkProgress }: StageRowProps) {
  const { status, label, meta, statusText, errorMessage } = stage;

  return (
    <div className="flex items-start gap-3">
      {/* Icon */}
      <div className="mt-0.5 shrink-0">
        {status === 'complete' && (
          <div className="w-5 h-5 rounded-full bg-green-600 flex items-center justify-center">
            <svg className="w-3 h-3 text-white" fill="none" viewBox="0 0 12 12" stroke="currentColor" strokeWidth={2.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M2 6l3 3 5-5" />
            </svg>
          </div>
        )}
        {status === 'active' && (
          <div className="w-5 h-5 rounded-full border-2 border-indigo-500 border-t-transparent animate-spin" />
        )}
        {status === 'pending' && (
          <div className="w-5 h-5 rounded-full border-2 border-zinc-600" />
        )}
        {status === 'error' && (
          <div className="w-5 h-5 rounded-full bg-red-600 flex items-center justify-center">
            <svg className="w-3 h-3 text-white" fill="none" viewBox="0 0 12 12" stroke="currentColor" strokeWidth={2.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M3 3l6 6M9 3l-6 6" />
            </svg>
          </div>
        )}
      </div>

      {/* Label + status text + meta */}
      <div className="flex-1 min-w-0">
        <span
          className={`text-sm ${
            status === 'pending'
              ? 'text-zinc-500'
              : status === 'error'
              ? 'text-red-400'
              : 'text-zinc-200'
          }`}
        >
          {label}
        </span>

        {/* Status text — inline context for each step */}
        {statusText && (
          <p className={`text-xs mt-0.5 ${
            status === 'active' ? 'text-indigo-400' : status === 'complete' ? 'text-zinc-400' : 'text-zinc-500'
          }`}>
            {statusText}
          </p>
        )}

        {/* Meta info for complete stages */}
        {status === 'complete' && meta && (
          <div className="flex gap-3 mt-0.5">
            {meta.ms !== undefined && (
              <span className="text-xs text-zinc-500">{Math.round(meta.ms as number)}ms</span>
            )}
            {meta.bytes !== undefined && (
              <span className="text-xs text-zinc-500">
                {((meta.bytes as number) / 1024).toFixed(1)} KB
              </span>
            )}
            {meta.chars !== undefined && (
              <span className="text-xs text-zinc-500">{(meta.chars as number).toLocaleString()} chars</span>
            )}
          </div>
        )}

        {/* Chunk progress for active extract stage */}
        {status === 'active' && chunkProgress && (
          <div className="mt-1">
            <div className="text-xs text-zinc-400">
              {chunkProgress.label
                ? chunkProgress.label
                : `Chunk ${chunkProgress.current} of ${chunkProgress.total}`}
            </div>
            <div className="mt-1 h-1 bg-zinc-700 rounded-full overflow-hidden w-32">
              <div
                className="h-full bg-indigo-500 rounded-full transition-all duration-300"
                style={{ width: `${Math.round((chunkProgress.current / chunkProgress.total) * 100)}%` }}
              />
            </div>
          </div>
        )}

        {/* Error message */}
        {status === 'error' && errorMessage && (
          <p className="text-xs text-red-400 mt-0.5">{errorMessage}</p>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Stream view
// ---------------------------------------------------------------------------

interface StreamViewProps {
  streamText: string;
  containerRef: React.RefObject<HTMLDivElement | null>;
}

function StreamView({ streamText, containerRef }: StreamViewProps) {
  return (
    <div
      ref={containerRef}
      className="h-full overflow-y-auto p-4 font-mono text-xs text-zinc-300 whitespace-pre-wrap break-words bg-zinc-900 leading-relaxed"
    >
      {streamText || (
        <span className="text-zinc-600 italic">Waiting for LLM output...</span>
      )}
      {streamText && (
        <span className="inline-block w-1.5 h-3.5 bg-zinc-300 ml-0.5 align-middle animate-pulse" />
      )}
    </div>
  );
}
