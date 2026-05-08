import type { ContentProcessor, IngestionSource } from './types';
import { pdfProcessor } from './processors/pdf-processor';
import { imageProcessor } from './processors/image-processor';

const processors: ContentProcessor[] = [pdfProcessor, imageProcessor];

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
