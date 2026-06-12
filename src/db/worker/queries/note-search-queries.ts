import { executeQuery, executeExec } from '../query-executor';
import { isNotesFTS5Available } from '../migrations';

export interface NoteSearchEntry {
  rowid: number;
  node_id: string;
  title: string;
  body: string;
}

export interface NoteSearchResult {
  node_id: string;
  title: string;
  snippet: string;
}

// --- Mutations ---

export async function upsertNoteSearch(
  nodeId: string,
  title: string,
  body: string,
): Promise<void> {
  await executeExec(
    `INSERT INTO note_search (node_id, title, body) VALUES (?, ?, ?)
     ON CONFLICT(node_id) DO UPDATE SET title = excluded.title, body = excluded.body;`,
    [nodeId, title, body],
  );
}

export async function deleteNoteSearch(nodeId: string): Promise<boolean> {
  const { changes } = await executeExec(
    'DELETE FROM note_search WHERE node_id = ?;',
    [nodeId],
  );
  return changes > 0;
}

// --- Queries ---

const FTS5_SPECIAL = /["*()\-+^:{}~|]/g;

function sanitizeFTS5Query(raw: string): string | null {
  const tokens = raw
    .split(/\s+/)
    .map((t) => t.replace(FTS5_SPECIAL, '').trim())
    .filter((t) => t.length > 0);
  if (tokens.length === 0) return null;
  return tokens.map((t) => `"${t}"*`).join(' ');
}

export async function searchNotes(
  queryText: string,
  limit = 30,
): Promise<NoteSearchResult[]> {
  if (isNotesFTS5Available()) {
    const ftsQuery = sanitizeFTS5Query(queryText);
    if (ftsQuery !== null) {
      try {
        const { rows } = await executeQuery<NoteSearchResult>(
          `SELECT ns.node_id, ns.title, substr(ns.body, 1, 200) AS snippet
           FROM note_search ns
           JOIN notes_fts fts ON ns.rowid = fts.rowid
           WHERE notes_fts MATCH ?
           ORDER BY rank
           LIMIT ?;`,
          [ftsQuery, limit],
        );
        return rows;
      } catch {
        // FTS5 failed — fall through to LIKE
      }
    }
  }

  // Fallback: LIKE on backing table
  const pattern = `%${queryText}%`;
  const { rows } = await executeQuery<NoteSearchResult>(
    `SELECT node_id, title, substr(body, 1, 200) AS snippet
     FROM note_search
     WHERE title LIKE ? OR body LIKE ?
     ORDER BY title
     LIMIT ?;`,
    [pattern, pattern, limit],
  );
  return rows;
}

export async function getNoteSearchEntry(
  nodeId: string,
): Promise<{ title: string; body: string } | null> {
  const { rows } = await executeQuery<{ title: string; body: string }>(
    'SELECT title, body FROM note_search WHERE node_id = ?;',
    [nodeId],
  );
  return rows[0] ?? null;
}

export async function getAllNoteSearchEntries(): Promise<
  Array<{ node_id: string; title: string }>
> {
  const { rows } = await executeQuery<{ node_id: string; title: string }>(
    'SELECT node_id, title FROM note_search;',
  );
  return rows;
}
