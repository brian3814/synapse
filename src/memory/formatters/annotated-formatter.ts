import type { MemoryFormatter, RankedMemory } from '../types';

function confidenceStars(score: number, maxScore: number): string {
  if (maxScore <= 0) return '★☆☆';
  const ratio = score / maxScore;
  if (ratio > 0.66) return '★★★';
  if (ratio > 0.33) return '★★☆';
  return '★☆☆';
}

export function createAnnotatedFormatter(): MemoryFormatter {
  return {
    format(memories: RankedMemory[], budget: number): string {
      if (memories.length === 0) return '';

      const maxScore = memories[0].score;
      const lines: string[] = [];
      let totalChars = 0;

      for (const rm of memories) {
        const stars = confidenceStars(rm.score, maxScore);
        const line = `- [${rm.entry.type}, ${stars}] ${rm.entry.content.replace(/\n/g, ' ').trim()}`;

        if (totalChars + line.length > budget) break;
        lines.push(line);
        totalChars += line.length;
      }

      return lines.join('\n');
    },
  };
}
