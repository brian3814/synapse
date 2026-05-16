import Database from 'better-sqlite3';
import * as path from 'path';

export interface StandaloneToolResult {
  result: string;
  isError?: boolean;
}

export class StandaloneGraphProvider {
  private db: Database.Database;

  constructor(vaultPath: string, readonly: boolean = true) {
    const dbPath = path.join(vaultPath, '.kg', 'graph.db');
    this.db = new Database(dbPath, { readonly });
  }

  searchNodes(query: string, limit = 10): StandaloneToolResult {
    try {
      const rows = this.db.prepare(
        `SELECT id, name, type, label FROM nodes WHERE name LIKE ? LIMIT ?`
      ).all(`%${query}%`, limit);
      return { result: JSON.stringify(rows) };
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      return { result: JSON.stringify({ error: msg }), isError: true };
    }
  }

  getNodeDetails(id: string): StandaloneToolResult {
    try {
      const node = this.db.prepare(`SELECT * FROM nodes WHERE id = ?`).get(id);
      if (!node) return { result: JSON.stringify({ error: 'Node not found' }), isError: true };
      const edges = this.db.prepare(
        `SELECT * FROM edges WHERE source_id = ? OR target_id = ?`
      ).all(id, id);
      return { result: JSON.stringify({ node, edges }) };
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      return { result: JSON.stringify({ error: msg }), isError: true };
    }
  }

  getNeighbors(nodeId: string, depth = 1): StandaloneToolResult {
    try {
      const visited = new Set<string>([nodeId]);
      let frontier = [nodeId];
      for (let d = 0; d < depth; d++) {
        const nextFrontier: string[] = [];
        for (const id of frontier) {
          const edges = this.db.prepare(
            `SELECT source_id, target_id FROM edges WHERE source_id = ? OR target_id = ?`
          ).all(id, id) as Array<{ source_id: string; target_id: string }>;
          for (const edge of edges) {
            const neighborId = edge.source_id === id ? edge.target_id : edge.source_id;
            if (!visited.has(neighborId)) {
              visited.add(neighborId);
              nextFrontier.push(neighborId);
            }
          }
        }
        frontier = nextFrontier;
      }
      visited.delete(nodeId);
      const neighborIds = [...visited];
      const placeholders = neighborIds.map(() => '?').join(',');
      const neighbors = placeholders
        ? this.db.prepare(`SELECT id, name, type, label FROM nodes WHERE id IN (${placeholders})`).all(...neighborIds)
        : [];
      return { result: JSON.stringify(neighbors) };
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      return { result: JSON.stringify({ error: msg }), isError: true };
    }
  }

  close(): void {
    this.db.close();
  }
}
