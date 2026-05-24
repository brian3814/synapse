import * as THREE from 'three';
import type { RenderNode, RenderEdge } from './types';
import type { SpatialHash } from './spatial-hash';

export interface HitResult {
  type: 'node' | 'edge' | 'none';
  id?: string;
}

const EDGE_HIT_THRESHOLD = 5; // pixels

export function hitTest(
  screenX: number,
  screenY: number,
  nodes: RenderNode[],
  edges: RenderEdge[],
  nodeMap: Map<string, RenderNode>,
  camera: THREE.OrthographicCamera,
  canvas: HTMLCanvasElement,
  spatialHash?: SpatialHash
): HitResult {
  // Convert screen coords to world coords
  const rect = canvas.getBoundingClientRect();
  const ndcX = ((screenX - rect.left) / rect.width) * 2 - 1;
  const ndcY = -((screenY - rect.top) / rect.height) * 2 + 1;

  const worldPos = new THREE.Vector3(ndcX, ndcY, 0);
  worldPos.unproject(camera);

  const wx = worldPos.x;
  const wy = worldPos.y;

  // Node hit (priority): find nearest node within its radius
  let closestNode: string | undefined;
  let closestNodeDist = Infinity;

  // Use spatial hash for fast candidate lookup if available
  const maxNodeSize = 5; // conservative upper bound for query radius
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
  // Convert pixel threshold to world units
  const pixelToWorld = (camera.right - camera.left) / rect.width;
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
