import { executeQuery, executeExec } from '../query-executor';

export interface SemanticMemory {
  id: string;
  category: string;
  content: string;
  source_session_id: string | null;
  created_at: string;
  updated_at: string;
}

export interface EpisodicMemory {
  id: string;
  session_id: string;
  summary: string;
  key_topics: string | null;
  created_at: string;
}

function generateId(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return Array.from(bytes).map((b) => b.toString(16).padStart(2, '0')).join('');
}

export async function addSemantic(input: {
  category: string;
  content: string;
  sourceSessionId?: string;
}): Promise<SemanticMemory> {
  const id = generateId();
  const { rows } = await executeQuery<SemanticMemory>(
    `INSERT INTO memory_semantic (id, category, content, source_session_id)
     VALUES (?, ?, ?, ?)
     RETURNING *;`,
    [id, input.category, input.content, input.sourceSessionId ?? null],
  );
  return rows[0];
}

export async function getAllSemantic(): Promise<SemanticMemory[]> {
  const { rows } = await executeQuery<SemanticMemory>(
    'SELECT * FROM memory_semantic ORDER BY updated_at DESC;',
  );
  return rows;
}

export async function getRecentSemantic(limit = 20): Promise<SemanticMemory[]> {
  const { rows } = await executeQuery<SemanticMemory>(
    'SELECT * FROM memory_semantic ORDER BY updated_at DESC LIMIT ?;',
    [limit],
  );
  return rows;
}

export async function deleteSemantic(id: string): Promise<boolean> {
  const { changes } = await executeExec(
    'DELETE FROM memory_semantic WHERE id = ?;',
    [id],
  );
  return changes > 0;
}

export async function clearAllSemantic(): Promise<number> {
  const { changes } = await executeExec('DELETE FROM memory_semantic;');
  return changes;
}

export async function findDuplicateSemantic(content: string): Promise<SemanticMemory | null> {
  const normalised = content.toLowerCase().trim();
  const { rows } = await executeQuery<SemanticMemory>(
    'SELECT * FROM memory_semantic WHERE LOWER(TRIM(content)) = ? LIMIT 1;',
    [normalised],
  );
  return rows[0] ?? null;
}

export async function touchSemantic(id: string): Promise<void> {
  await executeExec(
    `UPDATE memory_semantic SET updated_at = datetime('now') WHERE id = ?;`,
    [id],
  );
}

export async function addEpisodic(input: {
  sessionId: string;
  summary: string;
  keyTopics?: string[];
}): Promise<EpisodicMemory> {
  const id = generateId();
  const { rows } = await executeQuery<EpisodicMemory>(
    `INSERT INTO memory_episodic (id, session_id, summary, key_topics)
     VALUES (?, ?, ?, ?)
     RETURNING *;`,
    [id, input.sessionId, input.summary, input.keyTopics ? JSON.stringify(input.keyTopics) : null],
  );
  return rows[0];
}

export async function getRecentEpisodic(limit = 3): Promise<EpisodicMemory[]> {
  const { rows } = await executeQuery<EpisodicMemory>(
    'SELECT * FROM memory_episodic ORDER BY created_at DESC LIMIT ?;',
    [limit],
  );
  return rows;
}

export async function clearAllEpisodic(): Promise<number> {
  const { changes } = await executeExec('DELETE FROM memory_episodic;');
  return changes;
}
