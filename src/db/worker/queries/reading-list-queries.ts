import { executeQuery, executeExec } from '../query-executor';

function generateId(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

export async function saveHistory(input: {
  url: string;
  title: string;
  summary: string;
  keyTopics: string[];
  nodeIds: string[];
}): Promise<any> {
  const id = generateId();
  const keyTopicsJson = JSON.stringify(input.keyTopics);
  const nodeIdsJson = JSON.stringify(input.nodeIds);

  // Upsert: if same URL already exists, update
  const existing = await getByUrl(input.url);
  if (existing) {
    const { rows } = await executeQuery(
      `UPDATE reading_list_history
       SET title = ?, summary = ?, key_topics = ?, node_ids = ?, merged_at = datetime('now')
       WHERE id = ?
       RETURNING *;`,
      [input.title, input.summary, keyTopicsJson, nodeIdsJson, existing.id]
    );
    return rows[0];
  }

  const { rows } = await executeQuery(
    `INSERT INTO reading_list_history (id, url, title, summary, key_topics, node_ids)
     VALUES (?, ?, ?, ?, ?, ?)
     RETURNING *;`,
    [id, input.url, input.title, input.summary, keyTopicsJson, nodeIdsJson]
  );
  return rows[0];
}

export async function getAll(): Promise<any[]> {
  const { rows } = await executeQuery(
    'SELECT * FROM reading_list_history ORDER BY merged_at DESC;'
  );
  return rows;
}

export async function getByUrl(url: string): Promise<any | null> {
  const { rows } = await executeQuery(
    'SELECT * FROM reading_list_history WHERE url = ? LIMIT 1;',
    [url]
  );
  return rows[0] ?? null;
}

export async function getRecent(limit: number): Promise<any[]> {
  const { rows } = await executeQuery(
    'SELECT * FROM reading_list_history ORDER BY merged_at DESC LIMIT ?;',
    [limit]
  );
  return rows;
}
