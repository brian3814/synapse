import { useMemo } from 'react';

interface SvgRendererProps { content: string; }

export function SvgRenderer({ content }: SvgRendererProps) {
  const blobUrl = useMemo(() => {
    const blob = new Blob([content], { type: 'image/svg+xml' });
    return URL.createObjectURL(blob);
  }, [content]);

  return (
    <div className="h-full flex items-center justify-center bg-zinc-900 overflow-auto p-4">
      <img src={blobUrl} alt="SVG artifact" className="max-w-full max-h-full object-contain" />
    </div>
  );
}
