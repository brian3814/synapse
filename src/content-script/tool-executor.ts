import { extractPageContent, extractContentElement } from './page-extractor';
import { htmlToMarkdown } from '../shared/html-to-markdown';

const MAX_TEXT_LENGTH = 50_000;

export function executeTool(
  name: string,
  input: Record<string, unknown>
): string {
  switch (name) {
    case 'get_page_content':
      return getPageContent(input);
    case 'get_page_metadata':
      return getPageMetadata();
    case 'query_selector':
      return querySelector(input.selector as string);
    case 'query_selector_all':
      return querySelectorAll(input.selector as string, (input.limit as number) ?? 50);
    case 'get_links':
      return getLinks(input.scope as string | undefined);
    case 'get_tables':
      return getTables(input.selector as string | undefined);
    case 'get_structured_data':
      return getStructuredData();
    default:
      throw new Error(`Unknown tool: ${name}`);
  }
}

function getPageContent(input: Record<string, unknown>): string {
  const format = (input.format as string) ?? 'markdown';

  if (format === 'text') {
    const { text, title, url } = extractPageContent();
    const content = text.length > MAX_TEXT_LENGTH
      ? text.substring(0, MAX_TEXT_LENGTH) + '...[truncated]'
      : text;
    return JSON.stringify({ title, url, content });
  }

  // Markdown path (default)
  const { title, url, element } = extractContentElement();
  let markdown = htmlToMarkdown(element);
  markdown = markdown.replace(/\n{3,}/g, '\n\n');
  if (markdown.length > MAX_TEXT_LENGTH) {
    markdown = markdown.substring(0, MAX_TEXT_LENGTH) + '\n\n...[truncated]';
  }
  return JSON.stringify({ title, url, content: markdown });
}

function getPageMetadata(): string {
  const title = document.title;
  const url = window.location.href;

  const metaDescription =
    document.querySelector('meta[name="description"]')?.getAttribute('content') ?? null;

  // OG tags
  const ogTags: Record<string, string> = {};
  document.querySelectorAll('meta[property^="og:"]').forEach((el) => {
    const prop = el.getAttribute('property');
    const content = el.getAttribute('content');
    if (prop && content) ogTags[prop] = content;
  });

  // JSON-LD
  const jsonLd: unknown[] = [];
  document.querySelectorAll('script[type="application/ld+json"]').forEach((el) => {
    try {
      jsonLd.push(JSON.parse(el.textContent ?? ''));
    } catch { /* skip malformed */ }
  });

  // Heading outline
  const headings: Array<{ level: number; text: string }> = [];
  document.querySelectorAll('h1, h2, h3').forEach((el) => {
    const text = (el as HTMLElement).innerText?.trim();
    if (text) {
      headings.push({
        level: parseInt(el.tagName.substring(1)),
        text,
      });
    }
  });

  return JSON.stringify({ title, url, metaDescription, ogTags, jsonLd, headings });
}

function querySelector(selector: string): string {
  const el = document.querySelector(selector) as HTMLElement | null;
  if (!el) return JSON.stringify({ text: null, error: `No element found for selector: ${selector}` });
  const text = el.innerText?.trim() ?? '';
  return JSON.stringify({ text: text.substring(0, MAX_TEXT_LENGTH) });
}

function querySelectorAll(selector: string, limit: number): string {
  const els = Array.from(document.querySelectorAll(selector)).slice(0, Math.min(limit, 50));
  const results = els.map((el) => (el as HTMLElement).innerText?.trim() ?? '');
  return JSON.stringify({ results, count: results.length });
}

function getLinks(scope?: string): string {
  const container = scope ? document.querySelector(scope) : document.body;
  if (!container) return JSON.stringify({ links: [], error: `Scope not found: ${scope}` });

  const links: Array<{ text: string; href: string }> = [];
  container.querySelectorAll('a[href]').forEach((el) => {
    const text = (el as HTMLElement).innerText?.trim();
    const href = el.getAttribute('href');
    if (text && href) {
      links.push({ text: text.substring(0, 200), href });
    }
  });
  return JSON.stringify({ links: links.slice(0, 200) });
}

function getTables(selector?: string): string {
  const tables = Array.from(
    document.querySelectorAll(selector ?? 'table')
  ).slice(0, 5);

  const result = tables.map((table) => {
    const headerRow = table.querySelector('thead tr, tr:first-child');
    const headers: string[] = [];
    headerRow?.querySelectorAll('th, td').forEach((cell) => {
      headers.push((cell as HTMLElement).innerText?.trim() ?? '');
    });

    const rows: Array<Record<string, string>> = [];
    const bodyRows = table.querySelectorAll('tbody tr, tr');
    bodyRows.forEach((row, i) => {
      if (i === 0 && row === headerRow) return; // skip header row
      if (rows.length >= 100) return;
      const cells: Record<string, string> = {};
      row.querySelectorAll('td, th').forEach((cell, j) => {
        const key = headers[j] || `col_${j}`;
        cells[key] = (cell as HTMLElement).innerText?.trim() ?? '';
      });
      if (Object.keys(cells).length > 0) rows.push(cells);
    });

    return { headers, rows, rowCount: rows.length };
  });

  return JSON.stringify({ tables: result });
}

function getStructuredData(): string {
  const jsonLd: unknown[] = [];
  document.querySelectorAll('script[type="application/ld+json"]').forEach((el) => {
    try {
      jsonLd.push(JSON.parse(el.textContent ?? ''));
    } catch { /* skip */ }
  });

  // Basic microdata extraction
  const microdata: Array<{ type: string; properties: Record<string, string> }> = [];
  document.querySelectorAll('[itemscope]').forEach((scope) => {
    const type = scope.getAttribute('itemtype') ?? 'unknown';
    const properties: Record<string, string> = {};
    scope.querySelectorAll('[itemprop]').forEach((prop) => {
      const name = prop.getAttribute('itemprop');
      const value =
        prop.getAttribute('content') ??
        (prop as HTMLElement).innerText?.trim() ??
        '';
      if (name) properties[name] = value.substring(0, 500);
    });
    if (Object.keys(properties).length > 0) {
      microdata.push({ type, properties });
    }
  });

  return JSON.stringify({ jsonLd, microdata });
}
