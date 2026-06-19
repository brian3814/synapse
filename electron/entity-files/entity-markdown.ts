export interface EntityEdgeInfo {
  sourceName?: string;
  targetName?: string;
  label: string;
  direction: 'outgoing' | 'incoming';
}

export interface EntitySourceInfo {
  name: string;
  url: string | null;
}

export interface GenerateEntityInput {
  id: string;
  name: string;
  summary: string | null;
  edges: EntityEdgeInfo[];
  sources: EntitySourceInfo[];
}

export function generateEntityMarkdown(input: GenerateEntityInput): string {
  const lines: string[] = [];

  lines.push('---');
  lines.push(`id: ${input.id}`);
  lines.push(`title: ${input.name}`);
  lines.push('---');
  lines.push('');
  lines.push(`# ${input.name}`);
  lines.push('');

  if (input.summary) {
    lines.push(input.summary);
    lines.push('');
  }

  if (input.edges.length > 0) {
    lines.push('## Relationships');
    lines.push('');
    for (const edge of input.edges) {
      if (edge.direction === 'outgoing') {
        lines.push(`- [[${edge.targetName}]] — *${edge.label}*`);
      } else {
        lines.push(`- [[${edge.sourceName}]] → *${edge.label}*`);
      }
    }
    lines.push('');
  }

  if (input.sources.length > 0) {
    lines.push('## Sources');
    lines.push('');
    for (const src of input.sources) {
      if (src.url) {
        lines.push(`- [${src.name}](${src.url})`);
      } else {
        lines.push(`- ${src.name}`);
      }
    }
    lines.push('');
  }

  return lines.join('\n');
}

export interface ParsedEntityFrontmatter {
  id: string | null;
  title: string | null;
}

export function parseEntityFrontmatter(content: string): ParsedEntityFrontmatter {
  const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (!match) {
    // No frontmatter — fall back to first H1, then null
    const h1 = content.match(/^#\s+(.+)$/m)?.[1]?.trim() ?? null;
    return { id: null, title: h1 };
  }

  let id: string | null = null;
  let title: string | null = null;

  for (const line of match[1].split('\n')) {
    const idx = line.indexOf(':');
    if (idx <= 0) continue;
    const key = line.slice(0, idx).trim();
    const value = line.slice(idx + 1).trim();
    if (key === 'id') id = value;
    if (key === 'title') title = value;
  }

  return { id, title };
}

export function rewriteTitle(content: string, newTitle: string): string {
  return content.replace(
    /^(---\r?\n[\s\S]*?)title:.*(\r?\n[\s\S]*?---)/,
    `$1title: ${newTitle}$2`
  );
}
