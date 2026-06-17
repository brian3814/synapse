import type { RenderNode } from './types';
import { maxVisibleTier, tierOpacity, TIER_MAX_LABELS, TIER_COUNT } from '../tier-index';

export interface VisibleLabel {
  node: RenderNode;
  opacity: number;
}

export function selectVisibleLabels(nodes: RenderNode[], rawZoom: number): VisibleLabel[] {
  const visTier = maxVisibleTier(rawZoom);
  if (visTier === 0) return [];

  // Bucket nodes by tier
  const buckets: RenderNode[][] = Array.from({ length: TIER_COUNT }, () => []);
  for (const node of nodes) {
    const tier = node.tier ?? 1;
    if (tier <= visTier) {
      buckets[tier - 1].push(node);
    }
  }

  const result: VisibleLabel[] = [];
  for (let t = 0; t < visTier; t++) {
    const cap = TIER_MAX_LABELS[t];
    const opacity = tierOpacity(t + 1, rawZoom);
    const bucket = buckets[t];
    const limit = Math.min(bucket.length, cap);
    for (let i = 0; i < limit; i++) {
      result.push({ node: bucket[i], opacity });
    }
  }

  return result;
}
