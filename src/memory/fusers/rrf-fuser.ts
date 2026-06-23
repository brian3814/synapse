import type { MemoryFuser, RankedMemory } from '../types';

const RRF_K = 60;

export function createRRFFuser(): MemoryFuser {
  return {
    fuse(results: Map<string, RankedMemory[]>): RankedMemory[] {
      const scores = new Map<string, { memory: RankedMemory; score: number }>();

      for (const [, rankedList] of results) {
        for (let rank = 0; rank < rankedList.length; rank++) {
          const rm = rankedList[rank];
          const key = rm.entry.filename;
          const existing = scores.get(key);
          const rrfScore = 1 / (RRF_K + rank);

          if (existing) {
            existing.score += rrfScore;
          } else {
            scores.set(key, { memory: rm, score: rrfScore });
          }
        }
      }

      return [...scores.values()]
        .sort((a, b) => b.score - a.score)
        .map(({ memory, score }) => ({ ...memory, score }));
    },
  };
}
