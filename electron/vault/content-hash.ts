import { createHash } from 'crypto';
import { readFileSync } from 'fs';

export function computeFileHash(absolutePath: string): string | null {
  try {
    const data = readFileSync(absolutePath);
    return createHash('sha256').update(data).digest('hex');
  } catch {
    return null;
  }
}

export function stripMarkdownForSearch(markdown: string): string {
  let text = markdown;
  text = text.replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n?/, '');
  text = text.replace(/```[\s\S]*?```/g, '');
  text = text.replace(/`([^`]+)`/g, '$1');
  text = text.replace(/!\[([^\]]*)\]\([^)]*\)/g, '');
  text = text.replace(/\[([^\]]+)\]\([^)]*\)/g, '$1');
  text = text.replace(/\[\[([^\]|]+)(?:\|[^\]]+)?\]\]/g, '$1');
  text = text.replace(/^#{1,6}\s+/gm, '');
  text = text.replace(/\*{1,3}([^*]+)\*{1,3}/g, '$1');
  text = text.replace(/_{1,3}([^_]+)_{1,3}/g, '$1');
  text = text.replace(/^[-*_]{3,}\s*$/gm, '');
  text = text.replace(/<[^>]+>/g, '');
  text = text.replace(/^\s*[-*+]\s+/gm, '');
  text = text.replace(/^\s*\d+\.\s+/gm, '');
  text = text.replace(/\n{3,}/g, '\n\n');
  return text.trim();
}
