import { executeQuery, executeExec } from '../query-executor';
import type { DbEdgeSource } from '../../../shared/types';

export type EdgeProvenanceType = 'note' | 'extraction' | 'user';

/**
 * Add a provenance row for an edge. Rows are idempotent:
 * the UNIQUE(edge_id, source_type, source_id, resource_id) constraint
 * prevents duplicate entries, so repeated merges of the same edge from
 * the same source simply no-op.
 */
export async function addEdgeSource(input: {
  edgeId: string;
  sourceType: EdgeProvenanceType;
  sourceId?: string | null;
  resourceId?: string | null;
  location?: string | null;
}): Promise<void> {
  await executeExec(
    `INSERT OR IGNORE INTO edge_sources (edge_id, source_type, source_id, resource_id, location)
     VALUES (?, ?, ?, ?, ?);`,
    [
      input.edgeId,
      input.sourceType,
      input.sourceId ?? null,
      input.resourceId ?? null,
      input.location ?? null,
    ]
  );
}

export async function getSourcesForEdge(edgeId: string): Promise<DbEdgeSource[]> {
  const { rows } = await executeQuery<DbEdgeSource>(
    'SELECT * FROM edge_sources WHERE edge_id = ? ORDER BY created_at;',
    [edgeId]
  );
  return rows;
}

/** Remove all provenance rows attributed to a particular note (used on note deletion). */
export async function removeSourcesForNote(noteId: string): Promise<number> {
  const { changes } = await executeExec(
    "DELETE FROM edge_sources WHERE source_type = 'note' AND source_id = ?;",
    [noteId]
  );
  return changes;
}

/** Convenience: fetch all edges that trace back to a given note (via edge_sources). */
export async function getEdgesFromNote(noteId: string): Promise<string[]> {
  const { rows } = await executeQuery<{ edge_id: string }>(
    "SELECT DISTINCT edge_id FROM edge_sources WHERE source_type = 'note' AND source_id = ?;",
    [noteId]
  );
  return rows.map((r) => r.edge_id);
}
