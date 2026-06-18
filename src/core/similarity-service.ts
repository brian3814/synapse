import type { SimilarityMatch, SimilarityMatchType, ExtractedNodeData } from '../shared/reading-list-types';

export interface ExistingNodeInfo {
  id: string;
  name: string;
  label?: string | null;
  summary?: string | null;
}

// ---------------------------------------------------------------------------
// Helper
// ---------------------------------------------------------------------------

function toMatch(
  extractedName: string,
  node: ExistingNodeInfo,
  matchType: SimilarityMatchType,
  score: number,
): SimilarityMatch {
  return {
    extractedNodeName: extractedName,
    existingNodeId: node.id,
    existingNodeName: node.name,
    matchType,
    score,
    existingLabel: node.label ?? undefined,
    existingSummary: node.summary ?? undefined,
  };
}

// ---------------------------------------------------------------------------
// 1. Levenshtein distance
// ---------------------------------------------------------------------------

export function levenshteinDistance(a: string, b: string): number {
  const m = a.length;
  const n = b.length;
  // dp[i][j] = edit distance between a[0..i-1] and b[0..j-1]
  const dp: number[][] = Array.from({ length: m + 1 }, (_, i) =>
    Array.from({ length: n + 1 }, (_, j) => (i === 0 ? j : j === 0 ? i : 0)),
  );
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      if (a[i - 1] === b[j - 1]) {
        dp[i][j] = dp[i - 1][j - 1];
      } else {
        dp[i][j] = 1 + Math.min(dp[i - 1][j], dp[i][j - 1], dp[i - 1][j - 1]);
      }
    }
  }
  return dp[m][n];
}

// ---------------------------------------------------------------------------
// 2. Normalize for comparison
// ---------------------------------------------------------------------------

export function normalizeForComparison(s: string): string {
  return s.toLowerCase().replace(/[-\s_]/g, '').trim();
}

// ---------------------------------------------------------------------------
// 3. Exact match (case-insensitive)
// ---------------------------------------------------------------------------

export function findExactMatch(
  name: string,
  nodes: ExistingNodeInfo[],
): SimilarityMatch | undefined {
  const lower = name.toLowerCase();
  for (const node of nodes) {
    if (node.name.toLowerCase() === lower) {
      return toMatch(name, node, 'exact', 1.0);
    }
  }
  return undefined;
}

// ---------------------------------------------------------------------------
// 4. Normalized match
// ---------------------------------------------------------------------------

export function findNormalizedMatch(
  name: string,
  nodes: ExistingNodeInfo[],
): SimilarityMatch | undefined {
  const normName = normalizeForComparison(name);
  const lowerName = name.toLowerCase();
  for (const node of nodes) {
    // Skip if it would already be caught by exact match
    if (node.name.toLowerCase() === lowerName) continue;
    if (normalizeForComparison(node.name) === normName) {
      return toMatch(name, node, 'normalized', 0.95);
    }
  }
  return undefined;
}

// ---------------------------------------------------------------------------
// 5. Fuzzy match (Levenshtein ratio)
// ---------------------------------------------------------------------------

export function findFuzzyMatch(
  name: string,
  nodes: ExistingNodeInfo[],
): SimilarityMatch | undefined {
  let bestMatch: SimilarityMatch | undefined;
  let bestScore = -Infinity;

  for (const node of nodes) {
    const dist = levenshteinDistance(name, node.name);
    const maxLen = Math.max(name.length, node.name.length);
    const ratio = maxLen === 0 ? 1 : 1 - dist / maxLen;

    let accepted = false;
    if (name.length <= 5) {
      accepted = dist <= 1;
    } else {
      accepted = ratio > 0.85;
    }

    if (accepted && ratio > bestScore) {
      bestScore = ratio;
      bestMatch = toMatch(name, node, 'fuzzy', ratio);
    }
  }

  return bestMatch;
}

// ---------------------------------------------------------------------------
// 6. Acronym match
// ---------------------------------------------------------------------------

/** Build an acronym from the first letter of each word in a phrase. */
function buildAcronym(phrase: string): string {
  return phrase
    .split(/\s+/)
    .filter(Boolean)
    .map(w => w[0].toUpperCase())
    .join('');
}

function looksLikeAcronym(s: string): boolean {
  return s.length <= 6 && /^[A-Z]+$/.test(s) && !s.includes(' ');
}

export function findAcronymMatch(
  name: string,
  nodes: ExistingNodeInfo[],
): SimilarityMatch | undefined {
  // Case 1: name is a potential acronym, check if any node name expands to it
  if (looksLikeAcronym(name)) {
    for (const node of nodes) {
      if (buildAcronym(node.name) === name.toUpperCase()) {
        return toMatch(name, node, 'acronym', 0.95);
      }
    }
  }

  // Case 2: name is a multi-word phrase, check if any node name is its acronym
  const nameAcronym = buildAcronym(name);
  if (nameAcronym.length >= 2) {
    for (const node of nodes) {
      if (looksLikeAcronym(node.name) && node.name.toUpperCase() === nameAcronym) {
        return toMatch(name, node, 'acronym', 0.95);
      }
    }
  }

  return undefined;
}

// ---------------------------------------------------------------------------
// 7. Main entry point
// ---------------------------------------------------------------------------

export async function findSimilarityMatches(
  extractedNodes: ExtractedNodeData[],
  existingNodes: ExistingNodeInfo[],
  embeddingSearch?: (
    text: string,
    topK: number,
  ) => Promise<Array<{ nodeId: string; score: number }>>,
): Promise<SimilarityMatch[]> {
  const results: SimilarityMatch[] = [];
  const matchedExistingIds = new Set<string>();

  const unmatched: ExtractedNodeData[] = [];

  for (const extracted of extractedNodes) {
    const match =
      findExactMatch(extracted.name, existingNodes) ??
      findNormalizedMatch(extracted.name, existingNodes) ??
      findAcronymMatch(extracted.name, existingNodes) ??
      findFuzzyMatch(extracted.name, existingNodes);

    if (match) {
      results.push(match);
      matchedExistingIds.add(match.existingNodeId);
    } else {
      unmatched.push(extracted);
    }
  }

  // Embedding KNN for unmatched nodes
  if (embeddingSearch && unmatched.length > 0) {
    for (const extracted of unmatched) {
      const props = extracted.properties
        ? Object.values(extracted.properties).join('. ')
        : '';
      const queryText = [extracted.name, extracted.label, props].filter(Boolean).join('. ');

      const hits = await embeddingSearch(queryText, 5);
      for (const hit of hits) {
        if (hit.score > 0.7 && !matchedExistingIds.has(hit.nodeId)) {
          const node = existingNodes.find(n => n.id === hit.nodeId);
          if (node) {
            const match = toMatch(extracted.name, node, 'embedding', hit.score);
            results.push(match);
            matchedExistingIds.add(hit.nodeId);
            break; // take best hit only
          }
        }
      }
    }
  }

  return results;
}
