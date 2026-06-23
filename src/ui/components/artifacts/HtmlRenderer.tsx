import { useRef, useEffect } from 'react';

interface HtmlRendererProps { content: string; }

export function HtmlRenderer({ content }: HtmlRendererProps) {
  const iframeRef = useRef<HTMLIFrameElement>(null);

  useEffect(() => {
    const iframe = iframeRef.current;
    if (!iframe) return;
    const handleLoad = () => {
      iframe.contentWindow?.postMessage({ type: 'RENDER_HTML', html: content }, '*');
    };
    iframe.addEventListener('load', handleLoad);
    return () => iframe.removeEventListener('load', handleLoad);
  }, [content]);

  const srcdoc = `<!DOCTYPE html>
<html><head>
<meta charset="utf-8">
<style>body { margin: 0; background: #1e1e2e; color: #cdd6f4; font-family: system-ui; }</style>
</head><body>
<div id="root"></div>
<script>
window.addEventListener('message', (e) => {
  if (e.data?.type === 'RENDER_HTML') {
    document.getElementById('root').innerHTML = e.data.html;
  }
});
</script>
</body></html>`;

  return (
    <iframe
      ref={iframeRef}
      sandbox="allow-scripts"
      srcDoc={srcdoc}
      className="w-full h-full border-0 bg-zinc-900"
      title="HTML artifact"
    />
  );
}
