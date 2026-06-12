import Database from 'better-sqlite3';
import * as fs from 'fs';
import * as path from 'path';
import { setEngine } from '../../../src/db/worker/query-executor';
import { runMigrations } from '../../../src/db/worker/migrations';
import { EmbeddingService } from '../../../electron/embeddings/embedding-service';
import type { EmbeddingConfig } from '../../../src/embeddings/types';
import { buildAdjacencyMap } from '../../../src/graph/algorithms/adjacency';
import {
  degreeCentrality,
  connectedComponents,
  labelPropagation,
  findConnectionSuggestions,
  findBridgeNodes,
  computeGraphHealth,
  bfsPathWithEdges,
} from '../../../src/graph/algorithms/graph-algorithms';
import type { GraphNode, GraphEdge } from '../../../src/shared/types';

export interface StandaloneToolResult {
  result: string;
  isError?: boolean;
}

export class StandaloneGraphProvider {
  private db: Database.Database;
  private vaultPath: string;

  constructor(vaultPath: string, readonly: boolean = true) {
    this.vaultPath = vaultPath;
    const dbPath = path.join(vaultPath, '.kg', 'graph.db');
    this.db = new Database(dbPath, { readonly });
  }

  private embeddingService: EmbeddingService | null = null;

  async initEmbeddings(config: Partial<EmbeddingConfig>): Promise<void> {
    // Set worker path for ONNX provider to find the bundled worker file
    if (!process.env.SYNAPSE_ONNX_WORKER_PATH) {
      process.env.SYNAPSE_ONNX_WORKER_PATH = path.join(
        path.dirname(new URL(import.meta.url).pathname), 'onnx-worker.cjs'
      );
    }
    try {
      this.embeddingService = new EmbeddingService(
        () => this.db,
        (nodeId: string) => {
          const node = this.db.prepare('SELECT vault_path FROM nodes WHERE id = ?')
            .get(nodeId) as { vault_path: string | null } | undefined;
          if (node?.vault_path) {
            const absPath = path.join(this.vaultPath, node.vault_path);
            if (fs.existsSync(absPath)) return fs.readFileSync(absPath, 'utf-8');
          }
          return null;
        },
      );
      await this.embeddingService.initialize(config);
      console.log(`[embeddings] Initialized for vault (provider: ${config.providerId})`);
    } catch (e) {
      console.warn(`[embeddings] Failed to initialize: ${e instanceof Error ? e.message : e}`);
      this.embeddingService = null;
    }
  }

  static async initVault(vaultPath: string): Promise<void> {
    const kgDir = path.join(vaultPath, '.kg');
    const notesDir = path.join(vaultPath, 'notes');
    const agentDir = path.join(kgDir, 'agent', 'artifacts');
    const embDir = path.join(kgDir, 'embeddings');

    fs.mkdirSync(kgDir, { recursive: true });
    fs.mkdirSync(notesDir, { recursive: true });
    fs.mkdirSync(agentDir, { recursive: true });
    fs.mkdirSync(embDir, { recursive: true });

    const dbPath = path.join(kgDir, 'graph.db');
    const db = new Database(dbPath);
    db.pragma('journal_mode = WAL');
    db.pragma('foreign_keys = ON');

    setEngine({
      async exec(sql: string, params?: unknown[]) {
        if (params && params.length > 0) {
          return db.prepare(sql).run(...(params as unknown[])).changes;
        }
        db.exec(sql);
        return 0;
      },
      async query<T = Record<string, unknown>>(sql: string, params?: unknown[]) {
        if (params && params.length > 0) {
          return db.prepare(sql).all(...(params as unknown[])) as T[];
        }
        return db.prepare(sql).all() as T[];
      },
      async checkModuleAvailable(moduleName: string) {
        try {
          return db.prepare('SELECT name FROM pragma_module_list WHERE name = ?')
            .all(moduleName).length > 0;
        } catch {
          return false;
        }
      },
    });

    // The migration runner logs via console.log; MCP stdio servers must keep
    // stdout protocol-clean, so route logs to stderr for the duration.
    const origLog = console.log;
    console.log = console.error;
    let version: number;
    try {
      version = await runMigrations();
    } finally {
      console.log = origLog;
    }

    const configPath = path.join(kgDir, 'config.json');
    if (!fs.existsSync(configPath)) {
      fs.writeFileSync(configPath, JSON.stringify({
        name: path.basename(vaultPath),
        id: `vault_${crypto.randomUUID().slice(0, 12)}`,
        schemaVersion: version,
        createdAt: new Date().toISOString(),
      }, null, 2));
    }
    // NOTE: the query-executor engine singleton stays bound to this (closed)
    // DB after init. The MCP runtime never uses that singleton (tools use
    // this.db directly) — rebind via setEngine before any future use.
    db.close();
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

  getGraphOverview(): StandaloneToolResult {
    try {
      const nodeCount = (this.db.prepare('SELECT COUNT(*) as c FROM nodes').get() as any).c;
      const edgeCount = (this.db.prepare('SELECT COUNT(*) as c FROM edges').get() as any).c;
      const types = this.db.prepare('SELECT type, COUNT(*) as count FROM nodes GROUP BY type').all();
      const recent = this.db.prepare('SELECT id, name, type FROM nodes ORDER BY updated_at DESC LIMIT 10').all();
      return { result: JSON.stringify({ nodeCount, edgeCount, types, recentNodes: recent }) };
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      return { result: JSON.stringify({ error: msg }), isError: true };
    }
  }

  getSubgraph(nodeId: string, depth = 1): StandaloneToolResult {
    try {
      const visited = new Set<string>([nodeId]);
      let frontier = [nodeId];
      for (let d = 0; d < depth; d++) {
        const nextFrontier: string[] = [];
        for (const id of frontier) {
          const edges = this.db.prepare(
            'SELECT source_id, target_id FROM edges WHERE source_id = ? OR target_id = ?'
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
      const allIds = [...visited];
      const placeholders = allIds.map(() => '?').join(',');
      const nodes = this.db.prepare(
        `SELECT id, name, type, label FROM nodes WHERE id IN (${placeholders})`
      ).all(...allIds);
      const edges = this.db.prepare(
        `SELECT id, source_id, target_id, label, type FROM edges WHERE source_id IN (${placeholders}) AND target_id IN (${placeholders})`
      ).all(...allIds, ...allIds);
      return { result: JSON.stringify({ seed: nodeId, depth, nodes, edges, nodeCount: nodes.length, edgeCount: edges.length }) };
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      return { result: JSON.stringify({ error: msg }), isError: true };
    }
  }

  getNodesByType(type: string, limit = 50): StandaloneToolResult {
    try {
      const rows = this.db.prepare(
        'SELECT id, name, type, label FROM nodes WHERE type = ? OR label = ? LIMIT ?'
      ).all(type, type, limit);
      return { result: JSON.stringify({ type, nodes: rows, count: rows.length }) };
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      return { result: JSON.stringify({ error: msg }), isError: true };
    }
  }

  readNote(nodeId: string, notesDir: string): StandaloneToolResult {
    try {
      const node = this.db.prepare('SELECT id, name, type, vault_path FROM nodes WHERE id = ?').get(nodeId) as any;
      if (!node) return { result: JSON.stringify({ error: 'Node not found' }), isError: true };
      if (node.type !== 'note') return { result: JSON.stringify({ error: 'Node is not a note' }), isError: true };

      const filePath = path.join(notesDir, node.vault_path || `${node.name}.md`);
      if (!fs.existsSync(filePath)) return { result: JSON.stringify({ error: 'Note file not found' }), isError: true };

      const content = fs.readFileSync(filePath, 'utf-8');
      return { result: JSON.stringify({ id: nodeId, title: node.name, content }) };
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      return { result: JSON.stringify({ error: msg }), isError: true };
    }
  }

  listNotes(limit = 50): StandaloneToolResult {
    try {
      const rows = this.db.prepare(
        "SELECT id, name FROM nodes WHERE type = 'note' ORDER BY updated_at DESC LIMIT ?"
      ).all(limit);
      const total = (this.db.prepare("SELECT COUNT(*) as c FROM nodes WHERE type = 'note'").get() as any).c;
      return { result: JSON.stringify({ notes: rows, total }) };
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      return { result: JSON.stringify({ error: msg }), isError: true };
    }
  }

  searchNotes(query: string, limit = 10): StandaloneToolResult {
    try {
      const rows = this.db.prepare(
        'SELECT node_id, title, snippet(notes_fts, 1, "<b>", "</b>", "...", 40) as snippet FROM notes_fts WHERE notes_fts MATCH ? LIMIT ?'
      ).all(query, limit);
      return { result: JSON.stringify(rows) };
    } catch (e: unknown) {
      // FTS might not be available — fallback to LIKE
      try {
        const rows = this.db.prepare(
          'SELECT node_id, title FROM note_search WHERE body LIKE ? LIMIT ?'
        ).all(`%${query}%`, limit);
        return { result: JSON.stringify(rows) };
      } catch {
        const msg = e instanceof Error ? e.message : String(e);
        return { result: JSON.stringify({ error: msg }), isError: true };
      }
    }
  }

  findSimilarEntities(name: string): StandaloneToolResult {
    try {
      const rows = this.db.prepare(
        'SELECT id, name, type, label FROM nodes WHERE name LIKE ? OR id IN (SELECT node_id FROM entity_aliases WHERE alias_lower LIKE ?)'
      ).all(`%${name}%`, `%${name.toLowerCase()}%`);
      return { result: JSON.stringify({ query: name, matches: rows }) };
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      return { result: JSON.stringify({ error: msg }), isError: true };
    }
  }

  // --- Write operations ---

  createNode(name: string, type: string, label?: string, properties?: Record<string, unknown>): StandaloneToolResult {
    try {
      const id = crypto.randomUUID();
      const now = new Date().toISOString();
      this.db.prepare(
        `INSERT INTO nodes (id, identifier, name, type, label, properties, size, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, 1, ?, ?)`
      ).run(id, null, name, type, label ?? null, JSON.stringify(properties ?? {}), now, now);
      return { result: JSON.stringify({ id, name, type }) };
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      return { result: JSON.stringify({ error: msg }), isError: true };
    }
  }

  updateNode(nodeId: string, updates: { name?: string; type?: string; label?: string; properties?: Record<string, unknown> }): StandaloneToolResult {
    try {
      const node = this.db.prepare('SELECT * FROM nodes WHERE id = ?').get(nodeId) as any;
      if (!node) return { result: JSON.stringify({ error: 'Node not found' }), isError: true };

      const sets: string[] = [];
      const params: unknown[] = [];
      if (updates.name !== undefined) { sets.push('name = ?'); params.push(updates.name); }
      if (updates.type !== undefined) { sets.push('type = ?'); params.push(updates.type); }
      if (updates.label !== undefined) { sets.push('label = ?'); params.push(updates.label); }
      if (updates.properties !== undefined) { sets.push('properties = ?'); params.push(JSON.stringify(updates.properties)); }
      sets.push('updated_at = ?'); params.push(new Date().toISOString());
      params.push(nodeId);

      this.db.prepare(`UPDATE nodes SET ${sets.join(', ')} WHERE id = ?`).run(...params);
      return { result: JSON.stringify({ id: nodeId, updated: true }) };
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      return { result: JSON.stringify({ error: msg }), isError: true };
    }
  }

  deleteNode(nodeId: string): StandaloneToolResult {
    try {
      const node = this.db.prepare('SELECT id, name FROM nodes WHERE id = ?').get(nodeId) as any;
      if (!node) return { result: JSON.stringify({ error: 'Node not found' }), isError: true };

      this.db.prepare('DELETE FROM edges WHERE source_id = ? OR target_id = ?').run(nodeId, nodeId);
      this.db.prepare('DELETE FROM nodes WHERE id = ?').run(nodeId);
      return { result: JSON.stringify({ deleted: true, id: nodeId, name: node.name }) };
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      return { result: JSON.stringify({ error: msg }), isError: true };
    }
  }

  createEdge(sourceId: string, targetId: string, label: string, type?: string): StandaloneToolResult {
    try {
      const id = crypto.randomUUID();
      const now = new Date().toISOString();
      this.db.prepare(
        `INSERT INTO edges (id, source_id, target_id, label, type, properties, weight, directed, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, '{}', 1, 1, ?, ?)`
      ).run(id, sourceId, targetId, label, type ?? 'related', now, now);
      return { result: JSON.stringify({ id, label, sourceId, targetId }) };
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      return { result: JSON.stringify({ error: msg }), isError: true };
    }
  }

  deleteEdge(edgeId: string): StandaloneToolResult {
    try {
      const edge = this.db.prepare('SELECT id, label FROM edges WHERE id = ?').get(edgeId) as any;
      if (!edge) return { result: JSON.stringify({ error: 'Edge not found' }), isError: true };
      this.db.prepare('DELETE FROM edges WHERE id = ?').run(edgeId);
      return { result: JSON.stringify({ deleted: true, id: edgeId, label: edge.label }) };
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      return { result: JSON.stringify({ error: msg }), isError: true };
    }
  }

  createNote(title: string, content: string, vaultPath: string): StandaloneToolResult {
    try {
      const id = crypto.randomUUID();
      const now = new Date().toISOString();
      const notePath = `notes/${title.replace(/[/\\:]/g, '_').trim()}.md`;

      this.db.prepare(
        `INSERT INTO nodes (id, identifier, name, type, label, properties, size, vault_path, created_at, updated_at)
         VALUES (?, ?, ?, 'note', NULL, '{}', 1, ?, ?, ?)`
      ).run(id, null, title, notePath, now, now);

      // Write markdown file
      const fullPath = path.join(vaultPath, notePath);
      const dir = path.dirname(fullPath);
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
      const markdown = `---\ntitle: "${title}"\n---\n\n${content}`;
      fs.writeFileSync(fullPath, markdown, 'utf-8');

      // Update note_search for FTS
      try {
        this.db.prepare('INSERT OR REPLACE INTO note_search (node_id, title, body) VALUES (?, ?, ?)').run(id, title, content);
      } catch { /* note_search table might not exist */ }

      return { result: JSON.stringify({ id, title, notePath, created: true }) };
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      return { result: JSON.stringify({ error: msg }), isError: true };
    }
  }

  mergeNodes(primaryId: string, secondaryId: string): StandaloneToolResult {
    try {
      const primary = this.db.prepare('SELECT id, name FROM nodes WHERE id = ?').get(primaryId) as any;
      const secondary = this.db.prepare('SELECT id, name FROM nodes WHERE id = ?').get(secondaryId) as any;
      if (!primary) return { result: JSON.stringify({ error: `Primary node ${primaryId} not found` }), isError: true };
      if (!secondary) return { result: JSON.stringify({ error: `Secondary node ${secondaryId} not found` }), isError: true };

      // Transfer edges
      const edges = this.db.prepare('SELECT * FROM edges WHERE source_id = ? OR target_id = ?').all(secondaryId, secondaryId) as any[];
      let transferred = 0;
      for (const edge of edges) {
        const newSource = edge.source_id === secondaryId ? primaryId : edge.source_id;
        const newTarget = edge.target_id === secondaryId ? primaryId : edge.target_id;
        if (newSource === newTarget) continue;
        try {
          const id = crypto.randomUUID();
          const now = new Date().toISOString();
          this.db.prepare(
            'INSERT INTO edges (id, source_id, target_id, label, type, properties, weight, directed, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
          ).run(id, newSource, newTarget, edge.label, edge.type, edge.properties, edge.weight, edge.directed, now, now);
          transferred++;
        } catch { /* duplicate edge */ }
      }

      // Add alias
      try {
        const aliasId = crypto.randomUUID();
        this.db.prepare('INSERT INTO entity_aliases (id, node_id, alias, alias_lower) VALUES (?, ?, ?, ?)').run(
          aliasId, primaryId, secondary.name, secondary.name.toLowerCase()
        );
      } catch { /* alias table might not exist */ }

      // Delete secondary
      this.db.prepare('DELETE FROM edges WHERE source_id = ? OR target_id = ?').run(secondaryId, secondaryId);
      this.db.prepare('DELETE FROM nodes WHERE id = ?').run(secondaryId);

      return {
        result: JSON.stringify({
          merged: true,
          kept: { id: primaryId, name: primary.name },
          deleted: { id: secondaryId, name: secondary.name },
          edgesTransferred: transferred,
        }),
      };
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      return { result: JSON.stringify({ error: msg }), isError: true };
    }
  }

  // ---- Intelligence tools ----

  getCentralityRanking(limit = 10, nodeType?: string): StandaloneToolResult {
    try {
      const dbNodes = this.db.prepare('SELECT id, name, type, label FROM nodes').all() as Array<{ id: string; name: string; type: string; label: string | null }>;
      const dbEdges = this.db.prepare('SELECT id, source_id, target_id, label, type FROM edges').all() as Array<{ id: string; source_id: string; target_id: string; label: string; type: string }>;
      const nodes = dbNodes.map(toGraphNode);
      const edges = dbEdges.map(toGraphEdge);
      const map = buildAdjacencyMap(edges);
      const centrality = degreeCentrality(map, nodes);

      let filtered = nodes;
      if (nodeType) {
        filtered = nodes.filter((n) => n.type === nodeType || n.label === nodeType);
      }

      const totalDegrees = filtered.reduce((sum, n) => sum + (map.get(n.id)?.length ?? 0), 0);
      const avgDegree = filtered.length > 0 ? totalDegrees / filtered.length : 0;

      const rankings = filtered
        .map((n) => ({
          nodeId: n.id,
          name: n.name,
          type: n.type,
          label: n.label,
          degree: map.get(n.id)?.length ?? 0,
          centrality: centrality.get(n.id) ?? 0,
        }))
        .sort((a, b) => b.centrality - a.centrality)
        .slice(0, limit);

      return {
        result: JSON.stringify({
          rankings,
          totalNodes: filtered.length,
          avgDegree: Math.round(avgDegree * 100) / 100,
        }),
      };
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      return { result: JSON.stringify({ error: msg }), isError: true };
    }
  }

  getOrphanNodes(limit = 50, nodeType?: string): StandaloneToolResult {
    try {
      const dbNodes = this.db.prepare(`
        SELECT n.id, n.name, n.type, n.label, n.created_at
        FROM nodes n
        WHERE NOT EXISTS (SELECT 1 FROM edges e WHERE e.source_id = n.id OR e.target_id = n.id)
      `).all() as Array<{ id: string; name: string; type: string; label: string | null; created_at: string }>;

      let filtered = dbNodes;
      if (nodeType) {
        filtered = dbNodes.filter((n) => n.type === nodeType || n.label === nodeType);
      }

      const totalNodes = (this.db.prepare('SELECT COUNT(*) as c FROM nodes').get() as any).c;
      const orphanCount = filtered.length;
      const sliced = filtered.slice(0, limit).map((n) => ({
        nodeId: n.id,
        name: n.name,
        type: n.type,
        label: n.label,
        createdAt: n.created_at,
      }));

      return {
        result: JSON.stringify({
          orphans: sliced,
          orphanCount,
          orphanRate: totalNodes > 0 ? Math.round((orphanCount / totalNodes) * 1000) / 1000 : 0,
          totalNodes,
        }),
      };
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      return { result: JSON.stringify({ error: msg }), isError: true };
    }
  }

  getClusters(minSize = 2, includeMembers = false): StandaloneToolResult {
    try {
      const dbNodes = this.db.prepare('SELECT id, name, type, label FROM nodes').all() as Array<{ id: string; name: string; type: string; label: string | null }>;
      const dbEdges = this.db.prepare('SELECT id, source_id, target_id, label, type FROM edges').all() as Array<{ id: string; source_id: string; target_id: string; label: string; type: string }>;
      const nodes = dbNodes.map(toGraphNode);
      const edges = dbEdges.map(toGraphEdge);
      const map = buildAdjacencyMap(edges);
      const clusters = labelPropagation(map, nodes);

      const nodeMap = new Map(nodes.map((n) => [n.id, n]));
      const filtered = clusters.filter((c) => c.size >= minSize);

      const singletonCount = nodes.length - clusters.reduce((sum, c) => sum + c.size, 0);
      const nodesInClusters = filtered.reduce((sum, c) => sum + c.size, 0);

      const result = filtered.map((c) => {
        const entry: Record<string, unknown> = {
          id: c.id,
          label: c.label,
          size: c.size,
        };
        if (includeMembers) {
          entry.members = c.nodeIds.map((id) => {
            const n = nodeMap.get(id);
            return { id, name: n?.name ?? id, type: n?.type ?? 'unknown' };
          });
        }
        return entry;
      });

      return {
        result: JSON.stringify({
          clusters: result,
          clusterCount: filtered.length,
          nodesInClusters,
          singletonCount: Math.max(singletonCount, 0),
        }),
      };
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      return { result: JSON.stringify({ error: msg }), isError: true };
    }
  }

  getBridgeNodes(limit = 10): StandaloneToolResult {
    try {
      const dbNodes = this.db.prepare('SELECT id, name, type, label FROM nodes').all() as Array<{ id: string; name: string; type: string; label: string | null }>;
      const dbEdges = this.db.prepare('SELECT id, source_id, target_id, label, type FROM edges').all() as Array<{ id: string; source_id: string; target_id: string; label: string; type: string }>;
      const nodes = dbNodes.map(toGraphNode);
      const edges = dbEdges.map(toGraphEdge);
      const map = buildAdjacencyMap(edges);
      const clusters = labelPropagation(map, nodes);
      const bridges = findBridgeNodes(map, nodes, clusters);

      const nodeMap = new Map(nodes.map((n) => [n.id, n]));

      const result = bridges.slice(0, limit).map((b) => {
        const n = nodeMap.get(b.nodeId);
        return {
          nodeId: b.nodeId,
          name: n?.name ?? b.nodeId,
          type: n?.type ?? 'unknown',
          label: n?.label,
          clustersConnected: b.clustersConnected,
          clusterCount: b.clustersConnected.length,
        };
      });

      return {
        result: JSON.stringify({ bridges: result }),
      };
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      return { result: JSON.stringify({ error: msg }), isError: true };
    }
  }

  getConnectionSuggestions(limit = 10, minShared = 2): StandaloneToolResult {
    try {
      const dbNodes = this.db.prepare('SELECT id, name, type, label FROM nodes').all() as Array<{ id: string; name: string; type: string; label: string | null }>;
      const dbEdges = this.db.prepare('SELECT id, source_id, target_id, label, type FROM edges').all() as Array<{ id: string; source_id: string; target_id: string; label: string; type: string }>;
      const nodes = dbNodes.map(toGraphNode);
      const edges = dbEdges.map(toGraphEdge);
      const map = buildAdjacencyMap(edges);
      const suggestions = findConnectionSuggestions(map, nodes, minShared, limit);

      const nodeMap = new Map(nodes.map((n) => [n.id, n]));

      const result = suggestions.map((s) => ({
        nodeA: { id: s.nodeA, name: nodeMap.get(s.nodeA)?.name ?? s.nodeA },
        nodeB: { id: s.nodeB, name: nodeMap.get(s.nodeB)?.name ?? s.nodeB },
        sharedNeighborCount: s.sharedNeighbors.length,
        score: s.score,
      }));

      return {
        result: JSON.stringify({ suggestions: result }),
      };
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      return { result: JSON.stringify({ error: msg }), isError: true };
    }
  }

  getGraphHealth(): StandaloneToolResult {
    try {
      const dbNodes = this.db.prepare('SELECT id, name, type, label FROM nodes').all() as Array<{ id: string; name: string; type: string; label: string | null }>;
      const dbEdges = this.db.prepare('SELECT id, source_id, target_id, label, type FROM edges').all() as Array<{ id: string; source_id: string; target_id: string; label: string; type: string }>;
      const nodes = dbNodes.map(toGraphNode);
      const edges = dbEdges.map(toGraphEdge);
      const map = buildAdjacencyMap(edges);
      const clusters = labelPropagation(map, nodes);
      const components = connectedComponents(map, nodes);
      const health = computeGraphHealth(nodes, edges, map, clusters, components);

      return {
        result: JSON.stringify({
          ...health,
          orphanRate: Math.round(health.orphanRate * 1000) / 1000,
          density: Math.round(health.density * 10000) / 10000,
          avgDegree: Math.round(health.avgDegree * 100) / 100,
          largestComponentRatio: Math.round(health.largestComponentRatio * 1000) / 1000,
        }),
      };
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      return { result: JSON.stringify({ error: msg }), isError: true };
    }
  }

  findShortestPath(sourceId: string, targetId: string, maxHops = 6): StandaloneToolResult {
    try {
      const dbNodes = this.db.prepare('SELECT id, name, type, label FROM nodes').all() as Array<{ id: string; name: string; type: string; label: string | null }>;
      const dbEdges = this.db.prepare('SELECT id, source_id, target_id, label, type FROM edges').all() as Array<{ id: string; source_id: string; target_id: string; label: string; type: string }>;
      const nodes = dbNodes.map(toGraphNode);
      const edges = dbEdges.map(toGraphEdge);
      const map = buildAdjacencyMap(edges);
      const pathResult = bfsPathWithEdges(map, sourceId, targetId, maxHops);

      if (!pathResult) {
        return {
          result: JSON.stringify({ found: false, pathLength: 0, nodes: [], edges: [] }),
        };
      }

      const nodeMap = new Map(nodes.map((n) => [n.id, n]));
      const edgeMap = new Map(edges.map((e) => [e.id, e]));

      const pathNodes = pathResult.nodeIds.map((id) => {
        const n = nodeMap.get(id);
        return { id, name: n?.name ?? id, type: n?.type ?? 'unknown' };
      });

      const pathEdges = pathResult.edgeIds.map((id) => {
        const e = edgeMap.get(id);
        return {
          id,
          label: e?.label ?? '',
          sourceId: e?.sourceId ?? '',
          targetId: e?.targetId ?? '',
        };
      });

      return {
        result: JSON.stringify({
          found: true,
          pathLength: pathResult.nodeIds.length - 1,
          nodes: pathNodes,
          edges: pathEdges,
        }),
      };
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      return { result: JSON.stringify({ error: msg }), isError: true };
    }
  }

  async semanticSearch(query: string, limit = 5): Promise<StandaloneToolResult> {
    if (!this.embeddingService?.isEnabled()) {
      return {
        result: JSON.stringify({
          message: 'Embeddings not available. Ensure embeddings are enabled in the Synapse desktop app '
            + 'and the model is cached (ONNX) or OPENAI_API_KEY is set.',
        }),
      };
    }

    try {
      const results = await this.embeddingService.searchSimilar(query, limit);
      if (results.length === 0) {
        return { result: JSON.stringify({ message: 'No semantic matches found.' }) };
      }

      const nodeDetails = [];
      for (const r of results) {
        const node = this.db.prepare(
          'SELECT id, name, type, label FROM nodes WHERE id = ?'
        ).get(r.nodeId) as { id: string; name: string; type: string; label: string | null } | undefined;
        if (node) {
          nodeDetails.push({ ...node, similarity: r.score.toFixed(3) });
        }
      }
      return { result: JSON.stringify(nodeDetails) };
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      return { result: JSON.stringify({ error: msg }), isError: true };
    }
  }

  close(): void {
    this.embeddingService?.dispose().catch(() => {});
    this.db.close();
  }
}

function toGraphNode(row: { id: string; name: string; type: string; label: string | null }): GraphNode {
  return { id: row.id, identifier: null, name: row.name, type: row.type, label: row.label, properties: {}, size: 1, createdAt: '', updatedAt: '' };
}

function toGraphEdge(row: { id: string; source_id: string; target_id: string; label: string; type: string }): GraphEdge {
  return { id: row.id, sourceId: row.source_id, targetId: row.target_id, label: row.label, type: row.type, properties: {}, weight: 1, directed: false, createdAt: '', updatedAt: '' };
}
