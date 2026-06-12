import type { MemoryEntry } from '../../commands/memory-commands';
import type { MemoryRetriever, RankedMemory } from '../types';
import { extractSearchTerms } from '../../utils/text-search';

const WEIGHT_TAG_MATCH = 2.0;
const WEIGHT_CONTENT_MATCH = 1.0;
const BONUS_RECENT = 0.5;
const BONUS_FREQUENT = 0.3;
const BONUS_INSTRUCTION = 0.2;
const RECENCY_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;
const FREQUENCY_THRESHOLD = 5;
const FALLBACK_COUNT = 3;

export function createMetadataRetriever(): MemoryRetriever {
  return {
    name: 'metadata',
    enabled: () => true,

    retrieve(query: string, memories: MemoryEntry[]): RankedMemory[] {
      const terms = extractSearchTerms(query);
      const termSet = new Set(terms.map((t) => t.toLowerCase()));
      const now = Date.now();

      const scored: RankedMemory[] = memories.map((entry) => {
        let score = 0;

        for (const tag of entry.tags) {
          if (termSet.has(tag.toLowerCase())) {
            score += WEIGHT_TAG_MATCH;
          }
        }

        const contentWords = entry.content.toLowerCase().split(/\s+/);
        const descWords = entry.description.toLowerCase().split(/\s+/);
        const allWords = new Set([...contentWords, ...descWords]);
        for (const term of termSet) {
          if (allWords.has(term)) {
            score += WEIGHT_CONTENT_MATCH;
          }
        }

        if (entry.updated_at) {
          const updatedMs = new Date(entry.updated_at).getTime();
          if (now - updatedMs < RECENCY_WINDOW_MS) {
            score += BONUS_RECENT;
          }
        }

        if (entry.access_count > FREQUENCY_THRESHOLD) {
          score += BONUS_FREQUENT;
        }

        if (entry.type === 'instruction') {
          score += BONUS_INSTRUCTION;
        }

        return { entry, score, source: 'metadata' };
      });

      scored.sort((a, b) => b.score - a.score);

      const hasMatches = scored.some((s) => s.score > BONUS_RECENT + BONUS_FREQUENT + BONUS_INSTRUCTION);
      if (!hasMatches) {
        const byAccess = [...memories]
          .sort((a, b) => b.access_count - a.access_count)
          .slice(0, FALLBACK_COUNT);
        return byAccess.map((entry, i) => ({
          entry,
          score: 1 / (1 + i),
          source: 'metadata-fallback',
        }));
      }

      return scored.filter((s) => s.score > 0);
    },
  };
}
