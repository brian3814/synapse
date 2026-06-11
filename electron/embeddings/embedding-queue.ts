import type Database from 'better-sqlite3';
import type { EmbeddingProvider } from '../../src/embeddings/types';
import { insertEmbedding, deleteEmbedding } from './vec-store';
import { computeTextHash } from './build-embedding-text';

interface QueueItem {
  nodeId: string;
  text: string;
}

export class EmbeddingQueue {
  private queue: QueueItem[] = [];
  private pendingIds = new Set<string>();
  private processing = false;
  private idleDelay = 50;
  private getDb: () => Database.Database;
  private provider: EmbeddingProvider;
  constructor(getDb: () => Database.Database, provider: EmbeddingProvider) {
    this.getDb = getDb;
    this.provider = provider;
  }

  private get db(): Database.Database {
    return this.getDb();
  }

  enqueue(nodeId: string, text: string): void {
    if (this.pendingIds.has(nodeId)) {
      const idx = this.queue.findIndex((q) => q.nodeId === nodeId);
      if (idx !== -1) this.queue[idx].text = text;
      return;
    }
    this.pendingIds.add(nodeId);
    this.queue.push({ nodeId, text });
    if (!this.processing) {
      this.drain();
    }
  }

  async batchProcess(
    nodes: Array<{ id: string; text: string }>,
    onProgress: (done: number, total: number) => void,
  ): Promise<void> {
    const total = nodes.length;
    let done = 0;

    for (let i = 0; i < nodes.length; i += this.provider.maxTokens > 1000 ? 32 : 12) {
      const chunk = nodes.slice(i, i + (this.provider.maxTokens > 1000 ? 32 : 12));
      const texts = chunk.map((n) => n.text);

      try {
        const vectors = await this.provider.embedBatch(texts);
        for (let j = 0; j < chunk.length; j++) {
          this.storeEmbedding(chunk[j].id, chunk[j].text, vectors[j]);
        }
      } catch (e) {
        console.error('[EmbeddingQueue] Batch error, falling back to individual:', e);
        for (const item of chunk) {
          try {
            const vec = await this.provider.embed(item.text);
            this.storeEmbedding(item.id, item.text, vec);
          } catch (e2) {
            console.error(`[EmbeddingQueue] Failed to embed ${item.id}:`, e2);
          }
        }
      }

      done += chunk.length;
      onProgress(done, total);

      await new Promise((r) => setTimeout(r, this.idleDelay));
    }
  }

  private async drain(): Promise<void> {
    if (this.processing) return;
    this.processing = true;

    while (this.queue.length > 0) {
      const item = this.queue.shift()!;
      this.pendingIds.delete(item.nodeId);
      try {
        const vec = await this.provider.embed(item.text);
        this.storeEmbedding(item.nodeId, item.text, vec);
      } catch (e) {
        console.error(`[EmbeddingQueue] Failed to embed ${item.nodeId}:`, e);
      }
      if (this.queue.length > 0) {
        await new Promise((r) => setTimeout(r, this.idleDelay));
      }
    }

    this.processing = false;
  }

  private storeEmbedding(nodeId: string, text: string, vec: Float32Array): void {
    insertEmbedding(this.db, nodeId, vec);

    const hash = computeTextHash(text);
    this.db.prepare(
      'INSERT OR REPLACE INTO embedding_metadata(node_id, text_hash) VALUES (?, ?)'
    ).run(nodeId, hash);
  }

  handleNodeDeleted(nodeId: string): void {
    this.pendingIds.delete(nodeId);
    const idx = this.queue.findIndex((q) => q.nodeId === nodeId);
    if (idx !== -1) this.queue.splice(idx, 1);
    deleteEmbedding(this.db, nodeId);
    this.db.prepare('DELETE FROM embedding_metadata WHERE node_id = ?').run(nodeId);
  }

  get pending(): number {
    return this.queue.length;
  }

  get isProcessing(): boolean {
    return this.processing;
  }
}
