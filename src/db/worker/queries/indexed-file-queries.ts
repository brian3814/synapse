import { executeQuery, executeExec } from '../query-executor';
import type { DbIndexedFile } from '../../../shared/types';

function generateId(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

export async function saveIndexedFile(input: {
  filePath: string;
  fileName: string;
  lastModified: number;
  contentHash?: string;
  nodeId?: string;
}): Promise<DbIndexedFile> {
  // Upsert by file_path
  const existing = await getByPath(input.filePath);
  if (existing) {
    const { rows } = await executeQuery<DbIndexedFile>(
      `UPDATE indexed_files
       SET last_modified = ?, content_hash = COALESCE(?, content_hash),
           node_id = COALESCE(?, node_id), indexed_at = datetime('now')
       WHERE id = ?
       RETURNING *;`,
      [input.lastModified, input.contentHash ?? null, input.nodeId ?? null, existing.id]
    );
    return rows[0];
  }

  const id = generateId();
  const { rows } = await executeQuery<DbIndexedFile>(
    `INSERT INTO indexed_files (id, file_path, file_name, last_modified, content_hash, node_id)
     VALUES (?, ?, ?, ?, ?, ?)
     RETURNING *;`,
    [id, input.filePath, input.fileName, input.lastModified, input.contentHash ?? null, input.nodeId ?? null]
  );
  return rows[0];
}

export async function getByPath(filePath: string): Promise<DbIndexedFile | null> {
  const { rows } = await executeQuery<DbIndexedFile>(
    'SELECT * FROM indexed_files WHERE file_path = ?;',
    [filePath]
  );
  return rows[0] ?? null;
}

export async function getAllIndexedFiles(): Promise<DbIndexedFile[]> {
  const { rows } = await executeQuery<DbIndexedFile>(
    'SELECT * FROM indexed_files ORDER BY file_path;'
  );
  return rows;
}

export async function deleteByPath(filePath: string): Promise<boolean> {
  const { changes } = await executeExec(
    'DELETE FROM indexed_files WHERE file_path = ?;',
    [filePath]
  );
  return changes > 0;
}

export async function deleteByNodeId(nodeId: string): Promise<boolean> {
  const { changes } = await executeExec(
    'DELETE FROM indexed_files WHERE node_id = ?;',
    [nodeId]
  );
  return changes > 0;
}

export async function getByNodeId(nodeId: string): Promise<DbIndexedFile | null> {
  const { rows } = await executeQuery<DbIndexedFile>(
    'SELECT * FROM indexed_files WHERE node_id = ?;',
    [nodeId]
  );
  return rows[0] ?? null;
}
