# Reading List Import Redesign

## Summary

Redesign the reading list import pipeline with a clean state machine, local file support, tiered extraction strategies, structured progress insight, similarity detection, and per-state UI components.

## Goals

- Clean state machine: exactly 4 statuses (`pending | processing | ready | complete`), error as a property not a state
- Local file ingestion via drag-and-drop and file picker, with import-vs-reference choice
- Tiered extraction (direct / chunked / map-reduce) based on content size to manage cost and hallucination risk
- Real-time extraction progress with structured steps and raw LLM stream views
- Pre-merge similarity detection (name matching + embedding KNN) integrated into extraction review
- Per-state card components replacing the monolithic `ReadingListItemCard`

## Data Model

### ReadingListResource (replaces ReadingListItem)

```typescript
type ResourceSource =
  | { kind: 'url'; url: string }
  | { kind: 'file'; filePath: string;
      imported: boolean;
      vaultPath?: string;     // e.g. 'raw/report.pdf'
      keepOriginal?: boolean;
    };

type ResourceStatus = 'pending' | 'processing' | 'ready' | 'complete';

interface ReadingListResource {
  id: string;               // stable key (URL for urls, generated for files)
  source: ResourceSource;
  title: string;
  addedAt: number;
  status: ResourceStatus;

  error?: {
    message: string;
    stage: ExtractionStage;
    failedAt: number;
    attempts: number;
  };

  extraction?: {
    summary: string;
    keyTopics: string[];
    nodes: ExtractedNode[];
    edges: ExtractedEdge[];
    pageContent: string;
    extractedAt: number;
  };

  similarityMatches?: SimilarityMatch[];

  targetVaultPath?: string;
  targetVaultName?: string;
}
```

### SimilarityMatch

```typescript
interface SimilarityMatch {
  extractedNodeName: string;
  existingNodeId: string;
  existingNodeName: string;
  matchType: 'exact' | 'normalized' | 'fuzzy' | 'acronym' | 'embedding';
  score: number;              // 0-1
  existingLabel?: string;
  existingSummary?: string;
}
```

### Dropped types

- `ReadingListItemStatus` — replaced by `ResourceStatus` (4 values, no Chrome-legacy `fetching | extracting | extracted`)
- `ReadingListItem` — replaced by `ReadingListResource`

## State Machine

```
                    ┌──── error → pending + error info ────┐
                    │                                      │
  add URL/file → PENDING → extract → PROCESSING ──────────┘
                                        │
                                     success
                                        ↓
                                      READY → merge → COMPLETE
```

- **PENDING**: item added, awaiting extraction. May carry an `error` property from a previous failed attempt.
- **PROCESSING**: extraction pipeline running (fetch → parse → extract → validate → similarity).
- **READY**: extraction complete, similarity matches populated. User can preview (inline expand) or click "Review & Merge".
- **COMPLETE**: merged into graph, recorded in `reading_list_history` table, removed from UI.

Error is a property on pending items, not a separate status. On failure, the item transitions back to `pending` with `error` set.

## Local File Support

### Entry points

1. **Drag-and-drop**: drop files onto the reading list panel. A `DropZoneOverlay` appears on drag-over.
2. **File picker**: the "+ Add" button (renamed from "+ Add URL") opens `AddResourceModal` with URL / Files tabs. The Files tab has a "Choose Files..." button that opens Electron's `dialog.showOpenDialog()`.

### Supported file types

`.md`, `.txt`, `.pdf`, `.html`, `.json`, `.csv`, `.png`, `.jpg`, `.jpeg`, `.webp`, `.gif`, `.svg`

### Import decision flow

After files are selected (via either entry point), a `FileImportDialog` appears:

- **Import into vault**: copies files into the vault's `raw/` folder. Checkbox to keep original files after import.
- **Reference only**: stores the file path. File stays where it is.

### Vault layout

```
my-vault/
├── raw/              ← imported, unprocessed files
│   ├── report.pdf
│   └── data.csv
├── notes/            ← entity notes (existing)
├── .kg/              ← graph DB, config (existing)
└── ...
```

Files stay in `raw/` through the full lifecycle. They are raw source material — the knowledge lives in the graph after extraction.

## Extraction Pipeline

### Stages

```
FETCH → PARSE → EXTRACT → VALIDATE → SIMILARITY → READY
```

- **FETCH**: HTTP fetch + clean HTML (URLs), or read from disk/vault (files).
- **PARSE**: extract text content. PDF → text, HTML → text, etc. Images (`.png`, `.jpg`, `.webp`, `.gif`, `.svg`) skip text parsing — the raw image is passed to the LLM as a vision input in the extract stage.
- **EXTRACT**: LLM call with streaming. Produces summary, keyTopics, nodes, edges.
- **VALIDATE**: run `readingListExtractionSchema.parse()` on the LLM's JSON output.
- **SIMILARITY**: tiered matching against existing graph nodes (see Similarity Detection).

### Tiered extraction strategy

Auto-selected based on parsed text size (thresholds configurable in settings):

| Strategy | Content size | How it works | API calls |
|---|---|---|---|
| **Direct** | < 30 KB text | Single LLM call with full content | 1 |
| **Chunked** | 30–200 KB | Split by headings or page breaks (fallback: ~8KB paragraph blocks), extract per chunk, merge/dedup nodes across chunks | N (one per chunk) |
| **Map-Reduce** | > 200 KB | Summarize each chunk first, then extract from the summaries | N summaries + 1 final |

### Anti-hallucination measures

1. **Smaller context per call**: chunked/map-reduce keeps each LLM call focused. Less noise = fewer invented entities.
2. **Source location anchoring**: LLM is prompted to include `sourceLocation` (page, section) for each entity. Entities without a traceable location are flagged as lower confidence in review.
3. **Cross-chunk dedup**: chunked mode merges duplicate entity names across chunks (exact + fuzzy). Conflicting properties are flagged for user resolution in review.
4. **Summarization as compression gate**: map-reduce filters noise before the extraction pass, which works from ~10-20% of original content.

### Retry on validation failure

- **Fetch/parse failures**: no auto-retry. Item returns to `pending` with error immediately.
- **LLM output fails validation**: auto-retry up to N retries (default 2 retries = 3 total attempts). The retry prompt includes the malformed output + the Zod validation error so the LLM can self-correct.
- **After all retries exhausted**: item returns to `pending` with error. `error.attempts` tracks total attempts (including the original).

## ExtractionProgressService

A new service that emits typed events during extraction. The store and UI subscribe by resource ID.

```typescript
type ExtractionStage = 'fetch' | 'parse' | 'extract' | 'validate' | 'similarity';

type ExtractionProgressEvent =
  | { type: 'stage-start'; stage: ExtractionStage }
  | { type: 'stage-complete'; stage: ExtractionStage;
      meta?: { bytes?: number; chars?: number; ms?: number } }
  | { type: 'llm-chunk'; text: string }
  | { type: 'chunk-progress'; current: number; total: number;
      label?: string }
  | { type: 'strategy-selected'; strategy: 'direct' | 'chunked' | 'map-reduce';
      reason: string }
  | { type: 'error'; stage: ExtractionStage; message: string };
```

## Similarity Detection

### When it runs

As a pipeline stage after validation, before the item transitions to `ready`. "Ready" means fully ready — matches are already populated.

### Tiered matching

For each extracted node:

1. **Tier 1: Name matching** (always runs, < 50ms, zero API calls)
   - Exact: case-insensitive, trim whitespace
   - Normalized: "ChatGPT" ↔ "Chat GPT", hyphens/spaces
   - Fuzzy: Levenshtein distance ≤ 2 for short names, ratio > 0.85 for longer
   - Acronym: "LLM" ↔ "Large Language Model" (existing logic)

2. **Tier 2: Embedding KNN** (only if embeddings enabled in settings)
   - Embed each extracted node's name + label + properties
   - KNN top-5 from existing `vec_nodes`
   - Score threshold > 0.7, exclude Tier 1 hits
   - Uses graph-aware embeddings if enabled

### Failure handling

Similarity failure is non-fatal:
- If name matching fails → proceed with empty matches
- If embedding KNN fails → proceed with name-only matches
- Item still transitions to `ready` either way

### Review panel integration

In the extraction review, entities with matches show an inline match row:
- Amber badge indicating match type and score
- Existing node's name, label, and summary for context
- **Merge** button: new extraction's properties/edges are merged into the existing node
- **Keep New** button: create a separate node, dismiss the match

Exact matches are pre-selected as "Merge" by default (user can override). Fuzzy and embedding matches require explicit choice.

### Match cleanup on entity removal

Matches are displayed inline on entity rows. If the user removes an entity during review, the match disappears with it. If the user edits an entity's name, the stale match is dismissed. Matches are derived UI state, not standalone records — no special cleanup needed.

## Error Handling UX

### Visual treatment

Error pending items have:
- Red left border accent (3px solid)
- Red failure badge: "Failed · N attempts"
- Two buttons: "Detail" (toggles expanded error view) and "Retry"

### Expanded error detail

Clicking "Detail" extends the card to show:
- Stage that failed (fetch/parse/extract/validate)
- Failure timestamp
- Full error message in a monospace block

### Behavior rules

- Error items sort to the **top** of the pending list (most recent failure first)
- Pending tab badge count includes errored items
- "Retry" clears the error and starts extraction (`pending` → `processing`)
- Batch select skips errored items by default (user can manually include them)

## UI Components

### Component tree

```
ReadingListPanel               ← orchestrator (tabs, filtering, batch ops)
├── PendingCard                ← normal + error variants
├── ProcessingCard             ← spinner + stage progress + detail button
├── ReadyCard                  ← preview + match count + merge button
├── AddResourceModal           ← replaces AddUrlModal, URL/Files tabs
│   ├── UrlTab                 ← existing URL paste UI
│   └── FileTab                ← file picker + import options
├── FileImportDialog           ← import vs reference, keep original
└── DropZoneOverlay            ← appears on drag-over

ExtractionProgressPanel        ← new content tab (kind: 'extractionProgress')
├── StepsView                  ← structured progress checklist
└── StreamView                 ← raw LLM output

ExtractionReviewPanel          ← existing, extended with similarity UI
└── SimilarityMatchRow         ← inline match detail + merge/keep buttons
```

### File resource indicators

File resources show a file icon and filename instead of globe icon and domain. Badges:
- **"in vault"** (indigo): file was imported into `raw/`
- **"external"** (gray): file is a reference to an external path

### Processing card

Shows current pipeline stage (e.g. "Step 3/5") and animated pulse indicator. "Detail" button opens `ExtractionProgressPanel` as a content tab with toggle between:
- **Steps view**: structured checklist with timing/size metadata per stage
- **Stream view**: raw LLM JSON output streaming live with cursor

### Ready card

Shows entity count and match count badge (e.g. "8 entities · 2 matches"). Click to expand inline (summary, topics, counts). "Review & Merge" opens extraction review panel.

## Store Refactoring

Key changes to `reading-list-store.ts`:

1. Items keyed by `id` (not URL)
2. `addItem()` → `addResource(source: ResourceSource, title: string)`
3. `retryExtraction()` → `retryResource(id: string)` — clears error, re-enters processing
4. Drop `isProcessing()` helper — just check `status === 'processing'`
5. Subscribe to `ExtractionProgressService` for stage events
6. On load, migrate old items: `'failed'` → `'pending'` + error; `'fetching'`/`'extracting'` → `'processing'`; `'extracted'` → `'ready'`

## Storage Migration

On first load with the new code, `loadFromStorage()` converts existing `readingListItems` entries:

| Old status | New status | Additional |
|---|---|---|
| `pending` | `pending` | No change |
| `processing` / `fetching` / `extracting` | `processing` | — |
| `failed` | `pending` | `error` populated from old `error` field |
| `ready` / `extracted` | `ready` | Flat fields grouped into `extraction` object |
| `complete` | `complete` | No change |

Old URL-keyed items get `id` set to the URL and `source: { kind: 'url', url }`.
