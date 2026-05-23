import type { ExtractionRequest, LLMResult } from '../platform/types';
import {
  extractionResultSchema,
  type ExtractionResultParsed,
} from '../shared/schema';
import type {
  IngestionSource,
  ProcessingMode,
  ProcessedContent,
  ContentChunk,
} from './types';
import { getProcessor } from './processor-factory';

// ---------------------------------------------------------------------------
// Callback interface — callers provide platform-specific LLM streaming
// ---------------------------------------------------------------------------

export interface IngestionCallbacks {
  onProgress?: (pct: number, msg: string) => void;
  streamExtraction: (
    request: ExtractionRequest,
    onChunk: (text: string) => void,
  ) => Promise<LLMResult>;
  getSystemPrompt: (notesEnabled: boolean) => string;
  notesEnabled: boolean;
  model: string;
}

// ---------------------------------------------------------------------------
// Pipeline result
// ---------------------------------------------------------------------------

export interface IngestionPipelineResult {
  result: ExtractionResultParsed;
  content: ProcessedContent;
  totalInputTokens: number;
  totalOutputTokens: number;
}

// ---------------------------------------------------------------------------
// Source creation helpers
// ---------------------------------------------------------------------------

export async function createIngestionSourceFromFile(
  file: File,
): Promise<IngestionSource> {
  const data = await file.arrayBuffer();
  return {
    type: 'file',
    mimeType: file.type || 'application/octet-stream',
    name: file.name,
    data,
    size: file.size,
  };
}

export function createIngestionSourceFromClipboard(
  data: ArrayBuffer,
  mimeType: string,
  name: string,
): IngestionSource {
  return {
    type: 'clipboard',
    mimeType,
    name,
    data,
    size: data.byteLength,
  };
}

export function createIngestionSourceFromUrl(url: string): IngestionSource {
  return {
    type: 'url',
    mimeType: 'text/html',
    name: url,
    data: url,
    size: url.length,
  };
}

// ---------------------------------------------------------------------------
// Pipeline runner
// ---------------------------------------------------------------------------

export async function runIngestionPipeline(
  source: IngestionSource,
  mode: ProcessingMode,
  callbacks: IngestionCallbacks,
): Promise<IngestionPipelineResult> {
  const { onProgress } = callbacks;

  // 1. Resolve processor
  const processor = getProcessor(source);
  if (!processor) {
    throw new Error(
      `No processor found for "${source.name}" (${source.mimeType})`,
    );
  }

  // 2. Preprocess — progress 0-40%
  const progressProxy = onProgress
    ? (pct: number, msg: string) => onProgress(Math.round(pct * 0.4), msg)
    : undefined;

  const content = await processor.preprocess(source, mode, progressProxy);

  // 3. Build system prompt + extraction context
  const systemPrompt = callbacks.getSystemPrompt(callbacks.notesEnabled);
  const extraContext = processor.getExtractionContext?.() ?? '';

  onProgress?.(40, 'Starting extraction...');

  // 4. Image content — single extraction call with the data URI
  if (content.text.startsWith('data:image/')) {
    const llmResult = await extractSingleChunk(
      content.text,
      systemPrompt,
      extraContext,
      callbacks,
      [],
    );
    onProgress?.(100, 'Extraction complete');
    return {
      result: llmResult.parsed,
      content,
      totalInputTokens: llmResult.inputTokens,
      totalOutputTokens: llmResult.outputTokens,
    };
  }

  // 5. Multiple chunks — chunked extraction with entity carry-forward
  if (content.chunks && content.chunks.length > 1) {
    const chunkResults: ExtractionResultParsed[] = [];
    let totalInputTokens = 0;
    let totalOutputTokens = 0;
    let previousEntityNames: string[] = [];

    for (let i = 0; i < content.chunks.length; i++) {
      const chunk = content.chunks[i];
      const pct = 40 + Math.round(((i + 1) / content.chunks.length) * 60);
      onProgress?.(
        pct,
        `Extracting chunk ${i + 1} of ${content.chunks.length}...`,
      );

      const llmResult = await extractSingleChunk(
        chunk.text,
        systemPrompt,
        extraContext,
        callbacks,
        previousEntityNames,
      );

      // Stamp sourceLocation from the chunk onto extracted items that lack one
      stampSourceLocation(llmResult.parsed, chunk);

      // Collect entity names for carry-forward
      previousEntityNames = [
        ...previousEntityNames,
        ...llmResult.parsed.nodes.map((n) => n.name),
      ];
      // Deduplicate
      previousEntityNames = [...new Set(previousEntityNames)];

      chunkResults.push(llmResult.parsed);
      totalInputTokens += llmResult.inputTokens;
      totalOutputTokens += llmResult.outputTokens;
    }

    onProgress?.(100, 'Extraction complete');
    return {
      result: mergeExtractionResults(chunkResults),
      content,
      totalInputTokens,
      totalOutputTokens,
    };
  }

  // 6. Single chunk — one extraction call
  const llmResult = await extractSingleChunk(
    content.text,
    systemPrompt,
    extraContext,
    callbacks,
    [],
  );

  // Stamp location from first chunk if available
  if (content.chunks?.[0]) {
    stampSourceLocation(llmResult.parsed, content.chunks[0]);
  }

  onProgress?.(100, 'Extraction complete');
  return {
    result: llmResult.parsed,
    content,
    totalInputTokens: llmResult.inputTokens,
    totalOutputTokens: llmResult.outputTokens,
  };
}

// ---------------------------------------------------------------------------
// extractSingleChunk — builds prompt, streams LLM, parses result
// ---------------------------------------------------------------------------

interface ChunkExtractionResult {
  parsed: ExtractionResultParsed;
  inputTokens: number;
  outputTokens: number;
}

async function extractSingleChunk(
  text: string,
  systemPrompt: string,
  extraContext: string,
  callbacks: IngestionCallbacks,
  previousEntityNames: string[],
): Promise<ChunkExtractionResult> {
  // Build carry-forward block
  let carryForward = '';
  if (previousEntityNames.length > 0) {
    carryForward = `\n\nPreviously extracted entities (link to these when the same entity is mentioned): ${previousEntityNames.join(', ')}`;
  }

  // Combine prompt parts
  const fullSystemPrompt = [systemPrompt, extraContext, carryForward]
    .filter(Boolean)
    .join('\n\n');

  // Stream extraction
  let accumulated = '';
  const llmResult: LLMResult = await callbacks.streamExtraction(
    {
      prompt: text,
      model: callbacks.model,
      systemPrompt: fullSystemPrompt,
    },
    (chunk) => {
      accumulated += chunk;
    },
  );

  // Use full content from the LLM result if available, otherwise use accumulated chunks
  const responseText = llmResult.content || accumulated;

  // Parse JSON from response
  const parsed = parseExtractionResponse(responseText);

  return {
    parsed,
    inputTokens: llmResult.inputTokens,
    outputTokens: llmResult.outputTokens,
  };
}

// ---------------------------------------------------------------------------
// parseExtractionResponse — extract JSON from LLM text, validate with Zod
// ---------------------------------------------------------------------------

function parseExtractionResponse(text: string): ExtractionResultParsed {
  // Try to find JSON object in the response (LLMs sometimes wrap in markdown)
  const jsonMatch = text.match(/\{[\s\S]*\}/);
  if (!jsonMatch) {
    throw new Error('No JSON object found in extraction response');
  }

  let raw: unknown;
  try {
    raw = JSON.parse(jsonMatch[0]);
  } catch {
    throw new Error('Failed to parse extraction response as JSON');
  }

  return extractionResultSchema.parse(raw);
}

// ---------------------------------------------------------------------------
// stampSourceLocation — apply chunk location to items missing one
// ---------------------------------------------------------------------------

function stampSourceLocation(
  result: ExtractionResultParsed,
  chunk: ContentChunk,
): void {
  for (const node of result.nodes) {
    if (!node.sourceLocation) {
      node.sourceLocation = chunk.location;
    }
  }
  for (const edge of result.edges) {
    if (!edge.sourceLocation) {
      edge.sourceLocation = chunk.location;
    }
  }
}

// ---------------------------------------------------------------------------
// mergeExtractionResults — concatenate nodes/edges/notes from all chunks
// ---------------------------------------------------------------------------

function mergeExtractionResults(
  results: ExtractionResultParsed[],
): ExtractionResultParsed {
  return {
    nodes: results.flatMap((r) => r.nodes),
    edges: results.flatMap((r) => r.edges),
    notes: results.flatMap((r) => r.notes),
  };
}
