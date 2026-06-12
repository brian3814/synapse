import { useExtractionReviewStore } from '../../../graph/store/extraction-review-store';
import { ReviewToolbar } from './ReviewToolbar';
import { ReviewItemList } from './ReviewItemList';

interface ExtractionReviewProps {
  onApply: () => void;
}

export function ExtractionReview({ onApply }: ExtractionReviewProps) {
  const active = useExtractionReviewStore((s) => s.active);
  const nodes = useExtractionReviewStore((s) => s.nodes);
  const edges = useExtractionReviewStore((s) => s.edges);

  if (!active) return null;

  const activeNodeCount = nodes.filter((n) => !n.removed).length;
  const activeNodeIds = new Set(nodes.filter((n) => !n.removed).map((n) => n.tempId));
  const activeEdgeCount = edges.filter(
    (e) => !e.removed && activeNodeIds.has(e.sourceTempId) && activeNodeIds.has(e.targetTempId)
  ).length;
  const totalItems = activeNodeCount + activeEdgeCount;

  return (
    <div className="space-y-3">
      <ReviewToolbar />

      <ReviewItemList />

      {/* Apply button */}
      <button
        onClick={onApply}
        disabled={totalItems === 0}
        className="w-full bg-indigo-600 text-white text-sm font-medium py-2.5 rounded-lg hover:bg-indigo-500 transition-colors disabled:opacity-50 disabled:cursor-not-allowed sticky bottom-0"
      >
        Add to Graph ({totalItems} {totalItems === 1 ? 'item' : 'items'})
      </button>
    </div>
  );
}
