import type Database from 'better-sqlite3';
import type { EmbeddingConfig, EmbeddingProvider, EmbeddingStatus, SemanticSearchResult, SimilarPair } from '../../src/embeddings/types';
import { DEFAULT_EMBEDDING_CONFIG } from '../../src/embeddings/types';
import { OnnxProvider } from './onnx-provider';
import { OpenAIProvider } from './openai-provider';
import { EmbeddingQueue } from './embedding-queue';
import { loadVecExtension, ensureVecTable, dropVecTable, knnSearch, getSimilarPairs, addDismissal } from './vec-store';
import { buildEmbeddingText, computeTextHash } from './build-embedding-text';

export class EmbeddingService {
  private db: Database.Database;
  private provider: EmbeddingProvider | null = null;
  private queue: EmbeddingQueue | null = null;
  private config: EmbeddingConfig = { ...DEFAULT_EMBEDDING_CONFIG };
  private vecAvailable = false;
  private progressListeners = new Set<(progress: { done: number; total: number }) => void>();
  private readNote?: (nodeId: string) => string | null;

  constructor(db: Database.Database, readNote?: (nodeId: string) => string | null) {
    this.db = db;
    this.readNote = readNote;
  }

  async initialize(storedConfig?: Partial<EmbeddingConfig>): Promise<void> {
    if (storedConfig) {
      this.config = { ...DEFAULT_EMBEDDING_CONFIG, ...storedConfig };
    }

    this.vecAvailable = loadVecExtension(this.db);
    console.log('[EmbeddingService] vecAvailable:', this.vecAvailable, 'config:', JSON.stringify({ enabled: this.config.enabled, providerId: this.config.providerId }));
    if (!this.vecAvailable) {
      console.warn('[EmbeddingService] sqlite-vec not available, embeddings disabled');
      this.config.enabled = false;
      return;
    }

    if (this.config.enabled) {
      await this.activateProvider();
    }
  }

  private async activateProvider(): Promise<void> {
    const provider = this.createProvider();
    if (!provider) {
      console.warn('[EmbeddingService] No provider could be created for', this.config.providerId);
      this.config.enabled = false;
      return;
    }

    console.log(`[EmbeddingService] Activating provider: ${provider.id}`);
    try {
      await provider.initialize();
      this.provider = provider;
      ensureVecTable(this.db, provider.dimensions);
      this.queue = new EmbeddingQueue(this.db, provider);
      console.log(`[EmbeddingService] Provider ${provider.id} ready (${provider.dimensions}d)`);
    } catch (e) {
      console.error('[EmbeddingService] Failed to initialize provider:', e);
      this.config.enabled = false;
      try { await provider.dispose(); } catch {}
    }
  }

  private createProvider(): EmbeddingProvider | null {
    const { providerId, onnxModelQuality, openaiApiKey, openaiModel } = this.config;

    if (providerId.startsWith('onnx')) {
      return new OnnxProvider(onnxModelQuality);
    }
    if (providerId.startsWith('openai') && openaiApiKey) {
      return new OpenAIProvider(openaiApiKey, openaiModel ?? 'text-embedding-3-small');
    }
    return null;
  }

  async configure(update: Partial<EmbeddingConfig>): Promise<void> {
    const oldConfig = { ...this.config };
    this.config = { ...this.config, ...update };
    console.log('[EmbeddingService] configure:', JSON.stringify(update), 'oldEnabled:', oldConfig.enabled, 'newEnabled:', this.config.enabled);

    const providerChanged = oldConfig.providerId !== this.config.providerId
      || oldConfig.onnxModelQuality !== this.config.onnxModelQuality
      || oldConfig.openaiApiKey !== this.config.openaiApiKey
      || oldConfig.openaiModel !== this.config.openaiModel;

    if (!this.config.enabled) {
      if (this.provider) {
        await this.provider.dispose();
        this.provider = null;
        this.queue = null;
      }
      return;
    }

    if (!oldConfig.enabled || providerChanged) {
      if (this.provider) {
        await this.provider.dispose();
        this.provider = null;
        this.queue = null;
      }
      if (providerChanged && this.vecAvailable) {
        dropVecTable(this.db);
        this.db.prepare('DELETE FROM embedding_metadata').run();
      }
      await this.activateProvider();
      if (this.provider && this.queue) {
        await this.runBatchEmbed();
      }
    }
  }

  private async runBatchEmbed(): Promise<void> {
    if (!this.queue || !this.provider) return;

    const nodes = this.db.prepare('SELECT id, name, type, label, summary FROM nodes').all() as Array<{
      id: string; name: string; type: string; label: string | null; summary: string | null;
    }>;

    const items = nodes.map((n) => ({
      id: n.id,
      text: buildEmbeddingText(n, this.db, this.readNote),
    }));

    console.log(`[EmbeddingService] Starting batch embed of ${items.length} nodes`);
    await this.queue.batchProcess(items, (done, total) => {
      for (const listener of this.progressListeners) {
        listener({ done, total });
      }
    });

    const allPairs = this.db.prepare(
      `SELECT sp.node_id_a, sp.node_id_b, sp.similarity, na.name as name_a, nb.name as name_b
       FROM similar_pairs sp
       JOIN nodes na ON na.id = sp.node_id_a
       JOIN nodes nb ON nb.id = sp.node_id_b
       ORDER BY sp.similarity DESC`
    ).all() as Array<{ node_id_a: string; node_id_b: string; similarity: number; name_a: string; name_b: string }>;
    console.log(`[EmbeddingService] Batch complete. ${allPairs.length} similar pairs stored:`);
    for (const p of allPairs.slice(0, 20)) {
      console.log(`  ${p.similarity.toFixed(3)} | "${p.name_a}" ↔ "${p.name_b}"`);
    }
  }

  async handleNodeMutation(nodeId: string): Promise<void> {
    if (!this.config.enabled || !this.config.autoEmbed || !this.queue) return;

    const node = this.db.prepare('SELECT id, name, type, label, summary FROM nodes WHERE id = ?').get(nodeId) as {
      id: string; name: string; type: string; label: string | null; summary: string | null;
    } | undefined;

    if (!node) return;

    const text = buildEmbeddingText(node, this.db, this.readNote);
    const hash = computeTextHash(text);

    const existing = this.db.prepare('SELECT text_hash FROM embedding_metadata WHERE node_id = ?').get(nodeId) as { text_hash: string } | undefined;
    if (existing?.text_hash === hash) return;

    this.queue.enqueue(nodeId, text);
  }

  handleNodeDeleted(nodeId: string): void {
    this.queue?.handleNodeDeleted(nodeId);
  }

  async searchSimilar(queryText: string, topK = 5): Promise<SemanticSearchResult[]> {
    if (!this.provider || !this.config.enabled) return [];
    const vec = await this.provider.embed(queryText);
    const results = knnSearch(this.db, vec, topK);
    return results.map((r) => ({ nodeId: r.nodeId, score: 1 - r.distance }));
  }

  async searchSimilarByNodeId(nodeId: string, topK = 5): Promise<SemanticSearchResult[]> {
    if (!this.provider || !this.config.enabled) return [];
    const meta = this.db.prepare('SELECT node_id FROM embedding_metadata WHERE node_id = ?').get(nodeId);
    if (!meta) return [];
    const node = this.db.prepare('SELECT id, name, type, label, summary FROM nodes WHERE id = ?').get(nodeId) as any;
    if (!node) return [];
    const text = buildEmbeddingText(node, this.db, this.readNote);
    const vec = await this.provider.embed(text);
    const results = knnSearch(this.db, vec, topK + 1, nodeId);
    return results.slice(0, topK).map((r) => ({ nodeId: r.nodeId, score: 1 - r.distance }));
  }

  findDuplicatePairs(threshold?: number, limit?: number): SimilarPair[] {
    const t = threshold ?? this.config.similarityThreshold;
    const l = limit ?? 20;
    const rawPairs = getSimilarPairs(this.db, t, l);

    return rawPairs.map((p) => {
      const nodeA = this.db.prepare('SELECT id, name, type, label, summary FROM nodes WHERE id = ?').get(p.nodeIdA) as any;
      const nodeB = this.db.prepare('SELECT id, name, type, label, summary FROM nodes WHERE id = ?').get(p.nodeIdB) as any;
      if (!nodeA || !nodeB) return null;

      const countA = (this.db.prepare('SELECT COUNT(*) as c FROM edges WHERE source_id = ? OR target_id = ?').get(nodeA.id, nodeA.id) as any).c;
      const countB = (this.db.prepare('SELECT COUNT(*) as c FROM edges WHERE source_id = ? OR target_id = ?').get(nodeB.id, nodeB.id) as any).c;

      const primary = countA >= countB ? { ...nodeA, connectionCount: countA } : { ...nodeB, connectionCount: countB };
      const secondary = countA >= countB ? { ...nodeB, connectionCount: countB } : { ...nodeA, connectionCount: countA };

      return { nodeA: primary, nodeB: secondary, similarity: p.similarity };
    }).filter((p): p is SimilarPair => p !== null);
  }

  dismissPair(nodeIdA: string, nodeIdB: string): void {
    addDismissal(this.db, nodeIdA, nodeIdB);
  }

  getStatus(): EmbeddingStatus {
    const totalNodes = (this.db.prepare('SELECT COUNT(*) as c FROM nodes').get() as any).c;
    const embeddedNodes = (this.db.prepare('SELECT COUNT(*) as c FROM embedding_metadata').get() as any).c;

    return {
      enabled: this.config.enabled,
      providerId: this.provider?.id ?? null,
      totalNodes,
      embeddedNodes,
      processing: this.queue?.isProcessing ?? false,
    };
  }

  getConfig(): EmbeddingConfig {
    return { ...this.config };
  }

  isEnabled(): boolean {
    return this.config.enabled && this.provider !== null;
  }

  onProgress(cb: (progress: { done: number; total: number }) => void): () => void {
    this.progressListeners.add(cb);
    return () => this.progressListeners.delete(cb);
  }

  async dispose(): Promise<void> {
    if (this.provider) {
      await this.provider.dispose();
      this.provider = null;
    }
    this.queue = null;
    this.progressListeners.clear();
  }
}
