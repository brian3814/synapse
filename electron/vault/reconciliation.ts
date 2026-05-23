import { readdirSync, statSync } from 'fs';
import { join } from 'path';
import type { VaultContext } from './vault-context';

const IGNORE_DIRS = new Set(['.kg', '.git', 'node_modules']);
const IGNORE_FILES = new Set(['.DS_Store', 'Thumbs.db', '.gitignore']);

interface ReconciliationResult {
  newFiles: number;
  modifiedFiles: number;
  orphanedNodes: number;
  totalScanned: number;
}

export function reconcileVault(ctx: VaultContext): ReconciliationResult {
  const result: ReconciliationResult = {
    newFiles: 0,
    modifiedFiles: 0,
    orphanedNodes: 0,
    totalScanned: 0,
  };

  // Walk the vault filesystem and collect all files
  const filesOnDisk = new Set<string>();
  walkDir(ctx.path, ctx.path, filesOnDisk);
  result.totalScanned = filesOnDisk.size;

  // Compare each file against DB
  for (const relativePath of filesOnDisk) {
    const row = ctx.db.prepare(
      'SELECT id, file_mtime, file_size FROM nodes WHERE vault_path = ?'
    ).get(relativePath) as { id: string; file_mtime: number | null; file_size: number | null } | undefined;

    const absolutePath = ctx.resolve(relativePath);
    let stat: ReturnType<typeof statSync>;
    try {
      stat = statSync(absolutePath);
    } catch {
      continue;
    }

    const currentMtime = Math.floor(stat.mtimeMs);
    const currentSize = stat.size;

    if (!row) {
      // NEW file — not in DB. Skip notes/ (managed by NoteFileHandler)
      if (relativePath.startsWith('notes/')) continue;

      ctx.eventBus.emit({ type: 'file:added', relativePath });
      result.newFiles++;
    } else if (row.file_mtime !== currentMtime || row.file_size !== currentSize) {
      // MODIFIED — mtime or size differs
      ctx.db.prepare(
        'UPDATE nodes SET file_mtime = ?, file_size = ?, updated_at = ? WHERE id = ?'
      ).run(currentMtime, currentSize, new Date().toISOString(), row.id);
      result.modifiedFiles++;
    }
    // else: UNCHANGED — skip
  }

  // Find orphaned nodes (have vault_path but file is missing)
  const nodesWithPaths = ctx.db.prepare(
    'SELECT id, vault_path FROM nodes WHERE vault_path IS NOT NULL'
  ).all() as { id: string; vault_path: string }[];

  for (const node of nodesWithPaths) {
    if (!filesOnDisk.has(node.vault_path)) {
      // File is missing — null out file tracking metadata (mark orphaned)
      ctx.db.prepare(
        'UPDATE nodes SET file_mtime = NULL, file_size = NULL, updated_at = ? WHERE id = ?'
      ).run(new Date().toISOString(), node.id);
      result.orphanedNodes++;
    }
  }

  console.log(
    `[Reconciliation] Scanned ${result.totalScanned} files: ` +
    `${result.newFiles} new, ${result.modifiedFiles} modified, ${result.orphanedNodes} orphaned`
  );

  return result;
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
