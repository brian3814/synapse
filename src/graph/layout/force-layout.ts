import type { LayoutNodeInput, LayoutEdgeInput, LayoutOptions } from './layout-protocol';

const DEFAULTS: Required<LayoutOptions> = {
  iterations: 300,
  alphaDecay: 0.01,
  repulsionStrength: 100,
  attractionStrength: 0.01,
  centerStrength: 0.005,
};

// Barnes-Hut quadtree node
interface QTNode {
  x: number;
  y: number;
  mass: number;
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
  children: (QTNode | null)[];
  isLeaf: boolean;
  bodyIndex: number; // -1 if internal
}

const BH_THETA = 0.8;

export class ForceLayout {
  private positions: Float32Array; // [x0, y0, x1, y1, ...]
  private velocities: Float32Array;
  private nodeCount: number;
  private nodeIdToIndex: Map<string, number>;
  private nodeIds: string[];
  private edges: { srcIdx: number; tgtIdx: number }[];
  private pinnedNodes = new Set<number>();
  private alpha = 1.0;
  private opts: Required<LayoutOptions>;
  private stopped = false;

  constructor(
    nodes: LayoutNodeInput[],
    edges: LayoutEdgeInput[],
    options?: LayoutOptions
  ) {
    this.opts = { ...DEFAULTS, ...options };
    this.nodeCount = nodes.length;
    this.nodeIds = nodes.map((n) => n.id);
    this.nodeIdToIndex = new Map();
    this.positions = new Float32Array(nodes.length * 2);
    this.velocities = new Float32Array(nodes.length * 2);

    for (let i = 0; i < nodes.length; i++) {
      this.nodeIdToIndex.set(nodes[i].id, i);
      // Use provided positions or random layout
      const hasPos = nodes[i].x !== 0 || nodes[i].y !== 0;
      this.positions[i * 2] = hasPos ? nodes[i].x : (Math.random() - 0.5) * 100;
      this.positions[i * 2 + 1] = hasPos ? nodes[i].y : (Math.random() - 0.5) * 100;
    }

    this.edges = [];
    for (const e of edges) {
      const srcIdx = this.nodeIdToIndex.get(e.source);
      const tgtIdx = this.nodeIdToIndex.get(e.target);
      if (srcIdx !== undefined && tgtIdx !== undefined) {
        this.edges.push({ srcIdx, tgtIdx });
      }
    }
  }

  pin(nodeId: string, x: number, y: number) {
    const idx = this.nodeIdToIndex.get(nodeId);
    if (idx === undefined) return;
    this.pinnedNodes.add(idx);
    this.positions[idx * 2] = x;
    this.positions[idx * 2 + 1] = y;
    this.velocities[idx * 2] = 0;
    this.velocities[idx * 2 + 1] = 0;
    // Reheat slightly
    this.alpha = Math.max(this.alpha, 0.3);
  }

  unpin(nodeId: string) {
    const idx = this.nodeIdToIndex.get(nodeId);
    if (idx !== undefined) {
      this.pinnedNodes.delete(idx);
    }
  }

  stop() {
    this.stopped = true;
  }

  /** Run a batch of iterations. Returns positions + current alpha. */
  tick(batchSize = 10): { positions: Float32Array; alpha: number; done: boolean } {
    for (let iter = 0; iter < batchSize && !this.stopped; iter++) {
      if (this.alpha < 0.001) break;

      // Repulsion (Barnes-Hut)
      this.applyRepulsion();

      // Attraction (edges)
      this.applyAttraction();

      // Center force
      this.applyCenter();

      // Velocity Verlet integration
      const damping = 0.6;
      for (let i = 0; i < this.nodeCount; i++) {
        if (this.pinnedNodes.has(i)) continue;
        this.velocities[i * 2] *= damping;
        this.velocities[i * 2 + 1] *= damping;
        this.positions[i * 2] += this.velocities[i * 2] * this.alpha;
        this.positions[i * 2 + 1] += this.velocities[i * 2 + 1] * this.alpha;
      }

      this.alpha *= (1 - this.opts.alphaDecay);
    }

    const done = this.alpha < 0.001 || this.stopped;
    // Copy positions for transfer
    const copy = new Float32Array(this.positions);
    return { positions: copy, alpha: this.alpha, done };
  }

  private applyRepulsion() {
    if (this.nodeCount <= 1) return;

    // Build quadtree
    const root = this.buildQuadtree();
    if (!root) return;

    const strength = this.opts.repulsionStrength;

    for (let i = 0; i < this.nodeCount; i++) {
      if (this.pinnedNodes.has(i)) continue;
      const px = this.positions[i * 2];
      const py = this.positions[i * 2 + 1];

      this.applyRepulsionFromTree(root, i, px, py, strength);
    }
  }

  private applyRepulsionFromTree(
    node: QTNode,
    bodyIdx: number,
    px: number,
    py: number,
    strength: number
  ) {
    if (node.mass === 0) return;

    const dx = node.x - px;
    const dy = node.y - py;
    const distSq = dx * dx + dy * dy;

    if (node.isLeaf && node.bodyIndex === bodyIdx) return;

    const size = Math.max(node.maxX - node.minX, node.maxY - node.minY);

    if (node.isLeaf || (size * size / distSq) < (BH_THETA * BH_THETA)) {
      // Treat as single body
      if (distSq < 0.01) return; // avoid singularity
      const dist = Math.sqrt(distSq);
      const force = -strength * node.mass / distSq;
      this.velocities[bodyIdx * 2] += (dx / dist) * force;
      this.velocities[bodyIdx * 2 + 1] += (dy / dist) * force;
      return;
    }

    // Recurse into children
    for (const child of node.children) {
      if (child) this.applyRepulsionFromTree(child, bodyIdx, px, py, strength);
    }
  }

  private buildQuadtree(): QTNode | null {
    if (this.nodeCount === 0) return null;

    let minX = Infinity, maxX = -Infinity;
    let minY = Infinity, maxY = -Infinity;

    for (let i = 0; i < this.nodeCount; i++) {
      const x = this.positions[i * 2];
      const y = this.positions[i * 2 + 1];
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
    }

    // Make square
    const size = Math.max(maxX - minX, maxY - minY, 1);
    const cx = (minX + maxX) / 2;
    const cy = (minY + maxY) / 2;

    const root: QTNode = {
      x: 0, y: 0, mass: 0,
      minX: cx - size / 2, minY: cy - size / 2,
      maxX: cx + size / 2, maxY: cy + size / 2,
      children: [null, null, null, null],
      isLeaf: true,
      bodyIndex: -1,
    };

    for (let i = 0; i < this.nodeCount; i++) {
      this.insertIntoTree(root, i, this.positions[i * 2], this.positions[i * 2 + 1]);
    }

    return root;
  }

  private insertIntoTree(node: QTNode, bodyIdx: number, bx: number, by: number) {
    if (node.isLeaf && node.bodyIndex === -1) {
      // Empty leaf: place body here
      node.bodyIndex = bodyIdx;
      node.x = bx;
      node.y = by;
      node.mass = 1;
      return;
    }

    if (node.isLeaf) {
      // Split: create children and re-insert existing body
      node.isLeaf = false;
      const existing = node.bodyIndex;
      node.bodyIndex = -1;
      this.insertIntoQuadrant(node, existing,
        this.positions[existing * 2], this.positions[existing * 2 + 1]);
    }

    // Update center of mass
    const totalMass = node.mass + 1;
    node.x = (node.x * node.mass + bx) / totalMass;
    node.y = (node.y * node.mass + by) / totalMass;
    node.mass = totalMass;

    this.insertIntoQuadrant(node, bodyIdx, bx, by);
  }

  private insertIntoQuadrant(parent: QTNode, bodyIdx: number, bx: number, by: number) {
    const midX = (parent.minX + parent.maxX) / 2;
    const midY = (parent.minY + parent.maxY) / 2;

    let quadrant: number;
    let childMinX: number, childMaxX: number, childMinY: number, childMaxY: number;

    if (bx <= midX) {
      if (by <= midY) {
        quadrant = 0; // bottom-left
        childMinX = parent.minX; childMaxX = midX;
        childMinY = parent.minY; childMaxY = midY;
      } else {
        quadrant = 2; // top-left
        childMinX = parent.minX; childMaxX = midX;
        childMinY = midY; childMaxY = parent.maxY;
      }
    } else {
      if (by <= midY) {
        quadrant = 1; // bottom-right
        childMinX = midX; childMaxX = parent.maxX;
        childMinY = parent.minY; childMaxY = midY;
      } else {
        quadrant = 3; // top-right
        childMinX = midX; childMaxX = parent.maxX;
        childMinY = midY; childMaxY = parent.maxY;
      }
    }

    if (!parent.children[quadrant]) {
      parent.children[quadrant] = {
        x: 0, y: 0, mass: 0,
        minX: childMinX, minY: childMinY,
        maxX: childMaxX, maxY: childMaxY,
        children: [null, null, null, null],
        isLeaf: true,
        bodyIndex: -1,
      };
    }

    this.insertIntoTree(parent.children[quadrant]!, bodyIdx, bx, by);
  }

  private applyAttraction() {
    const strength = this.opts.attractionStrength;

    for (const { srcIdx, tgtIdx } of this.edges) {
      const sx = this.positions[srcIdx * 2];
      const sy = this.positions[srcIdx * 2 + 1];
      const tx = this.positions[tgtIdx * 2];
      const ty = this.positions[tgtIdx * 2 + 1];

      const dx = tx - sx;
      const dy = ty - sy;
      const dist = Math.sqrt(dx * dx + dy * dy);
      if (dist < 0.01) continue;

      const force = strength * dist;
      const fx = (dx / dist) * force;
      const fy = (dy / dist) * force;

      if (!this.pinnedNodes.has(srcIdx)) {
        this.velocities[srcIdx * 2] += fx;
        this.velocities[srcIdx * 2 + 1] += fy;
      }
      if (!this.pinnedNodes.has(tgtIdx)) {
        this.velocities[tgtIdx * 2] -= fx;
        this.velocities[tgtIdx * 2 + 1] -= fy;
      }
    }
  }

  private applyCenter() {
    const strength = this.opts.centerStrength;

    for (let i = 0; i < this.nodeCount; i++) {
      if (this.pinnedNodes.has(i)) continue;
      this.velocities[i * 2] -= this.positions[i * 2] * strength;
      this.velocities[i * 2 + 1] -= this.positions[i * 2 + 1] * strength;
    }
  }
}
