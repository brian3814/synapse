import { executeQuery, executeExec } from '../query-executor';

export interface ConceptSourceRow {
  concept_id: string;
  resource_identifier: string;
  created_at: string;
}

export async function getSourcesForConcept(
  conceptId: string
): Promise<{ resourceIdentifier: string; createdAt: string }[]> {
  const { rows } = await executeQuery<ConceptSourceRow>(
    'SELECT * FROM concept_sources WHERE concept_id = ? ORDER BY created_at;',
    [conceptId]
  );
  return rows.map((r) => ({
    resourceIdentifier: r.resource_identifier,
    createdAt: r.created_at,
  }));
}

export async function addSource(
  conceptId: string,
  resourceIdentifier: string
): Promise<void> {
  await executeExec(
    'INSERT OR IGNORE INTO concept_sources (concept_id, resource_identifier) VALUES (?, ?);',
    [conceptId, resourceIdentifier]
  );
}

export async function removeSource(
  conceptId: string,
  resourceIdentifier: string
): Promise<boolean> {
  const { changes } = await executeExec(
    'DELETE FROM concept_sources WHERE concept_id = ? AND resource_identifier = ?;',
    [conceptId, resourceIdentifier]
  );
  return changes > 0;
}

export async function removeAllForResource(
  resourceIdentifier: string
): Promise<number> {
  const { changes } = await executeExec(
    'DELETE FROM concept_sources WHERE resource_identifier = ?;',
    [resourceIdentifier]
  );
  return changes;
}

export async function getConceptsForResource(
  resourceIdentifier: string
): Promise<string[]> {
  const { rows } = await executeQuery<{ concept_id: string }>(
    'SELECT concept_id FROM concept_sources WHERE resource_identifier = ?;',
    [resourceIdentifier]
  );
  return rows.map((r) => r.concept_id);
}
