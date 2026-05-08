# Multi-Modal Resource Ingestion — Design Spec

## Goal

Add a modality-extensible content ingestion pipeline that lets users import PDFs, images, and other file types into the knowledge graph. Each modality has its own preprocessing logic, but all converge on the same extraction, review, and merge flow. Initial modalities: PDF and image. Interface designed for future extension (video, audio, social, etc.).

## Architecture

**Pattern:** ContentProcessor interface + factory. Each modality implements the interface. A factory resolves the correct processor by MIME type. The factory is a simple array scan today; it evolves into a dynamic registry (with `register()`) later without changing any processor code.

**Pipeline:** Entry points (drag-drop, paste, URL import) normalize input into an `IngestionSource`. The factory resolves a processor, which preprocesses content into text. From there, the existing shared pipeline handles LLM extraction, review, and graph merge. Source location metadata flows through the entire chain for provenance.

**Processing strategy:** Hybrid per-modality. Each processor picks the most efficient path for its content type. PDF: local text extraction (pdfjs-dist, pure JS) then LLM entity extraction. Image: always vision API (no local alternative). Future modalities make their own call.

**Inspiration:** Karpathy's LLM wiki methodology validates the compile-once model — knowledge is synthesized at ingest time, not re-derived per query. This app's extraction → review → merge pipeline already follows this pattern. The key extension is making ingestion work across content types beyond web page text.

## Core Types

### IngestionSource

Normalized input from any entry point (drag-drop, paste, URL import):

```ts
interface IngestionSource {
  type: 'file' | 'url' | 'clipboard';
  mimeType: string;          // 'application/pdf', 'image/png', etc.
  name: string;              // filename or URL
  data: ArrayBuffer | string; // raw bytes or URL string
  size: number;              // bytes
}
```

### SourceLocation

Discriminated union for per-modality provenance. Each modality adds its own variant without touching existing ones:

```ts
type SourceLocation =
  | { type: 'page';     page: number; section?: string }
  | { type: 'region';   description: string }
  | { type: 'time';     timestamp: string; speaker?: string }
  | { type: 'selector'; selector: string };
```

| Modality | Location Variant | Example |
|---|---|---|
| PDF | `page` | `{ type: 'page', page: 3, section: 'Methods' }` |
| Image | `region` | `{ type: 'region', description: 'top-left org chart' }` |
| Web page | `selector` | `{ type: 'selector', selector: 'p:nth-of-type(5)' }` |
| Future: Video | `time` | `{ type: 'time', timestamp: '14:32' }` |
| Future: Audio | `time` | `{ type: 'time', timestamp: '02:15', speaker: 'Host' }` |

### ProcessingMode

Harness control for processing depth:

```ts
type ProcessingMode = 'quick' | 'full' | 'section';
```

- **quick** — Extract overview only (title, abstract, TOC, key terms). For PDFs >50 pages when user chooses the fast path.
- **full** — Process all content with chunking and entity carry-forward.
- **section** — User picks specific sections/page ranges after a quick scan.

### ProcessedContent

What preprocessing produces — the convergence point where all modalities meet:

```ts
interface ProcessedContent {
  text: string;              // extracted text for LLM
  chunks?: ContentChunk[];   // if chunked (long docs)
  metadata: {
    title?: string;
    author?: string;
    pageCount?: number;
    dimensions?: { w: number; h: number };
  };
}

interface ContentChunk {
  text: string;
  location: SourceLocation;
  index: number;
}
```

## ContentProcessor Interface

```ts
interface ContentProcessor {
  // Identity
  id: string;                        // 'pdf', 'image', 'youtube', ...
  supportedMimeTypes: string[];      // ['application/pdf']
  supportedExtensions: string[];     // ['.pdf']

  // Can this processor handle the given source?
  canProcess(source: IngestionSource): boolean;

  // Should we prompt the user for processing mode?
  shouldPromptMode(source: IngestionSource): {
    prompt: boolean;
    reason?: string;       // "This PDF is 142 pages"
    estimatedCost?: string; // "~$0.15"
  };

  // Convert raw source → text ready for LLM extraction
  preprocess(
    source: IngestionSource,
    mode: ProcessingMode,
    onProgress?: (pct: number, msg: string) => void
  ): Promise<ProcessedContent>;

  // Optional: custom extraction prompt additions
  getExtractionContext?(): string;

  // Optional: store the source file in the vault
  storeSource?(
    source: IngestionSource,
    nodeId: string
  ): Promise<{ vaultPath: string }>;
}
```

### Factory Resolution

```ts
const processors: ContentProcessor[] = [
  pdfProcessor,
  imageProcessor,
  // future: youtubeProcessor, audioProcessor, ...
];

function getProcessor(source: IngestionSource): ContentProcessor | null {
  return processors.find(p => p.canProcess(source)) ?? null;
}
```

**Evolution to registry:** Wrap the factory in a `ProcessorRegistry` class that adds `register(processor)` at runtime. The `ContentProcessor` interface and all implementations stay identical. Only the resolution mechanism changes — no refactoring needed.

## PDF Processor

**File:** `src/ingestion/processors/pdf-processor.ts`

**Library:** pdfjs-dist (Mozilla's PDF.js). ~400KB gzipped, pure JS, no WASM, no native deps. Runs in any JS context with DOM access.

**Processing strategy:**
1. Load PDF via pdfjs-dist `getDocument()`
2. Extract text per page with `page.getTextContent()`
3. Extract metadata from PDF info dict (title, author, pageCount, outline/TOC)
4. Chunk by page groups (~10 pages per chunk)
5. Each `ContentChunk` gets `location: { type: 'page', page: N, section: heading }`

**Harness (shouldPromptMode):**
- `pageCount > 50` → prompt user
- Quick mode: Extract pages 1-3 only (title, abstract, TOC)
- Full mode: All pages, chunked with entity carry-forward
- Section mode: User picks page ranges after quick scan

**Extraction context:** `"Content extracted from a PDF document. Page numbers are provided in [Page N] markers. Use these for source location references."`

**Platform behavior:**
- Chrome: pdfjs-dist runs in the side panel/tab UI context (has DOM). LLM extraction goes through offscreen document via existing `@platform` LLM abstraction.
- Electron: pdfjs-dist runs in renderer. LLM extraction goes through main process via existing `@platform` LLM abstraction.

## Image Processor

**File:** `src/ingestion/processors/image-processor.ts`

**Processing strategy:**
1. Resize if needed via Canvas API (downscale images >4MP to reduce API cost, preserve aspect ratio)
2. Encode as base64 for vision API
3. Send to Claude vision with extraction prompt — single call, no chunking

**Harness:** `shouldPromptMode()` always returns `{ prompt: false }`. Images are always single-pass.

**Extraction context:** `"Extract entities and relationships from this image. Describe spatial regions when referencing where entities appear."`

**Supported types:** PNG, JPEG, WebP, GIF, SVG (rasterize first via Canvas)

**Platform behavior:**
- Chrome: Canvas resize in UI context (side panel/tab). Vision API call via `@platform` LLM abstraction → offscreen document.
- Electron: Canvas resize in renderer. Vision API call via `@platform` LLM abstraction → main process.

## Ingestion Pipeline Flow

### Entry Points

Three entry points, all normalizing to `IngestionSource`:

1. **Drag-and-drop** — Drop zone overlay appears on graph canvas during drag events. File read via `FileReader.readAsArrayBuffer()`.
2. **Paste** — Clipboard listener on graph canvas. Image paste via `ClipboardEvent.clipboardData`.
3. **Import button** — In header bar, opens native file picker dialog via `<input type="file">`.

All three feed into a shared `startIngestion(source: IngestionSource)` method on the `useLLMExtraction` hook, alongside existing `startExtraction()` and `startAgentExtraction()`.

### Pipeline Steps

```
Entry Point → createIngestionSource() → normalize to IngestionSource
  → getProcessor(source) → factory resolves ContentProcessor
    → shouldPromptMode(source) → large doc? prompt: Quick / Full / Section
      → processor.preprocess(source, mode, onProgress) → ProcessedContent
        ─── CONVERGENCE POINT ───
        → LLM entity extraction (single or chunked with carry-forward)
          → ExtractionReview (existing flow + source location badges)
            → applyReview() → graph merge with SourceLocation in provenance
              → storeSource() → vault copy + "Keep original?" prompt
```

### Chunked Extraction with Entity Carry-Forward

For long documents that produce multiple chunks:

1. Process chunk 1 → extract entities → collect entity names
2. Process chunk 2 with context: `[Alice, ACME Corp, Project X]` → LLM links cross-references instead of creating duplicates
3. Repeat until all chunks processed
4. Merge all chunk results → single ExtractionResult → review

The carry-forward context is small (just entity names as a string list), so it doesn't bloat the prompt. Each chunk's entities carry `sourceLocation` pointing to their specific pages.

### Web Page Extraction (Unchanged)

Existing web page extraction (`startExtraction()`, `startAgentExtraction()`) is **not refactored**. The new ingestion path is additive only. Web pages continue to flow through the existing service worker / offscreen document / agent loop pipeline.

## PlatformVault Interface

New platform interface for binary file storage, separate from PlatformNotes (which handles markdown text):

```ts
interface PlatformVault {
  store(data: ArrayBuffer, filename: string, nodeId: string): Promise<{ vaultPath: string }>;
  read(vaultPath: string): Promise<ArrayBuffer>;
  remove(vaultPath: string): Promise<void>;
  getStorageUsage(): Promise<{ bytes: number; fileCount: number }>;
}
```

**Chrome implementation:** OPFS at `vault/{nodeId}/{filename}`
**Electron implementation:** Filesystem at `~/Documents/KnowledgeGraph/vault/{nodeId}/{filename}`

**Vault UX:** Files are always copied into the vault (reliability — graph never loses its sources). After successful review and merge, user is prompted: *"File copied to your knowledge vault. Delete original?"* Default: **Keep original**.

## Database Schema Changes

New migration (00X):

```sql
-- Source location on entity_sources and edge_sources
ALTER TABLE entity_sources ADD COLUMN location TEXT;
-- JSON: {"type":"page","page":3,"section":"Methods"}

ALTER TABLE edge_sources ADD COLUMN location TEXT;

-- Vault file reference on resource nodes
ALTER TABLE nodes ADD COLUMN vault_path TEXT;
-- Only set on resource nodes with vault-stored files

-- Content type tracking for resource nodes
ALTER TABLE nodes ADD COLUMN content_type TEXT;
-- 'application/pdf', 'image/png', 'text/html', etc.
```

All columns are nullable. No backfill needed — existing data is unaffected.

**Column type:** `TEXT` (JSON-serialized). SQLite JSONB requires 3.45+, but wa-sqlite (Chrome) currently bundles 3.44.0. Migrate to JSONB when wa-sqlite updates. `json_extract()` works on TEXT columns for any queries that need to filter by location.

**DataStore additions:** `VaultRepository` sub-interface added to DataStore, following the existing pattern (NodeRepository, EdgeRepository, etc.).

## Extraction Result Schema Extension

Existing Zod schemas in `src/shared/schema.ts` gain an optional `sourceLocation` field:

```ts
const sourceLocationSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('page'), page: z.number(), section: z.string().optional() }),
  z.object({ type: z.literal('region'), description: z.string() }),
  z.object({ type: z.literal('time'), timestamp: z.string(), speaker: z.string().optional() }),
  z.object({ type: z.literal('selector'), selector: z.string() }),
]);

// Added to extractedNodeSchema and extractedEdgeSchema:
sourceLocation: sourceLocationSchema.optional()
```

Optional field — graceful degradation if LLM doesn't return it. No badge shown in review UI when absent.

## Review UI Changes

`ExtractionReview` gains source location badges on each entity/edge row:
- Subtle blue pill badge: `p.3 · Authors` for PDFs, `top-left` for images
- Non-intrusive, right-aligned alongside existing status indicators (+ new, ≈ merge)
- Only shown when `sourceLocation` is present

No changes to the review flow itself — same undo/redo, inline editing, merge recommendations, mini graph preview.

## Platform Considerations

| Step | Chrome Extension | Electron |
|---|---|---|
| File input (drop/paste) | Side panel / tab UI | Renderer window |
| PDF text extraction | UI context — side panel/tab (has DOM for pdfjs-dist) | Renderer |
| Image resize | UI context Canvas | Renderer Canvas |
| LLM API call | Offscreen doc (via SW key injection) | Main process |
| Vault storage | OPFS | ~/Documents/KnowledgeGraph/vault/ |
| URL fetch | Offscreen doc fetch() | Main process fetch() |

**Key insight:** `preprocess()` is platform-agnostic — it runs in whatever JS context the UI has. PDF.js works in any context with DOM access. The LLM call is already platform-abstracted via `@platform`. Only vault storage needs a new platform-specific implementation (extends the existing PlatformNotes pattern).

## File Structure

```
src/ingestion/
  types.ts                    — IngestionSource, SourceLocation, ProcessingMode, ProcessedContent, ContentProcessor
  processor-factory.ts        — getProcessor() factory, processors array
  ingestion-pipeline.ts       — orchestrates: normalize → resolve → prompt → preprocess → extract
  processors/
    pdf-processor.ts          — PDF ContentProcessor implementation
    image-processor.ts        — Image ContentProcessor implementation
src/platform/types.ts         — PlatformVault interface (added alongside existing interfaces)
src/platform/chrome/vault.ts  — ChromeVault (OPFS implementation)
src/platform/electron/vault.ts — ElectronVault (filesystem implementation)
src/shared/schema.ts          — sourceLocationSchema (extended)
src/db/data-store.ts          — VaultRepository sub-interface (added)
src/db/worker/migrations/     — New migration for location, vault_path, content_type columns
src/ui/components/ingestion/
  DropZone.tsx                — Drag-drop overlay on graph canvas
  ImportButton.tsx            — Header bar import button with file picker
  IngestionProgress.tsx       — Progress bar during preprocessing
  ProcessingModePrompt.tsx    — Harness prompt for large documents
```

## Non-Goals

- **Refactoring existing web page extraction** — additive only, existing flow untouched.
- **Full plugin system / dynamic registry** — factory is sufficient for now, evolves naturally later.
- **PDF viewer / image viewer** — viewing vault files in-app is a future feature, not part of this spec.
- **Video/audio/social modalities** — interface supports them, but only PDF and image are implemented.
- **Embedding-based entity resolution** — existing fuzzy matching in review flow is sufficient. Embedding-based resolution is a separate future enhancement.
- **JSONB columns** — wa-sqlite is on SQLite 3.44.0; JSONB needs 3.45+. Use TEXT for now.
