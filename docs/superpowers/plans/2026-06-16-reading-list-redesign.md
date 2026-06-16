# Reading List Import Redesign — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Redesign the reading list import pipeline with a clean 4-state machine, local file support, tiered extraction strategies, real-time progress insight, and pre-merge similarity detection.

**Architecture:** Replace `ReadingListItem` with `ReadingListResource` (discriminated union for URL/file sources). Extract pipeline emits progress events via `ExtractionProgressService`. Similarity detection runs as a pipeline stage, injecting results into the existing `mergeRecommendation` on `ReviewNode`. Per-state card components replace the monolithic card.

**Tech Stack:** React, Zustand, Vitest, Electron IPC, sqlite-vec (for embedding KNN)

**Spec:** `docs/superpowers/specs/2026-06-16-reading-list-redesign.md`

---

## File Map

### New Files

| File | Responsibility |
|---|---|
| `src/shared/reading-list-types.ts` | `ReadingListResource`, `ResourceSource`, `ResourceStatus`, `ExtractionStage`, `ExtractionProgressEvent`, `SimilarityMatch`, migration helper |
| `src/core/extraction-progress-service.ts` | Per-resource event emitter for extraction pipeline stages |
| `src/core/similarity-service.ts` | Tiered name matching + embedding KNN |
| `src/core/extraction-strategies.ts` | Direct / chunked / map-reduce strategy selection and execution |
| `src/ui/components/reading-list/PendingCard.tsx` | Pending item card (normal + error variant) |
| `src/ui/components/reading-list/ProcessingCard.tsx` | Processing item card (stage progress + detail button) |
| `src/ui/components/reading-list/ReadyCard.tsx` | Ready item card (preview expand + merge button + match count) |
| `src/ui/components/reading-list/AddResourceModal.tsx` | Tabbed modal: URL tab + Files tab (replaces `AddUrlModal.tsx`) |
| `src/ui/components/reading-list/FileImportDialog.tsx` | Import-vs-reference choice + keep-original checkbox |
| `src/ui/components/reading-list/DropZoneOverlay.tsx` | Drag-and-drop overlay for the reading list panel |
| `src/ui/components/reading-list/ExtractionProgressPanel.tsx` | Content tab: StepsView / StreamView toggle for in-progress extractions |
| `tests/reading-list/reading-list-types.test.ts` | Type guard and migration helper tests |
| `tests/reading-list/similarity-service.test.ts` | Name matching tier tests |
| `tests/reading-list/extraction-strategies.test.ts` | Strategy selection tests |

### Modified Files

| File | Changes |
|---|---|
| `src/shared/types.ts` | Keep old `ReadingListItem` type (consumed by migration), export from new types file |
| `src/graph/store/reading-list-store.ts` | Rewrite: use `ReadingListResource`, new keying by `id`, migration on load, progress service subscription |
| `src/graph/store/ui-store.ts:9-14` | Add `{ kind: 'extractionProgress'; resourceId: string }` to `ContentTabType` union |
| `src/graph/store/extraction-review-store.ts:20` | Extend `mergeRecommendation.matchType` with `'normalized' \| 'acronym' \| 'embedding'` |
| `src/ui/components/reading-list/ReadingListPanel.tsx` | Use new card components, add DnD, rename button |
| `src/ui/hooks/useReadingListMerge.ts` | Update for `ReadingListResource` type, pass `similarityMatches` to `buildDiffItems` |
| `src/ui/hooks/useLLMExtraction.ts:130-196` | Extend `buildDiffItems` to accept optional `similarityMatches` param and populate `mergeRecommendation` |
| `src/ui/components/llm/ExtractionReviewTab.tsx` | Handle new `extractionProgress` tab type routing |
| `electron/main.ts` | Add `dialog:open-files` IPC handler, add `file:copy-to-vault` IPC handler |

---

## Task 1: Types and Migration Helper

**Files:**
- Create: `src/shared/reading-list-types.ts`
- Create: `tests/reading-list/reading-list-types.test.ts`
- Modify: `src/shared/types.ts`

- [ ] **Step 1: Write failing tests for type guards and migration**

```typescript
// tests/reading-list/reading-list-types.test.ts
import { describe, it, expect } from 'vitest';
import {
  isUrlSource,
  isFileSource,
  isImageFile,
  migrateReadingListItem,
  type ReadingListResource,
  type ResourceSource,
} from '../../src/shared/reading-list-types';

describe('ResourceSource type guards', () => {
  it('isUrlSource returns true for url sources', () => {
    const source: ResourceSource = { kind: 'url', url: 'https://example.com' };
    expect(isUrlSource(source)).toBe(true);
    expect(isFileSource(source)).toBe(false);
  });

  it('isFileSource returns true for file sources', () => {
    const source: ResourceSource = { kind: 'file', filePath: '/tmp/doc.pdf', imported: false };
    expect(isFileSource(source)).toBe(true);
    expect(isUrlSource(source)).toBe(false);
  });
});

describe('isImageFile', () => {
  it('returns true for image extensions', () => {
    expect(isImageFile('photo.png')).toBe(true);
    expect(isImageFile('photo.JPG')).toBe(true);
    expect(isImageFile('icon.svg')).toBe(true);
    expect(isImageFile('animation.gif')).toBe(true);
    expect(isImageFile('photo.webp')).toBe(true);
  });

  it('returns false for non-image extensions', () => {
    expect(isImageFile('doc.pdf')).toBe(false);
    expect(isImageFile('notes.md')).toBe(false);
    expect(isImageFile('data.csv')).toBe(false);
  });
});

describe('migrateReadingListItem', () => {
  it('migrates a pending item', () => {
    const old = {
      url: 'https://example.com/article',
      title: 'Article',
      addedAt: 1000,
      status: 'pending' as const,
    };
    const result = migrateReadingListItem('https://example.com/article', old);
    expect(result.id).toBe('https://example.com/article');
    expect(result.source).toEqual({ kind: 'url', url: 'https://example.com/article' });
    expect(result.status).toBe('pending');
    expect(result.error).toBeUndefined();
  });

  it('migrates a failed item to pending with error', () => {
    const old = {
      url: 'https://example.com/broken',
      title: 'Broken',
      addedAt: 2000,
      status: 'failed' as const,
      error: 'No API key configured',
    };
    const result = migrateReadingListItem('https://example.com/broken', old);
    expect(result.status).toBe('pending');
    expect(result.error).toBeDefined();
    expect(result.error!.message).toBe('No API key configured');
    expect(result.error!.attempts).toBe(1);
  });

  it('migrates fetching/extracting to processing', () => {
    const old = {
      url: 'https://example.com/busy',
      title: 'Busy',
      addedAt: 3000,
      status: 'extracting' as const,
    };
    const result = migrateReadingListItem('https://example.com/busy', old);
    expect(result.status).toBe('processing');
  });

  it('migrates a ready item with extraction data grouped', () => {
    const old = {
      url: 'https://example.com/done',
      title: 'Done',
      addedAt: 4000,
      status: 'ready' as const,
      summary: 'A summary',
      keyTopics: ['topic1'],
      extractedNodes: [{ name: 'Node1', type: 'entity' }],
      extractedEdges: [{ sourceName: 'A', targetName: 'B', label: 'rel' }],
      pageContent: 'content',
      extractedAt: 5000,
    };
    const result = migrateReadingListItem('https://example.com/done', old);
    expect(result.status).toBe('ready');
    expect(result.extraction).toBeDefined();
    expect(result.extraction!.summary).toBe('A summary');
    expect(result.extraction!.keyTopics).toEqual(['topic1']);
    expect(result.extraction!.nodes).toHaveLength(1);
    expect(result.extraction!.edges).toHaveLength(1);
    expect(result.extraction!.pageContent).toBe('content');
  });

  it('migrates extracted (Chrome legacy) to ready', () => {
    const old = {
      url: 'https://example.com/ext',
      title: 'Extracted',
      addedAt: 6000,
      status: 'extracted' as const,
      summary: 'sum',
      keyTopics: ['t'],
      extractedNodes: [],
      extractedEdges: [],
    };
    const result = migrateReadingListItem('https://example.com/ext', old);
    expect(result.status).toBe('ready');
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/reading-list/reading-list-types.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: Implement the types and helpers**

```typescript
// src/shared/reading-list-types.ts
import type { ReadingListItem } from './types';

// --- Source ---

export type ResourceSource =
  | { kind: 'url'; url: string }
  | { kind: 'file'; filePath: string; imported: boolean; vaultPath?: string; keepOriginal?: boolean };

export function isUrlSource(s: ResourceSource): s is ResourceSource & { kind: 'url' } {
  return s.kind === 'url';
}

export function isFileSource(s: ResourceSource): s is ResourceSource & { kind: 'file' } {
  return s.kind === 'file';
}

const IMAGE_EXTENSIONS = new Set(['png', 'jpg', 'jpeg', 'webp', 'gif', 'svg']);

export function isImageFile(filename: string): boolean {
  const ext = filename.split('.').pop()?.toLowerCase() ?? '';
  return IMAGE_EXTENSIONS.has(ext);
}

export const SUPPORTED_FILE_EXTENSIONS = new Set([
  'md', 'txt', 'pdf', 'html', 'json', 'csv',
  ...IMAGE_EXTENSIONS,
]);

// --- Status ---

export type ResourceStatus = 'pending' | 'processing' | 'ready' | 'complete';

// --- Extraction ---

export type ExtractionStage = 'fetch' | 'parse' | 'extract' | 'validate' | 'similarity';

export type ExtractionStrategy = 'direct' | 'chunked' | 'map-reduce';

export interface ExtractedNodeData {
  name: string;
  type?: string;
  label?: string;
  properties?: Record<string, unknown>;
  tags?: string[];
  sourceLocation?: { type: 'page'; page: number; section?: string }
    | { type: 'region'; description: string };
}

export interface ExtractedEdgeData {
  sourceName: string;
  targetName: string;
  label: string;
  type?: string;
}

export interface ExtractionResult {
  summary: string;
  keyTopics: string[];
  nodes: ExtractedNodeData[];
  edges: ExtractedEdgeData[];
  pageContent: string;
  extractedAt: number;
}

// --- Similarity ---

export type SimilarityMatchType = 'exact' | 'normalized' | 'fuzzy' | 'acronym' | 'embedding';

export interface SimilarityMatch {
  extractedNodeName: string;
  existingNodeId: string;
  existingNodeName: string;
  matchType: SimilarityMatchType;
  score: number;
  existingLabel?: string;
  existingSummary?: string;
}

// --- Progress ---

export type ExtractionProgressEvent =
  | { type: 'stage-start'; resourceId: string; stage: ExtractionStage }
  | { type: 'stage-complete'; resourceId: string; stage: ExtractionStage; meta?: { bytes?: number; chars?: number; ms?: number } }
  | { type: 'llm-chunk'; resourceId: string; text: string }
  | { type: 'chunk-progress'; resourceId: string; current: number; total: number; label?: string }
  | { type: 'strategy-selected'; resourceId: string; strategy: ExtractionStrategy; reason: string }
  | { type: 'error'; resourceId: string; stage: ExtractionStage; message: string };

// --- Error ---

export interface ResourceError {
  message: string;
  stage: ExtractionStage;
  failedAt: number;
  attempts: number;
}

// --- Resource ---

export interface ReadingListResource {
  id: string;
  source: ResourceSource;
  title: string;
  addedAt: number;
  status: ResourceStatus;
  error?: ResourceError;
  extraction?: ExtractionResult;
  similarityMatches?: SimilarityMatch[];
  targetVaultPath?: string;
  targetVaultName?: string;
}

// --- Migration ---

export function migrateReadingListItem(key: string, old: ReadingListItem): ReadingListResource {
  const source: ResourceSource = { kind: 'url', url: old.url };

  let status: ResourceStatus;
  switch (old.status) {
    case 'failed':
      status = 'pending';
      break;
    case 'fetching':
    case 'extracting':
    case 'processing':
      status = 'processing';
      break;
    case 'extracted':
    case 'ready':
      status = 'ready';
      break;
    case 'complete':
      status = 'complete';
      break;
    default:
      status = 'pending';
  }

  let error: ResourceError | undefined;
  if (old.status === 'failed' && old.error) {
    error = {
      message: old.error,
      stage: 'extract',
      failedAt: Date.now(),
      attempts: 1,
    };
  }

  let extraction: ExtractionResult | undefined;
  if ((old.status === 'ready' || old.status === 'extracted') && old.extractedNodes) {
    extraction = {
      summary: old.summary ?? '',
      keyTopics: old.keyTopics ?? [],
      nodes: old.extractedNodes.map((n) => ({ name: n.name, type: n.type, properties: n.properties })),
      edges: (old.extractedEdges ?? []).map((e) => ({ sourceName: e.sourceName, targetName: e.targetName, label: e.label })),
      pageContent: old.pageContent ?? '',
      extractedAt: old.extractedAt ?? Date.now(),
    };
  }

  return {
    id: key,
    source,
    title: old.pageTitle || old.title,
    addedAt: old.addedAt,
    status,
    error,
    extraction,
    targetVaultPath: old.targetVaultPath,
    targetVaultName: old.targetVaultName,
  };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/reading-list/reading-list-types.test.ts`
Expected: ALL PASS

- [ ] **Step 5: Commit**

```bash
git add src/shared/reading-list-types.ts tests/reading-list/reading-list-types.test.ts
git commit -m "feat(reading-list): add ReadingListResource types and migration helper"
```

---

## Task 2: ExtractionProgressService

**Files:**
- Create: `src/core/extraction-progress-service.ts`

- [ ] **Step 1: Implement the event emitter**

```typescript
// src/core/extraction-progress-service.ts
import type { ExtractionProgressEvent } from '../shared/reading-list-types';

type Listener = (event: ExtractionProgressEvent) => void;

class ExtractionProgressService {
  private listeners = new Map<string, Set<Listener>>();
  private globalListeners = new Set<Listener>();

  on(resourceId: string, listener: Listener): () => void {
    let set = this.listeners.get(resourceId);
    if (!set) {
      set = new Set();
      this.listeners.set(resourceId, set);
    }
    set.add(listener);
    return () => {
      set!.delete(listener);
      if (set!.size === 0) this.listeners.delete(resourceId);
    };
  }

  onAll(listener: Listener): () => void {
    this.globalListeners.add(listener);
    return () => this.globalListeners.delete(listener);
  }

  emit(event: ExtractionProgressEvent): void {
    const set = this.listeners.get(event.resourceId);
    if (set) {
      for (const fn of set) fn(event);
    }
    for (const fn of this.globalListeners) fn(event);
  }

  clear(resourceId: string): void {
    this.listeners.delete(resourceId);
  }
}

export const extractionProgress = new ExtractionProgressService();
```

- [ ] **Step 2: Commit**

```bash
git add src/core/extraction-progress-service.ts
git commit -m "feat(reading-list): add ExtractionProgressService event emitter"
```

---

## Task 3: Extend Extraction Review Store for New Match Types

**Files:**
- Modify: `src/graph/store/extraction-review-store.ts:20`

- [ ] **Step 1: Extend the matchType union**

In `src/graph/store/extraction-review-store.ts`, update the `mergeRecommendation` type:

```typescript
// line 20 — old:
matchType: 'exact' | 'alias' | 'fuzzy';
// new:
matchType: 'exact' | 'alias' | 'fuzzy' | 'normalized' | 'acronym' | 'embedding';
```

- [ ] **Step 2: Run existing tests to verify no breakage**

Run: `npx vitest run`
Expected: ALL PASS

- [ ] **Step 3: Commit**

```bash
git add src/graph/store/extraction-review-store.ts
git commit -m "feat(reading-list): extend merge matchType for similarity detection"
```

---

## Task 4: Add extractionProgress Content Tab Type

**Files:**
- Modify: `src/graph/store/ui-store.ts:9-36`

- [ ] **Step 1: Add the new content tab variant**

In `src/graph/store/ui-store.ts`, extend the `ContentTabType` union:

```typescript
// line 9-14 — add new variant:
export type ContentTabType =
  | { kind: 'graph' }
  | { kind: 'noteEditor'; noteId: string }
  | { kind: 'extractionReview' }
  | { kind: 'extractionProgress'; resourceId: string }
  | { kind: 'viewer'; filePath: string }
  | { kind: 'artifact'; artifactId: string };
```

Update the `contentTabId` function to handle the new kind:

```typescript
// line 29-36 — add case:
function contentTabId(type: ContentTabType): string {
  if (type.kind === 'graph') return 'graph';
  if (type.kind === 'extractionReview') return 'extraction-review';
  if (type.kind === 'extractionProgress') return `extraction-progress-${type.resourceId}`;
  if (type.kind === 'noteEditor') return `note-${type.noteId}`;
  if (type.kind === 'viewer') return `viewer-${type.filePath}`;
  if (type.kind === 'artifact') return `artifact-${type.artifactId}`;
  return 'unknown';
}
```

- [ ] **Step 2: Run existing tests**

Run: `npx vitest run`
Expected: ALL PASS

- [ ] **Step 3: Commit**

```bash
git add src/graph/store/ui-store.ts
git commit -m "feat(reading-list): add extractionProgress content tab type"
```

---

## Task 5: Similarity Service

**Files:**
- Create: `src/core/similarity-service.ts`
- Create: `tests/reading-list/similarity-service.test.ts`

- [ ] **Step 1: Write failing tests for name matching**

```typescript
// tests/reading-list/similarity-service.test.ts
import { describe, it, expect, vi } from 'vitest';
import {
  findExactMatch,
  findNormalizedMatch,
  findFuzzyMatch,
  findAcronymMatch,
  normalizeForComparison,
  levenshteinDistance,
} from '../../src/core/similarity-service';

const existingNodes = [
  { id: '1', name: 'Transformer', label: 'technology', summary: 'A deep learning architecture' },
  { id: '2', name: 'BERT', label: 'technology', summary: 'Bidirectional encoder' },
  { id: '3', name: 'Large Language Model', label: 'concept', summary: null },
  { id: '4', name: 'ChatGPT', label: 'technology', summary: 'OpenAI chatbot' },
  { id: '5', name: 'Neural Network', label: 'concept', summary: null },
];

describe('levenshteinDistance', () => {
  it('returns 0 for identical strings', () => {
    expect(levenshteinDistance('abc', 'abc')).toBe(0);
  });

  it('returns correct distance for simple edits', () => {
    expect(levenshteinDistance('kitten', 'sitting')).toBe(3);
    expect(levenshteinDistance('BERT', 'BERt')).toBe(1);
  });
});

describe('normalizeForComparison', () => {
  it('lowercases and removes hyphens/extra spaces', () => {
    expect(normalizeForComparison('Chat GPT')).toBe('chatgpt');
    expect(normalizeForComparison('Chat-GPT')).toBe('chatgpt');
    expect(normalizeForComparison('  BERT  ')).toBe('bert');
  });
});

describe('findExactMatch', () => {
  it('finds case-insensitive exact match', () => {
    const match = findExactMatch('bert', existingNodes);
    expect(match).toBeDefined();
    expect(match!.existingNodeId).toBe('2');
    expect(match!.matchType).toBe('exact');
    expect(match!.score).toBe(1.0);
  });

  it('returns undefined when no exact match', () => {
    expect(findExactMatch('GPT-4', existingNodes)).toBeUndefined();
  });
});

describe('findNormalizedMatch', () => {
  it('matches after normalization (spaces/hyphens removed)', () => {
    const match = findNormalizedMatch('Chat GPT', existingNodes);
    expect(match).toBeDefined();
    expect(match!.existingNodeId).toBe('4');
    expect(match!.matchType).toBe('normalized');
  });

  it('returns undefined for non-matches', () => {
    expect(findNormalizedMatch('Llama', existingNodes)).toBeUndefined();
  });
});

describe('findFuzzyMatch', () => {
  it('matches with small Levenshtein distance', () => {
    const match = findFuzzyMatch('Transfomer', existingNodes);
    expect(match).toBeDefined();
    expect(match!.existingNodeId).toBe('1');
    expect(match!.matchType).toBe('fuzzy');
    expect(match!.score).toBeGreaterThan(0.8);
  });

  it('does not match distant strings', () => {
    expect(findFuzzyMatch('Quantum Computing', existingNodes)).toBeUndefined();
  });
});

describe('findAcronymMatch', () => {
  it('matches acronym to full name', () => {
    const match = findAcronymMatch('LLM', existingNodes);
    expect(match).toBeDefined();
    expect(match!.existingNodeId).toBe('3');
    expect(match!.matchType).toBe('acronym');
    expect(match!.score).toBe(0.95);
  });

  it('matches full name to acronym', () => {
    const nodesWithAcronym = [
      { id: '10', name: 'NLP', label: 'concept', summary: null },
    ];
    const match = findAcronymMatch('Natural Language Processing', nodesWithAcronym);
    expect(match).toBeDefined();
    expect(match!.existingNodeId).toBe('10');
  });

  it('returns undefined for non-acronyms', () => {
    expect(findAcronymMatch('Hello', existingNodes)).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/reading-list/similarity-service.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: Implement the similarity service**

```typescript
// src/core/similarity-service.ts
import type { SimilarityMatch, SimilarityMatchType, ExtractedNodeData } from '../shared/reading-list-types';

export interface ExistingNodeInfo {
  id: string;
  name: string;
  label?: string | null;
  summary?: string | null;
}

export function levenshteinDistance(a: string, b: string): number {
  const m = a.length;
  const n = b.length;
  const dp: number[][] = Array.from({ length: m + 1 }, () => Array(n + 1).fill(0));
  for (let i = 0; i <= m; i++) dp[i][0] = i;
  for (let j = 0; j <= n; j++) dp[0][j] = j;
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      dp[i][j] = a[i - 1] === b[j - 1]
        ? dp[i - 1][j - 1]
        : 1 + Math.min(dp[i - 1][j], dp[i][j - 1], dp[i - 1][j - 1]);
    }
  }
  return dp[m][n];
}

export function normalizeForComparison(s: string): string {
  return s.toLowerCase().replace(/[\s\-_]+/g, '').trim();
}

function toMatch(
  extractedName: string,
  node: ExistingNodeInfo,
  matchType: SimilarityMatchType,
  score: number,
): SimilarityMatch {
  return {
    extractedNodeName: extractedName,
    existingNodeId: node.id,
    existingNodeName: node.name,
    matchType,
    score,
    existingLabel: node.label ?? undefined,
    existingSummary: node.summary ?? undefined,
  };
}

export function findExactMatch(name: string, nodes: ExistingNodeInfo[]): SimilarityMatch | undefined {
  const lower = name.toLowerCase().trim();
  const found = nodes.find((n) => n.name.toLowerCase().trim() === lower);
  if (!found) return undefined;
  return toMatch(name, found, 'exact', 1.0);
}

export function findNormalizedMatch(name: string, nodes: ExistingNodeInfo[]): SimilarityMatch | undefined {
  const norm = normalizeForComparison(name);
  const found = nodes.find((n) => normalizeForComparison(n.name) === norm);
  if (!found) return undefined;
  if (found.name.toLowerCase().trim() === name.toLowerCase().trim()) return undefined;
  return toMatch(name, found, 'normalized', 0.95);
}

export function findFuzzyMatch(name: string, nodes: ExistingNodeInfo[]): SimilarityMatch | undefined {
  const lower = name.toLowerCase().trim();
  let bestNode: ExistingNodeInfo | undefined;
  let bestScore = 0;

  for (const node of nodes) {
    const nodeLower = node.name.toLowerCase().trim();
    const dist = levenshteinDistance(lower, nodeLower);
    const maxLen = Math.max(lower.length, nodeLower.length);
    if (maxLen === 0) continue;
    const ratio = 1 - dist / maxLen;

    const threshold = lower.length <= 5 ? (dist <= 1 ? 0.7 : -1) : 0.85;
    if (ratio >= threshold && ratio > bestScore) {
      bestScore = ratio;
      bestNode = node;
    }
  }

  if (!bestNode) return undefined;
  return toMatch(name, bestNode, 'fuzzy', bestScore);
}

function isAcronymOf(acronym: string, fullName: string): boolean {
  const words = fullName.split(/[\s\-]+/).filter((w) => w.length > 0);
  if (words.length < 2 || words.length !== acronym.length) return false;
  return words.every((w, i) => w[0].toUpperCase() === acronym[i].toUpperCase());
}

export function findAcronymMatch(name: string, nodes: ExistingNodeInfo[]): SimilarityMatch | undefined {
  const trimmed = name.trim();
  const isShort = trimmed.length <= 6 && trimmed === trimmed.toUpperCase() && !/\s/.test(trimmed);

  for (const node of nodes) {
    if (isShort && isAcronymOf(trimmed, node.name)) {
      return toMatch(name, node, 'acronym', 0.95);
    }
    const nodeTrimmed = node.name.trim();
    const nodeIsShort = nodeTrimmed.length <= 6 && nodeTrimmed === nodeTrimmed.toUpperCase() && !/\s/.test(nodeTrimmed);
    if (nodeIsShort && isAcronymOf(nodeTrimmed, trimmed)) {
      return toMatch(name, node, 'acronym', 0.95);
    }
  }
  return undefined;
}

export async function findSimilarityMatches(
  extractedNodes: ExtractedNodeData[],
  existingNodes: ExistingNodeInfo[],
  embeddingSearch?: (text: string, topK: number) => Promise<Array<{ nodeId: string; score: number }>>,
): Promise<SimilarityMatch[]> {
  const matches: SimilarityMatch[] = [];
  const matchedExistingIds = new Set<string>();

  for (const extracted of extractedNodes) {
    const exact = findExactMatch(extracted.name, existingNodes);
    if (exact) {
      matches.push(exact);
      matchedExistingIds.add(exact.existingNodeId);
      continue;
    }

    const normalized = findNormalizedMatch(extracted.name, existingNodes);
    if (normalized) {
      matches.push(normalized);
      matchedExistingIds.add(normalized.existingNodeId);
      continue;
    }

    const acronym = findAcronymMatch(extracted.name, existingNodes);
    if (acronym) {
      matches.push(acronym);
      matchedExistingIds.add(acronym.existingNodeId);
      continue;
    }

    const fuzzy = findFuzzyMatch(extracted.name, existingNodes);
    if (fuzzy) {
      matches.push(fuzzy);
      matchedExistingIds.add(fuzzy.existingNodeId);
      continue;
    }
  }

  if (embeddingSearch) {
    for (const extracted of extractedNodes) {
      if (matches.some((m) => m.extractedNodeName === extracted.name)) continue;

      try {
        const queryText = [extracted.name, extracted.label, extracted.properties ? JSON.stringify(extracted.properties) : '']
          .filter(Boolean)
          .join('. ');
        const results = await embeddingSearch(queryText, 5);
        const best = results.find((r) => r.score > 0.7 && !matchedExistingIds.has(r.nodeId));
        if (best) {
          const existingNode = existingNodes.find((n) => n.id === best.nodeId);
          if (existingNode) {
            matches.push(toMatch(extracted.name, existingNode, 'embedding', best.score));
            matchedExistingIds.add(best.nodeId);
          }
        }
      } catch {
        // Embedding search failed — continue with name-only matches
      }
    }
  }

  return matches;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/reading-list/similarity-service.test.ts`
Expected: ALL PASS

- [ ] **Step 5: Commit**

```bash
git add src/core/similarity-service.ts tests/reading-list/similarity-service.test.ts
git commit -m "feat(reading-list): add tiered similarity service (name + fuzzy + acronym + embedding)"
```

---

## Task 6: Extraction Strategy Selection

**Files:**
- Create: `src/core/extraction-strategies.ts`
- Create: `tests/reading-list/extraction-strategies.test.ts`

- [ ] **Step 1: Write failing tests for strategy selection**

```typescript
// tests/reading-list/extraction-strategies.test.ts
import { describe, it, expect } from 'vitest';
import { selectStrategy } from '../../src/core/extraction-strategies';

describe('selectStrategy', () => {
  it('selects direct for small content', () => {
    const text = 'a'.repeat(10_000);
    const result = selectStrategy(text);
    expect(result.strategy).toBe('direct');
    expect(result.reason).toContain('10');
  });

  it('selects chunked for medium content', () => {
    const text = 'a'.repeat(50_000);
    const result = selectStrategy(text);
    expect(result.strategy).toBe('chunked');
  });

  it('selects map-reduce for large content', () => {
    const text = 'a'.repeat(250_000);
    const result = selectStrategy(text);
    expect(result.strategy).toBe('map-reduce');
  });

  it('selects direct for image files', () => {
    const result = selectStrategy('', { isImage: true });
    expect(result.strategy).toBe('direct');
    expect(result.reason).toContain('image');
  });

  it('respects custom thresholds', () => {
    const text = 'a'.repeat(20_000);
    const result = selectStrategy(text, { directThreshold: 10_000, chunkedThreshold: 50_000 });
    expect(result.strategy).toBe('chunked');
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/reading-list/extraction-strategies.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: Implement strategy selection**

```typescript
// src/core/extraction-strategies.ts
import type { ExtractionStrategy } from '../shared/reading-list-types';

const DEFAULT_DIRECT_THRESHOLD = 30_000;  // 30KB
const DEFAULT_CHUNKED_THRESHOLD = 200_000; // 200KB

interface StrategyOptions {
  isImage?: boolean;
  directThreshold?: number;
  chunkedThreshold?: number;
}

interface StrategySelection {
  strategy: ExtractionStrategy;
  reason: string;
}

export function selectStrategy(textContent: string, opts?: StrategyOptions): StrategySelection {
  if (opts?.isImage) {
    return { strategy: 'direct', reason: 'image file → direct (vision input)' };
  }

  const size = textContent.length;
  const sizeKB = Math.round(size / 1000);
  const directThreshold = opts?.directThreshold ?? DEFAULT_DIRECT_THRESHOLD;
  const chunkedThreshold = opts?.chunkedThreshold ?? DEFAULT_CHUNKED_THRESHOLD;

  if (size <= directThreshold) {
    return { strategy: 'direct', reason: `${sizeKB}KB text → direct` };
  }
  if (size <= chunkedThreshold) {
    return { strategy: 'chunked', reason: `${sizeKB}KB text → chunked` };
  }
  return { strategy: 'map-reduce', reason: `${sizeKB}KB text → map-reduce` };
}

export function chunkText(text: string, maxChunkSize = 8_000): string[] {
  const sections = text.split(/\n(?=#{1,3}\s)|(?=\f)/);

  const chunks: string[] = [];
  let current = '';

  for (const section of sections) {
    if (current.length + section.length > maxChunkSize && current.length > 0) {
      chunks.push(current.trim());
      current = '';
    }
    current += section;
  }
  if (current.trim()) {
    chunks.push(current.trim());
  }

  // Split any oversized chunks by paragraphs
  const final: string[] = [];
  for (const chunk of chunks) {
    if (chunk.length <= maxChunkSize) {
      final.push(chunk);
    } else {
      const paragraphs = chunk.split(/\n\n+/);
      let sub = '';
      for (const para of paragraphs) {
        if (sub.length + para.length > maxChunkSize && sub.length > 0) {
          final.push(sub.trim());
          sub = '';
        }
        sub += para + '\n\n';
      }
      if (sub.trim()) final.push(sub.trim());
    }
  }

  return final;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/reading-list/extraction-strategies.test.ts`
Expected: ALL PASS

- [ ] **Step 5: Commit**

```bash
git add src/core/extraction-strategies.ts tests/reading-list/extraction-strategies.test.ts
git commit -m "feat(reading-list): add tiered extraction strategy selection and chunking"
```

> **Scope note:** This task implements strategy *selection* and text *chunking*. The actual chunked and map-reduce extraction pipelines (multi-call LLM orchestration, cross-chunk dedup, summarize-then-extract) are follow-up work once the direct strategy is working end-to-end. The store (Task 7) uses the direct strategy for now; the `selectStrategy` and `chunkText` functions are ready for when the pipeline is extended.

---

## Task 7: Reading List Store Refactor

**Files:**
- Modify: `src/graph/store/reading-list-store.ts` (rewrite)

- [ ] **Step 1: Rewrite the store with new types**

Replace the contents of `src/graph/store/reading-list-store.ts`:

```typescript
// src/graph/store/reading-list-store.ts
import { create } from 'zustand';
import type { ReadingListResource, ResourceSource, ResourceStatus, ResourceError } from '../../shared/reading-list-types';
import { migrateReadingListItem } from '../../shared/reading-list-types';
import { storage, browser, platformId, llm, vaultWorkspace } from '@platform';
import { readingListExtractionSchema } from '../../shared/schema';
import { extractionProgress } from '../../core/extraction-progress-service';
import type { ReadingListItem } from '../../shared/types';

interface ReadingListStore {
  items: Record<string, ReadingListResource>;
  loading: boolean;
  selectedId: string | null;
  selectedIds: string[];

  loadFromStorage: () => Promise<void>;
  startSyncListener: () => () => void;

  selectItem: (id: string | null) => void;
  toggleSelectId: (id: string) => void;
  selectAllPending: () => void;
  clearSelection: () => void;
  addResource: (source: ResourceSource, title: string) => Promise<void>;
  fetchTitles: (ids: string[]) => Promise<void>;
  startBatchExtraction: () => void;
  retryResource: (id: string) => Promise<void>;
  markComplete: (id: string) => void;
  removeItem: (id: string) => void;
}

function generateFileId(): string {
  return `file-${crypto.randomUUID()}`;
}

function migrateItems(raw: Record<string, any>): Record<string, ReadingListResource> {
  const result: Record<string, ReadingListResource> = {};
  for (const [key, value] of Object.entries(raw)) {
    if (value && typeof value === 'object' && 'source' in value && 'id' in value) {
      result[key] = value as ReadingListResource;
    } else {
      const migrated = migrateReadingListItem(key, value as ReadingListItem);
      result[migrated.id] = migrated;
    }
  }
  return result;
}

export const useReadingListStore = create<ReadingListStore>((set, get) => ({
  items: {},
  loading: true,
  selectedId: null,
  selectedIds: [],

  loadFromStorage: async () => {
    set({ loading: true });
    try {
      const result = await storage.get('readingListItems') as Record<string, any>;
      const raw = (result.readingListItems as Record<string, any>) ?? {};
      const items = migrateItems(raw);
      set({ items, loading: false });
      await storage.set({ readingListItems: items });
    } catch (e) {
      console.error('[ReadingListStore] Failed to load from storage:', e);
      set({ loading: false });
    }
  },

  startSyncListener: () => {
    const storageListener = (changes: Record<string, { newValue?: unknown }>, areaName: string) => {
      if (areaName === 'local' && changes.readingListItems) {
        const raw = (changes.readingListItems.newValue as Record<string, any>) ?? {};
        set({ items: migrateItems(raw) });
      }
    };
    const cleanupStorage = storage.onChange(storageListener);

    const messageListener = (message: any) => {
      if (message.type === 'READING_LIST_EXTRACTION_RESULT') {
        const payload = message.payload;
        set((state) => {
          const items = { ...state.items };
          const item = Object.values(items).find(
            (i) => i.source.kind === 'url' && i.source.url === payload.url
          );
          if (!item) return state;

          if (payload.success) {
            items[item.id] = {
              ...item,
              status: 'ready',
              extraction: {
                summary: payload.summary,
                keyTopics: payload.keyTopics,
                nodes: payload.nodes,
                edges: payload.edges,
                pageContent: payload.pageContent ?? '',
                extractedAt: Date.now(),
              },
              error: undefined,
            };
          } else {
            items[item.id] = {
              ...item,
              status: 'pending',
              error: {
                message: payload.error ?? 'Extraction failed',
                stage: 'extract',
                failedAt: Date.now(),
                attempts: (item.error?.attempts ?? 0) + 1,
              },
            };
          }
          return { items };
        });
      }
    };
    const cleanupMessages = (browser as any).onRuntimeMessage(messageListener);

    return () => {
      cleanupStorage();
      cleanupMessages();
    };
  },

  selectItem: (id) => set({ selectedId: id }),

  toggleSelectId: (id) => set((state) => {
    const idx = state.selectedIds.indexOf(id);
    if (idx >= 0) {
      return { selectedIds: state.selectedIds.filter((i) => i !== id) };
    }
    return { selectedIds: [...state.selectedIds, id] };
  }),

  selectAllPending: () => set((state) => {
    const pendingIds = Object.values(state.items)
      .filter((i) => i.status === 'pending' && !i.error)
      .map((i) => i.id);
    return { selectedIds: pendingIds };
  }),

  clearSelection: () => set({ selectedIds: [] }),

  addResource: async (source, title) => {
    const id = source.kind === 'url' ? source.url : generateFileId();
    if (get().items[id]) return;

    let targetVaultPath: string | undefined;
    let targetVaultName: string | undefined;
    if (platformId === 'electron') {
      try {
        const status = await vaultWorkspace.getStatus();
        if (status.open) {
          targetVaultPath = status.path;
          targetVaultName = status.name;
        }
      } catch {}
    }

    const item: ReadingListResource = {
      id,
      source,
      title: title.trim() || id,
      addedAt: Date.now(),
      status: 'pending',
      targetVaultPath,
      targetVaultName,
    };
    set((state) => ({ items: { ...state.items, [id]: item } }));
    await storage.set({ readingListItems: get().items });
  },

  fetchTitles: async (ids) => {
    if (platformId !== 'electron') return;

    const ipc = (window as any).electronIPC;
    const BAD_TITLES = ['404', 'page not found', 'access denied', 'forbidden', 'not found', 'error', 'untitled'];

    for (const id of ids) {
      const item = get().items[id];
      if (!item || item.source.kind !== 'url') continue;

      try {
        const { html } = await ipc.invoke('fetch-url-content', item.source.url);
        if (!html) continue;

        const doc = new DOMParser().parseFromString(html, 'text/html');
        const rawTitle = doc.querySelector('title')?.textContent?.trim() ?? '';

        const domain = (() => { try { return new URL(item.source.url).hostname.replace('www.', ''); } catch { return ''; } })();
        const isUsable = rawTitle
          && rawTitle.toLowerCase() !== domain.toLowerCase()
          && !BAD_TITLES.some(bad => rawTitle.toLowerCase().includes(bad));

        let resolvedTitle = '';

        if (isUsable) {
          resolvedTitle = rawTitle;
        } else {
          try {
            const configResult = await storage.get('llmConfig') as Record<string, any>;
            const config = configResult.llmConfig;
            if (config?.apiKey) {
              const textContent = doc.body?.textContent?.slice(0, 2000) ?? '';
              if (textContent.trim()) {
                const result = await llm.streamChat({
                  requestId: crypto.randomUUID(),
                  model: config.model,
                  systemPrompt: 'Generate a concise title (about 5-8 words) for this web page content. Return only the title text, nothing else.',
                  messages: [{ role: 'user', content: textContent }],
                }, () => {});
                resolvedTitle = result.textContent.trim();
              }
            }
          } catch {}
        }

        if (resolvedTitle) {
          set((state) => ({
            items: {
              ...state.items,
              [id]: { ...state.items[id], title: resolvedTitle },
            },
          }));
          await storage.set({ readingListItems: get().items });
        }
      } catch {}

      if (ids.indexOf(id) < ids.length - 1) {
        await new Promise((r) => setTimeout(r, 500));
      }
    }
  },

  startBatchExtraction: async () => {
    const { items, selectedIds } = get();
    const ids = selectedIds.filter((id) => items[id]?.status === 'pending' && !items[id]?.error);
    set({ selectedIds: [] });

    const configResult = await storage.get('maxParallelExtractions') as Record<string, any>;
    const cap = configResult.maxParallelExtractions ?? 4;

    let active = 0;
    let idx = 0;
    await new Promise<void>((resolve) => {
      const next = () => {
        while (active < cap && idx < ids.length) {
          const id = ids[idx++];
          active++;
          get().retryResource(id).finally(() => {
            active--;
            if (idx >= ids.length && active === 0) resolve();
            else next();
          });
        }
        if (ids.length === 0) resolve();
      };
      next();
    });
  },

  retryResource: async (id) => {
    const item = get().items[id];
    if (!item) return;

    if (platformId === 'electron' && item.source.kind === 'url') {
      set((state) => ({
        items: { ...state.items, [id]: { ...state.items[id], status: 'processing' as const, error: undefined } },
      }));

      const url = item.source.url;
      try {
        extractionProgress.emit({ type: 'stage-start', resourceId: id, stage: 'fetch' });
        const ipc = (window as any).electronIPC;
        const { html, error: fetchError } = await ipc.invoke('fetch-url-content', url);
        if (fetchError || !html) throw new Error(fetchError ?? 'Empty response');
        extractionProgress.emit({ type: 'stage-complete', resourceId: id, stage: 'fetch', meta: { bytes: html.length } });

        extractionProgress.emit({ type: 'stage-start', resourceId: id, stage: 'parse' });
        const doc = new DOMParser().parseFromString(html, 'text/html');
        const textContent = doc.body?.textContent?.slice(0, 100_000) ?? '';
        if (!textContent.trim()) throw new Error('Page content is empty');
        extractionProgress.emit({ type: 'stage-complete', resourceId: id, stage: 'parse', meta: { chars: textContent.length } });

        const configResult = await storage.get('llmConfig') as Record<string, any>;
        const config = configResult.llmConfig;
        if (!config?.apiKey) throw new Error('No API key configured');

        extractionProgress.emit({ type: 'stage-start', resourceId: id, stage: 'extract' });

        const systemPrompt = `You are a reading assistant. Given a web page's content, produce:
1. A concise 2-3 sentence summary
2. 3-7 key topics as short labels
3. Important entities (nodes) and relationships (edges) for a knowledge graph

Return ONLY valid JSON:
{
  "summary": "...",
  "keyTopics": ["topic1", "topic2"],
  "nodes": [{ "name": "...", "label": "concept", "properties": {}, "tags": [] }],
  "edges": [{ "sourceName": "...", "targetName": "...", "label": "..." }]
}

Rules:
- Every node is an entity with a semantic label: concept, person, organization, technology, event, place, methodology.
- Use consistent, lowercase relationship labels.
- Ensure all edges reference nodes by exact name.`;

        const result = await llm.streamChat({
          requestId: crypto.randomUUID(),
          model: config.model,
          systemPrompt,
          messages: [{ role: 'user', content: `Page title: ${item.title}\nURL: ${url}\n\nPage content:\n${textContent}` }],
        }, (chunk) => {
          extractionProgress.emit({ type: 'llm-chunk', resourceId: id, text: chunk });
        });

        extractionProgress.emit({ type: 'stage-complete', resourceId: id, stage: 'extract' });

        extractionProgress.emit({ type: 'stage-start', resourceId: id, stage: 'validate' });
        const jsonMatch = result.textContent.match(/\{[\s\S]*\}/);
        if (!jsonMatch) throw new Error('No JSON in LLM response');

        let parsed;
        const MAX_RETRIES = 2;
        let lastError: Error | null = null;
        let rawJson = jsonMatch[0];

        for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
          try {
            parsed = readingListExtractionSchema.parse(JSON.parse(rawJson));
            break;
          } catch (validationError: any) {
            lastError = validationError;
            if (attempt < MAX_RETRIES) {
              const retryResult = await llm.streamChat({
                requestId: crypto.randomUUID(),
                model: config.model,
                systemPrompt: 'Fix the JSON below so it matches the required schema. Return ONLY the corrected JSON.',
                messages: [
                  { role: 'user', content: `JSON:\n${rawJson}\n\nValidation error:\n${validationError.message}\n\nFix the JSON and return only valid JSON.` },
                ],
              }, (chunk) => {
                extractionProgress.emit({ type: 'llm-chunk', resourceId: id, text: chunk });
              });
              const retryMatch = retryResult.textContent.match(/\{[\s\S]*\}/);
              if (retryMatch) rawJson = retryMatch[0];
            }
          }
        }
        if (!parsed) throw lastError ?? new Error('Validation failed after retries');
        extractionProgress.emit({ type: 'stage-complete', resourceId: id, stage: 'validate' });

        // Similarity stage runs in useReadingListMerge when user opens review

        set((state) => ({
          items: {
            ...state.items,
            [id]: {
              ...state.items[id],
              status: 'ready' as const,
              extraction: {
                summary: parsed.summary,
                keyTopics: parsed.keyTopics,
                nodes: parsed.nodes.map((n) => ({ name: n.name, type: n.type ?? 'entity', label: n.label, properties: n.properties, tags: n.tags })),
                edges: parsed.edges.map((e) => ({ sourceName: e.sourceName, targetName: e.targetName, label: e.label })),
                pageContent: textContent,
                extractedAt: Date.now(),
              },
              error: undefined,
            },
          },
        }));
        await storage.set({ readingListItems: get().items });
      } catch (e: any) {
        console.error('[ReadingListStore] Extraction failed:', e);
        const prevAttempts = item.error?.attempts ?? 0;
        set((state) => ({
          items: {
            ...state.items,
            [id]: {
              ...state.items[id],
              status: 'pending' as const,
              error: {
                message: e.message,
                stage: 'extract',
                failedAt: Date.now(),
                attempts: prevAttempts + 1,
              },
            },
          },
        }));
      }
    } else if (item.source.kind === 'url') {
      (browser as any).sendReadingListRetry(item.source.url).catch(console.error);
    }
  },

  markComplete: async (id) => {
    set((state) => {
      const item = state.items[id];
      if (!item) return state;
      return {
        items: { ...state.items, [id]: { ...item, status: 'complete' as const } },
        selectedId: state.selectedId === id ? null : state.selectedId,
      };
    });
    await storage.set({ readingListItems: get().items });
  },

  removeItem: (id) => {
    set((state) => {
      const items = { ...state.items };
      delete items[id];
      return {
        items,
        selectedId: state.selectedId === id ? null : state.selectedId,
      };
    });
  },
}));
```

- [ ] **Step 2: Update ReadingListPanel imports**

In `src/ui/components/reading-list/ReadingListPanel.tsx`, update the import of `isProcessing`:

```typescript
// Old:
import { useReadingListStore, isProcessing } from '../../../graph/store/reading-list-store';
import type { ReadingListItem } from '../../../shared/types';

// New:
import { useReadingListStore } from '../../../graph/store/reading-list-store';
import type { ReadingListResource } from '../../../shared/reading-list-types';
```

Update the filtering logic to use the new status model — replace `isProcessing(i.status)` with `i.status === 'processing'`, and replace `i.status === 'failed'` references. Replace `ReadingListItem` with `ReadingListResource`. Replace `item.url` references with `item.id` and update `selectedUrl`/`selectedUrls` references to `selectedId`/`selectedIds`.

- [ ] **Step 3: Update useReadingListMerge imports**

In `src/ui/hooks/useReadingListMerge.ts`, update:

```typescript
// Old:
import type { ReadingListItem } from '../../shared/types';
// New:
import type { ReadingListResource } from '../../shared/reading-list-types';
```

Update the `startMerge` function signature and body — replace `item.url` with `item.id`, `item.extractedNodes` with `item.extraction?.nodes`, `item.extractedEdges` with `item.extraction?.edges`, `item.pageContent` with `item.extraction?.pageContent`.

- [ ] **Step 4: Update ReadingListItemCard references**

In `src/ui/components/reading-list/ReadingListItemCard.tsx`, update the import:

```typescript
// Old:
import type { ReadingListItem } from '../../../shared/types';
// New:
import type { ReadingListResource } from '../../../shared/reading-list-types';
```

Replace all `ReadingListItem` with `ReadingListResource` in props and function signatures.

- [ ] **Step 5: Build and fix any remaining type errors**

Run: `npx tsc --noEmit 2>&1 | head -40`

Fix any remaining references to old types — search for `ReadingListItem` imports across the codebase and update them. The old type stays in `src/shared/types.ts` for the migration helper but should not be imported by UI code.

- [ ] **Step 6: Run all tests**

Run: `npx vitest run`
Expected: ALL PASS

- [ ] **Step 7: Commit**

```bash
git add src/graph/store/reading-list-store.ts src/ui/components/reading-list/ src/ui/hooks/useReadingListMerge.ts
git commit -m "refactor(reading-list): migrate store to ReadingListResource with 4-state machine"
```

---

## Task 8: Per-State Card Components

**Files:**
- Create: `src/ui/components/reading-list/PendingCard.tsx`
- Create: `src/ui/components/reading-list/ProcessingCard.tsx`
- Create: `src/ui/components/reading-list/ReadyCard.tsx`
- Modify: `src/ui/components/reading-list/ReadingListPanel.tsx`

- [ ] **Step 1: Create PendingCard**

```typescript
// src/ui/components/reading-list/PendingCard.tsx
import { useState } from 'react';
import { useReadingListStore } from '../../../graph/store/reading-list-store';
import type { ReadingListResource } from '../../../shared/reading-list-types';
import { isUrlSource } from '../../../shared/reading-list-types';

interface Props {
  item: ReadingListResource;
  selectMode?: boolean;
  checked: boolean;
  onCheck: () => void;
}

function getDomain(url: string): string {
  try { return new URL(url).hostname.replace('www.', ''); } catch { return url; }
}

function timeAgo(timestamp: number): string {
  const seconds = Math.floor((Date.now() - timestamp) / 1000);
  if (seconds < 60) return 'just now';
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

function getSourceLabel(item: ReadingListResource): { icon: 'url' | 'file'; label: string; badge?: string } {
  if (isUrlSource(item.source)) {
    return { icon: 'url', label: getDomain(item.source.url) };
  }
  const filename = item.source.filePath.split('/').pop() ?? item.source.filePath;
  const badge = item.source.imported ? 'in vault' : 'external';
  return { icon: 'file', label: filename, badge };
}

export function PendingCard({ item, selectMode, checked, onCheck }: Props) {
  const retryResource = useReadingListStore((s) => s.retryResource);
  const [expanded, setExpanded] = useState(false);
  const hasError = !!item.error;
  const sourceInfo = getSourceLabel(item);

  return (
    <div className={`rounded-lg bg-zinc-800 overflow-hidden ${
      hasError ? 'border border-red-900/50 border-l-[3px] border-l-red-500' : 'border border-zinc-700/50'
    }`}>
      <div className="flex items-start gap-2.5 px-3 py-2.5">
        {selectMode && !hasError && (
          <input
            type="checkbox"
            checked={checked}
            onChange={onCheck}
            className="mt-0.5 accent-indigo-500 flex-shrink-0"
          />
        )}
        <div className="flex-1 min-w-0">
          <div className="flex items-start justify-between gap-2">
            <h3 className="text-sm font-medium text-zinc-200 line-clamp-1 leading-tight flex-1 min-w-0">
              {item.title}
            </h3>
            <div className="flex gap-1.5 flex-shrink-0">
              {hasError && (
                <button
                  onClick={() => setExpanded(!expanded)}
                  className={`px-2 py-1 text-xs rounded-md transition-colors ${
                    expanded ? 'bg-zinc-600 text-zinc-200' : 'bg-zinc-700 text-zinc-400 hover:text-zinc-200'
                  }`}
                >
                  Detail
                </button>
              )}
              <button
                className="px-2.5 py-1 text-xs bg-indigo-600 hover:bg-indigo-500 text-white rounded-md transition-colors"
                onClick={(e) => { e.stopPropagation(); retryResource(item.id); }}
              >
                {hasError ? 'Retry' : 'Extract'}
              </button>
            </div>
          </div>
          <div className="flex items-center gap-2 mt-1">
            <span className="text-xs text-zinc-500">{sourceInfo.label}</span>
            {sourceInfo.badge && (
              <>
                <span className="text-xs text-zinc-600">&middot;</span>
                <span className={`text-[10px] px-1 py-0.5 rounded ${
                  sourceInfo.badge === 'in vault' ? 'bg-indigo-500/10 text-indigo-400' : 'bg-zinc-700/50 text-zinc-500'
                }`}>
                  {sourceInfo.badge}
                </span>
              </>
            )}
            <span className="text-xs text-zinc-600">&middot;</span>
            <span className="text-xs text-zinc-500">{timeAgo(item.addedAt)}</span>
            {hasError && (
              <>
                <span className="text-xs text-zinc-600">&middot;</span>
                <span className="text-xs text-red-400 flex items-center gap-1">
                  Failed &middot; {item.error!.attempts} attempt{item.error!.attempts > 1 ? 's' : ''}
                </span>
              </>
            )}
          </div>
        </div>
      </div>

      {hasError && expanded && (
        <div className="px-3 pb-3 border-t border-zinc-700/30">
          <div className="flex items-center gap-2 mt-2 mb-1.5">
            <span className="text-[10px] font-semibold text-red-400 uppercase tracking-wider">
              {item.error!.stage} stage failed
            </span>
            <span className="text-[10px] text-zinc-600">&middot;</span>
            <span className="text-[10px] text-zinc-500">{timeAgo(item.error!.failedAt)}</span>
          </div>
          <div className="bg-zinc-900 border border-zinc-800 rounded-md px-2.5 py-2 font-mono text-xs text-zinc-400 leading-relaxed">
            {item.error!.message}
          </div>
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Create ProcessingCard**

```typescript
// src/ui/components/reading-list/ProcessingCard.tsx
import type { ReadingListResource } from '../../../shared/reading-list-types';
import { useUIStore } from '../../../graph/store/ui-store';

interface Props {
  item: ReadingListResource;
}

function getSourceLabel(item: ReadingListResource): string {
  if (item.source.kind === 'url') {
    try { return new URL(item.source.url).hostname.replace('www.', ''); } catch { return item.source.url; }
  }
  return item.source.filePath.split('/').pop() ?? item.source.filePath;
}

export function ProcessingCard({ item }: Props) {
  const openDetail = () => {
    useUIStore.getState().openContentTab(
      { kind: 'extractionProgress', resourceId: item.id },
      `Extracting: ${item.title}`,
    );
  };

  return (
    <div className="rounded-lg bg-zinc-800 border border-zinc-700/50">
      <div className="flex items-center gap-2.5 px-3 py-2.5">
        <div className="flex-1 min-w-0">
          <h3 className="text-sm font-medium text-zinc-200 line-clamp-1 leading-tight">
            {item.title}
          </h3>
          <div className="flex items-center gap-2 mt-1">
            <span className="flex items-center gap-1.5">
              <span className="w-1.5 h-1.5 bg-blue-400 rounded-full animate-pulse" />
              <span className="text-xs text-blue-400">Extracting...</span>
            </span>
            <span className="text-xs text-zinc-600">&middot;</span>
            <span className="text-xs text-zinc-500">{getSourceLabel(item)}</span>
          </div>
        </div>
        <button
          onClick={openDetail}
          className="px-2 py-1 text-xs bg-zinc-700 text-zinc-400 hover:text-zinc-200 rounded-md transition-colors flex-shrink-0"
        >
          Detail
        </button>
      </div>
    </div>
  );
}
```

- [ ] **Step 3: Create ReadyCard**

```typescript
// src/ui/components/reading-list/ReadyCard.tsx
import type { ReadingListResource } from '../../../shared/reading-list-types';
import { isUrlSource } from '../../../shared/reading-list-types';

interface Props {
  item: ReadingListResource;
  selected: boolean;
  onSelect: () => void;
  onMerge: (item: ReadingListResource) => void;
  isMerging?: boolean;
}

function getDomain(url: string): string {
  try { return new URL(url).hostname.replace('www.', ''); } catch { return url; }
}

function timeAgo(timestamp: number): string {
  const seconds = Math.floor((Date.now() - timestamp) / 1000);
  if (seconds < 60) return 'just now';
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

export function ReadyCard({ item, selected, onSelect, onMerge, isMerging }: Props) {
  const entityCount = item.extraction?.nodes.length ?? 0;
  const edgeCount = item.extraction?.edges.length ?? 0;
  const matchCount = item.similarityMatches?.length ?? 0;
  const sourceLabel = isUrlSource(item.source)
    ? getDomain(item.source.url)
    : item.source.filePath.split('/').pop() ?? '';

  return (
    <div
      className={`px-3.5 py-3 rounded-lg border cursor-pointer transition-colors ${
        selected ? 'bg-zinc-800 border-indigo-500' : 'bg-zinc-800 border-zinc-700/50 hover:border-zinc-600'
      }`}
      onClick={onSelect}
    >
      <div className="flex items-start justify-between gap-3">
        <h3 className="text-sm font-medium text-zinc-200 line-clamp-2 leading-tight flex-1 min-w-0">
          {item.title}
        </h3>
        <button
          className={`px-2.5 py-1 text-xs rounded-md transition-colors flex-shrink-0 flex items-center gap-1.5 ${
            isMerging
              ? 'bg-indigo-600/50 text-indigo-200 cursor-wait'
              : 'bg-indigo-600 hover:bg-indigo-500 text-white'
          }`}
          disabled={isMerging}
          onClick={(e) => { e.stopPropagation(); onMerge(item); }}
        >
          {isMerging && (
            <svg className="animate-spin h-3 w-3" viewBox="0 0 24 24" fill="none">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
            </svg>
          )}
          {isMerging ? 'Preparing...' : 'Review & Merge'}
        </button>
      </div>

      <div className="flex items-center gap-2 mt-1.5">
        <span className="text-xs text-zinc-500">{sourceLabel}</span>
        <span className="text-xs text-zinc-600">&middot;</span>
        <span className="text-xs text-zinc-500">{timeAgo(item.addedAt)}</span>
        {entityCount > 0 && !selected && (
          <>
            <span className="text-xs text-zinc-600">&middot;</span>
            <span className="text-xs text-zinc-400">{entityCount} entities</span>
          </>
        )}
        {matchCount > 0 && !selected && (
          <>
            <span className="text-xs text-zinc-600">&middot;</span>
            <span className="text-xs text-amber-400">{matchCount} match{matchCount > 1 ? 'es' : ''}</span>
          </>
        )}
      </div>

      {selected && (
        <>
          {item.extraction?.summary && (
            <p className="text-xs text-zinc-400 mt-2 line-clamp-3 leading-relaxed">
              {item.extraction.summary}
            </p>
          )}
          {item.extraction?.keyTopics && item.extraction.keyTopics.length > 0 && (
            <div className="flex flex-wrap gap-1 mt-2">
              {item.extraction.keyTopics.map((topic, i) => (
                <span key={i} className="px-1.5 py-0.5 text-xs bg-zinc-700/50 text-zinc-300 rounded">
                  {topic}
                </span>
              ))}
            </div>
          )}
          <div className="text-xs text-zinc-500 mt-2">
            {entityCount} entities &middot; {edgeCount} relationships
            {matchCount > 0 && (
              <span className="text-amber-400"> &middot; {matchCount} potential match{matchCount > 1 ? 'es' : ''}</span>
            )}
          </div>
        </>
      )}
    </div>
  );
}
```

- [ ] **Step 4: Update ReadingListPanel to use new card components**

In `src/ui/components/reading-list/ReadingListPanel.tsx`, replace the `ReadingListItemCard` usage with the three new components:

```typescript
// Imports — replace:
import { ReadingListItemCard } from './ReadingListItemCard';
// With:
import { PendingCard } from './PendingCard';
import { ProcessingCard } from './ProcessingCard';
import { ReadyCard } from './ReadyCard';
import type { ReadingListResource } from '../../../shared/reading-list-types';
```

In the item list rendering section (around line 210), replace the `ReadingListItemCard` map with:

```typescript
sorted.map((item) => {
  if (activeTab === 'pending') {
    return (
      <PendingCard
        key={item.id}
        item={item}
        selectMode={selectMode}
        checked={selectedIds.includes(item.id)}
        onCheck={() => toggleSelectId(item.id)}
      />
    );
  }
  if (activeTab === 'processing') {
    return <ProcessingCard key={item.id} item={item} />;
  }
  return (
    <ReadyCard
      key={item.id}
      item={item}
      selected={selectedId === item.id}
      onSelect={() => selectItem(selectedId === item.id ? null : item.id)}
      onMerge={handleMerge}
      isMerging={mergingId === item.id}
    />
  );
})
```

Update all references: `selectedUrl` → `selectedId`, `selectedUrls` → `selectedIds`, `toggleSelectUrl` → `toggleSelectId`, `item.url` → `item.id`, `mergingUrl` → `mergingId`. Update the pending filter to include items with errors:

```typescript
const pending = allItems.filter((i) => i.status === 'pending');
const processing = allItems.filter((i) => i.status === 'processing');
const ready = allItems.filter((i) => i.status === 'ready');
```

The pending tab count should be `pending.length` (errors are included since they're also `pending` status now). Sort pending items with errors first:

```typescript
const sorted = [...filtered].sort((a, b) => {
  if (activeTab === 'pending') {
    const aError = a.error ? 1 : 0;
    const bError = b.error ? 1 : 0;
    if (aError !== bError) return bError - aError;
  }
  return b.addedAt - a.addedAt;
});
```

- [ ] **Step 5: Build and verify**

Run: `npm run build:electron-renderer 2>&1 | tail -5`
Expected: Build succeeds

- [ ] **Step 6: Commit**

```bash
git add src/ui/components/reading-list/PendingCard.tsx src/ui/components/reading-list/ProcessingCard.tsx src/ui/components/reading-list/ReadyCard.tsx src/ui/components/reading-list/ReadingListPanel.tsx
git commit -m "feat(reading-list): per-state card components (PendingCard, ProcessingCard, ReadyCard)"
```

---

## Task 9: AddResourceModal with URL/Files Tabs

**Files:**
- Create: `src/ui/components/reading-list/AddResourceModal.tsx`
- Modify: `src/ui/components/reading-list/ReadingListPanel.tsx`

- [ ] **Step 1: Create AddResourceModal**

```typescript
// src/ui/components/reading-list/AddResourceModal.tsx
import { useState, useRef, useEffect, useMemo } from 'react';
import { useReadingListStore } from '../../../graph/store/reading-list-store';
import { SUPPORTED_FILE_EXTENSIONS } from '../../../shared/reading-list-types';

type ParsedUrl = {
  raw: string;
  normalized: string;
  domain: string;
  status: 'valid' | 'insecure' | 'duplicate' | 'invalid';
};

function parseUrls(text: string, existingIds: Set<string>): ParsedUrl[] {
  const lines = text.split('\n').map((l) => l.trim()).filter(Boolean);
  const seen = new Set<string>();
  const results: ParsedUrl[] = [];

  for (const raw of lines) {
    let normalized = raw;
    if (!/^https?:\/\//i.test(normalized)) normalized = `https://${normalized}`;

    let domain = '';
    try {
      const u = new URL(normalized);
      domain = u.hostname.replace('www.', '');
    } catch {
      results.push({ raw, normalized, domain: '', status: 'invalid' });
      continue;
    }

    if (existingIds.has(normalized) || seen.has(normalized)) {
      results.push({ raw, normalized, domain, status: 'duplicate' });
      continue;
    }

    seen.add(normalized);
    const isHttp = normalized.startsWith('http://');
    results.push({ raw, normalized, domain, status: isHttp ? 'insecure' : 'valid' });
  }

  return results;
}

type ActiveTab = 'urls' | 'files';

interface AddResourceModalProps {
  onClose: () => void;
  onFilesSelected: (files: File[]) => void;
}

export function AddResourceModal({ onClose, onFilesSelected }: AddResourceModalProps) {
  const [tab, setTab] = useState<ActiveTab>('urls');
  const [text, setText] = useState('');
  const backdropRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const items = useReadingListStore((s) => s.items);
  const addResource = useReadingListStore((s) => s.addResource);
  const fetchTitles = useReadingListStore((s) => s.fetchTitles);

  useEffect(() => {
    if (tab === 'urls') textareaRef.current?.focus();
    const handleKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [tab, onClose]);

  const existingIds = useMemo(() => new Set(Object.keys(items)), [items]);
  const parsed = useMemo(() => parseUrls(text, existingIds), [text, existingIds]);
  const addable = parsed.filter((p) => p.status === 'valid' || p.status === 'insecure');

  const handleAddUrls = async () => {
    if (addable.length === 0) return;
    const ids: string[] = [];
    for (const p of addable) {
      const domain = p.domain || p.normalized;
      await addResource({ kind: 'url', url: p.normalized }, domain);
      ids.push(p.normalized);
    }
    fetchTitles(ids);
    onClose();
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files ?? []);
    const supported = files.filter((f) => {
      const ext = f.name.split('.').pop()?.toLowerCase() ?? '';
      return SUPPORTED_FILE_EXTENSIONS.has(ext);
    });
    if (supported.length > 0) {
      onFilesSelected(supported);
      onClose();
    }
  };

  const acceptExtensions = [...SUPPORTED_FILE_EXTENSIONS].map((e) => `.${e}`).join(',');

  return (
    <div
      ref={backdropRef}
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60"
      onClick={(e) => { if (e.target === backdropRef.current) onClose(); }}
    >
      <div
        className="relative bg-zinc-900 border border-zinc-700 rounded-lg shadow-2xl flex flex-col"
        style={{ width: 480, maxHeight: '80vh' }}
      >
        <div className="flex items-center justify-between px-4 py-3 border-b border-zinc-700">
          <h2 className="text-sm font-semibold text-zinc-100">Add to Reading List</h2>
          <button onClick={onClose} className="p-1 rounded text-zinc-400 hover:text-zinc-200 hover:bg-zinc-700 transition-colors">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
              <path d="M18 6 6 18M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Tab toggle */}
        <div className="flex gap-2 px-4 pt-3">
          <button
            onClick={() => setTab('urls')}
            className={`flex-1 py-1.5 text-xs font-medium rounded-md transition-colors ${
              tab === 'urls' ? 'bg-indigo-600 text-white' : 'bg-zinc-800 text-zinc-400 border border-zinc-700'
            }`}
          >
            URLs
          </button>
          <button
            onClick={() => setTab('files')}
            className={`flex-1 py-1.5 text-xs font-medium rounded-md transition-colors ${
              tab === 'files' ? 'bg-indigo-600 text-white' : 'bg-zinc-800 text-zinc-400 border border-zinc-700'
            }`}
          >
            Files
          </button>
        </div>

        {/* Tab content */}
        <div className="px-4 py-3 flex flex-col gap-3 overflow-y-auto">
          {tab === 'urls' ? (
            <>
              <p className="text-xs text-zinc-500">Paste one URL per line</p>
              <textarea
                ref={textareaRef}
                value={text}
                onChange={(e) => setText(e.target.value)}
                rows={6}
                placeholder={"https://example.com/article-one\nhttps://example.com/article-two"}
                className="w-full bg-zinc-800 border border-zinc-700 rounded-md px-3 py-2 text-xs text-zinc-200 placeholder-zinc-600 font-mono outline-none focus:border-indigo-500 resize-y"
              />
              {parsed.length > 0 && (
                <div className="flex flex-col gap-1.5">
                  {parsed.map((p, i) => (
                    <div key={i} className={`flex items-center gap-2 text-xs px-2 py-1.5 rounded ${
                      p.status === 'invalid' || p.status === 'duplicate' ? 'text-zinc-500' : 'text-zinc-300'
                    }`}>
                      <span className={`w-2 h-2 rounded-full flex-shrink-0 ${
                        p.status === 'valid' ? 'bg-emerald-500' : p.status === 'insecure' ? 'bg-amber-500' : p.status === 'duplicate' ? 'bg-zinc-600' : 'bg-red-400'
                      }`} />
                      <span className="truncate flex-1 min-w-0">{p.domain || p.raw}</span>
                      {p.status === 'duplicate' && <span className="text-zinc-500 flex-shrink-0">already added</span>}
                      {p.status === 'invalid' && <span className="text-red-400 flex-shrink-0">invalid</span>}
                      {p.status === 'insecure' && <span className="text-amber-500 flex-shrink-0">insecure</span>}
                    </div>
                  ))}
                </div>
              )}
            </>
          ) : (
            <>
              <p className="text-xs text-zinc-500">Select files to add (.md, .txt, .pdf, .html, .json, .csv, images)</p>
              <button
                onClick={() => fileInputRef.current?.click()}
                className="w-full bg-zinc-800 border border-zinc-700 border-dashed rounded-lg py-6 text-center text-sm text-zinc-400 hover:border-indigo-500 hover:text-zinc-300 transition-colors"
              >
                Choose Files...
              </button>
              <input
                ref={fileInputRef}
                type="file"
                multiple
                accept={acceptExtensions}
                onChange={handleFileChange}
                className="hidden"
              />
            </>
          )}
        </div>

        {/* Footer — only for URLs tab */}
        {tab === 'urls' && (
          <div className="flex justify-end gap-2 px-4 py-3 border-t border-zinc-700">
            <button onClick={onClose} className="px-3 py-1.5 text-xs text-zinc-400 hover:text-zinc-200 transition-colors">
              Cancel
            </button>
            <button
              onClick={handleAddUrls}
              disabled={addable.length === 0}
              className="px-3 py-1.5 text-xs bg-indigo-600 hover:bg-indigo-500 text-white rounded-md transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {addable.length === 0 ? 'Add URLs' : `Add ${addable.length} URL${addable.length > 1 ? 's' : ''}`}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Update ReadingListPanel — rename button, swap modal**

In `ReadingListPanel.tsx`:

Replace `AddUrlModal` import with `AddResourceModal`. Update the button text from `"+ Add URL"` to `"+ Add"`. Pass an `onFilesSelected` callback that will be wired to the `FileImportDialog` in the next task.

```typescript
// Replace:
import { AddUrlModal } from './AddUrlModal';
// With:
import { AddResourceModal } from './AddResourceModal';
```

Replace modal rendering:

```typescript
{showAddModal && (
  <AddResourceModal
    onClose={() => setShowAddModal(false)}
    onFilesSelected={(files) => {
      setPendingFiles(files.map((f) => ({ name: f.name, path: (f as any).path ?? f.name })));
      setShowAddModal(false);
    }}
  />
)}
```

- [ ] **Step 3: Build and verify**

Run: `npm run build:electron-renderer 2>&1 | tail -5`
Expected: Build succeeds

- [ ] **Step 4: Commit**

```bash
git add src/ui/components/reading-list/AddResourceModal.tsx src/ui/components/reading-list/ReadingListPanel.tsx
git commit -m "feat(reading-list): AddResourceModal with URL/Files tabs"
```

---

## Task 10: File Import Infrastructure

**Files:**
- Create: `src/ui/components/reading-list/FileImportDialog.tsx`
- Create: `src/ui/components/reading-list/DropZoneOverlay.tsx`
- Modify: `electron/main.ts` (add IPC handlers)
- Modify: `src/ui/components/reading-list/ReadingListPanel.tsx`

- [ ] **Step 1: Add file IPC handlers in electron/main.ts**

Find the IPC handler section in `electron/main.ts` and add two new handlers:

```typescript
ipcMain.handle('dialog:open-files', async (_event, extensions: string[]) => {
  const win = BrowserWindow.getFocusedWindow();
  if (!win) return { canceled: true, filePaths: [] };
  const result = await dialog.showOpenDialog(win, {
    title: 'Choose files to add to Reading List',
    properties: ['openFile', 'multiSelections'],
    filters: [{ name: 'Supported Files', extensions }],
  });
  return result;
});

ipcMain.handle('file:copy-to-vault', async (_event, sourcePath: string, vaultPath: string, destFolder: string) => {
  const fs = await import('fs/promises');
  const path = await import('path');
  const destDir = path.join(vaultPath, destFolder);
  await fs.mkdir(destDir, { recursive: true });
  const filename = path.basename(sourcePath);
  const destPath = path.join(destDir, filename);
  await fs.copyFile(sourcePath, destPath);
  return { vaultRelativePath: `${destFolder}/${filename}` };
});
```

- [ ] **Step 2: Create FileImportDialog**

```typescript
// src/ui/components/reading-list/FileImportDialog.tsx
import { useState, useRef } from 'react';

interface FileImportDialogProps {
  files: Array<{ name: string; path: string }>;
  onConfirm: (opts: { imported: boolean; keepOriginal: boolean }) => void;
  onCancel: () => void;
}

export function FileImportDialog({ files, onConfirm, onCancel }: FileImportDialogProps) {
  const [imported, setImported] = useState(true);
  const [keepOriginal, setKeepOriginal] = useState(true);
  const backdropRef = useRef<HTMLDivElement>(null);

  return (
    <div
      ref={backdropRef}
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60"
      onClick={(e) => { if (e.target === backdropRef.current) onCancel(); }}
    >
      <div className="bg-zinc-900 border border-zinc-700 rounded-lg shadow-2xl" style={{ width: 400 }}>
        <div className="px-4 py-3 border-b border-zinc-700">
          <h2 className="text-sm font-semibold text-zinc-100">Add {files.length} file{files.length > 1 ? 's' : ''} to Reading List</h2>
          <p className="text-xs text-zinc-500 mt-1">{files.map((f) => f.name).join(', ')}</p>
        </div>

        <div className="px-4 py-3 flex flex-col gap-2">
          <label
            className={`flex items-start gap-2 p-2.5 rounded-lg cursor-pointer border transition-colors ${
              imported ? 'bg-zinc-800 border-indigo-500' : 'bg-zinc-800 border-zinc-700'
            }`}
            onClick={() => setImported(true)}
          >
            <input type="radio" checked={imported} onChange={() => setImported(true)} className="mt-0.5 accent-indigo-500" />
            <div>
              <div className="text-xs font-medium text-zinc-200">Import into vault</div>
              <div className="text-[11px] text-zinc-500">Copy files into <code className="text-amber-400">raw/</code> folder</div>
            </div>
          </label>

          <label
            className={`flex items-start gap-2 p-2.5 rounded-lg cursor-pointer border transition-colors ${
              !imported ? 'bg-zinc-800 border-indigo-500' : 'bg-zinc-800 border-zinc-700'
            }`}
            onClick={() => setImported(false)}
          >
            <input type="radio" checked={!imported} onChange={() => setImported(false)} className="mt-0.5 accent-indigo-500" />
            <div>
              <div className="text-xs font-medium text-zinc-200">Reference only</div>
              <div className="text-[11px] text-zinc-500">Store file path — file stays where it is</div>
            </div>
          </label>

          {imported && (
            <label className="flex items-center gap-2 text-xs text-zinc-400 px-1 mt-1">
              <input type="checkbox" checked={keepOriginal} onChange={(e) => setKeepOriginal(e.target.checked)} className="accent-indigo-500" />
              Keep original files after import
            </label>
          )}
        </div>

        <div className="flex justify-end gap-2 px-4 py-3 border-t border-zinc-700">
          <button onClick={onCancel} className="px-3 py-1.5 text-xs text-zinc-400 hover:text-zinc-200 transition-colors">
            Cancel
          </button>
          <button
            onClick={() => onConfirm({ imported, keepOriginal })}
            className="px-3 py-1.5 text-xs bg-indigo-600 hover:bg-indigo-500 text-white rounded-md transition-colors"
          >
            Add Files
          </button>
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 3: Create DropZoneOverlay**

```typescript
// src/ui/components/reading-list/DropZoneOverlay.tsx
import { SUPPORTED_FILE_EXTENSIONS } from '../../../shared/reading-list-types';

interface Props {
  visible: boolean;
}

export function DropZoneOverlay({ visible }: Props) {
  if (!visible) return null;
  return (
    <div className="absolute inset-0 z-40 flex items-center justify-center bg-zinc-900/80 rounded-lg border-2 border-dashed border-indigo-500 pointer-events-none">
      <div className="text-center">
        <div className="text-2xl mb-2">📄</div>
        <div className="text-sm text-zinc-300">Drop files to add</div>
        <div className="text-xs text-zinc-500 mt-1">
          {[...SUPPORTED_FILE_EXTENSIONS].map((e) => `.${e}`).join(', ')}
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Wire DnD and file import into ReadingListPanel**

In `ReadingListPanel.tsx`, add DnD handling and file import state:

```typescript
// Add imports:
import { FileImportDialog } from './FileImportDialog';
import { DropZoneOverlay } from './DropZoneOverlay';
import { SUPPORTED_FILE_EXTENSIONS } from '../../../shared/reading-list-types';

// Add state inside ReadingListPanel:
const [isDragging, setIsDragging] = useState(false);
const [pendingFiles, setPendingFiles] = useState<Array<{ name: string; path: string }> | null>(null);

// Add DnD handlers:
const handleDragOver = (e: React.DragEvent) => {
  e.preventDefault();
  setIsDragging(true);
};
const handleDragLeave = (e: React.DragEvent) => {
  if (e.currentTarget.contains(e.relatedTarget as Node)) return;
  setIsDragging(false);
};
const handleDrop = (e: React.DragEvent) => {
  e.preventDefault();
  setIsDragging(false);
  const files = Array.from(e.dataTransfer.files).filter((f) => {
    const ext = f.name.split('.').pop()?.toLowerCase() ?? '';
    return SUPPORTED_FILE_EXTENSIONS.has(ext);
  });
  if (files.length > 0) {
    setPendingFiles(files.map((f) => ({ name: f.name, path: (f as any).path ?? f.name })));
  }
};

const handleFileImportConfirm = async (opts: { imported: boolean; keepOriginal: boolean }) => {
  if (!pendingFiles) return;
  const ipc = (window as any).electronIPC;
  const vaultStatus = await vaultWorkspace.getStatus();

  for (const file of pendingFiles) {
    let source: any;
    if (opts.imported && vaultStatus?.path) {
      const { vaultRelativePath } = await ipc.invoke('file:copy-to-vault', file.path, vaultStatus.path, 'raw');
      source = { kind: 'file', filePath: file.path, imported: true, vaultPath: vaultRelativePath, keepOriginal: opts.keepOriginal };
    } else {
      source = { kind: 'file', filePath: file.path, imported: false };
    }
    await addResource(source, file.name.replace(/\.[^.]+$/, ''));
  }
  setPendingFiles(null);
};
```

Add DnD props to the root div and render the overlay + dialog:

```typescript
// On the root div, add:
onDragOver={handleDragOver}
onDragLeave={handleDragLeave}
onDrop={handleDrop}
style={{ position: 'relative' }}

// Inside the component, render:
<DropZoneOverlay visible={isDragging} />
{pendingFiles && (
  <FileImportDialog
    files={pendingFiles}
    onConfirm={handleFileImportConfirm}
    onCancel={() => setPendingFiles(null)}
  />
)}
```

Also wire the `onFilesSelected` in `AddResourceModal` to trigger the same import dialog:

```typescript
onFilesSelected={(files) => {
  setPendingFiles(files.map((f) => ({ name: f.name, path: (f as any).path ?? f.name })));
  setShowAddModal(false);
}}
```

- [ ] **Step 5: Build and verify**

Run: `npm run build:electron-renderer 2>&1 | tail -5 && npm run build:electron-main 2>&1 | tail -5`
Expected: Both builds succeed

- [ ] **Step 6: Commit**

```bash
git add src/ui/components/reading-list/FileImportDialog.tsx src/ui/components/reading-list/DropZoneOverlay.tsx src/ui/components/reading-list/ReadingListPanel.tsx electron/main.ts
git commit -m "feat(reading-list): local file support with DnD, picker, import dialog, raw/ folder"
```

---

## Task 11: ExtractionProgressPanel

**Files:**
- Create: `src/ui/components/reading-list/ExtractionProgressPanel.tsx`
- Modify: `src/ui/components/llm/ExtractionReviewTab.tsx` (route new tab kind)

- [ ] **Step 1: Create ExtractionProgressPanel**

```typescript
// src/ui/components/reading-list/ExtractionProgressPanel.tsx
import { useState, useEffect, useRef } from 'react';
import { extractionProgress } from '../../../core/extraction-progress-service';
import type { ExtractionProgressEvent, ExtractionStage } from '../../../shared/reading-list-types';

interface Props {
  resourceId: string;
}

interface StageInfo {
  stage: ExtractionStage;
  label: string;
  status: 'pending' | 'active' | 'complete' | 'error';
  meta?: Record<string, unknown>;
  errorMessage?: string;
}

const STAGE_LABELS: Record<ExtractionStage, string> = {
  fetch: 'Fetch content',
  parse: 'Parse text',
  extract: 'Extract entities',
  validate: 'Validate schema',
  similarity: 'Check for similar nodes',
};

type ViewMode = 'steps' | 'stream';

export function ExtractionProgressPanel({ resourceId }: Props) {
  const [view, setView] = useState<ViewMode>('steps');
  const [stages, setStages] = useState<StageInfo[]>(
    Object.entries(STAGE_LABELS).map(([stage, label]) => ({
      stage: stage as ExtractionStage,
      label,
      status: 'pending',
    }))
  );
  const [streamText, setStreamText] = useState('');
  const [strategy, setStrategy] = useState<string | null>(null);
  const [chunkProgress, setChunkProgress] = useState<{ current: number; total: number; label?: string } | null>(null);
  const streamRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const cleanup = extractionProgress.on(resourceId, (event: ExtractionProgressEvent) => {
      switch (event.type) {
        case 'stage-start':
          setStages((prev) => prev.map((s) =>
            s.stage === event.stage ? { ...s, status: 'active' } : s
          ));
          break;
        case 'stage-complete':
          setStages((prev) => prev.map((s) =>
            s.stage === event.stage ? { ...s, status: 'complete', meta: event.meta as any } : s
          ));
          break;
        case 'llm-chunk':
          setStreamText((prev) => prev + event.text);
          break;
        case 'strategy-selected':
          setStrategy(event.reason);
          break;
        case 'chunk-progress':
          setChunkProgress({ current: event.current, total: event.total, label: event.label });
          break;
        case 'error':
          setStages((prev) => prev.map((s) =>
            s.stage === event.stage ? { ...s, status: 'error', errorMessage: event.message } : s
          ));
          break;
      }
    });
    return cleanup;
  }, [resourceId]);

  useEffect(() => {
    if (view === 'stream' && streamRef.current) {
      streamRef.current.scrollTop = streamRef.current.scrollHeight;
    }
  }, [streamText, view]);

  return (
    <div className="flex flex-col h-full overflow-hidden">
      <div className="flex items-center gap-2 px-4 py-3 border-b border-zinc-700/50">
        <h2 className="text-sm font-semibold text-zinc-200 flex-1">Extraction Progress</h2>
        <div className="flex gap-1">
          <button
            onClick={() => setView('steps')}
            className={`px-2.5 py-1 text-xs rounded-md transition-colors ${
              view === 'steps' ? 'bg-indigo-600 text-white' : 'bg-zinc-800 text-zinc-400'
            }`}
          >
            Steps
          </button>
          <button
            onClick={() => setView('stream')}
            className={`px-2.5 py-1 text-xs rounded-md transition-colors ${
              view === 'stream' ? 'bg-indigo-600 text-white' : 'bg-zinc-800 text-zinc-400'
            }`}
          >
            Raw Stream
          </button>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-4">
        {strategy && (
          <div className="text-xs text-zinc-500 mb-3 px-1">Strategy: {strategy}</div>
        )}

        {view === 'steps' ? (
          <div className="flex flex-col gap-3">
            {stages.map((s) => (
              <div key={s.stage} className="flex items-center gap-3">
                <div className="w-5 h-5 flex-shrink-0 flex items-center justify-center">
                  {s.status === 'complete' && (
                    <div className="w-5 h-5 rounded-full bg-emerald-500 flex items-center justify-center">
                      <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="3" strokeLinecap="round"><polyline points="20 6 9 17 4 12" /></svg>
                    </div>
                  )}
                  {s.status === 'active' && (
                    <div className="w-5 h-5 rounded-full border-2 border-indigo-500 flex items-center justify-center">
                      <div className="w-2.5 h-2.5 border-2 border-indigo-500 border-t-transparent rounded-full animate-spin" />
                    </div>
                  )}
                  {s.status === 'pending' && (
                    <div className="w-5 h-5 rounded-full border-2 border-zinc-600" />
                  )}
                  {s.status === 'error' && (
                    <div className="w-5 h-5 rounded-full bg-red-500 flex items-center justify-center">
                      <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="3" strokeLinecap="round"><path d="M18 6 6 18M6 6l12 12" /></svg>
                    </div>
                  )}
                </div>
                <div>
                  <div className={`text-sm ${s.status === 'pending' ? 'text-zinc-500' : 'text-zinc-200'}`}>
                    {s.label}
                  </div>
                  {s.status === 'active' && s.stage === 'extract' && chunkProgress && (
                    <div className="text-xs text-indigo-400">Chunk {chunkProgress.current}/{chunkProgress.total}{chunkProgress.label ? ` — ${chunkProgress.label}` : ''}</div>
                  )}
                  {s.status === 'complete' && s.meta && (
                    <div className="text-xs text-zinc-500">
                      {s.meta.ms && `${Math.round(s.meta.ms as number)}ms`}
                      {s.meta.bytes && ` · ${Math.round((s.meta.bytes as number) / 1000)}KB`}
                      {s.meta.chars && ` · ${(s.meta.chars as number).toLocaleString()} chars`}
                    </div>
                  )}
                  {s.status === 'error' && s.errorMessage && (
                    <div className="text-xs text-red-400">{s.errorMessage}</div>
                  )}
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div
            ref={streamRef}
            className="bg-zinc-900 border border-zinc-800 rounded-lg p-3 font-mono text-xs text-zinc-400 leading-relaxed max-h-full overflow-y-auto whitespace-pre-wrap"
          >
            {streamText || <span className="text-zinc-600">Waiting for LLM output...</span>}
            <span className="text-indigo-500 animate-pulse">|</span>
          </div>
        )}
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Route the new tab kind in the content area**

Find the content tab router (the component that switches on `tab.type.kind` to render the correct panel). Add a case for `'extractionProgress'`:

```typescript
// In the content tab rendering logic, add:
import { ExtractionProgressPanel } from '../reading-list/ExtractionProgressPanel';

// In the switch/conditional:
if (tab.type.kind === 'extractionProgress') {
  return <ExtractionProgressPanel resourceId={tab.type.resourceId} />;
}
```

The exact file depends on how content tabs are rendered — check `src/ui/components/layout/` or the main content area component that reads `activeTab.type.kind`.

- [ ] **Step 3: Build and verify**

Run: `npm run build:electron-renderer 2>&1 | tail -5`
Expected: Build succeeds

- [ ] **Step 4: Commit**

```bash
git add src/ui/components/reading-list/ExtractionProgressPanel.tsx
git commit -m "feat(reading-list): ExtractionProgressPanel with steps/stream toggle"
```

---

## Task 12: Similarity Integration into buildDiffItems

**Files:**
- Modify: `src/ui/hooks/useLLMExtraction.ts:130-196`
- Modify: `src/ui/hooks/useReadingListMerge.ts`

- [ ] **Step 1: Extend buildDiffItems to accept similarity matches**

In `src/ui/hooks/useLLMExtraction.ts`, update the `buildDiffItems` function signature and body:

```typescript
// Add import:
import type { SimilarityMatch } from '../../shared/reading-list-types';

// Update signature — add optional param:
export async function buildDiffItems(
  validated: {
    nodes: Array<{ name: string; type?: string; label?: string; properties?: Record<string, unknown>; tags?: string[] }>;
    edges: Array<{ sourceName: string; targetName: string; label: string; type?: string }>;
    notes?: Array<{ title: string; content: string; about?: string[]; mentions?: string[] }>;
  },
  similarityMatches?: SimilarityMatch[],
): Promise<{ items: DiffItem[]; notes: ExtractedNoteCandidate[] }> {
```

Inside the `nodeItems` mapping, after the existing entity resolution (the `try/catch` block around `entityResolution.findMatches`), add similarity match lookup before falling through to `'add'`:

```typescript
// After the try/catch for entityResolution.findMatches, add:

// Check pre-computed similarity matches
if (similarityMatches) {
  const simMatch = similarityMatches.find(
    (m) => m.extractedNodeName.toLowerCase() === node.name.toLowerCase()
  );
  if (simMatch) {
    const existingNode = graph.nodes.find((n) => n.id === simMatch.existingNodeId);
    if (existingNode) {
      const autoAccept = simMatch.matchType === 'exact';
      return {
        action: 'merge',
        type: 'node',
        extracted: node,
        existingMatch: existingNode,
        accepted: autoAccept,
        similarityInfo: {
          matchType: simMatch.matchType,
          score: simMatch.score,
        },
      };
    }
  }
}
```

- [ ] **Step 2: Run similarity detection in useReadingListMerge**

In `src/ui/hooks/useReadingListMerge.ts`, add similarity detection before calling `buildDiffItems`:

```typescript
// Add imports:
import { findSimilarityMatches, type ExistingNodeInfo } from '../../core/similarity-service';
import { extractionProgress } from '../../core/extraction-progress-service';
import { useGraphStore } from '../../graph/store/graph-store';

// In startMerge, before the buildDiffItems call:
// Run similarity detection
extractionProgress.emit({ type: 'stage-start', resourceId: item.id, stage: 'similarity' });
let similarityMatches = item.similarityMatches;
if (!similarityMatches) {
  try {
    const graphNodes = useGraphStore.getState().nodes;
    const existingNodes: ExistingNodeInfo[] = graphNodes
      .filter((n) => n.type === 'entity')
      .map((n) => ({ id: n.id, name: n.name, label: n.label, summary: n.summary }));

    const embeddingSearch = await getEmbeddingSearch();
    similarityMatches = await findSimilarityMatches(
      item.extraction!.nodes,
      existingNodes,
      embeddingSearch,
    );
  } catch {
    similarityMatches = [];
  }
  extractionProgress.emit({ type: 'stage-complete', resourceId: item.id, stage: 'similarity' });
}

// Update buildDiffItems call:
const { items, notes } = await buildDiffItems(validated, similarityMatches);
```

Add the embedding search helper:

```typescript
async function getEmbeddingSearch(): Promise<((text: string, topK: number) => Promise<Array<{ nodeId: string; score: number }>>) | undefined> {
  try {
    const ipc = (window as any).electronIPC;
    const available = await ipc.invoke('embedding:is-available');
    if (!available) return undefined;
    return async (text: string, topK: number) => {
      return ipc.invoke('embedding:search-similar', text, topK);
    };
  } catch {
    return undefined;
  }
}
```

- [ ] **Step 3: Build and verify**

Run: `npm run build:electron-renderer 2>&1 | tail -5`
Expected: Build succeeds

- [ ] **Step 4: Commit**

```bash
git add src/ui/hooks/useLLMExtraction.ts src/ui/hooks/useReadingListMerge.ts
git commit -m "feat(reading-list): integrate similarity detection into extraction review flow"
```

---

## Task 13: Cleanup and Final Verification

**Files:**
- Delete: `src/ui/components/reading-list/AddUrlModal.tsx` (replaced by AddResourceModal)
- Modify: Any remaining imports of old types

- [ ] **Step 1: Remove old AddUrlModal**

```bash
git rm src/ui/components/reading-list/AddUrlModal.tsx
```

- [ ] **Step 2: Search for remaining old imports**

```bash
grep -rn 'AddUrlModal\|ReadingListItem\b\|isProcessing.*reading' src/ui/ src/graph/store/ --include='*.ts' --include='*.tsx' | grep -v 'node_modules' | grep -v 'types.ts'
```

Fix any remaining references. The old `ReadingListItem` type should only be imported by the migration helper in `reading-list-types.ts`.

- [ ] **Step 3: Run full test suite**

Run: `npx vitest run`
Expected: ALL PASS

- [ ] **Step 4: Build both targets**

Run: `npm run build:electron-renderer && npm run build:electron-main`
Expected: Both succeed

- [ ] **Step 5: Manual smoke test**

Run: `npx electron .`

Verify:
1. Reading list panel opens with Pending/Processing/Ready tabs
2. "+ Add" button opens modal with URL/Files tabs
3. Adding a URL creates a pending item
4. Clicking "Extract" moves item to processing (blue pulse, Detail button visible)
5. On success, item appears in Ready tab with entity count
6. On failure, item returns to Pending with red border and error detail
7. Clicking "Review & Merge" opens extraction review with similarity matches shown

- [ ] **Step 6: Commit cleanup**

```bash
git add -A
git commit -m "chore(reading-list): cleanup old AddUrlModal, fix remaining type references"
```

---

## Task Summary

| Task | Description | Dependencies |
|---|---|---|
| 1 | Types and migration helper | None |
| 2 | ExtractionProgressService | None |
| 3 | Extend review store matchType | None |
| 4 | Add extractionProgress content tab type | None |
| 5 | Similarity service | Task 1 |
| 6 | Extraction strategy selection | Task 1 |
| 7 | Store refactor | Tasks 1, 2 |
| 8 | Per-state card components | Task 7 |
| 9 | AddResourceModal | Task 8 |
| 10 | File import infrastructure | Tasks 8, 9 |
| 11 | ExtractionProgressPanel | Tasks 2, 4 |
| 12 | Similarity integration into review | Tasks 5, 7 |
| 13 | Cleanup and verification | All |

**Independent parallelizable groups:**
- Group A: Tasks 1–4 (foundation, all independent)
- Group B: Tasks 5–6 (services, depend on Task 1)
- Group C: Task 7 (store, depends on Tasks 1–2)
- Group D: Tasks 8–10 (UI, sequential after Task 7)
- Group E: Task 11 (progress panel, depends on Tasks 2, 4)
- Group F: Task 12 (similarity integration, depends on Tasks 5, 7)
- Final: Task 13 (cleanup)
