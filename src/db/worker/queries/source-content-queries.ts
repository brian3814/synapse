import { executeQuery, executeExec } from '../query-executor';
import type { DbSourceContent } from '../../../shared/types';

function generateId(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

function hashContent(content: string): string {
  // Simple DJB2 hash for dedup — not crypto-grade but fine for content comparison
  let hash = 5381;
  for (let i = 0; i < content.length; i++) {
    hash = ((hash << 5) + hash + content.charCodeAt(i)) | 0;
  }
  return (hash >>> 0).toString(16);
}

export async function saveSourceContent(input: {
  nodeId?: string;
  url: string;
  title?: string;
  content: string;
}): Promise<DbSourceContent> {
  const id = generateId();
  const contentHash = hashContent(input.content);

  // Upsert: if same URL already exists, update content
  const existing = await getByUrl(input.url);
  if (existing) {
    const { rows } = await executeQuery<DbSourceContent>(
      `UPDATE source_content
       SET content = ?, content_hash = ?, title = COALESCE(?, title),
           node_id = COALESCE(?, node_id), extracted_at = datetime('now')
       WHERE id = ?
       RETURNING *;`,
      [input.content, contentHash, input.title ?? null, input.nodeId ?? null, existing.id]
    );
    return rows[0];
  }

  const { rows } = await executeQuery<DbSourceContent>(
    `INSERT INTO source_content (id, node_id, url, title, content, content_hash)
     VALUES (?, ?, ?, ?, ?, ?)
     RETURNING *;`,
    [id, input.nodeId ?? null, input.url, input.title ?? null, input.content, contentHash]
  );
  return rows[0];
}

export async function getByNodeId(nodeId: string): Promise<DbSourceContent | null> {
  const { rows } = await executeQuery<DbSourceContent>(
    'SELECT * FROM source_content WHERE node_id = ? ORDER BY extracted_at DESC LIMIT 1;',
    [nodeId]
  );
  return rows[0] ?? null;
}

export async function getByUrl(url: string): Promise<DbSourceContent | null> {
  const { rows } = await executeQuery<DbSourceContent>(
    'SELECT * FROM source_content WHERE url = ? ORDER BY extracted_at DESC LIMIT 1;',
    [url]
  );
  return rows[0] ?? null;
}

export async function searchContent(queryText: string, limit = 20): Promise<DbSourceContent[]> {
  const pattern = `%${queryText}%`;
  const { rows } = await executeQuery<DbSourceContent>(
    `SELECT * FROM source_content
     WHERE content LIKE ? OR title LIKE ? OR url LIKE ?
     ORDER BY extracted_at DESC
     LIMIT ?;`,
    [pattern, pattern, pattern, limit]
  );
  return rows;
}

export async function deleteByNodeId(nodeId: string): Promise<boolean> {
  const { changes } = await executeExec(
    'DELETE FROM source_content WHERE node_id = ?;',
    [nodeId]
  );
  return changes > 0;
}

export async function getAllSourceContent(): Promise<DbSourceContent[]> {
  const { rows } = await executeQuery<DbSourceContent>(
    'SELECT * FROM source_content ORDER BY extracted_at DESC;'
  );
  return rows;
}
