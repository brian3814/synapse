import type { MemoryEntry } from '../commands/memory-commands';

export interface RankedMemory {
  entry: MemoryEntry;
  score: number;
  source: string;
}

export interface MemoryRetriever {
  name: string;
  enabled: () => boolean;
  retrieve: (query: string, memories: MemoryEntry[]) => RankedMemory[];
}

export interface MemoryFuser {
  fuse: (results: Map<string, RankedMemory[]>) => RankedMemory[];
}

export interface MemoryFormatter {
  format: (memories: RankedMemory[], budget: number) => string;
}

export interface RetrievalOptions {
  topK: number;
  charBudget: number;
}
