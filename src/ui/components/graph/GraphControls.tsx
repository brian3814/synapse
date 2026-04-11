import React from 'react';
import type { GraphCanvasHandle } from '../../../graph/renderer/types';
import { useUIStore } from '../../../graph/store/ui-store';
import { useGraphStore } from '../../../graph/store/graph-store';

interface GraphControlsProps {
  graphRef: React.RefObject<GraphCanvasHandle | null>;
}

export function GraphControls({ graphRef }: GraphControlsProps) {
  const visibleLayers = useUIStore((s) => s.visibleLayers);
  const toggleLayer = useUIStore((s) => s.toggleLayer);
  const nodeCount = useGraphStore((s) => s.nodes.length);
  const edgeCount = useGraphStore((s) => s.edges.length);

  const handleFitView = () => {
    graphRef.current?.fitToView();
  };

  const handleZoomIn = () => {
    graphRef.current?.zoomIn();
  };

  const handleZoomOut = () => {
    graphRef.current?.zoomOut();
  };

  const handleScreenshot = async () => {
    try {
      const blob = await graphRef.current?.captureScreenshot();
      if (!blob) return;
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      const date = new Date().toISOString().slice(0, 10);
      a.download = `knowledge-graph-${date}.png`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch {
      // Screenshot failed silently — renderer may not be ready
    }
  };

  const layerButton = (
    layer: 'entity' | 'note' | 'resource',
    label: string,
    color: string
  ) => {
    const active = visibleLayers[layer];
    return (
      <button
        key={layer}
        onClick={() => toggleLayer(layer)}
        className={`flex items-center gap-1 text-[10px] px-1.5 py-1 rounded border transition-colors ${
          active
            ? 'bg-zinc-700 text-zinc-100 border-zinc-500'
            : 'bg-zinc-800/50 text-zinc-500 border-zinc-700 hover:text-zinc-300'
        }`}
        title={`${active ? 'Hide' : 'Show'} ${label} layer`}
      >
        <span
          className="w-1.5 h-1.5 rounded-full"
          style={{ backgroundColor: active ? color : '#52525b' }}
        />
        {label}
      </button>
    );
  };

  return (
    <div className="absolute top-3 left-3 flex items-center gap-2 bg-zinc-900/80 border border-zinc-700 rounded p-1 backdrop-blur-sm">
      {/* Layer toggles */}
      <div className="flex gap-1">
        {layerButton('entity', 'Entities', '#7C3AED')}
        {layerButton('note', 'Notes', '#0EA5E9')}
        {layerButton('resource', 'Resources', '#059669')}
      </div>
      <div className="w-px h-4 bg-zinc-600" />
      {/* Stats */}
      <span className="text-[10px] text-zinc-500 whitespace-nowrap">
        {nodeCount}n · {edgeCount}e
      </span>
      <div className="w-px h-4 bg-zinc-600" />
      {/* Zoom + View controls */}
      <div className="flex items-center gap-0.5">
        <button onClick={handleZoomIn} className="text-zinc-300 text-xs px-1.5 py-0.5 rounded hover:bg-zinc-700" title="Zoom in">+</button>
        <button onClick={handleZoomOut} className="text-zinc-300 text-xs px-1.5 py-0.5 rounded hover:bg-zinc-700" title="Zoom out">−</button>
        <button onClick={handleFitView} className="text-zinc-300 text-xs px-1.5 py-0.5 rounded hover:bg-zinc-700" title="Fit to view">⊞</button>
        <button onClick={handleScreenshot} className="text-zinc-300 text-xs px-1.5 py-0.5 rounded hover:bg-zinc-700" title="Screenshot">⎙</button>
      </div>
    </div>
  );
}
