import { app } from 'electron';
import { join, resolve, relative } from 'path';
import {
  readFileSync,
  writeFileSync,
  unlinkSync,
  readdirSync,
  existsSync,
  mkdirSync,
} from 'fs';

const ROOT = join(app.getPath('documents'), 'KnowledgeGraph');

function validatePath(path: string): string {
  if (path.includes('..') || path.startsWith('/')) {
    throw new Error(`Invalid path: ${path}`);
  }
  const full = resolve(ROOT, path);
  const rel = relative(ROOT, full);
  if (rel.startsWith('..')) {
    throw new Error(`Path escapes root: ${path}`);
  }
  return full;
}

export function readFile(path: string): string | null {
  const full = validatePath(path);
  if (!existsSync(full)) return null;
  return readFileSync(full, 'utf-8');
}

export function writeFile(path: string, content: string): void {
  const full = validatePath(path);
  const dir = full.slice(0, full.lastIndexOf('/'));
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  writeFileSync(full, content, 'utf-8');
}

export function removeFile(path: string): void {
  const full = validatePath(path);
  if (existsSync(full)) unlinkSync(full);
}

export function listFiles(prefix: string): string[] {
  const cleanPrefix = prefix.replace(/\/$/, '');
  const full = validatePath(cleanPrefix);
  if (!existsSync(full)) return [];
  const entries = readdirSync(full);
  return entries
    .filter((name) => name.endsWith('.md'))
    .map((name) => `${cleanPrefix}/${name}`);
}
