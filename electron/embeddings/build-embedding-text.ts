import type Database from 'better-sqlite3';

function getNeighborContext(db: Database.Database, nodeId: string, limit = 8): string {
  const rows = db.prepare(
    `SELECT n.name AS neighbor_name, e.label AS edge_label,
            CASE WHEN e.source_id = ? THEN 'out' ELSE 'in' END AS direction
     FROM edges e
     JOIN nodes n ON n.id = CASE WHEN e.source_id = ? THEN e.target_id ELSE e.source_id END
     WHERE (e.source_id = ? OR e.target_id = ?)
     ORDER BY n.id
     LIMIT ?`
  ).all(nodeId, nodeId, nodeId, nodeId, limit) as Array<{
    neighbor_name: string; edge_label: string | null; direction: 'in' | 'out';
  }>;
  if (rows.length === 0) return '';
  return rows.map((r) => {
    if (!r.edge_label) return r.neighbor_name;
    const arrow = r.direction === 'out' ? '→' : '←';
    return `${r.neighbor_name} (${arrow}${r.edge_label})`;
  }).join(', ');
}

export function buildEmbeddingText(
  node: { id: string; name: string; type: string; label?: string | null; summary?: string | null },
  db: Database.Database,
  readNote?: (nodeId: string) => string | null,
  strategy: 'basic' | 'graph-aware' = 'basic',
): string {
  if (node.type === 'entity') {
    const parts = [node.name];
    if (node.label) parts.push(node.label);
    if (node.summary) parts.push(node.summary);
    if (strategy === 'graph-aware') {
      const ctx = getNeighborContext(db, node.id);
      if (ctx) parts.push(`[related] ${ctx}`);
    } else if (parts.length === 1) {
      const neighbors = db.prepare(
        `SELECT DISTINCT e.label FROM edges e WHERE e.source_id = ? OR e.target_id = ? LIMIT 5`
      ).all(node.id, node.id) as Array<{ label: string }>;
      const edgeLabels = neighbors.map((n) => n.label).filter(Boolean);
      if (edgeLabels.length > 0) parts.push(edgeLabels.join(', '));
    }
    return parts.join('. ');
  }

  if (node.type === 'note') {
    let baseText = '';
    if (readNote) {
      const content = readNote(node.id);
      if (content) {
        const frontmatter = parseFrontmatter(content);
        if (frontmatter.description || frontmatter.labels) {
          const parts = [node.name];
          if (frontmatter.description) parts.push(frontmatter.description);
          if (frontmatter.labels) parts.push(frontmatter.labels);
          baseText = parts.join('. ');
        } else {
          const body = stripFrontmatter(content).slice(0, 500);
          if (body.trim()) baseText = `${node.name}. ${body.trim()}`;
        }
      }
    }
    if (!baseText) {
      const noteRow = db.prepare('SELECT title, body FROM note_search WHERE node_id = ?').get(node.id) as { title: string; body: string } | undefined;
      if (noteRow?.body) baseText = `${node.name}. ${noteRow.body.slice(0, 500)}`;
    }
    if (!baseText) baseText = node.name;
    if (strategy === 'graph-aware') {
      const ctx = getNeighborContext(db, node.id);
      if (ctx) baseText += `. [mentions] ${ctx}`;
    }
    return baseText;
  }

  if (node.type === 'resource') {
    const parts = [node.name];
    const source = db.prepare('SELECT title, content FROM source_content WHERE node_id = ?').get(node.id) as { title: string | null; content: string } | undefined;
    if (source) {
      if (source.title) parts.push(source.title);
      parts.push(source.content.slice(0, 500));
    }
    if (strategy === 'graph-aware') {
      const ctx = getNeighborContext(db, node.id);
      if (ctx) parts.push(`[entities] ${ctx}`);
    }
    return parts.join('. ');
  }

  return node.name;
}

function parseFrontmatter(content: string): { description?: string; labels?: string } {
  const match = content.match(/^---\n([\s\S]*?)\n---/);
  if (!match) return {};
  const yaml = match[1];
  const result: { description?: string; labels?: string } = {};
  const descMatch = yaml.match(/description:\s*(.+)/);
  if (descMatch) result.description = descMatch[1].trim().replace(/^["']|["']$/g, '');
  const labelMatch = yaml.match(/labels:\s*(.+)/);
  if (labelMatch) result.labels = labelMatch[1].trim().replace(/^["']|["']$/g, '');
  return result;
}

function stripFrontmatter(content: string): string {
  return content.replace(/^---\n[\s\S]*?\n---\n?/, '');
}

export function computeTextHash(text: string): string {
  let hash = 5381;
  for (let i = 0; i < text.length; i++) {
    hash = ((hash << 5) + hash + text.charCodeAt(i)) | 0;
  }
  return hash.toString(36);
}
