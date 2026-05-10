import { dirname } from 'path';
import { existsSync, renameSync, unlinkSync, writeFileSync, mkdirSync, statSync } from 'fs';
import type { VaultContext } from '../vault-context';
import type { VaultEventBus } from '../event-bus';

export class NoteFileHandler {
  private ctx: VaultContext;
  private unsubscribers: (() => void)[] = [];

  constructor(ctx: VaultContext) {
    this.ctx = ctx;
  }

  register(eventBus: VaultEventBus): void {
    this.unsubscribers.push(
      eventBus.on('node:created', (event) => {
        if (event.node.type === 'note') {
          this.handleNoteCreated(event.node.id, event.node.name);
        }
      }),
      eventBus.on('node:updated', (event) => {
        if (event.node.type === 'note' && event.changes.includes('name')) {
          this.handleNoteRenamed(event.node.id, event.node.name);
        }
      }),
      eventBus.on('node:deleted', (event) => {
        if (event.filePath) {
          this.handleNoteDeleted(event.filePath);
        }
      }),
    );
  }

  unregister(): void {
    for (const unsub of this.unsubscribers) unsub();
    this.unsubscribers = [];
  }

  private handleNoteCreated(nodeId: string, name: string): void {
    const relativePath = this.deriveNotePath(name);
    const absolutePath = this.ctx.resolve(relativePath);

    mkdirSync(dirname(absolutePath), { recursive: true });
    if (!existsSync(absolutePath)) {
      writeFileSync(absolutePath, '', 'utf-8');
    }

    const stat = statSync(absolutePath);
    this.ctx.db.prepare(
      'UPDATE nodes SET vault_path = ?, file_mtime = ?, file_size = ? WHERE id = ?'
    ).run(relativePath, Math.floor(stat.mtimeMs), stat.size, nodeId);
  }

  private handleNoteRenamed(nodeId: string, newName: string): void {
    const row = this.ctx.db.prepare(
      'SELECT vault_path FROM nodes WHERE id = ?'
    ).get(nodeId) as { vault_path: string | null } | undefined;

    if (!row?.vault_path) return;

    const oldAbsolute = this.ctx.resolve(row.vault_path);
    const newRelativePath = this.deriveNotePath(newName);
    const newAbsolute = this.ctx.resolve(newRelativePath);

    if (oldAbsolute === newAbsolute) return;

    if (existsSync(oldAbsolute)) {
      mkdirSync(dirname(newAbsolute), { recursive: true });
      renameSync(oldAbsolute, newAbsolute);
    }

    const stat = existsSync(newAbsolute) ? statSync(newAbsolute) : null;
    this.ctx.db.prepare(
      'UPDATE nodes SET vault_path = ?, file_mtime = ?, file_size = ? WHERE id = ?'
    ).run(newRelativePath, stat ? Math.floor(stat.mtimeMs) : null, stat?.size ?? null, nodeId);
  }

  private handleNoteDeleted(filePath: string): void {
    const absolutePath = this.ctx.resolve(filePath);
    if (existsSync(absolutePath)) {
      unlinkSync(absolutePath);
    }
  }

  private deriveNotePath(name: string): string {
    let filename = sanitizeFilename(name);
    if (!filename) filename = `Untitled-${shortId()}`;

    let relativePath = `notes/${filename}.md`;
    let absolutePath = this.ctx.resolve(relativePath);

    // Collision handling
    let counter = 2;
    while (existsSync(absolutePath)) {
      // Check if this file belongs to the same node (not a real collision)
      const existing = this.ctx.db.prepare(
        'SELECT id FROM nodes WHERE vault_path = ?'
      ).get(relativePath) as { id: string } | undefined;
      if (existing) break;

      relativePath = `notes/${filename} (${counter}).md`;
      absolutePath = this.ctx.resolve(relativePath);
      counter++;
    }

    return relativePath;
  }
}

function sanitizeFilename(name: string): string {
  return name
    .replace(/[/\\]/g, '-')
    .replace(/:/g, '-')
    .replace(/^[\s.]+|[\s.]+$/g, '');
}

function shortId(): string {
  const chars = 'abcdefghijklmnopqrstuvwxyz0123456789';
  let result = '';
  for (let i = 0; i < 6; i++) {
    result += chars[Math.floor(Math.random() * chars.length)];
  }
  return result;
}
