# LLM Extraction & Ingestion Pipeline

## Extraction Modes

Three extraction modes, all ending in the same review→apply flow:

**Simple text extraction** (`useLLMExtraction.startExtraction`): Raw text → `llm.streamExtraction()` → streaming JSON → parse via `extractionResultSchema` (Zod) → diff with existing graph → review.

**Agent page extraction** (`useLLMExtraction.startAgentExtraction`): `llm.runAgent()` → shared agent loop (`src/core/agent-loop.ts`, max 15 iterations) → platform-specific tool executor (Chrome: content script tools via SW relay; Electron: `fetch_url` directly, content-script tools unavailable) → terminal `save_entities` tool → review.

**File ingestion** (`useLLMExtraction.startIngestion`): File (drag-drop, paste, import button) → `ContentProcessor.preprocess()` → text/chunks → `llm.streamExtraction()` with optional entity carry-forward across chunks → Zod parse → diff → review. See Multi-Modal Ingestion section below.

## Review Flow

`ExtractionReview` complements `DiffView` (`src/ui/components/llm/DiffView.tsx`):
- Converts diff items → `ReviewNode[]`/`ReviewEdge[]` with merge recommendations (fuzzy matching via entity resolution)
- Mini graph preview (Three.js ReviewGraphCanvas) or overlay on main graph
- Inline editing, add/remove nodes/edges, undo/redo
- Convert-to-property: async LLM call suggests inverse property keys, user confirms
- `applyReview()` commits to DB, resolving temp IDs → real IDs

## Multi-Modal Ingestion Pipeline

Third extraction mode alongside text and agent extraction. Imports PDFs, images, and future file types into the knowledge graph.

### Architecture

`ContentProcessor` interface + factory pattern. Each modality implements `canProcess()`, `shouldPromptMode()`, `preprocess()`. Factory resolves processor by MIME type. Evolves to dynamic registry via `registerProcessor()`.

### Pipeline Flow

Entry points (drag-drop, paste, import button) → normalize to `IngestionSource` → factory resolves processor → harness prompt if large doc → `preprocess()` → `ProcessedContent` convergence point → LLM extraction (chunked with entity carry-forward for long docs) → ExtractionReview → graph merge with SourceLocation provenance.

### Chunked Extraction with Entity Carry-Forward

For long documents, each chunk receives entity names from prior chunks as LLM context, preventing cross-chunk duplicates.

### Source Location Provenance

`SourceLocation` discriminated union tracks where entities were found:
- PDF: `{ type: 'page', page: 3, section: 'Methods' }`
- Image: `{ type: 'region', description: 'top-left org chart' }`
- Future video/audio: `{ type: 'time', timestamp: '14:32' }`

### Processing Modes

PDFs >50 pages prompt user: Quick (overview only) / Full (all pages with carry-forward).

### Key Files

- `src/ingestion/types.ts` — IngestionSource, SourceLocation, ContentProcessor interface
- `src/ingestion/processor-factory.ts` — Factory + registerProcessor()
- `src/ingestion/ingestion-pipeline.ts` — Pipeline orchestrator with chunked carry-forward
- `src/ingestion/processors/pdf-processor.ts` — pdfjs-dist, page-level chunking
- `src/ingestion/processors/image-processor.ts` — Canvas resize, base64 for vision API
