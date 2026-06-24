import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import Database from 'better-sqlite3';
import { mkdirSync, readFileSync, existsSync, writeFileSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { randomUUID } from 'crypto';
import { VaultEventBus } from '../../electron/vault/event-bus';
import { EntityFileService } from '../../electron/entity-files/entity-file-service';
import type { DbNode, DbEdge } from '../../src/shared/types';

function createTestEnv() {
  const vaultPath = join(tmpdir(), `synapse-test-${randomUUID()}`);
  mkdirSync(join(vaultPath, '.synapse'), { recursive: true });
  mkdirSync(join(vaultPath, 'notes'), { recursive: true });

  const db = new Database(':memory:');
  db.exec(`
    CREATE TABLE nodes (
      id TEXT PRIMARY KEY, identifier TEXT, name TEXT NOT NULL,
      type TEXT NOT NULL DEFAULT 'entity', label TEXT, summary TEXT,
      properties TEXT NOT NULL DEFAULT '{}', x REAL, y REAL,
      color TEXT, size REAL DEFAULT 1.0, source_url TEXT,
      vault_path TEXT, file_mtime INTEGER, file_size INTEGER,
      content_hash TEXT, created_at TEXT, updated_at TEXT
    );
    CREATE TABLE edges (
      id TEXT PRIMARY KEY, source_id TEXT, target_id TEXT,
      label TEXT NOT NULL, type TEXT DEFAULT 'related',
      properties TEXT DEFAULT '{}', weight REAL DEFAULT 1.0,
      directed INTEGER DEFAULT 1, created_at TEXT, updated_at TEXT
    );
    CREATE TABLE entity_sources (
      entity_id TEXT, resource_id TEXT, relation_type TEXT,
      location TEXT, created_at TEXT
    );
  `);

  const eventBus = new VaultEventBus();
  const ctx = {
    path: vaultPath,
    synapsePath: join(vaultPath, '.synapse'),
    name: 'test-vault',
    id: 'vault_test123',
    db,
    config: { name: 'test-vault', id: 'vault_test123', schemaVersion: 1, createdAt: new Date().toISOString() },
    eventBus,
    sandboxConfig: {},
    resolve: (rel: string) => join(vaultPath, rel),
    relative: (abs: string) => abs.slice(vaultPath.length + 1),
  };

  return { vaultPath, db, eventBus, ctx, cleanup: () => rmSync(vaultPath, { recursive: true, force: true }) };
}

function makeNode(overrides: Partial<DbNode> = {}): DbNode {
  return {
    id: randomUUID(),
    identifier: null,
    name: 'Machine Learning',
    type: 'entity',
    label: 'concept',
    summary: 'A branch of AI focused on learning from data.',
    properties: '{}',
    x: null,
    y: null,
    color: null,
    size: 1.0,
    source_url: null,
    vault_path: null,
    file_mtime: null,
    file_size: null,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    ...overrides,
  };
}

function makeEdge(overrides: Partial<DbEdge> = {}): DbEdge {
  return {
    id: randomUUID(),
    source_id: '',
    target_id: '',
    label: 'related_to',
    type: 'related',
    properties: '{}',
    weight: 1.0,
    directed: 1,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    ...overrides,
  };
}

function insertNode(db: Database.Database, node: DbNode): void {
  db.prepare(`
    INSERT INTO nodes (id, identifier, name, type, label, summary, properties, x, y, color, size, source_url, vault_path, file_mtime, file_size, content_hash, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    node.id, node.identifier, node.name, node.type, node.label, node.summary,
    node.properties, node.x, node.y, node.color, node.size, node.source_url,
    node.vault_path, node.file_mtime, node.file_size, null,
    node.created_at, node.updated_at,
  );
}

function insertEdge(db: Database.Database, edge: DbEdge): void {
  db.prepare(`
    INSERT INTO edges (id, source_id, target_id, label, type, properties, weight, directed, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    edge.id, edge.source_id, edge.target_id, edge.label, edge.type,
    edge.properties, edge.weight, edge.directed, edge.created_at, edge.updated_at,
  );
}

describe('EntityFileService', () => {
  let env: ReturnType<typeof createTestEnv>;
  let service: EntityFileService;

  beforeEach(() => {
    env = createTestEnv();
    service = new EntityFileService(env.ctx as any);
    service.register(env.eventBus);
  });

  afterEach(() => {
    service.unregister();
    env.cleanup();
  });

  // ── node:created ────────────────────────────────────────────────────

  describe('node:created', () => {
    it('generates entity file with frontmatter and summary', async () => {
      const node = makeNode();
      insertNode(env.db, node);

      env.eventBus.emit({ type: 'node:created', node });

      // Wait for debounce
      await vi.waitFor(() => {
        const filePath = env.ctx.resolve('entities/machine_learning.md');
        expect(existsSync(filePath)).toBe(true);
      }, { timeout: 2000 });

      const filePath = env.ctx.resolve('entities/machine_learning.md');
      const content = readFileSync(filePath, 'utf-8');

      // Check frontmatter
      expect(content).toContain(`id: ${node.id}`);
      expect(content).toContain('title: Machine Learning');

      // Check heading
      expect(content).toContain('# Machine Learning');

      // Check summary
      expect(content).toContain('A branch of AI focused on learning from data.');

      // Check DB vault_path was set
      const row = env.db.prepare('SELECT vault_path FROM nodes WHERE id = ?').get(node.id) as any;
      expect(row.vault_path).toBe('entities/machine_learning.md');
    });

    it('ignores non-entity node types (note)', () => {
      const note = makeNode({ type: 'note', name: 'My Note' });
      insertNode(env.db, note);

      env.eventBus.emit({ type: 'node:created', node: note });

      // Should not create anything in entities/
      const filePath = env.ctx.resolve('entities/my_note.md');
      expect(existsSync(filePath)).toBe(false);
    });

    it('ignores non-entity node types (resource)', () => {
      const resource = makeNode({ type: 'resource', name: 'Some URL' });
      insertNode(env.db, resource);

      env.eventBus.emit({ type: 'node:created', node: resource });

      const filePath = env.ctx.resolve('entities/some_url.md');
      expect(existsSync(filePath)).toBe(false);
    });

    it('does NOT overwrite existing entity file body', async () => {
      const node = makeNode();
      insertNode(env.db, node);

      // Pre-create the file with custom content
      const entitiesDir = env.ctx.resolve('entities');
      mkdirSync(entitiesDir, { recursive: true });
      const filePath = env.ctx.resolve('entities/machine_learning.md');
      writeFileSync(filePath, '---\nid: existing\ntitle: Custom\n---\n\n# Custom Content\n\nUser wrote this.', 'utf-8');

      // Set vault_path in DB to match
      env.db.prepare('UPDATE nodes SET vault_path = ? WHERE id = ?').run('entities/machine_learning.md', node.id);

      env.eventBus.emit({ type: 'node:created', node });

      // Give debounce time to fire (if it were going to)
      await new Promise((r) => setTimeout(r, 700));

      // File should still have original content
      const content = readFileSync(filePath, 'utf-8');
      expect(content).toContain('User wrote this.');
      expect(content).not.toContain('A branch of AI focused on learning from data.');
    });
  });

  // ── node:updated (rename) ──────────────────────────────────────────

  describe('node:updated (rename)', () => {
    it('renames file on name change', async () => {
      const node = makeNode();
      insertNode(env.db, node);

      // First generate the file
      env.eventBus.emit({ type: 'node:created', node });

      await vi.waitFor(() => {
        expect(existsSync(env.ctx.resolve('entities/machine_learning.md'))).toBe(true);
      }, { timeout: 2000 });

      // Now rename
      const updatedNode = { ...node, name: 'Deep Learning' };
      env.db.prepare('UPDATE nodes SET name = ? WHERE id = ?').run('Deep Learning', node.id);

      env.eventBus.emit({ type: 'node:updated', node: updatedNode, changes: ['name'] });

      // Wait for rename
      await vi.waitFor(() => {
        expect(existsSync(env.ctx.resolve('entities/deep_learning.md'))).toBe(true);
      }, { timeout: 2000 });

      // Old file should be gone
      expect(existsSync(env.ctx.resolve('entities/machine_learning.md'))).toBe(false);

      // New file should have updated title in frontmatter
      const content = readFileSync(env.ctx.resolve('entities/deep_learning.md'), 'utf-8');
      expect(content).toContain('title: Deep Learning');

      // DB vault_path should be updated
      const row = env.db.prepare('SELECT vault_path FROM nodes WHERE id = ?').get(node.id) as any;
      expect(row.vault_path).toBe('entities/deep_learning.md');
    });

    it('ignores update without name change', async () => {
      const node = makeNode();
      insertNode(env.db, node);

      env.eventBus.emit({ type: 'node:created', node });

      await vi.waitFor(() => {
        expect(existsSync(env.ctx.resolve('entities/machine_learning.md'))).toBe(true);
      }, { timeout: 2000 });

      const updatedNode = { ...node, summary: 'New summary' };
      env.eventBus.emit({ type: 'node:updated', node: updatedNode, changes: ['summary'] });

      // File should still be in the old location
      await new Promise((r) => setTimeout(r, 200));
      expect(existsSync(env.ctx.resolve('entities/machine_learning.md'))).toBe(true);
    });
  });

  // ── node:deleted ───────────────────────────────────────────────────

  describe('node:deleted', () => {
    it('deletes entity file on node deletion', async () => {
      const node = makeNode();
      insertNode(env.db, node);

      env.eventBus.emit({ type: 'node:created', node });

      await vi.waitFor(() => {
        expect(existsSync(env.ctx.resolve('entities/machine_learning.md'))).toBe(true);
      }, { timeout: 2000 });

      // Get the vault_path before deleting the node row
      const vaultPath = (env.db.prepare('SELECT vault_path FROM nodes WHERE id = ?').get(node.id) as any)?.vault_path;

      // Delete the node from DB
      env.db.prepare('DELETE FROM nodes WHERE id = ?').run(node.id);

      env.eventBus.emit({ type: 'node:deleted', nodeId: node.id, filePath: vaultPath });

      // File should be removed
      await vi.waitFor(() => {
        expect(existsSync(env.ctx.resolve('entities/machine_learning.md'))).toBe(false);
      }, { timeout: 1000 });
    });
  });

  // ── edge:created ───────────────────────────────────────────────────

  describe('edge:created', () => {
    it('appends relationship line to entity file', async () => {
      const nodeA = makeNode({ name: 'Neural Networks' });
      const nodeB = makeNode({ name: 'Deep Learning' });
      insertNode(env.db, nodeA);
      insertNode(env.db, nodeB);

      // Generate files for both
      env.eventBus.emit({ type: 'node:created', node: nodeA });
      env.eventBus.emit({ type: 'node:created', node: nodeB });

      await vi.waitFor(() => {
        expect(existsSync(env.ctx.resolve('entities/neural_networks.md'))).toBe(true);
        expect(existsSync(env.ctx.resolve('entities/deep_learning.md'))).toBe(true);
      }, { timeout: 2000 });

      // Create edge
      const edge = makeEdge({
        source_id: nodeA.id,
        target_id: nodeB.id,
        label: 'enables',
      });
      insertEdge(env.db, edge);

      env.eventBus.emit({ type: 'edge:created', edge });

      await vi.waitFor(() => {
        const contentA = readFileSync(env.ctx.resolve('entities/neural_networks.md'), 'utf-8');
        expect(contentA).toContain('[[Deep Learning]]');
        expect(contentA).toContain('*enables*');
      }, { timeout: 2000 });

      // The target file should also get an incoming reference
      const contentB = readFileSync(env.ctx.resolve('entities/deep_learning.md'), 'utf-8');
      expect(contentB).toContain('[[Neural Networks]]');
    });
  });

  // ── edge:deleted ───────────────────────────────────────────────────

  describe('edge:deleted', () => {
    it('removes relationship line from entity file', async () => {
      const nodeA = makeNode({ name: 'Neural Networks' });
      const nodeB = makeNode({ name: 'Deep Learning' });
      insertNode(env.db, nodeA);
      insertNode(env.db, nodeB);

      // Generate files
      env.eventBus.emit({ type: 'node:created', node: nodeA });
      env.eventBus.emit({ type: 'node:created', node: nodeB });

      await vi.waitFor(() => {
        expect(existsSync(env.ctx.resolve('entities/neural_networks.md'))).toBe(true);
        expect(existsSync(env.ctx.resolve('entities/deep_learning.md'))).toBe(true);
      }, { timeout: 2000 });

      // Create edge and emit
      const edge = makeEdge({
        source_id: nodeA.id,
        target_id: nodeB.id,
        label: 'enables',
      });
      insertEdge(env.db, edge);
      env.eventBus.emit({ type: 'edge:created', edge });

      await vi.waitFor(() => {
        const contentA = readFileSync(env.ctx.resolve('entities/neural_networks.md'), 'utf-8');
        expect(contentA).toContain('[[Deep Learning]]');
      }, { timeout: 2000 });

      // Now delete the edge -- we need to query it before removing from DB
      // The service should handle this by looking up the edge before it's gone
      // Actually edge:deleted only has edgeId, so the service must snapshot edge data
      // before removal, or the caller must provide it. We'll keep the edge in DB
      // and let the service read it.
      env.eventBus.emit({ type: 'edge:deleted', edgeId: edge.id });

      await vi.waitFor(() => {
        const contentA = readFileSync(env.ctx.resolve('entities/neural_networks.md'), 'utf-8');
        expect(contentA).not.toContain('[[Deep Learning]]');
        expect(contentA).not.toContain('*enables*');
      }, { timeout: 2000 });
    });
  });

  // ── file:removed ───────────────────────────────────────────────────

  describe('file:removed', () => {
    it('silently clears vault_path when entity file is removed externally', async () => {
      const node = makeNode();
      insertNode(env.db, node);

      env.eventBus.emit({ type: 'node:created', node });

      await vi.waitFor(() => {
        expect(existsSync(env.ctx.resolve('entities/machine_learning.md'))).toBe(true);
      }, { timeout: 2000 });

      // Verify vault_path is set
      let row = env.db.prepare('SELECT vault_path FROM nodes WHERE id = ?').get(node.id) as any;
      expect(row.vault_path).toBe('entities/machine_learning.md');

      // Simulate external file removal
      env.eventBus.emit({ type: 'file:removed', relativePath: 'entities/machine_learning.md' });

      await new Promise((r) => setTimeout(r, 100));

      // vault_path should be cleared
      row = env.db.prepare('SELECT vault_path FROM nodes WHERE id = ?').get(node.id) as any;
      expect(row.vault_path).toBeNull();
    });
  });

  // ── file:added guard ───────────────────────────────────────────────

  describe('file:added', () => {
    it('routes to handleEntityFileChanged if node already has vault_path bound', async () => {
      const node = makeNode();
      insertNode(env.db, node);

      env.eventBus.emit({ type: 'node:created', node });

      await vi.waitFor(() => {
        expect(existsSync(env.ctx.resolve('entities/machine_learning.md'))).toBe(true);
      }, { timeout: 2000 });

      // Emit file:added for a path that's already bound -- should not create a new-file notification
      // This is a guard test: it should route to changed, not treat as new import
      env.eventBus.emit({ type: 'file:added', relativePath: 'entities/machine_learning.md' });

      // The file should still exist and vault_path should still be set
      await new Promise((r) => setTimeout(r, 200));
      const row = env.db.prepare('SELECT vault_path FROM nodes WHERE id = ?').get(node.id) as any;
      expect(row.vault_path).toBe('entities/machine_learning.md');
    });
  });

  // ── checkEntityFile ────────────────────────────────────────────────

  describe('checkEntityFile', () => {
    it('returns title_mismatch when frontmatter title differs from DB name', async () => {
      const node = makeNode({ name: 'Machine Learning' });
      insertNode(env.db, node);

      // Generate file so vault_path is set
      service.generateFileForNode(node);

      // Mutate the file's frontmatter title to differ from DB
      const filePath = env.ctx.resolve('entities/machine_learning.md');
      let content = readFileSync(filePath, 'utf-8');
      content = content.replace('title: Machine Learning', 'title: ML (renamed)');
      writeFileSync(filePath, content, 'utf-8');

      const notifications = service.checkEntityFile('entities/machine_learning.md');
      expect(notifications).toHaveLength(1);
      expect(notifications[0].type).toBe('title_mismatch');
      expect(notifications[0].detail).toMatchObject({
        kind: 'title_mismatch',
        dbName: 'Machine Learning',
        fileTitle: 'ML (renamed)',
      });
    });

    it('returns empty array when frontmatter title matches DB name', async () => {
      const node = makeNode({ name: 'Machine Learning' });
      insertNode(env.db, node);

      service.generateFileForNode(node);

      const notifications = service.checkEntityFile('entities/machine_learning.md');
      expect(notifications).toHaveLength(0);
    });

    it('returns new_file when frontmatter has no id', () => {
      // Create a file without frontmatter id
      const entitiesDir = env.ctx.resolve('entities');
      mkdirSync(entitiesDir, { recursive: true });
      const filePath = env.ctx.resolve('entities/orphan.md');
      writeFileSync(filePath, '---\ntitle: Orphan Entity\n---\n\n# Orphan Entity\n', 'utf-8');

      const notifications = service.checkEntityFile('entities/orphan.md');
      expect(notifications).toHaveLength(1);
      expect(notifications[0].type).toBe('new_file');
      expect(notifications[0].detail).toMatchObject({
        kind: 'new_file',
        parsedTitle: 'Orphan Entity',
      });
    });

    it('returns unknown_id when id in frontmatter does not match any node', () => {
      const entitiesDir = env.ctx.resolve('entities');
      mkdirSync(entitiesDir, { recursive: true });
      const filePath = env.ctx.resolve('entities/ghost.md');
      writeFileSync(filePath, '---\nid: does-not-exist-000\ntitle: Ghost\n---\n\n# Ghost\n', 'utf-8');

      const notifications = service.checkEntityFile('entities/ghost.md');
      expect(notifications).toHaveLength(1);
      expect(notifications[0].type).toBe('unknown_id');
      expect(notifications[0].detail).toMatchObject({
        kind: 'unknown_id',
        fileId: 'does-not-exist-000',
      });
    });
  });

  // ── collision handling ─────────────────────────────────────────────

  describe('collision handling', () => {
    it('appends counter suffix when file already exists', async () => {
      // Pre-create a file at the expected path
      const entitiesDir = env.ctx.resolve('entities');
      mkdirSync(entitiesDir, { recursive: true });
      writeFileSync(env.ctx.resolve('entities/machine_learning.md'), 'occupied', 'utf-8');

      const node = makeNode();
      insertNode(env.db, node);

      env.eventBus.emit({ type: 'node:created', node });

      await vi.waitFor(() => {
        // Should create machine_learning_2.md or similar
        const row = env.db.prepare('SELECT vault_path FROM nodes WHERE id = ?').get(node.id) as any;
        expect(row.vault_path).toBeTruthy();
        expect(row.vault_path).not.toBe('entities/machine_learning.md');
      }, { timeout: 2000 });

      // The collision file should exist
      const row = env.db.prepare('SELECT vault_path FROM nodes WHERE id = ?').get(node.id) as any;
      expect(existsSync(env.ctx.resolve(row.vault_path))).toBe(true);
    });
  });

  describe('writeEntityFile', () => {
    it('overwrites entity file content and updates DB metadata', async () => {
      const node = makeNode({ name: 'Test Entity' });
      insertNode(env.db, node);
      env.eventBus.emit({ type: 'node:created', node });

      // Verify file was generated
      const row = env.db.prepare('SELECT vault_path FROM nodes WHERE id = ?').get(node.id) as any;

      await vi.waitFor(() => {
        const r = env.db.prepare('SELECT vault_path FROM nodes WHERE id = ?').get(node.id) as any;
        expect(r.vault_path).toBeTruthy();
      }, { timeout: 2000 });

      const updatedRow = env.db.prepare('SELECT vault_path FROM nodes WHERE id = ?').get(node.id) as any;
      expect(updatedRow.vault_path).toBeTruthy();

      const newContent = '---\nid: ' + node.id + '\ntitle: Test Entity\n---\n\n# Test Entity\n\nRewritten content.\n';
      const result = service.writeEntityFile(node.id, newContent);

      expect(result.contentHash).toBeTruthy();
      const onDisk = readFileSync(join(env.vaultPath, updatedRow.vault_path), 'utf-8');
      expect(onDisk).toBe(newContent);

      // DB metadata updated
      const dbRow = env.db.prepare('SELECT file_mtime, file_size, content_hash FROM nodes WHERE id = ?').get(node.id) as any;
      expect(dbRow.file_mtime).toBeGreaterThan(0);
      expect(dbRow.file_size).toBe(Buffer.byteLength(newContent));
      expect(dbRow.content_hash).toBe(result.contentHash);
    });

    it('throws when node has no vault_path', () => {
      const node = makeNode({ name: 'No File' });
      insertNode(env.db, node);
      // Don't emit node:created — no file generated, vault_path is null

      expect(() => service.writeEntityFile(node.id, 'content')).toThrow('no vault_path');
    });

    it('rejects on hash mismatch when expectedHash provided', async () => {
      const node = makeNode({ name: 'Hash Check' });
      insertNode(env.db, node);
      env.eventBus.emit({ type: 'node:created', node });

      await vi.waitFor(() => {
        const r = env.db.prepare('SELECT vault_path FROM nodes WHERE id = ?').get(node.id) as any;
        expect(r.vault_path).toBeTruthy();
      }, { timeout: 2000 });

      expect(() => service.writeEntityFile(node.id, 'new content', 'wrong-hash')).toThrow('Hash mismatch');
    });
  });
});
