import { describe, it, expect } from 'vitest';
import { selectVisibleLabels } from '../../src/graph/renderer/label-visibility';
import type { RenderNode } from '../../src/graph/renderer/types';

function makeNode(id: string, tier?: number): RenderNode {
  return { id, name: `Node ${id}`, x: 0, y: 0, z: 0, color: '#fff', size: 1, tier };
}

describe('selectVisibleLabels', () => {
  it('returns empty array for zoom below all thresholds (zoom 0.01)', () => {
    const nodes = [makeNode('a', 1), makeNode('b', 2)];
    const result = selectVisibleLabels(nodes, 0.01);
    expect(result).toEqual([]);
  });

  it('returns only tier 1 nodes at zoom 0.05', () => {
    const nodes = [makeNode('a', 1), makeNode('b', 2), makeNode('c', 3)];
    const result = selectVisibleLabels(nodes, 0.05);
    expect(result).toHaveLength(1);
    expect(result[0].node.id).toBe('a');
  });

  it('returns tiers 1-3 at zoom 0.45, excluding tier 4+', () => {
    const nodes = [
      makeNode('t1', 1),
      makeNode('t2', 2),
      makeNode('t3', 3),
      makeNode('t4', 4),
      makeNode('t5', 5),
    ];
    const result = selectVisibleLabels(nodes, 0.45);
    const ids = result.map(v => v.node.id);
    expect(ids).toContain('t1');
    expect(ids).toContain('t2');
    expect(ids).toContain('t3');
    expect(ids).not.toContain('t4');
    expect(ids).not.toContain('t5');
  });

  it('returns all tiers at zoom >= 10.0', () => {
    const nodes = [1, 2, 3, 4, 5, 6].map(t => makeNode(`t${t}`, t));
    const result = selectVisibleLabels(nodes, 10.0);
    expect(result).toHaveLength(6);
  });

  it('treats undefined tier as tier 1 (visible at zoom 0.05)', () => {
    const nodes = [makeNode('no-tier')]; // no tier field
    const result = selectVisibleLabels(nodes, 0.05);
    expect(result).toHaveLength(1);
    expect(result[0].node.id).toBe('no-tier');
  });

  it('enforces per-tier caps: 80 tier-1 nodes → only 50 returned (TIER_MAX_LABELS[0] = 50)', () => {
    const nodes = Array.from({ length: 80 }, (_, i) => makeNode(`n${i}`, 1));
    const result = selectVisibleLabels(nodes, 0.05);
    expect(result).toHaveLength(50);
  });

  it('opacity increases as zoom moves further past threshold', () => {
    const nodes = [makeNode('a', 1)];
    // Tier 1 threshold is 0.05. Further past should be more opaque.
    const at005 = selectVisibleLabels(nodes, 0.05);
    const at010 = selectVisibleLabels(nodes, 0.10);
    expect(at010[0].opacity).toBeGreaterThan(at005[0].opacity);
  });
});
