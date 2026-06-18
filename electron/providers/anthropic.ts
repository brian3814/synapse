import {
  executeLLMRequestStreaming,
  streamAnthropicWithTools,
} from '../../src/offscreen/llm-executor';
import type { ModelProvider, ModelInfo } from '../../src/core/model-provider';

const KNOWN_PRICING: Record<string, { inputPer1M: number; outputPer1M: number }> = {
  'claude-opus-4-8':   { inputPer1M: 5.00, outputPer1M: 25.00 },
  'claude-opus-4-7':   { inputPer1M: 5.00, outputPer1M: 25.00 },
  'claude-opus-4-6':   { inputPer1M: 5.00, outputPer1M: 25.00 },
  'claude-sonnet-4-6': { inputPer1M: 3.00, outputPer1M: 15.00 },
  'claude-haiku-4-5':  { inputPer1M: 1.00, outputPer1M: 5.00  },
};

const FALLBACK_ANTHROPIC_MODELS: ModelInfo[] = [
  { id: 'claude-opus-4-8',   label: 'Claude Opus 4.8',   provider: 'anthropic', contextWindow: 1_000_000, maxOutputTokens: 128_000, supportsTools: true, pricing: KNOWN_PRICING['claude-opus-4-8'] },
  { id: 'claude-sonnet-4-6', label: 'Claude Sonnet 4.6', provider: 'anthropic', contextWindow: 1_000_000, maxOutputTokens: 64_000,  supportsTools: true, pricing: KNOWN_PRICING['claude-sonnet-4-6'] },
  { id: 'claude-haiku-4-5',  label: 'Claude Haiku 4.5',  provider: 'anthropic', contextWindow: 200_000,   maxOutputTokens: 64_000,  supportsTools: true, pricing: KNOWN_PRICING['claude-haiku-4-5'] },
];

function buildHeaders(apiKey: string): Record<string, string> {
  return {
    'Content-Type': 'application/json',
    ...(apiKey.startsWith('sk-ant-')
      ? { 'x-api-key': apiKey }
      : { 'Authorization': `Bearer ${apiKey}` }),
    'anthropic-version': '2023-06-01',
  };
}

async function listModels(apiKey: string): Promise<ModelInfo[]> {
  try {
    const response = await fetch('https://api.anthropic.com/v1/models', {
      method: 'GET',
      headers: buildHeaders(apiKey),
    });

    if (!response.ok) {
      console.warn(`[AnthropicProvider] /v1/models returned ${response.status}, using fallback`);
      return FALLBACK_ANTHROPIC_MODELS;
    }

    const body = await response.json() as { data: Array<{
      id: string;
      display_name: string;
      max_input_tokens?: number;
      max_tokens?: number;
    }> };

    return body.data.map((m): ModelInfo => ({
      id: m.id,
      label: m.display_name || m.id,
      provider: 'anthropic',
      contextWindow: m.max_input_tokens,
      maxOutputTokens: m.max_tokens,
      supportsTools: true,
      pricing: KNOWN_PRICING[m.id],
    }));
  } catch (e) {
    console.warn('[AnthropicProvider] Failed to fetch models, using fallback:', e);
    return FALLBACK_ANTHROPIC_MODELS;
  }
}

export const anthropicProvider: ModelProvider = {
  id: 'anthropic',
  label: 'Anthropic',
  listModels,
  streamWithTools: streamAnthropicWithTools,
  streamExtraction: executeLLMRequestStreaming,
  validateKeyFormat(key: string): string | null {
    if (!key || key.length < 10) return 'API key too short';
    return null;
  },
};
