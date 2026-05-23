# Multi-Modal Ingestion Phase 2: Processors + Pipeline

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement the PDF and Image content processors, the ingestion pipeline orchestrator, chunked extraction with entity carry-forward, and integrate the `startIngestion()` method into the `useLLMExtraction` hook.

**Architecture:** Each processor implements the `ContentProcessor` interface from Phase 1. The pipeline orchestrator (`ingestion-pipeline.ts`) coordinates: normalize source → resolve processor → check harness → preprocess → chunked LLM extraction → merge results. The `useLLMExtraction` hook gains a `startIngestion()` method that drives the pipeline and feeds results into the existing review flow.

**Tech Stack:** TypeScript, pdfjs-dist, Canvas API, Zod, Anthropic Claude vision API

**Spec:** `docs/superpowers/specs/2026-05-03-multi-modal-ingestion-design.md`

**Depends on:** Phase 1 (types, schema, Zod extension, factory)

**No test framework is configured.** Verify each task by running `npm run build` (Chrome) and checking for compile errors.

---

### Task 1: Install pdfjs-dist dependency

**Files:**
- Modify: `package.json`

- [ ] **Step 1: Install pdfjs-dist**

Run: `npm install pdfjs-dist`

This is Mozilla's PDF.js library (~400KB gzipped). Pure JS, no WASM, no native deps. Works in any browser context with DOM access.

- [ ] **Step 2: Verify it installed**

Run: `npm ls pdfjs-dist`
Expected: Shows pdfjs-dist version in the dependency tree

- [ ] **Step 3: Commit**

```bash
git add package.json package-lock.json
git commit -m "chore: add pdfjs-dist dependency for PDF processing"
```

---

### Task 2: Implement PDF processor

**Files:**
- Create: `src/ingestion/processors/pdf-processor.ts`

- [ ] **Step 1: Create the PDF processor**

Create `src/ingestion/processors/pdf-processor.ts`:

```ts
import * as pdfjsLib from 'pdfjs-dist';
import type {
  ContentProcessor,
  IngestionSource,
  ProcessedContent,
  ProcessingMode,
  ContentChunk,
  ModePromptResult,
} from '../types';

const PAGES_PER_CHUNK = 10;
const LARGE_DOC_THRESHOLD = 50;

export const pdfProcessor: ContentProcessor = {
  id: 'pdf',
  supportedMimeTypes: ['application/pdf'],
  supportedExtensions: ['.pdf'],

  canProcess(source: IngestionSource): boolean {
    if (source.mimeType === 'application/pdf') return true;
    const ext = source.name.toLowerCase().split('.').pop();
    return ext === 'pdf';
  },

  shouldPromptMode(source: IngestionSource): ModePromptResult {
    // We can't know page count without loading the PDF, so we estimate from
    // file size. ~5KB per page is a reasonable heuristic for text-heavy PDFs.
    const estimatedPages = Math.ceil(source.size / 5000);
    if (estimatedPages > LARGE_DOC_THRESHOLD) {
      return {
        prompt: true,
        reason: `This PDF is approximately ${estimatedPages} pages`,
        estimatedCost: `~$${(estimatedPages * 0.003).toFixed(2)}`,
      };
    }
    return { prompt: false };
  },

  async preprocess(
    source: IngestionSource,
    mode: ProcessingMode,
    onProgress?: (pct: number, msg: string) => void,
  ): Promise<ProcessedContent> {
    const data = source.data instanceof ArrayBuffer
      ? new Uint8Array(source.data)
      : new TextEncoder().encode(source.data as string);

    const pdf = await pdfjsLib.getDocument({ data }).promise;
    const numPages = pdf.numPages;

    // Extract metadata
    const info = await pdf.getMetadata().catch(() => null);
    const metadata = {
      title: (info?.info as any)?.Title ?? undefined,
      author: (info?.info as any)?.Author ?? undefined,
      pageCount: numPages,
    };

    onProgress?.(5, `Loaded PDF: ${numPages} pages`);

    // Determine page range based on mode
    let startPage = 1;
    let endPage = numPages;

    if (mode === 'quick') {
      endPage = Math.min(3, numPages);
    }

    // Extract text page by page
    const pageTexts: Array<{ page: number; text: string }> = [];
    for (let i = startPage; i <= endPage; i++) {
      const page = await pdf.getPage(i);
      const content = await page.getTextContent();
      const text = content.items
        .map((item: any) => item.str)
        .join(' ')
        .replace(/\s+/g, ' ')
        .trim();

      if (text.length > 0) {
        pageTexts.push({ page: i, text });
      }

      const pct = 5 + Math.round(((i - startPage) / (endPage - startPage + 1)) * 90);
      onProgress?.(pct, `Extracting page ${i}/${endPage}...`);
    }

    // Build chunks by grouping pages
    const chunks: ContentChunk[] = [];
    for (let i = 0; i < pageTexts.length; i += PAGES_PER_CHUNK) {
      const group = pageTexts.slice(i, i + PAGES_PER_CHUNK);
      const chunkText = group
        .map((p) => `[Page ${p.page}]\n${p.text}`)
        .join('\n\n');

      chunks.push({
        text: chunkText,
        location: {
          type: 'page',
          page: group[0].page,
          section: group.length > 1
            ? `Pages ${group[0].page}-${group[group.length - 1].page}`
            : `Page ${group[0].page}`,
        },
        index: chunks.length,
      });
    }

    // Full text for single-chunk processing
    const fullText = pageTexts
      .map((p) => `[Page ${p.page}]\n${p.text}`)
      .join('\n\n');

    onProgress?.(100, 'PDF extraction complete');

    return {
      text: fullText,
      chunks: chunks.length > 1 ? chunks : undefined,
      metadata,
    };
  },

  getExtractionContext(): string {
    return 'Content extracted from a PDF document. Page numbers are provided in [Page N] markers. Use these for source location references in sourceLocation fields with type "page".';
  },
};
```

- [ ] **Step 2: Configure pdfjs-dist worker**

pdfjs-dist needs a worker URL configured. At the top of the processor file, after imports, add:

```ts
// Disable the worker — run parsing on the main thread.
// In a Chrome extension / Electron renderer, the worker URL is hard to
// configure correctly across build targets. The perf hit is negligible
// for text extraction (no rendering).
pdfjsLib.GlobalWorkerOptions.workerSrc = '';
```

Note: Setting `workerSrc` to empty string disables the worker and runs parsing on the main thread. This is fine for text extraction (we're not rendering pages). It avoids complex worker URL configuration across Chrome extension and Electron build targets.

- [ ] **Step 3: Verify it compiles**

Run: `npm run build 2>&1 | tail -10`
Expected: Build succeeds. If pdfjs-dist has import issues with the Vite build, check if `optimizeDeps` needs updating in `vite.config.chrome.ts` or `vite.config.electron.ts`.

- [ ] **Step 4: Commit**

```bash
git add src/ingestion/processors/pdf-processor.ts
git commit -m "feat(ingestion): implement PDF content processor"
```

---

### Task 3: Implement Image processor

**Files:**
- Create: `src/ingestion/processors/image-processor.ts`

- [ ] **Step 1: Create the Image processor**

Create `src/ingestion/processors/image-processor.ts`:

```ts
import type {
  ContentProcessor,
  IngestionSource,
  ProcessedContent,
  ProcessingMode,
  ModePromptResult,
} from '../types';

const MAX_DIMENSION = 2048;
const IMAGE_MIME_TYPES = ['image/png', 'image/jpeg', 'image/webp', 'image/gif', 'image/svg+xml'];
const IMAGE_EXTENSIONS = ['.png', '.jpg', '.jpeg', '.webp', '.gif', '.svg'];

function arrayBufferToBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let binary = '';
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

async function resizeIfNeeded(
  data: ArrayBuffer,
  mimeType: string,
  onProgress?: (pct: number, msg: string) => void,
): Promise<{ data: ArrayBuffer; mimeType: string; width: number; height: number }> {
  const blob = new Blob([data], { type: mimeType });
  const url = URL.createObjectURL(blob);

  try {
    const img = new Image();
    await new Promise<void>((resolve, reject) => {
      img.onload = () => resolve();
      img.onerror = () => reject(new Error('Failed to load image'));
      img.src = url;
    });

    const { naturalWidth: w, naturalHeight: h } = img;

    // No resize needed if within bounds
    if (w <= MAX_DIMENSION && h <= MAX_DIMENSION) {
      onProgress?.(50, `Image ${w}x${h} — no resize needed`);
      return { data, mimeType, width: w, height: h };
    }

    // Scale down preserving aspect ratio
    const scale = Math.min(MAX_DIMENSION / w, MAX_DIMENSION / h);
    const newW = Math.round(w * scale);
    const newH = Math.round(h * scale);

    onProgress?.(30, `Resizing from ${w}x${h} to ${newW}x${newH}...`);

    const canvas = document.createElement('canvas');
    canvas.width = newW;
    canvas.height = newH;
    const ctx = canvas.getContext('2d')!;
    ctx.drawImage(img, 0, 0, newW, newH);

    const outputMime = mimeType === 'image/svg+xml' ? 'image/png' : mimeType;
    const resizedBlob = await new Promise<Blob>((resolve, reject) => {
      canvas.toBlob(
        (b) => (b ? resolve(b) : reject(new Error('Canvas toBlob failed'))),
        outputMime,
        0.9,
      );
    });

    const resizedBuffer = await resizedBlob.arrayBuffer();
    onProgress?.(50, `Resized to ${newW}x${newH}`);
    return { data: resizedBuffer, mimeType: outputMime, width: newW, height: newH };
  } finally {
    URL.revokeObjectURL(url);
  }
}

export const imageProcessor: ContentProcessor = {
  id: 'image',
  supportedMimeTypes: IMAGE_MIME_TYPES,
  supportedExtensions: IMAGE_EXTENSIONS,

  canProcess(source: IngestionSource): boolean {
    if (IMAGE_MIME_TYPES.includes(source.mimeType)) return true;
    const ext = '.' + source.name.toLowerCase().split('.').pop();
    return IMAGE_EXTENSIONS.includes(ext);
  },

  shouldPromptMode(): ModePromptResult {
    return { prompt: false };
  },

  async preprocess(
    source: IngestionSource,
    _mode: ProcessingMode,
    onProgress?: (pct: number, msg: string) => void,
  ): Promise<ProcessedContent> {
    if (!(source.data instanceof ArrayBuffer)) {
      throw new Error('Image source must provide ArrayBuffer data');
    }

    onProgress?.(10, 'Processing image...');

    const { data, mimeType, width, height } = await resizeIfNeeded(
      source.data,
      source.mimeType,
      onProgress,
    );

    // Encode as base64 — this will be sent as vision content to the LLM
    const base64 = arrayBufferToBase64(data);

    onProgress?.(100, 'Image ready for extraction');

    return {
      // The text field carries the base64 data for vision API consumption.
      // The pipeline orchestrator detects image content and sends it as
      // a vision message instead of a text prompt.
      text: `data:${mimeType};base64,${base64}`,
      metadata: {
        title: source.name,
        dimensions: { w: width, h: height },
      },
    };
  },

  getExtractionContext(): string {
    return 'Extract entities and relationships from this image. Describe spatial regions when referencing where entities appear, using sourceLocation with type "region".';
  },
};
```

- [ ] **Step 2: Verify it compiles**

Run: `npm run build 2>&1 | tail -5`
Expected: Build succeeds

- [ ] **Step 3: Commit**

```bash
git add src/ingestion/processors/image-processor.ts
git commit -m "feat(ingestion): implement Image content processor"
```

---

### Task 4: Register processors in factory

**Files:**
- Modify: `src/ingestion/processor-factory.ts`

- [ ] **Step 1: Import and register both processors**

In `src/ingestion/processor-factory.ts`, add imports for both processors and register them:

```ts
import type { ContentProcessor, IngestionSource } from './types';
import { pdfProcessor } from './processors/pdf-processor';
import { imageProcessor } from './processors/image-processor';

const processors: ContentProcessor[] = [
  pdfProcessor,
  imageProcessor,
];

export function registerProcessor(processor: ContentProcessor): void {
  processors.push(processor);
}

export function getProcessor(source: IngestionSource): ContentProcessor | null {
  return processors.find((p) => p.canProcess(source)) ?? null;
}

export function getSupportedExtensions(): string[] {
  return processors.flatMap((p) => p.supportedExtensions);
}

export function getSupportedMimeTypes(): string[] {
  return processors.flatMap((p) => p.supportedMimeTypes);
}
```

- [ ] **Step 2: Verify it compiles**

Run: `npm run build 2>&1 | tail -5`
Expected: Build succeeds

- [ ] **Step 3: Commit**

```bash
git add src/ingestion/processor-factory.ts
git commit -m "feat(ingestion): register PDF and Image processors in factory"
```

---

### Task 5: Implement ingestion pipeline orchestrator

**Files:**
- Create: `src/ingestion/ingestion-pipeline.ts`

- [ ] **Step 1: Create the pipeline orchestrator**

Create `src/ingestion/ingestion-pipeline.ts`. This module orchestrates: normalize source → resolve processor → preprocess → chunked LLM extraction with carry-forward → merge results into a single `ExtractionResultParsed`.

```ts
import type {
  IngestionSource,
  ProcessedContent,
  ProcessingMode,
  ContentChunk,
} from './types';
import { getProcessor } from './processor-factory';
import { extractionResultSchema, type ExtractionResultParsed } from '../shared/schema';
import type { ExtractionRequest, LLMResult } from '../platform/types';

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

export function createIngestionSource(
  file: File,
): IngestionSource {
  return {
    type: 'file',
    mimeType: file.type || 'application/octet-stream',
    name: file.name,
    data: file.arrayBuffer ? file : (file as any),
    size: file.size,
  };
}

export async function createIngestionSourceFromFile(
  file: File,
): Promise<IngestionSource> {
  const buffer = await file.arrayBuffer();
  return {
    type: 'file',
    mimeType: file.type || 'application/octet-stream',
    name: file.name,
    data: buffer,
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

export function createIngestionSourceFromUrl(
  url: string,
): IngestionSource {
  return {
    type: 'url',
    mimeType: '',
    name: url,
    data: url,
    size: 0,
  };
}

function isImageContent(content: ProcessedContent): boolean {
  return content.text.startsWith('data:image/');
}

async function extractSingleChunk(
  text: string,
  systemPrompt: string,
  extraContext: string,
  callbacks: IngestionCallbacks,
  previousEntities: string[],
): Promise<ExtractionResultParsed> {
  let carryForwardBlock = '';
  if (previousEntities.length > 0) {
    carryForwardBlock = `\n\nPreviously extracted entities (link to these when the same entity is mentioned): ${previousEntities.join(', ')}`;
  }

  const fullPrompt = `${text}${carryForwardBlock}`;
  const fullSystem = `${systemPrompt}\n\n${extraContext}`;

  let accumulated = '';
  const result = await callbacks.streamExtraction(
    {
      prompt: fullPrompt,
      model: callbacks.model,
      systemPrompt: fullSystem,
    },
    (chunk) => {
      accumulated += chunk;
    },
  );

  const content = result.content ?? accumulated;
  const jsonMatch = content.match(/\{[\s\S]*\}/);
  if (!jsonMatch) {
    throw new Error('No JSON found in LLM extraction response');
  }

  const parsed = JSON.parse(jsonMatch[0]);
  return extractionResultSchema.parse(parsed);
}

function mergeExtractionResults(results: ExtractionResultParsed[]): ExtractionResultParsed {
  const nodes = results.flatMap((r) => r.nodes);
  const edges = results.flatMap((r) => r.edges);
  const notes = results.flatMap((r) => r.notes);
  return { nodes, edges, notes };
}

export async function runIngestionPipeline(
  source: IngestionSource,
  mode: ProcessingMode,
  callbacks: IngestionCallbacks,
): Promise<{
  result: ExtractionResultParsed;
  content: ProcessedContent;
  totalInputTokens: number;
  totalOutputTokens: number;
}> {
  const processor = getProcessor(source);
  if (!processor) {
    throw new Error(`No processor found for content type: ${source.mimeType}`);
  }

  // Phase 1: Preprocess
  callbacks.onProgress?.(0, 'Preprocessing...');
  const content = await processor.preprocess(source, mode, (pct, msg) => {
    callbacks.onProgress?.(Math.round(pct * 0.4), msg);
  });

  const systemPrompt = callbacks.getSystemPrompt(callbacks.notesEnabled);
  const extraContext = processor.getExtractionContext?.() ?? '';

  let totalInputTokens = 0;
  let totalOutputTokens = 0;

  // Phase 2: LLM Extraction
  if (isImageContent(content)) {
    // Image: vision API — the text field is a data URI
    // The caller (useLLMExtraction) will need to handle this as a vision message.
    // For now, we send it as text and rely on the LLM hook to detect the data URI.
    callbacks.onProgress?.(50, 'Extracting entities from image...');
    const result = await extractSingleChunk(
      content.text,
      systemPrompt,
      extraContext,
      callbacks,
      [],
    );

    return { result, content, totalInputTokens, totalOutputTokens };
  }

  if (content.chunks && content.chunks.length > 1) {
    // Chunked extraction with entity carry-forward
    const chunkResults: ExtractionResultParsed[] = [];
    const knownEntities: string[] = [];

    for (let i = 0; i < content.chunks.length; i++) {
      const chunk = content.chunks[i];
      const pct = 40 + Math.round((i / content.chunks.length) * 55);
      callbacks.onProgress?.(pct, `Extracting chunk ${i + 1}/${content.chunks.length}...`);

      const chunkResult = await extractSingleChunk(
        chunk.text,
        systemPrompt,
        extraContext,
        callbacks,
        knownEntities,
      );

      // Stamp source locations on extracted nodes/edges from this chunk
      for (const node of chunkResult.nodes) {
        if (!node.sourceLocation) {
          (node as any).sourceLocation = chunk.location;
        }
      }
      for (const edge of chunkResult.edges) {
        if (!edge.sourceLocation) {
          (edge as any).sourceLocation = chunk.location;
        }
      }

      chunkResults.push(chunkResult);

      // Carry forward entity names for next chunk
      for (const node of chunkResult.nodes) {
        if (!knownEntities.includes(node.name)) {
          knownEntities.push(node.name);
        }
      }
    }

    const merged = mergeExtractionResults(chunkResults);
    callbacks.onProgress?.(100, 'Extraction complete');
    return { result: merged, content, totalInputTokens, totalOutputTokens };
  }

  // Single chunk — process full text
  callbacks.onProgress?.(50, 'Extracting entities...');
  const result = await extractSingleChunk(
    content.text,
    systemPrompt,
    extraContext,
    callbacks,
    [],
  );

  callbacks.onProgress?.(100, 'Extraction complete');
  return { result, content, totalInputTokens, totalOutputTokens };
}
```

- [ ] **Step 2: Verify it compiles**

Run: `npm run build 2>&1 | tail -10`
Expected: Build succeeds

- [ ] **Step 3: Commit**

```bash
git add src/ingestion/ingestion-pipeline.ts
git commit -m "feat(ingestion): implement pipeline orchestrator with chunked carry-forward"
```

---

### Task 6: Add startIngestion to useLLMExtraction hook

**Files:**
- Modify: `src/ui/hooks/useLLMExtraction.ts`

- [ ] **Step 1: Add imports**

At the top of `src/ui/hooks/useLLMExtraction.ts`, add imports for the ingestion pipeline:

```ts
import type { IngestionSource, ProcessingMode } from '../../ingestion/types';
import { getProcessor } from '../../ingestion/processor-factory';
import { runIngestionPipeline } from '../../ingestion/ingestion-pipeline';
```

- [ ] **Step 2: Add the startIngestion callback**

Inside the `useLLMExtraction()` function, before the `return` statement (around line 1042), add a new `startIngestion` callback:

```ts
  const startIngestion = useCallback(async (source: IngestionSource, mode: ProcessingMode = 'full') => {
    // Privacy disclosure gate
    const disc = await storage.get('privacyDisclosureAccepted') as Record<string, any>;
    if (!disc.privacyDisclosureAccepted) {
      useLLMStore.getState().setShowPrivacyModal(true, () => startIngestion(source, mode));
      return;
    }

    const llmStore = useLLMStore.getState();
    llmStore.setError(null);

    const result = await storage.get('llmConfig') as Record<string, any>;
    const config = result.llmConfig;
    if (!config?.apiKey) {
      llmStore.setError('No API key configured. Go to Settings to add one.');
      return;
    }

    const processor = getProcessor(source);
    if (!processor) {
      llmStore.setError(`Unsupported file type: ${source.mimeType || source.name}`);
      return;
    }

    llmStore.startAgentRun([
      { id: 'preprocess', label: `Processing ${source.name}` },
      { id: 'extract', label: 'Extracting entities via LLM' },
      { id: 'parse', label: 'Parsing results' },
    ]);
    llmStore.setStatus('extracting');
    llmStore.setSourceUrl(source.name);

    const notesOn = await isNotesEnabled();

    try {
      const { result: extractionResult } = await runIngestionPipeline(
        source,
        mode,
        {
          onProgress: (pct, msg) => {
            const store = useLLMStore.getState();
            if (pct < 40) {
              store.appendToCurrentStep(msg + '\n');
            } else if (pct >= 40 && pct < 95) {
              // Move to extract step
              const run = store.agentRun;
              if (run && run.currentStepIndex === 0) {
                store.completeCurrentStep();
                store.advanceStep();
              }
              store.appendToCurrentStep(msg + '\n');
            }
          },
          streamExtraction: (request, onChunk) =>
            llm.streamExtraction(request, onChunk, (info) => {
              useLLMStore.getState().setRateLimitWait({ ...info, startedAt: Date.now() });
            }),
          getSystemPrompt: getQuickExtractSystemPrompt,
          notesEnabled: notesOn,
          model: config.model,
        },
      );

      useLLMStore.getState().setRateLimitWait(null);

      // Advance to parse step
      const store = useLLMStore.getState();
      if (store.agentRun && store.agentRun.currentStepIndex < 2) {
        store.completeCurrentStep();
        store.advanceStep();
      }

      const { items, notes: extractedNotes } = await buildDiffItems(extractionResult);

      store.completeCurrentStep();
      store.setDiff({ items, notes: extractedNotes });
      store.setStatus('extracted');
    } catch (e: any) {
      const llmState = useLLMStore.getState();
      llmState.failCurrentStep(e.message);
      llmState.setError(e.message);
    }
  }, []);
```

- [ ] **Step 3: Add startIngestion to the return value**

Update the return statement to include `startIngestion`:

```ts
  return { startExtraction, startQuickExtraction, startAgentExtraction, startIngestion, applyDiff, applyReview, proceedToReview };
```

- [ ] **Step 4: Verify it compiles**

Run: `npm run build 2>&1 | tail -10`
Expected: Build succeeds

- [ ] **Step 5: Commit**

```bash
git add src/ui/hooks/useLLMExtraction.ts
git commit -m "feat(ingestion): add startIngestion method to useLLMExtraction hook"
```

---

### Task 7: Update barrel export

**Files:**
- Modify: `src/ingestion/index.ts`

- [ ] **Step 1: Add pipeline exports to barrel**

Update `src/ingestion/index.ts` to export pipeline functions:

```ts
export type {
  IngestionSource,
  SourceLocation,
  ProcessingMode,
  ProcessedContent,
  ContentChunk,
  ContentProcessor,
  ModePromptResult,
} from './types';

export { getProcessor, registerProcessor, getSupportedExtensions, getSupportedMimeTypes } from './processor-factory';

export {
  createIngestionSourceFromFile,
  createIngestionSourceFromClipboard,
  createIngestionSourceFromUrl,
  runIngestionPipeline,
} from './ingestion-pipeline';
```

- [ ] **Step 2: Verify it compiles**

Run: `npm run build 2>&1 | tail -5`
Expected: Build succeeds

- [ ] **Step 3: Commit**

```bash
git add src/ingestion/index.ts
git commit -m "feat(ingestion): update barrel export with pipeline functions"
```
