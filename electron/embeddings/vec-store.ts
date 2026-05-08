import Database from 'better-sqlite3';
import * as sqliteVec from 'sqlite-vec';

let vecLoaded = false;

export function loadVecExtension(db: Database.Database): boolean {
  if (vecLoaded) return true;
  try {
    db.loadExtension(sqliteVec.getLoadablePath());
    vecLoaded = true;
    return true;
  } catch (e) {
    console.error('[vec-store] Failed to load sqlite-vec:', e);
    return false;
  }
}

export function ensureVecTable(db: Database.Database, dimensions: number): void {
  db.exec(`
    CREATE VIRTUAL TABLE IF NOT EXISTS vec_nodes USING vec0(
      node_id TEXT PRIMARY KEY,
      embedding float[${dimensions}]
    )
  `);
  db.exec(`
    CREATE TABLE IF NOT EXISTS similar_pairs (
      node_id_a TEXT NOT NULL,
      node_id_b TEXT NOT NULL,
      similarity REAL NOT NULL,
      updated_at TEXT NOT NULL,
      PRIMARY KEY (node_id_a, node_id_b)
    )
  `);
}

export function dropVecTable(db: Database.Database): void {
  db.exec('DROP TABLE IF EXISTS vec_nodes');
  db.exec('DELETE FROM similar_pairs');
}

export function insertEmbedding(db: Database.Database, nodeId: string, embedding: Float32Array): void {
  const stmt = db.prepare('INSERT OR REPLACE INTO vec_nodes(node_id, embedding) VALUES (?, ?)');
  stmt.run(nodeId, Buffer.from(embedding.buffer));
}

export function deleteEmbedding(db: Database.Database, nodeId: string): void {
  db.prepare('DELETE FROM vec_nodes WHERE node_id = ?').run(nodeId);
}

export function knnSearch(
  db: Database.Database,
  queryVec: Float32Array,
  topK: number,
  excludeNodeId?: string,
): Array<{ nodeId: string; distance: number }> {
  // sqlite-vec requires k=? in the WHERE clause for KNN queries.
  // LIMIT ? is not reliably passed to the vec0 virtual table planner.
  // When excluding a node, fetch one extra and filter in JS.
  const fetchK = excludeNodeId ? topK + 1 : topK;
  const sql = `SELECT node_id, distance FROM vec_nodes WHERE embedding MATCH ? AND k = ? ORDER BY distance`;
  const rows = db.prepare(sql).all(Buffer.from(queryVec.buffer), fetchK) as Array<{ node_id: string; distance: number }>;

  let results = rows.map((r) => ({ nodeId: r.node_id, distance: r.distance }));
  if (excludeNodeId) {
    results = results.filter((r) => r.nodeId !== excludeNodeId).slice(0, topK);
  }
  return results;
}

export function upsertSimilarPair(
  db: Database.Database,
  nodeIdA: string,
  nodeIdB: string,
  similarity: number,
): void {
  const [a, b] = nodeIdA < nodeIdB ? [nodeIdA, nodeIdB] : [nodeIdB, nodeIdA];
  db.prepare(
    'INSERT OR REPLACE INTO similar_pairs(node_id_a, node_id_b, similarity, updated_at) VALUES (?, ?, ?, ?)'
  ).run(a, b, similarity, new Date().toISOString());
}

export function removeSimilarPairsFor(db: Database.Database, nodeId: string): void {
  db.prepare('DELETE FROM similar_pairs WHERE node_id_a = ? OR node_id_b = ?').run(nodeId, nodeId);
}

export function getSimilarPairs(
  db: Database.Database,
  threshold: number,
  limit: number,
): Array<{ nodeIdA: string; nodeIdB: string; similarity: number }> {
  const dismissed = db.prepare(
    'SELECT node_id_a, node_id_b FROM embedding_dismissals'
  ).all() as Array<{ node_id_a: string; node_id_b: string }>;
  const dismissedSet = new Set(dismissed.map((d) => `${d.node_id_a}:${d.node_id_b}`));

  const rows = db.prepare(
    'SELECT node_id_a, node_id_b, similarity FROM similar_pairs WHERE similarity >= ? ORDER BY similarity DESC LIMIT ?'
  ).all(threshold, limit * 2) as Array<{ node_id_a: string; node_id_b: string; similarity: number }>;

  const result: Array<{ nodeIdA: string; nodeIdB: string; similarity: number }> = [];
  for (const r of rows) {
    const key = `${r.node_id_a}:${r.node_id_b}`;
    if (!dismissedSet.has(key)) {
      result.push({ nodeIdA: r.node_id_a, nodeIdB: r.node_id_b, similarity: r.similarity });
      if (result.length >= limit) break;
    }
  }
  return result;
}

export function addDismissal(db: Database.Database, nodeIdA: string, nodeIdB: string): void {
  const [a, b] = nodeIdA < nodeIdB ? [nodeIdA, nodeIdB] : [nodeIdB, nodeIdA];
  db.prepare(
    'INSERT OR IGNORE INTO embedding_dismissals(node_id_a, node_id_b, dismissed_at) VALUES (?, ?, ?)'
  ).run(a, b, new Date().toISOString());
}
