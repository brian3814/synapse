import { executeQuery, executeExec } from '../query-executor';
import type { DbNoteFolder } from '../../../shared/types';

/**
 * Queries for the S3-style note folder hierarchy.
 *
 * Folders are represented two ways:
 *  - Implicitly via nodes.folder_path on note nodes (e.g. "projects/ml")
 *  - Explicitly via the note_folders table (zero-byte markers for empty
 *    user-created folders that don't yet contain any notes)
 *
 * Folder paths use '/' as the delimiter and never contain a leading or
 * trailing slash. The empty string '' represents the root.
 */

export async function getAllFolders(): Promise<DbNoteFolder[]> {
  const { rows } = await executeQuery<DbNoteFolder>(
    'SELECT * FROM note_folders ORDER BY path;'
  );
  return rows;
}

export async function createFolder(path: string): Promise<void> {
  const normalized = normalizePath(path);
  if (!normalized) return;
  await executeExec(
    'INSERT OR IGNORE INTO note_folders (path) VALUES (?);',
    [normalized]
  );
}

/**
 * Rename a folder, cascading the prefix update across all contained notes
 * and all descendant folders. Single SQL transaction — cheap in SQLite.
 */
export async function renameFolder(oldPath: string, newPath: string): Promise<void> {
  const oldP = normalizePath(oldPath);
  const newP = normalizePath(newPath);
  if (!oldP || !newP || oldP === newP) return;

  // Update notes that live directly in the folder or any descendant
  await executeExec(
    `UPDATE nodes
       SET folder_path = ? || SUBSTR(folder_path, ?)
     WHERE type = 'note'
       AND (folder_path = ? OR folder_path LIKE ? || '/%');`,
    [newP, oldP.length + 1, oldP, oldP]
  );

  // Update the folder marker rows (the folder itself and any sub-folder markers)
  await executeExec(
    `UPDATE note_folders
       SET path = ? || SUBSTR(path, ?)
     WHERE path = ? OR path LIKE ? || '/%';`,
    [newP, oldP.length + 1, oldP, oldP]
  );
}

/**
 * Delete a folder. Moves any notes that lived directly in the folder to
 * the root ('') and removes the marker row. Does NOT recurse into
 * sub-folders — those remain as independent folders at their current path.
 */
export async function deleteFolder(path: string): Promise<void> {
  const p = normalizePath(path);
  if (!p) return;

  await executeExec(
    `UPDATE nodes SET folder_path = '' WHERE type = 'note' AND folder_path = ?;`,
    [p]
  );
  await executeExec('DELETE FROM note_folders WHERE path = ?;', [p]);
}

/** Move a single note to a different folder (or to root with path = ''). */
export async function moveNote(nodeId: string, folderPath: string): Promise<void> {
  const p = normalizePath(folderPath);
  await executeExec(
    `UPDATE nodes SET folder_path = ?, updated_at = datetime('now')
     WHERE id = ? AND type = 'note';`,
    [p, nodeId]
  );
}

export async function getNotesInFolder(path: string): Promise<Array<{ id: string; name: string; folder_path: string }>> {
  const p = normalizePath(path);
  const { rows } = await executeQuery<{ id: string; name: string; folder_path: string }>(
    `SELECT id, name, folder_path FROM nodes
       WHERE type = 'note' AND folder_path = ?
     ORDER BY name;`,
    [p]
  );
  return rows;
}

export async function getNotesRecursive(prefix: string): Promise<Array<{ id: string; name: string; folder_path: string }>> {
  const p = normalizePath(prefix);
  if (p === '') {
    // Root — return all notes
    const { rows } = await executeQuery<{ id: string; name: string; folder_path: string }>(
      `SELECT id, name, folder_path FROM nodes WHERE type = 'note' ORDER BY folder_path, name;`
    );
    return rows;
  }
  const { rows } = await executeQuery<{ id: string; name: string; folder_path: string }>(
    `SELECT id, name, folder_path FROM nodes
       WHERE type = 'note' AND (folder_path = ? OR folder_path LIKE ? || '/%')
     ORDER BY folder_path, name;`,
    [p, p]
  );
  return rows;
}

function normalizePath(p: string): string {
  return p.trim().replace(/^\/+|\/+$/g, '');
}
