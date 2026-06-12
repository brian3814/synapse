import { useEffect, useState } from 'react';
import { getExtension } from '../vault-explorer/file-type-utils';
import { MarkdownRenderer } from '../shared/MarkdownRenderer';

declare const window: Window & {
  electronIPC: {
    invoke(channel: string, ...args: unknown[]): Promise<unknown>;
  };
};

interface ViewerTabProps {
  filePath: string;
}

const IMAGE_EXTS = new Set(['.png', '.jpg', '.jpeg', '.gif', '.webp', '.svg']);

export function ViewerTab({ filePath }: ViewerTabProps) {
  const ext = getExtension(filePath);

  if (ext === '.md') {
    return <MarkdownViewer filePath={filePath} />;
  }

  if (IMAGE_EXTS.has(ext)) {
    return <ImageViewer filePath={filePath} ext={ext} />;
  }

  if (ext === '.pdf') {
    return <PdfViewer filePath={filePath} />;
  }

  return (
    <div className="h-full flex items-center justify-center bg-zinc-900 text-zinc-400 text-sm">
      <span>No preview available for {ext || 'this file type'}</span>
    </div>
  );
}

function ImageViewer({ filePath, ext }: { filePath: string; ext: string }) {
  const [blobUrl, setBlobUrl] = useState<string | null>(null);

  useEffect(() => {
    let revoked = false;
    (async () => {
      const data = await window.electronIPC.invoke('vault-explorer:read-file', filePath) as number[];
      if (revoked) return;
      const mimeMap: Record<string, string> = {
        '.png': 'image/png',
        '.jpg': 'image/jpeg',
        '.jpeg': 'image/jpeg',
        '.gif': 'image/gif',
        '.webp': 'image/webp',
        '.svg': 'image/svg+xml',
      };
      const mime = mimeMap[ext] || 'application/octet-stream';
      const blob = new Blob([new Uint8Array(data)], { type: mime });
      setBlobUrl(URL.createObjectURL(blob));
    })();
    return () => {
      revoked = true;
      if (blobUrl) URL.revokeObjectURL(blobUrl);
    };
  }, [filePath, ext]);

  if (!blobUrl) {
    return (
      <div className="h-full flex items-center justify-center bg-zinc-900 text-zinc-400 text-sm">
        Loading...
      </div>
    );
  }

  return (
    <div className="h-full flex items-center justify-center bg-zinc-900 overflow-auto p-4">
      <img
        src={blobUrl}
        alt={filePath.split('/').pop() ?? ''}
        className="max-w-full max-h-full object-contain rounded shadow-lg"
      />
    </div>
  );
}

function PdfViewer({ filePath }: { filePath: string }) {
  const [blobUrl, setBlobUrl] = useState<string | null>(null);

  useEffect(() => {
    let revoked = false;
    (async () => {
      const data = await window.electronIPC.invoke('vault-explorer:read-file', filePath) as number[];
      if (revoked) return;
      const blob = new Blob([new Uint8Array(data)], { type: 'application/pdf' });
      setBlobUrl(URL.createObjectURL(blob));
    })();
    return () => {
      revoked = true;
      if (blobUrl) URL.revokeObjectURL(blobUrl);
    };
  }, [filePath]);

  if (!blobUrl) {
    return (
      <div className="h-full flex items-center justify-center bg-zinc-900 text-zinc-400 text-sm">
        Loading...
      </div>
    );
  }

  return (
    <div className="h-full w-full bg-zinc-900">
      <iframe
        src={blobUrl}
        className="w-full h-full border-0"
        title={filePath.split('/').pop() ?? 'PDF'}
      />
    </div>
  );
}

function MarkdownViewer({ filePath }: { filePath: string }) {
  const [content, setContent] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const data = await window.electronIPC.invoke('vault-explorer:read-file', filePath) as number[];
      if (cancelled) return;
      const text = new TextDecoder().decode(new Uint8Array(data));
      setContent(text);
    })();
    return () => { cancelled = true; };
  }, [filePath]);

  if (content === null) {
    return (
      <div className="h-full flex items-center justify-center bg-zinc-900 text-zinc-400 text-sm">
        Loading...
      </div>
    );
  }

  return (
    <div className="h-full overflow-y-auto bg-zinc-900 p-6">
      <div className="max-w-3xl mx-auto prose prose-invert prose-sm">
        <MarkdownRenderer content={content} />
      </div>
    </div>
  );
}
