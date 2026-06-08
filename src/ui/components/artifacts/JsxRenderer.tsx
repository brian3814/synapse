import { useRef, useEffect, useState, useCallback } from 'react';

/**
 * Sandboxed JSX renderer.
 *
 * Loads React 19, Sucrase, Recharts, D3, and Tailwind via CDN inside a
 * sandboxed iframe (allow-scripts only, NO allow-same-origin).  The parent
 * sends JSX source via postMessage; the iframe transpiles with Sucrase,
 * evaluates, and renders via React.createRoot.
 *
 * Using srcdoc (not blob: or file://) because sandbox="allow-scripts" without
 * allow-same-origin gives the iframe a null origin -- blob URLs would be
 * blocked.  CDN <script src> tags still load because allow-scripts permits
 * network fetches for script/link elements.
 */

const SANDBOX_HTML = `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<script src="https://unpkg.com/react@19/umd/react.production.min.js" crossorigin></script>
<script src="https://unpkg.com/react-dom@19/umd/react-dom.production.min.js" crossorigin></script>
<script src="https://unpkg.com/sucrase@3/dist/sucrase.min.js"></script>
<script src="https://unpkg.com/recharts@2/umd/Recharts.min.js"></script>
<script src="https://unpkg.com/d3@7/dist/d3.min.js"></script>
<link href="https://cdn.jsdelivr.net/npm/tailwindcss@3/dist/tailwind.min.css" rel="stylesheet">
<style>
body { margin: 0; background: #1e1e2e; color: #cdd6f4; font-family: system-ui, sans-serif; }
#root { min-height: 100vh; }
.error-panel { background: #2d1b1b; border: 1px solid #7f1d1d; border-radius: 8px; padding: 16px; margin: 16px; }
.error-panel pre { color: #fca5a5; font-size: 12px; white-space: pre-wrap; word-break: break-word; }
</style>
</head>
<body>
<div id="root"></div>
<script>
var root = ReactDOM.createRoot(document.getElementById('root'));
function showError(message) {
  document.getElementById('root').innerHTML = '<div class="error-panel"><pre>' + message.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;') + '</pre></div>';
  window.parent.postMessage({ type: 'ERROR', message: message }, '*');
}
window.addEventListener('message', function(event) {
  if (!event.data || event.data.type !== 'RENDER') return;
  try {
    var transformed = Sucrase.transform(event.data.code, { transforms: ['jsx', 'imports'] }).code;
    var mod = { exports: {} };
    var fn = new Function('module', 'exports', 'React', 'recharts', 'd3', 'require', transformed);
    fn(mod, mod.exports, React, Recharts, d3, function(name) {
      var libs = { react: React, recharts: Recharts, d3: d3 };
      if (libs[name]) return libs[name];
      throw new Error('Module not available: ' + name);
    });
    var Component = mod.exports.default || mod.exports;
    if (typeof Component !== 'function') { showError('Artifact must export a default function component.'); return; }
    root.render(React.createElement(Component));
    window.parent.postMessage({ type: 'READY' }, '*');
    var observer = new ResizeObserver(function(entries) {
      for (var i = 0; i < entries.length; i++) {
        window.parent.postMessage({ type: 'RESIZE', height: entries[i].contentRect.height }, '*');
      }
    });
    observer.observe(document.getElementById('root'));
  } catch(err) { showError(String(err.message || err)); }
});
window.parent.postMessage({ type: 'INIT' }, '*');
</script>
</body>
</html>`;

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
        // Iframe finished loading CDN scripts, send the JSX code
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

  // Re-render when content changes (e.g. after source edit + save)
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
        srcDoc={SANDBOX_HTML}
        className="w-full border-0"
        style={{ height: `${height}px` }}
        title="JSX artifact sandbox"
      />
    </div>
  );
}
