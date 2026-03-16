/**
 * Fibonacci sphere layout — distributes N points approximately evenly
 * on the surface of a sphere using the golden spiral method.
 * O(n) computation, no iterative simulation needed.
 */

const GOLDEN_RATIO = (1 + Math.sqrt(5)) / 2;

export function sphericalLayout(
  nodeIds: string[],
  radius?: number
): Map<string, { x: number; y: number; z: number }> {
  const n = nodeIds.length;
  if (n === 0) return new Map();

  // Scale radius with node count so density stays reasonable
  const r = radius ?? Math.max(10, Math.sqrt(n) * 8);
  const positions = new Map<string, { x: number; y: number; z: number }>();

  for (let i = 0; i < n; i++) {
    // Fibonacci sphere: golden-ratio-spaced azimuthal angle, uniform vertical
    const theta = 2 * Math.PI * i / GOLDEN_RATIO;
    const phi = Math.acos(1 - 2 * (i + 0.5) / n);

    positions.set(nodeIds[i], {
      x: r * Math.sin(phi) * Math.cos(theta),
      y: r * Math.cos(phi),
      z: r * Math.sin(phi) * Math.sin(theta),
    });
  }

  return positions;
}
