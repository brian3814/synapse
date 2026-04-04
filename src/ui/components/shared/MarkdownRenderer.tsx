import React from 'react';
import { useGraphStore } from '../../../graph/store/graph-store';

interface MarkdownRendererProps {
  content: string;
  onNodeClick?: (nodeId: string) => void;
  className?: string;
}

/** Reusable markdown renderer — supports headers, bold, code, links, wikilinks, lists */
export function MarkdownRenderer({ content, onNodeClick, className }: MarkdownRendererProps) {
  const lines = content.split('\n');

  return (
    <div className={className ?? 'text-zinc-300 text-xs leading-relaxed space-y-1.5'}>
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
          return <p key={i} className="pl-3">{'\u2022'} {processInline(line.slice(2), onNodeClick)}</p>;
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

/** Renders markdown content with wikilink resolution for note previews */
export function NoteMarkdownPreview({ content, onNodeClick }: { content: string; onNodeClick?: (nodeId: string) => void }) {
  return (
    <MarkdownRenderer
      content={content}
      onNodeClick={onNodeClick}
      className="text-zinc-300 text-sm leading-relaxed space-y-2"
    />
  );
}

/** Process inline markdown: bold, code, links, source citations, wikilinks */
export function processInline(text: string, onNodeClick?: (nodeId: string) => void): React.ReactNode {
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
    // Wikilinks: [[Label]] or [[Label|Display]]
    const wikiMatch = remaining.match(/\[\[([^\]]+)\]\]/);
    // Links: [text](url)
    const linkMatch = remaining.match(/\[([^\]]+)\]\(([^)]+)\)/);

    // Find the earliest match
    const matches = [
      sourceMatch && { type: 'source', match: sourceMatch },
      boldMatch && { type: 'bold', match: boldMatch },
      codeMatch && { type: 'code', match: codeMatch },
      wikiMatch && { type: 'wiki', match: wikiMatch },
      linkMatch && { type: 'link', match: linkMatch },
    ].filter(Boolean).sort((a, b) => a!.match.index! - b!.match.index!);

    if (matches.length === 0) {
      parts.push(remaining);
      break;
    }

    const earliest = matches[0]!;
    const idx = earliest.match.index!;

    if (idx > 0) {
      parts.push(remaining.slice(0, idx));
    }

    switch (earliest.type) {
      case 'source': {
        const url = earliest.match[1].trim();
        let domain = 'source';
        try { domain = new URL(url).hostname.replace('www.', ''); } catch {}
        parts.push(
          <a key={key++} href={url} target="_blank" rel="noopener"
            className="text-indigo-400 hover:text-indigo-300 underline underline-offset-2" title={url}>
            [{domain}]
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
      case 'wiki': {
        const raw = earliest.match[1];
        const label = raw.split('|')[0].trim();
        const display = raw.includes('|') ? raw.split('|')[1].trim() : label;
        parts.push(<WikiLinkInline key={key++} label={label} display={display} onNodeClick={onNodeClick} />);
        remaining = remaining.slice(idx + earliest.match[0].length);
        break;
      }
      case 'link': {
        const linkText = earliest.match[1];
        const url = earliest.match[2];
        if (url.startsWith('node:') && onNodeClick) {
          const nodeId = url.slice(5);
          parts.push(
            <button key={key++} onClick={() => onNodeClick(nodeId)}
              className="text-emerald-400 hover:text-emerald-300 underline underline-offset-2 cursor-pointer inline-flex items-center gap-0.5">
              <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" className="inline shrink-0">
                <circle cx="12" cy="12" r="3" /><circle cx="12" cy="12" r="9" opacity="0.3" />
              </svg>
              {linkText}
            </button>
          );
        } else {
          parts.push(
            <a key={key++} href={url} target="_blank" rel="noopener"
              className="text-indigo-400 hover:text-indigo-300 underline underline-offset-2">
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

/** Renders a [[wikilink]] — green if node exists, gray if not */
function WikiLinkInline({ label, display, onNodeClick }: { label: string; display: string; onNodeClick?: (nodeId: string) => void }) {
  const node = useGraphStore((s) => s.nodes.find((n) => n.name.toLowerCase() === label.toLowerCase()));

  if (node && onNodeClick) {
    return (
      <button
        onClick={() => onNodeClick(node.id)}
        className="text-emerald-400 hover:text-emerald-300 underline underline-offset-2 cursor-pointer inline-flex items-center gap-0.5"
      >
        <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" className="inline shrink-0">
          <circle cx="12" cy="12" r="3" /><circle cx="12" cy="12" r="9" opacity="0.3" />
        </svg>
        {display}
      </button>
    );
  }

  return (
    <span className="text-zinc-500 underline underline-offset-2 decoration-dashed">
      {display}
    </span>
  );
}
