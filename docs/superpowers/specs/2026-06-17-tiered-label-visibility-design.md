# Tiered Label Visibility (H3-Inspired)

## Summary

Replace the binary on/off label rendering with a hierarchical tiered system inspired by Uber's H3 geospatial indexing. Nodes are bucketed into tiers by relationship count at vault load. As the user zooms in, each tier progressively becomes visible — hubs first, then mid-tier, then leaves. This creates a "semantic zoom" where the graph reveals more detail as you get closer, like a map showing countries → cities → streets.

## Problem

Current behavior (`label-layer.ts:90`):
- Labels are **all hidden** at zoom < 1.5 (`medium` and `far`)
- Labels are **all shown** at zoom >= 1.5 (`close`), up to a hard cap of 200 in array insertion order
- No prioritization by importance — a leaf node with 1 edge renders before a hub with 50 edges if it appears earlier in the array
- The transition is jarring: zero labels → 200 labels in a single step

## Goals

- Hub nodes (high relationship count) are always identifiable, even when zoomed far out
- Progressive disclosure: zooming in gradually reveals more labels, like increasing H3 resolution
- Small graphs (early vault usage) remain fully legible — the system never makes a 20-node graph harder to read
- Opacity fade-in per tier for smooth transitions
- Near-zero runtime cost — tier computation is O(n) and rendering cost stays bounded

## Non-Goals

- Spatial clustering / aggregation (the existing `far` zoom cluster mode handles that separately)
- Label collision avoidance / overlap detection (future enhancement)
- User-configurable tier count or thresholds (hardcoded sensible defaults first)

## Design

### Tier Model

Six tiers, numbered 1 (most prominent) through 6 (least prominent). The tier number determines **when** (at what zoom level) a node's label first appears. Font size is uniform across all tiers (11px, matching current behavior) — visual hierarchy comes from progressive disclosure and opacity fade-in, not text size.

```
Tier 1  ████████  Hubs        — visible earliest
Tier 2  ██████    High-mid
Tier 3  █████     Mid
Tier 4  ████      Low-mid
Tier 5  ███       Low
Tier 6  ██        Leaves      — visible only when close
```

### Tier Assignment: Adaptive Percentile Bucketing

Edge count alone can't determine tiers because graph sizes and density vary enormously. A fixed rule like "tier 1 = 20+ edges" fails on a 30-node graph where the max degree is 5.

**Algorithm**: rank all nodes by degree (edge count) descending, then assign tiers by cumulative percentile:

```
Tier 1:  top 3%     (the few true hubs)
Tier 2:  next 7%    (3–10%)
Tier 3:  next 15%   (10–25%)
Tier 4:  next 25%   (25–50%)
Tier 5:  next 25%   (50–75%)
Tier 6:  bottom 25% (75–100%)
```

Tiers are weighted toward the top — tier 1 is deliberately tiny (the "resolution 0" of H3). This means at maximum zoom-out, only 3% of nodes show labels, which is readable even for large graphs.

**Tie-breaking**: nodes with equal degree stay in the same tier, which may cause a tier to exceed its target percentile. This is fine — the thresholds are approximate, and a tier with 5% instead of 3% doesn't break anything. The computation rounds to the nearest tier boundary rather than splitting nodes with equal degree across tiers.

### Small Graph Adaptation

This is the critical edge case. A user with 20 nodes and sparse edges should not see a barren graph.

**Rule: if `totalNodes <= TIER_FLOOR_THRESHOLD` (default 40), bypass tiering entirely and assign all nodes tier 1.**

This means all labels are visible at the earliest zoom threshold. On a small graph there's no clutter problem to solve — showing 20–40 labels is fine at any zoom level.

The threshold of 40 is chosen because:
- At 40 nodes, the Canvas2D `fillText` cost is trivial
- 40 labels on screen is readable without clutter
- Below 40 nodes, percentile bucketing produces tiers with very few nodes (3% of 30 = 1 node), which feels arbitrary

**Graduated ramp-up** between 40 and ~200 nodes: as the graph grows past the floor, tier 1 gradually shrinks from "all nodes" toward the 3% target. This prevents a jarring transition at exactly 40 nodes.

```typescript
function effectiveTier1Pct(totalNodes: number): number {
  if (totalNodes <= TIER_FLOOR_THRESHOLD) return 1.0; // 100% — all nodes in tier 1
  if (totalNodes >= TIER_FULL_THRESHOLD) return 0.03; // 3% — normal bucketing
  // Linear interpolation between floor and full
  const t = (totalNodes - TIER_FLOOR_THRESHOLD) / (TIER_FULL_THRESHOLD - TIER_FLOOR_THRESHOLD);
  return 1.0 - t * 0.97;
}
```

| Nodes | Effective Tier 1 % | Tier 1 count | Behavior |
|---|---|---|---|
| 20 | 100% | 20 | All labels always visible |
| 40 | 100% | 40 | All labels always visible |
| 80 | ~72% | ~58 | Most labels visible early |
| 120 | ~51% | ~62 | Transitioning to tiered |
| 200 | 3% | 6 | Normal tiered behavior |
| 1000 | 3% | 30 | Normal tiered behavior |

Constants:
```typescript
const TIER_FLOOR_THRESHOLD = 40;
const TIER_FULL_THRESHOLD = 200;
const TIER_COUNT = 6;
```

### Zoom → Visible Tier Mapping

The camera zoom ranges from 0.001 to 1000. The current three-level `ZoomLevel` stays for cluster-mode switching but the label layer uses the raw zoom value to determine which tiers are visible.

Thresholds use geometric scaling (~3x per step), echoing H3's ~7x area increase per resolution:

```typescript
const TIER_ZOOM_THRESHOLDS = [
  0.05,   // Tier 1 visible (very zoomed out)
  0.15,   // Tier 2 visible
  0.45,   // Tier 3 visible
  1.2,    // Tier 4 visible
  3.5,    // Tier 5 visible
  10.0,   // Tier 6 visible (close zoom)
];
```

At any zoom level, visible tiers are: all tiers whose threshold <= current zoom.

```typescript
function maxVisibleTier(zoom: number): number {
  for (let i = TIER_ZOOM_THRESHOLDS.length - 1; i >= 0; i--) {
    if (zoom >= TIER_ZOOM_THRESHOLDS[i]) return i + 1; // 1-indexed tier
  }
  return 0; // below tier 1 threshold: no labels
}
```

| Raw zoom | Visible tiers | Typical camera state |
|---|---|---|
| < 0.05 | None | Extreme zoom-out (cluster view) |
| 0.05 | 1 | Wide overview — only hubs |
| 0.15 | 1–2 | Overview — hubs + high connectors |
| 0.45 | 1–3 | Mid zoom — top quarter of nodes |
| 1.2 | 1–4 | Working zoom — top half |
| 3.5 | 1–5 | Close — most nodes labeled |
| 10.0 | 1–6 | Very close — all labels |

### Opacity Fade-In

Font size is uniform at 11px across all tiers (labels are a 2D Canvas overlay drawn with `ctx.fillText` at fixed screen-space size — varying size would look inconsistent, not hierarchical). The visual hierarchy comes entirely from **when** labels appear and the opacity transition.

When a tier first becomes visible (zoom crosses its threshold), labels fade from 0 → 1 over a zoom sub-range rather than popping in:

```typescript
function tierOpacity(tier: number, zoom: number): number {
  const threshold = TIER_ZOOM_THRESHOLDS[tier - 1];
  const nextThreshold = TIER_ZOOM_THRESHOLDS[tier] ?? threshold * 3;
  const fadeRange = (nextThreshold - threshold) * 0.3; // fade over 30% of the band
  if (zoom < threshold) return 0;
  if (zoom >= threshold + fadeRange) return 1;
  return (zoom - threshold) / fadeRange;
}
```

The label layer sets `ctx.globalAlpha` per tier before its `fillText` calls, resetting to 1.0 after.

### Max Labels Per Tier

Even with tiering, a close zoom on a 10,000-node graph with all 6 tiers visible could attempt thousands of labels. Each tier has a render cap, and the total stays bounded:

```typescript
const TIER_MAX_LABELS = [50, 60, 70, 80, 80, 80]; // per tier, indexed by tier-1
// Total max across all tiers: 420
// At typical working zoom (tiers 1-4): 260
```

These caps apply **after frustum culling** — only nodes within the camera viewport are counted. The caps are generous because Canvas2D `fillText` handles hundreds of calls easily, and the existing dirty-tracking avoids unnecessary redraws.

Within a tier, if the cap is reached, nodes closer to the camera center are preferred (already approximately true since frustum-culled nodes iterate in spatial proximity).

## Data Flow

### Tier Computation

```
Vault opens
  → SQL: SELECT node_id, COUNT(*) as degree
         FROM (SELECT source_id AS node_id FROM edges
               UNION ALL
               SELECT target_id AS node_id FROM edges)
         GROUP BY node_id
  → Sort by degree DESC
  → Apply adaptive percentile bucketing
  → Store as Map<nodeId, tier> in a TierIndex
  → Emit to renderer
```

The `TierIndex` is a plain object:

```typescript
interface TierIndex {
  tiers: Map<string, number>;  // nodeId → tier (1–6)
  totalNodes: number;
  maxDegree: number;
  recomputedAt: number;        // for staleness checks
}
```

### Integration with Existing Pipeline

```
                    ┌──────────────┐
                    │  Vault Open  │
                    └──────┬───────┘
                           │
                    ┌──────▼───────┐
                    │ computeTiers │  (new: SQL query + bucketing)
                    └──────┬───────┘
                           │
                    ┌──────▼───────┐
                    │  TierIndex   │  (new: stored in viewport store or separate)
                    └──────┬───────┘
                           │
    existing flow          │         new data injected
    ─────────────          │         ────────────────
                           │
    Camera zooms ──► useViewportSync ──► spatial.nodesInBounds()
                           │                    │
                           │              ┌─────▼──────┐
                           │              │ slimToRender│  tier field added from TierIndex
                           │              └─────┬──────┘
                           │                    │
                           │              ┌─────▼──────┐
                           │              │  renderer   │
                           │              │ .setGraphData│
                           │              └─────┬──────┘
                           │                    │
                    ┌──────▼───────┐      ┌─────▼──────┐
                    │  rawZoom     │ ───► │ LabelLayer  │  filters by tier + zoom
                    │  (already    │      │  .update()  │  scales font + opacity per tier
                    │   in store)  │      └─────────────┘
                    └──────────────┘
```

### Recomputation Triggers

Tier assignments change when edges are added or removed. The tier index must be recomputed on:

1. **Extraction merge** — new nodes and edges added to the graph
2. **Manual edge create/delete** — from the UI or MCP tools
3. **Node delete** — cascades edge deletion

All of these already emit events via BroadcastChannel / IPC. The tier computation subscribes to these events and recomputes asynchronously.

**Debouncing**: The SQL query + bucketing is fast (~10–50ms even at 50K nodes), but bulk operations like extraction merges can fire dozens of edge mutations in rapid succession. Debounce recomputation with a 200ms trailing delay so it runs once after the batch settles, not once per edge. The stale tier index stays in use during the debounce window — labels may briefly show with outdated tiers, which is imperceptible for a 200ms window.

## Files to Change

| File | Change |
|---|---|
| `src/graph/renderer/types.ts` | Add `tier?: number` to `RenderNode` |
| `src/graph/renderer/label-layer.ts` | Replace binary zoom gate with tier-based filtering, per-tier opacity fade-in |
| `src/graph/store/viewport-store.ts` | Store `TierIndex` (or a `tierMap: Map<string, number>`), expose `setTierIndex` action |
| `src/ui/hooks/useViewportSync.ts` | Pass `rawZoom` to renderer instead of discrete `ZoomLevel` for labels; attach tier to `RenderNode` in `slimToRenderNode` |
| `src/shared/constants.ts` | Add `TIER_ZOOM_THRESHOLDS`, `TIER_FLOOR_THRESHOLD`, `TIER_FULL_THRESHOLD` |
| `src/db/worker/queries/` (new query) | `SELECT node_id, COUNT(*) ... GROUP BY node_id` for degree computation |
| `src/graph/renderer/graph-renderer.ts` | Pass `rawZoom` to `labelLayer.update()` |

## Testing

- **Unit: tier bucketing** — verify percentile assignment for various graph sizes (5, 50, 200, 5000 nodes)
- **Unit: small graph bypass** — confirm all nodes get tier 1 when totalNodes <= 40
- **Unit: graduated ramp-up** — verify tier 1 percentage interpolation between 40–200 nodes
- **Unit: maxVisibleTier** — verify zoom→tier mapping at boundary values
- **Unit: tierOpacity** — verify fade-in ramp at threshold boundaries
- **Visual: small graph** — 20 nodes, zoom from far to close, all labels visible at moderate zoom
- **Visual: large graph** — 1000+ nodes, verify progressive disclosure feels natural, no pop-in
- **Visual: hub prominence** — a 5-edge hub is labeled before a 1-edge leaf when partially zoomed out

## Open Questions

1. **Tier count**: 6 is chosen by analogy to useful H3 resolution ranges (0–5 covers continent→neighborhood). Could be 4 or 8 — needs visual testing with real vaults.
2. **Zoom thresholds**: the geometric 3x scaling is a starting point. Real tuning requires testing with graphs of various sizes and densities. These should be easy to adjust (constants, not buried in logic).
3. **Interaction with cluster mode**: at `far` zoom (< 0.15), the viewport switches to cluster summaries with synthetic nodes. Tier 1 labels at zoom 0.05–0.15 means labels show on cluster nodes too. The tier map won't have entries for synthetic cluster node IDs — these should default to tier 1 (they represent major clusters).
4. **Edge labels**: currently edge labels don't render at all. This system could extend to edge labels in the future (tier by edge weight or connected node tiers) but is out of scope for this spec.
