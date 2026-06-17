import { describe, it, expect } from 'vitest';
import {
  effectiveTier1Pct,
  assignTiers,
  buildTierIndex,
  maxVisibleTier,
  tierOpacity,
  TIER_COUNT,
  TIER_FLOOR_THRESHOLD,
  TIER_FULL_THRESHOLD,
  TIER_ZOOM_THRESHOLDS,
  TIER_MAX_LABELS,
} from '../../src/graph/tier-index';
import type { NodeDegree } from '../../src/graph/tier-index';

function makeDegrees(pairs: Array<[string, number]>): NodeDegree[] {
  return pairs.map(([nodeId, degree]) => ({ nodeId, degree }));
}

// ─── effectiveTier1Pct ────────────────────────────────────────────────────────

describe('effectiveTier1Pct', () => {
  it('returns 1.0 at TIER_FLOOR_THRESHOLD (40 nodes)', () => {
    expect(effectiveTier1Pct(TIER_FLOOR_THRESHOLD)).toBe(1.0);
  });

  it('returns 1.0 below TIER_FLOOR_THRESHOLD (3 nodes)', () => {
    expect(effectiveTier1Pct(3)).toBe(1.0);
  });

  it('returns 1.0 for 0 nodes', () => {
    expect(effectiveTier1Pct(0)).toBe(1.0);
  });

  it('returns 0.03 at TIER_FULL_THRESHOLD (200 nodes)', () => {
    expect(effectiveTier1Pct(TIER_FULL_THRESHOLD)).toBeCloseTo(0.03, 10);
  });

  it('returns 0.03 above TIER_FULL_THRESHOLD (500 nodes)', () => {
    expect(effectiveTier1Pct(500)).toBeCloseTo(0.03, 10);
  });

  it('interpolates at midpoint (120 nodes)', () => {
    // t = (120 - 40) / (200 - 40) = 80/160 = 0.5
    // result = 1.0 - 0.5 * 0.97 = 0.515
    const result = effectiveTier1Pct(120);
    expect(result).toBeCloseTo(0.515, 5);
  });

  it('interpolates at quarter point (80 nodes)', () => {
    // t = (80 - 40) / (200 - 40) = 40/160 = 0.25
    // result = 1.0 - 0.25 * 0.97 = 0.7575
    const result = effectiveTier1Pct(80);
    expect(result).toBeCloseTo(0.7575, 5);
  });
});

// ─── assignTiers ─────────────────────────────────────────────────────────────

describe('assignTiers — small graphs', () => {
  it('assigns all 3 nodes to tier 1', () => {
    const degrees = makeDegrees([['a', 5], ['b', 3], ['c', 1]]);
    const tiers = assignTiers(degrees);
    expect(tiers.get('a')).toBe(1);
    expect(tiers.get('b')).toBe(1);
    expect(tiers.get('c')).toBe(1);
  });

  it('assigns all 40 nodes to tier 1 (boundary)', () => {
    const pairs: Array<[string, number]> = Array.from({ length: 40 }, (_, i) => [
      `n${i}`, 10 - (i % 10),
    ]);
    const degrees = makeDegrees(pairs);
    const tiers = assignTiers(degrees);
    for (const deg of degrees) {
      expect(tiers.get(deg.nodeId)).toBe(1);
    }
  });

  it('handles empty input', () => {
    const tiers = assignTiers([]);
    expect(tiers.size).toBe(0);
  });
});

describe('assignTiers — full bucketing (200 nodes)', () => {
  // Create 200 nodes with distinct degrees 1..200
  function make200() {
    const pairs: Array<[string, number]> = Array.from({ length: 200 }, (_, i) => [
      `n${i}`, i + 1,
    ]);
    return makeDegrees(pairs);
  }

  it('produces all 6 tiers', () => {
    const degrees = make200();
    const tiers = assignTiers(degrees);
    const tierSet = new Set(tiers.values());
    for (let t = 1; t <= TIER_COUNT; t++) {
      expect(tierSet.has(t)).toBe(true);
    }
  });

  it('tier 1 gets approximately 3% of nodes (6 nodes at 200)', () => {
    const degrees = make200();
    const tiers = assignTiers(degrees);
    const tier1Count = [...tiers.values()].filter(t => t === 1).length;
    // 3% of 200 = 6
    expect(tier1Count).toBe(6);
  });

  it('tier 6 gets approximately 25% of nodes (50 nodes at 200)', () => {
    const degrees = make200();
    const tiers = assignTiers(degrees);
    const tier6Count = [...tiers.values()].filter(t => t === 6).length;
    // Should be around 25% = 50 nodes
    expect(tier6Count).toBeGreaterThanOrEqual(45);
    expect(tier6Count).toBeLessThanOrEqual(55);
  });

  it('higher-degree nodes get lower tier numbers', () => {
    const degrees = make200();
    const tiers = assignTiers(degrees);
    // n199 has degree 200 (highest) → should be tier 1
    // n0 has degree 1 (lowest) → should be tier 6
    expect(tiers.get('n199')).toBe(1);
    expect(tiers.get('n0')).toBe(6);
  });

  it('all node IDs are present in the result', () => {
    const degrees = make200();
    const tiers = assignTiers(degrees);
    expect(tiers.size).toBe(200);
    for (const deg of degrees) {
      expect(tiers.has(deg.nodeId)).toBe(true);
    }
  });
});

describe('assignTiers — tie-breaking', () => {
  it('all nodes with equal degree end up in the same tier', () => {
    // 200 nodes all with degree 5 → all should be same tier
    const pairs: Array<[string, number]> = Array.from({ length: 200 }, (_, i) => [
      `n${i}`, 5,
    ]);
    const degrees = makeDegrees(pairs);
    const tiers = assignTiers(degrees);
    const tierValues = [...tiers.values()];
    const uniqueTiers = new Set(tierValues);
    expect(uniqueTiers.size).toBe(1);
  });

  it('extends tier to include all tied nodes at boundary', () => {
    // Construct: 5 nodes with degree 100, 195 nodes with degree 1
    // With 200 nodes, tier 1 boundary is at 3% = 6 nodes
    // The 5 high-degree nodes should all be tier 1
    // Boundary falls in the middle of the low-degree group
    const pairs: Array<[string, number]> = [
      ...Array.from({ length: 5 }, (_, i): [string, number] => [`high${i}`, 100]),
      ...Array.from({ length: 195 }, (_, i): [string, number] => [`low${i}`, 1]),
    ];
    const degrees = makeDegrees(pairs);
    const tiers = assignTiers(degrees);
    // All high-degree nodes should be tier 1
    for (let i = 0; i < 5; i++) {
      expect(tiers.get(`high${i}`)).toBe(1);
    }
  });
});

// ─── buildTierIndex ────────────────────────────────────────────────────────────

describe('buildTierIndex', () => {
  it('returns correct totalNodes', () => {
    const degrees = makeDegrees([['a', 5], ['b', 3], ['c', 1]]);
    const index = buildTierIndex(degrees);
    expect(index.totalNodes).toBe(3);
  });

  it('returns correct maxDegree', () => {
    const degrees = makeDegrees([['a', 5], ['b', 3], ['c', 1]]);
    const index = buildTierIndex(degrees);
    expect(index.maxDegree).toBe(5);
  });

  it('tiers map contains all nodes', () => {
    const degrees = makeDegrees([['a', 5], ['b', 3], ['c', 1]]);
    const index = buildTierIndex(degrees);
    expect(index.tiers.size).toBe(3);
    expect(index.tiers.has('a')).toBe(true);
    expect(index.tiers.has('b')).toBe(true);
    expect(index.tiers.has('c')).toBe(true);
  });

  it('handles empty input gracefully', () => {
    const index = buildTierIndex([]);
    expect(index.totalNodes).toBe(0);
    expect(index.maxDegree).toBe(0);
    expect(index.tiers.size).toBe(0);
  });
});

// ─── maxVisibleTier ───────────────────────────────────────────────────────────

describe('maxVisibleTier', () => {
  it('returns 0 below all thresholds (zoom 0.04)', () => {
    // TIER_ZOOM_THRESHOLDS[0] = 0.05
    expect(maxVisibleTier(0.04)).toBe(0);
  });

  it('returns 0 at zoom 0.0', () => {
    expect(maxVisibleTier(0.0)).toBe(0);
  });

  it('returns 1 exactly at first threshold (0.05)', () => {
    expect(maxVisibleTier(TIER_ZOOM_THRESHOLDS[0])).toBe(1);
  });

  it('returns 1 just above first threshold (0.06)', () => {
    expect(maxVisibleTier(0.06)).toBe(1);
  });

  it('returns 2 exactly at second threshold (0.15)', () => {
    expect(maxVisibleTier(TIER_ZOOM_THRESHOLDS[1])).toBe(2);
  });

  it('returns 3 exactly at third threshold (0.45)', () => {
    expect(maxVisibleTier(TIER_ZOOM_THRESHOLDS[2])).toBe(3);
  });

  it('returns 4 exactly at fourth threshold (1.2)', () => {
    expect(maxVisibleTier(TIER_ZOOM_THRESHOLDS[3])).toBe(4);
  });

  it('returns 5 exactly at fifth threshold (3.5)', () => {
    expect(maxVisibleTier(TIER_ZOOM_THRESHOLDS[4])).toBe(5);
  });

  it('returns 6 exactly at sixth threshold (10.0)', () => {
    expect(maxVisibleTier(TIER_ZOOM_THRESHOLDS[5])).toBe(6);
  });

  it('returns 6 well above all thresholds (zoom 100)', () => {
    expect(maxVisibleTier(100)).toBe(6);
  });

  it('returns lower tier between two thresholds', () => {
    // Between 0.15 and 0.45, should return 2
    expect(maxVisibleTier(0.3)).toBe(2);
  });
});

// ─── tierOpacity ─────────────────────────────────────────────────────────────

describe('tierOpacity', () => {
  it('returns 0 below tier 1 threshold', () => {
    // tier 1 threshold = 0.05; below that → 0
    expect(tierOpacity(1, 0.01)).toBe(0);
  });

  it('returns 0 for tier 2 when zoom is between tier 1 and tier 2 thresholds', () => {
    // tier 2 threshold = 0.15; zoom = 0.06 (above tier 1 but below tier 2) → 0 for tier 2
    expect(tierOpacity(2, 0.06)).toBe(0);
  });

  it('returns 1 well above tier 1 threshold (fully faded in)', () => {
    // tier 1: threshold=0.05, fadeRange=(0.15-0.05)*0.3=0.03
    // zoom=0.05+0.03+epsilon = 0.081 → should be 1
    expect(tierOpacity(1, 0.09)).toBe(1);
  });

  it('returns value between 0 and 1 right at tier threshold (fading in)', () => {
    // At exactly the threshold, opacity starts its ramp from 0
    const opacity = tierOpacity(1, TIER_ZOOM_THRESHOLDS[0]);
    expect(opacity).toBeGreaterThanOrEqual(0);
    expect(opacity).toBeLessThanOrEqual(1);
    // At threshold exactly, it should be 0 (start of fade)
    expect(opacity).toBe(0);
  });

  it('returns 1 for tier 6 well above its threshold', () => {
    // tier 6: threshold=10.0, fadeRange=10.0*3=30.0
    // zoom=50 → should be 1
    expect(tierOpacity(6, 50)).toBe(1);
  });

  it('returns 0 for tier 6 below its threshold', () => {
    expect(tierOpacity(6, 5.0)).toBe(0);
  });

  it('linearly ramps between 0 and 1 during fade range', () => {
    // tier 1: threshold=0.05, fadeRange=(0.15-0.05)*0.3=0.03
    // midpoint of fade = 0.05 + 0.015 = 0.065 → opacity ~0.5
    const midOpacity = tierOpacity(1, 0.065);
    expect(midOpacity).toBeCloseTo(0.5, 5);
  });

  it('clamps at 1 above fade range', () => {
    // well past fade → 1
    expect(tierOpacity(3, 10.0)).toBe(1);
  });
});

// ─── exported constants sanity checks ────────────────────────────────────────

describe('constants', () => {
  it('TIER_COUNT is 6', () => {
    expect(TIER_COUNT).toBe(6);
  });

  it('TIER_FLOOR_THRESHOLD is 40', () => {
    expect(TIER_FLOOR_THRESHOLD).toBe(40);
  });

  it('TIER_FULL_THRESHOLD is 200', () => {
    expect(TIER_FULL_THRESHOLD).toBe(200);
  });

  it('TIER_ZOOM_THRESHOLDS has 6 entries', () => {
    expect(TIER_ZOOM_THRESHOLDS).toHaveLength(6);
  });

  it('TIER_MAX_LABELS has 6 entries', () => {
    expect(TIER_MAX_LABELS).toHaveLength(6);
  });
});
