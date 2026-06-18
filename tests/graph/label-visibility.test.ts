import { describe, it, expect } from 'vitest';
import { selectVisibleLabels } from '../../src/graph/renderer/label-visibility';
import { TIER_ZOOM_THRESHOLDS } from '../../src/graph/tier-index';
import type { RenderNode } from '../../src/graph/renderer/types';

function makeNode(id: string, tier?: number): RenderNode {
  return { id, name: `Node ${id}`, x: 0, y: 0, z: 0, color: '#fff', size: 1, tier };
}

describe('selectVisibleLabels', () => {
  it('returns empty array for zoom below all thresholds', () => {
    const nodes = [makeNode('a', 1), makeNode('b', 2)];
    const result = selectVisibleLabels(nodes, TIER_ZOOM_THRESHOLDS[0] / 2);
    expect(result).toEqual([]);
  });

  it('returns only tier 1 nodes at tier 1 zoom threshold', () => {
    const nodes = [makeNode('a', 1), makeNode('b', 2), makeNode('c', 3)];
    const result = selectVisibleLabels(nodes, TIER_ZOOM_THRESHOLDS[0]);
    expect(result).toHaveLength(1);
    expect(result[0].node.id).toBe('a');
  });

  it('returns tiers 1-3 at tier 3 zoom threshold, excluding tier 4+', () => {
    const nodes = [
      makeNode('t1', 1),
      makeNode('t2', 2),
      makeNode('t3', 3),
      makeNode('t4', 4),
      makeNode('t5', 5),
    ];
    const result = selectVisibleLabels(nodes, TIER_ZOOM_THRESHOLDS[2]);
    const ids = result.map(v => v.node.id);
    expect(ids).toContain('t1');
    expect(ids).toContain('t2');
    expect(ids).toContain('t3');
    expect(ids).not.toContain('t4');
    expect(ids).not.toContain('t5');
  });

  it('returns all tiers at tier 6 zoom threshold', () => {
    const nodes = [1, 2, 3, 4, 5, 6].map(t => makeNode(`t${t}`, t));
    const result = selectVisibleLabels(nodes, TIER_ZOOM_THRESHOLDS[5]);
    expect(result).toHaveLength(6);
  });

  it('treats undefined tier as tier 1', () => {
    const nodes = [makeNode('no-tier')];
    const result = selectVisibleLabels(nodes, TIER_ZOOM_THRESHOLDS[0]);
    expect(result).toHaveLength(1);
    expect(result[0].node.id).toBe('no-tier');
  });

  it('enforces per-tier caps: 80 tier-1 nodes capped to 50', () => {
    const nodes = Array.from({ length: 80 }, (_, i) => makeNode(`n${i}`, 1));
    const result = selectVisibleLabels(nodes, TIER_ZOOM_THRESHOLDS[0]);
    expect(result).toHaveLength(50);
  });

  it('opacity increases as zoom moves further past threshold', () => {
    const nodes = [makeNode('a', 1)];
    const atThreshold = selectVisibleLabels(nodes, TIER_ZOOM_THRESHOLDS[0]);
    const pastThreshold = selectVisibleLabels(nodes, TIER_ZOOM_THRESHOLDS[1]);
    expect(pastThreshold[0].opacity).toBeGreaterThan(atThreshold[0].opacity);
  });
});
