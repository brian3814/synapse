import { resolve, relative } from 'path';
import {
  readFileSync,
  writeFileSync,
  unlinkSync,
  readdirSync,
  existsSync,
  mkdirSync,
} from 'fs';

let root: string | null = null;

/**
 * Set the root directory for file operations.
 * Called when a vault is opened — points to `{vaultPath}/.kg/agent/`.
 */
export function setRoot(newRoot: string): void {
  root = newRoot;
}

/**
 * Clear the root (e.g. when vault is closed).
 */
export function clearRoot(): void {
  root = null;
}

function getRoot(): string {
  if (!root) {
    throw new Error('Files backend: no vault is open (root not set)');
  }
  return root;
}

function validatePath(path: string): string {
  if (path.includes('..') || path.startsWith('/')) {
    throw new Error(`Invalid path: ${path}`);
  }
  const currentRoot = getRoot();
  const full = resolve(currentRoot, path);
  const rel = relative(currentRoot, full);
  if (rel.startsWith('..')) {
    throw new Error(`Path escapes root: ${path}`);
  }
  return full;
}

export function readFile(path: string): string | null {
  try {
    const full = validatePath(path);
    if (!existsSync(full)) return null;
    return readFileSync(full, 'utf-8');
  } catch (e: any) {
    if (e.code === 'EPERM' || e.code === 'EACCES') {
      console.warn(`[files-backend] Cannot read file ${path}: ${e.code}`);
      return null;
    }
    throw e;
  }
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
  try {
    const entries = readdirSync(full);
    return entries
      .filter((name) => name.endsWith('.md'))
      .map((name) => `${cleanPrefix}/${name}`);
  } catch (e: any) {
    // Gracefully handle permission errors (EPERM/EACCES) — return empty list
    if (e.code === 'EPERM' || e.code === 'EACCES') {
      console.warn(`[files-backend] Cannot read directory ${full}: ${e.code}`);
      return [];
    }
    throw e;
  }
}
