import type { MemoryEntry } from '../commands/memory-commands';
import type { MemoryRetriever, MemoryFuser, MemoryFormatter, RankedMemory, RetrievalOptions } from './types';
import type { CommandContext } from '../commands/types';
import { updateAccessStats } from './governance';

export async function retrieveMemories(
  query: string,
  memories: MemoryEntry[],
  retrievers: MemoryRetriever[],
  fuser: MemoryFuser,
  formatter: MemoryFormatter,
  options: RetrievalOptions,
  ctx?: CommandContext,
): Promise<{ formatted: string; retrieved: RankedMemory[] }> {
  const active = retrievers.filter((r) => r.enabled());

  if (active.length === 0 || memories.length === 0) {
    return { formatted: '', retrieved: [] };
  }

  const resultsMap = new Map<string, RankedMemory[]>();
  for (const retriever of active) {
    const results = retriever.retrieve(query, memories);
    resultsMap.set(retriever.name, results);
  }

  let fused: RankedMemory[];
  if (resultsMap.size === 1) {
    fused = [...resultsMap.values()][0];
  } else {
    fused = fuser.fuse(resultsMap);
  }

  const topK = fused.slice(0, options.topK);

  if (ctx) {
    for (const rm of topK) {
      updateAccessStats(ctx, rm.entry.filename).catch(() => {});
    }
  }

  const formatted = formatter.format(topK, options.charBudget);
  return { formatted, retrieved: topK };
}
