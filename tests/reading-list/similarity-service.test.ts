import { describe, it, expect, vi } from 'vitest';
import {
  levenshteinDistance,
  normalizeForComparison,
  findExactMatch,
  findNormalizedMatch,
  findFuzzyMatch,
  findAcronymMatch,
  findSimilarityMatches,
  type ExistingNodeInfo,
} from '../../src/core/similarity-service';
import type { ExtractedNodeData } from '../../src/shared/reading-list-types';

// ---------------------------------------------------------------------------
// Shared test data
// ---------------------------------------------------------------------------

const existingNodes: ExistingNodeInfo[] = [
  { id: '1', name: 'Transformer', label: 'technology', summary: 'A deep learning architecture' },
  { id: '2', name: 'BERT', label: 'technology', summary: 'Bidirectional encoder' },
  { id: '3', name: 'Large Language Model', label: 'concept', summary: null },
  { id: '4', name: 'ChatGPT', label: 'technology', summary: 'OpenAI chatbot' },
  { id: '5', name: 'Neural Network', label: 'concept', summary: null },
];

// ---------------------------------------------------------------------------
// levenshteinDistance
// ---------------------------------------------------------------------------

describe('levenshteinDistance', () => {
  it('returns 0 for identical strings', () => {
    expect(levenshteinDistance('hello', 'hello')).toBe(0);
  });

  it('returns full length when one string is empty', () => {
    expect(levenshteinDistance('', 'abc')).toBe(3);
    expect(levenshteinDistance('abc', '')).toBe(3);
  });

  it('returns 0 for two empty strings', () => {
    expect(levenshteinDistance('', '')).toBe(0);
  });

  it('returns 1 for a single insertion', () => {
    // "cat" → "cats" (one insertion)
    expect(levenshteinDistance('cat', 'cats')).toBe(1);
  });

  it('returns 1 for a single deletion', () => {
    expect(levenshteinDistance('cats', 'cat')).toBe(1);
  });

  it('returns 1 for a single substitution', () => {
    // "cat" → "bat"
    expect(levenshteinDistance('cat', 'bat')).toBe(1);
  });

  it('computes distance for typical words', () => {
    // "Transformer" vs "Transformers" → 1 insertion
    expect(levenshteinDistance('Transformer', 'Transformers')).toBe(1);
  });

  it('is symmetric', () => {
    expect(levenshteinDistance('BERT', 'BIRT')).toBe(levenshteinDistance('BIRT', 'BERT'));
  });

  it('handles completely different strings', () => {
    expect(levenshteinDistance('abc', 'xyz')).toBe(3);
  });
});

// ---------------------------------------------------------------------------
// normalizeForComparison
// ---------------------------------------------------------------------------

describe('normalizeForComparison', () => {
  it('lowercases the string', () => {
    expect(normalizeForComparison('Transformer')).toBe('transformer');
  });

  it('removes spaces', () => {
    expect(normalizeForComparison('Large Language Model')).toBe('largelanguagemodel');
  });

  it('removes hyphens', () => {
    expect(normalizeForComparison('self-attention')).toBe('selfattention');
  });

  it('removes underscores', () => {
    expect(normalizeForComparison('neural_network')).toBe('neuralnetwork');
  });

  it('handles mixed separators', () => {
    expect(normalizeForComparison('Large-Language_Model')).toBe('largelanguagemodel');
  });

  it('trims leading and trailing whitespace', () => {
    expect(normalizeForComparison('  bert  ')).toBe('bert');
  });

  it('returns empty string for empty input', () => {
    expect(normalizeForComparison('')).toBe('');
  });
});

// ---------------------------------------------------------------------------
// findExactMatch
// ---------------------------------------------------------------------------

describe('findExactMatch', () => {
  it('returns a match for exact case-sensitive string', () => {
    const result = findExactMatch('Transformer', existingNodes);
    expect(result).toBeDefined();
    expect(result!.existingNodeId).toBe('1');
    expect(result!.matchType).toBe('exact');
    expect(result!.score).toBe(1.0);
  });

  it('matches case-insensitively', () => {
    const result = findExactMatch('transformer', existingNodes);
    expect(result).toBeDefined();
    expect(result!.existingNodeId).toBe('1');
    expect(result!.matchType).toBe('exact');
  });

  it('returns undefined when no match found', () => {
    expect(findExactMatch('GPT-4', existingNodes)).toBeUndefined();
  });

  it('populates extractedNodeName from the input name', () => {
    const result = findExactMatch('BERT', existingNodes);
    expect(result!.extractedNodeName).toBe('BERT');
    expect(result!.existingNodeName).toBe('BERT');
  });

  it('propagates label and summary from the matched node', () => {
    const result = findExactMatch('Transformer', existingNodes);
    expect(result!.existingLabel).toBe('technology');
    expect(result!.existingSummary).toBe('A deep learning architecture');
  });

  it('handles null summary as undefined', () => {
    const result = findExactMatch('Large Language Model', existingNodes);
    expect(result!.existingSummary).toBeUndefined();
  });

  it('returns undefined against an empty node list', () => {
    expect(findExactMatch('Transformer', [])).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// findNormalizedMatch
// ---------------------------------------------------------------------------

describe('findNormalizedMatch', () => {
  it('matches when only spacing differs', () => {
    // "LargeLanguageModel" normalizes to same as "Large Language Model"
    const result = findNormalizedMatch('LargeLanguageModel', existingNodes);
    expect(result).toBeDefined();
    expect(result!.existingNodeId).toBe('3');
    expect(result!.matchType).toBe('normalized');
    expect(result!.score).toBe(0.95);
  });

  it('matches when hyphen vs space', () => {
    const nodes: ExistingNodeInfo[] = [{ id: 'a', name: 'self-attention' }];
    const result = findNormalizedMatch('self attention', nodes);
    expect(result).toBeDefined();
    expect(result!.matchType).toBe('normalized');
  });

  it('skips nodes that would match by exact', () => {
    // "Transformer" matches exactly, so normalized should NOT return it
    const result = findNormalizedMatch('Transformer', existingNodes);
    // Exact match would catch this; normalized skips it
    expect(result).toBeUndefined();
  });

  it('returns undefined when no normalized match found', () => {
    expect(findNormalizedMatch('Quantum Computing', existingNodes)).toBeUndefined();
  });

  it('is case-insensitive on both sides', () => {
    const nodes: ExistingNodeInfo[] = [{ id: 'x', name: 'Neural-Network' }];
    const result = findNormalizedMatch('neural network', nodes);
    expect(result).toBeDefined();
  });
});

// ---------------------------------------------------------------------------
// findFuzzyMatch
// ---------------------------------------------------------------------------

describe('findFuzzyMatch', () => {
  it('matches near-identical long names (one extra char)', () => {
    // "Transformers" vs "Transformer" — ratio = 11/12 ≈ 0.917 > 0.85
    const result = findFuzzyMatch('Transformers', existingNodes);
    expect(result).toBeDefined();
    expect(result!.existingNodeId).toBe('1');
    expect(result!.matchType).toBe('fuzzy');
  });

  it('accepts short names (≤5) with edit distance ≤ 1', () => {
    // "BIRT" vs "BERT" — dist = 1, name length = 4 ≤ 5
    const result = findFuzzyMatch('BIRT', existingNodes);
    expect(result).toBeDefined();
    expect(result!.existingNodeId).toBe('2');
  });

  it('rejects short names with edit distance > 1', () => {
    // "BRX" vs "BERT" — dist = 2, length = 3 ≤ 5 → rejected
    const result = findFuzzyMatch('BRX', existingNodes);
    expect(result).toBeUndefined();
  });

  it('returns the best match when multiple candidates qualify', () => {
    const nodes: ExistingNodeInfo[] = [
      { id: 'a', name: 'Transformers' },   // ratio ≈ 11/12
      { id: 'b', name: 'Transformer_v2' }, // ratio = 11/14
    ];
    const result = findFuzzyMatch('Transformer', nodes);
    expect(result!.existingNodeId).toBe('a');
  });

  it('returns undefined when ratio ≤ 0.85 for long names', () => {
    // "ChatGPT" vs "Neural Network" — very different
    const result = findFuzzyMatch('Quantum Entanglement', existingNodes);
    expect(result).toBeUndefined();
  });

  it('score reflects the Levenshtein ratio', () => {
    const result = findFuzzyMatch('Transformers', existingNodes);
    // dist=1, maxLen=12 → ratio = 1 - 1/12 ≈ 0.9167
    expect(result!.score).toBeCloseTo(1 - 1 / 12, 4);
  });
});

// ---------------------------------------------------------------------------
// findAcronymMatch
// ---------------------------------------------------------------------------

describe('findAcronymMatch', () => {
  it('matches an acronym against an expanded node name', () => {
    // "LLM" → "Large Language Model"
    const result = findAcronymMatch('LLM', existingNodes);
    expect(result).toBeDefined();
    expect(result!.existingNodeId).toBe('3');
    expect(result!.matchType).toBe('acronym');
    expect(result!.score).toBe(0.95);
  });

  it('matches an expanded name against an acronym node', () => {
    // "Bidirectional Encoder Representations from Transformers" → "BERT"
    const nodes: ExistingNodeInfo[] = [{ id: 'x', name: 'BERT' }];
    const result = findAcronymMatch('Bidirectional Encoder Representations Transformers', nodes);
    expect(result).toBeDefined();
    expect(result!.existingNodeId).toBe('x');
  });

  it('returns undefined when acronym does not match any node', () => {
    expect(findAcronymMatch('GPT', existingNodes)).toBeUndefined();
  });

  it('returns undefined when a multi-word phrase acronym matches nothing', () => {
    // "Natural Language Processing" → "NLP", not in existingNodes
    expect(findAcronymMatch('Natural Language Processing', existingNodes)).toBeUndefined();
  });

  it('does not match lowercase input as an acronym (acronyms must be uppercase)', () => {
    // "llm" is lowercase so looksLikeAcronym returns false — no match expected
    const result = findAcronymMatch('llm', existingNodes);
    expect(result).toBeUndefined();
  });

  it('does not treat long strings as acronyms (> 6 chars)', () => {
    // "CHATGPT" is 7 chars — should not be treated as acronym
    const result = findAcronymMatch('CHATGPT', existingNodes);
    expect(result).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// findSimilarityMatches
// ---------------------------------------------------------------------------

describe('findSimilarityMatches', () => {
  it('returns exact matches for names present in the node list', async () => {
    const extracted: ExtractedNodeData[] = [{ name: 'Transformer' }, { name: 'ChatGPT' }];
    const results = await findSimilarityMatches(extracted, existingNodes);

    expect(results).toHaveLength(2);
    const txMatch = results.find(r => r.extractedNodeName === 'Transformer');
    expect(txMatch!.matchType).toBe('exact');
    expect(txMatch!.existingNodeId).toBe('1');
  });

  it('returns empty array when no matches found and no embedding search provided', async () => {
    const extracted: ExtractedNodeData[] = [{ name: 'Quantum Computing' }];
    const results = await findSimilarityMatches(extracted, existingNodes);
    expect(results).toHaveLength(0);
  });

  it('uses embedding search for unmatched nodes', async () => {
    const embeddingSearch = vi.fn().mockResolvedValue([{ nodeId: '5', score: 0.85 }]);
    const extracted: ExtractedNodeData[] = [{ name: 'Artificial Neural Net' }];

    const results = await findSimilarityMatches(extracted, existingNodes, embeddingSearch);

    expect(embeddingSearch).toHaveBeenCalledOnce();
    expect(results).toHaveLength(1);
    expect(results[0].matchType).toBe('embedding');
    expect(results[0].existingNodeId).toBe('5');
    expect(results[0].score).toBe(0.85);
  });

  it('skips embedding hits with score ≤ 0.7', async () => {
    const embeddingSearch = vi.fn().mockResolvedValue([{ nodeId: '5', score: 0.65 }]);
    const extracted: ExtractedNodeData[] = [{ name: 'Artificial Neural Net' }];

    const results = await findSimilarityMatches(extracted, existingNodes, embeddingSearch);
    expect(results).toHaveLength(0);
  });

  it('does not call embedding search for nodes that already have a tier match', async () => {
    const embeddingSearch = vi.fn();
    const extracted: ExtractedNodeData[] = [{ name: 'Transformer' }];

    await findSimilarityMatches(extracted, existingNodes, embeddingSearch);
    expect(embeddingSearch).not.toHaveBeenCalled();
  });

  it('prefers exact over normalized over acronym over fuzzy', async () => {
    // "Transformer" has an exact match — should not return a fuzzy match for a different node
    const extracted: ExtractedNodeData[] = [{ name: 'Transformer' }];
    const results = await findSimilarityMatches(extracted, existingNodes);
    expect(results[0].matchType).toBe('exact');
  });

  it('handles empty extracted node list', async () => {
    const results = await findSimilarityMatches([], existingNodes);
    expect(results).toHaveLength(0);
  });

  it('handles empty existing node list', async () => {
    const extracted: ExtractedNodeData[] = [{ name: 'Transformer' }];
    const results = await findSimilarityMatches(extracted, []);
    expect(results).toHaveLength(0);
  });

  it('returns acronym match for LLM → Large Language Model', async () => {
    const extracted: ExtractedNodeData[] = [{ name: 'LLM' }];
    const results = await findSimilarityMatches(extracted, existingNodes);
    expect(results).toHaveLength(1);
    expect(results[0].matchType).toBe('acronym');
    expect(results[0].existingNodeId).toBe('3');
  });

  it('returns normalized match for hyphenated variant', async () => {
    const nodes: ExistingNodeInfo[] = [{ id: '10', name: 'self-attention', label: 'concept' }];
    const extracted: ExtractedNodeData[] = [{ name: 'self attention' }];
    const results = await findSimilarityMatches(extracted, nodes);
    expect(results[0].matchType).toBe('normalized');
  });

  it('includes label and summary from the matched node', async () => {
    const extracted: ExtractedNodeData[] = [{ name: 'Transformer' }];
    const results = await findSimilarityMatches(extracted, existingNodes);
    expect(results[0].existingLabel).toBe('technology');
    expect(results[0].existingSummary).toBe('A deep learning architecture');
  });

  it('returns top-5 embedding hits but picks best with score > 0.7', async () => {
    // Return 3 hits, only 2 above threshold; since we take best-per-node, only 1 result
    const embeddingSearch = vi.fn().mockResolvedValue([
      { nodeId: '5', score: 0.9 },
      { nodeId: '4', score: 0.8 },
      { nodeId: '1', score: 0.6 },
    ]);
    const extracted: ExtractedNodeData[] = [{ name: 'Deep Neural Net' }];
    const results = await findSimilarityMatches(extracted, existingNodes, embeddingSearch);
    // Only first qualifying hit per node is used (break after first match)
    expect(results).toHaveLength(1);
    expect(results[0].existingNodeId).toBe('5');
    expect(results[0].score).toBe(0.9);
  });
});
