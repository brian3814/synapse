import { executeQuery, executeExec } from '../query-executor';
import type { ArtifactRecord, ArtifactType } from '../../../shared/artifact-types';

interface ArtifactRow {
  id: string;
  title: string;
  type: string;
  session_id: string | null;
  session_dir: string;
  file_name: string;
  created_at: string;
  updated_at: string;
}

function rowToRecord(row: ArtifactRow): ArtifactRecord {
  return {
    id: row.id,
    title: row.title,
    type: row.type as ArtifactType,
    sessionId: row.session_id ?? '',
    sessionDir: row.session_dir,
    fileName: row.file_name,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export async function listArtifacts(): Promise<ArtifactRecord[]> {
  const { rows } = await executeQuery<ArtifactRow>(
    `SELECT * FROM artifacts ORDER BY updated_at DESC;`
  );
  return rows.map(rowToRecord);
}

export async function getArtifact(id: string): Promise<ArtifactRecord | null> {
  const { rows } = await executeQuery<ArtifactRow>(
    `SELECT * FROM artifacts WHERE id = ?;`,
    [id]
  );
  return rows[0] ? rowToRecord(rows[0]) : null;
}

export async function insertArtifact(record: ArtifactRecord): Promise<void> {
  await executeExec(
    `INSERT INTO artifacts (id, title, type, session_id, session_dir, file_name, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?);`,
    [record.id, record.title, record.type, record.sessionId || null, record.sessionDir, record.fileName, record.createdAt, record.updatedAt]
  );
  await executeExec(
    `INSERT INTO artifacts_fts (id, title, text_content) VALUES (?, ?, '');`,
    [record.id, record.title]
  );
}

export async function updateArtifactRow(id: string, title: string, updatedAt: string): Promise<void> {
  await executeExec(
    `UPDATE artifacts SET title = ?, updated_at = ? WHERE id = ?;`,
    [title, updatedAt, id]
  );
  await executeExec(
    `UPDATE artifacts_fts SET title = ? WHERE id = ?;`,
    [title, id]
  );
}

export async function updateArtifactFts(id: string, textContent: string): Promise<void> {
  await executeExec(
    `UPDATE artifacts_fts SET text_content = ? WHERE id = ?;`,
    [textContent, id]
  );
}

export async function deleteArtifactRow(id: string): Promise<void> {
  await executeExec(
    `DELETE FROM artifacts WHERE id = ?;`,
    [id]
  );
  await executeExec(
    `DELETE FROM artifacts_fts WHERE id = ?;`,
    [id]
  );
}

const FTS5_SPECIAL = /["*()\-+^:{}~|]/g;

function sanitizeFTS5Query(raw: string): string | null {
  const tokens = raw
    .split(/\s+/)
    .map((t) => t.replace(FTS5_SPECIAL, '').trim())
    .filter((t) => t.length > 0);
  if (tokens.length === 0) return null;
  return tokens.map((t) => `"${t}"*`).join(' ');
}

export async function searchArtifacts(query: string): Promise<ArtifactRecord[]> {
  const ftsQuery = sanitizeFTS5Query(query);
  if (!ftsQuery) return listArtifacts();

  try {
    const { rows } = await executeQuery<ArtifactRow>(
      `SELECT a.*
       FROM artifacts a
       JOIN artifacts_fts fts ON a.id = fts.id
       WHERE artifacts_fts MATCH ?
       ORDER BY rank;`,
      [ftsQuery]
    );
    return rows.map(rowToRecord);
  } catch {
    // FTS5 failed — fall back to listing all
    return listArtifacts();
  }
}
