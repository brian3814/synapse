import React, { useState, useMemo } from 'react';
import { useExtractionReviewStore, type ReviewNode, type PendingConversion } from '../../../graph/store/extraction-review-store';
import { useNodeTypeStore } from '../../../graph/store/node-type-store';
import { SourceLocationBadge } from '../ingestion/SourceLocationBadge';

interface ReviewNodeItemProps {
  node: ReviewNode;
}

export function ReviewNodeItem({ node }: ReviewNodeItemProps) {
  const selectedTempId = useExtractionReviewStore((s) => s.selectedTempId);
  const select = useExtractionReviewStore((s) => s.select);
  const editNode = useExtractionReviewStore((s) => s.editNode);
  const removeNode = useExtractionReviewStore((s) => s.removeNode);
  const acceptMerge = useExtractionReviewStore((s) => s.acceptMerge);
  const dismissMerge = useExtractionReviewStore((s) => s.dismissMerge);
  const prepareConvertToProperty = useExtractionReviewStore((s) => s.prepareConvertToProperty);
  const pendingConversion = useExtractionReviewStore((s) => s.pendingConversion);
  const updateConversionKey = useExtractionReviewStore((s) => s.updateConversionKey);
  const confirmConvertToProperty = useExtractionReviewStore((s) => s.confirmConvertToProperty);
  const cancelConvertToProperty = useExtractionReviewStore((s) => s.cancelConvertToProperty);
  // Select the raw types array (stable reference) and derive labels in useMemo.
  // Calling s.getEntityLabels() inside the selector creates a new array on
  // every invocation, which triggers useSyncExternalStore infinite re-renders.
  const allTypes = useNodeTypeStore((s) => s.types);
  const entityLabels = useMemo(
    () => allTypes.filter((t) => t.category === 'entity_label'),
    [allTypes]
  );

  const isSelected = selectedTempId === node.tempId;
  const [editName, setEditName] = useState(node.name);
  const [editLabel, setEditLabel] = useState(node.label ?? 'concept');
  const [showMergeDetail, setShowMergeDetail] = useState(false);

  const merge = node.mergeRecommendation;
  const isPendingConversion = pendingConversion?.nodeTempId === node.tempId;
  const isEntity = node.type === 'entity';

  const handleClick = () => {
    if (isSelected) {
      select(null, null);
    } else {
      select(node.tempId, 'node');
      setEditName(node.name);
      setEditLabel(node.label ?? 'concept');
    }
  };

  const handleSaveEdit = () => {
    const changes: Partial<Pick<ReviewNode, 'name' | 'label'>> = {};
    if (editName !== node.name) changes.name = editName;
    if (isEntity && editLabel !== (node.label ?? 'concept')) changes.label = editLabel;
    if (Object.keys(changes).length > 0) {
      editNode(node.tempId, changes);
    }
  };

  const borderClass = merge?.status === 'accepted'
    ? 'border-green-700/50'
    : merge?.status === 'pending'
      ? 'border-amber-800/30'
      : 'border-emerald-800/30';

  const bgClass = merge?.status === 'accepted'
    ? 'bg-green-900/20'
    : merge?.status === 'pending'
      ? 'bg-amber-900/20'
      : 'bg-emerald-900/20';

  return (
    <div
      className={`rounded border transition-all ${bgClass} ${borderClass} ${
        isSelected ? 'ring-1 ring-indigo-500' : ''
      }`}
    >
      {/* Header row */}
      <div
        className="flex items-center gap-2 px-3 py-2 cursor-pointer"
        onClick={handleClick}
      >
        <span
          className="w-2 h-2 rounded-full flex-shrink-0"
          style={{
            backgroundColor:
              merge?.status === 'accepted'
                ? '#22c55e'
                : merge?.status === 'pending'
                  ? '#f59e0b'
                  : '#10b981',
          }}
        />
        <span className="text-sm text-zinc-200 truncate font-medium">{node.name}</span>
        <span className="text-xs text-zinc-500 ml-auto shrink-0">
          {isEntity ? (node.label ?? 'concept') : node.type}
        </span>

        {/* Merge badge */}
        {merge?.status === 'pending' && (
          <button
            onClick={(e) => {
              e.stopPropagation();
              setShowMergeDetail(!showMergeDetail);
            }}
            className="text-[10px] px-1.5 py-0.5 rounded bg-amber-800/60 text-amber-200 hover:bg-amber-700/60"
          >
            similar
          </button>
        )}
        {merge?.status === 'accepted' && (
          <span className="text-[10px] px-1.5 py-0.5 rounded bg-green-800/60 text-green-200">
            merging
          </span>
        )}
        {node.sourceLocation && <SourceLocationBadge location={node.sourceLocation} />}
      </div>

      {/* Merge detail expansion */}
      {merge && showMergeDetail && merge.status === 'pending' && (
        <div className="px-3 pb-2 pl-7 space-y-1">
          <p className="text-xs text-amber-400/80">
            Match: <span className="text-zinc-300">{merge.existingName}</span>
            <span className="text-zinc-500 ml-1">({Math.round(merge.similarity * 100)}% {merge.matchType})</span>
          </p>
          <div className="flex gap-1">
            <button
              onClick={(e) => {
                e.stopPropagation();
                acceptMerge(node.tempId);
                setShowMergeDetail(false);
              }}
              className="text-[10px] px-2 py-0.5 rounded bg-green-800 text-green-200 hover:bg-green-700"
            >
              Accept
            </button>
            <button
              onClick={(e) => {
                e.stopPropagation();
                dismissMerge(node.tempId);
                setShowMergeDetail(false);
              }}
              className="text-[10px] px-2 py-0.5 rounded bg-zinc-700 text-zinc-300 hover:bg-zinc-600"
            >
              Dismiss
            </button>
          </div>
        </div>
      )}

      {/* Accepted merge indicator */}
      {merge?.status === 'accepted' && (
        <div className="px-3 pb-2 pl-7">
          <p className="text-xs text-green-400/80">
            Merging with: <span className="text-zinc-300">{merge.existingName}</span>
          </p>
        </div>
      )}

      {/* Selected: inline edit */}
      {isSelected && !isPendingConversion && (
        <div className="px-3 pb-3 pl-7 space-y-2">
          <div className="flex gap-2">
            <input
              type="text"
              value={editName}
              onChange={(e) => setEditName(e.target.value)}
              onBlur={handleSaveEdit}
              onKeyDown={(e) => e.key === 'Enter' && handleSaveEdit()}
              className="flex-1 bg-zinc-800 border border-zinc-700 rounded px-2 py-1 text-xs text-zinc-200 outline-none focus:border-indigo-500"
              placeholder="Name"
              onClick={(e) => e.stopPropagation()}
            />
            {isEntity ? (
              <select
                value={editLabel}
                onChange={(e) => {
                  setEditLabel(e.target.value);
                  editNode(node.tempId, { label: e.target.value });
                }}
                className="bg-zinc-800 border border-zinc-700 rounded px-2 py-1 text-xs text-zinc-200 outline-none focus:border-indigo-500"
                onClick={(e) => e.stopPropagation()}
                title="Entity label"
              >
                {entityLabels.map((t) => (
                  <option key={t.type} value={t.type}>{t.type}</option>
                ))}
                {!entityLabels.some((t) => t.type === editLabel) && editLabel && (
                  <option value={editLabel}>{editLabel}</option>
                )}
              </select>
            ) : (
              <span className="text-xs text-zinc-500 px-2 py-1">{node.type}</span>
            )}
          </div>

          {/* Properties display */}
          {Object.keys(node.properties).length > 0 && (
            <div className="flex flex-wrap gap-1">
              {Object.entries(node.properties).map(([key, value]) => (
                <span key={key} className="text-[10px] px-1.5 py-0.5 rounded bg-zinc-800 text-zinc-400">
                  {key}: {String(value)}
                </span>
              ))}
            </div>
          )}

          <div className="flex gap-1">
            <button
              onClick={(e) => {
                e.stopPropagation();
                prepareConvertToProperty(node.tempId);
              }}
              className="text-[10px] px-2 py-1 rounded bg-zinc-700 text-zinc-300 hover:bg-zinc-600"
            >
              Convert to Property
            </button>
            <button
              onClick={(e) => {
                e.stopPropagation();
                removeNode(node.tempId);
              }}
              className="text-[10px] px-2 py-1 rounded bg-red-900/50 text-red-300 hover:bg-red-800/50"
            >
              Remove
            </button>
          </div>
        </div>
      )}

      {/* Pending conversion preview */}
      {isPendingConversion && pendingConversion && (
        <div className="px-3 pb-3 pl-7 space-y-2">
          {pendingConversion.loading ? (
            <div className="flex items-center gap-2">
              <div className="w-3 h-3 border-2 border-indigo-500 border-t-transparent rounded-full animate-spin" />
              <span className="text-xs text-zinc-400">Suggesting property keys...</span>
            </div>
          ) : (
            <>
              <p className="text-xs text-zinc-400">Property assignments:</p>
              {pendingConversion.assignments.map((a, i) => (
                <div key={i} className="flex items-center gap-1 text-xs">
                  <span className="text-zinc-400">{a.adjacentName} gets:</span>
                  <input
                    type="text"
                    value={a.suggestedKey}
                    onChange={(e) => updateConversionKey(i, e.target.value)}
                    className="w-24 bg-zinc-800 border border-zinc-700 rounded px-1.5 py-0.5 text-zinc-200 outline-none focus:border-indigo-500"
                    onClick={(e) => e.stopPropagation()}
                  />
                  <span className="text-zinc-500">= "{a.value}"</span>
                </div>
              ))}
              <div className="flex gap-1">
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    confirmConvertToProperty();
                  }}
                  className="text-[10px] px-2 py-1 rounded bg-indigo-700 text-indigo-200 hover:bg-indigo-600"
                >
                  Confirm
                </button>
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    cancelConvertToProperty();
                  }}
                  className="text-[10px] px-2 py-1 rounded bg-zinc-700 text-zinc-300 hover:bg-zinc-600"
                >
                  Cancel
                </button>
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}
