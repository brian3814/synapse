import { executeQuery, executeTransaction } from '../query-executor';
import type { DbNodeSlim, DbEdgeSlim } from '../../../shared/types';

export interface ClusterSummary {
  type: string;
  count: number;
  avgX: number;
  avgY: number;
}

export interface InterClusterEdge {
  sourceType: string;
  targetType: string;
  count: number;
}

/** Batch-update node positions. Splits into 500-statement batches. */
export async function batchUpdatePositions(
  updates: Array<{ id: string; x: number; y: number }>
): Promise<void> {
  const BATCH_SIZE = 500;
  for (let i = 0; i < updates.length; i += BATCH_SIZE) {
    const batch = updates.slice(i, i + BATCH_SIZE);
    await executeTransaction(
      batch.map((u) => ({
        sql: 'UPDATE nodes SET x = ?, y = ? WHERE id = ?;',
        params: [u.x, u.y, u.id],
      }))
    );
  }
}

/** Get nodes within a bounding box. */
export async function getNodesInBounds(
  minX: number,
  minY: number,
  maxX: number,
  maxY: number,
  limit = 5000
): Promise<DbNodeSlim[]> {
  const { rows } = await executeQuery<DbNodeSlim>(
    `SELECT id, identifier, name, type, color, size, source_url, x, y
     FROM nodes
     WHERE x BETWEEN ? AND ? AND y BETWEEN ? AND ?
     LIMIT ?;`,
    [minX, maxX, minY, maxY, limit]
  );
  return rows;
}

/** Get edges where both endpoints are in the given node set. */
export async function getEdgesForVisibleNodes(
  nodeIds: string[]
): Promise<DbEdgeSlim[]> {
  if (nodeIds.length === 0) return [];
  const placeholders = nodeIds.map(() => '?').join(',');
  const { rows } = await executeQuery<DbEdgeSlim>(
    `SELECT id, source_id, target_id, label, type, weight, directed
     FROM edges
     WHERE source_id IN (${placeholders}) AND target_id IN (${placeholders});`,
    [...nodeIds, ...nodeIds]
  );
  return rows;
}

/** Cluster summary: count + centroid per type (for far zoom). */
export async function getClusterSummary(): Promise<ClusterSummary[]> {
  const { rows } = await executeQuery<ClusterSummary>(
    `SELECT type, COUNT(*) as count, AVG(x) as avgX, AVG(y) as avgY
     FROM nodes
     WHERE x IS NOT NULL
     GROUP BY type;`
  );
  return rows;
}

/** Edge counts between node type pairs (for far zoom cluster edges).
 *  Builds an in-memory id→type map then aggregates — avoids expensive SQL
 *  double-join + GROUP BY over the full edges table. */
export async function getInterClusterEdges(): Promise<InterClusterEdge[]> {
  // 1. Single pass: build id→type map
  const { rows: nodes } = await executeQuery<{ id: string; type: string }>(
    'SELECT id, type FROM nodes;'
  );
  const typeMap = new Map<string, string>();
  for (const n of nodes) typeMap.set(n.id, n.type);

  // 2. Single pass: scan edges, aggregate counts in JS
  const { rows: edges } = await executeQuery<{ source_id: string; target_id: string }>(
    'SELECT source_id, target_id FROM edges;'
  );
  const counts = new Map<string, number>();
  for (const e of edges) {
    const st = typeMap.get(e.source_id);
    const tt = typeMap.get(e.target_id);
    if (!st || !tt) continue;
    const key = `${st}\0${tt}`;
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }

  const result: InterClusterEdge[] = [];
  for (const [key, count] of counts) {
    const [sourceType, targetType] = key.split('\0');
    result.push({ sourceType, targetType, count });
  }
  return result;
}

/** Count nodes in a bounding box (for density checks). */
export async function getNodeCountInBounds(
  minX: number,
  minY: number,
  maxX: number,
  maxY: number
): Promise<number> {
  const { rows } = await executeQuery<{ cnt: number }>(
    `SELECT COUNT(*) as cnt FROM nodes
     WHERE x BETWEEN ? AND ? AND y BETWEEN ? AND ?;`,
    [minX, maxX, minY, maxY]
  );
  return rows[0]?.cnt ?? 0;
}

/** Total node count (for small-graph bypass check). */
export async function getTotalNodeCount(): Promise<number> {
  const { rows } = await executeQuery<{ cnt: number }>(
    'SELECT COUNT(*) as cnt FROM nodes;'
  );
  return rows[0]?.cnt ?? 0;
}
