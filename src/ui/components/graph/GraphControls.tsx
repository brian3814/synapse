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
  const graphOverlay = useUIStore((s) => s.graphOverlay);
  const setGraphOverlay = useUIStore((s) => s.setGraphOverlay);
  const nodeCount = useGraphStore((s) => s.nodes.length);
  const edgeCount = useGraphStore((s) => s.edges.length);
  const selectedNodeIds = useGraphStore((s) => s.selectedNodeIds);
  const selectedCount = selectedNodeIds.size;

  const handleFitView = () => {
    graphRef.current?.fitToView();
  };

  const handleZoomIn = () => {
    graphRef.current?.zoomIn();
  };

  const handleZoomOut = () => {
    graphRef.current?.zoomOut();
  };

  const handleRefresh = () => {
    useGraphStore.getState().loadAll();
  };

  const handleDeleteSelected = async () => {
    if (selectedCount === 0) return;
    const store = useGraphStore.getState();
    const ids = [...store.selectedNodeIds];
    store.clearSelection();
    for (const id of ids) {
      await store.deleteNode(id);
    }
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
    <div className="absolute top-3 left-3 flex items-center gap-1.5 bg-zinc-900/80 border border-zinc-700 rounded-lg p-1.5 backdrop-blur-sm z-10">
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
        <button onClick={handleZoomIn} className="text-zinc-300 px-1 py-0.5 rounded hover:bg-zinc-700" title="Zoom in">
          <ZoomInIcon />
        </button>
        <button onClick={handleZoomOut} className="text-zinc-300 px-1 py-0.5 rounded hover:bg-zinc-700" title="Zoom out">
          <ZoomOutIcon />
        </button>
        <button onClick={handleFitView} className="text-zinc-300 text-xs px-1.5 py-0.5 rounded hover:bg-zinc-700" title="Fit to view">⊞</button>
        <button onClick={handleRefresh} className="text-zinc-300 px-1 py-0.5 rounded hover:bg-zinc-700" title="Reload graph">
          <RefreshIcon />
        </button>
        <button onClick={handleScreenshot} className="text-zinc-300 text-xs px-1.5 py-0.5 rounded hover:bg-zinc-700" title="Screenshot">⎙</button>
      </div>
      <div className="w-px h-4 bg-zinc-600" />
      {/* Create / Delete */}
      <div className="flex items-center gap-0.5">
        <button
          onClick={() => setGraphOverlay('create')}
          className={`p-1 rounded transition-colors ${
            graphOverlay === 'create'
              ? 'bg-indigo-600 text-white'
              : 'text-zinc-300 hover:bg-zinc-700'
          }`}
          title="Create node"
        >
          <PlusIcon />
        </button>
        <button
          onClick={handleDeleteSelected}
          disabled={selectedCount === 0}
          className={`p-1 rounded transition-colors ${
            selectedCount === 0
              ? 'text-zinc-600 cursor-default'
              : 'text-zinc-300 hover:bg-red-900/50 hover:text-red-400'
          }`}
          title={selectedCount > 0 ? `Delete ${selectedCount} selected` : 'Select nodes to delete'}
        >
          <TrashIcon />
        </button>
      </div>
    </div>
  );
}

const ZoomInIcon = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <circle cx="11" cy="11" r="8" />
    <line x1="21" y1="21" x2="16.65" y2="16.65" />
    <line x1="11" y1="8" x2="11" y2="14" />
    <line x1="8" y1="11" x2="14" y2="11" />
  </svg>
);

const ZoomOutIcon = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <circle cx="11" cy="11" r="8" />
    <line x1="21" y1="21" x2="16.65" y2="16.65" />
    <line x1="8" y1="11" x2="14" y2="11" />
  </svg>
);

const PlusIcon = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
    <path d="M12 5v14M5 12h14" />
  </svg>
);

const RefreshIcon = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M21 2v6h-6" />
    <path d="M3 12a9 9 0 0 1 15-6.7L21 8" />
    <path d="M3 22v-6h6" />
    <path d="M21 12a9 9 0 0 1-15 6.7L3 16" />
  </svg>
);

const TrashIcon = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M3 6h18" />
    <path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6" />
    <path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2" />
  </svg>
);
