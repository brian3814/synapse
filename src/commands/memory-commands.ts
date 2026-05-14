import type { CommandContext } from './types';

export interface MemoryEntry {
  filename: string;
  name: string;
  type: string;
  description: string;
  content: string;
  created_at: string;
  updated_at: string;
  tags: string[];
  superseded_by: string | null;
  valid: boolean;
  access_count: number;
  last_accessed: string | null;
}

interface WriteMemoryInput {
  action: 'create' | 'update' | 'delete' | 'list';
  filename?: string;
  type?: string;
  name?: string;
  description?: string;
  content?: string;
}

const FILENAME_RE = /^[a-z0-9_-]+\.md$/;
const NAME_RE = /^[a-z0-9-]+$/;
const VALID_TYPES = ['preference', 'fact', 'instruction', 'episodic'];

function validateFilename(filename: string): void {
  if (!FILENAME_RE.test(filename)) {
    throw new Error(`Invalid filename: ${filename}. Must match [a-z0-9_-]+.md`);
  }
  if (filename === 'MEMORY.md') {
    throw new Error('MEMORY.md is reserved for the index file');
  }
}

function escapeYaml(value: string): string {
  const clean = value.replace(/\n/g, ' ').trim();
  if (/[":{}[\],&*?|>!%@`#]/.test(clean) || clean.includes("'")) {
    return `"${clean.replace(/"/g, '\\"')}"`;
  }
  return clean;
}

function parseFrontmatter(raw: string): { meta: Record<string, any>; body: string } {
  const meta: Record<string, any> = {};
  if (!raw.startsWith('---')) {
    return { meta, body: raw };
  }
  const end = raw.indexOf('\n---', 3);
  if (end === -1) return { meta, body: raw };

  const frontmatter = raw.slice(4, end);
  const body = raw.slice(end + 4).trim();

  for (const line of frontmatter.split('\n')) {
    const colon = line.indexOf(':');
    if (colon === -1) continue;
    const key = line.slice(0, colon).trim();
    let value = line.slice(colon + 1).trim();

    if (value.startsWith('[') && value.endsWith(']')) {
      meta[key] = value.slice(1, -1).split(',').map((s) => s.trim()).filter(Boolean);
      continue;
    }
    if (value === 'true') { meta[key] = true; continue; }
    if (value === 'false') { meta[key] = false; continue; }
    if (value === '' || value === 'null') { meta[key] = null; continue; }
    if (/^\d+$/.test(value)) { meta[key] = parseInt(value, 10); continue; }
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    meta[key] = value;
  }

  return { meta, body };
}

function generateMemoryFile(entry: {
  name: string;
  type: string;
  description: string;
  content: string;
  created_at: string;
  updated_at: string;
  tags?: string[];
  superseded_by?: string | null;
  valid?: boolean;
  access_count?: number;
  last_accessed?: string | null;
}): string {
  const tags = entry.tags?.length ? `[${entry.tags.join(', ')}]` : '[]';
  const valid = entry.valid !== false ? 'true' : 'false';
  const accessCount = entry.access_count ?? 0;
  const lastAccessed = entry.last_accessed ?? '';
  const supersededBy = entry.superseded_by ?? '';

  return `---
name: ${escapeYaml(entry.name)}
description: ${escapeYaml(entry.description)}
type: ${entry.type}
tags: ${tags}
superseded_by: ${supersededBy}
valid: ${valid}
created_at: ${entry.created_at}
updated_at: ${entry.updated_at}
access_count: ${accessCount}
last_accessed: ${lastAccessed}
---

${entry.content}`;
}

function generateIndexContent(entries: MemoryEntry[]): string {
  if (entries.length === 0) return '# Memory\n\nNo memories yet.\n';
  const lines = entries.map((e) => `- [${e.filename}](${e.filename}) — ${e.description}`);
  return `# Memory\n\n${lines.join('\n')}\n`;
}

export async function listMemories(ctx: CommandContext): Promise<MemoryEntry[]> {
  const files = await ctx.files.list('memory/');
  const entries: MemoryEntry[] = [];

  for (const path of files) {
    const filename = path.replace('memory/', '');
    if (filename === 'MEMORY.md') continue;

    const raw = await ctx.files.read(path);
    if (!raw) continue;

    const { meta, body } = parseFrontmatter(raw);
    entries.push({
      filename,
      name: meta.name ?? filename.replace('.md', ''),
      type: meta.type ?? 'fact',
      description: meta.description ?? '',
      content: body,
      created_at: meta.created_at ?? '',
      updated_at: meta.updated_at ?? '',
      tags: Array.isArray(meta.tags) ? meta.tags : [],
      superseded_by: meta.superseded_by ?? null,
      valid: meta.valid !== false,
      access_count: typeof meta.access_count === 'number' ? meta.access_count : 0,
      last_accessed: meta.last_accessed ?? null,
    });
  }

  return entries;
}

export async function readMemory(ctx: CommandContext, filename: string): Promise<MemoryEntry | null> {
  validateFilename(filename);
  const raw = await ctx.files.read(`memory/${filename}`);
  if (!raw) return null;

  const { meta, body } = parseFrontmatter(raw);
  return {
    filename,
    name: meta.name ?? filename.replace('.md', ''),
    type: meta.type ?? 'fact',
    description: meta.description ?? '',
    content: body,
    created_at: meta.created_at ?? '',
    updated_at: meta.updated_at ?? '',
    tags: Array.isArray(meta.tags) ? meta.tags : [],
    superseded_by: meta.superseded_by ?? null,
    valid: meta.valid !== false,
    access_count: typeof meta.access_count === 'number' ? meta.access_count : 0,
    last_accessed: meta.last_accessed ?? null,
  };
}

export async function writeMemory(ctx: CommandContext, input: WriteMemoryInput): Promise<string> {
  const now = new Date().toISOString();

  if (input.action === 'create') {
    if (!input.type || !input.name || !input.description || !input.content) {
      throw new Error('create requires type, name, description, and content');
    }
    if (!VALID_TYPES.includes(input.type)) {
      throw new Error(`Invalid type: ${input.type}. Must be one of: ${VALID_TYPES.join(', ')}`);
    }
    if (!NAME_RE.test(input.name)) {
      throw new Error(`Invalid name: ${input.name}. Must be kebab-case [a-z0-9-]`);
    }

    const filename = `${input.type}_${input.name}.md`;
    validateFilename(filename);

    const existing = await ctx.files.read(`memory/${filename}`);
    if (existing) {
      throw new Error(`Memory file already exists: ${filename}. Use action 'update' instead.`);
    }

    const content = generateMemoryFile({
      name: input.name,
      type: input.type,
      description: input.description,
      content: input.content,
      created_at: now,
      updated_at: now,
    });

    await ctx.files.write(`memory/${filename}`, content);
    await regenerateIndex(ctx);
    return filename;
  }

  if (input.action === 'update') {
    if (!input.filename) throw new Error('update requires filename');
    validateFilename(input.filename);

    const existing = await readMemory(ctx, input.filename);
    if (!existing) throw new Error(`Memory not found: ${input.filename}`);

    const updated = generateMemoryFile({
      name: input.name ?? existing.name,
      type: input.type ?? existing.type,
      description: input.description ?? existing.description,
      content: input.content ?? existing.content,
      created_at: existing.created_at || now,
      updated_at: now,
    });

    await ctx.files.write(`memory/${input.filename}`, updated);
    await regenerateIndex(ctx);
    return input.filename;
  }

  if (input.action === 'delete') {
    if (!input.filename) throw new Error('delete requires filename');
    validateFilename(input.filename);
    await ctx.files.remove(`memory/${input.filename}`);
    await regenerateIndex(ctx);
    return input.filename;
  }

  throw new Error(`Unknown action: ${input.action}`);
}

export async function deleteMemory(ctx: CommandContext, filename: string): Promise<boolean> {
  validateFilename(filename);
  await ctx.files.remove(`memory/${filename}`);
  await regenerateIndex(ctx);
  return true;
}

export async function regenerateIndex(ctx: CommandContext): Promise<void> {
  const entries = await listMemories(ctx);
  const content = generateIndexContent(entries);
  await ctx.files.write('memory/MEMORY.md', content);
}

export async function loadAllForPrompt(ctx: CommandContext): Promise<Array<{ category: string; content: string }>> {
  const entries = await listMemories(ctx);

  entries.sort((a, b) => (b.updated_at || '').localeCompare(a.updated_at || ''));

  const result: Array<{ category: string; content: string }> = [];
  let totalChars = 0;
  const MAX_CHARS = 2000;

  for (const entry of entries) {
    if (totalChars + entry.content.length > MAX_CHARS) break;
    result.push({ category: entry.type, content: entry.content });
    totalChars += entry.content.length;
  }

  return result;
}

export async function loadValidMemories(ctx: CommandContext): Promise<MemoryEntry[]> {
  const all = await listMemories(ctx);
  return all.filter((e) => e.valid !== false);
}

export async function executeManageMemory(ctx: CommandContext, input: Record<string, unknown>): Promise<string> {
  const action = input.action as string;

  if (action === 'list') {
    const entries = await listMemories(ctx);
    return JSON.stringify({
      memories: entries.map((e) => ({
        filename: e.filename,
        type: e.type,
        description: e.description,
        updated_at: e.updated_at,
      })),
      total: entries.length,
    });
  }

  try {
    const filename = await writeMemory(ctx, {
      action: action as 'create' | 'update' | 'delete',
      filename: input.filename as string | undefined,
      type: input.type as string | undefined,
      name: input.name as string | undefined,
      description: input.description as string | undefined,
      content: input.content as string | undefined,
    });
    return JSON.stringify({ success: true, action, filename });
  } catch (e: any) {
    return JSON.stringify({ error: e.message });
  }
}

export async function migrateFromDB(
  ctx: CommandContext,
  records: Array<{ category: string; content: string; id: string }>,
): Promise<number> {
  let migrated = 0;
  for (const record of records) {
    const slug = record.content
      .toLowerCase()
      .replace(/[^a-z0-9\s-]/g, '')
      .trim()
      .replace(/\s+/g, '-')
      .slice(0, 40);
    const name = slug || record.id.slice(0, 12);
    try {
      await writeMemory(ctx, {
        action: 'create',
        type: record.category,
        name,
        description: record.content.slice(0, 80),
        content: record.content,
      });
      migrated++;
    } catch {
      // Skip duplicates or invalid entries
    }
  }
  return migrated;
}
