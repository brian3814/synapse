import { executeQuery, executeExec } from '../query-executor';

export async function getActiveSession(): Promise<any | null> {
  const { rows } = await executeQuery<any>(
    `SELECT * FROM chat_sessions
     WHERE status = 'active'
       AND datetime(last_active_at, '+2 hours') > datetime('now')
     ORDER BY last_active_at DESC
     LIMIT 1;`
  );
  return rows[0] ?? null;
}

export async function createSession(id: string, title: string): Promise<any> {
  const { rows } = await executeQuery<any>(
    `INSERT INTO chat_sessions (id, title) VALUES (?, ?) RETURNING *;`,
    [id, title]
  );
  return rows[0];
}

export async function expireSession(id: string): Promise<void> {
  await executeExec(
    `UPDATE chat_sessions SET status = 'expired' WHERE id = ?;`,
    [id]
  );
}

export async function expireAllStaleSessions(): Promise<void> {
  await executeExec(
    `UPDATE chat_sessions SET status = 'expired'
     WHERE status = 'active'
       AND datetime(last_active_at, '+2 hours') <= datetime('now');`
  );
}

export async function touchSession(id: string): Promise<void> {
  await executeExec(
    `UPDATE chat_sessions SET last_active_at = datetime('now') WHERE id = ?;`,
    [id]
  );
}

export async function pruneSessions(maxSessions: number = 10): Promise<void> {
  await executeExec(
    `DELETE FROM chat_sessions WHERE id NOT IN (
       SELECT id FROM chat_sessions ORDER BY created_at DESC LIMIT ?
     );`,
    [maxSessions]
  );
}

export async function saveMessage(input: {
  id: string;
  sessionId: string;
  role: 'user' | 'assistant';
  content: string;
  status: 'complete' | 'error';
}): Promise<any> {
  const { rows } = await executeQuery<any>(
    `INSERT INTO chat_messages (id, session_id, role, content, status)
     VALUES (?, ?, ?, ?, ?) RETURNING *;`,
    [input.id, input.sessionId, input.role, input.content, input.status]
  );
  return rows[0];
}

export async function getSessionMessages(sessionId: string): Promise<any[]> {
  const { rows } = await executeQuery<any>(
    `SELECT * FROM chat_messages
     WHERE session_id = ?
     ORDER BY created_at ASC;`,
    [sessionId]
  );
  return rows;
}

export async function getAllSessions(): Promise<any[]> {
  const { rows } = await executeQuery<any>(
    `SELECT id, title, created_at, last_active_at, status
     FROM chat_sessions
     ORDER BY last_active_at DESC
     LIMIT 20;`
  );
  return rows;
}

export async function getRecentMessages(sessionId: string, limit: number = 20): Promise<any[]> {
  const { rows } = await executeQuery<any>(
    `SELECT * FROM (
       SELECT * FROM chat_messages
       WHERE session_id = ? AND status = 'complete'
       ORDER BY created_at DESC LIMIT ?
     ) sub ORDER BY created_at ASC;`,
    [sessionId, limit]
  );
  return rows;
}
