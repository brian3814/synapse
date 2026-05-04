import type { EmbeddingProvider } from '../../src/embeddings/types';

interface OpenAIEmbeddingResponse {
  data: Array<{ embedding: number[]; index: number }>;
  usage: { prompt_tokens: number; total_tokens: number };
}

export class OpenAIProvider implements EmbeddingProvider {
  readonly id: string;
  readonly name: string;
  readonly dimensions: number;
  readonly maxTokens = 8191;

  private apiKey: string;
  private model: string;

  constructor(apiKey: string, model: string = 'text-embedding-3-small') {
    this.apiKey = apiKey;
    this.model = model;
    this.id = model === 'text-embedding-3-large' ? 'openai-large' : 'openai-small';
    this.name = `OpenAI (${model})`;
    this.dimensions = model === 'text-embedding-3-large' ? 3072 : 1536;
  }

  async initialize(): Promise<void> {
    const available = await this.isAvailable();
    if (!available) throw new Error('OpenAI API key is invalid or API is unreachable');
  }

  async embed(text: string): Promise<Float32Array> {
    const results = await this.embedBatch([text]);
    return results[0];
  }

  async embedBatch(texts: string[]): Promise<Float32Array[]> {
    const allResults: Float32Array[] = [];
    const batchSize = 100;

    for (let i = 0; i < texts.length; i += batchSize) {
      const chunk = texts.slice(i, i + batchSize);
      const response = await this.callAPIWithRetry(chunk);
      const sorted = response.data.sort((a, b) => a.index - b.index);
      for (const item of sorted) {
        allResults.push(new Float32Array(item.embedding));
      }
    }
    return allResults;
  }

  async isAvailable(): Promise<boolean> {
    try {
      await this.callAPI(['test']);
      return true;
    } catch {
      return false;
    }
  }

  async dispose(): Promise<void> {}

  private async callAPIWithRetry(input: string[], maxRetries = 3, baseDelay = 1000): Promise<OpenAIEmbeddingResponse> {
    let lastError: unknown;
    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      try {
        return await this.callAPI(input);
      } catch (e) {
        lastError = e;
        if (attempt >= maxRetries) break;
        await new Promise(resolve => setTimeout(resolve, baseDelay * Math.pow(2, attempt)));
      }
    }
    throw lastError;
  }

  private async callAPI(input: string[]): Promise<OpenAIEmbeddingResponse> {
    const response = await fetch('https://api.openai.com/v1/embeddings', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify({ input, model: this.model }),
    });

    if (!response.ok) {
      const text = await response.text();
      throw new Error(`OpenAI API error ${response.status}: ${text}`);
    }

    return response.json();
  }
}
