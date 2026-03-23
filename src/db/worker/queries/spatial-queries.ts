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

/** Edge counts between node type pairs (for far zoom cluster edges). */
export async function getInterClusterEdges(): Promise<InterClusterEdge[]> {
  const { rows } = await executeQuery<InterClusterEdge>(
    `SELECT n1.type as sourceType, n2.type as targetType, COUNT(*) as count
     FROM edges e
     JOIN nodes n1 ON e.source_id = n1.id
     JOIN nodes n2 ON e.target_id = n2.id
     GROUP BY n1.type, n2.type;`
  );
  return rows;
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
