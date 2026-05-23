/**
 * Lightweight markdown parsing: frontmatter extraction, wiki-link detection,
 * and basic entity extraction from headings/bold text.
 */

export interface ParsedMarkdown {
  frontmatter: Record<string, string>;
  title: string | null;
  content: string; // content without frontmatter
  wikiLinks: string[]; // [[linked labels]]
  headings: string[];
  boldTerms: string[];
}

/** Parse YAML-like frontmatter (simple key: value pairs) */
function parseFrontmatter(raw: string): { frontmatter: Record<string, string>; content: string } {
  const match = raw.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n([\s\S]*)$/);
  if (!match) return { frontmatter: {}, content: raw };

  const frontmatter: Record<string, string> = {};
  for (const line of match[1].split('\n')) {
    const idx = line.indexOf(':');
    if (idx > 0) {
      const key = line.slice(0, idx).trim();
      const value = line.slice(idx + 1).trim().replace(/^["']|["']$/g, '');
      if (key && value) frontmatter[key] = value;
    }
  }

  return { frontmatter, content: match[2] };
}

/** Extract [[wiki links]] from markdown content */
function extractWikiLinks(content: string): string[] {
  const links: string[] = [];
  const regex = /\[\[([^\]]+)\]\]/g;
  let match;
  while ((match = regex.exec(content)) !== null) {
    // Handle [[label|display]] syntax — use label part
    const label = match[1].split('|')[0].trim();
    if (label && !links.includes(label)) {
      links.push(label);
    }
  }
  return links;
}

/** Extract headings from markdown */
function extractHeadings(content: string): string[] {
  const headings: string[] = [];
  const regex = /^#{1,6}\s+(.+)$/gm;
  let match;
  while ((match = regex.exec(content)) !== null) {
    headings.push(match[1].trim());
  }
  return headings;
}

/** Extract bold/strong terms (potential entities) */
function extractBoldTerms(content: string): string[] {
  const terms: string[] = [];
  const regex = /\*\*([^*]+)\*\*/g;
  let match;
  while ((match = regex.exec(content)) !== null) {
    const term = match[1].trim();
    if (term.length > 1 && term.length < 100 && !terms.includes(term)) {
      terms.push(term);
    }
  }
  return terms;
}

export function parseMarkdown(raw: string): ParsedMarkdown {
  const { frontmatter, content } = parseFrontmatter(raw);

  // Title: frontmatter title, or first h1
  const h1Match = content.match(/^#\s+(.+)$/m);
  const title = frontmatter.title ?? h1Match?.[1]?.trim() ?? null;

  return {
    frontmatter,
    title,
    content,
    wikiLinks: extractWikiLinks(content),
    headings: extractHeadings(content),
    boldTerms: extractBoldTerms(content),
  };
}

/** Generate markdown content for a note */
export function generateNoteMarkdown(
  title: string,
  content: string,
  links: string[] = []
): string {
  const frontmatter = [
    '---',
    `title: "${title}"`,
    `created: "${new Date().toISOString()}"`,
    '---',
  ].join('\n');

  let body = `# ${title}\n\n${content}`;

  if (links.length > 0) {
    body += '\n\n## Links\n\n';
    body += links.map((l) => `- [[${l}]]`).join('\n');
  }

  return `${frontmatter}\n\n${body}\n`;
}
