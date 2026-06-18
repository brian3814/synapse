import type { ReadingListItem } from './types';

// ---------------------------------------------------------------------------
// Resource source — discriminated union
// ---------------------------------------------------------------------------

export type ResourceSource =
  | { kind: 'url'; url: string }
  | {
      kind: 'file';
      filePath: string;
      imported: boolean;
      vaultPath?: string;
      keepOriginal?: boolean;
    };

// ---------------------------------------------------------------------------
// Type guards
// ---------------------------------------------------------------------------

export function isUrlSource(source: ResourceSource): source is { kind: 'url'; url: string } {
  return source.kind === 'url';
}

export function isFileSource(
  source: ResourceSource,
): source is { kind: 'file'; filePath: string; imported: boolean; vaultPath?: string; keepOriginal?: boolean } {
  return source.kind === 'file';
}

export const SUPPORTED_FILE_EXTENSIONS = new Set([
  '.md',
  '.txt',
  '.pdf',
  '.html',
  '.json',
  '.csv',
  '.png',
  '.jpg',
  '.jpeg',
  '.webp',
  '.gif',
  '.svg',
]);

const IMAGE_EXTENSIONS = new Set(['.png', '.jpg', '.jpeg', '.gif', '.webp', '.svg']);

export function isImageFile(source: ResourceSource): boolean {
  if (!isFileSource(source)) return false;
  const ext = source.filePath.slice(source.filePath.lastIndexOf('.')).toLowerCase();
  return IMAGE_EXTENSIONS.has(ext);
}

// ---------------------------------------------------------------------------
// Status and stage enums
// ---------------------------------------------------------------------------

export type ResourceStatus = 'pending' | 'processing' | 'ready' | 'complete';

export type ExtractionStage = 'fetch' | 'parse' | 'extract' | 'validate' | 'similarity';

export type ExtractionStrategy = 'direct' | 'chunked' | 'map-reduce';

// ---------------------------------------------------------------------------
// Extraction data structures
// ---------------------------------------------------------------------------

export interface ExtractedNodeData {
  name: string;
  type?: string;
  label?: string;
  properties?: Record<string, unknown>;
  tags?: string[];
  sourceLocation?:
    | { type: 'page'; page: number; section?: string }
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
  pageContent?: string;
  extractedAt: number;
}

// ---------------------------------------------------------------------------
// Similarity matching
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// Extraction progress events — discriminated union
// ---------------------------------------------------------------------------

export type ExtractionProgressEvent =
  | { type: 'stage-start'; resourceId: string; stage: ExtractionStage; statusText?: string }
  | { type: 'stage-complete'; resourceId: string; stage: ExtractionStage; meta?: { bytes?: number; chars?: number; ms?: number }; statusText?: string }
  | { type: 'llm-chunk'; resourceId: string; text: string }
  | { type: 'chunk-progress'; resourceId: string; current: number; total: number; label?: string }
  | { type: 'strategy-selected'; resourceId: string; strategy: ExtractionStrategy; reason: string }
  | { type: 'error'; resourceId: string; stage: ExtractionStage; message: string };

// ---------------------------------------------------------------------------
// Error record
// ---------------------------------------------------------------------------

export interface ResourceError {
  message: string;
  stage?: ExtractionStage;
  failedAt: number;
  attempts: number;
}

// ---------------------------------------------------------------------------
// Core resource interface
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// Migration helper
// ---------------------------------------------------------------------------

/**
 * Converts a legacy ReadingListItem (keyed by URL) to the new ReadingListResource shape.
 *
 * Status mapping:
 *   failed              → pending  (error populated)
 *   fetching / extracting / processing → processing
 *   extracted / ready   → ready    (extraction object populated if data present)
 *   complete            → complete
 *   pending             → pending
 */
export function migrateReadingListItem(
  key: string,
  old: ReadingListItem,
): ReadingListResource {
  // Determine new status
  let status: ResourceStatus;
  let error: ResourceError | undefined;

  switch (old.status) {
    case 'failed':
      status = 'pending';
      error = {
        message: old.error ?? 'Unknown error',
        failedAt: old.addedAt,
        attempts: 1,
      };
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

    case 'pending':
    default:
      status = 'pending';
      break;
  }

  // Build extraction object when data is present
  let extraction: ExtractionResult | undefined;
  if (
    status === 'ready' ||
    status === 'complete' ||
    old.summary !== undefined ||
    old.extractedNodes !== undefined
  ) {
    if (old.summary !== undefined || old.extractedNodes !== undefined || old.extractedEdges !== undefined) {
      extraction = {
        summary: old.summary ?? '',
        keyTopics: old.keyTopics ?? [],
        nodes: (old.extractedNodes ?? []).map(n => ({
          name: n.name,
          type: n.type,
          properties: n.properties,
        })),
        edges: (old.extractedEdges ?? []).map(e => ({
          sourceName: e.sourceName,
          targetName: e.targetName,
          label: e.label,
          type: e.type,
        })),
        pageContent: old.pageContent,
        extractedAt: old.extractedAt ?? old.addedAt,
      };
    }
  }

  const url = old.url ?? key;

  return {
    id: url,
    source: { kind: 'url', url },
    title: old.title || old.pageTitle || url,
    addedAt: old.addedAt,
    status,
    error,
    extraction,
    targetVaultPath: old.targetVaultPath,
    targetVaultName: old.targetVaultName,
  };
}
