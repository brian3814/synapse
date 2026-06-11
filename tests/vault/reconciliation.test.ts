import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Database from 'better-sqlite3';
import { mkdirSync, writeFileSync, renameSync, rmSync, statSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { randomUUID } from 'crypto';
import { VaultEventBus, type VaultEvent } from '../../electron/vault/event-bus';
import { reconcileVault } from '../../electron/vault/reconciliation';
import { ResourceDetectionHandler } from '../../electron/vault/handlers/resource-detection-handler';
import { NoteFileHandler } from '../../electron/vault/handlers/note-file-handler';
import { computeFileHash } from '../../electron/vault/content-hash';
import type { VaultContext } from '../../electron/vault/vault-context';

// ── Test helpers ────────────────────────────────────────────────────────

function createTestVault(): { vaultPath: string; db: Database.Database; ctx: VaultContext; events: VaultEvent[] } {
  const vaultPath = join(tmpdir(), `synapse-test-${randomUUID()}`);
  mkdirSync(join(vaultPath, '.kg'), { recursive: true });
  mkdirSync(join(vaultPath, 'notes'), { recursive: true });

  writeFileSync(join(vaultPath, '.kg', 'config.json'), JSON.stringify({
    name: 'Test Vault',
    id: `vault_test_${randomUUID().slice(0, 8)}`,
    schemaVersion: 1,
    createdAt: new Date().toISOString(),
  }));

  const db = new Database(':memory:');
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');

  db.exec(`
    CREATE TABLE IF NOT EXISTS nodes (
      id TEXT PRIMARY KEY,
      identifier TEXT UNIQUE,
      name TEXT NOT NULL,
      type TEXT NOT NULL DEFAULT 'entity',
      label TEXT,
      summary TEXT,
      properties TEXT NOT NULL DEFAULT '{}',
      x REAL, y REAL,
      color TEXT,
      size REAL DEFAULT 1.0,
      source_url TEXT,
      vault_path TEXT,
      file_mtime INTEGER,
      file_size INTEGER,
      content_hash TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE UNIQUE INDEX IF NOT EXISTS idx_nodes_vault_path ON nodes(vault_path) WHERE vault_path IS NOT NULL;

    CREATE TABLE IF NOT EXISTS edges (
      id TEXT PRIMARY KEY,
      source_id TEXT NOT NULL REFERENCES nodes(id) ON DELETE CASCADE,
      target_id TEXT NOT NULL REFERENCES nodes(id) ON DELETE CASCADE,
      label TEXT NOT NULL,
      type TEXT NOT NULL DEFAULT 'related',
      properties TEXT NOT NULL DEFAULT '{}',
      weight REAL DEFAULT 1.0,
      directed INTEGER NOT NULL DEFAULT 1,
      source_url TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS note_search (
      rowid INTEGER PRIMARY KEY AUTOINCREMENT,
      node_id TEXT UNIQUE NOT NULL,
      title TEXT NOT NULL,
      body TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_note_search_node_id ON note_search(node_id);
  `);

  const eventBus = new VaultEventBus();
  const events: VaultEvent[] = [];

  // Collect all events for assertions
  for (const type of ['node:created', 'node:updated', 'node:deleted', 'file:added', 'file:changed', 'file:removed'] as const) {
    eventBus.on(type, (event) => events.push(event));
  }

  const ctx: VaultContext = {
    path: vaultPath,
    kgPath: join(vaultPath, '.kg'),
    name: 'Test Vault',
    id: 'vault_test',
    db,
    config: { name: 'Test Vault', id: 'vault_test', schemaVersion: 1, createdAt: new Date().toISOString() },
    eventBus,
    sandboxConfig: { allowedDirs: [], blockedExtensions: [] },
    resolve: (rel: string) => join(vaultPath, rel),
    relative: (abs: string) => abs.slice(vaultPath.length + 1),
  };

  return { vaultPath, db, ctx, events };
}

function insertNode(db: Database.Database, overrides: Partial<{
  id: string; name: string; type: string; vault_path: string;
  file_mtime: number; file_size: number; content_hash: string;
}> = {}) {
  const id = overrides.id ?? randomUUID();
  const now = new Date().toISOString();
  db.prepare(`
    INSERT INTO nodes (id, identifier, name, type, properties, size, vault_path, file_mtime, file_size, content_hash, created_at, updated_at)
    VALUES (?, ?, ?, ?, '{}', 1, ?, ?, ?, ?, ?, ?)
  `).run(
    id, id,
    overrides.name ?? 'Test Node',
    overrides.type ?? 'resource',
    overrides.vault_path ?? null,
    overrides.file_mtime ?? null,
    overrides.file_size ?? null,
    overrides.content_hash ?? null,
    now, now,
  );
  return id;
}

function insertEdge(db: Database.Database, sourceId: string, targetId: string, label = 'references') {
  const id = randomUUID();
  db.prepare(`
    INSERT INTO edges (id, source_id, target_id, label, type, created_at, updated_at)
    VALUES (?, ?, ?, ?, 'reference', datetime('now'), datetime('now'))
  `).run(id, sourceId, targetId, label);
  return id;
}

function getNode(db: Database.Database, id: string) {
  return db.prepare('SELECT * FROM nodes WHERE id = ?').get(id) as Record<string, unknown> | undefined;
}

function getAllNodes(db: Database.Database) {
  return db.prepare('SELECT * FROM nodes').all() as Record<string, unknown>[];
}

// ── Tests ───────────────────────────────────────────────────────────────

let testState: ReturnType<typeof createTestVault>;

beforeEach(() => {
  testState = createTestVault();
});

afterEach(() => {
  testState.db.close();
  rmSync(testState.vaultPath, { recursive: true, force: true });
});

describe('reconcileVault', () => {

  describe('Phase 2 — new file detection', () => {
    it('detects new resource files on disk and emits file:added', () => {
      const { vaultPath, ctx, events } = testState;

      writeFileSync(join(vaultPath, 'paper.pdf'), 'pdf-content');

      const result = reconcileVault(ctx);

      expect(result.newFiles).toBe(1);
      expect(result.totalScanned).toBeGreaterThanOrEqual(1);
      const fileAddedEvents = events.filter(e => e.type === 'file:added');
      expect(fileAddedEvents).toHaveLength(1);
      expect((fileAddedEvents[0] as any).relativePath).toBe('paper.pdf');
    });

    it('detects new note files in notes/ and creates note nodes', () => {
      const { vaultPath, db, ctx } = testState;

      writeFileSync(join(vaultPath, 'notes', 'My Research.md'), '# My Research\n\nSome content here.');

      const result = reconcileVault(ctx);

      expect(result.newNotes).toBe(1);
      const nodes = getAllNodes(db);
      const noteNode = nodes.find(n => n.type === 'note');
      expect(noteNode).toBeDefined();
      expect(noteNode!.name).toBe('My Research');
      expect(noteNode!.vault_path).toBe('notes/My Research.md');
      expect(noteNode!.content_hash).toBeTruthy();
      expect(noteNode!.file_mtime).toBeTruthy();
      expect(noteNode!.file_size).toBeTruthy();
    });

    it('indexes new note content in note_search for FTS', () => {
      const { vaultPath, db, ctx } = testState;

      writeFileSync(join(vaultPath, 'notes', 'Test Note.md'), '# Test Note\n\nSearchable content about quantum physics.');

      reconcileVault(ctx);

      const searchEntry = db.prepare('SELECT * FROM note_search WHERE title = ?').get('Test Note') as any;
      expect(searchEntry).toBeDefined();
      expect(searchEntry.body).toContain('Searchable content about quantum physics');
    });

    it('handles note name collision by appending (imported)', () => {
      const { vaultPath, db, ctx } = testState;

      insertNode(db, { name: 'Existing Note', type: 'note', vault_path: 'notes/Existing Note.md' });
      writeFileSync(join(vaultPath, 'notes', 'Existing Note.md'), '# Existing Note\nOriginal');
      writeFileSync(join(vaultPath, 'notes', 'Duplicate.md'), '# Content');

      // Manually create a second note with the same name to test collision
      insertNode(db, { name: 'Duplicate', type: 'note', vault_path: 'notes/Duplicate.md' });

      // Now create a NEW file that would map to the same name
      writeFileSync(join(vaultPath, 'notes', 'New Entry.md'), '# New Entry\nContent');

      const result = reconcileVault(ctx);

      expect(result.newNotes).toBe(1);
      const allNotes = getAllNodes(db).filter(n => n.type === 'note');
      expect(allNotes.length).toBe(3);
    });
  });

  describe('Phase 3 — orphan detection', () => {
    it('orphans nodes whose files are missing from disk', () => {
      const { db, ctx } = testState;

      const nodeId = insertNode(db, {
        name: 'Deleted File',
        vault_path: 'papers/gone.pdf',
        file_mtime: 1000,
        file_size: 500,
        content_hash: 'abc123',
      });

      const result = reconcileVault(ctx);

      expect(result.orphanedNodes).toBe(1);
      const node = getNode(db, nodeId)!;
      expect(node.file_mtime).toBeNull();
      expect(node.file_size).toBeNull();
      expect(node.vault_path).toBe('papers/gone.pdf'); // vault_path preserved
    });

    it('preserves edges on orphaned nodes', () => {
      const { db, ctx } = testState;

      const nodeA = insertNode(db, { name: 'Node A', vault_path: 'a.txt', file_mtime: 1, file_size: 1 });
      const nodeB = insertNode(db, { name: 'Node B' });
      const edgeId = insertEdge(db, nodeA, nodeB);

      reconcileVault(ctx);

      const edge = db.prepare('SELECT * FROM edges WHERE id = ?').get(edgeId);
      expect(edge).toBeDefined();
    });
  });

  describe('Phase 4 — rename detection via content hash', () => {
    it('detects file rename by matching content hash', () => {
      const { vaultPath, db, ctx, events } = testState;

      const content = 'unique file content for rename test';

      // Write the file at the NEW path
      mkdirSync(join(vaultPath, 'archive'), { recursive: true });
      writeFileSync(join(vaultPath, 'archive', 'paper.pdf'), content);

      // Compute the real hash
      const realHash = computeFileHash(join(vaultPath, 'archive', 'paper.pdf'))!;

      // Insert old node pointing at OLD path (file doesn't exist there) with matching hash
      const nodeId = insertNode(db, {
        name: 'My Paper',
        vault_path: 'papers/paper.pdf',
        file_mtime: 1000,
        file_size: content.length,
        content_hash: realHash,
      });

      // Add an edge to verify it's preserved
      const otherNode = insertNode(db, { name: 'Related Concept' });
      const edgeId = insertEdge(db, nodeId, otherNode);

      const result = reconcileVault(ctx);

      expect(result.renamedFiles).toBe(1);
      expect(result.orphanedNodes).toBe(0);

      const node = getNode(db, nodeId)!;
      expect(node.vault_path).toBe('archive/paper.pdf');
      expect(node.file_mtime).toBeTruthy();
      expect(node.file_size).toBe(content.length);
      expect(node.name).toBe('My Paper'); // name unchanged

      // Edge preserved
      const edge = db.prepare('SELECT * FROM edges WHERE id = ?').get(edgeId);
      expect(edge).toBeDefined();

      // node:updated event emitted
      const updateEvents = events.filter(e => e.type === 'node:updated');
      expect(updateEvents.length).toBeGreaterThanOrEqual(1);
    });

    it('prefers same-directory match when multiple orphans share a hash', () => {
      const { vaultPath, db, ctx } = testState;

      const content = 'duplicate content across directories';
      mkdirSync(join(vaultPath, 'dirA'), { recursive: true });
      writeFileSync(join(vaultPath, 'dirA', 'moved.txt'), content);

      const realHash = computeFileHash(join(vaultPath, 'dirA', 'moved.txt'))!;

      // Two orphans with the same hash, one in dirA (same dir), one in dirB
      const nodeA = insertNode(db, {
        name: 'File A', vault_path: 'dirA/original.txt',
        file_mtime: 1, file_size: 1, content_hash: realHash,
      });
      const nodeB = insertNode(db, {
        name: 'File B', vault_path: 'dirB/original.txt',
        file_mtime: 1, file_size: 1, content_hash: realHash,
      });

      reconcileVault(ctx);

      // nodeA should match (same directory)
      const resultA = getNode(db, nodeA)!;
      expect(resultA.vault_path).toBe('dirA/moved.txt');
      expect(resultA.file_mtime).not.toBeNull();

      // nodeB should be orphaned (no matching file)
      const resultB = getNode(db, nodeB)!;
      expect(resultB.file_mtime).toBeNull();
    });

    it('falls back to orphan when hash does not match any new file', () => {
      const { vaultPath, db, ctx } = testState;

      writeFileSync(join(vaultPath, 'unrelated.txt'), 'completely different content');

      const nodeId = insertNode(db, {
        name: 'Old File', vault_path: 'missing.txt',
        file_mtime: 1, file_size: 1, content_hash: 'no-match-hash',
      });

      const result = reconcileVault(ctx);

      expect(result.orphanedNodes).toBe(1);
      expect(result.renamedFiles).toBe(0);
      const node = getNode(db, nodeId)!;
      expect(node.file_mtime).toBeNull();
    });

    it('does not attempt rename detection when orphan has no content_hash', () => {
      const { vaultPath, db, ctx } = testState;

      const content = 'some content';
      writeFileSync(join(vaultPath, 'new-file.txt'), content);

      // Orphan WITHOUT hash (pre-migration node)
      insertNode(db, {
        name: 'Old File', vault_path: 'old-file.txt',
        file_mtime: 1, file_size: 1, content_hash: undefined,
      });

      const result = reconcileVault(ctx);

      // Should orphan the node and create a new one, not rename
      expect(result.orphanedNodes).toBe(1);
      expect(result.renamedFiles).toBe(0);
      expect(result.newFiles).toBe(1);
    });
  });

  describe('Phase 6 — modified files', () => {
    it('emits file:changed for modified resource files', () => {
      const { vaultPath, db, ctx, events } = testState;

      const filePath = join(vaultPath, 'doc.txt');
      writeFileSync(filePath, 'updated content');

      insertNode(db, {
        name: 'Doc', vault_path: 'doc.txt',
        file_mtime: 999, // Different from actual mtime → "modified"
        file_size: 5,
        content_hash: 'old-hash',
      });

      const result = reconcileVault(ctx);

      expect(result.modifiedFiles).toBe(1);
      const changedEvents = events.filter(e => e.type === 'file:changed');
      expect(changedEvents).toHaveLength(1);
      expect((changedEvents[0] as any).relativePath).toBe('doc.txt');
    });

    it('updates content_hash for modified files', () => {
      const { vaultPath, db, ctx } = testState;

      const filePath = join(vaultPath, 'data.txt');
      writeFileSync(filePath, 'new content after modification');
      const expectedHash = computeFileHash(filePath);

      insertNode(db, {
        name: 'Data', vault_path: 'data.txt',
        file_mtime: 1, file_size: 1, content_hash: 'stale-hash',
      });

      reconcileVault(ctx);

      const nodes = getAllNodes(db);
      const node = nodes.find(n => n.vault_path === 'data.txt')!;
      expect(node.content_hash).toBe(expectedHash);
    });

    it('updates note_search FTS index for modified note files', () => {
      const { vaultPath, db, ctx } = testState;

      const notePath = join(vaultPath, 'notes', 'Research.md');
      writeFileSync(notePath, '# Research\n\nUpdated content about neural networks.');

      const nid = insertNode(db, {
        name: 'Research', type: 'note', vault_path: 'notes/Research.md',
        file_mtime: 1, file_size: 1,
      });

      // Old search index
      db.prepare('INSERT INTO note_search (node_id, title, body) VALUES (?, ?, ?)').run(nid, 'Research', 'old content');

      reconcileVault(ctx);

      const entry = db.prepare('SELECT body FROM note_search WHERE node_id = ?').get(nid) as any;
      expect(entry.body).toContain('neural networks');
    });
  });

  describe('Phase 6 — hash backfill', () => {
    it('backfills content_hash for nodes that have vault_path but no hash', () => {
      const { vaultPath, db, ctx } = testState;

      const filePath = join(vaultPath, 'legacy.txt');
      writeFileSync(filePath, 'legacy content');
      const stat = statSync(filePath);
      const expectedHash = computeFileHash(filePath);

      insertNode(db, {
        name: 'Legacy', vault_path: 'legacy.txt',
        file_mtime: Math.floor(stat.mtimeMs),
        file_size: stat.size,
        content_hash: undefined, // No hash — pre-migration
      });

      const result = reconcileVault(ctx);

      expect(result.hashesBackfilled).toBe(1);
      const nodes = getAllNodes(db);
      expect(nodes[0].content_hash).toBe(expectedHash);
    });

    it('skips backfill for orphaned nodes (null mtime)', () => {
      const { db, ctx } = testState;

      insertNode(db, {
        name: 'Orphan', vault_path: 'gone.txt',
        file_mtime: undefined, // Orphaned
        file_size: undefined,
        content_hash: undefined,
      });

      const result = reconcileVault(ctx);

      expect(result.hashesBackfilled).toBe(0);
    });
  });

  describe('unchanged files', () => {
    it('skips files with matching mtime and size', () => {
      const { vaultPath, db, ctx, events } = testState;

      const filePath = join(vaultPath, 'stable.txt');
      writeFileSync(filePath, 'stable content');
      const stat = statSync(filePath);

      insertNode(db, {
        name: 'Stable', vault_path: 'stable.txt',
        file_mtime: Math.floor(stat.mtimeMs),
        file_size: stat.size,
        content_hash: 'existing-hash',
      });

      const result = reconcileVault(ctx);

      expect(result.newFiles).toBe(0);
      expect(result.modifiedFiles).toBe(0);
      expect(result.orphanedNodes).toBe(0);
      expect(events.filter(e => e.type !== 'node:created')).toHaveLength(0);
    });
  });

  describe('ignored paths', () => {
    it('ignores .kg directory contents', () => {
      const { vaultPath, ctx } = testState;

      writeFileSync(join(vaultPath, '.kg', 'internal.db'), 'database');

      const result = reconcileVault(ctx);

      expect(result.newFiles).toBe(0);
    });

    it('ignores .DS_Store files', () => {
      const { vaultPath, ctx } = testState;

      writeFileSync(join(vaultPath, '.DS_Store'), '');

      const result = reconcileVault(ctx);

      expect(result.newFiles).toBe(0);
      expect(result.totalScanned).toBe(0);
    });
  });
});

describe('ResourceDetectionHandler', () => {
  it('stores content_hash when creating new resource nodes', () => {
    const { vaultPath, db, ctx } = testState;

    const handler = new ResourceDetectionHandler(ctx, () => ctx.sandboxConfig);
    handler.register(ctx.eventBus);

    writeFileSync(join(vaultPath, 'photo.png'), 'fake-png-data');
    const expectedHash = computeFileHash(join(vaultPath, 'photo.png'));

    ctx.eventBus.emit({ type: 'file:added', relativePath: 'photo.png' });

    const nodes = getAllNodes(db);
    expect(nodes).toHaveLength(1);
    expect(nodes[0].content_hash).toBe(expectedHash);
    expect(nodes[0].name).toBe('photo');
    expect(nodes[0].type).toBe('resource');

    handler.unregister();
  });

  it('emits file:changed when updating an existing file', () => {
    const { vaultPath, db, ctx, events } = testState;

    const handler = new ResourceDetectionHandler(ctx, () => ctx.sandboxConfig);
    handler.register(ctx.eventBus);

    writeFileSync(join(vaultPath, 'doc.txt'), 'updated');
    insertNode(db, { name: 'Doc', vault_path: 'doc.txt', file_mtime: 1, file_size: 1 });

    ctx.eventBus.emit({ type: 'file:added', relativePath: 'doc.txt' });

    const changedEvents = events.filter(e => e.type === 'file:changed');
    expect(changedEvents).toHaveLength(1);

    handler.unregister();
  });

  it('emits node:updated on file:changed for downstream handlers', () => {
    const { vaultPath, db, ctx, events } = testState;

    const handler = new ResourceDetectionHandler(ctx, () => ctx.sandboxConfig);
    handler.register(ctx.eventBus);

    writeFileSync(join(vaultPath, 'doc.txt'), 'content');
    insertNode(db, { name: 'Doc', vault_path: 'doc.txt', file_mtime: 1, file_size: 1 });

    ctx.eventBus.emit({ type: 'file:changed', relativePath: 'doc.txt' });

    const nodeUpdatedEvents = events.filter(e => e.type === 'node:updated');
    expect(nodeUpdatedEvents).toHaveLength(1);

    handler.unregister();
  });
});

describe('NoteFileHandler', () => {
  it('skips vault_path assignment when already set (idempotency guard)', () => {
    const { db, ctx } = testState;

    const handler = new NoteFileHandler(ctx);
    handler.register(ctx.eventBus);

    const nodeId = insertNode(db, {
      name: 'Imported Note', type: 'note',
      vault_path: 'notes/Imported Note.md',
    });

    const node = getNode(db, nodeId)!;
    ctx.eventBus.emit({ type: 'node:created', node: node as any });

    const result = getNode(db, nodeId)!;
    expect(result.vault_path).toBe('notes/Imported Note.md'); // Unchanged

    handler.unregister();
  });

  it('sets vault_path when not already set', () => {
    const { db, ctx } = testState;

    const handler = new NoteFileHandler(ctx);
    handler.register(ctx.eventBus);

    const nodeId = insertNode(db, {
      name: 'New Note', type: 'note',
      vault_path: undefined,
    });

    const node = getNode(db, nodeId)!;
    ctx.eventBus.emit({ type: 'node:created', node: node as any });

    const result = getNode(db, nodeId)!;
    expect(result.vault_path).toBe('notes/New Note.md');

    handler.unregister();
  });
});

describe('computeFileHash', () => {
  it('returns consistent SHA-256 hash for same content', () => {
    const { vaultPath } = testState;

    const fileA = join(vaultPath, 'a.txt');
    const fileB = join(vaultPath, 'b.txt');
    writeFileSync(fileA, 'identical content');
    writeFileSync(fileB, 'identical content');

    expect(computeFileHash(fileA)).toBe(computeFileHash(fileB));
  });

  it('returns different hash for different content', () => {
    const { vaultPath } = testState;

    const fileA = join(vaultPath, 'a.txt');
    const fileB = join(vaultPath, 'b.txt');
    writeFileSync(fileA, 'content A');
    writeFileSync(fileB, 'content B');

    expect(computeFileHash(fileA)).not.toBe(computeFileHash(fileB));
  });

  it('detects single-character differences (trailing space)', () => {
    const { vaultPath } = testState;

    const fileA = join(vaultPath, 'a.txt');
    const fileB = join(vaultPath, 'b.txt');
    writeFileSync(fileA, 'hello');
    writeFileSync(fileB, 'hello ');

    expect(computeFileHash(fileA)).not.toBe(computeFileHash(fileB));
  });

  it('returns null for non-existent file', () => {
    expect(computeFileHash('/nonexistent/path/file.txt')).toBeNull();
  });
});

describe('end-to-end scenarios', () => {
  it('full rename workflow: file with edges is moved, reopened, edges preserved', () => {
    const { vaultPath, db, ctx } = testState;

    // Initial state: file exists, node tracks it, has edges
    const filePath = join(vaultPath, 'research', 'paper.pdf');
    mkdirSync(join(vaultPath, 'research'), { recursive: true });
    writeFileSync(filePath, 'Important research paper content');
    const hash = computeFileHash(filePath)!;
    const stat = statSync(filePath);

    const paperId = insertNode(db, {
      name: 'Research Paper', vault_path: 'research/paper.pdf',
      file_mtime: Math.floor(stat.mtimeMs), file_size: stat.size,
      content_hash: hash,
    });
    const conceptId = insertNode(db, { name: 'Machine Learning' });
    const edgeId = insertEdge(db, paperId, conceptId, 'discusses');

    // Simulate offline rename: move file
    mkdirSync(join(vaultPath, 'archive'), { recursive: true });
    renameSync(filePath, join(vaultPath, 'archive', 'paper.pdf'));

    // Reconcile (as if app just started)
    const result = reconcileVault(ctx);

    expect(result.renamedFiles).toBe(1);
    expect(result.orphanedNodes).toBe(0);
    expect(result.newFiles).toBe(0);

    // Node identity preserved
    const paper = getNode(db, paperId)!;
    expect(paper.vault_path).toBe('archive/paper.pdf');
    expect(paper.name).toBe('Research Paper');

    // Edge preserved
    const edge = db.prepare('SELECT * FROM edges WHERE id = ?').get(edgeId) as any;
    expect(edge).toBeDefined();
    expect(edge.source_id).toBe(paperId);
  });

  it('full note creation workflow: .md dropped into notes/ while offline', () => {
    const { vaultPath, db, ctx, events } = testState;

    writeFileSync(
      join(vaultPath, 'notes', 'Meeting Notes.md'),
      '# Meeting Notes\n\nDiscussed project timeline and deliverables.\n\n## Action Items\n\n- Review PRs\n- Update docs'
    );

    const result = reconcileVault(ctx);

    expect(result.newNotes).toBe(1);

    // Node created
    const nodes = getAllNodes(db).filter(n => n.type === 'note');
    expect(nodes).toHaveLength(1);
    expect(nodes[0].name).toBe('Meeting Notes');
    expect(nodes[0].vault_path).toBe('notes/Meeting Notes.md');
    expect(nodes[0].content_hash).toBeTruthy();

    // FTS indexed
    const search = db.prepare('SELECT * FROM note_search WHERE node_id = ?').get(nodes[0].id) as any;
    expect(search).toBeDefined();
    expect(search.body).toContain('project timeline');
    expect(search.body).toContain('Action Items');

    // node:created event emitted
    const createEvents = events.filter(e => e.type === 'node:created');
    expect(createEvents).toHaveLength(1);
  });

  it('reconciliation + handler integration: ResourceDetectionHandler processes file:added from reconciliation', () => {
    const { vaultPath, db, ctx } = testState;

    const handler = new ResourceDetectionHandler(ctx, () => ctx.sandboxConfig);
    handler.register(ctx.eventBus);

    writeFileSync(join(vaultPath, 'presentation.pptx'), 'pptx-binary-data');

    reconcileVault(ctx);

    const nodes = getAllNodes(db);
    const resource = nodes.find(n => n.name === 'presentation');
    expect(resource).toBeDefined();
    expect(resource!.type).toBe('resource');
    expect(resource!.vault_path).toBe('presentation.pptx');
    expect(resource!.content_hash).toBeTruthy();

    handler.unregister();
  });
});
