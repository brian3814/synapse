import React, { useEffect } from 'react';
import { useExtractionReviewStore } from '../../../graph/store/extraction-review-store';

export function ReviewToolbar() {
  const viewMode = useExtractionReviewStore((s) => s.viewMode);
  const setViewMode = useExtractionReviewStore((s) => s.setViewMode);
  const undoStack = useExtractionReviewStore((s) => s.undoStack);
  const redoStack = useExtractionReviewStore((s) => s.redoStack);
  const undo = useExtractionReviewStore((s) => s.undo);
  const redo = useExtractionReviewStore((s) => s.redo);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const mod = e.metaKey || e.ctrlKey;
      if (mod && e.key === 'z' && !e.shiftKey) {
        e.preventDefault();
        undo();
      } else if (mod && e.key === 'z' && e.shiftKey) {
        e.preventDefault();
        redo();
      }
    };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [undo, redo]);

  return (
    <div className="flex items-center justify-between">
      <div className="flex gap-0.5 bg-zinc-800 rounded p-0.5">
        <button
          onClick={() => setViewMode('extracted')}
          className={`text-xs px-2 py-1 rounded transition-colors ${
            viewMode === 'extracted' ? 'bg-zinc-600 text-zinc-100' : 'text-zinc-400 hover:text-zinc-200'
          }`}
        >
          Extracted
        </button>
        <button
          onClick={() => setViewMode('overlay')}
          className={`text-xs px-2 py-1 rounded transition-colors ${
            viewMode === 'overlay' ? 'bg-zinc-600 text-zinc-100' : 'text-zinc-400 hover:text-zinc-200'
          }`}
        >
          Overlay
        </button>
      </div>
      <div className="flex gap-1">
        <button
          onClick={undo}
          disabled={undoStack.length === 0}
          className="text-xs px-2 py-1 bg-zinc-700 text-zinc-300 rounded hover:bg-zinc-600 disabled:opacity-30 disabled:cursor-not-allowed"
          title="Undo (Cmd+Z)"
        >
          <svg className="w-3.5 h-3.5" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M3 7h7a3 3 0 0 1 0 6H8" />
            <path d="M6 4L3 7l3 3" />
          </svg>
        </button>
        <button
          onClick={redo}
          disabled={redoStack.length === 0}
          className="text-xs px-2 py-1 bg-zinc-700 text-zinc-300 rounded hover:bg-zinc-600 disabled:opacity-30 disabled:cursor-not-allowed"
          title="Redo (Cmd+Shift+Z)"
        >
          <svg className="w-3.5 h-3.5" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M13 7H6a3 3 0 0 0 0 6h2" />
            <path d="M10 4l3 3-3 3" />
          </svg>
        </button>
      </div>
    </div>
  );
}
