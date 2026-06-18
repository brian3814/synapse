import type { ExtractionStrategy } from '../shared/reading-list-types';

// ---------------------------------------------------------------------------
// Thresholds
// ---------------------------------------------------------------------------

const DEFAULT_DIRECT_THRESHOLD = 30_000;  // 30KB
const DEFAULT_CHUNKED_THRESHOLD = 200_000; // 200KB

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface StrategyOptions {
  isImage?: boolean;
  directThreshold?: number;
  chunkedThreshold?: number;
}

interface StrategySelection {
  strategy: ExtractionStrategy;
  reason: string;
}

// ---------------------------------------------------------------------------
// selectStrategy
// ---------------------------------------------------------------------------

export function selectStrategy(textContent: string, opts?: StrategyOptions): StrategySelection {
  if (opts?.isImage) {
    return { strategy: 'direct', reason: 'image file → direct (vision input)' };
  }

  const directThreshold = opts?.directThreshold ?? DEFAULT_DIRECT_THRESHOLD;
  const chunkedThreshold = opts?.chunkedThreshold ?? DEFAULT_CHUNKED_THRESHOLD;

  const size = textContent.length;
  const sizeKB = Math.round(size / 1000);

  if (size <= directThreshold) {
    return { strategy: 'direct', reason: `${sizeKB}KB text → direct` };
  }

  if (size <= chunkedThreshold) {
    return { strategy: 'chunked', reason: `${sizeKB}KB text → chunked` };
  }

  return { strategy: 'map-reduce', reason: `${sizeKB}KB text → map-reduce` };
}

// ---------------------------------------------------------------------------
// chunkText
// ---------------------------------------------------------------------------

export function chunkText(text: string, maxChunkSize = 8_000): string[] {
  // Split by heading markers (newline followed by # / ## / ###) or form feeds
  const sections = text.split(/(?=\n#{1,3}\s)|\f/);

  // Accumulate sections into chunks up to maxChunkSize
  const chunks: string[] = [];
  let current = '';

  for (const section of sections) {
    if (current.length + section.length > maxChunkSize && current.length > 0) {
      chunks.push(current);
      current = section;
    } else {
      current += section;
    }
  }

  if (current.length > 0) {
    chunks.push(current);
  }

  // Split any oversized chunks by double newlines (paragraphs)
  const result: string[] = [];

  for (const chunk of chunks) {
    if (chunk.length > maxChunkSize) {
      const paragraphs = chunk.split(/\n\n+/);
      let sub = '';
      for (const para of paragraphs) {
        if (sub.length + para.length > maxChunkSize && sub.length > 0) {
          result.push(sub.trim());
          sub = para;
        } else {
          sub = sub.length > 0 ? sub + '\n\n' + para : para;
        }
      }
      if (sub.trim().length > 0) {
        result.push(sub.trim());
      }
    } else {
      result.push(chunk.trim());
    }
  }

  return result.filter(c => c.length > 0);
}
