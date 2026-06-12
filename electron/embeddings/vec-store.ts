import Database from 'better-sqlite3';
import * as sqliteVec from 'sqlite-vec';

export function loadVecExtension(db: Database.Database): boolean {
  try {
    db.loadExtension(sqliteVec.getLoadablePath());
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
}

export function dropVecTable(db: Database.Database): void {
  db.exec('DROP TABLE IF EXISTS vec_nodes');
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
