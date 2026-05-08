import type Database from 'better-sqlite3';
import type { EmbeddingProvider } from '../../src/embeddings/types';
import { insertEmbedding, deleteEmbedding, knnSearch, upsertSimilarPair, removeSimilarPairsFor } from './vec-store';
import { computeTextHash } from './build-embedding-text';

interface QueueItem {
  nodeId: string;
  text: string;
}

export class EmbeddingQueue {
  private queue: QueueItem[] = [];
  private processing = false;
  private idleDelay = 50;
  private db: Database.Database;
  private provider: EmbeddingProvider;
  constructor(db: Database.Database, provider: EmbeddingProvider) {
    this.db = db;
    this.provider = provider;
  }

  enqueue(nodeId: string, text: string): void {
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
      'INSERT OR REPLACE INTO embedding_metadata(node_id, provider_id, dimensions, embedded_at, text_hash) VALUES (?, ?, ?, ?, ?)'
    ).run(nodeId, this.provider.id, this.provider.dimensions, new Date().toISOString(), hash);

    this.updateSimilarPairs(nodeId, vec);
  }

  private updateSimilarPairs(nodeId: string, vec: Float32Array): void {
    removeSimilarPairsFor(this.db, nodeId);

    // Embedding-based similarity (KNN)
    const neighbors = knnSearch(this.db, vec, 3, nodeId);
    for (const n of neighbors) {
      const similarity = 1 - n.distance;
      if (similarity >= 0.5) {
        upsertSimilarPair(this.db, nodeId, n.nodeId, similarity);
      }
    }

    // Acronym + normalized string matching (catches LLM ↔ Large Language Model, ChatGPT ↔ Chat GPT)
    const thisNode = this.db.prepare('SELECT name FROM nodes WHERE id = ?').get(nodeId) as { name: string } | undefined;
    if (!thisNode) return;
    const otherNodes = this.db.prepare('SELECT id, name FROM nodes WHERE id != ?').all(nodeId) as Array<{ id: string; name: string }>;
    for (const other of otherNodes) {
      if (isNameMatch(thisNode.name, other.name)) {
        upsertSimilarPair(this.db, nodeId, other.id, 0.95);
      }
    }
  }

  handleNodeDeleted(nodeId: string): void {
    deleteEmbedding(this.db, nodeId);
    removeSimilarPairsFor(this.db, nodeId);
    this.db.prepare('DELETE FROM embedding_metadata WHERE node_id = ?').run(nodeId);
  }

  get pending(): number {
    return this.queue.length;
  }

  get isProcessing(): boolean {
    return this.processing;
  }
}

function isNameMatch(a: string, b: string): boolean {
  return isAcronymOf(a, b) || isAcronymOf(b, a) || isNormalizedMatch(a, b);
}

function isAcronymOf(short: string, long: string): boolean {
  const s = short.trim();
  const words = long.trim().split(/\s+/);
  if (s.length < 2 || s.length > 10 || words.length < 2) return false;
  if (words.length !== s.length) return false;
  const acronym = words.map((w) => w[0]).join('');
  return acronym.toLowerCase() === s.toLowerCase();
}

function isNormalizedMatch(a: string, b: string): boolean {
  const normalize = (s: string) => s.toLowerCase().replace(/[\s\-_.]+/g, '');
  const na = normalize(a);
  const nb = normalize(b);
  if (na === nb && a !== b) return true;
  // "ChatGPT" vs "Chat GPT" — one is the collapsed form of the other
  if (na.length >= 3 && nb.length >= 3) {
    if (na.includes(nb) || nb.includes(na)) {
      const ratio = Math.min(na.length, nb.length) / Math.max(na.length, nb.length);
      return ratio >= 0.8;
    }
  }
  return false;
}
