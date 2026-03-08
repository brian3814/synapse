import React, { useState } from 'react';
import { useExtractionReviewStore, type ReviewEdge } from '../../../graph/store/extraction-review-store';

interface ReviewEdgeItemProps {
  edge: ReviewEdge;
  sourceLabel: string;
  targetLabel: string;
}

export function ReviewEdgeItem({ edge, sourceLabel, targetLabel }: ReviewEdgeItemProps) {
  const selectedTempId = useExtractionReviewStore((s) => s.selectedTempId);
  const select = useExtractionReviewStore((s) => s.select);
  const editEdge = useExtractionReviewStore((s) => s.editEdge);
  const removeEdge = useExtractionReviewStore((s) => s.removeEdge);

  const isSelected = selectedTempId === edge.tempId;
  const [editLabel, setEditLabel] = useState(edge.label);

  const handleClick = () => {
    if (isSelected) {
      select(null, null);
    } else {
      select(edge.tempId, 'edge');
      setEditLabel(edge.label);
    }
  };

  const handleSaveEdit = () => {
    if (editLabel !== edge.label) {
      editEdge(edge.tempId, { label: editLabel });
    }
  };

  return (
    <div
      className={`rounded border transition-all bg-emerald-900/20 border-emerald-800/30 ${
        isSelected ? 'ring-1 ring-indigo-500' : ''
      }`}
    >
      <div
        className="flex items-center gap-1.5 px-3 py-2 cursor-pointer"
        onClick={handleClick}
      >
        <span className="text-sm text-zinc-200 truncate">
          <span className="text-zinc-300">{sourceLabel}</span>
          <span className="text-zinc-500 mx-1">&rarr;</span>
          <span className="text-indigo-400">{edge.label}</span>
          <span className="text-zinc-500 mx-1">&rarr;</span>
          <span className="text-zinc-300">{targetLabel}</span>
        </span>
      </div>

      {isSelected && (
        <div className="px-3 pb-3 space-y-2">
          <input
            type="text"
            value={editLabel}
            onChange={(e) => setEditLabel(e.target.value)}
            onBlur={handleSaveEdit}
            onKeyDown={(e) => e.key === 'Enter' && handleSaveEdit()}
            className="w-full bg-zinc-800 border border-zinc-700 rounded px-2 py-1 text-xs text-zinc-200 outline-none focus:border-indigo-500"
            placeholder="Relationship label"
            onClick={(e) => e.stopPropagation()}
          />
          <button
            onClick={(e) => {
              e.stopPropagation();
              removeEdge(edge.tempId);
            }}
            className="text-[10px] px-2 py-1 rounded bg-red-900/50 text-red-300 hover:bg-red-800/50"
          >
            Remove
          </button>
        </div>
      )}
    </div>
  );
}
