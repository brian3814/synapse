import { getDocument, GlobalWorkerOptions } from 'pdfjs-dist';
import type { ContentProcessor, IngestionSource, ProcessedContent, ProcessingMode } from '../types';

// Disable web worker (not available in extension/electron contexts)
GlobalWorkerOptions.workerSrc = '';

const PAGES_PER_CHUNK = 10;
const LARGE_DOC_THRESHOLD = 50;
const APPROX_BYTES_PER_PAGE = 5 * 1024; // ~5KB per page estimate

export const pdfProcessor: ContentProcessor = {
  id: 'pdf',
  supportedMimeTypes: ['application/pdf'],
  supportedExtensions: ['.pdf'],

  canProcess(source: IngestionSource): boolean {
    return (
      source.mimeType === 'application/pdf' ||
      source.name.toLowerCase().endsWith('.pdf')
    );
  },

  shouldPromptMode(source: IngestionSource) {
    const estimatedPages = Math.ceil(source.size / APPROX_BYTES_PER_PAGE);
    if (estimatedPages > LARGE_DOC_THRESHOLD) {
      return {
        prompt: true,
        reason: `This PDF appears to have ~${estimatedPages} pages. Choose processing mode.`,
        estimatedCost: `Full: ~${estimatedPages} pages; Quick: first ${PAGES_PER_CHUNK} pages only`,
      };
    }
    return { prompt: false };
  },

  async preprocess(
    source: IngestionSource,
    mode: ProcessingMode,
    onProgress?: (pct: number, msg: string) => void,
  ): Promise<ProcessedContent> {
    // Convert data to Uint8Array
    const data =
      source.data instanceof ArrayBuffer
        ? new Uint8Array(source.data)
        : new TextEncoder().encode(source.data as string);

    onProgress?.(5, 'Loading PDF…');

    const loadingTask = getDocument({ data });
    const pdf = await loadingTask.promise;
    const totalPages = pdf.numPages;

    // Extract metadata
    let title: string | undefined;
    let author: string | undefined;
    try {
      const meta = await pdf.getMetadata();
      const info = meta.info as Record<string, unknown> | undefined;
      if (info) {
        if (typeof info['Title'] === 'string' && info['Title']) title = info['Title'];
        if (typeof info['Author'] === 'string' && info['Author']) author = info['Author'];
      }
    } catch {
      // metadata is optional — ignore errors
    }

    // Determine page range based on mode
    const pagesToProcess =
      mode === 'quick'
        ? Math.min(PAGES_PER_CHUNK, totalPages)
        : totalPages;

    // Extract text per page
    const pageTexts: string[] = [];
    for (let i = 1; i <= pagesToProcess; i++) {
      const page = await pdf.getPage(i);
      const textContent = await page.getTextContent();
      const pageText = textContent.items
        .map((item) => {
          // pdfjs TextItem has a `str` field; TextMarkedContent does not
          return 'str' in item ? item.str : '';
        })
        .join(' ')
        .trim();
      pageTexts.push(pageText);

      const pct = 5 + Math.round((i / pagesToProcess) * 85);
      onProgress?.(pct, `Processing page ${i} of ${pagesToProcess}…`);
    }

    // Build chunks grouped by PAGES_PER_CHUNK
    const chunks = [];
    for (let chunkStart = 0; chunkStart < pageTexts.length; chunkStart += PAGES_PER_CHUNK) {
      const slice = pageTexts.slice(chunkStart, chunkStart + PAGES_PER_CHUNK);
      const startPage = chunkStart + 1;
      const endPage = chunkStart + slice.length;

      // Label each page within the chunk
      const chunkText = slice
        .map((text, idx) => `[Page ${startPage + idx}]\n${text}`)
        .join('\n\n');

      chunks.push({
        text: chunkText,
        location: { type: 'page' as const, page: startPage, section: `Pages ${startPage}–${endPage}` },
        index: chunks.length,
      });
    }

    // Full text is all page texts with page markers
    const text = pageTexts
      .map((t, idx) => `[Page ${idx + 1}]\n${t}`)
      .join('\n\n');

    onProgress?.(100, 'Done');

    return {
      text,
      chunks,
      metadata: {
        title: title ?? source.name,
        author,
        pageCount: totalPages,
      },
    };
  },

  getExtractionContext(): string {
    return (
      'Content extracted from a PDF document. Page numbers are provided in [Page N] markers. ' +
      'Use these for source location references in sourceLocation fields with type "page".'
    );
  },
};
