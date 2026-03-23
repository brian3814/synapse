import { executeQuery, executeExec, executeTransaction } from '../query-executor';

export async function getTagsForNode(nodeId: string): Promise<string[]> {
  const { rows } = await executeQuery<{ tag: string }>(
    'SELECT tag FROM node_tags WHERE node_id = ? ORDER BY tag;',
    [nodeId]
  );
  return rows.map((r) => r.tag);
}

export async function setTagsForNode(nodeId: string, tags: string[]): Promise<void> {
  await executeExec('DELETE FROM node_tags WHERE node_id = ?;', [nodeId]);
  if (tags.length === 0) return;
  const statements = tags.map((tag) => ({
    sql: 'INSERT OR IGNORE INTO node_tags (node_id, tag) VALUES (?, ?);',
    params: [nodeId, tag] as unknown[],
  }));
  await executeTransaction(statements);
}

export async function getAllTags(): Promise<string[]> {
  const { rows } = await executeQuery<{ tag: string }>(
    'SELECT DISTINCT tag FROM node_tags ORDER BY tag;'
  );
  return rows.map((r) => r.tag);
}
