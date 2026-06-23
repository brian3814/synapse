/**
 * Markdown utilities for the OPFS note storage layer.
 *
 * `stripMarkdownToPlainText` produces clean prose suitable for FTS5
 * tokenisation (no JSON wrapping, no markdown syntax).
 */

export { parseMarkdown, generateNoteMarkdown } from '@/filesystem/markdown-parser';

/**
 * Strip markdown formatting to plain text for FTS indexing.
 * Removes frontmatter, headings, bold/italic, links, code, wiki-link brackets.
 */
export function stripMarkdownToPlainText(markdown: string): string {
  let text = markdown;

  // Remove YAML frontmatter block
  text = text.replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n?/, '');

  // Remove code fences (``` blocks)
  text = text.replace(/```[\s\S]*?```/g, '');

  // Remove inline code
  text = text.replace(/`([^`]+)`/g, '$1');

  // Remove images: ![alt](url)
  text = text.replace(/!\[([^\]]*)\]\([^)]*\)/g, '');

  // Convert links: [text](url) -> text
  text = text.replace(/\[([^\]]+)\]\([^)]*\)/g, '$1');

  // Convert wiki-links: [[label|display]] -> label, [[label]] -> label
  text = text.replace(/\[\[([^\]|]+)(?:\|[^\]]+)?\]\]/g, '$1');

  // Remove heading markers
  text = text.replace(/^#{1,6}\s+/gm, '');

  // Remove bold/italic markers
  text = text.replace(/\*{1,3}([^*]+)\*{1,3}/g, '$1');
  text = text.replace(/_{1,3}([^_]+)_{1,3}/g, '$1');

  // Remove horizontal rules
  text = text.replace(/^[-*_]{3,}\s*$/gm, '');

  // Remove HTML tags
  text = text.replace(/<[^>]+>/g, '');

  // Remove list markers (-, *, numbered)
  text = text.replace(/^\s*[-*+]\s+/gm, '');
  text = text.replace(/^\s*\d+\.\s+/gm, '');

  // Collapse multiple newlines
  text = text.replace(/\n{3,}/g, '\n\n');

  return text.trim();
}
