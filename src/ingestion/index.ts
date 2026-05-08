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

export type { IngestionCallbacks } from './ingestion-pipeline';
