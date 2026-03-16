/**
 * Spherical layout with type-based sector grouping.
 *
 * Technique adapted from https://github.com/luciopaiva/threejs-points-on-sphere:
 * - Archimedes' theorem: phi = acos(rand * 2 - 1) for area-uniform distribution
 * - Sphere divided into meridian/parallel sectors, one per node type
 * - Seeded Mulberry32 PRNG for deterministic results
 * - Fibonacci spiral fallback for nodes without type info
 */

// ---- Mulberry32 PRNG (deterministic, seedable) ----

class PRNG {
  private a: number;
  private seed: number;

  constructor(seed: number) {
    this.seed = seed;
    this.a = seed;
  }

  next(): number {
    this.a += 0x6D2B79F5;
    let t = this.a;
    t = Math.imul(t ^ t >>> 15, t | 1);
    t ^= t + Math.imul(t ^ t >>> 7, t | 61);
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  }

  reset() {
    this.a = this.seed;
  }
}

// ---- Layout ----

export interface SphericalNode {
  id: string;
  type?: string;
}

const GOLDEN_RATIO = (1 + Math.sqrt(5)) / 2;

export function sphericalLayout(
  nodes: SphericalNode[],
  radius?: number
): Map<string, { x: number; y: number; z: number }> {
  const n = nodes.length;
  if (n === 0) return new Map();

  const r = radius ?? Math.max(10, Math.sqrt(n) * 8);
  const positions = new Map<string, { x: number; y: number; z: number }>();

  // Group nodes by type
  const typeGroups = new Map<string, SphericalNode[]>();
  const untyped: SphericalNode[] = [];

  for (const node of nodes) {
    const type = node.type ?? '';
    if (!type) {
      untyped.push(node);
      continue;
    }
    let group = typeGroups.get(type);
    if (!group) {
      group = [];
      typeGroups.set(type, group);
    }
    group.push(node);
  }

  const typeKeys = [...typeGroups.keys()].sort();
  const numTypes = typeKeys.length;

  // If all nodes are untyped or single type, use Fibonacci spiral
  if (numTypes <= 1) {
    return fibonacciLayout(nodes, r);
  }

  // Compute grid: numParallels × numMeridians sectors to cover the sphere.
  // Choose a grid that roughly matches the number of types.
  const numMeridians = Math.max(2, Math.ceil(Math.sqrt(numTypes * 2)));
  const numParallels = Math.max(2, Math.ceil(numTypes / numMeridians));

  const rand = new PRNG(42);

  // Assign each type to a (lat, lng) sector
  let sectorIdx = 0;
  for (const typeKey of typeKeys) {
    const group = typeGroups.get(typeKey)!;
    const lat = sectorIdx % numParallels;
    const lng = Math.floor(sectorIdx / numParallels) % numMeridians;
    sectorIdx++;

    distributeInSector(group, lat, lng, numParallels, numMeridians, r, rand, positions);
  }

  // Distribute untyped nodes uniformly across the full sphere
  for (const node of untyped) {
    const phi = Math.acos(rand.next() * 2 - 1);
    const theta = rand.next() * Math.PI * 2;
    positions.set(node.id, {
      x: r * Math.sin(phi) * Math.cos(theta),
      y: r * Math.cos(phi),
      z: r * Math.sin(phi) * Math.sin(theta),
    });
  }

  return positions;
}

/**
 * Archimedes area-uniform distribution within a spherical sector (patch).
 * phi range is divided into `numParallels` bands, theta into `numMeridians` slices.
 * Uses acos() to ensure equal area per patch regardless of latitude.
 */
function distributeInSector(
  nodes: SphericalNode[],
  lat: number,
  lng: number,
  numParallels: number,
  numMeridians: number,
  radius: number,
  rand: PRNG,
  out: Map<string, { x: number; y: number; z: number }>
) {
  for (const node of nodes) {
    // Archimedes: acos maps uniform random → area-uniform phi within the sector
    const phi = Math.acos(
      rand.next() * 2 / numParallels + 2 * lat / numParallels - 1
    );
    const theta = (rand.next() + lng) * 2 * Math.PI / numMeridians;

    out.set(node.id, {
      x: radius * Math.sin(phi) * Math.cos(theta),
      y: radius * Math.cos(phi),
      z: radius * Math.sin(phi) * Math.sin(theta),
    });
  }
}

/** Fibonacci spiral — deterministic, near-uniform spacing. Used as fallback. */
function fibonacciLayout(
  nodes: SphericalNode[],
  radius: number
): Map<string, { x: number; y: number; z: number }> {
  const n = nodes.length;
  const positions = new Map<string, { x: number; y: number; z: number }>();

  for (let i = 0; i < n; i++) {
    const theta = 2 * Math.PI * i / GOLDEN_RATIO;
    const phi = Math.acos(1 - 2 * (i + 0.5) / n);

    positions.set(nodes[i].id, {
      x: radius * Math.sin(phi) * Math.cos(theta),
      y: radius * Math.cos(phi),
      z: radius * Math.sin(phi) * Math.sin(theta),
    });
  }

  return positions;
}
