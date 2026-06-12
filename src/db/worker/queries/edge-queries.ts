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

/**
 * Look up the seeded category for a relationship label.
 * The three-layer model keeps the canonical relationship name in `label`
 * (drives dedup / queries) and a derived category in `type` (drives viz grouping).
 * When the label isn't in the ontology, we fall back to 'related'.
 */
async function deriveEdgeType(label: string): Promise<string> {
  const { rows } = await executeQuery<{ category: string }>(
    'SELECT category FROM ontology_edge_types WHERE type = ?;',
    [label]
  );
  return rows[0]?.category ?? 'related';
}

export async function createEdge(input: {
  sourceId: string;
  targetId: string;
  label: string;
  type?: string;
  properties?: string;
  weight?: number;
  directed?: boolean;
}): Promise<DbEdge> {
  const id = generateId();
  // Auto-derive type from label if caller didn't specify one. This keeps
  // the LLM prompt simple (it only outputs `label`) while the graph viz
  // still gets a stable category to color/style the edge by.
  const type = input.type ?? (await deriveEdgeType(input.label));
  const { rows } = await executeQuery<DbEdge>(
    `INSERT INTO edges (id, source_id, target_id, label, type, properties, weight, directed)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(source_id, target_id, label) DO UPDATE SET
       type = excluded.type,
       properties = excluded.properties,
       weight = excluded.weight,
       directed = excluded.directed,
       updated_at = datetime('now')
     RETURNING *;`,
    [
      id,
      input.sourceId,
      input.targetId,
      input.label,
      type,
      input.properties ?? '{}',
      input.weight ?? 1.0,
      input.directed !== false ? 1 : 0,
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

/** Search edges by label, including source/target node names for display.
 *  Split into two cheap queries — avoids triple-LIKE + double-JOIN over full
 *  edges table, which times out on graphs with 30k+ edges. */
export async function searchEdges(
  queryText: string,
  limit = 30
): Promise<(DbEdge & { source_name: string; target_name: string })[]> {
  const pattern = `%${queryText}%`;
  const { rows: matchedEdges } = await executeQuery<DbEdge>(
    `SELECT * FROM edges WHERE label LIKE ? ORDER BY label LIMIT ?;`,
    [pattern, limit]
  );
  if (matchedEdges.length === 0) return [];

  const endpointIds = Array.from(
    new Set(matchedEdges.flatMap((e) => [e.source_id, e.target_id]))
  );
  const placeholders = endpointIds.map(() => '?').join(',');
  const { rows: endpoints } = await executeQuery<{ id: string; name: string }>(
    `SELECT id, name FROM nodes WHERE id IN (${placeholders});`,
    endpointIds
  );
  const nameMap = new Map(endpoints.map((n) => [n.id, n.name]));

  return matchedEdges.map((e) => ({
    ...e,
    source_name: nameMap.get(e.source_id) ?? '',
    target_name: nameMap.get(e.target_id) ?? '',
  }));
}

export interface OntologyEdgeType {
  type: string;
  description: string | null;
  category: string;
}

export async function getAllOntologyEdgeTypes(): Promise<OntologyEdgeType[]> {
  const { rows } = await executeQuery<OntologyEdgeType>(
    'SELECT type, description, category FROM ontology_edge_types ORDER BY type;'
  );
  return rows;
}

export async function getDistinctEdgeLabels(): Promise<string[]> {
  const { rows } = await executeQuery<{ label: string }>(
    `SELECT type AS label FROM ontology_edge_types
     UNION
     SELECT DISTINCT label FROM edges
     ORDER BY label;`
  );
  return rows.map(r => r.label);
}

export async function createOntologyEdgeType(input: {
  type: string;
  description?: string;
  category?: string;
}): Promise<void> {
  await executeExec(
    'INSERT OR IGNORE INTO ontology_edge_types (type, description, category) VALUES (?, ?, ?);',
    [input.type, input.description ?? null, input.category ?? 'semantic']
  );
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
