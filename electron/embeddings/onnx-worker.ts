import { parentPort } from 'worker_threads';

let pipeline: any = null;

async function loadModel(modelQuality: 'quantized' | 'full', cacheDir: string) {
  const { pipeline: createPipeline, env } = await import('@huggingface/transformers');
  env.cacheDir = cacheDir;
  env.allowLocalModels = true;

  const modelId = 'Xenova/all-MiniLM-L6-v2';
  const options: Record<string, unknown> = {};
  if (modelQuality === 'quantized') {
    options.quantized = true;
  }

  pipeline = await createPipeline('feature-extraction', modelId, options);
  parentPort?.postMessage({ type: 'ready' });
}

async function embed(texts: string[]): Promise<Float32Array[]> {
  if (!pipeline) throw new Error('Model not loaded');
  const output = await pipeline(texts, { pooling: 'mean', normalize: true });
  const results: Float32Array[] = [];
  for (let i = 0; i < texts.length; i++) {
    results.push(new Float32Array(output[i].data));
  }
  return results;
}

parentPort?.on('message', async (msg: { type: string; texts?: string[]; requestId?: string; modelQuality?: 'quantized' | 'full'; cacheDir?: string }) => {
  try {
    if (msg.type === 'load') {
      await loadModel(msg.modelQuality ?? 'quantized', msg.cacheDir ?? '');
    } else if (msg.type === 'embed' && msg.texts && msg.requestId) {
      const vectors = await embed(msg.texts);
      const transferable = vectors.map((v) => v.buffer as ArrayBuffer);
      parentPort?.postMessage(
        { type: 'result', requestId: msg.requestId, vectors },
        transferable,
      );
    }
  } catch (e: any) {
    parentPort?.postMessage({ type: 'error', requestId: msg.requestId, error: e.message });
  }
});
