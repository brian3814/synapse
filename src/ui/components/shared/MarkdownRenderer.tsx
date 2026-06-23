import { useState, useEffect, useRef, useMemo, type ReactNode } from 'react';
import ReactMarkdown, { type Components, defaultUrlTransform } from 'react-markdown';
import remarkGfm from 'remark-gfm';
import rehypeRaw from 'rehype-raw';
import { useGraphStore } from '../../../graph/store/graph-store';
import { noteAttachments } from '../../../db/client/db-client';

/** Allow custom protocols (wikilink:, node:, attachment:) through react-markdown's URL sanitizer */
function urlTransform(url: string): string {
  if (url.startsWith('wikilink:') || url.startsWith('node:') || url.startsWith('attachment:')) {
    return url;
  }
  return defaultUrlTransform(url);
}

interface MarkdownRendererProps {
  content: string;
  onNodeClick?: (nodeId: string) => void;
  className?: string;
}

/**
 * Pre-process markdown to convert [[wikilinks]] into a custom link syntax
 * that react-markdown can parse. We convert [[Label]] → [Label](wikilink:Label)
 * and [[Label|Display]] → [Display](wikilink:Label).
 */
function preprocessWikilinks(content: string): string {
  return content.replace(/\[\[([^\]]+)\]\]/g, (_match, inner: string) => {
    const parts = inner.split('|');
    const label = parts[0].trim();
    const display = parts.length > 1 ? parts[1].trim() : label;
    return `[${display}](wikilink:${encodeURIComponent(label)})`;
  });
}

export function MarkdownRenderer({ content, onNodeClick, className }: MarkdownRendererProps) {
  const processed = useMemo(() => preprocessWikilinks(content), [content]);

  const components = useMemo<Components>(
    () => ({
      // Tables
      table: ({ children }) => (
        <table className="border-collapse w-full my-2">{children}</table>
      ),
      thead: ({ children }) => <thead>{children}</thead>,
      tbody: ({ children }) => <tbody>{children}</tbody>,
      tr: ({ children }) => <tr className="border-b border-zinc-700">{children}</tr>,
      th: ({ children }) => (
        <th className="border border-zinc-600 px-2 py-1 bg-zinc-800 text-zinc-200 text-left font-medium">
          {children}
        </th>
      ),
      td: ({ children }) => (
        <td className="border border-zinc-700 px-2 py-1 text-zinc-300">{children}</td>
      ),
      // Headers
      h1: ({ children }) => <h1 className="text-zinc-100 font-bold text-base mt-3 mb-1">{children}</h1>,
      h2: ({ children }) => <h2 className="text-zinc-100 font-bold text-sm mt-3 mb-1">{children}</h2>,
      h3: ({ children }) => <h3 className="text-zinc-200 font-semibold text-sm mt-2 mb-1">{children}</h3>,
      h4: ({ children }) => <h4 className="text-zinc-200 font-semibold text-xs mt-2">{children}</h4>,
      // Text
      p: ({ children }) => <p className="my-1">{children}</p>,
      strong: ({ children }) => <strong className="text-zinc-200 font-medium">{children}</strong>,
      em: ({ children }) => <em className="text-zinc-300 italic">{children}</em>,
      del: ({ children }) => <del className="text-zinc-500">{children}</del>,
      // Code
      code: ({ className: codeClassName, children }) => {
        const isBlock = codeClassName?.startsWith('language-');
        if (isBlock) {
          return (
            <code className={`${codeClassName} text-indigo-300 text-[11px]`}>{children}</code>
          );
        }
        return (
          <code className="bg-zinc-900 px-1 py-0.5 rounded text-indigo-300 text-[11px]">
            {children}
          </code>
        );
      },
      pre: ({ children }) => (
        <pre className="bg-zinc-900 rounded p-2 overflow-x-auto my-2 text-[11px]">{children}</pre>
      ),
      // Lists
      ul: ({ children }) => <ul className="pl-4 list-disc space-y-0.5 my-1">{children}</ul>,
      ol: ({ children }) => <ol className="pl-4 list-decimal space-y-0.5 my-1">{children}</ol>,
      li: ({ children }) => <li>{children}</li>,
      // Task lists (GFM)
      input: (props) => (
        <input {...props} disabled className="mr-1 accent-indigo-500" />
      ),
      // Blockquotes
      blockquote: ({ children }) => (
        <blockquote className="border-l-2 border-zinc-600 pl-3 my-2 text-zinc-400 italic">
          {children}
        </blockquote>
      ),
      // Horizontal rules
      hr: () => <hr className="border-zinc-700 my-3" />,
      // Links — handle wikilink: and node: protocols
      a: ({ href, children }) => {
        if (href?.startsWith('wikilink:')) {
          const label = decodeURIComponent(href.slice(9));
          return (
            <WikiLinkInline
              label={label}
              display={children as string}
              onNodeClick={onNodeClick}
            />
          );
        }
        if (href?.startsWith('node:') && onNodeClick) {
          const nodeId = href.slice(5);
          return (
            <button
              onClick={() => onNodeClick(nodeId)}
              className="text-emerald-400 hover:text-emerald-300 underline underline-offset-2 cursor-pointer"
            >
              {children}
            </button>
          );
        }
        return (
          <a
            href={href}
            target="_blank"
            rel="noopener noreferrer"
            className="text-indigo-400 hover:text-indigo-300 underline underline-offset-2"
          >
            {children}
          </a>
        );
      },
      // Images — handle attachment: protocol
      img: ({ src, alt }) => {
        if (src?.startsWith('attachment:')) {
          return <AttachmentImage attachmentId={src.slice(11)} alt={alt ?? ''} />;
        }
        return (
          <img
            src={src}
            alt={alt}
            className="max-w-full rounded my-1"
            loading="lazy"
          />
        );
      },
      // Iframes — sandboxed
      iframe: (props) => (
        <iframe
          {...props}
          sandbox="allow-scripts allow-same-origin"
          className="w-full rounded border border-zinc-700 my-2"
          style={{ minHeight: 200 }}
        />
      ),
    }),
    [onNodeClick]
  );

  return (
    <div className={className ?? 'text-zinc-300 text-xs leading-relaxed space-y-1.5'}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        rehypePlugins={[rehypeRaw]}
        urlTransform={urlTransform}
        components={components}
      >
        {processed}
      </ReactMarkdown>
    </div>
  );
}

/** Renders markdown content with wikilink resolution for note previews */
export function NoteMarkdownPreview({
  content,
  onNodeClick,
}: {
  content: string;
  onNodeClick?: (nodeId: string) => void;
}) {
  return (
    <MarkdownRenderer
      content={content}
      onNodeClick={onNodeClick}
      className="text-zinc-300 text-sm leading-relaxed space-y-2"
    />
  );
}

/**
 * Legacy inline processor — kept for backward compatibility with components
 * that render a single line of markdown (e.g., ChatMessage).
 */
export function processInline(
  text: string,
  onNodeClick?: (nodeId: string) => void
): ReactNode {
  // Quick path: render a single line through MarkdownRenderer
  return <MarkdownRenderer content={text} onNodeClick={onNodeClick} />;
}

// --- Internal components ---

/** Renders a [[wikilink]] — green if node exists, gray if not */
function WikiLinkInline({
  label,
  display,
  onNodeClick,
}: {
  label: string;
  display: ReactNode;
  onNodeClick?: (nodeId: string) => void;
}) {
  const node = useGraphStore((s) =>
    s.nodes.find((n) => n.name.toLowerCase() === label.toLowerCase())
  );

  if (node && onNodeClick) {
    return (
      <button
        onClick={() => onNodeClick(node.id)}
        className="text-emerald-400 hover:text-emerald-300 underline underline-offset-2 cursor-pointer inline-flex items-center gap-0.5"
      >
        <svg
          width="10"
          height="10"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2.5"
          strokeLinecap="round"
          className="inline shrink-0"
        >
          <circle cx="12" cy="12" r="3" />
          <circle cx="12" cy="12" r="9" opacity="0.3" />
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

/** Loads and displays an image stored as a BLOB in note_attachments */
const blobUrlCache = new Map<string, string>();

function AttachmentImage({ attachmentId, alt }: { attachmentId: string; alt: string }) {
  const [url, setUrl] = useState<string | null>(blobUrlCache.get(attachmentId) ?? null);
  const [error, setError] = useState(false);
  const revokeRef = useRef<string | null>(null);

  useEffect(() => {
    if (blobUrlCache.has(attachmentId)) {
      setUrl(blobUrlCache.get(attachmentId)!);
      return;
    }

    let cancelled = false;
    noteAttachments.get(attachmentId).then((attachment: any) => {
      if (cancelled || !attachment?.data) {
        if (!cancelled) setError(true);
        return;
      }
      const blob = new Blob([attachment.data], { type: attachment.mime_type });
      const blobUrl = URL.createObjectURL(blob);
      blobUrlCache.set(attachmentId, blobUrl);
      revokeRef.current = blobUrl;
      setUrl(blobUrl);
    }).catch(() => {
      if (!cancelled) setError(true);
    });

    return () => { cancelled = true; };
  }, [attachmentId]);

  if (error) {
    return <span className="text-xs text-zinc-500 italic">[image not found]</span>;
  }
  if (!url) {
    return <span className="text-xs text-zinc-500">Loading image...</span>;
  }
  return <img src={url} alt={alt} className="max-w-full rounded my-1" loading="lazy" />;
}
