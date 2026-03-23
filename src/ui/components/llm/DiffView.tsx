import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useLLMStore } from '../../../graph/store/llm-store';
import type { ExtractionResult, GraphNode, GraphEdge } from '../../../shared/types';

interface DiffViewProps {
  onApply: () => void;
}

const ACTION_STYLES = {
  add: {
    bg: 'bg-emerald-900/20 border-emerald-800/30',
    badge: 'bg-emerald-800 text-emerald-200',
    label: 'new',
  },
  merge: {
    bg: 'bg-amber-900/20 border-amber-800/30',
    badge: 'bg-amber-800 text-amber-200',
    label: 'merge',
  },
  skip: {
    bg: 'bg-zinc-800/50 border-zinc-700/30',
    badge: 'bg-zinc-700 text-zinc-400',
    label: 'skip',
  },
} as const;

export function DiffView({ onApply }: DiffViewProps) {
  const diff = useLLMStore((s) => s.diff);
  const toggleDiffItem = useLLMStore((s) => s.toggleDiffItem);
  const acceptAll = useLLMStore((s) => s.acceptAllDiff);
  const rejectAll = useLLMStore((s) => s.rejectAllDiff);
  const [focusIndex, setFocusIndex] = useState(0);
  const containerRef = useRef<HTMLDivElement>(null);

  if (!diff) return null;

  const nodeItems = diff.items.filter((i) => i.type === 'node');
  const edgeItems = diff.items.filter((i) => i.type === 'edge');
  const acceptedCount = diff.items.filter((i) => i.accepted).length;
  const totalItems = diff.items.length;
  const mergeCount = diff.items.filter((i) => i.action === 'merge').length;
  const newCount = diff.items.filter((i) => i.action === 'add').length;

  // Keyboard navigation
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      // Only handle when this component's container is focused or a child is focused
      if (!containerRef.current?.contains(document.activeElement) && document.activeElement !== containerRef.current) return;

      switch (e.key) {
        case 'j':
        case 'ArrowDown':
          e.preventDefault();
          setFocusIndex((prev) => Math.min(prev + 1, totalItems - 1));
          break;
        case 'k':
        case 'ArrowUp':
          e.preventDefault();
          setFocusIndex((prev) => Math.max(prev - 1, 0));
          break;
        case 'a':
        case ' ':
          e.preventDefault();
          toggleDiffItem(focusIndex);
          break;
        case 'A':
          e.preventDefault();
          acceptAll();
          break;
        case 'R':
          e.preventDefault();
          rejectAll();
          break;
      }
    };

    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [focusIndex, totalItems, toggleDiffItem, acceptAll, rejectAll]);

  return (
    <div ref={containerRef} tabIndex={0} className="space-y-3 outline-none">
      {/* Header with stats */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="text-xs text-zinc-400">
            {acceptedCount}/{totalItems} selected
          </span>
          {mergeCount > 0 && (
            <span className="text-xs px-1.5 py-0.5 rounded bg-amber-900/40 text-amber-300">
              {mergeCount} merge
            </span>
          )}
          {newCount > 0 && (
            <span className="text-xs px-1.5 py-0.5 rounded bg-emerald-900/40 text-emerald-300">
              {newCount} new
            </span>
          )}
        </div>
        <div className="flex gap-1">
          <button onClick={acceptAll} className="text-xs px-2 py-1 bg-zinc-700 text-zinc-300 rounded hover:bg-zinc-600" title="Accept all (Shift+A)">
            All
          </button>
          <button onClick={rejectAll} className="text-xs px-2 py-1 bg-zinc-700 text-zinc-300 rounded hover:bg-zinc-600" title="Reject all (Shift+R)">
            None
          </button>
        </div>
      </div>

      {/* Nodes section */}
      {nodeItems.length > 0 && (
        <div>
          <h4 className="text-xs font-medium text-zinc-400 mb-2">
            Entities ({nodeItems.length})
          </h4>
          <div className="space-y-1">
            {nodeItems.map((item) => {
              const globalIdx = diff.items.indexOf(item);
              const extracted = item.extracted as ExtractionResult['nodes'][0];
              const style = ACTION_STYLES[item.action];
              const isFocused = globalIdx === focusIndex;
              const existing = item.existingMatch as GraphNode | undefined;

              return (
                <div
                  key={globalIdx}
                  className={`rounded border transition-all ${style.bg} ${
                    isFocused ? 'ring-1 ring-indigo-500' : ''
                  } ${!item.accepted ? 'opacity-40' : ''}`}
                  onClick={() => {
                    setFocusIndex(globalIdx);
                    toggleDiffItem(globalIdx);
                  }}
                >
                  <label className="flex items-center gap-2 px-3 py-2 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={item.accepted}
                      onChange={() => toggleDiffItem(globalIdx)}
                      className="rounded border-zinc-600 accent-indigo-500"
                      onClick={(e) => e.stopPropagation()}
                    />
                    <span className={`text-[10px] px-1.5 py-0.5 rounded font-medium uppercase tracking-wide ${style.badge}`}>
                      {style.label}
                    </span>
                    <span className="text-sm text-zinc-200 truncate font-medium">{extracted.name}</span>
                    <span className="text-xs text-zinc-500 ml-auto shrink-0">{extracted.type}</span>
                  </label>

                  {/* Show merge target info */}
                  {item.action === 'merge' && existing && (
                    <div className="px-3 pb-2 pl-9">
                      <p className="text-xs text-amber-400/80">
                        Merges with: <span className="text-zinc-300">{existing.name}</span>
                        {existing.name.toLowerCase() !== extracted.name.toLowerCase() && (
                          <span className="text-zinc-500 ml-1">(alias will be created)</span>
                        )}
                      </p>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Edges section */}
      {edgeItems.length > 0 && (
        <div>
          <h4 className="text-xs font-medium text-zinc-400 mb-2">
            Relationships ({edgeItems.length})
          </h4>
          <div className="space-y-1">
            {edgeItems.map((item) => {
              const globalIdx = diff.items.indexOf(item);
              const extracted = item.extracted as ExtractionResult['edges'][0];
              const isFocused = globalIdx === focusIndex;

              return (
                <label
                  key={globalIdx}
                  className={`flex items-center gap-2 px-3 py-2 rounded cursor-pointer border transition-all
                    bg-emerald-900/20 border-emerald-800/30
                    ${isFocused ? 'ring-1 ring-indigo-500' : ''}
                    ${!item.accepted ? 'opacity-40' : ''}`}
                  onClick={(e) => {
                    e.preventDefault();
                    setFocusIndex(globalIdx);
                    toggleDiffItem(globalIdx);
                  }}
                >
                  <input
                    type="checkbox"
                    checked={item.accepted}
                    onChange={() => toggleDiffItem(globalIdx)}
                    className="rounded border-zinc-600 accent-indigo-500"
                    onClick={(e) => e.stopPropagation()}
                  />
                  <span className="text-[10px] px-1.5 py-0.5 rounded font-medium uppercase tracking-wide bg-emerald-800 text-emerald-200">
                    new
                  </span>
                  <span className="text-sm text-zinc-200 truncate">
                    <span className="text-zinc-300">{extracted.sourceName}</span>
                    <span className="text-zinc-500 mx-1">&rarr;</span>
                    <span className="text-indigo-400">{extracted.label}</span>
                    <span className="text-zinc-500 mx-1">&rarr;</span>
                    <span className="text-zinc-300">{extracted.targetName}</span>
                  </span>
                </label>
              );
            })}
          </div>
        </div>
      )}

      {/* Keyboard hints */}
      <div className="flex gap-3 text-[10px] text-zinc-600 pt-1">
        <span><kbd className="px-1 py-0.5 bg-zinc-800 rounded">j/k</kbd> navigate</span>
        <span><kbd className="px-1 py-0.5 bg-zinc-800 rounded">a</kbd> toggle</span>
        <span><kbd className="px-1 py-0.5 bg-zinc-800 rounded">A</kbd> all</span>
        <span><kbd className="px-1 py-0.5 bg-zinc-800 rounded">R</kbd> none</span>
      </div>

      {/* Apply button */}
      <button
        onClick={onApply}
        disabled={acceptedCount === 0}
        className="w-full bg-indigo-600 text-white text-sm font-medium py-2.5 rounded-lg hover:bg-indigo-500 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
      >
        Apply {acceptedCount} {acceptedCount === 1 ? 'Change' : 'Changes'}
      </button>
    </div>
  );
}
