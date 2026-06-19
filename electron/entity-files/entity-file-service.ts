import {
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
  renameSync,
  unlinkSync,
  statSync,
} from 'fs';
import { dirname } from 'path';
import type { VaultContext } from '../vault/vault-context';
import type { VaultEventBus } from '../vault/event-bus';
import type { DbNode, DbEdge } from '../../src/shared/types';
import type { SyncNotification } from '../../src/shared/entity-sync-types';
import { deriveEntityPath } from './entity-slug';
import {
  generateEntityMarkdown,
  rewriteTitle,
} from './entity-markdown';
import type { EntityEdgeInfo, EntitySourceInfo } from './entity-markdown';
import { computeFileHash } from '../vault/content-hash';
import { SyncIssueStore } from './sync-issue-store';

// ── Constants ──────────────────────────────────────────────────────────

const DEBOUNCE_MS = 500;
const ENTITIES_DIR = 'entities';

// ── Service ────────────────────────────────────────────────────────────

export class EntityFileService {
  private ctx: VaultContext;
  private unsubscribers: (() => void)[] = [];
  private debounceTimers = new Map<string, ReturnType<typeof setTimeout>>();
  private markAsAppWritten?: (relativePath: string) => void;
  readonly syncIssueStore: SyncIssueStore;

  constructor(ctx: VaultContext) {
    this.ctx = ctx;
    this.syncIssueStore = new SyncIssueStore(ctx.synapsePath);
  }

  // ── Public API ─────────────────────────────────────────────────────

  setFileWatcher(markFn: (relativePath: string) => void): void {
    this.markAsAppWritten = markFn;
  }

  register(eventBus: VaultEventBus): void {
    this.ensureDirectory();

    this.unsubscribers.push(
      eventBus.on('node:created', (event) => {
        if (event.node.type !== 'entity') return;
        this.debouncedGenerate(event.node);
      }),

      eventBus.on('node:updated', (event) => {
        if (event.node.type !== 'entity') return;
        if (event.changes.includes('name')) {
          this.handleEntityRenamed(event.node);
        }
      }),

      eventBus.on('node:deleted', (event) => {
        this.handleEntityDeleted(event.nodeId, event.filePath);
      }),

      eventBus.on('edge:created', (event) => {
        this.handleEdgeChanged(event.edge);
      }),

      eventBus.on('edge:deleted', (event) => {
        this.handleEdgeDeletedWithData(event.edgeId);
      }),

      eventBus.on('file:added', (event) => {
        if (!this.isEntityFilePath(event.relativePath)) return;
        this.handleEntityFileAdded(event.relativePath);
      }),

      eventBus.on('file:changed', (event) => {
        if (!this.isEntityFilePath(event.relativePath)) return;
        this.handleEntityFileChanged(event.relativePath);
      }),

      eventBus.on('file:removed', (event) => {
        if (!this.isEntityFilePath(event.relativePath)) return;
        this.handleEntityFileRemoved(event.relativePath);
      }),
    );
  }

  unregister(): void {
    for (const unsub of this.unsubscribers) unsub();
    this.unsubscribers = [];

    // Flush all pending debounce timers
    for (const timer of this.debounceTimers.values()) {
      clearTimeout(timer);
    }
    this.debounceTimers.clear();
  }

  ensureDirectory(): void {
    const dir = this.ctx.resolve(ENTITIES_DIR);
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
    }
  }

  // ── IPC-facing methods ─────────────────────────────────────────────

  generateAll(): { generated: number } {
    const rows = this.ctx.db.prepare(
      "SELECT id, identifier, name, type, label, summary, properties, x, y, color, size, source_url, vault_path, file_mtime, file_size, created_at, updated_at FROM nodes WHERE type = 'entity' AND vault_path IS NULL"
    ).all() as DbNode[];

    let generated = 0;
    for (const node of rows) {
      this.generateFileForNode(node);
      generated++;
    }
    return { generated };
  }

  listSyncIssues(): SyncNotification[] {
    return this.syncIssueStore.listIssues();
  }

  dismissSyncIssue(notificationId: string): void {
    this.syncIssueStore.dismissIssue(notificationId);
  }

  resolveNotification(notificationId: string, action: string): void {
    // Stub — full resolution logic implemented in Task 13
    console.log(`[EntityFileService] resolveNotification: id=${notificationId} action=${action}`);
  }

  readEntityFile(nodeId: string): { path: string; content: string; contentHash: string } | null {
    const row = this.ctx.db.prepare(
      'SELECT vault_path FROM nodes WHERE id = ?'
    ).get(nodeId) as { vault_path: string | null } | undefined;

    const vaultPath = row?.vault_path;
    if (!vaultPath) return null;

    const absolutePath = this.ctx.resolve(vaultPath);
    if (!existsSync(absolutePath)) return null;

    const content = readFileSync(absolutePath, 'utf-8');
    const contentHash = computeFileHash(absolutePath) ?? '';
    return { path: vaultPath, content, contentHash };
  }

  appendEntityFile(
    nodeId: string,
    text: string,
    expectedHash?: string,
  ): { path: string; contentHash: string } {
    const row = this.ctx.db.prepare(
      'SELECT vault_path FROM nodes WHERE id = ?'
    ).get(nodeId) as { vault_path: string | null } | undefined;

    const vaultPath = row?.vault_path;
    if (!vaultPath) {
      throw new Error(`Node ${nodeId} has no vault_path — generate the entity file first`);
    }

    const absolutePath = this.ctx.resolve(vaultPath);
    if (!existsSync(absolutePath)) {
      throw new Error(`Entity file not found on disk: ${vaultPath}`);
    }

    if (expectedHash !== undefined) {
      const currentHash = computeFileHash(absolutePath);
      if (currentHash !== expectedHash) {
        throw new Error(`Hash mismatch for ${vaultPath}: expected ${expectedHash}, got ${currentHash}`);
      }
    }

    const existing = readFileSync(absolutePath, 'utf-8');
    const newContent = existing.trimEnd() + '\n\n' + text.trimStart();

    this.markAsAppWritten?.(vaultPath);
    writeFileSync(absolutePath, newContent, 'utf-8');

    const stat = statSync(absolutePath);
    const newHash = computeFileHash(absolutePath) ?? '';

    this.ctx.db.prepare(
      'UPDATE nodes SET file_mtime = ?, file_size = ?, content_hash = ? WHERE id = ?'
    ).run(Math.floor(stat.mtimeMs), stat.size, newHash, nodeId);

    return { path: vaultPath, contentHash: newHash };
  }

  patchEntityFile(
    nodeId: string,
    patch: { old_text: string; new_text: string },
    expectedHash?: string,
  ): { path: string; contentHash: string } {
    const row = this.ctx.db.prepare(
      'SELECT vault_path FROM nodes WHERE id = ?'
    ).get(nodeId) as { vault_path: string | null } | undefined;

    const vaultPath = row?.vault_path;
    if (!vaultPath) {
      throw new Error(`Node ${nodeId} has no vault_path — generate the entity file first`);
    }

    const absolutePath = this.ctx.resolve(vaultPath);
    if (!existsSync(absolutePath)) {
      throw new Error(`Entity file not found on disk: ${vaultPath}`);
    }

    if (expectedHash !== undefined) {
      const currentHash = computeFileHash(absolutePath);
      if (currentHash !== expectedHash) {
        throw new Error(`Hash mismatch for ${vaultPath}: expected ${expectedHash}, got ${currentHash}`);
      }
    }

    const content = readFileSync(absolutePath, 'utf-8');

    if (!content.includes(patch.old_text)) {
      throw new Error(`Patch old_text not found in ${vaultPath}`);
    }

    const newContent = content.replace(patch.old_text, patch.new_text);

    this.markAsAppWritten?.(vaultPath);
    writeFileSync(absolutePath, newContent, 'utf-8');

    const stat = statSync(absolutePath);
    const newHash = computeFileHash(absolutePath) ?? '';

    this.ctx.db.prepare(
      'UPDATE nodes SET file_mtime = ?, file_size = ?, content_hash = ? WHERE id = ?'
    ).run(Math.floor(stat.mtimeMs), stat.size, newHash, nodeId);

    return { path: vaultPath, contentHash: newHash };
  }

  generateFileForNode(node: DbNode): void {
    // Check if vault_path is already set and file exists -- skip generation
    const row = this.ctx.db.prepare(
      'SELECT vault_path FROM nodes WHERE id = ?'
    ).get(node.id) as { vault_path: string | null } | undefined;

    if (row?.vault_path) {
      const existingPath = this.ctx.resolve(row.vault_path);
      if (existsSync(existingPath)) {
        return; // Do NOT overwrite existing entity file
      }
    }

    const relativePath = this.derivePathWithCollision(node.name, node.id);
    const absolutePath = this.ctx.resolve(relativePath);

    // If a file already exists at the derived path (from collision handling, etc.), skip
    if (existsSync(absolutePath)) {
      // Check if the existing file at this path belongs to another node
      const existingOwner = this.ctx.db.prepare(
        'SELECT id FROM nodes WHERE vault_path = ?'
      ).get(relativePath) as { id: string } | undefined;

      if (existingOwner && existingOwner.id !== node.id) {
        return; // Another node owns this path
      }
    }

    const edges = this.queryEdgesForNode(node.id);
    const sources = this.querySourcesForNode(node.id);

    const markdown = generateEntityMarkdown({
      id: node.id,
      name: node.name,
      summary: node.summary,
      edges,
      sources,
    });

    mkdirSync(dirname(absolutePath), { recursive: true });
    this.markAsAppWritten?.(relativePath);
    writeFileSync(absolutePath, markdown, 'utf-8');

    // Update DB with vault_path and file metadata
    const stat = statSync(absolutePath);
    const hash = computeFileHash(absolutePath);

    this.ctx.db.prepare(
      'UPDATE nodes SET vault_path = ?, file_mtime = ?, file_size = ?, content_hash = ? WHERE id = ?'
    ).run(relativePath, Math.floor(stat.mtimeMs), stat.size, hash, node.id);
  }

  // ── Private: Debounce ──────────────────────────────────────────────

  private debouncedGenerate(node: DbNode): void {
    const existing = this.debounceTimers.get(node.id);
    if (existing) clearTimeout(existing);

    const timer = setTimeout(() => {
      this.debounceTimers.delete(node.id);
      this.generateFileForNode(node);
    }, DEBOUNCE_MS);

    this.debounceTimers.set(node.id, timer);
  }

  // ── Private: Node Handlers ─────────────────────────────────────────

  private handleEntityRenamed(node: DbNode): void {
    const row = this.ctx.db.prepare(
      'SELECT vault_path FROM nodes WHERE id = ?'
    ).get(node.id) as { vault_path: string | null } | undefined;

    if (!row?.vault_path) return;

    const oldAbsolute = this.ctx.resolve(row.vault_path);
    const newRelativePath = this.derivePathWithCollision(node.name, node.id);
    const newAbsolute = this.ctx.resolve(newRelativePath);

    if (oldAbsolute === newAbsolute) return;

    // Read old content and rewrite title in frontmatter
    if (existsSync(oldAbsolute)) {
      let content = readFileSync(oldAbsolute, 'utf-8');
      content = rewriteTitle(content, node.name);

      mkdirSync(dirname(newAbsolute), { recursive: true });
      this.markAsAppWritten?.(newRelativePath);
      this.markAsAppWritten?.(row.vault_path);
      writeFileSync(newAbsolute, content, 'utf-8');
      unlinkSync(oldAbsolute);
    }

    const stat = existsSync(newAbsolute) ? statSync(newAbsolute) : null;
    const hash = stat ? computeFileHash(newAbsolute) : null;

    this.ctx.db.prepare(
      'UPDATE nodes SET vault_path = ?, file_mtime = ?, file_size = ?, content_hash = ? WHERE id = ?'
    ).run(
      newRelativePath,
      stat ? Math.floor(stat.mtimeMs) : null,
      stat?.size ?? null,
      hash,
      node.id,
    );
  }

  private handleEntityDeleted(nodeId: string, filePath?: string): void {
    if (!filePath) return;
    if (!this.isEntityFilePath(filePath)) return;

    const absolutePath = this.ctx.resolve(filePath);
    this.markAsAppWritten?.(filePath);

    if (existsSync(absolutePath)) {
      unlinkSync(absolutePath);
    }
  }

  // ── Private: Edge Handlers ─────────────────────────────────────────

  private handleEdgeChanged(edge: DbEdge): void {
    // Append relationship line to both source and target entity files
    const sourceNode = this.ctx.db.prepare(
      'SELECT id, name, type, vault_path FROM nodes WHERE id = ?'
    ).get(edge.source_id) as Pick<DbNode, 'id' | 'name' | 'type' | 'vault_path'> | undefined;

    const targetNode = this.ctx.db.prepare(
      'SELECT id, name, type, vault_path FROM nodes WHERE id = ?'
    ).get(edge.target_id) as Pick<DbNode, 'id' | 'name' | 'type' | 'vault_path'> | undefined;

    // Update source entity file (outgoing relationship)
    if (sourceNode?.type === 'entity' && sourceNode.vault_path) {
      this.appendRelationshipLine(
        sourceNode.vault_path,
        targetNode?.name ?? 'Unknown',
        edge.label,
        'outgoing',
      );
    }

    // Update target entity file (incoming relationship)
    if (targetNode?.type === 'entity' && targetNode.vault_path) {
      this.appendRelationshipLine(
        targetNode.vault_path,
        sourceNode?.name ?? 'Unknown',
        edge.label,
        'incoming',
      );
    }
  }

  private handleEdgeDeletedWithData(edgeId: string): void {
    // Read edge from DB before it's removed (caller may have already deleted it)
    const edge = this.ctx.db.prepare(
      'SELECT id, source_id, target_id, label FROM edges WHERE id = ?'
    ).get(edgeId) as Pick<DbEdge, 'id' | 'source_id' | 'target_id' | 'label'> | undefined;

    if (!edge) return;

    const sourceNode = this.ctx.db.prepare(
      'SELECT id, name, type, vault_path FROM nodes WHERE id = ?'
    ).get(edge.source_id) as Pick<DbNode, 'id' | 'name' | 'type' | 'vault_path'> | undefined;

    const targetNode = this.ctx.db.prepare(
      'SELECT id, name, type, vault_path FROM nodes WHERE id = ?'
    ).get(edge.target_id) as Pick<DbNode, 'id' | 'name' | 'type' | 'vault_path'> | undefined;

    // Remove from source entity file
    if (sourceNode?.type === 'entity' && sourceNode.vault_path) {
      this.removeRelationshipLine(
        sourceNode.vault_path,
        targetNode?.name ?? 'Unknown',
        edge.label,
      );
    }

    // Remove from target entity file
    if (targetNode?.type === 'entity' && targetNode.vault_path) {
      this.removeRelationshipLine(
        targetNode.vault_path,
        sourceNode?.name ?? 'Unknown',
        edge.label,
      );
    }
  }

  private appendRelationshipLine(
    vaultPath: string,
    otherName: string,
    label: string,
    direction: 'outgoing' | 'incoming',
  ): void {
    const absolutePath = this.ctx.resolve(vaultPath);
    if (!existsSync(absolutePath)) return;

    let content = readFileSync(absolutePath, 'utf-8');

    // Build the relationship line
    const line = direction === 'outgoing'
      ? `- [[${otherName}]] — *${label}*`
      : `- [[${otherName}]] → *${label}*`;

    // Check if the line already exists (prevent duplicates)
    if (content.includes(line)) return;

    // Find or create the Relationships section
    const sectionHeader = '## Relationships';
    const sectionIdx = content.indexOf(sectionHeader);

    if (sectionIdx === -1) {
      // Append new section before Sources or at end
      const sourcesIdx = content.indexOf('## Sources');
      if (sourcesIdx !== -1) {
        content = content.slice(0, sourcesIdx) + sectionHeader + '\n\n' + line + '\n\n' + content.slice(sourcesIdx);
      } else {
        content = content.trimEnd() + '\n\n' + sectionHeader + '\n\n' + line + '\n';
      }
    } else {
      // Insert after the last relationship line in the section
      const afterHeader = sectionIdx + sectionHeader.length;
      const rest = content.slice(afterHeader);

      // Find end of relationships block (next ## or end of file)
      const nextSectionMatch = rest.match(/\n## /);
      const insertionPoint = nextSectionMatch
        ? afterHeader + nextSectionMatch.index!
        : content.length;

      // Insert line before the next section (or at end)
      const before = content.slice(0, insertionPoint).trimEnd();
      const after = content.slice(insertionPoint);
      content = before + '\n' + line + '\n' + after;
    }

    this.markAsAppWritten?.(vaultPath);
    writeFileSync(absolutePath, content, 'utf-8');
  }

  private removeRelationshipLine(
    vaultPath: string,
    otherName: string,
    label: string,
  ): void {
    const absolutePath = this.ctx.resolve(vaultPath);
    if (!existsSync(absolutePath)) return;

    let content = readFileSync(absolutePath, 'utf-8');

    // Match EXACT label line for both outgoing and incoming formats
    const outgoingRegex = new RegExp(
      `^- \\[\\[${escapeRegex(otherName)}\\]\\] — \\*${escapeRegex(label)}\\*$\\n?`,
      'gm',
    );
    const incomingRegex = new RegExp(
      `^- \\[\\[${escapeRegex(otherName)}\\]\\] → \\*${escapeRegex(label)}\\*$\\n?`,
      'gm',
    );

    content = content.replace(outgoingRegex, '');
    content = content.replace(incomingRegex, '');

    this.markAsAppWritten?.(vaultPath);
    writeFileSync(absolutePath, content, 'utf-8');
  }

  // ── Private: File Event Handlers ───────────────────────────────────

  private handleEntityFileAdded(relativePath: string): void {
    // Guard: if a node already has this vault_path, route to changed handler
    const existing = this.ctx.db.prepare(
      'SELECT id FROM nodes WHERE vault_path = ?'
    ).get(relativePath) as { id: string } | undefined;

    if (existing) {
      this.handleEntityFileChanged(relativePath);
      return;
    }

    // New entity file — stub for future import logic (Task 5+)
    // For now, do nothing
  }

  private handleEntityFileChanged(_relativePath: string): void {
    // Stub — will be implemented in a later task for bidirectional sync
  }

  private handleEntityFileRemoved(relativePath: string): void {
    // Silently clear vault_path, no notification
    this.ctx.db.prepare(
      'UPDATE nodes SET vault_path = NULL, file_mtime = NULL, file_size = NULL, content_hash = NULL WHERE vault_path = ?'
    ).run(relativePath);
  }

  // ── Private: Helpers ───────────────────────────────────────────────

  private derivePathWithCollision(name: string, nodeId: string): string {
    let relativePath = deriveEntityPath(name);
    let absolutePath = this.ctx.resolve(relativePath);

    let counter = 2;
    while (existsSync(absolutePath)) {
      // Check if this file belongs to the same node (not a real collision)
      const owner = this.ctx.db.prepare(
        'SELECT id FROM nodes WHERE vault_path = ?'
      ).get(relativePath) as { id: string } | undefined;

      if (owner?.id === nodeId) break;

      // Real collision — file exists on disk (owned by another node or unmanaged)
      const base = deriveEntityPath(name).replace(/\.md$/, '');
      relativePath = `${base}_${counter}.md`;
      absolutePath = this.ctx.resolve(relativePath);
      counter++;
    }

    return relativePath;
  }

  private queryEdgesForNode(nodeId: string): EntityEdgeInfo[] {
    const rows = this.ctx.db.prepare(`
      SELECT e.label, e.source_id, e.target_id, s.name AS source_name, t.name AS target_name
      FROM edges e
      LEFT JOIN nodes s ON e.source_id = s.id
      LEFT JOIN nodes t ON e.target_id = t.id
      WHERE e.source_id = ? OR e.target_id = ?
    `).all(nodeId, nodeId) as Array<{
      label: string;
      source_id: string;
      target_id: string;
      source_name: string | null;
      target_name: string | null;
    }>;

    return rows.map((row) => ({
      sourceName: row.source_name ?? undefined,
      targetName: row.target_name ?? undefined,
      label: row.label,
      direction: row.source_id === nodeId ? 'outgoing' as const : 'incoming' as const,
    }));
  }

  private querySourcesForNode(nodeId: string): EntitySourceInfo[] {
    const rows = this.ctx.db.prepare(`
      SELECT n.name, n.source_url AS url
      FROM entity_sources es
      JOIN nodes n ON es.resource_id = n.id
      WHERE es.entity_id = ?
    `).all(nodeId) as Array<{ name: string; url: string | null }>;

    return rows;
  }

  private isEntityFilePath(relativePath: string): boolean {
    return relativePath.startsWith(ENTITIES_DIR + '/') && relativePath.endsWith('.md');
  }
}

// ── Utility ────────────────────────────────────────────────────────────

function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
