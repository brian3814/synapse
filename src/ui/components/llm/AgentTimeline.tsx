import React, { useState } from 'react';
import { useLLMStore } from '../../../graph/store/llm-store';
import type { AgentTurn } from '../../../shared/types';

function TurnIcon({ type }: { type: AgentTurn['type'] }) {
  if (type === 'thinking') {
    return (
      <svg className="w-3.5 h-3.5 text-indigo-400 flex-shrink-0 mt-0.5" viewBox="0 0 16 16" fill="currentColor">
        <path d="M8 1a5 5 0 0 0-3.5 8.6V12a1 1 0 0 0 1 1h5a1 1 0 0 0 1-1V9.6A5 5 0 0 0 8 1zm-1.5 13a.5.5 0 0 0 0 1h3a.5.5 0 0 0 0-1h-3z" />
      </svg>
    );
  }
  if (type === 'tool_call') {
    return (
      <svg className="w-3.5 h-3.5 text-amber-400 flex-shrink-0 mt-0.5" viewBox="0 0 16 16" fill="currentColor">
        <path d="M4.5 1l-3 3 3 3 1-1-2-2 2-2-1-1zm7 0l-1 1 2 2-2 2 1 1 3-3-3-3zM5.5 0h1l4 16h-1l-4-16z" />
      </svg>
    );
  }
  // tool_result
  return (
    <svg className="w-3.5 h-3.5 text-green-400 flex-shrink-0 mt-0.5" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M3 8.5l3.5 3.5 6.5-7" />
    </svg>
  );
}

function ThinkingTurn({ turn }: { turn: AgentTurn }) {
  const [expanded, setExpanded] = useState(false);

  if (!turn.content) {
    return (
      <div className="flex items-center gap-2">
        <div className="w-3.5 h-3.5 border-2 border-indigo-400 border-t-transparent rounded-full animate-spin flex-shrink-0" />
        <span className="text-xs text-zinc-400">Thinking...</span>
      </div>
    );
  }

  const preview = turn.content.length > 80 ? turn.content.substring(0, 80) + '...' : turn.content;

  return (
    <div className="space-y-1">
      <button
        onClick={() => setExpanded(!expanded)}
        className="flex items-start gap-2 text-left w-full group"
      >
        <TurnIcon type="thinking" />
        <span className="text-xs text-zinc-300 group-hover:text-zinc-100">
          {expanded ? 'Thinking' : preview}
        </span>
      </button>
      {expanded && (
        <div className="ml-6 text-xs text-zinc-400 bg-zinc-800/50 rounded p-2 whitespace-pre-wrap max-h-40 overflow-y-auto">
          {turn.content}
        </div>
      )}
    </div>
  );
}

function ToolCallTurn({ turn }: { turn: AgentTurn }) {
  const [expanded, setExpanded] = useState(false);
  const inputSummary = turn.toolInput
    ? Object.entries(turn.toolInput)
        .map(([k, v]) => `${k}: ${typeof v === 'string' ? v.substring(0, 40) : JSON.stringify(v).substring(0, 40)}`)
        .join(', ')
    : '';

  return (
    <div className="space-y-1">
      <button
        onClick={() => setExpanded(!expanded)}
        className="flex items-start gap-2 text-left w-full group"
      >
        <TurnIcon type="tool_call" />
        <div className="min-w-0">
          <span className="text-xs font-mono text-amber-300">{turn.toolName}</span>
          {inputSummary && (
            <span className="text-xs text-zinc-500 ml-1">({inputSummary})</span>
          )}
        </div>
      </button>
      {expanded && turn.toolInput && (
        <div className="ml-6 text-xs text-zinc-400 bg-zinc-800/50 rounded p-2 font-mono whitespace-pre-wrap max-h-40 overflow-y-auto">
          {JSON.stringify(turn.toolInput, null, 2)}
        </div>
      )}
    </div>
  );
}

function ToolResultTurn({ turn }: { turn: AgentTurn }) {
  const [expanded, setExpanded] = useState(false);
  const isError = turn.content.startsWith('Error:');
  const preview = turn.content.length > 100
    ? turn.content.substring(0, 100) + '...'
    : turn.content;

  return (
    <div className="space-y-1">
      <button
        onClick={() => setExpanded(!expanded)}
        className="flex items-start gap-2 text-left w-full group"
      >
        <TurnIcon type="tool_result" />
        <span className={`text-xs truncate ${isError ? 'text-red-400' : 'text-zinc-400'}`}>
          {expanded ? `Result for ${turn.toolName ?? 'tool'}` : preview}
        </span>
      </button>
      {expanded && (
        <div className={`ml-6 text-xs bg-zinc-800/50 rounded p-2 font-mono whitespace-pre-wrap max-h-40 overflow-y-auto ${isError ? 'text-red-400' : 'text-zinc-400'}`}>
          {turn.content}
        </div>
      )}
    </div>
  );
}

export function AgentTimeline() {
  const turns = useLLMStore((s) => s.agentTurns);
  const status = useLLMStore((s) => s.status);

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2 mb-3">
        {status === 'agent-running' && (
          <div className="w-3.5 h-3.5 border-2 border-indigo-500 border-t-transparent rounded-full animate-spin flex-shrink-0" />
        )}
        <span className="text-xs font-medium text-zinc-300">
          {status === 'agent-running' ? 'Extracting from page...' : 'Extraction complete'}
        </span>
      </div>

      <div className="space-y-1.5 max-h-[400px] overflow-y-auto">
        {turns.map((turn, i) => {
          switch (turn.type) {
            case 'thinking':
              return <ThinkingTurn key={i} turn={turn} />;
            case 'tool_call':
              return <ToolCallTurn key={i} turn={turn} />;
            case 'tool_result':
              return <ToolResultTurn key={i} turn={turn} />;
          }
        })}
      </div>
    </div>
  );
}
