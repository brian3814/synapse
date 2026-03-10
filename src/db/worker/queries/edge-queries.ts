import { executeQuery, executeExec } from '../query-executor';
import type { DbEdge, DbEdgeSlim } from '../../../shared/types';

export async function getAllEdges(): Promise<DbEdge[]> {
  const { rows } = await executeQuery<DbEdge>('SELECT * FROM edges ORDER BY updated_at DESC;');
  return rows;
}

/** Slim projection for bulk graph loading — skips properties, source_url, timestamps */
export async function getAllEdgesSlim(): Promise<DbEdgeSlim[]> {
  const { rows } = await executeQuery<DbEdgeSlim>(
    'SELECT id, source_id, target_id, label, type, weight, directed FROM edges;'
  );
  return rows;
}

export async function getEdgeById(id: string): Promise<DbEdge | null> {
  const { rows } = await executeQuery<DbEdge>('SELECT * FROM edges WHERE id = ?;', [id]);
  return rows[0] ?? null;
}

export async function getEdgesForNode(nodeId: string): Promise<DbEdge[]> {
  const { rows } = await executeQuery<DbEdge>(
    'SELECT * FROM edges WHERE source_id = ? OR target_id = ?;',
    [nodeId, nodeId]
  );
  return rows;
}

export async function createEdge(input: {
  sourceId: string;
  targetId: string;
  label: string;
  type?: string;
  properties?: string;
  weight?: number;
  directed?: boolean;
  sourceUrl?: string;
}): Promise<DbEdge> {
  const id = generateId();
  const { rows } = await executeQuery<DbEdge>(
    `INSERT INTO edges (id, source_id, target_id, label, type, properties, weight, directed, source_url)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
     RETURNING *;`,
    [
      id,
      input.sourceId,
      input.targetId,
      input.label,
      input.type ?? 'related',
      input.properties ?? '{}',
      input.weight ?? 1.0,
      input.directed !== false ? 1 : 0,
      input.sourceUrl ?? null,
    ]
  );
  return rows[0];
}

export async function updateEdge(input: {
  id: string;
  label?: string;
  type?: string;
  properties?: string;
  weight?: number;
}): Promise<DbEdge | null> {
  const sets: string[] = [];
  const params: unknown[] = [];

  if (input.label !== undefined) {
    sets.push('label = ?');
    params.push(input.label);
  }
  if (input.type !== undefined) {
    sets.push('type = ?');
    params.push(input.type);
  }
  if (input.properties !== undefined) {
    sets.push('properties = ?');
    params.push(input.properties);
  }
  if (input.weight !== undefined) {
    sets.push('weight = ?');
    params.push(input.weight);
  }

  if (sets.length === 0) return getEdgeById(input.id);

  sets.push("updated_at = datetime('now')");
  params.push(input.id);

  const { rows } = await executeQuery<DbEdge>(
    `UPDATE edges SET ${sets.join(', ')} WHERE id = ? RETURNING *;`,
    params
  );
  return rows[0] ?? null;
}

export async function deleteEdge(id: string): Promise<boolean> {
  const { changes } = await executeExec('DELETE FROM edges WHERE id = ?;', [id]);
  return changes > 0;
}

export async function getEdgeTypes(): Promise<string[]> {
  const { rows } = await executeQuery<{ type: string }>('SELECT DISTINCT type FROM edges ORDER BY type;');
  return rows.map(r => r.type);
}

export async function getEdgesBetween(nodeIds: string[]): Promise<DbEdge[]> {
  if (nodeIds.length === 0) return [];
  const placeholders = nodeIds.map(() => '?').join(',');
  const { rows } = await executeQuery<DbEdge>(
    `SELECT * FROM edges
     WHERE source_id IN (${placeholders}) AND target_id IN (${placeholders});`,
    [...nodeIds, ...nodeIds]
  );
  return rows;
}

function generateId(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}
