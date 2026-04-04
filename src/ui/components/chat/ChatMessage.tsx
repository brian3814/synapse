import React, { useState } from 'react';
import type { ChatMessage as ChatMessageType } from '../../hooks/useChatSession';
import { ChatToolCall } from './ChatToolCall';
import { ChatReferencedEntities } from './ChatReferencedEntities';
import { MarkdownRenderer } from '../shared/MarkdownRenderer';

interface ChatMessageProps {
  message: ChatMessageType;
  onNodeClick?: (nodeId: string) => void;
}

export function ChatMessage({ message, onNodeClick }: ChatMessageProps) {
  if (message.role === 'user') {
    return (
      <div className="flex justify-end" style={{ marginBottom: '0.75rem' }}>
        <div className="group relative max-w-[85%] bg-indigo-600/20 border border-indigo-500/30 text-zinc-200 text-sm px-3 py-2 rounded-lg">
          {message.content}
          <CopyButton text={message.content} position="bottom-1 right-1" />
        </div>
      </div>
    );
  }

  return (
    <div className="flex justify-start" style={{ marginBottom: '0.75rem' }}>
      <div className="max-w-[95%] space-y-2">
        {message.status === 'streaming' && (
          <div className="group relative bg-zinc-800 border border-zinc-700 text-sm px-3 py-2 rounded-lg">
            {message.agentTurns && message.agentTurns.length > 0 && (
              <div className="space-y-1 mb-2">
                {message.agentTurns.map((turn, i) => (
                  <ChatToolCall key={i} turn={turn} />
                ))}
              </div>
            )}
            <MarkdownRenderer content={message.content || '...'} onNodeClick={onNodeClick} />
            <span className="inline-block w-1.5 h-3.5 bg-indigo-400 animate-pulse ml-0.5" />
            <CopyButton text={message.content} position="bottom-1 left-1" />
          </div>
        )}

        {message.status === 'executing' && (
          <div className="bg-zinc-800 border border-zinc-700 text-sm px-3 py-2 rounded-lg">
            {message.agentTurns && message.agentTurns.length > 0 && (
              <div className="space-y-1 mb-2">
                {message.agentTurns.map((turn, i) => (
                  <ChatToolCall key={i} turn={turn} />
                ))}
              </div>
            )}
            <p className="text-zinc-400 text-xs">Thinking...</p>
          </div>
        )}

        {message.status === 'complete' && (
          <div className="group relative bg-zinc-800 border border-zinc-700 text-sm px-3 py-2 rounded-lg space-y-2">
            {message.agentTurns && message.agentTurns.length > 0 && (
              <div className="space-y-1 mb-2">
                {message.agentTurns.map((turn, i) => (
                  <ChatToolCall key={i} turn={turn} />
                ))}
              </div>
            )}
            <MarkdownRenderer content={message.content} onNodeClick={onNodeClick} />
            {message.subgraph && message.subgraph.nodeIds.length > 0 && (
              <ChatReferencedEntities subgraph={message.subgraph} onNodeClick={onNodeClick} />
            )}
            <CopyButton text={message.content} position="bottom-1 left-1" />
          </div>
        )}

        {message.status === 'error' && (
          <div className="bg-zinc-800 border border-red-500/30 text-sm px-3 py-2 rounded-lg">
            <p className="text-red-400 text-xs">{message.error}</p>
          </div>
        )}
      </div>
    </div>
  );
}

function CopyButton({ text, position }: { text: string; position: string }) {
  const [copied, setCopied] = useState(false);

  const handleCopy = () => {
    navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  return (
    <button
      onClick={handleCopy}
      className={`absolute ${position} opacity-0 group-hover:opacity-100 transition-opacity p-1 rounded bg-zinc-700/80 hover:bg-zinc-600 text-zinc-400 hover:text-zinc-200`}
      title="Copy"
    >
      {copied ? (
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M20 6 9 17l-5-5" />
        </svg>
      ) : (
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <rect x="9" y="9" width="13" height="13" rx="2" />
          <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
        </svg>
      )}
    </button>
  );
}


