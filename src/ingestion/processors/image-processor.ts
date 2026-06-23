import type { ContentProcessor, IngestionSource, ProcessedContent, ProcessingMode } from '../types';

const MAX_DIMENSION = 2048;

const SUPPORTED_MIME_TYPES = [
  'image/png',
  'image/jpeg',
  'image/webp',
  'image/gif',
  'image/svg+xml',
];

const SUPPORTED_EXTENSIONS = ['.png', '.jpg', '.jpeg', '.webp', '.gif', '.svg'];

export const imageProcessor: ContentProcessor = {
  id: 'image',
  supportedMimeTypes: SUPPORTED_MIME_TYPES,
  supportedExtensions: SUPPORTED_EXTENSIONS,

  canProcess(source: IngestionSource): boolean {
    if (SUPPORTED_MIME_TYPES.includes(source.mimeType)) return true;
    const ext = source.name.toLowerCase().match(/\.[^.]+$/)?.[0] ?? '';
    return SUPPORTED_EXTENSIONS.includes(ext);
  },

  shouldPromptMode(_source: IngestionSource) {
    return { prompt: false };
  },

  async preprocess(
    source: IngestionSource,
    _mode: ProcessingMode,
    onProgress?: (pct: number, msg: string) => void,
  ): Promise<ProcessedContent> {
    onProgress?.(10, 'Loading image…');

    const isSvg =
      source.mimeType === 'image/svg+xml' ||
      source.name.toLowerCase().endsWith('.svg');

    // Get raw bytes as Uint8Array
    const bytes =
      source.data instanceof ArrayBuffer
        ? new Uint8Array(source.data)
        : new TextEncoder().encode(source.data as string);

    onProgress?.(30, 'Processing image…');

    // Create an HTMLImageElement from the raw data
    const blob = new Blob([bytes], { type: isSvg ? 'image/svg+xml' : source.mimeType });
    const objectUrl = URL.createObjectURL(blob);

    let dataUri: string;
    let width: number;
    let height: number;

    try {
      const img = await loadImage(objectUrl);
      width = img.naturalWidth;
      height = img.naturalHeight;

      onProgress?.(60, 'Encoding image…');

      // Resize if either dimension exceeds MAX_DIMENSION, or if SVG (convert to PNG)
      const needsResize =
        isSvg || width > MAX_DIMENSION || height > MAX_DIMENSION;

      if (needsResize) {
        const scale = needsResize && !isSvg
          ? Math.min(MAX_DIMENSION / width, MAX_DIMENSION / height)
          : Math.min(1, MAX_DIMENSION / width, MAX_DIMENSION / height);

        const targetW = Math.round(width * scale);
        const targetH = Math.round(height * scale);

        const canvas = document.createElement('canvas');
        canvas.width = targetW;
        canvas.height = targetH;
        const ctx = canvas.getContext('2d');
        if (!ctx) throw new Error('Canvas 2D context unavailable');
        ctx.drawImage(img, 0, 0, targetW, targetH);
        dataUri = canvas.toDataURL('image/png');
        width = targetW;
        height = targetH;
      } else {
        // Encode directly to base64 via canvas (avoids blob URL issues cross-context)
        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext('2d');
        if (!ctx) throw new Error('Canvas 2D context unavailable');
        ctx.drawImage(img, 0, 0);
        dataUri = canvas.toDataURL(source.mimeType === 'image/jpeg' ? 'image/jpeg' : 'image/png');
      }
    } finally {
      URL.revokeObjectURL(objectUrl);
    }

    onProgress?.(100, 'Done');

    return {
      // Store the base64 data URI in the text field so the LLM pipeline can consume it
      text: dataUri,
      metadata: {
        title: source.name,
        dimensions: { w: width, h: height },
      },
    };
  },

  getExtractionContext(): string {
    return (
      'Extract entities and relationships from this image. ' +
      'Describe spatial regions when referencing where entities appear, ' +
      'using sourceLocation with type "region".'
    );
  },
};

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = (e) => reject(new Error(`Failed to load image: ${String(e)}`));
    img.src = src;
  });
}
