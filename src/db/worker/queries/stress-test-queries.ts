import { executeTransaction } from '../query-executor';

const NODE_TYPES = [
  'person', 'organization', 'concept', 'technology', 'event',
  'location', 'product', 'paper', 'language', 'protocol',
];

const EDGE_TYPES = [
  'works_at', 'knows', 'uses', 'created', 'depends_on',
  'located_in', 'part_of', 'related_to', 'authored', 'implements',
  'extends', 'competes_with', 'inspired_by', 'funded_by', 'manages',
];

const DOMAINS = [
  'AI', 'Systems', 'Web', 'Database', 'Security', 'Cloud',
  'Mobile', 'DevOps', 'ML', 'Networking', 'Crypto', 'Graphics',
  'Compilers', 'OS', 'Distributed', 'Embedded', 'Robotics', 'HCI',
];

const ADJECTIVES = [
  'Advanced', 'Distributed', 'Scalable', 'Reactive', 'Functional',
  'Concurrent', 'Parallel', 'Adaptive', 'Federated', 'Modular',
  'Lightweight', 'Resilient', 'Secure', 'Optimized', 'Portable',
];

const NOUNS = [
  'Framework', 'Engine', 'Protocol', 'Algorithm', 'Architecture',
  'Platform', 'Runtime', 'Compiler', 'Service', 'Pipeline',
  'Toolkit', 'Library', 'Module', 'Kernel', 'Agent',
  'Network', 'Interface', 'Schema', 'Parser', 'Controller',
];

function generateId(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return Array.from(bytes).map((b) => b.toString(16).padStart(2, '0')).join('');
}

function pick<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}

function generateLabel(index: number): string {
  return `${pick(ADJECTIVES)} ${pick(DOMAINS)} ${pick(NOUNS)} ${index}`;
}

export async function generateStressTestData(
  nodeCount: number
): Promise<{ nodes: number; edges: number }> {
  const nodeIds: string[] = [];
  const statements: Array<{ sql: string; params?: unknown[] }> = [];

  // Compute cluster centroids: each NODE_TYPE gets a position on a circle
  const clusterRadius = Math.sqrt(nodeCount) * 5;
  const centroids = new Map<string, { cx: number; cy: number }>();
  for (let i = 0; i < NODE_TYPES.length; i++) {
    const angle = (2 * Math.PI * i) / NODE_TYPES.length;
    centroids.set(NODE_TYPES[i], {
      cx: Math.cos(angle) * clusterRadius,
      cy: Math.sin(angle) * clusterRadius,
    });
  }

  // Box-Muller for Gaussian jitter
  function gaussianRandom(): number {
    const u1 = Math.random();
    const u2 = Math.random();
    return Math.sqrt(-2 * Math.log(u1 || 1e-10)) * Math.cos(2 * Math.PI * u2);
  }

  const jitterSpread = clusterRadius * 0.25;

  // Generate nodes
  for (let i = 0; i < nodeCount; i++) {
    const id = generateId();
    nodeIds.push(id);
    const semanticType = pick(NODE_TYPES);
    const name = generateLabel(i);
    const identifier = `entity/${name.toLowerCase().replace(/[^a-z0-9]+/g, '-')}-${id.slice(0, 8)}`;
    const properties = JSON.stringify({
      domain: pick(DOMAINS),
      version: `${Math.floor(Math.random() * 10)}.${Math.floor(Math.random() * 20)}.${Math.floor(Math.random() * 100)}`,
      score: Math.round(Math.random() * 100),
    });

    const centroid = centroids.get(semanticType)!;
    const x = centroid.cx + gaussianRandom() * jitterSpread;
    const y = centroid.cy + gaussianRandom() * jitterSpread;

    statements.push({
      sql: `INSERT INTO nodes (id, identifier, name, type, label, properties, size, x, y) VALUES (?, ?, ?, 'entity', ?, ?, ?, ?, ?);`,
      params: [id, identifier, name, semanticType, properties, 0.5 + Math.random() * 2, x, y],
    });
  }

  // Generate edges — complex relationship patterns:
  // 1. Random edges (~3x node count)
  const edgeCount = nodeCount * 3;
  const edgeSet = new Set<string>();

  for (let i = 0; i < edgeCount; i++) {
    const srcIdx = Math.floor(Math.random() * nodeCount);
    let tgtIdx = Math.floor(Math.random() * nodeCount);
    if (tgtIdx === srcIdx) tgtIdx = (srcIdx + 1) % nodeCount;

    const key = `${srcIdx}-${tgtIdx}`;
    if (edgeSet.has(key)) continue;
    edgeSet.add(key);

    statements.push({
      sql: `INSERT INTO edges (id, source_id, target_id, label, type, weight, directed) VALUES (?, ?, ?, ?, ?, ?, ?);`,
      params: [
        generateId(),
        nodeIds[srcIdx],
        nodeIds[tgtIdx],
        pick(EDGE_TYPES),
        pick(EDGE_TYPES),
        Math.round(Math.random() * 100) / 100,
        1,
      ],
    });
  }

  // 2. Hub nodes — pick ~20 hubs with 50-200 connections each
  const hubCount = Math.min(20, Math.floor(nodeCount / 100));
  for (let h = 0; h < hubCount; h++) {
    const hubIdx = Math.floor(Math.random() * nodeCount);
    const fanout = 50 + Math.floor(Math.random() * 150);
    for (let f = 0; f < fanout; f++) {
      let tgtIdx = Math.floor(Math.random() * nodeCount);
      if (tgtIdx === hubIdx) continue;
      const key = `${hubIdx}-${tgtIdx}`;
      if (edgeSet.has(key)) continue;
      edgeSet.add(key);

      statements.push({
        sql: `INSERT INTO edges (id, source_id, target_id, label, type, weight, directed) VALUES (?, ?, ?, ?, ?, ?, ?);`,
        params: [
          generateId(),
          nodeIds[hubIdx],
          nodeIds[tgtIdx],
          pick(EDGE_TYPES),
          pick(EDGE_TYPES),
          Math.round(Math.random() * 100) / 100,
          1,
        ],
      });
    }
  }

  // 3. Chains — sequential connections to create long paths
  const chainCount = Math.min(10, Math.floor(nodeCount / 200));
  for (let c = 0; c < chainCount; c++) {
    const chainStart = Math.floor(Math.random() * nodeCount);
    const chainLen = 20 + Math.floor(Math.random() * 80);
    for (let j = 0; j < chainLen; j++) {
      const srcIdx = (chainStart + j) % nodeCount;
      const tgtIdx = (chainStart + j + 1) % nodeCount;
      const key = `${srcIdx}-${tgtIdx}`;
      if (edgeSet.has(key)) continue;
      edgeSet.add(key);

      statements.push({
        sql: `INSERT INTO edges (id, source_id, target_id, label, type, weight, directed) VALUES (?, ?, ?, ?, ?, ?, ?);`,
        params: [
          generateId(),
          nodeIds[srcIdx],
          nodeIds[tgtIdx],
          'next_in_chain',
          'sequence',
          1.0,
          1,
        ],
      });
    }
  }

  // 4. Clusters — dense interconnections within groups of ~30 nodes
  const clusterCount = Math.min(30, Math.floor(nodeCount / 50));
  for (let c = 0; c < clusterCount; c++) {
    const clusterStart = Math.floor(Math.random() * (nodeCount - 30));
    const clusterSize = 15 + Math.floor(Math.random() * 15);
    for (let a = 0; a < clusterSize; a++) {
      for (let b = a + 1; b < clusterSize; b++) {
        if (Math.random() > 0.4) continue; // 40% density within cluster
        const srcIdx = clusterStart + a;
        const tgtIdx = clusterStart + b;
        const key = `${srcIdx}-${tgtIdx}`;
        if (edgeSet.has(key)) continue;
        edgeSet.add(key);

        statements.push({
          sql: `INSERT INTO edges (id, source_id, target_id, label, type, weight, directed) VALUES (?, ?, ?, ?, ?, ?, ?);`,
          params: [
            generateId(),
            nodeIds[srcIdx],
            nodeIds[tgtIdx],
            'cluster_link',
            'related_to',
            0.8 + Math.random() * 0.2,
            Math.random() > 0.5 ? 1 : 0,
          ],
        });
      }
    }
  }

  const totalEdges = statements.length - nodeCount;

  // Execute in batches of 500 to avoid overly large transactions
  const BATCH_SIZE = 500;
  for (let i = 0; i < statements.length; i += BATCH_SIZE) {
    const batch = statements.slice(i, i + BATCH_SIZE);
    await executeTransaction(batch);
  }

  return { nodes: nodeCount, edges: totalEdges };
}
