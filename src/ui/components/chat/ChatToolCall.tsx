import React, { useState } from 'react';
import type { ChatAgentTurn } from '../../../shared/types';

interface ChatToolCallProps {
  turn: ChatAgentTurn;
}

export function ChatToolCall({ turn }: ChatToolCallProps) {
  const [open, setOpen] = useState(false);

  if (turn.type === 'thinking') {
    return (
      <details className="group/detail">
        <summary className="text-[10px] text-zinc-500 italic cursor-pointer select-none hover:text-zinc-400 list-none flex items-center gap-1">
          <ChevronIcon open={false} className="group-open/detail:rotate-90 transition-transform" />
          Thinking...
        </summary>
        <p className="text-[10px] text-zinc-500 italic mt-1 pl-3 whitespace-pre-wrap">{turn.content}</p>
      </details>
    );
  }

  if (turn.type === 'tool_call') {
    return (
      <div className="bg-zinc-900 rounded px-2 py-1.5">
        <div className="flex items-center gap-1.5">
          <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-mono bg-amber-900/30 text-amber-400 border border-amber-700/30">
            {turn.toolName || 'tool'}
          </span>
        </div>
        {turn.toolInput && Object.keys(turn.toolInput).length > 0 && (
          <details className="mt-1 group/input">
            <summary className="text-[10px] text-zinc-500 cursor-pointer select-none hover:text-zinc-400 list-none flex items-center gap-1">
              <ChevronIcon open={false} className="group-open/input:rotate-90 transition-transform" />
              Input
            </summary>
            <pre className="text-[10px] text-zinc-400 mt-1 pl-3 overflow-x-auto whitespace-pre-wrap break-all">
              {JSON.stringify(turn.toolInput, null, 2)}
            </pre>
          </details>
        )}
      </div>
    );
  }

  if (turn.type === 'tool_result') {
    const isError = turn.isError === true;
    const truncated = turn.content.length > 200
      ? turn.content.slice(0, 200) + '...'
      : turn.content;
    const needsExpand = turn.content.length > 200;

    return (
      <div className="bg-zinc-900 rounded px-2 py-1.5">
        <div className="flex items-center gap-1.5">
          <span
            className={`inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-mono ${
              isError
                ? 'bg-red-900/30 text-red-400 border border-red-700/30'
                : 'bg-emerald-900/30 text-emerald-400 border border-emerald-700/30'
            }`}
          >
            {isError ? 'error' : 'result'}
          </span>
        </div>
        {needsExpand ? (
          <details className="mt-1 group/result">
            <summary className="text-[10px] text-zinc-400 cursor-pointer select-none hover:text-zinc-300 list-none">
              <span className="whitespace-pre-wrap break-all">{truncated}</span>
            </summary>
            <pre className="text-[10px] text-zinc-400 mt-1 overflow-x-auto whitespace-pre-wrap break-all">
              {turn.content}
            </pre>
          </details>
        ) : (
          <p className="text-[10px] text-zinc-400 mt-1 whitespace-pre-wrap break-all">{turn.content}</p>
        )}
      </div>
    );
  }

  return null;
}

function ChevronIcon({ open, className }: { open: boolean; className?: string }) {
  return (
    <svg
      width="10"
      height="10"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={`shrink-0 ${className || ''}`}
    >
      <path d="m9 18 6-6-6-6" />
    </svg>
  );
}
