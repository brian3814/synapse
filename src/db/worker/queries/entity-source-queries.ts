import { executeQuery, executeExec } from '../query-executor';
import type { DbEntitySource } from '../../../shared/types';

export type EntityRelationType = 'about' | 'mention';

export async function getSourcesForEntity(
  entityId: string
): Promise<{ resourceId: string; relationType: EntityRelationType; createdAt: string; location?: string }[]> {
  const { rows } = await executeQuery<DbEntitySource & { location?: string | null }>(
    'SELECT * FROM entity_sources WHERE entity_id = ? ORDER BY created_at;',
    [entityId]
  );
  return rows.map((r) => ({
    resourceId: r.resource_id,
    relationType: r.relation_type,
    createdAt: r.created_at,
    location: r.location ?? undefined,
  }));
}

export async function addEntitySource(
  entityId: string,
  resourceId: string,
  relationType: EntityRelationType = 'about',
  location?: string
): Promise<void> {
  await executeExec(
    `INSERT OR IGNORE INTO entity_sources (entity_id, resource_id, relation_type, location)
     VALUES (?, ?, ?, ?);`,
    [entityId, resourceId, relationType, location ?? null]
  );
}

export async function removeEntitySource(
  entityId: string,
  resourceId: string,
  relationType?: EntityRelationType
): Promise<boolean> {
  if (relationType) {
    const { changes } = await executeExec(
      'DELETE FROM entity_sources WHERE entity_id = ? AND resource_id = ? AND relation_type = ?;',
      [entityId, resourceId, relationType]
    );
    return changes > 0;
  }
  const { changes } = await executeExec(
    'DELETE FROM entity_sources WHERE entity_id = ? AND resource_id = ?;',
    [entityId, resourceId]
  );
  return changes > 0;
}

export async function removeAllForResource(resourceId: string): Promise<number> {
  const { changes } = await executeExec(
    'DELETE FROM entity_sources WHERE resource_id = ?;',
    [resourceId]
  );
  return changes;
}

export async function getEntitiesForResource(
  resourceId: string
): Promise<{ entityId: string; relationType: EntityRelationType }[]> {
  const { rows } = await executeQuery<{ entity_id: string; relation_type: EntityRelationType }>(
    'SELECT entity_id, relation_type FROM entity_sources WHERE resource_id = ?;',
    [resourceId]
  );
  return rows.map((r) => ({ entityId: r.entity_id, relationType: r.relation_type }));
}
