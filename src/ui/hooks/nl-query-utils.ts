import { nodes, edges } from '../../db/client/db-client';
import { graphQuerySchema } from '../../db/worker/query-engine/schema';
import { storage } from '@platform';

export function streamFromOffscreen(
  requestId: string,
  onChunk: (text: string) => void
): Promise<{ content?: string; error?: string }> {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      cleanup();
      reject(new Error('LLM stream timed out after 120s'));
    }, 120_000);

    const listener = (message: any) => {
      if (message.type !== 'LLM_STREAM_CHUNK' || message.payload?.requestId !== requestId) return;
      const { chunk, done, content, error } = message.payload;
      if (chunk) onChunk(chunk);
      if (done) {
        cleanup();
        resolve({ content, error });
      }
    };

    const cleanup = () => {
      clearTimeout(timeout);
      chrome.runtime.onMessage.removeListener(listener);
    };

    chrome.runtime.onMessage.addListener(listener);
  });
}

export async function fetchLLMConfigAndTypes() {
  const [nodeTypesList, edgeTypesList, storageResult] = await Promise.all([
    nodes.getTypes(),
    edges.getTypes(),
    storage.get('llmConfig') as Promise<Record<string, any>>,
  ]);

  const config = storageResult.llmConfig;
  if (!config?.apiKey) {
    throw new Error('No API key configured. Go to Settings to add one.');
  }

  return { nodeTypesList, edgeTypesList, config };
}

export function parseJsonFromLLMResponse(content: string) {
  const jsonMatch = content.match(/\{[\s\S]*\}/);
  if (!jsonMatch) {
    throw new Error('No JSON found in LLM response');
  }

  const rawJson = jsonMatch[0];
  const parsed = JSON.parse(rawJson);
  const validated = graphQuerySchema.parse(parsed);

  return { rawJson, validated };
}
