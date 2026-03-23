import React, { useState } from 'react';
import type { ChatMessage as ChatMessageType } from '../../hooks/useChatSession';

interface ChatMessageProps {
  message: ChatMessageType;
  onNodeClick?: (nodeId: string) => void;
}

export function ChatMessage({ message, onNodeClick }: ChatMessageProps) {
  if (message.role === 'user') {
    return (
      <div className="flex justify-end">
        <div className="group relative max-w-[85%] bg-indigo-600/20 border border-indigo-500/30 text-zinc-200 text-sm px-3 py-2 rounded-lg">
          {message.content}
          <CopyButton text={message.content} position="bottom-1 right-1" />
        </div>
      </div>
    );
  }

  return (
    <div className="flex justify-start">
      <div className="max-w-[95%] space-y-2">
        {message.status === 'streaming' && (
          <div className="group relative bg-zinc-800 border border-zinc-700 text-sm px-3 py-2 rounded-lg">
            <MarkdownContent content={message.content || '...'} onNodeClick={onNodeClick} />
            <span className="inline-block w-1.5 h-3.5 bg-indigo-400 animate-pulse ml-0.5" />
            <CopyButton text={message.content} position="bottom-1 left-1" />
          </div>
        )}

        {message.status === 'executing' && (
          <div className="bg-zinc-800 border border-zinc-700 text-sm px-3 py-2 rounded-lg">
            <p className="text-zinc-400 text-xs">Searching knowledge graph...</p>
          </div>
        )}

        {message.status === 'complete' && (
          <div className="group relative bg-zinc-800 border border-zinc-700 text-sm px-3 py-2 rounded-lg space-y-2">
            <MarkdownContent content={message.content} onNodeClick={onNodeClick} />
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

/** Simple markdown renderer (bold, links, lists, headers) */
function MarkdownContent({ content, onNodeClick }: { content: string; onNodeClick?: (nodeId: string) => void }) {
  const lines = content.split('\n');

  return (
    <div className="text-zinc-300 text-xs leading-relaxed space-y-1.5">
      {lines.map((line, i) => {
        // Headers
        if (line.startsWith('### ')) {
          return <h4 key={i} className="text-zinc-200 font-semibold text-xs mt-2">{processInline(line.slice(4), onNodeClick)}</h4>;
        }
        if (line.startsWith('## ')) {
          return <h3 key={i} className="text-zinc-200 font-semibold text-sm mt-2">{processInline(line.slice(3), onNodeClick)}</h3>;
        }
        if (line.startsWith('# ')) {
          return <h2 key={i} className="text-zinc-100 font-bold text-sm mt-2">{processInline(line.slice(2), onNodeClick)}</h2>;
        }
        // List items
        if (line.match(/^[-*]\s/)) {
          return <p key={i} className="pl-3">• {processInline(line.slice(2), onNodeClick)}</p>;
        }
        if (line.match(/^\d+\.\s/)) {
          const num = line.match(/^(\d+)\.\s/)![1];
          return <p key={i} className="pl-3">{num}. {processInline(line.replace(/^\d+\.\s/, ''), onNodeClick)}</p>;
        }
        // Empty lines
        if (!line.trim()) return <br key={i} />;
        // Regular text
        return <p key={i}>{processInline(line, onNodeClick)}</p>;
      })}
    </div>
  );
}

/** Process inline markdown (bold, links, inline code, source citations, node links) */
function processInline(text: string, onNodeClick?: (nodeId: string) => void): React.ReactNode {
  const parts: React.ReactNode[] = [];
  let remaining = text;
  let key = 0;

  while (remaining.length > 0) {
    // Source citations: [Source: url]
    const sourceMatch = remaining.match(/\[Source:\s*([^\]]+)\]/);
    // Bold: **text**
    const boldMatch = remaining.match(/\*\*([^*]+)\*\*/);
    // Inline code: `text`
    const codeMatch = remaining.match(/`([^`]+)`/);
    // Links: [text](url)
    const linkMatch = remaining.match(/\[([^\]]+)\]\(([^)]+)\)/);

    // Find the earliest match
    const matches = [
      sourceMatch && { type: 'source', match: sourceMatch },
      boldMatch && { type: 'bold', match: boldMatch },
      codeMatch && { type: 'code', match: codeMatch },
      linkMatch && { type: 'link', match: linkMatch },
    ].filter(Boolean).sort((a, b) => a!.match.index! - b!.match.index!);

    if (matches.length === 0) {
      parts.push(remaining);
      break;
    }

    const earliest = matches[0]!;
    const idx = earliest.match.index!;

    // Text before match
    if (idx > 0) {
      parts.push(remaining.slice(0, idx));
    }

    switch (earliest.type) {
      case 'source': {
        const url = earliest.match[1].trim();
        parts.push(
          <a
            key={key++}
            href={url}
            target="_blank"
            rel="noopener"
            className="text-indigo-400 hover:text-indigo-300 underline underline-offset-2"
            title={url}
          >
            [source]
          </a>
        );
        remaining = remaining.slice(idx + earliest.match[0].length);
        break;
      }
      case 'bold':
        parts.push(<strong key={key++} className="text-zinc-200 font-medium">{earliest.match[1]}</strong>);
        remaining = remaining.slice(idx + earliest.match[0].length);
        break;
      case 'code':
        parts.push(
          <code key={key++} className="bg-zinc-900 px-1 py-0.5 rounded text-indigo-300 text-[11px]">
            {earliest.match[1]}
          </code>
        );
        remaining = remaining.slice(idx + earliest.match[0].length);
        break;
      case 'link': {
        const linkText = earliest.match[1];
        const url = earliest.match[2];
        if (url.startsWith('node:') && onNodeClick) {
          const nodeId = url.slice(5);
          parts.push(
            <button
              key={key++}
              onClick={() => onNodeClick(nodeId)}
              className="text-emerald-400 hover:text-emerald-300 underline underline-offset-2 cursor-pointer inline-flex items-center gap-0.5"
            >
              <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" className="inline shrink-0">
                <circle cx="12" cy="12" r="3" />
                <circle cx="12" cy="12" r="9" opacity="0.3" />
              </svg>
              {linkText}
            </button>
          );
        } else {
          parts.push(
            <a
              key={key++}
              href={url}
              target="_blank"
              rel="noopener"
              className="text-indigo-400 hover:text-indigo-300 underline underline-offset-2"
            >
              {linkText}
            </a>
          );
        }
        remaining = remaining.slice(idx + earliest.match[0].length);
        break;
      }
    }
  }

  return <>{parts}</>;
}

