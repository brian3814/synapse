# Replace Reagraph with Custom Three.js Graph Renderer

## Context

At 5k nodes / 20k edges the graph canvas is unusable. Reagraph creates 1 mesh per node/edge (25k draw calls), reconciles 25k React components, runs O(n²) force layout on the main thread, and has Troika text rendering shimmed to run synchronously due to Chrome MV3 CSP blob: URL restrictions. Replacing with a custom Three.js renderer using InstancedMesh (1-2 draw calls total), off-main-thread layout, and viewport culling gives full control and extensibility. Some breaking changes are acceptable (dropping 3D mode, tree/radial/hierarchical layouts initially; can re-add later).

## Scope

**Keep:** Node/edge rendering, single-node/edge selection, hover highlight, node dragging, zoom/pan/fit, force-directed 2D layout, edge arrows, node labels, per-node color/size, extraction review overlay

**Drop (re-add later):** forceDirected3d, treeTd2d, treeLr2d, radialOut2d, hierarchicalTd, clustering convex hulls, lasso selection

**Untouched:** Zustand stores (`graph-store`, `ui-store`, `extraction-review-store`, `node-type-store`, `llm-store`), DB layer, service worker, offscreen, content script

## Files to Create

```
src/graph/renderer/
  types.ts                 — RenderNode, RenderEdge, RenderTheme, GraphRendererOptions
  graph-renderer.ts        — Core class: Scene, Camera, WebGLRenderer, animation loop, event emitter
  node-mesh.ts             — InstancedMesh for circle nodes with per-instance color/size
  edge-mesh.ts             — LineSegments for edges + InstancedMesh for arrow cones
  label-layer.ts           — Canvas2D texture atlas + InstancedMesh label quads with frustum culling
  hit-test.ts              — CPU distance-based node/edge hit testing
  camera-controller.ts     — OrthographicCamera pan/zoom/fit with mouse/wheel handlers

src/graph/layout/
  layout-protocol.ts       — Shared message types (main ↔ worker)
  layout-worker.ts         — Web Worker entry point (built by Vite plugin)
  force-layout.ts          — Force-directed 2D: velocity Verlet + Barnes-Hut quadtree
  layout-runner.ts         — Main-thread API to create worker and handle messages

src/graph/transforms/
  db-to-render.ts          — GraphNode/GraphEdge → RenderNode/RenderEdge (replaces db-to-reagraph.ts)
  review-to-render.ts      — ReviewNode/ReviewEdge → RenderNode/RenderEdge (replaces review-to-reagraph.ts)

src/ui/components/graph/
  GraphCanvas.tsx           — Thin React wrapper (replaces KnowledgeGraph.tsx Reagraph usage)
  ReviewGraphCanvas.tsx     — Small preview renderer for extraction review
```

## Files to Modify

- `src/ui/components/graph/KnowledgeGraph.tsx` — Use new `GraphCanvas` instead of Reagraph's `GraphCanvas`
- `src/ui/components/graph/GraphControls.tsx` — Use new `GraphCanvasHandle` type instead of Reagraph's `GraphCanvasRef`
- `src/ui/components/llm/ReviewGraph.tsx` — Use `ReviewGraphCanvas`
- `src/ui/hooks/useGraphData.ts` — Import from `db-to-render.ts` / `review-to-render.ts`
- `src/graph/store/ui-store.ts` — Simplify layout options to `forceDirected2d` initially
- `src/shared/constants.ts` — Update `LAYOUT_OPTIONS`
- `vite.config.ts` — Add `layoutWorkerPlugin()`, remove `troika-worker-utils` alias
- `package.json` — Add `three` + `@types/three`, remove `reagraph`

## Files to Delete

- `src/graph/transforms/db-to-reagraph.ts`
- `src/graph/transforms/review-to-reagraph.ts`
- `src/lib/troika-worker-utils-shim.ts`

---

## Architecture

### A. Renderer Core (`graph-renderer.ts`)

Vanilla TypeScript class — zero React dependency. React owns a thin wrapper that creates/destroys it.

```
GraphRenderer
  ├─ THREE.WebGLRenderer (canvas)
  ├─ THREE.OrthographicCamera
  ├─ THREE.Scene
  ├─ NodeMesh (InstancedMesh — 1 draw call for all nodes)
  ├─ EdgeMesh (LineSegments — 1 draw call) + ArrowMesh (InstancedMesh — 1 draw call)
  ├─ LabelLayer (Canvas2D atlas → InstancedMesh quads, frustum-culled)
  ├─ HitTest (CPU distance-based node/edge picking)
  ├─ CameraController (pan/zoom/fit via mouse/wheel)
  └─ LayoutRunner (Web Worker communication)
```

**Event emitter:** `renderer.on('nodeClick' | 'edgeClick' | 'canvasClick' | 'nodeHover', callback)`. React wrapper subscribes and routes to Zustand store actions.

**Lifecycle:** `constructor(container, options)` → `setGraphData(data)` → animation loop → `dispose()`.

### B. Node Rendering (`node-mesh.ts`)

- `InstancedMesh` with `CircleGeometry(1, 32)` + `MeshBasicMaterial`
- Per-instance transform matrix: position (x, y, 0) + uniform scale (node.size)
- Per-instance color via `InstancedBufferAttribute` (Float32Array, 3 floats/instance)
- Selection ring: second `InstancedMesh` (RingGeometry) rendered only for selected node (count = 0 or 1)
- Hover: swap color in buffer for hovered instance, mark `needsUpdate`
- Inactive dimming: reduce alpha for non-selected nodes when a selection is active (via per-instance opacity attribute or shader uniform)

### C. Edge Rendering (`edge-mesh.ts`)

- `LineSegments` with `BufferGeometry`: 2 vertices per edge, `Float32Array` position attribute
- Per-edge color via `Float32BufferAttribute` (2 colors per edge, both same)
- Arrows: `InstancedMesh` with `ConeGeometry(0.03, 0.06, 4)`, positioned at target end of directed edges, rotated along edge direction
- Start with 1px lines (WebGL limitation); can upgrade to instanced quads later for thickness

### D. Labels (`label-layer.ts`)

CSP-safe approach — no blob: workers needed:

1. Offscreen `<canvas>` (2048×2048) as texture atlas
2. Render each label with `ctx.fillText()`, track UV rectangles per label
3. `InstancedMesh` with `PlaneGeometry` for label quads, textured from atlas
4. Each instance positioned below its node, UV attributes from atlas
5. **Viewport culling:** only show label instances for nodes within camera frustum (set scale=0 for culled). Critical for 10k+ nodes
6. Dirty tracking: only re-render atlas when labels change

### E. CPU Hit Testing (`hit-test.ts`)

- Convert mouse screen coords → world coords via `camera.unproject()`
- **Node hit:** Linear scan of node positions, find nearest within `node.size` radius. Nodes checked first (priority over edges)
- **Edge hit:** Point-to-line-segment distance test for visible edges, threshold ~3px in world units
- On mousemove: throttle to ~30fps, run hit test → update hover state
- On click: run hit test → emit `nodeClick` / `edgeClick` / `canvasClick`
- Sufficient for 10k nodes (linear scan of flat array is fast); can upgrade to spatial index or GPU picking later if needed

### F. Camera (`camera-controller.ts`)

- `OrthographicCamera` — left/right/top/bottom calculated from bounding box + padding
- Mouse wheel: zoom around cursor (adjust frustum bounds)
- Mouse drag (not on node): pan camera (translate position)
- `fitToView(nodeIds?)`: compute bounding box of target nodes, set camera frustum
- `zoomIn()`/`zoomOut()`: scale frustum by fixed factor
- Smooth transitions via lerp in animation loop (optional, can add later)

### G. Layout Worker

**Worker builds via Vite plugin** following existing `dbWorkerPlugin` pattern — pre-built `.js` file loaded via `new URL('/layout-worker.js', location.origin)`.

**Protocol (`layout-protocol.ts`):**
```typescript
// Main → Worker
type LayoutRequest =
  | { type: 'start'; nodes: { id: string; x: number; y: number }[];
      edges: { source: string; target: string }[]; options?: LayoutOptions }
  | { type: 'pin'; nodeId: string; x: number; y: number }
  | { type: 'unpin'; nodeId: string }
  | { type: 'stop' };

// Worker → Main
type LayoutResponse =
  | { type: 'tick'; positions: Float32Array; alpha: number }
  | { type: 'done'; positions: Float32Array };
```

**Force layout (`force-layout.ts`):**
- Velocity Verlet integration
- Repulsion: Barnes-Hut quadtree approximation → O(n log n)
- Attraction: Hooke's law along edges
- Center force: weak pull toward origin
- Alpha cooling: starts 1.0, decays × 0.99/tick, stops at < 0.001
- Sends `tick` with `Float32Array` (Transferable) every 10 iterations

**Pin/unpin for dragging:** Main thread sends `pin` with position during drag, `unpin` on drag end. Worker fixes that node during simulation.

### H. React Integration (`GraphCanvas.tsx`)

```
forwardRef<GraphCanvasHandle, { compact?: boolean }>
  ├─ useRef<HTMLDivElement> (container)
  ├─ useRef<GraphRenderer> (renderer instance)
  ├─ useEffect → new GraphRenderer(container, { theme })
  ├─ useEffect → useGraphStore.subscribe() → renderer.setGraphData()
  ├─ useEffect → subscribe selectedNodeId → renderer.setSelection()
  ├─ useEffect → renderer.on('nodeClick') → selectNode() + setActivePanel()
  ├─ useImperativeHandle → { zoomIn, zoomOut, fitToView }
  └─ <div ref={containerRef} className="absolute inset-0" />
```

Key: Zustand `.subscribe()` with selectors pushes data imperatively — **no React re-renders during interactions**. The renderer owns the animation loop.

---

## Implementation Phases

### Phase 1: Foundation — Nodes + Edges Rendering
**Create:** `types.ts`, `graph-renderer.ts`, `node-mesh.ts`, `edge-mesh.ts`, `db-to-render.ts`
**Install:** `three`, `@types/three`
**Test:** Build succeeds. New renderer shows colored circles + lines. Not yet wired into app.

### Phase 2: Camera + Interactions
**Create:** `camera-controller.ts`, `hit-test.ts`
**Add to renderer:** Pan/zoom, CPU hit testing, node click/hover events, selection ring, node dragging
**Test:** Pan, zoom, click to select, hover highlights, drag nodes.

### Phase 3: Layout Worker
**Create:** `layout-protocol.ts`, `force-layout.ts`, `layout-worker.ts`, `layout-runner.ts`
**Modify:** `vite.config.ts` (add `layoutWorkerPlugin`)
**Test:** Nodes auto-arrange. Drag pins nodes. Layout completes <2s for 10k nodes.

### Phase 4: Labels + Arrows
**Create:** `label-layer.ts`
**Add to `edge-mesh.ts`:** Arrow InstancedMesh
**Test:** Labels visible (frustum-culled at zoom-out), arrows on directed edges.

### Phase 5: Full Swap
**Create:** `GraphCanvas.tsx`, `ReviewGraphCanvas.tsx`, `review-to-render.ts`
**Modify:** `KnowledgeGraph.tsx`, `GraphControls.tsx`, `ReviewGraph.tsx`, `useGraphData.ts`, `ui-store.ts`, `constants.ts`
**Test:** Full feature parity. Extension works end-to-end.

### Phase 6: Cleanup
**Remove:** `reagraph` from package.json, delete `db-to-reagraph.ts`, `review-to-reagraph.ts`, `troika-worker-utils-shim.ts`
**Modify:** `vite.config.ts` (remove troika alias), update `CLAUDE.md` and `ARCHITECTURE.md`
**Test:** Clean build, no reagraph references. `npm run build` passes.

## Verification

- `npm run build` — no TypeScript errors at each phase
- Load `dist/` as unpacked extension at each phase
- Phase 3: Generate 5k stress test nodes → layout completes, 60fps pan/zoom
- Phase 5: Click node → detail panel opens. Click edge → edge panel. Hover → highlight. Drag → repositions. Extraction review overlay renders correctly.
- Phase 6: `grep -r "reagraph" src/` returns nothing
