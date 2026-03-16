import React from 'react';
import type { GraphCanvasHandle } from '../../../graph/renderer/types';
import { useUIStore } from '../../../graph/store/ui-store';
import { LAYOUT_OPTIONS } from '../../../shared/constants';

interface GraphControlsProps {
  graphRef: React.RefObject<GraphCanvasHandle | null>;
}

export function GraphControls({ graphRef }: GraphControlsProps) {
  const { layoutType, setLayoutType, displayMode } = useUIStore();
  const isSidePanel = displayMode === 'sidePanel';

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

  const availableLayouts = isSidePanel
    ? LAYOUT_OPTIONS.filter((l) => !l.id.includes('3d'))
    : LAYOUT_OPTIONS;

  return (
    <div className="absolute bottom-3 left-3 flex flex-col gap-2">
      {/* Layout selector */}
      <select
        value={layoutType}
        onChange={(e) => setLayoutType(e.target.value)}
        className="bg-zinc-800 text-zinc-300 text-xs border border-zinc-600 rounded px-2 py-1 outline-none focus:border-indigo-500"
      >
        {availableLayouts.map((opt) => (
          <option key={opt.id} value={opt.id}>
            {opt.label}
          </option>
        ))}
      </select>

      {/* Zoom controls */}
      <div className="flex gap-1">
        <button
          onClick={handleZoomIn}
          className="bg-zinc-800 text-zinc-300 border border-zinc-600 rounded px-2 py-1 text-xs hover:bg-zinc-700"
          title="Zoom in"
        >
          +
        </button>
        <button
          onClick={handleZoomOut}
          className="bg-zinc-800 text-zinc-300 border border-zinc-600 rounded px-2 py-1 text-xs hover:bg-zinc-700"
          title="Zoom out"
        >
          −
        </button>
        <button
          onClick={handleFitView}
          className="bg-zinc-800 text-zinc-300 border border-zinc-600 rounded px-2 py-1 text-xs hover:bg-zinc-700"
          title="Fit to view"
        >
          ⊞
        </button>
        <button
          onClick={handleScreenshot}
          className="bg-zinc-800 text-zinc-300 border border-zinc-600 rounded px-2 py-1 text-xs hover:bg-zinc-700"
          title="Screenshot"
        >
          ⎙
        </button>
      </div>
    </div>
  );
}
