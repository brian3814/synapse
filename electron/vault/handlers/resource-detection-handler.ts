import { statSync } from 'fs';
import { extname, basename } from 'path';
import { randomUUID } from 'crypto';
import type { VaultContext } from '../vault-context';
import type { VaultEventBus } from '../event-bus';
import type { VaultSandboxConfig } from '../../../src/shared/agent-settings-types';
import { computeFileHash } from '../content-hash';

const MIME_MAP: Record<string, string> = {
  '.pdf': 'application/pdf',
  '.html': 'text/html',
  '.htm': 'text/html',
  '.txt': 'text/plain',
  '.md': 'text/markdown',
  '.json': 'application/json',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.svg': 'image/svg+xml',
  '.webp': 'image/webp',
  '.mp3': 'audio/mpeg',
  '.mp4': 'video/mp4',
  '.csv': 'text/csv',
};

export class ResourceDetectionHandler {
  private ctx: VaultContext;
  private unsubscribers: (() => void)[] = [];
  private getSandboxConfig: () => VaultSandboxConfig;

  constructor(ctx: VaultContext, getSandboxConfig: () => VaultSandboxConfig) {
    this.ctx = ctx;
    this.getSandboxConfig = getSandboxConfig;
  }

  register(eventBus: VaultEventBus): void {
    this.unsubscribers.push(
      eventBus.on('file:added', (event) => {
        this.handleFileAdded(event.relativePath);
      }),
      eventBus.on('file:removed', (event) => {
        this.handleFileRemoved(event.relativePath);
      }),
      eventBus.on('file:changed', (event) => {
        this.handleFileChanged(event.relativePath);
      }),
    );
  }

  unregister(): void {
    for (const unsub of this.unsubscribers) unsub();
    this.unsubscribers = [];
  }

  private handleFileAdded(relativePath: string): void {
    // Sandbox check
    const sandbox = this.getSandboxConfig();
    const ext = extname(relativePath).toLowerCase();
    if (ext && sandbox.blockedExtensions.includes(ext)) return;
    if (sandbox.allowedDirs.length > 0) {
      const inAllowed = sandbox.allowedDirs.some((dir) => relativePath.startsWith(dir));
      if (!inAllowed) return;
    }

    // Check if a node already exists for this path
    const existing = this.ctx.db.prepare(
      'SELECT id FROM nodes WHERE vault_path = ?'
    ).get(relativePath) as { id: string } | undefined;

    if (existing) {
      this.updateFileMeta(existing.id, relativePath);
      this.ctx.eventBus.emit({ type: 'file:changed', relativePath });
      return;
    }

    // Create resource node
    const absolutePath = this.ctx.resolve(relativePath);
    let stat: ReturnType<typeof statSync>;
    try {
      stat = statSync(absolutePath);
    } catch {
      return;
    }

    const name = basename(relativePath, ext);
    const contentType = MIME_MAP[ext] ?? null;
    const id = randomUUID();
    const now = new Date().toISOString();
    const hash = computeFileHash(absolutePath);

    this.ctx.db.prepare(`
      INSERT INTO nodes (id, identifier, name, type, label, summary, folder_path, properties, x, y, z, color, size, source_url, vault_path, content_type, file_mtime, file_size, content_hash, created_at, updated_at)
      VALUES (?, ?, ?, 'resource', NULL, NULL, '', ?, NULL, NULL, NULL, NULL, 1, NULL, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      id,
      id,
      name,
      JSON.stringify({ fileType: ext.slice(1), addedAt: now }),
      relativePath,
      contentType,
      Math.floor(stat.mtimeMs),
      stat.size,
      hash,
      now,
      now,
    );

    // Emit node:created so other handlers (embedding, sync) react
    const node = this.ctx.db.prepare('SELECT * FROM nodes WHERE id = ?').get(id);
    if (node) {
      this.ctx.eventBus.emit({ type: 'node:created', node: node as any });
    }
  }

  private handleFileRemoved(relativePath: string): void {
    const existing = this.ctx.db.prepare(
      'SELECT id FROM nodes WHERE vault_path = ?'
    ).get(relativePath) as { id: string } | undefined;

    if (!existing) return;

    // Mark as orphaned by nulling vault_path metadata — don't delete the node
    this.ctx.db.prepare(
      'UPDATE nodes SET file_mtime = NULL, file_size = NULL, updated_at = ? WHERE id = ?'
    ).run(new Date().toISOString(), existing.id);
  }

  private handleFileChanged(relativePath: string): void {
    const existing = this.ctx.db.prepare(
      'SELECT * FROM nodes WHERE vault_path = ?'
    ).get(relativePath) as Record<string, unknown> | undefined;

    if (existing) {
      this.ctx.eventBus.emit({
        type: 'node:updated',
        node: existing as any,
        changes: ['content'],
      });
    }
  }

  private updateFileMeta(nodeId: string, relativePath: string): void {
    const absolutePath = this.ctx.resolve(relativePath);
    try {
      const stat = statSync(absolutePath);
      const hash = computeFileHash(absolutePath);
      this.ctx.db.prepare(
        'UPDATE nodes SET file_mtime = ?, file_size = ?, content_hash = ?, updated_at = ? WHERE id = ?'
      ).run(Math.floor(stat.mtimeMs), stat.size, hash, new Date().toISOString(), nodeId);
    } catch {
      // File may have been removed between events
    }
  }
}
