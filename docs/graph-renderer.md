# Graph Renderer (Three.js)

Custom renderer in `src/graph/renderer/` — zero React dependency. Uses InstancedMesh (1-2 draw calls) for nodes/edges instead of Reagraph's per-element meshes.

## Core Files

- **`graph-renderer.ts`** — Core class: Scene, Camera, WebGLRenderer, animation loop, event emitter
- **`node-mesh.ts`** — InstancedMesh with CircleGeometry for nodes, RingGeometry for selection ring
- **`edge-mesh.ts`** — LineSegments for edges + InstancedMesh ConeGeometry for directed arrows
- **`label-layer.ts`** — Canvas2D texture atlas + InstancedMesh quads with frustum culling
- **`camera-controller.ts`** — OrthographicCamera pan/zoom/fit with mouse/wheel handlers
- **`hit-test.ts`** — CPU distance-based node/edge picking (linear scan, sufficient for 10k+)
- **`types.ts`** — RenderNode, RenderEdge, RenderTheme, GraphCanvasHandle

## Layout Worker

Layout runs in a Web Worker (`src/graph/layout/`):
- **`force-layout.ts`** — Velocity Verlet + Barnes-Hut quadtree O(n log n) repulsion
- **`layout-worker.ts`** — Worker entry; sends Float32Array positions via Transferable
- **`layout-runner.ts`** — Main-thread API; creates worker and handles tick/done messages
- Pin/unpin support for node dragging during live simulation

## React Integration

`GraphCanvas.tsx` is a thin `forwardRef` wrapper. Zustand `.subscribe()` pushes data imperatively — no React re-renders during interactions. Graph container must use `absolute inset-0` positioning with `min-h-0` on flex parents.

## Graph Canvas Toolbar

`src/ui/components/graph/GraphControls.tsx` — toolbar overlay on the graph canvas:
- Layer toggles (entities/notes/resources)
- Node/edge count stats
- Zoom in/out (magnifier SVG icons), fit-to-view, refresh (reloads graph from DB), screenshot
- Create node button, delete selected button

**Refresh button** calls `useGraphStore.getState().loadAll()` which reloads all nodes/edges from the DB. Useful after chat agent mutations.

## Pitfalls

**Pitfall #14: InstancedMesh custom attributes require `onBeforeCompile`.** Three.js `MeshBasicMaterial` silently ignores custom geometry attributes (like `instanceOpacity`). Setting an attribute via `geometry.setAttribute()` does nothing unless you inject it into the shader via `material.onBeforeCompile`. The `node-mesh.ts` uses this to make per-instance opacity work. If you add new per-instance attributes, you must also patch the shader.

**Pitfall #15: InstancedMesh frustum culling uses geometry bounds, not instance bounds.** Three.js culls the entire InstancedMesh based on the geometry's bounding sphere (e.g., `CircleGeometry(1)` → radius 1 at origin). When the camera pans away, ALL instances vanish. Always set `frustumCulled = false` on InstancedMesh objects, and propagate this in `grow()` / capacity-rebuild methods.

**Pitfall #16: Spatial hash must be rebuilt after node position changes outside `updatePositions()`.** The `SpatialHash` is only rebuilt in `GraphRenderer.updatePositions()` (the public method). Direct position updates like `handleDragMove` bypass this, leaving the hash stale. Hit-testing then fails at the new position. Always call `spatialHash.rebuild()` after any position mutation.

**Pitfall #17: Selection color restoration.** `NodeMesh.setSelection()` dims inactive nodes via opacity but `applySelection()` also changes selected node colors to `nodeActiveColor` via `setHover()`. When selection is cleared, `setSelection()` must restore original colors from the node data — resetting opacity alone leaves nodes stuck at the active color.

**Pitfall #18: Drag vs click disambiguation.** Pointer-down on a node must NOT immediately start dragging — this swallows the click event. Use a `pendingDragNodeId` pattern: record the node on pointer-down, promote to active drag only after a movement threshold (3px) in pointer-move. If pointer-up fires without threshold crossing, treat as a click.

**Pitfall #19: Ring mesh position sync.** The selection ring (`ringMesh`) copies the node's matrix at selection time but doesn't auto-update. If node positions change (drag, force layout ticks), the ring stays at the old position. `updatePositions()` must also update ring matrices via a `ringNodeIds` mapping.

**Pitfall #20: Sequential DB round-trips in loops.** The DB client uses MessageChannel round-trips (UI → SharedWorker → DedicatedWorker → SQLite → back). Calling `await db.someQuery()` in a `for` loop serializes these, causing multi-second latency with 20+ items. Use `Promise.all()` to parallelize independent DB calls (e.g., `entityResolution.findMatches` in `buildDiffItems` and `proceedToReview`).

**Pitfall #21: Tailwind utility classes may not apply in extension contexts.** Some Tailwind classes (especially spacing like `py-3`, `pt-3`) were observed not applying in the Chrome extension side panel, with computed styles showing `0px` despite correct class names and the classes existing in the CSS bundle. Use inline `style={{}}` props as a reliable fallback for critical spacing.

**Pitfall #22: sqlite-vec requires `k=?` in WHERE clause, not `LIMIT ?`.** The `vec0` virtual table planner doesn't reliably receive `LIMIT` constraints passed through SQLite's query optimizer. Always use `WHERE embedding MATCH ? AND k = ?` syntax for KNN queries. When excluding a node from results, request `k+1` and filter in JS rather than adding `AND node_id != ?` to the query.

**Pitfall #23: Barnes-Hut quadtree stack overflow from null positions.** Nodes from the DB may have `x = null, y = null`. The check `nodes[i].x !== 0` evaluates to `true` for `null` (since `null !== 0` is `true` in JS), treating them as having valid positions. `Float32Array` then coerces `null` to `0`, placing all null-positioned nodes at exactly (0,0). The quadtree subdivides infinitely trying to separate coincident nodes. Fix: check `!= null` explicitly before using positions. Safety net: depth limit of 50 on `insertIntoTree` recursion.
