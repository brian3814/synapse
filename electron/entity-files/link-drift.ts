import type Database from 'better-sqlite3';

export interface LinkDriftItem {
  type: 'link_broken' | 'link_dead' | 'link_missing';
  linkText: string;
  suggestedFix: string | null;
  edgeLabel?: string;
}

export function resolveEntityLinks(
  db: Database.Database,
  nodeId: string,
  fileContent: string,
  options: { includeMissingRelationships?: boolean } = {}
): LinkDriftItem[] {
  const items: LinkDriftItem[] = [];
  const wikiLinkRegex = /\[\[([^\]]+)\]\]/g;

  const fileLinks = new Set<string>();
  let match;
  while ((match = wikiLinkRegex.exec(fileContent)) !== null) {
    const label = match[1].split('|')[0].trim();
    if (label) fileLinks.add(label);
  }

  for (const linkText of fileLinks) {
    const exactMatch = db.prepare(
      "SELECT id, name FROM nodes WHERE name = ? AND type = 'entity'"
    ).get(linkText) as { id: string; name: string } | undefined;

    if (exactMatch) continue;

    const aliasMatch = db.prepare(
      'SELECT n.id, n.name FROM entity_aliases ea JOIN nodes n ON ea.node_id = n.id WHERE ea.alias_lower = ?'
    ).get(linkText.toLowerCase()) as { id: string; name: string } | undefined;

    if (aliasMatch) {
      items.push({ type: 'link_broken', linkText, suggestedFix: aliasMatch.name });
    } else {
      items.push({ type: 'link_dead', linkText, suggestedFix: null });
    }
  }

  if (options.includeMissingRelationships) {
    const edges = db.prepare(
      `SELECT e.label, n.name as other_name
       FROM edges e
       JOIN nodes n ON (CASE WHEN e.source_id = ? THEN e.target_id ELSE e.source_id END) = n.id
       WHERE (e.source_id = ? OR e.target_id = ?) AND n.type = 'entity'`
    ).all(nodeId, nodeId, nodeId) as { label: string; other_name: string }[];

    for (const edge of edges) {
      if (!fileLinks.has(edge.other_name)) {
        items.push({
          type: 'link_missing',
          linkText: edge.other_name,
          suggestedFix: `- [[${edge.other_name}]] — *${edge.label}*`,
          edgeLabel: edge.label,
        });
      }
    }
  }

  return items;
}
