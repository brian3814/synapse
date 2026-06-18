import { readFileSync, existsSync } from 'fs';
import path from 'path';
import type { VaultEventBus } from '../event-bus';
import type { ArtifactMeta } from '../../../src/shared/artifact-types';
import * as artifactQueries from '../../../src/db/worker/queries/artifact-queries';
import { BrowserWindow } from 'electron';
import type { ArtifactRecord } from '../../../src/shared/artifact-types';

export class ArtifactFileHandler {
  private vaultPath: string;
  private unsubscribers: (() => void)[] = [];

  constructor(vaultPath: string) {
    this.vaultPath = vaultPath;
  }

  register(eventBus: VaultEventBus): void {
    this.unsubscribers.push(
      eventBus.on('file:added', (event) => {
        if (event.relativePath.startsWith('.synapse/artifacts/')) {
          this.handleArtifactChange(event.relativePath);
        }
      }),
      eventBus.on('file:removed', (event) => {
        if (event.relativePath.startsWith('.synapse/artifacts/')) {
          this.handleArtifactRemoved(event.relativePath);
        }
      }),
    );
  }

  unregister(): void {
    for (const unsub of this.unsubscribers) unsub();
    this.unsubscribers = [];
  }

  private async handleArtifactChange(relativePath: string): Promise<void> {
    if (relativePath.endsWith('.meta.json')) {
      await this.syncFromMeta(relativePath);
    }
  }

  private async handleArtifactRemoved(relativePath: string): Promise<void> {
    if (relativePath.endsWith('.meta.json')) {
      const absPath = path.join(this.vaultPath, relativePath);
      if (existsSync(absPath)) return;

      try {
        const metaContent = readFileSync(absPath, 'utf-8');
        const meta: ArtifactMeta = JSON.parse(metaContent);
        await artifactQueries.deleteArtifactRow(meta.id);
      } catch {
        // Meta file already gone — try to find and delete by path
      }
    }
  }

  private async syncFromMeta(metaRelPath: string): Promise<void> {
    const absPath = path.join(this.vaultPath, metaRelPath);
    if (!existsSync(absPath)) return;

    try {
      const meta: ArtifactMeta = JSON.parse(readFileSync(absPath, 'utf-8'));
      const existing = await artifactQueries.getArtifact(meta.id);

      if (existing) {
        await artifactQueries.updateArtifactRow(meta.id, meta.title, meta.updatedAt);

        const contentPath = absPath.replace('.meta.json', this.getExtForType(meta.type));
        if (existsSync(contentPath)) {
          const content = readFileSync(contentPath, 'utf-8');
          await artifactQueries.updateArtifactFts(meta.id, content);
        }

        const record: ArtifactRecord = { ...meta, fileName: existing.fileName };
        this.broadcastChange(record);
      }
    } catch (err) {
      console.error('[ArtifactFileHandler] Error syncing meta:', err);
    }
  }

  private getExtForType(type: string): string {
    const map: Record<string, string> = {
      jsx: '.jsx', markdown: '.md', html: '.html', svg: '.svg', mermaid: '.mmd',
    };
    return map[type] ?? '.txt';
  }

  private broadcastChange(record: ArtifactRecord): void {
    for (const win of BrowserWindow.getAllWindows()) {
      win.webContents.send('artifacts:changed', record);
    }
  }
}
