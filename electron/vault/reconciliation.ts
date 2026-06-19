import { readdirSync, readFileSync, statSync } from 'fs';
import { join, extname, basename } from 'path';
import { randomUUID } from 'crypto';
import type { VaultContext } from './vault-context';
import { computeFileHash, stripMarkdownForSearch } from './content-hash';

const IGNORE_DIRS = new Set(['.synapse', '.git', 'node_modules']);
const IGNORE_FILES = new Set(['.DS_Store', 'Thumbs.db', '.gitignore']);

interface ReconciliationResult {
  totalScanned: number;
  newFiles: number;
  newNotes: number;
  modifiedFiles: number;
  orphanedNodes: number;
  renamedFiles: number;
  hashesBackfilled: number;
}

interface ClassifiedFile {
  relativePath: string;
  absolutePath: string;
  mtime: number;
  size: number;
}

interface OrphanNode {
  id: string;
  vault_path: string;
  content_hash: string | null;
}

export function reconcileVault(ctx: VaultContext): ReconciliationResult {
  const result: ReconciliationResult = {
    totalScanned: 0,
    newFiles: 0,
    newNotes: 0,
    modifiedFiles: 0,
    orphanedNodes: 0,
    renamedFiles: 0,
    hashesBackfilled: 0,
  };

  // ── Phase 1: Walk filesystem ──────────────────────────────────────────
  const filesOnDisk = new Set<string>();
  walkDir(ctx.path, ctx.path, filesOnDisk);
  result.totalScanned = filesOnDisk.size;

  // ── Phase 2: Classify each file against DB ────────────────────────────
  const newFiles: ClassifiedFile[] = [];
  const modifiedFiles: ClassifiedFile[] = [];

  for (const relativePath of filesOnDisk) {
    const row = ctx.db.prepare(
      'SELECT id, file_mtime, file_size FROM nodes WHERE vault_path = ?'
    ).get(relativePath) as { id: string; file_mtime: number | null; file_size: number | null } | undefined;

    const absolutePath = ctx.resolve(relativePath);
    let mtime: number;
    let size: number;
    try {
      const stat = statSync(absolutePath);
      mtime = Math.floor(Number(stat.mtimeMs));
      size = stat.size as number;
    } catch {
      continue;
    }

    if (!row) {
      newFiles.push({ relativePath, absolutePath, mtime, size });
    } else if (row.file_mtime !== mtime || row.file_size !== size) {
      modifiedFiles.push({ relativePath, absolutePath, mtime, size });
    }
  }

  // ── Phase 3: Find orphans ─────────────────────────────────────────────
  const allNodesWithPaths = ctx.db.prepare(
    'SELECT id, vault_path, content_hash FROM nodes WHERE vault_path IS NOT NULL'
  ).all() as OrphanNode[];

  const orphanedNodes: OrphanNode[] = [];
  for (const node of allNodesWithPaths) {
    if (!filesOnDisk.has(node.vault_path)) {
      orphanedNodes.push(node);
    }
  }

  // ── Phase 4: Rename detection ─────────────────────────────────────────
  if (orphanedNodes.length > 0 && newFiles.length > 0) {
    const orphansByHash = new Map<string, OrphanNode[]>();
    for (const orphan of orphanedNodes) {
      if (orphan.content_hash) {
        const list = orphansByHash.get(orphan.content_hash) ?? [];
        list.push(orphan);
        orphansByHash.set(orphan.content_hash, list);
      }
    }

    if (orphansByHash.size > 0) {
      const matchedNewIndices = new Set<number>();
      const matchedOrphanIds = new Set<string>();

      for (let i = 0; i < newFiles.length; i++) {
        const file = newFiles[i];
        const hash = computeFileHash(file.absolutePath);
        if (!hash) continue;

        const candidates = orphansByHash.get(hash);
        if (!candidates || candidates.length === 0) continue;

        // Prefer same-directory match
        const fileDir = file.relativePath.includes('/')
          ? file.relativePath.slice(0, file.relativePath.lastIndexOf('/'))
          : '';
        const match = candidates.find((c) => {
          if (matchedOrphanIds.has(c.id)) return false;
          const orphanDir = c.vault_path.includes('/')
            ? c.vault_path.slice(0, c.vault_path.lastIndexOf('/'))
            : '';
          return orphanDir === fileDir;
        }) ?? candidates.find((c) => !matchedOrphanIds.has(c.id));

        if (!match) continue;

        ctx.db.prepare(
          'UPDATE nodes SET vault_path = ?, file_mtime = ?, file_size = ?, content_hash = ?, updated_at = ? WHERE id = ?'
        ).run(file.relativePath, file.mtime, file.size, hash, new Date().toISOString(), match.id);

        const updatedNode = ctx.db.prepare('SELECT * FROM nodes WHERE id = ?').get(match.id);
        if (updatedNode) {
          ctx.eventBus.emit({ type: 'node:updated', node: updatedNode as any, changes: ['vault_path'] });
        }

        matchedNewIndices.add(i);
        matchedOrphanIds.add(match.id);
        result.renamedFiles++;
      }

      // Remove matched entries from both lists (iterate in reverse for newFiles)
      for (let i = newFiles.length - 1; i >= 0; i--) {
        if (matchedNewIndices.has(i)) newFiles.splice(i, 1);
      }
      for (let i = orphanedNodes.length - 1; i >= 0; i--) {
        if (matchedOrphanIds.has(orphanedNodes[i].id)) orphanedNodes.splice(i, 1);
      }
    }
  }

  // Mark remaining orphans
  for (const orphan of orphanedNodes) {
    ctx.db.prepare(
      'UPDATE nodes SET file_mtime = NULL, file_size = NULL, updated_at = ? WHERE id = ?'
    ).run(new Date().toISOString(), orphan.id);
    result.orphanedNodes++;
  }

  // ── Phase 5: Handle remaining new files ───────────────────────────────
  for (const file of newFiles) {
    if (file.relativePath.startsWith('notes/') && file.relativePath.endsWith('.md')) {
      createNoteFromFile(ctx, file);
      result.newNotes++;
    } else if (file.relativePath.startsWith('entities/') && file.relativePath.endsWith('.md')) {
      handleNewEntityFile(ctx, file);
      // Don't count as newFiles — entity handling is separate
    } else {
      ctx.eventBus.emit({ type: 'file:added', relativePath: file.relativePath });
      result.newFiles++;
    }
  }

  // ── Phase 6: Modified files + hash backfill ───────────────────────────
  for (const file of modifiedFiles) {
    const hash = computeFileHash(file.absolutePath);

    ctx.db.prepare(
      'UPDATE nodes SET file_mtime = ?, file_size = ?, content_hash = ?, updated_at = ? WHERE vault_path = ?'
    ).run(file.mtime, file.size, hash, new Date().toISOString(), file.relativePath);

    ctx.eventBus.emit({ type: 'file:changed', relativePath: file.relativePath });

    // For notes: update FTS search index
    if (file.relativePath.startsWith('notes/') && file.relativePath.endsWith('.md')) {
      updateNoteSearchIndex(ctx, file);
    }

    result.modifiedFiles++;
  }

  // Hash backfill for nodes that were tracked before migration 012
  const unhashed = ctx.db.prepare(
    'SELECT id, vault_path FROM nodes WHERE content_hash IS NULL AND vault_path IS NOT NULL AND file_mtime IS NOT NULL'
  ).all() as { id: string; vault_path: string }[];

  for (const node of unhashed) {
    const hash = computeFileHash(ctx.resolve(node.vault_path));
    if (hash) {
      ctx.db.prepare('UPDATE nodes SET content_hash = ? WHERE id = ?').run(hash, node.id);
      result.hashesBackfilled++;
    }
  }

  console.log(
    `[Reconciliation] Scanned ${result.totalScanned} files: ` +
    `${result.newFiles} new, ${result.newNotes} new notes, ${result.modifiedFiles} modified, ` +
    `${result.orphanedNodes} orphaned, ${result.renamedFiles} renamed, ${result.hashesBackfilled} hashes backfilled`
  );

  return result;
}

function createNoteFromFile(ctx: VaultContext, file: ClassifiedFile): void {
  const ext = extname(file.relativePath);
  const filename = basename(file.relativePath, ext);
  const id = randomUUID();
  const now = new Date().toISOString();
  const hash = computeFileHash(file.absolutePath);

  // Check for name collision with existing notes
  let name = filename;
  const existing = ctx.db.prepare(
    'SELECT id FROM nodes WHERE name = ? AND type = ?'
  ).get(name, 'note') as { id: string } | undefined;
  if (existing) {
    name = `${filename} (imported)`;
    let counter = 2;
    while (ctx.db.prepare('SELECT id FROM nodes WHERE name = ? AND type = ?').get(name, 'note')) {
      name = `${filename} (imported ${counter})`;
      counter++;
    }
  }

  ctx.db.prepare(`
    INSERT INTO nodes (id, identifier, name, type, label, summary, properties, x, y, color, size, source_url, vault_path, file_mtime, file_size, content_hash, created_at, updated_at)
    VALUES (?, ?, ?, 'note', NULL, NULL, '{}', NULL, NULL, NULL, 1, NULL, ?, ?, ?, ?, ?, ?)
  `).run(id, id, name, file.relativePath, file.mtime, file.size, hash, now, now);

  // Index for FTS
  try {
    const content = readFileSync(file.absolutePath, 'utf-8');
    const plainText = stripMarkdownForSearch(content);
    ctx.db.prepare(
      'INSERT INTO note_search (node_id, title, body) VALUES (?, ?, ?) ON CONFLICT(node_id) DO UPDATE SET title = excluded.title, body = excluded.body'
    ).run(id, name, plainText);
  } catch {
    // File read failed — FTS will be empty, content still on disk
  }

  const node = ctx.db.prepare('SELECT * FROM nodes WHERE id = ?').get(id);
  if (node) {
    ctx.eventBus.emit({ type: 'node:created', node: node as any });
  }
}

function updateNoteSearchIndex(ctx: VaultContext, file: ClassifiedFile): void {
  const row = ctx.db.prepare(
    'SELECT id, name FROM nodes WHERE vault_path = ?'
  ).get(file.relativePath) as { id: string; name: string } | undefined;

  if (!row) return;

  try {
    const content = readFileSync(file.absolutePath, 'utf-8');
    const plainText = stripMarkdownForSearch(content);
    ctx.db.prepare(
      'INSERT INTO note_search (node_id, title, body) VALUES (?, ?, ?) ON CONFLICT(node_id) DO UPDATE SET title = excluded.title, body = excluded.body'
    ).run(row.id, row.name, plainText);
  } catch {
    // File read failed
  }
}

function handleNewEntityFile(ctx: VaultContext, file: ClassifiedFile): void {
  // Reconciliation only handles ID-based re-binding.
  // All other entity file logic (title mismatches, unknown IDs, new files without frontmatter,
  // link drift) is owned by EntityFileService.reconcileEntityFiles() which runs after the
  // service is registered. Do NOT emit file:added here — handlers don't exist yet.
  const content = readFileSync(file.absolutePath, 'utf-8');
  const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (!match) return; // No frontmatter — EntityFileService handles after registration

  let fileId: string | null = null;
  for (const line of match[1].split('\n')) {
    const idx = line.indexOf(':');
    if (idx > 0 && line.slice(0, idx).trim() === 'id') {
      fileId = line.slice(idx + 1).trim();
      break;
    }
  }

  if (fileId) {
    const node = ctx.db.prepare('SELECT id FROM nodes WHERE id = ?').get(fileId) as { id: string } | undefined;
    if (node) {
      const hash = computeFileHash(file.absolutePath);
      ctx.db.prepare(
        'UPDATE nodes SET vault_path = ?, file_mtime = ?, file_size = ?, content_hash = ? WHERE id = ?'
      ).run(file.relativePath, file.mtime, file.size, hash, fileId);
    }
  }
}

function walkDir(rootPath: string, currentPath: string, files: Set<string>): void {
  let entries: import('fs').Dirent[];
  try {
    entries = readdirSync(currentPath, { withFileTypes: true }) as import('fs').Dirent[];
  } catch {
    return;
  }

  for (const entry of entries) {
    if (entry.name.startsWith('.') && IGNORE_DIRS.has(entry.name)) continue;
    if (IGNORE_DIRS.has(entry.name)) continue;

    const fullPath = join(currentPath, entry.name);

    if (entry.isDirectory()) {
      walkDir(rootPath, fullPath, files);
    } else if (entry.isFile()) {
      if (IGNORE_FILES.has(entry.name)) continue;
      const relativePath = fullPath.slice(rootPath.length + 1).split('/').join('/');
      files.add(relativePath);
    }
  }
}
