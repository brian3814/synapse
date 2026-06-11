import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Database from 'better-sqlite3';
import { randomUUID } from 'crypto';

function createTestDb(): Database.Database {
  const db = new Database(':memory:');
  db.pragma('journal_mode = WAL');
  db.exec(`
    CREATE TABLE nodes (
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
    CREATE UNIQUE INDEX idx_nodes_vault_path ON nodes(vault_path) WHERE vault_path IS NOT NULL;
  `);
  return db;
}

function insertNode(db: Database.Database, overrides: Partial<{
  id: string; name: string; type: string; vault_path: string;
}> = {}) {
  const id = overrides.id ?? randomUUID();
  db.prepare(`
    INSERT INTO nodes (id, identifier, name, type, properties, size, vault_path, created_at, updated_at)
    VALUES (?, ?, ?, ?, '{}', 1, ?, datetime('now'), datetime('now'))
  `).run(id, id, overrides.name ?? 'Test Node', overrides.type ?? 'note', overrides.vault_path ?? null);
  return id;
}

/**
 * Mirrors the `notes:resolveByVaultPath` IPC handler logic from electron/main.ts.
 * Given a vault-relative path, returns the node ID or null.
 */
function resolveByVaultPath(db: Database.Database, vaultRelPath: string): string | null {
  const row = db.prepare('SELECT id FROM nodes WHERE vault_path = ?')
    .get(vaultRelPath) as { id: string } | undefined;
  return row?.id ?? null;
}

/**
 * Mirrors the path extraction logic from TabLayout.tsx handleOpenFile.
 * Given a full file path and vault root, returns the vault-relative path.
 */
function extractVaultRelPath(filePath: string, vaultPath: string): string | null {
  const prefix = vaultPath + '/';
  if (!filePath.startsWith(prefix)) return null;
  return filePath.slice(prefix.length);
}

let db: Database.Database;

beforeEach(() => {
  db = createTestDb();
});

afterEach(() => {
  db.close();
});

describe('resolveByVaultPath', () => {
  it('resolves a note in notes/ directory to its node ID', () => {
    const nodeId = insertNode(db, {
      name: 'Machine Learning',
      type: 'note',
      vault_path: 'notes/Machine Learning.md',
    });

    const result = resolveByVaultPath(db, 'notes/Machine Learning.md');
    expect(result).toBe(nodeId);
  });

  it('resolves a note in a subdirectory under notes/', () => {
    const nodeId = insertNode(db, {
      name: 'Deep Learning',
      type: 'note',
      vault_path: 'notes/research/Deep Learning.md',
    });

    const result = resolveByVaultPath(db, 'notes/research/Deep Learning.md');
    expect(result).toBe(nodeId);
  });

  it('resolves resource files outside notes/', () => {
    const nodeId = insertNode(db, {
      name: 'paper',
      type: 'resource',
      vault_path: 'papers/paper.pdf',
    });

    const result = resolveByVaultPath(db, 'papers/paper.pdf');
    expect(result).toBe(nodeId);
  });

  it('returns null for untracked file paths', () => {
    insertNode(db, { name: 'Some Note', vault_path: 'notes/Some Note.md' });

    const result = resolveByVaultPath(db, 'notes/Nonexistent.md');
    expect(result).toBeNull();
  });

  it('returns null for empty database', () => {
    const result = resolveByVaultPath(db, 'notes/Anything.md');
    expect(result).toBeNull();
  });

  it('does not match nodes with null vault_path', () => {
    insertNode(db, { name: 'Entity Node', type: 'entity', vault_path: undefined });

    const result = resolveByVaultPath(db, 'notes/Entity Node.md');
    expect(result).toBeNull();
  });

  it('matches exact path only — no partial matches', () => {
    insertNode(db, { name: 'Note', vault_path: 'notes/Note.md' });

    expect(resolveByVaultPath(db, 'notes/Note.md.bak')).toBeNull();
    expect(resolveByVaultPath(db, 'notes/Note')).toBeNull();
    expect(resolveByVaultPath(db, 'Note.md')).toBeNull();
  });

  it('handles special characters in note names', () => {
    const nodeId = insertNode(db, {
      name: "Fermat's Last Theorem (1995)",
      vault_path: "notes/Fermat's Last Theorem (1995).md",
    });

    const result = resolveByVaultPath(db, "notes/Fermat's Last Theorem (1995).md");
    expect(result).toBe(nodeId);
  });
});

describe('extractVaultRelPath', () => {
  const vaultPath = '/Users/brian/Documents/MyVault';

  it('extracts vault-relative path from full file path', () => {
    const filePath = '/Users/brian/Documents/MyVault/notes/Machine Learning.md';
    expect(extractVaultRelPath(filePath, vaultPath)).toBe('notes/Machine Learning.md');
  });

  it('handles nested subdirectories', () => {
    const filePath = '/Users/brian/Documents/MyVault/notes/research/physics/Quantum.md';
    expect(extractVaultRelPath(filePath, vaultPath)).toBe('notes/research/physics/Quantum.md');
  });

  it('handles files at vault root', () => {
    const filePath = '/Users/brian/Documents/MyVault/README.md';
    expect(extractVaultRelPath(filePath, vaultPath)).toBe('README.md');
  });

  it('returns null when file is outside vault', () => {
    const filePath = '/Users/brian/Desktop/random.md';
    expect(extractVaultRelPath(filePath, vaultPath)).toBeNull();
  });

  it('returns null when vault path is a prefix but not a directory boundary', () => {
    const filePath = '/Users/brian/Documents/MyVault-backup/notes/Note.md';
    expect(extractVaultRelPath(filePath, vaultPath)).toBeNull();
  });
});

describe('end-to-end: full path → vault-relative → node ID', () => {
  const vaultPath = '/Users/brian/Documents/MyVault';

  it('resolves a full file path to the correct node ID', () => {
    const nodeId = insertNode(db, {
      name: 'Quantum Computing',
      type: 'note',
      vault_path: 'notes/Quantum Computing.md',
    });

    const filePath = '/Users/brian/Documents/MyVault/notes/Quantum Computing.md';
    const vaultRelPath = extractVaultRelPath(filePath, vaultPath);
    expect(vaultRelPath).not.toBeNull();

    const resolvedId = resolveByVaultPath(db, vaultRelPath!);
    expect(resolvedId).toBe(nodeId);
  });

  it('falls through gracefully for untracked markdown files', () => {
    const filePath = '/Users/brian/Documents/MyVault/README.md';
    const vaultRelPath = extractVaultRelPath(filePath, vaultPath);
    expect(vaultRelPath).toBe('README.md');

    const resolvedId = resolveByVaultPath(db, vaultRelPath!);
    expect(resolvedId).toBeNull();
  });
});
