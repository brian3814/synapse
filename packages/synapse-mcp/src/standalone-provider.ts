import Database from 'better-sqlite3';
import * as fs from 'fs';
import * as path from 'path';
import { EmbeddingService } from '../../../electron/embeddings/embedding-service';
import type { EmbeddingConfig } from '../../../src/embeddings/types';

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

  static initVault(vaultPath: string): void {
    const kgDir = path.join(vaultPath, '.kg');
    const notesDir = path.join(vaultPath, 'notes');
    const agentDir = path.join(kgDir, 'agent', 'artifacts');
    const embDir = path.join(kgDir, 'embeddings');

    fs.mkdirSync(kgDir, { recursive: true });
    fs.mkdirSync(notesDir, { recursive: true });
    fs.mkdirSync(agentDir, { recursive: true });
    fs.mkdirSync(embDir, { recursive: true });

    const configPath = path.join(kgDir, 'config.json');
    if (!fs.existsSync(configPath)) {
      fs.writeFileSync(configPath, JSON.stringify({
        name: path.basename(vaultPath),
        id: `vault_${crypto.randomUUID().slice(0, 12)}`,
        schemaVersion: 11,
        createdAt: new Date().toISOString(),
      }, null, 2));
    }

    const dbPath = path.join(kgDir, 'graph.db');
    const db = new Database(dbPath);
    db.pragma('journal_mode = WAL');
    db.pragma('foreign_keys = ON');

    db.exec(INIT_SCHEMA);

    for (const [table, col, colType] of EXTRA_COLUMNS) {
      try { db.exec(`ALTER TABLE ${table} ADD COLUMN ${col} ${colType}`); } catch { /* exists */ }
    }

    db.prepare('INSERT OR REPLACE INTO schema_version (version, description) VALUES (?, ?)').run(11, 'init');
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
        `INSERT INTO nodes (id, identifier, name, type, label, folder_path, properties, size, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, '', ?, 1, ?, ?)`
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
        `INSERT INTO nodes (id, identifier, name, type, label, folder_path, properties, size, vault_path, content_type, created_at, updated_at)
         VALUES (?, ?, ?, 'note', NULL, '', '{}', 1, ?, 'text/markdown', ?, ?)`
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

const EXTRA_COLUMNS: [string, string, string][] = [
  ['nodes', 'source_content', 'TEXT'],
  ['nodes', 'vault_path', 'TEXT'],
  ['nodes', 'content_type', 'TEXT'],
  ['nodes', 'file_mtime', 'INTEGER'],
  ['nodes', 'file_size', 'INTEGER'],
  ['entity_sources', 'location', 'TEXT'],
  ['edge_sources', 'location', 'TEXT'],
];

const INIT_SCHEMA = `
CREATE TABLE IF NOT EXISTS nodes (
    id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
    identifier TEXT UNIQUE, name TEXT NOT NULL, type TEXT NOT NULL DEFAULT 'entity',
    label TEXT, summary TEXT, folder_path TEXT NOT NULL DEFAULT '',
    properties TEXT NOT NULL DEFAULT '{}', x REAL, y REAL, z REAL,
    color TEXT, size REAL DEFAULT 1.0, source_url TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_nodes_type ON nodes(type);
CREATE INDEX IF NOT EXISTS idx_nodes_label ON nodes(label);
CREATE INDEX IF NOT EXISTS idx_nodes_name ON nodes(name);
CREATE INDEX IF NOT EXISTS idx_nodes_identifier ON nodes(identifier);
CREATE INDEX IF NOT EXISTS idx_nodes_folder_path ON nodes(folder_path) WHERE type = 'note';
CREATE UNIQUE INDEX IF NOT EXISTS idx_unique_note_name ON nodes(name) WHERE type = 'note';

CREATE TABLE IF NOT EXISTS edges (
    id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
    source_id TEXT NOT NULL REFERENCES nodes(id) ON DELETE CASCADE,
    target_id TEXT NOT NULL REFERENCES nodes(id) ON DELETE CASCADE,
    label TEXT NOT NULL, type TEXT NOT NULL DEFAULT 'related',
    properties TEXT NOT NULL DEFAULT '{}', weight REAL DEFAULT 1.0,
    directed INTEGER NOT NULL DEFAULT 1, source_url TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now')),
    UNIQUE(source_id, target_id, label)
);
CREATE INDEX IF NOT EXISTS idx_edges_source ON edges(source_id);
CREATE INDEX IF NOT EXISTS idx_edges_target ON edges(target_id);
CREATE INDEX IF NOT EXISTS idx_edges_label ON edges(label);

CREATE TABLE IF NOT EXISTS entity_aliases (
    id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
    node_id TEXT NOT NULL REFERENCES nodes(id) ON DELETE CASCADE,
    alias TEXT NOT NULL, alias_lower TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_aliases_lower ON entity_aliases(alias_lower);

CREATE TABLE IF NOT EXISTS extraction_log (
    id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
    source_url TEXT, source_text TEXT, provider TEXT NOT NULL, model TEXT NOT NULL,
    raw_output TEXT, nodes_added INTEGER DEFAULT 0, edges_added INTEGER DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS schema_version (
    version INTEGER PRIMARY KEY, applied_at TEXT NOT NULL DEFAULT (datetime('now')), description TEXT
);

CREATE TABLE IF NOT EXISTS ontology_node_types (
    type TEXT PRIMARY KEY, description TEXT, color TEXT,
    category TEXT NOT NULL DEFAULT 'entity_label', is_default INTEGER NOT NULL DEFAULT 0,
    parent_type TEXT REFERENCES ontology_node_types(type), properties_schema TEXT
);
INSERT OR IGNORE INTO ontology_node_types (type, description, color, category) VALUES
    ('resource', 'A webpage ingested into the knowledge graph', '#059669', 'structural'),
    ('entity', 'A domain object', '#7C3AED', 'structural'),
    ('note', 'A granular prose unit about entities', '#0EA5E9', 'structural');

CREATE TABLE IF NOT EXISTS ontology_edge_types (
    type TEXT PRIMARY KEY, description TEXT, category TEXT NOT NULL DEFAULT 'related',
    source_types TEXT, target_types TEXT, properties_schema TEXT
);
INSERT OR IGNORE INTO ontology_edge_types (type, description, category) VALUES
    ('subfield_of', 'Hierarchical subfield relationship', 'hierarchical'),
    ('part_of', 'Part-whole relationship', 'hierarchical'),
    ('instance_of', 'Instance of a class or category', 'hierarchical'),
    ('created_by', 'Attribution to creator', 'attribution'),
    ('affiliated_with', 'Organizational affiliation', 'attribution'),
    ('used_in', 'Usage in a system or context', 'semantic'),
    ('builds_on', 'Extends or builds upon', 'semantic'),
    ('enables', 'Enables or makes possible', 'semantic'),
    ('contradicts', 'Contradicts or disagrees with', 'contrast'),
    ('alternative_to', 'Alternative approach', 'contrast'),
    ('preceded_by', 'Temporal precedence', 'temporal'),
    ('about', 'Note is primarily about entity', 'semantic'),
    ('mention', 'Note references entity secondarily', 'semantic'),
    ('extracted_from', 'Provenance link to source resource', 'provenance'),
    ('references', 'Citation or link between notes', 'semantic'),
    ('related', 'Generic related-to relationship', 'related');

CREATE TABLE IF NOT EXISTS node_tags (
    node_id TEXT NOT NULL REFERENCES nodes(id) ON DELETE CASCADE,
    tag TEXT NOT NULL, PRIMARY KEY (node_id, tag)
);
CREATE INDEX IF NOT EXISTS idx_node_tags_tag ON node_tags(tag);

CREATE TABLE IF NOT EXISTS entity_sources (
    entity_id TEXT NOT NULL REFERENCES nodes(id) ON DELETE CASCADE,
    resource_id TEXT NOT NULL, relation_type TEXT NOT NULL DEFAULT 'about',
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    PRIMARY KEY (entity_id, resource_id, relation_type)
);
CREATE INDEX IF NOT EXISTS idx_entity_sources_resource ON entity_sources(resource_id);

CREATE TABLE IF NOT EXISTS edge_sources (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    edge_id TEXT NOT NULL REFERENCES edges(id) ON DELETE CASCADE,
    source_type TEXT NOT NULL CHECK(source_type IN ('note', 'extraction', 'user')),
    source_id TEXT, resource_id TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    UNIQUE(edge_id, source_type, source_id, resource_id)
);
CREATE INDEX IF NOT EXISTS idx_edge_sources_edge ON edge_sources(edge_id);
CREATE INDEX IF NOT EXISTS idx_edge_sources_note ON edge_sources(source_id);

CREATE TABLE IF NOT EXISTS note_folders (path TEXT PRIMARY KEY, created_at TEXT NOT NULL DEFAULT (datetime('now')));

CREATE TABLE IF NOT EXISTS note_attachments (
    id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
    note_id TEXT NOT NULL REFERENCES nodes(id) ON DELETE CASCADE,
    filename TEXT NOT NULL, mime_type TEXT NOT NULL, data BLOB, source_url TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_note_attachments_note ON note_attachments(note_id);

CREATE TABLE IF NOT EXISTS chat_sessions (
    id TEXT PRIMARY KEY, title TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    last_active_at TEXT NOT NULL DEFAULT (datetime('now')),
    status TEXT NOT NULL DEFAULT 'active'
);
CREATE TABLE IF NOT EXISTS chat_messages (
    id TEXT PRIMARY KEY, session_id TEXT NOT NULL REFERENCES chat_sessions(id) ON DELETE CASCADE,
    role TEXT NOT NULL, content TEXT NOT NULL, rag_context TEXT,
    status TEXT NOT NULL DEFAULT 'complete',
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_chat_messages_session ON chat_messages(session_id, created_at);

CREATE TABLE IF NOT EXISTS note_search (
    rowid INTEGER PRIMARY KEY AUTOINCREMENT, node_id TEXT UNIQUE NOT NULL,
    title TEXT NOT NULL, body TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_note_search_node_id ON note_search(node_id);

CREATE TABLE IF NOT EXISTS spatial_positions (
    node_id TEXT PRIMARY KEY REFERENCES nodes(id) ON DELETE CASCADE,
    x REAL NOT NULL DEFAULT 0, y REAL NOT NULL DEFAULT 0, layout TEXT NOT NULL DEFAULT 'force'
);

CREATE TABLE IF NOT EXISTS reading_list (
    id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))), url TEXT NOT NULL, title TEXT,
    status TEXT NOT NULL DEFAULT 'unread', created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS browsing_history (
    id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))), url TEXT NOT NULL, title TEXT,
    visited_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS memory_episodic (
    id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))), session_id TEXT,
    summary TEXT NOT NULL, created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS embedding_metadata (
    node_id TEXT PRIMARY KEY REFERENCES nodes(id) ON DELETE CASCADE,
    model TEXT NOT NULL, dimensions INTEGER NOT NULL, text_hash TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now')), updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS embedding_dismissals (
    node_id TEXT PRIMARY KEY REFERENCES nodes(id) ON DELETE CASCADE,
    reason TEXT, created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
`;
