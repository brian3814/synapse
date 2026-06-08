import { useRef, useEffect, useState, useCallback } from 'react';

const SANDBOX_URL = 'artifact-sandbox://renderer/artifact-renderer.html';

interface JsxRendererProps {
  content: string;
}

export function JsxRenderer({ content }: JsxRendererProps) {
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const [error, setError] = useState<string | null>(null);
  const [height, setHeight] = useState(400);
  const contentRef = useRef(content);
  contentRef.current = content;

  const handleMessage = useCallback((event: MessageEvent) => {
    const iframe = iframeRef.current;
    if (!iframe || event.source !== iframe.contentWindow) return;

    switch (event.data?.type) {
      case 'INIT':
        iframe.contentWindow?.postMessage(
          { type: 'RENDER', code: contentRef.current },
          '*',
        );
        break;
      case 'READY':
        setError(null);
        break;
      case 'ERROR':
        setError(event.data.message);
        break;
      case 'RESIZE':
        if (event.data.height > 0) {
          setHeight(Math.min(event.data.height + 20, 2000));
        }
        break;
    }
  }, []);

  useEffect(() => {
    window.addEventListener('message', handleMessage);
    return () => window.removeEventListener('message', handleMessage);
  }, [handleMessage]);

  useEffect(() => {
    const iframe = iframeRef.current;
    if (iframe?.contentWindow) {
      iframe.contentWindow.postMessage(
        { type: 'RENDER', code: content },
        '*',
      );
    }
  }, [content]);

  return (
    <div className="h-full bg-zinc-900 overflow-auto">
      {error && (
        <div className="bg-red-900/20 border border-red-800 rounded-md p-3 m-3">
          <p className="text-red-400 text-xs font-mono">{error}</p>
        </div>
      )}
      <iframe
        ref={iframeRef}
        sandbox="allow-scripts"
        src={SANDBOX_URL}
        className="w-full border-0"
        style={{ height: `${height}px` }}
        title="JSX artifact sandbox"
      />
    </div>
  );
}
