import { useEffect, useRef, useState } from 'react';

let mermaidModule: typeof import('mermaid') | null = null;
let initPromise: Promise<void> | null = null;

function loadMermaid() {
  if (!initPromise) {
    initPromise = import('mermaid').then((mod) => {
      mermaidModule = mod;
      mod.default.initialize({ startOnLoad: false, theme: 'dark' });
    });
  }
  return initPromise;
}

interface MermaidRendererProps { content: string; }

export function MermaidRenderer({ content }: MermaidRendererProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    const id = `mermaid-${Date.now()}`;

    loadMermaid()
      .then(() => {
        if (cancelled || !mermaidModule) return;
        return mermaidModule.default.render(id, content);
      })
      .then((result) => {
        if (!cancelled && result && containerRef.current) {
          containerRef.current.innerHTML = result.svg;
          setError(null);
          setLoading(false);
        }
      })
      .catch((err) => {
        if (!cancelled) {
          setError(String(err));
          setLoading(false);
        }
      });

    return () => { cancelled = true; };
  }, [content]);

  if (error) {
    return (
      <div className="h-full flex flex-col bg-zinc-900 p-4">
        <div className="bg-red-900/20 border border-red-800 rounded-md p-3 mb-4">
          <p className="text-red-400 text-xs font-mono">{error}</p>
        </div>
        <pre className="text-zinc-400 text-xs font-mono overflow-auto">{content}</pre>
      </div>
    );
  }

  return (
    <div className="h-full flex items-center justify-center bg-zinc-900 overflow-auto p-4">
      {loading && <p className="text-zinc-500 text-xs">Rendering diagram...</p>}
      <div ref={containerRef} />
    </div>
  );
}
