import type { CommandContext } from './types';
import { parseMarkdown } from '../notes/markdown-utils';
import type { DbNode, DbEdge, DbSourceContent } from '../shared/types';
import { embedding } from '@platform';

export interface RAGContext {
  relevantNodes: DbNode[];
  relevantEdges: DbEdge[];
  sourceExcerpts: Array<{
    nodeId: string;
    nodeLabel: string;
    url: string;
    title: string | null;
    excerpt: string;
  }>;
  query: string;
}

function reciprocalRankFusion(
  ftsIds: string[],
  vecResults: Array<{ nodeId: string; score: number }>,
  k = 60,
): string[] {
  const scores = new Map<string, number>();
  ftsIds.forEach((id, rank) => {
    scores.set(id, (scores.get(id) ?? 0) + 1 / (k + rank));
  });
  vecResults.forEach(({ nodeId }, rank) => {
    scores.set(nodeId, (scores.get(nodeId) ?? 0) + 1 / (k + rank));
  });
  return [...scores.entries()].sort((a, b) => b[1] - a[1]).map(([id]) => id);
}

function extractSearchTerms(question: string): string[] {
  const stopWords = new Set([
    'what', 'who', 'where', 'when', 'why', 'how', 'is', 'are', 'was', 'were',
    'do', 'does', 'did', 'have', 'has', 'had', 'can', 'could', 'would', 'should',
    'will', 'shall', 'may', 'might', 'the', 'a', 'an', 'and', 'or', 'but', 'in',
    'on', 'at', 'to', 'for', 'of', 'with', 'by', 'from', 'about', 'between',
    'through', 'during', 'before', 'after', 'above', 'below', 'up', 'down',
    'i', 'me', 'my', 'we', 'our', 'you', 'your', 'they', 'them', 'their',
    'it', 'its', 'this', 'that', 'these', 'those', 'know', 'tell', 'give',
    'find', 'show', 'get', 'all', 'any', 'some', 'every', 'each', 'much',
    'many', 'more', 'most', 'other', 'another', 'such', 'no', 'not', 'only',
    'very', 'just', 'also', 'than', 'too', 'so', 'if', 'then', 'because',
    'while', 'although', 'though', 'even', 'still', 'already', 'yet',
  ]);

  const quotedPhrases: string[] = [];
  const withoutQuotes = question.replace(/"([^"]+)"/g, (_, phrase) => {
    quotedPhrases.push(phrase.trim());
    return '';
  });

  const words = withoutQuotes
    .toLowerCase()
    .replace(/[^\w\s-]/g, ' ')
    .split(/\s+/)
    .filter((w) => w.length > 2 && !stopWords.has(w));

  return [...quotedPhrases, ...words];
}

async function findRelevantNodes(ctx: CommandContext, terms: string[], limit = 30): Promise<DbNode[]> {
  const nodeSet = new Map<string, DbNode>();

  const allResults = await Promise.all(terms.map((term) => ctx.db.nodes.search(term, limit)));
  for (const results of allResults) {
    for (const node of results as DbNode[]) {
      nodeSet.set(node.id, node);
    }
  }

  return Array.from(nodeSet.values());
}

async function expandSubgraph(
  ctx: CommandContext,
  nodeIds: string[],
  hops = 1,
): Promise<{ expandedNodeIds: string[]; subgraphEdges: DbEdge[] }> {
  const allNodeIds = new Set(nodeIds);
  const allEdges: DbEdge[] = [];

  const firstHopResults = await Promise.all(nodeIds.map((id) => ctx.db.edges.getForNode(id)));
  for (const nodeEdges of firstHopResults) {
    for (const edge of nodeEdges as DbEdge[]) {
      allEdges.push(edge);
      allNodeIds.add(edge.source_id);
      allNodeIds.add(edge.target_id);
    }
  }

  if (hops >= 2) {
    const secondHopIds = Array.from(allNodeIds).filter((id) => !nodeIds.includes(id));
    const secondHopResults = await Promise.all(
      secondHopIds.slice(0, 20).map((id) => ctx.db.edges.getForNode(id)),
    );
    for (const nodeEdges of secondHopResults) {
      for (const edge of nodeEdges as DbEdge[]) {
        if (!allEdges.some((e) => e.id === edge.id)) {
          allEdges.push(edge);
        }
        allNodeIds.add(edge.source_id);
        allNodeIds.add(edge.target_id);
      }
    }
  }

  return {
    expandedNodeIds: Array.from(allNodeIds),
    subgraphEdges: allEdges,
  };
}

async function getSourceExcerpts(
  ctx: CommandContext,
  nodeIds: string[],
  nodeMap: Map<string, DbNode>,
  maxExcerptLength = 1000,
): Promise<RAGContext['sourceExcerpts']> {
  const results = await Promise.all(
    nodeIds.slice(0, 15).map(async (nodeId) => {
      try {
        const node = nodeMap.get(nodeId);
        if (node?.type === 'note') {
          const md = await ctx.notes.read(nodeId);
          if (md) {
            const parsed = parseMarkdown(md);
            return {
              nodeId,
              nodeLabel: node.name,
              url: `note://${nodeId}`,
              title: node.name,
              excerpt: parsed.content.slice(0, maxExcerptLength),
            };
          }
          return null;
        }
        const sc: DbSourceContent | null = await ctx.db.sourceContent.getByNodeId(nodeId) as any;
        if (sc?.content) {
          return {
            nodeId,
            nodeLabel: node?.name ?? 'Unknown',
            url: sc.url,
            title: sc.title,
            excerpt: sc.content.slice(0, maxExcerptLength),
          };
        }
      } catch {
        // Source content not available
      }
      return null;
    }),
  );

  return results.filter((r): r is NonNullable<typeof r> => r !== null);
}

export async function retrieveRAGContext(ctx: CommandContext, question: string): Promise<RAGContext> {
  const terms = extractSearchTerms(question);

  const matchedNodes = await findRelevantNodes(ctx, terms);
  const ftsNodeIds = matchedNodes.map((n) => n.id);

  let fusedNodeIds = ftsNodeIds;
  try {
    const vecResults = await embedding.searchSimilar(question, 10);
    if (vecResults.length > 0) {
      fusedNodeIds = reciprocalRankFusion(ftsNodeIds, vecResults);
    }
  } catch {
    // Embeddings not available — use FTS results only
  }

  const matchedNodeIds = fusedNodeIds;
  const { expandedNodeIds, subgraphEdges } = await expandSubgraph(ctx, fusedNodeIds.slice(0, 20), 1);

  const allNodes = await ctx.db.nodes.getAll() as DbNode[];
  const nodeMap = new Map(allNodes.map((n) => [n.id, n]));
  const relevantNodes = expandedNodeIds
    .map((id) => nodeMap.get(id))
    .filter((n): n is DbNode => n !== undefined);

  const sourceExcerpts = await getSourceExcerpts(ctx, matchedNodeIds, nodeMap);

  return {
    relevantNodes,
    relevantEdges: subgraphEdges,
    sourceExcerpts,
    query: question,
  };
}

export function formatRAGPrompt(context: RAGContext): string {
  const parts: string[] = [];

  parts.push(`User question: "${context.query}"`);
  parts.push('');

  if (context.relevantNodes.length > 0) {
    parts.push('## Relevant entities in the knowledge graph:');
    for (const node of context.relevantNodes.slice(0, 30)) {
      let props = '';
      try {
        const p = JSON.parse(node.properties);
        const entries = Object.entries(p).filter(([k]) => k !== 'content' && k !== 'wikiLinks');
        if (entries.length > 0) {
          props = ' | ' + entries.map(([k, v]) => `${k}: ${v}`).join(', ');
        }
      } catch {}
      parts.push(`- [${node.type}] ${node.name} (id:${node.id})${props}${node.source_url ? ` (source: ${node.source_url})` : ''}`);
    }
    parts.push('');
  }

  if (context.relevantEdges.length > 0) {
    parts.push('## Relationships:');
    const nodeMap = new Map(context.relevantNodes.map((n) => [n.id, n.name]));
    for (const edge of context.relevantEdges.slice(0, 30)) {
      const src = nodeMap.get(edge.source_id) ?? edge.source_id;
      const tgt = nodeMap.get(edge.target_id) ?? edge.target_id;
      parts.push(`- ${src} --[${edge.label}]--> ${tgt}`);
    }
    parts.push('');
  }

  if (context.sourceExcerpts.length > 0) {
    parts.push('## Source content excerpts:');
    for (const excerpt of context.sourceExcerpts) {
      parts.push(`### ${excerpt.title ?? excerpt.nodeLabel} [Source: ${excerpt.url}]`);
      parts.push(excerpt.excerpt);
      parts.push('');
    }
  }

  return parts.join('\n');
}

export const RAG_SYSTEM_PROMPT = `You are a helpful assistant integrated into a knowledge graph browser extension. The user may ask general questions or questions about their personal knowledge graph (built from web pages, notes, and documents).

When knowledge graph context is provided (entities, relationships, source excerpts):
- Prioritize information from the provided context but supplement with your general knowledge when helpful.
- Use inline citations: [Source: url] when referencing specific source material.
- When mentioning entities from the knowledge graph, use the format [Entity Name](node:entity-id) so users can click to navigate to that entity. The entity-id is the id shown in parentheses after each entity listing.
- If the question asks about connections or relationships, trace the graph paths explicitly.

When no knowledge graph context is provided:
- Answer the question using your general knowledge.

Always:
- Structure your answer with clear paragraphs. Use markdown formatting (bold, lists, headers) when helpful.
- Keep answers concise but thorough.`;
