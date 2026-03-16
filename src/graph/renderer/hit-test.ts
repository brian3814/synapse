import * as THREE from 'three';
import type { RenderNode, RenderEdge } from './types';
import type { SpatialHash } from './spatial-hash';

export interface HitResult {
  type: 'node' | 'edge' | 'none';
  id?: string;
}

const EDGE_HIT_THRESHOLD = 5; // pixels
const NODE_HIT_THRESHOLD_3D = 15; // pixels for 3D screen-space picking

const _v3 = new THREE.Vector3();

export function hitTest(
  screenX: number,
  screenY: number,
  nodes: RenderNode[],
  edges: RenderEdge[],
  nodeMap: Map<string, RenderNode>,
  camera: THREE.Camera,
  canvas: HTMLCanvasElement,
  spatialHash?: SpatialHash
): HitResult {
  const rect = canvas.getBoundingClientRect();
  const is3D = camera instanceof THREE.PerspectiveCamera;

  if (is3D) {
    return hitTest3D(screenX, screenY, nodes, edges, nodeMap, camera, rect);
  }

  // 2D mode: world-space hit testing
  const ndcX = ((screenX - rect.left) / rect.width) * 2 - 1;
  const ndcY = -((screenY - rect.top) / rect.height) * 2 + 1;

  const worldPos = new THREE.Vector3(ndcX, ndcY, 0);
  worldPos.unproject(camera);

  const wx = worldPos.x;
  const wy = worldPos.y;

  // Node hit (priority): find nearest node within its radius
  let closestNode: string | undefined;
  let closestNodeDist = Infinity;

  const maxNodeSize = 5;
  const candidates = spatialHash ? spatialHash.query(wx, wy, maxNodeSize) : nodes;

  for (const node of candidates) {
    const dx = wx - node.x;
    const dy = wy - node.y;
    const dist = Math.sqrt(dx * dx + dy * dy);
    if (dist <= node.size && dist < closestNodeDist) {
      closestNodeDist = dist;
      closestNode = node.id;
    }
  }

  if (closestNode) {
    return { type: 'node', id: closestNode };
  }

  // Edge hit: point-to-segment distance
  const ortho = camera as THREE.OrthographicCamera;
  const pixelToWorld = (ortho.right - ortho.left) / rect.width;
  const threshold = EDGE_HIT_THRESHOLD * pixelToWorld;

  let closestEdge: string | undefined;
  let closestEdgeDist = Infinity;

  for (const edge of edges) {
    const src = nodeMap.get(edge.sourceId);
    const tgt = nodeMap.get(edge.targetId);
    if (!src || !tgt) continue;

    const dist = pointToSegmentDist(wx, wy, src.x, src.y, tgt.x, tgt.y);
    if (dist <= threshold && dist < closestEdgeDist) {
      closestEdgeDist = dist;
      closestEdge = edge.id;
    }
  }

  if (closestEdge) {
    return { type: 'edge', id: closestEdge };
  }

  return { type: 'none' };
}

function hitTest3D(
  screenX: number,
  screenY: number,
  nodes: RenderNode[],
  edges: RenderEdge[],
  nodeMap: Map<string, RenderNode>,
  camera: THREE.PerspectiveCamera,
  rect: DOMRect
): HitResult {
  const cx = screenX - rect.left;
  const cy = screenY - rect.top;
  const w = rect.width;
  const h = rect.height;

  // Project all nodes to screen and find closest
  let closestNode: string | undefined;
  let closestDist = Infinity;

  for (const node of nodes) {
    _v3.set(node.x, node.y, node.z ?? 0);
    _v3.project(camera);
    if (_v3.z > 1) continue; // behind camera

    const sx = (_v3.x * 0.5 + 0.5) * w;
    const sy = (-_v3.y * 0.5 + 0.5) * h;
    const dx = cx - sx;
    const dy = cy - sy;
    const dist = Math.sqrt(dx * dx + dy * dy);

    // Scale hit radius by node size projected to screen
    const hitRadius = Math.max(NODE_HIT_THRESHOLD_3D, node.size * 10 / (1 + _v3.z));
    if (dist <= hitRadius && dist < closestDist) {
      closestDist = dist;
      closestNode = node.id;
    }
  }

  if (closestNode) {
    return { type: 'node', id: closestNode };
  }

  // Edge hit in screen space
  let closestEdge: string | undefined;
  let closestEdgeDist = Infinity;

  for (const edge of edges) {
    const src = nodeMap.get(edge.sourceId);
    const tgt = nodeMap.get(edge.targetId);
    if (!src || !tgt) continue;

    _v3.set(src.x, src.y, src.z ?? 0);
    _v3.project(camera);
    if (_v3.z > 1) continue;
    const sx1 = (_v3.x * 0.5 + 0.5) * w;
    const sy1 = (-_v3.y * 0.5 + 0.5) * h;

    _v3.set(tgt.x, tgt.y, tgt.z ?? 0);
    _v3.project(camera);
    if (_v3.z > 1) continue;
    const sx2 = (_v3.x * 0.5 + 0.5) * w;
    const sy2 = (-_v3.y * 0.5 + 0.5) * h;

    const dist = pointToSegmentDist(cx, cy, sx1, sy1, sx2, sy2);
    if (dist <= EDGE_HIT_THRESHOLD && dist < closestEdgeDist) {
      closestEdgeDist = dist;
      closestEdge = edge.id;
    }
  }

  if (closestEdge) {
    return { type: 'edge', id: closestEdge };
  }

  return { type: 'none' };
}

function pointToSegmentDist(
  px: number, py: number,
  ax: number, ay: number,
  bx: number, by: number
): number {
  const abx = bx - ax;
  const aby = by - ay;
  const apx = px - ax;
  const apy = py - ay;

  const ab2 = abx * abx + aby * aby;
  if (ab2 < 1e-10) return Math.sqrt(apx * apx + apy * apy);

  let t = (apx * abx + apy * aby) / ab2;
  t = Math.max(0, Math.min(1, t));

  const cx = ax + t * abx - px;
  const cy = ay + t * aby - py;
  return Math.sqrt(cx * cx + cy * cy);
}
