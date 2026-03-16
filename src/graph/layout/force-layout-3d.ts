import type { LayoutNodeInput, LayoutEdgeInput, LayoutOptions } from './layout-protocol';

const DEFAULTS: Required<Omit<LayoutOptions, 'dimensions'>> = {
  iterations: 300,
  alphaDecay: 0.01,
  repulsionStrength: 100,
  attractionStrength: 0.01,
  centerStrength: 0.005,
};

interface OctreeNode {
  cx: number;
  cy: number;
  cz: number;
  mass: number;
  minX: number; maxX: number;
  minY: number; maxY: number;
  minZ: number; maxZ: number;
  children: (OctreeNode | null)[];
  isLeaf: boolean;
  bodyIndex: number;
}

const BH_THETA = 0.8;

export class ForceLayout3D {
  private positions: Float32Array; // [x0, y0, z0, x1, y1, z1, ...]
  private velocities: Float32Array;
  private nodeCount: number;
  private nodeIdToIndex: Map<string, number>;
  private nodeIds: string[];
  private edges: { srcIdx: number; tgtIdx: number }[];
  private pinnedNodes = new Set<number>();
  private alpha = 1.0;
  private opts: Required<Omit<LayoutOptions, 'dimensions'>>;
  private stopped = false;

  constructor(
    nodes: LayoutNodeInput[],
    edges: LayoutEdgeInput[],
    options?: LayoutOptions
  ) {
    const { dimensions: _, ...rest } = options ?? {};
    this.opts = { ...DEFAULTS, ...rest };
    this.nodeCount = nodes.length;
    this.nodeIds = nodes.map((n) => n.id);
    this.nodeIdToIndex = new Map();
    this.positions = new Float32Array(nodes.length * 3);
    this.velocities = new Float32Array(nodes.length * 3);

    for (let i = 0; i < nodes.length; i++) {
      this.nodeIdToIndex.set(nodes[i].id, i);
      const hasPos = nodes[i].x !== 0 || nodes[i].y !== 0;
      this.positions[i * 3] = hasPos ? nodes[i].x : (Math.random() - 0.5) * 100;
      this.positions[i * 3 + 1] = hasPos ? nodes[i].y : (Math.random() - 0.5) * 100;
      this.positions[i * 3 + 2] = (nodes[i].z ?? 0) || (Math.random() - 0.5) * 100;
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

  pin(nodeId: string, x: number, y: number, z?: number) {
    const idx = this.nodeIdToIndex.get(nodeId);
    if (idx === undefined) return;
    this.pinnedNodes.add(idx);
    this.positions[idx * 3] = x;
    this.positions[idx * 3 + 1] = y;
    if (z !== undefined) this.positions[idx * 3 + 2] = z;
    this.velocities[idx * 3] = 0;
    this.velocities[idx * 3 + 1] = 0;
    this.velocities[idx * 3 + 2] = 0;
    this.alpha = Math.max(this.alpha, 0.3);
  }

  unpin(nodeId: string) {
    const idx = this.nodeIdToIndex.get(nodeId);
    if (idx !== undefined) this.pinnedNodes.delete(idx);
  }

  stop() {
    this.stopped = true;
  }

  tick(batchSize = 10): { positions: Float32Array; alpha: number; done: boolean } {
    for (let iter = 0; iter < batchSize && !this.stopped; iter++) {
      if (this.alpha < 0.001) break;

      this.applyRepulsion();
      this.applyAttraction();
      this.applyCenter();

      const damping = 0.6;
      for (let i = 0; i < this.nodeCount; i++) {
        if (this.pinnedNodes.has(i)) continue;
        const i3 = i * 3;
        this.velocities[i3] *= damping;
        this.velocities[i3 + 1] *= damping;
        this.velocities[i3 + 2] *= damping;
        this.positions[i3] += this.velocities[i3] * this.alpha;
        this.positions[i3 + 1] += this.velocities[i3 + 1] * this.alpha;
        this.positions[i3 + 2] += this.velocities[i3 + 2] * this.alpha;
      }

      this.alpha *= (1 - this.opts.alphaDecay);
    }

    const done = this.alpha < 0.001 || this.stopped;
    return { positions: new Float32Array(this.positions), alpha: this.alpha, done };
  }

  private applyRepulsion() {
    if (this.nodeCount <= 1) return;
    const root = this.buildOctree();
    if (!root) return;
    const strength = this.opts.repulsionStrength;
    for (let i = 0; i < this.nodeCount; i++) {
      if (this.pinnedNodes.has(i)) continue;
      const i3 = i * 3;
      this.repulsionFromTree(root, i, this.positions[i3], this.positions[i3 + 1], this.positions[i3 + 2], strength);
    }
  }

  private repulsionFromTree(
    node: OctreeNode, bodyIdx: number,
    px: number, py: number, pz: number,
    strength: number
  ) {
    if (node.mass === 0) return;
    const dx = node.cx - px;
    const dy = node.cy - py;
    const dz = node.cz - pz;
    const distSq = dx * dx + dy * dy + dz * dz;

    if (node.isLeaf && node.bodyIndex === bodyIdx) return;

    const size = Math.max(node.maxX - node.minX, node.maxY - node.minY, node.maxZ - node.minZ);

    if (node.isLeaf || (size * size / distSq) < (BH_THETA * BH_THETA)) {
      if (distSq < 0.01) return;
      const dist = Math.sqrt(distSq);
      const force = -strength * node.mass / distSq;
      const i3 = bodyIdx * 3;
      this.velocities[i3] += (dx / dist) * force;
      this.velocities[i3 + 1] += (dy / dist) * force;
      this.velocities[i3 + 2] += (dz / dist) * force;
      return;
    }

    for (const child of node.children) {
      if (child) this.repulsionFromTree(child, bodyIdx, px, py, pz, strength);
    }
  }

  private buildOctree(): OctreeNode | null {
    if (this.nodeCount === 0) return null;

    let minX = Infinity, maxX = -Infinity;
    let minY = Infinity, maxY = -Infinity;
    let minZ = Infinity, maxZ = -Infinity;

    for (let i = 0; i < this.nodeCount; i++) {
      const i3 = i * 3;
      const x = this.positions[i3], y = this.positions[i3 + 1], z = this.positions[i3 + 2];
      if (x < minX) minX = x; if (x > maxX) maxX = x;
      if (y < minY) minY = y; if (y > maxY) maxY = y;
      if (z < minZ) minZ = z; if (z > maxZ) maxZ = z;
    }

    const size = Math.max(maxX - minX, maxY - minY, maxZ - minZ, 1);
    const cx = (minX + maxX) / 2, cy = (minY + maxY) / 2, cz = (minZ + maxZ) / 2;

    const root: OctreeNode = {
      cx: 0, cy: 0, cz: 0, mass: 0,
      minX: cx - size / 2, maxX: cx + size / 2,
      minY: cy - size / 2, maxY: cy + size / 2,
      minZ: cz - size / 2, maxZ: cz + size / 2,
      children: [null, null, null, null, null, null, null, null],
      isLeaf: true, bodyIndex: -1,
    };

    for (let i = 0; i < this.nodeCount; i++) {
      const i3 = i * 3;
      this.insertIntoTree(root, i, this.positions[i3], this.positions[i3 + 1], this.positions[i3 + 2]);
    }
    return root;
  }

  private insertIntoTree(node: OctreeNode, bodyIdx: number, bx: number, by: number, bz: number, depth = 0) {
    if (node.isLeaf && node.bodyIndex === -1) {
      node.bodyIndex = bodyIdx;
      node.cx = bx; node.cy = by; node.cz = bz;
      node.mass = 1;
      return;
    }

    // Prevent infinite recursion from coincident nodes
    if (depth > 40) return;

    if (node.isLeaf) {
      node.isLeaf = false;
      const existing = node.bodyIndex;
      node.bodyIndex = -1;
      const e3 = existing * 3;
      this.insertIntoOctant(node, existing, this.positions[e3], this.positions[e3 + 1], this.positions[e3 + 2], depth);
    }

    const totalMass = node.mass + 1;
    node.cx = (node.cx * node.mass + bx) / totalMass;
    node.cy = (node.cy * node.mass + by) / totalMass;
    node.cz = (node.cz * node.mass + bz) / totalMass;
    node.mass = totalMass;

    this.insertIntoOctant(node, bodyIdx, bx, by, bz);
  }

  private insertIntoOctant(parent: OctreeNode, bodyIdx: number, bx: number, by: number, bz: number, depth = 0) {
    const midX = (parent.minX + parent.maxX) / 2;
    const midY = (parent.minY + parent.maxY) / 2;
    const midZ = (parent.minZ + parent.maxZ) / 2;

    const octant = (bx > midX ? 1 : 0) + (by > midY ? 2 : 0) + (bz > midZ ? 4 : 0);

    const childMinX = octant & 1 ? midX : parent.minX;
    const childMaxX = octant & 1 ? parent.maxX : midX;
    const childMinY = octant & 2 ? midY : parent.minY;
    const childMaxY = octant & 2 ? parent.maxY : midY;
    const childMinZ = octant & 4 ? midZ : parent.minZ;
    const childMaxZ = octant & 4 ? parent.maxZ : midZ;

    if (!parent.children[octant]) {
      parent.children[octant] = {
        cx: 0, cy: 0, cz: 0, mass: 0,
        minX: childMinX, maxX: childMaxX,
        minY: childMinY, maxY: childMaxY,
        minZ: childMinZ, maxZ: childMaxZ,
        children: [null, null, null, null, null, null, null, null],
        isLeaf: true, bodyIndex: -1,
      };
    }

    this.insertIntoTree(parent.children[octant]!, bodyIdx, bx, by, bz, depth + 1);
  }

  private applyAttraction() {
    const strength = this.opts.attractionStrength;
    for (const { srcIdx, tgtIdx } of this.edges) {
      const s3 = srcIdx * 3, t3 = tgtIdx * 3;
      const dx = this.positions[t3] - this.positions[s3];
      const dy = this.positions[t3 + 1] - this.positions[s3 + 1];
      const dz = this.positions[t3 + 2] - this.positions[s3 + 2];
      const dist = Math.sqrt(dx * dx + dy * dy + dz * dz);
      if (dist < 0.01) continue;
      const force = strength * dist;
      const fx = (dx / dist) * force;
      const fy = (dy / dist) * force;
      const fz = (dz / dist) * force;
      if (!this.pinnedNodes.has(srcIdx)) {
        this.velocities[s3] += fx;
        this.velocities[s3 + 1] += fy;
        this.velocities[s3 + 2] += fz;
      }
      if (!this.pinnedNodes.has(tgtIdx)) {
        this.velocities[t3] -= fx;
        this.velocities[t3 + 1] -= fy;
        this.velocities[t3 + 2] -= fz;
      }
    }
  }

  private applyCenter() {
    const strength = this.opts.centerStrength;
    for (let i = 0; i < this.nodeCount; i++) {
      if (this.pinnedNodes.has(i)) continue;
      const i3 = i * 3;
      this.velocities[i3] -= this.positions[i3] * strength;
      this.velocities[i3 + 1] -= this.positions[i3 + 1] * strength;
      this.velocities[i3 + 2] -= this.positions[i3 + 2] * strength;
    }
  }
}
