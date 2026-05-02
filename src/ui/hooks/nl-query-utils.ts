import { nodes, edges } from '../../db/client/db-client';
import { graphQuerySchema } from '../../db/worker/query-engine/schema';
import { storage } from '@platform';

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
