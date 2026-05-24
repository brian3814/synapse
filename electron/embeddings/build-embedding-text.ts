import type Database from 'better-sqlite3';

export function buildEmbeddingText(
  node: { id: string; name: string; type: string; label?: string | null; summary?: string | null },
  db: Database.Database,
  readNote?: (nodeId: string) => string | null,
): string {
  if (node.type === 'entity') {
    const parts = [node.name];
    if (node.label) parts.push(node.label);
    if (node.summary) parts.push(node.summary);
    if (parts.length === 1) {
      const neighbors = db.prepare(
        `SELECT DISTINCT e.label FROM edges e WHERE e.source_id = ? OR e.target_id = ? LIMIT 5`
      ).all(node.id, node.id) as Array<{ label: string }>;
      const edgeLabels = neighbors.map((n) => n.label).filter(Boolean);
      if (edgeLabels.length > 0) parts.push(edgeLabels.join(', '));
    }
    return parts.join('. ');
  }

  if (node.type === 'note') {
    if (readNote) {
      const content = readNote(node.id);
      if (content) {
        const frontmatter = parseFrontmatter(content);
        if (frontmatter.description || frontmatter.labels) {
          const parts = [node.name];
          if (frontmatter.description) parts.push(frontmatter.description);
          if (frontmatter.labels) parts.push(frontmatter.labels);
          return parts.join('. ');
        }
        const body = stripFrontmatter(content).slice(0, 500);
        if (body.trim()) return `${node.name}. ${body.trim()}`;
      }
    }
    const noteRow = db.prepare('SELECT title, body FROM note_search WHERE node_id = ?').get(node.id) as { title: string; body: string } | undefined;
    if (noteRow?.body) return `${node.name}. ${noteRow.body.slice(0, 500)}`;
    return node.name;
  }

  if (node.type === 'resource') {
    const source = db.prepare('SELECT title, content FROM source_content WHERE node_id = ?').get(node.id) as { title: string | null; content: string } | undefined;
    if (source) {
      const parts = [node.name];
      if (source.title) parts.push(source.title);
      parts.push(source.content.slice(0, 500));
      return parts.join('. ');
    }
    return node.name;
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
