/**
 * Wikilink parser — turns `[[wikilinks]]` inside note content into graph edges.
 *
 * Design constraints (see docs/design-three-layer-knowledge-model.md §Wikilink Parser):
 *  - Runs on note content within the extension (not on external files)
 *  - Creates edges only for EXACT name or alias matches (no fuzzy auto-linking;
 *    fuzzy matches are unreliable — "Transfer Learning" vs "Transformer" score ~0.72)
 *  - Label rules:
 *      target is a note     → 'references'
 *      target is a resource → 'references'
 *      target is an entity  → 'mention' (the stronger 'about' relationship is
 *                              only set during extraction)
 *  - Unresolved wikilinks are logged for a future "pending queue" UI; this
 *    parser does not create new nodes.
 */

import type { CommandContext } from '../commands/types';
import * as graphCommands from '../commands/graph-commands';

/**
 * Extract raw `[[…]]` tokens from note content.
 *
 * Rules:
 *  - `[[Display]]`           → target "Display"
 *  - `[[Target|Display]]`    → target "Target"
 *  - Whitespace is preserved inside the wikilink body but trimmed on return.
 *  - Duplicates within a single call are deduplicated (case-insensitive).
 */
export function extractWikilinks(content: string): string[] {
  const pattern = /\[\[([^\]|[]+)(?:\|[^\]]*)?\]\]/g;
  const seen = new Set<string>();
  const results: string[] = [];
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(content)) !== null) {
    const raw = match[1].trim();
    if (!raw) continue;
    const key = raw.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    results.push(raw);
  }
  return results;
}

/**
 * Resolve wikilink targets to existing node IDs using exact name + alias
 * matching only. Fuzzy matches are intentionally excluded — see design doc.
 * Returns both the resolved list and the unresolved strings (for a future
 * pending-links queue).
 */
export async function resolveWikilinks(
  ctx: CommandContext,
  wikilinks: string[],
): Promise<{
  resolved: Array<{ wikilink: string; nodeId: string; nodeType: string }>;
  unresolved: string[];
}> {
  const graph = await ctx.getGraphSnapshot();
  const resolved: Array<{ wikilink: string; nodeId: string; nodeType: string }> = [];
  const unresolved: string[] = [];

  for (const wikilink of wikilinks) {
    const lower = wikilink.toLowerCase();
    const inMemory = graph.nodes.find((n) => n.name.toLowerCase() === lower);
    if (inMemory) {
      resolved.push({ wikilink, nodeId: inMemory.id, nodeType: inMemory.type });
      continue;
    }

    try {
      const matches = await ctx.db.entityResolution.findMatches(wikilink);
      const exactOrAlias = matches.find(
        (m: any) => m.matchType === 'exact' || m.matchType === 'alias',
      );
      if (exactOrAlias) {
        const node = graph.nodes.find((n) => n.id === (exactOrAlias as any).nodeId);
        resolved.push({
          wikilink,
          nodeId: (exactOrAlias as any).nodeId,
          nodeType: node?.type ?? 'entity',
        });
        continue;
      }
    } catch {
      // Entity resolution unavailable
    }

    unresolved.push(wikilink);
  }

  return { resolved, unresolved };
}

/**
 * Pick the edge label for a wikilink-derived edge based on the target's type.
 * These are "soft" links from prose; the stronger `about` relationship is
 * only assigned explicitly during extraction.
 */
function labelForWikilinkTarget(targetType: string): string {
  if (targetType === 'note' || targetType === 'resource') return 'references';
  return 'mention';
}

/**
 * Parse a note's content, resolve all wikilinks, and create the corresponding
 * graph edges. Existing edges from this note are preserved (idempotent via
 * the UNIQUE(source_id, target_id, label) constraint on edges).
 *
 * Returns the number of edges created (approximate — duplicates are silently
 * dropped by the DB).
 */
export async function createWikilinkEdgesForNote(
  ctx: CommandContext,
  noteNodeId: string,
  content: string,
): Promise<{ created: number; unresolved: string[] }> {
  const wikilinks = extractWikilinks(content);
  if (wikilinks.length === 0) return { created: 0, unresolved: [] };

  const { resolved, unresolved } = await resolveWikilinks(ctx, wikilinks);
  if (resolved.length === 0) return { created: 0, unresolved };

  let created = 0;
  for (const target of resolved) {
    if (target.nodeId === noteNodeId) continue;
    const label = labelForWikilinkTarget(target.nodeType);
    try {
      const result = await graphCommands.createEdge(ctx, {
        sourceId: noteNodeId,
        targetId: target.nodeId,
        label,
        skipProvenance: true,
      });
      if (result.data) created++;
    } catch {
      // UNIQUE constraint: edge already exists
    }
  }
  return { created, unresolved };
}
