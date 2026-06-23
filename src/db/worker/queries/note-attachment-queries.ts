import { executeQuery, executeExec } from '../query-executor';
import type { DbNoteAttachment } from '../../../shared/types';

export async function createAttachment(
  noteId: string,
  filename: string,
  mimeType: string,
  data: Uint8Array
): Promise<DbNoteAttachment> {
  const { rows } = await executeQuery<DbNoteAttachment>(
    `INSERT INTO note_attachments (note_id, filename, mime_type, data)
     VALUES (?, ?, ?, ?)
     RETURNING *;`,
    [noteId, filename, mimeType, data]
  );
  return rows[0];
}

export async function getAttachment(
  id: string
): Promise<(DbNoteAttachment) | null> {
  const { rows } = await executeQuery<DbNoteAttachment>(
    'SELECT * FROM note_attachments WHERE id = ?;',
    [id]
  );
  return rows[0] ?? null;
}

/** Metadata only (no BLOB) for listing attachments. */
export async function getAttachmentsForNote(
  noteId: string
): Promise<Omit<DbNoteAttachment, 'data'>[]> {
  const { rows } = await executeQuery<Omit<DbNoteAttachment, 'data'>>(
    'SELECT id, note_id, filename, mime_type, source_url, created_at FROM note_attachments WHERE note_id = ? ORDER BY created_at;',
    [noteId]
  );
  return rows;
}

export async function deleteAttachment(id: string): Promise<boolean> {
  const { changes } = await executeExec(
    'DELETE FROM note_attachments WHERE id = ?;',
    [id]
  );
  return changes > 0;
}
