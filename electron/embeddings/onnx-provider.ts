import { Worker } from 'worker_threads';
import { join } from 'path';
import { homedir } from 'os';
import type { EmbeddingProvider } from '../../src/embeddings/types';

const DEFAULT_CACHE_DIR = process.env.SYNAPSE_MODELS_DIR
  || join(homedir(), '.synapse', 'models');

export class OnnxProvider implements EmbeddingProvider {
  readonly id: string;
  readonly name = 'Local (MiniLM)';
  readonly dimensions = 384;
  readonly maxTokens = 256;

  private worker: Worker | null = null;
  private pendingRequests = new Map<string, { resolve: (v: Float32Array[]) => void; reject: (e: Error) => void }>();
  private modelQuality: 'quantized' | 'full';
  private cacheDir: string;
  private workerPath: string;

  constructor(
    modelQuality: 'quantized' | 'full' = 'quantized',
    cacheDir?: string,
    workerPath?: string,
  ) {
    this.modelQuality = modelQuality;
    this.id = modelQuality === 'full' ? 'onnx-minilm-full' : 'onnx-minilm';
    this.cacheDir = cacheDir || DEFAULT_CACHE_DIR;
    this.workerPath = workerPath || process.env.SYNAPSE_ONNX_WORKER_PATH || join(__dirname, 'embeddings', 'onnx-worker.cjs');
  }

  async initialize(): Promise<void> {
    this.worker = new Worker(this.workerPath);

    this.worker.on('error', (e) => {
      console.error('[onnx-worker] Thread error:', e);
    });

    this.worker.on('message', (msg: { type: string; requestId?: string; vectors?: Float32Array[]; error?: string }) => {
      if (msg.type === 'result' && msg.requestId && msg.vectors) {
        this.pendingRequests.get(msg.requestId)?.resolve(msg.vectors);
        this.pendingRequests.delete(msg.requestId);
      } else if (msg.type === 'error' && msg.requestId) {
        this.pendingRequests.get(msg.requestId)?.reject(new Error(msg.error ?? 'ONNX worker error'));
        this.pendingRequests.delete(msg.requestId);
      }
    });

    await new Promise<void>((resolve, reject) => {
      const onMsg = (msg: { type: string; error?: string }) => {
        if (msg.type === 'ready') {
          this.worker?.off('message', onMsg);
          resolve();
        } else if (msg.type === 'error') {
          this.worker?.off('message', onMsg);
          reject(new Error(msg.error ?? 'Model load failed'));
        }
      };
      this.worker!.on('message', onMsg);
      this.worker!.postMessage({ type: 'load', modelQuality: this.modelQuality, cacheDir: this.cacheDir });
    });
  }

  async embed(text: string): Promise<Float32Array> {
    const results = await this.embedBatch([text]);
    return results[0];
  }

  async embedBatch(texts: string[]): Promise<Float32Array[]> {
    if (!this.worker) throw new Error('ONNX provider not initialized');
    const chunkSize = this.modelQuality === 'full' ? 12 : 32;
    const allResults: Float32Array[] = [];

    for (let i = 0; i < texts.length; i += chunkSize) {
      const chunk = texts.slice(i, i + chunkSize);
      const requestId = crypto.randomUUID();
      const vectors = await new Promise<Float32Array[]>((resolve, reject) => {
        this.pendingRequests.set(requestId, { resolve, reject });
        this.worker!.postMessage({ type: 'embed', texts: chunk, requestId });
      });
      allResults.push(...vectors);
    }
    return allResults;
  }

  async isAvailable(): Promise<boolean> {
    return this.worker !== null;
  }

  async dispose(): Promise<void> {
    if (this.worker) {
      await this.worker.terminate();
      this.worker = null;
    }
    this.pendingRequests.clear();
  }
}
