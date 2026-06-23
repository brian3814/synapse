/**
 * tier-index.ts
 *
 * Pure-function tier computation for H3-inspired label visibility.
 * No DOM/browser dependencies — safe for workers and tests.
 */

// ─── Constants ────────────────────────────────────────────────────────────────

export const TIER_COUNT = 6;

/** Graphs with ≤40 nodes bypass tiering (all tier 1). */
export const TIER_FLOOR_THRESHOLD = 40;

/** Full percentile bucketing kicks in at 200+ nodes. */
export const TIER_FULL_THRESHOLD = 200;

/** Zoom level at which each tier (1-indexed) becomes visible. */
export const TIER_ZOOM_THRESHOLDS: readonly number[] = [0.003, 0.008, 0.02, 0.06, 0.15, 0.5];

/** Per-tier maximum label render cap. */
export const TIER_MAX_LABELS: readonly number[] = [50, 60, 70, 80, 80, 80];

/**
 * Cumulative percentile fractions for tiers 1–6.
 * These sum to 1.0 and are used when the graph is large enough for full bucketing.
 * Tier 1 is overridden by effectiveTier1Pct(); remaining tiers are scaled proportionally.
 */
const TIER_PERCENTILES: readonly number[] = [0.03, 0.07, 0.15, 0.25, 0.25, 0.25];

// ─── Types ────────────────────────────────────────────────────────────────────

export interface NodeDegree {
  nodeId: string;
  degree: number;
}

export interface TierIndex {
  /** nodeId → tier (1–6) */
  tiers: Map<string, number>;
  totalNodes: number;
  maxDegree: number;
}

// ─── Functions ────────────────────────────────────────────────────────────────

/**
 * Returns the fraction of nodes that should land in tier 1, based on graph size.
 *
 * - At or below TIER_FLOOR_THRESHOLD: returns 1.0 (all nodes in tier 1)
 * - At or above TIER_FULL_THRESHOLD: returns 0.03 (normal 3% bucketing)
 * - Between: linear interpolation from 1.0 → 0.03
 */
export function effectiveTier1Pct(totalNodes: number): number {
  if (totalNodes <= TIER_FLOOR_THRESHOLD) return 1.0;
  if (totalNodes >= TIER_FULL_THRESHOLD) return 0.03;
  const t = (totalNodes - TIER_FLOOR_THRESHOLD) / (TIER_FULL_THRESHOLD - TIER_FLOOR_THRESHOLD);
  return 1.0 - t * 0.97;
}

/**
 * Assigns tiers 1–6 to nodes based on relationship degree (higher degree = lower tier number).
 *
 * - Sorts nodes by degree descending.
 * - Small graphs (≤ TIER_FLOOR_THRESHOLD) → all tier 1.
 * - Larger graphs: uses effectiveTier1Pct for tier 1, scales remaining tiers proportionally
 *   from the residual percentiles. Tie-breaking extends a tier to include all nodes with the
 *   same degree as the last node in that tier. Remaining nodes after tier 5 overflow into tier 6.
 */
export function assignTiers(degrees: NodeDegree[]): Map<string, number> {
  const result = new Map<string, number>();
  if (degrees.length === 0) return result;

  const total = degrees.length;

  // Small-graph bypass
  if (total <= TIER_FLOOR_THRESHOLD) {
    for (const { nodeId } of degrees) {
      result.set(nodeId, 1);
    }
    return result;
  }

  // Sort descending by degree (highest degree → tier 1)
  const sorted = [...degrees].sort((a, b) => b.degree - a.degree);

  // Compute per-tier node counts
  // Tier 1 uses effectiveTier1Pct; remaining TIER_COUNT-1 tiers share what's left
  // proportionally to TIER_PERCENTILES[1..5].
  const tier1Pct = effectiveTier1Pct(total);
  const remainingPct = 1.0 - tier1Pct;

  // Sum of the base percentile fractions for tiers 2–6
  const baseRemainingSum = TIER_PERCENTILES.slice(1).reduce((s, v) => s + v, 0);

  // Build array of target counts for each tier
  const targetCounts: number[] = new Array(TIER_COUNT).fill(0);
  targetCounts[0] = Math.max(1, Math.round(total * tier1Pct));
  for (let i = 1; i < TIER_COUNT; i++) {
    const fraction = remainingPct * (TIER_PERCENTILES[i] / baseRemainingSum);
    targetCounts[i] = Math.max(1, Math.round(total * fraction));
  }

  // Assign tiers respecting tie-breaking: if the last slot of a tier lands mid-tie, extend
  let pos = 0;
  for (let tierIdx = 0; tierIdx < TIER_COUNT - 1; tierIdx++) {
    const tierNum = tierIdx + 1;
    const target = targetCounts[tierIdx];
    let end = Math.min(pos + target, total);

    // Extend to include all nodes tied with the node at position end-1
    if (end < total) {
      const boundaryDegree = sorted[end - 1].degree;
      while (end < total && sorted[end].degree === boundaryDegree) {
        end++;
      }
    }

    for (let i = pos; i < end; i++) {
      result.set(sorted[i].nodeId, tierNum);
    }
    pos = end;

    if (pos >= total) break;
  }

  // All remaining nodes → tier 6
  for (let i = pos; i < total; i++) {
    result.set(sorted[i].nodeId, TIER_COUNT);
  }

  return result;
}

/**
 * Builds a complete TierIndex from a list of NodeDegree entries.
 */
export function buildTierIndex(degrees: NodeDegree[]): TierIndex {
  const tiers = assignTiers(degrees);
  const totalNodes = degrees.length;
  const maxDegree = degrees.length > 0 ? Math.max(...degrees.map(d => d.degree)) : 0;
  return { tiers, totalNodes, maxDegree };
}

/**
 * Returns the highest tier number visible at the given zoom level (0 = none visible).
 *
 * Iterates TIER_ZOOM_THRESHOLDS from end; returns i+1 for the first threshold ≤ zoom.
 */
export function maxVisibleTier(zoom: number): number {
  for (let i = TIER_ZOOM_THRESHOLDS.length - 1; i >= 0; i--) {
    if (zoom >= TIER_ZOOM_THRESHOLDS[i]) {
      return i + 1;
    }
  }
  return 0;
}

/**
 * Returns the label opacity for a given tier at the given zoom level.
 *
 * - Returns 0 if zoom is below the tier's threshold.
 * - Linearly ramps from 0 to 1 over the fade range.
 * - Returns 1 once fully faded in.
 *
 * fadeRange = (nextThreshold - thisThreshold) * 0.3
 * For tier 6 (no next threshold): fadeRange = thisThreshold * 3
 */
export function tierOpacity(tier: number, zoom: number): number {
  const idx = tier - 1;
  const threshold = TIER_ZOOM_THRESHOLDS[idx];

  if (zoom < threshold) return 0;

  const nextThreshold = TIER_ZOOM_THRESHOLDS[idx + 1];
  const fadeRange =
    nextThreshold !== undefined
      ? (nextThreshold - threshold) * 0.3
      : threshold * 3;

  if (fadeRange <= 0) return 1;

  const t = (zoom - threshold) / fadeRange;
  return Math.min(1, Math.max(0, t));
}
